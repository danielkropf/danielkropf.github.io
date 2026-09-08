// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SaveState, SaveStateOutlet, SaveStateProvider } from './SaveState'

function HiddenSurfaceHarness() {
  const [planning, setPlanning] = useState(false)
  return <SaveStateProvider>
    <button onClick={() => setPlanning(value => !value)}>Trocar</button>
    <SaveStateOutlet />
    <section hidden={planning}><SaveState status="✓ Estrutura salva" /></section>
    <section hidden={!planning}><SaveState status="Salvando Planejamento…" /></section>
  </SaveStateProvider>
}

describe('SaveState global outlet', () => {
  it('shows only the state owned by the visible surface and follows hidden workspace switches', async () => {
    render(<HiddenSurfaceHarness />)
    expect(await screen.findByText('✓ Estrutura salva')).toBeTruthy()
    expect(screen.queryByText('Salvando Planejamento…')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Trocar' }))
    await waitFor(() => expect(screen.getByText('Salvando Planejamento…')).toBeTruthy())
    expect(screen.queryByText('✓ Estrutura salva')).toBeNull()
  })

  it('does not duplicate a plain save status as a native tooltip', async () => {
    render(<SaveStateProvider><SaveStateOutlet /><SaveState status="✓ Salvo" /></SaveStateProvider>)
    const status = await screen.findByText('✓ Salvo')
    expect(status.closest('.save-state-control')?.hasAttribute('title')).toBe(false)
  })

  it('preserves retry behavior after moving the state to the global outlet', async () => {
    const retry = vi.fn()
    render(<SaveStateProvider><SaveStateOutlet /><SaveState status="⚠ Falha ao salvar" detail="Falha de rede" onRetry={retry} /></SaveStateProvider>)
    const button = await screen.findByRole('button', { name: 'Tentar novamente' })
    expect(button.closest('.save-state-control')?.getAttribute('title')).toBe('Falha de rede')
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
