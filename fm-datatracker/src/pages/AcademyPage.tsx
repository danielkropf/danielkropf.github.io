import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useSaves } from '../features/saves/SaveContext'
import { createManualIntakeClass, loadIntakeArchive, type IntakeArchiveClass } from '../lib/longitudinal-service'

export function AcademyPage() {
  const { selected } = useSaves()
  const [classes, setClasses] = useState<IntakeArchiveClass[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clubFilter, setClubFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const clubs = selected?.structure?.trackedClubs.filter(item => item.is_active) ?? []

  async function reload() {
    if (!selected) return
    setLoading(true); setError('')
    try { setClasses(await loadIntakeArchive(selected.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar a academia.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [selected?.id])

  const filtered = useMemo(() => classes.filter(item => clubFilter === 'all' || item.club_id === clubFilter), [classes, clubFilter])
  const members = filtered.flatMap(item => item.members)
  const active = members.filter(item => item.player?.is_active).length
  const professional = members.filter(item => ['first_team', 'reserve'].includes(item.latestSnapshot?.squad?.toLowerCase().replace(/\s+/g, '_') ?? '')).length

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected || !label.trim() || clubFilter === 'all') return
    setCreating(true); setError('')
    try { await createManualIntakeClass(selected.id, clubFilter, label, date || null); setLabel(''); setDate(''); await reload() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao criar turma.') }
    finally { setCreating(false) }
  }

  return <div className="roadmap-page">
    <header className="roadmap-heading"><div><span className="eyebrow">ACADEMIA</span><h1>Turmas de formação</h1><p>Coortes históricas fixas, com situação atual separada da fotografia de entrada.</p></div></header>
    {error && <p className="roadmap-alert" role="alert">{error}</p>}
    <section className="roadmap-kpis"><Metric value={filtered.length} label="turmas"/><Metric value={members.length} label="jogadores registrados"/><Metric value={active} label="ainda ativos"/><Metric value={professional} label="no profissional/reserva"/></section>
    <section className="card roadmap-toolbar"><label>Clube<select value={clubFilter} onChange={event => setClubFilter(event.target.value)}><option value="all">Toda a rede</option>{clubs.map(item => <option key={item.club_id} value={item.club_id}>{item.club.name}</option>)}</select></label><span>{loading ? 'Carregando…' : `${filtered.length} turmas encontradas`}</span></section>
    <section className="academy-grid">
      {filtered.map(item => <article className="card academy-class" key={item.id}><button className="academy-class-toggle" type="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(current => current === item.id ? null : item.id)}><span><span className="eyebrow">{item.club?.name ?? 'CLUBE NÃO RESOLVIDO'}</span><strong>{item.label}</strong><small>{item.season?.label ?? formatDate(item.intake_date) ?? 'Data não informada'} · {item.source_kind === 'manual' ? 'manual' : 'derivada'}</small></span><b>{item.members.length}</b></button>{expanded === item.id && <div className="academy-members">{item.members.length ? item.members.map(member => <div key={member.id}><span>{member.player ? <Link to={`/players/${member.player.id}`}>{member.player.current_name}</Link> : 'Jogador não resolvido'}<small>{member.latestSnapshot ? `${member.latestSnapshot.age ?? '—'} anos · ${member.latestSnapshot.club ?? 'sem clube'} · ${member.latestSnapshot.squad ?? 'sem equipe'}` : 'Sem fotografia atual'}</small></span><em>{member.player?.is_active ? 'Ativo' : 'Inativo'}</em></div>) : <p>Nenhum integrante registrado.</p>}</div>}</article>)}
      {!loading && !filtered.length && <article className="card roadmap-empty"><h2>Nenhuma turma neste recorte</h2><p>Imports futuros podem gerar turmas automaticamente; fatos históricos também podem ser registrados abaixo.</p></article>}
    </section>
    <form className="card roadmap-form" onSubmit={submit}><header><span className="eyebrow">REGISTRO MANUAL</span><h2>Adicionar turma histórica</h2><p>Use apenas para um fato conhecido; o registro preserva proveniência manual.</p></header><label>Clube<select required value={clubFilter === 'all' ? '' : clubFilter} onChange={event => setClubFilter(event.target.value)}><option value="">Selecione</option>{clubs.map(item => <option key={item.club_id} value={item.club_id}>{item.club.name}</option>)}</select></label><label>Nome da turma<input required value={label} onChange={event => setLabel(event.target.value)} placeholder="Ex.: Geração 2026"/></label><label>Data de entrada<input type="date" value={date} onChange={event => setDate(event.target.value)}/></label><button className="button" disabled={creating}>{creating ? 'Salvando…' : 'Registrar turma'}</button></form>
  </div>
}

function Metric({ value, label }: { value: number; label: string }) { return <article className="card"><strong>{value}</strong><span>{label}</span></article> }
function formatDate(value: string | null) { if (!value) return null; const parsed = new Date(`${value}T12:00:00`); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('pt-BR').format(parsed) }
