import { ATTRIBUTE_LOOKUP, type AttributeDefinition } from './attributes'

export type OracleProperty = { propertyId?: number; value?: string | null; rawAsString?: string | null; isNull?: boolean | null; error?: string | null }
export type OracleRosterPlayer = { rosterIndex: number; reference?: { uid?: string | null; index?: number | null; identifier?: string | null }; identity?: Record<string, OracleProperty>; attributes?: Record<string, OracleProperty>; abilities?: Record<string, OracleProperty>; otherProperties?: Record<string, OracleProperty> }
export type OracleRosterBatch = { oracleVersion?: string; batchId?: string; team?: { uid?: string | null; index?: number | null }; playerCountExpected?: number | null; playerCountRead?: number; error?: string | null; players?: OracleRosterPlayer[] }

export type NormalizedOraclePlayer = {
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
  attributes: Array<{ attribute_key: string; attribute_label: string; value: number; category: string; source_column: string }>
  raw_data: OracleRosterPlayer
  normalized_data: Record<string, unknown>
}

const value = (source: Record<string, OracleProperty> | undefined, name: string) => source?.[name]?.value?.trim() || null
const numberValue = (source: Record<string, OracleProperty> | undefined, name: string) => {
  const raw = value(source, name)
  return raw !== null && /^-?\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : null
}
const attributeKey = (name: string) => name.replace(/^Attribute/, '').replace(/[A-Z]/g, (letter, index) => `${index ? '_' : ''}${letter.toLowerCase()}`)
const positionalAbilityKey = (name: string) => name.replace(/^Ability/, '').replace(/[A-Z]/g, (letter, index) => `${index ? '_' : ''}${letter.toLowerCase()}`)
const numericProperties = (source: Record<string, OracleProperty> | undefined, names: string[]) => Object.fromEntries(names.flatMap(name => {
  const parsed = numberValue(source, name)
  return parsed === null ? [] : [[name.replace(/[A-Z]/g, (letter, index) => `${index ? '_' : ''}${letter.toLowerCase()}`), parsed]]
}))
const internationalSummary = (raw: string | null) => {
  const match = raw?.match(/(\d+)\s*caps?\s*\/\s*(\d+)\s*goals?/i)
  return match ? { caps: Number(match[1]), goals: Number(match[2]), raw } : { caps: null, goals: null, raw }
}
const SEASON_STAT_PROPERTIES = ['ClubAppearancesThisSeason', 'ClubGoalsThisSeason', 'ClubAssistsThisSeason', 'ClubAverageRatingThisSeason', 'StartingAppearances', 'SubAppearances', 'Minutes', 'ExpectedGoals', 'ExpectedAssists', 'PassCompletionPercentage', 'ShotsOnTargetPercentage', 'TacklesCompletedPer90', 'CleanSheets', 'TotalSaves']

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Oracle JSON inválido: ${label} deve ser um objeto.`)
  return value as Record<string, unknown>
}
const optionalObject = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const stringOrNull = (value: unknown) => value === null || value === undefined ? null : typeof value === 'string' ? value : String(value)
const propertyMap = (value: unknown, label: string): Record<string, OracleProperty> => {
  const source = optionalObject(value)
  if (!source) return {}
  return Object.fromEntries(Object.entries(source).map(([name, raw]) => {
    const item = object(raw, `${label}.${name}`)
    return [name, { propertyId: typeof (item.PropertyId ?? item.propertyId) === 'number' ? Number(item.PropertyId ?? item.propertyId) : undefined, value: stringOrNull(item.Value ?? item.value), rawAsString: stringOrNull(item.RawAsString ?? item.rawAsString), isNull: typeof (item.IsNull ?? item.isNull) === 'boolean' ? Boolean(item.IsNull ?? item.isNull) : null, error: stringOrNull(item.Error ?? item.error) }]
  }))
}

/** Parses the exact PascalCase JSON emitted by the C# Oracle into the stable site contract. */
export function parseOracleRosterJson(text: string): OracleRosterBatch {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Oracle JSON inválido: o arquivo não contém JSON válido.') }
  const batch = object(raw, 'resultado')
  const oracleVersion = stringOrNull(batch.OracleVersion ?? batch.oracleVersion)
  if (oracleVersion !== '0.4.9') throw new Error(`Oracle JSON incompatível: esperada a versão 0.4.9, recebida ${oracleVersion ?? 'ausente'}.`)
  const rawPlayers = batch.Players ?? batch.players
  if (!Array.isArray(rawPlayers)) throw new Error('Oracle JSON inválido: Players não foi encontrado.')
  const playerCountRead = batch.PlayerCountRead ?? batch.playerCountRead
  const playerCountExpected = batch.PlayerCountExpected ?? batch.playerCountExpected
  if (typeof playerCountRead === 'number' && playerCountRead !== rawPlayers.length) throw new Error(`Oracle JSON inconsistente: PlayerCountRead=${playerCountRead}, mas Players contém ${rawPlayers.length}.`)
  if (typeof playerCountExpected === 'number' && playerCountExpected !== rawPlayers.length) throw new Error(`Oracle JSON incompleto: PlayerCountExpected=${playerCountExpected}, mas Players contém ${rawPlayers.length}.`)
  return {
    oracleVersion,
    batchId: stringOrNull(batch.BatchId ?? batch.batchId) ?? undefined,
    playerCountExpected: typeof playerCountExpected === 'number' ? Number(playerCountExpected) : null,
    playerCountRead: typeof playerCountRead === 'number' ? Number(playerCountRead) : undefined,
    error: stringOrNull(batch.Error ?? batch.error),
    players: rawPlayers.map((rawPlayer, index) => {
      const player = object(rawPlayer, `Players[${index}]`)
      const rosterIndex = player.RosterIndex ?? player.rosterIndex
      if (!Number.isInteger(rosterIndex) || Number(rosterIndex) < 0) throw new Error(`Oracle JSON inválido: Players[${index}].RosterIndex é obrigatório.`)
      const reference = optionalObject(player.Reference ?? player.reference)
      return { rosterIndex: Number(rosterIndex), reference: reference ? { uid: stringOrNull(reference.UID ?? reference.uid), index: typeof (reference.Index ?? reference.index) === 'number' ? Number(reference.Index ?? reference.index) : null, identifier: stringOrNull(reference.Identifier ?? reference.identifier) } : undefined, identity: propertyMap(player.Identity ?? player.identity, `Players[${index}].Identity`), attributes: propertyMap(player.Attributes ?? player.attributes, `Players[${index}].Attributes`), abilities: propertyMap(player.Abilities ?? player.abilities, `Players[${index}].Abilities`), otherProperties: propertyMap(player.OtherProperties ?? player.otherProperties, `Players[${index}].OtherProperties`) }
    })
  }
}

export function normalizeOracleRoster(batch: OracleRosterBatch): NormalizedOraclePlayer[] {
  return (batch.players ?? []).flatMap(player => {
    const identity = player.identity ?? {}
    const uid = value(identity, 'UniqueId') ?? player.reference?.uid ?? null
    const currentName = value(identity, 'Name') ?? ([value(identity, 'Name'), value(identity, 'Surname')].filter(Boolean).join(' ') || null)
    if (!uid || !currentName) return []
    const attributes = Object.entries(player.attributes ?? {}).flatMap(([name, property]) => {
      const definition: AttributeDefinition | undefined = ATTRIBUTE_LOOKUP[attributeKey(name)]
      const raw = property.value?.replace(',', '.')
      const score = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null
      return definition && score !== null && score >= 1 && score <= 20 ? [{ attribute_key: definition.key, attribute_label: definition.label, value: score, category: definition.category, source_column: `Oracle:${name}` }] : []
    })
    const positions = (value(identity, 'PositionCombinedString') ?? value(identity, 'NaturalPositionShortString') ?? '').split(/[,/]/).map(item => item.trim()).filter(Boolean)
    const positionalAbilities = Object.fromEntries(Object.entries(player.abilities ?? {}).flatMap(([name, property]) => {
      const raw = property.value?.replace(',', '.')
      const score = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null
      return score !== null && score >= 0 && score <= 20 ? [[positionalAbilityKey(name), score]] : []
    }))
    const normalized_data: Record<string, unknown> = {
      source: 'fm26-oracle', oracle_version: batch.oracleVersion ?? null, roster_index: player.rosterIndex,
      unique_id: uid, nation: value(identity, 'Nation'), nationality: value(identity, 'NationalityText'),
      date_of_birth: value(identity, 'DateOfBirth'), preferred_foot: value(identity, 'Footedness'),
      best_role: value(identity, 'BestRole'), best_oop_role: value(identity, 'BestOOPRole'),
      season_stats: numericProperties(player.otherProperties, SEASON_STAT_PROPERTIES),
      international: {
        senior: internationalSummary(value(identity, 'InternationalCapsAndGoalsString') ?? value(player.otherProperties, 'InternationalCapsAndGoalsString')),
        u21_caps: numberValue(identity, 'InternationalU21Caps') ?? numberValue(player.otherProperties, 'InternationalU21Caps'),
        u21_goals: numberValue(identity, 'InternationalU21Goals') ?? numberValue(player.otherProperties, 'InternationalU21Goals'),
      },
      personality: value(player.otherProperties, 'Personality') ?? value(identity, 'Personality'),
      positional_abilities: positionalAbilities,
      club_appearances_this_season: numberValue(player.otherProperties, 'ClubAppearancesThisSeason'),
      club_goals_this_season: numberValue(player.otherProperties, 'ClubGoalsThisSeason'),
      club_assists_this_season: numberValue(player.otherProperties, 'ClubAssistsThisSeason'),
      club_average_rating_this_season: numberValue(player.otherProperties, 'ClubAverageRatingThisSeason'),
      transfer_value_range: value(player.otherProperties, 'TransferValueRange'),
      context_contract_weekly_wage: value(player.otherProperties, 'ContextContractWeeklyWage'),
      club_join_date: value(player.otherProperties, 'ClubJoinDate'),
      current_ability: null, potential_ability: null,
      current_ability_status: 'unsupported', potential_ability_status: 'unsupported'
    }
    const nationality = value(identity, 'NationalityText') ?? value(identity, 'Nation')
    return [{ fm_player_id: uid, current_name: currentName, normalized_name: currentName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), identity_key: `fm:${uid}`, date_of_birth: value(identity, 'DateOfBirth'), nationality, age: numberValue(identity, 'Age'), club: value(identity, 'Club'), squad: value(identity, 'Team'), positions, preferred_foot: value(identity, 'Footedness'), height: numberValue(identity, 'Height'), attributes, raw_data: player, normalized_data }]
  })
}
