import type { WorldCensusBatchDomain, WorldCoverageManifest } from './fm26-world-census'
import {
  canonicalBytes,
  sha256Bytes,
  type WorldCensusConsumerApplyResult,
  type WorldCensusStreamBatch,
  type WorldCensusStreamCoverageFinal,
  type WorldCensusStreamMessage,
  type WorldCensusStreamRunBegin,
  type WorldCensusStreamRunEnd,
} from './world-census-protocol'
import {
  startWorldCensusWorkerRun,
  type WorldCensusWorkerRun,
  type WorldCensusWorkerRunOptions,
} from './world-census-worker-client'
import { supabase } from './supabase'

const SOURCE_BUCKET = 'fm-world-sources'
const STATE_BUCKET = 'fm-world-state'
const SEGMENT_TARGET_BYTES = 1024 * 1024
const RECEIPT_FLUSH_COUNT = 64
const SEGMENT_SCHEMA_VERSION = 'world-state-segment-v1'
const SEGMENT_CODEC = 'gzip-json-v1'

type PersistenceError = { message?: string; details?: string; hint?: string; code?: string } | null

type PersistenceResult<T = unknown> = {
  data: T | null
  error: PersistenceError
}

type StorageFile = { name?: string; metadata?: { size?: number } | null }

type StorageBucketClient = {
  upload: (path: string, body: Blob | File | ArrayBuffer | Uint8Array, options?: Record<string, unknown>) => Promise<PersistenceResult>
  list: (path?: string, options?: Record<string, unknown>) => Promise<PersistenceResult<StorageFile[]>>
  remove: (paths: string[]) => Promise<PersistenceResult>
}

export type WorldCensusPersistenceClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error?: PersistenceError }>
  }
  rpc: (name: string, args: Record<string, unknown>) => Promise<PersistenceResult>
  storage: { from: (bucket: string) => StorageBucketClient }
}

type WorkerStarter = (
  bytes: ArrayBuffer,
  fileName: string,
  options?: WorldCensusWorkerRunOptions,
) => WorldCensusWorkerRun

export type WorldCensusPersistenceDependencies = {
  client?: WorldCensusPersistenceClient
  workerStarter?: WorkerStarter
  gzip?: (bytes: Uint8Array) => Promise<Uint8Array>
}

export type PersistWorldCensusCheckpointOptions = {
  saveId: string
  file: File
  expectedCheckpoint: string
  signal?: AbortSignal
  onStatus?: (status: string, progress?: number) => void
  dependencies?: WorldCensusPersistenceDependencies
}

export type WorldCensusPersistenceResult = {
  reader_run_id: string
  checkpoint_id: string
  package_id: string
  package_kind: 'full_anchor' | 'anchor_overlay'
  base_anchor_package_id: string | null
  package_hash: string
  compressed_bytes: number
  uncompressed_bytes: number
  overlay_full_ratio: number
  read_amplification: number
}

export type WorldCensusSaveStoragePaths = {
  source_paths: string[]
  state_paths: string[]
}

type BeginResult = {
  source_artifact_id: string
  source_reused: boolean
  source_bucket: string
  source_path: string
  lineage_id: string
  checkpoint_id: string
  reader_run_id: string
  previous_canonical_reader_run_id?: string | null
  already_started?: boolean
  run_status?: 'staging' | 'complete' | 'failed' | 'superseded'
}

type FinalizeResult = WorldCensusPersistenceResult & {
  discard_paths?: string[]
  already_complete?: boolean
}

type FailResult = {
  changed?: boolean
  discard_paths?: string[]
}

type Receipt = {
  seq: number
  message_kind: WorldCensusStreamMessage['type']
  batch_hash: string
  byte_count: number
  item_count: number
}

type Segment = {
  domain_key: WorldCensusBatchDomain
  ordinal: number
  storage_bucket: typeof STATE_BUCKET
  storage_path: string
  segment_hash: string
  record_count: number
  compressed_bytes: number
  uncompressed_bytes: number
  codec: typeof SEGMENT_CODEC
  schema_version: typeof SEGMENT_SCHEMA_VERSION
}

type DomainBuffer = {
  items: unknown[]
  estimatedBytes: number
  nextOrdinal: number
}

