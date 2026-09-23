import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { canonicalBytes, sha256Bytes } from './world-census-protocol'
import {
  buildWorldPlayerEvolutionShadow,
  compareWorldPlayerCoreProjection,
  verifyWorldPlayerCoreProjectionForRun,
  worldProjectionRowToEvolutionSnapshot,
  type WorldPlayerCoreProjectionGateway,
  type WorldPlayerCoreProjectionRow,
} from './world-player-evolution'

function row(overrides: Partial<WorldPlayerCoreProjectionRow> = {}): WorldPlayerCoreProjectionRow {
  const positions = Array(15).fill(10)
  positions[3] = 18
  const attributes = Array(54).fill(12)
  attributes[24] = 8
  attributes[25] = 20
  return {
    id: 'projection-1', save_id: 'save-1', lineage_id: 'lineage-1', checkpoint_id: 'checkpoint-1', reader_run_id: 'run-1',
    world_person_record_id: 'record-1', person_entity_id: 'entity-1', identity_epoch_id: 'epoch-1', person_record_ref: 1,
    uid: 2_000_000_001, checkpoint_date: '2031-06-15', is_canonical: true, identity_linkage_status: 'confirmed',
    identity_linkage_reason: 'same_epoch_birth_guard', identity_birth_date: '2011-07-01', core_status: 'confirmed',
    core_reason_code: 'ability_owned_by_person_record', ca: 120, pa: 155, position_ratings: positions, attributes_1_20: attributes,
    height_cm: 182, evidence_refs: [2], derivation_ref: 3, ...overrides,
  }
}

function directFromProjection(projection: WorldPlayerCoreProjectionRow) {
  return {
    person_record_ref: projection.person_record_ref,
    status: projection.core_status,
    reason_code: projection.core_reason_code,
    ca: projection.ca,
    pa: projection.pa,
    positions: projection.position_ratings,
    attributes_1_20: projection.attributes_1_20,
    height_cm: projection.height_cm,
    evidence_refs: projection.evidence_refs,
    derivation_ref: projection.derivation_ref,
  }
}

describe('WC-E Player Evolution shadow projection', () => {
  it('maps a confirmed World player-core row to Player Evolution shape', () => {
    const snapshot = worldProjectionRowToEvolutionSnapshot(row())
    expect(snapshot?.positions).toEqual(['DC'])
    expect(snapshot?.age).toBe(19)
    expect(snapshot?.normalized_data?.feet).toEqual({ left: 8, right: 20 })
    expect(snapshot?.player_attributes.find(item => item.attribute_key === 'team_work')?.value).toBe(12)
    expect(snapshot?.player_attributes.find(item => item.attribute_key === 'punching')?.value).toBe(12)
    expect(snapshot?.player_attributes.some(item => item.attribute_key === 'left_foot')).toBe(false)
  })

  it('breaks continuity on unknown core and on a new identity epoch', () => {
    const rows = [
      row({ id: 'p1', checkpoint_date: '2031-01-01', reader_run_id: 'r1' }),
      row({ id: 'p2', checkpoint_date: '2031-02-01', reader_run_id: 'r2' }),
      row({ id: 'p3', checkpoint_date: '2031-03-01', reader_run_id: 'r3', core_status: 'unknown', core_reason_code: 'ability_not_owned_or_missing', ca: null, pa: null, position_ratings: null, attributes_1_20: null, height_cm: null }),
      row({ id: 'p4', checkpoint_date: '2031-04-01', reader_run_id: 'r4' }),
      row({ id: 'p5', checkpoint_date: '2031-05-01', reader_run_id: 'r5', identity_epoch_id: 'epoch-2' }),
    ]
    expect(buildWorldPlayerEvolutionShadow(rows).segments.map(segment => segment.map(point => point.snapshot_date))).toEqual([
      ['2031-01-01', '2031-02-01'], ['2031-04-01'], ['2031-05-01'],
    ])
  })

  it('refuses to merge one UID across multiple World lineages', () => {
    const shadow = buildWorldPlayerEvolutionShadow([row(), row({ id: 'p2', lineage_id: 'lineage-2', checkpoint_date: '2031-07-15' })])
    expect(shadow.diagnostic).toBe('multiple_world_lineages_for_uid')
    expect(shadow.segments).toEqual([])
  })

  it('compares projection to the direct package-domain shape', async () => {
    const projection = row()
    const direct = [directFromProjection(projection)]
    const equal = await compareWorldPlayerCoreProjection(direct, [projection])
    expect(equal.matches).toBe(true)
    const changed = await compareWorldPlayerCoreProjection(direct, [row({ ca: 121 })])
    expect(changed.matches).toBe(false)
    expect(changed.differingRefs).toEqual([1])
  })

  it('reads an inherited player-core domain from the anchor package and proves projection equivalence', async () => {
    const projection = row({ reader_run_id: 'run-overlay' })
    const direct = directFromProjection(projection)
    const payload = { schema_version: 'world-state-segment-v1', domain: 'player_core_facts', ordinal: 0, items: [direct] }
    const raw = canonicalBytes(payload)
    const hash = await sha256Bytes(raw)
    const compressed = new Blob([gzipSync(raw)])
    const gateway: WorldPlayerCoreProjectionGateway = {
      loadRowsByUid: async () => [projection],
      loadRowsByRun: async () => [projection],
      loadPackage: async () => ({ id: 'overlay-package', base_anchor_package_id: 'anchor-package', domain_actions: { player_core_facts: 'inherit' } }),
      loadSegments: async packageId => packageId === 'anchor-package' ? [{ ordinal: 0, storage_bucket: 'fm-world-state', storage_path: 'segment.gz', segment_hash: hash, codec: 'gzip-json-v1', schema_version: 'world-state-segment-v1' }] : [],
      download: async () => compressed,
    }
    const result = await verifyWorldPlayerCoreProjectionForRun('run-overlay', gateway)
    expect(result.domainAction).toBe('inherit')
    expect(result.effectivePackageId).toBe('anchor-package')
    expect(result.matches).toBe(true)
  })
})
