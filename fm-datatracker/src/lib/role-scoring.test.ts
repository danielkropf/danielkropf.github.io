import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { IP_ROLES, OOP_ROLES } from './tactics'
import { canonicalRoleDefaultWeights, resolveRoleWeightMatrixKey, resolveRoleWeights } from './role-scoring'

const EXPECTED_ROLE_MATRIX_KEYS: Record<string, string> = {
  'IP-GK-GK': 'IP_GK_GOALKEEPER',
  'IP-GK-NNGK': 'IP_GK_NO_NONSENSE_GOALKEEPER',
  'IP-GK-BPGK': 'IP_GK_BALL_PLAYING_GOALKEEPER',
  'IP-CB-CB': 'IP_DC_CENTRE_BACK',
  'IP-CB-BPCB': 'IP_DC_BALL_PLAYING_CENTRE_BACK',
  'IP-CB-NNCB': 'IP_DC_NO_NONSENSE_CENTRE_BACK',
  'IP-CB-ACB': 'IP_DC_ADVANCED_CENTRE_BACK',
  'IP-CB-OCB': 'IP_DC_OVERLAPPING_CENTRE_BACK',
  'IP-FB-FB': 'IP_FB_FULL_BACK',
  'IP-FB-IFB': 'IP_FB_INSIDE_FULL_BACK',
  'IP-FB-PWB': 'IP_WB_PLAYMAKING_WING_BACK',
  'IP-WB-WB': 'IP_WB_WING_BACK',
  'IP-WB-IWB': 'IP_WB_INSIDE_WING_BACK',
  'IP-WB-PWB': 'IP_WB_PLAYMAKING_WING_BACK',
  'IP-WB-AWB': 'IP_WB_ADVANCED_WING_BACK',
  'IP-DM-DM': 'IP_DM_DEFENSIVE_MIDFIELDER',
  'IP-DM-DLP': 'IP_DM_DEEP_LYING_PLAYMAKER',
  'IP-DM-HB': 'IP_DM_HALF_BACK',
  'IP-DM-B2BM': 'IP_DM_BOX_TO_BOX_MIDFIELDER',
  'IP-DM-B2BP': 'IP_DM_BOX_TO_BOX_PLAYMAKER',
  'IP-CM-CM': 'IP_CM_CENTRAL_MIDFIELDER',
  'IP-CM-MP': 'IP_CM_MIDFIELD_PLAYMAKER',
  'IP-CM-WCM': 'IP_CM_WIDE_CENTRAL_MIDFIELDER',
  'IP-WM-WM': 'IP_MRL_WIDE_MIDFIELDER',
  'IP-WM-W': 'IP_W_WINGER',
  'IP-WM-IW': 'IP_W_INSIDE_WINGER',
  'IP-WM-PW': 'IP_W_PLAYMAKING_WINGER',
  'IP-AM-AM': 'IP_AMC_ATTACKING_MIDFIELDER',
  'IP-AM-AP': 'IP_CM_ADVANCED_PLAYMAKER',
  'IP-AM-CHM': 'IP_AMC_CHANNEL_MIDFIELDER',
  'IP-AM-FR': 'IP_AMC_FREE_ROLE',
  'IP-AM-SS': 'IP_AMC_SECOND_STRIKER',
  'IP-W-W': 'IP_W_WINGER',
  'IP-W-IW': 'IP_W_INSIDE_WINGER',
  'IP-W-IF': 'IP_AMRL_INSIDE_FORWARD',
  'IP-W-PW': 'IP_W_PLAYMAKING_WINGER',
  'IP-W-WF': 'IP_AMRL_WIDE_FORWARD',
  'IP-ST-CF': 'IP_ST_CENTRE_FORWARD',
  'IP-ST-CHF': 'IP_ST_CHANNEL_FORWARD',
  'IP-ST-DLF': 'IP_ST_DEEP_LYING_FORWARD',
  'IP-ST-F9': 'IP_ST_FALSE_NINE',
  'IP-ST-P': 'IP_ST_POACHER',
  'IP-ST-TF': 'IP_ST_TARGET_FORWARD',
  'OOP-GK-GK': 'OOP_GK_GOALKEEPER',
  'OOP-GK-LHK': 'OOP_GK_LINE_HOLDING_KEEPER',
  'OOP-GK-SK': 'OOP_GK_SWEEPER_KEEPER',
  'OOP-CB-CB': 'OOP_DC_CENTRE_BACK',
  'OOP-CB-CCB': 'OOP_DC_COVERING_CENTRE_BACK',
  'OOP-CB-SCB': 'OOP_DC_STOPPING_CENTRE_BACK',
  'OOP-FB-FB': 'OOP_FB_FULL_BACK',
  'OOP-FB-HFB': 'OOP_FB_HOLDING_FULL_BACK',
  'OOP-FB-PFB': 'OOP_FB_PRESSING_FULL_BACK',
  'OOP-WB-WB': 'OOP_WB_WING_BACK',
  'OOP-WB-HWB': 'OOP_WB_HOLDING_WING_BACK',
  'OOP-WB-PWB': 'OOP_WB_PRESSING_WING_BACK',
  'OOP-DM-DM': 'OOP_DM_DEFENSIVE_MIDFIELDER',
  'OOP-DM-DDM': 'OOP_DM_DROPPING_DEFENSIVE_MIDFIELDER',
  'OOP-DM-SDM': 'OOP_DM_SCREENING_DEFENSIVE_MIDFIELDER',
  'OOP-DM-WCDM': 'OOP_DM_WIDE_COVERING_DEFENSIVE_MIDFIELDER',
  'OOP-CM-CM': 'OOP_CM_CENTRAL_MIDFIELDER',
  'OOP-CM-PCM': 'OOP_CM_PRESSING_CENTRAL_MIDFIELDER',
  'OOP-CM-SCM': 'OOP_CM_SCREENING_CENTRAL_MIDFIELDER',
  'OOP-CM-WCCM': 'OOP_CM_WIDE_COVERING_CENTRAL_MIDFIELDER',
  'OOP-WM-WM': 'OOP_MRL_WIDE_MIDFIELDER',
  'OOP-WM-TWM': 'OOP_MRL_TRACKING_WIDE_MIDFIELDER',
  'OOP-WM-WOWM': 'OOP_MRL_WIDE_OUTLET_WIDE_MIDFIELDER',
  'OOP-AM-AM': 'OOP_AMC_ATTACKING_MIDFIELDER',
  'OOP-AM-COAM': 'OOP_AMC_CENTRAL_OUTLET_ATTACKING_MIDFIELDER',
  'OOP-AM-SOAM': 'OOP_AMC_SPLITTING_OUTLET_ATTACKING_MIDFIELDER',
  'OOP-AM-TAM': 'OOP_AMC_TRACKING_ATTACKING_MIDFIELDER',
  'OOP-W-W': 'OOP_W_WINGER',
  'OOP-W-IOW': 'OOP_AMRL_INSIDE_OUTLET_WINGER',
  'OOP-W-TW': 'OOP_AMRL_TRACKING_WINGER',
  'OOP-W-WOW': 'OOP_AMRL_WIDE_OUTLET_WINGER',
  'OOP-ST-CF': 'OOP_ST_CENTRE_FORWARD',
  'OOP-ST-COCF': 'OOP_ST_CENTRAL_OUTLET_CENTRE_FORWARD',
  'OOP-ST-SOCF': 'OOP_ST_SPLITTING_OUTLET_CENTRE_FORWARD',
  'OOP-ST-TCF': 'OOP_ST_TRACKING_CENTRE_FORWARD',
}

