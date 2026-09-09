// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ listener: null as null | ((event: string, session: unknown) => void) }))
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { auth: {
  onAuthStateChange: (listener: typeof mocks.listener) => { mocks.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } } },
  getSession: async () => ({ data: { session: { user: { id: 'a' } } }, error: null }),
} } }))
import { AuthGate } from './AuthGate'
afterEach(cleanup)
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
