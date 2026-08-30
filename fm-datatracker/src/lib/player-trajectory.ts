import type {
  PlayerMembershipWithClubs,
  ProvenanceSourceKind,
  SaveEvent,
  SaveEventType,
  TeamLevel,
} from '../types/domain'

export type TrajectoryContext = {
  currentClubId: string | null
  currentClub: string | null
  ownerClubId: string | null
  ownerClub: string | null
  squad: string | null
  teamLevel: TeamLevel
  isLoan: boolean | null
  loanFromClubId: string | null
  loanFromClub: string | null
  loanToClubId: string | null
  loanToClub: string | null
}

export type TrajectoryObservation = {
  id: string
  membershipId: string
  snapshotId: string
  date: string
  sourceKind: ProvenanceSourceKind
  context: TrajectoryContext
}

export type TrajectoryChangedField =
  | 'current_club'
  | 'owner_club'
  | 'squad'
  | 'team_level'
  | 'loan_status'
  | 'loan_from_club'
  | 'loan_to_club'

export type TrajectoryFieldChange = {
  field: TrajectoryChangedField
  label: string
  from: string
  to: string
}

export type DerivedTrajectoryChange = {
  id: string
  kind: 'observed_context_change'
  date: string
  fromObservationId: string
  toObservationId: string
  changes: TrajectoryFieldChange[]
  provenance: {
    sourceMembershipIds: [string, string]
    sourceSnapshotIds: [string, string]
    rule: 'known-value-difference-v1'
  }
}

export type TrajectoryTimelineItem =
  | { id: string; kind: 'derived_change'; date: string; change: DerivedTrajectoryChange }
  | { id: string; kind: 'explicit_event'; date: string; event: SaveEvent }

export type PlayerTrajectory = {
  observations: TrajectoryObservation[]
  changes: DerivedTrajectoryChange[]
  explicitEvents: SaveEvent[]
  timeline: TrajectoryTimelineItem[]
  ignoredMembershipCount: number
  ambiguousSnapshotCount: number
}

const FIELD_LABELS: Record<TrajectoryChangedField, string> = {
  current_club: 'Clube atual',
  owner_club: 'Clube detentor',
  squad: 'Equipe/elenco',
  team_level: 'Nível da equipe',
  loan_status: 'Status de empréstimo',
  loan_from_club: 'Clube de origem do empréstimo',
  loan_to_club: 'Clube de destino do empréstimo',
}

export const SAVE_EVENT_LABELS: Record<SaveEventType, string> = {
  player_first_seen: 'Primeiro registro do jogador',
  player_inactive: 'Jogador marcado como inativo',
  membership_changed: 'Mudança de vínculo registrada',
  intake_entry: 'Entrada de intake registrada',
  contract_changed: 'Mudança contratual registrada',
  planning_status_changed: 'Mudança de planejamento registrada',
  manual_fact: 'Fato manual registrado',
  transfer: 'Transferência registrada',
  loan: 'Empréstimo registrado',
}

function normalizedText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function nonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

function observationFromMembership(membership: PlayerMembershipWithClubs): TrajectoryObservation | null {
  if (!membership.source_snapshot_id) return null
  return {
    id: `observation:${membership.id}`,
    membershipId: membership.id,
    snapshotId: membership.source_snapshot_id,
    date: membership.observed_date,
    sourceKind: membership.source_kind,
    context: {
      currentClubId: membership.current_club_id,
      currentClub: membership.currentClub?.name ?? null,
      ownerClubId: membership.owner_club_id,
      ownerClub: membership.ownerClub?.name ?? null,
      squad: nonEmpty(membership.squad_name),
      teamLevel: membership.team_level,
      isLoan: membership.is_loan,
      loanFromClubId: membership.loan_from_club_id,
      loanFromClub: membership.loanFromClub?.name ?? null,
      loanToClubId: membership.loan_to_club_id,
      loanToClub: membership.loanToClub?.name ?? null,
    },
  }
}

function stableMembershipOrder(a: PlayerMembershipWithClubs, b: PlayerMembershipWithClubs) {
  return a.observed_date.localeCompare(b.observed_date)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id)
}

export function safeTrajectoryObservations(memberships: PlayerMembershipWithClubs[]) {
  const linked = memberships.filter(membership => Boolean(membership.source_snapshot_id))
  const bySnapshot = new Map<string, PlayerMembershipWithClubs[]>()
  for (const membership of linked) {
    const snapshotId = membership.source_snapshot_id!
    const rows = bySnapshot.get(snapshotId) ?? []
    rows.push(membership)
    bySnapshot.set(snapshotId, rows)
  }

  const observations: TrajectoryObservation[] = []
  let ambiguousSnapshotCount = 0
  for (const rows of bySnapshot.values()) {
    if (rows.length !== 1) {
      ambiguousSnapshotCount += 1
      continue
    }
    const observation = observationFromMembership(rows[0])
    if (observation) observations.push(observation)
  }

  observations.sort((a, b) => a.date.localeCompare(b.date) || a.membershipId.localeCompare(b.membershipId))
  return {
    observations,
    ignoredMembershipCount: memberships.length - observations.length,
    ambiguousSnapshotCount,
  }
}

