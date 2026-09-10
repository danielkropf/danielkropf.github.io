import { expect, it } from 'vitest'
import { playerNameStatusClass } from './player-name-status'
it('shares the roster status mapping and preserves neutral unknowns', () => {
  expect(['Para venda', 'Para empréstimo', 'Para venda e empréstimo', 'Emprestado para fora', 'Emprestado para dentro', 'Nos planos', 'Incerto'].map(playerNameStatusClass)).toEqual(['is-for-sale','is-for-loan','is-for-sale','is-loaned-out','is-loaned-in','',''])
})
