type UnknownRecord = Record<string, unknown>

export const MEMBERSHIP_FACTS_SCHEMA = 'membership_facts_v1' as const
export const MEMBERSHIP_FACTS_VERSION = 'e-mc-01-v1' as const
export const MEMBERSHIP_READER_VERSION = 'fm26-membership-reader/e-mc-01-v1' as const

export type FactualStatus = 'confirmed' | 'unknown' | 'ambiguous' | 'unsupported'
export type FactualValue<T> = {
  status: FactualStatus
  reason_code: string
  value: T | null
  evidence_refs: string[]
}

export type MembershipPackedDate = {
  offset: number
  packed_raw: number
  packed_hex: string
  year: number
  day_of_year: number
  flags: number
  flags_hex: string
  iso: string | null
  sentinel: boolean
}

export type MembershipContractTerm = {
  offset: number
  type_id: number | null
  raw_value: number | null
  raw_payload: string
  status: 'decoded_type_value' | 'raw_only'
}

export type ContractTemporalStatus = 'current' | 'current_candidate' | 'ambiguous_current_candidate' | 'future' | 'historical' | 'unresolved'

export type CompleteContractObject = {
  ref: string
  kind: 'complete_standard_contract'
  temporal_status: ContractTemporalStatus
  team_id_raw: number
  wage_raw: number
  expiry_date: string | null
  joined_or_start_date: string | null
  signed_or_effective_date: string | null
  state_date: string | null
  terms: MembershipContractTerm[]
  auxiliary_count: number
  auxiliary_blocks: Array<{ offset: number; length: 31 }>
  offsets: {
    object_start: number
    terms_header: number
    terms_end: number
    trailer_start: number
    anchor: number
  }
  raw_dates: {
    terms_header: MembershipPackedDate
    expiry: MembershipPackedDate
    joined_or_start: MembershipPackedDate
    signed_or_effective: MembershipPackedDate
    state: MembershipPackedDate
  }
  provenance: { source_member: 'game_db.dat'; parser_version: typeof MEMBERSHIP_FACTS_VERSION }
}

export type SecondaryRelationship = {
  ref: string
  kind: 'secondary_relationship'
  team_id_raw: number
  wage_raw: number
  start_date: string | null
  end_date: string | null
  signed_or_effective_date: string | null
  active_at_checkpoint: boolean | null
  structural_classification: 'internal_same_organization' | 'external' | 'organization_unresolved' | 'not_active' | 'unknown'
  organization_ref: string | null
  offsets: { anchor: number }
  raw_dates: {
    end: MembershipPackedDate
    start: MembershipPackedDate
    signed_or_effective: MembershipPackedDate
    state: MembershipPackedDate
  }
  provenance: { source_member: 'game_db.dat'; parser_version: typeof MEMBERSHIP_FACTS_VERSION }
}

export type UnsupportedContractAnchor = {
  ref: string
  team_id_raw: number
  wage_raw: number
  anchor_offset: number
  reason_code: string
}

export type StructuralOrganization = {
  organization_ref: string
  record_offset: number
  organization_team_ids: number[]
  partition_a_team_ids: number[]
  partition_b_team_ids: number[]
  provenance: {
    source_member: 'game_db.dat'
    resolution_method: 'unique_structural_organization_record'
  }
}

export type TeamOrganizationResolution = {
  team_id_raw: number
  status: 'confirmed' | 'unknown' | 'ambiguous'
  reason_code: string
  candidate_count: number
  candidate_refs: string[]
  organization: StructuralOrganization | null
}

export type ContractReference = {
  ref: string
  team_id_raw: number
  organization_ref: string | null
  expiry_date: string | null
  joined_or_start_date: string | null
  signed_or_effective_date: string | null
  wage_raw: number
}

export type OrganizationReference = {
  organization_ref: string
  organization_team_ids: number[]
  record_offset: number
}

export type StructuralTeamReference = {
  team_id_raw: number
  team_name_raw: string | null
  roster_group_label_raw: string | null
}

export type MembershipFactsV1 = {
  schema: typeof MEMBERSHIP_FACTS_SCHEMA
  version: typeof MEMBERSHIP_FACTS_VERSION
  provenance: {
    reader_parser_version: typeof MEMBERSHIP_READER_VERSION
    source_member: 'game_db.dat'
    checkpoint_date: string | null
    player_eid: number
    player_uid: number
    identity_offset: number
    scan_window: { start_offset: number; end_offset: number }
    organization_resolution_method: 'unique_structural_organization_record'
  }
  raw_structural_membership: {
    team_id_raw: number | null
    team_name_raw: string | null
    roster_group_label_raw: string | null
    roster_group_index_raw: number | null
    roster_group_primary_raw: boolean | null
    roster_group_record_offset: number | null
  }
  organization_resolution: {
    teams: TeamOrganizationResolution[]
  }
  contracts: {
    complete_objects: CompleteContractObject[]
    current_selection: FactualValue<ContractReference>
    future_objects: CompleteContractObject[]
    historical_objects: CompleteContractObject[]
    unresolved_complete_objects: CompleteContractObject[]
    unsupported_anchors: UnsupportedContractAnchor[]
  }
  relationships: SecondaryRelationship[]
  resolved_membership_facts: {
    structural_team: FactualValue<StructuralTeamReference>
    structural_squad: FactualValue<{ label_raw: string; index_raw: number | null }>
    organization_identity: FactualValue<OrganizationReference>
    team_level: FactualValue<'first_team'>
    current_standard_contract: FactualValue<ContractReference>
    future_standard_contracts: FactualValue<ContractReference[]>
    contract_expiry: FactualValue<string>
    joined_or_start_date: FactualValue<string>
    signed_or_effective_date: FactualValue<string>
    owner_organization: FactualValue<OrganizationReference>
    current_organization: FactualValue<OrganizationReference>
    is_loan: FactualValue<boolean>
    loan_from_organization: FactualValue<OrganizationReference>
    loan_to_organization: FactualValue<OrganizationReference>
    internal_same_organization_relations: FactualValue<Array<{ relationship_ref: string; team_id_raw: number; organization_ref: string }>>
  }
  unsupported_capabilities: Array<{
    field: string
    status: 'unsupported'
    reason_code: string
  }>
}

