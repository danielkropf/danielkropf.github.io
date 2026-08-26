type Props = {
  status: string
  detail?: string
  onRetry?: () => void
}

export function SaveState({ status, detail = '', onRetry }: Props) {
  const failed = status.startsWith('⚠')
  const saving = status.startsWith('Salvando')
  const saved = status.startsWith('✓')
  const className = failed ? 'save-state-failed' : saving ? 'save-state-saving' : saved ? 'save-state-saved' : ''
  return <span className={`save-state-control ${className}`.trim()} title={detail || status} role={failed ? 'alert' : 'status'}>
    <span>{status}</span>
    {failed && onRetry && <button type="button" onClick={onRetry}>Tentar novamente</button>}
  </span>
}