function identityRowsForBatch(message: WorldCensusStreamBatch): Record<string, unknown>[] {
  if (message.domain === 'person_records') {
    return message.items.map(item => {
      const value = item as Record<string, unknown>
      return {
        kind: 'person_record',
        person_record_ref: value.person_record_ref,
        person_record_key: value.person_record_key,
        eid: value.eid,
        uid: value.uid,
        identity_offset: value.identity_offset,
        boundary_start: value.boundary_start,
        boundary_end: value.boundary_end,
        resolution_method: value.resolution_method,
      }
    })
  }
  if (message.domain === 'biography_facts') {
    return message.items.map(item => {
      const value = item as Record<string, unknown>
      return {
        kind: 'biography_fact',
        person_record_ref: value.person_record_ref,
        status: value.status,
        reason_code: value.reason_code,
        birth_date: value.birth_date,
        display_name: value.display_name,
        hidden_personality: value.hidden_personality,
      }
    })
  }
  return []
}

function playerCoreRowsForBatch(message: WorldCensusStreamBatch): Record<string, unknown>[] {
  if (message.domain !== 'player_core_facts') return []
  return message.items.map(item => {
    const value = item as Record<string, unknown>
    return {
      person_record_ref: value.person_record_ref,
      status: value.status,
      reason_code: value.reason_code,
      ca: value.ca,
      pa: value.pa,
      positions: value.positions,
      attributes_1_20: value.attributes_1_20,
      height_cm: value.height_cm,
      evidence_refs: value.evidence_refs,
      derivation_ref: value.derivation_ref,
    }
  })
}

function errorMessage(error: PersistenceError | unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [value.message, value.details, value.hint].filter((part): part is string => typeof part === 'string' && Boolean(part))
    if (parts.length) return parts.join(' — ')
    if (typeof value.code === 'string') return value.code
  }
  return String(error ?? 'erro desconhecido')
}

function requireData<T>(result: PersistenceResult, context: string): T {
  if (result.error) throw new Error(`${context}: ${errorMessage(result.error)}`)
  return result.data as T
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function parentAndName(path: string): { parent: string; name: string } {
  const index = path.lastIndexOf('/')
  return index < 0 ? { parent: '', name: path } : { parent: path.slice(0, index), name: path.slice(index + 1) }
}

async function objectExists(client: WorldCensusPersistenceClient, bucket: string, path: string, expectedSize?: number): Promise<boolean> {
  const { parent, name } = parentAndName(path)
  const result = await client.storage.from(bucket).list(parent, { limit: 10, search: name })
  if (result.error) return false
  const match = (result.data ?? []).find(item => item.name === name)
  if (!match) return false
  const size = match.metadata?.size
  return expectedSize === undefined || typeof size !== 'number' || size === expectedSize
}

async function ensureImmutableUpload(
  client: WorldCensusPersistenceClient,
  bucket: string,
  path: string,
  body: Blob | File | ArrayBuffer | Uint8Array,
  expectedSize: number,
  contentType: string,
): Promise<void> {
  const upload = await client.storage.from(bucket).upload(path, body, { upsert: false, contentType, cacheControl: '31536000' })
  if (!upload.error) return
  if (await objectExists(client, bucket, path, expectedSize)) return
  throw new Error(`world_census_storage_upload_failed:${bucket}:${path}:${errorMessage(upload.error)}`)
}

async function defaultGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') throw new Error('world_census_gzip_unavailable')
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function removePaths(client: WorldCensusPersistenceClient, bucket: string, paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))]
  for (let index = 0; index < unique.length; index += 100) {
    const batch = unique.slice(index, index + 100)
    const result = await client.storage.from(bucket).remove(batch)
    if (result.error) throw new Error(`world_census_storage_remove_failed:${bucket}:${errorMessage(result.error)}`)
  }
}

class WorldCensusPersistenceSession {
  private readonly client: WorldCensusPersistenceClient
  private readonly gzip: (bytes: Uint8Array) => Promise<Uint8Array>
  private readonly ownerId: string
  private readonly saveId: string
  private readonly file: File
  private readonly expectedCheckpoint: string
  private readonly receiptBuffer: Receipt[] = []
  private readonly domainBuffers = new Map<WorldCensusBatchDomain, DomainBuffer>()
  private readonly uploadedStatePaths = new Set<string>()
  private beginResult: BeginResult | null = null
  private coverageFinal: WorldCensusStreamCoverageFinal | null = null
  private finalized: FinalizeResult | null = null

