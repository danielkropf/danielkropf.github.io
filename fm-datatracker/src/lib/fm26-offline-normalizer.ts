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
  age: number | null
  club: string | null
  squad: string | null
  positions: string[]
  preferred_foot: string | null
  height: number | null
  weight: number | null
  contract_expiry: string | null
  attributes: Array<{ attribute_key: string; attribute_label: string; value: number; category: AttributeCategory; source_column: string }>
  statistics: UnknownRecord | null
  tactic: UnknownRecord | null
  raw_data: UnknownRecord
  normalized_data: UnknownRecord
}

export type OfflineFmRead = {
  raw: UnknownRecord
  players: OfflinePlayerRow[]
  tactics: UnknownRecord[]
  diagnostics: UnknownRecord
  snapshot_date: string | null
  snapshot_date_precision: 'day' | 'year' | null
}

const normalizedName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const record = (value: unknown): UnknownRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
const stringOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const numberOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const isoDateOrNull = (value: unknown): string | null => {
  const input = stringOrNull(value)
  return input && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : null
}
const ageAt = (birthDate: string | null, snapshotDate: string | null): number | null => {
  if (!birthDate || !snapshotDate) return null
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const snapshot = new Date(`${snapshotDate}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(snapshot.getTime())) return null
  let age = snapshot.getUTCFullYear() - birth.getUTCFullYear()
  const beforeBirthday = snapshot.getUTCMonth() < birth.getUTCMonth()
    || (snapshot.getUTCMonth() === birth.getUTCMonth() && snapshot.getUTCDate() < birth.getUTCDate())
  if (beforeBirthday) age -= 1
  return age >= 0 && age < 100 ? age : null
}
const attributeKey = (label: string) => ({
  teamwork: 'team_work',
  punching_tendency: 'punching',
  rushing_out_tendency: 'rushing_out_tendency',
}[label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))

const HIDDEN_METRIC_KEYS = new Set([
  'consistency', 'important_matches', 'injury_proneness', 'versatility',
])
const POSITIONAL_ABILITY_KEYS: Record<string, string> = {
  GK: 'goalkeeper', DL: 'defender_left', DC: 'defender_center', DR: 'defender_right', DM: 'defensive_midfielder',
  WBL: 'wing_back_left', WBR: 'wing_back_right', ML: 'midfielder_left', MC: 'midfielder_central', MR: 'midfielder_right',
  AML: 'attacking_midfielder_left', AMC: 'attacking_midfielder_central', AMR: 'attacking_midfielder_right', ST: 'striker',
}

function resolvedHumanTactics(humans: unknown[]): UnknownRecord[] {
  return humans.flatMap((value, manager_index) => {
    const human = record(value), tactic = record(human.tactic)
    if (tactic.resolved !== true) return []
    return [{ ...tactic, manager_index, manager_name: stringOrNull(record(human.manager).display_name), human_eid: numberOrNull(human.human_eid), human_record_offset: numberOrNull(human.human_record_offset), root_team_id: numberOrNull(record(human.human_club).root_team_id) }]
  })
}

/**
 * Converts the proven offline result into the site-facing player shape.
 * Raw structures stay attached so unresolved fields and all stat/contract contexts remain auditable.
 */
export function normalizeOfflineFmResult(rawResult: unknown): OfflineFmRead {
  const raw = record(rawResult)
  const humans = Array.isArray(raw.human_managers) ? raw.human_managers : []
  const players: OfflinePlayerRow[] = []
  const tactics = resolvedHumanTactics(humans)

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
      const rawAttributes = record(player.attributes_1_20)
      const hiddenAttributes = Object.fromEntries(Object.entries(rawAttributes)
        .filter(([label]) => HIDDEN_METRIC_KEYS.has(attributeKey(label)))
        .map(([label, value]) => [attributeKey(label), numberOrNull(value)]))
      const positionalAbility = Object.fromEntries(Object.entries(record(player.positions)).map(([position, value]) => [POSITIONAL_ABILITY_KEYS[position] ?? position.toLowerCase(), numberOrNull(value)]))
      const hiddenPersonality = record(player.hidden_personality)
      const fmHidden = {
        current_ability: numberOrNull(player.ca), potential_ability: numberOrNull(player.pa), world_reputation: null,
        adaptability: numberOrNull(hiddenPersonality.adaptability), ambition: numberOrNull(hiddenPersonality.ambition),
        controversy: numberOrNull(hiddenPersonality.controversy), loyalty: numberOrNull(hiddenPersonality.loyalty),
        pressure: numberOrNull(hiddenPersonality.pressure), professionalism: numberOrNull(hiddenPersonality.professionalism),
        sportsmanship: numberOrNull(hiddenPersonality.sportsmanship), temperament: numberOrNull(hiddenPersonality.temperament),
        consistency: numberOrNull(hiddenAttributes.consistency), important_matches: numberOrNull(hiddenAttributes.important_matches),
        injury_proneness: numberOrNull(hiddenAttributes.injury_proneness), versatility: numberOrNull(hiddenAttributes.versatility),
        ...positionalAbility, preferred_central_position: null,
      }
      const rosterGroup = record(player.roster_group)
      const contractTeamResolution = record(player.contract_team_name_resolution)
      const rosterTeamResolution = record(rosterGroup.team_name_resolution)
      const currentContract = record(player.current_contract)
      const loan = record(player.loan)
      const currentTeamId = numberOrNull(currentContract.team_id)
      const currentTeamName = stringOrNull(currentContract.team_name)
      const weeklyWage = numberOrNull(currentContract.weekly_wage)
      const joinedDate = isoDateOrNull(currentContract.joined_date)
      const signedDate = isoDateOrNull(currentContract.signed_or_effective_date)
      const expiryDate = isoDateOrNull(currentContract.expiry_date)
      const futureContracts = Array.isArray(player.future_contracts) ? player.future_contracts : []
      const relationships = Array.isArray(player.contract_relationships) ? player.contract_relationships : []
      const contractTerms = Array.isArray(currentContract.terms) ? currentContract.terms : []
      const statistics = Object.keys(record(player.statistics)).length ? record(player.statistics) : null
      const tactic = Object.keys(record(player.tactic)).length ? record(player.tactic) : null
      players.push({
        fm_player_id: String(uid), current_name: name, normalized_name: normalizedName(name), identity_key: `fm:${uid}`,
        date_of_birth: stringOrNull(player.birth_date), nationality: stringOrNull(player.nation), age: null,
        club: currentTeamName, squad: stringOrNull(rosterGroup.label) ?? groupLabel, positions, preferred_foot: preferredFoot,
        height: numberOrNull(player.height_cm), weight: null, contract_expiry: expiryDate, attributes, statistics, tactic, raw_data: player,
        normalized_data: {
          source: 'fm26-save-offline', parser: raw.parser ?? null, eid: player.eid ?? null, uid,
          ca_candidate: player.ca ?? null, pa_candidate: player.pa ?? null,
          ca_pa_status: 'candidate_with_provenance_not_universally_validated',
          current_ability: fmHidden.current_ability, potential_ability: fmHidden.potential_ability,
          hidden_personality: hiddenPersonality, hidden_attributes: hiddenAttributes,
          positional_ability: positionalAbility, preferred_central_position: null,
          fm_hidden: fmHidden,
          unresolved_fm_hidden_fields: ['world_reputation', 'preferred_central_position'],
          positional_ratings: player.positions ?? {}, feet: player.feet ?? {}, preferred_foot: preferredFoot,
          left_foot: left, right_foot: right,
          left_foot_raw: numberOrNull(feet.left_raw), right_foot_raw: numberOrNull(feet.right_raw),
          personality_hidden_attributes: player.hidden_personality ?? null,
          personality_status: player.hidden_personality ? 'confirmed_binary_eight_traits' : 'unresolved',

          // v0.23.4 contract model. The complete current object supersedes the old
          // single person↔Team compatibility field whenever it was structurally resolved.
          current_contract: Object.keys(currentContract).length ? currentContract : null,
          future_contracts: futureContracts,
          contract_relationships: relationships,
          contract_current_team_id: currentTeamId,
          contract_current_team_name: currentTeamName,
          contract_weekly_wage: weeklyWage,
          contract_joined_date: joinedDate,
          contract_signed_or_effective_date: signedDate,
          contract_expiry_date: expiryDate,
          contract_terms: contractTerms,
          contract_terms_status: stringOrNull(currentContract.terms_status) ?? (Object.keys(currentContract).length ? 'unresolved_variant' : 'unresolved'),
          loan_status: stringOrNull(loan.status) ?? 'unresolved',
          loan_from_team_id: numberOrNull(loan.from_team_id),
          loan_from_team_name: stringOrNull(loan.from_team_name),
          loan_to_team_id: numberOrNull(loan.to_team_id),
          loan_to_team_name: stringOrNull(loan.to_team_name),
          loan_start_date: isoDateOrNull(loan.start_date),
          loan_end_date: isoDateOrNull(loan.end_date),
          market_value: null,
          market_value_status: 'unresolved',

          // Historical compatibility keys. They remain available for old consumers,
          // but do not regain ownership semantics when no complete current object exists.
          contracted_club_team_id: player.contract_team_id ?? null,
          contracted_club_contract_offset: player.contract_offset ?? null,
          contracted_club_status: player.contract_team_id != null ? 'confirmed_binary_contract_shape' : 'unresolved',
          contract_team_name: stringOrNull(player.contract_team_name),
          contract_team_name_resolution: Object.keys(contractTeamResolution).length ? contractTeamResolution : null,
          contract_team_semantics_status: currentTeamId !== null ? 'superseded_by_resolved_current_contract' : player.contract_team_id != null ? 'owner_unresolved_person_team_relation' : 'unresolved',
          roster_team_id: rosterGroup.team_id ?? null,
          roster_team_name: stringOrNull(rosterGroup.team_name),
          roster_team_name_resolution: Object.keys(rosterTeamResolution).length ? rosterTeamResolution : null,
          statistics, tactic, roster_group: player.roster_group ?? null,
        },
      })
    }
  }
  const save = record(raw.save)
  const exactDate = isoDateOrNull(save.current_date) ?? isoDateOrNull(save.game_date) ?? isoDateOrNull(save.snapshot_date)
  const historyYears = humans.flatMap(humanValue => {
    const human = record(humanValue)
    const rosterGroups = record(human.human_club).roster_groups
    if (!Array.isArray(rosterGroups)) return []
    return rosterGroups.map((group: unknown) => numberOrNull(record(record(group).league_history).latest_year)).filter((year): year is number => year !== null)
  })
  const latestYear = historyYears.length ? Math.max(...historyYears) : null
  const snapshot_date = exactDate ?? (latestYear ? `${latestYear}-01-01` : null)
  const playersWithAge = players.map(player => ({
    ...player,
    age: exactDate ? ageAt(player.date_of_birth, exactDate) : null,
  }))
  const diagnostics = record(raw.humans_summary)
  return { raw, players: playersWithAge, tactics, diagnostics, snapshot_date, snapshot_date_precision: exactDate ? 'day' : latestYear ? 'year' : null }
}

export async function readFmSaveBytes(bytes: Uint8Array, fileName = 'save.fm', onStatus?: (status: string) => void): Promise<OfflineFmRead> {
  const raw = await readOfflineSaveBytes(bytes, fileName, onStatus)
  return normalizeOfflineFmResult(raw)
}

export async function readFmSave(file: File | Uint8Array, onStatus?: (status: string) => void): Promise<OfflineFmRead> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer())
  const fileName = file instanceof Uint8Array ? 'save.fm' : file.name
  return readFmSaveBytes(bytes, fileName, onStatus)
}
