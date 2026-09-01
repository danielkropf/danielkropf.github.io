import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadPotentialRoleCeilingModel, type PotentialRoleCeilingManifest } from './potential-role-ceiling-model'
import { parsePotentialRoleCeilingModel, POTENTIAL_ROLE_CEILING_MAGIC, predictPotentialCeilingEnsemble } from './potential-role-ceiling-binary'
import { POTENTIAL_INDIVIDUAL_ROLE_CATALOG } from './potential-role-ceiling'
import golden from './potential-role-ceiling-v1_1.golden.json'
import { ATTRIBUTE_CATALOG } from './attributes'

function fixtureAsset() {
  const trees = 180, header = 32, treeBytes = 48
  const bytes = new Uint8Array(header + trees * treeBytes)
  bytes.set(new TextEncoder().encode(POTENTIAL_ROLE_CEILING_MAGIC), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 2, true)
  view.setUint32(12, 51, true)
  view.setUint32(16, trees, true)
  view.setUint32(20, 83, true)
  view.setFloat64(24, 0, true)
  let offset = header
  for (let tree = 0; tree < trees; tree += 1) {
    view.setUint32(offset, 1, true)
    view.setUint32(offset + 4, 0, true)
    offset += 8
    view.setInt32(offset, -1, true)
    view.setInt32(offset + 4, -1, true)
    view.setInt32(offset + 8, -1, true)
    view.setInt32(offset + 12, -1, true)
    view.setUint32(offset + 16, 1, true)
    view.setFloat64(offset + 24, 0, true)
    view.setFloat64(offset + 32, 1 / trees, true)
    offset += 40
  }
  return bytes
}

async function digest(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))
  return [...hash].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function fixtureManifest(bytes: Uint8Array): Promise<PotentialRoleCeilingManifest> {
  return {
    schemaVersion: 'fm-datatracker-potential-role-ceiling-manifest-v1_1',
    potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1',
    engineVersion: 'plausible-career-ceiling-role-score-engine-v1.1',
    scoringModelVersion: '2.0',
    roleCatalogVersion: 'fm26-canonical-individual-83-20260901',
    model: { file: 'potential-role-ceiling.fm26-v1_1.bin', sha256: await digest(bytes), byteLength: bytes.byteLength, format: 'FMDTPH21', formatVersion: 2, treeCount: 180, featureCount: 51, individualRoleCount: 83 },
    domain: { minAgeInclusive: 16, maxAgeExclusive: 30, canonicalIpFunctions: 48, canonicalOopFunctions: 35, canonicalIndividualFunctions: 83, canonicalPairCapacity: 1680, requiresTrustedCaPa: true, requiresCompleteVisible47: true, customMatricesSupported: false },
    featureOrderModel: ['individual_role_id', 'age', 'current_single_phase_role_score', 'headroom', ...ATTRIBUTE_CATALOG.map(attribute => attribute.key)],
    individualRoles: POTENTIAL_INDIVIDUAL_ROLE_CATALOG,
  }
}

function fakeFetch(manifestUrl: string, assetUrl: string, manifest: PotentialRoleCeilingManifest, bytes: Uint8Array) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === manifestUrl) return new Response(JSON.stringify(manifest), { status: 200 })
    if (url === assetUrl) return new Response(Uint8Array.from(bytes).buffer, { status: 200 })
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('PotentialRole ceiling model loader', () => {
  it('reproduces the 24 frozen Python/sklearn golden vectors exactly', () => {
    const asset = readFileSync(new URL('../../public/reference/potential-role-ceiling.fm26-v1_1.bin', import.meta.url))
    const model = parsePotentialRoleCeilingModel(asset)
    let maxDifference = 0
    for (const testCase of golden.cases) {
      const actual = predictPotentialCeilingEnsemble(model.phase, testCase.features)
      maxDifference = Math.max(maxDifference, Math.abs(actual - testCase.expectedGain))
    }
    expect(maxDifference).toBeLessThan(1e-12)
  })

  it('resolves the asset relative to the manifest and validates the frozen binary contract', async () => {
    const bytes = fixtureAsset()
    const manifest = await fixtureManifest(bytes)
    const manifestUrl = 'https://example.test/fm-datatracker/reference/potential-role-ceiling.fm26-v1_1.manifest.json'
    const assetUrl = 'https://example.test/fm-datatracker/reference/potential-role-ceiling.fm26-v1_1.bin'
    const loaded = await loadPotentialRoleCeilingModel(manifestUrl, fakeFetch(manifestUrl, assetUrl, manifest, bytes))
    expect(loaded.model.phase.trees).toHaveLength(180)
    expect(loaded.model.individualRoleCount).toBe(83)
  })

  it('fails closed when SHA-256 diverges', async () => {
    const good = fixtureAsset()
    const manifest = await fixtureManifest(good)
    const bad = Uint8Array.from(good)
    bad[bad.length - 1] ^= 1
    const manifestUrl = 'https://example.test/fm-datatracker/reference/potential-role-ceiling.fm26-v1_1.manifest.json'
    const assetUrl = 'https://example.test/fm-datatracker/reference/potential-role-ceiling.fm26-v1_1.bin'
    await expect(loadPotentialRoleCeilingModel(manifestUrl, fakeFetch(manifestUrl, assetUrl, manifest, bad))).rejects.toThrow(/SHA-256/)
  })
})
