import type {
  WorldCensusBatch,
  WorldCensusBatchDomain,
  WorldCensusSourceArtifact,
  WorldCoverageManifest,
} from './fm26-world-census'

export const WORLD_CENSUS_STREAM_PROTOCOL_VERSION = 'world-census-stream-v1'
export const WORLD_CENSUS_STREAM_DEFAULT_BUDGET_BYTES = 192 * 1024
export const WORLD_CENSUS_STREAM_MIN_BUDGET_BYTES = 32 * 1024
export const WORLD_CENSUS_STREAM_MAX_BUDGET_BYTES = 256 * 1024

export const WORLD_CENSUS_DICTIONARY_DOMAINS = ['evidence_refs', 'derivation_refs'] as const satisfies readonly WorldCensusBatchDomain[]
export const WORLD_CENSUS_ENTITY_DOMAINS = ['person_records', 'structural_team_facts', 'organization_scope_facts'] as const satisfies readonly WorldCensusBatchDomain[]
export const WORLD_CENSUS_FACT_DOMAINS = [
  'player_core_facts',
  'biography_facts',
  'organization_scope_containment',
  'contract_facts',
  'active_relationship_facts',
  'club_affiliation_facts',
] as const satisfies readonly WorldCensusBatchDomain[]
export const WORLD_CENSUS_LOGICAL_DOMAIN_ORDER = [
  ...WORLD_CENSUS_DICTIONARY_DOMAINS,
  ...WORLD_CENSUS_ENTITY_DOMAINS,
  ...WORLD_CENSUS_FACT_DOMAINS,
] as const satisfies readonly WorldCensusBatchDomain[]

export type WorldCensusStreamBatchType = 'dictionary_batch' | 'entity_batch' | 'fact_batch'

export type WorldCensusStreamRunBegin = {
  type: 'run_begin'
  seq: number
  run_id: string
  protocol_version: typeof WORLD_CENSUS_STREAM_PROTOCOL_VERSION
  message_budget_bytes: number
  source_artifact: WorldCensusSourceArtifact
  checkpoint: string | null
  output_contract_version: string
  representation_version: string
  reader_version: string
  planned_capabilities: string[]
}

export type WorldCensusStreamBatch = {
  type: WorldCensusStreamBatchType
  seq: number
  run_id: string
  batch_index: number
  domain: WorldCensusBatchDomain
  items: unknown[]
  item_count: number
  payload_hash: string
}

export type WorldCensusStreamCoverageFinal = {
  type: 'coverage_final'
  seq: number
  run_id: string
  manifest: WorldCoverageManifest
  manifest_hash: string
}

export type WorldCensusStreamRunEnd = {
  type: 'run_end'
  seq: number
  run_id: string
  coverage_hash: string
  logical_hash: string
  domain_counts: Partial<Record<WorldCensusBatchDomain, number>>
  domain_hashes: Partial<Record<WorldCensusBatchDomain, string>>
  dictionary_count: number
  entity_count: number
  fact_count: number
  decoder_catalog: Array<{ decoder_id: string; version: string }>
  diagnostics: Record<string, unknown>
}

export type WorldCensusStreamMessage =
  | WorldCensusStreamRunBegin
  | WorldCensusStreamBatch
  | WorldCensusStreamCoverageFinal
  | WorldCensusStreamRunEnd

export type WorldCensusStreamPreview = {
  protocol_version: typeof WORLD_CENSUS_STREAM_PROTOCOL_VERSION
  run_id: string
  source_artifact: WorldCensusSourceArtifact
  checkpoint: string | null
  output_contract_version: string
  representation_version: string
  reader_version: string
  coverage_manifest: WorldCoverageManifest
  logical_hash: string
  domain_counts: Partial<Record<WorldCensusBatchDomain, number>>
  decoder_catalog: Array<{ decoder_id: string; version: string }>
  diagnostics: Record<string, unknown>
}

const encoder = new TextEncoder()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('world_census_protocol_non_finite_number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error(`world_census_protocol_unsupported_value:${typeof value}`)
}

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalJson(value))
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return hex(new Uint8Array(digest))
}

