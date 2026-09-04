export const FACTUAL_MEMBERSHIP_AUTHORITY = 'membership_facts_v1' as const
export const FACTUAL_MEMBERSHIP_SYNC_VERSION = 'e-mc-01b-v1' as const
export const CSV_FACTUAL_MEMBERSHIP_AUTHORITY = 'csv_observation' as const
export const CSV_FACTUAL_CONTRACT = 'checkpoint-exact-v1' as const

type UnknownRecord = Record<string, unknown>
export type FactualResolutionStatus = 'confirmed' | 'unknown' | 'ambiguous' | 'conflicting' | 'unsupported'

export type FactualMembershipObservation = {
  id: string
  player_id: string
  observed_date: string
  current_club_id: string | null
  owner_club_id: string | null
  team_level: 'first_team' | 'reserve' | 'academy' | 'other' | 'unknown'
  squad_name: string | null
  is_loan: boolean | null
  loan_from_club_id: string | null
  loan_to_club_id: string | null
  provenance: UnknownRecord
}

export type FactualResolvedField<T> = {
  status: FactualResolutionStatus
  value: T | null
  reason_code: string
  evidence_refs: string[]
  observed_date: string | null
}

export type FactualMembershipState = {
  currentClubId: FactualResolvedField<string>
  ownerClubId: FactualResolvedField<string>
  teamLevel: FactualResolvedField<FactualMembershipObservation['team_level']>
  squadName: FactualResolvedField<string>
  isLoan: FactualResolvedField<boolean>
  loanFromClubId: FactualResolvedField<string>
  loanToClubId: FactualResolvedField<string>
}

export type FactualMembershipContext = {
  playerId: string
  checkpointDate: string
  current: FactualMembershipState
  lastConfirmed: FactualMembershipState
  currentObservationCount: number
  ignoredLegacyObservationCount: number
}

type FieldSpec<T> = {
  provenanceKey: string
  read: (row: FactualMembershipObservation) => T | null
  bindingRequired?: boolean
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function refs(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))] : []
}

function factMeta(row: FactualMembershipObservation, key: string) {
  return record(record(row.provenance.factual_fields)?.[key])
}

export function isAuthoritativeMembershipObservation(row: FactualMembershipObservation): boolean {
  if (row.provenance.legacy_phase0e_untrusted === true) return false
  const emc = row.provenance.membership_authority === FACTUAL_MEMBERSHIP_AUTHORITY
    && row.provenance.membership_facts_sync_version === FACTUAL_MEMBERSHIP_SYNC_VERSION
  const csv = row.provenance.membership_authority === CSV_FACTUAL_MEMBERSHIP_AUTHORITY
    && row.provenance.current_fact_contract === CSV_FACTUAL_CONTRACT
  return emc || csv
}

function unresolved<T>(status: Exclude<FactualResolutionStatus, 'confirmed'>, reason: string, evidenceRefs: string[] = [], observedDate: string | null = null): FactualResolvedField<T> {
  return { status, value: null, reason_code: reason, evidence_refs: evidenceRefs, observed_date: observedDate }
}

function resolveFieldAtDate<T>(rows: FactualMembershipObservation[], date: string, spec: FieldSpec<T>): FactualResolvedField<T> {
  const sameDate = rows.filter(row => row.observed_date === date && isAuthoritativeMembershipObservation(row))
  const confirmed = new Map<string, { value: T; refs: string[] }>()
  let sawAmbiguous = false
  let sawUnsupported = false
  const unresolvedRefs: string[] = []

  for (const row of sameDate) {
    const meta = factMeta(row, spec.provenanceKey)
    const status = meta?.status
    unresolvedRefs.push(...refs(meta?.evidence_refs))
    if (status === 'ambiguous') sawAmbiguous = true
    if (status === 'unsupported') sawUnsupported = true
    if (status !== 'confirmed') continue
    if (spec.bindingRequired && meta?.binding_status !== 'confirmed') {
      if (meta?.binding_status === 'conflicting') return unresolved('conflicting', 'conflicting_structural_binding_at_checkpoint', unresolvedRefs, date)
      if (meta?.binding_status === 'ambiguous') sawAmbiguous = true
      continue
    }
    const value = spec.read(row)
    if (value === null) continue
    const key = typeof value === 'object' ? JSON.stringify(value) : String(value)
    const existing = confirmed.get(key)
    const evidence = refs(meta?.evidence_refs)
    if (existing) existing.refs.push(...evidence)
    else confirmed.set(key, { value, refs: evidence })
  }

  if (confirmed.size === 1) {
    const [{ value, refs: evidence }] = [...confirmed.values()]
    return { status: 'confirmed', value, reason_code: 'confirmed_at_checkpoint', evidence_refs: [...new Set(evidence)], observed_date: date }
  }
  if (confirmed.size > 1) return unresolved('conflicting', 'conflicting_confirmed_observations_at_checkpoint', unresolvedRefs, date)
  if (sawAmbiguous) return unresolved('ambiguous', 'ambiguous_observation_at_checkpoint', unresolvedRefs, date)
  if (sawUnsupported) return unresolved('unsupported', 'unsupported_observation_at_checkpoint', unresolvedRefs, date)
  return unresolved('unknown', 'no_confirmed_observation_at_checkpoint', unresolvedRefs, date)
}

