import { ZSTDDecoder } from 'zstddec/stream'
import { FM26OfflineReaderV022 } from './fm26-offline-reader-v022.js'
import { parseFm26SaveSummaryDate } from './fm26-save-summary'
import { readWorldCensusMembers, type WorldCensusSink, type WorldCensusSummary } from './fm26-world-census'

type Archive = {
  init(): Promise<Archive>
  getMember(name: string): Promise<Uint8Array>
  memberByName: Map<string, unknown>
  saveName: string | null
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

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

/**
 * WC-A entry point. It deliberately does NOT feed the legacy import payload,
 * normalizer, worker response or database. Facts are emitted through a local sink
 * so the caller never needs a monolithic world object; WC-B will define the
 * Worker ACK/backpressure protocol around this reader in a later slice.
 */
export async function readWorldCensusSaveBytes(
  saveBytes: Uint8Array,
  fileName = 'save.fm',
  emit?: WorldCensusSink,
  onStatus: (status: string, progress?: number) => void = () => {},
): Promise<WorldCensusSummary> {
  onStatus('World Census: lendo contêiner…', 5)
  const ArchiveConstructor = FM26OfflineReaderV022.FMArchive as unknown as new (
    data: Uint8Array,
    fileName: string,
    decompress: (frame: Uint8Array) => Promise<Uint8Array>,
  ) => Archive
  const archive = await new ArchiveConstructor(saveBytes, fileName, localZstd).init()
  onStatus('World Census: descompactando índices canônicos…', 15)
  const [gameDb, playerStats, humans, summaryBytes] = await Promise.all([
    archive.getMember('game_db.dat'),
    archive.getMember('rgman/player_stats.dat'),
    archive.memberByName.has('humans.dat') ? archive.getMember('humans.dat') : Promise.resolve(new Uint8Array()),
    archive.memberByName.has('save_game_summary.dat') ? archive.getMember('save_game_summary.dat') : Promise.resolve(null),
  ])
  const expectedHumanCount = humans.length >= 10 ? humans[8] | (humans[9] << 8) : 0
  const summary = parseFm26SaveSummaryDate(summaryBytes, expectedHumanCount)
  onStatus('World Census: construindo índices e facts WC-A…', 35)
  const sourceHash = await sha256(saveBytes)
  const result = readWorldCensusMembers({
    gameDb,
    playerStats,
    checkpoint: summary.status === 'confirmed' ? summary.current_date : null,
    sourceArtifact: { sha256: sourceHash, file_name: fileName, byte_length: saveBytes.byteLength, internal_name: archive.saveName },
    emit,
  })
  onStatus('World Census WC-A concluído.', 95)
  return result
}
