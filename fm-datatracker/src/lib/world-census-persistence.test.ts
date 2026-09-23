import { describe, expect, it, vi } from 'vitest'
import type { WorldCensusStreamMessage, WorldCensusStreamPreview } from './world-census-protocol'
import {
  persistWorldCensusCheckpoint,
  type WorldCensusPersistenceClient,
} from './world-census-persistence'
import type { WorldCensusWorkerRunOptions, WorldCensusWorkerResult } from './world-census-worker-client'

const OWNER = '11111111-1111-4111-8111-111111111111'
const SAVE = '22222222-2222-4222-8222-222222222222'
const RUN = 'world-census:test-run'
const SHA = 'a'.repeat(64)
const COVERAGE_HASH = 'b'.repeat(64)

const messages: WorldCensusStreamMessage[] = [
  {
    type: 'run_begin', seq: 0, run_id: RUN, protocol_version: 'world-census-stream-v1', message_budget_bytes: 196608,
    source_artifact: { sha256: SHA, file_name: 'test.fm', byte_length: 3, internal_name: 'Test Save' },
    checkpoint: '2031-12-15', output_contract_version: 'world-census-run-v1', representation_version: 'world-census-representation-v1',
    reader_version: 'wc-a-reader-v1', planned_capabilities: [],
  },
  {
    type: 'entity_batch', seq: 1, run_id: RUN, batch_index: 0, domain: 'person_records',
    items: [{ person_record_ref: 1, person_record_key: 'person:10:2000000020@100', eid: 10, uid: 2_000_000_020, identity_offset: 100, boundary_start: 50, boundary_end: 100, resolution_method: 'unique_player_stats_identity' }], item_count: 1, payload_hash: 'c'.repeat(64),
  },
  {
    type: 'fact_batch', seq: 2, run_id: RUN, batch_index: 1, domain: 'biography_facts',
    items: [{ person_record_ref: 1, status: 'confirmed', grammar: 'standard', reason_code: 'standard_biography_owned_by_person_record', birth_date: '2001-02-03', display_name: 'Test Player', hidden_personality: [10, 11, 12, 13, 14, 15, 16, 17] }], item_count: 1, payload_hash: 'f'.repeat(64),
  },
  {
    type: 'fact_batch', seq: 3, run_id: RUN, batch_index: 2, domain: 'player_core_facts',
    items: [{ person_record_ref: 1, status: 'confirmed', reason_code: 'ability_owned_by_person_record', ca: 120, pa: 150,
      positions: Array(15).fill(15), attributes_1_20: Array(54).fill(12), height_cm: 180,
      evidence_refs: [2], derivation_ref: 3 }], item_count: 1, payload_hash: '8'.repeat(64),
  },
  {
    type: 'coverage_final', seq: 4, run_id: RUN,
    manifest: { version: 'world-coverage-manifest-v1', capabilities: [] }, manifest_hash: COVERAGE_HASH,
  },
  {
    type: 'run_end', seq: 5, run_id: RUN, coverage_hash: COVERAGE_HASH, logical_hash: 'd'.repeat(64),
    domain_counts: { person_records: 1, biography_facts: 1, player_core_facts: 1 }, domain_hashes: { person_records: 'e'.repeat(64), biography_facts: '9'.repeat(64), player_core_facts: '8'.repeat(64) },
    dictionary_count: 0, entity_count: 1, fact_count: 2, decoder_catalog: [], diagnostics: {},
  },
]

type FakeState = {
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  uploads: Array<{ bucket: string; path: string; size: number }>
  removes: Array<{ bucket: string; paths: string[] }>
}

