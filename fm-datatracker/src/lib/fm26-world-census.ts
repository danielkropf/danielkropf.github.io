export const WORLD_CENSUS_OUTPUT_CONTRACT_VERSION = 'world-census-run-v1'
export const WORLD_CENSUS_REPRESENTATION_VERSION = 'world-census-representation-v1'
export const WORLD_CENSUS_READER_VERSION = 'wc-a-reader-v1'

export const WORLD_CENSUS_POSITION_RATING_NAMES = [
  'GK', 'SW', 'DL', 'DC', 'DR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST', 'WBL', 'WBR',
] as const

export const WORLD_CENSUS_ATTRIBUTE_NAMES = [
  'Crossing', 'Dribbling', 'Finishing', 'Heading', 'Long Shots', 'Marking', 'Off the Ball', 'Passing', 'Penalty Taking', 'Tackling',
  'Vision', 'Handling', 'Aerial Reach', 'Command of Area', 'Communication', 'Kicking', 'Throwing', 'Anticipation', 'Decisions', 'One on Ones',
  'Positioning', 'Reflexes', 'First Touch', 'Technique', 'Left Foot', 'Right Foot', 'Flair', 'Corners', 'Teamwork', 'Work Rate', 'Long Throws',
  'Eccentricity', 'Rushing Out Tendency', 'Punching Tendency', 'Acceleration', 'Free Kick Taking', 'Strength', 'Stamina', 'Pace', 'Jumping Reach',
  'Leadership', 'Dirtiness', 'Balance', 'Bravery', 'Consistency', 'Aggression', 'Agility', 'Important Matches', 'Injury Proneness', 'Versatility',
  'Natural Fitness', 'Determination', 'Composure', 'Concentration',
] as const

export const WORLD_CENSUS_HIDDEN_PERSONALITY_NAMES = [
  'Adaptability', 'Ambition', 'Loyalty', 'Pressure', 'Professionalism', 'Sportsmanship', 'Temperament', 'Controversy',
] as const

const KNOWN_NATIONS: Record<number, string> = {
  0: 'Algeria', 11: 'Egypt', 16: 'Ghana', 18: 'Guinea-Bissau', 19: 'Ivory Coast', 26: 'Mali', 29: 'Morocco', 33: 'Nigeria',
  36: 'Senegal', 40: 'South Africa', 47: 'Uganda', 48: 'DR Congo', 58: 'Indonesia', 61: 'Japan', 79: 'Singapore', 80: 'South Korea',
  81: 'Sri Lanka', 85: 'Thailand', 97: 'Canada', 100: 'Cuba', 102: 'El Salvador', 104: 'Guatemala', 108: 'Jamaica', 109: 'Mexico',
  120: 'U.S.A.', 126: 'Albania', 129: 'Austria', 131: 'Belgium', 133: 'Bosnia & Herzegovina', 135: 'Croatia', 137: 'Czechia',
  138: 'Denmark', 139: 'England', 143: 'France', 144: 'Georgia', 145: 'Germany', 146: 'Greece', 147: 'Hungary', 149: 'Israel',
  150: 'Italy', 158: 'Netherlands', 159: 'N.Ireland', 161: 'Poland', 162: 'Portugal', 163: 'Ireland', 164: 'Romania', 167: 'Scotland',
  170: 'Spain', 171: 'Sweden', 172: 'Switzerland', 173: 'Türkiye', 174: 'Ukraine', 187: 'Argentina', 189: 'Brazil', 190: 'Chile',
  191: 'Colombia', 192: 'Ecuador', 194: 'Peru', 195: 'Uruguay', 196: 'Venezuela', 219: 'Kosovo',
}

const SCOPE_FRAME_SIGNATURE = new Uint8Array([0xf3, 0x37, 0xa8, 0x00, 0xf3, 0x37, 0xa8, 0x00, 0x00, 0x00, 0xa6, 0x0e, 0xff, 0xff, 0xff, 0xff])
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const textEncoder = new TextEncoder()

type FactStatus = 'confirmed' | 'unknown' | 'ambiguous' | 'unsupported' | 'excluded'
export type WorldEnumerationStatus = 'complete_for_scope' | 'partial_known_grammar' | 'unsupported' | 'not_attempted'

export type WorldField<T> = {
  status: FactStatus
  value: T | null
  reason_code: string
  evidence_refs: number[]
}

export type WorldCoverageCapability = {
  capability_key: string
  subject_unit: string
  subject_scope: { id: string; enumeration_status: WorldEnumerationStatus }
  subjects_evaluated: number
  counts: Record<FactStatus, number>
  reason_counts: Record<string, number>
  coverage_ratio: number | null
}

export type WorldCoverageManifest = {
  version: 'world-coverage-manifest-v1'
  capabilities: WorldCoverageCapability[]
}

export type WorldCensusBatchDomain =
  | 'evidence_refs'
  | 'derivation_refs'
  | 'person_records'
  | 'player_core_facts'
  | 'biography_facts'
  | 'structural_team_facts'
  | 'organization_scope_facts'
  | 'organization_scope_containment'
  | 'contract_facts'
  | 'active_relationship_facts'
  | 'club_affiliation_facts'

export type WorldCensusBatch = {
  domain: WorldCensusBatchDomain
  batch_index: number
  items: unknown[]
  serialized_bytes: number
}

export type WorldCensusSink = (batch: WorldCensusBatch) => void

export type WorldCensusSourceArtifact = {
  sha256: string | null
  file_name: string | null
  byte_length: number | null
  internal_name?: string | null
}

export type WorldCensusReadInput = {
  gameDb: Uint8Array
  playerStats: Uint8Array
  checkpoint: string | null
  sourceArtifact: WorldCensusSourceArtifact
  emit?: WorldCensusSink
  batchTargetBytes?: number
}

export type WorldCensusSummary = {
  output_contract_version: typeof WORLD_CENSUS_OUTPUT_CONTRACT_VERSION
  representation_version: typeof WORLD_CENSUS_REPRESENTATION_VERSION
  reader_version: typeof WORLD_CENSUS_READER_VERSION
  source_artifact: WorldCensusSourceArtifact
  checkpoint: string | null
  coverage_manifest: WorldCoverageManifest
  decoder_catalog: Array<{ decoder_id: string; version: string }>
  diagnostics: {
    timings_ms: Record<string, number>
    counts: Record<string, number>
    warnings: string[]
    person_region_start: number
    emitted_batches: number
    emitted_items: number
    emitted_serialized_bytes: number
    max_batch_serialized_bytes: number
    organization_scope_frame: { status: 'confirmed' | 'unknown' | 'ambiguous'; start: number | null; end: number | null; physical_candidates: number; logical_scopes: number }
  }
}

export type PersonRecord = {
  person_record_ref: number
  person_record_key: string
  eid: number
  uid: number
  identity_offset: number
  boundary_start: number
  boundary_end: number
  resolution_method: 'unique_player_stats_identity' | 'structural_team_matching_contract_identity'
  evidence_refs: number[]
  derivation_ref: number
}

export type BiographyIdentityForEpoch = {
  uid: number
  eid: number
  birth_date: string | null
  display_name: string | null
  hidden_personality: number[] | null
}

export type IdentityEpochDecision = 'same_epoch' | 'new_epoch' | 'different_uid' | 'unknown'

export type AlternateBiographyRaw = {
  start: number
  end: number
  birth_offset: number
  forename_id: number
  surname_id: number
  third_name_id_raw: number
  birth_day_of_year: number
  birth_year: number
  birth_date: string
  person_marker: number
  nation_id: number
  hidden_personality: number[]
  raw7_hex: string
}

export type StandardBiographyRaw = {
  start: number
  end: number
  prefix_end: number
  forename_id: number
  surname_id: number
  known_name_id: number
  full_inline: string | null
  birth_day_of_year: number
  birth_year: number
  birth_date: string
  person_marker: number
  nation_id: number
  hidden_personality: number[]
}

