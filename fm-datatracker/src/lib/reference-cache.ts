import type { ReferenceDataset } from './reference'

type ReferenceResponse = {
  ok: boolean
  json: () => Promise<unknown>
}
type ReferenceFetch = (url: string) => Promise<ReferenceResponse>

const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

export function isReferenceDataset(value: unknown): value is ReferenceDataset {
  if (!value || typeof value !== 'object') return false
  const dataset = value as Partial<ReferenceDataset>
  if (!Number.isInteger(dataset.version) || (dataset.version ?? 0) < 1) return false
  if (typeof dataset.generatedAt !== 'string' || !dataset.generatedAt.trim()) return false
  const attributes = dataset.attributes
  if (!Array.isArray(attributes) || !attributes.every(attribute => typeof attribute === 'string')) return false
  if (!Array.isArray(dataset.markets) || !dataset.markets.every(market =>
    Boolean(market)
    && typeof market === 'object'
    && typeof market.country === 'string'
    && finiteNumber(market.division)
    && finiteNumber(market.count))) return false
  if (!Array.isArray(dataset.players) || !dataset.players.every(player =>
    Boolean(player)
    && typeof player === 'object'
    && typeof player.c === 'string'
    && finiteNumber(player.d)
    && (player.a === null || finiteNumber(player.a))
    && typeof player.p === 'string'
    && Array.isArray(player.v)
    && player.v.length === attributes.length
    && player.v.every(attribute => attribute === null || finiteNumber(attribute)))) return false
  return true
}

export function createReferenceDatasetLoader(
  getUrl: () => string,
  fetcher: ReferenceFetch = url => fetch(url),
) {
  let cached: Promise<ReferenceDataset | null> | null = null

  return function loadReferenceDataset() {
    if (cached) return cached
    const request = fetcher(getUrl())
      .then(async response => {
        if (!response.ok) return null
        const value = await response.json()
        return isReferenceDataset(value) ? value : null
      })
      .catch(() => null)

    cached = request
    void request.then(result => {
      if (result === null && cached === request) cached = null
    })
    return request
  }
}
