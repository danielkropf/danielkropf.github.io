export function importRpcErrorMessage(error: { message?: string; code?: string }): string {
  const message = error.message ?? 'Falha desconhecida ao gravar a importação.'
  if (/statement timeout/i.test(message)) {
    return 'O banco excedeu o tempo permitido e cancelou esta tentativa de importação. As gravações desta tentativa foram revertidas. Você pode confirmar novamente o mesmo arquivo; a verificação de duplicidade continua ativa. Se o erro persistir, informe a quantidade de jogadores e o tipo do arquivo. (statement timeout)'
  }
  return message
}