  constructor(args: {
    client: WorldCensusPersistenceClient
    gzip: (bytes: Uint8Array) => Promise<Uint8Array>
    ownerId: string
    saveId: string
    file: File
    expectedCheckpoint: string
  }) {
    this.client = args.client
    this.gzip = args.gzip
    this.ownerId = args.ownerId
    this.saveId = args.saveId
    this.file = args.file
    this.expectedCheckpoint = args.expectedCheckpoint
  }

  get result(): FinalizeResult | null { return this.finalized }

  async accept(message: WorldCensusStreamMessage, validation: WorldCensusConsumerApplyResult): Promise<void> {
    if (validation.status === 'duplicate_idempotent') return
    if (message.type === 'run_begin') await this.begin(message)
    else if (message.type === 'dictionary_batch' || message.type === 'entity_batch' || message.type === 'fact_batch') await this.acceptBatch(message)
    else if (message.type === 'coverage_final') this.coverageFinal = message

    this.receiptBuffer.push({
      seq: message.seq,
      message_kind: message.type,
      batch_hash: validation.message_hash,
      byte_count: canonicalBytes(message).byteLength,
      item_count: message.type === 'dictionary_batch' || message.type === 'entity_batch' || message.type === 'fact_batch' ? message.item_count : 0,
    })

    if (message.type === 'run_begin' || this.receiptBuffer.length >= RECEIPT_FLUSH_COUNT || message.type === 'coverage_final') await this.flushReceipts()
    if (message.type === 'run_end') await this.finish(message)
  }

  async fail(cause: unknown): Promise<void> {
    const runId = this.beginResult?.reader_run_id
    if (!runId) return
    let failResult: FailResult | null = null
    try {
      failResult = requireData<FailResult>(await this.client.rpc('world_census_fail', {
        p_reader_run_id: runId,
        p_reason: errorMessage(cause).slice(0, 1000),
      }), 'world_census_fail')
    } catch {
      return
    }
    // Never delete locally-known uploads when the DB says the run was already
    // finalized. That case can be a network failure after a successful commit.
    if (!failResult.changed) return
    const paths = [...this.uploadedStatePaths, ...(failResult.discard_paths ?? [])]
    try { await removePaths(this.client, STATE_BUCKET, paths) } catch { /* private orphan; metadata is already failed */ }
  }

  private async begin(message: WorldCensusStreamRunBegin): Promise<void> {
    if (this.beginResult) throw new Error('world_census_persistence_duplicate_run_begin')
    const sha = message.source_artifact.sha256
    const byteLength = message.source_artifact.byte_length
    if (!sha || !/^[0-9a-f]{64}$/.test(sha)) throw new Error('world_census_persistence_source_sha_missing')
    if (byteLength !== this.file.size) throw new Error(`world_census_persistence_source_size_mismatch:${byteLength}<>${this.file.size}`)
    if (!message.checkpoint || !isIsoDate(message.checkpoint)) throw new Error('world_census_persistence_reader_checkpoint_not_exact')
    if (message.checkpoint !== this.expectedCheckpoint) {
      throw new Error(`world_census_persistence_checkpoint_mismatch:${message.checkpoint}<>${this.expectedCheckpoint}`)
    }
    const sourcePath = `${this.ownerId}/${sha}.fm`
    const begin = requireData<BeginResult>(await this.client.rpc('world_census_begin', {
      p_save_id: this.saveId,
      p_source_sha: sha,
      p_source_path: sourcePath,
      p_source_byte_size: this.file.size,
      p_source_filename: this.file.name,
      p_internal_save_name: message.source_artifact.internal_name ?? null,
      p_checkpoint_date: message.checkpoint,
      p_checkpoint_precision: 'day',
      p_checkpoint_date_source: 'reader_confirmed',
      p_protocol_run_id: message.run_id,
      p_protocol_version: message.protocol_version,
      p_message_budget_bytes: message.message_budget_bytes,
      p_planned_capabilities: message.planned_capabilities,
      p_reader_version: message.reader_version,
      p_output_contract_version: message.output_contract_version,
      p_representation_version: message.representation_version,
    }), 'world_census_begin')
    this.beginResult = begin
    if (begin.run_status && begin.run_status !== 'staging') {
      if (begin.run_status === 'complete') throw new Error('world_census_persistence_protocol_run_already_complete')
      throw new Error(`world_census_persistence_protocol_run_not_staging:${begin.run_status}`)
    }
    if (begin.source_bucket !== SOURCE_BUCKET || begin.source_path !== sourcePath) throw new Error('world_census_persistence_source_contract_mismatch')
    await ensureImmutableUpload(this.client, SOURCE_BUCKET, sourcePath, this.file, this.file.size, 'application/octet-stream')
  }

