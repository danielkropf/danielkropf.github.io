import { resolveOfflineTeamNames } from './fm26-team-resolver'

type UnknownRecord = Record<string, unknown>

type ReaderPlayer = UnknownRecord & {
  eid?: unknown
  uid?: unknown
  identity_offset?: unknown
  identity_link_confidence?: unknown
  roster_group?: unknown
}

export type ContractTerm = {
  type_id: number | null
  raw_value: number | null
  argument: number | null
  raw_payload: string
  offset: number
  semantic_label: null
  status: 'decoded_type_value' | 'raw_only'
}

export type ContractRelationship = {
  team_id: number
  team_name: string | null
  start_date: string | null
  end_date: string | null
  classification: 'internal' | 'loan_current' | 'historical' | 'future' | 'unknown'
  offset: number
  raw: UnknownRecord
}

export type ContractObject = {
  team_id: number
  team_name: string | null
  weekly_wage: number
  joined_date: string | null
  signed_or_effective_date: string | null
  expiry_date: string | null
  terms: ContractTerm[]
  terms_status: 'resolved' | 'unresolved_variant'
  secondary_relationships: ContractRelationship[]
  offset: number
  raw: UnknownRecord
}

export type ContractLoan = {
  status: 'current' | 'none' | 'unresolved'
  from_team_id: number | null
  from_team_name: string | null
  to_team_id: number | null
  to_team_name: string | null
  start_date: string | null
  end_date: string | null
}

type RawContractDate = {
  offset: number
  day_of_year: number
  year: number
  iso: string | null
  sentinel: boolean
  raw_hex: string
}

type Anchor = {
  offset: number
  end: number
  teamId: number
  wage: number
  completeShape: boolean
}

type ParsedObject = ContractObject & {
  _rawDates: RawContractDate[]
  _effectiveRaw: RawContractDate | null
  _expiryRaw: RawContractDate | null
}

const asRecord = (value: unknown): UnknownRecord | null => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) ? value : null

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

function daysInYear(year: number): number {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 366 : 365
}

/** Confirmed contract-date representation: little-endian u16 day-of-year + u16 year. */
export function decodeContractDate(bytes: Uint8Array, offset: number): RawContractDate | null {
  if (offset < 0 || offset + 4 > bytes.length) return null
  const dayOfYear = u16(bytes, offset)
  const year = u16(bytes, offset + 2)
  if (year < 1900 || year > 2200 || dayOfYear < 1 || dayOfYear > daysInYear(year)) return null
  const sentinel = year === 1900
  let iso: string | null = null
  if (!sentinel) {
    const date = new Date(Date.UTC(year, 0, 1))
    date.setUTCDate(dayOfYear)
    iso = date.toISOString().slice(0, 10)
  }
  return { offset, day_of_year: dayOfYear, year, iso, sentinel, raw_hex: hex(bytes, offset, offset + 4) }
}

function dateCandidates(bytes: Uint8Array, start: number, end: number): RawContractDate[] {
  const out: RawContractDate[] = []
  let offset = Math.max(0, start)
  while (offset + 4 <= Math.min(bytes.length, end)) {
    const value = decodeContractDate(bytes, offset)
    if (value) {
      out.push(value)
      offset += 4
    } else offset += 1
  }
  return out
}

function relationAnchors(bytes: Uint8Array, eid: number, identityOffset: number): Anchor[] {
  const start = Math.max(0, identityOffset - 2400)
  const candidates: Omit<Anchor, 'end'>[] = []
  for (let offset = start; offset + 23 <= identityOffset && offset + 23 <= bytes.length; offset++) {
    if (u32(bytes, offset) !== eid) continue
    const teamId = u32(bytes, offset + 4)
    if (teamId <= 0 || teamId >= 100_000 || u32(bytes, offset + 8) !== 0) continue
    const wage = u32(bytes, offset + 12)
    if (wage > 10_000_000) continue
    const completeShape = bytes[offset + 16] === 0x01
      && bytes[offset + 18] === 0x00
      && u32(bytes, offset + 19) === 0xffffffff
    candidates.push({ offset, teamId, wage, completeShape })
  }
  return candidates.map((candidate, index) => ({
    ...candidate,
    end: Math.min(identityOffset, candidates[index + 1]?.offset ?? identityOffset),
  }))
}

