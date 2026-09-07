import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generalScoreForSnapshot } from '../lib/base-position-score'
import { pairedRoleScore, resolveRoleWeights } from '../lib/role-scoring'
import { ScoreWithProjection } from '../components/ScoreWithProjection'
import { ScoreBadge } from '../components/ScoreBadge'
import { SaveState } from '../components/SaveState'
import { CustomSelect } from '../components/CustomSelect'
import { DataTable, type DataTableColumnLike } from '../components/data-table/DataTable'
import { percentile, referencePairedRoleScore, type ReferenceDataset } from '../lib/reference'
import { canPlayPosition } from '../lib/positions'
import { isPlanningFamiliar, isPlanningOutOfPosition, planningFamiliarity, planningFamiliarityTooltip, type PlanningFamiliarity } from '../lib/planning-familiarity'
import { loadCurrentPlayers, loadReferenceDataset } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { PlayerPeek } from '../components/PlayerPeek'
import { usePotential } from '../features/potential/PotentialContext'
import { loadModelConfig, patchModelConfig, retryModelConfigPatch, scheduleModelConfigPatch } from '../lib/model-config'
import { describeDbError } from '../lib/db-error'
import { resolvePlanningInsertionBefore } from '../lib/planning-layout'
import { functionProjectionKey } from '../lib/projection-player'
import { PITCH_NODES, positionGroup } from '../lib/tactics'
import { derivePlanningAssignmentIndex } from '../lib/planningDistribution'
import { PLANNING_PITCH_LIST_CAPACITY, planningPitchPositionLabel, planningPitchSetHeader } from '../lib/planning-pitch-list'
import { planningSpatialLayout, type PlanningPitchLine, type PlanningSpatialPlacement } from '../lib/planning-spatial-layout'
import { resolvePlanningSetExpansion, type PlanningSetExpansion, type PlanningSetRect } from '../lib/planning-set-expansion'
import { loadPlanningMemberships } from '../lib/longitudinal-service'
import { classifyPlanningMembership, resolveCurrentSnapshotMembership, type PlanningMembershipFact } from '../lib/planning-membership'
import type { PlayerMembershipWithClubs } from '../types/domain'
import {
  activePlanningClubs,
  derivePlanningClubIndex,
  movePlayerAcrossClubPlans,
  patchClubPlanning,
  patchClubTacticId,
  primaryPlanningClubId,
  promoteLegacyPrimaryPlanning,
  promoteLegacyPrimaryTacticId,
  resolveClubPlanning,
  resolveClubTacticId,
  resolvePlanningClubId,
  sanitizeClubTacticSelections,
} from '../lib/multiclub-planning'
import {
  canGroupAdjacentPlanningSets,
  groupAdjacentPlanningSets,
  layoutsFor,
  PLANNING_VISUAL_GRID_COLUMNS,
  PLANNING_VISUAL_GRID_ROWS,
  PLANNING_VISUAL_GOALKEEPER_Y,
  movePlanningSetVisualGrid,
  planningVisualGridCellForSet,
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
  restorePlanningSetVisualGrid,
  splitPlanningSet,
  type FlexiblePlanning,
  type PlanningSetLayout,
  type PlanningVisualGridCell,
  type TacticSlotDescriptor,
} from '../lib/planningSets'
import '../app/styles/planning-pitch-list.css'

type Attribute = { attribute_key: string; attribute_label: string; value: number; category: string }
type Snapshot = {
  id?: string
  snapshot_date: string
  age: number | null
  positions: string[]
  club: string | null
  squad: string | null
  preferred_foot: string | null
  height: number | null
  weight: number | null
  normalized_data?: Record<string, unknown>
  raw_data?: Record<string, unknown>
  player_attributes: Attribute[]
}
type Player = { id: string; current_name: string; nationality: string | null; player_snapshots: Snapshot[] }
type Group = { id: string; name: string }
type Planning = FlexiblePlanning & { groups: Group[] }
type Assignment = { playerId: string; nodeId: string; position: string; roleId?: string; roleCode: string; roleName: string }
type Pair = { ip: Assignment; oop: Assignment }
type Tactic = { id: string; name: string; ipAssignments: Assignment[]; oopAssignments: Assignment[]; roles?: { id: string; name: string; weights: Record<string, number> }[] }
type Config = Record<string, unknown> & {
  planning?: Planning
  planning_by_club?: Record<string, Planning>
  tactics?: Tactic[]
  selected_tactic_id?: string | null
  selected_tactic_id_by_club?: Record<string, string | null>
  role_weight_overrides?: Record<string, Record<string, number>>
}
type DragItem = { type: 'player'; id: string }
type Menu = { x: number; y: number; playerId: string }
type Familiarity = PlanningFamiliarity
type PlayerDropPreview = { setId: string; beforePlayerId: string | null }
type PlanningUndo = Pick<Config, 'planning' | 'planning_by_club'>
type PlanningScoreDetail = { id: string; label: string; score: number | null }
type PlanningGridPlacement = PlanningSpatialPlacement & { gridRow: number; gridColumn: number; isGoalkeeper: boolean }
type PickerColumnId = 'name' | 'score' | 'positions' | 'age' | 'fact' | 'plan'
type PickerColumn = DataTableColumnLike & { id: PickerColumnId }
type PickerRow = {
  player: Player
  snapshot: Snapshot | undefined
  score: number | null
  rank: number | null
  rankPopulation: number[]
  compatible: boolean
  alreadyInTarget: boolean
  fact: PlanningMembershipFact
  planLabel: string
  projectionKey: string
}

const transferGroups: Group[] = [{ id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }]
const EMPTY_ROLE_OVERRIDES: Record<string, Record<string, number>> = {}
const defaults = (): Planning => ({ groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'base', name: 'Base' }, ...transferGroups], slotAssignments: {}, setLayouts: {} })
const planningClubStorageKey = (saveId: string) => `fm-datatracker:planning-club:${saveId}`
const PICKER_COLUMNS: PickerColumn[] = [
  { id: 'name', label: 'Jogador' },
  { id: 'score', label: 'Nota' },
  { id: 'positions', label: 'Posições' },
  { id: 'age', label: 'Idade' },
  { id: 'fact', label: 'Vínculo atual' },
  { id: 'plan', label: 'Plano' },
]
const PICKER_WIDTHS: Record<PickerColumnId, number> = { name: 230, score: 178, positions: 150, age: 72, fact: 150, plan: 180 }

const planningMembershipCache = new Map<string, Map<string, WeakMap<Player[], Promise<PlayerMembershipWithClubs[]>>>>()
const planningRoleReferenceCache = new Map<string, WeakMap<ReferenceDataset, Map<string, number[]>>>()

function loadPlanningMembershipsWarm(saveId: string, clubId: string | null, currentPlayers: Player[]) {
  const clubKey = clubId ?? '__no_planning_club__'
  let byClub = planningMembershipCache.get(saveId)
  if (!byClub) { byClub = new Map(); planningMembershipCache.set(saveId, byClub) }
  let byPlayers = byClub.get(clubKey)
  if (!byPlayers) { byPlayers = new WeakMap(); byClub.set(clubKey, byPlayers) }
  const cached = byPlayers.get(currentPlayers)
  if (cached) return cached
  const snapshotIds = currentPlayers.map(player => player.player_snapshots[0]?.id).filter((id): id is string => Boolean(id))
  const request = loadPlanningMemberships(saveId, snapshotIds).catch(error => { byPlayers?.delete(currentPlayers); throw error })
  byPlayers.set(currentPlayers, request)
  return request
}
function planningReferenceScopeKey(saveId: string, clubId: string | null) { return JSON.stringify(['planning-reference-v1', saveId, clubId ?? '__no_planning_club__']) }
function planningWeightKey(weights: Record<string, number>) { return JSON.stringify(Object.entries(weights).sort(([left], [right]) => left.localeCompare(right))) }
function planningRoleReferenceKey(pair: Pair, ipWeights: Record<string, number>, oopWeights: Record<string, number>) {
  return JSON.stringify(['planning-role-reference-v1', pair.ip.playerId, pair.ip.position, pair.ip.roleId ?? '', pair.ip.roleCode, pair.ip.roleName, planningWeightKey(ipWeights), pair.oop.position, pair.oop.roleId ?? '', pair.oop.roleCode, pair.oop.roleName, planningWeightKey(oopWeights)])
}
function planningRoleReferenceRatings(scopeKey: string, reference: ReferenceDataset, pair: Pair, ipWeights: Record<string, number>, oopWeights: Record<string, number>) {
  let byReference = planningRoleReferenceCache.get(scopeKey)
  if (!byReference) { byReference = new WeakMap(); planningRoleReferenceCache.set(scopeKey, byReference) }
  let cache = byReference.get(reference)
  if (!cache) { cache = new Map(); byReference.set(reference, cache) }
  const key = planningRoleReferenceKey(pair, ipWeights, oopWeights)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const ratings = reference.players.filter(player => canPlayPosition([player.p], pair.ip.position)).map(player => referencePairedRoleScore(player, reference.attributes, ipWeights, oopWeights)).filter((value): value is number => value !== null).sort((a, b) => a - b)
  cache.set(key, ratings)
  return ratings
}
function normalizePlanning(raw: (Planning & { assignments?: Record<string, string> }) | undefined): Planning {
  const base: Planning = raw ? { ...defaults(), groups: raw.groups ?? defaults().groups, slotAssignments: raw.slotAssignments ?? {}, setLayouts: raw.setLayouts ?? {} } : defaults()
  return { ...base, groups: [...base.groups, ...transferGroups.filter(required => !base.groups.some(group => group.id === required.id))] }
}
function modelDiagnostic(result: { diagnostic?: string | null }) { return result.diagnostic ?? '' }

