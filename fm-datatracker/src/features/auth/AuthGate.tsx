import { setPrivateSession } from '../../lib/private-session'
import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { AppVersion } from '../../components/AppVersion'

export const AUTH_WAIT_MS = 15000
const unavailable = 'O serviço de login não respondeu. Tente novamente em instantes.'
function authError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '')
  if (/failed to fetch|network|timeout|522|aborted/i.test(message)) return unavailable
  return message || 'Não foi possível verificar a sessão.'
}
async function boundedAuth<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(unavailable)), AUTH_WAIT_MS)
    })])
  } finally { clearTimeout(timer) }
}

type AuthState =
  | { status: 'loading'; session: null; error: '' }
  | { status: 'authenticated'; session: Session; error: '' }
  | { status: 'unauthenticated'; session: null; error: '' }
  | { status: 'error'; session: null; error: string }

const loadingState = (): AuthState => ({ status: 'loading', session: null, error: '' })
const unauthenticatedState = (): AuthState => ({ status: 'unauthenticated', session: null, error: '' })

export function AuthGate({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(loadingState)
  const [bootAttempt, setBootAttempt] = useState(0)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    let authEventSeen = false
    setAuth(loadingState())

    const timer = setTimeout(() => {
      if (active && !authEventSeen) setAuth({ status: 'error', session: null, error: unavailable })
    }, AUTH_WAIT_MS)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      clearTimeout(timer)
      authEventSeen = true
      setPrivateSession(next?.user.id ?? null)
      setAuth(next
        ? { status: 'authenticated', session: next, error: '' }
        : unauthenticatedState())
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEventSeen) return
      clearTimeout(timer)
      if (error) {
        setAuth({ status: 'error', session: null, error: authError(error) })
        return
      }
      setPrivateSession(data.session?.user.id ?? null)
      setAuth(data.session
        ? { status: 'authenticated', session: data.session, error: '' }
        : unauthenticatedState())
    }).catch(cause => {
      if (!active || authEventSeen) return
      clearTimeout(timer)
      setAuth({
        status: 'error',
        session: null,
        error: authError(cause),
      })
    })

    return () => {
      clearTimeout(timer)
      active = false
      subscription.unsubscribe()
    }
  }, [bootAttempt])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || submitting) return
    setSubmitting(true)
    setMessage('')
    try {
      const { data, error } = await boundedAuth(supabase.auth.signInWithPassword({ email, password }))
      if (error) {
        setMessage(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : authError(error))
      } else if (data.session) {
        setPrivateSession(data.session.user.id)
        setAuth({ status: 'authenticated', session: data.session, error: '' })
      }
    } catch (cause) {
      setMessage(authError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (!isSupabaseConfigured) return <main className="center"><section className="card auth"><span className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</span><h1>Conecte seu Banco Mestre</h1><p>Adicione <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> aos secrets do GitHub Actions e execute um novo deploy.</p><AppVersion /></section></main>

  if (auth.status === 'loading') return <main className="center"><section className="card auth" aria-live="polite"><span className="eyebrow">FM DATATRACKER</span><h1>Verificando sessão…</h1><p>Confirmando seu acesso ao Banco Mestre.</p><AppVersion /></section></main>

  if (auth.status === 'error') return <main className="center"><section className="card auth"><span className="eyebrow">SESSÃO INDISPONÍVEL</span><h1>Não foi possível verificar o login</h1><p className="error" role="alert">{auth.error}</p><button type="button" onClick={() => setBootAttempt(value => value + 1)}>Tentar novamente</button><AppVersion /></section></main>

  if (auth.status === 'unauthenticated') return <main className="center"><form className="card auth" onSubmit={submit}><span className="eyebrow">FM DATATRACKER</span><h1>Entre no vestiário</h1><p>Use o usuário criado no Supabase para acessar seu Banco Mestre.</p><label>E-mail<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="voce@exemplo.com" /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="Sua senha" /></label><button disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</button>{message && <p className="error" role="alert">{message}</p>}<AppVersion /></form></main>

  return <Fragment key={auth.session.user.id}>{children}</Fragment>
}
