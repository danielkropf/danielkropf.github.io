import type { EvolutionCheckpoint, EvolutionSnapshot } from './player-evolution'

export const EVOLUTION_DETAIL_PAGE_SIZE = 12

export type EvolutionRange<T extends EvolutionSnapshot = EvolutionSnapshot> = {
  snapshots: T[]
  startIndex: number
  endIndex: number
  normalizedFromId: string
  normalizedToId: string
}

export type EvolutionPage<T> = {
  items: T[]
  page: number
  pageSize: number
  pageCount: number
  total: number
  start: number
  end: number
}

export type EvolutionTrendPoint = {
  snapshotId: string
  snapshotDate: string
  age: number | null
  generalScore: number
  checkpointIndex: number
}

export function evolutionRange<T extends EvolutionSnapshot>(
  orderedSnapshots: T[],
  fromSnapshotId: string,
  toSnapshotId: string,
): EvolutionRange<T> {
  if (!orderedSnapshots.length) {
    return {
      snapshots: [],
      startIndex: 0,
      endIndex: -1,
      normalizedFromId: '',
      normalizedToId: '',
    }
  }

  const fallbackFrom = 0
  const fallbackTo = orderedSnapshots.length - 1
  const requestedFrom = orderedSnapshots.findIndex(snapshot => snapshot.id === fromSnapshotId)
  const requestedTo = orderedSnapshots.findIndex(snapshot => snapshot.id === toSnapshotId)
  const fromIndex = requestedFrom >= 0 ? requestedFrom : fallbackFrom
  const toIndex = requestedTo >= 0 ? requestedTo : fallbackTo
  const startIndex = Math.min(fromIndex, toIndex)
  const endIndex = Math.max(fromIndex, toIndex)

  return {
    snapshots: orderedSnapshots.slice(startIndex, endIndex + 1),
    startIndex,
    endIndex,
    normalizedFromId: orderedSnapshots[startIndex].id,
    normalizedToId: orderedSnapshots[endIndex].id,
  }
}

export function generalScoreSegments(checkpoints: EvolutionCheckpoint[]): EvolutionTrendPoint[][] {
  const segments: EvolutionTrendPoint[][] = []
  let current: EvolutionTrendPoint[] = []

  checkpoints.forEach((checkpoint, checkpointIndex) => {
    if (checkpoint.generalScore === null || !Number.isFinite(checkpoint.generalScore)) {
      if (current.length) segments.push(current)
      current = []
      return
    }

    current.push({
      snapshotId: checkpoint.snapshotId,
      snapshotDate: checkpoint.snapshotDate,
      age: checkpoint.age,
      generalScore: checkpoint.generalScore,
      checkpointIndex,
    })
  })

  if (current.length) segments.push(current)
  return segments
}

export function paginateEvolution<T>(items: T[], requestedPage: number, pageSize = EVOLUTION_DETAIL_PAGE_SIZE): EvolutionPage<T> {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : EVOLUTION_DETAIL_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize))
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1, 1), pageCount)
  const startIndex = (page - 1) * safePageSize
  const pageItems = items.slice(startIndex, startIndex + safePageSize)

  return {
    items: pageItems,
    page,
    pageSize: safePageSize,
    pageCount,
    total: items.length,
    start: items.length ? startIndex + 1 : 0,
    end: items.length ? startIndex + pageItems.length : 0,
  }
}
