import { describe, expect, it } from 'vitest'
import { contextualCpPercentile, exactAgeYears, mentalDevelopmentIndex, projectScore, Q_HIGH, Q_LOW, saturatedTrait, weightedQuantile } from './projection-engine'
import type { ProjectionReference } from './projection-reference'

function reference(): ProjectionReference {
  const observations = Array.from({ length: 300 }, (_, index) => ({ age: 18 + (index % 20) / 20, score: 11 + (index % 40) / 20, cp: 100 + index % 101 }))
  const growth = Array.from({ length: 8 }, (_, offset) => ({ scoreType: 'general' as const, scoreKey: 'OUTFIELD', ageStart: 18 + offset, deltas: Array.from({ length: 300 }, (_, index) => 0.05 + (index % 100) / 100) }))
  return { referenceVersion: 'fm26-v1', projectionModelVersion: '1.0', mode: 'calibrated', calibrated: true, sample: { uniquePlayers: 10000, transitions: 50000 }, cohorts: [{ scoreType: 'general', scoreKey: 'OUTFIELD', observations }], growth }
}

describe('Projection Model v1.0', () => {
  it('calcula idade exata usando 365.2425 dias', () => {
    const age = exactAgeYears('2008-01-01', '2026-10-01')
    expect(age).not.toBeNull()
    expect(age!).toBeGreaterThan(18.7)
    expect(age!).toBeLessThan(18.8)
  })

  it('satura Ambition/Determination após 10', () => {
    expect(saturatedTrait(1)).toBeCloseTo(0)
    expect(saturatedTrait(10)).toBeCloseTo(0.75)
    expect(saturatedTrait(20)).toBeCloseTo(1)
    expect(saturatedTrait(15) - saturatedTrait(10)).toBeLessThan(saturatedTrait(10) - saturatedTrait(5))
  })

  it('mantém MDI entre zero e um', () => {
    expect(mentalDevelopmentIndex(1, 1, 1)).toBeGreaterThanOrEqual(0)
    expect(mentalDevelopmentIndex(20, 20, 20)).toBeLessThanOrEqual(1)
  })

  it('mantém percentil contextual entre zero e um', () => {
    const result = contextualCpPercentile(reference().cohorts[0].observations, 18.6, 12.1, 165)
    expect(result).not.toBeNull()
    expect(result!.percentile).toBeGreaterThanOrEqual(0)
    expect(result!.percentile).toBeLessThanOrEqual(1)
    expect(result!.effectiveSample).toBeGreaterThan(0)
  })

  it('calcula quantil ponderado', () => {
    expect(weightedQuantile([1, 2, 3, 4], 0.5)).toBe(2)
    expect(weightedQuantile([1, 2, 3, 4], Q_LOW)).toBe(1)
    expect(weightedQuantile([1, 2, 3, 4], Q_HIGH)).toBe(4)
  })

  it('nunca projeta abaixo da nota atual nem acima de 20', () => {
    const result = projectScore({ currentScore: 14, cp: 170, birthDate: '2008-01-01', snapshotDate: '2026-10-01', professionalism: 18, ambition: 15, determination: 14, scoreType: 'general', scoreKey: 'OUTFIELD', reference: reference() })
    expect(result.status).toBe('ok')
    expect(result.projectedScore!).toBeGreaterThanOrEqual(14)
    expect(result.projectedScore!).toBeLessThanOrEqual(20)
    expect(result.trajectoryQuantile!).toBeGreaterThanOrEqual(Q_LOW)
    expect(result.trajectoryQuantile!).toBeLessThanOrEqual(Q_HIGH)
  })

  it('reduz o primeiro intervalo pela idade fracionária', () => {
    const base = reference()
    const early = projectScore({ currentScore: 12, cp: 150, birthDate: '2008-01-01', snapshotDate: '2026-01-02', professionalism: 10, ambition: 10, determination: 10, scoreType: 'general', scoreKey: 'OUTFIELD', reference: base })
    const late = projectScore({ currentScore: 12, cp: 150, birthDate: '2008-01-01', snapshotDate: '2026-10-01', professionalism: 10, ambition: 10, determination: 10, scoreType: 'general', scoreKey: 'OUTFIELD', reference: base })
    expect(early.status).toBe('ok')
    expect(late.status).toBe('ok')
    expect(early.projectedScore!).toBeGreaterThanOrEqual(late.projectedScore!)
  })

  it('não inventa futuro quando o pico já foi atingido', () => {
    const result = projectScore({ currentScore: 15, cp: 170, birthDate: '1998-01-01', snapshotDate: '2026-08-26', scoreType: 'general', scoreKey: 'OUTFIELD', reference: reference() })
    expect(result.status).toBe('peak_reached')
    expect(result.projectedScore).toBeNull()
  })

  it('falha fechado quando CP ou referência faltam', () => {
    expect(projectScore({ currentScore: 12, cp: null, birthDate: '2008-01-01', snapshotDate: '2026-08-26', scoreType: 'general', scoreKey: 'OUTFIELD', reference: reference() }).status).toBe('missing_cp')
    expect(projectScore({ currentScore: 12, cp: 160, birthDate: '2008-01-01', snapshotDate: '2026-08-26', scoreType: 'general', scoreKey: 'OUTFIELD', reference: null }).status).toBe('missing_reference')
  })

  it('é determinístico para a mesma entrada e versão', () => {
    const input = { currentScore: 13.2, cp: 155, birthDate: '2008-03-10', snapshotDate: '2026-08-26', professionalism: 14, ambition: 12, determination: 16, scoreType: 'general' as const, scoreKey: 'OUTFIELD', reference: reference() }
    expect(projectScore(input)).toEqual(projectScore(input))
  })
})