type PlanningPageProps = { active?: boolean }
export function PlanningPage({ active = true }: PlanningPageProps = {}) {
  const { selected } = useSaves()
  const navigate = useNavigate()
  const [players, setPlayers] = useState<Player[]>([])
  const [memberships, setMemberships] = useState<PlayerMembershipWithClubs[]>([])
  const [membershipDiagnostic, setMembershipDiagnostic] = useState('')
  const [reference, setReference] = useState<ReferenceDataset | null>(null)
  const [config, setConfig] = useState<Config>({ planning: defaults() })
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null)
  const [undoPlanning, setUndoPlanning] = useState<PlanningUndo | null>(null)
  const [status, setStatus] = useState('Carregando…')
  const [saveDetail, setSaveDetail] = useState('')
  const [dragging, setDragging] = useState<DragItem | null>(null)
  const [playerDropPreview, setPlayerDropPreview] = useState<PlayerDropPreview | null>(null)
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
  const [showScores, setShowScores] = useState(true)
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set())
  const [pickerSetId, setPickerSetId] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const loaded = useRef(false)

  const planningClubs = useMemo(() => activePlanningClubs(selected?.structure?.trackedClubs ?? []), [selected?.structure?.trackedClubs])
  const primaryClubId = useMemo(() => primaryPlanningClubId(selected?.structure?.trackedClubs ?? []), [selected?.structure?.trackedClubs])
  const selectedClub = planningClubs.find(item => item.club_id === selectedClubId) ?? null
  const saveStatus = (next: string, detail?: string) => { setStatus(next); setSaveDetail(detail ?? '') }

  useEffect(() => { void loadReferenceDataset().then(setReference) }, [])
  useEffect(() => {
    let alive = true
    loaded.current = false
    setUndoPlanning(null); setMemberships([]); setMembershipDiagnostic(''); setExpandedSets(new Set()); setFocusedSetId(null); setPlayerDropPreview(null); setPickerSetId(null)
    setManagerSetDragging(null); setManagerSetPreview(undefined); setManagerGroupDragging(null); setManagerGroupPreview(undefined)
    if (!supabase || !selected) return () => { alive = false }
    setLoading(true); saveStatus('Carregando…')
    void Promise.all([loadCurrentPlayers(selected.id), loadModelConfig(selected.id)]).then(async ([cached, modelConfig]) => {
      const currentPlayers = cached as unknown as Player[]
      const existing = modelConfig as Config
      const tracked = selected.structure?.trackedClubs ?? []
      const primaryId = primaryPlanningClubId(tracked)
      const remembered = typeof window === 'undefined' ? null : localStorage.getItem(planningClubStorageKey(selected.id))
      const nextClubId = resolvePlanningClubId(tracked, remembered)
      const membershipResult = await loadPlanningMembershipsWarm(selected.id, nextClubId, currentPlayers).then(rows => ({ rows, diagnostic: '' })).catch(error => ({ rows: [] as PlayerMembershipWithClubs[], diagnostic: describeDbError(error).full }))
      if (!alive) return
      startTransition(() => {
        setPlayers(currentPlayers); setMemberships(membershipResult.rows); setMembershipDiagnostic(membershipResult.diagnostic)
        const promotedPlanning = promoteLegacyPrimaryPlanning(existing, primaryId)
        const planningByClub = Object.fromEntries(Object.entries(promotedPlanning).map(([clubId, raw]) => [clubId, normalizePlanning(raw as Planning)]))
        const selectedPlanning = nextClubId ? normalizePlanning(resolveClubPlanning({ ...existing, planning_by_club: planningByClub }, nextClubId, primaryId, defaults)) : normalizePlanning(existing.planning)
        const selectedTacticByClub = promoteLegacyPrimaryTacticId(existing, primaryId)
        const tacticSelection = sanitizeClubTacticSelections({ ...existing, selected_tactic_id_by_club: selectedTacticByClub }, (existing.tactics ?? []).map(item => item.id))
        const legacyPlanning = primaryId && planningByClub[primaryId] ? planningByClub[primaryId] : normalizePlanning(existing.planning)
        setConfig({ ...existing, ...tacticSelection, planning: legacyPlanning, planning_by_club: planningByClub })
        setSelectedClubId(nextClubId)
        if (typeof window !== 'undefined') { if (nextClubId) localStorage.setItem(planningClubStorageKey(selected.id), nextClubId); else localStorage.removeItem(planningClubStorageKey(selected.id)) }
        setSelectedGroup(selectedPlanning.groups[0]?.id ?? '')
        loaded.current = true; saveStatus('✓ Salvo'); setLoading(false)
      })
    }).catch(error => { if (alive) { setStatus('⚠ Não foi possível carregar'); setSaveDetail(describeDbError(error).full); setLoading(false) } })
    return () => { alive = false }
  }, [selected?.id])

  useEffect(() => {
    if (!active || !loaded.current || !selected || !supabase) return
    let alive = true
    void loadModelConfig(selected.id).then(modelConfig => {
      if (!alive || !loaded.current) return
      const latest = modelConfig as Config
      const tactics = latest.tactics ?? []
      const tacticSelection = sanitizeClubTacticSelections({ ...latest, selected_tactic_id_by_club: promoteLegacyPrimaryTacticId(latest, primaryClubId) }, tactics.map(item => item.id))
      setConfig(previous => ({ ...previous, tactics, role_weight_overrides: latest.role_weight_overrides ?? previous.role_weight_overrides, ...tacticSelection }))
      setExpandedSets(new Set()); setFocusedSetId(null); setPickerSetId(null)
    }).catch(error => { if (alive) console.error('Falha ao sincronizar a tática de referência do Planejamento.', describeDbError(error).full) })
    return () => { alive = false }
  }, [active, selected?.id, primaryClubId])

  useEffect(() => {
    if (!loaded.current || !selected || !supabase) return
    const patch: Record<string, unknown> = { planning_by_club: config.planning_by_club ?? {}, selected_tactic_id: config.selected_tactic_id ?? null, selected_tactic_id_by_club: config.selected_tactic_id_by_club ?? {} }
    if (config.planning !== undefined) patch.planning = config.planning
    scheduleModelConfigPatch(selected.id, '2.9.0', patch, saveStatus)
  }, [config.planning, config.planning_by_club, config.selected_tactic_id, config.selected_tactic_id_by_club, selected?.id])

  useEffect(() => { const close = () => setMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [])

  const planning = selectedClubId ? resolveClubPlanning(config, selectedClubId, primaryClubId, defaults) : config.planning ?? defaults()
  const assignmentIndex = useMemo(() => derivePlanningAssignmentIndex(planning.slotAssignments), [planning.slotAssignments])
  const tactics = config.tactics ?? []
  const scopedTacticId = selectedClubId ? resolveClubTacticId(config, selectedClubId, primaryClubId, tactics.map(item => item.id)) : config.selected_tactic_id ?? null
  const tactic = tactics.find(item => item.id === scopedTacticId) ?? (!selectedClubId || selectedClubId === primaryClubId ? tactics[0] : undefined)
  const pairs: Pair[] = useMemo(() => tactic ? tactic.ipAssignments.map(ip => ({ ip, oop: tactic.oopAssignments.find(oop => oop.playerId === ip.playerId) ?? ip })) : [], [tactic])
  const pitchNodeX = useMemo(() => new Map(PITCH_NODES.map(node => [node.id, node.x])), [])
  const slotDescriptors: TacticSlotDescriptor[] = useMemo(() => pairs.map(pair => ({ id: pair.ip.playerId, position: pair.ip.position, oopPosition: pair.oop.position, nodeId: pair.ip.nodeId, x: pitchNodeX.get(pair.ip.nodeId) })), [pairs, pitchNodeX])
  const pairBySlot = useMemo(() => new Map(pairs.map(pair => [pair.ip.playerId, pair])), [pairs])
  const roleOverrides = config.role_weight_overrides ?? EMPTY_ROLE_OVERRIDES
  const latestByPlayer = useMemo(() => new Map(players.map(player => [player.id, player.player_snapshots[0]])), [players])
  const latest = (player: Player) => latestByPlayer.get(player.id)
  const membershipsByPlayer = useMemo(() => {
    const rows = new Map<string, PlayerMembershipWithClubs[]>()
    memberships.forEach(membership => { const values = rows.get(membership.player_id) ?? []; values.push(membership); rows.set(membership.player_id, values) })
    return rows
  }, [memberships])
  const membershipFacts = useMemo(() => new Map(players.map(player => {
    const snapshot = latestByPlayer.get(player.id)
    return [player.id, classifyPlanningMembership(resolveCurrentSnapshotMembership(membershipsByPlayer.get(player.id) ?? [], snapshot?.id), selectedClubId)]
  })), [players, latestByPlayer, membershipsByPlayer, selectedClubId])
  const membershipFact = (playerId: string) => membershipFacts.get(playerId) ?? classifyPlanningMembership(undefined, selectedClubId)
  const planningIndex = useMemo(() => derivePlanningClubIndex(config.planning_by_club ?? {}), [config.planning_by_club])
  const plannedClubName = (playerId: string) => { const clubId = planningIndex.clubByPlayer[playerId]; return planningClubs.find(item => item.club_id === clubId)?.club.name ?? null }
  const plannedClubConflict = (playerId: string) => planningIndex.conflicts[playerId]?.map(clubId => planningClubs.find(item => item.club_id === clubId)?.club.name ?? clubId) ?? []

  const currentGroupIndex = Math.max(0, planning.groups.findIndex(group => group.id === selectedGroup))
  const currentGroup = planning.groups[currentGroupIndex]
  const isTransferGroup = Boolean(currentGroup && transferGroups.some(group => group.id === currentGroup.id))
  const currentSets = useMemo(() => tactic && currentGroup && !isTransferGroup ? layoutsFor(planning, tactic.id, currentGroup.id, slotDescriptors) : [], [planning, tactic, currentGroup, isTransferGroup, slotDescriptors])
  const displaySetLabel = (set: PlanningSetLayout) => planningSetDisplayLabel(set, currentSets, slotDescriptors)
  const setPairs = (set: PlanningSetLayout) => set.slotIds.map(id => pairBySlot.get(id)).filter((pair): pair is Pair => Boolean(pair))
  const setHeaderLabel = (set: PlanningSetLayout) => {
    const localPairs = setPairs(set)
    const positions = [...new Set(localPairs.map(pair => planningPitchPositionLabel(pair.ip.position, pair.ip.nodeId)))]
    return planningPitchSetHeader(
      positions.join(' / ') || displaySetLabel(set).replace(/\s+\d+$/, ''),
      localPairs.map(pair => pair.ip.roleCode || pair.ip.roleName),
      localPairs.map(pair => pair.oop.roleCode || pair.oop.roleName),
    )
  }
  const spatialPlacements = useMemo(() => {
    const items = currentSets.map(set => {
      const setPairsValue = set.slotIds.map(id => pairBySlot.get(id)).filter((pair): pair is Pair => Boolean(pair))
      const firstSlot = setPairsValue[0]
      const anchors = setPairsValue.map(pair => pitchNodeX.get(pair.ip.nodeId)).filter((value): value is number => Number.isFinite(value))
      return { key: set.id, line: planningLine(firstSlot?.ip.position ?? ''), label: firstSlot?.ip.position ?? 'M (C)', anchorX: anchors.length ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length : undefined }
    })
    const tacticDerived = new Map(planningSpatialLayout(items).map(item => [item.key, item]))
    const placements = new Map<string, PlanningGridPlacement>()
    currentSets.forEach(set => {
      const placement = tacticDerived.get(set.id)
      if (!placement) return
      if (placement.line === 'gk') { placements.set(set.id, { ...placement, x: 50, y: PLANNING_VISUAL_GOALKEEPER_Y, gridRow: 6, gridColumn: 3, isGoalkeeper: true }); return }
      const cell = planningVisualGridCellForSet(set, placement.x, placement.line)
      placements.set(set.id, { ...placement, gridRow: cell.row, gridColumn: cell.column, x: PLANNING_VISUAL_GRID_COLUMNS[cell.column - 1], y: PLANNING_VISUAL_GRID_ROWS[cell.row - 1], isGoalkeeper: false })
    })
    return placements
  }, [currentSets, pairBySlot, pitchNodeX])
  useEffect(() => { if (focusedSetId && !currentSets.some(set => set.id === focusedSetId)) setFocusedSetId(null); if (pickerSetId && !currentSets.some(set => set.id === pickerSetId)) setPickerSetId(null) }, [focusedSetId, pickerSetId, currentSets])
  useEffect(() => {
    if (!pickerSetId) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPickerSetId(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [pickerSetId])

  function resolvedWeights(slot: Assignment, phase: 'IP' | 'OOP') {
    const id = slot.roleId ?? `${phase}-${positionGroup(slot.position)}-${slot.roleCode}`
    return resolveRoleWeights({ roleId: id, roleName: slot.roleName, overrideWeights: roleOverrides[id] ?? tactic?.roles?.find(role => role.id === id)?.weights })
  }
  function pairRoleScore(player: Player, pair: Pair) { const snapshot = latest(player); return snapshot ? pairedRoleScore(snapshot.player_attributes, resolvedWeights(pair.ip, 'IP'), resolvedWeights(pair.oop, 'OOP')) : null }
  function generalScore(player: Player) { const snapshot = latest(player); return snapshot ? generalScoreForSnapshot(snapshot)?.score ?? null : null }
  const referenceScopeKey = useMemo(() => planningReferenceScopeKey(selected?.id ?? '__no_save__', selectedClubId), [selected?.id, selectedClubId])
  const referenceRatings = useMemo(() => new Map(pairs.map(pair => {
    const ipWeights = resolvedWeights(pair.ip, 'IP'); const oopWeights = resolvedWeights(pair.oop, 'OOP')
    return [pair.ip.playerId, reference ? planningRoleReferenceRatings(referenceScopeKey, reference, pair, ipWeights, oopWeights) : []]
  })), [pairs, reference, referenceScopeKey, roleOverrides, tactic])
  const playerScores = useMemo(() => new Map(players.map(player => [player.id, new Map(pairs.map(pair => {
    const value = pairRoleScore(player, pair); return [pair.ip.playerId, { value, rank: value === null ? null : percentile(value, referenceRatings.get(pair.ip.playerId) ?? []) }]
  }))])), [players, pairs, referenceRatings, roleOverrides, tactic])
  const pairRating = (player: Player, pair: Pair) => playerScores.get(player.id)?.get(pair.ip.playerId)?.value ?? null
  const pairPercentile = (player: Player, pair: Pair) => playerScores.get(player.id)?.get(pair.ip.playerId)?.rank ?? null
  function setScore(player: Player, set: PlanningSetLayout) {
    return setPairs(set).map(pair => ({ pair, value: pairRating(player, pair), rank: pairPercentile(player, pair), rankPopulation: referenceRatings.get(pair.ip.playerId) ?? [] })).reduce<{ pair: Pair | null; value: number | null; rank: number | null; rankPopulation: number[] }>((best, current) => best.pair === null || (current.value ?? -1) > (best.value ?? -1) ? current : best, { pair: null, value: null, rank: null, rankPopulation: [] })
  }
  function setFamiliarity(player: Player, set: PlanningSetLayout) { return planningFamiliarity(latest(player), setPairs(set)) }
  const currentGroupPlayerIds = useMemo(() => new Set(Object.values(planning.slotAssignments[currentGroup?.id ?? ''] ?? {}).flat().filter(Boolean)), [planning.slotAssignments, currentGroup?.id])
  function coveragePlayers(set: PlanningSetLayout) {
    if (!currentGroup) return []
    return players.filter(player => currentGroupPlayerIds.has(player.id) && isPlanningFamiliar(setFamiliarity(player, set)) && Boolean(primarySetForPlayer(planning, currentGroup.id, currentSets, player.id)?.id !== set.id))
  }
  function primaryLabel(playerId: string) { const set = currentGroup ? primarySetForPlayer(planning, currentGroup.id, currentSets, playerId) : null; return set ? displaySetLabel(set) : 'Outro conjunto' }
  function tacticScoreDetails(player: Player): PlanningScoreDetail[] {
    const snapshot = latest(player)
    if (!snapshot) return []
    return currentSets.flatMap(set => set.slotIds.flatMap(slotId => { const pair = pairBySlot.get(slotId); return pair && canPlayPosition(snapshot.positions, pair.ip.position) ? [{ id: slotId, label: planningSlotDisplayLabel(set, slotId, slotDescriptors), score: pairRating(player, pair) }] : [] }))
  }

  function update(fn: (planning: Planning) => Planning) {
    const next = fn(planning)
    if (next === planning) return
    setUndoPlanning({ planning: config.planning, planning_by_club: config.planning_by_club })
    setConfig(current => selectedClubId ? { ...current, ...patchClubPlanning(current, selectedClubId, primaryClubId, next) } : { ...current, planning: next })
  }
  function undo() { if (!undoPlanning) return; setConfig(current => ({ ...current, planning: undoPlanning.planning, planning_by_club: undoPlanning.planning_by_club })); setUndoPlanning(null) }
  function changePlanningClub(clubId: string) {
    if (!selected || clubId === selectedClubId || !planningClubs.some(item => item.club_id === clubId)) return
    const nextPlanning = resolveClubPlanning(config, clubId, primaryClubId, defaults)
    setSelectedClubId(clubId); localStorage.setItem(planningClubStorageKey(selected.id), clubId); setSelectedGroup(nextPlanning.groups[0]?.id ?? ''); setUndoPlanning(null); setExpandedSets(new Set()); setFocusedSetId(null); setPickerSetId(null)
  }
  function selectClubTactic(id: string) {
    setExpandedSets(new Set()); setFocusedSetId(null); setPickerSetId(null)
    if (!selectedClubId) { setConfig(current => ({ ...current, selected_tactic_id: id })); void persistPatch({ selected_tactic_id: id }); return }
    setConfig(current => ({ ...current, ...patchClubTacticId(current, selectedClubId, primaryClubId, id) }))
  }
  function changeGroup(direction: number) { if (!planning.groups.length) return; const next = (currentGroupIndex + direction + planning.groups.length) % planning.groups.length; setSelectedGroup(planning.groups[next].id); setExpandedSets(new Set()); setFocusedSetId(null); setPickerSetId(null) }
  function addGroup() { if (!newGroup.trim()) return; update(value => ({ ...value, groups: [...value.groups, { id: crypto.randomUUID(), name: newGroup.trim() }] })); setNewGroup('') }
  function renameGroup(id: string, name: string) { update(value => ({ ...value, groups: value.groups.map(group => group.id === id ? { ...group, name } : group) })) }
  function removeGroup(id: string) {
    const group = planning.groups.find(item => item.id === id); const allocated = Object.values(planning.slotAssignments[id] ?? {}).flat().filter(Boolean).length
    if (!confirm(allocated > 0 ? `Excluir “${group?.name ?? 'este elenco'}” e remover ${allocated} alocação${allocated === 1 ? '' : 'ões'}? Os jogadores voltarão para a lista disponível.` : `Excluir o elenco “${group?.name ?? 'selecionado'}”?`)) return
    if (selectedGroup === id) setSelectedGroup(planning.groups.find(item => item.id !== id)?.id ?? '')
    update(value => ({ ...value, groups: value.groups.filter(groupItem => groupItem.id !== id), slotAssignments: Object.fromEntries(Object.entries(value.slotAssignments).filter(([groupId]) => groupId !== id)), setLayouts: Object.fromEntries(Object.entries(value.setLayouts ?? {}).map(([tacticId, groups]) => [tacticId, Object.fromEntries(Object.entries(groups).filter(([groupId]) => groupId !== id))])) }))
  }
  function removePlayer(id: string) { update(value => removePlayerFromPlanning(value, id) as Planning) }
  function clearPlanning() { if (!confirm('Remover todas as alocações de todos os elencos deste planejamento?')) return; if (!confirm('Confirme novamente: limpar TODOS os elencos?')) return; update(value => ({ ...value, slotAssignments: {} })) }
  function clearCurrentGroup() { if (currentGroup && confirm(`Remover todas as alocações de “${currentGroup.name}”?`)) update(value => ({ ...value, slotAssignments: { ...value.slotAssignments, [currentGroup.id]: {} } })) }
  function placePlayer(groupId: string, setId: string, playerId: string, beforePlayerId?: string | null) {
    if (!selectedClubId) { update(value => movePlayerToSet(value, groupId, setId, playerId, beforePlayerId) as Planning); return }
    const target = movePlayerToSet(planning, groupId, setId, playerId, beforePlayerId) as Planning
    setUndoPlanning({ planning: config.planning, planning_by_club: config.planning_by_club })
    setConfig(current => { const planningByClub = movePlayerAcrossClubPlans(current.planning_by_club ?? {}, selectedClubId, playerId, target); return { ...current, planning_by_club: planningByClub, ...(selectedClubId === primaryClubId ? { planning: planningByClub[selectedClubId] } : {}) } })
  }
  function stopPlayerDrag() { setDragging(null); setPlayerDropPreview(null) }
  function toggleSet(setId: string) { setExpandedSets(current => { const next = new Set(current); if (next.has(setId)) next.delete(setId); else next.add(setId); return next }) }
  function groupSet(firstId: string, secondId: string) { if (tactic && currentGroup) update(value => groupAdjacentPlanningSets(value, tactic.id, currentGroup.id, currentSets, firstId, secondId, slotDescriptors, `set-${crypto.randomUUID()}`) as Planning) }
  function splitSet(setId: string) { if (tactic && currentGroup) update(value => splitPlanningSet(value, tactic.id, currentGroup.id, currentSets, setId, slotDescriptors) as Planning) }
  function renameSet(setId: string, label: string) { if (tactic && currentGroup) update(value => renamePlanningSet(value, tactic.id, currentGroup.id, currentSets, setId, label) as Planning) }
  function renameSetSlot(setId: string, slotId: string, label: string) { if (tactic && currentGroup) update(value => renamePlanningSlotLabel(value, tactic.id, currentGroup.id, currentSets, setId, slotId, label) as Planning) }
  function reorderSet(draggedId: string, beforeId: string | null) { if (tactic && currentGroup) update(value => reorderPlanningSets(value, tactic.id, currentGroup.id, currentSets, draggedId, beforeId) as Planning) }
  function reorderGroup(draggedId: string, beforeId: string | null) { update(value => reorderPlanningGroups(value, draggedId, beforeId) as Planning) }
  function restoreSets() { if (tactic && currentGroup) update(value => restoreDefaultPlanningSets(value, tactic.id, currentGroup.id, currentSets, slotDescriptors) as Planning) }
  function restoreSetVisualPositions() { if (tactic && currentGroup) update(value => restorePlanningSetVisualGrid(value, tactic.id, currentGroup.id, currentSets) as Planning) }
  function moveSetVisualPosition(setId: string, requested: PlanningVisualGridCell) {
    if (!tactic || !currentGroup) return
    const source = spatialPlacements.get(setId); if (!source || source.isGoalkeeper) return
    const currentCells = Object.fromEntries([...spatialPlacements].filter(([, placement]) => !placement.isGoalkeeper).map(([id, placement]) => [id, { row: placement.gridRow, column: placement.gridColumn }]))
    update(value => movePlanningSetVisualGrid(value, tactic.id, currentGroup.id, currentSets, setId, requested, currentCells) as Planning)
  }
  async function persistPatch(patch: Record<string, unknown>) { if (!selected) return; saveStatus('Salvando…'); try { const result = await patchModelConfig(selected.id, '2.9.0', patch); saveStatus('✓ Salvo', modelDiagnostic(result)) } catch (error) { saveStatus('⚠ Não foi possível salvar', describeDbError(error).full) } }
  async function retrySave() { if (!selected) return; try { const result = await retryModelConfigPatch(selected.id, saveStatus); if (!result) await persistPatch({ planning: config.planning ?? defaults(), planning_by_club: config.planning_by_club ?? {}, selected_tactic_id: config.selected_tactic_id ?? null, selected_tactic_id_by_club: config.selected_tactic_id_by_club ?? {} }) } catch { /* shared layer owns status */ } }
  function openPlayerMenu(event: ReactMouseEvent, playerId: string) { event.preventDefault(); event.stopPropagation(); setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 238)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 140)), playerId }) }
  function moveMenuPlayer(groupId: 'loan' | 'sale') { if (!menu) return; placePlayer(groupId, 'market', menu.playerId); setSelectedGroup(groupId); setFocusedSetId(null); setPickerSetId(null); setMenu(null) }

  const pickerSet = currentSets.find(set => set.id === pickerSetId) ?? null
  const pickerPairs = pickerSet ? setPairs(pickerSet) : []
  const pickerRows = useMemo<PickerRow[]>(() => {
    if (!pickerSet || !currentGroup) return []
    const targetIds = new Set(planning.slotAssignments[currentGroup.id]?.[pickerSet.id] ?? [])
    return players.map(player => {
      const snapshot = latestByPlayer.get(player.id)
      const compatible = isPlanningFamiliar(planningFamiliarity(snapshot, pickerPairs))
      const rating = setScore(player, pickerSet)
      const currentSet = primarySetForPlayer(planning, currentGroup.id, currentSets, player.id)
      const projectionPairs = rating.pair ? [rating.pair] : pickerPairs
      return {
        player, snapshot, compatible, alreadyInTarget: targetIds.has(player.id), score: rating.value, rank: rating.rank, rankPopulation: rating.rankPopulation,
        fact: membershipFact(player.id), planLabel: currentSet ? displaySetLabel(currentSet) : plannedClubName(player.id) ?? 'Não alocado',
        projectionKey: snapshot ? functionProjectionKey(projectionPairs.flatMap(pair => [{ phase: 'IP', position: pair.ip.position, roleCode: pair.ip.roleCode }, { phase: 'OOP', position: pair.oop.position, roleCode: pair.oop.roleCode }])) : '',
      }
    }).filter(row => row.player.current_name.toLowerCase().includes(pickerSearch.trim().toLowerCase()))
      .sort((a, b) => Number(b.compatible) - Number(a.compatible) || Number(a.alreadyInTarget) - Number(b.alreadyInTarget) || (b.score ?? -1) - (a.score ?? -1) || a.player.current_name.localeCompare(b.player.current_name, 'pt-BR'))
  }, [pickerSet, currentGroup, planning, currentSets, players, latestByPlayer, pickerSearch, playerScores, referenceRatings, membershipFacts, planningIndex, planningClubs])
  function renderPickerCell(row: PickerRow, column: PickerColumn): ReactNode {
    if (column.id === 'name') return <div className="planning-picker-player"><span className="planning-picker-peek">{row.snapshot && <PlayerPeek player={row.player} snapshot={row.snapshot} />}</span><strong>{row.player.current_name}</strong>{!row.compatible && <small>Sem familiaridade</small>}</div>
    if (column.id === 'positions') return row.snapshot?.positions.join(', ') || '—'
    if (column.id === 'age') return row.snapshot?.age ?? '—'
    if (column.id === 'fact') return <span className={`membership-badge is-${row.fact.kind}`}>{row.fact.label}</span>
    if (column.id === 'plan') return row.alreadyInTarget ? <span className="planning-picker-current">Neste conjunto</span> : row.planLabel
    return row.snapshot ? <ScoreWithProjection playerId={row.player.id} currentScore={row.score} currentRank={row.rank} rankPopulation={row.rankPopulation} snapshot={row.snapshot} scoreType="function" scoreKey={row.projectionKey} variant="compact" currentTitle="Nota atual nesta função" /> : '—'
  }

  const activePlayer = players.find(player => player.id === dragging?.id)
  return <div className="screen-page planning-page planning-flex-page planning-pitch-list-page">
    <div className="title-row planning-title-row"><div><h1>Planejamento{selectedClub && planningClubs.length > 1 ? ` · ${selectedClub.club.name}` : ''}</h1>{(loading || isPending) && <span className="background-loading" role="status">Carregando em segundo plano…</span>}</div><SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠') ? () => void retrySave() : undefined} /></div>
    <section className="planning-matrix-toolbar planning-aligned-toolbar planning-flex-toolbar">
      {planningClubs.length > 1 && <CustomSelect className="tactic-custom-select" ariaLabel="Clube do planejamento" value={selectedClubId ?? ''} options={planningClubs.map(item => ({ value: item.club_id, label: item.tracking_role === 'primary' ? `${item.club.name} · Principal` : item.club.name }))} placeholder="Clube" onChange={changePlanningClub} />}
      <CustomSelect className="tactic-custom-select" ariaLabel="Tática selecionada" value={tactic?.id ?? ''} options={tactics.map(item => ({ value: item.id, label: item.name }))} placeholder={tactics.length ? 'Tática' : 'Nenhuma tática criada'} disabled={!tactics.length || isTransferGroup} disabledReason={isTransferGroup ? 'Táticas não se aplicam a grupos de mercado' : !tactics.length ? 'Nenhuma tática criada' : undefined} onChange={selectClubTactic} />
      <div className="squad-pagination planning-group-selector"><button onClick={() => changeGroup(-1)} disabled={planning.groups.length < 2}>‹</button><strong>{currentGroup?.name ?? 'Nenhum elenco'}</strong><span>{planning.groups.length ? `${currentGroupIndex + 1} de ${planning.groups.length}` : '0 de 0'}</span><button onClick={() => changeGroup(1)} disabled={planning.groups.length < 2}>›</button></div>
      <label className={`coverage-toggle ${isTransferGroup || !tactic ? 'is-disabled' : ''}`}><input type="checkbox" checked={showCoverages} disabled={isTransferGroup || !tactic} onChange={event => setShowCoverages(event.target.checked)} /><span>Mostrar coberturas</span></label>
      <label className={`coverage-toggle planning-score-toggle ${isTransferGroup || !tactic ? 'is-disabled' : ''}`}><input type="checkbox" checked={showScores} disabled={isTransferGroup || !tactic} onChange={event => setShowScores(event.target.checked)} /><span>Mostrar notas</span></label>
      <div className="planning-flex-actions"><button className="ghost undo-planning-button dt-control" onClick={undo} disabled={!undoPlanning} title="Desfazer última alteração">↶</button><button className="ghost manage-sets-button dt-control" disabled={isTransferGroup || !tactic} onClick={() => setManageSetsOpen(true)}>Organizar posições</button><button className="ghost manage-squads-button dt-control" onClick={() => setManageSquadsOpen(true)}>Gerenciar elencos</button><button className="planning-clear-current dt-control" type="button" disabled={!currentGroupPlayerIds.size} onClick={clearCurrentGroup} title={`Limpar ${currentGroup?.name ?? 'elenco'}`}>🗑</button></div>
    </section>

    <section className="planning-depth-layout planning-flex-layout planning-full-pitch-layout">
      <div className={`planning-flex-board ${expandedSets.size ? 'has-expanded' : ''} ${isTransferGroup ? 'is-transfer' : ''}`}>
        {isTransferGroup && currentGroup ? <TransferGroupPanel group={currentGroup} playerIds={planning.slotAssignments[currentGroup.id]?.market ?? []} players={players} latest={latest} fact={membershipFact} plannedClub={plannedClubName} dragging={Boolean(activePlayer)} drop={() => { if (activePlayer) placePlayer(currentGroup.id, 'market', activePlayer.id); stopPlayerDrag() }} startDrag={id => setDragging({ type: 'player', id })} dragEnd={stopPlayerDrag} open={id => navigate(`/players/${id}`)} context={openPlayerMenu} remove={removePlayer} />
          : tactic && currentGroup ? <div className={`planning-set-list is-spatial-ready ${expandedSets.size ? 'has-expanded' : ''}`}>{currentSets.map(set => <PlanningSetRow key={set.id} set={set} spatial={spatialPlacements.get(set.id)} displayLabel={displaySetLabel(set)} headerLabel={setHeaderLabel(set)} pairs={setPairs(set)} assignedIds={planning.slotAssignments[currentGroup.id]?.[set.id] ?? []} players={players} latest={latest} expanded={expandedSets.has(set.id)} focused={focusedSetId === set.id} coverages={showCoverages ? coveragePlayers(set) : []} showCoverages={showCoverages} showScores={showScores} generalScore={generalScore} scoreDetails={tacticScoreDetails} primaryLabel={primaryLabel} activePlayer={activePlayer} playerDropPreview={playerDropPreview} score={player => setScore(player, set)} familiarity={player => setFamiliarity(player, set)} fact={membershipFact} plannedClub={plannedClubName} plannedConflict={plannedClubConflict} toggle={() => toggleSet(set.id)} focus={() => setFocusedSetId(current => current === set.id ? null : set.id)} addPlayer={() => { setPickerSearch(''); setPickerSetId(set.id) }} startPlayerDrag={(id, event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDragging({ type: 'player', id }); setPlayerDropPreview(null) }} stopPlayerDrag={stopPlayerDrag} previewPlayer={beforePlayerId => setPlayerDropPreview({ setId: set.id, beforePlayerId })} dropPlayer={beforePlayerId => { if (activePlayer) placePlayer(currentGroup.id, set.id, activePlayer.id, beforePlayerId); stopPlayerDrag() }} open={id => navigate(`/players/${id}`)} context={openPlayerMenu} moveVisualGrid={cell => moveSetVisualPosition(set.id, cell)} />)}</div>
          : <div className="empty planning-no-tactic"><h2>Nenhuma tática disponível</h2><p>Crie uma tática para organizar o elenco por posição e função.</p><button onClick={() => navigate('/tactics')}>Criar primeira tática</button></div>}
      </div>
    </section>

    {pickerSet && currentGroup && <div className="settings-overlay planning-add-player-overlay" onClick={() => setPickerSetId(null)}><section className="planning-add-player-modal" onClick={event => event.stopPropagation()}><header><div><h2>Adicionar jogador</h2><p>{setHeaderLabel(pickerSet)}</p></div><button className="close" onClick={() => setPickerSetId(null)}>×</button></header><div className="planning-add-player-search"><input autoFocus placeholder="Buscar jogador" value={pickerSearch} onChange={event => setPickerSearch(event.target.value)} /><span>{pickerRows.length} jogadores</span></div>{membershipDiagnostic && <div className="planning-membership-warning" title={membershipDiagnostic}>Contexto factual indisponível; a escolha manual continua disponível.</div>}<div className="planning-add-player-table"><DataTable<PickerRow, PickerColumn> rows={pickerRows} columns={PICKER_COLUMNS} rowKey={row => row.player.id} renderCell={renderPickerCell} getColumnWidth={column => PICKER_WIDTHS[column.id]} getColumnMinWidth={column => column.id === 'name' ? 190 : column.id === 'score' ? 160 : 70} getColumnMaxWidth={() => 420} fillContainer frozenIndex={0} capabilities={{ sorting: false, resizing: false, reordering: false, freezing: true, selection: true }} onSelectRow={row => { if (row.alreadyInTarget) return; placePlayer(currentGroup.id, pickerSet.id, row.player.id); setPickerSetId(null) }} isRowDisabled={row => row.alreadyInTarget} getRowClassName={row => `${!row.compatible ? 'planning-picker-row-incompatible ' : ''}${row.alreadyInTarget ? 'planning-picker-row-current' : ''}`.trim()} getCellClassName={(_row, column) => column.id === 'name' ? 'planning-picker-name-cell' : column.id === 'score' ? 'planning-picker-score-cell' : undefined} emptyMessage="Nenhum jogador corresponde à busca." /></div><footer><span><i className="planning-picker-key is-compatible" /> Apto à função</span><span><i className="planning-picker-key is-incompatible" /> Sem familiaridade — ainda selecionável</span></footer></section></div>}

    {manageSquadsOpen && <div className="settings-overlay" onClick={() => setManageSquadsOpen(false)}><section className="squad-manager planning-squad-manager" onClick={event => event.stopPropagation()}><header><h2>Gerenciar elencos</h2><button className="close" onClick={() => setManageSquadsOpen(false)}>×</button></header><div className="squad-manager-list">{planning.groups.map((group, index) => { const fixed = transferGroups.some(item => item.id === group.id); const previewBefore = managerGroupPreview === group.id && managerGroupDragging !== group.id; return <Fragment key={group.id}>{previewBefore && <ManagerDropPlaceholder label="Mover elenco para cá" />}<div className={`planning-squad-manager-row ${fixed ? 'fixed-planning-group' : ''} ${managerGroupDragging === group.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerGroupPreview(event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null) }} onDrop={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderGroup(managerGroupDragging, event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null); setManagerGroupDragging(null); setManagerGroupPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.id); setManagerGroupDragging(group.id); setManagerGroupPreview(group.id) }} onDragEnd={() => { setManagerGroupDragging(null); setManagerGroupPreview(undefined) }}>⠿</button><input value={group.name} readOnly={fixed} onChange={event => renameGroup(group.id, event.target.value)} />{fixed ? <span className="market-group-label">GRUPO MERCADO</span> : <button className="manager-trash" onClick={() => removeGroup(group.id)}>🗑</button>}</div></Fragment> })}{managerGroupDragging && managerGroupPreview === null && <ManagerDropPlaceholder label="Mover elenco para o final" />}</div><footer className="planning-squad-manager-footer"><div className="planning-add-squad"><input placeholder="Novo elenco" value={newGroup} onChange={event => setNewGroup(event.target.value)} onKeyDown={event => event.key === 'Enter' && addGroup()} /><button onClick={addGroup}>+ Adicionar</button></div><button className="danger-button clear-all-squads" disabled={!Object.keys(assignmentIndex).length} onClick={clearPlanning}>Limpar todos os elencos</button></footer></section></div>}

    {manageSetsOpen && tactic && currentGroup && !isTransferGroup && <div className="settings-overlay" onClick={() => setManageSetsOpen(false)}><section className="squad-manager planning-set-manager" onClick={event => event.stopPropagation()}><header><div><h2>Organizar posições</h2><p>Organização visual de {currentGroup.name}; arraste os conjuntos pela grade 5×5. A sexta linha permanece reservada ao goleiro.</p></div><button className="close" onClick={() => setManageSetsOpen(false)}>×</button></header><div className="planning-set-manager-list">{currentSets.map((set, index) => { const effectiveLabel = displaySetLabel(set); const previewBefore = managerSetPreview === set.id && managerSetDragging !== set.id; const nextSet = currentSets[index + 1]; const canGroupNext = Boolean(nextSet && canGroupAdjacentPlanningSets(set, nextSet, slotDescriptors)); return <Fragment key={set.id}>{previewBefore && <ManagerDropPlaceholder label="Mover posição para cá" />}<div className={`planning-squad-manager-row ${set.slotIds.length > 1 ? 'is-grouped-manager-row' : ''} ${managerSetDragging === set.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerSetPreview(event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null) }} onDrop={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderSet(managerSetDragging, event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null); setManagerSetDragging(null); setManagerSetPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', set.id); setManagerSetDragging(set.id); setManagerSetPreview(set.id) }} onDragEnd={() => { setManagerSetDragging(null); setManagerSetPreview(undefined) }}>⠿</button>{set.slotIds.length > 1 ? <><button className="split-set-button" onClick={() => splitSet(set.id)}>−</button><div className="grouped-set-fields"><label>Nome geral<input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /></label>{set.slotIds.map((slotId, slotIndex) => <label key={slotId}>Posição {slotIndex + 1}<input value={planningSlotDisplayLabel(set, slotId, slotDescriptors)} onChange={event => renameSetSlot(set.id, slotId, event.target.value)} /></label>)}</div></> : <><span className="set-manager-order">{index + 1}</span><input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /><small>1 posição</small></>}</div>{canGroupNext && <button className="adjacent-group-button" type="button" onClick={() => groupSet(set.id, nextSet.id)}>+</button>}</Fragment> })}{managerSetDragging && managerSetPreview === null && <ManagerDropPlaceholder label="Mover posição para o final" />}</div><footer className="planning-set-manager-footer"><div><button className="ghost" onClick={restoreSetVisualPositions}>Restaurar posições do campo</button><button className="ghost" onClick={restoreSets}>Restaurar ordem e grupos da tática</button></div><button onClick={() => setManageSetsOpen(false)}>Concluir</button></footer></section></div>}

    {menu && <div className="planning-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}><button role="menuitem" onClick={() => moveMenuPlayer('loan')}>Adicionar a Empréstimo</button><button role="menuitem" onClick={() => moveMenuPlayer('sale')}>Adicionar a Venda</button><button role="menuitem" className="is-danger" onClick={() => { removePlayer(menu.playerId); setMenu(null) }}>Remover do planejamento</button></div>}
  </div>
}

function insertionBeforePlayer(container: HTMLElement, clientX: number, clientY: number, draggingId: string | undefined, currentBeforeId: string | null | undefined) {
  const cards = [...container.querySelectorAll<HTMLElement>('[data-planning-player-id]')].filter(card => card.dataset.planningPlayerId !== draggingId && card.offsetParent !== null).map(card => { const rect = card.getBoundingClientRect(); return { id: card.dataset.planningPlayerId ?? '', left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } }).filter(card => Boolean(card.id))
  return resolvePlanningInsertionBefore(cards, clientX, clientY, currentBeforeId)
}

function PlanningSetRow({ set, spatial, displayLabel, headerLabel, pairs, assignedIds, players, latest, expanded, focused, coverages, showCoverages, showScores, generalScore, scoreDetails, primaryLabel, activePlayer, playerDropPreview, score, familiarity, fact, plannedClub, plannedConflict, toggle, focus, addPlayer, startPlayerDrag, stopPlayerDrag, previewPlayer, dropPlayer, open, context, moveVisualGrid }: {
  set: PlanningSetLayout; spatial: PlanningGridPlacement | undefined; displayLabel: string; headerLabel: string; pairs: Pair[]; assignedIds: string[]; players: Player[]; latest: (player: Player) => Snapshot | undefined; expanded: boolean; focused: boolean; coverages: Player[]; showCoverages: boolean; showScores: boolean; generalScore: (player: Player) => number | null; scoreDetails: (player: Player) => PlanningScoreDetail[]; primaryLabel: (playerId: string) => string; activePlayer?: Player; playerDropPreview: PlayerDropPreview | null; score: (player: Player) => { pair: Pair | null; value: number | null; rank: number | null; rankPopulation: number[] }; familiarity: (player: Player) => Familiarity; fact: (playerId: string) => PlanningMembershipFact; plannedClub: (playerId: string) => string | null; plannedConflict: (playerId: string) => string[]; toggle: () => void; focus: () => void; addPlayer: () => void; startPlayerDrag: (id: string, event: DragEvent<HTMLElement>) => void; stopPlayerDrag: () => void; previewPlayer: (beforePlayerId: string | null) => void; dropPlayer: (beforePlayerId?: string | null) => void; open: (id: string) => void; context: (event: ReactMouseEvent, playerId: string) => void; moveVisualGrid: (cell: PlanningVisualGridCell) => void
}) {
  const capacity = PLANNING_PITCH_LIST_CAPACITY
  const members = assignedIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  const coverageOptions = showCoverages ? coverages.filter(player => !members.some(member => member.id === player.id)) : []
  const options = [...members.map(player => ({ player, coverage: false as const })), ...coverageOptions.map(player => ({ player, coverage: true as const }))]
  const visible = expanded ? options : options.slice(0, capacity)
  const hidden = Math.max(0, options.length - visible.length)
  const rowItems: Array<{ player: Player; coverage: boolean } | null> = expanded ? visible : Array.from({ length: capacity }, (_, index) => visible[index] ?? null)
  const grouped = set.slotIds.length > 1
  const articleRef = useRef<HTMLElement | null>(null)
  const compactRectRef = useRef<PlanningSetRect | null>(null)
  const [expansionLayout, setExpansionLayout] = useState<PlanningSetExpansion | null>(null)
  const [visualGridPreview, setVisualGridPreview] = useState<{ cell: PlanningVisualGridCell; occupantLabel: string | null } | null>(null)
  const visualGridPreviewRef = useRef<{ cell: PlanningVisualGridCell; occupantLabel: string | null } | null>(null)
  const visualDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; moved: boolean; startedOnLegend: boolean; captureElement: HTMLElement } | null>(null)
  const suppressLegendClickRef = useRef(false)
  const linePosition = pairs[0]?.ip.position ?? ''
  const activeFamiliarity = activePlayer ? familiarity(activePlayer) : 'unknown'
  const preview = playerDropPreview?.setId === set.id ? playerDropPreview.beforePlayerId : undefined
  function rectRelativeTo(rect: DOMRect, parentRect: DOMRect): PlanningSetRect { return { left: rect.left - parentRect.left, top: rect.top - parentRect.top, width: rect.width, height: rect.height } }
  function measuredExpansion(compactOverride?: PlanningSetRect | null) {
    const article = articleRef.current; const pitch = article?.parentElement; if (!article || !pitch) return null
    const pitchRect = pitch.getBoundingClientRect(); const compact = compactOverride ?? rectRelativeTo(article.getBoundingClientRect(), pitchRect)
    const obstacles = [...pitch.querySelectorAll<HTMLElement>('.planning-set-row')].filter(item => item !== article).map(item => rectRelativeTo(item.getBoundingClientRect(), pitchRect))
    return resolvePlanningSetExpansion({ pitchWidth: pitchRect.width, pitchHeight: pitchRect.height, compact, obstacles, playerCount: options.length, cardWidth: Math.max(110, compact.width - 12), cardHeight: 30, gap: 3, verticalItemsPerRow: 1, horizontalItemsPerColumn: 3 })
  }
  function toggleExpansion() {
    if (expanded) { compactRectRef.current = null; setExpansionLayout(null); toggle(); return }
    const article = articleRef.current; const pitch = article?.parentElement
    if (article && pitch) { const compact = rectRelativeTo(article.getBoundingClientRect(), pitch.getBoundingClientRect()); compactRectRef.current = compact; setExpansionLayout(measuredExpansion(compact)) }
    toggle()
  }
  useEffect(() => { if (!expanded) { compactRectRef.current = null; setExpansionLayout(null); return }; const refresh = () => compactRectRef.current && setExpansionLayout(measuredExpansion(compactRectRef.current)); refresh(); window.addEventListener('resize', refresh); return () => window.removeEventListener('resize', refresh) }, [expanded, options.length])
  function snappedVisualGridCell(clientX: number, clientY: number): PlanningVisualGridCell {
    const pitch = articleRef.current?.parentElement; if (!pitch) return { row: spatial?.gridRow ?? 3, column: spatial?.gridColumn ?? 3 }
    const rect = pitch.getBoundingClientRect(); const rawX = ((clientX - rect.left) / Math.max(1, rect.width)) * 100; const rawY = ((clientY - rect.top) / Math.max(1, rect.height)) * 100
    const column = PLANNING_VISUAL_GRID_COLUMNS.reduce((best, candidate, index) => Math.abs(candidate - rawX) < Math.abs(PLANNING_VISUAL_GRID_COLUMNS[best] - rawX) ? index : best, 0) + 1
    const row = PLANNING_VISUAL_GRID_ROWS.reduce((best, candidate, index) => Math.abs(candidate - rawY) < Math.abs(PLANNING_VISUAL_GRID_ROWS[best] - rawY) ? index : best, 0) + 1
    return { row, column }
  }
  function visualGridOccupant(cell: PlanningVisualGridCell) { const article = articleRef.current; const pitch = article?.parentElement; if (!article || !pitch) return null; return [...pitch.querySelectorAll<HTMLElement>('.planning-set-row')].find(item => item !== article && item.dataset.gridLocked !== 'goalkeeper' && Number(item.dataset.gridRow) === cell.row && Number(item.dataset.gridColumn) === cell.column)?.dataset.setLabel ?? null }
  function setVisualPreview(cell: PlanningVisualGridCell | null) { const next = cell ? { cell, occupantLabel: visualGridOccupant(cell) } : null; visualGridPreviewRef.current = next; setVisualGridPreview(next) }
  function visualSetDragBlocked(target: EventTarget | null) { const element = target instanceof Element ? target : null; if (!element) return true; if (element.closest('[data-planning-player-id], .planning-set-expand, .planning-set-collapse, .planning-set-add-player')) return true; const interactive = element.closest('button,a,input,select,textarea,[contenteditable="true"]'); return Boolean(interactive && !interactive.classList.contains('planning-set-legend')) }
  function startVisualDrag(event: ReactPointerEvent<HTMLElement>) { if (event.button !== 0 || expanded || !spatial || spatial.isGoalkeeper || visualSetDragBlocked(event.target)) return; event.stopPropagation(); const legend = event.target instanceof Element ? event.target.closest<HTMLElement>('.planning-set-legend') : null; const captureElement = legend ?? event.currentTarget; visualDragRef.current = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, moved: false, startedOnLegend: Boolean(legend), captureElement }; captureElement.setPointerCapture?.(event.pointerId) }
  function moveVisualDrag(event: ReactPointerEvent<HTMLElement>) { const drag = visualDragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; if (!drag.moved && Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 4) return; drag.moved = true; event.preventDefault(); if (drag.startedOnLegend) suppressLegendClickRef.current = true; setVisualPreview(snappedVisualGridCell(event.clientX, event.clientY)) }
  function finishVisualDrag(event: ReactPointerEvent<HTMLElement>) { const drag = visualDragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; try { drag.captureElement.releasePointerCapture?.(event.pointerId) } catch { /* no-op */ }; visualDragRef.current = null; const target = drag.moved ? (visualGridPreviewRef.current?.cell ?? snappedVisualGridCell(event.clientX, event.clientY)) : null; setVisualPreview(null); if (target) moveVisualGrid(target); if (drag.moved && drag.startedOnLegend) window.setTimeout(() => { suppressLegendClickRef.current = false }, 0); else suppressLegendClickRef.current = false }
  function cancelVisualDrag(event?: ReactPointerEvent<HTMLElement>) { const drag = visualDragRef.current; if (!drag || (event && drag.pointerId !== event.pointerId)) return; try { drag.captureElement.releasePointerCapture?.(drag.pointerId) } catch { /* no-op */ }; visualDragRef.current = null; suppressLegendClickRef.current = false; setVisualPreview(null) }
  useEffect(() => { const cancelOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelVisualDrag() }; window.addEventListener('keydown', cancelOnEscape); return () => window.removeEventListener('keydown', cancelOnEscape) }, [])
  const visualGridOverlay = visualGridPreview && spatial && !spatial.isGoalkeeper && articleRef.current?.parentElement ? createPortal(<div className="planning-visual-grid-overlay" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => { const cell = { row: Math.floor(index / 5) + 1, column: (index % 5) + 1 }; const activeCell = cell.row === visualGridPreview.cell.row && cell.column === visualGridPreview.cell.column; return <div key={`${cell.row}-${cell.column}`} className={`planning-visual-grid-cell ${activeCell ? 'is-target' : ''}`} style={{ '--planning-preview-x': `${PLANNING_VISUAL_GRID_COLUMNS[cell.column - 1]}%`, '--planning-preview-y': `${PLANNING_VISUAL_GRID_ROWS[cell.row - 1]}%` } as CSSProperties} /> })}<div className={`planning-visual-grid-ghost planning-line-${planningLine(linePosition)} ${visualGridPreview.occupantLabel ? 'is-swap' : ''}`} style={{ '--planning-preview-x': `${PLANNING_VISUAL_GRID_COLUMNS[visualGridPreview.cell.column - 1]}%`, '--planning-preview-y': `${PLANNING_VISUAL_GRID_ROWS[visualGridPreview.cell.row - 1]}%` } as CSSProperties}><strong>{displayLabel}</strong>{visualGridPreview.occupantLabel && <span>↔ {visualGridPreview.occupantLabel}</span>}</div></div>, articleRef.current.parentElement) : null
  const spatialStyle = { ...(spatial ? { '--planning-x': `${spatial.x}%`, '--planning-y': `${spatial.y}%`, '--planning-grid-row': String(spatial.gridRow), '--planning-grid-column': String(spatial.gridColumn), '--planning-row-count': String(Math.max(spatial.rowCount, 1)) } : {}), ...(expansionLayout ? { '--planning-expanded-left': `${expansionLayout.left}px`, '--planning-expanded-top': `${expansionLayout.top}px`, '--planning-expanded-width': `${expansionLayout.width}px`, '--planning-expanded-height': `${expansionLayout.height}px` } : {}) } as CSSProperties
  return <article ref={articleRef} data-spatial-key={spatial?.key ?? set.id} data-spatial-side={spatial?.side ?? 'center'} data-grid-row={spatial?.gridRow} data-grid-column={spatial?.gridColumn} data-set-label={displayLabel} data-grid-locked={spatial?.isGoalkeeper ? 'goalkeeper' : undefined} style={spatialStyle} className={`planning-set-row planning-line-${planningLine(linePosition)} ${grouped ? 'is-grouped' : ''} ${expanded ? 'is-expanded' : ''} ${focused ? 'is-focused' : ''} ${visualGridPreview !== null ? 'is-visual-position-dragging' : ''} ${preview !== undefined && activePlayer ? 'is-player-drop-target' : ''}`} onPointerDown={startVisualDrag} onPointerMove={moveVisualDrag} onPointerUp={finishVisualDrag} onPointerCancel={cancelVisualDrag} onLostPointerCapture={event => { if (visualDragRef.current?.pointerId === event.pointerId) cancelVisualDrag(event) }} onDragOver={event => { if (activePlayer) { event.preventDefault(); previewPlayer(null) } }} onDrop={event => { if (!activePlayer) return; event.preventDefault(); dropPlayer(preview ?? null) }}>
    {visualGridOverlay}
    <button type="button" className="planning-set-legend" onClick={() => { if (suppressLegendClickRef.current) { suppressLegendClickRef.current = false; return }; focus() }} title={spatial?.isGoalkeeper ? headerLabel : `${headerLabel} · arraste pela grade 5×5 sem alterar a tática`}><span className="planning-set-legend-position">{headerLabel.split('\n')[0]}</span><span className="planning-set-legend-roles">{headerLabel.split('\n')[1] ?? ''}</span></button>
    <button type="button" className="planning-set-add-player" title={`Adicionar jogador a ${displayLabel}`} aria-label={`Adicionar jogador a ${displayLabel}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); addPlayer() }}>+</button>
    <div className={`planning-pitch-depth-list ${isPlanningFamiliar(activeFamiliarity) ? 'is-compatible-drop' : isPlanningOutOfPosition(activeFamiliarity) ? 'is-training-drop' : ''}`} onDragOver={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; previewPlayer(insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id, preview)) }} onDrop={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); dropPlayer(preview ?? insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id, preview)) }}>
      {rowItems.map((option, index) => {
        if (!option) return <EmptyPlayerRow key={`empty-${index}`} showScores={showScores} />
        const player = option.player; const snapshot = latest(player); const rating = score(player); const beforeId = player.id; const playerFamiliarity = familiarity(player); const projectionPairs = rating.pair ? [rating.pair] : pairs; const projectionKey = snapshot ? functionProjectionKey(projectionPairs.flatMap(pair => [{ phase: 'IP', position: pair.ip.position, roleCode: pair.ip.roleCode }, { phase: 'OOP', position: pair.oop.position, roleCode: pair.oop.roleCode }])) : ''
        return <Fragment key={`${option.coverage ? 'coverage' : 'primary'}-${player.id}`}>{preview === beforeId && activePlayer?.id !== player.id && <PlayerDropPlaceholder />}<BoardPlayerRow player={player} snapshot={snapshot} score={rating.value} generalScore={showScores ? generalScore(player) : null} scoreDetails={showScores ? scoreDetails(player).filter(detail => detail.id !== rating.pair?.ip.playerId) : []} showScores={showScores} rank={rating.rank} rankPopulation={rating.rankPopulation} coverage={option.coverage} source={option.coverage ? primaryLabel(player.id) : null} familiarity={playerFamiliarity} fact={fact(player.id)} plannedClub={plannedClub(player.id)} plannedConflict={plannedConflict(player.id)} projectionKey={projectionKey} familiarityTooltip={snapshot ? planningFamiliarityTooltip(snapshot, pairs) : 'Sem observação no checkpoint atual.'} dragging={activePlayer?.id === player.id} drag={event => startPlayerDrag(player.id, event)} dragEnd={stopPlayerDrag} open={() => open(player.id)} context={event => context(event, player.id)} /></Fragment>
      })}
      {preview === null && activePlayer && <PlayerDropPlaceholder />}
    </div>
    {!expanded && hidden > 0 && <button className="planning-set-expand" onClick={event => { event.stopPropagation(); toggleExpansion() }}>+{hidden}</button>}
    {expanded && options.length > capacity && <button className="planning-set-collapse" onClick={event => { event.stopPropagation(); toggleExpansion() }}>−</button>}
  </article>
}

function PlanningPitchRowCells({ peek, identity, score, showScores, emptyScore = false }: { peek?: ReactNode; identity?: ReactNode; score?: ReactNode; showScores: boolean; emptyScore?: boolean }) {
  const { showPotential } = usePotential()
  return <>
    <span className="planning-pitch-row-peek">{peek}</span>
    <span className="planning-pitch-row-identity">{identity}</span>
    {showScores && <span className={`planning-pitch-row-score ${showPotential ? 'is-potential-mode' : ''}`}>
      {emptyScore ? <span className="planning-pitch-empty-score-content">
        <span className="planning-pitch-empty-score-box" />
        {showPotential && <><span className="planning-pitch-score-separator">›</span><span className="planning-pitch-empty-score-box is-potential" /></>}
      </span> : score}
    </span>}
  </>
}

function EmptyPlayerRow({ showScores }: { showScores: boolean }) {
  return <div className={`planning-pitch-depth-row is-empty ${!showScores ? 'is-score-hidden' : ''}`} aria-hidden="true">
    <PlanningPitchRowCells showScores={showScores} emptyScore />
  </div>
}

function PlayerDropPlaceholder() { return <div className="planning-pitch-player-drop-placeholder" aria-hidden="true"><span>destino</span></div> }

function BoardPlayerRow({ player, snapshot, score, generalScore, scoreDetails, showScores, rank, rankPopulation, coverage, source, familiarity, fact, plannedClub, plannedConflict, projectionKey, familiarityTooltip, dragging, drag, dragEnd, open, context }: { player: Player; snapshot: Snapshot | undefined; score: number | null; generalScore: number | null; scoreDetails: PlanningScoreDetail[]; showScores: boolean; rank: number | null; rankPopulation: number[]; coverage: boolean; source: string | null; familiarity: Familiarity; fact: PlanningMembershipFact; plannedClub: string | null; plannedConflict: string[]; projectionKey: string; familiarityTooltip: string; dragging: boolean; drag: (event: DragEvent<HTMLElement>) => void; dragEnd: () => void; open: () => void; context: (event: ReactMouseEvent) => void }) {
  const out = snapshot ? isPlanningOutOfPosition(familiarity) : false
  const title = [coverage ? `Cobertura · Principal: ${source ?? 'outro conjunto'}` : null, snapshot ? `Atual: ${fact.label} — ${fact.detail}` : 'Sem observação no checkpoint atual.', plannedConflict.length ? `Conflito: ${plannedConflict.join(', ')}` : plannedClub ? `Planejado: ${plannedClub}` : 'Sem destino planejado', out ? familiarityTooltip : null].filter(Boolean).join('\n\n')
  const scoreContent = showScores ? <PlanningScorePeek playerName={player.current_name} generalScore={generalScore} details={scoreDetails} className="planning-pitch-score-trigger">
    {snapshot ? <ScoreWithProjection playerId={player.id} currentScore={score} currentRank={rank} rankPopulation={rankPopulation} snapshot={snapshot} scoreType="function" scoreKey={projectionKey} variant="compact" opacityState={coverage ? 'coverage' : 'normal'} currentTitle={coverage ? 'Nota atual nesta função — cobertura' : 'Nota atual nesta função'} projectionTitle="Melhor RoleScore plausível nesta função em um cenário positivo de desenvolvimento." /> : <span className="planning-pitch-score-unavailable">—</span>}
  </PlanningScorePeek> : null
  return <article data-planning-player-id={player.id} className={`planning-pitch-depth-row ${coverage ? 'is-coverage' : ''} ${out ? 'is-out-of-position' : ''} ${!snapshot ? 'is-current-unknown' : ''} ${!showScores ? 'is-score-hidden' : ''} ${dragging ? 'is-player-dragging' : ''}`} title={title || undefined} draggable onDragStart={event => { event.stopPropagation(); drag(event) }} onDragEnd={dragEnd} onContextMenu={context}>
    <PlanningPitchRowCells
      showScores={showScores}
      peek={snapshot ? <PlayerPeek player={player} snapshot={snapshot} /> : null}
      identity={<button type="button" className="planning-pitch-player-name" onClick={event => { event.stopPropagation(); open() }}><span>{player.current_name}</span></button>}
      score={scoreContent}
    />
  </article>
}

function PlanningScorePeek({ playerName, generalScore, details, children, className = '' }: { playerName: string; generalScore: number | null; details: PlanningScoreDetail[]; children: ReactNode; className?: string }) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const show = (element: HTMLElement) => { const rect = element.getBoundingClientRect(); const width = 284; const height = Math.min(340, 90 + details.length * 34); const left = window.innerWidth - rect.right >= width + 12 ? rect.right + 8 : Math.max(8, rect.left - width - 8); setAnchor({ top: Math.max(8, Math.min(rect.top - 10, window.innerHeight - height - 8)), left }) }
  return <span className={className} tabIndex={0} aria-label={`Ver notas de ${playerName}`} onMouseEnter={event => show(event.currentTarget)} onMouseLeave={() => setAnchor(null)} onFocus={event => show(event.currentTarget)} onBlur={() => setAnchor(null)} onClick={event => event.stopPropagation()}>{children}{anchor && createPortal(<aside className="planning-score-tooltip" role="tooltip" style={{ top: anchor.top, left: anchor.left }}><header><div><h2>{playerName}</h2><p>Notas na tática atual</p></div></header><div className="planning-score-tooltip-list"><div className="is-general"><span>Nota geral</span><ScoreBadge value={generalScore} className="score-badge-compact" showTitle={false} /></div>{details.map(detail => <div key={detail.id}><span>{detail.label}</span><ScoreBadge value={detail.score} className="score-badge-compact" showTitle={false} /></div>)}</div></aside>, document.body)}</span>
}
function TransferGroupPanel({ group, playerIds, players, latest, fact, plannedClub, dragging, drop, startDrag, dragEnd, open, context, remove }: { group: Group; playerIds: string[]; players: Player[]; latest: (player: Player) => Snapshot | undefined; fact: (playerId: string) => PlanningMembershipFact; plannedClub: (playerId: string) => string | null; dragging: boolean; drop: () => void; startDrag: (id: string) => void; dragEnd: () => void; open: (id: string) => void; context: (event: ReactMouseEvent, playerId: string) => void; remove: (id: string) => void }) {
  const members = playerIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  return <section className={`transfer-group-panel planning-free-group ${dragging ? 'is-receiving' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop() }}><div className="transfer-group-summary"><span>Área livre de mercado</span><strong>{members.length} jogador{members.length === 1 ? '' : 'es'}</strong></div><div className="transfer-player-grid">{members.map(player => { const snapshot = latest(player); const current = fact(player.id); return <article className={`transfer-player-card ${!snapshot ? 'is-current-unknown' : ''}`} draggable onDragStart={() => startDrag(player.id)} onDragEnd={dragEnd} onContextMenu={event => context(event, player.id)} key={player.id}>{snapshot && <PlayerPeek player={player} snapshot={snapshot} />}<div className="transfer-player-info"><button className="player-name" onClick={() => open(player.id)}>{player.current_name}</button><span>{snapshot ? snapshot.positions.join(', ') || 'Sem posição' : 'Sem observação no checkpoint atual'}</span><small>{snapshot ? `${snapshot.age ?? '—'} anos · Atual: ${current.label} · Plano: ${plannedClub(player.id) ?? '—'}` : `Situação atual desconhecida · Plano: ${plannedClub(player.id) ?? group.name}`}</small></div><button className="transfer-remove" onClick={() => remove(player.id)}>×</button></article> })}</div></section>
}
function ManagerDropPlaceholder({ label }: { label: string }) { return <div className="manager-drop-placeholder" aria-hidden="true">{label}</div> }
function planningLine(position: string): PlanningPitchLine { const value = position.toUpperCase().replaceAll(' ', ''); if (value.startsWith('GK')) return 'gk'; if (value.startsWith('ST')) return 'st'; if (value.startsWith('AM')) return 'am'; if (value.startsWith('M')) return 'm'; if (value.startsWith('DM') || value.startsWith('WB')) return 'dm'; return 'd' }
