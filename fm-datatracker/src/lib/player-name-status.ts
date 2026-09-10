/** Shared name styling. Sale takes color priority when both market flags apply. */
export function playerNameStatusClass(status: string): string {
  if (status === 'Para venda' || status === 'Para venda e empréstimo') return 'is-for-sale'
  if (status === 'Para empréstimo') return 'is-for-loan'
  if (status === 'Emprestado para fora') return 'is-loaned-out'
  if (status === 'Emprestado para dentro') return 'is-loaned-in'
  return ''
}