function standardTermHeader(bytes: Uint8Array, start: number, end: number): { expiry: RawContractDate; count: number; termsOffset: number; termsEnd: number; headerOffset: number } | null {
  const matches: Array<{ expiry: RawContractDate; count: number; termsOffset: number; termsEnd: number; headerOffset: number }> = []
  const limit = Math.min(bytes.length, end)
  for (let ff = Math.max(start + 4, 0); ff + 12 <= limit; ff++) {
    let allFf = true
    for (let i = 0; i < 8; i++) if (bytes[ff + i] !== 0xff) { allFf = false; break }
    if (!allFf || bytes[ff + 8] !== 0 || bytes[ff + 9] !== 0 || bytes[ff + 10] !== 0) continue
    const expiry = decodeContractDate(bytes, ff - 4)
    if (!expiry) continue
    const count = bytes[ff + 11]
    if (count > 96) continue
    const termsOffset = ff + 12
    const termsEnd = termsOffset + count * 8
    if (termsEnd > limit) continue
    matches.push({ expiry, count, termsOffset, termsEnd, headerOffset: ff - 4 })
  }
  return matches.length === 1 ? matches[0] : null
}

function decodeTerms(bytes: Uint8Array, offset: number, count: number): ContractTerm[] {
  const terms: ContractTerm[] = []
  for (let index = 0; index < count; index++) {
    const termOffset = offset + index * 8
    const marker = u16(bytes, termOffset + 4)
    const typeId = marker === 0xffff ? u16(bytes, termOffset + 6) : null
    terms.push({
      type_id: typeId,
      raw_value: typeId === null ? null : u32(bytes, termOffset),
      argument: null,
      raw_payload: hex(bytes, termOffset, termOffset + 8),
      offset: termOffset,
      semantic_label: null,
      status: typeId === null ? 'raw_only' : 'decoded_type_value',
    })
  }
  return terms
}

function parseCompleteObject(bytes: Uint8Array, anchor: Anchor): ParsedObject | null {
  if (!anchor.completeShape) return null
  const header = standardTermHeader(bytes, anchor.offset + 23, anchor.end)
  if (!header) {
    return {
      team_id: anchor.teamId,
      team_name: null,
      weekly_wage: anchor.wage,
      joined_date: null,
      signed_or_effective_date: null,
      expiry_date: null,
      terms: [],
      terms_status: 'unresolved_variant',
      secondary_relationships: [],
      offset: anchor.offset,
      raw: {
        anchor_hex: hex(bytes, anchor.offset, Math.min(anchor.end, anchor.offset + 96)),
        object_end: anchor.end,
        weekly_wage_raw: anchor.wage,
      },
      _rawDates: [],
      _effectiveRaw: null,
      _expiryRaw: null,
    }
  }

  // The term list is the structural anchor. Dates after the variable-length term
  // payload are consumed in record order; random date-like values are not accepted
  // when more than the expected two post-list fields appear in the short field window.
  const postDates = dateCandidates(bytes, header.termsEnd, Math.min(anchor.end, header.termsEnd + 80))
  const cleanPostDates = postDates.filter((value, index) => index === 0 || value.offset >= postDates[index - 1].offset + 4)
  const joined = cleanPostDates[0] ?? null
  const effective = cleanPostDates[1] ?? null
  const datesTrusted = cleanPostDates.length <= 2
  const terms = decodeTerms(bytes, header.termsOffset, header.count)
  const normalizedJoined = datesTrusted ? joined?.iso ?? null : null
  const normalizedEffective = datesTrusted ? effective?.iso ?? null : null
  return {
    team_id: anchor.teamId,
    team_name: null,
    weekly_wage: anchor.wage,
    joined_date: normalizedJoined,
    signed_or_effective_date: normalizedEffective,
    expiry_date: header.expiry.iso,
    terms,
    terms_status: 'resolved',
    secondary_relationships: [],
    offset: anchor.offset,
    raw: {
      anchor_hex: hex(bytes, anchor.offset, anchor.offset + 23),
      object_end: anchor.end,
      weekly_wage_raw: anchor.wage,
      terms_header_offset: header.headerOffset,
      terms_count_raw: header.count,
      expiry_date_raw: header.expiry,
      joined_date_raw: joined,
      signed_or_effective_date_raw: effective,
      post_date_status: datesTrusted ? 'structurally_bounded' : 'ambiguous_extra_date_candidates',
    },
    _rawDates: [header.expiry, ...cleanPostDates],
    _effectiveRaw: datesTrusted ? effective : null,
    _expiryRaw: header.expiry,
  }
}

