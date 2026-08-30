import type { PlayerStat } from '../types/domain'

export type AdditiveStatTotals = {
  minutes: number | null
  appearances: number | null
  starts: number | null
  subAppearances: number | null
}

export type PerformanceHistoryContext = {
  key: string
  season: string | null
  competition: string | null
  team: string | null
  explicit: boolean
  stat: PlayerStat
  superseded: PlayerStat[]
}

export type PerformanceHistorySeason = {
  key: string
  label: string
  contexts: PerformanceHistoryContext[]
  totals: AdditiveStatTotals | null
  totalsDiagnostic: string | null
  lastSnapshotDate: string
}

export type PlayerPerformanceHistory = {
  seasons: PerformanceHistorySeason[]
  careerTotals: AdditiveStatTotals | null
  careerTotalsDiagnostic: string | null
  observedCount: number
  completeContextCount: number
  partialContextCount: number
  supersededCount: number
}

const ADDITIVE_FIELDS = ['minutes', 'appearances', 'starts', 'sub_appearances'] as const

type AdditiveField = (typeof ADDITIVE_FIELDS)[number]

function text(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function identity(value: string | null) {
  return value?.normalize('NFKC').toLocaleLowerCase('pt-BR') ?? ''
}

function explicitContext(stat: PlayerStat) {
  const season = text(stat.season)
  const competition = text(stat.competition)
  const team = text(stat.team)
  return season && competition && team ? { season, competition, team } : null
}

function compareObservation(a: PlayerStat, b: PlayerStat) {
  const date = a.snapshot_date.localeCompare(b.snapshot_date)
  if (date) return date
  const created = a.created_at.localeCompare(b.created_at)
  if (created) return created
  return a.id.localeCompare(b.id)
}

function latestFirst(a: PerformanceHistoryContext, b: PerformanceHistoryContext) {
  const byDate = b.stat.snapshot_date.localeCompare(a.stat.snapshot_date)
  if (byDate) return byDate
  return a.key.localeCompare(b.key)
}

function safeAdditive(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function aggregateField(contexts: PerformanceHistoryContext[], field: AdditiveField) {
  const values = contexts.map(context => safeAdditive(context.stat[field]))
  return values.some(value => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

export function aggregateAdditiveStats(contexts: PerformanceHistoryContext[]): AdditiveStatTotals | null {
  if (!contexts.length || contexts.some(context => !context.explicit)) return null
  return {
    minutes: aggregateField(contexts, 'minutes'),
    appearances: aggregateField(contexts, 'appearances'),
    starts: aggregateField(contexts, 'starts'),
    subAppearances: aggregateField(contexts, 'sub_appearances'),
  }
}

export function buildPlayerPerformanceHistory(stats: PlayerStat[]): PlayerPerformanceHistory {
  const complete = new Map<string, PlayerStat[]>()
  const partial: PerformanceHistoryContext[] = []

  for (const stat of stats) {
    const resolved = explicitContext(stat)
    if (!resolved) {
      partial.push({
        key: `partial:${stat.id}`,
        season: text(stat.season),
        competition: text(stat.competition),
        team: text(stat.team),
        explicit: false,
        stat,
        superseded: [],
      })
      continue
    }

    const key = [resolved.season, resolved.competition, resolved.team]
      .map(value => identity(value))
      .join('|')
    const bucket = complete.get(key) ?? []
    bucket.push(stat)
    complete.set(key, bucket)
  }

  const contexts: PerformanceHistoryContext[] = [...complete.entries()].map(([key, observations]) => {
    const ordered = [...observations].sort(compareObservation)
    const stat = ordered.at(-1)!
    const resolved = explicitContext(stat)!
    return {
      key: `complete:${key}`,
      season: resolved.season,
      competition: resolved.competition,
      team: resolved.team,
      explicit: true,
      stat,
      superseded: ordered.slice(0, -1),
    }
  })
  contexts.push(...partial)

  const seasonBuckets = new Map<string, PerformanceHistoryContext[]>()
  for (const context of contexts) {
    const key = context.season ? `season:${identity(context.season)}` : 'season:unknown'
    const bucket = seasonBuckets.get(key) ?? []
    bucket.push(context)
    seasonBuckets.set(key, bucket)
  }

  const seasons = [...seasonBuckets.entries()].map(([key, seasonContexts]): PerformanceHistorySeason => {
    const ordered = [...seasonContexts].sort(latestFirst)
    const hasPartial = ordered.some(context => !context.explicit)
    const totals = hasPartial ? null : aggregateAdditiveStats(ordered)
    return {
      key,
      label: ordered.find(context => context.season)?.season ?? 'Temporada não informada',
      contexts: ordered,
      totals,
      totalsDiagnostic: hasPartial
        ? 'Totais indisponíveis: existe registro desta temporada sem season + competition + team completos.'
        : null,
      lastSnapshotDate: ordered.reduce(
        (latest, context) => context.stat.snapshot_date > latest ? context.stat.snapshot_date : latest,
        '',
      ),
    }
  }).sort((a, b) => b.lastSnapshotDate.localeCompare(a.lastSnapshotDate) || b.label.localeCompare(a.label, 'pt-BR'))

  const completeContexts = contexts.filter(context => context.explicit)
  const partialCount = contexts.length - completeContexts.length
  const careerTotals = partialCount === 0 ? aggregateAdditiveStats(completeContexts) : null

  return {
    seasons,
    careerTotals,
    careerTotalsDiagnostic: stats.length === 0
      ? null
      : partialCount > 0
        ? 'Totais de carreira indisponíveis: há registros sem season + competition + team completos.'
        : completeContexts.length === 0
          ? 'Totais de carreira indisponíveis: nenhum contexto estatístico completo foi observado.'
          : null,
    observedCount: stats.length,
    completeContextCount: completeContexts.length,
    partialContextCount: partialCount,
    supersededCount: completeContexts.reduce((sum, context) => sum + context.superseded.length, 0),
  }
}
