import { FM26OfflineReaderV022 } from './fm26-offline-reader-v022.js'
import { buildPlayerMembershipFacts, indexStructuralOrganizations, decodeMembershipPackedDate } from './fm26-membership-facts'
import { invalidPlayerRecord } from './fm26-person-eligibility'
import { buildCompetitionIdentityIndex, resolveCompetitionIdentity, type CompetitionHistory } from './fm26-competition-history'
import { readLeagueRule, leagueLevel, type LeagueRule } from './fm26-league-rules'
import { ATTRIBUTE_CATALOG } from './attributes'
import { LEAGUE_REFERENCE_VERSION, type LeagueReference, type LeagueCohort, type LeagueHeaderPopulation } from './league-reference'

type Row = Record<string, unknown>
type Contract = { eid: number; uid: number; identity_offset: number; contract_team_id: number }
type Squad = { team: number; start: number; ratio: number; eids: number[]; header: number }
type DB = { stringTables: Array<{ start: number }>; _currentRootContractsMulti(ids: number[]): Map<number, Map<number, Contract>>; _playerFromIdentity(eid: number, offset: number, uid: number): Row }
const record = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const unique = <T,>(xs: T[]) => [...new Set(xs)]

/** Full ordered round robin + unanimous squad headers + same-save historical mapping.
 * Unknown formats stay unavailable. No mapping is borrowed from another universe.
 */
export function readLeagueCalendars(bytes: Uint8Array, end: number, history: CompetitionHistory, headers: Map<number, Set<number>>, identities: ReturnType<typeof buildCompetitionIdentityIndex>, rules: LeagueRule[], checkpoint: string | null): LeagueCohort[] {
  if (!Number.isInteger(end) || end < 0 || end > bytes.length) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const mappings = new Map<number, Set<number>>()
  for (const s of history.seasons) if (s.fixture_status === 'confirmed' && s.fixture_kind_raw !== null) {
    const set = mappings.get(s.fixture_kind_raw) ?? new Set<number>(); set.add(s.competition_id_raw); mappings.set(s.fixture_kind_raw, set)
  }
  type Fixture = { a: number; b: number; date: string; season: string; kind: number }
  const groups = new Map<string, Fixture[]>(), latest = new Map<number, string>()
  for (let p = 0; p + 33 <= end; p++) {
    if (bytes[p] !== 0x1c || bytes[p + 16] !== 255 || bytes[p + 23] !== 255) continue
    const a = view.getUint32(p + 12, true), b = view.getUint32(p + 19, true), kind = view.getUint32(p + 1, true)
    if (!a || !b || a >= 100000 || b >= 100000 || a === b) continue
    const date = decodeMembershipPackedDate(bytes, p + 25)?.iso, season = decodeMembershipPackedDate(bytes, p + 29)?.iso
    if (!date || !season) continue
    const key = `${kind}:${season}`, group = groups.get(key) ?? []; group.push({ a, b, date, season, kind }); groups.set(key, group)
    if (season > (latest.get(kind) ?? '')) latest.set(kind, season)
  }
  const cohorts: LeagueCohort[] = []
  for (const fs of groups.values()) {
    const { kind, season } = fs[0]; if (season !== latest.get(kind)) continue
    const teams = unique(fs.flatMap(f => [f.a, f.b])).sort((a,b) => a-b), pairs = new Set(fs.map(f => `${f.a}:${f.b}`))
    const complete = teams.length >= 2 && fs.length === teams.length * (teams.length - 1) && pairs.size === fs.length && fs.every(f => pairs.has(`${f.b}:${f.a}`))
    if (!complete) continue
    const known = mappings.get(kind), allHeaders = unique(teams.flatMap(t => [...(headers.get(t) ?? [])]))
    const unanimous = allHeaders.length === 1 && teams.every(t => headers.get(t)?.size === 1)
    const mappedRaw = known?.size === 1 ? [...known][0] : null
    const raw = mappedRaw ?? (unanimous ? allHeaders[0] : null)
    const identity = raw === null ? null : resolveCompetitionIdentity(raw, identities)
    const uid = identity?.status === 'confirmed' ? identity.competition_uid : null
    const dates = fs.map(f => f.date).sort(), first = dates[0], last = dates[dates.length - 1]
    const current = Boolean(checkpoint && season >= checkpoint && last >= checkpoint)
    // A unique same-save historical mapping is already independent evidence for
    // calendar identity. Roster headers remain a conflict detector, not a demand
    // that every participant expose exactly one identical header: Brazilian saves
    // can legitimately expose extra competition headers for the same senior squad.
    const mappingConflict = Boolean(known?.size && known.size !== 1)
    const headerConflict = mappedRaw !== null && teams.some(team => {
      const observed = headers.get(team)
      return Boolean(observed?.size && !observed.has(mappedRaw))
    })
    const conflict = mappingConflict || headerConflict
    const supportedLeague = uid !== null && leagueLevel(rules.find(r => r.uid === uid)) !== null
    const corroboratedByHistory = mappedRaw !== null && supportedLeague
    const corroboratedByHeaders = unanimous && raw === allHeaders[0] && supportedLeague
    const status = !current ? 'historical' : corroboratedByHistory && !conflict ? 'confirmed' : corroboratedByHeaders && !conflict && teams.length >= 8 ? 'candidate' : 'unresolved'
    const reason = status === 'confirmed' ? 'same_save_calendar_and_history'
      : status === 'candidate' ? 'header_consensus_only'
      : !current && corroboratedByHistory && !conflict ? 'same_save_calendar_and_history_completed'
      : conflict ? 'history_header_conflict'
      : !current ? 'outside_checkpoint'
      : 'identity_or_headers_unresolved'
    cohorts.push({ uid, raw, kind, season, first, last, teams, fixtures: fs.length, complete, status, reason })
  }
  return cohorts
}