function relationDates(bytes: Uint8Array, anchor: Anchor): { start: RawContractDate | null; end: RawContractDate | null; status: string } {
  const candidates = dateCandidates(bytes, anchor.offset + 16, Math.min(anchor.end, anchor.offset + 144))
  if (candidates.length !== 2) return { start: null, end: null, status: candidates.length ? 'ambiguous_date_candidates' : 'unresolved' }
  const [start, end] = candidates
  if (!start.iso || !end.iso || start.iso > end.iso) return { start: null, end: null, status: 'invalid_or_sentinel_period' }
  return { start, end, status: 'resolved_period' }
}

function isCurrentWindow(start: string | null, end: string | null, saveDate: string): boolean {
  return Boolean(start && end && start <= saveDate && saveDate <= end)
}

function isInternalTeam(teamId: number, rootTeamId: number, managedTeamIds: Set<number>): boolean {
  // A human-club roster set is evidence of an internal/B/C relation only when
  // the root contract itself belongs to that same managed structure. This keeps
  // a loan-in (Chelsea root, Bayern roster) from being mislabeled as internal.
  return managedTeamIds.has(rootTeamId) && managedTeamIds.has(teamId)
}

function chooseContracts(objects: ParsedObject[], saveDate: string | null): { current: ParsedObject | null; future: ParsedObject[]; unresolved: ParsedObject[] } {
  if (!objects.length) return { current: null, future: [], unresolved: [] }
  if (!saveDate) return objects.length === 1 ? { current: objects[0], future: [], unresolved: [] } : { current: null, future: [], unresolved: objects }

  const future = objects.filter(object => Boolean(object.signed_or_effective_date && object.signed_or_effective_date > saveDate))
  const nonFuture = objects.filter(object => !future.includes(object))
  const active = nonFuture.filter(object => {
    const effective = object.signed_or_effective_date ?? object.joined_date
    return (!effective || effective <= saveDate) && (!object.expiry_date || object.expiry_date >= saveDate)
  })
  if (active.length === 1) return { current: active[0], future, unresolved: nonFuture.filter(object => object !== active[0]) }
  if (objects.length === 1 && future.length === 0) return { current: objects[0], future: [], unresolved: [] }
  return { current: null, future, unresolved: nonFuture }
}

function publicObject(object: ParsedObject): ContractObject {
  const { _rawDates: _ignoredDates, _effectiveRaw: _ignoredEffective, _expiryRaw: _ignoredExpiry, ...value } = object
  return value
}

/**
 * Adds the mapped contract layer without changing the characterized v0.22 core.
 * It is intentionally fail-closed: incomplete/ambiguous variants remain raw and
 * no market value or unknown clause label is invented.
 */
