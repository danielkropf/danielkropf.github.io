import {
  basePositionScores,
  generalScoreForSnapshot,
  type BasePositionScoreResult,
  type GeneralScoreSnapshot,
} from './base-position-score'
import type { PlayerMembershipWithClubs, Season, TeamLevel } from '../types/domain'

type EvolutionAttribute = { attribute_key: string; value: number | null }

export type EvolutionSnapshot = GeneralScoreSnapshot & {
  id: string
  snapshot_date: string
  age?: number | null
  club?: string | null
  squad?: string | null
  player_attributes: EvolutionAttribute[]
}

export type EvolutionNormalizedContext = {
  membershipId: string
  seasonId: string | null
  seasonLabel: string | null
  currentClub: string | null
  ownerClub: string | null
  squad: string | null
  teamLevel: TeamLevel
  isLoan: boolean | null
  loanFromClub: string | null
  loanToClub: string | null
}

export type EvolutionCheckpoint = {
  snapshotId: string
  snapshotDate: string
  age: number | null
  club: string | null
  squad: string | null
  generalScore: number | null
  generalPosition: string | null
  scoreKey: string | null
  basePositionScores: BasePositionScoreResult[]
  normalizedContext: EvolutionNormalizedContext | null
  contextDiagnostic: string | null
}

export type EvolutionDelta = {
  fromSnapshotId: string
  toSnapshotId: string
  from: number
  to: number
  delta: number
}

export type AttributeChange = {
  attributeKey: string
  from: number
  to: number
  delta: number
}

export type BasePositionScoreChange = {
  scoreKey: string
  family: BasePositionScoreResult['family']
  fromPosition: string
  toPosition: string
  from: number
  to: number
  delta: number
}

export type EvolutionComparison = {
  fromSnapshotId: string
  toSnapshotId: string
  generalScoreDelta: EvolutionDelta | null
  basePositionScoreChanges: BasePositionScoreChange[]
  attributeChanges: AttributeChange[]
  gains: AttributeChange[]
  losses: AttributeChange[]
}

export type ObservedContextChange = {
  fromSnapshotId: string
  toSnapshotId: string
  snapshotDate: string
  club: { from: string; to: string } | null
  squad: { from: string; to: string } | null
}

export type PlayerEvolution = {
  checkpoints: EvolutionCheckpoint[]
  periodGeneralScoreDelta: EvolutionDelta | null
  gains: AttributeChange[]
  losses: AttributeChange[]
  contextChanges: ObservedContextChange[]
}

function finiteAttributeMap(snapshot: EvolutionSnapshot) {
  const values = new Map<string, number>()
  for (const attribute of snapshot.player_attributes) {
    if (typeof attribute.value === 'number' && Number.isFinite(attribute.value)) values.set(attribute.attribute_key, attribute.value)
  }
  return values
}

export function sortEvolutionSnapshots<T extends EvolutionSnapshot>(snapshots: T[]): T[] {
  return snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((a, b) => a.snapshot.snapshot_date.localeCompare(b.snapshot.snapshot_date) || a.index - b.index)
    .map(item => item.snapshot)
}

export function attributeDelta(from: EvolutionSnapshot, to: EvolutionSnapshot, attributeKey: string): AttributeChange | null {
  const fromValue = finiteAttributeMap(from).get(attributeKey)
  const toValue = finiteAttributeMap(to).get(attributeKey)
  if (fromValue === undefined || toValue === undefined) return null
  return { attributeKey, from: fromValue, to: toValue, delta: toValue - fromValue }
}

export function rankAttributeChanges(from: EvolutionSnapshot, to: EvolutionSnapshot): AttributeChange[] {
  const fromValues = finiteAttributeMap(from)
  const toValues = finiteAttributeMap(to)
  const changes: AttributeChange[] = []
  for (const [attributeKey, fromValue] of fromValues) {
    const toValue = toValues.get(attributeKey)
    if (toValue === undefined) continue
    changes.push({ attributeKey, from: fromValue, to: toValue, delta: toValue - fromValue })
  }
  return changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.delta - a.delta || a.attributeKey.localeCompare(b.attributeKey))
}

export function generalScoreDelta(from: EvolutionSnapshot, to: EvolutionSnapshot): EvolutionDelta | null {
  const fromScore = generalScoreForSnapshot(from)?.score ?? null
  const toScore = generalScoreForSnapshot(to)?.score ?? null
  if (fromScore === null || toScore === null) return null
  return { fromSnapshotId: from.id, toSnapshotId: to.id, from: fromScore, to: toScore, delta: toScore - fromScore }
}

function baseScoreIdentity(score: BasePositionScoreResult) {
  return `${score.scoreKey}:${score.family}`
}

export function basePositionScoreChanges(from: EvolutionSnapshot, to: EvolutionSnapshot): BasePositionScoreChange[] {
  const fromScores = new Map(basePositionScores(from).map(score => [baseScoreIdentity(score), score]))
  const changes: BasePositionScoreChange[] = []
  for (const toScore of basePositionScores(to)) {
    const fromScore = fromScores.get(baseScoreIdentity(toScore))
    if (!fromScore) continue
    changes.push({
      scoreKey: toScore.scoreKey,
      family: toScore.family,
      fromPosition: fromScore.position,
      toPosition: toScore.position,
      from: fromScore.score,
      to: toScore.score,
      delta: toScore.score - fromScore.score,
    })
  }
  return changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)
    || b.delta - a.delta
    || a.scoreKey.localeCompare(b.scoreKey)
    || a.family.localeCompare(b.family))
}

