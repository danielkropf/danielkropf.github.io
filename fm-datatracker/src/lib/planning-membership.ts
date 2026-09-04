import type { PlayerMembershipWithClubs, TeamLevel } from '../types/domain'
import {
  isAuthoritativeMembershipObservation,
  resolveFactualMembershipContext,
  type FactualMembershipObservation,
  type FactualResolvedField,
} from './factual-membership'

export type PlanningMembershipFactKind =
  | 'current'
  | 'loaned_in'
  | 'loaned_out'
  | 'other_club'
  | 'unknown'

export type PlanningMembershipFact = {
  kind: PlanningMembershipFactKind
  membership: PlayerMembershipWithClubs | null
  label: string
  detail: string
  diagnostic: string | null
}

export type PlanningMembershipResolution = {
  membership: PlayerMembershipWithClubs | null
  diagnostic: string | null
}

const teamLevelLabels: Record<TeamLevel, string> = {
  first_team: 'Principal',
  reserve: 'Reserva/B',
  academy: 'Base',
  other: 'Outro elenco',
  unknown: 'Elenco não informado',
}

function sourceIds(snapshotId: string | string[] | null | undefined) {
  const raw = Array.isArray(snapshotId) ? snapshotId : snapshotId ? [snapshotId] : []
  const expanded = raw.flatMap(value => {
    if (!value.startsWith('current:')) return [value]
    const parts = value.split(':')
    return parts.length >= 3 ? parts.slice(2).join(':').split('+').filter(Boolean) : [value]
  })
  return [...new Set(expanded.filter(Boolean))].sort()
}

function confirmed<T>(field: FactualResolvedField<T>): T | null {
  return field.status === 'confirmed' ? field.value : null
}

function clubFor(
  rows: PlayerMembershipWithClubs[],
  id: string | null,
  idField: 'current_club_id' | 'owner_club_id' | 'loan_from_club_id' | 'loan_to_club_id',
  clubField: 'currentClub' | 'ownerClub' | 'loanFromClub' | 'loanToClub',
) {
  if (!id) return null
  return rows.find(row => row[idField] === id)?.[clubField] ?? null
}

function statusDiagnostic(context: ReturnType<typeof resolveFactualMembershipContext>) {
  const fields = Object.entries(context.current)
    .filter(([, field]) => field.status === 'ambiguous' || field.status === 'conflicting' || field.status === 'unsupported')
    .map(([key, field]) => `${key}:${field.status}`)
  return fields.length ? `Campos factuais sem resolução no checkpoint: ${fields.join(', ')}.` : null
}

/**
 * Resolves all authoritative membership observations linked to the exact current
 * snapshot set. Same-date imports add evidence; no created_at/upload order wins.
 * Each factual field is reconciled independently and conflicting fields become
 * unknown without erasing independent confirmed fields.
 */
export function resolveCurrentSnapshotMembership(
  rows: PlayerMembershipWithClubs[],
  snapshotId: string | string[] | null | undefined,
): PlanningMembershipResolution {
  const ids = sourceIds(snapshotId)
  if (!ids.length) return { membership: null, diagnostic: 'Snapshot atual sem identidade persistida.' }
  const idSet = new Set(ids)
  const matches = rows.filter(row => row.source_snapshot_id && idSet.has(row.source_snapshot_id))
  if (!matches.length) return { membership: null, diagnostic: 'Nenhum membership ligado ao checkpoint atual.' }

  const authoritative = matches.filter(row => isAuthoritativeMembershipObservation(row as unknown as FactualMembershipObservation))
  if (!authoritative.length) return { membership: null, diagnostic: 'Os memberships ligados ao checkpoint não possuem autoridade factual compatível.' }
  const dates = [...new Set(authoritative.map(row => row.observed_date))]
  const playerIds = [...new Set(authoritative.map(row => row.player_id))]
  if (dates.length !== 1 || playerIds.length !== 1) return { membership: null, diagnostic: 'Memberships do checkpoint apontam para datas ou jogadores incompatíveis.' }

  const checkpointDate = dates[0]
  const playerId = playerIds[0]
  const context = resolveFactualMembershipContext(authoritative as unknown as FactualMembershipObservation[], playerId, checkpointDate)
  const currentId = confirmed(context.current.currentClubId)
  const ownerId = confirmed(context.current.ownerClubId)
  const loanFromId = confirmed(context.current.loanFromClubId)
  const loanToId = confirmed(context.current.loanToClubId)
  const base = authoritative[0]
  const importIds = [...new Set(authoritative.map(row => row.source_import_id).filter((value): value is string => Boolean(value)))]
  const createdAt = [...authoritative].map(row => row.created_at).sort().at(-1) ?? base.created_at
  const membership: PlayerMembershipWithClubs = {
    ...base,
    id: `current:${checkpointDate}:${ids.join('+')}`,
    observed_date: checkpointDate,
    current_club_id: currentId,
    owner_club_id: ownerId,
    team_level: confirmed(context.current.teamLevel) ?? 'unknown',
    squad_name: confirmed(context.current.squadName),
    is_loan: confirmed(context.current.isLoan),
    loan_from_club_id: loanFromId,
    loan_to_club_id: loanToId,
    source_snapshot_id: ids.length === 1 ? ids[0] : null,
    source_import_id: importIds.length === 1 ? importIds[0] : null,
    source_kind: 'derived',
    provenance: {
      membership_authority: 'checkpoint_fieldwise_reconciliation',
      checkpoint_date: checkpointDate,
      source_snapshot_ids: ids,
      factual_statuses: Object.fromEntries(Object.entries(context.current).map(([key, field]) => [key, field.status])),
    },
    created_at: createdAt,
    currentClub: clubFor(authoritative, currentId, 'current_club_id', 'currentClub'),
    ownerClub: clubFor(authoritative, ownerId, 'owner_club_id', 'ownerClub'),
    loanFromClub: clubFor(authoritative, loanFromId, 'loan_from_club_id', 'loanFromClub'),
    loanToClub: clubFor(authoritative, loanToId, 'loan_to_club_id', 'loanToClub'),
  }
  return { membership, diagnostic: statusDiagnostic(context) }
}

