import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { generalScoreForSnapshot } from './base-position-score'
import { potentialGeneralCeilingForSnapshot } from './potential-general-ceiling'
import { POTENTIAL_GENERAL_GROUPS, type LoadedPotentialGeneralCeilingModel, type PotentialGeneralCeilingManifest } from './potential-general-ceiling-model'
import type { GeneralCeilingBinaryModel } from './potential-general-ceiling-binary'
import { POTENTIAL_INDIVIDUAL_ROLE_CATALOG } from './potential-role-ceiling'
import type { LoadedPotentialRoleCeilingModel, PotentialRoleCeilingManifest } from './potential-role-ceiling-model'

function generalModel(profileGain: number, coarseGain = profileGain): LoadedPotentialGeneralCeilingModel {
  const manifest: PotentialGeneralCeilingManifest = {
    schemaVersion: 'fm-datatracker-potential-general-ceiling-manifest-v2', potentialModelVersion: 'pccgs-profileq95-coarseq90-phasefloor-20260901-v2', engineVersion: 'plausible-career-ceiling-general-score-engine-v2', scoringModelVersion: '2.0', basePositionCatalogVersion: 'fixture',
    model: { file: 'fixture.bin', sha256: 'fixture', byteLength: 0, format: 'FMDTGC02', formatVersion: 2, profileTreeCount: 180, profileFeatureCount: 62, coarseTreeCount: 180, coarseFeatureCount: 15, basePositionGroupCount: 10 },
    domain: { minimumAgeGate: false, observedMinimumAgeInclusive: 15, maxAgeExclusive: 30, roleFloorMinimumAgeInclusive: 16, positionEligibilityThreshold: 15, canonicalBasePositionGroups: 10, requiresTrustedCaPa: true, requiresCompleteVisible47: true, requiresPotentialRoleCeilingV1_1WhenAgeSupported: true, customMatricesSupported: false },
    featureOrderModel: [], basePositionGroups: POTENTIAL_GENERAL_GROUPS.map((code, id) => ({ id, code })),
    combination: { method: 'maximum', components: [], roleFloorModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1', clampMin: 'current_general_score', clampMax: 20 },
  }
  const model: GeneralCeilingBinaryModel = { profile: { featureCount: 62, baseline: profileGain, trees: [] }, coarse: { featureCount: 15, baseline: coarseGain, trees: [] }, basePositionGroupCount: 10 }
  return { manifest, model }
}

function roleModel(gain: number): LoadedPotentialRoleCeilingModel {
  const manifest: PotentialRoleCeilingManifest = {
    schemaVersion: 'fm-datatracker-potential-role-ceiling-manifest-v1_1', potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1', engineVersion: 'plausible-career-ceiling-role-score-engine-v1.1', scoringModelVersion: '2.0', roleCatalogVersion: 'fixture',
    model: { file: 'fixture.bin', sha256: 'fixture', byteLength: 0, format: 'FMDTPH21', formatVersion: 2, treeCount: 180, featureCount: 51, individualRoleCount: 83 },
    domain: { minAgeInclusive: 16, maxAgeExclusive: 30, canonicalIpFunctions: 48, canonicalOopFunctions: 35, canonicalIndividualFunctions: 83, canonicalPairCapacity: 1680, requiresTrustedCaPa: true, requiresCompleteVisible47: true, customMatricesSupported: false },
    featureOrderModel: [], individualRoles: POTENTIAL_INDIVIDUAL_ROLE_CATALOG,
  }
  return { manifest, model: { individualRoleCount: 83, phase: { featureCount: 51, baseline: gain, trees: [] } } }
}

function snapshot(birthDate = '2008-01-01') {
  return {
    snapshot_date: '2027-01-01', age: 19, positions: ['DM (C)', 'M (C)', 'AM (C)'],
    normalized_data: { source: 'fm26-save-offline', ca_pa_status: 'candidate_with_provenance_not_universally_validated', birth_date: birthDate, fm_hidden: { current_ability: 100, potential_ability: 160 }, positional_ratings: { DM: 18, MC: 17, AMC: 15 } },
    player_attributes: ATTRIBUTE_CATALOG.map(attribute => ({ attribute_key: attribute.key, value: 10 })),
  }
}

describe('PlausibleCareerCeilingGeneralScore v2', () => {
  it('uses the greatest of profile, headroom-dominant and eligible base-role floors', () => {
    const player = snapshot()
    const current = generalScoreForSnapshot(player)!.score
    const result = potentialGeneralCeilingForSnapshot({ snapshot: player, loadedGeneralModel: generalModel(1, 1.5), loadedRoleModel: roleModel(2) })
    expect(result.status).toBe('AVAILABLE')
    expect(result.currentGeneralScore).toBeCloseTo(current, 12)
    expect(result.directGeneralCeiling).toBeCloseTo(current + 1, 12)
    expect(result.coarseGeneralCeiling).toBeCloseTo(current + 1.5, 12)
    expect(result.bestEligibleRoleCeiling).toBeCloseTo(current + 2, 12)
    expect(result.plausibleCareerCeilingGeneralScore).toBeCloseTo(current + 2, 12)
    expect(result.eligibleBaseGroups).toEqual(['DM', 'CM', 'AM'])
  })

  it('shows age 15 without requiring the role-floor model', () => {
    const player = snapshot('2011-06-01')
    const current = generalScoreForSnapshot(player)!.score
    const result = potentialGeneralCeilingForSnapshot({ snapshot: player, loadedGeneralModel: generalModel(1, 2), loadedRoleModel: null })
    expect(result.status).toBe('AVAILABLE')
    expect(result.plausibleCareerCeilingGeneralScore).toBeCloseTo(current + 2, 12)
    expect(result.bestEligibleRoleCeiling).toBeNull()
  })

  it('fails closed without required assets, trusted ability or supported maximum age', () => {
    const player = snapshot()
    expect(potentialGeneralCeilingForSnapshot({ snapshot: player, loadedGeneralModel: null, loadedRoleModel: roleModel(1) }).unavailableReason).toBe('MODEL_ASSET_UNAVAILABLE')
    expect(potentialGeneralCeilingForSnapshot({ snapshot: player, loadedGeneralModel: generalModel(1), loadedRoleModel: null }).unavailableReason).toBe('ROLE_FLOOR_ASSET_UNAVAILABLE')
    expect(potentialGeneralCeilingForSnapshot({ snapshot: { ...player, normalized_data: { birth_date: '2008-01-01' } }, loadedGeneralModel: generalModel(1), loadedRoleModel: roleModel(1) }).unavailableReason).toBe('ABILITY_UNAVAILABLE')
    expect(potentialGeneralCeilingForSnapshot({ snapshot: snapshot('1990-01-01'), loadedGeneralModel: generalModel(1), loadedRoleModel: roleModel(1) }).unavailableReason).toBe('UNSUPPORTED_AGE_DOMAIN')
  })
})
