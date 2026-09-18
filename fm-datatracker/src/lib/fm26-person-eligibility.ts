type Row = Record<string, unknown>
/** Reject an ability block if it crosses the preceding numbered person's identity.
 * This is record ownership evidence, never an age/name/position heuristic. */
export function invalidPlayerRecord(player: Row, db: Uint8Array): string | null {
  const eid=player.eid, identity=player.identity_offset, ability=player.attribute_start
  if(typeof eid!=='number'||typeof identity!=='number'||identity<12||identity>db.length) return null
  if(typeof ability!=='number') return player.gap_to_identity===43 ? 'compact_person_without_player_ability' : null
  const view=new DataView(db.buffer,db.byteOffset,db.byteLength)
  for(let offset=Math.max(0,ability+54);offset+12<=identity;offset++) {
    if(view.getUint32(offset,true)!==eid-1)continue
    const uid=view.getUint32(offset+4,true)
    if(uid>=100000&&uid<3000000000&&uid===view.getUint32(offset+8,true)) return 'ability_crosses_previous_person_identity'
  }
  return null
}
export function excludeNonPlayerRecords(result: Row, db: Uint8Array) {
  const excluded: Row[]=[]
  for(const manager of (result.human_managers ?? []) as Row[]){
    manager.players=((manager.players ?? []) as Row[]).filter(player=>{
      const reason=invalidPlayerRecord(player,db)
      if(reason)excluded.push({uid:player.uid,name:player.display_name,eid:player.eid,reason,identity_offset:player.identity_offset,attribute_start:player.attribute_start??null})
      return !reason
    })
  }
  result.excluded_non_players=excluded
}