export async function sha256Canonical(value: unknown): Promise<string> {
  return sha256Bytes(canonicalBytes(value))
}

// Small dependency-free incremental SHA-256 used only for batch-boundary-independent
// logical content hashing. Protocol-message/payload hashes still use WebCrypto.
class Sha256Accumulator {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  private readonly block = new Uint8Array(64)
  private blockLength = 0
  private bytesHashed = 0
  private finished = false

  update(input: string | Uint8Array): this {
    if (this.finished) throw new Error('world_census_sha256_already_finalized')
    const data = typeof input === 'string' ? encoder.encode(input) : input
    this.bytesHashed += data.byteLength
    let offset = 0
    while (offset < data.byteLength) {
      const take = Math.min(64 - this.blockLength, data.byteLength - offset)
      this.block.set(data.subarray(offset, offset + take), this.blockLength)
      this.blockLength += take
      offset += take
      if (this.blockLength === 64) {
        this.compress(this.block)
        this.blockLength = 0
      }
    }
    return this
  }

  digestHex(): string {
    if (!this.finished) this.finish()
    const out = new Uint8Array(32)
    for (let i = 0; i < 8; i++) {
      const value = this.state[i]
      out[i * 4] = value >>> 24
      out[i * 4 + 1] = value >>> 16
      out[i * 4 + 2] = value >>> 8
      out[i * 4 + 3] = value
    }
    return hex(out)
  }

