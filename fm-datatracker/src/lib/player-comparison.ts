import { ATTRIBUTE_CATALOG } from './attributes'
import { BASE_POSITION_DEFINITIONS, generalScoreForSnapshot, type GeneralScoreSnapshot } from './base-position-score'
import { canPlayPosition } from './positions'
import { effectiveWeight } from './scoring'
import { canonicalRoleDefaultWeights, pairedRoleScore, resolveRoleWeights, roleScore } from './role-scoring'
import { positionGroup, rolesFor, type TacticPhase } from './tactics'

export type ComparisonSnapshot = GeneralScoreSnapshot & {
  snapshot_date?: string
  age?: number | null
  club?: string | null
  squad?: string | null
}

export type ComparisonRole = {
  position: string
  roleCode: string
}

export type ComparisonMetric =
  | { kind: 'general' }
  | { kind: 'base'; position: string }
  | { kind: 'role'; phase: TacticPhase; position: string; roleCode: string }
  | { kind: 'pair'; ip: ComparisonRole; oop: ComparisonRole }

export type RoleWeightOverrides = Record<string, Record<string, number>>

export type ComparisonWeights = {
  ip: Record<string, number> | null
  oop: Record<string, number> | null
}

export type ComparisonScoreResult = {
  score: number | null
  ipScore: number | null
  oopScore: number | null
  label: string
  detail: string
  familiarity: Array<{ position: string; familiar: boolean }>
  weights: ComparisonWeights
}

export type ComparisonAttributeRow = {
  key: string
  label: string
  left: number | null
  right: number | null
  delta: number | null
  ipWeight: number | null
  oopWeight: number | null
  priority: number
}

const roleName = (position: string, phase: TacticPhase, roleCode: string) =>
  rolesFor(position, phase).find(([code]) => code === roleCode)?.[1] ?? roleCode

const attrs = (snapshot: ComparisonSnapshot) =>
  snapshot.player_attributes.map(attribute => ({
    key: attribute.attribute_key,
    value: attribute.value,
  }))

function baseDefinition(position: string) {
  return BASE_POSITION_DEFINITIONS.find(definition => definition.position === position) ?? null
}

function roleWeights(
  phase: TacticPhase,
  position: string,
  roleCode: string,
  overrides: RoleWeightOverrides,
) {
  const name = roleName(position, phase, roleCode)
  const roleId = `${phase}-${positionGroup(position)}-${roleCode}`
  return {
    roleId,
    name,
    weights: resolveRoleWeights({
      roleId,
      roleName: name,
      overrideWeights: overrides[roleId],
    }),
  }
}

export function comparisonMetricLabel(metric: ComparisonMetric) {
  if (metric.kind === 'general') return 'Nota Geral'
  if (metric.kind === 'base') return `BasePositionScore · ${metric.position}`
  if (metric.kind === 'role') return `RoleScore ${metric.phase} · ${metric.position} · ${roleName(metric.position, metric.phase, metric.roleCode)}`
  return `RoleScore combinado · ${metric.ip.position} ${roleName(metric.ip.position, 'IP', metric.ip.roleCode)} ↔ ${metric.oop.position} ${roleName(metric.oop.position, 'OOP', metric.oop.roleCode)}`
}

