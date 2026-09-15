import { FM26OfflineReaderV022 } from './fm26-offline-reader-v022.js'

export const INTAKE_READER_VERSION = 'fm26-intakes-v1'
type Row = Record<string, any>
export type IntakeMember = { uid: string; eid: number; name: string; birth_date: string; identity_offset: number }
export type IntakeEvidence = {
  key: string; team_id: number; club_name: string; intake_date: string
  confidence: 'candidate' | 'supported'; method: 'trial_42_days' | 'news_envelope_and_trial_cohort'
  members: IntakeMember[]; expected_members: number; news_offsets: number[]
}
export type IntakeRead = { version: string; checkpoint_date: string | null; classes: IntakeEvidence[]; warnings: string[] }
const rec = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(rec) : []
function date(v: unknown): v is string { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v }
export function intakeTrialStart(player: Row, team: number, checkpoint: string): string | null {
  const f = rec(player.membership_facts_v1), relations = list(f.relationships)
  if (list(rec(f.contracts).complete_objects).length || relations.length !== 1) return null
  const r = relations[0]
  return r.team_id_raw === team && r.wage_raw === 0 && r.active_at_checkpoint === true
    && date(r.start_date) && date(r.end_date) && r.start_date === r.signed_or_effective_date
    && (Date.parse(r.end_date) - Date.parse(r.start_date)) / 86400000 === 42
    && r.start_date <= checkpoint && checkpoint <= r.end_date ? r.start_date : null
}
function member(p: Row, db?: DataView): IntakeMember | null {
  if (p.identity_link_confidence !== 'high' || !Number.isInteger(p.uid) || p.uid <= 0 || !Number.isInteger(p.eid)
    || typeof p.display_name !== 'string' || !p.display_name.trim() || !date(p.birth_date) || !Number.isInteger(p.identity_offset)) return null
  const o = p.identity_offset
  if (db && (o < 0 || o + 12 > db.byteLength || db.getUint32(o,true) !== p.eid || db.getUint32(o+4,true) !== p.uid || db.getUint32(o+8,true) !== p.uid)) return null
  return { uid: String(p.uid), eid: p.eid, name: p.display_name, birth_date: p.birth_date, identity_offset: o }
}
/** Local news layout: bounded byte count + root Team + two zero bytes + u8 count.
 * It is supporting evidence, never a universal news opcode or a trial-type enum. */
export function scanIntakeNews(bytes: Uint8Array, teams: Set<number>) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  const found: Array<{ team: number; offset: number; eids: number[] }> = []
  for (let o = 11; o + 4 <= bytes.length; o++) {
    const count = bytes[o-1]
    if (count < 2 || count > 64 || bytes[o-3] || bytes[o-2] || o+count*4 > bytes.length) continue
    if (view.getUint32(o-11,true) !== count*4) continue
    const team = view.getUint32(o-7,true)
    if (!teams.has(team)) continue
    const eids = Array.from({length:count},(_,i)=>view.getUint32(o+i*4,true))
    if (eids.some(eid=>eid===0) || new Set(eids).size!==count) continue
    found.push({team,offset:o,eids})
    if (found.length >= 256) break // bounded work on malformed/uncharacterized data
  }
  return found
}
export function readIntakes(raw: unknown, news: Uint8Array | null, gameDb?: Uint8Array): IntakeRead {
  const result = rec(raw), checkpoint = rec(result.save).current_date
  const output: IntakeRead = { version: INTAKE_READER_VERSION, checkpoint_date: date(checkpoint) ? checkpoint : null, classes: [], warnings: [] }
  if (!output.checkpoint_date) { output.warnings.push('Data exata indisponível; intake não classificado.'); return output }
  const humans = list(result.human_managers), teams = new Set<number>(humans.map(h=>rec(h.human_club).root_team_id).filter(Number.isInteger))
  const envelopes = news ? scanIntakeNews(news,teams) : []
  if (!news) output.warnings.push('Notícias indisponíveis; grupos de testes exigem revisão.')
  const db = gameDb ? new DataView(gameDb.buffer,gameDb.byteOffset,gameDb.byteLength) : undefined
  const roster = humans.flatMap(h=>list(h.players)), identities = new Map<number,IntakeMember>()
  const ambiguous = new Set<number>()
  for (const p of roster) {
    const m = member(p,db); if (!m) continue
    const previous = identities.get(m.eid)
    if (previous && (previous.uid!==m.uid || previous.birth_date!==m.birth_date || previous.identity_offset!==m.identity_offset)) ambiguous.add(m.eid)
    else identities.set(m.eid,m)
  }
  // Recover a released candidate from the news reference without adding him to the current squad.
  const missing = new Set(envelopes.flatMap(e=>e.eids).filter(eid=>!identities.has(eid)))
  if (gameDb && db && missing.size) {
    const Core = FM26OfflineReaderV022.GameDBReader as unknown as new (b: Uint8Array)=>{ personRegionStart: number; _findPersonPrefix(o:number): Row | null }
    const core = new Core(gameDb)
    for (let o=core.personRegionStart;o+12<=gameDb.length;o++) {
      const eid=db.getUint32(o,true)
      if (!missing.has(eid)) continue
      const uid=db.getUint32(o+4,true)
      if (uid<1000000 || uid>=3000000000 || db.getUint32(o+8,true)!==uid) continue
      const prefix=core._findPersonPrefix(o)
      if (!prefix || prefix.gap_to_identity>800) continue
      const m=member({...prefix,eid,uid,identity_offset:o,identity_link_confidence:'high'},db)
      if (!m) continue
      if (identities.has(eid)) ambiguous.add(eid)
      else identities.set(eid,m)
    }
  }
  for (const eid of ambiguous) identities.delete(eid)
  for (const human of humans) {
    const club=rec(human.human_club), team=club.root_team_id
    if (!teams.has(team)) continue
    const groups = new Map<string,IntakeMember[]>()
    for (const p of list(human.players)) {
      const start=intakeTrialStart(p,team,checkpoint), m=identities.get(p.eid)
      if (start && m) groups.set(start,[...(groups.get(start)??[]),m])
    }
    for (const [start, seeds] of groups) {
      const seedIds=new Set(seeds.map(m=>m.eid))
      // At least two independent trial records and a majority of the news list must agree.
      const matches=envelopes.filter(e=>e.team===team && seeds.length>=2 && e.eids.filter(id=>seedIds.has(id)).length > e.eids.length/2 && seeds.every(m=>e.eids.includes(m.eid)))
      const layouts=new Map(matches.map(e=>[[...e.eids].sort((a,b)=>a-b).join(','),e]))
      const envelope=layouts.size===1 ? [...layouts.values()][0] : null
      const recovered=envelope?.eids.map(id=>identities.get(id))
      const supported=!!recovered && recovered.every(Boolean)
      const members=supported ? recovered as IntakeMember[] : [...new Map(seeds.map(m=>[`${m.uid}:${m.birth_date}`,m])).values()]
      output.classes.push({key:`${team}:${start}`,team_id:team,club_name:club.name ?? club.root_team_name ?? rec(list(club.roster_groups).find(g=>g.team_id===team)?.team_name_resolution).name ?? `Clube ${team}`,intake_date:start,
        confidence:supported?'supported':'candidate',method:supported?'news_envelope_and_trial_cohort':'trial_42_days',members,
        expected_members:envelope?.eids.length??members.length,news_offsets:envelope ? matches.map(e=>e.offset) : []})
    }
  }
  if (!output.classes.length) output.warnings.push('Nenhuma turma identificada neste checkpoint; isso não prova ausência de intake.')
  return output
}
