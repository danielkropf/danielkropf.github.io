import type {
  Club,
  LongitudinalResolution,
  Save,
  SaveStructure,
  Season,
  TrackedClub,
} from '../types/domain'

export function normalizeLongitudinalName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolveSeasonForLabel(
  seasons: Season[],
  label: string | null | undefined,
): LongitudinalResolution<Season> {
  const exactLabel = label ?? null
  if (!exactLabel) {
    return { value: null, label: null, source: 'unresolved', diagnostic: 'Nenhuma temporada foi informada.' }
  }
  const matches = seasons.filter(season => season.label === exactLabel)
  if (matches.length === 1) {
    return { value: matches[0], label: exactLabel, source: 'normalized', diagnostic: null }
  }
  if (matches.length > 1) {
    return { value: null, label: exactLabel, source: 'unresolved', diagnostic: `Mais de uma Season usa o rótulo exato "${exactLabel}".` }
  }
  return {
    value: null,
    label: exactLabel,
    source: 'legacy',
    diagnostic: 'Rótulo disponível apenas no campo legado; Season normalizada ainda não foi resolvida.',
  }
}

export function resolveSeasonForDate(
  seasons: Season[],
  date: string | null | undefined,
): LongitudinalResolution<Season> {
  if (!date) return { value: null, label: null, source: 'unresolved', diagnostic: 'Nenhuma data foi informada.' }
  const matches = seasons.filter(season => {
    if (!season.start_date || !season.end_date) return false
    return season.start_date <= date && date <= season.end_date
  })
  if (matches.length === 1) {
    return { value: matches[0], label: matches[0].label, source: 'normalized', diagnostic: null }
  }
  return {
    value: null,
    label: null,
    source: 'unresolved',
    diagnostic: matches.length
      ? `A data ${date} pertence a mais de uma Season normalizada.`
      : `Nenhuma Season com datas confirmadas cobre ${date}.`,
  }
}

export function buildSaveStructure(
  save: Save,
  trackedClubs: TrackedClub[],
  seasons: Season[],
  diagnostic: string | null = null,
): SaveStructure {
  const activePrimary = trackedClubs.filter(item => item.is_active && item.tracking_role === 'primary')
  const primaryClub: LongitudinalResolution<Club> = activePrimary.length === 1
    ? { value: activePrimary[0].club, label: activePrimary[0].club.name, source: 'normalized', diagnostic: null }
    : save.club_name
      ? {
          value: null,
          label: save.club_name,
          source: 'legacy',
          diagnostic: activePrimary.length > 1
            ? 'Mais de um primary Club ativo foi carregado; usando apenas o rótulo legado.'
            : 'Primary Club normalizado indisponível; usando saves.club_name como compatibilidade.',
        }
      : { value: null, label: null, source: 'unresolved', diagnostic: 'Primary Club não resolvido.' }

  return {
    trackedClubs,
    seasons,
    primaryClub,
    currentSeason: resolveSeasonForLabel(seasons, save.current_season),
    diagnostic,
  }
}

export function withLegacySaveStructure(save: Save, diagnostic: string): Save {
  return { ...save, structure: buildSaveStructure(save, [], [], diagnostic) }
}
