export const COMPETITION_HISTORY_VERSION = 'fm26-competition-history-v1' as const

const LEAGUE_HISTORY_HEADER_SIZE = 8
const LEAGUE_HISTORY_RECORD_SIZE = 24
const COMP_HISTORY_HEADER_SIZE = 8
const COMP_HISTORY_RECORD_SIZE = 55
const FIX_INDEX_ENTRY_SIZE = 14
const FIX_BUCKETS_PER_YEAR = 66
const FIX_BRIDGE_SIZE = 13
const FIXTURE_RECORD_MIN_SIZE = 33
const SCORE_RECORD_SIZE = 13
const SCORE_PREDECESSOR_WINDOW = 157
const MAX_STRUCTURAL_TEAM_ID = 100_000
const MAX_VALID_SCORE = 30
const ZSTD_MAGIC = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd])
const COMPETITION_IDENTITY_PREFIX = new Uint8Array([0x01, 0x00, 0x6c, 0x07, 0x01, 0x00, 0x6c, 0x07])

export type CompetitionHistoryStatus = 'confirmed' | 'partial' | 'unresolved'
export type CompetitionIdentityStatus = 'confirmed' | 'unresolved' | 'ambiguous'
export type CompetitionFixtureStatus = 'confirmed' | 'unresolved' | 'incomplete'
export type CompetitionTableStatus = 'confirmed' | 'partial' | 'unresolved'
export type StandingIdentityStatus = 'confirmed' | 'unresolved' | 'ambiguous'

export type PackedFmDate = {
  raw: number
  year: number
  day_of_year: number
  flags: number
}

export type CompetitionStandingRow = {
  position: number
  rank_slot: number
  team_id: number | null
  identity_status: StandingIdentityStatus
  games_played: number
  wins: number
  draws: number
  losses: number
  goals_for: number
  goals_against: number
  goal_difference: number
  points: number
  raw_8: number
  raw_13: number
  raw_17: number
  source_offset: number
}

export type CompetitionPodium = {
  champion_team_id: number | null
  runner_up_team_id: number | null
  third_place_team_id: number | null
  source: 'comp_history_dt.cmt'
  status: 'confirmed' | 'conflict' | 'unresolved'
  source_offset: number
  raw_6: number
  raw_20: number
}

export type CompetitionSeason = {
  season_end_year: number
  competition_id_raw: number
  competition_uid: number | null
  competition_identity_status: CompetitionIdentityStatus
  fixture_status: CompetitionFixtureStatus
  table_status: CompetitionTableStatus
  fixture_kind_raw: number | null
  team_count: number
  expected_fixture_count: number | null
  resolved_fixture_count: number
  rows: CompetitionStandingRow[]
  podium: CompetitionPodium | null
  provenance: Record<string, unknown>
}

export type CompetitionHistoryDiagnostics = {
  members: {
    fix_man: 'available' | 'missing' | 'error'
    league_history: 'available' | 'missing' | 'invalid'
    comp_history: 'available' | 'missing' | 'invalid'
    game_db: 'available' | 'missing'
  }
  league_history: Record<string, unknown>
  fix_man: Record<string, unknown>
  competition_identity: Record<string, unknown>
  comp_history: Record<string, unknown>
  matching: Record<string, unknown>
  timings_ms: Record<string, number>
  warnings: string[]
  errors: string[]
}

export type CompetitionHistory = {
  version: typeof COMPETITION_HISTORY_VERSION
  status: CompetitionHistoryStatus
  seasons: CompetitionSeason[]
  diagnostics: CompetitionHistoryDiagnostics
}

export type ZstdDecompress = (frame: Uint8Array, expectedSize?: number) => Promise<Uint8Array>

export type CompetitionHistoryInput = {
  fixMan?: Uint8Array | null
  leagueHistory?: Uint8Array | null
  compHistory?: Uint8Array | null
  gameDb?: Uint8Array | null
  decompress?: ZstdDecompress | null
}

type LeagueHistoryRecord = {
  season_end_year: number
  competition_id_raw: number
  rank_slot: number
  raw_8: number
  games_played: number
  raw_13: number
  wins: number
  draws: number
  losses: number
  raw_17: number
  goals_for: number
  goals_against: number
  points: number
  source_offset: number
}

export type LeagueHistoryGroup = {
  season_end_year: number
  competition_id_raw: number
  records: LeagueHistoryRecord[]
  rows: CompetitionStandingRow[]
  status: 'closed' | 'unclosed' | 'invalid'
  reasons: string[]
}

export type FixIndexEntry = {
  bucket_id: number
  year: number
  compressed_offset: number
  compressed_length: number
  source_offset: number
}

export type FixManFraming = {
  index_start: number
  index_end: number
  index_entry_count: number
  year_labels: number[]
  bridge_start: number
  bridge_length: number
  archive_start: number
  archive_payload_end: number
  trailer_length: number
  entries: FixIndexEntry[]
  frames: Array<{
    entry: FixIndexEntry
    absolute_offset: number
    plain: Uint8Array
  }>
}

export type FixManFramingDetection = {
  status: 'confirmed' | 'unresolved' | 'ambiguous'
  candidate_count: number
  framing: FixManFraming | null
  diagnostics: string[]
}

export type FixtureProvenance = {
  source: 'live' | 'archive'
  source_offset: number
  archive_year?: number
  archive_bucket?: number
  archive_compressed_offset?: number
  archive_plain_offset?: number
}

export type FixtureRecord = {
  kind_raw: number
  team_a: number
  team_b: number
  packed_date_1: PackedFmDate
  packed_date_2: PackedFmDate
  score_a: number
  score_b: number
  fixture_offset: number
  score_offset: number
  provenance: FixtureProvenance[]
}

export type FixtureScanResult = {
  fixtures: FixtureRecord[]
  diagnostics: {
    fixture_like: number
    score_ready: number
    missing_score: number
    invalid_team: number
    invalid_date: number
  }
}