type AnchorCandidate = {
  offset: number
  teamId: number
  wage: number
}

type ContractEvidence = {
  complete: CompleteContractObject[]
  relationships: SecondaryRelationship[]
  unsupported: UnsupportedContractAnchor[]
  scanStart: number
  scanEnd: number
}

type OrganizationIndex = {
  records: StructuralOrganization[]
  byTeamId: Map<number, StructuralOrganization[]>
}

const organizationIndexCache = new WeakMap<Uint8Array, OrganizationIndex>()

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
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

function hex(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let offset = Math.max(0, start); offset < Math.min(bytes.length, end); offset++) out += bytes[offset].toString(16).padStart(2, '0')
  return out
}

function leapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
}

function daysInYear(year: number): number {
  return leapYear(year) ? 366 : 365
}

export function decodeMembershipPackedDate(bytes: Uint8Array, offset: number): MembershipPackedDate | null {
  if (offset < 0 || offset + 4 > bytes.length) return null
  const packed = u32(bytes, offset)
  const year = packed >>> 16
  const dayOfYear = packed & 0x01ff
  const flags = packed & 0xfe00
  if (year < 1900 || year > 2200 || dayOfYear < 1 || dayOfYear > daysInYear(year)) return null
  const sentinel = year === 1900
  let iso: string | null = null
  if (!sentinel) {
    const date = new Date(Date.UTC(year, 0, 1))
    date.setUTCDate(dayOfYear)
    iso = date.toISOString().slice(0, 10)
  }
  return {
    offset,
    packed_raw: packed,
    packed_hex: `0x${packed.toString(16).padStart(8, '0')}`,
    year,
    day_of_year: dayOfYear,
    flags,
    flags_hex: `0x${flags.toString(16).padStart(4, '0')}`,
    iso,
    sentinel,
  }
}

function confirmed<T>(value: T, reasonCode: string, evidenceRefs: string[]): FactualValue<T> {
  return { status: 'confirmed', reason_code: reasonCode, value, evidence_refs: evidenceRefs }
}

function unknown<T>(reasonCode: string, evidenceRefs: string[] = []): FactualValue<T> {
  return { status: 'unknown', reason_code: reasonCode, value: null, evidence_refs: evidenceRefs }
}

function ambiguous<T>(reasonCode: string, evidenceRefs: string[] = []): FactualValue<T> {
  return { status: 'ambiguous', reason_code: reasonCode, value: null, evidence_refs: evidenceRefs }
}

function unsupported<T>(reasonCode: string, evidenceRefs: string[] = []): FactualValue<T> {
  return { status: 'unsupported', reason_code: reasonCode, value: null, evidence_refs: evidenceRefs }
}

function validTeamId(teamId: number): boolean {
  return Number.isInteger(teamId) && teamId > 0 && teamId < 100_000
}

/**
 * Characterized organization record grammar from E-MC-01. The scan is performed
 * once per game_db Uint8Array and indexed by raw structural Team ID.
 */
export function indexStructuralOrganizations(gameDb: Uint8Array): OrganizationIndex {
  const cached = organizationIndexCache.get(gameDb)
  if (cached) return cached

  const records: StructuralOrganization[] = []
  const seenRecords = new Set<string>()
  let searchFrom = 1
  while (searchFrom < gameDb.length - 3) {
    const ffOffset = gameDb.indexOf(0xff, searchFrom)
    if (ffOffset < 0) break
    searchFrom = ffOffset + 1
    if (ffOffset < 1 || ffOffset + 2 >= gameDb.length || gameDb[ffOffset - 1] !== 0x00 || gameDb[ffOffset + 1] !== 0x00) continue
    const offset = ffOffset - 1
    const countA = gameDb[offset + 3]
    // Characterized E-MC-01 corpus bounds. Keeping the bounds strict materially
    // reduces accidental byte-pattern matches and fails closed for variants.
    if (countA < 2 || countA > 6) continue
    let cursor = offset + 4
    if (cursor + countA * 4 + 1 > gameDb.length) continue
    const a: number[] = []
    let valid = true
    for (let index = 0; index < countA; index++) {
      const teamId = u32(gameDb, cursor)
      cursor += 4
      if (!validTeamId(teamId)) { valid = false; break }
      a.push(teamId)
    }
    if (!valid) continue
    const countB = gameDb[cursor++]
    if (countB > 6 || cursor + countB * 4 > gameDb.length) continue
    const b: number[] = []
    for (let index = 0; index < countB; index++) {
      const teamId = u32(gameDb, cursor)
      cursor += 4
      if (!validTeamId(teamId)) { valid = false; break }
      b.push(teamId)
    }
    if (!valid) continue
    const all = [...a, ...b]
    if (new Set(all).size !== all.length) continue

    const identity = `${offset}:${a.join(',')}|${b.join(',')}`
    if (seenRecords.has(identity)) continue
    seenRecords.add(identity)
    records.push({
      organization_ref: `game_db.dat@${offset}`,
      record_offset: offset,
      organization_team_ids: all,
      partition_a_team_ids: a,
      partition_b_team_ids: b,
      provenance: {
        source_member: 'game_db.dat',
        resolution_method: 'unique_structural_organization_record',
      },
    })
  }

  const byTeamId = new Map<number, StructuralOrganization[]>()
  for (const record of records) {
    for (const teamId of record.organization_team_ids) {
      const existing = byTeamId.get(teamId)
      if (existing) existing.push(record)
      else byTeamId.set(teamId, [record])
    }
  }
  const index = { records, byTeamId }
  organizationIndexCache.set(gameDb, index)
  return index
}

