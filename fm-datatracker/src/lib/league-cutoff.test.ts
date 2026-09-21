import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { LEAGUE_CUTOFF_MIN_COVERAGE, leagueCutoffTopN, summarizeLeagueRole, type LeaguePlayer, type LeagueReference, type LeagueRolePair, type ReferencePopulation } from './league-reference'
import { referenceFixture } from './league-reference.fixture'
import { pairedRoleScore } from './role-scoring'

const pair = (ip: string, oop = ip, ipWeights: Record<string, number> = { passing: 5 }, oopWeights: Record<string, number> = { tackling: 5 }): LeagueRolePair => ({
  label: `${ip}/${oop}`,
  ip: { position: ip, weights: ipWeights },
  oop: { position: oop, weights: oopWeights },
})

const player = ({ team, eid, score, ip = 'MC', oop = ip, passing = score, tackling = score, ratings, positions }: {
  team: number; eid: number; score: number; ip?: string; oop?: string; passing?: number; tackling?: number; ratings?: Record<string, number>; positions?: string[]
}): LeaguePlayer => ({
  eid,
  uid: 500000 + eid,
  name: `P${eid}`,
  birth: '2010-01-01',
  team,
  positions: positions ?? [...new Set([ip, oop])],
  ratings: ratings ?? Object.fromEntries([...new Set([ip, oop])].map(position => [position, 20])),
  attributes: ATTRIBUTE_CATALOG.map(attribute => attribute.key === 'passing' ? passing : attribute.key === 'tackling' ? tackling : score),
})

const population = (players: LeaguePlayer[], expectedTeams: number): ReferencePopulation => ({
  status: 'available_partial', reason: 'test_population', uid: 999, groups: [999], players,
  teams: expectedTeams, coveredTeams: new Set(players.map(item => item.team)).size, missingGroups: [], exclusions: {},
})
const data = (): LeagueReference => referenceFixture()

