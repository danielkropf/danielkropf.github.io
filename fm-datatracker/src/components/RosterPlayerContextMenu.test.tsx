// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RosterPlayerContextMenu } from './RosterPlayerContextMenu'
afterEach(cleanup)
it('offers independent removal actions when both market flags are active', () => {
  const loan = vi.fn(), sale = vi.fn()
  const props = { x: 10, y: 10, squads: [], onMoveSquad: vi.fn(), onLoan: loan, onSale: sale, onClose: vi.fn() }
  const view = render(<RosterPlayerContextMenu {...props} markedForLoan markedForSale />)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remover de venda' }))
  expect(sale).toHaveBeenCalledOnce()
  expect(loan).not.toHaveBeenCalled()
  view.rerender(<RosterPlayerContextMenu {...props} markedForLoan markedForSale={false} />)
  expect(screen.getByRole('menuitem', { name: 'Adicionar para venda' })).not.toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remover de empréstimo' }))
  expect(loan).toHaveBeenCalledOnce()
})