function lastConfirmedField<T>(rows: FactualMembershipObservation[], checkpointDate: string, spec: FieldSpec<T>): FactualResolvedField<T> {
  const dates = [...new Set(rows
    .filter(row => row.observed_date < checkpointDate && isAuthoritativeMembershipObservation(row))
    .map(row => row.observed_date))]
    .sort((a, b) => b.localeCompare(a))
  for (const date of dates) {
    const resolved = resolveFieldAtDate(rows, date, spec)
    if (resolved.status === 'confirmed') return { ...resolved, reason_code: 'last_confirmed_before_checkpoint' }
  }
  return unresolved('unknown', 'no_prior_confirmed_observation')
}

const CURRENT: FieldSpec<string> = { provenanceKey: 'current_organization', read: row => row.current_club_id, bindingRequired: true }
const OWNER: FieldSpec<string> = { provenanceKey: 'owner_organization', read: row => row.owner_club_id, bindingRequired: true }
const LOAN_FROM: FieldSpec<string> = { provenanceKey: 'loan_from_organization', read: row => row.loan_from_club_id, bindingRequired: true }
const LOAN_TO: FieldSpec<string> = { provenanceKey: 'loan_to_organization', read: row => row.loan_to_club_id, bindingRequired: true }
const LOAN: FieldSpec<boolean> = { provenanceKey: 'is_loan', read: row => row.is_loan }
const LEVEL: FieldSpec<FactualMembershipObservation['team_level']> = { provenanceKey: 'team_level', read: row => row.team_level === 'unknown' ? null : row.team_level }
const SQUAD: FieldSpec<string> = { provenanceKey: 'structural_squad', read: row => row.squad_name }

function stateAt(rows: FactualMembershipObservation[], date: string): FactualMembershipState {
  return {
    currentClubId: resolveFieldAtDate(rows, date, CURRENT),
    ownerClubId: resolveFieldAtDate(rows, date, OWNER),
    teamLevel: resolveFieldAtDate(rows, date, LEVEL),
    squadName: resolveFieldAtDate(rows, date, SQUAD),
    isLoan: resolveFieldAtDate(rows, date, LOAN),
    loanFromClubId: resolveFieldAtDate(rows, date, LOAN_FROM),
    loanToClubId: resolveFieldAtDate(rows, date, LOAN_TO),
  }
}

function lastState(rows: FactualMembershipObservation[], date: string): FactualMembershipState {
  return {
    currentClubId: lastConfirmedField(rows, date, CURRENT),
    ownerClubId: lastConfirmedField(rows, date, OWNER),
    teamLevel: lastConfirmedField(rows, date, LEVEL),
    squadName: lastConfirmedField(rows, date, SQUAD),
    isLoan: lastConfirmedField(rows, date, LOAN),
    loanFromClubId: lastConfirmedField(rows, date, LOAN_FROM),
    loanToClubId: lastConfirmedField(rows, date, LOAN_TO),
  }
}

/**
 * Resolves the factual observation exactly at checkpointDate. Older rows are
 * exposed only through lastConfirmed and never fill a missing current value.
 */
export function resolveFactualMembershipContext(
  rows: FactualMembershipObservation[],
  playerId: string,
  checkpointDate: string,
): FactualMembershipContext {
  const playerRows = rows.filter(row => row.player_id === playerId && row.observed_date <= checkpointDate)
  const currentRows = playerRows.filter(row => row.observed_date === checkpointDate)
  return {
    playerId,
    checkpointDate,
    current: stateAt(playerRows, checkpointDate),
    lastConfirmed: lastState(playerRows, checkpointDate),
    currentObservationCount: currentRows.filter(isAuthoritativeMembershipObservation).length,
    ignoredLegacyObservationCount: currentRows.filter(row => !isAuthoritativeMembershipObservation(row)).length,
  }
}
