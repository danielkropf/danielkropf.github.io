import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ATTRIBUTE_CATALOG } from '../lib/attributes'
import { useSaves } from '../features/saves/SaveContext'

type Attribute = { attribute_key: string; attribute_label: string; value: number; category: string }
type Snapshot = {
  id: string
  snapshot_date: string
  age: number | null
  club: string | null
  squad: string | null
  positions: string[]
  preferred_foot?: string | null
  height?: number | null
  weight?: number | null
  contract_expiry: string | null
  raw_data: Record<string, unknown>
  normalized_data: Record<string, unknown>
  player_attributes: Attribute[]
}
type Player = {
  id: string
  fm_player_id: string | null
  current_name: string
  nationality: string | null
  date_of_birth: string | null
  first_seen_date: string
  last_seen_date: string
  is_active: boolean
  player_snapshots: Snapshot[]
}
type LoadState =
  | { status: 'loading' }
  | { status: 'data'; player: Player }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function isPlayer(value: unknown): value is Player {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.current_name === 'string'
    && Array.isArray(value.player_snapshots)
    && value.player_snapshots.every(snapshot => isRecord(snapshot) && typeof snapshot.id === 'string' && typeof snapshot.snapshot_date === 'string' && Array.isArray(snapshot.player_attributes))
}

