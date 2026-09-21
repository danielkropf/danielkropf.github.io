import { useEffect, useId, useMemo, useRef, useState, cloneElement, isValidElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { leagueComparisons, summarizeLeagueRole, type LeagueReference, type LeagueRolePair } from '../lib/league-reference'
import { loadBestLeagueReference } from '../lib/league-reference-store'
import './league-comparison.css'

const reasonLabels: Record<string, string> = {
  no_current_calendar: 'Sem referência disponível.',
  legacy_reference_needs_refresh: 'Atualize este import para reconstruir a referência.',
  header_consensus_only: 'Referência ainda não confirmada.',
  multiple_current_leagues: 'Mais de uma liga possível.',
  multiple_completed_leagues: 'Mais de uma edição possível.',
  missing_same_save_population: 'Sem população disponível neste checkpoint.',
  unstable_or_unsupported_rules: 'Liga ainda não suportada.',
  child_rules_unresolved: 'Grupo da liga ainda não confirmado.',
  multiple_reference_cohorts: 'Mais de uma população possível.',
  multiple_header_populations: 'Mais de uma população possível.',
  overlapping_group_teams: 'População ambígua.',
  conflicting_identity: 'População ambígua.',
  conflicting_biography: 'População ambígua.',
  duplicate_uid: 'População ambígua.',
  empty_population: 'Sem jogadores elegíveis.',
  adjacent_unresolved: 'Divisão não confirmada.',
  multiple_adjacent_targets: 'Divisão não confirmada.',
  quota_not_positive: 'Divisão não confirmada.',
  insufficient_cutoff_coverage: 'Cobertura insuficiente para esta função.',
  missing_expected_teams: 'Quantidade de clubes da liga não confirmada.',
  unsupported_cutoff_position: 'Posição sem referência de corte configurada.',
}
export const leagueReason = (reason: string) => reasonLabels[reason] ?? 'Sem dados disponíveis.'
const displayDate = (iso: string | null | undefined) => iso ? iso.split('-').reverse().join('/') : '—'

export function useLeagueReference(saveId: string | undefined, date: string | null, revision: number) {
  const key = `${saveId}:${date}:${revision}`
  const [state, setState] = useState<{ key: string; data: LeagueReference | null; message: string; requestedDate: string | null; sourceDate: string | null; fallback: boolean }>({ key: '', data: null, message: '', requestedDate: null, sourceDate: null, fallback: false })
  useEffect(() => {
    let active = true
    if (!saveId || !date) return
    void loadBestLeagueReference(saveId, date).then(selection => {
      if (!active) return
      setState({
        key,
        data: selection.data,
        requestedDate: selection.requestedDate,
        sourceDate: selection.sourceDate,
        fallback: selection.fallback,
        message: selection.data ? '' : 'Nenhuma referência de liga utilizável foi encontrada neste save.',
      })
    }).catch(() => {
      if (active) setState({ key, data: null, requestedDate: date, sourceDate: null, fallback: false, message: 'Não foi possível carregar o comparativo de liga.' })
    })
    return () => { active = false }
  }, [saveId, date, revision, key])
  return state.key === key ? state : { key, data: null, requestedDate: date, sourceDate: null, fallback: false, message: saveId && date ? 'Carregando comparativo…' : 'Checkpoint indisponível.' }
}

/** Multiplayer is intentionally out of scope for now: exactly one human team is the reference. */
export function referenceTeamForSave(data: LeagueReference | null): number | null {
  return data?.humanTeams.length === 1 ? data.humanTeams[0].team : null
}

export function LeagueComparisonHint({ data, team, pairs, message, requestedDate, sourceDate, fallback, children }: {
  data: LeagueReference | null
  team: number | null
  pairs: LeagueRolePair[]
  message: string
  requestedDate: string | null
  sourceDate: string | null
  fallback: boolean
  children: ReactNode
}) {
  const id = useId(), anchor = useRef<HTMLSpanElement>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const close = () => { if (timer.current) clearTimeout(timer.current); setAt(null) }
  const hold = () => { if (timer.current) clearTimeout(timer.current) }
  const show = () => {
    hold()
    const r = anchor.current?.firstElementChild?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(500, window.innerWidth - 16)
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 250)) })
  }
  const leave = () => { hold(); timer.current = setTimeout(() => setAt(null), 150) }
  useEffect(() => {
    if (!at) return
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', escape); window.addEventListener('resize', close)
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('resize', close) }
  }, [Boolean(at)])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const comparison = useMemo(() => at && data && team !== null ? leagueComparisons(data, team) : null, [Boolean(at), data, team])
  const fmt = (n: number | null) => n === null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const checkpoint = displayDate(sourceDate ?? requestedDate ?? data?.checkpoint)

  return <span ref={anchor} className="league-hint-anchor" onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={leave} aria-describedby={at ? id : undefined}>
    {isValidElement<{ 'aria-describedby'?: string }>(children) ? cloneElement(children, { 'aria-describedby': at ? id : undefined }) : children}
    {at && createPortal(<div id={id} role="tooltip" className="league-comparison-tooltip" data-reference-fallback={fallback ? 'true' : undefined} style={{ ...at, maxHeight: Math.max(160, window.innerHeight - at.top - 8) }} onMouseEnter={hold} onMouseLeave={leave}>
      <header className="league-comparison-header">
        <span className="league-comparison-info" aria-hidden="true">i</span>
        <strong>Comparativo de liga</strong>
        <span className="league-comparison-checkpoint">Checkpoint {checkpoint}</span>
      </header>

      {!data ? <div className="league-comparison-empty">{message || 'Sem comparativo disponível.'}</div>
        : team === null ? <div className="league-comparison-empty">{data.humanTeams.length > 1 ? 'Comparativo indisponível para saves multiplayer.' : 'Equipe do save não identificada.'}</div>
        : !comparison?.rows.length ? <div className="league-comparison-empty">{leagueReason(comparison?.current.reason ?? 'no_current_calendar')}</div>
        : <div className="league-comparison-content">
          {pairs.map((pair, index) => <section className="league-comparison-role" key={index}>
            {pairs.length > 1 && <div className="league-comparison-role-label">{pair.label}</div>}
            <div className="league-comparison-cards">{comparison.rows.map(row => {
              const summary = summarizeLeagueRole(data, row.population, pair)
              const label = row.direction === 'current' ? 'Sua liga' : row.direction === 'down' ? 'Divisão inferior' : 'Referência mundial'
              return <article className={`league-reference-card is-${row.direction}`} key={`${row.direction}-${row.target}`}>
                <header>{label}</header>
                {summary && summary.cutoffMean !== null ? <div className="league-reference-summary">
                  <div className="league-reference-cutoff"><span>Nota de corte média:</span><strong>{fmt(summary.cutoffMean)}</strong></div>
                  <div className="league-reference-best"><span>Melhor jogador</span><strong title={summary.best?.name ?? undefined}>{summary.best?.name ?? '—'}</strong><b>{summary.best ? fmt(summary.best.score) : '—'}</b></div>
                </div> : <div className="league-reference-unavailable">{leagueReason(summary?.reason ?? (row.population.reason === 'adjacent_unresolved' ? row.reason : row.population.reason))}</div>}
              </article>
            })}</div>
          </section>)}
        </div>}
    </div>, document.body)}
  </span>
}
