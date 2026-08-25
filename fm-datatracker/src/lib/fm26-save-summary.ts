export type Fm26SaveSummaryDate = {
  status: 'confirmed' | 'unresolved'
  source: 'save_game_summary.dat'
  current_date: string | null
  date_precision: 'day' | null
  reason: string | null
  packed_date: number | null
  packed_date_hex: string | null
  date_offset: number | null
  year: number | null
  day_of_year: number | null
  flags: number | null
  flags_hex: string | null
  competition_count: number | null
  summary_human_count: number | null
  expected_human_count: number
}

const HEADER = [0x03, 0x01, 0x74, 0x61, 0x64, 0x2e, 0x1d, 0x00] as const
const MAX_STRING_BYTES = 4096
const MAX_COMPETITIONS = 128
const MAX_HUMANS = 64

const u16 = (data: Uint8Array, offset: number) => data[offset] | (data[offset + 1] << 8)
const u32 = (data: Uint8Array, offset: number) => (
  data[offset]
  | (data[offset + 1] << 8)
  | (data[offset + 2] << 16)
  | (data[offset + 3] << 24)
) >>> 0

const hex32 = (value: number) => `0x${value.toString(16).padStart(8, '0')}`
const hex16 = (value: number) => `0x${value.toString(16).padStart(4, '0')}`
const leapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

function unresolved(expectedHumanCount: number, reason: string, partial: Partial<Fm26SaveSummaryDate> = {}): Fm26SaveSummaryDate {
  return {
    status: 'unresolved', source: 'save_game_summary.dat', current_date: null, date_precision: null,
    reason, packed_date: null, packed_date_hex: null, date_offset: null, year: null, day_of_year: null,
    flags: null, flags_hex: null, competition_count: null, summary_human_count: null, expected_human_count: expectedHumanCount,
    ...partial,
  }
}

function skipLengthPrefixedString(data: Uint8Array, offset: number): number | null {
  if (offset + 4 > data.length) return null
  const length = u32(data, offset)
  if (length > MAX_STRING_BYTES || offset + 4 + length > data.length) return null
  return offset + 4 + length
}

export function decodeFm26PackedSaveDate(packedDate: number): { currentDate: string; year: number; dayOfYear: number; flags: number } | null {
  const year = packedDate >>> 16
  const dayOfYear = packedDate & 0x01ff
  const flags = packedDate & 0xfe00
  if (year < 1900 || year > 2400) return null
  const maxDay = leapYear(year) ? 366 : 365
  if (dayOfYear < 1 || dayOfYear > maxDay) return null
  const date = new Date(Date.UTC(year, 0, dayOfYear))
  const currentDate = date.toISOString().slice(0, 10)
  return { currentDate, year, dayOfYear, flags }
}

/**
 * Parses only the confirmed current-date field in save_game_summary.dat.
 * The parser deliberately fails closed if the characterized grammar changes.
 */
export function parseFm26SaveSummaryDate(data: Uint8Array | null, expectedHumanCount: number): Fm26SaveSummaryDate {
  if (!data) return unresolved(expectedHumanCount, 'save_game_summary.dat ausente')
  if (expectedHumanCount < 1 || expectedHumanCount > MAX_HUMANS) return unresolved(expectedHumanCount, 'contagem esperada de técnicos inválida')
  if (data.length < 32) return unresolved(expectedHumanCount, 'save_game_summary.dat curto demais')
  if (HEADER.some((value, index) => data[index] !== value)) return unresolved(expectedHumanCount, 'header de save_game_summary.dat não reconhecido')

  let offset: number = HEADER.length
  offset = skipLengthPrefixedString(data, offset) ?? -1
  if (offset < 0) return unresolved(expectedHumanCount, 'string inicial inválida')
  offset = skipLengthPrefixedString(data, offset) ?? -1
  if (offset < 0 || offset + 4 > data.length) return unresolved(expectedHumanCount, 'versão/string inicial inválida')

  const competitionCount = u32(data, offset)
  offset += 4
  if (competitionCount > MAX_COMPETITIONS) return unresolved(expectedHumanCount, 'quantidade de competições inválida', { competition_count: competitionCount })
  for (let index = 0; index < competitionCount; index += 1) {
    offset = skipLengthPrefixedString(data, offset) ?? -1
    if (offset < 0) return unresolved(expectedHumanCount, 'lista de competições truncada', { competition_count: competitionCount })
  }

  if (offset + 8 > data.length) return unresolved(expectedHumanCount, 'seção de técnicos truncada', { competition_count: competitionCount })
  const sectionMarker = data[offset]
  const recordSignature = u16(data, offset + 5)
  const summaryHumanCount = data[offset + 7]
  offset += 8

  if (sectionMarker !== 0x01 || recordSignature !== 0x0e95) {
    return unresolved(expectedHumanCount, 'assinatura da seção de técnicos não reconhecida', {
      competition_count: competitionCount,
      summary_human_count: summaryHumanCount,
    })
  }
  if (summaryHumanCount !== expectedHumanCount) {
    return unresolved(expectedHumanCount, 'contagem de técnicos diverge de humans.dat', {
      competition_count: competitionCount,
      summary_human_count: summaryHumanCount,
    })
  }

  for (let index = 0; index < summaryHumanCount; index += 1) {
    offset = skipLengthPrefixedString(data, offset) ?? -1
    if (offset < 0) return unresolved(expectedHumanCount, 'nome de técnico truncado', { competition_count: competitionCount, summary_human_count: summaryHumanCount })
    offset = skipLengthPrefixedString(data, offset) ?? -1
    if (offset < 0 || offset + 4 > data.length) return unresolved(expectedHumanCount, 'nome/referência de equipe truncado', { competition_count: competitionCount, summary_human_count: summaryHumanCount })
    offset += 4 // associated team/club reference; semantics are intentionally not inferred here
  }

  if (offset + 4 > data.length) return unresolved(expectedHumanCount, 'packed_date ausente', { competition_count: competitionCount, summary_human_count: summaryHumanCount })
  const dateOffset = offset
  const packedDate = u32(data, dateOffset)
  const decoded = decodeFm26PackedSaveDate(packedDate)
  if (!decoded) {
    return unresolved(expectedHumanCount, 'packed_date inválido', {
      competition_count: competitionCount,
      summary_human_count: summaryHumanCount,
      packed_date: packedDate,
      packed_date_hex: hex32(packedDate),
      date_offset: dateOffset,
    })
  }

  return {
    status: 'confirmed', source: 'save_game_summary.dat', current_date: decoded.currentDate, date_precision: 'day', reason: null,
    packed_date: packedDate, packed_date_hex: hex32(packedDate), date_offset: dateOffset,
    year: decoded.year, day_of_year: decoded.dayOfYear, flags: decoded.flags, flags_hex: hex16(decoded.flags),
    competition_count: competitionCount, summary_human_count: summaryHumanCount, expected_human_count: expectedHumanCount,
  }
}
