import { describe, expect, it } from 'vitest'
import { canDeactivateTrackedClub, orderedTrackedClubs, untrackedClubCandidates } from './multiclub-tracking'
import type { Club, TrackedClub } from '../types/domain'

const club = (id: string, name: string): Club => ({
  id, save_id: 'save', owner_id: 'owner', fm_club_id: null, name,
  normalized_name: name.toLowerCase(), country: null, source_kind: 'manual',
  source_import_id: null, provenance: {}, created_at: '', updated_at: '',
})
const tracked = (id: string, name: string, role: 'primary' | 'tracked', active: boolean, displayOrder: number): TrackedClub => ({
  id: `sc-${id}`, save_id: 'save', owner_id: 'owner', club_id: id,
  tracking_role: role, is_active: active, display_order: displayOrder,
  first_tracked_date: null, last_tracked_date: null, settings: {}, created_at: '', updated_at: '',
  club: club(id, name),
})

describe('multiclub tracking helpers', () => {
  it('keeps the primary club first and then respects display order', () => {
    const rows = [tracked('b', 'Beta', 'tracked', true, 2), tracked('p', 'Principal', 'primary', true, 9), tracked('a', 'Alpha', 'tracked', true, 1)]
    expect(orderedTrackedClubs(rows).map(item => item.club_id)).toEqual(['p', 'a', 'b'])
  })

  it('does not offer inactive linked clubs as new candidates', () => {
    const catalog = [club('a', 'Alpha'), club('b', 'Beta'), club('c', 'Charlie')]
    const links = [tracked('a', 'Alpha', 'primary', true, 0), tracked('b', 'Beta', 'tracked', false, 1)]
    expect(untrackedClubCandidates(catalog, links).map(item => item.id)).toEqual(['c'])
  })

  it('never allows the primary club to be deactivated', () => {
    expect(canDeactivateTrackedClub(tracked('p', 'Principal', 'primary', true, 0))).toBe(false)
    expect(canDeactivateTrackedClub(tracked('t', 'Tracked', 'tracked', true, 1))).toBe(true)
  })
})
