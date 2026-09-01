import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useSaves } from '../features/saves/SaveContext'
import { createManualSaveEvent, loadSaveHistory, type SaveHistoryEvent } from '../lib/longitudinal-service'
import { historyEventText, historyYear, summarizeHistory } from '../lib/save-history'

export function HistoryPage() {
  const { selected } = useSaves()
  const [events, setEvents] = useState<SaveHistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clubFilter, setClubFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const clubs = selected?.structure?.trackedClubs.filter(item => item.is_active) ?? []

  async function reload() {
    if (!selected) return
    setLoading(true); setError('')
    try { setEvents(await loadSaveHistory(selected.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar a história.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [selected?.id])
  const filtered = useMemo(() => events.filter(event => (clubFilter === 'all' || event.club_id === clubFilter) && (typeFilter === 'all' || event.source_kind === typeFilter)), [events, clubFilter, typeFilter])
  const grouped = useMemo(() => {
    const groups = new Map<string, SaveHistoryEvent[]>()
    for (const event of filtered) {
      const key = historyYear(event)
      groups.set(key, [...(groups.get(key) ?? []), event])
    }
    return groups
  }, [filtered])
  const summary = summarizeHistory(events)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected || !title.trim() || !date) return
    setSaving(true); setError('')
    try { await createManualSaveEvent(selected.id, { eventDate: date, clubId: clubFilter === 'all' ? null : clubFilter, title, detail }); setTitle(''); setDetail(''); await reload() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao registrar fato.') }
    finally { setSaving(false) }
  }

  return <div className="roadmap-page">
    <header className="roadmap-heading"><div><span className="eyebrow">HISTÓRIA DO SAVE</span><h1>Linha do tempo factual</h1><p>Eventos derivados e registros manuais com origem explícita — sem inventar narrativa.</p></div><Link className="button ghost" to="/academy">Ver Academia</Link></header>
    {error && <p className="roadmap-alert" role="alert">{error}</p>}
    <section className="roadmap-kpis"><Metric value={summary.total} label="eventos"/><Metric value={summary.derived} label="derivados"/><Metric value={summary.manual} label="manuais"/><Metric value={summary.seasons} label="temporadas"/></section>
    <section className="card roadmap-toolbar"><label>Clube<select value={clubFilter} onChange={event => setClubFilter(event.target.value)}><option value="all">Toda a rede</option>{clubs.map(item => <option key={item.club_id} value={item.club_id}>{item.club.name}</option>)}</select></label><label>Origem<select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">Todas</option><option value="derived">Derivados</option><option value="manual">Manuais</option><option value="imported">Importados</option></select></label><span>{loading ? 'Carregando…' : `${filtered.length} eventos`}</span></section>
    <section className="history-timeline">{[...grouped].map(([period, rows]) => <div className="history-period" key={period}><h2>{period}</h2>{rows.map(event => { const text = historyEventText(event); return <article className="card history-event" key={event.id}><time>{formatDate(event.event_date)}</time><div><strong>{text.title}</strong>{text.detail && <p>{text.detail}</p>}<small>{event.club?.name ?? 'Toda a rede'} · {event.source_kind === 'manual' ? 'registro manual' : `derivado · ${event.event_type}`}</small></div>{event.player && <Link to={`/players/${event.player.id}`}>Jogador →</Link>}</article> })}</div>)}{!loading && !filtered.length && <article className="card roadmap-empty"><h2>Nenhum evento neste recorte</h2><p>Novos imports alimentam eventos derivados; fatos conhecidos podem ser adicionados abaixo.</p></article>}</section>
    <form className="card roadmap-form" onSubmit={submit}><header><span className="eyebrow">FATO MANUAL</span><h2>Registrar acontecimento</h2><p>Registre somente fatos confirmados. O aplicativo identifica a origem manual.</p></header><label>Data<input required type="date" value={date} onChange={event => setDate(event.target.value)}/></label><label>Título<input required value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex.: Campeão estadual"/></label><label>Detalhe<textarea value={detail} onChange={event => setDetail(event.target.value)} rows={3}/></label><button className="button" disabled={saving}>{saving ? 'Salvando…' : 'Registrar fato'}</button></form>
  </div>
}

function Metric({ value, label }: { value: number; label: string }) { return <article className="card"><strong>{value}</strong><span>{label}</span></article> }
function formatDate(value: string) { const parsed = new Date(`${value}T12:00:00`); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('pt-BR').format(parsed) }