type StringTable = { start: number; end: number; count: number; values: string[] }
type IdentityCandidate = { offset: number; uid: number }
type ResolvedIdentity = IdentityCandidate & { eid: number; method: PersonRecord['resolution_method'] }
type AbilityRaw = {
  start: number
  end: number
  attribute_start: number
  ability_marker: number
  ca: number
  pa: number
  positions: number[]
  attributes_raw: number[]
  attributes_1_20: number[]
  height_raw: number | null
  height_cm: number | null
}
type StructuralTeamRow = {
  team_id: number
  record_offset: number
  team_key: number
  type_raw: number
  age_raw: number
  name_reference_raw: number
  name: string | null
  short_name: string | null
  roster_eids: number[]
  record_end: number
}
type ScopePhysical = { offset: number; end: number; a: number[]; b: number[] }
type ScopeLogical = { scope_ref: string; a: number[]; b: number[]; offsets: number[]; end_offsets: number[]; teams: number[] }
type PackedDate = { offset: number; raw: number; year: number; day_of_year: number; flags: number; iso: string | null; sentinel: boolean }
type ContractHeader = { header_offset: number; terms_count: number; terms_offset: number; terms_end: number; auxiliary_count: number; trailer_base: number; expected_anchor: number }
type ContractHeaderIndex = { exact: Map<number, ContractHeader[]>; sorted: ContractHeader[] }
type ContractAnchor = { offset: number; team_id: number; wage_raw: number }

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0
}

function allZero(bytes: Uint8Array, offset: number, count: number): boolean {
  if (offset < 0 || offset + count > bytes.length) return false
  for (let i = 0; i < count; i++) if (bytes[offset + i] !== 0) return false
  return true
}

function allFf(bytes: Uint8Array, offset: number, count: number): boolean {
  if (offset < 0 || offset + count > bytes.length) return false
  for (let i = 0; i < count; i++) if (bytes[offset + i] !== 0xff) return false
  return true
}