/**
 * Fallback population boundary for loaded divisions whose fixtures are not
 * materialized in fix_man. A population is admitted only when all of these
 * same-save signals agree:
 * - the squad header resolves uniquely to a supported league UID;
 * - tc_league_history carries that raw competition with a confirmed UID;
 * - its latest observed table shape has a single team count >= 8;
 * - the current structurally valid squad headers produce exactly that count.
 *
 * This confirms a participant population only. It does not invent a calendar,
 * standings or season dates for the division.
 */
export function deriveHeaderLeaguePopulations(
  headers: Map<number, Set<number>>,
  history: CompetitionHistory,
  identities: ReturnType<typeof buildCompetitionIdentityIndex>,
  rules: LeagueRule[],
): LeagueHeaderPopulation[] {
  const supported = new Set(rules.filter(rule => leagueLevel(rule) !== null).map(rule => rule.uid))
  const rawHeaders = unique([...headers.values()].flatMap(values => [...values])).sort((a, b) => a - b)
  const populations: LeagueHeaderPopulation[] = []
  for (const raw of rawHeaders) {
    const identity = resolveCompetitionIdentity(raw, identities)
    if (identity.status !== 'confirmed' || identity.competition_uid === null || !supported.has(identity.competition_uid)) continue
    const seasons = history.seasons.filter(season =>
      season.competition_id_raw === raw &&
      season.competition_uid === identity.competition_uid &&
      season.competition_identity_status === 'confirmed' &&
      season.team_count >= 8
    )
    if (!seasons.length) continue
    const seasonEndYear = Math.max(...seasons.map(season => season.season_end_year))
    const latest = seasons.filter(season => season.season_end_year === seasonEndYear)
    const counts = unique(latest.map(season => season.team_count))
    if (counts.length !== 1) continue
    const expectedTeams = counts[0]
    const teams = [...headers.entries()].filter(([, values]) => values.has(raw)).map(([team]) => team).sort((a, b) => a - b)
    if (teams.length !== expectedTeams || new Set(teams).size !== teams.length) continue
    populations.push({ uid: identity.competition_uid, raw, teams, expectedTeams, seasonEndYear, reason: 'same_save_roster_headers_and_history_shape' })
  }
  return populations
}

