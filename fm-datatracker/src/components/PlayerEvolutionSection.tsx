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
import type { PlayerMembershipWithClubs, Season, TeamLevel } from '../types/domain'
import { ScoreBadge } from './ScoreBadge'

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
  const evolution = useMemo(
    () => buildPlayerEvolution(orderedSnapshots, memberships, seasons),
    [orderedSnapshots, memberships, seasons],
  )
  const [fromSnapshotId, setFromSnapshotId] = useState('')
  const [toSnapshotId, setToSnapshotId] = useState('')

  useEffect(() => {
    setFromSnapshotId(orderedSnapshots[0]?.id ?? '')
    setToSnapshotId(orderedSnapshots.at(-1)?.id ?? '')
  }, [orderedSnapshots])

  const comparison = useMemo(() => {
    const from = orderedSnapshots.find(snapshot => snapshot.id === fromSnapshotId)
    const to = orderedSnapshots.find(snapshot => snapshot.id === toSnapshotId)
    return from && to ? compareEvolutionSnapshots(from, to) : null
  }, [fromSnapshotId, orderedSnapshots, toSnapshotId])

  if (!evolution.checkpoints.length) return null

  const first = evolution.checkpoints[0]
  const last = evolution.checkpoints.at(-1)!
  const period = evolution.periodGeneralScoreDelta
  const gains = comparison?.gains.slice(0, 5) ?? []
  const losses = comparison?.losses.slice(0, 5) ?? []
  const comparisonFrom = orderedSnapshots.find(snapshot => snapshot.id === comparison?.fromSnapshotId)
  const comparisonTo = orderedSnapshots.find(snapshot => snapshot.id === comparison?.toSnapshotId)

  return <section className="card player-evolution-panel">
    <header className="player-evolution-header">
      <div><span className="eyebrow">TRAJETÓRIA OBSERVADA</span><h2>Evolução</h2></div>
      <span className="analyzer-status">{evolution.checkpoints.length} checkpoint{evolution.checkpoints.length === 1 ? '' : 's'}</span>
    </header>

    {contextDiagnostic ? <p className="player-evolution-context-warning">Contexto normalizado indisponível: {contextDiagnostic}</p> : null}

    <div className="player-evolution-summary">
      <EvolutionFact label="Primeiro registro" value={first.snapshotDate} detail={checkpointContextLabel(first)} />
      <EvolutionFact label="Último registro" value={last.snapshotDate} detail={checkpointContextLabel(last)} />
      <EvolutionFact label="Nota Geral no período" value={period ? `${formatScore(period.from)} → ${formatScore(period.to)}` : formatScore(first.generalScore)} detail={period ? signed(period.delta) : 'Ainda sem intervalo comparável'} />
      <EvolutionFact label="Mudanças de contexto" value={evolution.contextChanges.length} detail="Somente alterações entre valores observados" />
    </div>

    <div className="player-evolution-score-block">
      <div className="player-evolution-section-title"><h3>Trajetória de scores</h3><p>GeneralScore e BasePositionScore usam a fórmula canônica em cada snapshot. Lacunas permanecem como lacunas.</p></div>
      <div className="player-evolution-score-track" role="list" aria-label="Trajetória de scores">
        {evolution.checkpoints.map(checkpoint => <div className="player-evolution-checkpoint" role="listitem" key={checkpoint.snapshotId}>
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
    </div>

    <div className="player-evolution-compare-block">
      <div className="player-evolution-section-title"><h3>Comparar checkpoints</h3><p>Escolha quaisquer duas observações; a direção do comparativo segue De → Para.</p></div>
      <div className="player-evolution-compare-controls">
        <label>De<select aria-label="Checkpoint inicial" value={fromSnapshotId} disabled={orderedSnapshots.length <= 1} onChange={event => setFromSnapshotId(event.target.value)}>{orderedSnapshots.map(snapshot => <option value={snapshot.id} key={snapshot.id}>{snapshot.snapshot_date}</option>)}</select></label>
        <label>Para<select aria-label="Checkpoint final" value={toSnapshotId} disabled={orderedSnapshots.length <= 1} onChange={event => setToSnapshotId(event.target.value)}>{orderedSnapshots.map(snapshot => <option value={snapshot.id} key={snapshot.id}>{snapshot.snapshot_date}</option>)}</select></label>
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
      </> : null}
    </div>

    {evolution.checkpoints.length === 1 ? <div className="player-evolution-baseline"><strong>Baseline único</strong><p>Há somente um snapshot observado. O DataTracker não fabrica tendência ou delta sem um segundo checkpoint.</p></div> : <div className="player-evolution-change-grid">
      <AttributeChangeList title="Maiores ganhos no comparativo" items={gains} empty="Nenhum ganho comparável entre os checkpoints selecionados." />
      <AttributeChangeList title="Maiores perdas no comparativo" items={losses} empty="Nenhuma perda comparável entre os checkpoints selecionados." />
    </div>}

    <div className="player-evolution-context-block">
      <div className="player-evolution-section-title"><h3>Contexto observado</h3><p>Membership/Season só substituem o rótulo legado quando existe vínculo explícito com o snapshot.</p></div>
      <div className="player-evolution-context-list">
        {evolution.checkpoints.map(checkpoint => <CheckpointContext checkpoint={checkpoint} key={checkpoint.snapshotId} />)}
      </div>
    </div>
  </section>
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