  private async acceptBatch(message: WorldCensusStreamBatch): Promise<void> {
    const begin = this.beginResult
    if (!begin) throw new Error('world_census_persistence_run_begin_required')
    const identityRows = identityRowsForBatch(message)
    if (identityRows.length) {
      requireData(await this.client.rpc('world_census_stage_identity_rows', {
        p_reader_run_id: begin.reader_run_id,
        p_rows: identityRows,
      }), 'world_census_stage_identity_rows')
    }
    const playerCoreRows = playerCoreRowsForBatch(message)
    if (playerCoreRows.length) {
      requireData(await this.client.rpc('world_census_stage_player_core_rows', {
        p_reader_run_id: begin.reader_run_id,
        p_rows: playerCoreRows,
      }), 'world_census_stage_player_core_rows')
    }
    let state = this.domainBuffers.get(message.domain)
    if (!state) {
      state = { items: [], estimatedBytes: 128, nextOrdinal: 0 }
      this.domainBuffers.set(message.domain, state)
    }
    for (const item of message.items) {
      const itemBytes = canonicalBytes(item).byteLength + 1
      if (state.items.length > 0 && state.estimatedBytes + itemBytes > SEGMENT_TARGET_BYTES) await this.flushDomain(message.domain, state)
      state.items.push(item)
      state.estimatedBytes += itemBytes
    }
  }

  private async flushDomain(domain: WorldCensusBatchDomain, state: DomainBuffer): Promise<void> {
    if (!state.items.length) return
    const begin = this.beginResult
    if (!begin) throw new Error('world_census_persistence_run_begin_required')
    const ordinal = state.nextOrdinal++
    const raw = canonicalBytes({
      schema_version: SEGMENT_SCHEMA_VERSION,
      domain,
      ordinal,
      items: state.items,
    })
    const segmentHash = await sha256Bytes(raw)
    const compressed = await this.gzip(raw)
    const checkpoint = this.expectedCheckpoint
    const path = `${this.ownerId}/${this.saveId}/${begin.lineage_id}/${begin.checkpoint_id}/${begin.reader_run_id}/${checkpoint}/${domain}/${ordinal}-${segmentHash}.json.gz`
    await ensureImmutableUpload(this.client, STATE_BUCKET, path, compressed, compressed.byteLength, 'application/gzip')
    this.uploadedStatePaths.add(path)
    const segment: Segment = {
      domain_key: domain,
      ordinal,
      storage_bucket: STATE_BUCKET,
      storage_path: path,
      segment_hash: segmentHash,
      record_count: state.items.length,
      compressed_bytes: compressed.byteLength,
      uncompressed_bytes: raw.byteLength,
      codec: SEGMENT_CODEC,
      schema_version: SEGMENT_SCHEMA_VERSION,
    }
    requireData(await this.client.rpc('world_census_stage_segments', {
      p_reader_run_id: begin.reader_run_id,
      p_segments: [segment],
    }), 'world_census_stage_segments')
    state.items = []
    state.estimatedBytes = 128
  }

  private async flushAllDomains(): Promise<void> {
    for (const [domain, state] of this.domainBuffers) await this.flushDomain(domain, state)
  }

  private async flushReceipts(): Promise<void> {
    const begin = this.beginResult
    if (!begin || !this.receiptBuffer.length) return
    const receipts = this.receiptBuffer.splice(0, this.receiptBuffer.length)
    try {
      requireData(await this.client.rpc('world_census_record_batch_receipts', {
        p_reader_run_id: begin.reader_run_id,
        p_receipts: receipts,
      }), 'world_census_record_batch_receipts')
    } catch (error) {
      this.receiptBuffer.unshift(...receipts)
      throw error
    }
  }

