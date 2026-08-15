import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { AppVersion } from '../../components/AppVersion'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { if (!supabase) return; void supabase.auth.getSession().then(({ data }) => setSession(data.session)); return supabase.auth.onAuthStateChange((_e, next) => setSession(next)).data.subscription.unsubscribe }, [])
  async function submit(event: FormEvent) { event.preventDefault(); if (!supabase) return; const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } }); setMessage(error ? `Falha no login: ${error.message}` : 'Link de acesso enviado. Verifique seu e-mail.') }
  if (!isSupabaseConfigured) return <main className="center"><section className="card auth"><span className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</span><h1>Conecte seu Banco Mestre</h1><p>Adicione <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> aos secrets do GitHub Actions e execute um novo deploy.</p><AppVersion /></section></main>
  if (!session) return <main className="center"><form className="card auth" onSubmit={submit}><span className="eyebrow">FM DATATRACKER</span><h1>Entre no vestiário</h1><p>Receba um link seguro de acesso por e-mail.</p><label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="voce@exemplo.com" /></label><button>Enviar link de acesso</button>{message && <p className="notice">{message}</p>}<AppVersion /></form></main>
  return children
}
