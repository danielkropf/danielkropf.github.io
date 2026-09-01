import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import golden from './potential-general-ceiling-v2.golden.json'
import { parsePotentialGeneralCeilingModel, POTENTIAL_GENERAL_CEILING_MAGIC, predictPotentialGeneralCeiling, predictPotentialGeneralCoarseCeiling, predictPotentialGeneralCoarseCeilingMonotonic } from './potential-general-ceiling-binary'
import { loadPotentialGeneralCeilingModel, POTENTIAL_GENERAL_GROUPS, type PotentialGeneralCeilingManifest } from './potential-general-ceiling-model'

function fixtureAsset() {
  const trees = 180, header = 56, treeBytes = 48
  const bytes = new Uint8Array(header + trees * treeBytes * 2)
  bytes.set(new TextEncoder().encode(POTENTIAL_GENERAL_CEILING_MAGIC), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 2, true); view.setUint32(12, 62, true); view.setUint32(16, trees, true); view.setUint32(20, 15, true); view.setUint32(24, trees, true); view.setUint32(28, 10, true); view.setFloat64(40, 0, true); view.setFloat64(48, 0, true)
  let offset = header
  for (let ensemble = 0; ensemble < 2; ensemble += 1) {
    for (let tree = 0; tree < trees; tree += 1) {
      view.setUint32(offset, 1, true); view.setUint32(offset + 4, 0, true); offset += 8
      view.setInt32(offset, -1, true); view.setInt32(offset + 4, -1, true); view.setInt32(offset + 8, -1, true); view.setInt32(offset + 12, -1, true)
      view.setUint32(offset + 16, 1, true); view.setFloat64(offset + 24, 0, true); view.setFloat64(offset + 32, 1 / trees, true); offset += 40
    }
  }
  return bytes
}

async function digest(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))
  return [...hash].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function fixtureManifest(bytes: Uint8Array): Promise<PotentialGeneralCeilingManifest> {
  return {
    schemaVersion: 'fm-datatracker-potential-general-ceiling-manifest-v2',
    potentialModelVersion: 'pccgs-profileq95-coarseq90-phasefloor-20260901-v2',
    engineVersion: 'plausible-career-ceiling-general-score-engine-v2',
    scoringModelVersion: '2.0', basePositionCatalogVersion: 'fixture',
    model: { file: 'potential-general-ceiling.fm26-v2.bin', sha256: await digest(bytes), byteLength: bytes.byteLength, format: 'FMDTGC02', formatVersion: 2, profileTreeCount: 180, profileFeatureCount: 62, coarseTreeCount: 180, coarseFeatureCount: 15, basePositionGroupCount: 10 },
    domain: { minimumAgeGate: false, observedMinimumAgeInclusive: 15, maxAgeExclusive: 30, roleFloorMinimumAgeInclusive: 16, positionEligibilityThreshold: 15, canonicalBasePositionGroups: 10, requiresTrustedCaPa: true, requiresCompleteVisible47: true, requiresPotentialRoleCeilingV1_1WhenAgeSupported: true, customMatricesSupported: false },
    featureOrderModel: ['current_best_base_group_id', 'age', 'current_general_score', 'headroom', 'eligible_base_group_count', ...POTENTIAL_GENERAL_GROUPS.map(group => `eligible_${group.toLowerCase()}`), ...ATTRIBUTE_CATALOG.map(attribute => attribute.key)],
    basePositionGroups: POTENTIAL_GENERAL_GROUPS.map((code, id) => ({ id, code })),
    combination: { method: 'maximum', components: ['profile_general_ceiling_q95', 'headroom_dominant_coarse_floor_q90', 'best_eligible_base_role_ceiling_when_age_supported'], roleFloorModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1', clampMin: 'current_general_score', clampMax: 20 },
  }
}

describe('PotentialGeneral ceiling model loader', () => {
  it('reproduces 24 frozen Python/sklearn vectors and preserves headroom monotonicity', () => {
    const asset = readFileSync(new URL('../../public/reference/potential-general-ceiling.fm26-v2.bin', import.meta.url))
    const model = parsePotentialGeneralCeilingModel(asset)
    let maxDifference = 0
    for (const testCase of golden.cases) {
      const actual = predictPotentialGeneralCeiling(model, testCase.features)
      const coarse = predictPotentialGeneralCoarseCeiling(model, testCase.features)
      maxDifference = Math.max(maxDifference, Math.abs(actual - testCase.expectedProfileGain), Math.abs(coarse - testCase.expectedCoarseGain))
      const higherHeadroom = [...testCase.features]
      higherHeadroom[3] += 20
      expect(predictPotentialGeneralCeiling(model, higherHeadroom) + 1e-12).toBeGreaterThanOrEqual(actual)
      expect(predictPotentialGeneralCoarseCeilingMonotonic(model, higherHeadroom) + 1e-12).toBeGreaterThanOrEqual(predictPotentialGeneralCoarseCeilingMonotonic(model, testCase.features))
    }
    expect(maxDifference).toBeLessThan(1e-12)
  })

  it('loads relative assets and rejects SHA divergence', async () => {
    const bytes = fixtureAsset()
    const manifest = await fixtureManifest(bytes)
    const manifestUrl = 'https://example.test/reference/potential-general-ceiling.fm26-v2.manifest.json'
    const assetUrl = 'https://example.test/reference/potential-general-ceiling.fm26-v2.bin'
    const fetcher = ((input: RequestInfo | URL) => Promise.resolve(String(input) === manifestUrl ? new Response(JSON.stringify(manifest)) : String(input) === assetUrl ? new Response(Uint8Array.from(bytes).buffer) : new Response('', { status: 404 }))) as typeof fetch
    const loaded = await loadPotentialGeneralCeilingModel(manifestUrl, fetcher)
    expect(loaded.model.profile.trees).toHaveLength(180)
    expect(loaded.model.coarse.trees).toHaveLength(180)
    const bad = Uint8Array.from(bytes); bad[bad.length - 1] ^= 1
    const badFetcher = ((input: RequestInfo | URL) => Promise.resolve(String(input) === manifestUrl ? new Response(JSON.stringify(manifest)) : new Response(Uint8Array.from(bad).buffer))) as typeof fetch
    await expect(loadPotentialGeneralCeilingModel(manifestUrl, badFetcher)).rejects.toThrow(/SHA-256/)
  })
})
