export type DirtyField = { value: unknown; revision: number }
export type DirtyPatchState = Record<string, DirtyField>
export type DirtySnapshot = { patch: Record<string, unknown>; revisions: Record<string, number> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function configValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => configValueEqual(value, right[index]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false
    return leftKeys.every(key => configValueEqual(left[key], right[key]))
  }
  return false
}

/**
 * Marks only values that still differ from the last server-confirmed config.
 * Re-marking the same dirty value does not create a new revision; this prevents
 * an immediate structural save from being duplicated by the page autosave effect.
 */
export function addDirtyPatch(
  current: DirtyPatchState,
  patch: Record<string, unknown>,
  confirmed: Record<string, unknown>,
  nextRevision: () => number,
): DirtyPatchState {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    const existing = next[key]
    if (configValueEqual(confirmed[key], value)) {
      if (existing) delete next[key]
      continue
    }
    if (existing && configValueEqual(existing.value, value)) continue
    next[key] = { value, revision: nextRevision() }
  }
  return next
}

export function captureDirtyPatch(state: DirtyPatchState): DirtySnapshot | null {
  const entries = Object.entries(state)
  if (!entries.length) return null
  return {
    patch: Object.fromEntries(entries.map(([key, field]) => [key, field.value])),
    revisions: Object.fromEntries(entries.map(([key, field]) => [key, field.revision])),
  }
}

/** Removes only revisions that were actually confirmed by the completed write. */
export function confirmDirtyPatch(state: DirtyPatchState, snapshot: DirtySnapshot): DirtyPatchState {
  const next = { ...state }
  for (const [key, revision] of Object.entries(snapshot.revisions)) {
    if (next[key]?.revision === revision) delete next[key]
  }
  return next
}

export function dirtyPatchValues(state: DirtyPatchState): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).map(([key, field]) => [key, field.value]))
}
