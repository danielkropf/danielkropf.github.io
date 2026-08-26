import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attributeScore, combinedPhaseScore } from '../lib/scoring'
import { ScoreBadge } from '../components/ScoreBadge'
import { percentile, referenceScore, type ReferenceDataset } from '../lib/reference'
import { roleDefaultWeights } from '../lib/roleWeights'
import { canPlayPosition } from '../lib/positions'
import { loadCurrentPlayers, loadReferenceDataset } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { PlayerPeek } from '../components/PlayerPeek'
import { loadModelConfig, patchModelConfig, scheduleModelConfigPatch } from '../lib/model-config'
import { derivePlanningAssignmentIndex } from '../lib/planningDistribution'
import {
  groupEquivalentSets,
  layoutsFor,
  movePlanningSet,
  movePlayerToSet,
  positionFamily,
  primarySetForPlayer,
  removePlayerFromPlanning,
  renamePlanningSet,
  reorderPlanningSets,
  restoreDefaultPlanningSets,
  splitPlanningSet,
  type FlexiblePlanning,
  type PlanningSetLayout,
  type TacticSlotDescriptor,
} from '../lib/planningSets'

type Attribute = { attribute_key: string; attribute_label: string; value: number; category: string }
type Snapshot = { snapshot_date: string; age: number | null; positions: string[]; club: string | null; squad: string | null; preferred_foot: string | null; height: number | null; weight: number | null; player_attributes: Attribute[] }
type Player = { id: string; current_name: string; nationality: string | null; player_snapshots: Snapshot[] }
type Group = { id: string; name: string }
type Planning = FlexiblePlanning & { groups: Group[] }
type Assignment = { playerId: string; nodeId: string; position: string; roleId?: string; roleCode: string; roleName: string }
type Pair = { ip: Assignment; oop: Assignment }
type Tactic = { id: string; name: string; ipAssignments: Assignment[]; oopAssignments: Assignment[]; roles?: { id: string; name: string; weights: Record<string, number> }[] }
type Config = Record<string, unknown> & { planning?: Planning; tactics?: Tactic[]; selected_tactic_id?: string | null; role_weight_overrides?: Record<string, Record<string, number>> }
type DragItem = { type: 'player'; id: string }
type Menu = { x: number; y: number; playerId: string }

const transferGroups: Group[] = [{ id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }]
const EMPTY_ROLE_OVERRIDES: Record<string, Record<string, number>> = {}
const defaults = (): Planning => ({ groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'base', name: 'Base' }, ...transferGroups], slotAssignments: {}, setLayouts: {} })
const canPlay = canPlayPosition

