import { describe, expect, it } from 'vitest'
import {
  activePlanningClubs,
  patchClubPlanning,
  patchClubTacticId,
  primaryPlanningClubId,
  promoteLegacyPrimaryPlanning,
  promoteLegacyPrimaryTacticId,
  resolveClubPlanning,
  resolveClubTacticId,
  resolvePlanningClubId,
  sanitizeClubTacticSelections,
  type PlanningTrackedClub,
} from './multiclub-planning'

type Planning = { groups: string[] }
const defaults = (): Planning => ({ groups: ['default'] })
const primary: PlanningTrackedClub = { club_id: 'club-a', tracking_role: 'primary', is_active: true, display_order: 5, club: { id: 'club-a', name: 'Fluminense' } }
const secondary: PlanningTrackedClub = { club_id: 'club-b', tracking_role: 'tracked', is_active: true, display_order: 1, club: { id: 'club-b', name: 'Estrela' } }
const inactive: PlanningTrackedClub = { club_id: 'club-c', tracking_role: 'tracked', is_active: false, display_order: 0, club: { id: 'club-c', name: 'Inativo' } }

describe('multiclub planning config', () => {
  it('uses only active clubs, keeps primary first, and ignores stale remembered selection', () => {
    expect(activePlanningClubs([secondary, inactive, primary]).map(item => item.club_id)).toEqual(['club-a', 'club-b'])
    expect(primaryPlanningClubId([secondary, primary])).toBe('club-a')
    expect(resolvePlanningClubId([secondary, primary], 'club-b')).toBe('club-b')
    expect(resolvePlanningClubId([secondary, primary], 'club-c')).toBe('club-a')
  })

  it('promotes the legacy plan only to the primary club and never copies it to a secondary club', () => {
    const legacy = { groups: ['legacy-primary'] }
    const config = { planning: legacy }
    expect(resolveClubPlanning(config, 'club-a', 'club-a', defaults)).toBe(legacy)
    expect(resolveClubPlanning(config, 'club-b', 'club-a', defaults)).toEqual({ groups: ['default'] })
    expect(promoteLegacyPrimaryPlanning(config, 'club-a')).toEqual({ 'club-a': legacy })
  })

  it('updates club plans independently and mirrors only the primary plan to the legacy field', () => {
    const a = { groups: ['A'] }
    const b = { groups: ['B'] }
    const config = { planning: a, planning_by_club: { 'club-a': a, 'club-b': b } }
    const b2 = { groups: ['B2'] }
    expect(patchClubPlanning(config, 'club-b', 'club-a', b2)).toEqual({ planning_by_club: { 'club-a': a, 'club-b': b2 } })
    const a2 = { groups: ['A2'] }
    expect(patchClubPlanning(config, 'club-a', 'club-a', a2)).toEqual({ planning: a2, planning_by_club: { 'club-a': a2, 'club-b': b } })
  })

  it('keeps tactic selection independent by club while preserving primary legacy fallback', () => {
    const config = { selected_tactic_id: 't1', selected_tactic_id_by_club: { 'club-b': 't2' } }
    expect(resolveClubTacticId(config, 'club-a', 'club-a', ['t1', 't2'])).toBe('t1')
    expect(resolveClubTacticId(config, 'club-b', 'club-a', ['t1', 't2'])).toBe('t2')
    expect(promoteLegacyPrimaryTacticId({ selected_tactic_id: 't1' }, 'club-a')).toEqual({ 'club-a': 't1' })
    expect(patchClubTacticId(config, 'club-b', 'club-a', 't1')).toEqual({ selected_tactic_id_by_club: { 'club-b': 't1' } })
    expect(patchClubTacticId(config, 'club-a', 'club-a', 't2')).toEqual({ selected_tactic_id: 't2', selected_tactic_id_by_club: { 'club-b': 't2', 'club-a': 't2' } })
  })

  it('keeps scoped primary values authoritative after legacy editor state changes', () => {
    const primaryPlan = { groups: ['primary-scoped'] }
    const changedLegacyPlan = { groups: ['legacy-changed'] }
    const config = {
      planning: changedLegacyPlan,
      planning_by_club: { 'club-a': primaryPlan },
      selected_tactic_id: 't2',
      selected_tactic_id_by_club: { 'club-a': 't1' },
    }
    expect(resolveClubPlanning(config, 'club-a', 'club-a', defaults)).toBe(primaryPlan)
    expect(resolveClubTacticId(config, 'club-a', 'club-a', ['t1', 't2'])).toBe('t1')
    expect(resolveClubTacticId(config, 'club-b', 'club-a', ['t1', 't2'])).toBeNull()
  })

  it('fails closed on removed tactic ids instead of leaking another club selection', () => {
    const config = { selected_tactic_id: 'removed', selected_tactic_id_by_club: { 'club-a': 'removed', 'club-b': 't2' } }
    expect(resolveClubTacticId(config, 'club-a', 'club-a', ['t2'])).toBeNull()
    expect(sanitizeClubTacticSelections(config, ['t2'])).toEqual({ selected_tactic_id: null, selected_tactic_id_by_club: { 'club-a': null, 'club-b': 't2' } })
  })
})
