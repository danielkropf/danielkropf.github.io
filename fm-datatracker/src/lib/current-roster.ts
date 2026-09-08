export type CurrentRosterStatus = 'Nos planos' | 'Para empréstimo' | 'Para venda' | 'Fora do clube'
export type PlanningTeamLevel = 'first_team' | 'reserve' | 'academy' | 'other' | 'unknown' | null

type PlanningGroupLike = { id: string; name: string }

const normalize = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const marketKind = (group: PlanningGroupLike | string | null | undefined): 'loan' | 'sale' | null => {
  const value = typeof group === 'string' ? normalize(group) : normalize(`${group?.id ?? ''} ${group?.name ?? ''}`)
  if (value.includes('loan') || value.includes('emprest')) return 'loan'
  if (value.includes('sale') || value.includes('vend')) return 'sale'
  return null
}

export function isExternalCurrentClub({ currentClubId, primaryClubId, currentClubName, primaryClubName }: {
  currentClubId?: string | null
  primaryClubId?: string | null
  currentClubName?: string | null
  primaryClubName?: string | null
}) {
  if (currentClubId && primaryClubId) return currentClubId !== primaryClubId
  const current = normalize(currentClubName)
  const primary = normalize(primaryClubName)
  return Boolean(current && primary && current !== primary)
}

/**
 * Resolves the single factual roster label shown by current-list surfaces.
 * Exact squad evidence wins; team level is only a deterministic display fallback.
 * A player currently at another club never inherits the selected club's roster.
 */
export function currentRosterLabel({ externalClub, factualSquadName, snapshotSquadName, teamLevel, primaryClubName }: {
  externalClub: boolean
  factualSquadName?: string | null
  snapshotSquadName?: string | null
  teamLevel?: PlanningTeamLevel
  primaryClubName?: string | null
}): string | null {
  if (externalClub) return null
  const factual = factualSquadName?.trim()
  if (factual) return factual
  const snapshot = snapshotSquadName?.trim()
  if (snapshot) return snapshot
  if (teamLevel === 'first_team') return primaryClubName?.trim() || 'Principal'
  if (teamLevel === 'reserve') return 'Reservas'
  if (teamLevel === 'academy') return 'Base'
  return null
}

export function currentRosterStatus(externalClub: boolean, planningGroup: PlanningGroupLike | string | null | undefined): CurrentRosterStatus {
  if (externalClub) return 'Fora do clube'
  const kind = marketKind(planningGroup)
  if (kind === 'loan') return 'Para empréstimo'
  if (kind === 'sale') return 'Para venda'
  return 'Nos planos'
}

export function preferredTacticalPlanningGroupId(groups: PlanningGroupLike[], existingGroupId: string | null | undefined, teamLevel: PlanningTeamLevel, rosterLabel?: string | null): string | null {
  const internal = groups.filter(group => !marketKind(group))
  if (existingGroupId && internal.some(group => group.id === existingGroupId)) return existingGroupId

  const roster = normalize(rosterLabel)
  if (roster) {
    const exactRoster = internal.find(group => normalize(group.name) === roster || normalize(group.id) === roster)
    if (exactRoster) return exactRoster.id
  }

  const aliases = teamLevel === 'first_team' ? ['principal', 'first team', 'primeiro time']
    : teamLevel === 'reserve' ? ['b', 'time b', 'reserva', 'reservas']
      : teamLevel === 'academy' ? ['base', 'sub 20', 'under 20', 'u20', 'youth']
        : []
  const preferred = internal.find(group => aliases.some(alias => normalize(group.id) === normalize(alias) || normalize(group.name) === normalize(alias)))
  return preferred?.id ?? internal[0]?.id ?? null
}

const ISO_REGION_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(/\s+/)
let countryCodeByName: Map<string, string> | null = null

function countryMap() {
  if (countryCodeByName) return countryCodeByName
  const map = new Map<string, string>()
  const displays = ['pt-BR', 'en'].flatMap(locale => {
    try { return [new Intl.DisplayNames([locale], { type: 'region' })] } catch { return [] }
  })
  for (const code of ISO_REGION_CODES) {
    map.set(normalize(code), code)
    for (const display of displays) {
      const name = display.of(code)
      if (name) map.set(normalize(name), code)
    }
  }
  // Common FM/localized aliases that Intl may spell differently.
  const aliases: Record<string, string> = {
    brasil: 'BR', brazil: 'BR', uruguai: 'UY', uruguay: 'UY', argentina: 'AR', colombia: 'CO',
    'estados unidos': 'US', usa: 'US', eua: 'US', england: 'GB', inglaterra: 'GB', scotland: 'GB', escocia: 'GB',
    wales: 'GB', gales: 'GB', 'irlanda do norte': 'GB', 'northern ireland': 'GB', 'south korea': 'KR', 'coreia do sul': 'KR',
  }
  for (const [name, code] of Object.entries(aliases)) map.set(normalize(name), code)
  countryCodeByName = map
  return map
}

export function countryFlagEmoji(country: string | null | undefined): string | null {
  const values = (country ?? '').split(/\s*(?:\/|;|,)\s*/).map(normalize).filter(Boolean)
  const map = countryMap()
  for (const value of values) {
    const code = map.get(value) ?? (/^[a-z]{2}$/.test(value) ? value.toUpperCase() : null)
    if (!code || !/^[A-Z]{2}$/.test(code)) continue
    return [...code].map(letter => String.fromCodePoint(0x1F1E6 + letter.charCodeAt(0) - 65)).join('')
  }
  return null
}
