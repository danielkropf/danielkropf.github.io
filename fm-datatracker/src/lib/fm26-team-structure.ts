/** Save-local Team rows and literal names. Numeric categories are evidence, not
 * a universal dictionary of U20/B/II suffixes. Unknown variants stay unnamed. */
export type StructuralTeamName = {
  teamId: number; offset: number; key: number; type: number; age: number; reference: number
  name: string | null; shortName: string | null; nameOffset: number | null
  source: 'game_db_team_embedded_name' | 'game_db_team_name_reference'
  ambiguous: boolean
}
const cache = new WeakMap<Uint8Array, Map<number, StructuralTeamName[]>>()
const decoder = new TextDecoder('utf-8', { fatal: true })
export function indexStructuralTeamNames(bytes: Uint8Array) {
  const cached = cache.get(bytes)
  if (cached) return cached
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (o: number) => view.getUint32(o, true)
  const u16 = (o: number) => view.getUint16(o, true)
  const text = (o: number, length: number): string | null => {
    if (length > 160 || o + length > bytes.length) return null
    try { const value = decoder.decode(bytes.subarray(o, o + length)); return /[\x00-\x1f\x7f]/.test(value) ? null : value } catch { return null }
  }
  const names = new Map<number, Array<{ name: string; shortName: string; offset: number }>>()
  for (let k = 4; k + 43 < bytes.length; k++) {
    const length = bytes[k + 35]
    if (!length || length > 160 || bytes[k + 36] || bytes[k + 37] || bytes[k + 38]) continue
    if (!u32(k) || u32(k) === 0xffffffff || u32(k) !== u32(k + 4) || u32(k - 4) >= 1_000_000) continue
    const end = k + 39 + length
    if (end + 4 > bytes.length) continue
    const name = text(k + 39, length), shortName = text(end + 4, u32(end))
    if (!name?.trim() || !shortName?.trim()) continue
    const ref = u32(k - 4) + 1, candidates = names.get(ref) ?? []
    candidates.push({ name, shortName, offset: k }); names.set(ref, candidates)
  }
  const result = new Map<number, StructuralTeamName[]>()
  const previous = new Map<number, number>()
  for (let marker = bytes.indexOf(10, 12); marker >= 0; marker = bytes.indexOf(10, marker + 1)) {
    const r = marker - 12
    if (r < 0 || r + 86 >= bytes.length || u32(r) >= 100_000) continue
    const count = u16(r + 46), end = r + 48 + 4 * count
    if (count > 500 || end + 38 >= bytes.length || bytes[end + 22] !== 255) continue
    const length = u32(end + 28), name = text(end + 32, length)
    const shortOffset = end + 33 + length
    if (name === null || shortOffset + 4 >= bytes.length) continue
    const shortLength = u32(shortOffset), shortName = text(shortOffset + 4, shortLength)
    const next = shortOffset + 5 + shortLength
    if (shortName === null || next > bytes.length) continue
    const nextValid = next + 13 <= bytes.length && u32(next) === u32(r) + 1 && bytes[next + 12] === 10
    if (!nextValid && previous.get(r) !== u32(r)) continue
    let valid = true
    for (let i = 0; i < count; i++) { const eid = u32(r + 48 + 4 * i); if (!eid || eid >= 500_000) { valid = false; break } }
    if (!valid) continue
    previous.set(next, u32(r) + 1)
    const ref = u32(end + 24), type = u16(end + 18)
    // A reference on an unnamed youth row can point to its parent club.
    // Only the observed normal-team type can take its literal global name.
    const candidates = !name.trim() && type === 0 ? names.get(ref) ?? [] : []
    const distinct = [...new Map(candidates.map(item => [`${item.name}\0${item.shortName}`, item])).values()]
    const global = distinct.length === 1 ? distinct[0] : null
    const row: StructuralTeamName = {
      teamId: u32(r) + 1, offset: r, key: u32(r + 4), type, age: bytes[end + 21], reference: ref,
      name: name.trim() ? name : global?.name ?? null, shortName: name.trim() ? shortName || name : global?.shortName ?? null,
      nameOffset: name.trim() ? end + 32 : global?.offset ?? null,
      source: name.trim() ? 'game_db_team_embedded_name' : 'game_db_team_name_reference', ambiguous: distinct.length > 1,
    }
    const rows = result.get(row.teamId) ?? []; rows.push(row); result.set(row.teamId, rows)
  }
  cache.set(bytes, result)
  return result
}
