import { useEffect, useMemo, useState } from 'react'
import { ATTRIBUTE_CATALOG } from '../lib/attributes'
import {
  buildPlayerEvolution,
  compareEvolutionSnapshots,
  sortEvolutionSnapshots,
  type AttributeChange,
  type EvolutionCheckpoint,
  type EvolutionNormalizedContext,
  type EvolutionSnapshot,
} from '../lib/player-evolution'
import {
  EVOLUTION_DETAIL_PAGE_SIZE,
  evolutionRange,
  generalScoreSegments,
  paginateEvolution,
  type EvolutionPage,
} from '../lib/player-evolution-view'
import type { PlayerMembershipWithClubs, Season, TeamLevel } from '../types/domain'
import { ScoreBadge } from './ScoreBadge'
import '../player-evolution-rich.css'

type PlayerEvolutionSectionProps = {
  snapshots: EvolutionSnapshot[]
  memberships?: PlayerMembershipWithClubs[]
  seasons?: Season[]
  contextDiagnostic?: string | null
}

export function PlayerEvolutionSection({
  snapshots,
  memberships = [],
  seasons = [],
  contextDiagnostic = null,
}: PlayerEvolutionSectionProps) {
  const orderedSnapshots = useMemo(() => sortEvolutionSnapshots(snapshots), [snapshots])
  const [rangeFromSnapshotId, setRangeFromSnapshotId] = useState('')
  const [rangeToSnapshotId, setRangeToSnapshotId] = useState('')
  const [fromSnapshotId, setFromSnapshotId] = useState('')
  const [toSnapshotId, setToSnapshotId] = useState('')
  const [detailPage, setDetailPage] = useState(1)

  useEffect(() => {
    const firstId = orderedSnapshots[0]?.id ?? ''
    const lastId = orderedSnapshots.at(-1)?.id ?? ''
    setRangeFromSnapshotId(firstId)
    setRangeToSnapshotId(lastId)
    setFromSnapshotId(firstId)
    setToSnapshotId(lastId)
    setDetailPage(1)
  }, [orderedSnapshots])

  const selectedRange = useMemo(
    () => evolutionRange(orderedSnapshots, rangeFromSnapshotId, rangeToSnapshotId),
    [orderedSnapshots, rangeFromSnapshotId, rangeToSnapshotId],
  )

  useEffect(() => {
    if (!selectedRange.snapshots.length) return
    if (rangeFromSnapshotId !== selectedRange.normalizedFromId) setRangeFromSnapshotId(selectedRange.normalizedFromId)
    if (rangeToSnapshotId !== selectedRange.normalizedToId) setRangeToSnapshotId(selectedRange.normalizedToId)
  }, [rangeFromSnapshotId, rangeToSnapshotId, selectedRange])

  useEffect(() => {
    setDetailPage(1)
  }, [selectedRange.normalizedFromId, selectedRange.normalizedToId])

  const evolution = useMemo(
    () => buildPlayerEvolution(selectedRange.snapshots, memberships, seasons),
    [selectedRange.snapshots, memberships, seasons],
  )

  const detailPagination = useMemo(
    () => paginateEvolution(evolution.checkpoints, detailPage, EVOLUTION_DETAIL_PAGE_SIZE),
    [detailPage, evolution.checkpoints],
  )

  useEffect(() => {
    if (detailPage !== detailPagination.page) setDetailPage(detailPagination.page)
  }, [detailPage, detailPagination.page])

  const comparison = useMemo(() => {
    const from = orderedSnapshots.find(snapshot => snapshot.id === fromSnapshotId)
    const to = orderedSnapshots.find(snapshot => snapshot.id === toSnapshotId)
    return from && to ? compareEvolutionSnapshots(from, to) : null
  }, [fromSnapshotId, orderedSnapshots, toSnapshotId])

  if (!evolution.checkpoints.length) return null

  const first = evolution.checkpoints[0]
  const last = evolution.checkpoints.at(-1)!
  const period = evolution.periodGeneralScoreDelta
  const periodGains = evolution.gains.slice(0, 5)
  const periodLosses = evolution.losses.slice(0, 5)
  const comparisonGains = comparison?.gains.slice(0, 5) ?? []
  const comparisonLosses = comparison?.losses.slice(0, 5) ?? []
  const comparisonFrom = orderedSnapshots.find(snapshot => snapshot.id === comparison?.fromSnapshotId)
  const comparisonTo = orderedSnapshots.find(snapshot => snapshot.id === comparison?.toSnapshotId)
  const isFullHistory = selectedRange.startIndex === 0 && selectedRange.endIndex === orderedSnapshots.length - 1

  const resetRange = () => {
    setRangeFromSnapshotId(orderedSnapshots[0]?.id ?? '')
    setRangeToSnapshotId(orderedSnapshots.at(-1)?.id ?? '')
  }

  return <section className="card player-evolution-panel">
    <header className="player-evolution-header">
      <div><span className="eyebrow">TRAJETÓRIA OBSERVADA</span><h2>Evolução</h2></div>
      <span className="analyzer-status">
        {evolution.checkpoints.length === orderedSnapshots.length
          ? `${evolution.checkpoints.length} checkpoint${evolution.checkpoints.length === 1 ? '' : 's'}`
          : `${evolution.checkpoints.length}/${orderedSnapshots.length} checkpoints`}
      </span>
    </header>

    {contextDiagnostic ? <p className="player-evolution-context-warning">Contexto normalizado indisponível: {contextDiagnostic}</p> : null}

    <div className="player-evolution-range">
      <div className="player-evolution-range-header">
        <div><h3>Período observado</h3><p>O filtro altera a leitura da evolução; o comparador De → Para abaixo continua independente.</p></div>
        <span className="analyzer-status">{isFullHistory ? 'Todo o histórico' : `${first.snapshotDate} → ${last.snapshotDate}`}</span>
      </div>
      <div className="player-evolution-range-controls">
        <label>De
          <select aria-label="Início do período observado" value={rangeFromSnapshotId} onChange={(event: { target: { value: string } }) => setRangeFromSnapshotId(event.target.value)}>
            {orderedSnapshots.map((snapshot, index) => <option value={snapshot.id} key={snapshot.id}>{rangeOptionLabel(snapshot, index)}</option>)}
          </select>
        </label>
        <label>Até
          <select aria-label="Fim do período observado" value={rangeToSnapshotId} onChange={(event: { target: { value: string } }) => setRangeToSnapshotId(event.target.value)}>
            {orderedSnapshots.map((snapshot, index) => <option value={snapshot.id} key={snapshot.id}>{rangeOptionLabel(snapshot, index)}</option>)}
          </select>
        </label>
        <button className="secondary player-evolution-range-reset" type="button" onClick={resetRange} disabled={isFullHistory}>Todo histórico</button>
      </div>
    </div>

    <div className="player-evolution-summary">
      <EvolutionFact label="Primeiro registro" value={first.snapshotDate} detail={checkpointContextLabel(first)} />
      <EvolutionFact label="Último registro" value={last.snapshotDate} detail={checkpointContextLabel(last)} />
      <EvolutionFact label="Nota Geral no período" value={period ? `${formatScore(period.from)} → ${formatScore(period.to)}` : formatScore(first.generalScore)} detail={period ? signed(period.delta) : 'Ainda sem intervalo comparável'} />
      <EvolutionFact label="Mudanças de contexto" value={evolution.contextChanges.length} detail="Somente alterações entre valores observados" />
    </div>

    <EvolutionTrend checkpoints={evolution.checkpoints} />

    {evolution.checkpoints.length === 1 ? <div className="player-evolution-baseline"><strong>Baseline único</strong><p>Há somente um snapshot observado neste período. O DataTracker não fabrica tendência ou delta sem um segundo checkpoint.</p></div> : <div className="player-evolution-period-change-grid">
      <AttributeChangeList title="Maiores ganhos no período" items={periodGains} empty="Nenhum ganho comparável entre as pontas do período filtrado." />
      <AttributeChangeList title="Maiores perdas no período" items={periodLosses} empty="Nenhuma perda comparável entre as pontas do período filtrado." />
    </div>}

    <div className="player-evolution-score-block">
      <div className="player-evolution-section-title"><h3>Detalhes dos checkpoints</h3><p>GeneralScore e BasePositionScore usam a fórmula canônica. A paginação limita somente os cards montados na tela.</p></div>
      <div className="player-evolution-score-track" role="list" aria-label="Detalhes dos checkpoints observados">
        {detailPagination.items.map(checkpoint => <div className="player-evolution-checkpoint" role="listitem" key={checkpoint.snapshotId}>
          <small>{checkpoint.snapshotDate}</small>
          <div className="player-evolution-general-score">
            <span>Nota Geral</span>
            {checkpoint.generalScore === null ? <strong>—</strong> : <ScoreBadge value={checkpoint.generalScore} className="score-badge-compact" showTitle={false} />}
          </div>
          <span>{checkpoint.age === null ? 'Idade —' : `${checkpoint.age} anos`}</span>
          <span>{checkpoint.generalPosition ?? 'Score indisponível'}</span>
          {checkpoint.basePositionScores.length ? <div className="player-evolution-base-list" aria-label={`BasePositionScore em ${checkpoint.snapshotDate}`}>
            {checkpoint.basePositionScores.map(score => <div key={`${score.scoreKey}-${score.family}`}><span>{score.position}</span><ScoreBadge value={score.score} className="score-badge-compact" showTitle={false} /></div>)}
          </div> : <small>Sem BasePositionScore comparável.</small>}
        </div>)}
      </div>
      <EvolutionPagination pagination={detailPagination} onPage={setDetailPage} />
    </div>

    <div className="player-evolution-compare-block">
      <div className="player-evolution-section-title"><h3>Comparar checkpoints</h3><p>Escolha quaisquer duas observações de todo o histórico; a direção segue De → Para e não depende do filtro acima.</p></div>
      <div className="player-evolution-compare-controls">
        <label>De<select aria-label="Checkpoint inicial" value={fromSnapshotId} disabled={orderedSnapshots.length <= 1} onChange={(event: { target: { value: string } }) => setFromSnapshotId(event.target.value)}>{orderedSnapshots.map((snapshot, index) => <option value={snapshot.id} key={snapshot.id}>{rangeOptionLabel(snapshot, index)}</option>)}</select></label>
        <label>Para<select aria-label="Checkpoint final" value={toSnapshotId} disabled={orderedSnapshots.length <= 1} onChange={(event: { target: { value: string } }) => setToSnapshotId(event.target.value)}>{orderedSnapshots.map((snapshot, index) => <option value={snapshot.id} key={snapshot.id}>{rangeOptionLabel(snapshot, index)}</option>)}</select></label>
      </div>
      {comparison ? <>
        <div className="player-evolution-comparison-summary">
          <EvolutionFact label="Intervalo escolhido" value={`${comparisonFrom?.snapshot_date ?? '—'} → ${comparisonTo?.snapshot_date ?? '—'}`} detail="Observações persistidas" />
          <EvolutionFact label="Nota Geral" value={comparison.generalScoreDelta ? `${formatScore(comparison.generalScoreDelta.from)} → ${formatScore(comparison.generalScoreDelta.to)}` : '—'} detail={comparison.generalScoreDelta ? signed(comparison.generalScoreDelta.delta) : 'Sem dois scores comparáveis'} />
          <EvolutionFact label="Bases comparáveis" value={comparison.basePositionScoreChanges.length} detail="Somente bases presentes nos dois checkpoints" />
          <EvolutionFact label="Atributos comparáveis" value={comparison.attributeChanges.length} detail="Ausência não vira zero" />
        </div>
        {comparison.basePositionScoreChanges.length ? <div className="player-evolution-base-comparison">
          {comparison.basePositionScoreChanges.map(item => <div key={`${item.scoreKey}-${item.family}`}>
            <span>{basePositionChangeLabel(item.fromPosition, item.toPosition)}</span>
            <small>{formatScore(item.from)} → {formatScore(item.to)}</small>
            <strong className={item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : ''}>{signed(item.delta)}</strong>
          </div>)}
        </div> : <p className="player-evolution-comparison-empty">Nenhum BasePositionScore está presente nos dois checkpoints selecionados.</p>}
        <div className="player-evolution-change-grid">
          <AttributeChangeList title="Maiores ganhos no comparativo" items={comparisonGains} empty="Nenhum ganho comparável entre os checkpoints selecionados." />
          <AttributeChangeList title="Maiores perdas no comparativo" items={comparisonLosses} empty="Nenhuma perda comparável entre os checkpoints selecionados." />
        </div>
      </> : null}
    </div>

    <div className="player-evolution-context-block">
      <div className="player-evolution-section-title"><h3>Contexto observado</h3><p>Membership/Season só substituem o rótulo legado quando existe vínculo explícito com o snapshot. A página acompanha os cards detalhados acima.</p></div>
      <div className="player-evolution-context-list">
        {detailPagination.items.map(checkpoint => <CheckpointContext checkpoint={checkpoint} key={checkpoint.snapshotId} />)}
      </div>
      <EvolutionPagination pagination={detailPagination} onPage={setDetailPage} />
    </div>
  </section>
}

