import { describe, expect, it } from 'vitest'
import { describeDbError, isMissingRpcError } from './db-error'

describe('database error normalization', () => {
  it('preserves Supabase/PostgREST details that are not native Error instances', () => {
    const info = describeDbError({ message: 'Could not find the function', code: 'PGRST202', details: 'schema cache', hint: 'reload schema' })
    expect(info.message).toBe('Could not find the function')
    expect(info.full).toContain('PGRST202')
    expect(info.full).toContain('schema cache')
    expect(info.full).toContain('reload schema')
  })

  it('detects a missing model-config RPC conservatively', () => {
    expect(isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function public.patch_scoring_model_config' })).toBe(true)
    expect(isMissingRpcError({ code: '42501', message: 'permission denied' })).toBe(false)
  })
})