export type CampaignVector = {
  games_played: number
  wins: number
  draws: number
  losses: number
  goals_for: number
  goals_against: number
  points: number
}

export type FixtureGroup = {
  key: string
  kind_raw: number
  season_marker: PackedFmDate
  fixtures: FixtureRecord[]
  team_ids: number[]
  complete: boolean
  completeness_reasons: string[]
  campaign: Map<number, CampaignVector>
}

export type StandingMatchAttempt = {
  rows: Array<{
    row: CompetitionStandingRow
    team_id: number | null
    identity_status: StandingIdentityStatus
    candidate_team_ids: number[]
  }>
  fully_unique: boolean
  unique_team_count: number
}

type CompetitionIdentityRecord = {
  internal_competition_id: number
  public_uid_1: number
  public_uid_2: number
  source_offset: number
  variant_bytes: [number, number]
}

export type CompetitionIdentityResolution = {
  competition_uid: number | null
  status: CompetitionIdentityStatus
  candidate_count: number
  candidates: CompetitionIdentityRecord[]
}

type CompHistoryRecord = {
  competition_id_raw: number
  season_end_year: number
  raw_6: number
  champion_team_id: number
  runner_up_team_id: number
  third_place_team_id: number
  raw_20: number
  source_offset: number
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + bytes[offset + 3] * 0x1000000) >>> 0
}

function bytesEqualAt(bytes: Uint8Array, offset: number, pattern: Uint8Array): boolean {
  if (offset < 0 || offset + pattern.length > bytes.length) return false
  for (let i = 0; i < pattern.length; i++) if (bytes[offset + i] !== pattern[i]) return false
  return true
}

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100
}

export function decodePackedFmDate(raw: number): PackedFmDate | null {
  const year = raw >>> 16
  const dayOfYear = raw & 0x01ff
  const flags = raw & 0xfe00
  if (year < 1900 || year > 2400 || dayOfYear < 1 || dayOfYear > 366) return null
  return { raw: raw >>> 0, year, day_of_year: dayOfYear, flags }
}

export function parseLeagueHistoryRecords(
  bytes: Uint8Array,
  options: { headerBytes?: number } = {},
): LeagueHistoryRecord[] {
  const headerBytes = options.headerBytes ?? LEAGUE_HISTORY_HEADER_SIZE
  if (headerBytes < 0 || bytes.length < headerBytes || (bytes.length - headerBytes) % LEAGUE_HISTORY_RECORD_SIZE !== 0) {
    throw new Error(`tc_league_history_dt.cmt has invalid header/stride: ${bytes.length} bytes`)
  }
  const records: LeagueHistoryRecord[] = []
  for (let offset = headerBytes; offset + LEAGUE_HISTORY_RECORD_SIZE <= bytes.length; offset += LEAGUE_HISTORY_RECORD_SIZE) {
    records.push({
      season_end_year: u16(bytes, offset),
      competition_id_raw: u16(bytes, offset + 2),
      rank_slot: u32(bytes, offset + 4),
      raw_8: u32(bytes, offset + 8),
      games_played: bytes[offset + 12],
      raw_13: bytes[offset + 13],
      wins: bytes[offset + 14],
      draws: bytes[offset + 15],
      losses: bytes[offset + 16],
      raw_17: bytes[offset + 17],
      goals_for: u16(bytes, offset + 18),
      goals_against: u16(bytes, offset + 20),
      points: u16(bytes, offset + 22),
      source_offset: offset,
    })
  }
  return records
}

export function groupLeagueHistoryRecords(records: LeagueHistoryRecord[]): LeagueHistoryGroup[] {
  const byGroup = new Map<string, LeagueHistoryRecord[]>()
  for (const record of records) {
    const key = `${record.season_end_year}:${record.competition_id_raw}`
    const list = byGroup.get(key) ?? []
    list.push(record)
    byGroup.set(key, list)
  }

  const groups: LeagueHistoryGroup[] = []
  for (const list of byGroup.values()) {
    const sorted = [...list].sort((a, b) => a.rank_slot - b.rank_slot || a.source_offset - b.source_offset)
    const reasons: string[] = []
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].rank_slot !== sorted[i - 1].rank_slot + 1) {
        reasons.push('rank_slots_not_consecutive')
        break
      }
    }

    const hasPlaceholder = sorted.some((r) => r.games_played === 0xff)
    if (hasPlaceholder) reasons.push('games_played_placeholder_255')

    const algebraInvalid = sorted.some((r) =>
      r.games_played !== 0xff &&
      (r.games_played !== r.wins + r.draws + r.losses || r.points !== 3 * r.wins + r.draws),
    )
    if (algebraInvalid) reasons.push('campaign_algebra_mismatch')

    const status: LeagueHistoryGroup['status'] = hasPlaceholder
      ? 'unclosed'
      : reasons.length
        ? 'invalid'
        : 'closed'

    const rows: CompetitionStandingRow[] = sorted.map((r, index) => ({
      position: index + 1,
      rank_slot: r.rank_slot,
      team_id: null,
      identity_status: 'unresolved',
      games_played: r.games_played,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      goals_for: r.goals_for,
      goals_against: r.goals_against,
      goal_difference: r.goals_for - r.goals_against,
      points: r.points,
      raw_8: r.raw_8,
      raw_13: r.raw_13,
      raw_17: r.raw_17,
      source_offset: r.source_offset,
    }))

    groups.push({
      season_end_year: sorted[0]?.season_end_year ?? 0,
      competition_id_raw: sorted[0]?.competition_id_raw ?? 0,
      records: sorted,
      rows,
      status,
      reasons,
    })
  }

  groups.sort((a, b) => a.season_end_year - b.season_end_year || a.competition_id_raw - b.competition_id_raw)
  return groups
}

