import { describe, expect, it, vi } from 'vitest'
import { deleteWithRpcFallback, isDeleteImportRpcMissing } from './import-management'

const missing = { code: 'PGRST202', message: 'Could not find the function public.delete_fm_import in the schema cache' }

function failure(error: { code?: string; message?: string; details?: string }) {
  const fallback = vi.fn(async () => undefined)
  return {
    fallback,
    run: () => deleteWithRpcFallback(async () => ({ error }), fallback),
  }
}

describe('deleteFmImportSafe fallback policy', () => {
  it('RPC success does not call fallback', async () => {
    const fallback = vi.fn(async () => undefined)
    await expect(deleteWithRpcFallback(async () => ({ error: null }), fallback)).resolves.toBe('rpc')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('known missing RPC can use the compatibility fallback', async () => {
    const fallback = vi.fn(async () => undefined)
    await expect(deleteWithRpcFallback(async () => ({ error: missing }), fallback)).resolves.toBe('direct')
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(isDeleteImportRpcMissing(missing)).toBe(true)
  })

  it.each([
    ['network', { message: 'Failed to fetch' }],
    ['permission', { code: '42501', message: 'permission denied for table imports' }],
    ['server', { code: 'XX000', message: 'internal server error' }],
    ['constraint', { code: '23503', message: 'foreign key violation' }],
    ['unknown', { code: 'PGRST100', message: 'unexpected error' }],
  ])('%s error fails closed without fallback', async (_label, error) => {
    const { run, fallback } = failure(error)
    await expect(run()).rejects.toThrow()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('does not treat an unrelated missing-function error as delete_fm_import compatibility', async () => {
    const { run, fallback } = failure({ code: 'PGRST202', message: 'Could not find public.some_other_rpc' })
    await expect(run()).rejects.toThrow()
    expect(fallback).not.toHaveBeenCalled()
  })
})
