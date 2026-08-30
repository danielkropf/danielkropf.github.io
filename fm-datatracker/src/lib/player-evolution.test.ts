import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import {
  attributeDelta,
  basePositionScoreChanges,
  buildPlayerEvolution,
  compareEvolutionSnapshots,
  generalScoreDelta,
  normalizedContextForSnapshot,
  observedContextChanges,
  rankAttributeChanges,
  sortEvolutionSnapshots,
  type EvolutionSnapshot,
} from './player-evolution'
import type { Club, PlayerMembershipWithClubs, Season } from '../types/domain'

function snapshot(id: string, date: string, value: number, overrides: Partial<EvolutionSnapshot> = {}): EvolutionSnapshot {
  return {
    id,
    snapshot_date: date,
    age: 20,
    club: 'Numancia',
    squad: 'First Team',
    positions: ['M (C)'],
    normalized_data: {},
    raw_data: {},
    player_attributes: ATTRIBUTE_CATALOG.map(attribute => ({ attribute_key: attribute.key, value })),
    ...overrides,
  }
}

function club(id: string, name: string): Club {
  return {
    id,
    save_id: 'save-a',
    owner_id: 'owner-a',
    fm_club_id: null,
    name,
    normalized_name: name.toLowerCase(),
    country: 'Spain',
    source_kind: 'csv',
    source_import_id: 'import-a',
    provenance: {},
    created_at: '2029-07-01T00:00:00Z',
    updated_at: '2029-07-01T00:00:00Z',
  }
}

function membership(snapshotId: string, seasonId: string | null = 'season-a'): PlayerMembershipWithClubs {
  const numancia = club('club-a', 'Numancia')
  return {
    id: `membership-${snapshotId}`,
    save_id: 'save-a',
    owner_id: 'owner-a',
    player_id: 'player-a',
    observed_date: '2029-07-01',
    season_id: seasonId,
    current_club_id: numancia.id,
    owner_club_id: numancia.id,
    team_level: 'first_team',
    squad_name: 'First Team',
    is_loan: false,
    loan_from_club_id: null,
    loan_to_club_id: null,
    source_snapshot_id: snapshotId,
    source_import_id: 'import-a',
    source_kind: 'csv',
    provenance: {},
    created_at: '2029-07-01T00:00:00Z',
    currentClub: numancia,
    ownerClub: numancia,
    loanFromClub: null,
    loanToClub: null,
  }
}

function season(): Season {
  return {
    id: 'season-a',
    save_id: 'save-a',
    owner_id: 'owner-a',
    season_key: '2029-30',
    label: '2029/30',
    ordinal: 1,
    start_date: '2029-07-01',
    end_date: '2030-06-30',
    source_kind: 'manual',
    source_import_id: null,
    provenance: {},
    created_at: '2029-07-01T00:00:00Z',
    updated_at: '2029-07-01T00:00:00Z',
  }
}

