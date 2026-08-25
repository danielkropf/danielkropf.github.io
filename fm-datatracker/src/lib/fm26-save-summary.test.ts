import { describe, expect, it } from 'vitest'
import { decodeFm26PackedSaveDate, parseFm26SaveSummaryDate } from './fm26-save-summary'

const u32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
const lp = (value: string) => [...u32(new TextEncoder().encode(value).length), ...new TextEncoder().encode(value)]

function summary(packedDate: number, humans = 1) {
  const bytes = [0x03, 0x01, 0x74, 0x61, 0x64, 0x2e, 0x1d, 0x00]
  bytes.push(...lp('1651,MALE,0,0'))
  bytes.push(...lp('26.3.2+2329565'))
  bytes.push(...u32(1), ...lp('First Division'))
  bytes.push(0x01, ...u32(123456), 0x95, 0x0e, humans)
  for (let index = 0; index < humans; index += 1) {
    bytes.push(...lp(`Manager ${index + 1}`), ...lp(`Club ${index + 1}`), ...u32(300 + index))
  }
  bytes.push(...u32(packedDate), 0, 0, 0, 0)
  return new Uint8Array(bytes)
}

describe('FM26 save summary date', () => {
  it('decodes the controlled month transition without an off-by-one error', () => {
    expect(decodeFm26PackedSaveDate(0x07e9001e)?.currentDate).toBe('2025-01-30')
    expect(decodeFm26PackedSaveDate(0x07e9001f)?.currentDate).toBe('2025-01-31')
    expect(decodeFm26PackedSaveDate(0x07e90020)?.currentDate).toBe('2025-02-01')
  })

  it('preserves extra flag bits while decoding the same day-of-year field', () => {
    expect(decodeFm26PackedSaveDate(0x07e91aca)).toEqual({ currentDate: '2025-07-21', year: 2025, dayOfYear: 202, flags: 0x1a00 })
    expect(decodeFm26PackedSaveDate(0x07ed8225)).toEqual({ currentDate: '2029-02-06', year: 2029, dayOfYear: 37, flags: 0x8200 })
  })

  it('walks every human-manager record before reading packed_date', () => {
    const parsed = parseFm26SaveSummaryDate(summary(0x07ed8225, 6), 6)
    expect(parsed.status).toBe('confirmed')
    expect(parsed.current_date).toBe('2029-02-06')
    expect(parsed.summary_human_count).toBe(6)
  })

  it('fails closed when summary and humans.dat counts disagree', () => {
    const parsed = parseFm26SaveSummaryDate(summary(0x07e90020, 1), 2)
    expect(parsed.status).toBe('unresolved')
    expect(parsed.current_date).toBeNull()
    expect(parsed.reason).toMatch(/diverge/)
  })

  it('rejects impossible day-of-year values', () => {
    expect(decodeFm26PackedSaveDate(0x07e90000)).toBeNull()
    expect(decodeFm26PackedSaveDate(0x07e9016e)).toBeNull() // day 366 in non-leap 2025
    expect(decodeFm26PackedSaveDate(0x07e8016e)?.currentDate).toBe('2024-12-31')
  })
})
