import '../player-profile.css'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ATTRIBUTE_CATALOG } from '../lib/attributes'
import { useSaves } from '../features/saves/SaveContext'
import { basePositionScores, generalScoreForSnapshot } from '../lib/base-position-score'
import { explainBasePositionScore } from '../lib/score-explanation'
import { loadPlayerStats, statContextLabel, statMetricEntries, statsSample } from '../lib/player-stats'
import { loadPlayerEvolutionContext, type PlayerEvolutionContextData } from '../lib/longitudinal-service'
import { loadPlayerSaveEvents, type PlayerSaveEventData } from '../lib/player-trajectory-service'
import { loadPlayerSnapshots, loadCurrentPlayers, loadReferenceDataset } from '../lib/dataCache'
import { formatCheckpointDate, resolveSameDateSnapshotGroup } from '../lib/current-checkpoint'
import { resolveCurrentSnapshotMembership } from '../lib/planning-membership'
import { generalReferencePercentile, generalReferenceScoresByFamily, normalizeCountry, referenceLevel, type ReferenceDataset } from '../lib/reference'
import { ScoreBadge } from '../components/ScoreBadge'
import { PlayerEvolutionSection } from '../components/PlayerEvolutionSection'
import { PlayerPerformanceHistorySection } from '../components/PlayerPerformanceHistorySection'
import { PlayerTrajectorySection } from '../components/PlayerTrajectorySection'
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
  source_snapshot_ids?: string[]
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
  | { status: 'data'; player: Player; stats: PlayerStat[]; reference: ReferenceDataset | null; evolutionContext: PlayerEvolutionContextData; saveEvents: PlayerSaveEventData }
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

function reconcileHistory(snapshots: Snapshot[]): Snapshot[] {
  const byDate = new Map<string, Snapshot[]>()
  for (const snapshot of snapshots) byDate.set(snapshot.snapshot_date, [...(byDate.get(snapshot.snapshot_date) ?? []), snapshot])
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([date, rows]) => {
      const merged = resolveSameDateSnapshotGroup(rows, date)
      return merged ? [merged as Snapshot] : []
    })
}