export function parseFixIndexEntries(bytes: Uint8Array, baseOffset = 0): FixIndexEntry[] {
  if (bytes.length % FIX_INDEX_ENTRY_SIZE !== 0) throw new Error('fix_man index stride is not 14 bytes')
  const entries: FixIndexEntry[] = []
  for (let offset = 0; offset < bytes.length; offset += FIX_INDEX_ENTRY_SIZE) {
    entries.push({
      bucket_id: u32(bytes, offset),
      year: u16(bytes, offset + 4),
      compressed_offset: u32(bytes, offset + 6),
      compressed_length: u32(bytes, offset + 10),
      source_offset: baseOffset + offset,
    })
  }
  return entries
}

function isPlausibleIndexEntry(bytes: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + FIX_INDEX_ENTRY_SIZE > bytes.length) return false
  const bucket = u32(bytes, offset)
  const year = u16(bytes, offset + 4)
  const compressedOffset = u32(bytes, offset + 6)
  const compressedLength = u32(bytes, offset + 10)
  return bucket < FIX_BUCKETS_PER_YEAR && year >= 1900 && year <= 2400 && compressedLength > 0 && compressedOffset + compressedLength <= bytes.length
}

function parseValidYearBlock(bytes: Uint8Array, start: number): FixIndexEntry[] | null {
  const blockLength = FIX_BUCKETS_PER_YEAR * FIX_INDEX_ENTRY_SIZE
  if (start < 0 || start + blockLength > bytes.length || !isPlausibleIndexEntry(bytes, start)) return null
  const year = u16(bytes, start + 4)
  const buckets = new Set<number>()
  const entries: FixIndexEntry[] = []
  for (let index = 0; index < FIX_BUCKETS_PER_YEAR; index++) {
    const offset = start + index * FIX_INDEX_ENTRY_SIZE
    if (!isPlausibleIndexEntry(bytes, offset) || u16(bytes, offset + 4) !== year) return null
    const bucketId = u32(bytes, offset)
    if (buckets.has(bucketId)) return null
    buckets.add(bucketId)
    entries.push({
      bucket_id: bucketId,
      year,
      compressed_offset: u32(bytes, offset + 6),
      compressed_length: u32(bytes, offset + 10),
      source_offset: offset,
    })
  }
  if (buckets.size !== FIX_BUCKETS_PER_YEAR) return null
  for (let bucket = 0; bucket < FIX_BUCKETS_PER_YEAR; bucket++) if (!buckets.has(bucket)) return null
  return entries
}

type StructuralIndexSequence = { start: number; entries: FixIndexEntry[]; years: number[] }

function findStructuralIndexSequences(bytes: Uint8Array): StructuralIndexSequence[] {
  const blockLength = FIX_BUCKETS_PER_YEAR * FIX_INDEX_ENTRY_SIZE
  const validBlocks = new Map<number, FixIndexEntry[]>()

  for (let alignment = 0; alignment < FIX_INDEX_ENTRY_SIZE; alignment++) {
    for (let offset = alignment; offset + blockLength <= bytes.length; offset += FIX_INDEX_ENTRY_SIZE) {
      if (!isPlausibleIndexEntry(bytes, offset)) continue
      const block = parseValidYearBlock(bytes, offset)
      if (block) validBlocks.set(offset, block)
    }
  }

  const starts = [...validBlocks.keys()].sort((a, b) => a - b)
  const sequences: StructuralIndexSequence[] = []
  for (const start of starts) {
    // Only a maximal contiguous run can be the full index. Treating every
    // suffix/prefix as an independent candidate makes any genuine multi-year
    // index appear ambiguous because suffixes share the same real archive
    // start. A candidate therefore cannot have another valid annual block
    // immediately to its left.
    if (validBlocks.has(start - blockLength)) continue

    const blocks: FixIndexEntry[][] = []
    let cursor = start
    while (validBlocks.has(cursor)) {
      blocks.push(validBlocks.get(cursor)!)
      cursor += blockLength
    }
    if (!blocks.length) continue

    const years = blocks.map((block) => block[0].year)
    if (new Set(years).size !== years.length) continue
    sequences.push({ start, entries: blocks.flat(), years })
  }

  const unique = new Map<string, StructuralIndexSequence>()
  for (const candidate of sequences) {
    const key = `${candidate.start}:${candidate.entries.length}`
    unique.set(key, candidate)
  }
  return [...unique.values()]
}

async function validateFramingCandidate(
  bytes: Uint8Array,
  candidate: StructuralIndexSequence,
  decompress: ZstdDecompress,
  decompressionCache: Map<string, Uint8Array>,
): Promise<FixManFraming | null> {
  const indexEnd = candidate.start + candidate.entries.length * FIX_INDEX_ENTRY_SIZE
  const bridgeStart = indexEnd
  const archiveStart = bridgeStart + FIX_BRIDGE_SIZE
  if (archiveStart > bytes.length) return null

  const intervals = candidate.entries.map((entry) => {
    const absoluteStart = archiveStart + entry.compressed_offset
    const absoluteEnd = absoluteStart + entry.compressed_length
    return { entry, absoluteStart, absoluteEnd }
  })

  for (const interval of intervals) {
    if (interval.absoluteStart < archiveStart || interval.absoluteEnd > bytes.length) return null
    if (!bytesEqualAt(bytes, interval.absoluteStart, ZSTD_MAGIC)) return null
  }

  const sortedIntervals = [...intervals].sort((a, b) => a.absoluteStart - b.absoluteStart || a.absoluteEnd - b.absoluteEnd)
  for (let i = 1; i < sortedIntervals.length; i++) {
    if (sortedIntervals[i].absoluteStart < sortedIntervals[i - 1].absoluteEnd) return null
  }

  const frames: FixManFraming['frames'] = []
  for (const interval of intervals) {
    const key = `${interval.absoluteStart}:${interval.entry.compressed_length}`
    let plain = decompressionCache.get(key)
    if (!plain) {
      try {
        const frame = bytes.subarray(interval.absoluteStart, interval.absoluteEnd)
        const decoded = await decompress(frame, 0)
        plain = decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded)
        decompressionCache.set(key, plain)
      } catch {
        return null
      }
    }
    frames.push({ entry: interval.entry, absolute_offset: interval.absoluteStart, plain })
  }

  const archivePayloadEnd = sortedIntervals.length
    ? Math.max(...sortedIntervals.map((interval) => interval.absoluteEnd))
    : archiveStart

  return {
    index_start: candidate.start,
    index_end: indexEnd,
    index_entry_count: candidate.entries.length,
    year_labels: candidate.years,
    bridge_start: bridgeStart,
    bridge_length: FIX_BRIDGE_SIZE,
    archive_start: archiveStart,
    archive_payload_end: archivePayloadEnd,
    trailer_length: Math.max(0, bytes.length - archivePayloadEnd),
    entries: candidate.entries,
    frames,
  }
}

