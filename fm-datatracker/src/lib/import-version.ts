export type ImportVersionState = 'current' | 'older' | 'newer' | 'unknown'

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i

export function normalizeAppVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = trimmed.match(VERSION_RE)
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null
}

export function compareAppVersions(left: string, right: string): number | null {
  const a = normalizeAppVersion(left)
  const b = normalizeAppVersion(right)
  if (!a || !b) return null
  const av = a.split('.').map(Number)
  const bv = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (av[index] < bv[index]) return -1
    if (av[index] > bv[index]) return 1
  }
  return 0
}

export function importVersionState(importVersion: unknown, currentVersion: string): ImportVersionState {
  const normalized = normalizeAppVersion(importVersion)
  if (!normalized) return 'unknown'
  const comparison = compareAppVersions(normalized, currentVersion)
  if (comparison === null) return 'unknown'
  if (comparison < 0) return 'older'
  if (comparison > 0) return 'newer'
  return 'current'
}
