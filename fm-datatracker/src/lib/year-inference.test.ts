import { describe, expect, it } from 'vitest'
import { inferSnapshotYear, parseCsv, prepareRows } from './importer'

describe('desempate do ano sugerido', () => {
  it('escolhe o menor ano quando as frequências empatam', () => {
    const preview = parseCsv('Player;Age;DoB\nA;15;1/6/2010\nB;15;1/6/2011', 'x.csv')
    expect(inferSnapshotYear(prepareRows(preview, 'Player'))).toBe(2026)
  })
})