export async function detectFixManFraming(bytes: Uint8Array, decompress: ZstdDecompress): Promise<FixManFramingDetection> {
  const structural = findStructuralIndexSequences(bytes)
  const valid: FixManFraming[] = []
  const cache = new Map<string, Uint8Array>()

  for (const candidate of structural) {
    const framing = await validateFramingCandidate(bytes, candidate, decompress, cache)
    if (framing) valid.push(framing)
  }

  if (valid.length === 1) {
    return { status: 'confirmed', candidate_count: 1, framing: valid[0], diagnostics: [] }
  }
  if (valid.length > 1) {
    return {
      status: 'ambiguous',
      candidate_count: valid.length,
      framing: null,
      diagnostics: [`Multiple complete fix_man framings passed all gates: ${valid.length}`],
    }
  }
  return {
    status: 'unresolved',
    candidate_count: 0,
    framing: null,
    diagnostics: ['No complete fix_man framing passed all gates'],
  }
}

function findMarkerOffsets(bytes: Uint8Array, marker: number): number[] {
  const offsets: number[] = []
  let offset = bytes.indexOf(marker)
  while (offset >= 0) {
    offsets.push(offset)
    offset = bytes.indexOf(marker, offset + 1)
  }
  return offsets
}

function validScoreAt(bytes: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + SCORE_RECORD_SIZE > bytes.length || bytes[offset] !== 0x1c) return false
  if (bytes[offset + 6] !== 0xff || bytes[offset + 7] !== 0xff || bytes[offset + 8] !== 0xff) return false
  if (bytes[offset + 10] !== 0xff || bytes[offset + 11] !== 0xff || bytes[offset + 12] !== 0xff) return false
  return bytes[offset + 5] <= MAX_VALID_SCORE && bytes[offset + 9] <= MAX_VALID_SCORE
}

export function scanFixtureBuffer(
  bytes: Uint8Array,
  provenance: Omit<FixtureProvenance, 'source_offset' | 'archive_plain_offset'> & { base_offset?: number } = { source: 'live' },
): FixtureScanResult {
  const markers = findMarkerOffsets(bytes, 0x1c)
  const fixtures: FixtureRecord[] = []
  const diagnostics = { fixture_like: 0, score_ready: 0, missing_score: 0, invalid_team: 0, invalid_date: 0 }

  for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
    const offset = markers[markerIndex]
    if (offset + FIXTURE_RECORD_MIN_SIZE > bytes.length) continue

    const teamA = u32(bytes, offset + 12)
    const teamB = u32(bytes, offset + 19)
    const date1 = decodePackedFmDate(u32(bytes, offset + 25))
    const date2 = decodePackedFmDate(u32(bytes, offset + 29))

    const fixtureShape = teamA > 0 && teamA < MAX_STRUCTURAL_TEAM_ID && teamB > 0 && teamB < MAX_STRUCTURAL_TEAM_ID && teamA !== teamB
    if (!fixtureShape && (!date1 || !date2)) continue
    diagnostics.fixture_like++

    if (!fixtureShape) {
      diagnostics.invalid_team++
      continue
    }
    if (!date1 || !date2) {
      diagnostics.invalid_date++
      continue
    }

    let scoreOffset: number | null = null
    for (let priorIndex = markerIndex - 1; priorIndex >= 0; priorIndex--) {
      const candidate = markers[priorIndex]
      if (offset - candidate > SCORE_PREDECESSOR_WINDOW) break
      if (candidate + SCORE_RECORD_SIZE > offset) continue
      if (validScoreAt(bytes, candidate)) {
        scoreOffset = candidate
        break
      }
    }

    if (scoreOffset == null) {
      diagnostics.missing_score++
      continue
    }

    const baseOffset = provenance.base_offset ?? 0
    const fixtureSourceOffset = baseOffset + offset
    const occurrence: FixtureProvenance = provenance.source === 'archive'
      ? {
          source: 'archive',
          source_offset: fixtureSourceOffset,
          archive_year: provenance.archive_year,
          archive_bucket: provenance.archive_bucket,
          archive_compressed_offset: provenance.archive_compressed_offset,
          archive_plain_offset: offset,
        }
      : { source: 'live', source_offset: fixtureSourceOffset }

    fixtures.push({
      kind_raw: u32(bytes, offset + 1),
      team_a: teamA,
      team_b: teamB,
      packed_date_1: date1,
      packed_date_2: date2,
      score_a: bytes[scoreOffset + 5],
      score_b: bytes[scoreOffset + 9],
      fixture_offset: fixtureSourceOffset,
      score_offset: baseOffset + scoreOffset,
      provenance: [occurrence],
    })
    diagnostics.score_ready++
  }

  return { fixtures, diagnostics }
}

function fixtureSemanticKey(fixture: FixtureRecord): string {
  return [
    fixture.kind_raw,
    fixture.packed_date_1.raw,
    fixture.packed_date_2.raw,
    fixture.team_a,
    fixture.team_b,
    fixture.score_a,
    fixture.score_b,
  ].join(':')
}

