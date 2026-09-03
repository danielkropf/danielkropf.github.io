import { describe, expect, it } from 'vitest'
import {
  aggregateCampaign,
  buildCompetitionIdentityIndex,
  buildFixtureGroups,
  decodePackedFmDate,
  deduplicateFixtures,
  detectFixManFraming,
  groupLeagueHistoryRecords,
  matchStandingRowsToCampaign,
  parseCompHistoryRecords,
  parseLeagueHistoryRecords,
  readCompetitionHistory,
  resolveCompetitionIdentity,
  scanFixtureBuffer,
  type CompetitionStandingRow,
  type FixtureRecord,
} from './fm26-competition-history'

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

function writeU16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true)
}

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true)
}

function packedDate(year: number, dayOfYear: number, flags = 0) {
  return ((year << 16) | flags | dayOfYear) >>> 0
}

function leagueRow(values: {
  year?: number
  comp?: number
  slot?: number
  raw8?: number
  gp?: number
  raw13?: number
  w?: number
  d?: number
  l?: number
  raw17?: number
  gf?: number
  ga?: number
  pts?: number
}) {
  const bytes = new Uint8Array(24)
  writeU16(bytes, 0, values.year ?? 2028)
  writeU16(bytes, 2, values.comp ?? 51)
  writeU32(bytes, 4, values.slot ?? 5120)
  writeU32(bytes, 8, values.raw8 ?? 0xffffffff)
  bytes[12] = values.gp ?? 2
  bytes[13] = values.raw13 ?? 77
  bytes[14] = values.w ?? 1
  bytes[15] = values.d ?? 1
  bytes[16] = values.l ?? 0
  bytes[17] = values.raw17 ?? 9
  writeU16(bytes, 18, values.gf ?? 2)
  writeU16(bytes, 20, values.ga ?? 1)
  writeU16(bytes, 22, values.pts ?? 4)
  return bytes
}

function withHeader(records: Uint8Array[], headerSize = 8) {
  const total = headerSize + records.reduce((sum, record) => sum + record.length, 0)
  const bytes = new Uint8Array(total)
  let offset = headerSize
  for (const record of records) {
    bytes.set(record, offset)
    offset += record.length
  }
  return bytes
}

function standingRow(overrides: Partial<CompetitionStandingRow> = {}): CompetitionStandingRow {
  return {
    position: 1,
    rank_slot: 5120,
    team_id: null,
    identity_status: 'unresolved',
    games_played: 2,
    wins: 1,
    draws: 1,
    losses: 0,
    goals_for: 2,
    goals_against: 1,
    goal_difference: 1,
    points: 4,
    raw_8: 0xffffffff,
    raw_13: 0,
    raw_17: 0,
    source_offset: 8,
    ...overrides,
  }
}

function fixtureRecord(overrides: Partial<FixtureRecord> = {}): FixtureRecord {
  return {
    kind_raw: 999,
    team_a: 1,
    team_b: 2,
    packed_date_1: decodePackedFmDate(packedDate(2028, 10))!,
    packed_date_2: decodePackedFmDate(packedDate(2028, 142))!,
    score_a: 1,
    score_b: 0,
    fixture_offset: 20,
    score_offset: 0,
    provenance: [{ source: 'live', source_offset: 20 }],
    ...overrides,
  }
}

function fixtureWindow(values: {
  kind?: number
  teamA: number
  teamB: number
  scoreA: number
  scoreB: number
  year?: number
  seasonDay?: number
  matchDay?: number
  gap?: number
}) {
  const gap = values.gap ?? 7
  const fixtureOffset = 13 + gap
  const bytes = new Uint8Array(fixtureOffset + 33)
  bytes[0] = 0x1c
  bytes[5] = values.scoreA
  bytes.set([0xff, 0xff, 0xff], 6)
  bytes[9] = values.scoreB
  bytes.set([0xff, 0xff, 0xff], 10)
  bytes[fixtureOffset] = 0x1c
  writeU32(bytes, fixtureOffset + 1, values.kind ?? 999)
  writeU32(bytes, fixtureOffset + 12, values.teamA)
  writeU32(bytes, fixtureOffset + 19, values.teamB)
  writeU32(bytes, fixtureOffset + 25, packedDate(values.year ?? 2028, values.matchDay ?? 10))
  writeU32(bytes, fixtureOffset + 29, packedDate(values.year ?? 2028, values.seasonDay ?? 142))
  return bytes
}

