type UnknownRecord = Record<string, unknown>

export type OfflineTeamNameResolution = {
  team_id: number
  team_index_zero_based: number
  status: 'confirmed' | 'unresolved' | 'ambiguous'
  name: string | null
  short_name: string | null
  team_key: number | null
  squad_row_offset: number | null
  name_record_offset: number | null
  name_record_reference_raw: number | null
  source: 'game_db_structural_team_key'
  candidate_count: number
}

type TeamRowCandidate = {
  teamId: number
  teamIndexZeroBased: number
  teamKey: number
  squadRowOffset: number
  squadCount: number
}

type TeamNameCandidate = {
  name: string
  shortName: string
  teamKey: number
  nameRecordOffset: number
  nameRecordReferenceRaw: number
}

const textDecoder = new TextDecoder('utf-8', { fatal: true })

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0
}

function decodeTeamText(bytes: Uint8Array): string | null {
  try {
    const text = textDecoder.decode(bytes)
    if (!text.trim()) return null
    for (const char of text) if (char.charCodeAt(0) < 32) return null
    return text
  } catch {
    return null
  }
}

function findU32Occurrences(bytes: Uint8Array, value: number): number[] {
  const out: number[] = []
  const lowByte = value & 0xff
  let offset = 0
  while (offset + 4 <= bytes.length) {
    const found = bytes.indexOf(lowByte, offset)
    if (found < 0 || found + 4 > bytes.length) break
    if (u32(bytes, found) === value) out.push(found)
    offset = found + 1
  }
  return out
}

function looksLikeStructuralSquad(bytes: Uint8Array, rowOffset: number): { count: number } | null {
  if (rowOffset < 0 || rowOffset + 48 > bytes.length) return null
  const count = u16(bytes, rowOffset + 46)
  if (count < 3 || count > 80 || rowOffset + 48 + count * 4 > bytes.length) return null

  let plausibleEids = 0
  for (let index = 0; index < count; index++) {
    const eid = u32(bytes, rowOffset + 48 + index * 4)
    if (eid > 0 && eid < 200_000) plausibleEids++
  }
  if (plausibleEids !== count) return null
  return { count }
}

function findTeamRows(bytes: Uint8Array, teamId: number): TeamRowCandidate[] {
  const teamIndexZeroBased = teamId - 1
  if (!Number.isInteger(teamId) || teamId <= 0 || teamId >= 100_000) return []

  const rows: TeamRowCandidate[] = []
  for (const rowOffset of findU32Occurrences(bytes, teamIndexZeroBased)) {
    if (rowOffset + 12 > bytes.length) continue
    const teamKey = u32(bytes, rowOffset + 4)
    if (teamKey === 0 || teamKey === 0xffffffff || u32(bytes, rowOffset + 8) !== teamKey) continue
    const squad = looksLikeStructuralSquad(bytes, rowOffset)
    if (!squad) continue
    rows.push({ teamId, teamIndexZeroBased, teamKey, squadRowOffset: rowOffset, squadCount: squad.count })
  }
  return rows
}

function findNameCandidates(bytes: Uint8Array, teamKey: number): TeamNameCandidate[] {
  const candidates: TeamNameCandidate[] = []
  for (const keyOffset of findU32Occurrences(bytes, teamKey)) {
    if (keyOffset < 4 || keyOffset + 43 > bytes.length || u32(bytes, keyOffset + 4) !== teamKey) continue

    // Confirmed standard team-name grammar: repeated team key, then fixed metadata,
    // u32 long-name length at +35, long UTF-8 name at +39, followed by a
    // length-prefixed UTF-8 short name. Some teams use identical long/short names;
    // others (e.g. Bayern II) do not.
    const longLength = u32(bytes, keyOffset + 35)
    if (longLength < 1 || longLength > 160) continue
    const longStart = keyOffset + 39
    const longEnd = longStart + longLength
    if (longEnd + 4 > bytes.length) continue
    const name = decodeTeamText(bytes.subarray(longStart, longEnd))
    if (!name) continue

    const shortLength = u32(bytes, longEnd)
    if (shortLength < 1 || shortLength > 160 || longEnd + 4 + shortLength > bytes.length) continue
    const shortName = decodeTeamText(bytes.subarray(longEnd + 4, longEnd + 4 + shortLength))
    if (!shortName) continue

    const nameRecordReferenceRaw = u32(bytes, keyOffset - 4)
    if (nameRecordReferenceRaw === 0xffffffff || nameRecordReferenceRaw >= 1_000_000) continue

    candidates.push({
      name,
      shortName,
      teamKey,
      nameRecordOffset: keyOffset,
      nameRecordReferenceRaw,
    })
  }
  return candidates
}