export function PlanningPage() {
  const { selected } = useSaves()
  const navigate = useNavigate()
  const [players, setPlayers] = useState<Player[]>([])
  const [reference, setReference] = useState<ReferenceDataset | null>(null)
  const [config, setConfig] = useState<Config>({ planning: defaults() })
  const [undoPlanning, setUndoPlanning] = useState<Planning | null>(null)
  const [status, setStatus] = useState('Carregando…')
  const [search, setSearch] = useState('')
  const [positionFilters, setPositionFilters] = useState<string[]>([])
  const [dragging, setDragging] = useState<DragItem | null>(null)
  const [draggingSetId, setDraggingSetId] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState('principal')
  const [manageSquadsOpen, setManageSquadsOpen] = useState(false)
  const [manageSetsOpen, setManageSetsOpen] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [showCoverages, setShowCoverages] = useState(false)
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const loaded = useRef(false)

  useEffect(() => { void loadReferenceDataset().then(setReference) }, [])
  useEffect(() => {
    let active = true
    loaded.current = false
    setUndoPlanning(null)
    setExpandedSets(new Set())
    if (!supabase || !selected) return () => { active = false }
    setLoading(true)
    setStatus('Carregando…')
    void Promise.all([loadCurrentPlayers(selected.id), loadModelConfig(selected.id)]).then(([cached, modelConfig]) => {
      if (!active) return
      startTransition(() => {
        setPlayers(cached as unknown as Player[])
        const existing = modelConfig as Config
        const old = existing.planning as (Planning & { assignments?: Record<string, string> }) | undefined
        const loadedPlanning: Planning = old ? {
          ...defaults(),
          groups: old.groups ?? defaults().groups,
          slotAssignments: old.slotAssignments ?? {},
          setLayouts: old.setLayouts ?? {},
        } : defaults()
        const next: Planning = {
          ...loadedPlanning,
          groups: [...loadedPlanning.groups, ...transferGroups.filter(required => !loadedPlanning.groups.some(group => group.id === required.id))],
        }
        setConfig({ ...existing, planning: next })
        setSelectedGroup(next.groups[0]?.id ?? '')
        loaded.current = true
        setStatus('Salvo automaticamente')
        setLoading(false)
      })
    }).catch(error => {
      if (active) {
        setStatus(`Erro ao carregar dados: ${error instanceof Error ? error.message : 'falha desconhecida'}`)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [selected?.id])
  useEffect(() => {
    if (!loaded.current || !selected || !supabase) return
    scheduleModelConfigPatch(selected.id, '2.9.0', { planning: config.planning ?? defaults() }, setStatus)
  }, [config.planning, selected?.id])
  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const planning = config.planning ?? defaults()
  const assignmentIndex = useMemo(() => derivePlanningAssignmentIndex(planning.slotAssignments), [planning.slotAssignments])
  const tactics = config.tactics ?? []
  const tactic = tactics.find(item => item.id === config.selected_tactic_id) ?? tactics[0]
  const pairs: Pair[] = useMemo(() => tactic ? tactic.ipAssignments.map(ip => ({ ip, oop: tactic.oopAssignments.find(oop => oop.playerId === ip.playerId) ?? ip })) : [], [tactic])
  const slotDescriptors: TacticSlotDescriptor[] = useMemo(() => pairs.map(pair => ({ id: pair.ip.playerId, position: pair.ip.position })), [pairs])
  const pairBySlot = useMemo(() => new Map(pairs.map(pair => [pair.ip.playerId, pair])), [pairs])
  const roleOverrides = config.role_weight_overrides ?? EMPTY_ROLE_OVERRIDES
  const latestByPlayer = useMemo(() => new Map(players.map(player => [player.id, player.player_snapshots[0]])), [players])
  const latest = (player: Player) => latestByPlayer.get(player.id)

  function roleScore(player: Player, slot: Assignment) {
    const snapshot = latest(player)
    const id = slot.roleId ?? slot.roleCode
    const weights = roleOverrides[id] ?? tactic?.roles?.find(role => role.id === id)?.weights ?? roleDefaultWeights(id, slot.roleName)
    return snapshot ? attributeScore(snapshot.player_attributes.map(attribute => ({ key: attribute.attribute_key, value: attribute.value, weight: weights[attribute.attribute_key] ?? 3 }))) : null
  }

  const referenceRatings = useMemo(() => new Map(pairs.map(pair => {
    const ipId = pair.ip.roleId ?? pair.ip.roleCode
    const oopId = pair.oop.roleId ?? pair.oop.roleCode
    const ipWeights = roleOverrides[ipId] ?? tactic?.roles?.find(role => role.id === ipId)?.weights ?? roleDefaultWeights(ipId, pair.ip.roleName)
    const oopWeights = roleOverrides[oopId] ?? tactic?.roles?.find(role => role.id === oopId)?.weights ?? roleDefaultWeights(oopId, pair.oop.roleName)
    const ratings = (reference?.players ?? [])
      .filter(player => canPlay([player.p], pair.ip.position))
      .map(player => combinedPhaseScore(referenceScore(player, reference!.attributes, ipWeights), referenceScore(player, reference!.attributes, oopWeights)))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)
    return [pair.ip.playerId, ratings]
  })), [pairs, reference, roleOverrides, tactic])

  const playerScores = useMemo(() => new Map(players.map(player => [player.id, new Map(pairs.map(pair => {
    const value = combinedPhaseScore(roleScore(player, pair.ip), roleScore(player, pair.oop))
    const rank = value === null ? null : percentile(value, referenceRatings.get(pair.ip.playerId) ?? [])
    return [pair.ip.playerId, { value, rank }]
  }))])), [players, pairs, referenceRatings, roleOverrides, tactic])
  const pairRating = (player: Player, pair: Pair) => playerScores.get(player.id)?.get(pair.ip.playerId)?.value ?? null
  const pairPercentile = (player: Player, pair: Pair) => playerScores.get(player.id)?.get(pair.ip.playerId)?.rank ?? null
  function bestPair(player: Player) {
    const positions = latest(player)?.positions ?? []
    const natural = pairs.filter(pair => canPlay(positions, pair.ip.position))
    const pool = natural.length ? natural : pairs
    return pool.reduce<Pair | undefined>((best, pair) => !best || (pairRating(player, pair) ?? -1) > (pairRating(player, best) ?? -1) ? pair : best, undefined)
  }
  const roster = useMemo(() => players.map(player => {
    const selectedPairs = positionFilters.map(id => pairBySlot.get(id)).filter((pair): pair is Pair => Boolean(pair))
    const pair = selectedPairs.length
      ? selectedPairs.reduce<Pair | undefined>((best, current) => !best || (pairRating(player, current) ?? -1) > (pairRating(player, best) ?? -1) ? current : best, undefined)
      : bestPair(player)
    const score = pair ? pairRating(player, pair) : null
    const rank = pair ? pairPercentile(player, pair) : null
    const positions = latest(player)?.positions ?? []
    const compatible = selectedPairs.length ? selectedPairs.some(current => canPlay(positions, current.ip.position) || canPlay(positions, current.oop.position)) : true
    return { player, score, rank, compatible }
  }).filter(row => !assignmentIndex[row.player.id] && row.player.current_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.compatible) - Number(a.compatible) || (b.score ?? 0) - (a.score ?? 0) || a.player.current_name.localeCompare(b.player.current_name, 'pt-BR')), [players, search, positionFilters, pairs, pairBySlot, playerScores, assignmentIndex, latestByPlayer])

  const currentGroupIndex = Math.max(0, planning.groups.findIndex(group => group.id === selectedGroup))
  const currentGroup = planning.groups[currentGroupIndex]
  const isTransferGroup = Boolean(currentGroup && transferGroups.some(group => group.id === currentGroup.id))
  const currentSets = useMemo(() => tactic && currentGroup && !isTransferGroup ? layoutsFor(planning, tactic.id, currentGroup.id, slotDescriptors) : [], [planning, tactic, currentGroup, isTransferGroup, slotDescriptors])
  const activePlayer = players.find(player => player.id === dragging?.id)
  const currentGroupPlayerIds = useMemo(() => new Set(Object.values(planning.slotAssignments[currentGroup?.id ?? ''] ?? {}).flat().filter(Boolean)), [planning.slotAssignments, currentGroup?.id])

  function update(fn: (planning: Planning) => Planning) {
    const previous = planning
    const next = fn(previous)
    if (next === previous) return
    setUndoPlanning(previous)
    setConfig(current => ({ ...current, planning: next }))
  }
  function undo() {
    if (!undoPlanning) return
    setConfig(current => ({ ...current, planning: undoPlanning }))
    setUndoPlanning(null)
  }
  function changeGroup(direction: number) {
    if (!planning.groups.length) return
    const next = (currentGroupIndex + direction + planning.groups.length) % planning.groups.length
    setSelectedGroup(planning.groups[next].id)
    setExpandedSets(new Set())
  }
  function addGroup() {
    if (!newGroup.trim()) return
    update(value => ({ ...value, groups: [...value.groups, { id: crypto.randomUUID(), name: newGroup.trim() }] }))
    setNewGroup('')
  }
  function renameGroup(id: string, name: string) { update(value => ({ ...value, groups: value.groups.map(group => group.id === id ? { ...group, name } : group) })) }
  function removeGroup(id: string) {
    if (!confirm('Excluir este elenco?')) return
    update(value => {
      const setLayouts = Object.fromEntries(Object.entries(value.setLayouts ?? {}).map(([tacticId, groups]) => [tacticId, Object.fromEntries(Object.entries(groups).filter(([groupId]) => groupId !== id))]))
      return { ...value, groups: value.groups.filter(group => group.id !== id), slotAssignments: Object.fromEntries(Object.entries(value.slotAssignments).filter(([groupId]) => groupId !== id)), setLayouts }
    })
  }
  function removePlayer(id: string) { update(value => removePlayerFromPlanning(value, id) as Planning) }
  function clearPlanning() { update(value => ({ ...value, slotAssignments: {} })) }
  function clearGroup(groupId: string) {
    update(value => {
      const removed = Object.values(value.slotAssignments[groupId] ?? {}).flat().some(Boolean)
      if (!removed) return value
      return { ...value, slotAssignments: { ...value.slotAssignments, [groupId]: {} } }
    })
  }
  function placePlayer(groupId: string, setId: string, playerId: string, beforePlayerId?: string | null) { update(value => movePlayerToSet(value, groupId, setId, playerId, beforePlayerId) as Planning) }
  function stopPlayerDrag() { setDragging(null) }
  function toggleSet(setId: string) { setExpandedSets(current => { const next = new Set(current); if (next.has(setId)) next.delete(setId); else next.add(setId); return next }) }

  function setPairs(set: PlanningSetLayout) { return set.slotIds.map(id => pairBySlot.get(id)).filter((pair): pair is Pair => Boolean(pair)) }
  function setScore(player: Player, set: PlanningSetLayout) {
    const candidates = setPairs(set).map(pair => ({ pair, value: pairRating(player, pair), rank: pairPercentile(player, pair) }))
    return candidates.reduce<{ pair: Pair | null; value: number | null; rank: number | null }>((best, current) => best.pair === null || (current.value ?? -1) > (best.value ?? -1) ? current : best, { pair: null, value: null, rank: null })
  }
  function compatibleWithSet(player: Player, set: PlanningSetLayout) {
    const positions = latest(player)?.positions ?? []
    return setPairs(set).some(pair => canPlay(positions, pair.ip.position) || canPlay(positions, pair.oop.position))
  }
  function coveragePlayers(set: PlanningSetLayout) {
    if (!currentGroup) return []
    return players.filter(player => {
      if (!currentGroupPlayerIds.has(player.id) || !compatibleWithSet(player, set)) return false
      const primary = primarySetForPlayer(planning, currentGroup.id, currentSets, player.id)
      return Boolean(primary && primary.id !== set.id)
    })
  }
  function primaryLabel(playerId: string) { return currentGroup ? primarySetForPlayer(planning, currentGroup.id, currentSets, playerId)?.label ?? 'Outro conjunto' : 'Outro conjunto' }

  function groupSet(setId: string) {
    if (!tactic || !currentGroup) return
    update(value => groupEquivalentSets(value, tactic.id, currentGroup.id, currentSets, setId, slotDescriptors, `set-${crypto.randomUUID()}`) as Planning)
  }
  function splitSet(setId: string) {
    if (!tactic || !currentGroup) return
    update(value => splitPlanningSet(value, tactic.id, currentGroup.id, currentSets, setId, slotDescriptors) as Planning)
  }
  function renameSet(setId: string, label: string) {
    if (!tactic || !currentGroup) return
    update(value => renamePlanningSet(value, tactic.id, currentGroup.id, currentSets, setId, label) as Planning)
  }
  function moveSet(setId: string, direction: -1 | 1) {
    if (!tactic || !currentGroup) return
    update(value => movePlanningSet(value, tactic.id, currentGroup.id, currentSets, setId, direction) as Planning)
  }
  function reorderSet(draggedId: string, beforeId: string) {
    if (!tactic || !currentGroup) return
    update(value => reorderPlanningSets(value, tactic.id, currentGroup.id, currentSets, draggedId, beforeId) as Planning)
  }
  function restoreSets() {
    if (!tactic || !currentGroup) return
    update(value => restoreDefaultPlanningSets(value, tactic.id, currentGroup.id, currentSets, slotDescriptors) as Planning)
  }
  function canGroup(set: PlanningSetLayout) {
    const pair = pairBySlot.get(set.slotIds[0])
    if (!pair || set.slotIds.length > 1) return false
    const family = positionFamily(pair.ip.position)
    return currentSets.filter(candidate => candidate.slotIds.some(id => positionFamily(pairBySlot.get(id)?.ip.position ?? '') === family)).length > 1
  }

  return <div className="screen-page planning-page planning-flex-page">
    <div className="title-row"><h1>Planejamento</h1><div className="planning-header-actions"><span className="save-state">{status}</span>{(loading || isPending) && <span className="background-loading" role="status">Carregando em segundo plano…</span>}</div></div>

    <section className="planning-matrix-toolbar planning-aligned-toolbar planning-flex-toolbar">
      <select value={tactic?.id ?? ''} onChange={event => {
        const id = event.target.value || null
        setConfig(current => ({ ...current, selected_tactic_id: id }))
        setExpandedSets(new Set())
        if (selected) void patchModelConfig(selected.id, '2.9.0', { selected_tactic_id: id }).then(() => setStatus('Salvo automaticamente')).catch(error => setStatus(`Erro: ${error instanceof Error ? error.message : 'falha ao salvar'}`))
      }}><option value="">Selecione uma tática</option>{tactics.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      {!isTransferGroup && tactic && <label className="coverage-toggle"><input type="checkbox" checked={showCoverages} onChange={event => setShowCoverages(event.target.checked)} /><span>Mostrar coberturas</span></label>}
      <div className="squad-navigation-row">
        <div className="squad-pagination"><button onClick={() => changeGroup(-1)} disabled={planning.groups.length < 2}>‹</button><strong>{currentGroup?.name ?? 'Nenhum elenco'}</strong><span>{planning.groups.length ? `${currentGroupIndex + 1} / ${planning.groups.length}` : '0 / 0'}</span><button onClick={() => changeGroup(1)} disabled={planning.groups.length < 2}>›</button></div>
        <button className="ghost undo-planning-button" onClick={undo} disabled={!undoPlanning} title="Desfazer a última alteração do planejamento" aria-label="Desfazer a última alteração do planejamento">↶</button>
        <button className="ghost clear-planning-button" onClick={clearPlanning} disabled={!Object.keys(assignmentIndex).length}>Limpar elencos</button>
        {!isTransferGroup && tactic && <button className="ghost manage-sets-button" onClick={() => setManageSetsOpen(true)}>Gerenciar conjuntos</button>}
        <button className="ghost manage-squads-button" onClick={() => setManageSquadsOpen(true)}>Gerenciar elencos</button>
      </div>
    </section>

    <section className="planning-depth-layout planning-flex-layout">
      <article className="planning-column roster-column">
        <header><h2>Elenco</h2><span>{roster.length}</span></header>
        <div className="roster-filters"><input placeholder="Buscar" value={search} onChange={event => setSearch(event.target.value)} /><PositionFilterDropdown pairs={pairs} selected={positionFilters} change={setPositionFilters} /></div>
        <div className="planning-player-list">
          {!players.length && (loading || isPending) && <div className="background-loader-panel" role="status">Carregando elenco… você pode trocar de aba enquanto isso.</div>}
          {roster.map(({ player, score, rank, compatible }) => <RosterPlayerCard player={player} snapshot={latest(player)!} score={score} rank={rank} compatible={compatible} drag={() => setDragging({ type: 'player', id: player.id })} dragEnd={stopPlayerDrag} open={() => navigate(`/players/${player.id}`)} key={player.id} />)}
        </div>
      </article>

      <div className="planning-flex-board">
        {isTransferGroup && currentGroup ? <TransferGroupPanel group={currentGroup} playerIds={planning.slotAssignments[currentGroup.id]?.market ?? []} players={players} latest={latest} dragging={Boolean(activePlayer)} drop={() => { if (activePlayer) placePlayer(currentGroup.id, 'market', activePlayer.id); stopPlayerDrag() }} startDrag={id => setDragging({ type: 'player', id })} dragEnd={stopPlayerDrag} open={id => navigate(`/players/${id}`)} remove={removePlayer} clear={() => clearGroup(currentGroup.id)} />
          : tactic && currentGroup ? <>
            <header className="planning-flex-board-header"><div><span className="eyebrow">{tactic.name}</span><h2>{currentGroup.name}</h2><p>{currentGroupPlayerIds.size} jogador{currentGroupPlayerIds.size === 1 ? '' : 'es'} com alocação principal</p></div><button className="ghost clear-current-flex" onClick={() => clearGroup(currentGroup.id)} disabled={!currentGroupPlayerIds.size}>Limpar {currentGroup.name}</button></header>
            <div className="planning-set-list">
              {currentSets.map(set => <PlanningSetRow
                key={set.id}
                set={set}
                pairs={setPairs(set)}
                assignedIds={planning.slotAssignments[currentGroup.id]?.[set.id] ?? []}
                players={players}
                latest={latest}
                expanded={expandedSets.has(set.id)}
                showCoverages={showCoverages}
                coverages={showCoverages ? coveragePlayers(set) : []}
                primaryLabel={primaryLabel}
                activePlayer={activePlayer}
                draggingSetId={draggingSetId}
                score={player => setScore(player, set)}
                compatible={player => compatibleWithSet(player, set)}
                toggle={() => toggleSet(set.id)}
                startPlayerDrag={id => setDragging({ type: 'player', id })}
                stopPlayerDrag={stopPlayerDrag}
                dropPlayer={(beforePlayerId) => { if (activePlayer) placePlayer(currentGroup.id, set.id, activePlayer.id, beforePlayerId); stopPlayerDrag() }}
                startSetDrag={() => setDraggingSetId(set.id)}
                stopSetDrag={() => setDraggingSetId(null)}
                dropSet={() => { if (draggingSetId) reorderSet(draggingSetId, set.id); setDraggingSetId(null) }}
                open={id => navigate(`/players/${id}`)}
                context={(event, playerId) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, playerId }) }}
              />)}
            </div>
          </> : <div className="empty planning-no-tactic"><h2>Nenhuma tática disponível</h2><p>Crie uma tática para organizar o elenco por posição e função.</p><button onClick={() => navigate('/tactics')}>Criar primeira tática</button></div>}
      </div>
    </section>

    {manageSquadsOpen && <div className="settings-overlay" onClick={() => setManageSquadsOpen(false)}><section className="squad-manager" onClick={event => event.stopPropagation()}><header><h2>Gerenciar elencos</h2><button className="close" onClick={() => setManageSquadsOpen(false)}>×</button></header><div className="squad-manager-list">{planning.groups.map(group => { const fixed = transferGroups.some(item => item.id === group.id); return <div className={fixed ? 'fixed-planning-group' : ''} key={group.id}><input value={group.name} readOnly={fixed} onChange={event => renameGroup(group.id, event.target.value)} />{fixed ? <span>Grupo de mercado</span> : <button className="column-delete" onClick={() => removeGroup(group.id)}>Excluir</button>}</div> })}</div><footer><input placeholder="Novo elenco" value={newGroup} onChange={event => setNewGroup(event.target.value)} onKeyDown={event => event.key === 'Enter' && addGroup()} /><button onClick={addGroup}>+ Adicionar</button></footer></section></div>}

    {manageSetsOpen && tactic && currentGroup && !isTransferGroup && <div className="settings-overlay" onClick={() => setManageSetsOpen(false)}><section className="squad-manager planning-set-manager" onClick={event => event.stopPropagation()}><header><div><h2>Gerenciar conjuntos</h2><p>Organização visual de {currentGroup.name}; a tática não é alterada.</p></div><button className="close" onClick={() => setManageSetsOpen(false)}>×</button></header><div className="planning-set-manager-list">{currentSets.map((set, index) => <div className="planning-set-manager-row" key={set.id}><span className="set-manager-order">{index + 1}</span><input value={set.label} onChange={event => renameSet(set.id, event.target.value)} /><small>{set.slotIds.length} posição{set.slotIds.length === 1 ? '' : 'ões'}</small><div><button className="ghost" onClick={() => moveSet(set.id, -1)} disabled={index === 0} aria-label="Mover conjunto para cima">↑</button><button className="ghost" onClick={() => moveSet(set.id, 1)} disabled={index === currentSets.length - 1} aria-label="Mover conjunto para baixo">↓</button>{set.slotIds.length > 1 ? <button className="ghost" onClick={() => splitSet(set.id)}>Separar</button> : canGroup(set) ? <button className="ghost" onClick={() => groupSet(set.id)}>Agrupar equivalentes</button> : null}</div></div>)}</div><footer><button className="ghost" onClick={restoreSets}>Restaurar ordem e grupos da tática</button><button onClick={() => setManageSetsOpen(false)}>Concluir</button></footer></section></div>}

    {menu && <div className="planning-context-menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}><button onClick={() => { removePlayer(menu.playerId); setMenu(null) }}>Remover do elenco</button></div>}
  </div>
}

function PlanningSetRow({ set, pairs, assignedIds, players, latest, expanded, showCoverages, coverages, primaryLabel, activePlayer, draggingSetId, score, compatible, toggle, startPlayerDrag, stopPlayerDrag, dropPlayer, startSetDrag, stopSetDrag, dropSet, open, context }: {
  set: PlanningSetLayout
  pairs: Pair[]
  assignedIds: string[]
  players: Player[]
  latest: (player: Player) => Snapshot | undefined
  expanded: boolean
  showCoverages: boolean
  coverages: Player[]
  primaryLabel: (playerId: string) => string
  activePlayer?: Player
  draggingSetId: string | null
  score: (player: Player) => { pair: Pair | null; value: number | null; rank: number | null }
  compatible: (player: Player) => boolean
  toggle: () => void
  startPlayerDrag: (id: string) => void
  stopPlayerDrag: () => void
  dropPlayer: (beforePlayerId?: string | null) => void
  startSetDrag: () => void
  stopSetDrag: () => void
  dropSet: () => void
  open: (id: string) => void
  context: (event: ReactMouseEvent, playerId: string) => void
}) {
  const members = assignedIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  const grouped = set.slotIds.length > 1
  const compactLimit = grouped ? 8 : 4
  const visible = expanded ? members : members.slice(0, compactLimit)
  const hidden = Math.max(0, members.length - visible.length)
  const linePosition = pairs[0]?.ip.position ?? ''
  const ipRoles = [...new Set(pairs.map(pair => pair.ip.roleCode))]
  const oopRoles = [...new Set(pairs.map(pair => pair.oop.roleCode))]
  const activeCompatible = Boolean(activePlayer && compatible(activePlayer))
  return <article className={`planning-set-row planning-line-${planningLine(linePosition)} ${grouped ? 'is-grouped' : ''} ${draggingSetId === set.id ? 'is-line-dragging' : ''}`} onDragOver={event => { if (draggingSetId || activePlayer) event.preventDefault() }} onDrop={event => { event.preventDefault(); if (draggingSetId) dropSet(); else if (activePlayer) dropPlayer(null) }}>
    <header className="planning-set-header">
      <button className="planning-set-handle" draggable onDragStart={event => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; startSetDrag() }} onDragEnd={stopSetDrag} title="Arrastar para reordenar" aria-label={`Reordenar ${set.label}`}>↕</button>
      <div><span className="planning-set-title"><strong>{set.label}</strong>{grouped && <b>{set.slotIds.length} POSIÇÕES</b>}</span><small><i>IP</i> {ipRoles.join(' / ') || '—'} <em>·</em> <i>OOP</i> {oopRoles.join(' / ') || '—'}</small></div>
      <span className="planning-set-count">{members.length}</span>
    </header>
    <div className={`planning-set-cards ${activeCompatible ? 'is-compatible-drop' : activePlayer ? 'is-training-drop' : ''}`} onDragOver={event => { if (activePlayer) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); dropPlayer(null) }}>
      {visible.map(player => {
        const snapshot = latest(player)
        const rating = score(player)
        return snapshot ? <BoardPlayerCard key={player.id} player={player} snapshot={snapshot} score={rating.value} rank={rating.rank} drag={() => startPlayerDrag(player.id)} dragEnd={stopPlayerDrag} dropBefore={() => dropPlayer(player.id)} open={() => open(player.id)} context={event => context(event, player.id)} /> : null
      })}
      {!members.length && <div className="planning-set-empty"><b>Nenhum jogador planejado</b><span>Arraste jogadores aqui</span></div>}
      {!expanded && hidden > 0 && <button className="planning-set-expand" onClick={toggle}>+{hidden}</button>}
      {expanded && members.length > compactLimit && <button className="planning-set-expand collapse" onClick={toggle}>−</button>}
    </div>
    {showCoverages && coverages.length > 0 && <div className="planning-set-coverages"><span>Cobertura</span><div>{coverages.map(player => { const snapshot = latest(player); const rating = score(player); return snapshot ? <CoverageCard key={player.id} player={player} snapshot={snapshot} score={rating.value} rank={rating.rank} source={primaryLabel(player.id)} drag={() => startPlayerDrag(player.id)} dragEnd={stopPlayerDrag} drop={() => dropPlayer(null)} open={() => open(player.id)} /> : null })}</div></div>}
  </article>
}