function concatBytes(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function fakeFixMan(plainFrames: Uint8Array[] = [], options: { year?: number; years?: number[]; duplicateBucket?: boolean; invalidFrame?: boolean } = {}) {
  const years = options.years ?? [options.year ?? 2028]
  const prefix = new Uint8Array([7, 7, 7, 7, 7])
  const index = new Uint8Array(years.length * 66 * 14)
  const bridge = new Uint8Array(13)
  const frames: Uint8Array[] = []
  let compressedOffset = 0
  let frameIndex = 0
  for (const year of years) {
    for (let bucket = 0; bucket < 66; bucket++, frameIndex++) {
      const plain = plainFrames[frameIndex] ?? new Uint8Array()
      const frame = concatBytes([new Uint8Array(ZSTD_MAGIC), plain])
      if (options.invalidFrame && frameIndex === 0) frame[0] = 0
      frames.push(frame)
      const offset = frameIndex * 14
      writeU32(index, offset, options.duplicateBucket && frameIndex === years.length * 66 - 1 ? 64 : bucket)
      writeU16(index, offset + 4, year)
      writeU32(index, offset + 6, compressedOffset)
      writeU32(index, offset + 10, frame.length)
      compressedOffset += frame.length
    }
  }
  return concatBytes([prefix, index, bridge, ...frames, new Uint8Array([0])])
}

const fakeDecompress = async (frame: Uint8Array) => frame.subarray(4)

function identityRecord(raw: number, uid1: number, uid2 = uid1, variantA = 0, variantB = 0) {
  const bytes = new Uint8Array(23)
  bytes.set([0x01, 0x00, 0x6c, 0x07, 0x01, 0x00, 0x6c, 0x07], 0)
  bytes[8] = variantA
  bytes[9] = variantB
  bytes[10] = 0xff
  writeU32(bytes, 11, raw)
  writeU32(bytes, 15, uid1)
  writeU32(bytes, 19, uid2)
  return bytes
}

function compHistoryRecord(raw: number, year: number, top3: [number, number, number], raw20 = 1234) {
  const bytes = new Uint8Array(55)
  writeU32(bytes, 0, raw)
  writeU16(bytes, 4, year)
  writeU16(bytes, 6, year - 1)
  writeU32(bytes, 8, top3[0])
  writeU32(bytes, 12, top3[1])
  writeU32(bytes, 16, top3[2])
  writeU32(bytes, 20, raw20)
  return bytes
}

function twoTeamLeagueRows(comp = 51, year = 2028) {
  return withHeader([
    leagueRow({ year, comp, slot: 5120, gp: 2, w: 1, d: 1, l: 0, gf: 2, ga: 1, pts: 4 }),
    leagueRow({ year, comp, slot: 5121, gp: 2, w: 0, d: 1, l: 1, gf: 1, ga: 2, pts: 1 }),
  ])
}

function twoTeamFixturePlain(kind = 999, year = 2028, seasonDay = 142) {
  return concatBytes([
    fixtureWindow({ kind, teamA: 1, teamB: 2, scoreA: 1, scoreB: 0, year, seasonDay, matchDay: 10 }),
    fixtureWindow({ kind, teamA: 2, teamB: 1, scoreA: 1, scoreB: 1, year, seasonDay, matchDay: 20 }),
  ])
}

describe('tc_league_history_dt.cmt', () => {
  it('parses the confirmed 8-byte header + 24-byte stride and preserves raw fields', () => {
    const records = parseLeagueHistoryRecords(withHeader([leagueRow({ raw8: 0x12345678, raw13: 44, raw17: 55 })]))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ raw_8: 0x12345678, raw_13: 44, raw_17: 55, source_offset: 8 })
  })

  it('fails closed on an invalid stride', () => {
    expect(() => parseLeagueHistoryRecords(new Uint8Array(8 + 23))).toThrow(/invalid header\/stride/)
  })

  it('classifies games_played=255 as unclosed', () => {
    const group = groupLeagueHistoryRecords(parseLeagueHistoryRecords(withHeader([
      leagueRow({ gp: 255, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }),
    ])))[0]
    expect(group.status).toBe('unclosed')
  })

  it('rejects J != V+E+D', () => {
    const group = groupLeagueHistoryRecords(parseLeagueHistoryRecords(withHeader([
      leagueRow({ gp: 4, w: 1, d: 1, l: 1, pts: 4 }),
    ])))[0]
    expect(group.status).toBe('invalid')
    expect(group.reasons).toContain('campaign_algebra_mismatch')
  })

  it('rejects points incompatible with 3V+E', () => {
    const group = groupLeagueHistoryRecords(parseLeagueHistoryRecords(withHeader([
      leagueRow({ gp: 3, w: 1, d: 1, l: 1, pts: 5 }),
    ])))[0]
    expect(group.status).toBe('invalid')
  })
})

