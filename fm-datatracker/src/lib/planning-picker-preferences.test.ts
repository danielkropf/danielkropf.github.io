// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { pickerAllocationState, readPickerPreferences, writePickerPreferences } from './planning-picker-preferences'
import type { FlexiblePlanning } from './planningSets'
beforeEach(() => localStorage.clear())
it('restores all three choices and preserves the local potential choice independently of the global toggle', () => {
  expect(readPickerPreferences()).toEqual({ showPotential: true, showOtherSquads: false, onlyEligible: false })
  const chosen = { showPotential: false, showOtherSquads: true, onlyEligible: true }
  writePickerPreferences(chosen)
  expect(readPickerPreferences()).toEqual(chosen)
})
it('falls back safely for malformed stored preferences', () => {
  localStorage.setItem('fm-datatracker:planning-picker-options:v1', '{broken')
  expect(readPickerPreferences().onlyEligible).toBe(false)
})
it('distinguishes target, same squad, other squad and market-only players', () => {
  const plan: FlexiblePlanning = { groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'sale', name: 'Venda' }], slotAssignments: { a: { gk: ['p1'], st: ['p2'] }, b: { st: ['p3'] }, sale: { market: ['p4'] } } }
  expect(['p1','p2','p3','p4'].map(id => pickerAllocationState(plan, 'a', 'gk', id))).toEqual(['current','same-squad','other-squad','available'])
})
