import { useMemo } from 'react'
import { ATTRIBUTE_CATALOG } from '../lib/attributes'
import { buildPlayerEvolution, type AttributeChange, type EvolutionSnapshot } from '../lib/player-evolution'
import { ScoreBadge } from './ScoreBadge'

export function PlayerEvolutionSection({ snapshots }: { snapshots: EvolutionSnapshot[] }) {
  const evolution = useMemo(() => buildPlayerEvolution(snapshots), [snapshots])
  if (!evolution.checkpoints.length) return null

  const first = evolution.checkpoints[0]
  const last = evolution.checkpoints.at(-1)!
  const period = evolution.periodGeneralScoreDelta
  const gains = evolution.gains.slice(0, 5)
  const losses = evolution.losses.slice(0, 5)

  return <section className="card player-evolution-panel">
    <header className="player-evolution-header">
      <div><span className="eyebrow">TRAJETÓRIA OBSERVADA</span><h2>Evolução</h2></div>
      <span className="analyzer-status">{evolution.checkpoints.length} checkpoint{evolution.checkpoints.length === 1 ? '' : 's'}</span>
    </header>

    <div className="player-evolution-summary">
      <EvolutionFact label="Primeiro registro" value={first.snapshotDate} detail={contextLabel(first.club, first.squad)} />
      <EvolutionFact label="Último registro" value={last.snapshotDate} detail={contextLabel(last.club, last.squad)} />
      <EvolutionFact label="Nota Geral no período" value={period ? `${formatScore(period.from)} → ${formatScore(period.to)}` : formatScore(first.generalScore)} detail={period ? signed(period.delta) : 'Ainda sem intervalo comparável'} />
      <EvolutionFact label="Mudanças de contexto" value={evolution.contextChanges.length} detail="Somente alterações entre valores observados" />
    </div>

    <div className="player-evolution-score-block">
      <div className="player-evolution-section-title"><h3>Trajetória da Nota Geral</h3><p>A mesma fórmula canônica é recalculada em cada snapshot. Lacunas permanecem como lacunas.</p></div>
      <div className="player-evolution-score-track" role="list" aria-label="Trajetória da Nota Geral">
        {evolution.checkpoints.map(checkpoint => <div className="player-evolution-checkpoint" role="listitem" key={checkpoint.snapshotId}>
          <small>{checkpoint.snapshotDate}</small>
          {checkpoint.generalScore === null ? <strong>—</strong> : <ScoreBadge value={checkpoint.generalScore} className="score-badge-compact" showTitle={false} />}
          <span>{checkpoint.age === null ? 'Idade —' : `${checkpoint.age} anos`}</span>
          <span>{checkpoint.generalPosition ?? 'Score indisponível'}</span>
        </div>)}
      </div>
    </div>

    {evolution.checkpoints.length === 1 ? <div className="player-evolution-baseline"><strong>Baseline único</strong><p>Há somente um snapshot observado. O DataTracker não fabrica tendência ou delta sem um segundo checkpoint.</p></div> : <div className="player-evolution-change-grid">
      <AttributeChangeList title="Maiores ganhos" items={gains} empty="Nenhum ganho comparável entre o primeiro e o último snapshot." />
      <AttributeChangeList title="Maiores perdas" items={losses} empty="Nenhuma perda comparável entre o primeiro e o último snapshot." />
    </div>}

    <div className="player-evolution-context-block">
      <div className="player-evolution-section-title"><h3>Contexto observado</h3><p>Club/squad são mostrados como apareceram nos checkpoints; não inferem transferência, empréstimo ou promoção.</p></div>
      <div className="player-evolution-context-list">
        {evolution.checkpoints.map(checkpoint => <div key={checkpoint.snapshotId}>
          <span>{checkpoint.snapshotDate}</span>
          <strong>{contextLabel(checkpoint.club, checkpoint.squad)}</strong>
          <small>{checkpoint.age === null ? 'Idade desconhecida' : `${checkpoint.age} anos`}</small>
        </div>)}
      </div>
    </div>
  </section>
}

function EvolutionFact({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>
}

function AttributeChangeList({ title, items, empty }: { title: string; items: AttributeChange[]; empty: string }) {
  return <section><h3>{title}</h3>{items.length ? <div className="player-evolution-attribute-list">{items.map(item => <div key={item.attributeKey}>
    <span>{attributeLabel(item.attributeKey)}</span><small>{item.from} → {item.to}</small><strong className={item.delta > 0 ? 'up' : 'down'}>{signed(item.delta)}</strong>
  </div>)}</div> : <p>{empty}</p>}</section>
}

function attributeLabel(key: string) { return ATTRIBUTE_CATALOG.find(attribute => attribute.key === key)?.label ?? key.replace(/_/g, ' ') }
function formatScore(value: number | null) { return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) }
function signed(value: number) { return `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}` }
function contextLabel(club: string | null, squad: string | null) { return [club, squad].filter(Boolean).join(' · ') || 'Contexto não informado' }