function textChange(
  field: TrajectoryChangedField,
  from: string | null,
  to: string | null,
  compareNormalized = false,
): TrajectoryFieldChange | null {
  if (!from || !to) return null
  const equal = compareNormalized ? normalizedText(from) === normalizedText(to) : from === to
  return equal ? null : { field, label: FIELD_LABELS[field], from, to }
}

function idBackedChange(
  field: TrajectoryChangedField,
  fromId: string | null,
  toId: string | null,
  fromLabel: string | null,
  toLabel: string | null,
): TrajectoryFieldChange | null {
  if (!fromId || !toId || !fromLabel || !toLabel || fromId === toId) return null
  return { field, label: FIELD_LABELS[field], from: fromLabel, to: toLabel }
}

function teamLevelLabel(value: TeamLevel) {
  return ({
    first_team: 'Principal',
    reserve: 'Reserva/B',
    academy: 'Base',
    other: 'Outro',
    unknown: 'Não informado',
  } as const)[value]
}

function knownContextChanges(from: TrajectoryObservation, to: TrajectoryObservation) {
  const changes: Array<TrajectoryFieldChange | null> = [
    idBackedChange('current_club', from.context.currentClubId, to.context.currentClubId, from.context.currentClub, to.context.currentClub),
    idBackedChange('owner_club', from.context.ownerClubId, to.context.ownerClubId, from.context.ownerClub, to.context.ownerClub),
    textChange('squad', from.context.squad, to.context.squad, true),
    from.context.teamLevel !== 'unknown' && to.context.teamLevel !== 'unknown' && from.context.teamLevel !== to.context.teamLevel
      ? { field: 'team_level', label: FIELD_LABELS.team_level, from: teamLevelLabel(from.context.teamLevel), to: teamLevelLabel(to.context.teamLevel) }
      : null,
    typeof from.context.isLoan === 'boolean' && typeof to.context.isLoan === 'boolean' && from.context.isLoan !== to.context.isLoan
      ? { field: 'loan_status', label: FIELD_LABELS.loan_status, from: from.context.isLoan ? 'Empréstimo observado' : 'Sem empréstimo observado', to: to.context.isLoan ? 'Empréstimo observado' : 'Sem empréstimo observado' }
      : null,
    idBackedChange('loan_from_club', from.context.loanFromClubId, to.context.loanFromClubId, from.context.loanFromClub, to.context.loanFromClub),
    idBackedChange('loan_to_club', from.context.loanToClubId, to.context.loanToClubId, from.context.loanToClub, to.context.loanToClub),
  ]
  return changes.filter((change): change is TrajectoryFieldChange => Boolean(change))
}

export function deriveObservedContextChanges(observations: TrajectoryObservation[]): DerivedTrajectoryChange[] {
  const changes: DerivedTrajectoryChange[] = []
  for (let index = 1; index < observations.length; index += 1) {
    const from = observations[index - 1]
    const to = observations[index]
    const fields = knownContextChanges(from, to)
    if (!fields.length) continue
    changes.push({
      id: `observed-context-change:${from.membershipId}:${to.membershipId}`,
      kind: 'observed_context_change',
      date: to.date,
      fromObservationId: from.id,
      toObservationId: to.id,
      changes: fields,
      provenance: {
        sourceMembershipIds: [from.membershipId, to.membershipId],
        sourceSnapshotIds: [from.snapshotId, to.snapshotId],
        rule: 'known-value-difference-v1',
      },
    })
  }
  return changes
}

function stableEventOrder(a: SaveEvent, b: SaveEvent) {
  return a.event_date.localeCompare(b.event_date)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id)
}

export function buildPlayerTrajectory(
  memberships: PlayerMembershipWithClubs[],
  events: SaveEvent[] = [],
): PlayerTrajectory {
  const safe = safeTrajectoryObservations([...memberships].sort(stableMembershipOrder))
  const changes = deriveObservedContextChanges(safe.observations)
  const explicitEvents = [...events].sort(stableEventOrder)
  const timeline: TrajectoryTimelineItem[] = [
    ...changes.map(change => ({ id: change.id, kind: 'derived_change' as const, date: change.date, change })),
    ...explicitEvents.map(event => ({ id: `event:${event.id}`, kind: 'explicit_event' as const, date: event.event_date, event })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'explicit_event' ? -1 : 1))

  return {
    observations: safe.observations,
    changes,
    explicitEvents,
    timeline,
    ignoredMembershipCount: safe.ignoredMembershipCount,
    ambiguousSnapshotCount: safe.ambiguousSnapshotCount,
  }
}

export function explicitEventLabel(event: SaveEvent) {
  return SAVE_EVENT_LABELS[event.event_type] ?? 'Evento registrado'
}