function fakeClient(args: { finalizeFails?: boolean; failChanged?: boolean; identityStageFails?: boolean; coreStageFails?: boolean } = {}): { client: WorldCensusPersistenceClient; state: FakeState } {
  const state: FakeState = { rpcCalls: [], uploads: [], removes: [] }
  const client: WorldCensusPersistenceClient = {
    auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) },
    rpc: async (name, rpcArgs) => {
      state.rpcCalls.push({ name, args: rpcArgs })
      if (name === 'world_census_begin') return { data: {
        source_artifact_id: 'source-1', source_reused: false, source_bucket: 'fm-world-sources', source_path: `${OWNER}/${SHA}.fm`,
        lineage_id: 'lineage-1', checkpoint_id: 'checkpoint-1', reader_run_id: 'reader-run-1', previous_canonical_reader_run_id: null,
      }, error: null }
      if (name === 'world_census_stage_identity_rows' && args.identityStageFails) return { data: null, error: { message: 'identity_stage_failed' } }
      if (name === 'world_census_stage_player_core_rows' && args.coreStageFails) return { data: null, error: { message: 'player_core_stage_failed' } }
      if (name === 'world_census_finalize') {
        if (args.finalizeFails) return { data: null, error: { message: 'network_after_or_before_finalize' } }
        return { data: {
          reader_run_id: 'reader-run-1', checkpoint_id: 'checkpoint-1', package_id: 'package-1', package_kind: 'full_anchor',
          base_anchor_package_id: null, package_hash: 'f'.repeat(64), compressed_bytes: 10, uncompressed_bytes: 20,
          overlay_full_ratio: 1, read_amplification: 1, discard_paths: [],
        }, error: null }
      }
      if (name === 'world_census_fail') return { data: {
        changed: args.failChanged ?? true,
        discard_paths: state.uploads.filter(item => item.bucket === 'fm-world-state').map(item => item.path),
      }, error: null }
      return { data: { inserted: 1 }, error: null }
    },
    storage: {
      from: bucket => ({
        upload: async (path, body) => {
          const size = body instanceof Blob ? body.size : body instanceof ArrayBuffer ? body.byteLength : body instanceof Uint8Array ? body.byteLength : 0
          state.uploads.push({ bucket, path, size })
          return { data: { path }, error: null }
        },
        list: async () => ({ data: [], error: null }),
        remove: async paths => {
          state.removes.push({ bucket, paths: [...paths] })
          return { data: {}, error: null }
        },
      }),
    },
  }
  return { client, state }
}

function workerStarter() {
  return (_bytes: ArrayBuffer, _fileName: string, options: WorldCensusWorkerRunOptions = {}) => {
    const promise = (async (): Promise<WorldCensusWorkerResult> => {
      for (const message of messages) {
        await options.onValidatedMessage?.(message, {
          status: 'accepted', seq: message.seq, message_hash: (message.seq.toString(16) || '0').repeat(64), complete: message.type === 'run_end',
        })
      }
      const preview: WorldCensusStreamPreview = {
        protocol_version: 'world-census-stream-v1', run_id: RUN, source_artifact: messages[0].type === 'run_begin' ? messages[0].source_artifact : { sha256: null, file_name: null, byte_length: null },
        checkpoint: '2031-12-15', output_contract_version: 'world-census-run-v1', representation_version: 'world-census-representation-v1', reader_version: 'wc-a-reader-v1',
        coverage_manifest: { version: 'world-coverage-manifest-v1', capabilities: [] }, logical_hash: 'd'.repeat(64), domain_counts: { person_records: 1 }, decoder_catalog: [], diagnostics: {},
      }
      return { preview, transport: { messages: 6, protocol_bytes: 1, max_message_bytes: 1, max_unacked: 1, max_synchronous_post_message_ms: 0, ack_wait_ms_total: 0, ack_wait_ms_max: 0, wall_ms: 1 } }
    })()
    return { request_id: 'fake', promise, cancel: vi.fn() }
  }
}

const gzip = async (bytes: Uint8Array) => new Uint8Array(Math.max(1, Math.ceil(bytes.byteLength / 2)))

function file(): File { return new File([new Uint8Array([1, 2, 3])], 'test.fm', { type: 'application/octet-stream' }) }

