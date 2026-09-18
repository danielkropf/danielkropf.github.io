import { expect, it } from 'vitest'
import fixtures from './fixtures/flu-person-boundaries.json'
import {invalidPlayerRecord} from './fm26-person-eligibility'
for(const fixture of fixtures) it(`checks record ownership: ${fixture.name}`,()=>{
 const bytes=new Uint8Array(Buffer.from(fixture.hex,'hex'))
 expect(Boolean(invalidPlayerRecord(fixture,bytes))).toBe(fixture.excluded)
})
it('does not reject a player based on age or name',()=>{
 expect(invalidPlayerRecord({eid:40,identity_offset:100,attribute_start:10,age:50,display_name:'Holf'},new Uint8Array(130))).toBe(null)
})
