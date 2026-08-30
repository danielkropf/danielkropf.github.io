import { generalScoreForSnapshot, type GeneralScoreSnapshot } from './base-position-score'

type EvolutionAttribute = { attribute_key: string; value: number | null }

export type EvolutionSnapshot = GeneralScoreSnapshot & {
  id: string
  snapshot_date: string
  age?: number | null
  club?: string | null
  squad?: string | null
  player_attributes: EvolutionAttribute[]
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

function checkpoint(snapshot: EvolutionSnapshot): EvolutionCheckpoint {
  const general = generalScoreForSnapshot(snapshot)
  return {
    snapshotId: snapshot.id,
    snapshotDate: snapshot.snapshot_date,
    age: snapshot.age ?? null,
    club: snapshot.club?.trim() || null,
    squad: snapshot.squad?.trim() || null,
    generalScore: general?.score ?? null,
    generalPosition: general?.position ?? null,
    scoreKey: general?.scoreKey ?? null,
  }
}

export function buildPlayerEvolution(snapshots: EvolutionSnapshot[]): PlayerEvolution {
  const ordered = sortEvolutionSnapshots(snapshots)
  const first = ordered[0]
  const last = ordered.at(-1)
  const changes = first && last && first.id !== last.id ? rankAttributeChanges(first, last) : []
  return {
    checkpoints: ordered.map(checkpoint),
    periodGeneralScoreDelta: first && last && first.id !== last.id ? generalScoreDelta(first, last) : null,
    gains: changes.filter(change => change.delta > 0),
    losses: changes.filter(change => change.delta < 0),
    contextChanges: observedContextChanges(ordered),
  }
}
