import { describe, expect, it } from 'vitest'
import { addDirtyPatch, captureDirtyPatch, confirmDirtyPatch, dirtyPatchValues, type DirtyPatchState } from './model-config-dirty'

function revisions() {
  let value = 0
  return () => ++value
}

describe('Model Lab dirty patch state', () => {
  it('keeps a failed tactics patch when a later planning patch is added and confirmed separately', () => {
    const nextRevision = revisions()
    let state: DirtyPatchState = {}
    state = addDirtyPatch(state, { tactics: [{ id: 'A' }] }, {}, nextRevision)
    const failedWrite = captureDirtyPatch(state)!

    state = addDirtyPatch(state, { planning: { group: 'principal' } }, {}, nextRevision)
    const laterWrite = captureDirtyPatch(state)!
    expect(laterWrite.patch).toEqual({ tactics: [{ id: 'A' }], planning: { group: 'principal' } })

    // A stale completion may only confirm the revision it actually sent.
    state = confirmDirtyPatch(state, failedWrite)
    expect(dirtyPatchValues(state)).toEqual({ planning: { group: 'principal' } })
  })

  it('does not let an older successful write clear a newer revision of the same key', () => {
    const nextRevision = revisions()
    let state: DirtyPatchState = addDirtyPatch({}, { tactics: [{ id: 'A' }] }, {}, nextRevision)
    const firstWrite = captureDirtyPatch(state)!
    state = addDirtyPatch(state, { tactics: [{ id: 'A' }, { id: 'B' }] }, {}, nextRevision)
    state = confirmDirtyPatch(state, firstWrite)
    expect(dirtyPatchValues(state)).toEqual({ tactics: [{ id: 'A' }, { id: 'B' }] })
  })

  it('does not create a second dirty revision for the same value already queued', () => {
    const nextRevision = revisions()
    let state: DirtyPatchState = addDirtyPatch({}, { selected_tactic_id: 'A' }, {}, nextRevision)
    const revision = state.selected_tactic_id.revision
    state = addDirtyPatch(state, { selected_tactic_id: 'A' }, {}, nextRevision)
    expect(state.selected_tactic_id.revision).toBe(revision)
  })


  it('clears an existing dirty key when the user returns it to the confirmed value', () => {
    const nextRevision = revisions()
    let state: DirtyPatchState = addDirtyPatch({}, { selected_tactic_id: 'B' }, { selected_tactic_id: 'A' }, nextRevision)
    state = addDirtyPatch(state, { selected_tactic_id: 'A' }, { selected_tactic_id: 'A' }, nextRevision)
    expect(captureDirtyPatch(state)).toBeNull()
  })

  it('does not mark a value dirty when it already matches the confirmed server config', () => {
    const nextRevision = revisions()
    const state = addDirtyPatch({}, { planning: { a: 1 } }, { planning: { a: 1 } }, nextRevision)
    expect(captureDirtyPatch(state)).toBeNull()
  })
})