describe('World Census persistence', () => {
  it('persists source, segments, receipts and finalizes the ReaderRun', async () => {
    const { client, state } = fakeClient()
    const result = await persistWorldCensusCheckpoint({
      saveId: SAVE, file: file(), expectedCheckpoint: '2031-12-15',
      dependencies: { client, workerStarter: workerStarter(), gzip },
    })
    expect(result.package_kind).toBe('full_anchor')
    expect(state.uploads.some(item => item.bucket === 'fm-world-sources' && item.path === `${OWNER}/${SHA}.fm`)).toBe(true)
    expect(state.uploads.some(item => item.bucket === 'fm-world-state' && item.path.includes('/person_records/'))).toBe(true)
    expect(state.rpcCalls.filter(call => call.name === 'world_census_stage_identity_rows')).toHaveLength(2)
    expect(state.rpcCalls.filter(call => call.name === 'world_census_stage_player_core_rows')).toHaveLength(1)
    expect(state.rpcCalls.map(call => call.name).indexOf('world_census_stage_identity_rows')).toBeLessThan(state.rpcCalls.map(call => call.name).indexOf('world_census_finalize'))
    expect(state.rpcCalls.map(call => call.name).indexOf('world_census_stage_player_core_rows')).toBeLessThan(state.rpcCalls.map(call => call.name).indexOf('world_census_finalize'))
    expect(state.rpcCalls.map(call => call.name)).toContain('world_census_stage_segments')
    expect(state.rpcCalls.map(call => call.name)).toContain('world_census_record_batch_receipts')
    expect(state.rpcCalls.map(call => call.name)).toContain('world_census_finalize')
  })

  it('fails before finalization when identity staging fails', async () => {
    const { client, state } = fakeClient({ identityStageFails: true })
    await expect(persistWorldCensusCheckpoint({
      saveId: SAVE, file: file(), expectedCheckpoint: '2031-12-15',
      dependencies: { client, workerStarter: workerStarter(), gzip },
    })).rejects.toThrow(/world_census_stage_identity_rows/)
    expect(state.rpcCalls.map(call => call.name)).not.toContain('world_census_finalize')
    expect(state.rpcCalls.map(call => call.name)).toContain('world_census_fail')
  })

  it('fails before finalization when player-core projection staging fails', async () => {
    const { client, state } = fakeClient({ coreStageFails: true })
    await expect(persistWorldCensusCheckpoint({
      saveId: SAVE, file: file(), expectedCheckpoint: '2031-12-15',
      dependencies: { client, workerStarter: workerStarter(), gzip },
    })).rejects.toThrow(/world_census_stage_player_core_rows/)
    expect(state.rpcCalls.map(call => call.name)).not.toContain('world_census_finalize')
    expect(state.rpcCalls.map(call => call.name)).toContain('world_census_fail')
  })

  it('marks a staging run failed and removes staged state objects when finalize fails', async () => {
    const { client, state } = fakeClient({ finalizeFails: true, failChanged: true })
    await expect(persistWorldCensusCheckpoint({
      saveId: SAVE, file: file(), expectedCheckpoint: '2031-12-15',
      dependencies: { client, workerStarter: workerStarter(), gzip },
    })).rejects.toThrow(/world_census_finalize/)
    expect(state.rpcCalls.map(call => call.name)).toContain('world_census_fail')
    expect(state.removes.some(item => item.bucket === 'fm-world-state' && item.paths.length > 0)).toBe(true)
    expect(state.removes.some(item => item.bucket === 'fm-world-sources')).toBe(false)
  })

  it('does not delete state objects when failure recovery reports the run is already non-staging', async () => {
    const { client, state } = fakeClient({ finalizeFails: true, failChanged: false })
    await expect(persistWorldCensusCheckpoint({
      saveId: SAVE, file: file(), expectedCheckpoint: '2031-12-15',
      dependencies: { client, workerStarter: workerStarter(), gzip },
    })).rejects.toThrow(/world_census_finalize/)
    expect(state.rpcCalls.map(call => call.name)).toContain('world_census_fail')
    expect(state.removes).toEqual([])
  })
})
