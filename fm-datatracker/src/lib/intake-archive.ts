import type { IntakeEvidence, IntakeMember } from './fm26-intakes'
export type IntakeObservation = { id: string; cohort_key: string; checkpoint_date: string; source_hash: string; evidence: IntakeEvidence }
export type IntakeReview = { cohort_key: string; decision: 'confirmed' | 'rejected'; reviewed_at: string }
export type AutomaticIntake = IntakeEvidence & { observations: IntakeObservation[]; identity_conflict: boolean; decision: IntakeReview['decision'] | null }
export function aggregateIntakes(observations: IntakeObservation[], reviews: IntakeReview[]): AutomaticIntake[] {
  const groups = new Map<string,IntakeObservation[]>()
  for (const observation of observations) groups.set(observation.cohort_key,[...(groups.get(observation.cohort_key)??[]),observation])
  return [...groups.values()].map(rows=>{
    rows.sort((a,b)=>a.checkpoint_date.localeCompare(b.checkpoint_date)||a.source_hash.localeCompare(b.source_hash))
    const supported=rows.filter(r=>r.evidence.confidence==='supported')
    const memberSources=supported.length?supported:rows
    const strongest=memberSources[0]
    const members=new Map<string,IntakeMember>(), biographies=new Map<string,Set<string>>()
    for (const row of memberSources) for (const m of row.evidence.members) {
      members.set(`${m.uid}:${m.birth_date}`,m)
      biographies.set(m.uid,new Set([...(biographies.get(m.uid)??[]),m.birth_date]))
    }
    return {...strongest.evidence,members:[...members.values()].sort((a,b)=>a.name.localeCompare(b.name)),
      expected_members:Math.max(...memberSources.map(r=>r.evidence.expected_members)),observations:rows,
      identity_conflict:[...biographies.values()].some(b=>b.size>1) || new Set(rows.filter(r=>r.evidence.confidence==='supported').map(r=>r.evidence.members.map(m=>`${m.uid}:${m.birth_date}`).sort().join('|'))).size>1,decision:reviews.find(r=>r.cohort_key===strongest.cohort_key)?.decision??null}
  }).sort((a,b)=>b.intake_date.localeCompare(a.intake_date)||a.team_id-b.team_id)
}
