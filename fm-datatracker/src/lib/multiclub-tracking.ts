import type { Club, TrackedClub } from '../types/domain'

export function orderedTrackedClubs(rows: TrackedClub[]): TrackedClub[] {
  return [...rows].sort((a, b) => {
    const role = Number(b.tracking_role === 'primary') - Number(a.tracking_role === 'primary')
    if (role) return role
    return a.display_order - b.display_order || a.club.name.localeCompare(b.club.name, 'pt-BR')
  })
}

export function untrackedClubCandidates(catalog: Club[], tracked: TrackedClub[]): Club[] {
  const linked = new Set(tracked.map(item => item.club_id))
  return catalog
    .filter(club => !linked.has(club.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export function canDeactivateTrackedClub(item: TrackedClub): boolean {
  return item.tracking_role !== 'primary'
}
