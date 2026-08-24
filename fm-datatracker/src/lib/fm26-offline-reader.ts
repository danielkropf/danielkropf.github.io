import { ZSTDDecoder } from 'zstddec/stream'
import { FM26OfflineReaderV022 } from './fm26-offline-reader-v022.js'

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

/** Local browser decoder; no CDN, game process, Oracle or server is involved. */
async function localZstd(frame: Uint8Array): Promise<Uint8Array> {
  const decoder = await decoderInstance()
  const chunks = [...decoder.decodeStreaming([frame])]
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output
}

/** Reads the required FM26 members using the characterized v0.22 parser core. */
export async function readOfflineSaveBytes(saveBytes: Uint8Array, fileName = 'save.fm', onStatus: (status: string) => void = () => {}): Promise<ReaderResult> {
  onStatus('Lendo contêiner e manifesto…')
  const ArchiveConstructor = FM26OfflineReaderV022.FMArchive as unknown as new (data: Uint8Array, fileName: string, decompress: (frame: Uint8Array) => Promise<Uint8Array>) => Archive
  const archive = await new ArchiveConstructor(saveBytes, fileName, localZstd).init()
  onStatus('Descompactando game_db.dat…')
  const gameDb = await archive.getMember('game_db.dat')
  onStatus('Descompactando estatísticas…')
  const stats = await archive.getMember('rgman/player_stats.dat')
  const history = archive.memberByName.has('player_stats_hist_dt.cmt') ? await archive.getMember('player_stats_hist_dt.cmt') : null
  onStatus('Descompactando tática e técnicos humanos…')
  const [tactics, humans] = await Promise.all([archive.getMember('tactics_man.dat'), archive.getMember('humans.dat')])
  onStatus('Interpretando elencos, atributos, estatísticas e táticas…')
  const Reader = FM26OfflineReaderV022.FM26V1Reader as unknown as ReaderConstructor
  const result = new Reader({ gameDb, stats, tactics, humans, historyDt: history, fileName, internalName: archive.saveName, manifestMembers: archive.members.length }).read()
  onStatus('Concluído.')
  return result
}
