import { describe, expect, it } from 'vitest'
import { PROJECTION_DISPLAY_MAX_AGE, shouldDisplayProjectionForAge } from './projection-visibility'

describe('projection visibility', () => {
  it('shows potential through age 29 and hides it from age 30 onward', () => {
    expect(PROJECTION_DISPLAY_MAX_AGE).toBe(29)
    expect(shouldDisplayProjectionForAge(18)).toBe(true)
    expect(shouldDisplayProjectionForAge(29)).toBe(true)
    expect(shouldDisplayProjectionForAge(29.99)).toBe(true)
    expect(shouldDisplayProjectionForAge(30)).toBe(false)
    expect(shouldDisplayProjectionForAge(38)).toBe(false)
  })

  it('keeps missing age delegated to the projection engine and fails closed on invalid numeric age', () => {
    expect(shouldDisplayProjectionForAge(null)).toBe(true)
    expect(shouldDisplayProjectionForAge(undefined)).toBe(true)
    expect(shouldDisplayProjectionForAge(Number.NaN)).toBe(false)
  })
})