export function resolveStructuralTeamOrganization(index: OrganizationIndex, teamId: number): TeamOrganizationResolution {
  const candidates = index.byTeamId.get(teamId) ?? []
  if (candidates.length === 0) {
    return {
      team_id_raw: teamId,
      status: 'unknown',
      reason_code: 'organization_record_not_found',
      candidate_count: 0,
      candidate_refs: [],
      organization: null,
    }
  }
  if (candidates.length !== 1) {
    return {
      team_id_raw: teamId,
      status: 'ambiguous',
      reason_code: 'multiple_organization_records_for_team',
      candidate_count: candidates.length,
      candidate_refs: candidates.map(candidate => candidate.organization_ref),
      organization: null,
    }
  }
  return {
    team_id_raw: teamId,
    status: 'confirmed',
    reason_code: 'unique_structural_organization_record',
    candidate_count: 1,
    candidate_refs: [candidates[0].organization_ref],
    organization: candidates[0],
  }
}

function findAnchors(bytes: Uint8Array, eid: number, identityOffset: number): AnchorCandidate[] {
  const scanStart = Math.max(0, identityOffset - 4096)
  const scanEnd = Math.min(bytes.length, identityOffset)
  const out: AnchorCandidate[] = []
  const low = eid & 0xff
  let cursor = scanStart
  while (cursor + 16 <= scanEnd) {
    const found = bytes.indexOf(low, cursor)
    if (found < 0 || found + 16 > scanEnd) break
    if (u32(bytes, found) === eid) {
      const teamId = u32(bytes, found + 4)
      const zero = u32(bytes, found + 8)
      const wage = u32(bytes, found + 12)
      if (validTeamId(teamId) && zero === 0 && wage <= 10_000_000) out.push({ offset: found, teamId, wage })
    }
    cursor = found + 1
  }
  return out
}

function allFf(bytes: Uint8Array, offset: number, count: number): boolean {
  if (offset < 0 || offset + count > bytes.length) return false
  for (let index = 0; index < count; index++) if (bytes[offset + index] !== 0xff) return false
  return true
}

function allZero(bytes: Uint8Array, offset: number, count: number): boolean {
  if (offset < 0 || offset + count > bytes.length) return false
  for (let index = 0; index < count; index++) if (bytes[offset + index] !== 0) return false
  return true
}

function termsFor(bytes: Uint8Array, offset: number, count: number): MembershipContractTerm[] {
  const terms: MembershipContractTerm[] = []
  for (let index = 0; index < count; index++) {
    const termOffset = offset + index * 8
    const marker = u16(bytes, termOffset + 4)
    const typeId = marker === 0xffff ? u16(bytes, termOffset + 6) : null
    terms.push({
      offset: termOffset,
      type_id: typeId,
      raw_value: typeId === null ? null : u32(bytes, termOffset),
      raw_payload: hex(bytes, termOffset, termOffset + 8),
      status: typeId === null ? 'raw_only' : 'decoded_type_value',
    })
  }
  return terms
}

type HeaderCandidate = {
  headerOffset: number
  headerDate: MembershipPackedDate
  count: number
  termsOffset: number
  termsEnd: number
  auxiliaryCount: number
  expectedAnchor: number
}

function termHeaderCandidates(bytes: Uint8Array, anchorOffset: number): { exact: HeaderCandidate[]; nearbyMismatch: HeaderCandidate[] } {
  const exact: HeaderCandidate[] = []
  const nearbyMismatch: HeaderCandidate[] = []
  const start = Math.max(0, anchorOffset - 384)
  const end = Math.min(anchorOffset - 15, bytes.length - 16)
  for (let headerOffset = start; headerOffset <= end; headerOffset++) {
    const headerDate = decodeMembershipPackedDate(bytes, headerOffset)
    if (!headerDate || !allFf(bytes, headerOffset + 4, 8) || !allZero(bytes, headerOffset + 12, 3)) continue
    const count = bytes[headerOffset + 15]
    if (count > 96) continue
    const termsOffset = headerOffset + 16
    const termsEnd = termsOffset + count * 8
    if (termsEnd >= bytes.length || termsEnd >= anchorOffset) continue
    const auxiliaryCount = bytes[termsEnd]
    if (auxiliaryCount > 32) continue
    const expectedAnchor = termsEnd + 1 + auxiliaryCount * 31 + 74
    const candidate = { headerOffset, headerDate, count, termsOffset, termsEnd, auxiliaryCount, expectedAnchor }
    if (expectedAnchor === anchorOffset) exact.push(candidate)
    else if (Math.abs(expectedAnchor - anchorOffset) <= 96) nearbyMismatch.push(candidate)
  }
  return { exact, nearbyMismatch }
}

function trailerDates(bytes: Uint8Array, anchorOffset: number) {
  return {
    expiry: decodeMembershipPackedDate(bytes, anchorOffset - 43),
    joined: decodeMembershipPackedDate(bytes, anchorOffset - 39),
    effective: decodeMembershipPackedDate(bytes, anchorOffset - 24),
    state: decodeMembershipPackedDate(bytes, anchorOffset - 5),
  }
}

function relationActivity(start: string | null, end: string | null, checkpoint: string | null): boolean | null {
  if (!checkpoint || !start || !end) return null
  return start <= checkpoint && checkpoint <= end
}

function contractRef(object: CompleteContractObject, org: TeamOrganizationResolution | null): ContractReference {
  return {
    ref: object.ref,
    team_id_raw: object.team_id_raw,
    organization_ref: org?.status === 'confirmed' ? org.organization!.organization_ref : null,
    expiry_date: object.expiry_date,
    joined_or_start_date: object.joined_or_start_date,
    signed_or_effective_date: object.signed_or_effective_date,
    wage_raw: object.wage_raw,
  }
}

