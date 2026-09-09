// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readStoredDataTableViews, writeStoredDataTableViews } from './table-view-storage'

describe('table view storage', () => {
  afterEach(() => localStorage.clear())
  it('round-trips user table views', () => {
    const views = [{ id: 'v1', name: 'Minha visão', columns: [{ id: 'name' }], frozenIndex: 0, widths: { name: 210 } }]
    writeStoredDataTableViews('test-views', views)
    expect(readStoredDataTableViews('test-views')).toEqual(views)
  })
  it('fails closed on malformed storage', () => {
    localStorage.setItem('test-views', '{broken')
    expect(readStoredDataTableViews('test-views')).toEqual([])
  })
})