export function enrichOfflineContracts(rawResult: unknown, gameDb: Uint8Array, saveDate: string | null): unknown {
  const root = asRecord(rawResult)
  if (!root) return rawResult
  const humans = Array.isArray(root.human_managers) ? root.human_managers : []

  for (const humanValue of humans) {
    const human = asRecord(humanValue)
    if (!human) continue
    const humanClub = asRecord(human.human_club)
    const managedTeamIds = new Set<number>()
    for (const groupValue of Array.isArray(humanClub?.roster_groups) ? humanClub!.roster_groups as unknown[] : []) {
      const group = asRecord(groupValue)
      const id = integer(group?.team_id)
      if (id !== null && id > 0) managedTeamIds.add(id)
    }

    const players = Array.isArray(human.players) ? human.players : []
    for (const playerValue of players) {
      const player = asRecord(playerValue) as ReaderPlayer | null
      if (!player || player.identity_link_confidence !== 'high') continue
      const eid = integer(player.eid)
      const uid = integer(player.uid)
      const identityOffset = integer(player.identity_offset)
      if (eid === null || uid === null || identityOffset === null) continue
      if (identityOffset < 0 || identityOffset + 12 > gameDb.length) continue
      if (u32(gameDb, identityOffset) !== eid || u32(gameDb, identityOffset + 4) !== uid || u32(gameDb, identityOffset + 8) !== uid) continue

      const anchors = relationAnchors(gameDb, eid, identityOffset)
      const parsedObjects = anchors.flatMap(anchor => {
        const parsed = parseCompleteObject(gameDb, anchor)
        return parsed ? [parsed] : []
      })
      const { current, future, unresolved } = chooseContracts(parsedObjects, saveDate)
      const rootTeamId = current?.team_id ?? null

      const relationshipAnchors = anchors.filter(anchor => !parsedObjects.some(object => object.offset === anchor.offset))
      const relationshipDrafts: ContractRelationship[] = relationshipAnchors.map(anchor => {
        const period = relationDates(gameDb, anchor)
        let classification: ContractRelationship['classification'] = 'unknown'
        if (rootTeamId !== null && isInternalTeam(anchor.teamId, rootTeamId, managedTeamIds)) classification = 'internal'
        else if (saveDate && period.start?.iso && period.end?.iso) {
          // A relation whose window includes the save date is only a loan
          // candidate here. It is promoted to loan_current below only when it
          // is the unique, unambiguous external current relation.
          if (period.start.iso > saveDate) classification = 'future'
          else if (period.end.iso < saveDate) classification = 'historical'
        }
        return {
          team_id: anchor.teamId,
          team_name: null,
          start_date: period.start?.iso ?? null,
          end_date: period.end?.iso ?? null,
          classification,
          offset: anchor.offset,
          raw: {
            anchor_hex: hex(gameDb, anchor.offset, Math.min(anchor.end, anchor.offset + 80)),
            weekly_wage_raw: anchor.wage,
            period_status: period.status,
            start_date_raw: period.start,
            end_date_raw: period.end,
            current_window_candidate: Boolean(saveDate && period.start?.iso && period.end?.iso && isCurrentWindow(period.start.iso, period.end.iso, saveDate)),
          },
        } satisfies ContractRelationship
      })

      const teamIds = [...new Set([
        ...parsedObjects.map(object => object.team_id),
        ...relationshipDrafts.map(relation => relation.team_id),
      ])]
      const names = new Map<number, string | null>(resolveOfflineTeamNames(gameDb, teamIds).map(resolution => [resolution.team_id, resolution.status === 'confirmed' ? resolution.name : null] as [number, string | null]))
      for (const object of parsedObjects) object.team_name = names.get(object.team_id) ?? null
      for (const relation of relationshipDrafts) relation.team_name = names.get(relation.team_id) ?? null

      // A valid loan requires one and only one external current relation and
      // no unresolved external relation that could contradict it. Candidates
      // remain `unknown` unless this uniqueness check succeeds.
      const unknownExternal = current ? relationshipDrafts.filter(relation => relation.classification === 'unknown' && !isInternalTeam(relation.team_id, current.team_id, managedTeamIds)) : []
      const currentCandidates = unknownExternal.filter(relation => relation.raw.current_window_candidate === true)
      const unresolvedExternal = unknownExternal.filter(relation => relation.raw.current_window_candidate !== true)
      let loan: ContractLoan
      if (!current) {
        loan = { status: 'unresolved', from_team_id: null, from_team_name: null, to_team_id: null, to_team_name: null, start_date: null, end_date: null }
      } else if (currentCandidates.length === 1 && unresolvedExternal.length === 0) {
        const relation = currentCandidates[0]
        relation.classification = 'loan_current'
        loan = {
          status: 'current',
          from_team_id: current.team_id,
          from_team_name: current.team_name,
          to_team_id: relation.team_id,
          to_team_name: relation.team_name,
          start_date: relation.start_date,
          end_date: relation.end_date,
        }
      } else if (currentCandidates.length > 0 || unresolvedExternal.length > 0) {
        loan = { status: 'unresolved', from_team_id: current.team_id, from_team_name: current.team_name, to_team_id: null, to_team_name: null, start_date: null, end_date: null }
      } else {
        loan = { status: 'none', from_team_id: current.team_id, from_team_name: current.team_name, to_team_id: null, to_team_name: null, start_date: null, end_date: null }
      }

      if (current) current.secondary_relationships = relationshipDrafts
      player.current_contract = current ? publicObject(current) : null
      player.future_contracts = future.map(publicObject)
      player.contract_relationships = relationshipDrafts
      player.loan = loan
      player.contracts_status = current ? 'resolved_current_contract' : parsedObjects.length ? 'unresolved_current_contract' : 'unresolved'
      player.unresolved_contract_objects = unresolved.map(publicObject)
      player.market_value = null
      player.market_value_status = 'unresolved'
    }
  }
  return rawResult
}