export function deduplicateFixtures(fixtures: FixtureRecord[]): FixtureRecord[] {
  const unique = new Map<string, FixtureRecord>()
  for (const fixture of fixtures) {
    const key = fixtureSemanticKey(fixture)
    const prior = unique.get(key)
    if (!prior) {
      unique.set(key, { ...fixture, provenance: [...fixture.provenance] })
      continue
    }
    const seen = new Set(prior.provenance.map((p) => `${p.source}:${p.source_offset}:${p.archive_year ?? ''}:${p.archive_bucket ?? ''}`))
    for (const item of fixture.provenance) {
      const provenanceKey = `${item.source}:${item.source_offset}:${item.archive_year ?? ''}:${item.archive_bucket ?? ''}`
      if (!seen.has(provenanceKey)) {
        prior.provenance.push(item)
        seen.add(provenanceKey)
      }
    }
  }
  return [...unique.values()]
}

export function aggregateCampaign(fixtures: FixtureRecord[]): Map<number, CampaignVector> {
  const campaign = new Map<number, CampaignVector>()
  const ensure = (teamId: number): CampaignVector => {
    const existing = campaign.get(teamId)
    if (existing) return existing
    const created = { games_played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, points: 0 }
    campaign.set(teamId, created)
    return created
  }

  for (const fixture of fixtures) {
    const a = ensure(fixture.team_a)
    const b = ensure(fixture.team_b)
    a.games_played++
    b.games_played++
    a.goals_for += fixture.score_a
    a.goals_against += fixture.score_b
    b.goals_for += fixture.score_b
    b.goals_against += fixture.score_a
    if (fixture.score_a > fixture.score_b) {
      a.wins++
      b.losses++
      a.points += 3
    } else if (fixture.score_a < fixture.score_b) {
      b.wins++
      a.losses++
      b.points += 3
    } else {
      a.draws++
      b.draws++
      a.points++
      b.points++
    }
  }
  return campaign
}

function fixtureGroupKey(fixture: FixtureRecord): string {
  return `${fixture.kind_raw}:${fixture.packed_date_2.raw}`
}

export function buildFixtureGroups(fixtures: FixtureRecord[]): FixtureGroup[] {
  const byGroup = new Map<string, FixtureRecord[]>()
  for (const fixture of fixtures) {
    const key = fixtureGroupKey(fixture)
    const list = byGroup.get(key) ?? []
    list.push(fixture)
    byGroup.set(key, list)
  }

  const groups: FixtureGroup[] = []
  for (const [key, list] of byGroup.entries()) {
    const teamIds = [...new Set(list.flatMap((fixture) => [fixture.team_a, fixture.team_b]))].sort((a, b) => a - b)
    const n = teamIds.length
    const reasons: string[] = []
    const expectedFixtures = n > 1 ? n * (n - 1) : 0
    if (n < 2 || list.length !== expectedFixtures) reasons.push('fixture_count_mismatch')

    const gamesByTeam = new Map<number, number>(teamIds.map((teamId) => [teamId, 0]))
    const meetings = new Map<string, number>()
    for (const fixture of list) {
      gamesByTeam.set(fixture.team_a, (gamesByTeam.get(fixture.team_a) ?? 0) + 1)
      gamesByTeam.set(fixture.team_b, (gamesByTeam.get(fixture.team_b) ?? 0) + 1)
      const a = Math.min(fixture.team_a, fixture.team_b)
      const b = Math.max(fixture.team_a, fixture.team_b)
      const pairKey = `${a}:${b}`
      meetings.set(pairKey, (meetings.get(pairKey) ?? 0) + 1)
    }

    if (n >= 2 && [...gamesByTeam.values()].some((games) => games !== 2 * (n - 1))) reasons.push('games_per_team_mismatch')
    if (n >= 2 && (meetings.size !== (n * (n - 1)) / 2 || [...meetings.values()].some((count) => count !== 2))) {
      reasons.push('pair_meetings_mismatch')
    }

    groups.push({
      key,
      kind_raw: list[0].kind_raw,
      season_marker: list[0].packed_date_2,
      fixtures: list,
      team_ids: teamIds,
      complete: reasons.length === 0,
      completeness_reasons: reasons,
      campaign: aggregateCampaign(list),
    })
  }
  return groups
}

function vectorKey(vector: CampaignVector): string {
  return [
    vector.games_played,
    vector.wins,
    vector.draws,
    vector.losses,
    vector.goals_for,
    vector.goals_against,
    vector.points,
  ].join(':')
}

function rowVector(row: CompetitionStandingRow): CampaignVector {
  return {
    games_played: row.games_played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    goals_for: row.goals_for,
    goals_against: row.goals_against,
    points: row.points,
  }
}

export function matchStandingRowsToCampaign(
  rows: CompetitionStandingRow[],
  campaign: Map<number, CampaignVector>,
): StandingMatchAttempt {
  const byVector = new Map<string, number[]>()
  for (const [teamId, vector] of campaign.entries()) {
    const key = vectorKey(vector)
    const list = byVector.get(key) ?? []
    list.push(teamId)
    byVector.set(key, list)
  }

  const matched = rows.map((row) => {
    const candidates = [...(byVector.get(vectorKey(rowVector(row))) ?? [])].sort((a, b) => a - b)
    if (candidates.length === 1) {
      return { row, team_id: candidates[0], identity_status: 'confirmed' as const, candidate_team_ids: candidates }
    }
    if (candidates.length > 1) {
      return { row, team_id: null, identity_status: 'ambiguous' as const, candidate_team_ids: candidates }
    }
    return { row, team_id: null, identity_status: 'unresolved' as const, candidate_team_ids: candidates }
  })
  const teamIds = matched.flatMap((item) => item.team_id == null ? [] : [item.team_id])
  const uniqueTeamCount = new Set(teamIds).size
  return {
    rows: matched,
    fully_unique: matched.length > 0 && matched.every((item) => item.identity_status === 'confirmed') && uniqueTeamCount === rows.length,
    unique_team_count: uniqueTeamCount,
  }
}

