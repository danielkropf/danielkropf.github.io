import type { PlayerMembershipWithClubs, TeamLevel } from '../types/domain'

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

function membershipSignature(row: PlayerMembershipWithClubs) {
  return [
    row.current_club_id,
    row.owner_club_id,
    row.team_level,
    row.squad_name?.trim() || null,
    row.is_loan,
    row.loan_from_club_id,
    row.loan_to_club_id,
  ].join('|')
}

/**
 * Resolves only a membership explicitly linked to the current snapshot. A
 * duplicated observation is accepted only when every factual field agrees;
 * conflicting rows fail closed instead of choosing by insertion order.
 */
export function resolveCurrentSnapshotMembership(
  rows: PlayerMembershipWithClubs[],
  snapshotId: string | null | undefined,
): PlanningMembershipResolution {
  if (!snapshotId) return { membership: null, diagnostic: 'Snapshot atual sem identidade persistida.' }
  const matches = rows.filter(row => row.source_snapshot_id === snapshotId)
  if (!matches.length) return { membership: null, diagnostic: 'Nenhum membership ligado ao snapshot atual.' }
  const signatures = new Set(matches.map(membershipSignature))
  if (signatures.size > 1) return { membership: null, diagnostic: 'Memberships conflitantes apontam para o snapshot atual.' }
  return { membership: [...matches].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0], diagnostic: null }
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
    if (membership.is_loan === true) {
      if (ownerId && ownerId !== selectedClubId) {
        return {
          kind: 'loaned_in',
          membership,
          label: 'Emprestado ao clube',
          detail: `${factualSquadLabel(membership)} · detentor: ${ownerName}`,
          diagnostic: null,
        }
      }
      return { kind: 'unknown', membership, label: 'Empréstimo incompleto', detail: 'O jogador está no clube, mas o detentor do passe não foi confirmado.', diagnostic: 'is_loan=true sem owner_club_id externo confirmado.' }
    }
    if (membership.is_loan === false) {
      return { kind: 'current', membership, label: factualSquadLabel(membership), detail: 'Vínculo factual atual com o clube selecionado.', diagnostic: null }
    }
    return { kind: 'unknown', membership, label: 'Situação de empréstimo desconhecida', detail: `${factualSquadLabel(membership)} · clube atual confirmado, empréstimo não confirmado.`, diagnostic: 'current_club_id conhecido com is_loan=null.' }
  }

  if (ownerId === selectedClubId && currentId && currentId !== selectedClubId && membership.is_loan === true) {
    return { kind: 'loaned_out', membership, label: 'Emprestado pelo clube', detail: `Atualmente em ${currentName}.`, diagnostic: null }
  }

  if (currentId && currentId !== selectedClubId) {
    return { kind: 'other_club', membership, label: 'Outro clube', detail: `Atualmente em ${currentName}.`, diagnostic: null }
  }

  return {
    kind: 'unknown',
    membership,
    label: 'Vínculo desconhecido',
    detail: 'Os campos atuais não permitem determinar a relação com o clube selecionado.',
    diagnostic: resolution?.diagnostic ?? 'Combinação factual incompleta para o clube selecionado.',
  }
}

export function planningMembershipOrder(kind: PlanningMembershipFactKind) {
  return ({ current: 0, loaned_in: 1, loaned_out: 2, other_club: 3, unknown: 4 } as const)[kind]
}
