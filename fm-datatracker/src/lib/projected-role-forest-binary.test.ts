import { describe, expect, it } from 'vitest'
import { parseProjectedRoleForest, predictProjectedRoleForest, PROJECTED_ROLE_FOREST_MAGIC } from './projected-role-forest-binary'

function fixtureForest() {
  // One split tree, two leaves, two outputs.
  const bytes = new Uint8Array(24 + 8 + 3 * 24 + 2 * 2 * 8)
  bytes.set(new TextEncoder().encode(PROJECTED_ROLE_FOREST_MAGIC), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 1, true)
  view.setUint32(12, 2, true)
  view.setUint32(16, 1, true)
  let offset = 24
  view.setUint32(offset, 3, true); view.setUint32(offset + 4, 2, true); offset += 8
  // root: x0 <= 5 -> node1, else node2
  view.setInt32(offset, 1, true); view.setInt32(offset + 4, 2, true); view.setInt32(offset + 8, 0, true); view.setInt32(offset + 12, -1, true); view.setFloat64(offset + 16, 5, true); offset += 24
  // leaf 0
  view.setInt32(offset, -1, true); view.setInt32(offset + 4, -1, true); view.setInt32(offset + 8, -2, true); view.setInt32(offset + 12, 0, true); view.setFloat64(offset + 16, -2, true); offset += 24
  // leaf 1
  view.setInt32(offset, -1, true); view.setInt32(offset + 4, -1, true); view.setInt32(offset + 8, -2, true); view.setInt32(offset + 12, 1, true); view.setFloat64(offset + 16, -2, true); offset += 24
  view.setFloat64(offset, 1.25, true); view.setFloat64(offset + 8, -0.5, true)
  view.setFloat64(offset + 16, 3.75, true); view.setFloat64(offset + 24, 2.5, true)
  return bytes
}

describe('ProjectedRole forest binary', () => {
  it('parses and follows sklearn-compatible <= thresholds', () => {
    const forest = parseProjectedRoleForest(fixtureForest())
    expect(Array.from(predictProjectedRoleForest(forest, [5]))).toEqual([1.25, -0.5])
    expect(Array.from(predictProjectedRoleForest(forest, [5.0001]))).toEqual([3.75, 2.5])
  })

  it('fails closed on a bad feature vector', () => {
    const forest = parseProjectedRoleForest(fixtureForest())
    expect(() => predictProjectedRoleForest(forest, [])).toThrow(/feature vector/)
    expect(() => predictProjectedRoleForest(forest, [Number.NaN])).toThrow(/não-finita/)
  })
})