function BoardPlayerCard({ player, snapshot, score, rank, drag, dragEnd, dropBefore, open, context }: { player: Player; snapshot: Snapshot; score: number | null; rank: number | null; drag: () => void; dragEnd: () => void; dropBefore: () => void; open: () => void; context: (event: ReactMouseEvent) => void }) {
  return <article className="planning-set-player-card" draggable onDragStart={event => { event.stopPropagation(); drag() }} onDragEnd={dragEnd} onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move' }} onDrop={event => { event.preventDefault(); event.stopPropagation(); dropBefore() }} onContextMenu={context}><button className="player-name" onClick={event => { event.stopPropagation(); open() }}>{player.current_name}</button><small>{snapshot.age ?? '—'} anos</small><ScoreBadge value={score} rank={rank} showTitle={false} /></article>
}

function CoverageCard({ player, snapshot, score, rank, source, drag, dragEnd, drop, open }: { player: Player; snapshot: Snapshot; score: number | null; rank: number | null; source: string; drag: () => void; dragEnd: () => void; drop: () => void; open: () => void }) {
  return <article className="planning-coverage-card" draggable onDragStart={drag} onDragEnd={dragEnd} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop() }}><div><button className="player-name" onClick={open}>{player.current_name}</button><small>{snapshot.age ?? '—'} anos · Principal: {source}</small></div><span>Cobertura</span><ScoreBadge value={score} rank={rank} showTitle={false} /></article>
}