describe('fix_man framing', () => {
  it('returns zero framings when no index exists', async () => {
    const result = await detectFixManFraming(new Uint8Array(200), fakeDecompress)
    expect(result.status).toBe('unresolved')
    expect(result.candidate_count).toBe(0)
  })

  it('accepts exactly one structural framing', async () => {
    const result = await detectFixManFraming(fakeFixMan(), fakeDecompress)
    expect(result.status).toBe('confirmed')
    expect(result.framing?.index_entry_count).toBe(66)
    expect(result.framing?.trailer_length).toBe(1)
  })

  it('treats one multi-year index as one maximal framing rather than ambiguous suffixes', async () => {
    const result = await detectFixManFraming(fakeFixMan([], { years: [2026, 2027, 2028] }), fakeDecompress)
    expect(result.status).toBe('confirmed')
    expect(result.candidate_count).toBe(1)
    expect(result.framing?.index_entry_count).toBe(198)
    expect(result.framing?.year_labels).toEqual([2026, 2027, 2028])
  })

  it('accepts unique annual blocks even when year labels are not chronological', async () => {
    const result = await detectFixManFraming(fakeFixMan([], { years: [2026, 2024, 2025] }), fakeDecompress)
    expect(result.status).toBe('confirmed')
    expect(result.candidate_count).toBe(1)
    expect(result.framing?.index_entry_count).toBe(198)
    expect(result.framing?.year_labels).toEqual([2026, 2024, 2025])
  })

  it('fails closed when more than one full framing exists', async () => {
    const result = await detectFixManFraming(concatBytes([fakeFixMan(), fakeFixMan()]), fakeDecompress)
    expect(result.status).toBe('ambiguous')
    expect(result.candidate_count).toBeGreaterThan(1)
  })

  it('rejects an incomplete/duplicate bucket set', async () => {
    const result = await detectFixManFraming(fakeFixMan([], { duplicateBucket: true }), fakeDecompress)
    expect(result.status).toBe('unresolved')
  })

  it('rejects an indexed frame without Zstandard framing', async () => {
    const result = await detectFixManFraming(fakeFixMan([], { invalidFrame: true }), fakeDecompress)
    expect(result.status).toBe('unresolved')
  })
})