function parseContractEvidence(bytes: Uint8Array, eid: number, identityOffset: number, checkpointDate: string | null): ContractEvidence {
  const scanStart = Math.max(0, identityOffset - 4096)
  const scanEnd = Math.min(bytes.length, identityOffset)
  const complete: CompleteContractObject[] = []
  const relationships: SecondaryRelationship[] = []
  const unsupportedAnchors: UnsupportedContractAnchor[] = []

  for (const anchor of findAnchors(bytes, eid, identityOffset)) {
    const ref = `game_db.dat@${anchor.offset}`
    const dates = trailerDates(bytes, anchor.offset)
    const invalidTrailer = !dates.expiry || !dates.joined || !dates.effective || !dates.state
    const headers = termHeaderCandidates(bytes, anchor.offset)

    if (headers.exact.length > 1) {
      unsupportedAnchors.push({ ref, team_id_raw: anchor.teamId, wage_raw: anchor.wage, anchor_offset: anchor.offset, reason_code: 'multiple_complete_contract_preambles' })
      continue
    }

    if (headers.exact.length === 1) {
      if (invalidTrailer) {
        unsupportedAnchors.push({ ref, team_id_raw: anchor.teamId, wage_raw: anchor.wage, anchor_offset: anchor.offset, reason_code: 'invalid_complete_contract_trailer_date' })
        continue
      }
      const header = headers.exact[0]
      const auxiliaryBlocks = Array.from({ length: header.auxiliaryCount }, (_, index) => ({
        offset: header.termsEnd + 1 + index * 31,
        length: 31 as const,
      }))
      const trailerStart = header.termsEnd + 1 + header.auxiliaryCount * 31
      complete.push({
        ref,
        kind: 'complete_standard_contract',
        temporal_status: 'unresolved',
        team_id_raw: anchor.teamId,
        wage_raw: anchor.wage,
        expiry_date: dates.expiry!.iso,
        joined_or_start_date: dates.joined!.iso,
        signed_or_effective_date: dates.effective!.iso,
        state_date: dates.state!.iso,
        terms: termsFor(bytes, header.termsOffset, header.count),
        auxiliary_count: header.auxiliaryCount,
        auxiliary_blocks: auxiliaryBlocks,
        offsets: {
          object_start: header.headerOffset,
          terms_header: header.headerOffset,
          terms_end: header.termsEnd,
          trailer_start: trailerStart,
          anchor: anchor.offset,
        },
        raw_dates: {
          terms_header: header.headerDate,
          expiry: dates.expiry!,
          joined_or_start: dates.joined!,
          signed_or_effective: dates.effective!,
          state: dates.state!,
        },
        provenance: { source_member: 'game_db.dat', parser_version: MEMBERSHIP_FACTS_VERSION },
      })
      continue
    }

    // A nearby valid term-header shape whose derived anchor misses by a small
    // structural unit is evidence of a malformed/unsupported complete variant,
    // not permission to silently reinterpret it as a relationship.
    if (headers.nearbyMismatch.length > 0) {
      unsupportedAnchors.push({ ref, team_id_raw: anchor.teamId, wage_raw: anchor.wage, anchor_offset: anchor.offset, reason_code: 'complete_contract_layout_mismatch' })
      continue
    }

    if (invalidTrailer) {
      unsupportedAnchors.push({ ref, team_id_raw: anchor.teamId, wage_raw: anchor.wage, anchor_offset: anchor.offset, reason_code: 'secondary_relationship_dates_unsupported' })
      continue
    }

    const start = dates.joined!.iso
    const end = dates.expiry!.iso
    relationships.push({
      ref,
      kind: 'secondary_relationship',
      team_id_raw: anchor.teamId,
      wage_raw: anchor.wage,
      start_date: start,
      end_date: end,
      signed_or_effective_date: dates.effective!.iso,
      active_at_checkpoint: relationActivity(start, end, checkpointDate),
      structural_classification: checkpointDate && start && end && !(start <= checkpointDate && checkpointDate <= end) ? 'not_active' : 'unknown',
      organization_ref: null,
      offsets: { anchor: anchor.offset },
      raw_dates: {
        end: dates.expiry!,
        start: dates.joined!,
        signed_or_effective: dates.effective!,
        state: dates.state!,
      },
      provenance: { source_member: 'game_db.dat', parser_version: MEMBERSHIP_FACTS_VERSION },
    })
  }

  return { complete, relationships, unsupported: unsupportedAnchors, scanStart, scanEnd }
}

function temporalStart(object: CompleteContractObject): string | null {
  return object.signed_or_effective_date ?? object.joined_or_start_date
}

function withTemporalStatus(object: CompleteContractObject, temporal_status: ContractTemporalStatus): CompleteContractObject {
  return object.temporal_status === temporal_status ? object : { ...object, temporal_status }
}

function selectContracts(objects: CompleteContractObject[], unsupportedAnchors: UnsupportedContractAnchor[], checkpointDate: string | null) {
  if (!checkpointDate) {
    const classified = objects.map(object => withTemporalStatus(object, 'unresolved'))
    return {
      complete: classified,
      current: unknown<CompleteContractObject>('checkpoint_date_unavailable'),
      future: [] as CompleteContractObject[],
      historical: [] as CompleteContractObject[],
      unresolved: classified,
    }
  }

  const future: CompleteContractObject[] = []
  const historical: CompleteContractObject[] = []
  const currentCandidates: CompleteContractObject[] = []
  const unresolved: CompleteContractObject[] = []
  for (const object of objects) {
    const start = temporalStart(object)
    const expiry = object.expiry_date
    if (!start || !expiry || expiry < start) {
      unresolved.push(withTemporalStatus(object, 'unresolved'))
      continue
    }
    if (start > checkpointDate) {
      future.push(withTemporalStatus(object, 'future'))
      continue
    }
    if (expiry >= checkpointDate) currentCandidates.push(withTemporalStatus(object, 'current_candidate'))
    else historical.push(withTemporalStatus(object, 'historical'))
  }

  if (currentCandidates.length > 1) {
    const ambiguousCandidates = currentCandidates.map(object => withTemporalStatus(object, 'ambiguous_current_candidate'))
    const complete = [...future, ...historical, ...unresolved, ...ambiguousCandidates].sort((a, b) => a.offsets.anchor - b.offsets.anchor)
    return {
      complete,
      current: ambiguous<CompleteContractObject>('multiple_current_complete_contract_candidates', ambiguousCandidates.map(candidate => candidate.ref)),
      future,
      historical,
      unresolved: [...unresolved, ...ambiguousCandidates],
    }
  }
  if (currentCandidates.length === 1) {
    const candidate = currentCandidates[0]
    if (unsupportedAnchors.length > 0) {
      const complete = [...future, ...historical, ...unresolved, candidate].sort((a, b) => a.offsets.anchor - b.offsets.anchor)
      return {
        complete,
        current: unsupported<CompleteContractObject>('unsupported_contract_anchor_may_contradict_current', [candidate.ref, ...unsupportedAnchors.map(anchor => anchor.ref)]),
        future,
        historical,
        unresolved: [...unresolved, candidate],
      }
    }
    const currentObject = withTemporalStatus(candidate, 'current')
    const complete = [...future, ...historical, ...unresolved, currentObject].sort((a, b) => a.offsets.anchor - b.offsets.anchor)
    return {
      complete,
      current: confirmed(currentObject, 'unique_current_complete_contract_candidate', [currentObject.ref]),
      future,
      historical,
      unresolved,
    }
  }
  const complete = [...future, ...historical, ...unresolved].sort((a, b) => a.offsets.anchor - b.offsets.anchor)
  if (unsupportedAnchors.length > 0) {
    return {
      complete,
      current: unsupported<CompleteContractObject>('unsupported_contract_variant_without_current_resolution', unsupportedAnchors.map(anchor => anchor.ref)),
      future,
      historical,
      unresolved,
    }
  }
  return {
    complete,
    current: unknown<CompleteContractObject>('no_current_complete_contract_candidate'),
    future,
    historical,
    unresolved,
  }
}

