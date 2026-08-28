import { describe, expect, it, vi } from 'vitest'
import { runDiagnosticReservationUpload, type DiagnosticUploadAdapter } from './diagnostic-upload'

function adapter(overrides: Partial<DiagnosticUploadAdapter> = {}): DiagnosticUploadAdapter {
  return {
    reserve: vi.fn(async () => ({ id: 'sample-1', storagePrefix: 'user-1/sample-1' })),
    setPaths: vi.fn(async () => undefined),
    upload: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    deleteReservation: vi.fn(async () => undefined),
    ...overrides,
  }
}
const fm = { name: 'save.fm' }
const csv = { name: 'squad.csv' }

describe('diagnostic upload lifecycle', () => {
  it('completa a reserva sem cleanup no caminho feliz', async () => {
    const api = adapter()
    await expect(runDiagnosticReservationUpload(api, fm, csv)).resolves.toMatchObject({ id: 'sample-1' })
    expect(api.setPaths).toHaveBeenCalledBefore(vi.mocked(api.upload))
    expect(api.upload).toHaveBeenCalledTimes(2)
    expect(api.complete).toHaveBeenCalledTimes(1)
    expect(api.remove).not.toHaveBeenCalled()
    expect(api.deleteReservation).not.toHaveBeenCalled()
  })

  it('compensa falha parcial do segundo upload e remove a reserva', async () => {
    let uploadCount = 0
    const api = adapter({
      upload: vi.fn(async () => {
        uploadCount += 1
        if (uploadCount === 2) throw new Error('csv upload failed')
      }),
    })
    await expect(runDiagnosticReservationUpload(api, fm, csv)).rejects.toThrow('csv upload failed')
    expect(api.remove).toHaveBeenCalledWith(['user-1/sample-1/fm-save.fm', 'user-1/sample-1/csv-squad.csv'])
    expect(api.deleteReservation).toHaveBeenCalledWith('sample-1')
  })

  it('preserva a reserva quando a limpeza de storage falha para permitir retry/retention', async () => {
    const api = adapter({
      upload: vi.fn(async () => { throw new Error('network') }),
      remove: vi.fn(async () => { throw new Error('storage cleanup unavailable') }),
    })
    await expect(runDiagnosticReservationUpload(api, fm, csv)).rejects.toThrow('reserva foi preservada')
    expect(api.deleteReservation).not.toHaveBeenCalled()
  })
})
