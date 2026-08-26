export type DbErrorDetails = {
  message: string
  code: string | null
  details: string | null
  hint: string | null
  full: string
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

export function describeDbError(error: unknown, fallback = 'Falha desconhecida'): DbErrorDetails {
  if (error instanceof Error) {
    const message = text(error.message) ?? fallback
    return { message, code: null, details: null, hint: null, full: message }
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = text(record.message) ?? fallback
    const code = text(record.code)
    const details = text(record.details)
    const hint = text(record.hint)
    const full = [message, code ? `Código: ${code}` : null, details, hint].filter(Boolean).join(' — ')
    return { message, code, details, hint, full }
  }
  const primitive = text(String(error ?? ''))
  const message = primitive && primitive !== '[object Object]' ? primitive : fallback
  return { message, code: null, details: null, hint: null, full: message }
}

export function isMissingRpcError(error: unknown) {
  const info = describeDbError(error)
  const value = `${info.code ?? ''} ${info.full}`.toLowerCase()
  return info.code === 'PGRST202'
    || info.code === '42883'
    || value.includes('could not find the function')
    || value.includes('function public.patch_scoring_model_config')
    || value.includes('schema cache') && value.includes('patch_scoring_model_config')
}
