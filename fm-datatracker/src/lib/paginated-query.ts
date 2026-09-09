type Page<T> = { data: T[] | null; error: unknown }
type RangeQuery<T> = { range: (from: number, to: number) => PromiseLike<Page<T>> }

/** Stable ordering with a unique tie-breaker is required at every call site.
 * Advance by actual rows, so a lower server cap cannot silently truncate data.
 * Never expose partial results after a failed page.
 */
export async function paginatedQuery<T>(createQuery: () => RangeQuery<T>, pageSize = 500): Promise<{ data: T[]; error: null }> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('Tamanho de página inválido.')
  const rows: T[] = []
  for (;;) {
    const result = await createQuery().range(rows.length, rows.length + pageSize - 1)
    if (result.error) throw result.error
    const page = result.data ?? []
    if (!page.length) return { data: rows, error: null }
    rows.push(...page)
  }
}
