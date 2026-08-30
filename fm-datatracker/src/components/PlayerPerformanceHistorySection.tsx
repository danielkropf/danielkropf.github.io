import { useMemo } from 'react'
import { buildPlayerPerformanceHistory, type AdditiveStatTotals, type PerformanceHistoryContext } from '../lib/player-performance-history'
import { statMetricEntries, statsSample } from '../lib/player-stats'
import type { PlayerStat } from '../types/domain'
import '../player-performance-history.css'

type Props = { stats: PlayerStat[] }

export function PlayerPerformanceHistorySection({ stats }: Props) {
  const history = useMemo(() => buildPlayerPerformanceHistory(stats), [stats])

  return <section className="card player-performance-history-panel">
    <header className="player-performance-history-header">
      <div><span className="eyebrow">HISTÓRICO OBSERVADO</span><h2>Temporadas / Performance</h2></div>
      <span className="analyzer-status">{history.observedCount} registro{history.observedCount === 1 ? '' : 's'} de stats</span>
    </header>

    {!stats.length ? <div className="stats-empty">
      <strong>Sem histórico de performance importado</strong>
      <p>Quando houver player_stats, esta área organiza temporadas e contextos sem fabricar totais ausentes.</p>
    </div> : <>
      <section className="player-performance-career-summary">
        <div>
          <small>Carreira observada</small>
          <strong>{history.seasons.length} temporada{history.seasons.length === 1 ? '' : 's'}</strong>
          <span>{history.completeContextCount} contexto{history.completeContextCount === 1 ? '' : 's'} completo{history.completeContextCount === 1 ? '' : 's'} · {history.supersededCount} checkpoint{history.supersededCount === 1 ? '' : 's'} anterior{history.supersededCount === 1 ? '' : 'es'} preservado{history.supersededCount === 1 ? '' : 's'} como evidência</span>
        </div>
        {history.careerTotals ? <Totals totals={history.careerTotals} /> : null}
      </section>

      {history.careerTotalsDiagnostic ? <p className="player-performance-history-warning">{history.careerTotalsDiagnostic}</p> : null}

      <div className="player-performance-season-list">
        {history.seasons.map(season => <section className="player-performance-season" key={season.key}>
          <header>
            <div><small>Temporada</small><h3>{season.label}</h3></div>
            <span>Último registro: {season.lastSnapshotDate || '—'}</span>
          </header>
          {season.totals ? <Totals totals={season.totals} /> : null}
          {season.totalsDiagnostic ? <p className="player-performance-history-warning">{season.totalsDiagnostic}</p> : null}
          <div className="player-performance-context-grid">
            {season.contexts.map(context => <PerformanceContext context={context} key={context.key} />)}
          </div>
        </section>)}
      </div>
    </>}

    <p className="performance-contract">Somente minutos, partidas, titular e reserva podem ser agregados quando o contexto é explícito. Médias, percentuais, ratings e métricas por 90 permanecem evidência do registro original. PerformanceScore continua não definido.</p>
  </section>
}

function Totals({ totals }: { totals: AdditiveStatTotals }) {
  const sample = statsSample(totals.minutes)
  return <div className="player-performance-totals">
    <Stat label="Minutos" value={totals.minutes} />
    <Stat label="Partidas" value={totals.appearances} />
    <Stat label="Titular" value={totals.starts} />
    <Stat label="Reserva" value={totals.subAppearances} />
    <div className="player-performance-sample"><small>Amostra</small><strong>{sample.label}</strong><span>{Math.round(sample.confidence * 100)}%</span></div>
  </div>
}

function PerformanceContext({ context }: { context: PerformanceHistoryContext }) {
  const sample = statsSample(context.stat.minutes)
  const metrics = statMetricEntries(context.stat, 6)
  return <article className={`player-performance-history-context${context.explicit ? '' : ' is-partial'}`}>
    <header>
      <div><strong>{contextLabel(context)}</strong><small>{context.stat.snapshot_date}</small></div>
      <span>{sample.label} · {Math.round(sample.confidence * 100)}%</span>
    </header>
    <div className="stat-basics">
      <Stat label="Minutos" value={context.stat.minutes} />
      <Stat label="Partidas" value={context.stat.appearances} />
      <Stat label="Titular" value={context.stat.starts} />
      <Stat label="Reserva" value={context.stat.sub_appearances} />
    </div>
    {metrics.length ? <div className="stat-metrics">{metrics.map(metric => <div key={metric.key}><small>{metric.label}</small><strong>{formatStat(metric.value)}</strong></div>)}</div> : <small>Nenhuma métrica adicional normalizada neste registro.</small>}
    {!context.explicit ? <p className="player-performance-history-warning">Contexto incompleto: este registro permanece visível, mas não entra em totais.</p> : null}
    {context.superseded.length ? <small className="player-performance-history-meta">{context.superseded.length} checkpoint{context.superseded.length === 1 ? '' : 's'} anterior{context.superseded.length === 1 ? '' : 'es'} do mesmo contexto não somado{context.superseded.length === 1 ? '' : 's'} novamente.</small> : null}
  </article>
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return <div><small>{label}</small><strong>{value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong></div>
}

function contextLabel(context: PerformanceHistoryContext) {
  const values = [context.competition, context.team].filter(Boolean)
  return values.length ? values.join(' · ') : 'Contexto não informado'
}

function formatStat(value: unknown) {
  if (typeof value === 'number') return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number.NaN
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : String(value)
}
