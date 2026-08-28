export type SaveRequestToken = Readonly<{ saveId: string; generation: number }>

/**
 * Page-scoped request generation guard. A response is authoritative only while
 * it belongs to the most recent request for the currently selected save.
 * Invalidating on effect cleanup also prevents state updates after unmount.
 */
export function createLatestSaveRequestGuard() {
  let generation = 0
  let currentSaveId: string | null = null

  return {
    begin(saveId: string): SaveRequestToken {
      currentSaveId = saveId
      generation += 1
      return { saveId, generation }
    },
    isCurrent(token: SaveRequestToken) {
      return token.generation === generation && token.saveId === currentSaveId
    },
    invalidate(token?: SaveRequestToken) {
      if (!token || (token.generation === generation && token.saveId === currentSaveId)) {
        generation += 1
        currentSaveId = null
      }
    },
  }
}
