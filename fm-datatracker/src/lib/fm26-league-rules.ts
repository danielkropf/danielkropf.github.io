/** Bounded reader for the characterized competition property-tree variant (research v5).
 * Unsupported roots invalidate that node's adjacency; never select the first season.
 */
export type RuleEdge = { direction: 'up' | 'down'; target: number; places: number | null }
export type RuleRoot = { offset: number; code: string | null; level: number | null; type: number | null; year: number | null; groups: number[]; edges: RuleEdge[] }
export type LeagueRule = { uid: number; roots: RuleRoot[]; errors: number }
export type AdjacentLeague = {
  direction: 'up' | 'down'; rawTarget: number; target: number; groups: number[]
  quota: 'positive' | 'zero' | 'uncertain'; status: 'candidate'; reason: 'stable_rules_season_unselected'
}
type Value = { type: number; scalar?: number | string | null; key?: string; children?: Value[] }
const widths: Record<number, number> = { 0: 0, 5: 8, 25: 4, 32: 4, 15: 8, 1: 4, 2: 4, 3: 1, 17: 1, 18: 2, 24: 8 }
const field = (v: Value, key: string) => v.children?.find(c => c.key === key)
const scalar = (v: Value | undefined): number | string | null => v?.scalar ?? (v ? scalar(field(v, 'pmoc')) : null)
const num = (v: Value | undefined) => typeof scalar(v) === 'number' ? scalar(v) as number : null
const unique = <T,>(a: T[]) => [...new Set(a)]

export function readLeagueRule(bytes: Uint8Array, uid: number): LeagueRule {
  const result: LeagueRule = { uid, roots: [], errors: 0 }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let cursor = 0, budget = 0
  const need = (n: number) => { if (n < 0 || cursor + n > bytes.length) throw new Error('bounds') }
  const u32 = () => { need(4); const n = view.getUint32(cursor, true); cursor += 4; return n }
  const key = () => { need(4); const s = decoder.decode(bytes.subarray(cursor, cursor + 4)); cursor += 4; return s }
  const value = (depth: number): Value => {
    if (depth > 40 || ++budget > 200_000) throw new Error('complexity')
    need(2); if (bytes[cursor++] !== 1) throw new Error('prefix')
    const type = bytes[cursor++], width = widths[type]
    if (width !== undefined) {
      need(width); let n: number | null = 0
      if (type === 15) n = view.getUint32(cursor, true) === view.getUint32(cursor + 4, true) ? view.getUint32(cursor, true) : null
      else if (width === 8) { const raw = view.getBigUint64(cursor, true); n = raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : null }
      else for (let i = 0; i < width; i++) n! += bytes[cursor + i] * 2 ** (8 * i)
      cursor += width; return { type, scalar: n }
    }
    if (type === 26) { const n = u32(); need(n); const s = decoder.decode(bytes.subarray(cursor, cursor + n)); cursor += n; return { type, scalar: s } }
    if (type === 10 || type === 11) {
      const n = u32(); if (n > 100_000) throw new Error('count')
      const children: Value[] = []
      for (let i = 0; i < n; i++) { const k = type === 10 ? key() : undefined; children.push({ ...value(depth + 1), key: k }) }
      return { type, children }
    }
    throw new Error('unsupported_type')
  }
  for (let offset = 4; offset + 6 <= bytes.length; offset++) {
    if (bytes[offset] !== 101 || bytes[offset + 1] !== 121 || bytes[offset + 2] !== 116 || bytes[offset + 3] !== 102 || bytes[offset + 4] !== 1 || bytes[offset + 5] !== 17) continue
    if (result.roots.length + result.errors >= 256) { result.errors++; break }
    try {
      cursor = offset - 4; budget = 0; const count = u32(); if (count > 100_000) throw new Error('root_count')
      const tree: Value = { type: 10, children: [] }
      for (let i = 0; i < count; i++) { const k = key(); tree.children!.push({ ...value(0), key: k }) }
      const edges: RuleEdge[] = [], groups: number[] = []
      const visit = (v: Value, path: string) => {
        if (v.key === 'rmrp' || v.key === 'rler') { const target = num(field(v, 'pmoc')); if (target !== null) edges.push({ direction: v.key === 'rmrp' ? 'up' : 'down', target, places: num(field(v, 'lprn')) }) }
        if (path.startsWith('root/cdhc/') && v.key === 'pmoc') { const n = num(v); if (n !== null) groups.push(n) }
        v.children?.forEach((c, i) => visit(c, `${path}/${c.key ?? i}`))
      }
      visit(tree, 'root')
      const code = scalar(field(tree, 'elif'))
      result.roots.push({ offset, code: typeof code === 'string' ? code : null, type: num(field(tree, 'epyt')), level: num(field(tree, 'lvel')), year: num(field(tree, 'raey')), groups: unique(groups).sort((a, b) => a - b), edges })
    } catch { result.errors++ }
  }
  return result
}

export function stableLeagueGroups(rule: LeagueRule | undefined): number[] | null {
  if (!rule?.roots.length || rule.errors) return null
  const sets = rule.roots.map(r => JSON.stringify([...r.groups].sort((a, b) => a - b)))
  return unique(sets).length === 1 ? rule.roots[0].groups : null
}
export function leagueLevel(rule: LeagueRule | undefined): number | null {
  if (!rule?.roots.length || rule.errors || rule.roots.some(r => r.type !== 1)) return null
  const levels = unique(rule.roots.map(r => r.level)); return levels.length === 1 ? levels[0] : null
}
export function adjacentLeagues(uid: number, rules: LeagueRule[]): AdjacentLeague[] {
  const map = new Map(rules.map(r => [r.uid, r])), source = map.get(uid), level = leagueLevel(source)
  if (!source || level === null) return []
  const out: AdjacentLeague[] = []
  for (const direction of ['up', 'down'] as const) {
    const targets = unique(source.roots.flatMap(r => r.edges.filter(e => e.direction === direction).map(e => e.target)))
    for (const target of targets) {
      const node = map.get(target)
      if (!node || leagueLevel(node) !== level + (direction === 'up' ? -1 : 1)) continue
      if (source.roots.some(r => !r.edges.some(e => e.direction === direction && e.target === target))) continue
      const families = unique([...source.roots, ...node.roots].map(r => r.code?.slice(0, 4)))
      if (families.length !== 1 || !families[0]) continue
      const parents = rules.filter(p => leagueLevel(p) === leagueLevel(node) && stableLeagueGroups(p)?.includes(target))
      // Multiple possible parent families are not resolved by iteration order.
      if (parents.length > 1) continue
      const parent = parents[0], groups = parent ? stableLeagueGroups(parent)! : []
      if (parent?.roots.some(r => r.code?.slice(0, 4) !== families[0])) continue
      const quotas = source.roots.flatMap(r => r.edges.filter(e => e.direction === direction && e.target === target).map(e => e.places))
      out.push({ direction, rawTarget: target, target: parent?.uid ?? target, groups, quota: quotas.every(q => q !== null && q > 0) ? 'positive' : quotas.every(q => q === 0) ? 'zero' : 'uncertain', status: 'candidate', reason: 'stable_rules_season_unselected' })
    }
  }
  return out
}