function EvolutionTrend({ checkpoints }: { checkpoints: EvolutionCheckpoint[] }) {
  const segments = generalScoreSegments(checkpoints)
  const points = segments.flat()
  const width = 760
  const height = 220
  const left = 42
  const right = 18
  const top = 14
  const bottom = 34
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const x = (checkpointIndex: number) => checkpoints.length <= 1
    ? left + plotWidth / 2
    : left + (checkpointIndex / (checkpoints.length - 1)) * plotWidth
  const y = (score: number) => top + ((20 - Math.min(20, Math.max(0, score))) / 20) * plotHeight
  const ticks = [0, 5, 10, 15, 20]
  const hasGaps = points.length !== checkpoints.length

  return <div className="player-evolution-trend">
    <div className="player-evolution-trend-header">
      <div><h3>Tendência da Nota Geral</h3><p>Cada ponto é um checkpoint observado. Lacunas quebram a linha em vez de serem interpoladas.</p></div>
      <span className="analyzer-status">{points.length}/{checkpoints.length} com score</span>
    </div>
    <svg className="player-evolution-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico da trajetória observada da Nota Geral">
      <title>Trajetória observada da Nota Geral no período selecionado</title>
      {ticks.map(tick => <g key={tick}>
        <line className="player-evolution-trend-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
        <text className="player-evolution-trend-axis-label" x={left - 8} y={y(tick) + 4} textAnchor="end">{tick}</text>
      </g>)}
      {segments.map((segment, index) => segment.length >= 2
        ? <polyline className="player-evolution-trend-line" key={`segment-${index}`} points={segment.map(point => `${x(point.checkpointIndex)},${y(point.generalScore)}`).join(' ')} />
        : null)}
      {points.map(point => <circle
        className="player-evolution-trend-point"
        key={point.snapshotId}
        cx={x(point.checkpointIndex)}
        cy={y(point.generalScore)}
        r="4"
        tabIndex={0}
        aria-label={`${point.snapshotDate}: Nota Geral ${formatScore(point.generalScore)}${point.age === null ? '' : `, ${point.age} anos`}`}
      ><title>{`${point.snapshotDate} · Nota Geral ${formatScore(point.generalScore)}${point.age === null ? '' : ` · ${point.age} anos`}`}</title></circle>)}
      <text className="player-evolution-trend-axis-label" x={left} y={height - 8} textAnchor="start">{checkpoints[0]?.snapshotDate ?? ''}</text>
      <text className="player-evolution-trend-axis-label" x={width - right} y={height - 8} textAnchor="end">{checkpoints.at(-1)?.snapshotDate ?? ''}</text>
    </svg>
    {hasGaps ? <p className="player-evolution-trend-gap-note">Há {checkpoints.length - points.length} checkpoint{checkpoints.length - points.length === 1 ? '' : 's'} sem Nota Geral calculável; esses trechos permanecem desconectados.</p> : null}
  </div>
}