function orgReference(org: StructuralOrganization): OrganizationReference {
  return {
    organization_ref: org.organization_ref,
    organization_team_ids: [...org.organization_team_ids],
    record_offset: org.record_offset,
  }
}

function uniqueTeamResolutions(index: OrganizationIndex, teamIds: Iterable<number>): TeamOrganizationResolution[] {
  return [...new Set([...teamIds].filter(validTeamId))].sort((a, b) => a - b).map(teamId => resolveStructuralTeamOrganization(index, teamId))
}

function byTeam(resolutions: TeamOrganizationResolution[]): Map<number, TeamOrganizationResolution> {
  return new Map(resolutions.map(resolution => [resolution.team_id_raw, resolution]))
}

function currentContractFact(selection: FactualValue<CompleteContractObject>, organizations: Map<number, TeamOrganizationResolution>): FactualValue<ContractReference> {
  if (selection.status !== 'confirmed' || !selection.value) return { ...selection, value: null } as FactualValue<ContractReference>
  const org = organizations.get(selection.value.team_id_raw) ?? null
  return confirmed(contractRef(selection.value, org), 'unique_current_complete_contract_candidate', selection.evidence_refs)
}

function fieldFromCurrentContract(current: FactualValue<ContractReference>, field: 'expiry_date' | 'joined_or_start_date' | 'signed_or_effective_date', reason: string): FactualValue<string> {
  if (current.status !== 'confirmed' || !current.value) {
    if (current.status === 'ambiguous') return ambiguous('current_contract_ambiguous', current.evidence_refs)
    if (current.status === 'unsupported') return unsupported('current_contract_unsupported', current.evidence_refs)
    return unknown('current_contract_unresolved', current.evidence_refs)
  }
  const value = current.value[field]
  return value ? confirmed(value, reason, [current.value.ref]) : unknown('current_contract_date_unresolved', [current.value.ref])
}

function unresolvedLike<T>(resolution: TeamOrganizationResolution, unknownReason: string): FactualValue<T> {
  return resolution.status === 'ambiguous'
    ? ambiguous<T>('organization_resolution_ambiguous', resolution.candidate_refs)
    : unknown<T>(unknownReason)
}

function structuralOrganizationFact(resolution: TeamOrganizationResolution | null): FactualValue<OrganizationReference> {
  if (!resolution) return unknown('structural_team_unresolved')
  if (resolution.status !== 'confirmed' || !resolution.organization) return unresolvedLike(resolution, 'structural_team_organization_unresolved')
  return confirmed(orgReference(resolution.organization), 'unique_structural_organization_record', resolution.candidate_refs)
}

function ownerFact(currentSelection: FactualValue<CompleteContractObject>, organizations: Map<number, TeamOrganizationResolution>): FactualValue<OrganizationReference> {
  if (currentSelection.status !== 'confirmed' || !currentSelection.value) {
    if (currentSelection.status === 'ambiguous') return ambiguous('current_contract_root_ambiguous', currentSelection.evidence_refs)
    if (currentSelection.status === 'unsupported') return unsupported('current_contract_root_unsupported', currentSelection.evidence_refs)
    return unknown('current_contract_root_unresolved', currentSelection.evidence_refs)
  }
  const resolution = organizations.get(currentSelection.value.team_id_raw)
  if (!resolution || resolution.status !== 'confirmed' || !resolution.organization) {
    return resolution ? unresolvedLike(resolution, 'current_root_organization_unresolved') : unknown('current_root_organization_unresolved')
  }
  return confirmed(orgReference(resolution.organization), 'unique_current_root_organization', [currentSelection.value.ref, ...resolution.candidate_refs])
}

function resolveRelationships(
  relationships: SecondaryRelationship[],
  checkpointDate: string | null,
  organizations: Map<number, TeamOrganizationResolution>,
  rootOrganization: OrganizationReference | null,
): SecondaryRelationship[] {
  return relationships.map(relation => {
    const org = organizations.get(relation.team_id_raw)
    const organizationRef = org?.status === 'confirmed' ? org.organization!.organization_ref : null
    let classification = relation.structural_classification
    if (relation.active_at_checkpoint === false) classification = 'not_active'
    else if (relation.active_at_checkpoint === true) {
      if (!organizationRef) classification = 'organization_unresolved'
      else if (rootOrganization && organizationRef === rootOrganization.organization_ref) classification = 'internal_same_organization'
      else classification = 'external'
    } else if (!checkpointDate) classification = 'unknown'
    return { ...relation, organization_ref: organizationRef, structural_classification: classification }
  })
}

