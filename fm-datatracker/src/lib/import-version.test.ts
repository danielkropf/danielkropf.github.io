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

import { needsImportUpdate, IMPORT_DATA_VERSION } from './import-version'
it('offers reprocessing only for FM imports older than the data version, not UI versions', () => {
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.35.3'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm'})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.36.0'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.42.0'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.42.1'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.43.0'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.43.1'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.43.2'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.43.3'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.43.4'}})).toBe(true)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:IMPORT_DATA_VERSION}})).toBe(false)
  expect(needsImportUpdate({original_filename:'save.fm',source_schema:{app_version:'0.99.0'}})).toBe(false)
  expect(needsImportUpdate({original_filename:'squad.csv',source_schema:{app_version:'0.30.0'}})).toBe(false)
})
