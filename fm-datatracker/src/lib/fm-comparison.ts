/** Canonical comparison helpers shared by import validation and raw inspection. */
export const normalizedText = (value: unknown) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

export function normalizedDate(value: unknown) {
  const source = String(value ?? '').trim()
  const iso = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const dmy = source.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : null
}

export function normalizedFoot(value: unknown) {
  const foot = normalizedText(value).replace(/-footed only|-footed/g, '').trim()
  if (/(right|direito)/.test(foot)) return 'right'
  if (/(left|esquerdo)/.test(foot)) return 'left'
  if (/(either|both|ambidextr)/.test(foot)) return 'either'
  return foot
}

const CODE_TO_FAMILY: Record<string, string> = {
  GK: 'GK', DL: 'D', DC: 'D', DR: 'D', WBL: 'WB', WBR: 'WB', DM: 'DM',
  ML: 'M', MC: 'M', MR: 'M', AML: 'AM', AMC: 'AM', AMR: 'AM', ST: 'ST',
}

const FM_POSITION_LABELS: Record<string, string> = {
  GK: 'GK', DL: 'D (L)', DC: 'D (C)', DR: 'D (R)', WBL: 'WB (L)', WBR: 'WB (R)',
  DM: 'DM (C)', ML: 'M (L)', MC: 'M (C)', MR: 'M (R)', AML: 'AM (L)', AMC: 'AM (C)', AMR: 'AM (R)', ST: 'ST (C)',
}

/**
 * The offline reader preserves positional ability as a structured rating map.
 * Convert only proven playable ratings (15+) to the same notation emitted by
 * the CSV exporter, so comparison is semantic instead of comparing an object
 * with a string.
 */
export function displayFmPositions(value: unknown) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([code, rating]) => typeof rating === 'number' && rating >= 15 && FM_POSITION_LABELS[code] ? [FM_POSITION_LABELS[code]] : [])
    .join(', ')
}

type PositionSignature = { specific: Set<string>; generic: Set<string> }

function addPositionToken(signature: PositionSignature, token: string) {
  const clean = normalizedText(token).replace(/\s+/g, '').replace(/-/g, '')
  const direct: Record<string, string> = {
    gk: 'GK', dl: 'DL', dc: 'DC', dr: 'DR', dm: 'DM', wbl: 'WBL', wbr: 'WBR',
    ml: 'ML', mc: 'MC', mr: 'MR', aml: 'AML', amc: 'AMC', amr: 'AMR', st: 'ST',
  }
  if (direct[clean]) { signature.specific.add(direct[clean]); return }
  const match = clean.match(/^(gk|d|wb|dm|m|am|st)\(?([lcr]+)?\)?$/)
  if (!match) return
  const [, line, sides] = match
  const prefix = line.toUpperCase()
  if (!sides) { signature.generic.add(prefix); return }
  for (const side of sides) {
    const code = prefix === 'D' ? `D${side.toUpperCase()}`
      : prefix === 'WB' ? `WB${side.toUpperCase()}`
        : prefix === 'M' ? `M${side.toUpperCase()}`
          : prefix === 'AM' ? `AM${side.toUpperCase()}` : prefix
    if (CODE_TO_FAMILY[code]) signature.specific.add(code)
  }
}

function positionSignature(values: string[]) {
  const signature: PositionSignature = { specific: new Set(), generic: new Set() }
  values.forEach(value => value.split(/[|,/]/).forEach(token => addPositionToken(signature, token)))
  return signature
}

const positionMatches = (candidate: string, reference: PositionSignature) =>
  reference.specific.has(candidate) || reference.generic.has(CODE_TO_FAMILY[candidate])

/** Treats "D" in exports as a family wildcard, while retaining exact L/C/R comparisons. */
export function positionsMatch(left: string[], right: string[]) {
  const a = positionSignature(left); const b = positionSignature(right)
  if (!a.specific.size && !a.generic.size || !b.specific.size && !b.generic.size) return false
  return [...a.specific].every(code => positionMatches(code, b))
    && [...b.specific].every(code => positionMatches(code, a))
    && [...a.generic].every(family => b.generic.has(family) || [...b.specific].some(code => CODE_TO_FAMILY[code] === family))
    && [...b.generic].every(family => a.generic.has(family) || [...a.specific].some(code => CODE_TO_FAMILY[code] === family))
}

export const canonicalFieldKey = (field: string) => {
  const key = normalizedText(field).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return ({
    teamwork: 'team_work', team_work: 'team_work',
    punching_tendency: 'punching', punching: 'punching',
    rushing_out_tendency: 'rushing_out_tendency',
    preferred_foot: 'preferred_foot', date_of_birth: 'date_of_birth', dob: 'date_of_birth',
  }[key] ?? key)
}
