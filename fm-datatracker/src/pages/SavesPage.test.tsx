// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SavesPage } from './SavesPage'
import type { Club, Save, TrackedClub } from '../types/domain'

const club = (id: string, name: string): Club => ({
  id, save_id: 'save-a', owner_id: 'owner', fm_club_id: null, name,
  normalized_name: name.toLowerCase(), country: 'Brasil', source_kind: 'manual',
  source_import_id: null, provenance: {}, created_at: '', updated_at: '',
})
const link = (id: string, name: string, role: 'primary' | 'tracked', active = true, order = 0): TrackedClub => ({
  id: `link-${id}`, save_id: 'save-a', owner_id: 'owner', club_id: id,
  tracking_role: role, is_active: active, display_order: order,
  first_tracked_date: null, last_tracked_date: null, settings: {}, created_at: '', updated_at: '',
  club: club(id, name),
})
const save = (trackedClubs: TrackedClub[]): Save => ({
  id: 'save-a', name: 'Rede Teste', club_name: 'Principal FC', country: 'Brasil',
  game_version: null, current_season: null, created_at: '',
  structure: {
    trackedClubs, seasons: [], diagnostic: null,
    primaryClub: { value: trackedClubs.find(item => item.tracking_role === 'primary')?.club ?? null, label: 'Principal FC', source: 'normalized', diagnostic: null },
    currentSeason: { value: null, label: null, source: 'unresolved', diagnostic: null },
  },
})

const mocks = vi.hoisted(() => ({
  selected: null as Save | null,
  refresh: vi.fn(),
  createSave: vi.fn(),
  deleteSave: vi.fn(),
  loadCatalog: vi.fn(),
  trackClub: vi.fn(),
  createClub: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('../features/saves/SaveContext', () => ({
  useSaves: () => ({
    saves: mocks.selected ? [mocks.selected] : [], selected: mocks.selected,
    select: vi.fn(), refresh: mocks.refresh, create: mocks.createSave, deleteSave: mocks.deleteSave,
  }),
}))
vi.mock('../lib/longitudinal-service', () => ({
  loadClubCatalog: (...args: unknown[]) => mocks.loadCatalog(...args),
  trackSaveClub: (...args: unknown[]) => mocks.trackClub(...args),
  createTrackedClub: (...args: unknown[]) => mocks.createClub(...args),
  setTrackedClubActive: (...args: unknown[]) => mocks.setActive(...args),
}))
vi.mock('../components/CustomSelect', () => ({
  CustomSelect: ({ value, options, onChange, disabled, ariaLabel }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; ariaLabel?: string }) => <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecione</option>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>,
}))

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.createSave.mockReset().mockResolvedValue(null)
  mocks.deleteSave.mockReset().mockResolvedValue(null)
  mocks.loadCatalog.mockReset().mockResolvedValue([])
  mocks.trackClub.mockReset().mockResolvedValue(undefined)
  mocks.createClub.mockReset().mockResolvedValue(undefined)
  mocks.setActive.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

function view() { return <MemoryRouter><SavesPage /></MemoryRouter> }

describe('SavesPage multiclub workspace', () => {
  it('protege o primary e desativa apenas o tracked secundário', async () => {
    mocks.selected = save([link('primary', 'Principal FC', 'primary', true, 0), link('partner', 'Parceiro FC', 'tracked', true, 1)])
    mocks.loadCatalog.mockResolvedValue([club('primary', 'Principal FC'), club('partner', 'Parceiro FC')])
    render(view())

    const primaryActive = await screen.findByRole('button', { name: 'Ativo' })
    expect((primaryActive as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Parar de acompanhar' }))
    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledWith('save-a', 'partner', false))
    expect(mocks.setActive).not.toHaveBeenCalledWith('save-a', 'primary', false)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('oferece Club conhecido não vinculado sem confundir inativo com candidato novo', async () => {
    mocks.selected = save([link('primary', 'Principal FC', 'primary', true, 0), link('inactive', 'Inativo FC', 'tracked', false, 1)])
    mocks.loadCatalog.mockResolvedValue([club('primary', 'Principal FC'), club('inactive', 'Inativo FC'), club('known', 'Conhecido FC')])
    render(view())

    expect(await screen.findByRole('button', { name: 'Reativar' })).not.toBeNull()
    await waitFor(() => expect(screen.getByRole('option', { name: /Conhecido FC/ })).not.toBeNull())
    const selector = screen.getByLabelText('Clube conhecido')
    expect(screen.queryByRole('option', { name: /Inativo FC/ })).toBeNull()
    fireEvent.change(selector, { target: { value: 'known' } })
    fireEvent.click(screen.getByRole('button', { name: 'Acompanhar' }))
    await waitFor(() => expect(mocks.trackClub).toHaveBeenCalledWith('save-a', 'known'))
  })
})