function RosterPlayerCard({ player, snapshot, score, rank, compatible, drag, dragEnd, open }: { player: Player; snapshot: Snapshot; score: number | null; rank: number | null; compatible: boolean; drag: () => void; dragEnd: () => void; open: () => void }) {
  return <div className={`planning-player roster-player-card ${!compatible ? 'incompatible' : ''}`} draggable onDragStart={drag} onDragEnd={dragEnd}><PlayerPeek player={player} snapshot={snapshot} /><div className="roster-player-main"><button className="player-name" onClick={event => { event.stopPropagation(); open() }}>{player.current_name}</button><span>{snapshot.positions.join(', ') || 'Sem posição informada'}</span><small>{snapshot.age ?? '—'} anos · {snapshot.height ? `${snapshot.height} cm` : 'Altura —'} · {footLabel(snapshot.preferred_foot)}</small></div><ScoreBadge value={score} rank={rank} /></div>
}

function TransferGroupPanel({ group, playerIds, players, latest, dragging, drop, startDrag, dragEnd, open, remove, clear }: { group: Group; playerIds: string[]; players: Player[]; latest: (player: Player) => Snapshot | undefined; dragging: boolean; drop: () => void; startDrag: (id: string) => void; dragEnd: () => void; open: (id: string) => void; remove: (id: string) => void; clear: () => void }) {
  const members = playerIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  return <section className={`transfer-group-panel ${dragging ? 'is-receiving' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop() }}><header><div><span>Grupo de mercado</span><h2>{group.name}</h2></div><div className="transfer-group-actions"><strong>{members.length} jogador{members.length === 1 ? '' : 'es'}</strong><button className="clear-current-group" onClick={clear} disabled={!members.length} title={`Limpar somente ${group.name}`} aria-label={`Limpar somente ${group.name}`}><TrashIcon /></button></div></header><div className="transfer-player-grid">{members.map(player => { const snapshot = latest(player); return snapshot ? <article className="transfer-player-card" draggable onDragStart={() => startDrag(player.id)} onDragEnd={dragEnd} key={player.id}><PlayerPeek player={player} snapshot={snapshot} /><div className="transfer-player-info"><button className="player-name" onClick={() => open(player.id)}>{player.current_name}</button><span>{snapshot.positions.join(', ') || 'Sem posição'}</span><small>{snapshot.age ?? '—'} anos · {snapshot.club ?? 'Sem clube'}</small></div><button className="transfer-remove" onClick={() => remove(player.id)} title={`Remover ${player.current_name} de ${group.name}`} aria-label={`Remover ${player.current_name} de ${group.name}`}>×</button></article> : null })}{!members.length && <div className="transfer-empty"><b>Arraste jogadores para {group.name.toLowerCase()}</b><span>Este grupo não utiliza posições ou funções da tática.</span></div>}</div>{dragging && <div className="transfer-drop-hint">Solte para adicionar a {group.name}</div>}</section>
}

function PositionFilterDropdown({ pairs, selected, change }: { pairs: Pair[]; selected: string[]; change: (ids: string[]) => void }) {
  const label = !selected.length ? 'Todas as posições' : selected.length === 1 ? '1 posição selecionada' : `${selected.length} posições selecionadas`
  return <details className="position-multi-filter"><summary>{label}<span>⌄</span></summary><div className="position-multi-menu"><header><b>Posições da tática</b>{selected.length > 0 && <button type="button" onClick={() => change([])}>Limpar</button>}</header>{pairs.map(pair => { const checked = selected.includes(pair.ip.playerId); return <label className={`planning-line-${planningLine(pair.ip.position)}`} key={pair.ip.playerId}><input type="checkbox" checked={checked} onChange={event => change(event.target.checked ? [...selected, pair.ip.playerId] : selected.filter(id => id !== pair.ip.playerId))} /><span><b>{pair.ip.position}</b> {pair.ip.roleCode}</span><i>→</i><span><b>{pair.oop.position}</b> {pair.oop.roleCode}</span></label> })}</div></details>
}

function TrashIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" /></svg> }
function planningLine(position: string) { const value = position.toUpperCase().replaceAll(' ', ''); if (value.startsWith('GK')) return 'gk'; if (value.startsWith('ST')) return 'st'; if (value.startsWith('AM')) return 'am'; if (value.startsWith('M')) return 'm'; if (value.startsWith('DM') || value.startsWith('WB')) return 'dm'; return 'd' }
const footLabel = (foot: string | null) => foot ? `Pé ${foot}` : 'Pé —'
