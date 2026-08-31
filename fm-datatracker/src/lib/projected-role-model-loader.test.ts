import { describe, expect, it } from 'vitest'
import { PROJECTED_ROLE_COLD_FEATURE_KEYS } from './projected-role-model-loader'
import { PROJECTED_ROLE_OUTPUT_KEYS } from './projected-role-model-contract'

describe('ProjectedRole model loader contract', () => {
  it('keeps the frozen feature dimensions explicit', () => {
    expect(PROJECTED_ROLE_COLD_FEATURE_KEYS).toEqual([
      'continuousAge', 'currentAbility', 'potentialAbility', 'headroom',
      'professionalism', 'ambition', 'determination',
    ])
    expect(PROJECTED_ROLE_OUTPUT_KEYS).toHaveLength(47)
    expect(PROJECTED_ROLE_COLD_FEATURE_KEYS.length + PROJECTED_ROLE_OUTPUT_KEYS.length).toBe(54)
  })
})