function evaluateMembershipFacts(args: {
  structuralOrg: FactualValue<OrganizationReference>
  owner: FactualValue<OrganizationReference>
  relationships: SecondaryRelationship[]
  hasCurrentRoot: boolean
}): Pick<MembershipFactsV1['resolved_membership_facts'], 'current_organization' | 'is_loan' | 'loan_from_organization' | 'loan_to_organization' | 'internal_same_organization_relations'> {
  const active = args.relationships.filter(relation => relation.active_at_checkpoint === true)
  const unresolvedActive = active.filter(relation => !relation.organization_ref)
  const internal = active.filter(relation => relation.structural_classification === 'internal_same_organization' && relation.organization_ref)
  const external = active.filter(relation => relation.structural_classification === 'external' && relation.organization_ref)
  const externalByOrg = new Map<string, SecondaryRelationship[]>()
  for (const relation of external) {
    const existing = externalByOrg.get(relation.organization_ref!)
    if (existing) existing.push(relation)
    else externalByOrg.set(relation.organization_ref!, [relation])
  }

  const internalFact = args.owner.status === 'confirmed'
    ? confirmed(internal.map(relation => ({ relationship_ref: relation.ref, team_id_raw: relation.team_id_raw, organization_ref: relation.organization_ref! })), 'same_organization_relationships_grouped', internal.map(relation => relation.ref))
    : unknown<Array<{ relationship_ref: string; team_id_raw: number; organization_ref: string }>>('current_root_organization_unresolved', active.map(relation => relation.ref))

  if (!args.hasCurrentRoot) {
    // Special fail-closed convergence path: a rootless relationship can establish
    // current organization only when independent structural membership and one
    // active relationship converge to the same uniquely resolved organization.
    const activeResolvedOrganizations = new Set(active.flatMap(relation => relation.organization_ref ? [relation.organization_ref] : []))
    const converged = args.structuralOrg.status === 'confirmed'
      && args.structuralOrg.value
      && unresolvedActive.length === 0
      && activeResolvedOrganizations.size === 1
      && activeResolvedOrganizations.has(args.structuralOrg.value.organization_ref)
    const current = converged
      ? confirmed(args.structuralOrg.value!, 'structural_membership_and_current_relation_converge', active.map(relation => relation.ref))
      : activeResolvedOrganizations.size > 1
        ? ambiguous<OrganizationReference>('multiple_active_relationship_organizations_without_root', active.map(relation => relation.ref))
        : unknown<OrganizationReference>('current_organization_unresolved_without_current_root', active.map(relation => relation.ref))
    return {
      current_organization: current,
      is_loan: unknown<boolean>('loan_requires_confirmed_current_root', active.map(relation => relation.ref)),
      loan_from_organization: unknown<OrganizationReference>('loan_from_requires_confirmed_current_root', active.map(relation => relation.ref)),
      loan_to_organization: unknown<OrganizationReference>('loan_to_requires_confirmed_current_root', active.map(relation => relation.ref)),
      internal_same_organization_relations: internalFact,
    }
  }

  if (args.owner.status !== 'confirmed' || !args.owner.value) {
    const reason = args.owner.status === 'ambiguous' ? 'owner_organization_ambiguous' : args.owner.status === 'unsupported' ? 'owner_organization_unsupported' : 'owner_organization_unresolved'
    const fact = args.owner.status === 'ambiguous' ? ambiguous<OrganizationReference>(reason, args.owner.evidence_refs) : args.owner.status === 'unsupported' ? unsupported<OrganizationReference>(reason, args.owner.evidence_refs) : unknown<OrganizationReference>(reason, args.owner.evidence_refs)
    return {
      current_organization: fact,
      is_loan: fact.status === 'ambiguous' ? ambiguous<boolean>(reason, fact.evidence_refs) : fact.status === 'unsupported' ? unsupported<boolean>(reason, fact.evidence_refs) : unknown<boolean>(reason, fact.evidence_refs),
      loan_from_organization: fact,
      loan_to_organization: fact,
      internal_same_organization_relations: internalFact,
    }
  }

  if (unresolvedActive.length > 0) {
    return {
      current_organization: unknown('active_relationship_organization_unresolved', unresolvedActive.map(relation => relation.ref)),
      is_loan: unknown('active_relationship_organization_unresolved', unresolvedActive.map(relation => relation.ref)),
      loan_from_organization: confirmed(args.owner.value, 'owner_preserved_independently_of_relationship_ambiguity', args.owner.evidence_refs),
      loan_to_organization: unknown('active_relationship_organization_unresolved', unresolvedActive.map(relation => relation.ref)),
      internal_same_organization_relations: internalFact,
    }
  }

  if (externalByOrg.size > 1) {
    const refs = [...externalByOrg.values()].flat().map(relation => relation.ref)
    return {
      current_organization: ambiguous('multiple_external_active_organizations', refs),
      is_loan: ambiguous('multiple_external_active_organizations', refs),
      loan_from_organization: confirmed(args.owner.value, 'owner_preserved_independently_of_external_ambiguity', args.owner.evidence_refs),
      loan_to_organization: ambiguous('multiple_external_active_organizations', refs),
      internal_same_organization_relations: internalFact,
    }
  }

  if (externalByOrg.size === 1) {
    const [organizationRef, relations] = [...externalByOrg.entries()][0]
    const orgValue: OrganizationReference = {
      organization_ref: organizationRef,
      organization_team_ids: [],
      record_offset: Number(organizationRef.split('@')[1]),
    }
    const evidence = relations.map(relation => relation.ref)
    if (args.structuralOrg.status === 'confirmed' && args.structuralOrg.value
      && args.structuralOrg.value.organization_ref !== organizationRef) {
      const contradiction = [...evidence, ...args.structuralOrg.evidence_refs]
      return {
        current_organization: ambiguous('external_relation_conflicts_with_structural_membership', contradiction),
        is_loan: ambiguous('external_relation_conflicts_with_structural_membership', contradiction),
        loan_from_organization: confirmed(args.owner.value, 'owner_preserved_independently_of_current_membership_conflict', args.owner.evidence_refs),
        loan_to_organization: ambiguous('external_relation_conflicts_with_structural_membership', contradiction),
        internal_same_organization_relations: internalFact,
      }
    }
    return {
      current_organization: confirmed(orgValue, 'unique_external_active_organization', evidence),
      is_loan: confirmed(true, 'unique_external_active_organization_with_confirmed_owner', [...args.owner.evidence_refs, ...evidence]),
      loan_from_organization: confirmed(args.owner.value, 'loan_from_equals_confirmed_owner_organization', args.owner.evidence_refs),
      loan_to_organization: confirmed(orgValue, 'loan_to_equals_unique_external_active_organization', evidence),
      internal_same_organization_relations: internalFact,
    }
  }

  // Without positive external evidence, a structural organization that contradicts
  // the current complete-contract root is a real factual contradiction, not a
  // reason to silently treat the root as the player's current organization.
  if (args.structuralOrg.status === 'confirmed' && args.structuralOrg.value
    && args.structuralOrg.value.organization_ref !== args.owner.value.organization_ref) {
    const contradiction = [...args.owner.evidence_refs, ...args.structuralOrg.evidence_refs]
    return {
      current_organization: ambiguous('root_organization_conflicts_with_structural_membership', contradiction),
      is_loan: unknown('loan_requires_positive_external_relationship_evidence', contradiction),
      loan_from_organization: unknown('loan_not_confirmed_despite_known_owner', contradiction),
      loan_to_organization: unknown('loan_not_confirmed_despite_current_membership_conflict', contradiction),
      internal_same_organization_relations: internalFact,
    }
  }

  // No active external organization: ordinary current membership remains at root.
  return {
    current_organization: confirmed(args.owner.value, 'current_root_without_external_active_organization', args.owner.evidence_refs),
    is_loan: confirmed(false, 'no_external_active_organization', args.owner.evidence_refs),
    loan_from_organization: unknown('not_a_confirmed_loan'),
    loan_to_organization: unknown('not_a_confirmed_loan'),
    internal_same_organization_relations: internalFact,
  }
}