export function PlayerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { selected } = useSaves()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [index, setIndex] = useState(0)
  const [compareMode, setCompareMode] = useState('previous')

  useEffect(() => {
    let active = true
    setIndex(0)
    setState({ status: 'loading' })

    if (!supabase) {
      setState({ status: 'error', message: 'Banco Mestre não configurado.' })
      return () => { active = false }
    }
    if (!id || !selected) {
      setState({ status: 'not-found' })
      return () => { active = false }
    }

    void (async () => {
      const result = await supabase
        .from('players')
        .select('id,fm_player_id,current_name,nationality,date_of_birth,first_seen_date,last_seen_date,is_active,player_snapshots(id,snapshot_date,age,club,squad,positions,preferred_foot,height,weight,contract_expiry,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))')
        .eq('id', id)
        .eq('save_id', selected.id)
        .maybeSingle()

      if (!active) return
      if (result.error) {
        setState({ status: 'error', message: result.error.message })
        return
      }
      if (!result.data) {
        setState({ status: 'not-found' })
        return
      }
      if (!isPlayer(result.data)) {
        setState({ status: 'error', message: 'O Banco Mestre retornou uma ficha de jogador em formato inesperado.' })
        return
      }

      const player: Player = {
        ...result.data,
        player_snapshots: [...result.data.player_snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)),
      }
      setState({ status: 'data', player })
      setIndex(Math.max(0, player.player_snapshots.length - 1))
    })().catch(cause => {
      if (!active) return
      setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Falha inesperada ao carregar a ficha do jogador.' })
    })

    return () => { active = false }
  }, [id, selected?.id])

  const player = state.status === 'data' ? state.player : null
  const snapshots = player?.player_snapshots ?? []
  const current = snapshots[index]
  const compareIndex = useMemo(() => compareMode === 'previous' ? Math.max(0, index - 1) : compareMode === 'oldest' ? 0 : Number(compareMode), [compareMode, index])
  const comparison = snapshots[compareIndex]

  if (state.status === 'loading') return <div className="screen-page player-page"><p>Carregando ficha do jogador…</p></div>
  if (state.status === 'not-found') return <div className="screen-page player-page"><p>Jogador não encontrado neste save.</p></div>
  if (state.status === 'error') return <div className="screen-page player-page"><p className="warning">Não foi possível carregar a ficha do jogador: {state.message}</p></div>
  if (!player) return null

  return <div className="screen-page player-page"><div className="title-row"><div><button className="back-button" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/squad')}>← Voltar</button><h1>{player.current_name}</h1></div><div className="player-snapshot-control"><label>Snapshot <span>{index + 1}/{snapshots.length}</span><input type="range" min="0" max={Math.max(0, snapshots.length - 1)} value={index} disabled={snapshots.length <= 1} onChange={event => setIndex(Number(event.target.value))} /></label><strong>{current?.snapshot_date ?? 'Sem snapshot'}</strong></div></div>{current ? <div className="player-page-body">
    <section className="player-summary-grid"><Info label="Idade" value={current.age} /><Info label="Nacionalidade" value={player.nationality} /><Info label="Nascimento" value={player.date_of_birth} /><Info label="Posições" value={current.positions?.join(', ')} /><Info label="Equipe" value={current.club || current.squad} /><FeetInfo snapshot={current} /><Info label="Altura" value={current.height ? `${current.height} cm` : field(current, 'height')} /><Info label="Peso" value={current.weight ? `${current.weight} kg` : field(current, 'weight')} /><Info label="Contrato" value={current.contract_expiry} /><Info label="ID do FM" value={player.fm_player_id} /></section>
    <section className="card player-attributes-panel"><header><div><span className="eyebrow">ATRIBUTOS</span><h2>{current.snapshot_date}</h2></div><label>Comparar com<select value={compareMode} disabled={snapshots.length <= 1} onChange={event => setCompareMode(event.target.value)}><option value="previous">Snapshot anterior</option><option value="oldest">Primeiro snapshot</option>{snapshots.map((snapshot, snapshotIndex) => <option value={snapshotIndex} key={snapshot.id}>{snapshot.snapshot_date}</option>)}</select></label></header><div className="player-attribute-groups">{(['technical', 'mental', 'physical', 'goalkeeping'] as const).map(category => <section key={category}><h3>{{ technical: 'Técnico', mental: 'Mental', physical: 'Físico', goalkeeping: 'Goleiro' }[category]}</h3>{ATTRIBUTE_CATALOG.filter(attribute => attribute.category === category).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')).map(definition => { const attribute = current.player_attributes.find(item => item.attribute_key === definition.key); const old = comparison?.player_attributes.find(item => item.attribute_key === definition.key); const delta = attribute && old ? attribute.value - old.value : null; return <div className="player-attribute-row" key={definition.key}><span>{attribute?.attribute_label ?? definition.label}</span><b className={attribute ? attributeClass(attribute.value) : ''}>{attribute?.value ?? '—'}</b><small className={delta && delta > 0 ? 'up' : delta && delta < 0 ? 'down' : ''}>{delta === null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`}</small></div> })}</section>)}</div></section>
  </div> : <p>Este jogador ainda não possui snapshots.</p>}</div>
}

function field(snapshot: Snapshot, key: string) {
  const value = snapshot.normalized_data?.[key] ?? Object.entries(snapshot.raw_data ?? {}).find(([label]) => label.toLowerCase().replace(/\W/g, '_').includes(key))?.[1]
  return value == null ? '—' : String(value)
}
function Info({ label, value }: { label: string; value: unknown }) { return <div><small>{label}</small><strong>{value == null || value === '' ? '—' : String(value)}</strong></div> }
function attributeClass(value: number) { return value >= 15 ? 'attribute-high' : value >= 10 ? 'attribute-mid' : 'attribute-low' }
function FeetInfo({ snapshot }: { snapshot: Snapshot }) { const preferred = String(snapshot.preferred_foot || field(snapshot, 'preferred_foot')); const right = footValue(snapshot, 'right') || (preferred.toLowerCase().includes('right') ? 'Preferido' : '—'); const left = footValue(snapshot, 'left') || (preferred.toLowerCase().includes('left') ? 'Preferido' : '—'); return <div className="feet-info"><small>Proficiência dos pés</small><span><b>DIR</b><strong>{right}</strong><b>ESQ</b><strong>{left}</strong></span></div> }
function footValue(snapshot: Snapshot, side: 'right' | 'left') { const direct = snapshot.normalized_data?.[`${side}_foot`], feet = snapshot.normalized_data?.feet; if (typeof direct === 'number') return footRating(direct); if (feet && typeof feet === 'object' && !Array.isArray(feet)) { const value = isRecord(feet) ? feet[side] : null; if (typeof value === 'number') return footRating(value) } const aliases = side === 'right' ? ['right_foot', 'pe_direito', 'pé_direito'] : ['left_foot', 'pe_esquerdo', 'pé_esquerdo'], entries = Object.entries({ ...snapshot.raw_data, ...snapshot.normalized_data }); for (const [key, value] of entries) { const normalized = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_'); if (aliases.some(alias => normalized.includes(alias.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) && value != null && String(value).trim()) { const numeric = Number(value); return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? footRating(numeric) : String(value) } } return null }
function footRating(value: number) { const label = value <= 4 ? 'Very Weak' : value <= 7 ? 'Weak' : value <= 11 ? 'Reasonable' : value <= 14 ? 'Fairly Strong' : value <= 17 ? 'Strong' : 'Very Strong'; return `${value} · ${label}` }