describe('resolver canônico de RoleScore', () => {
  it('distingue Channel Midfielder de CM e AMC pelo grupo do roleId', () => {
    expect(resolveRoleWeightMatrixKey('IP-CM-CHM', 'Channel Midfielder')).toBe('IP_CM_CHANNEL_MIDFIELDER')
    expect(resolveRoleWeightMatrixKey('IP-AM-CHM', 'Channel Midfielder')).toBe('IP_AMC_CHANNEL_MIDFIELDER')
  })

  it('resolve cada função publicada para a matrix key canônica exata', () => {
    const publishedRoleIds: string[] = []

    for (const [group, roles] of Object.entries(IP_ROLES)) {
      for (const [code, name] of roles) {
        const roleId = `IP-${group}-${code}`
        publishedRoleIds.push(roleId)
        expect(EXPECTED_ROLE_MATRIX_KEYS[roleId], `${roleId} precisa de expectativa canônica explícita`).toBeDefined()
        expect(resolveRoleWeightMatrixKey(roleId, name), `${roleId} ${name}`).toBe(EXPECTED_ROLE_MATRIX_KEYS[roleId])
      }
    }
    for (const [group, roles] of Object.entries(OOP_ROLES)) {
      for (const [code, name] of roles) {
        const roleId = `OOP-${group}-${code}`
        publishedRoleIds.push(roleId)
        expect(EXPECTED_ROLE_MATRIX_KEYS[roleId], `${roleId} precisa de expectativa canônica explícita`).toBeDefined()
        expect(resolveRoleWeightMatrixKey(roleId, name), `${roleId} ${name}`).toBe(EXPECTED_ROLE_MATRIX_KEYS[roleId])
      }
    }

    expect([...publishedRoleIds].sort()).toEqual(Object.keys(EXPECTED_ROLE_MATRIX_KEYS).sort())
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