function unsupportedCapabilities(): MembershipFactsV1['unsupported_capabilities'] {
  return [
    ['public_club_uid', 'public_club_uid_not_structurally_resolved'],
    ['clubs.fm_club_id', 'structural_team_id_is_not_public_club_uid'],
    ['contract_subtype', 'universal_contract_subtype_not_characterized'],
    ['trial_subtype', 'universal_trial_classifier_not_characterized'],
    ['youth_contract_subtype', 'universal_youth_contract_classifier_not_characterized'],
    ['transfer_mechanism', 'transfer_mechanism_not_characterized'],
    ['transfer_fee', 'transfer_financials_not_characterized'],
    ['loan_financials', 'loan_financials_not_characterized'],
    ['wage_semantics', 'only_raw_wage_value_is_supported'],
  ].map(([field, reason_code]) => ({ field, status: 'unsupported' as const, reason_code }))
}

export function buildPlayerMembershipFacts(
  playerValue: unknown,
  gameDb: Uint8Array,
  checkpointDate: string | null,
  organizationIndex: OrganizationIndex = indexStructuralOrganizations(gameDb),
): MembershipFactsV1 | null {
  const player = asRecord(playerValue)
  if (!player || player.identity_link_confidence !== 'high') return null
  const eid = integer(player.eid)
  const uid = integer(player.uid)
  const identityOffset = integer(player.identity_offset)
  if (eid === null || uid === null || identityOffset === null || identityOffset < 0 || identityOffset + 12 > gameDb.length) return null
  if (u32(gameDb, identityOffset) !== eid || u32(gameDb, identityOffset + 4) !== uid || u32(gameDb, identityOffset + 8) !== uid) return null

  const rosterGroup = asRecord(player.roster_group)
  const structuralTeamId = integer(rosterGroup?.team_id)
  const structuralTeamName = text(rosterGroup?.team_name)
  const rosterLabel = text(rosterGroup?.label)
  const rosterIndex = integer(rosterGroup?.index)
  const rosterPrimary = booleanOrNull(rosterGroup?.primary)
  const rosterRecordOffset = integer(rosterGroup?.record_offset)

  const evidence = parseContractEvidence(gameDb, eid, identityOffset, checkpointDate)
  const selection = selectContracts(evidence.complete, evidence.unsupported, checkpointDate)
  const relevantTeamIds = new Set<number>()
  if (structuralTeamId !== null) relevantTeamIds.add(structuralTeamId)
  for (const object of evidence.complete) relevantTeamIds.add(object.team_id_raw)
  for (const relation of evidence.relationships) relevantTeamIds.add(relation.team_id_raw)
  const teamResolutions = uniqueTeamResolutions(organizationIndex, relevantTeamIds)
  const organizationByTeam = byTeam(teamResolutions)
  const structuralTeamOrgResolution = structuralTeamId === null ? null : organizationByTeam.get(structuralTeamId) ?? null
  const structuralOrg = structuralOrganizationFact(structuralTeamOrgResolution)
  const owner = ownerFact(selection.current, organizationByTeam)
  const rootOrgValue = owner.status === 'confirmed' ? owner.value : null
  const resolvedRelationships = resolveRelationships(evidence.relationships, checkpointDate, organizationByTeam, rootOrgValue)
  const membership = evaluateMembershipFacts({
    structuralOrg,
    owner,
    relationships: resolvedRelationships,
    hasCurrentRoot: selection.current.status === 'confirmed' && Boolean(selection.current.value),
  })

  // Preserve complete organization identity on the current/external refs after the
  // membership decision. No representative Team is promoted to a public club UID.
  const fillOrganizationTeams = (fact: FactualValue<OrganizationReference>): FactualValue<OrganizationReference> => {
    if (fact.status !== 'confirmed' || !fact.value) return fact
    const record = organizationIndex.records.find(candidate => candidate.organization_ref === fact.value!.organization_ref)
    return record ? { ...fact, value: orgReference(record) } : fact
  }
  membership.current_organization = fillOrganizationTeams(membership.current_organization)
  membership.loan_from_organization = fillOrganizationTeams(membership.loan_from_organization)
  membership.loan_to_organization = fillOrganizationTeams(membership.loan_to_organization)

  const currentContract = currentContractFact(selection.current, organizationByTeam)
  const futureContracts = selection.future.map(object => contractRef(object, organizationByTeam.get(object.team_id_raw) ?? null))
  const futureFact = evidence.unsupported.length
    ? unsupported<ContractReference[]>('unsupported_contract_anchor_may_affect_future_set', evidence.unsupported.map(anchor => anchor.ref))
    : confirmed(futureContracts, 'all_future_complete_contracts_enumerated_before_selection', futureContracts.map(contract => contract.ref))

  const structuralTeamFact: FactualValue<StructuralTeamReference> = structuralTeamId === null
    ? unknown('structural_team_unresolved')
    : confirmed({ team_id_raw: structuralTeamId, team_name_raw: structuralTeamName, roster_group_label_raw: rosterLabel }, 'structural_roster_team_observed', rosterRecordOffset === null ? [] : [`game_db.dat@${rosterRecordOffset}`])
  const structuralSquadFact = rosterLabel
    ? confirmed({ label_raw: rosterLabel, index_raw: rosterIndex }, 'structural_roster_group_observed', rosterRecordOffset === null ? [] : [`game_db.dat@${rosterRecordOffset}`])
    : unknown<{ label_raw: string; index_raw: number | null }>('structural_roster_group_label_unresolved')
  const teamLevel = rosterPrimary === true
    ? confirmed<'first_team'>('first_team', 'primary_roster_group_structurally_explicit', rosterRecordOffset === null ? [] : [`game_db.dat@${rosterRecordOffset}`])
    : unknown<'first_team'>('team_level_not_universally_characterized_for_non_primary_group', rosterRecordOffset === null ? [] : [`game_db.dat@${rosterRecordOffset}`])

  return {
    schema: MEMBERSHIP_FACTS_SCHEMA,
    version: MEMBERSHIP_FACTS_VERSION,
    provenance: {
      reader_parser_version: MEMBERSHIP_READER_VERSION,
      source_member: 'game_db.dat',
      checkpoint_date: checkpointDate,
      player_eid: eid,
      player_uid: uid,
      identity_offset: identityOffset,
      scan_window: { start_offset: evidence.scanStart, end_offset: evidence.scanEnd },
      organization_resolution_method: 'unique_structural_organization_record',
    },
    raw_structural_membership: {
      team_id_raw: structuralTeamId,
      team_name_raw: structuralTeamName,
      roster_group_label_raw: rosterLabel,
      roster_group_index_raw: rosterIndex,
      roster_group_primary_raw: rosterPrimary,
      roster_group_record_offset: rosterRecordOffset,
    },
    organization_resolution: { teams: teamResolutions },
    contracts: {
      complete_objects: selection.complete,
      current_selection: currentContract,
      future_objects: selection.future,
      historical_objects: selection.historical,
      unresolved_complete_objects: selection.unresolved,
      unsupported_anchors: evidence.unsupported,
    },
    relationships: resolvedRelationships,
    resolved_membership_facts: {
      structural_team: structuralTeamFact,
      structural_squad: structuralSquadFact,
      organization_identity: structuralOrg,
      team_level: teamLevel,
      current_standard_contract: currentContract,
      future_standard_contracts: futureFact,
      contract_expiry: fieldFromCurrentContract(currentContract, 'expiry_date', 'current_contract_expiry_confirmed'),
      joined_or_start_date: fieldFromCurrentContract(currentContract, 'joined_or_start_date', 'current_contract_joined_or_start_confirmed'),
      signed_or_effective_date: fieldFromCurrentContract(currentContract, 'signed_or_effective_date', 'current_contract_signed_or_effective_confirmed'),
      owner_organization: owner,
      current_organization: membership.current_organization,
      is_loan: membership.is_loan,
      loan_from_organization: membership.loan_from_organization,
      loan_to_organization: membership.loan_to_organization,
      internal_same_organization_relations: membership.internal_same_organization_relations,
    },
    unsupported_capabilities: unsupportedCapabilities(),
  }
}

