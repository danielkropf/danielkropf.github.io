import { describe, expect, it } from 'vitest'
import {
  buildSaveStructure,
  normalizeLongitudinalName,
  resolveSeasonForDate,
  resolveSeasonForLabel,
} from './longitudinal-domain'
import type { Club, Save, Season, TrackedClub } from '../types/domain'

const save: Save = {
  id: 'save-1',
  name: 'Teste',
  club_name: 'São Paulo FC',
  country: 'Brasil',
  game_version: null,
  current_season: '2026/27',
  created_at: '2026-08-29T00:00:00Z',
}

const club: Club = {
  id: 'club-1',
  save_id: 'save-1',
  owner_id: 'owner-1',
  fm_club_id: '123',
  name: 'São Paulo FC',
  normalized_name: 'sao paulo fc',
  country: 'Brasil',
  source_kind: 'manual',
  source_import_id: null,
  provenance: {},
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
}

const tracked: TrackedClub = {
  id: 'tracked-1',
  save_id: 'save-1',
  owner_id: 'owner-1',
  club_id: 'club-1',
  tracking_role: 'primary',
  is_active: true,
  display_order: 0,
  first_tracked_date: null,
  last_tracked_date: null,
  settings: {},
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
  club,
}

const season: Season = {
  id: 'season-1',
  save_id: 'save-1',
  owner_id: 'owner-1',
  season_key: 'label:test',
  label: '2026/27',
  ordinal: null,
  start_date: '2026-07-01',
  end_date: '2027-06-30',
  source_kind: 'manual',
  source_import_id: null,
  provenance: {},
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
}

describe('longitudinal domain', () => {
  it('normaliza nomes de forma compatível com o contrato SQL', () => {
    expect(normalizeLongitudinalName('  São  Paulo-FC  ')).toBe('sao paulo fc')
    expect(normalizeLongitudinalName('FC Bayern München')).toBe('fc bayern munchen')
  })

  it('prefere Primary Club normalizado ao rótulo legado', () => {
    const structure = buildSaveStructure(save, [tracked], [season])
    expect(structure.primaryClub.source).toBe('normalized')
    expect(structure.primaryClub.value?.id).toBe('club-1')
    expect(structure.currentSeason.source).toBe('normalized')
  })

  it('mantém fallback legado explícito quando a estrutura ainda não puder ser lida', () => {
    const structure = buildSaveStructure(save, [], [])
    expect(structure.primaryClub.source).toBe('legacy')
    expect(structure.primaryClub.value).toBeNull()
    expect(structure.primaryClub.label).toBe('São Paulo FC')
    expect(structure.currentSeason.source).toBe('legacy')
  })

  it('resolve Season por label exato sem inventar datas', () => {
    expect(resolveSeasonForLabel([season], '2026/27').value?.id).toBe('season-1')
    expect(resolveSeasonForLabel([season], '2027/28').source).toBe('legacy')
  })

  it('resolve por data apenas quando bounds confirmados cobrem a data', () => {
    expect(resolveSeasonForDate([season], '2027-01-05').value?.id).toBe('season-1')
    expect(resolveSeasonForDate([{ ...season, start_date: null, end_date: null }], '2027-01-05').source).toBe('unresolved')
  })
})
