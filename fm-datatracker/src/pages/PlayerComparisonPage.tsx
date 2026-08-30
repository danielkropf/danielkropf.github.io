import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ScoreBadge } from '../components/ScoreBadge'
import { useSaves } from '../features/saves/SaveContext'
import { BASE_POSITION_DEFINITIONS } from '../lib/base-position-score'
import { loadCurrentPlayers } from '../lib/dataCache'
import { loadModelConfig } from '../lib/model-config'
import {
  comparisonAttributeRows,
  comparisonMetricLabel,
  firstRoleCode,
  resolveComparisonScore,
  type ComparisonMetric,
  type ComparisonSnapshot,
  type RoleWeightOverrides,
} from '../lib/player-comparison'
import { loadPlayerStats, statContextLabel, statMetricEntries, statsSample } from '../lib/player-stats'
import { rolesFor, type TacticPhase } from '../lib/tactics'
import type { PlayerRow, PlayerStat } from '../types/domain'

type ModelConfigLite = { role_weight_overrides?: RoleWeightOverrides }
type PageState =
  | { status: 'loading' }
  | { status: 'data'; players: PlayerRow[]; overrides: RoleWeightOverrides }
  | { status: 'error'; message: string }

const POSITIONS = BASE_POSITION_DEFINITIONS.map(definition => definition.position)

function latest(player: PlayerRow | null | undefined) {
  return player?.player_snapshots[0] as ComparisonSnapshot | undefined
}

function roleCodeFor(position: string, phase: TacticPhase, requested: string | null) {
  const options = rolesFor(position, phase)
  return options.some(([code]) => code === requested) ? requested! : firstRoleCode(position, phase)
}

