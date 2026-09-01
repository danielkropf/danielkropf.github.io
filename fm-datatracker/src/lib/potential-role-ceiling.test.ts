import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { canonicalRoleDefaultWeights, pairedRoleScore, roleScore } from './role-scoring'
import { IP_ROLES, OOP_ROLES } from './tactics'
import type { LoadedPotentialRoleCeilingModel, PotentialRoleCeilingManifest } from './potential-role-ceiling-model'
import { POTENTIAL_INDIVIDUAL_ROLE_CATALOG, potentialRoleCeilingForSnapshot, potentialRoleComboFromProjectionKey } from './potential-role-ceiling'
import type { PotentialCeilingBinaryModel, PotentialCeilingEnsemble } from './potential-role-ceiling-binary'

function constantEnsemble(featureCount: number, value: number): PotentialCeilingEnsemble {
  return {
    featureCount,
    baseline: 0,
    trees: [{
      nodes: [{ left: -1, right: -1, feature: -1, bitsetIndex: -1, flags: 1, threshold: 0, value }],
      categoricalBitsets: [],
    }],
  }
}

function loadedModel(gain = 1): LoadedPotentialRoleCeilingModel {
  const manifest: PotentialRoleCeilingManifest = {
    schemaVersion: 'fm-datatracker-potential-role-ceiling-manifest-v1_1',
    potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1',
    engineVersion: 'plausible-career-ceiling-role-score-engine-v1.1',
    scoringModelVersion: '2.0',
    roleCatalogVersion: 'fm26-canonical-individual-83-20260901',
    model: { file: 'fixture.bin', sha256: 'fixture', byteLength: 0, format: 'FMDTPH21', formatVersion: 2, treeCount: 180, featureCount: 51, individualRoleCount: 83 },
    domain: { minAgeInclusive: 16, maxAgeExclusive: 30, canonicalIpFunctions: 48, canonicalOopFunctions: 35, canonicalIndividualFunctions: 83, canonicalPairCapacity: 1680, requiresTrustedCaPa: true, requiresCompleteVisible47: true, customMatricesSupported: false },
    featureOrderModel: [],
    individualRoles: POTENTIAL_INDIVIDUAL_ROLE_CATALOG,
  }
  const model: PotentialCeilingBinaryModel = { phase: constantEnsemble(51, gain), individualRoleCount: 83 }
  return { manifest, model }
}

function trustedGkSnapshot(birthDate = '2005-01-01') {
  return {
    snapshot_date: '2027-01-01',
    age: 22,
    positions: ['GK'],
    normalized_data: {
      source: 'fm26-save-offline',
      ca_pa_status: 'candidate_with_provenance_not_universally_validated',
      birth_date: birthDate,
      fm_hidden: { current_ability: 100, potential_ability: 120 },
    },
    player_attributes: ATTRIBUTE_CATALOG.map(attribute => ({ attribute_key: attribute.key, value: 10 })),
  }
}

function canonicalGkScore(snapshot: ReturnType<typeof trustedGkSnapshot>) {
  const ip = canonicalRoleDefaultWeights('IP-GK-GK', 'Goalkeeper')
  const oop = canonicalRoleDefaultWeights('OOP-GK-GK', 'Goalkeeper')
  return pairedRoleScore(snapshot.player_attributes, ip, oop)
}

function canonicalMixedScore(snapshot: ReturnType<typeof trustedGkSnapshot>) {
  const ip = canonicalRoleDefaultWeights('IP-CM-AP', 'Advanced Playmaker')
  const oop = canonicalRoleDefaultWeights('OOP-DM-DM', 'Defensive Midfielder')
  return pairedRoleScore(snapshot.player_attributes, ip, oop)
}