export function PlayerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { selected, currentCheckpoint } = useSaves()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [index, setIndex] = useState(-1)
  const [section, setSection] = useState('summary')
  const [compareMode, setCompareMode] = useState('previous')
  const checkpointDate = selected && currentCheckpoint?.saveId === selected.id && currentCheckpoint.status === 'ready' ? currentCheckpoint.date : null

  useEffect(() => {
    let active = true
    setIndex(-1)
    setSection('summary')
    setState({ status: 'loading' })

    if (!supabase) { setState({ status: 'error', message: 'Banco Mestre não configurado.' }); return () => { active = false } }
    if (!id || !selected) { setState({ status: 'not-found' }); return () => { active = false } }
    const client = supabase

    void (async () => {
      const [identityResult, historySnapshots, stats, reference, evolutionContext, saveEvents, currentPortrait] = await Promise.all([
        client.from('players')
          .select('id,fm_player_id,current_name,nationality,date_of_birth,first_seen_date,last_seen_date,is_active')
          .eq('id', id).eq('save_id', selected.id).maybeSingle(),
        loadPlayerSnapshots(selected.id, id),
        loadPlayerStats(selected.id, id),
        loadReferenceDataset().catch(() => null),
        loadPlayerEvolutionContext(selected.id, id),
        loadPlayerSaveEvents(selected.id, id),
        checkpointDate ? loadCurrentPlayers(selected.id) : Promise.resolve([]),
      ])
      if (!active) return
      const playerResult = { ...identityResult, data: identityResult.data ? { ...identityResult.data, player_snapshots: historySnapshots } : null }
      if (playerResult.error) { setState({ status: 'error', message: playerResult.error.message }); return }
      if (!playerResult.data) { setState({ status: 'not-found' }); return }
      if (!isPlayer(playerResult.data)) { setState({ status: 'error', message: 'O Banco Mestre retornou uma ficha de jogador em formato inesperado.' }); return }

      let snapshots = reconcileHistory(playerResult.data.player_snapshots)
      const exactCurrent = currentPortrait.find(candidate => candidate.id === id)?.player_snapshots[0] as Snapshot | undefined
      if (checkpointDate && exactCurrent?.snapshot_date === checkpointDate) {
        snapshots = [...snapshots.filter(snapshot => snapshot.snapshot_date !== checkpointDate), exactCurrent].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      }
      const player: Player = { ...playerResult.data, player_snapshots: snapshots }
      setState({ status: 'data', player, stats, reference, evolutionContext, saveEvents })
      setIndex(checkpointDate ? snapshots.findIndex(snapshot => snapshot.snapshot_date === checkpointDate) : -1)
    })().catch(cause => { if (active) setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Falha inesperada ao carregar a ficha do jogador.' }) })

    return () => { active = false }
  }, [id, selected?.id, checkpointDate])

  const player = state.status === 'data' ? state.player : null
  const stats = state.status === 'data' ? state.stats : []
  const reference = state.status === 'data' ? state.reference : null
  const evolutionContext = state.status === 'data' ? state.evolutionContext : null
  const saveEvents = state.status === 'data' ? state.saveEvents : null
  const snapshots = player?.player_snapshots ?? []
  const current = index >= 0 ? snapshots[index] : undefined
  const membershipResolution = useMemo(() => resolveCurrentSnapshotMembership(
    evolutionContext?.memberships ?? [],
    current?.source_snapshot_ids?.length ? current.source_snapshot_ids : current?.id,
  ), [current, evolutionContext?.memberships])
  const compareIndex = useMemo(() => index < 0 ? -1 : compareMode === 'previous' ? Math.max(0, index - 1) : compareMode === 'oldest' ? 0 : Number(compareMode), [compareMode, index])
  const comparison = compareIndex >= 0 ? snapshots[compareIndex] : undefined
  const isHistoricalView = Boolean(current && current.snapshot_date !== checkpointDate)
  const lastConfirmedIndex = snapshots.length ? snapshots.length - 1 : -1

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

  const sections = [['summary', 'Resumo'], ['attributes', 'Atributos'], ['evolution', 'Evolução'], ['performance', 'Desempenho'], ['career', 'Carreira']] as const
  const currentStats = current ? stats.filter(stat => stat.snapshot_date === current.snapshot_date) : []
  return <div className="screen-page player-page player-profile">
    <header className="profile-header">
      <div className="profile-identity"><button className="back-button" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/squad')}>← Voltar</button><div><span className="eyebrow">FICHA DO JOGADOR</span><h1>{player.current_name}</h1><p>{[current?.age != null ? `${current.age} anos` : null, player.nationality, current?.positions?.join(', ')].filter(Boolean).join(' · ') || 'Informações pessoais indisponíveis'}</p></div></div>
      <label className="profile-date">Dados de<select aria-label="Data da observação" value={index} onChange={event => { const next = Number(event.target.value); setIndex(next < 0 ? snapshots.findIndex(snapshot => snapshot.snapshot_date === checkpointDate) : next) }}><option value={-1}>Atual · {formatCheckpointDate(checkpointDate) ?? 'sem data'}</option>{snapshots.map((snapshot, i) => <option key={snapshot.id} value={i}>{formatCheckpointDate(snapshot.snapshot_date) ?? snapshot.snapshot_date}{snapshot.snapshot_date === checkpointDate ? ' · atual' : ''}</option>)}</select></label>
    </header>
    {isHistoricalView && <p className="notice profile-history-notice">Você está vendo {formatCheckpointDate(current?.snapshot_date ?? null) ?? current?.snapshot_date}. A data atual do save continua {formatCheckpointDate(checkpointDate) ?? 'indisponível'}.</p>}
    <nav className="profile-navigation" aria-label="Seções do jogador">{sections.map(([key, label]) => <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)}>{label}</button>)}</nav>
    <div className="player-page-body profile-content" key={section}>
      {section === 'summary' && <>
        {!current ? <section className="card"><h2>Sem observação na data atual</h2><p>{checkpointDate ? `Não há dados deste jogador em ${formatCheckpointDate(checkpointDate)}.` : 'A data atual deste save ainda não está disponível.'}</p>{lastConfirmedIndex >= 0 && <button className="ghost button" onClick={() => setIndex(lastConfirmedIndex)}>Ver última observação · {formatCheckpointDate(snapshots[lastConfirmedIndex].snapshot_date)}</button>}</section> : <>
          <div className="profile-overview">
            <section className="card profile-quality"><span className="eyebrow">AVALIAÇÃO POR ATRIBUTOS</span><h2>{isHistoricalView ? 'Qualidade nesta data' : 'Qualidade atual'}</h2>
              <div className="profile-score"><strong>{analysis?.general ? formatScore(analysis.general.score) : '—'}</strong><div><b>Nota geral</b><span>{analysis?.general?.position ?? 'Atributos insuficientes'}</span></div></div>
              <p>Avaliação calculada pelos atributos do jogador.</p>
              {analysis?.reference && <p className="profile-reference"><strong>{analysis.reference.level}</strong><span>Percentil {analysis.reference.percentile} na referência de {analysis.reference.country} · {analysis.reference.division}ª divisão</span></p>}
              <button className="ghost button" onClick={() => setSection('attributes')}>Ver atributos e comparação →</button>
            </section>
            <FactualMembershipCard resolution={membershipResolution} historical={isHistoricalView} contractExpiry={current.contract_expiry} />
          </div>
          <div className="profile-overview">
            <section className="card"><header><h2>Posições e avaliação</h2></header>{analysis?.bases.length ? <div className="base-position-list">{analysis.bases.map(item => <div key={`${item.scoreKey}-${item.family}`}><span>{item.position}</span><ScoreBadge value={item.score} showTitle={false} /></div>)}</div> : <p>Sem atributos suficientes para avaliar as posições.</p>}</section>
            <section className="card"><header><h2>Perfil</h2></header><div className="profile-facts"><FeetInfo snapshot={current} /><Info label="Altura" value={current.height ? `${current.height} cm` : field(current, 'height')} /><Info label="Peso" value={current.weight ? `${current.weight} kg` : field(current, 'weight')} /><Info label="Nascimento" value={formatCheckpointDate(player.date_of_birth)} /></div></section>
          </div>
          <details className="card profile-method"><summary>Como a avaliação é calculada</summary>{analysis?.explanation ? <><p>Matriz: {analysis.explanation.roleName}. Com bola: {formatScore(analysis.explanation.ipScore)}. Sem bola: {formatScore(analysis.explanation.oopScore)}. A nota combina essas avaliações pela fórmula geométrica.</p><div className="score-evidence-attributes">{analysis.explanation.attributes.slice(0,6).map(item => <span key={item.key}><b>{attributeLabel(item.key)}</b><strong>{item.value}</strong><small>Pesos: com bola {item.ipWeight} · sem bola {item.oopWeight}</small></span>)}</div></> : <p>Sem atributos suficientes para explicar a avaliação.</p>}<p>Estatísticas de partidas não entram na nota. O percentil compara o jogador com a base de referência, não representa potencial futuro.</p>{analysis?.reference && <p>Referência: {analysis.reference.sample} jogadores · grupo {analysis.reference.family}.</p>}<Info label="ID do FM" value={player.fm_player_id} /></details>
        </>}
      </>}
      {section === 'attributes' && (current ? <section className="card player-attributes-panel"><header><div><span className="eyebrow">ATRIBUTOS</span><h2>{current.snapshot_date}{isHistoricalView ? ' · histórico' : ' · atual'}</h2></div><label>Comparar com<select value={compareMode} disabled={snapshots.length <= 1} onChange={event => setCompareMode(event.target.value)}><option value="previous">Observação anterior</option><option value="oldest">Primeira observação</option>{snapshots.map((snapshot, snapshotIndex) => <option value={snapshotIndex} key={snapshot.id}>{snapshot.snapshot_date}</option>)}</select></label></header><div className="player-attribute-groups">{(['technical', 'mental', 'physical', 'goalkeeping'] as const).map(category => <section key={category}><h3>{{ technical: 'Técnico', mental: 'Mental', physical: 'Físico', goalkeeping: 'Goleiro' }[category]}</h3>{ATTRIBUTE_CATALOG.filter(attribute => attribute.category === category).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')).map(definition => { const attribute = current.player_attributes.find(item => item.attribute_key === definition.key); const old = comparison?.player_attributes.find(item => item.attribute_key === definition.key); const delta = attribute && old ? attribute.value - old.value : null; return <div className="player-attribute-row" key={definition.key}><span>{attribute?.attribute_label ?? definition.label}</span><b className={attribute ? attributeClass(attribute.value) : ''}>{attribute?.value ?? '—'}</b><small className={delta && delta > 0 ? 'up' : delta && delta < 0 ? 'down' : ''}>{delta === null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`}</small></div> })}</section>)}</div></section> : <section className="card"><h2>Atributos indisponíveis nesta data</h2><p>Selecione uma observação no controle de data para consultar os atributos registrados.</p></section>)}
      {section === 'evolution' && <PlayerEvolutionSection snapshots={snapshots} memberships={evolutionContext?.memberships} seasons={evolutionContext?.seasons} contextDiagnostic={evolutionContext?.diagnostic} />}
      {section === 'performance' && <>
        <section className="card player-performance-evidence"><header><h2>Desempenho na data selecionada</h2></header>{currentStats.length ? <div className="player-stat-contexts">{currentStats.map(stat => <StatContext stat={stat} key={stat.id} />)}</div> : <p>Sem estatísticas registradas para esta data. Consulte abaixo as outras observações disponíveis.</p>}</section>
        <PlayerPerformanceHistorySection stats={stats} />
      </>}
      {section === 'career' && <><section className="card"><h2>Carreira e origem</h2><p>Consulte os clubes e eventos registrados ao longo do save.</p><details><summary>Sobre a identificação de youth intake</summary><p>A identificação automática de origem pelo intake ainda está em pesquisa. Idade, presença na base ou um vínculo de teste não bastam para confirmar a turma do jogador.</p></details></section><PlayerTrajectorySection memberships={evolutionContext?.memberships} events={saveEvents?.events} eventsDiagnostic={saveEvents?.diagnostic} /></>}
    </div>
  </div>
}

function FactualMembershipCard({ resolution, historical, contractExpiry }: { resolution: ReturnType<typeof resolveCurrentSnapshotMembership>; historical: boolean; contractExpiry: string | null }) {
  const membership = resolution.membership
  const clubLabel = (id: string | null, name: string | null | undefined) => name ?? (id ? 'Nome indisponível' : 'Não identificado')
  const teamLabel = membership?.squad_name?.trim() || (membership?.team_level && membership.team_level !== 'unknown' ? ({ first_team: 'Principal', reserve: 'Reserva/B', academy: 'Base', other: 'Outro elenco' } as const)[membership.team_level] : 'Não identificado')
  const loanLabel = membership?.is_loan === true ? 'Emprestado' : membership?.is_loan === false ? 'Não está emprestado' : 'Não identificado'
  return <section className="card profile-membership"><span className="eyebrow">CLUBE E CONTRATO</span><h2>{historical ? 'Situação nesta data' : 'Situação atual'}</h2>
    <div className="profile-facts">
      <Info label="Clube atual" value={membership ? clubLabel(membership.current_club_id, membership.currentClub?.name) : 'Não identificado'} />
      <Info label="Elenco" value={teamLabel} />
      <Info label="Fim do contrato" value={formatCheckpointDate(contractExpiry)} />
      <Info label="Empréstimo" value={loanLabel} />
      {membership?.owner_club_id && <Info label="Clube do contrato" value={clubLabel(membership.owner_club_id, membership.ownerClub?.name)} />}
      {membership?.is_loan === true && <><Info label="Clube que cede" value={clubLabel(membership.loan_from_club_id, membership.loanFromClub?.name)} /><Info label="Clube que recebe" value={clubLabel(membership.loan_to_club_id, membership.loanToClub?.name)} /></>}
    </div>
    {(!membership || resolution.diagnostic) && <details className="profile-method"><summary>Disponibilidade dos vínculos</summary><p>{resolution.diagnostic ?? 'Ainda não foi possível identificar o vínculo nesta observação.'}</p></details>}
  </section>
}

function StatContext({stat}:{stat:PlayerStat}){
  const sample=statsSample(stat.minutes),metrics=statMetricEntries(stat,8)
  return <section className="player-stat-context"><header><div><strong>{statContextLabel(stat)}</strong><small>{stat.snapshot_date}</small></div><span title="Tamanho da amostra calculado pelos minutos jogados">{sample.label}</span></header><div className="stat-basics"><Info label="Minutos" value={stat.minutes}/><Info label="Partidas" value={stat.appearances}/><Info label="Titular" value={stat.starts}/><Info label="Reserva" value={stat.sub_appearances}/></div>{metrics.length?<div className="stat-metrics">{metrics.map(metric=><div key={metric.key}><small>{metric.label}</small><strong>{formatStat(metric.value)}</strong></div>)}</div>:<small>Nenhuma métrica adicional normalizada neste registro.</small>}</section>
}
function formatStat(value:unknown){if(typeof value==='number')return value.toLocaleString('pt-BR',{maximumFractionDigits:2});const parsed=typeof value==='string'?Number(value.replace(',','.')):NaN;return Number.isFinite(parsed)?parsed.toLocaleString('pt-BR',{maximumFractionDigits:2}):String(value)}
function formatScore(value:number|null){return value===null?'—':value.toLocaleString('pt-BR',{maximumFractionDigits:2})}
function attributeLabel(key:string){return ATTRIBUTE_CATALOG.find(item=>item.key===key)?.label??key.replace(/_/g,' ')}
function field(snapshot: Snapshot, key: string) { const value = snapshot.normalized_data?.[key] ?? Object.entries(snapshot.raw_data ?? {}).find(([label]) => label.toLowerCase().replace(/\W/g, '_').includes(key))?.[1]; return value == null ? '—' : String(value) }
function Info({ label, value }: { label: string; value: unknown }) { return <div><small>{label}</small><strong>{value == null || value === '' ? '—' : String(value)}</strong></div> }
function attributeClass(value: number) { return value >= 15 ? 'attribute-high' : value >= 10 ? 'attribute-mid' : 'attribute-low' }
function FeetInfo({ snapshot }: { snapshot: Snapshot }) { const preferred = String(snapshot.preferred_foot || field(snapshot, 'preferred_foot')); const right = footValue(snapshot, 'right') || (preferred.toLowerCase().includes('right') ? 'Preferido' : '—'); const left = footValue(snapshot, 'left') || (preferred.toLowerCase().includes('left') ? 'Preferido' : '—'); return <div className="feet-info"><small>Proficiência dos pés</small><span><b>DIR</b><strong>{right}</strong><b>ESQ</b><strong>{left}</strong></span></div> }
function footValue(snapshot: Snapshot, side: 'right' | 'left') { const direct = snapshot.normalized_data?.[`${side}_foot`], feet = snapshot.normalized_data?.feet; if (typeof direct === 'number') return footRating(direct); if (feet && typeof feet === 'object' && !Array.isArray(feet)) { const value = isRecord(feet) ? feet[side] : null; if (typeof value === 'number') return footRating(value) } const aliases = side === 'right' ? ['right_foot', 'pe_direito', 'pé_direito'] : ['left_foot', 'pe_esquerdo', 'pé_esquerdo'], entries = Object.entries({ ...snapshot.raw_data, ...snapshot.normalized_data }); for (const [key, value] of entries) { const normalized = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_'); if (aliases.some(alias => normalized.includes(alias.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) && value != null && String(value).trim()) { const numeric = Number(value); return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? footRating(numeric) : String(value) } } return null }
function footRating(value: number) { const label = value <= 4 ? 'Muito fraco' : value <= 7 ? 'Fraco' : value <= 11 ? 'Razoável' : value <= 14 ? 'Bom' : value <= 17 ? 'Forte' : 'Muito forte'; return `${value} · ${label}` }
