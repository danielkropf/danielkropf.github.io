import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attributeScore, combinedPhaseScore } from '../lib/scoring'
import { ScoreBadge } from '../components/ScoreBadge'
import { SaveState } from '../components/SaveState'
import { CustomSelect } from '../components/CustomSelect'
import { PositionSelector, canonicalPosition } from '../components/PositionSelector'
import { percentile, referenceScore, type ReferenceDataset } from '../lib/reference'
import { roleDefaultWeights } from '../lib/roleWeights'
import { canPlayPosition } from '../lib/positions'
import { isPlanningFamiliar, isPlanningOutOfPosition, planningFamiliarity, planningFamiliarityLabel, planningFamiliarityTooltip, type PlanningFamiliarity } from '../lib/planning-familiarity'
import { loadCurrentPlayers, loadReferenceDataset } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { PlayerPeek } from '../components/PlayerPeek'
import { loadModelConfig, patchModelConfig, retryModelConfigPatch, scheduleModelConfigPatch } from '../lib/model-config'
import { describeDbError } from '../lib/db-error'
import { calculatePlanningCardLayout } from '../lib/planning-layout'
import { derivePlanningAssignmentIndex } from '../lib/planningDistribution'
import {
  canGroupAdjacentPlanningSets,
  groupAdjacentPlanningSets,
  layoutsFor,
  movePlayerToSet,
  planningSetDisplayLabel,
  planningSlotDisplayLabel,
  primarySetForPlayer,
  removePlayerFromPlanning,
  renamePlanningSet,
  renamePlanningSlotLabel,
  reorderPlanningGroups,
  reorderPlanningSets,
  restoreDefaultPlanningSets,
  splitPlanningSet,
  type FlexiblePlanning,
  type PlanningSetLayout,
  type TacticSlotDescriptor,
} from '../lib/planningSets'

type Attribute = { attribute_key: string; attribute_label: string; value: number; category: string }
type Snapshot = {
  snapshot_date: string
  age: number | null
  positions: string[]
  club: string | null
  squad: string | null
  preferred_foot: string | null
  height: number | null
  weight: number | null
  normalized_data?: Record<string, unknown>
  player_attributes: Attribute[]
}
type Player = { id: string; current_name: string; nationality: string | null; player_snapshots: Snapshot[] }
type Group = { id: string; name: string }
type Planning = FlexiblePlanning & { groups: Group[] }
type Assignment = { playerId: string; nodeId: string; position: string; roleId?: string; roleCode: string; roleName: string }
type Pair = { ip: Assignment; oop: Assignment }
type Tactic = { id: string; name: string; ipAssignments: Assignment[]; oopAssignments: Assignment[]; roles?: { id: string; name: string; weights: Record<string, number> }[] }
type Config = Record<string, unknown> & { planning?: Planning; tactics?: Tactic[]; selected_tactic_id?: string | null; role_weight_overrides?: Record<string, Record<string, number>> }
type DragItem = { type: 'player'; id: string }
type Menu = { x: number; y: number; playerId: string }
type Familiarity = PlanningFamiliarity
type PlayerDropPreview = { setId: string; beforePlayerId: string | null }
type SetDropPreview = { beforeSetId: string | null }

const transferGroups: Group[] = [{ id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }]
const EMPTY_ROLE_OVERRIDES: Record<string, Record<string, number>> = {}
const defaults = (): Planning => ({ groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'base', name: 'Base' }, ...transferGroups], slotAssignments: {}, setLayouts: {} })
const canPlay = canPlayPosition

function modelDiagnostic(result: { diagnostic?: string | null }) { return result.diagnostic ?? '' }

