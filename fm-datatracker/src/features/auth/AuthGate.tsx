import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { AppVersion } from '../../components/AppVersion'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { if (!supabase) return; void supabase.auth.getSession().then(({ data }) => setSession(data.session)); return supabase.auth.onAuthStateChange((_e, next) => setSession(next)).data.subscription.unsubscribe }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) setMessage(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : `Falha no login: ${error.message}`)
  }
  if (!isSupabaseConfigured) return <main className="center"><section className="card auth"><span className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</span><h1>Conecte seu Banco Mestre</h1><p>Adicione <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> aos secrets do GitHub Actions e execute um novo deploy.</p><AppVersion /></section></main>
  if (!session) return <main className="center"><form className="card auth" onSubmit={submit}><span className="eyebrow">FM DATATRACKER</span><h1>Entre no vestiário</h1><p>Use o usuário criado no Supabase para acessar seu Banco Mestre.</p><label>E-mail<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="voce@exemplo.com" /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="Sua senha" /></label><button disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</button>{message && <p className="error" role="alert">{message}</p>}<AppVersion /></form></main>
  return children
}