function uniqueNameCandidates(candidates: TeamNameCandidate[]): TeamNameCandidate[] {
  const byIdentity = new Map<string, TeamNameCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.teamKey}\u0000${candidate.name}\u0000${candidate.shortName}\u0000${candidate.nameRecordReferenceRaw}`
    if (!byIdentity.has(key)) byIdentity.set(key, candidate)
  }
  return [...byIdentity.values()]
}

/**
 * Resolves internal structural Team IDs to team names using only game_db.dat.
 * It intentionally fails closed: zero or multiple distinct validated chains yield
 * a null name rather than a guessed club/team label.
 */
export function resolveOfflineTeamNames(gameDb: Uint8Array, teamIds: Iterable<number>): OfflineTeamNameResolution[] {
  const wanted = [...new Set([...teamIds].filter(teamId => Number.isInteger(teamId) && teamId > 0 && teamId < 100_000))].sort((a, b) => a - b)
  const nameCache = new Map<number, TeamNameCandidate[]>()

  return wanted.map(teamId => {
    const chains: Array<{ row: TeamRowCandidate; name: TeamNameCandidate }> = []
    for (const row of findTeamRows(gameDb, teamId)) {
      let names = nameCache.get(row.teamKey)
      if (!names) {
        names = uniqueNameCandidates(findNameCandidates(gameDb, row.teamKey))
        nameCache.set(row.teamKey, names)
      }
      for (const name of names) chains.push({ row, name })
    }

    const distinct = new Map<string, { row: TeamRowCandidate; name: TeamNameCandidate }>()
    for (const chain of chains) {
      const key = `${chain.row.teamKey}\u0000${chain.name.name}\u0000${chain.name.shortName}\u0000${chain.name.nameRecordReferenceRaw}`
      if (!distinct.has(key)) distinct.set(key, chain)
    }
    const candidates = [...distinct.values()]
    const source = 'game_db_structural_team_key' as const

    if (candidates.length !== 1) {
      return {
        team_id: teamId,
        team_index_zero_based: teamId - 1,
        status: candidates.length > 1 ? 'ambiguous' : 'unresolved',
        name: null,
        short_name: null,
        team_key: null,
        squad_row_offset: null,
        name_record_offset: null,
        name_record_reference_raw: null,
        source,
        candidate_count: candidates.length,
      }
    }

    const [{ row, name }] = candidates
    return {
      team_id: teamId,
      team_index_zero_based: row.teamIndexZeroBased,
      status: 'confirmed',
      name: name.name,
      short_name: name.shortName,
      team_key: row.teamKey,
      squad_row_offset: row.squadRowOffset,
      name_record_offset: name.nameRecordOffset,
      name_record_reference_raw: name.nameRecordReferenceRaw,
      source,
      candidate_count: 1,
    }
  })
}

function collectTeamIds(rawResult: UnknownRecord): number[] {
  const ids = new Set<number>()
  const humans = Array.isArray(rawResult.human_managers) ? rawResult.human_managers : []
  for (const humanValue of humans) {
    const human = asRecord(humanValue)
    if (!human) continue
    const humanClub = asRecord(human.human_club)
    const rootTeamId = integer(humanClub?.root_team_id)
    if (rootTeamId) ids.add(rootTeamId)
    for (const groupValue of Array.isArray(humanClub?.roster_groups) ? humanClub.roster_groups : []) {
      const teamId = integer(asRecord(groupValue)?.team_id)
      if (teamId) ids.add(teamId)
    }
    for (const playerValue of Array.isArray(human.players) ? human.players : []) {
      const player = asRecord(playerValue)
      if (!player) continue
      const contractTeamId = integer(player.contract_team_id)
      if (contractTeamId) ids.add(contractTeamId)
      const rosterTeamId = integer(asRecord(player.roster_group)?.team_id)
      if (rosterTeamId) ids.add(rosterTeamId)
    }
  }
  return [...ids]
}

/** Adds auditable team-name evidence to the legacy reader result without changing its parser core. */
export function enrichOfflineTeamNames(rawResult: UnknownRecord, gameDb: Uint8Array): UnknownRecord {
  const resolutions = resolveOfflineTeamNames(gameDb, collectTeamIds(rawResult))
  const byTeamId = new Map(resolutions.map(resolution => [resolution.team_id, resolution]))
  rawResult.team_name_resolutions = resolutions

  const resolutionFor = (value: unknown): OfflineTeamNameResolution | null => {
    const teamId = integer(value)
    return teamId === null ? null : byTeamId.get(teamId) ?? null
  }

  const humans = Array.isArray(rawResult.human_managers) ? rawResult.human_managers : []
  for (const humanValue of humans) {
    const human = asRecord(humanValue)
    if (!human) continue
    const humanClub = asRecord(human.human_club)
    if (humanClub) {
      humanClub.root_team_name_resolution = resolutionFor(humanClub.root_team_id)
      const groups = Array.isArray(humanClub.roster_groups) ? humanClub.roster_groups : []
      for (const groupValue of groups) {
        const group = asRecord(groupValue)
        if (!group) continue
        const resolution = resolutionFor(group.team_id)
        group.team_name_resolution = resolution
        group.team_name = resolution?.status === 'confirmed' ? resolution.name : null
      }
    }

    for (const playerValue of Array.isArray(human.players) ? human.players : []) {
      const player = asRecord(playerValue)
      if (!player) continue
      const contractResolution = resolutionFor(player.contract_team_id)
      player.contract_team_name_resolution = contractResolution
      player.contract_team_name = contractResolution?.status === 'confirmed' ? contractResolution.name : null
      const rosterGroup = asRecord(player.roster_group)
      if (rosterGroup) {
        const rosterResolution = resolutionFor(rosterGroup.team_id)
        rosterGroup.team_name_resolution = rosterResolution
        rosterGroup.team_name = rosterResolution?.status === 'confirmed' ? rosterResolution.name : null
      }
    }
  }
  return rawResult
}
