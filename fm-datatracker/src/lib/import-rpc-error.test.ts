import { expect, it } from 'vitest'
import { importRpcErrorMessage } from './import-rpc-error'
it('explains database cancellation without treating unrelated errors as a rolled-back import', () => {
  expect(importRpcErrorMessage({code:'PGRST202',message:'Could not find public.import_fm_with_intakes'})).toContain('20260915005520')
  expect(importRpcErrorMessage({code:'57014',message:'canceling statement due to statement timeout'})).toContain('foram revertidas')
  expect(importRpcErrorMessage({message:'Failed to fetch'})).toBe('Failed to fetch')
  expect(importRpcErrorMessage({code:'57014',message:'canceling statement due to user request'})).toBe('canceling statement due to user request')
})
