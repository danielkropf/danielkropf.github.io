import { describe, expect, it } from 'vitest'
import { resolveOfflineTeamNames } from './fm26-team-resolver'
function fixture(type: number, embedded: string, count = 0) {
  const bytes = new Uint8Array(2048), view = new DataView(bytes.buffer), u32 = (offset: number, n: number) => view.setUint32(offset, n, true)
  const row=100, tail=row+48+4*count
  u32(row, 9); u32(row+4, 111); u32(row+8, 222); bytes[row+12]=10
  view.setUint16(row+46,count,true)
  for(let n=0;n<count;n++) u32(row+48+n*4,100+n)
  view.setUint16(tail+18,type,true); bytes[tail+21]=18; bytes[tail+22]=255;u32(tail+24,8)
  const text=new TextEncoder().encode(embedded)
  u32(tail+28,text.length); bytes.set(text,tail+32);u32(tail+33+text.length,text.length);bytes.set(text,tail+37+text.length)
  const next=tail+38+2*text.length;u32(next,10);bytes[next+12]=10
  const k=1000;u32(k-4,7);u32(k,333);u32(k+4,333)
  const parent=new TextEncoder().encode('Parent Club');u32(k+35,parent.length);bytes.set(parent,k+39);u32(k+39+parent.length,parent.length);bytes.set(parent,k+43+parent.length)
  return bytes
}
describe('structural Team names', () => {
  it('resolves an empty squad through its explicit name reference despite different row keys', () => {
    expect(resolveOfflineTeamNames(fixture(0,''),[10])[0]).toMatchObject({status:'confirmed',name:'Parent Club',source:'game_db_team_name_reference'})
  })
  it('prefers a literal U19 name even when the raw age is 18', () => {
    expect(resolveOfflineTeamNames(fixture(11,'Example U19',2),[10])[0]).toMatchObject({status:'confirmed',name:'Example U19',age_raw:18,source:'game_db_team_embedded_name'})
  })
  it('does not use a parent-club reference as the literal name of an unnamed youth or unknown category', () => {
    for(const type of [11,18,22]) expect(resolveOfflineTeamNames(fixture(type,''),[10])[0]).toMatchObject({status:'unresolved',name:null,category_raw:type})
  })
  it('rejects a truncated row instead of reading beyond the buffer', () => {
    expect(resolveOfflineTeamNames(fixture(0,'').slice(0,160),[10])[0].status).toBe('unresolved')
  })
})
