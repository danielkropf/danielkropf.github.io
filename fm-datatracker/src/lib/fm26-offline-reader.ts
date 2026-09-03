import { ZSTDDecoder } from 'zstddec/stream'
import { FM26OfflineReaderV022 } from './fm26-offline-reader-v022.js'
import { enrichOfflineTeamNames } from './fm26-team-resolver'
import { enrichOfflineContracts } from './fm26-contract-reader'
import { enrichOfflineMembershipFacts } from './fm26-membership-facts'
import { readCompetitionHistory } from './fm26-competition-history'
import { parseFm26SaveSummaryDate } from './fm26-save-summary'

type ReaderResult = Record<string, unknown>
type ReaderConstructor = new (args: {
  gameDb: Uint8Array
  stats: Uint8Array
  tactics: Uint8Array
  humans: Uint8Array
  historyDt: Uint8Array | null
  fileName: string
  internalName: string | null
  manifestMembers: number
}) => { read(): ReaderResult }

type Archive = {
  init(): Promise<Archive>
  getMember(name: string): Promise<Uint8Array>
  memberByName: Map<string, unknown>
  saveName: string | null
  members: unknown[]
}

let decoderPromise: Promise<ZSTDDecoder> | null = null
const decoderInstance = () => decoderPromise ??= (async () => {
  const decoder = new ZSTDDecoder()
  await decoder.init()
  return decoder
})()

async function localZstd(frame: Uint8Array): Promise<Uint8Array> {
  const decoder = await decoderInstance()
  const chunks = [...decoder.decodeStreaming([frame])]
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output
}

async function optionalArchiveMember(archive: Archive, name: string, warnings: string[]): Promise<Uint8Array | null> {
  if (!archive.memberByName.has(name)) return null
  try {
    return await archive.getMember(name)
  } catch (error) {
    warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** Reads the required FM26 members locally and keeps the characterized v0.22 core read-only. */
export async function readOfflineSaveBytes(saveBytes: Uint8Array, fileName = 'save.fm', onStatus: (status: string) => void = () => {}): Promise<ReaderResult> {
  onStatus('Lendo contêiner e manifesto…')
  const ArchiveConstructor = FM26OfflineReaderV022.FMArchive as unknown as new (data: Uint8Array, fileName: string, decompress: (frame: Uint8Array) => Promise<Uint8Array>) => Archive
  const archive = await new ArchiveConstructor(saveBytes, fileName, localZstd).init()
  onStatus('Descompactando game_db.dat…')
  const gameDb = await archive.getMember('game_db.dat')
  onStatus('Descompactando estatísticas…')
  const stats = await archive.getMember('rgman/player_stats.dat')
  const history = archive.memberByName.has('player_stats_hist_dt.cmt') ? await archive.getMember('player_stats_hist_dt.cmt') : null
  onStatus('Descompactando tática, técnicos humanos e resumo do save…')
  const [tactics, humans, saveSummaryData] = await Promise.all([
    archive.getMember('tactics_man.dat'),
    archive.getMember('humans.dat'),
    archive.memberByName.has('save_game_summary.dat') ? archive.getMember('save_game_summary.dat') : Promise.resolve(null),
  ])
  onStatus('Interpretando elencos, atributos, estatísticas e táticas…')
  const Reader = FM26OfflineReaderV022.FM26V1Reader as unknown as ReaderConstructor
  const result = new Reader({ gameDb, stats, tactics, humans, historyDt: history, fileName, internalName: archive.saveName, manifestMembers: archive.members.length }).read()
  const expectedHumanCount = humans.length >= 10 ? humans[8] | (humans[9] << 8) : 0
  const saveSummary = parseFm26SaveSummaryDate(saveSummaryData, expectedHumanCount)
  const currentSave = result.save && typeof result.save === 'object' && !Array.isArray(result.save) ? result.save as Record<string, unknown> : {}
  result.save = {
    ...currentSave,
    ...(saveSummary.status === 'confirmed' ? {
      current_date: saveSummary.current_date,
      current_date_precision: 'day',
      current_date_source: saveSummary.source,
    } : {}),
    save_game_summary: saveSummary,
  }
  onStatus('Resolvendo nomes de equipes confirmados…')
  enrichOfflineTeamNames(result, gameDb)
  onStatus('Interpretando contratos, termos e empréstimos…')
  enrichOfflineContracts(result, gameDb, saveSummary.status === 'confirmed' ? saveSummary.current_date : null)
  onStatus('Resolvendo membership factual E-MC-01A…')
  enrichOfflineMembershipFacts(result, gameDb, saveSummary.status === 'confirmed' ? saveSummary.current_date : null)

  // E-TC-01 is an additive, fail-closed sidecar. Historical member failures must
  // never invalidate the already-characterized players/tactics/membership result.
  onStatus('Interpretando histórico de competições E-TC-01…')
  const competitionWarnings: string[] = []
  try {
    const hasLeagueHistory = archive.memberByName.has('tc_league_history_dt.cmt')
    const [leagueHistory, compHistory, fixMan] = hasLeagueHistory
      ? await Promise.all([
          optionalArchiveMember(archive, 'tc_league_history_dt.cmt', competitionWarnings),
          optionalArchiveMember(archive, 'comp_history_dt.cmt', competitionWarnings),
          optionalArchiveMember(archive, 'rgman/fix_man.dat', competitionWarnings),
        ])
      : [null, null, null]
    const competitionHistory = await readCompetitionHistory({
      leagueHistory,
      compHistory,
      fixMan,
      gameDb,
      decompress: localZstd,
    })
    competitionHistory.diagnostics.warnings.push(...competitionWarnings)
    result.competition_history = competitionHistory
  } catch (error) {
    const competitionHistory = await readCompetitionHistory({})
    competitionHistory.diagnostics.errors.push(`E-TC-01 sidecar failure: ${error instanceof Error ? error.message : String(error)}`)
    competitionHistory.diagnostics.warnings.push(...competitionWarnings)
    result.competition_history = competitionHistory
  }

  onStatus('Concluído.')
  return result
}
