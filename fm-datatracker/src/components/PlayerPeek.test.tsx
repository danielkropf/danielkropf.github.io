// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerPeek } from './PlayerPeek'

const snapshot = {
  positions: ['D (C)'], age: 24, club: 'Fluminense', preferred_foot: 'right', height: 184,
  player_attributes: [],
}

afterEach(() => vi.restoreAllMocks())

describe('PlayerPeek', () => {
  it('anchors the portal beside the hovered trigger instead of the viewport centre', async () => {
    render(<PlayerPeek player={{ current_name: 'Jogador Teste', nationality: 'BRA' }} snapshot={snapshot} />)
    const button = screen.getByRole('button', { name: 'Prévia de Jogador Teste' })
    button.getBoundingClientRect = () => ({ left: 100, right: 120, top: 200, bottom: 220, width: 20, height: 20, x: 100, y: 200, toJSON: () => ({}) } as DOMRect)

    fireEvent.mouseEnter(button)
    const tooltip = await screen.findByText('Jogador Teste').then(() => document.querySelector<HTMLElement>('.fm-player-tooltip-trigger-anchored')!)
    await waitFor(() => expect(tooltip.style.visibility).toBe('visible'))
    expect(tooltip.style.left).toBe('128px')
    expect(tooltip.style.top).toBe('210px')
    expect(tooltip.classList.contains('fm-player-tooltip-trigger-anchored')).toBe(true)
  })
})