  private finish(): void {
    const bits = this.bytesHashed * 8
    this.block[this.blockLength++] = 0x80
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength)
      this.compress(this.block)
      this.blockLength = 0
    }
    this.block.fill(0, this.blockLength, 56)
    const high = Math.floor(bits / 0x100000000)
    const low = bits >>> 0
    this.block[56] = high >>> 24
    this.block[57] = high >>> 16
    this.block[58] = high >>> 8
    this.block[59] = high
    this.block[60] = low >>> 24
    this.block[61] = low >>> 16
    this.block[62] = low >>> 8
    this.block[63] = low
    this.compress(this.block)
    this.blockLength = 0
    this.finished = true
  }

  private compress(block: Uint8Array): void {
    const k = SHA256_K
    const w = new Uint32Array(64)
    for (let i = 0; i < 16; i++) {
      const o = i * 4
      w[i] = ((block[o] << 24) | (block[o + 1] << 16) | (block[o + 2] << 8) | block[o + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2]
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = this.state[0], b = this.state[1], c = this.state[2], d = this.state[3]
    let e = this.state[4], f = this.state[5], g = this.state[6], h = this.state[7]
    for (let i = 0; i < 64; i++) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (h + s1 + ch + k[i] + w[i]) >>> 0
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (s0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    this.state[0] = (this.state[0] + a) >>> 0
    this.state[1] = (this.state[1] + b) >>> 0
    this.state[2] = (this.state[2] + c) >>> 0
    this.state[3] = (this.state[3] + d) >>> 0
    this.state[4] = (this.state[4] + e) >>> 0
    this.state[5] = (this.state[5] + f) >>> 0
    this.state[6] = (this.state[6] + g) >>> 0
    this.state[7] = (this.state[7] + h) >>> 0
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
])
const rotr = (value: number, bits: number) => ((value >>> bits) | (value << (32 - bits))) >>> 0

function batchTypeForDomain(domain: WorldCensusBatchDomain): WorldCensusStreamBatchType {
  if ((WORLD_CENSUS_DICTIONARY_DOMAINS as readonly string[]).includes(domain)) return 'dictionary_batch'
  if ((WORLD_CENSUS_ENTITY_DOMAINS as readonly string[]).includes(domain)) return 'entity_batch'
  return 'fact_batch'
}

function ensureBudget(value: number | undefined): number {
  const budget = Math.floor(value ?? WORLD_CENSUS_STREAM_DEFAULT_BUDGET_BYTES)
  if (!Number.isFinite(budget) || budget < WORLD_CENSUS_STREAM_MIN_BUDGET_BYTES || budget > WORLD_CENSUS_STREAM_MAX_BUDGET_BYTES) {
    throw new Error(`world_census_protocol_invalid_message_budget:${budget}`)
  }
  return budget
}

function exactBatchMessageBytes(args: {
  type: WorldCensusStreamBatchType
  seq: number
  runId: string
  batchIndex: number
  domain: WorldCensusBatchDomain
  itemCount: number
  itemsBytes: number
}): number {
  const dummy: WorldCensusStreamBatch = {
    type: args.type,
    seq: args.seq,
    run_id: args.runId,
    batch_index: args.batchIndex,
    domain: args.domain,
    items: [],
    item_count: args.itemCount,
    payload_hash: '0'.repeat(64),
  }
  const emptyBytes = canonicalBytes(dummy).byteLength
  return emptyBytes - 2 + 2 + args.itemsBytes + Math.max(0, args.itemCount - 1)
}

class LogicalContentAccumulator {
  private readonly hashers = new Map<WorldCensusBatchDomain, Sha256Accumulator>()
  private readonly counts = new Map<WorldCensusBatchDomain, number>()
  private readonly startedDomains = new Set<WorldCensusBatchDomain>()

  addCanonicalBatch(domain: WorldCensusBatchDomain, canonicalItems: string, itemCount: number): void {
    if (itemCount === 0) return
    if (!canonicalItems.startsWith('[') || !canonicalItems.endsWith(']')) throw new Error('world_census_protocol_invalid_canonical_items')
    let hasher = this.hashers.get(domain)
    if (!hasher) { hasher = new Sha256Accumulator(); this.hashers.set(domain, hasher) }
    if (!this.startedDomains.has(domain)) {
      hasher.update('[')
      this.startedDomains.add(domain)
    } else {
      hasher.update(',')
    }
    hasher.update(canonicalItems.slice(1, -1))
    this.counts.set(domain, (this.counts.get(domain) ?? 0) + itemCount)
  }

  snapshot(): { domain_counts: Partial<Record<WorldCensusBatchDomain, number>>; domain_hashes: Partial<Record<WorldCensusBatchDomain, string>> } {
    const domain_counts: Partial<Record<WorldCensusBatchDomain, number>> = {}
    const domain_hashes: Partial<Record<WorldCensusBatchDomain, string>> = {}
    for (const domain of WORLD_CENSUS_LOGICAL_DOMAIN_ORDER) {
      const count = this.counts.get(domain) ?? 0
      if (!count) continue
      const hasher = this.hashers.get(domain)!
      hasher.update(']')
      domain_counts[domain] = count
      domain_hashes[domain] = hasher.digestHex()
    }
    return { domain_counts, domain_hashes }
  }
}

export type WorldCensusProtocolSendMeta = { message_hash: string; serialized_bytes: number }

export type WorldCensusProtocolEmitterOptions = {
  runId: string
  sourceArtifact: WorldCensusSourceArtifact
  checkpoint: string | null
  outputContractVersion: string
  representationVersion: string
  readerVersion: string
  plannedCapabilities: string[]
  messageBudgetBytes?: number
  send: (message: WorldCensusStreamMessage, meta: WorldCensusProtocolSendMeta) => Promise<void>
}

export class WorldCensusProtocolEmitter {
  readonly messageBudgetBytes: number
  private seq = 0
  private batchIndex = 0
  private started = false
  private finished = false
  private readonly logical = new LogicalContentAccumulator()

  constructor(private readonly options: WorldCensusProtocolEmitterOptions) {
    this.messageBudgetBytes = ensureBudget(options.messageBudgetBytes)
  }

  async begin(): Promise<void> {
    if (this.started) throw new Error('world_census_protocol_run_begin_already_sent')
    const message: WorldCensusStreamRunBegin = {
      type: 'run_begin', seq: this.seq++, run_id: this.options.runId,
      protocol_version: WORLD_CENSUS_STREAM_PROTOCOL_VERSION,
      message_budget_bytes: this.messageBudgetBytes,
      source_artifact: this.options.sourceArtifact,
      checkpoint: this.options.checkpoint,
      output_contract_version: this.options.outputContractVersion,
      representation_version: this.options.representationVersion,
      reader_version: this.options.readerVersion,
      planned_capabilities: [...this.options.plannedCapabilities],
    }
    await this.sendChecked(message)
    this.started = true
  }

  async acceptBatch(batch: WorldCensusBatch): Promise<void> {
    if (!this.started || this.finished) throw new Error('world_census_protocol_batch_outside_active_run')
    const type = batchTypeForDomain(batch.domain)
    const sendItems = async (items: unknown[]): Promise<void> => {
      if (!items.length) return
      const canonicalItems = canonicalJson(items)
      const payloadHash = await sha256Bytes(encoder.encode(canonicalItems))
      const message: WorldCensusStreamBatch = {
        type, seq: this.seq, run_id: this.options.runId, batch_index: this.batchIndex, domain: batch.domain,
        items, item_count: items.length, payload_hash: payloadHash,
      }
      const serializedBytes = canonicalBytes(message).byteLength
      if (serializedBytes <= this.messageBudgetBytes) {
        this.seq += 1
        this.batchIndex += 1
        this.logical.addCanonicalBatch(batch.domain, canonicalItems, items.length)
        await this.sendChecked(message, serializedBytes)
        return
      }
      if (items.length === 1) throw new Error(`world_census_protocol_single_item_exceeds_message_budget:${batch.domain}`)
      const middle = Math.ceil(items.length / 2)
      await sendItems(items.slice(0, middle))
      await sendItems(items.slice(middle))
    }
    await sendItems(batch.items)
  }

  async finish(args: {
    manifest: WorldCoverageManifest
    decoderCatalog: Array<{ decoder_id: string; version: string }>
    diagnostics: Record<string, unknown>
  }): Promise<WorldCensusStreamRunEnd> {
    if (!this.started || this.finished) throw new Error('world_census_protocol_finish_outside_active_run')
    const manifestHash = await sha256Canonical(args.manifest)
    const coverageMessage: WorldCensusStreamCoverageFinal = {
      type: 'coverage_final', seq: this.seq++, run_id: this.options.runId,
      manifest: args.manifest, manifest_hash: manifestHash,
    }
    await this.sendChecked(coverageMessage)
    const logical = this.logical.snapshot()
    const dictionary_count = WORLD_CENSUS_DICTIONARY_DOMAINS.reduce((sum, domain) => sum + (logical.domain_counts[domain] ?? 0), 0)
    const entity_count = WORLD_CENSUS_ENTITY_DOMAINS.reduce((sum, domain) => sum + (logical.domain_counts[domain] ?? 0), 0)
    const fact_count = WORLD_CENSUS_FACT_DOMAINS.reduce((sum, domain) => sum + (logical.domain_counts[domain] ?? 0), 0)
    const logicalHash = await sha256Canonical({
      protocol_version: WORLD_CENSUS_STREAM_PROTOCOL_VERSION,
      source_artifact: this.options.sourceArtifact,
      checkpoint: this.options.checkpoint,
      output_contract_version: this.options.outputContractVersion,
      representation_version: this.options.representationVersion,
      reader_version: this.options.readerVersion,
      domain_counts: logical.domain_counts,
      domain_hashes: logical.domain_hashes,
      coverage_hash: manifestHash,
    })
    const end: WorldCensusStreamRunEnd = {
      type: 'run_end', seq: this.seq++, run_id: this.options.runId,
      coverage_hash: manifestHash, logical_hash: logicalHash,
      domain_counts: logical.domain_counts, domain_hashes: logical.domain_hashes,
      dictionary_count, entity_count, fact_count,
      decoder_catalog: args.decoderCatalog,
      diagnostics: args.diagnostics,
    }
    await this.sendChecked(end)
    this.finished = true
    return end
  }

  private async sendChecked(message: WorldCensusStreamMessage, knownSize?: number): Promise<void> {
    const bytes = canonicalBytes(message)
    const size = knownSize ?? bytes.byteLength
    if (size > this.messageBudgetBytes) throw new Error(`world_census_protocol_message_exceeds_budget:${message.type}:${size}>${this.messageBudgetBytes}`)
    const messageHash = await sha256Bytes(bytes)
    await this.options.send(message, { message_hash: messageHash, serialized_bytes: size })
  }
}

export type WorldCensusConsumerApplyResult = {
  status: 'accepted' | 'duplicate_idempotent'
  message_hash: string
  seq: number
  complete: boolean
}

export class WorldCensusStreamConsumer {
  private expectedSeq = 0
  private readonly seen = new Map<number, string>()
  private started = false
  private complete = false
  private runBegin: WorldCensusStreamRunBegin | null = null
  private coverage: WorldCoverageManifest | null = null
  private coverageHash: string | null = null
  private readonly logical = new LogicalContentAccumulator()
  private readonly receivedCounts = new Map<WorldCensusBatchDomain, number>()
  private preview: WorldCensusStreamPreview | null = null

  constructor(private readonly onBatch?: (message: WorldCensusStreamBatch) => void | Promise<void>) {}

  get isComplete(): boolean { return this.complete }
  get result(): WorldCensusStreamPreview | null { return this.preview }

  async apply(message: WorldCensusStreamMessage): Promise<WorldCensusConsumerApplyResult> {
    const messageBytes = canonicalBytes(message)
    const messageHash = await sha256Bytes(messageBytes)
    const messageSize = messageBytes.byteLength
    const previous = this.seen.get(message.seq)
    if (previous) {
      if (previous === messageHash) return { status: 'duplicate_idempotent', message_hash: messageHash, seq: message.seq, complete: this.complete }
      throw new Error('world_census_protocol_sequence_conflict')
    }
    if (message.seq !== this.expectedSeq) throw new Error(`world_census_protocol_sequence_gap:${this.expectedSeq}->${message.seq}`)
    if (this.complete) throw new Error('world_census_protocol_message_after_run_end')
    if (!this.started && message.type !== 'run_begin') throw new Error('world_census_protocol_run_begin_required')
    if (message.type === 'run_begin') await this.applyRunBegin(message, messageSize)
    else if (message.type === 'dictionary_batch' || message.type === 'entity_batch' || message.type === 'fact_batch') await this.applyBatch(message, messageSize)
    else if (message.type === 'coverage_final') await this.applyCoverage(message, messageSize)
    else if (message.type === 'run_end') await this.applyRunEnd(message, messageSize)
    else throw new Error('world_census_protocol_unknown_message_type')
    this.seen.set(message.seq, messageHash)
    this.expectedSeq += 1
    return { status: 'accepted', message_hash: messageHash, seq: message.seq, complete: this.complete }
  }

  private async applyRunBegin(message: WorldCensusStreamRunBegin, messageSize: number): Promise<void> {
    if (this.started || message.seq !== 0) throw new Error('world_census_protocol_duplicate_run_begin')
    if (message.protocol_version !== WORLD_CENSUS_STREAM_PROTOCOL_VERSION) throw new Error('world_census_protocol_version_mismatch')
    ensureBudget(message.message_budget_bytes)
    if (messageSize > message.message_budget_bytes) throw new Error('world_census_protocol_message_exceeds_declared_budget')
    this.runBegin = structuredClone(message)
    this.started = true
  }

  private async applyBatch(message: WorldCensusStreamBatch, messageSize: number): Promise<void> {
    const begin = this.requireRunBegin(message.run_id)
    if (this.coverage) throw new Error('world_census_protocol_batch_after_coverage_final')
    if (messageSize > begin.message_budget_bytes) throw new Error('world_census_protocol_message_exceeds_declared_budget')
    if (message.type !== batchTypeForDomain(message.domain)) throw new Error('world_census_protocol_domain_message_type_mismatch')
    if (message.item_count !== message.items.length) throw new Error('world_census_protocol_batch_item_count_mismatch')
    const canonicalItems = canonicalJson(message.items)
    if (await sha256Bytes(encoder.encode(canonicalItems)) !== message.payload_hash) throw new Error('world_census_protocol_batch_integrity_mismatch')
    this.logical.addCanonicalBatch(message.domain, canonicalItems, message.items.length)
    this.receivedCounts.set(message.domain, (this.receivedCounts.get(message.domain) ?? 0) + message.items.length)
    await this.onBatch?.(message)
  }

  private async applyCoverage(message: WorldCensusStreamCoverageFinal, messageSize: number): Promise<void> {
    const begin = this.requireRunBegin(message.run_id)
    if (messageSize > begin.message_budget_bytes) throw new Error('world_census_protocol_message_exceeds_declared_budget')
    if (this.coverage) throw new Error('world_census_protocol_duplicate_coverage_final')
    if (await sha256Canonical(message.manifest) !== message.manifest_hash) throw new Error('world_census_protocol_coverage_integrity_mismatch')
    const capabilityKeys = message.manifest.capabilities.map(capability => capability.capability_key)
    const capabilitySet = new Set(capabilityKeys)
    if (capabilitySet.size !== capabilityKeys.length) throw new Error('world_census_protocol_coverage_duplicate_capability')
    const planned = [...begin.planned_capabilities].sort()
    const final = [...capabilitySet].sort()
    if (canonicalJson(planned) !== canonicalJson(final)) throw new Error('world_census_protocol_coverage_capability_mismatch')
    this.coverage = structuredClone(message.manifest)
    this.coverageHash = message.manifest_hash
  }

  private async applyRunEnd(message: WorldCensusStreamRunEnd, messageSize: number): Promise<void> {
    const begin = this.requireRunBegin(message.run_id)
    if (messageSize > begin.message_budget_bytes) throw new Error('world_census_protocol_message_exceeds_declared_budget')
    if (!this.coverage || !this.coverageHash) throw new Error('world_census_protocol_coverage_final_required')
    if (message.coverage_hash !== this.coverageHash) throw new Error('world_census_protocol_final_coverage_hash_mismatch')
    const logical = this.logical.snapshot()
    if (canonicalJson(message.domain_counts) !== canonicalJson(logical.domain_counts)) throw new Error('world_census_protocol_final_domain_count_mismatch')
    if (canonicalJson(message.domain_hashes) !== canonicalJson(logical.domain_hashes)) throw new Error('world_census_protocol_final_domain_hash_mismatch')
    const dictionaryCount = WORLD_CENSUS_DICTIONARY_DOMAINS.reduce((sum, domain) => sum + (this.receivedCounts.get(domain) ?? 0), 0)
    const entityCount = WORLD_CENSUS_ENTITY_DOMAINS.reduce((sum, domain) => sum + (this.receivedCounts.get(domain) ?? 0), 0)
    const factCount = WORLD_CENSUS_FACT_DOMAINS.reduce((sum, domain) => sum + (this.receivedCounts.get(domain) ?? 0), 0)
    if (message.dictionary_count !== dictionaryCount || message.entity_count !== entityCount || message.fact_count !== factCount) {
      throw new Error('world_census_protocol_final_count_mismatch')
    }
    const logicalHash = await sha256Canonical({
      protocol_version: begin.protocol_version,
      source_artifact: begin.source_artifact,
      checkpoint: begin.checkpoint,
      output_contract_version: begin.output_contract_version,
      representation_version: begin.representation_version,
      reader_version: begin.reader_version,
      domain_counts: logical.domain_counts,
      domain_hashes: logical.domain_hashes,
      coverage_hash: this.coverageHash,
    })
    if (message.logical_hash !== logicalHash) throw new Error('world_census_protocol_final_logical_hash_mismatch')
    this.preview = {
      protocol_version: begin.protocol_version,
      run_id: begin.run_id,
      source_artifact: structuredClone(begin.source_artifact),
      checkpoint: begin.checkpoint,
      output_contract_version: begin.output_contract_version,
      representation_version: begin.representation_version,
      reader_version: begin.reader_version,
      coverage_manifest: structuredClone(this.coverage),
      logical_hash: logicalHash,
      domain_counts: structuredClone(logical.domain_counts),
      decoder_catalog: structuredClone(message.decoder_catalog),
      diagnostics: structuredClone(message.diagnostics),
    }
    this.complete = true
  }

  private requireRunBegin(runId: string): WorldCensusStreamRunBegin {
    if (!this.runBegin) throw new Error('world_census_protocol_run_begin_required')
    if (this.runBegin.run_id !== runId) throw new Error('world_census_protocol_run_id_mismatch')
    return this.runBegin
  }
}
