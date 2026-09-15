import { describe, expect, it } from 'vitest'
import { intakeTrialStart, readIntakes, scanIntakeNews } from './fm26-intakes'
import { aggregateIntakes, type IntakeObservation } from './intake-archive'
const player=(eid:number,days=42)=>({eid,uid:1000000+eid,display_name:`Player ${eid}`,birth_date:'2014-01-02',identity_offset:eid*20,identity_link_confidence:'high',membership_facts_v1:{contracts:{complete_objects:[]},relationships:[{team_id_raw:700,wage_raw:0,active_at_checkpoint:true,start_date:'2030-09-22',signed_or_effective_date:'2030-09-22',end_date:days===42?'2030-11-03':days===7?'2030-09-29':'2030-10-20'}]}})
const raw=(players:unknown[])=>({save:{current_date:'2030-09-22'},human_managers:[{human_club:{root_team_id:700},players}]})
const news=(ids:number[])=>{const b=new Uint8Array(32+ids.length*4),v=new DataView(b.buffer);v.setUint32(9,ids.length*4,true);v.setUint32(13,700,true);b[19]=ids.length;ids.forEach((id,i)=>v.setUint32(20+4*i,id,true));return b}
describe('intake evidence',()=>{
 it('supports variable cohort sizes without names or UID ranges as classification rules',()=>{
  const result=readIntakes(raw([player(1),player(2),player(3)]),news([3,1,2]))
  expect(result.classes[0]).toMatchObject({confidence:'supported',expected_members:3,news_offsets:[20]})
 })
 it('rejects normal trials, salary, wrong club, incomplete dates and completed contracts',()=>{
  for(const days of [7,28])expect(intakeTrialStart(player(1,days),700,'2030-09-22')).toBeNull()
  const p=player(1);p.membership_facts_v1.relationships[0].wage_raw=100
  expect(intakeTrialStart(p,700,'2030-09-22')).toBeNull()
  expect(intakeTrialStart(player(1),701,'2030-09-22')).toBeNull()
  expect(readIntakes({...raw([]),save:{current_date:'invalid'}},null).classes).toEqual([])
 })
 it('keeps a six-week trial uncertain without a compatible full news list',()=>{
  expect(readIntakes(raw([player(1),player(2)]),null).classes[0].confidence).toBe('candidate')
  expect(readIntakes(raw([player(1),player(2)]),news([1,2,3])).classes[0]).toMatchObject({confidence:'candidate',expected_members:3})
  expect(scanIntakeNews(news([1,1]),new Set([700]))).toEqual([])
  expect(scanIntakeNews(news([1,2]).slice(0,23),new Set([700]))).toEqual([])
 })
 it('retains the original members after release/signature, deduplicates and detects UID biography conflicts',()=>{
  const evidence=readIntakes(raw([player(1),player(2)]),news([1,2])).classes[0]
  const a: IntakeObservation={id:'one',cohort_key:evidence.key,checkpoint_date:'2030-09-22',source_hash:'one',evidence}
  const b: IntakeObservation={...a,id:'two',source_hash:'two',checkpoint_date:'2030-09-25',evidence:{...evidence,confidence:'candidate',members:[evidence.members[0]]}}
  const archive=aggregateIntakes([b,a,a],[])
  expect(archive).toHaveLength(1);expect(archive[0].members).toHaveLength(2);expect(archive[0].confidence).toBe('supported')
  const extra={...b,evidence:{...b.evidence,members:[{...evidence.members[0],uid:'999',name:'External trial'}]}}
  expect(aggregateIntakes([a,extra],[])[0].members).toHaveLength(2)
  const conflict={...b,evidence:{...b.evidence,confidence:'supported' as const,members:[{...evidence.members[0],birth_date:'2012-02-03'}]}}
  expect(aggregateIntakes([a,conflict],[])[0].identity_conflict).toBe(true)
  expect(aggregateIntakes([a],[{cohort_key:a.cohort_key,decision:'rejected',reviewed_at:'2030-10-01'}])[0].decision).toBe('rejected')
 })
})
