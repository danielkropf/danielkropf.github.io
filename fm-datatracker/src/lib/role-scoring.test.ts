import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { IP_ROLES, OOP_ROLES } from './tactics'
import { canonicalRoleDefaultWeights, resolveRoleWeightMatrixKey, resolveRoleWeights } from './role-scoring'

describe('resolver canônico de RoleScore', () => {
  it('distingue Channel Midfielder de CM e AMC pelo grupo do roleId', () => {
    expect(resolveRoleWeightMatrixKey('IP-CM-CHM', 'Channel Midfielder')).toBe('IP_CM_CHANNEL_MIDFIELDER')
    expect(resolveRoleWeightMatrixKey('IP-AM-CHM', 'Channel Midfielder')).toBe('IP_AMC_CHANNEL_MIDFIELDER')
  })

  it('resolve todas as funções expostas pelas tabelas táticas', () => {
    for (const [group, roles] of Object.entries(IP_ROLES)) {
      for (const [code, name] of roles) expect(resolveRoleWeightMatrixKey(`IP-${group}-${code}`, name), `IP ${group} ${name}`).not.toBeNull()
    }
    for (const [group, roles] of Object.entries(OOP_ROLES)) {
      for (const [code, name] of roles) expect(resolveRoleWeightMatrixKey(`OOP-${group}-${code}`, name), `OOP ${group} ${name}`).not.toBeNull()
    }
  })

  it('falha fechado para função desconhecida: peso visual 1 em todos os atributos', () => {
    const weights = canonicalRoleDefaultWeights('IP-AM-UNKNOWN', 'Função inexistente')
    expect(Object.keys(weights)).toHaveLength(ATTRIBUTE_CATALOG.length)
    expect(Object.values(weights).every(value => value === 1)).toBe(true)
  })

  it('não reaproveita uma matriz legado toda em peso 3', () => {
    const legacy = Object.fromEntries(ATTRIBUTE_CATALOG.map(attribute => [attribute.key, 3]))
    const resolved = resolveRoleWeights({ roleId: 'IP-ST-CF', roleName: 'Centre Forward', overrideWeights: legacy })
    expect(Object.values(resolved).some(value => value !== 3)).toBe(true)
  })
})
