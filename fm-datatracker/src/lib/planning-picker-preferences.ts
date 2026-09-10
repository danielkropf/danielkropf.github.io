import { safeStorage } from './safe-storage'
import { isMarketPlanningGroup } from './planning-squads'
import type { FlexiblePlanning } from './planningSets'
const KEY = 'fm-datatracker:planning-picker-options:v1'
export type PickerPreferences = { showPotential: boolean; showOtherSquads: boolean; onlyEligible: boolean }
export function readPickerPreferences(): PickerPreferences {
  let value: Partial<PickerPreferences> = {}
  try { const parsed = JSON.parse(safeStorage.getItem(KEY) ?? '{}'); if (parsed && typeof parsed === 'object') value = parsed } catch { /* Use defaults for invalid local preferences. */ }
  return { showPotential: typeof value.showPotential === 'boolean' ? value.showPotential : true, showOtherSquads: typeof value.showOtherSquads === 'boolean' ? value.showOtherSquads : false, onlyEligible: typeof value.onlyEligible === 'boolean' ? value.onlyEligible : false }
}
export function writePickerPreferences(value: PickerPreferences) { safeStorage.setItem(KEY, JSON.stringify(value)) }
export function pickerAllocationState(planning: FlexiblePlanning, groupId: string, setId: string, playerId: string): 'current' | 'same-squad' | 'other-squad' | 'available' {
  if (planning.slotAssignments[groupId]?.[setId]?.includes(playerId)) return 'current'
  if (Object.values(planning.slotAssignments[groupId] ?? {}).some(ids => ids.includes(playerId))) return 'same-squad'
  if (planning.groups.some(group => group.id !== groupId && !isMarketPlanningGroup(group) && (planning.squadAssignments?.[playerId] === group.id || Object.values(planning.slotAssignments[group.id] ?? {}).some(ids => ids.includes(playerId))))) return 'other-squad'
  return 'available'
}