function EvolutionPagination<T>({ pagination, onPage }: { pagination: EvolutionPage<T>; onPage: (page: number) => void }) {
  if (pagination.pageCount <= 1) return null
  return <div className="player-evolution-detail-pagination">
    <span>Mostrando {pagination.start}–{pagination.end} de {pagination.total} checkpoints · página {pagination.page}/{pagination.pageCount}</span>
    <div>
      <button className="secondary" type="button" onClick={() => onPage(pagination.page - 1)} disabled={pagination.page <= 1}>Anterior</button>
      <button className="secondary" type="button" onClick={() => onPage(pagination.page + 1)} disabled={pagination.page >= pagination.pageCount}>Próxima</button>
    </div>
  </div>
}

function CheckpointContext({ checkpoint }: { checkpoint: EvolutionCheckpoint }) {
  const normalized = checkpoint.normalizedContext
  return <div>
    <span>{checkpoint.snapshotDate}</span>
    <strong>{checkpointContextLabel(checkpoint)}</strong>
    <small>{checkpoint.age === null ? 'Idade desconhecida' : `${checkpoint.age} anos`}</small>
    {normalized ? <>
      <small>Membership normalizado{normalized.seasonLabel ? ` · ${normalized.seasonLabel}` : ''}</small>
      {normalized.ownerClub && normalized.ownerClub !== normalized.currentClub ? <small>Clube detentor: {normalized.ownerClub}</small> : null}
      {normalized.isLoan === true ? <small>Empréstimo registrado: {loanLabel(normalized)}</small> : null}
      <small>Nível: {teamLevelLabel(normalized.teamLevel)}</small>
    </> : <small>Somente contexto observado no snapshot</small>}
    {checkpoint.contextDiagnostic ? <small className="warning">{checkpoint.contextDiagnostic}</small> : null}
  </div>
}

