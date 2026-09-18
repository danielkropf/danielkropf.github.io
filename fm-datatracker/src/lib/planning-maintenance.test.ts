import { expect, it } from 'vitest'
import {clearMarketLists,pruneDepartedPlayers,hasConfirmedDeparture} from './planning-maintenance'
const plan={groups:[{id:'first',name:'Principal'},{id:'loan',name:'Empréstimo'},{id:'sale',name:'Venda'}],slotAssignments:{first:{attack:['a','b']},loan:{market:['a']},sale:{market:['a','c']}},squadAssignments:{a:'first',b:'first'}}
it('starts a season without removing squad or tactical assignments',()=>{
 const next=clearMarketLists(plan)
 expect(next.slotAssignments).toEqual({first:{attack:['a','b']},loan:{},sale:{}})
 expect(next.squadAssignments).toEqual(plan.squadAssignments)
 expect(plan.slotAssignments.sale.market).toEqual(['a','c'])
})
it('removes a departure from all sets, market lists and squad override',()=>{
 const next=pruneDepartedPlayers(plan,new Set(['a']))
 expect(next.slotAssignments).toEqual({first:{attack:['b']},loan:{market:[]},sale:{market:['c']}})
 expect(next.squadAssignments).toEqual({b:'first'})
})
it('preserves loans owned by the club and unknown evidence',()=>{
 expect(hasConfirmedDeparture({current_club_id:'away',owner_club_id:'home',is_loan:true},'home')).toBe(false)
 expect(hasConfirmedDeparture(null,'home')).toBe(false)
 expect(hasConfirmedDeparture({current_club_id:'away',owner_club_id:null,is_loan:null},'home')).toBe(false)
 expect(hasConfirmedDeparture({current_club_id:'away',owner_club_id:'away',is_loan:false},'home')).toBe(true)
})
