export function importRpcErrorMessage(error: { message?: string; code?: string }): string {
  const message = error.message ?? 'Falha desconhecida ao gravar a importação.'
  if (error.code === 'PGRST202' && message.includes('import_fm_with_intakes')) return 'O banco ainda não tem o suporte a intakes desta versão. Aplique a migração 20260915005520_automatic_intake_evidence antes de confirmar. Nenhuma importação foi executada.'
  if (/statement timeout/i.test(message)) {
    return 'O banco excedeu o tempo permitido e cancelou esta tentativa de importação. As gravações desta tentativa foram revertidas. Você pode confirmar novamente o mesmo arquivo; a verificação de duplicidade continua ativa. Se o erro persistir, informe a quantidade de jogadores e o tipo do arquivo. (statement timeout)'
  }
  return message
}