export function buildCompetitionIdentityIndex(gameDb: Uint8Array): Map<number, CompetitionIdentityRecord[]> {
  const index = new Map<number, CompetitionIdentityRecord[]>()
  let offset = gameDb.indexOf(COMPETITION_IDENTITY_PREFIX[0])
  while (offset >= 0) {
    if (offset + 23 <= gameDb.length && bytesEqualAt(gameDb, offset, COMPETITION_IDENTITY_PREFIX) && gameDb[offset + 10] === 0xff) {
      const record: CompetitionIdentityRecord = {
        internal_competition_id: u32(gameDb, offset + 11),
        public_uid_1: u32(gameDb, offset + 15),
        public_uid_2: u32(gameDb, offset + 19),
        source_offset: offset,
        variant_bytes: [gameDb[offset + 8], gameDb[offset + 9]],
      }
      const list = index.get(record.internal_competition_id) ?? []
      list.push(record)
      index.set(record.internal_competition_id, list)
    }
    offset = gameDb.indexOf(COMPETITION_IDENTITY_PREFIX[0], offset + 1)
  }
  return index
}

export function resolveCompetitionIdentity(
  competitionIdRaw: number,
  index: Map<number, CompetitionIdentityRecord[]>,
): CompetitionIdentityResolution {
  const candidates = [...(index.get(competitionIdRaw) ?? [])]
  if (candidates.length === 0) return { competition_uid: null, status: 'unresolved', candidate_count: 0, candidates }
  if (candidates.length > 1) return { competition_uid: null, status: 'ambiguous', candidate_count: candidates.length, candidates }
  const [candidate] = candidates
  if (candidate.public_uid_1 !== candidate.public_uid_2) {
    return { competition_uid: null, status: 'unresolved', candidate_count: 1, candidates }
  }
  return { competition_uid: candidate.public_uid_1, status: 'confirmed', candidate_count: 1, candidates }
}

export function parseCompHistoryRecords(
  bytes: Uint8Array,
  options: { headerBytes?: number } = {},
): CompHistoryRecord[] {
  const headerBytes = options.headerBytes ?? COMP_HISTORY_HEADER_SIZE
  if (headerBytes < 0 || bytes.length < headerBytes || (bytes.length - headerBytes) % COMP_HISTORY_RECORD_SIZE !== 0) {
    throw new Error(`comp_history_dt.cmt has invalid header/stride: ${bytes.length} bytes`)
  }
  const records: CompHistoryRecord[] = []
  for (let offset = headerBytes; offset + COMP_HISTORY_RECORD_SIZE <= bytes.length; offset += COMP_HISTORY_RECORD_SIZE) {
    records.push({
      competition_id_raw: u32(bytes, offset),
      season_end_year: u16(bytes, offset + 4),
      raw_6: u16(bytes, offset + 6),
      champion_team_id: u32(bytes, offset + 8),
      runner_up_team_id: u32(bytes, offset + 12),
      third_place_team_id: u32(bytes, offset + 16),
      raw_20: u32(bytes, offset + 20),
      source_offset: offset,
    })
  }
  return records
}

function buildCompHistoryIndex(records: CompHistoryRecord[]): Map<string, CompHistoryRecord[]> {
  const index = new Map<string, CompHistoryRecord[]>()
  for (const record of records) {
    const key = `${record.season_end_year}:${record.competition_id_raw}`
    const list = index.get(key) ?? []
    list.push(record)
    index.set(key, list)
  }
  return index
}

function resolvePodium(
  group: LeagueHistoryGroup,
  rows: CompetitionStandingRow[],
  index: Map<string, CompHistoryRecord[]>,
): { podium: CompetitionPodium | null; reason: string | null } {
  if (group.status !== 'closed') return { podium: null, reason: 'table_not_closed' }
  const candidates = index.get(`${group.season_end_year}:${group.competition_id_raw}`) ?? []
  if (candidates.length === 0) return { podium: null, reason: 'comp_history_record_absent' }
  if (candidates.length > 1) return { podium: null, reason: 'comp_history_record_ambiguous' }

  const record = candidates[0]
  const top3 = rows.slice(0, 3).map((row) => row.team_id)
  const canCompare = top3.length === 3 && top3.every((teamId): teamId is number => teamId != null)
  const sourceTop3 = [record.champion_team_id, record.runner_up_team_id, record.third_place_team_id]
  const status: CompetitionPodium['status'] = !canCompare
    ? 'unresolved'
    : top3.every((teamId, index) => teamId === sourceTop3[index])
      ? 'confirmed'
      : 'conflict'

  return {
    podium: {
      champion_team_id: record.champion_team_id || null,
      runner_up_team_id: record.runner_up_team_id || null,
      third_place_team_id: record.third_place_team_id || null,
      source: 'comp_history_dt.cmt',
      status,
      source_offset: record.source_offset,
      raw_6: record.raw_6,
      raw_20: record.raw_20,
    },
    reason: status === 'conflict' ? 'top3_conflict' : status === 'unresolved' ? 'table_identity_unresolved' : null,
  }
}

function initialDiagnostics(input: CompetitionHistoryInput): CompetitionHistoryDiagnostics {
  return {
    members: {
      fix_man: input.fixMan ? 'available' : 'missing',
      league_history: input.leagueHistory ? 'available' : 'missing',
      comp_history: input.compHistory ? 'available' : 'missing',
      game_db: input.gameDb ? 'available' : 'missing',
    },
    league_history: {},
    fix_man: {},
    competition_identity: {},
    comp_history: {},
    matching: {},
    timings_ms: {},
    warnings: [],
    errors: [],
  }
}