export function compareEvolutionSnapshots(from: EvolutionSnapshot, to: EvolutionSnapshot): EvolutionComparison {
  const attributeChanges = rankAttributeChanges(from, to)
  return {
    fromSnapshotId: from.id,
    toSnapshotId: to.id,
    generalScoreDelta: generalScoreDelta(from, to),
    basePositionScoreChanges: basePositionScoreChanges(from, to),
    attributeChanges,
    gains: attributeChanges.filter(change => change.delta > 0),
    losses: attributeChanges.filter(change => change.delta < 0),
  }
}

function knownContextChange(from: string | null | undefined, to: string | null | undefined) {
  const before = from?.trim() || null
  const after = to?.trim() || null
  return before && after && before !== after ? { from: before, to: after } : null
}

export function observedContextChanges(snapshots: EvolutionSnapshot[]): ObservedContextChange[] {
  const ordered = sortEvolutionSnapshots(snapshots)
  const changes: ObservedContextChange[] = []
  for (let index = 1; index < ordered.length; index += 1) {
    const from = ordered[index - 1]
    const to = ordered[index]
    const club = knownContextChange(from.club, to.club)
    const squad = knownContextChange(from.squad, to.squad)
    if (!club && !squad) continue
    changes.push({ fromSnapshotId: from.id, toSnapshotId: to.id, snapshotDate: to.snapshot_date, club, squad })
  }
  return changes
}

export function normalizedContextForSnapshot(
  snapshot: EvolutionSnapshot,
  memberships: PlayerMembershipWithClubs[],
  seasons: Season[],
): { context: EvolutionNormalizedContext | null; diagnostic: string | null } {
  const matches = memberships.filter(membership => membership.source_snapshot_id === snapshot.id)
  if (!matches.length) return { context: null, diagnostic: null }
  if (matches.length > 1) {
    return {
      context: null,
      diagnostic: `${matches.length} memberships normalizados apontam para o snapshot ${snapshot.id}; o contexto não foi escolhido automaticamente.`,
    }
  }

  const membership = matches[0]
  let seasonLabel: string | null = null
  let diagnostic: string | null = null
  if (membership.season_id) {
    const seasonMatches = seasons.filter(season => season.id === membership.season_id)
    if (seasonMatches.length === 1) seasonLabel = seasonMatches[0].label
    else diagnostic = seasonMatches.length
      ? `Mais de uma Season corresponde ao season_id ${membership.season_id}.`
      : `A Season ${membership.season_id} vinculada ao membership não foi carregada.`
  }

  return {
    context: {
      membershipId: membership.id,
      seasonId: membership.season_id,
      seasonLabel,
      currentClub: membership.currentClub?.name ?? null,
      ownerClub: membership.ownerClub?.name ?? null,
      squad: membership.squad_name?.trim() || null,
      teamLevel: membership.team_level,
      isLoan: membership.is_loan,
      loanFromClub: membership.loanFromClub?.name ?? null,
      loanToClub: membership.loanToClub?.name ?? null,
    },
    diagnostic,
  }
}

function checkpoint(
  snapshot: EvolutionSnapshot,
  memberships: PlayerMembershipWithClubs[],
  seasons: Season[],
): EvolutionCheckpoint {
  const general = generalScoreForSnapshot(snapshot)
  const normalized = normalizedContextForSnapshot(snapshot, memberships, seasons)
  const bases = basePositionScores(snapshot).sort((a, b) => b.score - a.score
    || a.scoreKey.localeCompare(b.scoreKey)
    || a.family.localeCompare(b.family))
  return {
    snapshotId: snapshot.id,
    snapshotDate: snapshot.snapshot_date,
    age: snapshot.age ?? null,
    club: snapshot.club?.trim() || null,
    squad: snapshot.squad?.trim() || null,
    generalScore: general?.score ?? null,
    generalPosition: general?.position ?? null,
    scoreKey: general?.scoreKey ?? null,
    basePositionScores: bases,
    normalizedContext: normalized.context,
    contextDiagnostic: normalized.diagnostic,
  }
}

export function buildPlayerEvolution(
  snapshots: EvolutionSnapshot[],
  memberships: PlayerMembershipWithClubs[] = [],
  seasons: Season[] = [],
): PlayerEvolution {
  const ordered = sortEvolutionSnapshots(snapshots)
  const first = ordered[0]
  const last = ordered.at(-1)
  const changes = first && last && first.id !== last.id ? rankAttributeChanges(first, last) : []
  return {
    checkpoints: ordered.map(snapshot => checkpoint(snapshot, memberships, seasons)),
    periodGeneralScoreDelta: first && last && first.id !== last.id ? generalScoreDelta(first, last) : null,
    gains: changes.filter(change => change.delta > 0),
    losses: changes.filter(change => change.delta < 0),
    contextChanges: observedContextChanges(ordered),
  }
}