export function resolveComparisonScore(
  snapshot: ComparisonSnapshot | null | undefined,
  metric: ComparisonMetric,
  overrides: RoleWeightOverrides = {},
): ComparisonScoreResult | null {
  if (!snapshot) return null

  if (metric.kind === 'general') {
    const general = generalScoreForSnapshot(snapshot)
    return {
      score: general?.score ?? null,
      ipScore: null,
      oopScore: null,
      label: 'Nota Geral',
      detail: general ? `${general.position} · BasePositionScore ${general.scoreKey}` : 'Sem BasePositionScore elegível',
      familiarity: [],
      weights: { ip: null, oop: null },
    }
  }

  if (metric.kind === 'base') {
    const definition = baseDefinition(metric.position)
    if (!definition) {
      return {
        score: null,
        ipScore: null,
        oopScore: null,
        label: comparisonMetricLabel(metric),
        detail: 'Posição-base não reconhecida',
        familiarity: [{ position: metric.position, familiar: canPlayPosition(snapshot.positions, metric.position) }],
        weights: { ip: null, oop: null },
      }
    }
    const ip = canonicalRoleDefaultWeights(`IP-${definition.group}-${definition.roleCode}`, definition.roleName)
    const oop = canonicalRoleDefaultWeights(`OOP-${definition.group}-${definition.roleCode}`, definition.roleName)
    const values = attrs(snapshot)
    return {
      score: pairedRoleScore(values, ip, oop),
      ipScore: roleScore(values, ip),
      oopScore: roleScore(values, oop),
      label: comparisonMetricLabel(metric),
      detail: definition.roleName,
      familiarity: [{ position: metric.position, familiar: canPlayPosition(snapshot.positions, metric.position) }],
      weights: { ip, oop },
    }
  }

  if (metric.kind === 'role') {
    const resolved = roleWeights(metric.phase, metric.position, metric.roleCode, overrides)
    const score = roleScore(attrs(snapshot), resolved.weights)
    return {
      score,
      ipScore: metric.phase === 'IP' ? score : null,
      oopScore: metric.phase === 'OOP' ? score : null,
      label: comparisonMetricLabel(metric),
      detail: resolved.name,
      familiarity: [{ position: metric.position, familiar: canPlayPosition(snapshot.positions, metric.position) }],
      weights: metric.phase === 'IP'
        ? { ip: resolved.weights, oop: null }
        : { ip: null, oop: resolved.weights },
    }
  }

  const ip = roleWeights('IP', metric.ip.position, metric.ip.roleCode, overrides)
  const oop = roleWeights('OOP', metric.oop.position, metric.oop.roleCode, overrides)
  const values = attrs(snapshot)
  return {
    score: pairedRoleScore(values, ip.weights, oop.weights),
    ipScore: roleScore(values, ip.weights),
    oopScore: roleScore(values, oop.weights),
    label: comparisonMetricLabel(metric),
    detail: `${ip.name} ↔ ${oop.name}`,
    familiarity: [
      { position: metric.ip.position, familiar: canPlayPosition(snapshot.positions, metric.ip.position) },
      ...(metric.oop.position === metric.ip.position
        ? []
        : [{ position: metric.oop.position, familiar: canPlayPosition(snapshot.positions, metric.oop.position) }]),
    ],
    weights: { ip: ip.weights, oop: oop.weights },
  }
}

function attributeMap(snapshot: ComparisonSnapshot | null | undefined) {
  const result = new Map<string, number>()
  for (const attribute of snapshot?.player_attributes ?? []) {
    if (typeof attribute.value === 'number' && Number.isFinite(attribute.value)) {
      result.set(attribute.attribute_key, attribute.value)
    }
  }
  return result
}

export function comparisonAttributeRows(
  left: ComparisonSnapshot | null | undefined,
  right: ComparisonSnapshot | null | undefined,
  metric: ComparisonMetric,
  overrides: RoleWeightOverrides = {},
): ComparisonAttributeRow[] {
  if (!left || !right || metric.kind === 'general') return []

  const resolved = resolveComparisonScore(left, metric, overrides)
  if (!resolved) return []
  const { ip, oop } = resolved.weights
  const leftValues = attributeMap(left)
  const rightValues = attributeMap(right)

  return ATTRIBUTE_CATALOG.map(definition => {
    const ipWeight = ip?.[definition.key] ?? null
    const oopWeight = oop?.[definition.key] ?? null
    const ipEffective = ipWeight === null ? 0 : effectiveWeight(ipWeight)
    const oopEffective = oopWeight === null ? 0 : effectiveWeight(oopWeight)
    const priority = ipEffective + oopEffective
    if (priority <= 0) return null

    const leftValue = leftValues.get(definition.key) ?? null
    const rightValue = rightValues.get(definition.key) ?? null
    const delta = leftValue === null || rightValue === null ? null : leftValue - rightValue
    return {
      key: definition.key,
      label: definition.label,
      left: leftValue,
      right: rightValue,
      delta,
      ipWeight,
      oopWeight,
      priority,
    }
  }).filter((row): row is ComparisonAttributeRow => row !== null)
    .sort((a, b) => {
      const aSignal = Math.abs(a.delta ?? 0) * a.priority
      const bSignal = Math.abs(b.delta ?? 0) * b.priority
      return bSignal - aSignal || b.priority - a.priority || a.label.localeCompare(b.label, 'pt-BR')
    })
}

export function firstRoleCode(position: string, phase: TacticPhase) {
  return rolesFor(position, phase)[0]?.[0] ?? ''
}
