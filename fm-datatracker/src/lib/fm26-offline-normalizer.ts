import { ATTRIBUTE_LOOKUP, type AttributeCategory } from './attributes'
import { readOfflineSaveBytes } from './fm26-offline-reader'

type UnknownRecord = Record<string, unknown>

export type OfflinePlayerRow = {
  fm_player_id: string
  current_name: string
  normalized_name: string
  identity_key: string
  date_of_birth: string | null
  nationality: string | null
  age: null
  club: null
  squad: string | null
  positions: string[]
  preferred_foot: string | null
  height: number | null
  attributes: Array<{ attribute_key: string; attribute_label: string; value: number; category: AttributeCategory; source_column: string }>
  statistics: UnknownRecord | null
  tactic: UnknownRecord | null
  raw_data: UnknownRecord
  normalized_data: UnknownRecord
}

export type OfflineFmRead = {
  raw: UnknownRecord
  players: OfflinePlayerRow[]
  diagnostics: UnknownRecord
}

const normalizedName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const record = (value: unknown): UnknownRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
const stringOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const numberOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const attributeKey = (label: string) => ({
  teamwork: 'team_work',
  punching_tendency: 'punching',
  rushing_out_tendency: 'rushing_out_tendency',
}[label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))

/**
 * Converts the proven v0.22 offline result into the site-facing player shape.
 * Raw structures stay attached so unresolved fields and all stat contexts remain auditable.
 */
export function normalizeOfflineFmResult(rawResult: unknown): OfflineFmRead {
  const raw = record(rawResult)
  const humans = Array.isArray(raw.human_managers) ? raw.human_managers : []
  const players: OfflinePlayerRow[] = []

  for (const humanValue of humans) {
    const human = record(humanValue)
    const groupLabel = stringOrNull(record(human.manager).display_name)
    for (const playerValue of Array.isArray(human.players) ? human.players : []) {
      const player = record(playerValue)
      const uid = numberOrNull(player.uid)
      const name = stringOrNull(player.display_name)
      if (uid === null || !name || player.identity_link_confidence !== 'high') continue
      const attributes20 = record(player.attributes_1_20)
      const attributes = Object.entries(attributes20).flatMap(([label, value]) => {
        const definition = ATTRIBUTE_LOOKUP[attributeKey(label)]
        const score = numberOrNull(value)
        return definition && score !== null && score >= 1 && score <= 20
          ? [{ attribute_key: definition.key, attribute_label: definition.label, value: score, category: definition.category, source_column: `FM26 save:${label}` }]
          : []
      })
      const feet = record(player.feet)
      const left = numberOrNull(feet.left)
      const right = numberOrNull(feet.right)
      const preferredFoot = left === null || right === null ? null : left === right ? 'Either' : left > right ? 'Left' : 'Right'
      const positions = Object.entries(record(player.positions)).flatMap(([position, value]) => numberOrNull(value) && numberOrNull(value)! >= 15 ? [position] : [])
      const rosterGroup = record(player.roster_group)
      const statistics = Object.keys(record(player.statistics)).length ? record(player.statistics) : null
      const tactic = Object.keys(record(player.tactic)).length ? record(player.tactic) : null
      players.push({
        fm_player_id: String(uid), current_name: name, normalized_name: normalizedName(name), identity_key: `fm:${uid}`,
        date_of_birth: stringOrNull(player.birth_date), nationality: stringOrNull(player.nation), age: null,
        club: null, squad: stringOrNull(rosterGroup.label) ?? groupLabel, positions, preferred_foot: preferredFoot,
        height: numberOrNull(player.height_cm), attributes, statistics, tactic, raw_data: player,
        normalized_data: {
          source: 'fm26-save-offline', parser: raw.parser ?? null, eid: player.eid ?? null, uid,
          ca_candidate: player.ca ?? null, pa_candidate: player.pa ?? null,
          ca_pa_status: 'candidate_with_provenance_not_universally_validated',
          positional_ratings: player.positions ?? {}, feet: player.feet ?? {},
          statistics, tactic, roster_group: player.roster_group ?? null,
        },
      })
    }
  }
  const diagnostics = record(raw.humans_summary)
  return { raw, players, diagnostics }
}

/** Offline-only entry point. It never calls the FM runtime, Oracle, or BepInEx. */
export async function readFmSave(file: File | Uint8Array, onStatus?: (status: string) => void): Promise<OfflineFmRead> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer())
  const fileName = file instanceof Uint8Array ? 'save.fm' : file.name
  const raw = await readOfflineSaveBytes(bytes, fileName, onStatus)
  return normalizeOfflineFmResult(raw)
}
