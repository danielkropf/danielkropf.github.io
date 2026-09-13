import type { UnassignedDrawerState } from './planning-unassigned'
import { movePlayerToSet, type FlexiblePlanning } from './planningSets'
import { movePlayerToPlanningSquad } from './planning-squads'

export function selectPickerRows(selected: ReadonlySet<string>, anchor: string | null, clicked: string, orderedIds: string[], modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
  if (!orderedIds.includes(clicked)) return { selected: new Set(selected), anchor }
  const additive = modifiers.ctrlKey || modifiers.metaKey
  if (modifiers.shiftKey && anchor && orderedIds.includes(anchor)) {
    const a = orderedIds.indexOf(anchor), b = orderedIds.indexOf(clicked)
    const range = orderedIds.slice(Math.min(a,b), Math.max(a,b)+1)
    return { selected: new Set(additive ? [...selected, ...range] : range), anchor }
  }
  const next = additive ? new Set(selected) : new Set<string>()
  if (additive && next.has(clicked)) next.delete(clicked)
  else next.add(clicked)
  return { selected: next, anchor: clicked }
}
export function placePickerPlayers(planning: FlexiblePlanning, groupId: string, setId: string, playerIds: string[]): FlexiblePlanning {
  return [...new Set(playerIds)].reduce((next,id) => movePlayerToPlanningSquad(movePlayerToSet(next,groupId,setId,id),id,groupId), planning)
}
// Transient navigation state, keyed by save and SPA history entry; not persisted to disk.
export type PickerReturnState = { drawer?: UnassignedDrawerState; clubId: string | null; groupId: string; setId: string; search: string; selected: string[]; anchor: string | null; quickFilter: string; sort: { key: string; direction: 1 | -1 }; scrollTop: number; scrollLeft: number }
const returns = new Map<string, PickerReturnState>()
export function rememberPickerReturn(key: string, state: PickerReturnState) { returns.clear(); returns.set(key,state) }
export function readPickerReturn(key: string) { return returns.get(key) ?? null }
export function clearPickerReturn(key: string) { returns.delete(key) }