function EvolutionFact({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>
}

function AttributeChangeList({ title, items, empty }: { title: string; items: AttributeChange[]; empty: string }) {
  return <section><h3>{title}</h3>{items.length ? <div className="player-evolution-attribute-list">{items.map(item => <div key={item.attributeKey}>
    <span>{attributeLabel(item.attributeKey)}</span><small>{item.from} → {item.to}</small><strong className={item.delta > 0 ? 'up' : 'down'}>{signed(item.delta)}</strong>
  </div>)}</div> : <p>{empty}</p>}</section>
}

function checkpointContextLabel(checkpoint: EvolutionCheckpoint) {
  const normalized = checkpoint.normalizedContext
  return normalized
    ? contextLabel(normalized.currentClub, normalized.squad)
    : contextLabel(checkpoint.club, checkpoint.squad)
}
function loanLabel(context: EvolutionNormalizedContext) { return [context.loanFromClub, context.loanToClub].filter(Boolean).join(' → ') || 'sim' }
function teamLevelLabel(level: TeamLevel) { return ({ first_team: 'Principal', reserve: 'Reserva/B', academy: 'Base', other: 'Outro', unknown: 'Não informado' } as const)[level] }
function basePositionChangeLabel(from: string, to: string) { return from === to ? from : `${from} → ${to}` }
function attributeLabel(key: string) { return ATTRIBUTE_CATALOG.find(attribute => attribute.key === key)?.label ?? key.replace(/_/g, ' ') }
function formatScore(value: number | null) { return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) }
function signed(value: number) { return `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}` }
function contextLabel(club: string | null, squad: string | null) { return [club, squad].filter(Boolean).join(' · ') || 'Contexto não informado' }
function rangeOptionLabel(snapshot: EvolutionSnapshot, index: number) { return `${snapshot.snapshot_date} · registro ${index + 1}` }
