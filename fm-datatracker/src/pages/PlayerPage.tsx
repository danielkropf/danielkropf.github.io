import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ATTRIBUTE_CATALOG } from '../lib/attributes'
import { useSaves } from '../features/saves/SaveContext'
import { basePositionScores, generalScoreForSnapshot } from '../lib/base-position-score'
import { explainBasePositionScore } from '../lib/score-explanation'
import { loadPlayerStats, statContextLabel, statMetricEntries, statsSample } from '../lib/player-stats'
import { loadReferenceDataset } from '../lib/dataCache'
import { generalReferencePercentile, generalReferenceScoresByFamily, normalizeCountry, referenceLevel, type ReferenceDataset } from '../lib/reference'
import { ScoreBadge } from '../components/ScoreBadge'
import type { PlayerStat } from '../types/domain'

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
  | { status: 'data'; player: Player; stats: PlayerStat[]; reference: ReferenceDataset | null }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
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

    if (!supabase) { setState({ status: 'error', message: 'Banco Mestre não configurado.' }); return () => { active = false } }
    if (!id || !selected) { setState({ status: 'not-found' }); return () => { active = false } }
    const client = supabase

    void (async () => {
      const [playerResult, stats, reference] = await Promise.all([
        client.from('players')
          .select('id,fm_player_id,current_name,nationality,date_of_birth,first_seen_date,last_seen_date,is_active,player_snapshots:player_snapshots!player_snapshots_player_save_fkey(id,snapshot_date,age,club,squad,positions,preferred_foot,height,weight,contract_expiry,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))')
          .eq('id', id).eq('save_id', selected.id).maybeSingle(),
        loadPlayerStats(selected.id, id),
        loadReferenceDataset().catch(() => null),
      ])
      if (!active) return
      if (playerResult.error) { setState({ status: 'error', message: playerResult.error.message }); return }
      if (!playerResult.data) { setState({ status: 'not-found' }); return }
      if (!isPlayer(playerResult.data)) { setState({ status: 'error', message: 'O Banco Mestre retornou uma ficha de jogador em formato inesperado.' }); return }

      const player: Player = { ...playerResult.data, player_snapshots: [...playerResult.data.player_snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)) }
      setState({ status: 'data', player, stats, reference })
      setIndex(Math.max(0, player.player_snapshots.length - 1))
    })().catch(cause => { if (active) setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Falha inesperada ao carregar a ficha do jogador.' }) })

    return () => { active = false }
  }, [id, selected?.id])

  const player = state.status === 'data' ? state.player : null
  const stats = state.status === 'data' ? state.stats : []
  const reference = state.status === 'data' ? state.reference : null
  const snapshots = player?.player_snapshots ?? []
  const current = snapshots[index]
  const compareIndex = useMemo(() => compareMode === 'previous' ? Math.max(0, index - 1) : compareMode === 'oldest' ? 0 : Number(compareMode), [compareMode, index])
  const comparison = snapshots[compareIndex]

  const analysis = useMemo(() => {
    if (!current) return null
    const general = generalScoreForSnapshot(current)
    const bases = basePositionScores(current).sort((a, b) => b.score - a.score)
    const explanation = explainBasePositionScore(current, general)
    if (!general || !reference) return { general, bases, explanation, reference: null as null | { percentile:number; level:string; sample:number; country:string; division:number; family:string } }
    const markets = reference.markets.filter(market => normalizeCountry(market.country) === normalizeCountry(selected?.country))
    const market = markets.find(item => item.division === 1) ?? markets.sort((a,b) => a.division-b.division)[0]
    if (!market) return { general, bases, explanation, reference: null }
    const players = reference.players.filter(item => item.c === market.country && item.d === market.division)
    const groups = generalReferenceScoresByFamily(players, reference.attributes)
    const result = generalReferencePercentile(general.score, current, groups)
    return { general, bases, explanation, reference: result ? { percentile: result.percentile, level: referenceLevel(result.percentile), sample: result.population.length, country: market.country, division: market.division, family: result.family } : null }
  }, [current, reference, selected?.country])

  if (state.status === 'loading') return <div className="screen-page player-page"><p>Carregando ficha do jogador…</p></div>
  if (state.status === 'not-found') return <div className="screen-page player-page"><p>Jogador não encontrado neste save.</p></div>
  if (state.status === 'error') return <div className="screen-page player-page"><p className="warning">Não foi possível carregar a ficha do jogador: {state.message}</p></div>
  if (!player) return null

  return <div className="screen-page player-page">
    <div className="title-row"><div><button className="back-button" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/squad')}>← Voltar</button><h1>{player.current_name}</h1></div><div className="player-snapshot-control"><label>Snapshot <span>{index + 1}/{snapshots.length}</span><input type="range" min="0" max={Math.max(0, snapshots.length - 1)} value={index} disabled={snapshots.length <= 1} onChange={event => setIndex(Number(event.target.value))} /></label><strong>{current?.snapshot_date ?? 'Sem snapshot'}</strong></div></div>
    {current ? <div className="player-page-body">
      <section className="player-summary-grid"><Info label="Idade" value={current.age} /><Info label="Nacionalidade" value={player.nationality} /><Info label="Nascimento" value={player.date_of_birth} /><Info label="Posições" value={current.positions?.join(', ')} /><Info label="Equipe" value={current.club || current.squad} /><FeetInfo snapshot={current} /><Info label="Altura" value={current.height ? `${current.height} cm` : field(current, 'height')} /><Info label="Peso" value={current.weight ? `${current.weight} kg` : field(current, 'weight')} /><Info label="Contrato" value={current.contract_expiry} /><Info label="ID do FM" value={player.fm_player_id} /></section>

      <section className="player-analyzer-grid">
        <article className="card player-current-analysis"><header><div><span className="eyebrow">ANALYZER</span><h2>Qualidade atual</h2></div>{analysis?.general ? <ScoreBadge value={analysis.general.score} rank={analysis.reference?.percentile ?? null} /> : null}</header>
          {analysis?.general ? <><div className="analysis-primary"><div><small>Nota Geral</small><strong>{analysis.general.score.toLocaleString('pt-BR',{maximumFractionDigits:2})}</strong><span>{analysis.general.position} · BasePositionScore {analysis.general.scoreKey}</span></div>{analysis.reference ? <div><small>Referência competitiva</small><strong>P{analysis.reference.percentile} · {analysis.reference.level}</strong><span>{analysis.reference.country} · {analysis.reference.division}ª divisão · {analysis.reference.sample} jogadores · família {analysis.reference.family}</span></div> : <div><small>Referência competitiva</small><strong>Indisponível</strong><span>Sem população compatível para este save.</span></div>}</div>
            <div className="base-position-list">{analysis.bases.map(item => <div key={`${item.scoreKey}-${item.family}`}><span>{item.position}</span><ScoreBadge value={item.score} showTitle={false}/></div>)}</div>
            {analysis.explanation ? <div className="score-evidence"><div><small>Matriz-base</small><strong>{analysis.explanation.roleName}</strong><span>IP {formatScore(analysis.explanation.ipScore)} · OOP {formatScore(analysis.explanation.oopScore)} · combinação geométrica canônica.</span></div><div className="score-evidence-attributes">{analysis.explanation.attributes.slice(0,6).map(item => <span key={item.key}><b>{attributeLabel(item.key)}</b><strong>{item.value}</strong><small>IP {item.ipWeight} · OOP {item.oopWeight}</small></span>)}</div><p>Os atributos acima são os de maior peso efetivo na matriz usada. A nota continua sendo calculada pela fórmula canônica; familiaridade, percentil e stats não alteram silenciosamente esse valor.</p></div> : null}</> : <p className="notice">Não há atributos suficientes para calcular a Nota Geral neste snapshot.</p>}
        </article>

        <article className="card player-performance-evidence"><header><div><span className="eyebrow">EVIDÊNCIA OBSERVADA</span><h2>Estatísticas</h2></div><span className="analyzer-status">PerformanceScore: não definido</span></header>
          {stats.length ? <div className="player-stat-contexts">{stats.map(stat => <StatContext stat={stat} key={stat.id}/>)}</div> : <div className="stats-empty"><strong>Sem estatísticas importadas</strong><p>A Nota Geral acima continua válida por atributos. Stats ausentes não viram zero e não reduzem a avaliação.</p></div>}
          <p className="performance-contract">Confidence indica somente o tamanho da amostra em minutos. Ainda não existe PerformanceScore aprovado, portanto nenhuma estatística é misturada à nota atual.</p>
        </article>
      </section>

      <section className="card player-attributes-panel"><header><div><span className="eyebrow">ATRIBUTOS</span><h2>{current.snapshot_date}</h2></div><label>Comparar com<select value={compareMode} disabled={snapshots.length <= 1} onChange={event => setCompareMode(event.target.value)}><option value="previous">Snapshot anterior</option><option value="oldest">Primeiro snapshot</option>{snapshots.map((snapshot, snapshotIndex) => <option value={snapshotIndex} key={snapshot.id}>{snapshot.snapshot_date}</option>)}</select></label></header><div className="player-attribute-groups">{(['technical', 'mental', 'physical', 'goalkeeping'] as const).map(category => <section key={category}><h3>{{ technical: 'Técnico', mental: 'Mental', physical: 'Físico', goalkeeping: 'Goleiro' }[category]}</h3>{ATTRIBUTE_CATALOG.filter(attribute => attribute.category === category).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')).map(definition => { const attribute = current.player_attributes.find(item => item.attribute_key === definition.key); const old = comparison?.player_attributes.find(item => item.attribute_key === definition.key); const delta = attribute && old ? attribute.value - old.value : null; return <div className="player-attribute-row" key={definition.key}><span>{attribute?.attribute_label ?? definition.label}</span><b className={attribute ? attributeClass(attribute.value) : ''}>{attribute?.value ?? '—'}</b><small className={delta && delta > 0 ? 'up' : delta && delta < 0 ? 'down' : ''}>{delta === null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`}</small></div> })}</section>)}</div></section>
    </div> : <p>Este jogador ainda não possui snapshots.</p>}
  </div>
}

function StatContext({stat}:{stat:PlayerStat}){
  const sample=statsSample(stat.minutes),metrics=statMetricEntries(stat,8)
  return <section className="player-stat-context"><header><div><strong>{statContextLabel(stat)}</strong><small>{stat.snapshot_date}</small></div><span title="Confidence representa somente tamanho da amostra por minutos">{sample.label} · {Math.round(sample.confidence*100)}%</span></header><div className="stat-basics"><Info label="Minutos" value={stat.minutes}/><Info label="Partidas" value={stat.appearances}/><Info label="Titular" value={stat.starts}/><Info label="Reserva" value={stat.sub_appearances}/></div>{metrics.length?<div className="stat-metrics">{metrics.map(metric=><div key={metric.key}><small>{metric.label}</small><strong>{formatStat(metric.value)}</strong></div>)}</div>:<small>Nenhuma métrica adicional normalizada neste registro.</small>}</section>
}
function formatStat(value:unknown){if(typeof value==='number')return value.toLocaleString('pt-BR',{maximumFractionDigits:2});const parsed=typeof value==='string'?Number(value.replace(',','.')):NaN;return Number.isFinite(parsed)?parsed.toLocaleString('pt-BR',{maximumFractionDigits:2}):String(value)}
function formatScore(value:number|null){return value===null?'—':value.toLocaleString('pt-BR',{maximumFractionDigits:2})}
function attributeLabel(key:string){return ATTRIBUTE_CATALOG.find(item=>item.key===key)?.label??key.replace(/_/g,' ')}
function field(snapshot: Snapshot, key: string) { const value = snapshot.normalized_data?.[key] ?? Object.entries(snapshot.raw_data ?? {}).find(([label]) => label.toLowerCase().replace(/\W/g, '_').includes(key))?.[1]; return value == null ? '—' : String(value) }
function Info({ label, value }: { label: string; value: unknown }) { return <div><small>{label}</small><strong>{value == null || value === '' ? '—' : String(value)}</strong></div> }
function attributeClass(value: number) { return value >= 15 ? 'attribute-high' : value >= 10 ? 'attribute-mid' : 'attribute-low' }
function FeetInfo({ snapshot }: { snapshot: Snapshot }) { const preferred = String(snapshot.preferred_foot || field(snapshot, 'preferred_foot')); const right = footValue(snapshot, 'right') || (preferred.toLowerCase().includes('right') ? 'Preferido' : '—'); const left = footValue(snapshot, 'left') || (preferred.toLowerCase().includes('left') ? 'Preferido' : '—'); return <div className="feet-info"><small>Proficiência dos pés</small><span><b>DIR</b><strong>{right}</strong><b>ESQ</b><strong>{left}</strong></span></div> }
function footValue(snapshot: Snapshot, side: 'right' | 'left') { const direct = snapshot.normalized_data?.[`${side}_foot`], feet = snapshot.normalized_data?.feet; if (typeof direct === 'number') return footRating(direct); if (feet && typeof feet === 'object' && !Array.isArray(feet)) { const value = isRecord(feet) ? feet[side] : null; if (typeof value === 'number') return footRating(value) } const aliases = side === 'right' ? ['right_foot', 'pe_direito', 'pé_direito'] : ['left_foot', 'pe_esquerdo', 'pé_esquerdo'], entries = Object.entries({ ...snapshot.raw_data, ...snapshot.normalized_data }); for (const [key, value] of entries) { const normalized = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_'); if (aliases.some(alias => normalized.includes(alias.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) && value != null && String(value).trim()) { const numeric = Number(value); return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? footRating(numeric) : String(value) } } return null }
function footRating(value: number) { const label = value <= 4 ? 'Very Weak' : value <= 7 ? 'Weak' : value <= 11 ? 'Reasonable' : value <= 14 ? 'Fairly Strong' : value <= 17 ? 'Strong' : 'Very Strong'; return `${value} · ${label}` }