describe('fixture and score geometry', () => {
  it('requires the bounded predecessor score geometry', () => {
    const valid = scanFixtureBuffer(fixtureWindow({ teamA: 1, teamB: 2, scoreA: 2, scoreB: 1 }))
    expect(valid.fixtures).toHaveLength(1)
    expect(valid.fixtures[0]).toMatchObject({ team_a: 1, team_b: 2, score_a: 2, score_b: 1 })
  })

  it('does not use a fixture with no predecessor score', () => {
    const bytes = fixtureWindow({ teamA: 1, teamB: 2, scoreA: 2, scoreB: 1 })
    bytes[6] = 0
    expect(scanFixtureBuffer(bytes).fixtures).toHaveLength(0)
  })

  it('accepts the cross-save 157-byte predecessor boundary and rejects anything beyond it', () => {
    const atBoundary = fixtureWindow({ teamA: 1, teamB: 2, scoreA: 2, scoreB: 1, gap: 144 })
    expect(scanFixtureBuffer(atBoundary).fixtures).toHaveLength(1)

    const beyondBoundary = fixtureWindow({ teamA: 1, teamB: 2, scoreA: 2, scoreB: 1, gap: 145 })
    expect(scanFixtureBuffer(beyondBoundary).fixtures).toHaveLength(0)
  })

  it('deduplicates the same semantic fixture across live/archive provenance', () => {
    const base = fixtureRecord()
    const duplicate = { ...base, provenance: [{ source: 'archive' as const, source_offset: 55, archive_year: 2027, archive_bucket: 1 }] }
    const unique = deduplicateFixtures([base, duplicate])
    expect(unique).toHaveLength(1)
    expect(unique[0].provenance).toHaveLength(2)
  })
})

describe('round-robin completeness and campaign matching', () => {
  it('rejects an incomplete fixture group', () => {
    const groups = buildFixtureGroups([fixtureRecord()])
    expect(groups[0].complete).toBe(false)
  })

  it('accepts a complete double round-robin group', () => {
    const fixtures = [
      fixtureRecord({ team_a: 1, team_b: 2, score_a: 1, score_b: 0 }),
      fixtureRecord({ team_a: 2, team_b: 1, score_a: 1, score_b: 1, packed_date_1: decodePackedFmDate(packedDate(2028, 20))! }),
    ]
    const groups = buildFixtureGroups(fixtures)
    expect(groups[0].complete).toBe(true)
    expect(groups[0].campaign.get(1)).toMatchObject({ games_played: 2, wins: 1, draws: 1, points: 4 })
  })

  it('leaves zero Team matches unresolved', () => {
    const result = matchStandingRowsToCampaign([standingRow()], new Map())
    expect(result.rows[0].identity_status).toBe('unresolved')
    expect(result.rows[0].team_id).toBeNull()
  })

  it('resolves exactly one full-vector Team match', () => {
    const campaign = new Map([[99, { games_played: 2, wins: 1, draws: 1, losses: 0, goals_for: 2, goals_against: 1, points: 4 }]])
    const result = matchStandingRowsToCampaign([standingRow()], campaign)
    expect(result.rows[0]).toMatchObject({ team_id: 99, identity_status: 'confirmed' })
  })

  it('leaves multiple full-vector Team matches ambiguous', () => {
    const vector = { games_played: 2, wins: 1, draws: 1, losses: 0, goals_for: 2, goals_against: 1, points: 4 }
    const result = matchStandingRowsToCampaign([standingRow()], new Map([[10, vector], [20, vector]]))
    expect(result.rows[0].identity_status).toBe('ambiguous')
    expect(result.rows[0].team_id).toBeNull()
  })

  it('fails closed when multiple complete fixture groups satisfy the same table', async () => {
    const payloadA = twoTeamFixturePlain(900, 2028, 142)
    const payloadB = twoTeamFixturePlain(901, 2028, 143)
    const result = await readCompetitionHistory({
      leagueHistory: twoTeamLeagueRows(),
      fixMan: fakeFixMan([concatBytes([payloadA, payloadB])]),
      gameDb: identityRecord(51, 67),
      compHistory: withHeader([]),
      decompress: fakeDecompress,
    })
    const season = result.seasons.find((item) => item.competition_id_raw === 51)!
    expect(season.fixture_status).toBe('unresolved')
    expect(season.table_status).toBe('partial')
    expect(season.rows.every((row) => row.team_id == null)).toBe(true)
  })
})

