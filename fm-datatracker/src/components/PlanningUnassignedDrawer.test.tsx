// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PlanningUnassignedDrawer, type UnassignedDrawerItem } from './PlanningUnassignedDrawer'
afterEach(cleanup)
it('expands eligible sets first, then all sets, without selecting the player', () => {
  const profile = vi.fn()
  const item: UnassignedDrawerItem = { id: 'p', name: 'Jogador', age: 18, positions: ['MC'], bestPosition: 'MC', bestRole: null, eligiblePositions: ['MC'], hasEligible: true, value: 13, status: 'Nos planos', score: <span>13</span>, setRatings: [
    { id: 'mid', label: 'Meio', eligible: true, position: 'MC', score: <span>13</span> },
    { id: 'att', label: 'Ataque', eligible: false, position: 'ST', score: <span>9</span> },
  ] }
  render(<PlanningUnassignedDrawer items={[item]} sets={[]} onProfile={profile} onContext={vi.fn()} onDragStart={vi.fn()} onDragEnd={vi.fn()} onAssign={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '▾ Conjuntos aptos' }))
  expect(screen.getByText('Meio')).not.toBeNull()
  expect(screen.queryByText('Ataque')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos os conjuntos' }))
  expect(screen.getByText('Ataque')).not.toBeNull()
  expect(screen.getByText('ST · Sem aptidão')).not.toBeNull()
  expect(within(screen.getByRole('listbox')).getByRole('option').getAttribute('aria-selected')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Jogador' }))
  expect(profile.mock.calls[0][1].expanded).toEqual({ p: 2 })
})
