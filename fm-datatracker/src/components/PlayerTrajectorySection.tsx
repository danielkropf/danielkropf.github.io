import { useMemo } from 'react'
import {
  buildPlayerTrajectory,
  explicitEventLabel,
  type TrajectoryObservation,
  type TrajectoryTimelineItem,
} from '../lib/player-trajectory'
import type { PlayerMembershipWithClubs, ProvenanceSourceKind, SaveEvent } from '../types/domain'
import '../player-trajectory.css'

type PlayerTrajectorySectionProps = {
  memberships?: PlayerMembershipWithClubs[]
  events?: SaveEvent[]
  eventsDiagnostic?: string | null
}

export function PlayerTrajectorySection({
  memberships = [],
  events = [],
  eventsDiagnostic = null,
}: PlayerTrajectorySectionProps) {
  const trajectory = useMemo(() => buildPlayerTrajectory(memberships, events), [events, memberships])

  if (!memberships.length && !events.length && !eventsDiagnostic) return null

  const first = trajectory.observations[0]
  const last = trajectory.observations.at(-1)

  return <section className="card player-trajectory-panel">
    <header className="player-trajectory-header">
      <div><span className="eyebrow">TRAJETÓRIA & EVENTOS</span><h2>Histórico longitudinal</h2></div>
      <span className="analyzer-status">{trajectory.observations.length} observação{trajectory.observations.length === 1 ? '' : 'ões'}</span>
    </header>

    {eventsDiagnostic ? <p className="player-trajectory-warning">Eventos explícitos indisponíveis: {eventsDiagnostic}</p> : null}
    {trajectory.ignoredMembershipCount ? <p className="player-trajectory-warning">{trajectory.ignoredMembershipCount} membership{trajectory.ignoredMembershipCount === 1 ? '' : 's'} não entrou na trajetória segura por ausência ou ambiguidade do vínculo com snapshot.</p> : null}

    <div className="player-trajectory-summary">
      <TrajectoryFact label="Primeira observação" value={first?.date ?? '—'} detail={first ? observationContext(first) : 'Sem membership seguro'} />
      <TrajectoryFact label="Última observação" value={last?.date ?? '—'} detail={last ? observationContext(last) : 'Sem membership seguro'} />
      <TrajectoryFact label="Mudanças observadas" value={trajectory.changes.length} detail="Somente diferenças entre valores conhecidos" />
      <TrajectoryFact label="Eventos explícitos" value={trajectory.explicitEvents.length} detail="Somente registros persistidos em SaveEvents" />
    </div>

    {trajectory.observations.length ? <div className="player-trajectory-block">
      <div className="player-trajectory-section-title"><h3>Vínculos observados</h3><p>Cada cartão corresponde a um membership ligado explicitamente a um snapshot. Repetições não são tratadas como movimentação.</p></div>
      <div className="player-trajectory-observations" role="list" aria-label="Vínculos observados">
        {trajectory.observations.map(observation => <ObservationCard observation={observation} key={observation.id} />)}
      </div>
    </div> : <div className="player-trajectory-empty"><strong>Sem memberships seguros</strong><p>O DataTracker não cria trajetória sem vínculo explícito entre membership e snapshot.</p></div>}

    <div className="player-trajectory-block">
      <div className="player-trajectory-section-title"><h3>Marcos e mudanças</h3><p>Transferência, empréstimo e outros fatos causais só recebem esse nome quando existe um SaveEvent explícito.</p></div>
      {trajectory.timeline.length ? <div className="player-trajectory-timeline">
        {trajectory.timeline.map(item => <TimelineItem item={item} key={item.id} />)}
      </div> : <div className="player-trajectory-empty"><strong>Nenhuma mudança ou evento confirmado</strong><p>Os checkpoints observados permanecem válidos acima, mas não há evidência suficiente para criar um marco entre eles.</p></div>}
    </div>

    <p className="player-trajectory-contract">Regra de provenance: mudanças derivadas usam somente diferenças entre dois valores conhecidos em memberships ligados a snapshots. Valor ausente é desconhecido, nunca evidência de mudança.</p>
  </section>
}

function ObservationCard({ observation }: { observation: TrajectoryObservation }) {
  const context = observation.context
  return <article role="listitem">
    <header><strong>{observation.date}</strong><span>{sourceLabel(observation.sourceKind)} · snapshot confirmado</span></header>
    <div><small>Contexto observado</small><strong>{observationContext(observation)}</strong></div>
    {context.ownerClub && context.ownerClub !== context.currentClub ? <small>Detentor: {context.ownerClub}</small> : null}
    {context.isLoan === true ? <small>Empréstimo observado no membership{loanRoute(observation) ? ` · ${loanRoute(observation)}` : ''}</small> : null}
    <small>Nível: {teamLevelLabel(context.teamLevel)}</small>
  </article>
}

function TimelineItem({ item }: { item: TrajectoryTimelineItem }) {
  if (item.kind === 'explicit_event') {
    const detail = eventDetail(item.event)
    return <article className="player-trajectory-event explicit">
      <time>{item.date}</time>
      <div><span>EVENTO EXPLÍCITO</span><strong>{explicitEventLabel(item.event)}</strong>{detail ? <p>{detail}</p> : null}<small>Fonte: {sourceLabel(item.event.source_kind)}{item.event.derivation_version ? ` · derivação ${item.event.derivation_version}` : ''}</small></div>
    </article>
  }
  return <article className="player-trajectory-event derived">
    <time>{item.date}</time>
    <div><span>MUDANÇA OBSERVADA</span><strong>Mudança de contexto observada</strong><ul>{item.change.changes.map(change => <li key={change.field}><b>{change.label}</b>: {change.from} → {change.to}</li>)}</ul><small>Regra: valores conhecidos diferentes entre dois memberships consecutivos · provenance em 2 snapshots</small></div>
  </article>
}

function TrajectoryFact({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>
}

function observationContext(observation: TrajectoryObservation) {
  const { currentClub, squad } = observation.context
  return [currentClub, squad].filter(Boolean).join(' · ') || 'Contexto não informado'
}

function loanRoute(observation: TrajectoryObservation) {
  const { loanFromClub, loanToClub } = observation.context
  return [loanFromClub, loanToClub].filter(Boolean).join(' → ')
}

function teamLevelLabel(value: TrajectoryObservation['context']['teamLevel']) {
  return ({ first_team: 'Principal', reserve: 'Reserva/B', academy: 'Base', other: 'Outro', unknown: 'Não informado' } as const)[value]
}

function sourceLabel(value: ProvenanceSourceKind) {
  return ({ fm: 'FM', csv: 'CSV', manual: 'Manual', derived: 'Derivado', legacy: 'Legado' } as const)[value]
}

function eventDetail(event: SaveEvent) {
  for (const key of ['description', 'label', 'title', 'note', 'status']) {
    const value = event.payload?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}