describe('canonical league cutoff mean', () => {
  it('maps Top 1, Top 2 and Top 3 maximums by exact positional family and side', () => {
    expect(leagueCutoffTopN('GK')).toBe(1)
    expect(leagueCutoffTopN('DC')).toBe(2)
    expect(leagueCutoffTopN('DL')).toBe(1); expect(leagueCutoffTopN('DR')).toBe(1)
    expect(leagueCutoffTopN('WBL')).toBe(1); expect(leagueCutoffTopN('WBR')).toBe(1)
    expect(leagueCutoffTopN('DM')).toBe(2)
    expect(leagueCutoffTopN('MC')).toBe(3); expect(leagueCutoffTopN('CM')).toBe(3)
    expect(leagueCutoffTopN('ML')).toBe(1); expect(leagueCutoffTopN('MR')).toBe(1)
    expect(leagueCutoffTopN('AML')).toBe(2); expect(leagueCutoffTopN('AMR')).toBe(2)
    expect(leagueCutoffTopN('AMC')).toBe(2)
    expect(leagueCutoffTopN('ST')).toBe(1)
    expect(leagueCutoffTopN('SW')).toBeNull()
  })

  it('Top 1 keeps only the best eligible player from each club', () => {
    const players = [
      player({ team: 1, eid: 1, score: 15, ip: 'ST' }), player({ team: 1, eid: 2, score: 14, ip: 'ST' }),
      player({ team: 2, eid: 3, score: 13, ip: 'ST' }), player({ team: 2, eid: 4, score: 12, ip: 'ST' }),
    ]
    expect(summarizeLeagueRole(data(), population(players, 2), pair('ST'))).toMatchObject({ topN: 1, n: 2, clubsWithSelected: 2, coverage: 1, cutoffMean: 14 })
  })

  it('Top 2 caps clubs above the maximum and accepts a club with exactly Top-N', () => {
    const players = [15, 14, 13].map((score, index) => player({ team: 1, eid: index + 1, score, ip: 'DC' }))
      .concat([12, 11].map((score, index) => player({ team: 2, eid: index + 10, score, ip: 'DC' })))
    expect(summarizeLeagueRole(data(), population(players, 2), pair('DC'))).toMatchObject({ topN: 2, n: 4, clubsWithSelected: 2, cutoffMean: 13 })
  })

  it('Top 3 uses a partial quota and never equalizes club weight', () => {
    const players = [15, 14, 13, 10].map((score, index) => player({ team: 1, eid: index + 1, score, ip: 'MC' }))
      .concat([player({ team: 2, eid: 10, score: 12, ip: 'MC' })])
    const summary = summarizeLeagueRole(data(), population(players, 2), pair('MC'))!
    expect(summary).toMatchObject({ topN: 3, n: 4, clubsWithSelected: 2, coverage: 1, cutoffMean: 13.5 })
    expect(summary.cutoffMean).not.toBe((((15 + 14 + 13) / 3) + 12) / 2)
  })

  it('Top 3 accepts one club at exactly Top-N and another below Top-N', () => {
    const players = [15, 14, 13].map((score, index) => player({ team: 1, eid: index + 1, score, ip: 'MC' }))
      .concat([12, 11].map((score, index) => player({ team: 2, eid: index + 10, score, ip: 'MC' })))
    expect(summarizeLeagueRole(data(), population(players, 2), pair('MC'))).toMatchObject({ n: 5, clubsWithSelected: 2, cutoffMean: 13 })
  })

  it('counts a club with one eligible, ignores a club with zero, and publishes at exactly 80% coverage', () => {
    const players = [1, 2, 3, 4].map((team, index) => player({ team, eid: index + 1, score: 12 + index, ip: 'ST' }))
    const summary = summarizeLeagueRole(data(), population(players, 5), pair('ST'))!
    expect(summary.coverage).toBe(LEAGUE_CUTOFF_MIN_COVERAGE)
    expect(summary).toMatchObject({ clubsWithSelected: 4, expectedTeams: 5, n: 4, reason: 'available' })
    expect(summary.cutoffMean).not.toBeNull()
  })

  it('returns unavailable below 80% club coverage', () => {
    const players = [1, 2, 3].map((team, index) => player({ team, eid: index + 1, score: 15 - index, ip: 'ST' }))
    expect(summarizeLeagueRole(data(), population(players, 5), pair('ST'))).toMatchObject({ cutoffMean: null, clubsWithSelected: 3, expectedTeams: 5, coverage: .6, reason: 'insufficient_cutoff_coverage' })
  })

  it('returns unavailable without a trustworthy expectedTeams denominator', () => {
    const players = [player({ team: 1, eid: 1, score: 15, ip: 'ST' })]
    expect(summarizeLeagueRole(data(), population(players, 0), pair('ST'))).toMatchObject({ cutoffMean: null, n: 1, clubsWithSelected: 1, expectedTeams: null, coverage: null, reason: 'missing_expected_teams' })
  })

  it.each([['DL', 'DR'], ['WBL', 'WBR'], ['ML', 'MR'], ['AML', 'AMR']] as const)('keeps %s and %s as separate sided populations', (left, right) => {
    const players = [
      player({ team: 1, eid: 1, score: 15, ip: left, ratings: { [left]: 20, [right]: 1 }, positions: [left] }),
      player({ team: 1, eid: 2, score: 12, ip: right, ratings: { [left]: 1, [right]: 20 }, positions: [right] }),
    ]
    const pop = population(players, 1)
    expect(summarizeLeagueRole(data(), pop, pair(left))).toMatchObject({ n: 1, cutoffMean: 15, clubsWithSelected: 1 })
    expect(summarizeLeagueRole(data(), pop, pair(right))).toMatchObject({ n: 1, cutoffMean: 12, clubsWithSelected: 1 })
  })

  it('ranks with the exact paired IP/OOP score rather than either phase alone', () => {
    const rolePair = pair('ST', 'ST', { passing: 5 }, { tackling: 5 })
    const phaseStar = player({ team: 1, eid: 1, score: 10, ip: 'ST', passing: 20, tackling: 5 })
    const balanced = player({ team: 1, eid: 2, score: 12, ip: 'ST', passing: 12, tackling: 12 })
    const expected = pairedRoleScore(data().attributes.map(attribute_key => ({ attribute_key, value: attribute_key === 'passing' || attribute_key === 'tackling' ? 12 : 10 })), rolePair.ip.weights, rolePair.oop.weights)
    expect(summarizeLeagueRole(data(), population([phaseStar, balanced], 1), rolePair)).toMatchObject({ topN: 1, n: 1, cutoffMean: expected, best: { name: 'P2' } })
  })

  it('has no fallback for missing numeric familiarity, lower familiarity, adjacent position, or alternate function', () => {
    const rolePair = pair('MC', 'DM')
    const noNumeric = player({ team: 1, eid: 1, score: 15, ip: 'MC', oop: 'DM', ratings: {}, positions: ['MC', 'DM'] })
    const belowThreshold = player({ team: 2, eid: 2, score: 14, ip: 'MC', oop: 'DM', ratings: { MC: 20, DM: 14 }, positions: ['MC', 'DM'] })
    const adjacentOnly = player({ team: 3, eid: 3, score: 13, ip: 'MC', oop: 'DM', ratings: { MC: 20, AMC: 20 }, positions: ['MC', 'AMC'] })
    expect(summarizeLeagueRole(data(), population([noNumeric, belowThreshold, adjacentOnly], 3), rolePair)).toMatchObject({ cutoffMean: null, n: 0, clubsWithSelected: 0, coverage: 0, ineligible: 3, reason: 'insufficient_cutoff_coverage' })
  })
})