describe('player evolution', () => {
  it('ordena snapshots por data e preserva ordem da fonte quando a data é igual', () => {
    const ordered = sortEvolutionSnapshots([snapshot('b', '2030-07-01', 10), snapshot('a', '2029-07-01', 10), snapshot('c', '2030-07-01', 10)])
    expect(ordered.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('recalcula GeneralScore canônico em cada checkpoint', () => {
    const evolution = buildPlayerEvolution([snapshot('a', '2029-07-01', 10), snapshot('b', '2030-07-01', 12)])
    expect(evolution.checkpoints).toHaveLength(2)
    expect(evolution.checkpoints[0].generalScore).not.toBeNull()
    expect((evolution.checkpoints[1].generalScore ?? 0) > (evolution.checkpoints[0].generalScore ?? 0)).toBe(true)
    expect(evolution.periodGeneralScoreDelta?.delta).toBeGreaterThan(0)
  })

  it('expõe BasePositionScore histórico detalhado em cada checkpoint', () => {
    const evolution = buildPlayerEvolution([snapshot('a', '2029-07-01', 10), snapshot('b', '2030-07-01', 12)])
    expect(evolution.checkpoints[0].basePositionScores.length).toBeGreaterThan(0)
    expect(evolution.checkpoints[0].basePositionScores[0]).toMatchObject({ scoreKey: 'CM' })
    expect(evolution.checkpoints[1].basePositionScores[0].score).toBeGreaterThan(evolution.checkpoints[0].basePositionScores[0].score)
  })

  it('calcula deltas positivos, negativos e zero sem alterar a observação', () => {
    const key = ATTRIBUTE_CATALOG[0].key
    const from = snapshot('a', '2029-07-01', 10)
    const to = snapshot('b', '2030-07-01', 10)
    to.player_attributes.find(attribute => attribute.attribute_key === key)!.value = 13
    expect(attributeDelta(from, to, key)?.delta).toBe(3)
    to.player_attributes.find(attribute => attribute.attribute_key === key)!.value = 7
    expect(attributeDelta(from, to, key)?.delta).toBe(-3)
    to.player_attributes.find(attribute => attribute.attribute_key === key)!.value = 10
    expect(attributeDelta(from, to, key)?.delta).toBe(0)
  })

  it('não transforma atributo ausente em zero', () => {
    const key = ATTRIBUTE_CATALOG[0].key
    const from = snapshot('a', '2029-07-01', 10)
    const to = snapshot('b', '2030-07-01', 12, { player_attributes: [] })
    expect(attributeDelta(from, to, key)).toBeNull()
    expect(rankAttributeChanges(from, to)).toEqual([])
  })

  it('ordena ganhos/perdas deterministicamente por magnitude, delta e chave', () => {
    const first = snapshot('a', '2029-07-01', 10)
    const last = snapshot('b', '2030-07-01', 10)
    const [a, b, c] = ATTRIBUTE_CATALOG.slice(0, 3).map(attribute => attribute.key)
    last.player_attributes.find(item => item.attribute_key === a)!.value = 12
    last.player_attributes.find(item => item.attribute_key === b)!.value = 8
    last.player_attributes.find(item => item.attribute_key === c)!.value = 12
    const ranked = rankAttributeChanges(first, last).filter(item => item.delta !== 0)
    expect(ranked.map(item => item.attributeKey)).toEqual([a, c].sort().concat(b))
  })

  it('um único snapshot não fabrica delta de período', () => {
    const only = snapshot('a', '2029-07-01', 10)
    expect(buildPlayerEvolution([only]).periodGeneralScoreDelta).toBeNull()
    expect(generalScoreDelta(only, only)?.delta).toBe(0)
  })

  it('registra contexto apenas quando há dois valores conhecidos e diferentes', () => {
    const changes = observedContextChanges([
      snapshot('a', '2029-07-01', 10, { club: 'Numancia', squad: 'B' }),
      snapshot('b', '2030-01-01', 10, { club: null, squad: 'B' }),
      snapshot('c', '2030-07-01', 10, { club: 'Numancia', squad: 'First Team' }),
      snapshot('d', '2031-07-01', 10, { club: 'Burgos', squad: 'First Team' }),
    ])
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ fromSnapshotId: 'b', toSnapshotId: 'c', squad: { from: 'B', to: 'First Team' }, club: null })
    expect(changes[1]).toMatchObject({ fromSnapshotId: 'c', toSnapshotId: 'd', club: { from: 'Numancia', to: 'Burgos' }, squad: null })
  })

  it('integra membership e Season somente por vínculos explícitos do snapshot', () => {
    const current = snapshot('s1', '2029-07-01', 10, { club: 'legacy club', squad: 'legacy squad' })
    const normalized = normalizedContextForSnapshot(current, [membership('s1')], [season()])
    expect(normalized.diagnostic).toBeNull()
    expect(normalized.context).toMatchObject({
      membershipId: 'membership-s1',
      seasonLabel: '2029/30',
      currentClub: 'Numancia',
      squad: 'First Team',
      teamLevel: 'first_team',
    })

    const unrelated = normalizedContextForSnapshot(current, [membership('other')], [season()])
    expect(unrelated).toEqual({ context: null, diagnostic: null })
  })

  it('não escolhe automaticamente entre memberships ambíguos do mesmo snapshot', () => {
    const current = snapshot('s1', '2029-07-01', 10)
    const result = normalizedContextForSnapshot(current, [membership('s1'), { ...membership('s1'), id: 'membership-other' }], [season()])
    expect(result.context).toBeNull()
    expect(result.diagnostic).toMatch(/2 memberships/)
  })

  it('não fabrica Season quando o membership não possui season_id resolvido', () => {
    const current = snapshot('s1', '2029-07-01', 10)
    expect(normalizedContextForSnapshot(current, [membership('s1', null)], [season()]).context?.seasonLabel).toBeNull()
    const unresolved = normalizedContextForSnapshot(current, [membership('s1', 'season-missing')], [season()])
    expect(unresolved.context?.seasonLabel).toBeNull()
    expect(unresolved.diagnostic).toMatch(/não foi carregada/)
  })

  it('compara quaisquer dois checkpoints sem impor ordem cronológica', () => {
    const older = snapshot('a', '2029-07-01', 10)
    const newer = snapshot('b', '2030-07-01', 12)
    const forward = compareEvolutionSnapshots(older, newer)
    const reverse = compareEvolutionSnapshots(newer, older)
    expect(forward.generalScoreDelta?.delta).toBeGreaterThan(0)
    expect(reverse.generalScoreDelta?.delta).toBeLessThan(0)
    expect(forward.basePositionScoreChanges.length).toBeGreaterThan(0)
    expect(reverse.basePositionScoreChanges[0].delta).toBeLessThan(0)
  })

  it('BasePositionScore só produz delta quando a mesma base existe nos dois checkpoints', () => {
    const midfielder = snapshot('a', '2029-07-01', 10, { positions: ['M (C)'] })
    const striker = snapshot('b', '2030-07-01', 12, { positions: ['ST (C)'] })
    expect(basePositionScoreChanges(midfielder, striker)).toEqual([])
  })
})