export function PlanningPage() {
  const { selected } = useSaves()
  const navigate = useNavigate()
  const [players, setPlayers] = useState<Player[]>([])
  const [reference, setReference] = useState<ReferenceDataset | null>(null)
  const [config, setConfig] = useState<Config>({ planning: defaults() })
  const [undoPlanning, setUndoPlanning] = useState<Planning | null>(null)
  const [status, setStatus] = useState('Carregando…')
  const [saveDetail, setSaveDetail] = useState('')
  const [search, setSearch] = useState('')
  const [positionFilters, setPositionFilters] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState<DragItem | null>(null)
  const [draggingSetId, setDraggingSetId] = useState<string | null>(null)
  const [playerDropPreview, setPlayerDropPreview] = useState<PlayerDropPreview | null>(null)
  const [setDropPreview, setSetDropPreview] = useState<SetDropPreview | null>(null)
  const [managerSetDragging, setManagerSetDragging] = useState<string | null>(null)
  const [managerSetPreview, setManagerSetPreview] = useState<string | null | undefined>(undefined)
  const [managerGroupDragging, setManagerGroupDragging] = useState<string | null>(null)
  const [managerGroupPreview, setManagerGroupPreview] = useState<string | null | undefined>(undefined)
  const [selectedGroup, setSelectedGroup] = useState('principal')
  const [focusedSetId, setFocusedSetId] = useState<string | null>(null)
  const [manageSquadsOpen, setManageSquadsOpen] = useState(false)
  const [manageSetsOpen, setManageSetsOpen] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [showCoverages, setShowCoverages] = useState(false)
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const loaded = useRef(false)

  const saveStatus = (next: string, detail?: string) => { setStatus(next); setSaveDetail(detail ?? '') }

  useEffect(() => { void loadReferenceDataset().then(setReference) }, [])
  useEffect(() => {
    let active = true
    loaded.current = false
    setUndoPlanning(null)
    setExpandedSets(new Set())
    setFocusedSetId(null)
    setPlayerDropPreview(null)
    setSetDropPreview(null)
    setManagerSetDragging(null)
    setManagerSetPreview(undefined)
    setManagerGroupDragging(null)
    setManagerGroupPreview(undefined)
    if (!supabase || !selected) return () => { active = false }
    setLoading(true)
    saveStatus('Carregando…')
    void Promise.all([loadCurrentPlayers(selected.id), loadModelConfig(selected.id)]).then(([cached, modelConfig]) => {
      if (!active) return
      startTransition(() => {
        setPlayers(cached as unknown as Player[])
        const existing = modelConfig as Config
        const old = existing.planning as (Planning & { assignments?: Record<string, string> }) | undefined
        const loadedPlanning: Planning = old ? { ...defaults(), groups: old.groups ?? defaults().groups, slotAssignments: old.slotAssignments ?? {}, setLayouts: old.setLayouts ?? {} } : defaults()
        const next: Planning = { ...loadedPlanning, groups: [...loadedPlanning.groups, ...transferGroups.filter(required => !loadedPlanning.groups.some(group => group.id === required.id))] }
        setConfig({ ...existing, planning: next })
        setSelectedGroup(next.groups[0]?.id ?? '')
        loaded.current = true
        saveStatus('✓ Salvo')
        setLoading(false)
      })
    }).catch(error => {
      if (active) {
        const detail = describeDbError(error).full
        setStatus('⚠ Não foi possível carregar')
        setSaveDetail(detail)
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [selected?.id])

  useEffect(() => {
    if (!loaded.current || !selected || !supabase) return
    scheduleModelConfigPatch(selected.id, '2.9.0', { planning: config.planning ?? defaults() }, saveStatus)
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
  const slotDescriptors: TacticSlotDescriptor[] = useMemo(() => pairs.map(pair => ({ id: pair.ip.playerId, position: pair.ip.position, oopPosition: pair.oop.position })), [pairs])
  const pairBySlot = useMemo(() => new Map(pairs.map(pair => [pair.ip.playerId, pair])), [pairs])
  const roleOverrides = config.role_weight_overrides ?? EMPTY_ROLE_OVERRIDES
  const latestByPlayer = useMemo(() => new Map(players.map(player => [player.id, player.player_snapshots[0]])), [players])
  const latest = (player: Player) => latestByPlayer.get(player.id)

  const currentGroupIndex = Math.max(0, planning.groups.findIndex(group => group.id === selectedGroup))
  const currentGroup = planning.groups[currentGroupIndex]
  const isTransferGroup = Boolean(currentGroup && transferGroups.some(group => group.id === currentGroup.id))
  const currentSets = useMemo(() => tactic && currentGroup && !isTransferGroup ? layoutsFor(planning, tactic.id, currentGroup.id, slotDescriptors) : [], [planning, tactic, currentGroup, isTransferGroup, slotDescriptors])
  const focusedSet = currentSets.find(set => set.id === focusedSetId) ?? null
  const displaySetLabel = (set: PlanningSetLayout) => planningSetDisplayLabel(set, currentSets, slotDescriptors)
  useEffect(() => {
    if (focusedSetId && !currentSets.some(set => set.id === focusedSetId)) setFocusedSetId(null)
  }, [focusedSetId, currentSets])

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
    const ratings = (reference?.players ?? []).filter(player => canPlay([player.p], pair.ip.position)).map(player => combinedPhaseScore(referenceScore(player, reference!.attributes, ipWeights), referenceScore(player, reference!.attributes, oopWeights))).filter((value): value is number => value !== null).sort((a, b) => a - b)
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
  function setPairs(set: PlanningSetLayout) { return set.slotIds.map(id => pairBySlot.get(id)).filter((pair): pair is Pair => Boolean(pair)) }
  const availableFilterPositions = useMemo(() => [...new Set(pairs.flatMap(pair => [canonicalPosition(pair.ip.position), canonicalPosition(pair.oop.position)]))], [pairs])
  const contextualPairs = useMemo(() => {
    const selectedPositions = positionFilters ?? []
    const explicit = selectedPositions.length ? pairs.filter(pair => selectedPositions.some(position => canPlay([pair.ip.position], position) || canPlay([pair.oop.position], position))) : []
    return explicit.length ? explicit : focusedSet ? setPairs(focusedSet) : []
  }, [positionFilters, pairs, focusedSet])

  const roster = useMemo(() => players.map(player => {
    const pair = contextualPairs.length ? contextualPairs.reduce<Pair | undefined>((best, current) => !best || (pairRating(player, current) ?? -1) > (pairRating(player, best) ?? -1) ? current : best, undefined) : bestPair(player)
    const score = pair ? pairRating(player, pair) : null
    const rank = pair ? pairPercentile(player, pair) : null
    const snapshot = latest(player)
    const compatible = contextualPairs.length ? isPlanningFamiliar(planningFamiliarity(snapshot, contextualPairs)) : true
    const positionVisible = positionFilters === null ? true : positionFilters.length > 0 && positionFilters.some(position => canPlay(snapshot?.positions ?? [], position))
    return { player, score, rank, compatible, positionVisible }
  }).filter(row => row.positionVisible && !assignmentIndex[row.player.id] && row.player.current_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.compatible) - Number(a.compatible) || (b.score ?? 0) - (a.score ?? 0) || a.player.current_name.localeCompare(b.player.current_name, 'pt-BR')), [players, search, contextualPairs, playerScores, assignmentIndex, latestByPlayer])

  const activePlayer = players.find(player => player.id === dragging?.id)
  const currentGroupPlayerIds = useMemo(() => new Set(Object.values(planning.slotAssignments[currentGroup?.id ?? ''] ?? {}).flat().filter(Boolean)), [planning.slotAssignments, currentGroup?.id])

  function update(fn: (planning: Planning) => Planning) {
    const previous = planning
    const next = fn(previous)
    if (next === previous) return
    setUndoPlanning(previous)
    setConfig(current => ({ ...current, planning: next }))
  }
  function undo() { if (!undoPlanning) return; setConfig(current => ({ ...current, planning: undoPlanning })); setUndoPlanning(null) }
  function changeGroup(direction: number) { if (!planning.groups.length) return; const next = (currentGroupIndex + direction + planning.groups.length) % planning.groups.length; setSelectedGroup(planning.groups[next].id); setExpandedSets(new Set()); setFocusedSetId(null) }
  function addGroup() { if (!newGroup.trim()) return; update(value => ({ ...value, groups: [...value.groups, { id: crypto.randomUUID(), name: newGroup.trim() }] })); setNewGroup('') }
  function renameGroup(id: string, name: string) { update(value => ({ ...value, groups: value.groups.map(group => group.id === id ? { ...group, name } : group) })) }
  function removeGroup(id: string) {
    const group = planning.groups.find(item => item.id === id)
    const allocated = Object.values(planning.slotAssignments[id] ?? {}).flat().filter(Boolean).length
    const message = allocated > 0
      ? `Excluir “${group?.name ?? 'este elenco'}” e remover ${allocated} alocação${allocated === 1 ? '' : 'ões'}? Os jogadores voltarão para a lista disponível.`
      : `Excluir o elenco “${group?.name ?? 'selecionado'}”?`
    if (!confirm(message)) return
    if (selectedGroup === id) setSelectedGroup(planning.groups.find(item => item.id !== id)?.id ?? '')
    update(value => {
      const setLayouts = Object.fromEntries(Object.entries(value.setLayouts ?? {}).map(([tacticId, groups]) => [tacticId, Object.fromEntries(Object.entries(groups).filter(([groupId]) => groupId !== id))]))
      return { ...value, groups: value.groups.filter(group => group.id !== id), slotAssignments: Object.fromEntries(Object.entries(value.slotAssignments).filter(([groupId]) => groupId !== id)), setLayouts }
    })
  }
  function removePlayer(id: string) { update(value => removePlayerFromPlanning(value, id) as Planning) }
  function clearPlanning() {
    if (!confirm('Remover todas as alocações de todos os elencos deste planejamento? Esta ação afeta Principal, Time B, Base, Empréstimo, Venda e demais grupos.')) return
    if (!confirm('Confirme novamente: limpar TODOS os elencos? Os jogadores voltarão para a lista disponível.')) return
    update(value => ({ ...value, slotAssignments: {} }))
  }
  function clearGroup(groupId: string) { update(value => { const removed = Object.values(value.slotAssignments[groupId] ?? {}).flat().some(Boolean); return removed ? { ...value, slotAssignments: { ...value.slotAssignments, [groupId]: {} } } : value }) }
  function clearCurrentGroup() { if (currentGroup && confirm(`Remover todas as alocações de “${currentGroup.name}”? Os jogadores voltarão para a lista disponível.`)) clearGroup(currentGroup.id) }
  function placePlayer(groupId: string, setId: string, playerId: string, beforePlayerId?: string | null) { update(value => movePlayerToSet(value, groupId, setId, playerId, beforePlayerId) as Planning) }
  function stopPlayerDrag() { setDragging(null); setPlayerDropPreview(null) }
  function stopSetDrag() { setDraggingSetId(null); setSetDropPreview(null) }
  function toggleSet(setId: string) { setExpandedSets(current => { const next = new Set(current); if (next.has(setId)) next.delete(setId); else next.add(setId); return next }) }

  function setScore(player: Player, set: PlanningSetLayout) {
    const candidates = setPairs(set).map(pair => ({ pair, value: pairRating(player, pair), rank: pairPercentile(player, pair) }))
    return candidates.reduce<{ pair: Pair | null; value: number | null; rank: number | null }>((best, current) => best.pair === null || (current.value ?? -1) > (best.value ?? -1) ? current : best, { pair: null, value: null, rank: null })
  }
  function setFamiliarity(player: Player, set: PlanningSetLayout) { return planningFamiliarity(latest(player), setPairs(set)) }
  function coveragePlayers(set: PlanningSetLayout) {
    if (!currentGroup) return []
    return players.filter(player => {
      if (!currentGroupPlayerIds.has(player.id) || !isPlanningFamiliar(setFamiliarity(player, set))) return false
      const primary = primarySetForPlayer(planning, currentGroup.id, currentSets, player.id)
      return Boolean(primary && primary.id !== set.id)
    })
  }
  function primaryLabel(playerId: string) { const set = currentGroup ? primarySetForPlayer(planning, currentGroup.id, currentSets, playerId) : null; return set ? displaySetLabel(set) : 'Outro conjunto' }

  function groupSet(firstId: string, secondId: string) { if (tactic && currentGroup) update(value => groupAdjacentPlanningSets(value, tactic.id, currentGroup.id, currentSets, firstId, secondId, slotDescriptors, `set-${crypto.randomUUID()}`) as Planning) }
  function splitSet(setId: string) { if (tactic && currentGroup) update(value => splitPlanningSet(value, tactic.id, currentGroup.id, currentSets, setId, slotDescriptors) as Planning) }
  function renameSet(setId: string, label: string) { if (tactic && currentGroup) update(value => renamePlanningSet(value, tactic.id, currentGroup.id, currentSets, setId, label) as Planning) }
  function renameSetSlot(setId: string, slotId: string, label: string) { if (tactic && currentGroup) update(value => renamePlanningSlotLabel(value, tactic.id, currentGroup.id, currentSets, setId, slotId, label) as Planning) }
  function reorderSet(draggedId: string, beforeId: string | null) { if (tactic && currentGroup) update(value => reorderPlanningSets(value, tactic.id, currentGroup.id, currentSets, draggedId, beforeId) as Planning) }
  function reorderGroup(draggedId: string, beforeId: string | null) { update(value => reorderPlanningGroups(value, draggedId, beforeId) as Planning) }
  function restoreSets() { if (tactic && currentGroup) update(value => restoreDefaultPlanningSets(value, tactic.id, currentGroup.id, currentSets, slotDescriptors) as Planning) }

  async function persistPatch(patch: Record<string, unknown>) {
    if (!selected) return
    saveStatus('Salvando…')
    try { const result = await patchModelConfig(selected.id, '2.9.0', patch); saveStatus('✓ Salvo', modelDiagnostic(result)) }
    catch (error) { saveStatus('⚠ Não foi possível salvar', describeDbError(error).full) }
  }
  async function retrySave() {
    if (!selected) return
    try {
      const result = await retryModelConfigPatch(selected.id, saveStatus)
      if (!result) await persistPatch({ planning: config.planning ?? defaults(), selected_tactic_id: config.selected_tactic_id ?? null })
    } catch { /* status is already updated by the shared persistence layer */ }
  }

  function commitSetDrop(beforeId: string | null) {
    if (draggingSetId) reorderSet(draggingSetId, beforeId)
    stopSetDrag()
  }

  return <div className="screen-page planning-page planning-flex-page">
    <div className="title-row planning-title-row"><div><h1>Planejamento</h1>{(loading || isPending) && <span className="background-loading" role="status">Carregando em segundo plano…</span>}</div><SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠') ? () => void retrySave() : undefined} /></div>

    <section className="planning-matrix-toolbar planning-aligned-toolbar planning-flex-toolbar">
      <CustomSelect className="tactic-custom-select" ariaLabel="Tática selecionada" value={tactic?.id ?? ''} options={tactics.map(item => ({ value: item.id, label: item.name }))} placeholder={tactics.length ? 'Tática' : 'Nenhuma tática criada'} disabled={!tactics.length || isTransferGroup} onChange={id => { setConfig(current => ({ ...current, selected_tactic_id: id })); setExpandedSets(new Set()); setFocusedSetId(null); void persistPatch({ selected_tactic_id: id }) }} />
      <div className="squad-pagination planning-group-selector"><button onClick={() => changeGroup(-1)} disabled={planning.groups.length < 2}>‹</button><strong>{currentGroup?.name ?? 'Nenhum elenco'}</strong><span>{planning.groups.length ? `${currentGroupIndex + 1} de ${planning.groups.length}` : '0 de 0'}</span><button onClick={() => changeGroup(1)} disabled={planning.groups.length < 2}>›</button></div>
      <label className={`coverage-toggle ${isTransferGroup || !tactic ? 'is-disabled' : ''}`}><input type="checkbox" checked={showCoverages} disabled={isTransferGroup || !tactic} onChange={event => setShowCoverages(event.target.checked)} /><span>Mostrar coberturas</span></label>
      <div className="planning-flex-actions">
        <button className="ghost undo-planning-button dt-control" onClick={undo} disabled={!undoPlanning} title="Desfazer última alteração" aria-label="Desfazer última alteração">↶</button>
        <button className="ghost manage-sets-button dt-control" disabled={isTransferGroup || !tactic} onClick={() => setManageSetsOpen(true)}>Organizar posições</button>
        <button className="ghost manage-squads-button dt-control" onClick={() => setManageSquadsOpen(true)}>Gerenciar elencos</button>
        <button className="planning-clear-current dt-control" type="button" disabled={!currentGroupPlayerIds.size} onClick={clearCurrentGroup} title={`Limpar ${currentGroup?.name ?? 'elenco'}`} aria-label={`Limpar ${currentGroup?.name ?? 'elenco'}`}>🗑</button>
      </div>
    </section>

    <section className="planning-depth-layout planning-flex-layout">
      <article className="planning-column roster-column">
        <header><h2>{focusedSet ? `Elenco · ${focusedSet.label}` : 'Elenco'}</h2><span>{roster.length}</span></header>
        <div className="roster-filters"><input placeholder="Buscar" value={search} onChange={event => setSearch(event.target.value)} /><PositionSelector selected={positionFilters} availablePositions={availableFilterPositions} onChange={positions => { setPositionFilters(positions); if (positions?.length) setFocusedSetId(null) }} /></div>
        {contextualPairs.length > 0 && <div className="roster-context-note">Prioridade: nota específica da função</div>}
        <div className="planning-player-list">
          {!players.length && (loading || isPending) && <div className="background-loader-panel" role="status">Carregando elenco… você pode trocar de aba enquanto isso.</div>}
          {roster.map(({ player, score, rank, compatible }) => <RosterPlayerCard player={player} snapshot={latest(player)!} score={score} rank={rank} compatible={compatible} contextual={contextualPairs.length > 0} drag={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', player.id); setDragging({ type: 'player', id: player.id }) }} dragEnd={stopPlayerDrag} open={() => navigate(`/players/${player.id}`)} key={player.id} />)}
        </div>
      </article>

      <div className={`planning-flex-board ${expandedSets.size ? 'has-expanded' : ''} ${isTransferGroup ? 'is-transfer' : ''}`}>
        {isTransferGroup && currentGroup ? <TransferGroupPanel group={currentGroup} playerIds={planning.slotAssignments[currentGroup.id]?.market ?? []} players={players} latest={latest} dragging={Boolean(activePlayer)} drop={() => { if (activePlayer) placePlayer(currentGroup.id, 'market', activePlayer.id); stopPlayerDrag() }} startDrag={id => setDragging({ type: 'player', id })} dragEnd={stopPlayerDrag} open={id => navigate(`/players/${id}`)} remove={removePlayer} />
          : tactic && currentGroup ? <div className={`planning-set-list ${expandedSets.size ? 'has-expanded' : ''}`}>
            {currentSets.map((set, index) => <Fragment key={set.id}>
              {draggingSetId && setDropPreview?.beforeSetId === set.id && draggingSetId !== set.id && <SetDropPlaceholder drop={() => commitSetDrop(set.id)} />}
              <PlanningSetRow
                set={set}
                displayLabel={displaySetLabel(set)}
                pairs={setPairs(set)}
                assignedIds={planning.slotAssignments[currentGroup.id]?.[set.id] ?? []}
                players={players}
                latest={latest}
                expanded={expandedSets.has(set.id)}
                focused={focusedSetId === set.id}
                coverages={showCoverages ? coveragePlayers(set) : []}
                showCoverages={showCoverages}
                primaryLabel={primaryLabel}
                activePlayer={activePlayer}
                draggingSetId={draggingSetId}
                playerDropPreview={playerDropPreview}
                nextSetId={currentSets[index + 1]?.id ?? null}
                score={player => setScore(player, set)}
                familiarity={player => setFamiliarity(player, set)}
                toggle={() => toggleSet(set.id)}
                focus={() => setFocusedSetId(current => current === set.id ? null : set.id)}
                startPlayerDrag={(id, event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDragging({ type: 'player', id }); setPlayerDropPreview(null) }}
                stopPlayerDrag={stopPlayerDrag}
                previewPlayer={beforePlayerId => setPlayerDropPreview({ setId: set.id, beforePlayerId })}
                dropPlayer={beforePlayerId => { if (activePlayer) placePlayer(currentGroup.id, set.id, activePlayer.id, beforePlayerId); stopPlayerDrag() }}
                startSetDrag={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', set.id); setDraggingSetId(set.id); setSetDropPreview({ beforeSetId: set.id }) }}
                stopSetDrag={stopSetDrag}
                previewSet={beforeSetId => setSetDropPreview({ beforeSetId })}
                dropSet={beforeSetId => commitSetDrop(beforeSetId)}
                open={id => navigate(`/players/${id}`)}
                context={(event, playerId) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, playerId }) }}
              />
            </Fragment>)}
            {draggingSetId && setDropPreview?.beforeSetId === null && <SetDropPlaceholder drop={() => commitSetDrop(null)} />}
          </div> : <div className="empty planning-no-tactic"><h2>Nenhuma tática disponível</h2><p>Crie uma tática para organizar o elenco por posição e função.</p><button onClick={() => navigate('/tactics')}>Criar primeira tática</button></div>}
      </div>
    </section>

    {manageSquadsOpen && <div className="settings-overlay" onClick={() => setManageSquadsOpen(false)}><section className="squad-manager planning-squad-manager" onClick={event => event.stopPropagation()}><header><h2>Gerenciar elencos</h2><button className="close" onClick={() => setManageSquadsOpen(false)}>×</button></header><div className="squad-manager-list">{planning.groups.map((group, index) => { const fixed = transferGroups.some(item => item.id === group.id); const previewBefore = managerGroupPreview === group.id && managerGroupDragging !== group.id; return <Fragment key={group.id}>{previewBefore && <ManagerDropPlaceholder label="Mover elenco para cá" />}<div className={`planning-squad-manager-row ${fixed ? 'fixed-planning-group' : ''} ${managerGroupDragging === group.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerGroupPreview(event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null) }} onDrop={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderGroup(managerGroupDragging, event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null); setManagerGroupDragging(null); setManagerGroupPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.id); setManagerGroupDragging(group.id); setManagerGroupPreview(group.id) }} onDragEnd={() => { setManagerGroupDragging(null); setManagerGroupPreview(undefined) }} title={`Arrastar ${group.name}`} aria-label={`Reordenar ${group.name}`}>⠿</button><input value={group.name} readOnly={fixed} onChange={event => renameGroup(group.id, event.target.value)} />{fixed ? <span className="market-group-label">GRUPO MERCADO</span> : <button className="manager-trash" onClick={() => removeGroup(group.id)} title={`Excluir ${group.name}`} aria-label={`Excluir ${group.name}`}>🗑</button>}</div></Fragment> })}{managerGroupDragging && managerGroupPreview === null && <ManagerDropPlaceholder label="Mover elenco para o final" />}</div><footer className="planning-squad-manager-footer"><div className="planning-add-squad"><input placeholder="Novo elenco" value={newGroup} onChange={event => setNewGroup(event.target.value)} onKeyDown={event => event.key === 'Enter' && addGroup()} /><button onClick={addGroup}>+ Adicionar</button></div><button className="danger-button clear-all-squads" disabled={!Object.keys(assignmentIndex).length} onClick={clearPlanning}>Limpar todos os elencos</button></footer></section></div>}

    {manageSetsOpen && tactic && currentGroup && !isTransferGroup && <div className="settings-overlay" onClick={() => setManageSetsOpen(false)}><section className="squad-manager planning-set-manager" onClick={event => event.stopPropagation()}><header><div><h2>Organizar posições</h2><p>Organização visual de {currentGroup.name}; a tática não é alterada.</p></div><button className="close" onClick={() => setManageSetsOpen(false)}>×</button></header><div className="planning-set-manager-list">{currentSets.map((set, index) => { const effectiveLabel = displaySetLabel(set); const previewBefore = managerSetPreview === set.id && managerSetDragging !== set.id; const nextSet = currentSets[index + 1]; const canGroupNext = Boolean(nextSet && canGroupAdjacentPlanningSets(set, nextSet, slotDescriptors)); return <Fragment key={set.id}>{previewBefore && <ManagerDropPlaceholder label="Mover posição para cá" />}<div className={`planning-set-manager-row ${set.slotIds.length > 1 ? 'is-grouped-manager-row' : ''} ${managerSetDragging === set.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerSetPreview(event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null) }} onDrop={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderSet(managerSetDragging, event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null); setManagerSetDragging(null); setManagerSetPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', set.id); setManagerSetDragging(set.id); setManagerSetPreview(set.id) }} onDragEnd={() => { setManagerSetDragging(null); setManagerSetPreview(undefined) }} title={`Arrastar ${effectiveLabel}`} aria-label={`Reordenar ${effectiveLabel}`}>⠿</button>{set.slotIds.length > 1 ? <><button className="split-set-button" onClick={() => splitSet(set.id)} title="Desagrupar" aria-label={`Desagrupar ${effectiveLabel}`}>−</button><div className="grouped-set-fields"><label>Nome geral<input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /></label>{set.slotIds.map((slotId, slotIndex) => <label key={slotId}>Posição {slotIndex + 1}<input value={planningSlotDisplayLabel(set, slotId, slotDescriptors)} onChange={event => renameSetSlot(set.id, slotId, event.target.value)} /></label>)}</div></> : <><span className="set-manager-order">{index + 1}</span><input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /><small>1 posição</small></>}</div>{canGroupNext && <button className="adjacent-group-button" type="button" title={`Agrupar ${effectiveLabel} e ${displaySetLabel(nextSet)}`} onClick={() => groupSet(set.id, nextSet.id)}>+</button>}</Fragment> })}{managerSetDragging && managerSetPreview === null && <ManagerDropPlaceholder label="Mover posição para o final" />}</div><footer><button className="ghost" onClick={restoreSets}>Restaurar ordem e grupos da tática</button><button onClick={() => setManageSetsOpen(false)}>Concluir</button></footer></section></div>}

    {menu && <div className="planning-context-menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}><button onClick={() => { removePlayer(menu.playerId); setMenu(null) }}>Remover do elenco</button></div>}
  </div>
}

function useCompactCapacity(grouped: boolean, optionCount: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [capacity, setCapacity] = useState(grouped ? 8 : 4)
  const [columns, setColumns] = useState(4)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const layout = calculatePlanningCardLayout(node.clientWidth, grouped, optionCount)
      node.style.setProperty('--planning-card-width', `${layout.cardWidth}px`)
      setCapacity(layout.capacity)
      setColumns(layout.columns)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [grouped, optionCount])
  return { ref, capacity, columns }
}

function insertionBeforePlayer(container: HTMLElement, clientX: number, clientY: number, draggingId: string | undefined) {
  const cards = [...container.querySelectorAll<HTMLElement>('[data-planning-player-id]')].filter(card => card.dataset.planningPlayerId !== draggingId && card.offsetParent !== null)
  if (!cards.length) return null
  const rows: Array<{ top: number; bottom: number; cards: HTMLElement[] }> = []
  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    let row = rows.find(item => Math.abs(item.top - rect.top) < 8)
    if (!row) { row = { top: rect.top, bottom: rect.bottom, cards: [] }; rows.push(row) }
    row.bottom = Math.max(row.bottom, rect.bottom); row.cards.push(card)
  }
  rows.sort((a, b) => a.top - b.top)
  const rowIndex = rows.reduce((best, row, index) => {
    const center = (row.top + row.bottom) / 2
    const bestCenter = (rows[best].top + rows[best].bottom) / 2
    return Math.abs(clientY - center) < Math.abs(clientY - bestCenter) ? index : best
  }, 0)
  const row = rows[rowIndex]
  row.cards.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
  for (const card of row.cards) {
    const rect = card.getBoundingClientRect()
    if (clientX < rect.left + rect.width / 2) return card.dataset.planningPlayerId ?? null
  }
  return rows[rowIndex + 1]?.cards[0]?.dataset.planningPlayerId ?? null
}


function PlanningSetRow({ set, displayLabel, pairs, assignedIds, players, latest, expanded, focused, coverages, showCoverages, primaryLabel, activePlayer, draggingSetId, playerDropPreview, nextSetId, score, familiarity, toggle, focus, startPlayerDrag, stopPlayerDrag, previewPlayer, dropPlayer, startSetDrag, stopSetDrag, previewSet, dropSet, open, context }: {
  set: PlanningSetLayout
  displayLabel: string
  pairs: Pair[]
  assignedIds: string[]
  players: Player[]
  latest: (player: Player) => Snapshot | undefined
  expanded: boolean
  focused: boolean
  coverages: Player[]
  showCoverages: boolean
  primaryLabel: (playerId: string) => string
  activePlayer?: Player
  draggingSetId: string | null
  playerDropPreview: PlayerDropPreview | null
  nextSetId: string | null
  score: (player: Player) => { pair: Pair | null; value: number | null; rank: number | null }
  familiarity: (player: Player) => Familiarity
  toggle: () => void
  focus: () => void
  startPlayerDrag: (id: string, event: DragEvent<HTMLElement>) => void
  stopPlayerDrag: () => void
  previewPlayer: (beforePlayerId: string | null) => void
  dropPlayer: (beforePlayerId?: string | null) => void
  startSetDrag: (event: DragEvent<HTMLElement>) => void
  stopSetDrag: () => void
  previewSet: (beforeSetId: string | null) => void
  dropSet: (beforeSetId: string | null) => void
  open: (id: string) => void
  context: (event: ReactMouseEvent, playerId: string) => void
}) {
  const members = assignedIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  const coverageOptions = showCoverages ? coverages.filter(player => !members.some(member => member.id === player.id)) : []
  const options = [...members.map(player => ({ player, coverage: false as const })), ...coverageOptions.map(player => ({ player, coverage: true as const }))]
  const grouped = set.slotIds.length > 1
  const { ref: cardsRef, capacity, columns } = useCompactCapacity(grouped, options.length)
  const visible = expanded ? options : options.slice(0, capacity)
  const hidden = Math.max(0, options.length - visible.length)
  const linePosition = pairs[0]?.ip.position ?? ''
  const ipDescriptions = [...new Set(pairs.map(pair => `${pair.ip.position.replaceAll(' ', '')} · ${pair.ip.roleCode}`))]
  const oopDescriptions = [...new Set(pairs.map(pair => `${pair.oop.position.replaceAll(' ', '')} · ${pair.oop.roleCode}`))]
  const activeFamiliarity = activePlayer ? familiarity(activePlayer) : 'unknown'
  const preview = playerDropPreview?.setId === set.id ? playerDropPreview.beforePlayerId : undefined

  const lineDropTarget = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? set.id : nextSetId
  }

  return <article className={`planning-set-row planning-line-${planningLine(linePosition)} ${grouped ? 'is-grouped' : ''} ${expanded ? 'is-expanded' : ''} ${focused ? 'is-focused' : ''} ${draggingSetId === set.id ? 'is-line-dragging' : ''} ${preview !== undefined && activePlayer ? 'is-player-drop-target' : ''}`} onDragOver={event => {
    if (draggingSetId) { event.preventDefault(); previewSet(lineDropTarget(event)); return }
    if (activePlayer) { event.preventDefault(); previewPlayer(null) }
  }} onDrop={event => {
    event.preventDefault()
    if (draggingSetId) dropSet(lineDropTarget(event))
    else if (activePlayer) dropPlayer(preview ?? null)
  }}>
    <div className="planning-set-meta" onClick={focus}>
      <button className="planning-set-handle" draggable onClick={event => event.stopPropagation()} onDragStart={event => { event.stopPropagation(); startSetDrag(event) }} onDragEnd={stopSetDrag} title="Arrastar para reordenar" aria-label={`Reordenar ${displayLabel}`}>⠿</button>
      <div className="planning-set-position"><div className="planning-position-heading"><span className="planning-position-label">{displayLabel}</span>{grouped && <b>{set.slotIds.length} POS.</b>}</div><small className="planning-phase-line"><i>IP</i><span>{ipDescriptions.join(" / ") || "—"}</span></small><small className="planning-phase-line"><em>OOP</em><span>{oopDescriptions.join(" / ") || "—"}</span></small>{members.length > 0 && <small className="planning-set-depth">{members.length} jogador{members.length === 1 ? "" : "es"}{grouped ? ` · ${set.slotIds.length} posições` : ""}</small>}</div>
    </div>

    <div ref={cardsRef} className={`planning-set-cards ${isPlanningFamiliar(activeFamiliarity) ? 'is-compatible-drop' : isPlanningOutOfPosition(activeFamiliarity) ? 'is-training-drop' : ''}`} onDragOver={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; previewPlayer(insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id)) }} onDrop={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); dropPlayer(preview ?? insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id)) }}>
      {visible.map((option, index) => {
        const player = option.player
        const snapshot = latest(player)
        if (!snapshot) return null
        const rating = score(player)
        const beforeId = player.id
        return <Fragment key={`${option.coverage ? 'coverage' : 'primary'}-${player.id}`}>
          {preview === beforeId && activePlayer?.id !== player.id && <PlayerDropPlaceholder />}
          <BoardPlayerCard
            player={player}
            snapshot={snapshot}
            score={rating.value}
            rank={rating.rank}
            coverage={option.coverage}
            source={option.coverage ? primaryLabel(player.id) : null}
            familiarity={familiarity(player)}
            familiarityTooltip={planningFamiliarityTooltip(snapshot, pairs)}
            dragging={activePlayer?.id === player.id}
            drag={(event) => startPlayerDrag(player.id, event)}
            dragEnd={stopPlayerDrag}
            open={() => open(player.id)}
            context={event => context(event, player.id)}
          />
          {grouped && index + 1 === columns && visible.length > columns && <span className="planning-card-row-break" aria-hidden="true" />}
        </Fragment>
      })}
      {preview === null && activePlayer && <PlayerDropPlaceholder />}
      {!options.length && <div className="planning-set-empty">{activePlayer ? 'SOLTE PARA ADICIONAR' : 'Arraste jogadores aqui'}</div>}
      {!expanded && hidden > 0 && <button className="planning-set-expand" onClick={event => { event.stopPropagation(); toggle() }}>+{hidden}</button>}
      {expanded && options.length > capacity && <button className="planning-set-collapse" onClick={event => { event.stopPropagation(); toggle() }} title="Recolher" aria-label={`Recolher ${displayLabel}`}>−</button>}
    </div>
  </article>
}

function PlayerDropPlaceholder() { return <div className="planning-player-drop-placeholder" aria-hidden="true"><span>destino</span></div> }
function SetDropPlaceholder({ drop }: { drop: () => void }) { return <div className="planning-set-drop-placeholder" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop() }} aria-hidden="true"><span>soltar aqui</span></div> }

function BoardPlayerCard({ player, snapshot, score, rank, coverage, source, familiarity, familiarityTooltip, dragging, drag, dragEnd, open, context }: {
  player: Player
  snapshot: Snapshot
  score: number | null
  rank: number | null
  coverage: boolean
  source: string | null
  familiarity: Familiarity
  familiarityTooltip: string
  dragging: boolean
  drag: (event: DragEvent<HTMLElement>) => void
  dragEnd: () => void
  open: () => void
  context: (event: ReactMouseEvent) => void
}) {
  const out = isPlanningOutOfPosition(familiarity)
  const familiarityLabel = planningFamiliarityLabel(familiarity)
  const title = [coverage ? `Cobertura · Principal: ${source ?? 'outro conjunto'}` : null, out ? familiarityTooltip : null].filter(Boolean).join('\n\n')
  return <article data-planning-player-id={player.id} className={`planning-set-player-card ${coverage ? 'is-coverage' : ''} ${out ? 'is-out-of-position' : ''} ${dragging ? 'is-player-dragging' : ''}`} title={title || undefined} draggable onDragStart={event => { event.stopPropagation(); drag(event) }} onDragEnd={dragEnd} onContextMenu={context}>
    <button className="player-name" onClick={event => { event.stopPropagation(); open() }}>{out && <span className="position-warning-icon" aria-label="Fora de posição">⚠</span>}{player.current_name}</button>
    <span className="planning-score-wrap" title={coverage ? 'Nota nesta função — opção de cobertura' : 'Nota nesta função'}><ScoreBadge value={score} rank={rank} showTitle={false} /></span>
    <div className="planning-card-meta"><small>{snapshot.age ?? '—'} anos</small><span className="planning-card-badges">{coverage && <b className="coverage-badge">Cobertura</b>}{familiarityLabel && <b className="out-position-badge">{familiarityLabel.includes('IP/OOP') ? 'Fora pos. IP/OOP' : familiarityLabel.includes('IP') ? 'Fora pos. IP' : familiarityLabel.includes('OOP') ? 'Fora pos. OOP' : 'Fora pos.'}</b>}</span></div>
  </article>
}

function RosterPlayerCard({ player, snapshot, score, rank, compatible, contextual, drag, dragEnd, open }: { player: Player; snapshot: Snapshot; score: number | null; rank: number | null; compatible: boolean; contextual: boolean; drag: (event: DragEvent<HTMLDivElement>) => void; dragEnd: () => void; open: () => void }) {
  return <div className={`planning-player roster-player-card ${!compatible ? 'incompatible' : ''}`} draggable onDragStart={drag} onDragEnd={dragEnd}><PlayerPeek player={player} snapshot={snapshot} /><div className="roster-player-main"><button className="player-name" onClick={event => { event.stopPropagation(); open() }}>{player.current_name}</button><span>{snapshot.positions.join(', ') || 'Sem posição informada'}</span><small>{[snapshot.age !== null ? `${snapshot.age} anos` : null, snapshot.height ? `${snapshot.height} cm` : null, snapshot.preferred_foot ? footLabel(snapshot.preferred_foot) : null].filter(Boolean).join(' · ') || 'Sem metadados adicionais'}</small></div><span className="planning-score-wrap roster-score-wrap" title={contextual ? 'Nota nesta função' : 'Nota geral'}><ScoreBadge value={score} rank={rank} showTitle={false} /></span></div>
}

function TransferGroupPanel({ group, playerIds, players, latest, dragging, drop, startDrag, dragEnd, open, remove }: { group: Group; playerIds: string[]; players: Player[]; latest: (player: Player) => Snapshot | undefined; dragging: boolean; drop: () => void; startDrag: (id: string) => void; dragEnd: () => void; open: (id: string) => void; remove: (id: string) => void }) {
  const members = playerIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  return <section className={`transfer-group-panel planning-free-group ${dragging ? 'is-receiving' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop() }}><div className="transfer-group-summary"><span>Área livre de mercado</span><strong>{members.length} jogador{members.length === 1 ? '' : 'es'}</strong></div><div className="transfer-player-grid">{members.map(player => { const snapshot = latest(player); return snapshot ? <article className="transfer-player-card" draggable onDragStart={() => startDrag(player.id)} onDragEnd={dragEnd} key={player.id}><PlayerPeek player={player} snapshot={snapshot} /><div className="transfer-player-info"><button className="player-name" onClick={() => open(player.id)}>{player.current_name}</button><span>{snapshot.positions.join(', ') || 'Sem posição'}</span><small>{snapshot.age ?? '—'} anos · {snapshot.club ?? 'Sem clube'}</small></div><button className="transfer-remove" onClick={() => remove(player.id)} title={`Remover ${player.current_name} de ${group.name}`} aria-label={`Remover ${player.current_name} de ${group.name}`}>×</button></article> : null })}{!members.length && <div className="transfer-empty"><b>Arraste jogadores para {group.name.toLowerCase()}</b><span>Este grupo não utiliza posições ou funções da tática.</span></div>}</div>{dragging && <div className="transfer-drop-hint">Solte para adicionar a {group.name}</div>}</section>
}

function ManagerDropPlaceholder({ label }: { label: string }) { return <div className="manager-drop-placeholder" aria-hidden="true">{label}</div> }


function planningLine(position: string) { const value = position.toUpperCase().replaceAll(' ', ''); if (value.startsWith('GK')) return 'gk'; if (value.startsWith('ST')) return 'st'; if (value.startsWith('AM')) return 'am'; if (value.startsWith('M')) return 'm'; if (value.startsWith('DM') || value.startsWith('WB')) return 'dm'; return 'd' }
const footLabel = (foot: string | null) => foot ? `Pé ${foot}` : 'Pé —'
