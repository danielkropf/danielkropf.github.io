import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadProjectionReference, resetProjectionReferenceCache, validateExperimentalProjectionReference, validateProjectionReference } from './projection-reference'

describe('projection reference guard', () => {
  it('aceita apenas a referência e o modelo versionados esperados', () => {
    expect(validateProjectionReference({ referenceVersion: 'fm26-v1', projectionModelVersion: '1.0', calibrated: true, sample: { uniquePlayers: 10000, transitions: 50000 }, cohorts: [{ scoreType: 'general', scoreKey: 'OUTFIELD', observations: [{ age: 18, score: 12, cp: 150 }] }], growth: [{ scoreType: 'general', scoreKey: 'OUTFIELD', ageStart: 18, deltas: [0.5] }] })?.referenceVersion).toBe('fm26-v1')
    expect(validateProjectionReference({ referenceVersion: 'inventada', projectionModelVersion: '1.0', calibrated: true, sample: { uniquePlayers: 10000, transitions: 50000 }, cohorts: [], growth: [] })).toBeNull()
    expect(validateProjectionReference({ referenceVersion: 'fm26-v1', projectionModelVersion: '2.0', calibrated: true, sample: { uniquePlayers: 10000, transitions: 50000 }, cohorts: [], growth: [] })).toBeNull()
  })
})


describe('projection alpha1 guard', () => {
  it('aceita somente a referência experimental explicitamente marcada como não validada', () => {
    const alpha = validateExperimentalProjectionReference({
      id: 'projection_reference_fm26_alpha1', version: 'alpha1', production_ready: false, accuracy_validated: false,
      score_scope: 'generic_general_delta_proxy', function_projection_mode: 'reuse_generic_delta_for_ui_test_only',
      quantile_model: { anchors: [0.167, 0.25, 0.5, 0.75, 0.833] },
      cp_adapter_alpha: { mode: 'absolute_scale_standin_not_contextual_percentile' }, peak_age: { outfield: 26, goalkeeper: 28 },
      curves_by_integer_age: { '18': { q: { '0.167': -0.04, '0.25': 0.03, '0.5': 0.27, '0.75': 0.34, '0.833': 0.43 } } },
      raw_partial_observations: { '18': [{ player: 'Teste', attribute_delta_6m: 1 }] },
    })
    expect(alpha?.mode).toBe('experimental-alpha1')
    expect(alpha?.calibrated).toBe(false)
    expect(alpha?.experimental?.persistResults).toBe(false)
  })
})

const alphaFixture = {
  id: 'projection_reference_fm26_alpha1', version: 'alpha1', production_ready: false, accuracy_validated: false,
  score_scope: 'generic_general_delta_proxy', function_projection_mode: 'reuse_generic_delta_for_ui_test_only',
  quantile_model: { anchors: [0.167, 0.25, 0.5, 0.75, 0.833] },
  cp_adapter_alpha: { mode: 'absolute_scale_standin_not_contextual_percentile' }, peak_age: { outfield: 26, goalkeeper: 28 },
  curves_by_integer_age: { '18': { q: { '0.167': -0.04, '0.25': 0.03, '0.5': 0.27, '0.75': 0.34, '0.833': 0.43 } } },
  raw_partial_observations: { '18': [{ player: 'Teste', attribute_delta_6m: 1 }] },
}

afterEach(() => {
  resetProjectionReferenceCache()
  vi.unstubAllGlobals()
})

describe('projection reference loading fallback', () => {
  it('continua para alpha1 quando a referência calibrada responde HTML em vez de JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => '<!doctype html><html>fallback</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(alphaFixture) })
    vi.stubGlobal('fetch', fetchMock)
    resetProjectionReferenceCache()

    const state = await loadProjectionReference()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(state.status).toBe('experimental')
    expect(state.reference?.mode).toBe('experimental-alpha1')
  })

  it('continua para alpha1 quando a referência calibrada retorna 404', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(alphaFixture) })
    vi.stubGlobal('fetch', fetchMock)
    resetProjectionReferenceCache()

    const state = await loadProjectionReference()

    expect(state.status).toBe('experimental')
  })
})

