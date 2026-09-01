import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Falha não tratada no FM DataTracker.', { error, componentStack: info.componentStack })
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error" role="alert">
      <span className="eyebrow">Recuperação segura</span>
      <h1>O DataTracker encontrou uma falha inesperada</h1>
      <p>Nenhum dado foi apagado. Recarregue a página; se o problema continuar, copie o diagnóstico abaixo.</p>
      <pre>{this.state.error.message}</pre>
      <button type="button" onClick={() => globalThis.location?.reload()}>Recarregar aplicativo</button>
    </main>
  }
}
