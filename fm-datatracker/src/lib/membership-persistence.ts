export const MEMBERSHIP_FACTS_SYNC_VERSION = 'e-mc-01b-v1' as const
export const MEMBERSHIP_FACTS_INPUT_SCHEMA = 'membership_facts_v1' as const
export const MEMBERSHIP_FACTS_INPUT_VERSION = 'e-mc-01-v1' as const

type UnknownRecord = Record<string, unknown>
export type MembershipFactStatus = 'confirmed' | 'unknown' | 'ambiguous' | 'unsupported'

export type MembershipPersistenceFact<T = unknown> = {
  status: MembershipFactStatus
  reason_code: string
  evidence_refs: string[]
  value: T | null
}

export type MembershipPersistenceOrganization = {
  organization_ref: string
  organization_team_ids: number[]
  record_offset: number
  evidence_team_id_raw: number | null
  evidence_team_name_raw: string | null
  evidence_team_name_status: 'confirmed' | 'unknown' | 'ambiguous'
}

export type MembershipPersistenceRow = {
  fm_player_id: string
  facts_schema: typeof MEMBERSHIP_FACTS_INPUT_SCHEMA
  facts_version: typeof MEMBERSHIP_FACTS_INPUT_VERSION
  sync_version: typeof MEMBERSHIP_FACTS_SYNC_VERSION
  checkpoint_date: string
  structural_team: MembershipPersistenceFact
  structural_squad: MembershipPersistenceFact
  organization_identity: MembershipPersistenceFact<MembershipPersistenceOrganization>
  team_level: MembershipPersistenceFact
  current_organization: MembershipPersistenceFact<MembershipPersistenceOrganization>
  owner_organization: MembershipPersistenceFact<MembershipPersistenceOrganization>
  is_loan: MembershipPersistenceFact<boolean>
  loan_from_organization: MembershipPersistenceFact<MembershipPersistenceOrganization>
  loan_to_organization: MembershipPersistenceFact<MembershipPersistenceOrganization>
  contract_facts: {
    current_standard_contract: MembershipPersistenceFact
    future_standard_contracts: MembershipPersistenceFact
    contract_expiry: MembershipPersistenceFact<string>
    joined_or_start_date: MembershipPersistenceFact<string>
    signed_or_effective_date: MembershipPersistenceFact<string>
  }
  raw_structural_membership: {
    team_id_raw: number | null
    team_name_raw: string | null
    roster_group_label_raw: string | null
    roster_group_index_raw: number | null
    roster_group_primary_raw: boolean | null
  }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function status(value: unknown): MembershipFactStatus | null {
  return value === 'confirmed' || value === 'unknown' || value === 'ambiguous' || value === 'unsupported' ? value : null
}

function evidenceRefs(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))] : []
}

function compactFact(value: unknown, compactValue: (raw: unknown) => unknown = raw => raw): MembershipPersistenceFact {
  const source = record(value)
  const sourceStatus = status(source?.status) ?? 'unsupported'
  const reasonCode = text(source?.reason_code) ?? 'invalid_membership_fact_shape'
  return {
    status: sourceStatus,
    reason_code: reasonCode,
    evidence_refs: evidenceRefs(source?.evidence_refs),
    value: sourceStatus === 'confirmed' && source ? compactValue(source.value) : null,
  }
}

function compactOrganization(value: unknown): MembershipPersistenceOrganization | null {
  const source = record(value)
  const organizationRef = text(source?.organization_ref)
  const rawTeams = Array.isArray(source?.organization_team_ids) ? source!.organization_team_ids : []
  const teams = [...new Set(rawTeams.map(integer).filter((item): item is number => item !== null && item > 0 && item < 100_000))].sort((a, b) => a - b)
  const recordOffset = integer(source?.record_offset)
  if (!organizationRef || !teams.length || recordOffset === null || recordOffset < 0) return null
  const evidenceNameStatus = source?.evidence_team_name_status === 'confirmed' || source?.evidence_team_name_status === 'ambiguous'
    ? source.evidence_team_name_status
    : 'unknown'
  const evidenceTeamId = integer(source?.evidence_team_id_raw)
  const evidenceName = text(source?.evidence_team_name_raw)
  return {
    organization_ref: organizationRef,
    organization_team_ids: teams,
    record_offset: recordOffset,
    evidence_team_id_raw: evidenceTeamId !== null && teams.includes(evidenceTeamId) ? evidenceTeamId : null,
    evidence_team_name_raw: evidenceNameStatus === 'confirmed' ? evidenceName : null,
    evidence_team_name_status: evidenceNameStatus === 'confirmed' && evidenceName && evidenceTeamId !== null && teams.includes(evidenceTeamId)
      ? 'confirmed'
      : evidenceNameStatus === 'ambiguous' ? 'ambiguous' : 'unknown',
  }
}

