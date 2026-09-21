import { ATTRIBUTE_CATALOG } from './attributes'
import { LEAGUE_REFERENCE_VERSION, type LeagueReference } from './league-reference'
import type { LeagueRule } from './fm26-league-rules'
export const rule = (uid: number, level: number, groups: number[] = []): LeagueRule => ({ uid, errors: 0, roots: [{ offset: 4, type: 1, code: 'spai_test', year: 2034, level, groups, edges: [] }] })
export function referenceFixture(): LeagueReference {
  const rules = [rule(68,1),rule(67,0),rule(200,2,[201,202]),rule(201,2),rule(202,2)]
  rules[0].roots[0].edges = [{ direction: 'up', target: 67, places: 3 }, { direction: 'down', target: 202, places: 4 }]
  return { version: LEAGUE_REFERENCE_VERSION, sourceSha256: 'a'.repeat(64), checkpoint: '2034-01-01', fileName: 'save.fm', attributes: ATTRIBUTE_CATALOG.map(a=>a.key), rules,
    cohorts: [68,67,201,202].map((uid,i)=>({uid,raw:uid,kind:uid,season:'2034-06-30',first:'2033-08-01',last:'2034-06-01',teams:[i*2+1,i*2+2],fixtures:2,status:'confirmed',reason:'same_save_calendar_and_headers',complete:true})),
    players:Array.from({length:8},(_,i)=>({eid:i+1,uid:100000+i,name:`Jogador ${i+1}`,birth:'2010-01-01',team:i+1,positions:['MC'],ratings:{MC:20,DM:1},attributes:ATTRIBUTE_CATALOG.map(()=>10+i)})),humanTeams:[{team:1,name:'Clube'}],diagnostics:{warnings:[],excluded:{},excludedByTeam:{},recovered:0,scanned:8} }
}
