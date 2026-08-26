import { describe, expect, it } from 'vitest'
import { compareAppVersions, importVersionState, normalizeAppVersion } from './import-version'

describe('import version metadata', () => {
  it('normalizes semantic versions used by the app', () => {
    expect(normalizeAppVersion('v0.24.2')).toBe('0.24.2')
    expect(normalizeAppVersion('0.24.2')).toBe('0.24.2')
    expect(normalizeAppVersion('legacy')).toBeNull()
  })

  it('compares patch, minor and major versions numerically', () => {
    expect(compareAppVersions('0.24.1', '0.24.2')).toBe(-1)
    expect(compareAppVersions('0.23.9', '0.24.0')).toBe(-1)
    expect(compareAppVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareAppVersions('0.24.2', '0.24.2')).toBe(0)
  })

  it('classifies historical imports without inventing a version', () => {
    expect(importVersionState('0.24.1', '0.24.2')).toBe('older')
    expect(importVersionState('0.24.2', '0.24.2')).toBe('current')
    expect(importVersionState('0.25.0', '0.24.2')).toBe('newer')
    expect(importVersionState(null, '0.24.2')).toBe('unknown')
  })
})