function compactOrganizationFact(value: unknown): MembershipPersistenceFact<MembershipPersistenceOrganization> {
  const fact = compactFact(value, compactOrganization)
  const organization = fact.value as MembershipPersistenceOrganization | null
  if (fact.status === 'confirmed' && !organization) {
    return { status: 'unsupported', reason_code: 'invalid_confirmed_organization_shape', evidence_refs: fact.evidence_refs, value: null }
  }
  return fact as MembershipPersistenceFact<MembershipPersistenceOrganization>
}

function compactBooleanFact(value: unknown): MembershipPersistenceFact<boolean> {
  const fact = compactFact(value, raw => typeof raw === 'boolean' ? raw : null)
  if (fact.status === 'confirmed' && typeof fact.value !== 'boolean') {
    return { status: 'unsupported', reason_code: 'invalid_confirmed_boolean_shape', evidence_refs: fact.evidence_refs, value: null }
  }
  return fact as MembershipPersistenceFact<boolean>
}


function compactTeamLevelFact(value: unknown): MembershipPersistenceFact<'first_team'> {
  const fact = compactFact(value, raw => raw === 'first_team' ? raw : null)
  if (fact.status === 'confirmed' && fact.value !== 'first_team') {
    return { status: 'unsupported', reason_code: 'team_level_not_supported_by_emc01b', evidence_refs: fact.evidence_refs, value: null }
  }
  return fact as MembershipPersistenceFact<'first_team'>
}

function compactTextFact(value: unknown): MembershipPersistenceFact<string> {
  const fact = compactFact(value, text)
  if (fact.status === 'confirmed' && typeof fact.value !== 'string') {
    return { status: 'unsupported', reason_code: 'invalid_confirmed_text_shape', evidence_refs: fact.evidence_refs, value: null }
  }
  return fact as MembershipPersistenceFact<string>
}

function compactStructuralRaw(value: unknown): MembershipPersistenceRow['raw_structural_membership'] {
  const source = record(value)
  return {
    team_id_raw: integer(source?.team_id_raw),
    team_name_raw: text(source?.team_name_raw),
    roster_group_label_raw: text(source?.roster_group_label_raw),
    roster_group_index_raw: integer(source?.roster_group_index_raw),
    roster_group_primary_raw: booleanOrNull(source?.roster_group_primary_raw),
  }
}

export function buildMembershipPersistenceRow(rowValue: unknown): MembershipPersistenceRow | null {
  const row = record(rowValue)
  const fmPlayerId = text(row?.fm_player_id)
  const envelope = record(row?.membership_facts_v1)
  if (!fmPlayerId || !envelope) return null
  if (envelope.schema !== MEMBERSHIP_FACTS_INPUT_SCHEMA || envelope.version !== MEMBERSHIP_FACTS_INPUT_VERSION) return null

  const provenance = record(envelope.provenance)
  const checkpointDate = text(provenance?.checkpoint_date)
  if (!checkpointDate || !/^\d{4}-\d{2}-\d{2}$/.test(checkpointDate)) return null
  const facts = record(envelope.resolved_membership_facts)
  if (!facts) return null

  return {
    fm_player_id: fmPlayerId,
    facts_schema: MEMBERSHIP_FACTS_INPUT_SCHEMA,
    facts_version: MEMBERSHIP_FACTS_INPUT_VERSION,
    sync_version: MEMBERSHIP_FACTS_SYNC_VERSION,
    checkpoint_date: checkpointDate,
    structural_team: compactFact(facts.structural_team),
    structural_squad: compactFact(facts.structural_squad),
    organization_identity: compactOrganizationFact(facts.organization_identity),
    team_level: compactTeamLevelFact(facts.team_level),
    current_organization: compactOrganizationFact(facts.current_organization),
    owner_organization: compactOrganizationFact(facts.owner_organization),
    is_loan: compactBooleanFact(facts.is_loan),
    loan_from_organization: compactOrganizationFact(facts.loan_from_organization),
    loan_to_organization: compactOrganizationFact(facts.loan_to_organization),
    contract_facts: {
      current_standard_contract: compactFact(facts.current_standard_contract),
      future_standard_contracts: compactFact(facts.future_standard_contracts),
      contract_expiry: compactTextFact(facts.contract_expiry),
      joined_or_start_date: compactTextFact(facts.joined_or_start_date),
      signed_or_effective_date: compactTextFact(facts.signed_or_effective_date),
    },
    raw_structural_membership: compactStructuralRaw(envelope.raw_structural_membership),
  }
}

export function buildMembershipPersistenceRows(rows: unknown[]): MembershipPersistenceRow[] {
  const byPlayer = new Map<string, MembershipPersistenceRow>()
  for (const row of rows) {
    const compact = buildMembershipPersistenceRow(row)
    if (!compact) continue
    const existing = byPlayer.get(compact.fm_player_id)
    if (existing) throw new Error(`E-MC-01B: duplicate FM player id ${compact.fm_player_id} in membership persistence payload.`)
    byPlayer.set(compact.fm_player_id, compact)
  }
  return [...byPlayer.values()]
}