function computeOverallStatus(seasons: CompetitionSeason[], diagnostics: CompetitionHistoryDiagnostics): CompetitionHistoryStatus {
  if (!seasons.length) return 'unresolved'
  const meaningful = seasons.filter((season) => season.table_status !== 'unresolved')
  if (!meaningful.length) return 'unresolved'
  // `confirmed` describes the whole sidecar, not just the subset of usable
  // tables. Any unclosed/unsupported season remains visible and keeps the
  // aggregate capability partial instead of being silently ignored.
  const allFullyResolved = seasons.every((season) =>
    season.table_status === 'confirmed' &&
    season.fixture_status === 'confirmed' &&
    season.competition_identity_status === 'confirmed' &&
    (season.podium == null || season.podium.status === 'confirmed'),
  )
  const optionalMembersAvailable = diagnostics.members.fix_man === 'available' && diagnostics.members.game_db === 'available' && diagnostics.members.comp_history === 'available'
  return allFullyResolved && optionalMembersAvailable ? 'confirmed' : 'partial'
}

export async function readCompetitionHistory(input: CompetitionHistoryInput): Promise<CompetitionHistory> {
  const totalStart = performance.now()
  const diagnostics = initialDiagnostics(input)

  if (!input.leagueHistory) {
    diagnostics.errors.push('tc_league_history_dt.cmt is unavailable')
    diagnostics.timings_ms.total = elapsedMs(totalStart)
    return { version: COMPETITION_HISTORY_VERSION, status: 'unresolved', seasons: [], diagnostics }
  }

  let leagueRecords: LeagueHistoryRecord[]
  let tableGroups: LeagueHistoryGroup[]
  const leagueStart = performance.now()
  try {
    leagueRecords = parseLeagueHistoryRecords(input.leagueHistory)
    tableGroups = groupLeagueHistoryRecords(leagueRecords)
    diagnostics.league_history = {
      record_count: leagueRecords.length,
      group_count: tableGroups.length,
      closed_groups: tableGroups.filter((group) => group.status === 'closed').length,
      unclosed_groups: tableGroups.filter((group) => group.status === 'unclosed').length,
      invalid_groups: tableGroups.filter((group) => group.status === 'invalid').length,
    }
  } catch (error) {
    diagnostics.members.league_history = 'invalid'
    diagnostics.errors.push(error instanceof Error ? error.message : String(error))
    diagnostics.timings_ms.league_history = elapsedMs(leagueStart)
    diagnostics.timings_ms.total = elapsedMs(totalStart)
    return { version: COMPETITION_HISTORY_VERSION, status: 'unresolved', seasons: [], diagnostics }
  }
  diagnostics.timings_ms.league_history = elapsedMs(leagueStart)

  const identityStart = performance.now()
  const identityIndex = input.gameDb ? buildCompetitionIdentityIndex(input.gameDb) : new Map<number, CompetitionIdentityRecord[]>()
  diagnostics.competition_identity = {
    indexed_internal_ids: identityIndex.size,
    indexed_records: [...identityIndex.values()].reduce((sum, records) => sum + records.length, 0),
  }
  if (!input.gameDb) diagnostics.warnings.push('game_db.dat unavailable; competition UID identity remains unresolved')
  diagnostics.timings_ms.competition_identity = elapsedMs(identityStart)

  const compHistoryStart = performance.now()
  let compHistoryIndex = new Map<string, CompHistoryRecord[]>()
  if (input.compHistory) {
    try {
      const records = parseCompHistoryRecords(input.compHistory)
      compHistoryIndex = buildCompHistoryIndex(records)
      diagnostics.comp_history = { record_count: records.length, key_count: compHistoryIndex.size }
    } catch (error) {
      diagnostics.members.comp_history = 'invalid'
      diagnostics.warnings.push(error instanceof Error ? error.message : String(error))
      diagnostics.comp_history = { status: 'invalid' }
    }
  } else {
    diagnostics.comp_history = { status: 'missing' }
  }
  diagnostics.timings_ms.comp_history = elapsedMs(compHistoryStart)

  const fixtureStart = performance.now()
  let fixtureGroups: FixtureGroup[] = []
  let uniqueFixtures: FixtureRecord[] = []
  if (input.fixMan && input.decompress) {
    try {
      const framingDetection = await detectFixManFraming(input.fixMan, input.decompress)
      diagnostics.fix_man = {
        framing_status: framingDetection.status,
        framing_candidates: framingDetection.candidate_count,
        framing_diagnostics: framingDetection.diagnostics,
        score_predecessor_window: SCORE_PREDECESSOR_WINDOW,
      }
      if (framingDetection.status === 'confirmed' && framingDetection.framing) {
        const framing = framingDetection.framing
        const live = scanFixtureBuffer(input.fixMan.subarray(0, framing.index_start), { source: 'live', base_offset: 0 })
        const archiveFixtures: FixtureRecord[] = []
        const archiveDiagnostics = { fixture_like: 0, score_ready: 0, missing_score: 0, invalid_team: 0, invalid_date: 0 }
        for (const frame of framing.frames) {
          const scan = scanFixtureBuffer(frame.plain, {
            source: 'archive',
            base_offset: 0,
            archive_year: frame.entry.year,
            archive_bucket: frame.entry.bucket_id,
            archive_compressed_offset: frame.entry.compressed_offset,
          })
          archiveFixtures.push(...scan.fixtures)
          for (const key of Object.keys(archiveDiagnostics) as Array<keyof typeof archiveDiagnostics>) archiveDiagnostics[key] += scan.diagnostics[key]
        }
        uniqueFixtures = deduplicateFixtures([...live.fixtures, ...archiveFixtures])
        fixtureGroups = buildFixtureGroups(uniqueFixtures)
        Object.assign(diagnostics.fix_man, {
          index_start: framing.index_start,
          index_entries: framing.index_entry_count,
          year_labels: framing.year_labels,
          archive_frames: framing.frames.length,
          archive_payload_end: framing.archive_payload_end,
          trailer_length: framing.trailer_length,
          live_scan: live.diagnostics,
          archive_scan: archiveDiagnostics,
          fixture_occurrences_score_ready: live.fixtures.length + archiveFixtures.length,
          fixtures_unique: uniqueFixtures.length,
          fixture_groups: fixtureGroups.length,
          fixture_groups_complete: fixtureGroups.filter((group) => group.complete).length,
        })
      }
    } catch (error) {
      diagnostics.members.fix_man = 'error'
      diagnostics.errors.push(`competition history fix_man error: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    diagnostics.fix_man = { status: 'missing_or_decompressor_unavailable' }
    if (!input.fixMan) diagnostics.warnings.push('rgman/fix_man.dat unavailable; standing row identities remain unresolved')
    else diagnostics.warnings.push('Zstd decompressor unavailable; fix_man framing remains unresolved')
  }
  diagnostics.timings_ms.fixtures = elapsedMs(fixtureStart)

  const matchingStart = performance.now()
  const completeGroupsByYearAndTeams = new Map<string, FixtureGroup[]>()
  const allGroupsByYearAndTeams = new Map<string, FixtureGroup[]>()
  for (const group of fixtureGroups) {
    const key = `${group.season_marker.year}:${group.team_ids.length}`
    const all = allGroupsByYearAndTeams.get(key) ?? []
    all.push(group)
    allGroupsByYearAndTeams.set(key, all)
    if (group.complete) {
      const complete = completeGroupsByYearAndTeams.get(key) ?? []
      complete.push(group)
      completeGroupsByYearAndTeams.set(key, complete)
    }
  }

  let confirmedAssociations = 0
  let ambiguousAssociations = 0
  let failedAssociations = 0

  const seasons: CompetitionSeason[] = tableGroups.map((tableGroup) => {
    const identity = resolveCompetitionIdentity(tableGroup.competition_id_raw, identityIndex)
    const teamCount = tableGroup.rows.length
    const expectedFixtureCount = teamCount > 1 ? teamCount * (teamCount - 1) : null
    let rows = tableGroup.rows.map((row) => ({ ...row }))
    let fixtureStatus: CompetitionFixtureStatus = 'unresolved'
    let tableStatus: CompetitionTableStatus = tableGroup.status === 'closed' ? 'partial' : 'unresolved'
    let fixtureKindRaw: number | null = null
    let resolvedFixtureCount = 0
    let selectedGroup: FixtureGroup | null = null
    const associationDiagnostics: Record<string, unknown> = {}

    if (tableGroup.status === 'closed') {
      const groupKey = `${tableGroup.season_end_year}:${teamCount}`
      const completeCandidates = completeGroupsByYearAndTeams.get(groupKey) ?? []
      const fullMatches: Array<{ group: FixtureGroup; attempt: StandingMatchAttempt }> = []
      for (const fixtureGroup of completeCandidates) {
        const attempt = matchStandingRowsToCampaign(rows, fixtureGroup.campaign)
        if (attempt.fully_unique) fullMatches.push({ group: fixtureGroup, attempt })
      }
      associationDiagnostics.complete_fixture_group_candidates = completeCandidates.length
      associationDiagnostics.full_campaign_matches = fullMatches.length

      if (fullMatches.length === 1) {
        const match = fullMatches[0]
        selectedGroup = match.group
        rows = match.attempt.rows.map(({ row, team_id }) => ({ ...row, team_id, identity_status: 'confirmed' }))
        fixtureStatus = 'confirmed'
        tableStatus = 'confirmed'
        fixtureKindRaw = selectedGroup.kind_raw
        resolvedFixtureCount = selectedGroup.fixtures.length
        confirmedAssociations++
      } else if (fullMatches.length > 1) {
        ambiguousAssociations++
        associationDiagnostics.reason = 'multiple_fixture_groups_match_full_table'
      } else {
        failedAssociations++
        const sameYearTeamCountGroups = allGroupsByYearAndTeams.get(groupKey) ?? []
        if (sameYearTeamCountGroups.some((group) => !group.complete)) fixtureStatus = 'incomplete'
        associationDiagnostics.reason = completeCandidates.length ? 'no_complete_fixture_group_matches_full_table' : 'no_complete_fixture_group_candidate'
      }
    }

    const podiumResolution = resolvePodium(tableGroup, rows, compHistoryIndex)
    const podium = podiumResolution.podium
    if (podiumResolution.reason) associationDiagnostics.podium = podiumResolution.reason

    return {
      season_end_year: tableGroup.season_end_year,
      competition_id_raw: tableGroup.competition_id_raw,
      competition_uid: identity.competition_uid,
      competition_identity_status: identity.status,
      fixture_status: fixtureStatus,
      table_status: tableStatus,
      fixture_kind_raw: fixtureKindRaw,
      team_count: teamCount,
      expected_fixture_count: expectedFixtureCount,
      resolved_fixture_count: resolvedFixtureCount,
      rows,
      podium,
      provenance: {
        table_source: 'tc_league_history_dt.cmt',
        table_record_offsets: tableGroup.records.map((record) => record.source_offset),
        table_group_status: tableGroup.status,
        table_group_reasons: tableGroup.reasons,
        competition_identity_candidates: identity.candidates.map((candidate) => ({
          source_offset: candidate.source_offset,
          variant_bytes: candidate.variant_bytes,
          public_uid_1: candidate.public_uid_1,
          public_uid_2: candidate.public_uid_2,
        })),
        fixture_group: selectedGroup
          ? {
              key: selectedGroup.key,
              kind_raw: selectedGroup.kind_raw,
              season_marker: selectedGroup.season_marker,
              fixture_count: selectedGroup.fixtures.length,
            }
          : null,
        association_diagnostics: associationDiagnostics,
      },
    }
  })

  diagnostics.matching = {
    table_groups: tableGroups.length,
    confirmed_associations: confirmedAssociations,
    ambiguous_associations: ambiguousAssociations,
    unresolved_associations: failedAssociations,
  }
  diagnostics.timings_ms.matching = elapsedMs(matchingStart)
  diagnostics.timings_ms.total = elapsedMs(totalStart)

  return {
    version: COMPETITION_HISTORY_VERSION,
    status: computeOverallStatus(seasons, diagnostics),
    seasons,
    diagnostics,
  }
}