/**
 * Additive E-MC-01A enrichment. It deliberately writes only the versioned factual
 * envelope (plus root diagnostics) and leaves every legacy contract/loan field
 * untouched so v0.29.2 cannot acquire persistence authority by accident.
 */
export function enrichOfflineMembershipFacts(rawResult: unknown, gameDb: Uint8Array, checkpointDate: string | null): unknown {
  const root = asRecord(rawResult)
  if (!root) return rawResult
  const organizationIndex = indexStructuralOrganizations(gameDb)
  let playersEnveloped = 0
  let completeObjects = 0
  let secondaryRelationships = 0
  let unsupportedAnchors = 0

  for (const humanValue of Array.isArray(root.human_managers) ? root.human_managers : []) {
    const human = asRecord(humanValue)
    if (!human) continue
    for (const playerValue of Array.isArray(human.players) ? human.players : []) {
      const player = asRecord(playerValue)
      if (!player) continue
      const envelope = buildPlayerMembershipFacts(player, gameDb, checkpointDate, organizationIndex)
      if (!envelope) continue
      player.membership_facts_v1 = envelope
      playersEnveloped++
      completeObjects += envelope.contracts.complete_objects.length
      secondaryRelationships += envelope.relationships.length
      unsupportedAnchors += envelope.contracts.unsupported_anchors.length
    }
  }

  root.membership_facts_v1_diagnostics = {
    schema: MEMBERSHIP_FACTS_SCHEMA,
    version: MEMBERSHIP_FACTS_VERSION,
    players_enveloped: playersEnveloped,
    complete_contract_objects: completeObjects,
    secondary_relationships: secondaryRelationships,
    unsupported_anchors: unsupportedAnchors,
    organization_records_indexed: organizationIndex.records.length,
    persistence_authority: false,
  }
  return rawResult
}
