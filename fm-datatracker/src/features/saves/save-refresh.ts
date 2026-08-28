export type SaveRefreshResolution<T extends { id: string }> = {
  saves: T[]
  selected: T | null
  error: string | null
  persistActiveSaveId: string | null | undefined
}

/**
 * Reconciles a save refresh without treating backend failure as an empty list.
 * `undefined` means localStorage must not be changed; `null` means a successful
 * empty result and therefore the active-save key may be removed.
 */
export function resolveSaveRefresh<T extends { id: string }>({
  currentSaves,
  currentSelected,
  rememberedId,
  data,
  error,
}: {
  currentSaves: T[]
  currentSelected: T | null
  rememberedId: string | null
  data: T[] | null
  error: string | null
}): SaveRefreshResolution<T> {
  if (error) {
    return {
      saves: currentSaves,
      selected: currentSelected,
      error,
      persistActiveSaveId: undefined,
    }
  }

  const saves = data ?? []
  const selected = saves.find(save => save.id === currentSelected?.id)
    ?? saves.find(save => save.id === rememberedId)
    ?? saves[0]
    ?? null

  return {
    saves,
    selected,
    error: null,
    persistActiveSaveId: selected?.id ?? null,
  }
}


/** Guards overlapping refresh calls so only the latest response may mutate state. */
export function createSaveRefreshRequestGuard() {
  let generation = 0
  return {
    begin() {
      generation += 1
      return generation
    },
    isCurrent(token: number) {
      return token === generation
    },
    invalidate() {
      generation += 1
    },
  }
}
