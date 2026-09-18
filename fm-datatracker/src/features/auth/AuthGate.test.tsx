// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), listener: null as null | ((event: string, session: unknown) => void) }))
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { auth: {
  onAuthStateChange: (listener: typeof mocks.listener) => { mocks.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } } },
  getSession: () => mocks.getSession(),
} } }))
import { AuthGate, AUTH_WAIT_MS } from './AuthGate'
beforeEach(() => { mocks.getSession.mockReset().mockResolvedValue({data:{session:{user:{id:'a'}}},error:null}) })
afterEach(() => { cleanup(); vi.useRealTimers() })
function PrivateView() { const [value, setValue] = useState('empty'); return <button onClick={() => setValue('private-a')}>{value}</button> }
describe('authenticated user boundary', () => {
  it('retains state for token refresh but remounts private views when the user changes', async () => {
    render(<AuthGate><PrivateView /></AuthGate>)
    fireEvent.click(await screen.findByText('empty'))
    act(() => mocks.listener?.('TOKEN_REFRESHED', { user: { id: 'a' } }))
    expect(screen.getByText('private-a')).not.toBeNull()
    act(() => mocks.listener?.('SIGNED_IN', { user: { id: 'b' } }))
    expect(screen.queryByText('private-a')).toBeNull()
    expect(screen.getByText('empty')).not.toBeNull()
  })
})

it('ends an unresponsive session check and allows retry without exposing private content',async()=>{
 vi.useFakeTimers()
 mocks.getSession.mockReturnValue(new Promise(()=>{}))
 render(<AuthGate><span>Private</span></AuthGate>)
 await act(async()=>{vi.advanceTimersByTime(AUTH_WAIT_MS)})
 expect(screen.getByRole('alert').textContent).toContain('não respondeu')
 expect(screen.queryByText('Private')).toBeNull()
 mocks.getSession.mockResolvedValue({data:{session:{user:{id:'a'}}},error:null})
 await act(async()=>{fireEvent.click(screen.getByText('Tentar novamente'))})
 expect(screen.getByText('Private')).toBeTruthy()
})
it('accepts a recovered auth event after the wait limit',async()=>{
 vi.useFakeTimers();mocks.getSession.mockReturnValue(new Promise(()=>{}))
 render(<AuthGate><span>Recovered</span></AuthGate>)
 await act(async()=>{vi.advanceTimersByTime(AUTH_WAIT_MS)})
 act(()=>mocks.listener?.('SIGNED_IN',{user:{id:'a'}}))
 expect(screen.getByText('Recovered')).toBeTruthy()
})