  private async finish(message: WorldCensusStreamRunEnd): Promise<void> {
    const begin = this.beginResult
    const coverage = this.coverageFinal
    if (!begin) throw new Error('world_census_persistence_run_begin_required')
    if (!coverage) throw new Error('world_census_persistence_coverage_final_required')
    if (coverage.manifest_hash !== message.coverage_hash) throw new Error('world_census_persistence_coverage_hash_mismatch')
    await this.flushAllDomains()
    await this.flushReceipts()
    const finalize = requireData<FinalizeResult>(await this.client.rpc('world_census_finalize', {
      p_reader_run_id: begin.reader_run_id,
      p_coverage_manifest: coverage.manifest,
      p_coverage_hash: coverage.manifest_hash,
      p_run_end: message,
    }), 'world_census_finalize')
    this.finalized = finalize
    const discard = finalize.discard_paths ?? []
    for (const path of discard) this.uploadedStatePaths.delete(path)
    if (discard.length) {
      try { await removePaths(this.client, STATE_BUCKET, discard) } catch { /* orphan is private and non-canonical */ }
    }
  }
}

function configuredClient(dependencies?: WorldCensusPersistenceDependencies): WorldCensusPersistenceClient {
  if (dependencies?.client) return dependencies.client
  if (!supabase) throw new Error('world_census_persistence_supabase_not_configured')
  return supabase as unknown as WorldCensusPersistenceClient
}

async function currentOwnerId(client: WorldCensusPersistenceClient): Promise<string> {
  const result = await client.auth.getUser()
  if (result.error) throw new Error(`world_census_persistence_auth_failed:${errorMessage(result.error)}`)
  const owner = result.data.user?.id
  if (!owner) throw new Error('world_census_persistence_auth_required')
  return owner
}

export async function persistWorldCensusCheckpoint(options: PersistWorldCensusCheckpointOptions): Promise<WorldCensusPersistenceResult> {
  if (!isIsoDate(options.expectedCheckpoint)) throw new Error('world_census_persistence_expected_checkpoint_invalid')
  const client = configuredClient(options.dependencies)
  const ownerId = await currentOwnerId(client)
  const session = new WorldCensusPersistenceSession({
    client,
    gzip: options.dependencies?.gzip ?? defaultGzip,
    ownerId,
    saveId: options.saveId,
    file: options.file,
    expectedCheckpoint: options.expectedCheckpoint,
  })
  const workerStarter = options.dependencies?.workerStarter ?? startWorldCensusWorkerRun
  const bytes = await options.file.arrayBuffer()
  const run = workerStarter(bytes, options.file.name, {
    signal: options.signal,
    onStatus: options.onStatus,
    onValidatedMessage: (message, validation) => session.accept(message, validation),
  })
  try {
    await run.promise
    if (!session.result) throw new Error('world_census_persistence_finalize_missing')
    const { discard_paths: _discard, already_complete: _already, ...result } = session.result
    return result
  } catch (error) {
    await session.fail(error)
    throw error
  }
}

export async function collectWorldCensusSaveStorage(saveId: string, dependencies?: Pick<WorldCensusPersistenceDependencies, 'client'>): Promise<WorldCensusSaveStoragePaths> {
  const client = configuredClient(dependencies)
  const value = requireData<WorldCensusSaveStoragePaths>(await client.rpc('world_census_collect_save_storage', { p_save_id: saveId }), 'world_census_collect_save_storage')
  return {
    source_paths: Array.isArray(value.source_paths) ? value.source_paths.filter(path => typeof path === 'string') : [],
    state_paths: Array.isArray(value.state_paths) ? value.state_paths.filter(path => typeof path === 'string') : [],
  }
}

export async function removeWorldCensusStorage(paths: WorldCensusSaveStoragePaths, dependencies?: Pick<WorldCensusPersistenceDependencies, 'client'>): Promise<void> {
  const client = configuredClient(dependencies)
  await removePaths(client, STATE_BUCKET, paths.state_paths)
  await removePaths(client, SOURCE_BUCKET, paths.source_paths)
}

export function worldCensusCoverageManifest(value: WorldCoverageManifest): WorldCoverageManifest {
  return value
}
