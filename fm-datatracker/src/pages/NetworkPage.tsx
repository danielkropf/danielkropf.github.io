import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSaves } from '../features/saves/SaveContext'
import { loadCurrentPlayers, type RichPlayer } from '../lib/dataCache'
import { loadModelConfig } from '../lib/model-config'
import { deriveNetworkBalance, globalPlannedClubIndex, type NetworkConfig } from '../lib/network-planning'

type Player = RichPlayer

export function NetworkPage() {
  const { selected } = useSaves()
  const [players, setPlayers] = useState<Player[]>([])
  const [config, setConfig] = useState<NetworkConfig>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentFilter, setCurrentFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [plannedFilter, setPlannedFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const clubs = selected?.structure?.trackedClubs.filter(item => item.is_active) ?? []

  useEffect(() => {
    let active = true
    if (!selected) return () => { active = false }
    setLoading(true); setError('')
    void Promise.all([loadCurrentPlayers(selected.id), loadModelConfig(selected.id)])
      .then(([rows, model]) => { if (active) { setPlayers(rows); setConfig(model as NetworkConfig) } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar a rede.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selected?.id])

  const balance = useMemo(() => deriveNetworkBalance(clubs.map(item => item.club_id), config), [clubs, config])
  const index = useMemo(() => globalPlannedClubIndex(config), [config])
  const clubNames = useMemo(() => new Map(clubs.map(item => [item.club_id, item.club.name])), [clubs])
  const source = useMemo(() => players.map(player => {
    const snapshot = player.player_snapshots[0]
    const factual = player.current_factual
    const plannedId = index.clubByPlayer[player.id] ?? null
    const current = factual.currentClubName ?? snapshot?.club ?? null
    const owner = factual.ownerClubName
    const team = snapshot?.squad ?? 'Não resolvida'
    return { player, snapshot, factual, current, plannedId, owner, team, conflicts: index.conflicts[player.id] ?? [] }
  }), [players, index])
  const pool = useMemo(() => source.filter(row => (currentFilter === 'all' || row.current === currentFilter)
    && (ownerFilter === 'all' || row.owner === ownerFilter)
    && (plannedFilter === 'all' || (plannedFilter === 'none' ? !row.plannedId : row.plannedId === plannedFilter))
    && (teamFilter === 'all' || row.team === teamFilter)), [source, currentFilter, ownerFilter, plannedFilter, teamFilter])
  const currentClubs = useMemo(() => [...new Set(source.map(row => row.current).filter((value): value is string => Boolean(value)))].sort(), [source])
  const owners = useMemo(() => [...new Set(source.map(row => row.owner).filter((value): value is string => Boolean(value)))].sort(), [source])
  const teams = useMemo(() => [...new Set(source.map(row => row.team))].sort(), [source])

  return <div className="roadmap-page">
    <header className="roadmap-heading"><div><span className="eyebrow">NETWORK MANAGER</span><h1>Rede de clubes</h1><p>Pool global, necessidades táticas e destino planejado sem misturar intenção com vínculo factual.</p></div><Link className="button" to="/planning">Abrir Planejamento</Link></header>
    {error && <p className="roadmap-alert">{error}</p>}
    <section className="network-summary">
      {balance.map(item => <article className="card network-club-card" key={item.clubId}>
        <header><div><span className="eyebrow">{item.tacticName ?? 'SEM TÁTICA'}</span><h2>{clubNames.get(item.clubId) ?? 'Clube'}</h2></div><strong className={item.balance < 0 ? 'negative' : item.balance > 0 ? 'positive' : ''}>{item.balance > 0 ? '+' : ''}{item.balance}</strong></header>
        <p>{item.plannedPlayers} jogadores planejados · {item.requiredSlots || '—'} slots</p>
        <div className="need-list">{item.needs.length ? item.needs.map(need => <span className={need.balance < 0 ? 'need-shortage' : need.balance > 0 ? 'need-surplus' : 'need-even'} key={need.group}>{need.group} {need.filled}/{need.required}</span>) : <small>Selecione uma tática para calcular necessidades.</small>}</div>
      </article>)}
      {!clubs.length && <article className="card roadmap-empty"><h2>Nenhum clube acompanhado</h2><p>Adicione clubes ao save para ativar a visão de rede.</p><Link to="/saves">Gerenciar clubes →</Link></article>}
    </section>
    <section className="card network-pool">
      <header><div><span className="eyebrow">POOL GLOBAL</span><h2>{loading ? 'Carregando…' : `${pool.length} jogadores`}</h2></div></header>
      <div className="network-filters"><label>Clube atual<select value={currentFilter} onChange={event => setCurrentFilter(event.target.value)}><option value="all">Todos</option>{currentClubs.map(value => <option key={value}>{value}</option>)}</select></label><label>Clube proprietário<select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}><option value="all">Todos</option>{owners.map(value => <option key={value}>{value}</option>)}</select></label><label>Destino planejado<select value={plannedFilter} onChange={event => setPlannedFilter(event.target.value)}><option value="all">Todos</option><option value="none">Sem destino</option>{clubs.map(item => <option value={item.club_id} key={item.club_id}>{item.club.name}</option>)}</select></label><label>Equipe atual<select value={teamFilter} onChange={event => setTeamFilter(event.target.value)}><option value="all">Todas</option>{teams.map(value => <option key={value}>{value}</option>)}</select></label></div>
      <div className="network-table" role="table"><div className="network-row network-head" role="row"><span>Jogador</span><span>Atual / proprietário</span><span>Destino / equipe</span><span>Situação</span></div>{pool.map(({ player, factual, current, plannedId, owner, team, conflicts }) => <div className="network-row" role="row" key={player.id}><Link to={`/players/${player.id}`}>{player.current_name}</Link><span>{current ?? 'Não resolvido'}<small>{owner ? `Prop.: ${owner}` : factual.membership?.current.ownerClubId.status === 'ambiguous' || factual.membership?.current.ownerClubId.status === 'conflicting' ? 'Proprietário ambíguo' : 'Proprietário não confirmado'}</small></span><span>{plannedId ? clubNames.get(plannedId) ?? 'Clube não acompanhado' : 'Sem destino'}<small>{team}</small></span><span>{conflicts.length ? <b className="negative">Conflito em {conflicts.length} clubes</b> : plannedId ? 'Planejado' : 'Disponível'}</span></div>)}</div>
    </section>
  </div>
}