describe('PlausibleCareerCeilingRoleScore v1.1', () => {
  it('keeps 83 individual functions and the 171-pair legacy subset', () => {
    const groups = ['GK','CB','FB','WB','DM','CM','WM','AM','W','ST'] as const
    expect(POTENTIAL_INDIVIDUAL_ROLE_CATALOG).toHaveLength(83)
    expect(POTENTIAL_INDIVIDUAL_ROLE_CATALOG.filter(role => role.phase === 'IP')).toHaveLength(48)
    expect(POTENTIAL_INDIVIDUAL_ROLE_CATALOG.filter(role => role.phase === 'OOP')).toHaveLength(35)
    expect(groups.reduce((sum, group) => sum + IP_ROLES[group].length * OOP_ROLES[group].length, 0)).toBe(171)
  })

  it('resolves same-group, mixed and single-phase canonical identities', () => {
    expect(potentialRoleComboFromProjectionKey('IP:D(C):BPCB|OOP:D(C):SCB')?.identity).toBe('IP:CB|Ball-Playing Centre-Back > OOP:CB|Stopping Centre-Back')
    expect(potentialRoleComboFromProjectionKey('IP:M(C):CHM|OOP:M(C):WCCM')?.legacyComboId).not.toBeNull()
    const mixed = potentialRoleComboFromProjectionKey('IP:M(C):AP|OOP:DM(C):DM')
    expect(mixed?.identity).toBe('IP:CM|Advanced Playmaker > OOP:DM|Defensive Midfielder')
    expect(mixed?.ip?.id).toBe(24)
    expect(mixed?.oop?.id).toBe(60)
    expect(mixed?.legacyComboId).toBeNull()
    expect(potentialRoleComboFromProjectionKey('IP:M(C):CM')?.identity).toBe('IP:CM|Central Midfielder')
    expect(potentialRoleComboFromProjectionKey('OOP:DM(C):DM')?.identity).toBe('OOP:DM|Defensive Midfielder')
  })

  it('returns a potential for one individual phase', () => {
    const snapshot = trustedGkSnapshot()
    const weights = canonicalRoleDefaultWeights('IP-CM-AP', 'Advanced Playmaker')
    const current = roleScore(snapshot.player_attributes, weights)
    const result = potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore: current, scoreKey: 'IP:M(C):AP', loadedModel: loadedModel(1.25) })
    expect(result.status).toBe('AVAILABLE')
    expect(result.ipFunctionId).toBe(24)
    expect(result.oopFunctionId).toBeNull()
    expect(result.plausibleCareerCeilingRoleScore).toBeCloseTo(current! + 1.25, 10)
  })

  it('uses the validated young edge instead of hiding under-16 players', () => {
    const snapshot = { ...trustedGkSnapshot(), normalized_data: { ...trustedGkSnapshot().normalized_data, birth_date: '2021-01-01' }, snapshot_date: '2036-01-01' }
    const current = canonicalGkScore(snapshot)
    const result = potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore: current, scoreKey: 'IP:GK:GK|OOP:GK:GK', loadedModel: loadedModel() })
    expect(result.status).toBe('AVAILABLE')
    expect(result.supportStatus).toBe('YOUTH_EDGE_EXTRAPOLATION')
  })

  it('returns a ceiling above the current canonical RoleScore and never above 20', () => {
    const snapshot = trustedGkSnapshot()
    const currentRoleScore = canonicalGkScore(snapshot)
    expect(currentRoleScore).not.toBeNull()
    const result = potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore, scoreKey: 'IP:GK:GK|OOP:GK:GK', loadedModel: loadedModel() })
    expect(result.status).toBe('AVAILABLE')
    expect(result.plausibleCareerCeilingRoleScore).toBeCloseTo(currentRoleScore! + 1, 11)
    expect(result.plausibleCareerCeilingRoleScore!).toBeGreaterThanOrEqual(currentRoleScore!)
    expect(result.plausibleCareerCeilingRoleScore!).toBeLessThanOrEqual(20)
  })

  it('returns potential for the mixed M(C)-AP / DM(C)-DM pair', () => {
    const snapshot = trustedGkSnapshot()
    const currentRoleScore = canonicalMixedScore(snapshot)
    expect(currentRoleScore).not.toBeNull()
    const result = potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore, scoreKey: 'IP:M(C):AP|OOP:DM(C):DM', loadedModel: loadedModel(1.5) })
    expect(result.status).toBe('AVAILABLE')
    expect(result.unavailableReason).toBeNull()
    expect(result.roleComboId).toBeNull()
    expect(result.ipFunctionId).toBe(24)
    expect(result.oopFunctionId).toBe(60)
    expect(result.plausibleCareerCeilingRoleScore).toBeCloseTo(currentRoleScore! + 1.5, 11)
  })

  it('fails closed for custom matrices, missing trusted CA/PA and age 30+', () => {
    const snapshot = trustedGkSnapshot()
    const currentRoleScore = canonicalGkScore(snapshot)!
    const custom = potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore: currentRoleScore + 0.1, scoreKey: 'IP:GK:GK|OOP:GK:GK', loadedModel: loadedModel() })
    expect(custom.unavailableReason).toBe('CUSTOM_MATRIX_UNSUPPORTED')

    const missingAbility = potentialRoleCeilingForSnapshot({
      snapshot: { ...snapshot, normalized_data: { birth_date: '2005-01-01' } },
      currentRoleScore,
      scoreKey: 'IP:GK:GK|OOP:GK:GK',
      loadedModel: loadedModel(),
    })
    expect(missingAbility.unavailableReason).toBe('ABILITY_UNAVAILABLE')

    const age30 = trustedGkSnapshot('1996-01-01')
    const age30Score = canonicalGkScore(age30)!
    const outside = potentialRoleCeilingForSnapshot({ snapshot: age30, currentRoleScore: age30Score, scoreKey: 'IP:GK:GK|OOP:GK:GK', loadedModel: loadedModel() })
    expect(outside.unavailableReason).toBe('UNSUPPORTED_AGE_DOMAIN')
  })
})