export async function readLeagueReference(args: { gameDb: Uint8Array; fixMan: Uint8Array | null; history: CompetitionHistory; checkpoint: string | null; sourceSha256: string; fileName: string; humans: unknown; members: string[]; getMember: (name: string) => Promise<Uint8Array> }): Promise<LeagueReference> {
  const { gameDb, checkpoint } = args
  const out: LeagueReference = { version: LEAGUE_REFERENCE_VERSION, checkpoint, sourceSha256: args.sourceSha256, fileName: args.fileName, attributes: ATTRIBUTE_CATALOG.map(a => a.key), rules: [], cohorts: [], headerPopulations: [], players: [], humanTeams: [], diagnostics: { warnings: [], excluded: {}, excludedByTeam: {}, recovered: 0, scanned: 0 } }
  for (const h of Array.isArray(args.humans) ? args.humans : []) { const club = record(record(h).human_club); if (Number.isInteger(club.root_team_id)) out.humanTeams.push({ team: club.root_team_id as number, name: String(record(club.root_team_name_resolution).status === 'confirmed' ? record(club.root_team_name_resolution).name : `Equipe ${club.root_team_id}`) }) }
  out.humanTeams = out.humanTeams.filter((t, i, all) => all.findIndex(x => x.team === t.team) === i)
  for (const name of args.members) {
    const match = /^rgman\/comp_(\d+)\.dat$/.exec(name); if (!match) continue
    try { out.rules.push(readLeagueRule(await args.getMember(name), Number(match[1]))) } catch { out.diagnostics.warnings.push(`Regras indisponíveis: ${match[1]}`) }
  }
  const oi = indexStructuralOrganizations(gameDb)
  const Constructor = FM26OfflineReaderV022.GameDBReader as unknown as new (bytes: Uint8Array) => DB
  const db = new Constructor(gameDb), byEid = new Map<number, Contract[]>()
  for (const map of db._currentRootContractsMulti([...oi.byTeamId.keys()]).values()) for (const p of map.values()) { const refs = byEid.get(p.eid) ?? []; refs.push(p); byEid.set(p.eid, refs) }
  const view = new DataView(gameDb.buffer, gameDb.byteOffset, gameDb.byteLength), u32 = (p: number) => view.getUint32(p, true)
  const limit = Math.min(db.stringTables[0]?.start ?? 0, gameDb.length), groups = new Map<number, Squad>()
  for (let cp = 46; cp + 6 < limit; cp++) {
    const count = view.getUint16(cp, true), start = cp + 2
    if (count < 3 || count > 80 || start + count * 4 > limit) continue
    const team = u32(start - 48) + 1, orgs = oi.byTeamId.get(team); if (orgs?.length !== 1) continue
    const eids: number[] = []
    for (let i = 0; i < count; i++) { const eid = u32(start + i * 4); if (byEid.get(eid)?.some(p => orgs[0].organization_team_ids.includes(p.contract_team_id))) eids.push(eid) }
    if (count < 8 ? eids.length !== count : eids.length < 8 || eids.length / count < .3) continue
    groups.set(start, { team, start, ratio: eids.length / count, eids, header: u32(start - 31) })
  }
  for (const [start, g] of groups) if ((groups.get(start + 12)?.ratio ?? -1) >= g.ratio) groups.delete(start)
  const headers = new Map<number, Set<number>>(), squads = new Map<number, Squad[]>()
  for (const g of groups.values()) { const hs = headers.get(g.team) ?? new Set<number>(); hs.add(g.header); headers.set(g.team, hs); for (const eid of g.eids) { const gs = squads.get(eid) ?? []; gs.push(g); squads.set(eid, gs) } }
  const competitionIdentities = buildCompetitionIdentityIndex(gameDb)
  out.headerPopulations = deriveHeaderLeaguePopulations(headers, args.history, competitionIdentities, out.rules)
  const end = args.history.diagnostics.fix_man.index_start
  if (args.fixMan && typeof end === 'number') out.cohorts = readLeagueCalendars(args.fixMan, end, args.history, headers, competitionIdentities, out.rules, checkpoint)
  else out.diagnostics.warnings.push('Calendário atual sem delimitação confirmada; comparativos indisponíveis.')
  // Keep comparison populations available after a season ends and for divisions
  // whose participant set is independently confirmed by current structural roster
  // headers + same-save league-history shape. Calendar semantics remain separate.
  const wantedTeams = new Set([
    ...out.cohorts.filter(c => c.status === 'confirmed' || (c.status === 'historical' && c.reason === 'same_save_calendar_and_history_completed')).flatMap(c => c.teams),
    ...(out.headerPopulations ?? []).flatMap(population => population.teams),
  ])
  const reject = (reason: string, gs: Squad[]) => { out.diagnostics.excluded[reason] = (out.diagnostics.excluded[reason] ?? 0) + 1; for (const team of unique(gs.map(g => g.team)).filter(t => wantedTeams.has(t))) { const counts = out.diagnostics.excludedByTeam[team] ?? {}; counts[reason] = (counts[reason] ?? 0) + 1; out.diagnostics.excludedByTeam[team] = counts } }
  for (const [eid, gs] of squads) {
    if (!gs.some(g => wantedTeams.has(g.team))) continue
    out.diagnostics.scanned++
    const refs = (byEid.get(eid) ?? []).filter(p => gs.some(g => oi.byTeamId.get(g.team)?.[0].organization_team_ids.includes(p.contract_team_id)))
    if (!refs.length || unique(refs.map(r => `${r.identity_offset}:${r.uid}`)).length !== 1) { reject('ambiguous_identity', gs); continue }
    try {
      const p = db._playerFromIdentity(eid, refs[0].identity_offset, refs[0].uid)
      if (p.identity_link_confidence !== 'high' || !Number.isInteger(p.attribute_start)) { reject('identity_or_ability_unresolved', gs); continue }
      const invalid = invalidPlayerRecord(p, gameDb); if (invalid) { reject(invalid, gs); continue }
      let teams = unique(gs.map(g => g.team))
      const wasAmbiguous = teams.length > 1
      // Research v5 requires a current organization even for a unique squad.
      if (wasAmbiguous && unique((byEid.get(eid) ?? []).map(r => `${r.identity_offset}:${r.uid}`)).length !== 1) { reject('ambiguous_identity', gs); continue }
      const facts = buildPlayerMembershipFacts({ ...p, roster_group: { team_id: gs[0].team, record_offset: gs[0].start } }, gameDb, checkpoint, oi)
      const selections = out.diagnostics.contractSelections ??= {}
      const contractReason = facts?.contracts.current_selection.reason_code ?? 'facts_unavailable'
      selections[contractReason] = (selections[contractReason] ?? 0) + 1
      const current = facts?.resolved_membership_facts.current_organization
      if (current?.status !== 'confirmed' || !current.value) { reject('current_organization_unresolved', gs); continue }
      teams = teams.filter(t => current.value!.organization_team_ids.includes(t))
      if (teams.length !== 1) { reject('ambiguous_current_squad', gs); continue }
      if (wasAmbiguous) out.diagnostics.recovered++
      if (!wantedTeams.has(teams[0])) { reject('outside_current_cohort', gs); continue }
      const attrs = Object.fromEntries(Object.entries(record(p.attributes_1_20)).map(([k,v]) => { let key = k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); key = ({ teamwork: 'team_work', punching_tendency: 'punching', rushing_out_tendency: 'rushing_out_tendency' } as Record<string,string>)[key] ?? key; return [key,v] }))
      const ratings = Object.fromEntries(Object.entries(record(p.positions)).filter(([,v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20)) as Record<string, number>
      out.players.push({ eid, uid: refs[0].uid, name: typeof p.display_name === 'string' && p.display_name.trim() ? p.display_name.trim() : undefined, birth: typeof p.birth_date === 'string' ? p.birth_date : null, team: teams[0], positions: Object.keys(ratings).filter(k => ratings[k] >= 15), ratings, attributes: out.attributes.map(key => typeof attrs[key] === 'number' && (attrs[key] as number) >= 1 && (attrs[key] as number) <= 20 ? attrs[key] as number : null) })
    } catch { reject('player_decode_failed', gs) }
  }
  if (args.members.includes('contract_man.dat')) {
    try { out.diagnostics.offerRegistry = readContractRegistryDiagnostic(await args.getMember('contract_man.dat')) } catch { out.diagnostics.offerRegistry = { status: 'unavailable', records: [] } }
  }
  return out
}

/** Experimental framing only: this is not a contract/offer authority. */
export function readContractRegistryDiagnostic(bytes: Uint8Array): NonNullable<LeagueReference['diagnostics']['offerRegistry']> {
  const unavailable = { status: 'unsupported', records: [] }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let cursor = 8
  for (const width of [8, 29, 10]) {
    if (cursor + 4 > bytes.length) return unavailable
    const n = view.getUint32(cursor, true); if (n > 100000 || cursor + 4 + n * width > bytes.length) return unavailable
    cursor += 4 + n * width
  }
  if (cursor + 4 > bytes.length) return unavailable
  const n = view.getUint32(cursor, true), end = cursor + 4 + n * 44
  if (n > 100000 || end + 12 !== bytes.length || bytes.subarray(end).some(b => b !== 0)) return unavailable
  return { status: 'experimental_local_shape', records: Array.from({ length: n }, (_, i) => { const offset = cursor + 4 + i * 44; return { offset, eid: view.getUint32(offset + 1, true), field5: view.getUint32(offset + 5, true) } }) }
}