function hex(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = Math.max(0, start); i < Math.min(bytes.length, end); i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

function daysInYear(year: number): number {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 366 : 365
}

function dayOfYearIso(year: number, day: number): string {
  const date = new Date(Date.UTC(year, 0, 1))
  date.setUTCDate(day)
  return date.toISOString().slice(0, 10)
}

function internalAttrTo20(raw: number): number {
  return Math.max(1, Math.min(20, Math.floor(raw / 5 + 0.5)))
}

function validTeamId(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < 100_000
}

function validIdentityUid(value: number): boolean {
  return Number.isInteger(value) && value >= 1_000_000 && value < 3_000_000_000
}

function validPlayerEid(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < 200_000
}

function factual<T>(status: FactStatus, value: T | null, reason: string, evidence: number[] = []): WorldField<T> {
  return { status, value, reason_code: reason, evidence_refs: evidence }
}

function confirmed<T>(value: T, reason: string, evidence: number[] = []): WorldField<T> {
  return factual('confirmed', value, reason, evidence)
}

function unknown<T>(reason: string, evidence: number[] = []): WorldField<T> {
  return factual<T>('unknown', null, reason, evidence)
}

function ambiguous<T>(reason: string, evidence: number[] = []): WorldField<T> {
  return factual<T>('ambiguous', null, reason, evidence)
}

function unsupported<T>(reason: string, evidence: number[] = []): WorldField<T> {
  return factual<T>('unsupported', null, reason, evidence)
}

class BatchEmitter {
  private readonly pending = new Map<WorldCensusBatchDomain, { items: unknown[]; bytes: number }>()
  private batchIndex = 0
  readonly stats = { batches: 0, items: 0, bytes: 0, maxBytes: 0 }

  constructor(private readonly sink: WorldCensusSink | undefined, private readonly targetBytes: number) {}

  add(domain: WorldCensusBatchDomain, item: unknown): void {
    if (!this.sink) return
    const itemBytes = textEncoder.encode(JSON.stringify(item)).byteLength + 1
    let state = this.pending.get(domain)
    if (!state) {
      state = { items: [], bytes: 64 }
      this.pending.set(domain, state)
    }
    if (state.items.length > 0 && state.bytes + itemBytes > this.targetBytes) {
      this.flushDomain(domain)
      state = { items: [], bytes: 64 }
      this.pending.set(domain, state)
    }
    state.items.push(item)
    state.bytes += itemBytes
    this.stats.items += 1
  }

  private flushDomain(domain: WorldCensusBatchDomain): void {
    const state = this.pending.get(domain)
    if (!this.sink || !state || state.items.length === 0) return
    const batch: WorldCensusBatch = { domain, batch_index: this.batchIndex++, items: state.items, serialized_bytes: state.bytes }
    this.sink(batch)
    this.stats.batches += 1
    this.stats.bytes += state.bytes
    this.stats.maxBytes = Math.max(this.stats.maxBytes, state.bytes)
    this.pending.set(domain, { items: [], bytes: 64 })
  }

  flush(): void {
    for (const domain of this.pending.keys()) this.flushDomain(domain)
  }
}

class ProvenanceRegistry {
  private readonly evidence = new Map<string, number>()
  private readonly derivations = new Map<string, number>()
  private nextEvidence = 1
  private nextDerivation = 1

  constructor(
    private readonly emitter: BatchEmitter,
    private readonly sourceSha256: string | null,
    private readonly readerRunRef: string,
  ) {}

  evidenceRef(member: string, start: number, end: number): number {
    const key = `${member}:${start}-${end}`
    const existing = this.evidence.get(key)
    if (existing) return existing
    const ref = this.nextEvidence++
    this.evidence.set(key, ref)
    this.emitter.add('evidence_refs', [ref, 'run_source', member, start, end])
    return ref
  }

  derivationRef(subjectRef: string, decoderId: string, decoderVersion: string, evidenceRefs: number[]): number {
    const key = `${decoderId}:${subjectRef}`
    const existing = this.derivations.get(key)
    if (existing) return existing
    const ref = this.nextDerivation++
    this.derivations.set(key, ref)
    this.emitter.add('derivation_refs', [ref, decoderId, decoderVersion, evidenceRefs])
    return ref
  }
}

class CoverageBuilder {
  private readonly capabilities = new Map<string, {
    capability_key: string
    subject_unit: string
    subject_scope: { id: string; enumeration_status: WorldEnumerationStatus }
    counts: Record<FactStatus, number>
    reasons: Map<string, number>
    subjects: number
    ratioAllowed: boolean
  }>()

  define(key: string, unit: string, scopeId: string, enumeration: WorldEnumerationStatus, ratioAllowed = false): void {
    this.capabilities.set(key, {
      capability_key: key,
      subject_unit: unit,
      subject_scope: { id: scopeId, enumeration_status: enumeration },
      counts: { confirmed: 0, unknown: 0, ambiguous: 0, unsupported: 0, excluded: 0 },
      reasons: new Map(),
      subjects: 0,
      ratioAllowed,
    })
  }

  add(key: string, status: FactStatus, reason: string): void {
    const cap = this.capabilities.get(key)
    if (!cap) throw new Error(`Unknown coverage capability: ${key}`)
    cap.subjects += 1
    cap.counts[status] += 1
    cap.reasons.set(reason, (cap.reasons.get(reason) ?? 0) + 1)
  }

  finalize(): WorldCoverageManifest {
    const capabilities: WorldCoverageCapability[] = []
    for (const cap of this.capabilities.values()) {
      const total = Object.values(cap.counts).reduce((sum, value) => sum + value, 0)
      if (total !== cap.subjects) throw new Error(`Coverage mismatch for ${cap.capability_key}: ${total} != ${cap.subjects}`)
      const ratio = cap.ratioAllowed && cap.subject_scope.enumeration_status === 'complete_for_scope' && cap.subjects > 0
        ? cap.counts.confirmed / cap.subjects
        : null
      capabilities.push({
        capability_key: cap.capability_key,
        subject_unit: cap.subject_unit,
        subject_scope: cap.subject_scope,
        subjects_evaluated: cap.subjects,
        counts: cap.counts,
        reason_counts: Object.fromEntries([...cap.reasons.entries()].sort(([a], [b]) => a.localeCompare(b))),
        coverage_ratio: ratio,
      })
    }
    return { version: 'world-coverage-manifest-v1', capabilities }
  }
}

function discoverStringTables(data: Uint8Array): StringTable[] {
  const tables: StringTable[] = []
  let p = 4
  while (p + 12 < data.length && tables.length < 3) {
    let found = data.indexOf(0, p)
    while (found >= 0 && found + 3 < data.length && !(data[found] === 0 && data[found + 1] === 0 && data[found + 2] === 0 && data[found + 3] === 0)) found = data.indexOf(0, found + 1)
    if (found < 0 || found + 12 >= data.length) break
    p = found
    if (p < 4) { p += 1; continue }
    const count = u32(data, p - 4)
    if (count < 50_000 || count > 1_000_000) { p += 1; continue }

    let quickPos = p
    let quick = true
    for (let expected = 0; expected < 4; expected++) {
      if (quickPos + 8 > data.length) { quick = false; break }
      const index = u32(data, quickPos)
      const length = u32(data, quickPos + 4)
      if (index !== expected || length < 1 || length > 240 || quickPos + 8 + length > data.length) { quick = false; break }
      try { textDecoder.decode(data.subarray(quickPos + 8, quickPos + 8 + length)) } catch { quick = false; break }
      quickPos += 8 + length
    }
    if (!quick) { p += 1; continue }

    let pos = p
    let ok = true
    const values = new Array<string>(count)
    for (let expected = 0; expected < count; expected++) {
      if (pos + 8 > data.length) { ok = false; break }
      const index = u32(data, pos)
      const length = u32(data, pos + 4)
      if (index !== expected || length > 4096 || pos + 8 + length > data.length) { ok = false; break }
      try { values[expected] = textDecoder.decode(data.subarray(pos + 8, pos + 8 + length)) } catch { ok = false; break }
      pos += 8 + length
    }
    if (ok) {
      tables.push({ start: p, count, end: pos, values })
      p = pos
    } else p += 1
  }
  if (tables.length < 3) throw new Error('World Census: three FM name string tables were not located')
  return tables
}

function isStatsRecordAnchor(data: Uint8Array, pos: number): boolean {
  if (pos <= 0 || pos + 33 > data.length || data[pos - 1] !== 0x01) return false
  const eid = u32(data, pos)
  const contextId = u32(data, pos + 4)
  const headerValue = u32(data, pos + 8)
  if (!validPlayerEid(eid) || !(contextId === 0xffffffff || validTeamId(contextId)) || headerValue > 100_000) return false
  let marker = false
  for (let rel = 18; rel <= 32; rel++) if (pos + rel + 1 < data.length && data[pos + rel] === 0x01 && data[pos + rel + 1] === 0x06) { marker = true; break }
  let zeroish = true
  for (let rel = 20; rel < 28; rel++) if (data[pos + rel] !== 0) { zeroish = false; break }
  return marker || zeroish
}

function enumerateStatsCandidateEids(data: Uint8Array): { eids: number[]; anchorCount: number } {
  const set = new Set<number>()
  let marker = data.indexOf(0x01, 0)
  let anchors = 0
  while (marker >= 0 && marker + 34 <= data.length) {
    const pos = marker + 1
    if (isStatsRecordAnchor(data, pos)) {
      anchors += 1
      set.add(u32(data, pos))
    }
    marker = data.indexOf(0x01, marker + 1)
  }
  return { eids: [...set].sort((a, b) => a - b), anchorCount: anchors }
}

function decodeText(data: Uint8Array, offset: number, length: number): string | null {
  if (length > 160 || offset < 0 || offset + length > data.length) return null
  try {
    const value = textDecoder.decode(data.subarray(offset, offset + length))
    return /[\x00-\x1f\x7f]/.test(value) ? null : value
  } catch { return null }
}

function scanStructuralTeams(data: Uint8Array, limit: number): StructuralTeamRow[] {
  const rows: StructuralTeamRow[] = []
  const previous = new Map<number, number>()
  let marker = data.indexOf(10, 12)
  while (marker >= 0 && marker < limit) {
    const r = marker - 12
    if (r >= 0 && r + 86 < limit && u32(data, r) < 100_000) {
      const count = u16(data, r + 46)
      const rosterEnd = r + 48 + 4 * count
      if (count <= 500 && rosterEnd + 38 < limit && data[rosterEnd + 22] === 255) {
        const nameLength = u32(data, rosterEnd + 28)
        const name = decodeText(data, rosterEnd + 32, nameLength)
        const shortOffset = rosterEnd + 33 + nameLength
        if (name !== null && shortOffset + 4 < limit) {
          const shortLength = u32(data, shortOffset)
          const shortName = decodeText(data, shortOffset + 4, shortLength)
          const next = shortOffset + 5 + shortLength
          const nextValid = next + 13 <= limit && u32(data, next) === u32(data, r) + 1 && data[next + 12] === 10
          if (shortName !== null && (nextValid || previous.get(r) === u32(data, r))) {
            const rosterEids: number[] = []
            let valid = true
            for (let i = 0; i < count; i++) {
              const eid = u32(data, r + 48 + 4 * i)
              if (!eid || eid >= 500_000) { valid = false; break }
              rosterEids.push(eid)
            }
            if (valid) {
              previous.set(next, u32(data, r) + 1)
              rows.push({
                team_id: u32(data, r) + 1,
                record_offset: r,
                team_key: u32(data, r + 4),
                type_raw: u16(data, rosterEnd + 18),
                age_raw: data[rosterEnd + 21],
                name_reference_raw: u32(data, rosterEnd + 24),
                name: name.trim() ? name : null,
                short_name: shortName.trim() ? shortName : null,
                roster_eids: rosterEids,
                record_end: next,
              })
            }
          }
        }
      }
    }
    marker = data.indexOf(10, marker + 1)
  }
  return rows
}

function scanIdentityCandidates(data: Uint8Array, start: number, wantedEids: Set<number>): Map<number, IdentityCandidate[]> {
  const out = new Map<number, IdentityCandidate[]>()
  for (let p = Math.max(0, start); p + 12 <= data.length; p++) {
    if (data[p + 3] > 2) continue
    const eid = u32(data, p)
    if (!wantedEids.has(eid)) continue
    const uid1 = u32(data, p + 4)
    if (!validIdentityUid(uid1) || uid1 !== u32(data, p + 8)) continue
    const list = out.get(eid)
    const candidate = { offset: p, uid: uid1 }
    if (list) list.push(candidate)
    else out.set(eid, [candidate])
  }
  return out
}

function findMatchingStructuralAnchor(data: Uint8Array, eid: number, identityOffset: number, teamIds: Set<number>): boolean {
  if (!teamIds.size) return false
  const start = Math.max(0, identityOffset - 4096)
  const low = eid & 0xff
  let cursor = data.indexOf(low, start)
  while (cursor >= 0 && cursor + 16 <= identityOffset) {
    if (u32(data, cursor) === eid) {
      const team = u32(data, cursor + 4)
      if (teamIds.has(team) && u32(data, cursor + 8) === 0 && u32(data, cursor + 12) <= 10_000_000) return true
    }
    cursor = data.indexOf(low, cursor + 1)
  }
  return false
}

export function resolveWorldIdentityCandidates(args: {
  eid: number
  candidates: IdentityCandidate[]
  gameDb?: Uint8Array
  structuralTeamIds?: Iterable<number>
}): { status: 'confirmed' | 'unknown' | 'ambiguous'; value: IdentityCandidate | null; method: PersonRecord['resolution_method'] | null; reason_code: string } {
  if (args.candidates.length === 0) return { status: 'unknown', value: null, method: null, reason_code: 'identity_candidate_not_found' }
  if (args.candidates.length === 1) return { status: 'confirmed', value: args.candidates[0], method: 'unique_player_stats_identity', reason_code: 'unique_identity_candidate_for_player_stats_eid' }
  if (args.gameDb && args.structuralTeamIds) {
    const teams = new Set(args.structuralTeamIds)
    const supported = args.candidates.filter(candidate => findMatchingStructuralAnchor(args.gameDb!, args.eid, candidate.offset, teams))
    if (supported.length === 1) return { status: 'confirmed', value: supported[0], method: 'structural_team_matching_contract_identity', reason_code: 'unique_identity_candidate_supported_by_structural_team_contract_anchor' }
  }
  return { status: 'ambiguous', value: null, method: null, reason_code: 'multiple_structurally_plausible_identity_candidates' }
}

function findSequence(data: Uint8Array, pattern: Uint8Array, start = 0): number[] {
  const hits: number[] = []
  let first = data.indexOf(pattern[0], start)
  while (first >= 0 && first + pattern.length <= data.length) {
    let ok = true
    for (let i = 1; i < pattern.length; i++) if (data[first + i] !== pattern[i]) { ok = false; break }
    if (ok) hits.push(first)
    first = data.indexOf(pattern[0], first + 1)
  }
  return hits
}

export function parseOrganizationScopeRecordAt(data: Uint8Array, offset: number, validTeamIds?: Set<number>): ScopePhysical | null {
  if (offset < 0 || offset + 5 > data.length || data[offset] !== 0 || data[offset + 1] !== 0xff || data[offset + 2] !== 0) return null
  const countA = data[offset + 3]
  if (countA < 1 || countA > 32) return null
  let cursor = offset + 4
  if (cursor + countA * 4 + 1 > data.length) return null
  const a: number[] = []
  for (let i = 0; i < countA; i++) {
    const team = u32(data, cursor); cursor += 4
    if (!validTeamId(team) || (validTeamIds && !validTeamIds.has(team))) return null
    a.push(team)
  }
  const countB = data[cursor++]
  if (countB > 32 || cursor + countB * 4 > data.length) return null
  const b: number[] = []
  for (let i = 0; i < countB; i++) {
    const team = u32(data, cursor); cursor += 4
    if (!validTeamId(team) || (validTeamIds && !validTeamIds.has(team))) return null
    b.push(team)
  }
  const all = [...a, ...b]
  if (new Set(all).size !== all.length) return null
  return { offset, end: cursor, a, b }
}

function scopeKey(a: number[], b: number[]): string {
  return `scope:a=${a.join(',')};b=${b.join(',')}`
}

function scanOrganizationScopes(data: Uint8Array, teamIds: Set<number>): {
  status: 'confirmed' | 'unknown' | 'ambiguous'
  reason: string
  frameStart: number | null
  frameEnd: number | null
  physicalCandidates: number
  scopes: ScopeLogical[]
  containment: Array<{ child: string; parent: string }>
} {
  const signatureHits = findSequence(data, SCOPE_FRAME_SIGNATURE)
  const viableFrames = signatureHits.flatMap(hit => {
    const start = hit + SCOPE_FRAME_SIGNATURE.length
    return parseOrganizationScopeRecordAt(data, start, teamIds) ? [start] : []
  })
  if (viableFrames.length === 0) return { status: 'unknown', reason: 'organization_scope_frame_signature_not_found', frameStart: null, frameEnd: null, physicalCandidates: 0, scopes: [], containment: [] }
  if (viableFrames.length > 1) return { status: 'ambiguous', reason: 'multiple_organization_scope_frame_signatures', frameStart: null, frameEnd: null, physicalCandidates: 0, scopes: [], containment: [] }
  const frameStart = viableFrames[0]
  const physical: ScopePhysical[] = []
  let cursor = data.indexOf(0, frameStart)
  while (cursor >= 0 && cursor + 5 <= data.length) {
    if (data[cursor + 1] === 0xff && data[cursor + 2] === 0) {
      const parsed = parseOrganizationScopeRecordAt(data, cursor, teamIds)
      if (parsed) physical.push(parsed)
    }
    cursor = data.indexOf(0, cursor + 1)
  }
  const multi = physical.filter(scope => scope.a.length + scope.b.length > 1)
  if (multi.length === 0) return { status: 'unknown', reason: 'organization_scope_frame_has_no_multi_team_boundary', frameStart, frameEnd: null, physicalCandidates: physical.length, scopes: [], containment: [] }
  const frameEnd = multi[multi.length - 1].offset
  const framed = physical.filter(scope => scope.offset >= frameStart && scope.offset <= frameEnd)
  const logicalMap = new Map<string, ScopeLogical>()
  for (const item of framed) {
    const key = scopeKey(item.a, item.b)
    const existing = logicalMap.get(key)
    if (existing) {
      existing.offsets.push(item.offset)
      existing.end_offsets.push(item.end)
    } else logicalMap.set(key, { scope_ref: key, a: item.a, b: item.b, offsets: [item.offset], end_offsets: [item.end], teams: [...item.a, ...item.b] })
  }
  const scopes = [...logicalMap.values()]
  const scopeSets = scopes.map(scope => new Set(scope.teams))
  const byTeam = new Map<number, number[]>()
  scopes.forEach((scope, index) => {
    for (const team of scope.teams) {
      const list = byTeam.get(team)
      if (list) list.push(index)
      else byTeam.set(team, [index])
    }
  })
  const containment: Array<{ child: string; parent: string }> = []
  for (let i = 0; i < scopes.length; i++) {
    const child = scopes[i]
    if (child.teams.length === 0) continue
    let pool: number[] | null = null
    for (const team of child.teams) {
      const candidates = byTeam.get(team) ?? []
      if (pool === null || candidates.length < pool.length) pool = candidates
    }
    let minParentSize = Number.POSITIVE_INFINITY
    const parents: number[] = []
    for (const j of pool ?? []) {
      if (i === j || scopes[j].teams.length <= child.teams.length) continue
      const parentSet = scopeSets[j]
      let subset = true
      for (const team of child.teams) if (!parentSet.has(team)) { subset = false; break }
      if (!subset) continue
      const size = scopes[j].teams.length
      if (size < minParentSize) { minParentSize = size; parents.length = 0; parents.push(j) }
      else if (size === minParentSize) parents.push(j)
    }
    for (const j of parents) containment.push({ child: child.scope_ref, parent: scopes[j].scope_ref })
  }
  return { status: 'confirmed', reason: 'framed_organization_scope_region', frameStart, frameEnd, physicalCandidates: physical.length, scopes, containment }
}

function findFiveZeroAnchors(data: Uint8Array, start: number, end: number): number[] {
  const hits: number[] = []
  let zero = data.indexOf(0, Math.max(0, start))
  while (zero >= 0 && zero + 5 <= end) {
    if (data[zero + 1] === 0 && data[zero + 2] === 0 && data[zero + 3] === 0 && data[zero + 4] === 0) hits.push(zero)
    zero = data.indexOf(0, zero + 1)
  }
  return hits
}

export function findStandardBiographyCandidates(
  data: Uint8Array,
  start: number,
  end: number,
  tableLimits: { forenames: number; surnames: number; commonNames: number },
): StandardBiographyRaw[] {
  const found: StandardBiographyRaw[] = []
  let sep = data.indexOf(0, Math.max(start + 4, 4))
  while (sep >= 0 && sep < end) {
    const p = sep - 4
    if (p >= start && p + 19 <= end) {
      const firstId = u32(data, p)
      const surnameId = u32(data, p + 5)
      const knownId = u32(data, p + 10)
      if (firstId < tableLimits.forenames && data[p + 4] === 0 && surnameId < tableLimits.surnames && data[p + 9] === 0 && data[p + 14] === 0
        && (knownId === 0xffffffff || knownId < tableLimits.commonNames || knownId === firstId)) {
        const fullLength = u32(data, p + 15)
        const q = p + 19 + fullLength
        if (fullLength <= 240 && q + 4 <= end) {
          let fullInline: string | null = null
          let inlineValid = true
          if (fullLength) {
            try { fullInline = textDecoder.decode(data.subarray(p + 19, p + 19 + fullLength)) } catch { inlineValid = false }
          }
          if (inlineValid) {
            const day = u16(data, q)
            const year = u16(data, q + 2)
            const prefixEnd = q + 4
            if (day >= 1 && day <= 366 && year >= 1900 && year <= 2100 && prefixEnd + 25 <= end) {
              const marker = data[prefixEnd + 8]
              const nation = u16(data, prefixEnd + 9)
              const hidden = Array.from(data.subarray(prefixEnd + 17, prefixEnd + 25))
              if (marker >= 2 && marker <= 6 && hidden.length === 8 && hidden.every(value => value <= 20)) {
                found.push({ start: p, end: prefixEnd + 25, prefix_end: prefixEnd, forename_id: firstId, surname_id: surnameId, known_name_id: knownId, full_inline: fullInline, birth_day_of_year: day, birth_year: year, birth_date: dayOfYearIso(year, day), person_marker: marker, nation_id: nation, hidden_personality: hidden })
              }
            }
          }
        }
      }
    }
    sep = data.indexOf(0, sep + 1)
  }
  return found
}

export function findAlternateBiographyCandidates(
  data: Uint8Array,
  start: number,
  end: number,
  tableLimits: { forenames: number; surnames: number },
): AlternateBiographyRaw[] {
  const found: AlternateBiographyRaw[] = []
  for (const zeroStart of findFiveZeroAnchors(data, Math.max(start, 0), end)) {
    const b = zeroStart + 5
    if (b - 19 < start || b + 29 > end) continue
    if (data[b - 15] !== 0 || data[b - 10] !== 0) continue
    const firstId = u32(data, b - 19)
    const surnameId = u32(data, b - 14)
    const thirdNameId = u32(data, b - 9)
    if (firstId >= tableLimits.forenames || surnameId >= tableLimits.surnames || thirdNameId >= tableLimits.surnames) continue
    const day = u16(data, b)
    const year = u16(data, b + 2)
    if (day < 1 || day > 366 || year < 1900 || year > 2100 || data[b + 4] !== 0xff) continue
    const marker = data[b + 12]
    if (marker < 2 || marker > 6 || !allZero(data, b + 15, 6)) continue
    const hidden = Array.from(data.subarray(b + 21, b + 29))
    if (hidden.length !== 8 || hidden.some(value => value > 20)) continue
    found.push({ start: b - 19, end: b + 29, birth_offset: b, forename_id: firstId, surname_id: surnameId, third_name_id_raw: thirdNameId, birth_day_of_year: day, birth_year: year, birth_date: dayOfYearIso(year, day), person_marker: marker, nation_id: u16(data, b + 13), hidden_personality: hidden, raw7_hex: hex(data, b + 5, b + 12) })
  }
  return found
}

function findAbility(data: Uint8Array, start: number, identityOffset: number, eid: number): { ability: AbilityRaw | null; reason: string } {
  const candidates: AbilityRaw[] = []
  for (const zeroStart of findFiveZeroAnchors(data, start, identityOffset)) {
    const ast = zeroStart + 20
    if (ast - 46 < start || ast + 54 > identityOffset) continue
    const marker = data[ast - 46]
    if (marker !== 0x02 && marker !== 0x03) continue
    const positions = Array.from(data.subarray(ast - 15, ast))
    const attrs = Array.from(data.subarray(ast, ast + 54))
    if (positions.length !== 15 || positions.some(value => value < 1 || value > 20)) continue
    if (attrs.length !== 54 || attrs.some(value => value < 1 || value > 100)) continue
    const ca = u16(data, ast - 39), pa = u16(data, ast - 37)
    if (ca > 200 || pa > 200) continue
    const heightRaw = ast + 82 < identityOffset ? data[ast + 82] : null
    candidates.push({ start: ast - 46, end: Math.min(identityOffset, ast + 83), attribute_start: ast, ability_marker: marker, ca, pa, positions, attributes_raw: attrs, attributes_1_20: attrs.map(internalAttrTo20), height_raw: heightRaw, height_cm: heightRaw !== null && heightRaw >= 100 && heightRaw <= 250 ? heightRaw : null })
  }
  if (candidates.length === 0) return { ability: null, reason: 'ability_not_owned_or_missing' }
  const ability = candidates[candidates.length - 1]
  if (eid > 1) {
    const low = (eid - 1) & 0xff
    let cursor = data.indexOf(low, ability.attribute_start + 54)
    while (cursor >= 0 && cursor + 12 <= identityOffset) {
      if (u32(data, cursor) === eid - 1) {
        const uid = u32(data, cursor + 4)
        if (uid >= 100_000 && uid < 3_000_000_000 && uid === u32(data, cursor + 8)) return { ability: null, reason: 'ability_crosses_previous_person_identity' }
      }
      cursor = data.indexOf(low, cursor + 1)
    }
  }
  return { ability, reason: 'ability_owned_by_person_record' }
}

function decodePackedDate(data: Uint8Array, offset: number): PackedDate | null {
  if (offset < 0 || offset + 4 > data.length) return null
  const raw = u32(data, offset)
  const year = raw >>> 16
  const day = raw & 0x01ff
  const flags = raw & 0xfe00
  if (year < 1900 || year > 2200 || day < 1 || day > daysInYear(year)) return null
  const sentinel = year === 1900
  return { offset, raw, year, day_of_year: day, flags, iso: sentinel ? null : dayOfYearIso(year, day), sentinel }
}

function buildContractHeaderIndex(data: Uint8Array, start: number): ContractHeaderIndex {
  const exact = new Map<number, ContractHeader[]>()
  const sorted: ContractHeader[] = []
  let ff = data.indexOf(0xff, Math.max(start + 4, 4))
  while (ff >= 0 && ff + 12 < data.length) {
    if (ff >= 4 && allFf(data, ff, 8) && allZero(data, ff + 8, 3)) {
      const headerOffset = ff - 4
      const headerDate = decodePackedDate(data, headerOffset)
      if (headerDate) {
        const count = data[ff + 11]
        if (count <= 96) {
          const termsOffset = ff + 12
          const termsEnd = termsOffset + count * 8
          if (termsEnd < data.length) {
            const auxiliaryCount = data[termsEnd]
            if (auxiliaryCount <= 32) {
              const trailerStart = termsEnd + 1 + auxiliaryCount * 31
              if (trailerStart + 74 <= data.length) {
                const count19 = data[trailerStart]
                if (count19 <= 1) {
                  const trailerBase = trailerStart + 19 * count19
                  if (trailerBase + 74 <= data.length) {
                    const count29 = u32(data, trailerBase + 45)
                    if (count29 <= 128) {
                      const expectedAnchor = trailerBase + 74 + 29 * count29
                      const header: ContractHeader = { header_offset: headerOffset, terms_count: count, terms_offset: termsOffset, terms_end: termsEnd, auxiliary_count: auxiliaryCount, trailer_base: trailerBase, expected_anchor: expectedAnchor }
                      const list = exact.get(expectedAnchor)
                      if (list) list.push(header); else exact.set(expectedAnchor, [header])
                      sorted.push(header)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    ff = data.indexOf(0xff, ff + 1)
  }
  sorted.sort((a, b) => a.expected_anchor - b.expected_anchor)
  return { exact, sorted }
}

function hasNearbyContractHeader(index: ContractHeaderIndex, anchor: number, boundaryStart: number): boolean {
  const values = index.sorted
  let lo = 0, hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid].expected_anchor < anchor) lo = mid + 1; else hi = mid
  }
  for (let i = Math.max(0, lo - 3); i < Math.min(values.length, lo + 4); i++) {
    const header = values[i]
    if (header.expected_anchor === anchor || Math.abs(header.expected_anchor - anchor) > 96) continue
    if (header.header_offset >= boundaryStart && header.header_offset < anchor) return true
  }
  return false
}

function contractAnchors(data: Uint8Array, eid: number, boundaryStart: number, identityOffset: number): ContractAnchor[] {
  const start = Math.max(boundaryStart, identityOffset - 4096)
  const out: ContractAnchor[] = []
  const low = eid & 0xff
  let cursor = data.indexOf(low, start)
  while (cursor >= 0 && cursor + 16 <= identityOffset) {
    if (u32(data, cursor) === eid) {
      const team = u32(data, cursor + 4), zero = u32(data, cursor + 8), wage = u32(data, cursor + 12)
      if (validTeamId(team) && zero === 0 && wage <= 10_000_000) out.push({ offset: cursor, team_id: team, wage_raw: wage })
    }
    cursor = data.indexOf(low, cursor + 1)
  }
  return out
}

function contractTemporalStatus(start: string | null, expiry: string | null, checkpoint: string | null): 'current_candidate' | 'future' | 'historical' | 'unresolved' {
  if (!checkpoint || !start || !expiry || expiry < start) return 'unresolved'
  if (start > checkpoint) return 'future'
  if (expiry < checkpoint) return 'historical'
  return 'current_candidate'
}

function countReason(target: Record<string, number>, reason: string): void {
  target[reason] = (target[reason] ?? 0) + 1
}

export function classifyIdentityEpoch(previous: BiographyIdentityForEpoch, current: BiographyIdentityForEpoch): IdentityEpochDecision {
  if (previous.uid !== current.uid) return 'different_uid'
  if (!previous.birth_date || !current.birth_date) return 'unknown'
  if (previous.birth_date !== current.birth_date) return 'new_epoch'
  return 'same_epoch'
}

export function reconcilePersonRecordOrdering<T extends { eid: number; offset: number }>(resolved: T[]): { records: T[]; conflicting_eids: number[] } {
  const conflicts = new Set<number>()
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i - 1].offset >= resolved[i].offset) {
      conflicts.add(resolved[i - 1].eid)
      conflicts.add(resolved[i].eid)
    }
  }
  return {
    records: conflicts.size ? resolved.filter(value => !conflicts.has(value.eid)) : resolved,
    conflicting_eids: [...conflicts].sort((a, b) => a - b),
  }
}

export function readWorldCensusMembers(input: WorldCensusReadInput): WorldCensusSummary {
  const timings: Record<string, number> = {}
  const warnings: string[] = []
  const counts: Record<string, number> = {}
  const tTotal = now()
  const batchTarget = Math.max(32 * 1024, input.batchTargetBytes ?? 192 * 1024)
  const emitter = new BatchEmitter(input.emit, batchTarget)
  const readerRunRef = `reader-run:${input.sourceArtifact.sha256 ?? input.sourceArtifact.file_name ?? 'unknown'}:${WORLD_CENSUS_READER_VERSION}`
  const provenance = new ProvenanceRegistry(emitter, input.sourceArtifact.sha256, readerRunRef)
  const coverage = new CoverageBuilder()
  coverage.define('person_record_boundary', 'player_stats_candidate_eid', 'player_stats_candidates_with_identity_grammar', 'partial_known_grammar')
  coverage.define('player_core', 'person_record', 'confirmed_person_records', 'complete_for_scope', true)
  coverage.define('biography', 'person_record', 'confirmed_person_records', 'complete_for_scope', true)
  coverage.define('structural_team', 'structural_team_row', 'characterized_team_row_grammar', 'partial_known_grammar')
  coverage.define('organization_scope', 'organization_scope_record', 'framed_organization_scope_region', 'complete_for_scope', true)
  coverage.define('contract_fact', 'person_record', 'confirmed_person_records_known_contract_anchor_grammar', 'partial_known_grammar')
  coverage.define('active_relationship', 'person_record', 'confirmed_person_records_known_secondary_relationship_grammar', 'partial_known_grammar')
  coverage.define('club_affiliation_public_uid', 'person_record', 'confirmed_person_records', 'unsupported')
  coverage.define('free_agent_registration', 'person_record', 'confirmed_person_records', 'unsupported')
  coverage.define('competition_facts', 'checkpoint', 'wc_a_first_cut', 'not_attempted')

  let t = now()
  const tables = discoverStringTables(input.gameDb)
  const [forenames, surnames, commonNames] = tables
  const personRegionStart = commonNames.end
  timings.string_tables = now() - t

  t = now()
  const statsCandidates = enumerateStatsCandidateEids(input.playerStats)
  const wantedEids = new Set(statsCandidates.eids)
  timings.player_stats_index = now() - t
  counts.player_stats_candidate_eids = statsCandidates.eids.length
  counts.player_stats_candidate_anchors = statsCandidates.anchorCount

  t = now()
  const teamRows = scanStructuralTeams(input.gameDb, forenames.start)
  const teamIds = new Set(teamRows.map(row => row.team_id))
  const eidToTeams = new Map<number, Set<number>>()
  for (const row of teamRows) {
    const teamEvidence = provenance.evidenceRef('game_db.dat', row.record_offset, row.record_end)
    const subjectRef = `team:${row.team_id}@${row.record_offset}`
    const derivationRef = provenance.derivationRef(subjectRef, 'structural_team_row', 'v1', [teamEvidence])
    emitter.add('structural_team_facts', {
      structural_team_ref: subjectRef,
      team_id_raw: row.team_id,
      team_key_raw: row.team_key,
      type_raw: row.type_raw,
      age_raw: row.age_raw,
      name_reference_raw: row.name_reference_raw,
      name: row.name,
      short_name: row.short_name,
      name_status: row.name ? 'confirmed_embedded' : 'unknown_not_embedded',
      short_name_status: row.short_name ? 'confirmed_embedded' : 'unknown_not_embedded',
      roster_eids: row.roster_eids,
      evidence_refs: [teamEvidence],
      derivation_ref: derivationRef,
    })
    coverage.add('structural_team', 'confirmed', 'structural_team_row_shape_confirmed')
    for (const eid of row.roster_eids) {
      if (!wantedEids.has(eid)) continue
      const set = eidToTeams.get(eid)
      if (set) set.add(row.team_id); else eidToTeams.set(eid, new Set([row.team_id]))
    }
  }
  timings.structural_teams = now() - t
  counts.structural_team_rows = teamRows.length
  counts.structural_team_ids = teamIds.size

  t = now()
  const identityCandidates = scanIdentityCandidates(input.gameDb, personRegionStart, wantedEids)
  const resolved: ResolvedIdentity[] = []
  const identityStatus = new Map<number, { status: 'confirmed' | 'unknown' | 'ambiguous'; reason: string }>()
  for (const eid of statsCandidates.eids) {
    const result = resolveWorldIdentityCandidates({ eid, candidates: identityCandidates.get(eid) ?? [], gameDb: input.gameDb, structuralTeamIds: eidToTeams.get(eid) })
    identityStatus.set(eid, { status: result.status, reason: result.reason_code })
    if (result.status === 'confirmed' && result.value && result.method) resolved.push({ eid, ...result.value, method: result.method })
  }
  resolved.sort((a, b) => a.eid - b.eid)
  const ordering = reconcilePersonRecordOrdering(resolved)
  const monotonicResolved = ordering.records
  const conflicts = new Set(ordering.conflicting_eids)
  if (conflicts.size) {
    warnings.push(`PersonRecord identity ordering conflict in ${conflicts.size} EIDs; conflicting records were excluded fail-closed.`)
    for (const eid of conflicts) identityStatus.set(eid, { status: 'ambiguous', reason: 'identity_order_non_monotonic' })
  }
  for (const eid of statsCandidates.eids) {
    const finalStatus = identityStatus.get(eid)
    if (!finalStatus) throw new Error(`World Census identity status missing for EID ${eid}`)
    coverage.add('person_record_boundary', finalStatus.status, finalStatus.reason)
  }
  timings.identity_index = now() - t
  counts.identity_candidates_total = [...identityCandidates.values()].reduce((sum, values) => sum + values.length, 0)
  counts.person_records_confirmed = monotonicResolved.length
  counts.identity_multiple_eids = [...identityCandidates.values()].filter(values => values.length > 1).length
  counts.identity_order_conflicts = conflicts.size

  t = now()
  const scopeIndex = scanOrganizationScopes(input.gameDb, teamIds)
  if (scopeIndex.status === 'confirmed') {
    for (const scope of scopeIndex.scopes) {
      const evidenceRefs = scope.offsets.map((offset, index) => provenance.evidenceRef('game_db.dat', offset, scope.end_offsets[index]))
      const derivationRef = provenance.derivationRef(scope.scope_ref, 'organization_scope_framed', 'r-wc-03-v1', evidenceRefs)
      emitter.add('organization_scope_facts', { scope_ref: scope.scope_ref, partition_a_team_ids: scope.a, partition_b_team_ids: scope.b, team_ids: scope.teams, evidence_refs: evidenceRefs, derivation_ref: derivationRef })
      coverage.add('organization_scope', 'confirmed', 'scope_shape_confirmed_inside_characterized_frame')
    }
    for (const edge of scopeIndex.containment) emitter.add('organization_scope_containment', { child_scope_ref: edge.child, parent_scope_ref: edge.parent, status: 'confirmed', reason_code: 'minimal_strict_subset_containment' })
  } else {
    coverage.add('organization_scope', scopeIndex.status, scopeIndex.reason)
  }
  timings.organization_scopes = now() - t
  counts.organization_scopes = scopeIndex.scopes.length
  counts.organization_scope_containment_edges = scopeIndex.containment.length

  t = now()
  const contractHeaders = buildContractHeaderIndex(input.gameDb, personRegionStart)
  timings.contract_header_index = now() - t
  counts.contract_header_candidates = contractHeaders.sorted.length

  const biographyReasonCounts: Record<string, number> = {}
  const abilityReasonCounts: Record<string, number> = {}
  t = now()
  let previousIdentityEnd = personRegionStart
  let nextPersonRecordRef = 1
  for (const identity of monotonicResolved) {
    const boundaryStart = previousIdentityEnd
    const boundaryEnd = identity.offset
    previousIdentityEnd = identity.offset + 12
    const identityEvidence = provenance.evidenceRef('game_db.dat', identity.offset, identity.offset + 12)
    const personRef = nextPersonRecordRef++
    const personKey = `person:${identity.eid}:${identity.uid}@${identity.offset}`
    const personDerivation = provenance.derivationRef(personKey, 'person_record_boundary', 'v1', [identityEvidence])
    const person: PersonRecord = { person_record_ref: personRef, person_record_key: personKey, eid: identity.eid, uid: identity.uid, identity_offset: identity.offset, boundary_start: boundaryStart, boundary_end: boundaryEnd, resolution_method: identity.method, evidence_refs: [identityEvidence], derivation_ref: personDerivation }
    emitter.add('person_records', person)

    const abilityResult = findAbility(input.gameDb, boundaryStart, boundaryEnd, identity.eid)
    countReason(abilityReasonCounts, abilityResult.reason)
    if (abilityResult.ability) {
      const ability = abilityResult.ability
      const evidence = provenance.evidenceRef('game_db.dat', ability.start, ability.end)
      const derivationRef = provenance.derivationRef(personKey, 'player_core_ability', 'v1', [evidence])
      emitter.add('player_core_facts', {
        person_record_ref: personRef,
        status: 'confirmed',
        reason_code: abilityResult.reason,
        ca: ability.ca,
        pa: ability.pa,
        positions: ability.positions,
        attributes_raw_1_100: ability.attributes_raw,
        attributes_1_20: ability.attributes_1_20,
        feet: [ability.attributes_1_20[24], ability.attributes_1_20[25]],
        height_cm: ability.height_cm,
        field_status: ability.height_cm === null ? { height_cm: 'unknown_owned_height_not_resolved' } : {},
        ability_marker_raw: ability.ability_marker,
        evidence_refs: [evidence],
        derivation_ref: derivationRef,
      })
      coverage.add('player_core', 'confirmed', abilityResult.reason)
    } else {
      const derivationRef = provenance.derivationRef(personKey, 'player_core_ability', 'v1', [identityEvidence])
      emitter.add('player_core_facts', { person_record_ref: personRef, status: 'unknown', reason_code: abilityResult.reason, ca: null, pa: null, positions: null, attributes_raw_1_100: null, attributes_1_20: null, feet: null, height_cm: null, evidence_refs: [identityEvidence], derivation_ref: derivationRef })
      coverage.add('player_core', 'unknown', abilityResult.reason)
    }

    const standard = findStandardBiographyCandidates(input.gameDb, boundaryStart, boundaryEnd, { forenames: forenames.count, surnames: surnames.count, commonNames: commonNames.count })
    const standardOwned = standard.length ? standard[standard.length - 1] : null
    const alternate = standardOwned ? [] : findAlternateBiographyCandidates(input.gameDb, boundaryStart, boundaryEnd, { forenames: forenames.count, surnames: surnames.count })
    if (standardOwned) {
      const bio = standardOwned
      const evidence = provenance.evidenceRef('game_db.dat', bio.start, bio.end)
      const first = forenames.values[bio.forename_id]
      const surname = surnames.values[bio.surname_id]
      const known = bio.known_name_id === 0xffffffff ? null : bio.known_name_id === bio.forename_id ? first : commonNames.values[bio.known_name_id]
      const fullName = bio.full_inline || `${first} ${surname}`.trim()
      const displayName = known || `${first} ${surname}`.trim()
      const derivationRef = provenance.derivationRef(personKey, 'biography_standard_owned', 'v1', [evidence])
      emitter.add('biography_facts', {
        person_record_ref: personRef,
        status: 'confirmed', grammar: 'standard', reason_code: 'standard_biography_owned_by_person_record',
        forename: first, surname, known_name: known, full_name: fullName, display_name: displayName,
        birth_date: bio.birth_date, nation_id: bio.nation_id, nation_name: KNOWN_NATIONS[bio.nation_id] ?? null,
        person_marker_raw: bio.person_marker, hidden_personality: bio.hidden_personality,
        third_name_id_raw: null, raw7_hex: null,
        field_status: {
          ...(known ? {} : { known_name: 'unknown_standard_known_name_absent' }),
          ...(KNOWN_NATIONS[bio.nation_id] ? {} : { nation_name: 'unknown_nation_dictionary_label_unmapped' }),
          third_name_id_raw: 'unknown_not_present_in_standard_grammar',
          raw7_hex: 'unknown_not_present_in_standard_grammar',
        },
        evidence_refs: [evidence], derivation_ref: derivationRef,
      })
      coverage.add('biography', 'confirmed', 'standard_biography_owned_by_person_record')
      countReason(biographyReasonCounts, 'standard_biography_owned_by_person_record')
    } else if (alternate.length === 1) {
      const bio = alternate[0]
      const evidence = provenance.evidenceRef('game_db.dat', bio.start, bio.end)
      const first = forenames.values[bio.forename_id]
      const surname = surnames.values[bio.surname_id]
      const display = `${first} ${surname}`.trim()
      const derivationRef = provenance.derivationRef(personKey, 'biography_alternate_owned', 'r-wc-02-v1', [evidence])
      emitter.add('biography_facts', {
        person_record_ref: personRef,
        status: 'confirmed', grammar: 'alternate', reason_code: 'alternate_biography_owned_by_person_record',
        forename: first, surname, known_name: null, full_name: display, display_name: display,
        birth_date: bio.birth_date, nation_id: bio.nation_id, nation_name: KNOWN_NATIONS[bio.nation_id] ?? null,
        person_marker_raw: bio.person_marker, hidden_personality: bio.hidden_personality,
        third_name_id_raw: bio.third_name_id_raw, raw7_hex: bio.raw7_hex,
        field_status: {
          known_name: 'unknown_alternate_third_name_semantics_unconfirmed',
          ...(KNOWN_NATIONS[bio.nation_id] ? {} : { nation_name: 'unknown_nation_dictionary_label_unmapped' }),
          third_name_id_raw: 'confirmed_raw_semantics_unconfirmed',
          raw7_hex: 'confirmed_raw_semantics_unconfirmed',
        },
        evidence_refs: [evidence], derivation_ref: derivationRef,
      })
      coverage.add('biography', 'confirmed', 'alternate_biography_owned_by_person_record')
      countReason(biographyReasonCounts, 'alternate_biography_owned_by_person_record')
    } else {
      const reason = alternate.length > 1 ? 'multiple_owned_alternate_biography_candidates' : 'owned_biography_not_resolved'
      const status: FactStatus = alternate.length > 1 ? 'ambiguous' : 'unknown'
      const derivationRef = provenance.derivationRef(personKey, 'biography_owned_resolution', 'v1', [identityEvidence])
      emitter.add('biography_facts', { person_record_ref: personRef, status, grammar: null, reason_code: reason, evidence_refs: [identityEvidence], derivation_ref: derivationRef })
      coverage.add('biography', status, reason)
      countReason(biographyReasonCounts, reason)
    }

    const anchors = contractAnchors(input.gameDb, identity.eid, boundaryStart, boundaryEnd)
    let completeCount = 0
    let relationCount = 0
    let unsupportedCount = 0
    const completeCandidates: Array<{ ref: string; start: string | null; expiry: string | null; status: string }> = []
    for (const anchor of anchors) {
      const anchorEvidence = provenance.evidenceRef('game_db.dat', anchor.offset, anchor.offset + 16)
      const headers = contractHeaders.exact.get(anchor.offset) ?? []
      if (headers.length === 1) {
        const header = headers[0]
        const expiry = decodePackedDate(input.gameDb, header.trailer_base + 31)
        const joined = decodePackedDate(input.gameDb, header.trailer_base + 35)
        const effective = decodePackedDate(input.gameDb, anchor.offset - 24)
        const state = decodePackedDate(input.gameDb, anchor.offset - 5)
        if (expiry && joined && effective && state) {
          const evidence = provenance.evidenceRef('game_db.dat', header.header_offset, anchor.offset + 16)
          const contractRef = `contract:${personKey}@${anchor.offset}`
          const temporal = contractTemporalStatus(effective.iso ?? joined.iso, expiry.iso, input.checkpoint)
          const derivationRef = provenance.derivationRef(contractRef, 'complete_standard_contract', 'e-mc-01-v1', [evidence])
          const terms = Array.from({ length: header.terms_count }, (_, index) => {
            const offset = header.terms_offset + index * 8
            const marker = u16(input.gameDb, offset + 4)
            return { type_id: marker === 0xffff ? u16(input.gameDb, offset + 6) : null, raw_value: marker === 0xffff ? u32(input.gameDb, offset) : null, raw_payload: hex(input.gameDb, offset, offset + 8) }
          })
          emitter.add('contract_facts', { contract_ref: contractRef, person_record_ref: personRef, status: 'confirmed', kind: 'complete_standard_contract', temporal_status: temporal, team_id_raw: anchor.team_id, wage_raw: anchor.wage_raw, expiry_date: expiry.iso, joined_or_start_date: joined.iso, signed_or_effective_date: effective.iso, state_date: state.iso, terms, auxiliary_count: header.auxiliary_count, evidence_refs: [evidence], derivation_ref: derivationRef })
          completeCandidates.push({ ref: contractRef, start: effective.iso ?? joined.iso, expiry: expiry.iso, status: temporal })
          completeCount += 1
          continue
        }
      }
      if (headers.length > 1) {
        unsupportedCount += 1
        counts.contract_unsupported_layout = (counts.contract_unsupported_layout ?? 0) + 1
        continue
      }
      const secondary: Array<{ n: number; expiry: PackedDate; joined: PackedDate; effective: PackedDate; state: PackedDate }> = []
      for (let n = 0; n <= 128; n++) {
        const base = anchor.offset - 74 - 29 * n
        if (base < boundaryStart || base + 49 > input.gameDb.length || u32(input.gameDb, base + 45) !== n) continue
        const expiry = decodePackedDate(input.gameDb, base + 31), joined = decodePackedDate(input.gameDb, base + 35), effective = decodePackedDate(input.gameDb, anchor.offset - 24), state = decodePackedDate(input.gameDb, anchor.offset - 5)
        if (expiry && joined && effective && state) secondary.push({ n, expiry, joined, effective, state })
      }
      if (secondary.length === 1) {
        const relation = secondary[0]
        const relationRef = `relationship:${personKey}@${anchor.offset}`
        const evidence = provenance.evidenceRef('game_db.dat', Math.max(boundaryStart, anchor.offset - 74 - 29 * relation.n), anchor.offset + 16)
        const active = input.checkpoint && relation.joined.iso && relation.expiry.iso ? relation.joined.iso <= input.checkpoint && input.checkpoint <= relation.expiry.iso : null
        const derivationRef = provenance.derivationRef(relationRef, 'secondary_relationship', 'e-mc-01-v1', [evidence])
        emitter.add('active_relationship_facts', { relationship_ref: relationRef, person_record_ref: personRef, status: 'confirmed', relationship_class: 'secondary_relationship', subtype: unknown<string>('universal_secondary_relationship_subtype_not_characterized', [evidence]), team_id_raw: anchor.team_id, wage_raw: anchor.wage_raw, start_date: relation.joined.iso, end_date: relation.expiry.iso, signed_or_effective_date: relation.effective.iso, active_at_checkpoint: active === null ? unknown<boolean>('checkpoint_or_relationship_date_unavailable', [evidence]) : confirmed(active, 'relationship_period_compared_to_checkpoint', [evidence]), evidence_refs: [evidence], derivation_ref: derivationRef })
        relationCount += 1
      } else if (hasNearbyContractHeader(contractHeaders, anchor.offset, boundaryStart)) {
        unsupportedCount += 1
        counts.contract_unsupported_layout = (counts.contract_unsupported_layout ?? 0) + 1
      } else {
        unsupportedCount += 1
        counts.contract_unsupported_secondary_dates = (counts.contract_unsupported_secondary_dates ?? 0) + 1
      }
      void anchorEvidence
    }
    const currentCandidates = completeCandidates.filter(candidate => candidate.status === 'current_candidate')
    if (currentCandidates.length > 1) warnings.push(`Multiple current complete contract candidates for EID ${identity.eid}; contracts remain facts but no club affiliation is promoted.`)
    coverage.add('contract_fact', completeCount > 0 ? 'confirmed' : unsupportedCount > 0 ? 'unsupported' : 'unknown', completeCount > 0 ? 'one_or_more_complete_contract_facts_confirmed' : unsupportedCount > 0 ? 'contract_anchor_variant_unsupported' : 'no_complete_contract_fact_confirmed')
    coverage.add('active_relationship', relationCount > 0 ? 'confirmed' : unsupportedCount > 0 ? 'unsupported' : 'unknown', relationCount > 0 ? 'one_or_more_secondary_relationship_facts_confirmed' : unsupportedCount > 0 ? 'relationship_anchor_variant_unsupported' : 'no_secondary_relationship_fact_confirmed')
    counts.contract_facts = (counts.contract_facts ?? 0) + completeCount
    counts.active_relationship_facts = (counts.active_relationship_facts ?? 0) + relationCount
    counts.contract_unsupported_anchors = (counts.contract_unsupported_anchors ?? 0) + unsupportedCount

    coverage.add('club_affiliation_public_uid', 'unsupported', 'positive_universal_public_club_uid_authority_not_characterized')
    coverage.add('free_agent_registration', 'unsupported', 'positive_universal_free_agent_authority_not_characterized')
  }
  timings.person_facts = now() - t
  counts.biography_reason_counts = Object.values(biographyReasonCounts).reduce((sum, value) => sum + value, 0)
  counts.player_core_reason_counts = Object.values(abilityReasonCounts).reduce((sum, value) => sum + value, 0)

  emitter.flush()
  timings.total = now() - tTotal

  const manifest = coverage.finalize()
  return {
    output_contract_version: WORLD_CENSUS_OUTPUT_CONTRACT_VERSION,
    representation_version: WORLD_CENSUS_REPRESENTATION_VERSION,
    reader_version: WORLD_CENSUS_READER_VERSION,
    source_artifact: input.sourceArtifact,
    checkpoint: input.checkpoint,
    coverage_manifest: manifest,
    decoder_catalog: [
      { decoder_id: 'person_record_boundary', version: 'v1' },
      { decoder_id: 'player_core_ability', version: 'v1' },
      { decoder_id: 'biography_standard_owned', version: 'v1' },
      { decoder_id: 'biography_alternate_owned', version: 'r-wc-02-v1' },
      { decoder_id: 'structural_team_row', version: 'v1' },
      { decoder_id: 'organization_scope_framed', version: 'r-wc-03-v1' },
      { decoder_id: 'complete_standard_contract', version: 'e-mc-01-v1' },
      { decoder_id: 'secondary_relationship', version: 'e-mc-01-v1' },
      { decoder_id: 'club_affiliation_fail_closed', version: 'r-wc-01-v1' },
    ],
    diagnostics: {
      timings_ms: timings,
      counts,
      warnings,
      person_region_start: personRegionStart,
      emitted_batches: emitter.stats.batches,
      emitted_items: emitter.stats.items,
      emitted_serialized_bytes: emitter.stats.bytes,
      max_batch_serialized_bytes: emitter.stats.maxBytes,
      organization_scope_frame: { status: scopeIndex.status, start: scopeIndex.frameStart, end: scopeIndex.frameEnd, physical_candidates: scopeIndex.physicalCandidates, logical_scopes: scopeIndex.scopes.length },
    },
  }
}