describe('competition identity', () => {
  it('returns unresolved for zero candidates', () => {
    expect(resolveCompetitionIdentity(51, buildCompetitionIdentityIndex(new Uint8Array()))).toMatchObject({ status: 'unresolved', competition_uid: null })
  })

  it('confirms exactly one consistent duplicated UID', () => {
    expect(resolveCompetitionIdentity(51, buildCompetitionIdentityIndex(identityRecord(51, 67)))).toMatchObject({ status: 'confirmed', competition_uid: 67 })
  })

  it('fails ambiguous for more than one structural candidate', () => {
    const db = concatBytes([identityRecord(51, 67), identityRecord(51, 67, 67, 1, 2)])
    expect(resolveCompetitionIdentity(51, buildCompetitionIdentityIndex(db)).status).toBe('ambiguous')
  })

  it('rejects an inconsistent duplicated UID', () => {
    expect(resolveCompetitionIdentity(51, buildCompetitionIdentityIndex(identityRecord(51, 67, 68)))).toMatchObject({ status: 'unresolved', competition_uid: null })
  })
})

describe('comp_history and sidecar fail-closed behavior', () => {
  it('parses the 55-byte record from the confirmed +8 member header and preserves raw +20', () => {
    const records = parseCompHistoryRecords(withHeader([compHistoryRecord(51, 2028, [1, 2, 3], 444)]))
    expect(records[0]).toMatchObject({ competition_id_raw: 51, season_end_year: 2028, raw_20: 444, source_offset: 8 })
  })

  it('keeps podium null when no matching record exists', async () => {
    const result = await readCompetitionHistory({
      leagueHistory: twoTeamLeagueRows(),
      fixMan: fakeFixMan([twoTeamFixturePlain()]),
      gameDb: identityRecord(51, 67),
      compHistory: withHeader([]),
      decompress: fakeDecompress,
    })
    expect(result.seasons[0].podium).toBeNull()
  })

  it('confirms an independently matching top-3', async () => {
    const league = withHeader([
      leagueRow({ slot: 5120, gp: 4, w: 3, d: 1, l: 0, gf: 5, ga: 1, pts: 10 }),
      leagueRow({ slot: 5121, gp: 4, w: 2, d: 1, l: 1, gf: 4, ga: 2, pts: 7 }),
      leagueRow({ slot: 5122, gp: 4, w: 0, d: 0, l: 4, gf: 0, ga: 6, pts: 0 }),
    ])
    const fixtures = [
      fixtureWindow({ kind: 999, teamA: 1, teamB: 2, scoreA: 1, scoreB: 0, matchDay: 1 }),
      fixtureWindow({ kind: 999, teamA: 2, teamB: 1, scoreA: 1, scoreB: 1, matchDay: 2 }),
      fixtureWindow({ kind: 999, teamA: 1, teamB: 3, scoreA: 2, scoreB: 0, matchDay: 3 }),
      fixtureWindow({ kind: 999, teamA: 3, teamB: 1, scoreA: 0, scoreB: 1, matchDay: 4 }),
      fixtureWindow({ kind: 999, teamA: 2, teamB: 3, scoreA: 2, scoreB: 0, matchDay: 5 }),
      fixtureWindow({ kind: 999, teamA: 3, teamB: 2, scoreA: 0, scoreB: 1, matchDay: 6 }),
    ]
    const result = await readCompetitionHistory({
      leagueHistory: league,
      fixMan: fakeFixMan([concatBytes(fixtures)]),
      gameDb: identityRecord(51, 67),
      compHistory: withHeader([compHistoryRecord(51, 2028, [1, 2, 3])]),
      decompress: fakeDecompress,
    })
    expect(result.seasons[0].podium?.status).toBe('confirmed')
  })

  it('preserves a conflicting podium instead of repairing it', async () => {
    const league = withHeader([
      leagueRow({ slot: 5120, gp: 4, w: 3, d: 1, l: 0, gf: 5, ga: 1, pts: 10 }),
      leagueRow({ slot: 5121, gp: 4, w: 2, d: 1, l: 1, gf: 4, ga: 2, pts: 7 }),
      leagueRow({ slot: 5122, gp: 4, w: 0, d: 0, l: 4, gf: 0, ga: 6, pts: 0 }),
    ])
    const fixtures = [
      fixtureWindow({ kind: 999, teamA: 1, teamB: 2, scoreA: 1, scoreB: 0, matchDay: 1 }),
      fixtureWindow({ kind: 999, teamA: 2, teamB: 1, scoreA: 1, scoreB: 1, matchDay: 2 }),
      fixtureWindow({ kind: 999, teamA: 1, teamB: 3, scoreA: 2, scoreB: 0, matchDay: 3 }),
      fixtureWindow({ kind: 999, teamA: 3, teamB: 1, scoreA: 0, scoreB: 1, matchDay: 4 }),
      fixtureWindow({ kind: 999, teamA: 2, teamB: 3, scoreA: 2, scoreB: 0, matchDay: 5 }),
      fixtureWindow({ kind: 999, teamA: 3, teamB: 2, scoreA: 0, scoreB: 1, matchDay: 6 }),
    ]
    const result = await readCompetitionHistory({
      leagueHistory: league,
      fixMan: fakeFixMan([concatBytes(fixtures)]),
      gameDb: identityRecord(51, 67),
      compHistory: withHeader([compHistoryRecord(51, 2028, [2, 1, 3])]),
      decompress: fakeDecompress,
    })
    expect(result.seasons[0].podium?.status).toBe('conflict')
  })

  it('keeps the aggregate sidecar partial when any season remains unclosed', async () => {
    const league = withHeader([
      leagueRow({ year: 2028, comp: 51, slot: 5120, gp: 2, w: 1, d: 1, l: 0, gf: 2, ga: 1, pts: 4 }),
      leagueRow({ year: 2028, comp: 51, slot: 5121, gp: 2, w: 0, d: 1, l: 1, gf: 1, ga: 2, pts: 1 }),
      leagueRow({ year: 2028, comp: 7, slot: 6000, gp: 255, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }),
    ])
    const result = await readCompetitionHistory({
      leagueHistory: league,
      fixMan: fakeFixMan([twoTeamFixturePlain()]),
      gameDb: concatBytes([identityRecord(51, 67), identityRecord(7, 70)]),
      compHistory: withHeader([]),
      decompress: fakeDecompress,
    })
    expect(result.seasons.find((season) => season.competition_id_raw === 51)?.table_status).toBe('confirmed')
    expect(result.seasons.find((season) => season.competition_id_raw === 7)?.table_status).toBe('unresolved')
    expect(result.status).toBe('partial')
  })

  it('returns partial numeric history when optional members are absent', async () => {
    const result = await readCompetitionHistory({ leagueHistory: twoTeamLeagueRows() })
    expect(result.status).toBe('partial')
    expect(result.seasons[0]).toMatchObject({ table_status: 'partial', fixture_status: 'unresolved', competition_uid: null })
    expect(result.diagnostics.warnings.length).toBeGreaterThan(0)
    expect('competition_name' in result.seasons[0]).toBe(false)
  })

  it('returns unresolved diagnostics when the league member is absent', async () => {
    const result = await readCompetitionHistory({})
    expect(result.status).toBe('unresolved')
    expect(result.seasons).toEqual([])
    expect(result.diagnostics.errors).toContain('tc_league_history_dt.cmt is unavailable')
  })
})
