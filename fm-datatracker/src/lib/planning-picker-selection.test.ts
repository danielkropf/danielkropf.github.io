import { expect, it } from 'vitest'
import { selectPickerRows, placePickerPlayers } from './planning-picker-selection'
it('supports plain, Ctrl/Meta toggle and anchored Shift ranges in displayed order', () => {
  const order=['c','a','b','d']
  let next=selectPickerRows(new Set(),null,'a',order,{})
  next=selectPickerRows(next.selected,next.anchor,'d',order,{shiftKey:true})
  expect([...next.selected]).toEqual(['a','b','d'])
  next=selectPickerRows(next.selected,next.anchor,'b',order,{ctrlKey:true})
  expect([...next.selected]).toEqual(['a','d'])
  next=selectPickerRows(next.selected,next.anchor,'c',order,{metaKey:true})
  expect([...next.selected]).toEqual(['a','d','c'])
  expect([...selectPickerRows(next.selected,next.anchor,'x',order,{}).selected]).toEqual(['a','d','c'])
})
it('adds a batch without replacing earlier additions or market flags', () => {
  const next=placePickerPlayers({groups:[{id:'a',name:'A'},{id:'sale',name:'Venda'},{id:'loan',name:'Empréstimo'}],slotAssignments:{a:{st:['old']},sale:{market:['p']},loan:{market:['p']}}} ,'a','st',['p','q','p'])
  expect(next.slotAssignments.a.st).toEqual(['old','p','q'])
  expect(next.slotAssignments.sale.market).toEqual(['p'])
  expect(next.slotAssignments.loan.market).toEqual(['p'])
})