export function PlayerComparisonPage() {
  const { selected } = useSaves()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [stats, setStats] = useState<Record<string, PlayerStat[]>>({})

  useEffect(() => {
    let active = true
    if (!selected) {
      setState({ status: 'error', message: 'Nenhum save ativo.' })
      return () => { active = false }
    }
    setState({ status: 'loading' })
    void Promise.all([loadCurrentPlayers(selected.id), loadModelConfig(selected.id)])
      .then(([players, model]) => {
        if (!active) return
        setState({
          status: 'data',
          players: (players as unknown as PlayerRow[]).slice().sort((a, b) => a.current_name.localeCompare(b.current_name, 'pt-BR')),
          overrides: ((model as ModelConfigLite).role_weight_overrides ?? {}),
        })
      })
      .catch(error => {
        if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Falha ao carregar jogadores para comparação.' })
      })
    return () => { active = false }
  }, [selected?.id])

  const players = state.status === 'data' ? state.players : []
  const overrides = state.status === 'data' ? state.overrides : {}
  const leftId = params.get('a') ?? ''
  const rightId = params.get('b') ?? ''
  const leftPlayer = players.find(player => player.id === leftId) ?? null
  const rightPlayer = players.find(player => player.id === rightId) ?? null
  const leftSnapshot = latest(leftPlayer)
  const rightSnapshot = latest(rightPlayer)

  useEffect(() => {
    let active = true
    if (!selected) return () => { active = false }
    const ids = [...new Set([leftId, rightId].filter(Boolean))]
    if (!ids.length) {
      setStats({})
      return () => { active = false }
    }
    void Promise.all(ids.map(async id => [id, await loadPlayerStats(selected.id, id)] as const))
      .then(entries => { if (active) setStats(Object.fromEntries(entries)) })
      .catch(() => { if (active) setStats({}) })
    return () => { active = false }
  }, [selected?.id, leftId, rightId])

  const requestedMetric = params.get('metric')
  const kind: 'general' | 'base' | 'role' | 'pair' = requestedMetric === 'base' || requestedMetric === 'role' || requestedMetric === 'pair' ? requestedMetric : 'general'
  const position = POSITIONS.includes(params.get('position') ?? '') ? params.get('position')! : 'M (C)'
  const phase: TacticPhase = params.get('phase') === 'OOP' ? 'OOP' : 'IP'
  const roleCode = roleCodeFor(position, phase, params.get('role'))
  const ipPosition = POSITIONS.includes(params.get('ipPosition') ?? '') ? params.get('ipPosition')! : position
  const oopPosition = POSITIONS.includes(params.get('oopPosition') ?? '') ? params.get('oopPosition')! : ipPosition
  const ipRole = roleCodeFor(ipPosition, 'IP', params.get('ipRole'))
  const oopRole = roleCodeFor(oopPosition, 'OOP', params.get('oopRole'))

  const metric = useMemo<ComparisonMetric>(() => {
    if (kind === 'base') return { kind: 'base', position }
    if (kind === 'role') return { kind: 'role', phase, position, roleCode }
    if (kind === 'pair') return { kind: 'pair', ip: { position: ipPosition, roleCode: ipRole }, oop: { position: oopPosition, roleCode: oopRole } }
    return { kind: 'general' }
  }, [kind, position, phase, roleCode, ipPosition, ipRole, oopPosition, oopRole])

  const leftResult = useMemo(() => resolveComparisonScore(leftSnapshot, metric, overrides), [leftSnapshot, metric, overrides])
  const rightResult = useMemo(() => resolveComparisonScore(rightSnapshot, metric, overrides), [rightSnapshot, metric, overrides])
  const attributeRows = useMemo(() => comparisonAttributeRows(leftSnapshot, rightSnapshot, metric, overrides), [leftSnapshot, rightSnapshot, metric, overrides])
  const delta = leftResult?.score != null && rightResult?.score != null ? leftResult.score - rightResult.score : null

  function patch(next: Record<string, string | null>, replace = true) {
    const updated = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value)
      else updated.delete(key)
    }
    setParams(updated, { replace })
  }

  function choosePlayer(side: 'a' | 'b', id: string) {
    const other = side === 'a' ? rightId : leftId
    const changes: Record<string, string | null> = { [side]: id || null }
    if (id && id === other) changes[side === 'a' ? 'b' : 'a'] = null
    patch(changes)
  }

  function swap() {
    patch({ a: rightId || null, b: leftId || null }, false)
  }

  function changeMetric(next: string) {
    patch({ metric: next === 'general' ? null : next })
  }

  if (state.status === 'loading') return <div className="screen-page player-comparison-page"><p>Carregando comparador…</p></div>
  if (state.status === 'error') return <div className="screen-page player-comparison-page"><p className="warning">Não foi possível abrir o comparador: {state.message}</p></div>

  return <div className="screen-page player-comparison-page">
    <div className="title-row comparison-title-row">
      <div>
        <span className="eyebrow">ANALYZER</span>
        <h1>Comparar jogadores</h1>
        <p>Escolha dois jogadores e fixe uma única métrica. A mesma fórmula e a mesma matriz são aplicadas aos dois lados.</p>
      </div>
    </div>

    <section className="card comparison-controls">
      <div className="comparison-player-select">
        <label htmlFor="compare-a">Jogador A</label>
        <select id="compare-a" value={leftId} onChange={(event: { target: { value: string } }) => choosePlayer('a', event.target.value)}>
          <option value="">Selecionar jogador…</option>
          {players.map(player => <option key={player.id} value={player.id} disabled={player.id === rightId}>{player.current_name}</option>)}
        </select>
      </div>
      <button type="button" className="ghost comparison-swap" onClick={swap} disabled={!leftId && !rightId} title="Trocar lados">⇄</button>
      <div className="comparison-player-select">
        <label htmlFor="compare-b">Jogador B</label>
        <select id="compare-b" value={rightId} onChange={(event: { target: { value: string } }) => choosePlayer('b', event.target.value)}>
          <option value="">Selecionar jogador…</option>
          {players.map(player => <option key={player.id} value={player.id} disabled={player.id === leftId}>{player.current_name}</option>)}
        </select>
      </div>
      <div className="comparison-metric-select">
        <label htmlFor="compare-metric">Métrica</label>
        <select id="compare-metric" value={kind} onChange={(event: { target: { value: string } }) => changeMetric(event.target.value)}>
          <option value="general">Nota Geral</option>
          <option value="base">Posição-base</option>
          <option value="role">Função em uma fase</option>
          <option value="pair">Par IP ↔ OOP</option>
        </select>
      </div>
    </section>

    {kind !== 'general' && <section className="card comparison-context-controls">
      {kind === 'base' && <ControlSelect label="Posição" value={position} options={POSITIONS.map(value => [value, value])} onChange={value => patch({ position: value })} />}
      {kind === 'role' && <>
        <ControlSelect label="Fase" value={phase} options={[['IP', 'IP · Com a bola'], ['OOP', 'OOP · Sem a bola']]} onChange={value => {
          const nextPhase = value as TacticPhase
          patch({ phase: nextPhase === 'IP' ? null : nextPhase, role: firstRoleCode(position, nextPhase) })
        }} />
        <ControlSelect label="Posição" value={position} options={POSITIONS.map(value => [value, value])} onChange={value => patch({ position: value, role: firstRoleCode(value, phase) })} />
        <ControlSelect label="Função" value={roleCode} options={rolesFor(position, phase).map(([code, name]) => [code, `${code} · ${name}`])} onChange={value => patch({ role: value })} />
      </>}
      {kind === 'pair' && <>
        <div className="comparison-phase-group"><strong>IP</strong>
          <ControlSelect label="Posição" value={ipPosition} options={POSITIONS.map(value => [value, value])} onChange={value => patch({ ipPosition: value, ipRole: firstRoleCode(value, 'IP') })} />
          <ControlSelect label="Função" value={ipRole} options={rolesFor(ipPosition, 'IP').map(([code, name]) => [code, `${code} · ${name}`])} onChange={value => patch({ ipRole: value })} />
        </div>
        <div className="comparison-phase-group"><strong>OOP</strong>
          <ControlSelect label="Posição" value={oopPosition} options={POSITIONS.map(value => [value, value])} onChange={value => patch({ oopPosition: value, oopRole: firstRoleCode(value, 'OOP') })} />
          <ControlSelect label="Função" value={oopRole} options={rolesFor(oopPosition, 'OOP').map(([code, name]) => [code, `${code} · ${name}`])} onChange={value => patch({ oopRole: value })} />
        </div>
      </>}
    </section>}

    <section className="comparison-metric-contract">
      <strong>{comparisonMetricLabel(metric)}</strong>
      <span>{kind === 'general'
        ? 'Cada lado usa seu melhor BasePositionScore elegível. Para uma comparação atributo por atributo estritamente like-for-like, escolha posição-base ou função.'
        : 'A matriz escolhida é idêntica nos dois lados. Familiaridade é mostrada separadamente e não multiplica nem bloqueia RoleScore.'}</span>
    </section>

    <section className="comparison-scoreboard">
      <PlayerSide player={leftPlayer} snapshot={leftSnapshot} result={leftResult} side="A" />
      <div className={`comparison-delta ${delta === null ? '' : delta > 0 ? 'left-wins' : delta < 0 ? 'right-wins' : 'tie'}`}>
        <small>Diferença A − B</small>
        <strong>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`}</strong>
        <span>{delta === null ? 'Selecione dois jogadores.' : Math.abs(delta) < .005 ? 'Empate nesta métrica' : delta > 0 ? 'A tem a nota maior' : 'B tem a nota maior'}</span>
      </div>
      <PlayerSide player={rightPlayer} snapshot={rightSnapshot} result={rightResult} side="B" />
    </section>

    {leftPlayer && rightPlayer && <section className="card comparison-explanation">
      <header><div><span className="eyebrow">POR QUÊ</span><h2>Diferenças relevantes na matriz</h2></div></header>
      {kind === 'general'
        ? <div className="comparison-general-note"><p>A Nota Geral é a mesma métrica nos dois lados, mas pode nascer de posições-base diferentes. Por isso o comparador não inventa uma matriz comum para justificar a diferença.</p><p>Escolha <b>Posição-base</b>, <b>Função em uma fase</b> ou <b>Par IP ↔ OOP</b> para obter uma comparação atributo por atributo usando exatamente os mesmos pesos.</p></div>
        : attributeRows.length
          ? <div className="comparison-attribute-table-wrap"><table className="comparison-attribute-table"><thead><tr><th>Atributo</th><th>{leftPlayer.current_name}</th><th>{rightPlayer.current_name}</th><th>Δ A−B</th><th>IP</th><th>OOP</th></tr></thead><tbody>{attributeRows.slice(0, 20).map(row => <tr key={row.key}><td>{row.label}</td><td>{row.left ?? '—'}</td><td>{row.right ?? '—'}</td><td className={row.delta == null || row.delta === 0 ? '' : row.delta > 0 ? 'advantage-a' : 'advantage-b'}>{row.delta == null || row.delta === 0 ? '—' : `${row.delta > 0 ? '+' : ''}${row.delta}`}</td><td>{row.ipWeight ?? '—'}</td><td>{row.oopWeight ?? '—'}</td></tr>)}</tbody></table><p className="comparison-method-note">A ordem prioriza atributos usados pela matriz e diferenças maiores entre os jogadores. Isso serve para explicar a evidência; não é uma decomposição aditiva exata do score, especialmente quando IP/OOP são combinados geometricamente.</p></div>
          : <p className="notice">Não há atributos suficientes para explicar esta comparação.</p>}
    </section>}

    <section className="comparison-stats-grid">
      <StatsSide title={leftPlayer?.current_name ?? 'Jogador A'} stat={leftId ? stats[leftId]?.[0] : undefined} />
      <StatsSide title={rightPlayer?.current_name ?? 'Jogador B'} stat={rightId ? stats[rightId]?.[0] : undefined} />
    </section>
    <p className="performance-contract comparison-performance-contract">Cada lado mostra apenas o contexto estatístico mais recente disponível. Contextos diferentes não são tratados como equivalentes: o comparador não agrega competições, não declara vencedor por stats e não calcula PerformanceScore.</p>
  </div>
}

function ControlSelect({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void }) {
  return <label className="comparison-control"><span>{label}</span><select value={value} onChange={(event: { target: { value: string } }) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option value={optionValue} key={optionValue}>{optionLabel}</option>)}</select></label>
}

function PlayerSide({ player, snapshot, result, side }: { player: PlayerRow | null; snapshot: ComparisonSnapshot | undefined; result: ReturnType<typeof resolveComparisonScore>; side: 'A' | 'B' }) {
  return <article className={`card comparison-player-card comparison-player-${side.toLowerCase()}`}>
    <header><span className="comparison-side-label">Jogador {side}</span>{result ? <ScoreBadge value={result.score} showTitle={false} /> : null}</header>
    {player && snapshot ? <>
      <h2><Link to={`/players/${player.id}`}>{player.current_name}</Link></h2>
      <p>{snapshot.age ?? '—'} anos · {snapshot.club || snapshot.squad || 'Equipe desconhecida'}</p>
      <small>{snapshot.positions.join(', ') || 'Sem posição'} · snapshot {snapshot.snapshot_date || '—'}</small>
      <div className="comparison-score-detail"><strong>{result?.score == null ? '—' : result.score.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong><span>{result?.detail ?? 'Sem nota calculável'}</span>{result && (result.ipScore !== null || result.oopScore !== null) && <small>IP {formatScore(result.ipScore)} · OOP {formatScore(result.oopScore)}</small>}</div>
      {result?.familiarity.length ? <div className="comparison-familiarity">{result.familiarity.map(item => <span key={item.position} className={item.familiar ? 'is-familiar' : 'is-unfamiliar'}>{item.position}: {item.familiar ? 'familiar' : 'sem familiaridade'}</span>)}</div> : null}
    </> : <div className="comparison-empty-player"><strong>Selecione o jogador {side}</strong><p>O comparador usa o snapshot mais recente do save ativo.</p></div>}
  </article>
}

function StatsSide({ title, stat }: { title: string; stat: PlayerStat | undefined }) {
  if (!stat) return <article className="card comparison-stats-card"><header><div><span className="eyebrow">EVIDÊNCIA OBSERVADA</span><h2>{title}</h2></div></header><div className="stats-empty"><strong>Sem estatísticas</strong><p>Nenhum contexto estatístico disponível para este jogador.</p></div></article>
  const sample = statsSample(stat.minutes)
  const metrics = statMetricEntries(stat, 6)
  return <article className="card comparison-stats-card">
    <header><div><span className="eyebrow">EVIDÊNCIA OBSERVADA</span><h2>{title}</h2></div><span title="Confidence representa somente tamanho da amostra por minutos">{sample.label} · {Math.round(sample.confidence * 100)}%</span></header>
    <strong>{statContextLabel(stat)}</strong><small>{stat.snapshot_date}</small>
    <div className="comparison-stat-basics"><Info label="Minutos" value={stat.minutes} /><Info label="Partidas" value={stat.appearances} /><Info label="Titular" value={stat.starts} /><Info label="Reserva" value={stat.sub_appearances} /></div>
    {metrics.length ? <div className="comparison-stat-metrics">{metrics.map(metric => <Info key={metric.key} label={metric.label} value={formatStat(metric.value)} />)}</div> : <p>Nenhuma métrica adicional normalizada.</p>}
  </article>
}

function Info({ label, value }: { label: string; value: unknown }) {
  return <div><small>{label}</small><strong>{value == null || value === '' ? '—' : String(value)}</strong></div>
}

function formatScore(value: number | null) {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function formatStat(value: unknown) {
  if (typeof value === 'number') return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : NaN
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : String(value)
}
