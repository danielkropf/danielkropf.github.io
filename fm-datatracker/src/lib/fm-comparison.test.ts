import { describe, expect, it } from 'vitest'
import { canonicalFieldKey, displayFmPositions, normalizedDate, normalizedFoot, positionsMatch } from './fm-comparison'

describe('FM/CSV comparison normalization', () => {
  it('normalizes the exported Brazilian date notation before comparison', () => {
    expect(normalizedDate('9/2/1997')).toBe('1997-02-09')
    expect(normalizedDate('1997-02-09')).toBe('1997-02-09')
  })

  it('matches the preferred-foot labels from both sources', () => {
    expect(normalizedFoot('Right-Footed Only')).toBe('right')
    expect(normalizedFoot('Right')).toBe('right')
  })

  it('compares position notation semantically, including generic export lines', () => {
    expect(positionsMatch(['D (C)'], ['DC'])).toBe(true)
    expect(positionsMatch(['D (LC), WB (L)'], ['DL', 'DC', 'WBL'])).toBe(true)
    expect(positionsMatch(['D', 'WB (R)'], ['DR', 'WBR'])).toBe(true)
    expect(positionsMatch(['D (L)'], ['DR'])).toBe(false)
  })

  it('uses one canonical key for Teamwork and the corresponding FM attribute', () => {
    expect(canonicalFieldKey('Teamwork')).toBe('team_work')
    expect(canonicalFieldKey('Team Work')).toBe('team_work')
  })

  it('maps the FM goalkeeper attribute and structured position ratings', () => {
    expect(canonicalFieldKey('Punching Tendency')).toBe('punching')
    expect(displayFmPositions({ DL: 16, DC: 20, DR: 8, WBL: 14 })).toBe('D (L), D (C)')
    expect(positionsMatch(['D (LC)'], [displayFmPositions({ DL: 16, DC: 20 })])).toBe(true)
  })
})