function factualSquadLabel(membership: PlayerMembershipWithClubs) {
  return membership.squad_name?.trim() || teamLevelLabels[membership.team_level]
}

export function classifyPlanningMembership(
  resolution: PlanningMembershipResolution | undefined,
  selectedClubId: string | null,
): PlanningMembershipFact {
  const membership = resolution?.membership ?? null
  if (!selectedClubId) return { kind: 'unknown', membership, label: 'Clube não selecionado', detail: 'Selecione um clube para contextualizar o vínculo atual.', diagnostic: resolution?.diagnostic ?? null }
  if (!membership) return { kind: 'unknown', membership: null, label: 'Vínculo desconhecido', detail: resolution?.diagnostic ?? 'Sem membership factual seguro.', diagnostic: resolution?.diagnostic ?? 'Sem membership factual seguro.' }

  const currentId = membership.current_club_id
  const ownerId = membership.owner_club_id
  const currentName = membership.currentClub?.name ?? 'clube atual conhecido'
  const ownerName = membership.ownerClub?.name ?? 'clube detentor conhecido'

  if (currentId === selectedClubId) {
    if (membership.is_loan === true && ownerId && ownerId !== selectedClubId) {
      return {
        kind: 'loaned_in',
        membership,
        label: 'Emprestado ao clube',
        detail: `${factualSquadLabel(membership)} · detentor: ${ownerName}`,
        diagnostic: resolution?.diagnostic ?? null,
      }
    }
    if (membership.is_loan === true) {
      return { kind: 'current', membership, label: factualSquadLabel(membership), detail: 'Clube atual confirmado; o empréstimo está confirmado, mas o detentor não foi resolvido.', diagnostic: resolution?.diagnostic ?? 'is_loan=true sem owner_club_id externo confirmado.' }
    }
    if (membership.is_loan === false) {
      return { kind: 'current', membership, label: factualSquadLabel(membership), detail: 'Vínculo factual atual com o clube selecionado.', diagnostic: resolution?.diagnostic ?? null }
    }
    return { kind: 'current', membership, label: factualSquadLabel(membership), detail: 'Clube atual confirmado; situação de empréstimo não confirmada.', diagnostic: resolution?.diagnostic ?? 'current_club_id conhecido com is_loan=null.' }
  }

  if (ownerId === selectedClubId && currentId && currentId !== selectedClubId && membership.is_loan === true) {
    return { kind: 'loaned_out', membership, label: 'Emprestado pelo clube', detail: `Atualmente em ${currentName}.`, diagnostic: resolution?.diagnostic ?? null }
  }

  if (currentId && currentId !== selectedClubId) {
    return { kind: 'other_club', membership, label: 'Outro clube', detail: `Atualmente em ${currentName}.`, diagnostic: resolution?.diagnostic ?? null }
  }

  return {
    kind: 'unknown',
    membership,
    label: ownerId === selectedClubId ? 'Pertence ao clube; localização atual desconhecida' : 'Vínculo desconhecido',
    detail: ownerId === selectedClubId ? 'O detentor foi confirmado, mas o clube atual não foi confirmado neste checkpoint.' : 'Os campos atuais não permitem determinar a relação com o clube selecionado.',
    diagnostic: resolution?.diagnostic ?? 'Combinação factual incompleta para o clube selecionado.',
  }
}

export function planningMembershipOrder(kind: PlanningMembershipFactKind) {
  return ({ current: 0, loaned_in: 1, loaned_out: 2, other_club: 3, unknown: 4 } as const)[kind]
}
