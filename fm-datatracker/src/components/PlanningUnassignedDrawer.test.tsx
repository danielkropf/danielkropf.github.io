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
  fireEvent.click(screen.getByRole('button', { name: 'Conjuntos aptos de Jogador' }))
  expect(screen.getByText('Meio')).not.toBeNull()
  expect(screen.queryByText('Ataque')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos os conjuntos' }))
  expect(screen.getByText('Ataque')).not.toBeNull()
  expect(screen.getByText('ST · Sem aptidão')).not.toBeNull()
  expect(within(screen.getByRole('listbox')).getByRole('option').getAttribute('aria-selected')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Jogador' }))
  expect(profile.mock.calls[0][1].expanded).toEqual({ p: 2 })
})

it('keeps unfamiliar players after eligible players and uses the requested set scores',()=>{
 const items:UnassignedDrawerItem[]=[['a',false,19],['b',true,12],['c',true,16]].map(([id,eligible,value])=>({id:String(id),name:String(id),age:18,positions:[],bestPosition:null,bestRole:null,eligiblePositions:[],hasEligible:true,value:20,status:'Nos planos',score:'default',setRatings:[{id:'mid',label:'Meu meio',eligible:Boolean(eligible),position:'MC',value:Number(value),score:String(value)}]}))
 render(<PlanningUnassignedDrawer items={items} sets={[{id:'mid',label:'Meu meio'}]} requestedSet={{id:'mid',revision:1}} onProfile={vi.fn()} onContext={vi.fn()} onDragStart={vi.fn()} onDragEnd={vi.fn()} onAssign={vi.fn()}/>)
 expect(screen.getAllByRole('option').map(row=>within(row).getAllByRole('button')[0].textContent)).toEqual(['c','b','a'])
 expect(screen.queryByText('default')).toBeNull()
 expect(screen.getByText('19')).toBeTruthy()
})
