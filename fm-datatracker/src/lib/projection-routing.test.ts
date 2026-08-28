import { describe, expect, it } from 'vitest'
import { PROJECTION_REFERENCE_PATH, projectionReferenceUrl } from './projection-reference'
describe('Projection v2.1 routing',()=>{
  it('respeita o BASE_URL do GitHub Pages',()=>{
    expect(PROJECTION_REFERENCE_PATH).toBe('reference/projection.fm26-v2-provisional.json')
    expect(projectionReferenceUrl('/fm-datatracker/')).toBe('/fm-datatracker/reference/projection.fm26-v2-provisional.json')
    expect(projectionReferenceUrl('/fm-datatracker')).toBe('/fm-datatracker/reference/projection.fm26-v2-provisional.json')
  })
  it('não contém fallback silencioso para alpha1',()=>{
    expect(PROJECTION_REFERENCE_PATH.toLowerCase()).not.toContain('alpha')
    expect(projectionReferenceUrl('/fm-datatracker/').toLowerCase()).not.toContain('alpha')
  })
})
