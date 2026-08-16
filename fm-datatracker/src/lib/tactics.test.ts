import{describe,expect,it}from'vitest'
import{PITCH_NODES,positionGroup,rolesFor}from'./tactics'

describe('editor tático FM26',()=>{
  it('separa funções IP e OOP compatíveis com a posição',()=>{
    expect(positionGroup('D (C)')).toBe('CB')
    expect(rolesFor('AM (L)','IP').some(r=>r[0]==='IF')).toBe(true)
    expect(rolesFor('AM (L)','OOP').some(r=>r[0]==='TW')).toBe(true)
  })

  it('oferece três posições centrais em cada linha',()=>{
    expect(PITCH_NODES.filter(n=>n.id.startsWith('dc')).length).toBe(3)
    expect(PITCH_NODES.filter(n=>n.position==='DM (C)').length).toBe(3)
    expect(PITCH_NODES.filter(n=>n.position==='M (C)').length).toBe(3)
    expect(PITCH_NODES.filter(n=>n.position==='AM (C)').length).toBe(3)
  })
})
