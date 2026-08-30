import{describe,expect,it}from'vitest'
import{IP_ROLES,OOP_ROLES,PITCH_NODES,positionGroup,rolesFor}from'./tactics'

describe('editor tático FM26',()=>{
  it('separa funções IP e OOP compatíveis com a posição',()=>{
    expect(positionGroup('D (C)')).toBe('CB')
    expect(rolesFor('AM (L)','IP').some(r=>r[0]==='IF')).toBe(true)
    expect(rolesFor('AM (L)','OOP').some(r=>r[0]==='TW')).toBe(true)
  })

  it('inclui todas as funções IP válidas restauradas para D(L/R) e M(C)',()=>{
    const fullBackIp=rolesFor('D (L)','IP').map(([code])=>code)
    expect(fullBackIp).toContain('WB')
    expect(fullBackIp).toContain('IWB')

    const centralMidfieldIp=rolesFor('M (C)','IP').map(([code])=>code)
    expect(centralMidfieldIp).toContain('AM')
    expect(centralMidfieldIp).toContain('AP')
    expect(centralMidfieldIp).toContain('CHM')
  })

  it('mantém o catálogo canônico com 171 combinações IP×OOP',()=>{
    const groups=['GK','CB','FB','WB','DM','CM','WM','AM','W','ST']
    const combinations=groups.reduce((total,group)=>total+IP_ROLES[group].length*OOP_ROLES[group].length,0)
    expect(combinations).toBe(171)
  })

  it('oferece três posições centrais em cada linha',()=>{
    expect(PITCH_NODES.filter(n=>n.id.startsWith('dc')).length).toBe(3)
    expect(PITCH_NODES.filter(n=>n.position==='DM (C)').length).toBe(3)
    expect(PITCH_NODES.filter(n=>n.position==='M (C)').length).toBe(3)
    expect(PITCH_NODES.filter(n=>n.position==='AM (C)').length).toBe(3)
  })
})