function alphaReference(): ProjectionReference {
  const curvesByIntegerAge = Object.fromEntries(Array.from({ length: 14 }, (_, index) => {
    const age = 14 + index
    return [age, { anchors: [0.167, 0.25, 0.5, 0.75, 0.833], values: [-0.1, 0, 0.2, 0.5, 0.65].map(value => value * Math.max(0.1, (28 - age) / 12)) }]
  }))
  return {
    referenceVersion: 'alpha1', projectionModelVersion: '1.0', mode: 'experimental-alpha1', calibrated: false, cohorts: [], growth: [],
    peakAges: { 'general:OUTFIELD': 26, 'general:GK': 28 },
    experimental: { sourceId: 'projection_reference_fm26_alpha1', cpAdapter: 'absolute_scale_standin', functionProjectionMode: 'reuse_generic_delta_for_ui_test_only', curvesByIntegerAge, persistResults: false, observedRows: 57 },
  }
}

describe('Projection Model alpha1 experimental', () => {
  it('usa o CP apenas como adaptador absoluto temporário e não o rotula como percentil contextual', () => {
    const low = projectScore({ currentScore: 12, cp: 80, birthDate: '2008-01-01', snapshotDate: '2026-08-26', professionalism: 10, ambition: 10, determination: 10, scoreType: 'general', scoreKey: 'OUTFIELD', reference: alphaReference() })
    const high = projectScore({ currentScore: 12, cp: 180, birthDate: '2008-01-01', snapshotDate: '2026-08-26', professionalism: 10, ambition: 10, determination: 10, scoreType: 'general', scoreKey: 'OUTFIELD', reference: alphaReference() })
    expect(low.status).toBe('ok')
    expect(high.status).toBe('ok')
    expect(low.cpPercentile).toBeNull()
    expect(high.cpPercentile).toBeNull()
    expect(high.projectedScore!).toBeGreaterThanOrEqual(low.projectedScore!)
  })

  it('reutiliza a curva genérica para uma nota funcional apenas no modo experimental', () => {
    const result = projectScore({ currentScore: 13.4, cp: 160, birthDate: '2008-01-01', snapshotDate: '2026-08-26', professionalism: 14, ambition: 12, determination: 13, scoreType: 'function', scoreKey: 'IP:D(C):CD', reference: alphaReference() })
    expect(result.status).toBe('ok')
    expect(result.referenceMode).toBe('experimental-alpha1')
    expect(result.projectedScore!).toBeGreaterThanOrEqual(13.4)
  })
})
