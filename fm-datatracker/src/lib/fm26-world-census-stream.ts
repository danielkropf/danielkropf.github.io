import {
  readWorldCensusMembers,
  WORLD_CENSUS_OUTPUT_CONTRACT_VERSION,
  WORLD_CENSUS_PLANNED_CAPABILITIES,
  WORLD_CENSUS_READER_VERSION,
  WORLD_CENSUS_REPRESENTATION_VERSION,
  type WorldCensusReadInput,
  type WorldCensusSummary,
} from './fm26-world-census'
import {
  WORLD_CENSUS_STREAM_DEFAULT_BUDGET_BYTES,
  WorldCensusProtocolEmitter,
  type WorldCensusProtocolSendMeta,
  type WorldCensusStreamMessage,
  type WorldCensusStreamRunEnd,
} from './world-census-protocol'

export type StreamWorldCensusOptions = {
  runId: string
  messageBudgetBytes?: number
  send: (message: WorldCensusStreamMessage, meta: WorldCensusProtocolSendMeta) => Promise<void>
}

export type StreamWorldCensusResult = {
  summary: WorldCensusSummary
  run_end: WorldCensusStreamRunEnd
}

export async function streamWorldCensusMembers(
  input: Omit<WorldCensusReadInput, 'emit' | 'batchTargetBytes'>,
  options: StreamWorldCensusOptions,
): Promise<StreamWorldCensusResult> {
  const messageBudgetBytes = options.messageBudgetBytes ?? WORLD_CENSUS_STREAM_DEFAULT_BUDGET_BYTES
  const protocol = new WorldCensusProtocolEmitter({
    runId: options.runId,
    sourceArtifact: input.sourceArtifact,
    checkpoint: input.checkpoint,
    outputContractVersion: WORLD_CENSUS_OUTPUT_CONTRACT_VERSION,
    representationVersion: WORLD_CENSUS_REPRESENTATION_VERSION,
    readerVersion: WORLD_CENSUS_READER_VERSION,
    plannedCapabilities: [...WORLD_CENSUS_PLANNED_CAPABILITIES],
    messageBudgetBytes,
    send: options.send,
  })
  await protocol.begin()
  const localBatchTarget = Math.max(32 * 1024, Math.min(messageBudgetBytes - 2048, 192 * 1024))
  const summary = await readWorldCensusMembers({
    ...input,
    batchTargetBytes: localBatchTarget,
    emit: batch => protocol.acceptBatch(batch),
  })
  const run_end = await protocol.finish({
    manifest: summary.coverage_manifest,
    decoderCatalog: summary.decoder_catalog,
    diagnostics: summary.diagnostics,
  })
  return { summary, run_end }
}
