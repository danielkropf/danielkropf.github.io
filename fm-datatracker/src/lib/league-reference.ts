import { z } from 'zod'
import { adjacentLeagues, leagueLevel, stableLeagueGroups, type LeagueRule } from './fm26-league-rules'
import { ATTRIBUTE_CATALOG } from './attributes'
import { pairedRoleScore } from './role-scoring'
import { planningFamiliarity } from './planning-familiarity'

export const LEAGUE_REFERENCE_VERSION = 'fm26-league-reference-v1' as const
export type LeaguePlayer = { eid: number; uid: number; name?: string; birth: string | null; team: number; attributes: Array<number | null>; positions: string[]; ratings?: Record<string, number> }
export type LeagueCohort = {
  uid: number | null; raw: number | null; kind: number; season: string; first: string; last: string; teams: number[]; fixtures: number
  status: 'confirmed' | 'candidate' | 'historical' | 'unresolved'; reason: string; complete: boolean
}
export type LeagueHeaderPopulation = {
  uid: number; raw: number; teams: number[]; expectedTeams: number; seasonEndYear: number
  reason: 'same_save_roster_headers_and_history_shape'
}
export type LeagueReference = {
  version: typeof LEAGUE_REFERENCE_VERSION; checkpoint: string | null; sourceSha256: string; fileName: string
  attributes: string[]; rules: LeagueRule[]; cohorts: LeagueCohort[]; headerPopulations?: LeagueHeaderPopulation[]; players: LeaguePlayer[]
  humanTeams: Array<{ team: number; name: string }>
  diagnostics: { warnings: string[]; excluded: Record<string, number>; excludedByTeam: Record<string, Record<string, number>>; recovered: number; scanned: number; contractSelections?: Record<string, number>; offerRegistry?: { status: string; records: Array<{ eid: number; field5: number; offset: number }> } }
}
export type ReferencePopulation = {
  status: 'available_partial' | 'unknown' | 'ambiguous'; reason: string; uid: number; groups: number[]
  players: LeaguePlayer[]; teams: number; coveredTeams: number; missingGroups: number[]; exclusions: Record<string, number>
}
const integer = z.number().int().nonnegative()
const nullableInteger = integer.nullable()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const counts = z.record(z.string(), integer)
const referenceSchema = z.object({
  version: z.literal(LEAGUE_REFERENCE_VERSION), checkpoint: isoDate.nullable(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), fileName: z.string(),
  attributes: z.array(z.string()).refine(a => a.length === ATTRIBUTE_CATALOG.length && a.every((key, i) => key === ATTRIBUTE_CATALOG[i].key)),
  rules: z.array(z.object({ uid: integer, errors: integer, roots: z.array(z.object({ offset: integer, code: z.string().nullable(), level: nullableInteger, type: nullableInteger, year: nullableInteger, groups: z.array(integer), edges: z.array(z.object({ direction: z.enum(['up', 'down']), target: integer, places: nullableInteger })) })) })),
  cohorts: z.array(z.object({ uid: nullableInteger, raw: nullableInteger, kind: integer, season: isoDate, first: isoDate, last: isoDate, teams: z.array(integer), fixtures: integer, status: z.enum(['confirmed', 'candidate', 'historical', 'unresolved']), reason: z.string(), complete: z.boolean() })),
  headerPopulations: z.array(z.object({ uid: integer, raw: integer, teams: z.array(integer), expectedTeams: integer, seasonEndYear: integer, reason: z.literal('same_save_roster_headers_and_history_shape') })).optional(),
  players: z.array(z.object({ eid: integer, uid: integer, name: z.string().min(1).optional(), birth: isoDate.nullable(), team: integer, attributes: z.array(z.number().min(1).max(20).nullable()).length(ATTRIBUTE_CATALOG.length), positions: z.array(z.string()), ratings: z.record(z.string(), z.number().min(0).max(20)).optional() })),
  humanTeams: z.array(z.object({ team: integer, name: z.string() })),
  diagnostics: z.object({ warnings: z.array(z.string()), excluded: counts, excludedByTeam: z.record(z.string(), counts), recovered: integer, scanned: integer }),
})
export function isLeagueReference(value: unknown): value is LeagueReference { return referenceSchema.safeParse(value).success }
const completedLeagueReason = 'same_save_calendar_and_history_completed' as const
function supportedLeagueCohort(data: LeagueReference, cohort: LeagueCohort) {
  return cohort.complete && cohort.uid !== null && leagueLevel(data.rules.find(rule => rule.uid === cohort.uid)) !== null
}
function activeCohorts(data: LeagueReference, uid?: number, team?: number) {
  if (!data.checkpoint) return []
  return data.cohorts.filter(cohort => cohort.status === 'confirmed' && supportedLeagueCohort(data, cohort) && cohort.season >= data.checkpoint! && cohort.last >= data.checkpoint! && (uid === undefined || cohort.uid === uid) && (team === undefined || cohort.teams.includes(team)))
}
function completedCohorts(data: LeagueReference, uid?: number, team?: number) {
  if (!data.checkpoint) return []
  return data.cohorts.filter(cohort => cohort.status === 'historical' && cohort.reason === completedLeagueReason && supportedLeagueCohort(data, cohort) && cohort.last < data.checkpoint! && (uid === undefined || cohort.uid === uid) && (team === undefined || cohort.teams.includes(team)))
}
function newestUniqueCohort(cohorts: LeagueCohort[]) {
  if (!cohorts.length) return { cohort: null, ambiguous: false }
  const latest = cohorts.reduce((value, cohort) => cohort.last > value ? cohort.last : value, cohorts[0].last)
  const matches = cohorts.filter(cohort => cohort.last === latest)
  return { cohort: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 }
}
export function currentLeague(data: LeagueReference, team: number) {
  const active = activeCohorts(data, undefined, team)
  if (active.length === 1) return { status: 'confirmed' as const, cohort: active[0], reason: 'same_save_calendar' }
  if (active.length > 1) return { status: 'ambiguous' as const, cohort: null, reason: 'multiple_current_leagues' }
  const activeCandidate = data.checkpoint && data.cohorts.some(cohort => cohort.status === 'candidate' && cohort.complete && cohort.teams.includes(team) && cohort.season >= data.checkpoint! && cohort.last >= data.checkpoint!)
  if (activeCandidate) return { status: 'candidate' as const, cohort: null, reason: 'header_consensus_only' }
  // After a league season ends, the latest fully corroborated completed edition remains
  // the club's comparison league until a newer active league is confirmed.
  const completed = newestUniqueCohort(completedCohorts(data, undefined, team))
  if (completed.cohort) return { status: 'confirmed' as const, cohort: completed.cohort, reason: 'latest_completed_league' }
  if (completed.ambiguous) return { status: 'ambiguous' as const, cohort: null, reason: 'multiple_completed_leagues' }
  // 0.43.0/0.43.1 could persist a complete current calendar with a resolved
  // competition as unresolved only because the squad carried additional headers.
  // The reader fix needs the original .fm again to rebuild the player population.
  const legacyNeedsRefresh = data.cohorts.some(c => c.status === 'unresolved' && c.reason === 'identity_or_headers_unresolved' && c.complete && c.uid !== null && c.season >= (data.checkpoint ?? '') && c.teams.includes(team) && data.checkpoint && c.last >= data.checkpoint && leagueLevel(data.rules.find(r => r.uid === c.uid)) !== null)
  return { status: 'unknown' as const, cohort: null, reason: legacyNeedsRefresh ? 'legacy_reference_needs_refresh' : 'no_current_calendar' }
}
export function leaguePopulation(data: LeagueReference, uid: number): ReferencePopulation {
  const result: ReferencePopulation = { status: 'unknown', reason: 'missing_same_save_population', uid, groups: [], players: [], teams: 0, coveredTeams: 0, missingGroups: [], exclusions: {} }
  const node = data.rules.find(r => r.uid === uid), groups = stableLeagueGroups(node)
  if (groups === null || leagueLevel(node) === null) return { ...result, reason: 'unstable_or_unsupported_rules' }
  result.groups = groups.length ? groups : [uid]
  const teams: number[] = []
  for (const child of result.groups) {
    if (leagueLevel(data.rules.find(r => r.uid === child)) !== leagueLevel(node)) return { ...result, reason: 'child_rules_unresolved' }
    const active = activeCohorts(data, child)
    if (active.length > 1) return { ...result, status: 'ambiguous', reason: 'multiple_reference_cohorts' }
    const selected = active.length === 1 ? active[0] : newestUniqueCohort(completedCohorts(data, child)).cohort
    if (selected) { teams.push(...selected.teams); continue }
    // Some inactive-but-loaded divisions do not carry a full fixture calendar in
    // fix_man. The Reader can still confirm their participant set when current
    // structural squad headers resolve to the competition and the count exactly
    // matches the same-save league-history shape. This is population evidence,
    // not a synthetic calendar.
    const headerPopulations = (data.headerPopulations ?? []).filter(population => population.uid === child)
    if (headerPopulations.length > 1) return { ...result, status: 'ambiguous', reason: 'multiple_header_populations' }
    if (headerPopulations.length === 1) { teams.push(...headerPopulations[0].teams); continue }
    result.missingGroups.push(child)
  }
  if (result.missingGroups.length) return result
  if (new Set(teams).size !== teams.length) return { ...result, status: 'ambiguous', reason: 'overlapping_group_teams' }
  const ts = new Set(teams), identities = new Map<number, LeaguePlayer>(), biographical = new Map<number, string | null>()
  for (const p of data.players.filter(p => ts.has(p.team))) {
    const previous = identities.get(p.eid)
    if (previous && (previous.team !== p.team || previous.uid !== p.uid || previous.name !== p.name || previous.birth !== p.birth || JSON.stringify(previous.attributes) !== JSON.stringify(p.attributes) || JSON.stringify(previous.ratings) !== JSON.stringify(p.ratings))) return { ...result, status: 'ambiguous', reason: 'conflicting_identity' }
    if (biographical.has(p.uid) && biographical.get(p.uid) !== p.birth) return { ...result, status: 'ambiguous', reason: 'conflicting_biography' }
    identities.set(p.eid, p); biographical.set(p.uid, p.birth)
  }
  // UID duplicates with different EIDs are not silently summed either.
  if (new Set([...identities.values()].map(p => p.uid)).size !== identities.size) return { ...result, status: 'ambiguous', reason: 'duplicate_uid' }
  result.players = [...identities.values()]; result.teams = teams.length; result.coveredTeams = new Set(result.players.map(p => p.team)).size
  teams.forEach(team => Object.entries(data.diagnostics.excludedByTeam[team] ?? {}).forEach(([reason, n]) => { result.exclusions[reason] = (result.exclusions[reason] ?? 0) + n }))
  return { ...result, status: result.players.length ? 'available_partial' : 'unknown', reason: result.players.length ? 'observed_candidates_not_census' : 'empty_population' }
}
export type LeagueGeneralSummary = { mean: number | null; coverage: number; observed: number; possible: number }
export type LeagueComparisonRow = {
  direction: 'current' | 'down' | 'world'; target: number; reason: string; population: ReferencePopulation
  general?: LeagueGeneralSummary
}
export function summarizeLeagueGeneralAttributes(data: LeagueReference, population: ReferencePopulation): LeagueGeneralSummary {
  const possible = population.players.length * data.attributes.length
  if (population.status !== 'available_partial' || !possible) return { mean: null, coverage: 0, observed: 0, possible }
  const means: number[] = []; let observed = 0
  for (let index = 0; index < data.attributes.length; index++) {
    const values = population.players.map(player => player.attributes[index]).filter((value): value is number => value !== null)
    observed += values.length
    if (values.length) means.push(values.reduce((sum, value) => sum + value, 0) / values.length)
  }
  return { mean: means.length ? means.reduce((sum, value) => sum + value, 0) / means.length : null, coverage: possible ? observed / possible : 0, observed, possible }
}
export function worldLeagueBenchmark(data: LeagueReference) {
  // A regional child is never treated as a whole league when a characterized
  // aggregate parent exists. Missing siblings block the aggregate via leaguePopulation().
  const groupedChildren = new Set(data.rules.flatMap(rule => stableLeagueGroups(rule) ?? []))
  const candidates = data.rules.filter(rule => leagueLevel(rule) !== null && !groupedChildren.has(rule.uid)).map(rule => {
    const population = leaguePopulation(data, rule.uid)
    return { target: rule.uid, population, general: summarizeLeagueGeneralAttributes(data, population) }
  }).filter(candidate => candidate.population.status === 'available_partial' && candidate.general.mean !== null)
  candidates.sort((left, right) => (right.general.mean! - left.general.mean!) || (right.general.coverage - left.general.coverage) || (right.population.players.length - left.population.players.length) || (left.target - right.target))
  return candidates[0] ?? null
}
export function leagueComparisons(data: LeagueReference, team: number) {
  const current = currentLeague(data, team)
  if (!current.cohort || current.cohort.uid === null) return { current, rows: [] as LeagueComparisonRow[] }
  const uid = current.cohort.uid
  const rows: LeagueComparisonRow[] = [{ direction: 'current', target: uid, reason: current.reason, population: leaguePopulation(data, uid) }]
  const lowerEdges = adjacentLeagues(uid, data.rules).filter(edge => edge.direction === 'down')
  if (lowerEdges.length) {
    const targets = [...new Set(lowerEdges.map(edge => edge.target))]
    if (targets.length !== 1 || lowerEdges.some(edge => edge.quota !== 'positive')) {
      rows.push({ direction: 'down', target: 0, reason: targets.length > 1 ? 'multiple_adjacent_targets' : 'quota_not_positive', population: { status: 'unknown', reason: 'adjacent_unresolved', uid: 0, groups: [], players: [], teams: 0, coveredTeams: 0, missingGroups: [], exclusions: {} } })
    } else rows.push({ direction: 'down', target: targets[0], reason: 'stable_rules_season_unselected', population: leaguePopulation(data, targets[0]) })
  }
  const world = worldLeagueBenchmark(data)
  if (world) rows.push({ direction: 'world', target: world.target, reason: 'highest_equal_visible_attribute_mean', population: world.population, general: world.general })
  return { current, rows }
}
export type LeagueRolePair = { label: string; ip: { position: string; weights: Record<string, number> }; oop: { position: string; weights: Record<string, number> } }
export function summarizeLeagueRole(data: LeagueReference, population: ReferencePopulation, pair: LeagueRolePair) {
  const scored: Array<{ score: number; player: LeaguePlayer }> = []; let missing = 0, ineligible = 0
  if (population.status !== 'available_partial') return null
  for (const p of population.players) {
    if (planningFamiliarity({ positions: p.positions, normalized_data: { positional_ratings: p.ratings } }, [pair]) !== 'familiar') { ineligible++; continue }
    const attributes = data.attributes.map((key, i) => ({ attribute_key: key, value: p.attributes[i] }))
    if (attributes.some(a => ((pair.ip.weights[a.attribute_key] ?? 1) > 1 || (pair.oop.weights[a.attribute_key] ?? 1) > 1) && a.value === null)) { missing++; continue }
    const score = pairedRoleScore(attributes, pair.ip.weights, pair.oop.weights)
    if (score !== null) scored.push({ score, player: p }); else missing++
  }
  scored.sort((a, b) => a.score - b.score || b.player.uid - a.player.uid || b.player.eid - a.player.eid)
  const scores = scored.map(item => item.score)
  const quantile = (q: number) => { const at = (scores.length - 1) * q, lo = Math.floor(at); return scores[lo] + (scores[Math.ceil(at)] - scores[lo]) * (at - lo) }
  const top = scored.length ? scored[scored.length - 1] : null
  return {
    n: scores.length,
    missing,
    ineligible,
    mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    median: scores.length ? quantile(.5) : null,
    p25: scores.length ? quantile(.25) : null,
    p75: scores.length ? quantile(.75) : null,
    best: top ? { name: top.player.name ?? null, score: top.score, uid: top.player.uid, team: top.player.team } : null,
  }
}
