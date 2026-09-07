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
import { PositionSelector, canonicalPosition } from '../components/PositionSelector'
import { DataTable, type DataTableColumnLike, type DataTableContextMenuItem } from '../components/data-table/DataTable'
import { DATA_TABLE_PRESETS } from '../components/data-table/presets'
import { generalReferencePercentile, generalReferenceScoresByFamily, percentile, referencePairedRoleScore, type ReferenceDataset } from '../lib/reference'
import { canPlayPosition } from '../lib/positions'
import { isPlanningFamiliar, isPlanningOutOfPosition, planningFamiliarity, planningFamiliarityLabel, planningFamiliarityTooltip, type PlanningFamiliarity } from '../lib/planning-familiarity'
import { loadCurrentPlayers, loadReferenceDataset } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { PlayerPeek } from '../components/PlayerPeek'
import { loadModelConfig, patchModelConfig, retryModelConfigPatch, scheduleModelConfigPatch } from '../lib/model-config'
import { describeDbError } from '../lib/db-error'
import { resolvePlanningInsertionBefore } from '../lib/planning-layout'
import { functionProjectionKey } from '../lib/projection-player'
import { PITCH_NODES, positionGroup } from '../lib/tactics'
import { derivePlanningAssignmentIndex } from '../lib/planningDistribution'
import { planningSpatialLayout, type PlanningPitchLine, type PlanningSpatialPlacement } from '../lib/planning-spatial-layout'
import { resolvePlanningSetExpansion, type PlanningSetExpansion, type PlanningSetRect } from '../lib/planning-set-expansion'
import { loadPlanningMemberships } from '../lib/longitudinal-service'
import { classifyPlanningMembership, planningMembershipOrder, resolveCurrentSnapshotMembership, type PlanningMembershipFact, type PlanningMembershipFactKind } from '../lib/planning-membership'
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
type FactFilter = 'all' | PlanningMembershipFactKind
type PlanningUndo = Pick<Config, 'planning' | 'planning_by_club'>
type PlanningScoreDetail = { id: string; label: string; score: number | null }
type PlanningGridPlacement = PlanningSpatialPlacement & { gridRow: number; gridColumn: number; isGoalkeeper: boolean }
const DEFAULT_FIELD_SHARE = 60
const MIN_FIELD_SHARE = 44
const MAX_FIELD_SHARE = 76
const WORKSPACE_DIVIDER_WIDTH = 10

type PlanningRosterColumnId = 'name' | 'positions' | 'age' | 'club' | 'fact' | 'plan' | 'score'
type PlanningRosterColumn = DataTableColumnLike & { id: PlanningRosterColumnId }
type PlanningRosterRow = {
  player: Player
  snapshot: Snapshot | undefined
  score: number | null
  rank: number | null
  rankPopulation: number[]
  compatible: boolean
  pair: Pair | undefined
  fact: PlanningMembershipFact
  plannedClub: string | null
  plannedConflict: string[]
}

const transferGroups: Group[] = [{ id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }]
const EMPTY_ROLE_OVERRIDES: Record<string, Record<string, number>> = {}
const defaults = (): Planning => ({ groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'base', name: 'Base' }, ...transferGroups], slotAssignments: {}, setLayouts: {} })
const canPlay = canPlayPosition
const PLANNING_ROSTER_COLUMNS: PlanningRosterColumn[] = [
  { id: 'name', label: 'Jogador' },
  { id: 'score', label: 'Nota' },
  { id: 'positions', label: 'Posições' },
  { id: 'age', label: 'Idade' },
  { id: 'club', label: 'Clube atual' },
  { id: 'fact', label: 'Vínculo atual' },
  { id: 'plan', label: 'Plano' },
]
const PLANNING_ROSTER_WIDTHS: Record<PlanningRosterColumnId, number> = { name: 210, positions: 130, age: 76, club: 150, fact: 150, plan: 150, score: 196 }
const planningClubStorageKey = (saveId: string) => `fm-datatracker:planning-club:${saveId}`

// Planning-local warm caches. They are intentionally scoped to exact source object
// identities and exact save/club/function/matrix inputs so stale results cannot cross
// factual or scoring boundaries.
const planningMembershipCache = new Map<string, Map<string, WeakMap<Player[], Promise<PlayerMembershipWithClubs[]>>>>()
const planningGeneralReferenceCache = new Map<string, WeakMap<ReferenceDataset, ReturnType<typeof generalReferenceScoresByFamily>>>()
const planningRoleReferenceCache = new Map<string, WeakMap<ReferenceDataset, Map<string, number[]>>>()

function loadPlanningMembershipsWarm(saveId: string, clubId: string | null, currentPlayers: Player[]) {
  const clubKey = clubId ?? '__no_planning_club__'
  let byClub = planningMembershipCache.get(saveId)
  if (!byClub) {
    byClub = new Map()
    planningMembershipCache.set(saveId, byClub)
  }
  let byPlayers = byClub.get(clubKey)
  if (!byPlayers) {
    byPlayers = new WeakMap()
    byClub.set(clubKey, byPlayers)
  }
  const cache = byPlayers
  const cached = cache.get(currentPlayers)
  if (cached) return cached
  const snapshotIds = currentPlayers.map(player => player.player_snapshots[0]?.id).filter((id): id is string => Boolean(id))
  const request = loadPlanningMemberships(saveId, snapshotIds).catch(error => {
    cache.delete(currentPlayers)
    throw error
  })
  cache.set(currentPlayers, request)
  return request
}

function planningReferenceScopeKey(saveId: string, clubId: string | null) {
  return JSON.stringify(['planning-reference-v1', saveId, clubId ?? '__no_planning_club__'])
}

function planningGeneralReferenceRatings(scopeKey: string, reference: ReferenceDataset) {
  let cache = planningGeneralReferenceCache.get(scopeKey)
  if (!cache) {
    cache = new WeakMap()
    planningGeneralReferenceCache.set(scopeKey, cache)
  }
  const cached = cache.get(reference)
  if (cached !== undefined) return cached
  const ratings = generalReferenceScoresByFamily(reference.players, reference.attributes)
  cache.set(reference, ratings)
  return ratings
}

function planningWeightKey(weights: Record<string, number>) {
  return JSON.stringify(Object.entries(weights).sort(([left], [right]) => left.localeCompare(right)))
}

function planningRoleReferenceKey(pair: Pair, ipWeights: Record<string, number>, oopWeights: Record<string, number>) {
  return JSON.stringify([
    'planning-role-reference-v1',
    pair.ip.playerId,
    pair.ip.position,
    pair.ip.roleId ?? '',
    pair.ip.roleCode,
    pair.ip.roleName,
    planningWeightKey(ipWeights),
    pair.oop.position,
    pair.oop.roleId ?? '',
    pair.oop.roleCode,
    pair.oop.roleName,
    planningWeightKey(oopWeights),
  ])
}

function planningRoleReferenceRatings(scopeKey: string, reference: ReferenceDataset, pair: Pair, ipWeights: Record<string, number>, oopWeights: Record<string, number>) {
  let byReference = planningRoleReferenceCache.get(scopeKey)
  if (!byReference) {
    byReference = new WeakMap()
    planningRoleReferenceCache.set(scopeKey, byReference)
  }
  let cache = byReference.get(reference)
  if (!cache) {
    cache = new Map()
    byReference.set(reference, cache)
  }
  const key = planningRoleReferenceKey(pair, ipWeights, oopWeights)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const ratings = reference.players
    .filter(player => canPlay([player.p], pair.ip.position))
    .map(player => referencePairedRoleScore(player, reference.attributes, ipWeights, oopWeights))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)
  cache.set(key, ratings)
  return ratings
}

function normalizePlanning(raw: (Planning & { assignments?: Record<string, string> }) | undefined): Planning {
  const base: Planning = raw
    ? { ...defaults(), groups: raw.groups ?? defaults().groups, slotAssignments: raw.slotAssignments ?? {}, setLayouts: raw.setLayouts ?? {} }
    : defaults()
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
  const [search, setSearch] = useState('')
  const [positionFilters, setPositionFilters] = useState<string[] | null>(null)
  const [factFilter, setFactFilter] = useState<FactFilter>('all')
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
  const [fieldShare, setFieldShare] = useState(DEFAULT_FIELD_SHARE)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const pendingFieldShareRef = useRef(DEFAULT_FIELD_SHARE)
  const workspaceResizeRef = useRef<{ left: number; availableWidth: number; pointerId: number } | null>(null)
  const [rosterSort, setRosterSort] = useState<{ key: PlanningRosterColumnId; direction: 1 | -1 }>({ key: 'score', direction: -1 })
  const [rosterColumns, setRosterColumns] = useState<PlanningRosterColumn[]>(() => PLANNING_ROSTER_COLUMNS.map(column => ({ ...column })))
  const [rosterWidths, setRosterWidths] = useState<Record<PlanningRosterColumnId, number>>({ ...PLANNING_ROSTER_WIDTHS })
  const [rosterFrozenIndex, setRosterFrozenIndex] = useState(1)
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const loaded = useRef(false)

  const planningClubs = useMemo(() => activePlanningClubs(selected?.structure?.trackedClubs ?? []), [selected?.structure?.trackedClubs])
  const primaryClubId = useMemo(() => primaryPlanningClubId(selected?.structure?.trackedClubs ?? []), [selected?.structure?.trackedClubs])
  const selectedClub = planningClubs.find(item => item.club_id === selectedClubId) ?? null

  const saveStatus = (next: string, detail?: string) => { setStatus(next); setSaveDetail(detail ?? '') }

  useEffect(() => { void loadReferenceDataset().then(setReference) }, [])
  useEffect(() => {
    let active = true
    loaded.current = false
    setUndoPlanning(null)
    setMemberships([])
    setMembershipDiagnostic('')
    setFactFilter('all')
    setExpandedSets(new Set())
    setFocusedSetId(null)
    setPlayerDropPreview(null)
    setManagerSetDragging(null)
    setManagerSetPreview(undefined)
    setManagerGroupDragging(null)
    setManagerGroupPreview(undefined)
    if (!supabase || !selected) return () => { active = false }
    setLoading(true)
    saveStatus('Carregando…')
    void Promise.all([loadCurrentPlayers(selected.id), loadModelConfig(selected.id)]).then(async ([cached, modelConfig]) => {
      const currentPlayers = cached as unknown as Player[]
      const existing = modelConfig as Config
      const tracked = selected.structure?.trackedClubs ?? []
      const primaryId = primaryPlanningClubId(tracked)
      const remembered = typeof window === 'undefined' ? null : localStorage.getItem(planningClubStorageKey(selected.id))
      const nextClubId = resolvePlanningClubId(tracked, remembered)
      const membershipResult = await loadPlanningMembershipsWarm(selected.id, nextClubId, currentPlayers)
        .then(rows => ({ rows, diagnostic: '' }))
        .catch(error => ({ rows: [] as PlayerMembershipWithClubs[], diagnostic: describeDbError(error).full }))
      if (!active) return
      startTransition(() => {
        setPlayers(currentPlayers)
        setMemberships(membershipResult.rows)
        setMembershipDiagnostic(membershipResult.diagnostic)
        const promotedPlanning = promoteLegacyPrimaryPlanning(existing, primaryId)
        const planningByClub = Object.fromEntries(Object.entries(promotedPlanning).map(([clubId, raw]) => [clubId, normalizePlanning(raw as Planning)]))
        const selectedPlanning = nextClubId
          ? normalizePlanning(resolveClubPlanning({ ...existing, planning_by_club: planningByClub }, nextClubId, primaryId, defaults))
          : normalizePlanning(existing.planning)
        const selectedTacticByClub = promoteLegacyPrimaryTacticId(existing, primaryId)
        const tacticSelection = sanitizeClubTacticSelections(
          { ...existing, selected_tactic_id_by_club: selectedTacticByClub },
          (existing.tactics ?? []).map(item => item.id),
        )
        const legacyPlanning = primaryId && planningByClub[primaryId] ? planningByClub[primaryId] : normalizePlanning(existing.planning)
        setConfig({ ...existing, ...tacticSelection, planning: legacyPlanning, planning_by_club: planningByClub })
        setSelectedClubId(nextClubId)
        if (typeof window !== 'undefined') {
          if (nextClubId) localStorage.setItem(planningClubStorageKey(selected.id), nextClubId)
          else localStorage.removeItem(planningClubStorageKey(selected.id))
        }
        setSelectedGroup(selectedPlanning.groups[0]?.id ?? '')
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
    if (!active || !loaded.current || !selected || !supabase) return
    let current = true
    void loadModelConfig(selected.id).then(modelConfig => {
      if (!current || !loaded.current) return
      const latest = modelConfig as Config
      const tactics = latest.tactics ?? []
      const promoted = promoteLegacyPrimaryTacticId(latest, primaryClubId)
      const tacticSelection = sanitizeClubTacticSelections(
        { ...latest, selected_tactic_id_by_club: promoted },
        tactics.map(item => item.id),
      )
      setConfig(previous => ({
        ...previous,
        tactics,
        role_weight_overrides: latest.role_weight_overrides ?? previous.role_weight_overrides,
        ...tacticSelection,
      }))
      setExpandedSets(new Set())
      setFocusedSetId(null)
    }).catch(error => {
      if (current) console.error('Falha ao sincronizar a tática de referência do Planejamento.', describeDbError(error).full)
    })
    return () => { current = false }
  }, [active, selected?.id, primaryClubId])

  useEffect(() => {
    if (!loaded.current || !selected || !supabase) return
    const patch: Record<string, unknown> = {
      planning_by_club: config.planning_by_club ?? {},
      selected_tactic_id: config.selected_tactic_id ?? null,
      selected_tactic_id_by_club: config.selected_tactic_id_by_club ?? {},
    }
    if (config.planning !== undefined) patch.planning = config.planning
    scheduleModelConfigPatch(selected.id, '2.9.0', patch, saveStatus)
  }, [config.planning, config.planning_by_club, config.selected_tactic_id, config.selected_tactic_id_by_club, selected?.id])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

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
    for (const membership of memberships) {
      const values = rows.get(membership.player_id) ?? []
      values.push(membership)
      rows.set(membership.player_id, values)
    }
    return rows
  }, [memberships])
  const membershipFacts = useMemo(() => new Map(players.map(player => {
    const snapshot = latestByPlayer.get(player.id)
    const resolution = resolveCurrentSnapshotMembership(membershipsByPlayer.get(player.id) ?? [], snapshot?.id)
    return [player.id, classifyPlanningMembership(resolution, selectedClubId)]
  })), [players, latestByPlayer, membershipsByPlayer, selectedClubId])
  const membershipFact = (playerId: string) => membershipFacts.get(playerId) ?? classifyPlanningMembership(undefined, selectedClubId)
  const planningIndex = useMemo(() => derivePlanningClubIndex(config.planning_by_club ?? {}), [config.planning_by_club])
  const plannedClubName = (playerId: string) => {
    const clubId = planningIndex.clubByPlayer[playerId]
    return planningClubs.find(item => item.club_id === clubId)?.club.name ?? null
  }
  const plannedClubConflict = (playerId: string) => planningIndex.conflicts[playerId]?.map(clubId => planningClubs.find(item => item.club_id === clubId)?.club.name ?? clubId) ?? []

  const currentGroupIndex = Math.max(0, planning.groups.findIndex(group => group.id === selectedGroup))
  const currentGroup = planning.groups[currentGroupIndex]
  const isTransferGroup = Boolean(currentGroup && transferGroups.some(group => group.id === currentGroup.id))
  const currentSets = useMemo(() => tactic && currentGroup && !isTransferGroup ? layoutsFor(planning, tactic.id, currentGroup.id, slotDescriptors) : [], [planning, tactic, currentGroup, isTransferGroup, slotDescriptors])
  const focusedSet = currentSets.find(set => set.id === focusedSetId) ?? null
  const displaySetLabel = (set: PlanningSetLayout) => planningSetDisplayLabel(set, currentSets, slotDescriptors)
  const spatialPlacements = useMemo(() => {
    const items = currentSets.map(set => {
      const setPairs = set.slotIds.map(id => pairBySlot.get(id)).filter((pair): pair is Pair => Boolean(pair))
      const firstSlot = setPairs[0]
      const anchors = setPairs.map(pair => pitchNodeX.get(pair.ip.nodeId)).filter((value): value is number => Number.isFinite(value))
      const anchorX = anchors.length ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length : undefined
      return { key: set.id, line: planningLine(firstSlot?.ip.position ?? ''), label: firstSlot?.ip.position ?? 'M (C)', anchorX }
    })
    const tacticDerived = new Map(planningSpatialLayout(items).map(item => [item.key, item]))
    const placements = new Map<string, PlanningGridPlacement>()
    for (const set of currentSets) {
      const placement = tacticDerived.get(set.id)
      if (!placement) continue
      if (placement.line === 'gk') {
        placements.set(set.id, { ...placement, x: 50, y: PLANNING_VISUAL_GOALKEEPER_Y, gridRow: 6, gridColumn: 3, isGoalkeeper: true })
        continue
      }
      const cell = planningVisualGridCellForSet(set, placement.x, placement.line)
      placements.set(set.id, {
        ...placement,
        gridRow: cell.row,
        gridColumn: cell.column,
        x: PLANNING_VISUAL_GRID_COLUMNS[cell.column - 1],
        y: PLANNING_VISUAL_GRID_ROWS[cell.row - 1],
        isGoalkeeper: false,
      })
    }
    return placements
  }, [currentSets, pairBySlot, pitchNodeX])
  useEffect(() => {
    if (focusedSetId && !currentSets.some(set => set.id === focusedSetId)) setFocusedSetId(null)
  }, [focusedSetId, currentSets])

  function resolvedWeights(slot: Assignment, phase: 'IP' | 'OOP') {
    const id = slot.roleId ?? `${phase}-${positionGroup(slot.position)}-${slot.roleCode}`
    return resolveRoleWeights({ roleId: id, roleName: slot.roleName, overrideWeights: roleOverrides[id] ?? tactic?.roles?.find(role => role.id === id)?.weights })
  }

  function pairRoleScore(player: Player, pair: Pair) {
    const snapshot = latest(player)
    return snapshot ? pairedRoleScore(snapshot.player_attributes, resolvedWeights(pair.ip, 'IP'), resolvedWeights(pair.oop, 'OOP')) : null
  }

  function generalScore(player: Player) {
    const snapshot = latest(player)
    return snapshot ? generalScoreForSnapshot(snapshot)?.score ?? null : null
  }

  const referenceScopeKey = useMemo(() => planningReferenceScopeKey(selected?.id ?? '__no_save__', selectedClubId), [selected?.id, selectedClubId])
  const generalReferenceRatings = useMemo(() => reference ? planningGeneralReferenceRatings(referenceScopeKey, reference) : generalReferenceScoresByFamily([], []), [referenceScopeKey, reference])

  const referenceRatings = useMemo(() => new Map(pairs.map(pair => {
    const ipWeights = resolvedWeights(pair.ip, 'IP')
    const oopWeights = resolvedWeights(pair.oop, 'OOP')
    const ratings = reference ? planningRoleReferenceRatings(referenceScopeKey, reference, pair, ipWeights, oopWeights) : []
    return [pair.ip.playerId, ratings]
  })), [pairs, reference, referenceScopeKey, roleOverrides, tactic])

  const playerScores = useMemo(() => new Map(players.map(player => [player.id, new Map(pairs.map(pair => {
    const value = pairRoleScore(player, pair)
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
    const snapshot = latest(player)
    const fact = membershipFact(player.id)
    const contextual = contextualPairs.length > 0
    const pair = contextual ? contextualPairs.reduce<Pair | undefined>((best, current) => !best || (pairRating(player, current) ?? -1) > (pairRating(player, best) ?? -1) ? current : best, undefined) : undefined
    const score = contextual && pair ? pairRating(player, pair) : generalScore(player)
    const generalReference = !contextual && snapshot && score !== null ? generalReferencePercentile(score, snapshot, generalReferenceRatings) : null
    const rankPopulation = contextual && pair ? (referenceRatings.get(pair.ip.playerId) ?? []) : generalReference?.population ?? []
    const rank = contextual ? (score === null ? null : percentile(score, rankPopulation)) : generalReference?.percentile ?? null
    const compatible = contextual ? isPlanningFamiliar(planningFamiliarity(snapshot, contextualPairs)) : true
    const positionVisible = positionFilters === null ? true : positionFilters.length > 0 && positionFilters.some(position => canPlay(snapshot?.positions ?? [], position))
    return { player, score, rank, rankPopulation, compatible, positionVisible, pair, fact }
  }).filter(row => row.positionVisible && !assignmentIndex[row.player.id] && (factFilter === 'all' || row.fact.kind === factFilter) && row.player.current_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => planningMembershipOrder(a.fact.kind) - planningMembershipOrder(b.fact.kind) || Number(b.compatible) - Number(a.compatible) || (b.score ?? 0) - (a.score ?? 0) || a.player.current_name.localeCompare(b.player.current_name, 'pt-BR')), [players, search, contextualPairs, playerScores, assignmentIndex, latestByPlayer, generalReferenceRatings, referenceRatings, membershipFacts, factFilter])

  const factCounts = useMemo(() => {
    const counts: Record<PlanningMembershipFactKind, number> = { current: 0, loaned_in: 0, loaned_out: 0, other_club: 0, unknown: 0 }
    players.forEach(player => { counts[membershipFact(player.id).kind] += 1 })
    return counts
  }, [players, membershipFacts])

  const rosterRows = useMemo<PlanningRosterRow[]>(() => {
    const rows = roster.map(row => ({
      player: row.player,
      snapshot: latestByPlayer.get(row.player.id),
      score: row.score,
      rank: row.rank,
      rankPopulation: row.rankPopulation,
      compatible: row.compatible,
      pair: row.pair,
      fact: row.fact,
      plannedClub: plannedClubName(row.player.id),
      plannedConflict: plannedClubConflict(row.player.id),
    }))
    const direction = rosterSort.direction
    const compareText = (left: string, right: string) => left.localeCompare(right, 'pt-BR') * direction
    return rows.sort((left, right) => {
      if (rosterSort.key === 'name') return compareText(left.player.current_name, right.player.current_name)
      if (rosterSort.key === 'positions') return compareText(left.snapshot?.positions.join(', ') ?? '', right.snapshot?.positions.join(', ') ?? '')
      if (rosterSort.key === 'age') return (((left.snapshot?.age ?? -Infinity) - (right.snapshot?.age ?? -Infinity)) * direction) || left.player.current_name.localeCompare(right.player.current_name, 'pt-BR')
      if (rosterSort.key === 'club') return compareText(left.fact.membership?.currentClub?.name ?? '', right.fact.membership?.currentClub?.name ?? '') || left.player.current_name.localeCompare(right.player.current_name, 'pt-BR')
      if (rosterSort.key === 'fact') return (planningMembershipOrder(left.fact.kind) - planningMembershipOrder(right.fact.kind)) * direction || left.player.current_name.localeCompare(right.player.current_name, 'pt-BR')
      if (rosterSort.key === 'plan') return compareText(left.plannedConflict.join(', ') || left.plannedClub || '', right.plannedConflict.join(', ') || right.plannedClub || '') || left.player.current_name.localeCompare(right.player.current_name, 'pt-BR')
      return (((left.score ?? -Infinity) - (right.score ?? -Infinity)) * direction) || left.player.current_name.localeCompare(right.player.current_name, 'pt-BR')
    })
  }, [roster, latestByPlayer, rosterSort, planningIndex, planningClubs])

  const activePlayer = players.find(player => player.id === dragging?.id)
  const currentGroupPlayerIds = useMemo(() => new Set(Object.values(planning.slotAssignments[currentGroup?.id ?? ''] ?? {}).flat().filter(Boolean)), [planning.slotAssignments, currentGroup?.id])

  function update(fn: (planning: Planning) => Planning) {
    const previous = planning
    const next = fn(previous)
    if (next === previous) return
    setUndoPlanning({ planning: config.planning, planning_by_club: config.planning_by_club })
    setConfig(current => selectedClubId
      ? { ...current, ...patchClubPlanning(current, selectedClubId, primaryClubId, next) }
      : { ...current, planning: next })
  }
  function undo() {
    if (!undoPlanning) return
    const previous = undoPlanning
    setConfig(current => ({ ...current, planning: previous.planning, planning_by_club: previous.planning_by_club }))
    setUndoPlanning(null)
  }
  function changePlanningClub(clubId: string) {
    if (!selected || clubId === selectedClubId || !planningClubs.some(item => item.club_id === clubId)) return
    const nextPlanning = resolveClubPlanning(config, clubId, primaryClubId, defaults)
    setSelectedClubId(clubId)
    localStorage.setItem(planningClubStorageKey(selected.id), clubId)
    setSelectedGroup(nextPlanning.groups[0]?.id ?? '')
    setUndoPlanning(null)
    setExpandedSets(new Set())
    setFocusedSetId(null)
    setPositionFilters(null)
  }
  function selectClubTactic(id: string) {
    setExpandedSets(new Set())
    setFocusedSetId(null)
    if (!selectedClubId) {
      setConfig(current => ({ ...current, selected_tactic_id: id }))
      void persistPatch({ selected_tactic_id: id })
      return
    }
    setConfig(current => ({ ...current, ...patchClubTacticId(current, selectedClubId, primaryClubId, id) }))
  }
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
  function placePlayer(groupId: string, setId: string, playerId: string, beforePlayerId?: string | null) {
    if (!selectedClubId) {
      update(value => movePlayerToSet(value, groupId, setId, playerId, beforePlayerId) as Planning)
      return
    }
    const target = movePlayerToSet(planning, groupId, setId, playerId, beforePlayerId) as Planning
    setUndoPlanning({ planning: config.planning, planning_by_club: config.planning_by_club })
    setConfig(current => {
      const planningByClub = movePlayerAcrossClubPlans(current.planning_by_club ?? {}, selectedClubId, playerId, target)
      return {
        ...current,
        planning_by_club: planningByClub,
        ...(selectedClubId === primaryClubId ? { planning: planningByClub[selectedClubId] } : {}),
      }
    })
  }
  function stopPlayerDrag() { setDragging(null); setPlayerDropPreview(null) }
  function toggleSet(setId: string) { setExpandedSets(current => { const next = new Set(current); if (next.has(setId)) next.delete(setId); else next.add(setId); return next }) }

  function setScore(player: Player, set: PlanningSetLayout) {
    const candidates = setPairs(set).map(pair => ({ pair, value: pairRating(player, pair), rank: pairPercentile(player, pair), rankPopulation: referenceRatings.get(pair.ip.playerId) ?? [] }))
    return candidates.reduce<{ pair: Pair | null; value: number | null; rank: number | null; rankPopulation: number[] }>((best, current) => best.pair === null || (current.value ?? -1) > (best.value ?? -1) ? current : best, { pair: null, value: null, rank: null, rankPopulation: [] })
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

  function tacticScoreDetails(player: Player): PlanningScoreDetail[] {
    const snapshot = latest(player)
    if (!snapshot) return []
    return currentSets.flatMap(set => set.slotIds.flatMap(slotId => {
      const pair = pairBySlot.get(slotId)
      if (!pair || !canPlay(snapshot.positions, pair.ip.position)) return []
      return [{ id: slotId, label: planningSlotDisplayLabel(set, slotId, slotDescriptors), score: pairRating(player, pair) }]
    }))
  }

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
    const source = spatialPlacements.get(setId)
    if (!source || source.isGoalkeeper) return
    const currentCells = Object.fromEntries([...spatialPlacements]
      .filter(([, placement]) => !placement.isGoalkeeper)
      .map(([id, placement]) => [id, { row: placement.gridRow, column: placement.gridColumn }]))
    update(value => movePlanningSetVisualGrid(value, tactic.id, currentGroup.id, currentSets, setId, requested, currentCells) as Planning)
  }

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
      if (!result) await persistPatch({
        planning: config.planning ?? defaults(),
        planning_by_club: config.planning_by_club ?? {},
        selected_tactic_id: config.selected_tactic_id ?? null,
        selected_tactic_id_by_club: config.selected_tactic_id_by_club ?? {},
      })
    } catch { /* status is already updated by the shared persistence layer */ }
  }

  function openPlayerMenu(event: ReactMouseEvent, playerId: string) {
    event.preventDefault()
    event.stopPropagation()
    const width = 230
    const height = 132
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      playerId,
    })
  }

  function moveMenuPlayer(groupId: 'loan' | 'sale') {
    if (!menu) return
    placePlayer(groupId, 'market', menu.playerId)
    setSelectedGroup(groupId)
    setFocusedSetId(null)
    setMenu(null)
  }

  function applyFieldShare(next: number, commit = true) {
    const share = Math.max(MIN_FIELD_SHARE, Math.min(MAX_FIELD_SHARE, next))
    pendingFieldShareRef.current = share
    const layout = workspaceRef.current
    layout?.style.setProperty('--planning-field-fr', `${share}fr`)
    layout?.style.setProperty('--planning-table-fr', `${100 - share}fr`)
    if (commit) setFieldShare(share)
  }

  function resetFieldShare() { applyFieldShare(DEFAULT_FIELD_SHARE) }

  function resizeShareAt(clientX: number, left: number, availableWidth: number) {
    return ((clientX - left - (WORKSPACE_DIVIDER_WIDTH / 2)) / availableWidth) * 100
  }

  function startWorkspaceResize(event: ReactPointerEvent<HTMLDivElement>) {
    const layout = workspaceRef.current
    if (!layout) return
    event.preventDefault()
    setExpandedSets(new Set())
    const rect = layout.getBoundingClientRect()
    const availableWidth = Math.max(1, rect.width - WORKSPACE_DIVIDER_WIDTH)
    workspaceResizeRef.current = { left: rect.left, availableWidth, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    applyFieldShare(resizeShareAt(event.clientX, rect.left, availableWidth), false)
  }

  function moveWorkspaceResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = workspaceResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    applyFieldShare(resizeShareAt(event.clientX, resize.left, resize.availableWidth), false)
  }

  function finishWorkspaceResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = workspaceResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    workspaceResizeRef.current = null
    setFieldShare(pendingFieldShareRef.current)
    window.dispatchEvent(new Event('resize'))
  }

  function changeRosterSort(key: string) {
    const nextKey = key as PlanningRosterColumnId
    setRosterSort(current => current.key === nextKey ? { key: nextKey, direction: current.direction === 1 ? -1 : 1 } : { key: nextKey, direction: nextKey === 'score' ? -1 : 1 })
  }

  function moveRosterColumn(fromIndex: number, toIndex: number) {
    setRosterColumns(current => {
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  function removeRosterColumn(index: number) {
    if (rosterColumns[index]?.id === 'name') return
    setRosterColumns(current => current.filter((_, columnIndex) => columnIndex !== index))
    setRosterFrozenIndex(current => current < 0 ? -1 : Math.max(0, Math.min(current - (index <= current ? 1 : 0), rosterColumns.length - 2)))
  }

  function addRosterColumn(column: PlanningRosterColumn, insertAfter: number) {
    setRosterColumns(current => current.some(item => item.id === column.id)
      ? current
      : [...current.slice(0, insertAfter + 1), { ...column }, ...current.slice(insertAfter + 1)])
  }

  function resetRosterTable() {
    setRosterColumns(PLANNING_ROSTER_COLUMNS.map(column => ({ ...column })))
    setRosterWidths({ ...PLANNING_ROSTER_WIDTHS })
    setRosterFrozenIndex(1)
  }

  function rosterHeaderContextItems(column: PlanningRosterColumn, index: number): DataTableContextMenuItem[] {
    const missing = PLANNING_ROSTER_COLUMNS.filter(candidate => !rosterColumns.some(current => current.id === candidate.id))
    return [
      { id: 'freeze', label: 'Congelar até esta coluna', onSelect: () => setRosterFrozenIndex(index) },
      { id: 'unfreeze', label: 'Remover congelamento', disabled: rosterFrozenIndex < 0, onSelect: () => setRosterFrozenIndex(-1) },
      { id: 'remove', label: 'Remover coluna', disabled: column.id === 'name', onSelect: () => removeRosterColumn(index) },
      ...missing.map((candidate, missingIndex): DataTableContextMenuItem => ({
        id: `add-${candidate.id}`,
        label: `Adicionar ${candidate.label}`,
        separatorBefore: missingIndex === 0,
        onSelect: () => addRosterColumn(candidate, index),
      })),
      { id: 'reset', label: 'Restaurar tabela padrão', separatorBefore: true, onSelect: resetRosterTable },
    ]
  }

  function renderRosterCell(row: PlanningRosterRow, column: PlanningRosterColumn): ReactNode {
    if (column.id === 'name') {
      const dragTitle = row.snapshot ? `Atual: ${row.fact.label} — ${row.fact.detail}` : 'Sem observação no checkpoint atual.'
      return <div
        className={`planning-roster-player-drag roster-player-card ${!row.compatible ? 'incompatible' : ''}`}
        draggable
        title={dragTitle}
        onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.player.id); setDragging({ type: 'player', id: row.player.id }) }}
        onDragEnd={stopPlayerDrag}
        onContextMenu={event => openPlayerMenu(event, row.player.id)}
      >
        {row.snapshot && <PlayerPeek player={row.player} snapshot={row.snapshot} />}
        <button type="button" className="player-name planning-roster-player-name" onClick={event => { event.stopPropagation(); navigate(`/players/${row.player.id}`) }}>{row.player.current_name}</button>
      </div>
    }
    if (column.id === 'positions') return <span className="planning-roster-positions">{row.snapshot?.positions.join(', ') || '—'}</span>
    if (column.id === 'age') return <span className="planning-roster-age">{row.snapshot?.age ?? '—'}</span>
    if (column.id === 'club') return <span className="planning-roster-club" title={row.fact.membership?.currentClub?.name ?? undefined}>{row.fact.membership?.currentClub?.name ?? '—'}</span>
    if (column.id === 'fact') return <span className={`membership-badge is-${row.fact.kind}`} title={row.fact.detail}>{row.fact.label}</span>
    if (column.id === 'plan') {
      if (row.plannedConflict.length) return <span className="planning-roster-plan is-conflict" title={`Planejado simultaneamente em ${row.plannedConflict.join(', ')}`}>Conflito · {row.plannedConflict.join(', ')}</span>
      return <span className="planning-roster-plan">{row.plannedClub ?? 'A definir'}</span>
    }
    const projectionKey = row.pair ? functionProjectionKey([{ phase: 'IP', position: row.pair.ip.position, roleCode: row.pair.ip.roleCode }, { phase: 'OOP', position: row.pair.oop.position, roleCode: row.pair.oop.roleCode }]) : undefined
    return <span className="planning-roster-score">{row.snapshot ? <ScoreWithProjection playerId={row.player.id} currentScore={row.score} currentRank={row.rank} rankPopulation={row.rankPopulation} snapshot={row.snapshot} scoreType={contextualPairs.length > 0 ? 'function' : 'general'} scoreKey={projectionKey} variant="compact" currentTitle={contextualPairs.length > 0 ? 'Nota atual nesta função' : 'Nota atual'} /> : <span title="Sem observação no checkpoint atual">—</span>}</span>
  }

  return <div className="screen-page planning-page planning-flex-page">
    <div className="title-row planning-title-row"><div><h1>Planejamento{selectedClub && planningClubs.length > 1 ? ` · ${selectedClub.club.name}` : ''}</h1>{(loading || isPending) && <span className="background-loading" role="status">Carregando em segundo plano…</span>}</div><SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠') ? () => void retrySave() : undefined} /></div>

    <section className="planning-matrix-toolbar planning-aligned-toolbar planning-flex-toolbar">
      {planningClubs.length > 1 && <CustomSelect className="tactic-custom-select" ariaLabel="Clube do planejamento" value={selectedClubId ?? ''} options={planningClubs.map(item => ({ value: item.club_id, label: item.tracking_role === 'primary' ? `${item.club.name} · Principal` : item.club.name }))} placeholder="Clube" onChange={changePlanningClub} />}
      <CustomSelect className="tactic-custom-select" ariaLabel="Tática selecionada" value={tactic?.id ?? ''} options={tactics.map(item => ({ value: item.id, label: item.name }))} placeholder={tactics.length ? 'Tática' : 'Nenhuma tática criada'} disabled={!tactics.length || isTransferGroup} disabledReason={isTransferGroup ? 'Táticas não se aplicam a grupos de mercado' : !tactics.length ? 'Nenhuma tática criada' : undefined} onChange={selectClubTactic} />
      <div className="squad-pagination planning-group-selector"><button onClick={() => changeGroup(-1)} disabled={planning.groups.length < 2}>‹</button><strong>{currentGroup?.name ?? 'Nenhum elenco'}</strong><span>{planning.groups.length ? `${currentGroupIndex + 1} de ${planning.groups.length}` : '0 de 0'}</span><button onClick={() => changeGroup(1)} disabled={planning.groups.length < 2}>›</button></div>
      <label className={`coverage-toggle ${isTransferGroup || !tactic ? 'is-disabled' : ''}`} title={isTransferGroup ? 'Coberturas não se aplicam a grupos de mercado' : !tactic ? 'Crie uma tática para visualizar coberturas' : undefined}><input type="checkbox" checked={showCoverages} disabled={isTransferGroup || !tactic} onChange={event => setShowCoverages(event.target.checked)} /><span>Mostrar coberturas</span></label>
      <label className={`coverage-toggle planning-score-toggle ${isTransferGroup || !tactic ? 'is-disabled' : ''}`} title={isTransferGroup ? 'Notas do campo não se aplicam a grupos de mercado' : !tactic ? 'Crie uma tática para visualizar notas' : undefined}><input type="checkbox" checked={showScores} disabled={isTransferGroup || !tactic} onChange={event => setShowScores(event.target.checked)} /><span>Mostrar notas</span></label>
      <div className="planning-flex-actions">
        <button className="ghost undo-planning-button dt-control" onClick={undo} disabled={!undoPlanning} title="Desfazer última alteração" aria-label="Desfazer última alteração">↶</button>
        <button className="ghost manage-sets-button dt-control" disabled={isTransferGroup || !tactic} onClick={() => setManageSetsOpen(true)}>Organizar posições</button>
        <button className="ghost manage-squads-button dt-control" onClick={() => setManageSquadsOpen(true)}>Gerenciar elencos</button>
        <button className="planning-clear-current dt-control" type="button" disabled={!currentGroupPlayerIds.size} onClick={clearCurrentGroup} title={`Limpar ${currentGroup?.name ?? 'elenco'}`} aria-label={`Limpar ${currentGroup?.name ?? 'elenco'}`}>🗑</button>
      </div>
    </section>

    <section ref={workspaceRef} className="planning-depth-layout planning-flex-layout" style={{ '--planning-field-fr': `${fieldShare}fr`, '--planning-table-fr': `${100 - fieldShare}fr` } as CSSProperties}>
      <div className={`planning-flex-board ${expandedSets.size ? 'has-expanded' : ''} ${isTransferGroup ? 'is-transfer' : ''}`}>
        {isTransferGroup && currentGroup ? <TransferGroupPanel group={currentGroup} playerIds={planning.slotAssignments[currentGroup.id]?.market ?? []} players={players} latest={latest} fact={membershipFact} plannedClub={plannedClubName} dragging={Boolean(activePlayer)} drop={() => { if (activePlayer) placePlayer(currentGroup.id, 'market', activePlayer.id); stopPlayerDrag() }} startDrag={id => setDragging({ type: 'player', id })} dragEnd={stopPlayerDrag} open={id => navigate(`/players/${id}`)} context={openPlayerMenu} remove={removePlayer} />
          : tactic && currentGroup ? <div className={`planning-set-list is-spatial-ready ${expandedSets.size ? 'has-expanded' : ''}`}>
            {currentSets.map(set => <PlanningSetRow
              key={set.id}
              set={set}
              spatial={spatialPlacements.get(set.id)}
              displayLabel={displaySetLabel(set)}
              pairs={setPairs(set)}
              assignedIds={planning.slotAssignments[currentGroup.id]?.[set.id] ?? []}
              players={players}
              latest={latest}
              expanded={expandedSets.has(set.id)}
              focused={focusedSetId === set.id}
              coverages={showCoverages ? coveragePlayers(set) : []}
              showCoverages={showCoverages}
              showScores={showScores}
              generalScore={generalScore}
              scoreDetails={tacticScoreDetails}
              primaryLabel={primaryLabel}
              activePlayer={activePlayer}
              playerDropPreview={playerDropPreview}
              score={player => setScore(player, set)}
              familiarity={player => setFamiliarity(player, set)}
              fact={membershipFact}
              plannedClub={plannedClubName}
              plannedConflict={plannedClubConflict}
              toggle={() => toggleSet(set.id)}
              focus={() => setFocusedSetId(current => current === set.id ? null : set.id)}
              startPlayerDrag={(id, event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDragging({ type: 'player', id }); setPlayerDropPreview(null) }}
              stopPlayerDrag={stopPlayerDrag}
              previewPlayer={beforePlayerId => setPlayerDropPreview({ setId: set.id, beforePlayerId })}
              dropPlayer={beforePlayerId => { if (activePlayer) placePlayer(currentGroup.id, set.id, activePlayer.id, beforePlayerId); stopPlayerDrag() }}
              open={id => navigate(`/players/${id}`)}
              context={openPlayerMenu}
              moveVisualGrid={cell => moveSetVisualPosition(set.id, cell)}
            />)}
          </div> : <div className="empty planning-no-tactic"><h2>Nenhuma tática disponível</h2><p>Crie uma tática para organizar o elenco por posição e função.</p><button onClick={() => navigate('/tactics')}>Criar primeira tática</button></div>}
      </div>

      <div
        className="planning-workspace-divider"
        role="separator"
        aria-label="Ajustar largura do campo e da tabela"
        aria-orientation="vertical"
        aria-valuemin={MIN_FIELD_SHARE}
        aria-valuemax={MAX_FIELD_SHARE}
        aria-valuenow={Math.round(fieldShare)}
        tabIndex={0}
        onPointerDown={startWorkspaceResize}
        onPointerMove={moveWorkspaceResize}
        onPointerUp={finishWorkspaceResize}
        onPointerCancel={finishWorkspaceResize}
        onDoubleClick={resetFieldShare}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); applyFieldShare(fieldShare - 2) }
          else if (event.key === 'ArrowRight') { event.preventDefault(); applyFieldShare(fieldShare + 2) }
          else if (event.key === 'Home') { event.preventDefault(); resetFieldShare() }
        }}
        title="Arraste para redimensionar · clique duas vezes para restaurar 60/40"
      ><span aria-hidden="true" /></div>

      <article className="planning-column roster-column">
        <header>
          <h2>{focusedSet ? `Elenco · ${displaySetLabel(focusedSet)}` : 'Elenco'}</h2>
          <span>{rosterRows.length}</span>
        </header>
        <div className="roster-filters"><input placeholder="Buscar" value={search} onChange={event => setSearch(event.target.value)} /><PositionSelector selected={positionFilters} availablePositions={availableFilterPositions} onChange={positions => { setPositionFilters(positions); if (positions?.length) setFocusedSetId(null) }} /></div>
        <div className="planning-fact-filters" aria-label="Filtrar por vínculo factual">
          <button className={factFilter === 'all' ? 'active' : ''} onClick={() => setFactFilter('all')}>Todos <b>{players.length}</b></button>
          <button className={factFilter === 'current' ? 'active' : ''} onClick={() => setFactFilter('current')}>No clube <b>{factCounts.current}</b></button>
          <button className={factFilter === 'loaned_in' ? 'active' : ''} onClick={() => setFactFilter('loaned_in')}>Recebidos <b>{factCounts.loaned_in}</b></button>
          <button className={factFilter === 'loaned_out' ? 'active' : ''} onClick={() => setFactFilter('loaned_out')}>Emprestados <b>{factCounts.loaned_out}</b></button>
          <button className={factFilter === 'other_club' ? 'active' : ''} onClick={() => setFactFilter('other_club')}>Outro clube <b>{factCounts.other_club}</b></button>
          <button className={factFilter === 'unknown' ? 'active' : ''} onClick={() => setFactFilter('unknown')}>Incerto <b>{factCounts.unknown}</b></button>
        </div>
        {membershipDiagnostic && <div className="planning-membership-warning" title={membershipDiagnostic}>Contexto factual indisponível; o planejamento manual continua seguro.</div>}
        {contextualPairs.length > 0 && <div className="roster-context-note">Prioridade: nota específica da função</div>}
        <DataTable<PlanningRosterRow, PlanningRosterColumn>
          rows={rosterRows}
          columns={rosterColumns}
          rowKey={row => row.player.id}
          renderCell={renderRosterCell}
          getColumnWidth={column => rosterWidths[column.id]}
          getColumnMinWidth={column => column.id === 'name' ? 170 : column.id === 'score' ? 196 : column.id === 'age' ? 68 : 110}
          getColumnMaxWidth={() => 420}
          onColumnWidthChange={(column, width) => setRosterWidths(current => ({ ...current, [column.id]: width }))}
          onColumnMove={moveRosterColumn}
          frozenIndex={rosterFrozenIndex}
          fillContainer
          sort={rosterSort}
          onSort={changeRosterSort}
          onRowContextMenu={(event, row) => openPlayerMenu(event, row.player.id)}
          getHeaderContextMenuItems={rosterHeaderContextItems}
          capabilities={DATA_TABLE_PRESETS.tactics}
          className="planning-roster-table"
          loading={!players.length && (loading || isPending)}
          loadingMessage="Carregando elenco…"
          emptyMessage="Nenhum jogador disponível corresponde a este recorte."
          getCellClassName={(_row, column) => column.id === 'score' ? 'planning-roster-score-cell' : column.id === 'name' ? 'planning-roster-name-cell' : column.id === 'age' ? 'planning-roster-age-cell' : undefined}
          getRowClassName={row => !row.compatible ? 'planning-roster-row-incompatible' : undefined}
        />
      </article>
    </section>

    {manageSquadsOpen && <div className="settings-overlay" onClick={() => setManageSquadsOpen(false)}><section className="squad-manager planning-squad-manager" onClick={event => event.stopPropagation()}><header><h2>Gerenciar elencos</h2><button className="close" onClick={() => setManageSquadsOpen(false)}>×</button></header><div className="squad-manager-list">{planning.groups.map((group, index) => { const fixed = transferGroups.some(item => item.id === group.id); const previewBefore = managerGroupPreview === group.id && managerGroupDragging !== group.id; return <Fragment key={group.id}>{previewBefore && <ManagerDropPlaceholder label="Mover elenco para cá" />}<div className={`planning-squad-manager-row ${fixed ? 'fixed-planning-group' : ''} ${managerGroupDragging === group.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerGroupPreview(event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null) }} onDrop={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderGroup(managerGroupDragging, event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null); setManagerGroupDragging(null); setManagerGroupPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.id); setManagerGroupDragging(group.id); setManagerGroupPreview(group.id) }} onDragEnd={() => { setManagerGroupDragging(null); setManagerGroupPreview(undefined) }} title={`Arrastar ${group.name}`} aria-label={`Reordenar ${group.name}`}>⠿</button><input value={group.name} readOnly={fixed} onChange={event => renameGroup(group.id, event.target.value)} />{fixed ? <span className="market-group-label">GRUPO MERCADO</span> : <button className="manager-trash" onClick={() => removeGroup(group.id)} title={`Excluir ${group.name}`} aria-label={`Excluir ${group.name}`}>🗑</button>}</div></Fragment> })}{managerGroupDragging && managerGroupPreview === null && <ManagerDropPlaceholder label="Mover elenco para o final" />}</div><footer className="planning-squad-manager-footer"><div className="planning-add-squad"><input placeholder="Novo elenco" value={newGroup} onChange={event => setNewGroup(event.target.value)} onKeyDown={event => event.key === 'Enter' && addGroup()} /><button onClick={addGroup}>+ Adicionar</button></div><button className="danger-button clear-all-squads" disabled={!Object.keys(assignmentIndex).length} onClick={clearPlanning}>Limpar todos os elencos</button></footer></section></div>}

    {manageSetsOpen && tactic && currentGroup && !isTransferGroup && <div className="settings-overlay" onClick={() => setManageSetsOpen(false)}><section className="squad-manager planning-set-manager" onClick={event => event.stopPropagation()}><header><div><h2>Organizar posições</h2><p>Organização visual de {currentGroup.name}; arraste os conjuntos livremente pela grade 5×5. A tática não é alterada.</p></div><button className="close" onClick={() => setManageSetsOpen(false)}>×</button></header><div className="planning-set-manager-list">{currentSets.map((set, index) => { const effectiveLabel = displaySetLabel(set); const previewBefore = managerSetPreview === set.id && managerSetDragging !== set.id; const nextSet = currentSets[index + 1]; const canGroupNext = Boolean(nextSet && canGroupAdjacentPlanningSets(set, nextSet, slotDescriptors)); return <Fragment key={set.id}>{previewBefore && <ManagerDropPlaceholder label="Mover posição para cá" />}<div className={`planning-squad-manager-row ${set.slotIds.length > 1 ? 'is-grouped-manager-row' : ''} ${managerSetDragging === set.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerSetPreview(event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null) }} onDrop={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderSet(managerSetDragging, event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null); setManagerSetDragging(null); setManagerSetPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', set.id); setManagerSetDragging(set.id); setManagerSetPreview(set.id) }} onDragEnd={() => { setManagerSetDragging(null); setManagerSetPreview(undefined) }} title={`Arrastar ${effectiveLabel}`} aria-label={`Reordenar ${effectiveLabel}`}>⠿</button>{set.slotIds.length > 1 ? <><button className="split-set-button" onClick={() => splitSet(set.id)} title="Desagrupar" aria-label={`Desagrupar ${effectiveLabel}`}>−</button><div className="grouped-set-fields"><label>Nome geral<input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /></label>{set.slotIds.map((slotId, slotIndex) => <label key={slotId}>Posição {slotIndex + 1}<input value={planningSlotDisplayLabel(set, slotId, slotDescriptors)} onChange={event => renameSetSlot(set.id, slotId, event.target.value)} /></label>)}</div></> : <><span className="set-manager-order">{index + 1}</span><input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /><small>1 posição</small></>}</div>{canGroupNext && <button className="adjacent-group-button" type="button" title={`Agrupar ${effectiveLabel} e ${displaySetLabel(nextSet)}`} onClick={() => groupSet(set.id, nextSet.id)}>+</button>}</Fragment> })}{managerSetDragging && managerSetPreview === null && <ManagerDropPlaceholder label="Mover posição para o final" />}</div><footer className="planning-set-manager-footer"><div><button className="ghost" onClick={restoreSetVisualPositions}>Restaurar posições do campo</button><button className="ghost" onClick={restoreSets}>Restaurar ordem e grupos da tática</button></div><button onClick={() => setManageSetsOpen(false)}>Concluir</button></footer></section></div>}

    {menu && <div className="planning-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}>
      <button role="menuitem" onClick={() => moveMenuPlayer('loan')}>Adicionar a Empréstimo</button>
      <button role="menuitem" onClick={() => moveMenuPlayer('sale')}>Adicionar a Venda</button>
      <button role="menuitem" className="is-danger" onClick={() => { removePlayer(menu.playerId); setMenu(null) }}>Remover do planejamento</button>
    </div>}
  </div>
}

function useCompactCapacity(capacity = 3) {
  // Every Planning set, including the goalkeeper in the reserved sixth row,
  // exposes the same three compact depth rows before +N expansion.
  const ref = useRef<HTMLDivElement | null>(null)
  return { ref, capacity }
}

function insertionBeforePlayer(container: HTMLElement, clientX: number, clientY: number, draggingId: string | undefined, currentBeforeId: string | null | undefined) {
  const cards = [...container.querySelectorAll<HTMLElement>('[data-planning-player-id]')]
    .filter(card => card.dataset.planningPlayerId !== draggingId && card.offsetParent !== null)
    .map(card => {
      const rect = card.getBoundingClientRect()
      return { id: card.dataset.planningPlayerId ?? '', left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })
    .filter(card => Boolean(card.id))
  return resolvePlanningInsertionBefore(cards, clientX, clientY, currentBeforeId)
}

function PlanningSetRow({ set, spatial, displayLabel, pairs, assignedIds, players, latest, expanded, focused, coverages, showCoverages, showScores, generalScore, scoreDetails, primaryLabel, activePlayer, playerDropPreview, score, familiarity, fact, plannedClub, plannedConflict, toggle, focus, startPlayerDrag, stopPlayerDrag, previewPlayer, dropPlayer, open, context, moveVisualGrid }: {
  set: PlanningSetLayout
  spatial: PlanningGridPlacement | undefined
  displayLabel: string
  pairs: Pair[]
  assignedIds: string[]
  players: Player[]
  latest: (player: Player) => Snapshot | undefined
  expanded: boolean
  focused: boolean
  coverages: Player[]
  showCoverages: boolean
  showScores: boolean
  generalScore: (player: Player) => number | null
  scoreDetails: (player: Player) => PlanningScoreDetail[]
  primaryLabel: (playerId: string) => string
  activePlayer?: Player
  playerDropPreview: PlayerDropPreview | null
  score: (player: Player) => { pair: Pair | null; value: number | null; rank: number | null; rankPopulation: number[] }
  familiarity: (player: Player) => Familiarity
  fact: (playerId: string) => PlanningMembershipFact
  plannedClub: (playerId: string) => string | null
  plannedConflict: (playerId: string) => string[]
  toggle: () => void
  focus: () => void
  startPlayerDrag: (id: string, event: DragEvent<HTMLElement>) => void
  stopPlayerDrag: () => void
  previewPlayer: (beforePlayerId: string | null) => void
  dropPlayer: (beforePlayerId?: string | null) => void
  open: (id: string) => void
  context: (event: ReactMouseEvent, playerId: string) => void
  moveVisualGrid: (cell: PlanningVisualGridCell) => void
}) {
  const members = assignedIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  const coverageOptions = showCoverages ? coverages.filter(player => !members.some(member => member.id === player.id)) : []
  const options = [...members.map(player => ({ player, coverage: false as const })), ...coverageOptions.map(player => ({ player, coverage: true as const }))]
  const grouped = set.slotIds.length > 1
  const { ref: cardsRef, capacity } = useCompactCapacity(3)
  const articleRef = useRef<HTMLElement | null>(null)
  const compactRectRef = useRef<PlanningSetRect | null>(null)
  const [expansionLayout, setExpansionLayout] = useState<PlanningSetExpansion | null>(null)
  const [visualGridPreview, setVisualGridPreview] = useState<{ cell: PlanningVisualGridCell; occupantLabel: string | null } | null>(null)
  const visualGridPreviewRef = useRef<{ cell: PlanningVisualGridCell; occupantLabel: string | null } | null>(null)
  const visualDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; moved: boolean; startedOnLegend: boolean; captureElement: HTMLElement } | null>(null)
  const suppressLegendClickRef = useRef(false)
  const visible = expanded ? options : options.slice(0, capacity)
  const hidden = Math.max(0, options.length - visible.length)
  const linePosition = pairs[0]?.ip.position ?? ''
  const roleSummary = [...new Set(pairs.flatMap(pair => [`IP ${pair.ip.position.replaceAll(' ', '')} · ${pair.ip.roleCode}`, `OOP ${pair.oop.position.replaceAll(' ', '')} · ${pair.oop.roleCode}`]))].join(' / ')
  const activeFamiliarity = activePlayer ? familiarity(activePlayer) : 'unknown'
  const preview = playerDropPreview?.setId === set.id ? playerDropPreview.beforePlayerId : undefined

  function rectRelativeTo(rect: DOMRect, parentRect: DOMRect): PlanningSetRect {
    return { left: rect.left - parentRect.left, top: rect.top - parentRect.top, width: rect.width, height: rect.height }
  }

  function measuredExpansion(compactOverride?: PlanningSetRect | null) {
    const article = articleRef.current
    const pitch = article?.parentElement
    if (!article || !pitch) return null
    const pitchRect = pitch.getBoundingClientRect()
    const compact = compactOverride ?? rectRelativeTo(article.getBoundingClientRect(), pitchRect)
    const computed = getComputedStyle(article)
    const numberVar = (name: string, fallback: number) => {
      const parsed = Number.parseFloat(computed.getPropertyValue(name))
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    }
    const obstacles = [...pitch.querySelectorAll<HTMLElement>('.planning-set-row')]
      .filter(item => item !== article)
      .map(item => rectRelativeTo(item.getBoundingClientRect(), pitchRect))
    return resolvePlanningSetExpansion({
      pitchWidth: pitchRect.width,
      pitchHeight: pitchRect.height,
      compact,
      obstacles,
      playerCount: options.length,
      cardWidth: Math.max(90, compact.width - 14),
      cardHeight: numberVar('--planning-depth-row-height', 28),
      gap: numberVar('--planning-depth-row-gap', 1),
      verticalItemsPerRow: 1,
      horizontalItemsPerColumn: 3,
    })
  }

  function toggleExpansion() {
    if (expanded) {
      compactRectRef.current = null
      setExpansionLayout(null)
      toggle()
      return
    }
    const article = articleRef.current
    const pitch = article?.parentElement
    if (article && pitch) {
      const compact = rectRelativeTo(article.getBoundingClientRect(), pitch.getBoundingClientRect())
      compactRectRef.current = compact
      setExpansionLayout(measuredExpansion(compact))
    }
    toggle()
  }

  useEffect(() => {
    if (!expanded) {
      compactRectRef.current = null
      setExpansionLayout(null)
      return
    }
    const refresh = () => {
      if (compactRectRef.current) setExpansionLayout(measuredExpansion(compactRectRef.current))
    }
    refresh()
    window.addEventListener('resize', refresh)
    return () => window.removeEventListener('resize', refresh)
  }, [expanded, options.length])

  function snappedVisualGridCell(clientX: number, clientY: number): PlanningVisualGridCell {
    const article = articleRef.current
    const pitch = article?.parentElement
    if (!pitch) return { row: spatial?.gridRow ?? 3, column: spatial?.gridColumn ?? 3 }
    const rect = pitch.getBoundingClientRect()
    const rawX = ((clientX - rect.left) / Math.max(1, rect.width)) * 100
    const rawY = ((clientY - rect.top) / Math.max(1, rect.height)) * 100
    const column = PLANNING_VISUAL_GRID_COLUMNS.reduce((best, candidate, index) => Math.abs(candidate - rawX) < Math.abs(PLANNING_VISUAL_GRID_COLUMNS[best] - rawX) ? index : best, 0) + 1
    const row = PLANNING_VISUAL_GRID_ROWS.reduce((best, candidate, index) => Math.abs(candidate - rawY) < Math.abs(PLANNING_VISUAL_GRID_ROWS[best] - rawY) ? index : best, 0) + 1
    return { row, column }
  }

  function visualGridOccupant(cell: PlanningVisualGridCell) {
    const article = articleRef.current
    const pitch = article?.parentElement
    if (!article || !pitch) return null
    const occupant = [...pitch.querySelectorAll<HTMLElement>('.planning-set-row')].find(item =>
      item !== article
      && item.dataset.gridLocked !== 'goalkeeper'
      && Number(item.dataset.gridRow) === cell.row
      && Number(item.dataset.gridColumn) === cell.column)
    return occupant?.dataset.setLabel ?? null
  }

  function setVisualPreview(cell: PlanningVisualGridCell | null) {
    const next = cell ? { cell, occupantLabel: visualGridOccupant(cell) } : null
    visualGridPreviewRef.current = next
    setVisualGridPreview(next)
  }

  function visualSetDragBlocked(target: EventTarget | null) {
    const element = target instanceof Element ? target : null
    if (!element) return true
    if (element.closest('[data-planning-player-id], .planning-set-expand, .planning-set-collapse')) return true
    const interactive = element.closest('button,a,input,select,textarea,[contenteditable="true"]')
    return Boolean(interactive && !interactive.classList.contains('planning-set-legend'))
  }

  function startVisualDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || expanded || !spatial || spatial.isGoalkeeper || visualSetDragBlocked(event.target)) return
    event.stopPropagation()
    const legend = event.target instanceof Element ? event.target.closest<HTMLElement>('.planning-set-legend') : null
    const captureElement = legend ?? event.currentTarget
    visualDragRef.current = { pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, moved: false, startedOnLegend: Boolean(legend), captureElement }
    captureElement.setPointerCapture?.(event.pointerId)
  }

  function moveVisualDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = visualDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
    if (!drag.moved && distance < 4) return
    drag.moved = true
    event.preventDefault()
    if (drag.startedOnLegend) suppressLegendClickRef.current = true
    setVisualPreview(snappedVisualGridCell(event.clientX, event.clientY))
  }

  function finishVisualDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = visualDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    try { drag.captureElement.releasePointerCapture?.(event.pointerId) } catch { /* pointer capture can already be gone */ }
    visualDragRef.current = null
    const target = drag.moved ? (visualGridPreviewRef.current?.cell ?? snappedVisualGridCell(event.clientX, event.clientY)) : null
    setVisualPreview(null)
    if (target) moveVisualGrid(target)
    if (drag.moved && drag.startedOnLegend) window.setTimeout(() => { suppressLegendClickRef.current = false }, 0)
    else suppressLegendClickRef.current = false
  }

  function cancelVisualDrag(event?: ReactPointerEvent<HTMLElement>) {
    const drag = visualDragRef.current
    if (!drag || (event && drag.pointerId !== event.pointerId)) return
    try { drag.captureElement.releasePointerCapture?.(drag.pointerId) } catch { /* pointer capture can already be gone */ }
    visualDragRef.current = null
    suppressLegendClickRef.current = false
    setVisualPreview(null)
  }

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelVisualDrag() }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [])

  const visualGridOverlay = visualGridPreview && spatial && !spatial.isGoalkeeper && articleRef.current?.parentElement
    ? createPortal(<div className="planning-visual-grid-overlay" aria-hidden="true">
      {Array.from({ length: 25 }, (_, index) => {
        const cell = { row: Math.floor(index / 5) + 1, column: (index % 5) + 1 }
        const active = cell.row === visualGridPreview.cell.row && cell.column === visualGridPreview.cell.column
        return <div key={`${cell.row}-${cell.column}`} className={`planning-visual-grid-cell ${active ? 'is-target' : ''}`} style={{ '--planning-preview-x': `${PLANNING_VISUAL_GRID_COLUMNS[cell.column - 1]}%`, '--planning-preview-y': `${PLANNING_VISUAL_GRID_ROWS[cell.row - 1]}%` } as CSSProperties} />
      })}
      <div className={`planning-visual-grid-ghost planning-line-${planningLine(linePosition)} ${visualGridPreview.occupantLabel ? 'is-swap' : ''}`} style={{ '--planning-preview-x': `${PLANNING_VISUAL_GRID_COLUMNS[visualGridPreview.cell.column - 1]}%`, '--planning-preview-y': `${PLANNING_VISUAL_GRID_ROWS[visualGridPreview.cell.row - 1]}%` } as CSSProperties}>
        <strong>{displayLabel}</strong>
        {visualGridPreview.occupantLabel && <span>↔ {visualGridPreview.occupantLabel}</span>}
      </div>
    </div>, articleRef.current.parentElement)
    : null

  const spatialStyle = {
    ...(spatial ? {
      '--planning-x': `${spatial.x}%`,
      '--planning-y': `${spatial.y}%`,
      '--planning-grid-row': String(spatial.gridRow),
      '--planning-grid-column': String(spatial.gridColumn),
      '--planning-row-count': String(Math.max(spatial.rowCount, 1)),
    } : {}),
    ...(expansionLayout ? {
      '--planning-expanded-left': `${expansionLayout.left}px`,
      '--planning-expanded-top': `${expansionLayout.top}px`,
      '--planning-expanded-width': `${expansionLayout.width}px`,
      '--planning-expanded-height': `${expansionLayout.height}px`,
      '--planning-depth-list-width': `${Math.max(90, (compactRectRef.current?.width ?? 184) - 14)}px`,
    } : {}),
  } as CSSProperties

  return <article
    ref={articleRef}
    data-spatial-key={spatial?.key ?? set.id}
    data-spatial-side={spatial?.side ?? 'center'}
    data-grid-row={spatial?.gridRow}
    data-grid-column={spatial?.gridColumn}
    data-set-label={displayLabel}
    data-grid-locked={spatial?.isGoalkeeper ? 'goalkeeper' : undefined}
    data-expansion-direction={expansionLayout?.direction}
    style={spatialStyle}
    className={`planning-set-row planning-line-${planningLine(linePosition)} ${grouped ? 'is-grouped' : ''} ${expanded ? 'is-expanded' : ''} ${expansionLayout ? `is-expansion-${expansionLayout.axis} is-expand-${expansionLayout.direction}` : ''} ${focused ? 'is-focused' : ''} ${visualGridPreview !== null ? 'is-visual-position-dragging' : ''} ${preview !== undefined && activePlayer ? 'is-player-drop-target' : ''}`}
    onPointerDown={startVisualDrag}
    onPointerMove={moveVisualDrag}
    onPointerUp={finishVisualDrag}
    onPointerCancel={cancelVisualDrag}
    onLostPointerCapture={event => { if (visualDragRef.current?.pointerId === event.pointerId) cancelVisualDrag(event) }}
    onDragOver={event => { if (activePlayer) { event.preventDefault(); previewPlayer(null) } }}
    onDrop={event => { if (!activePlayer) return; event.preventDefault(); dropPlayer(preview ?? null) }}
  >
    {visualGridOverlay}
    <button
      type="button"
      className="planning-set-legend"
      onClick={() => { if (suppressLegendClickRef.current) { suppressLegendClickRef.current = false; return } focus() }}
      title={spatial?.isGoalkeeper ? (roleSummary || displayLabel) : expanded ? `${roleSummary || displayLabel} · recolha o conjunto para reposicionar` : `${roleSummary || displayLabel} · arraste livremente pela grade 5×5 sem alterar a posição tática`}
      aria-label={spatial?.isGoalkeeper ? `Focar o conjunto ${displayLabel}` : `Focar ou reposicionar visualmente o conjunto ${displayLabel} na grade 5 por 5`}
    >
      <span>{displayLabel}</span>
    </button>

    <div ref={cardsRef} className={`planning-set-cards ${isPlanningFamiliar(activeFamiliarity) ? 'is-compatible-drop' : isPlanningOutOfPosition(activeFamiliarity) ? 'is-training-drop' : ''}`} onDragOver={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; previewPlayer(insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id, preview)) }} onDrop={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); dropPlayer(preview ?? insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id, preview)) }}>
      {visible.map(option => {
        const player = option.player
        const snapshot = latest(player)
        const rating = score(player)
        const beforeId = player.id
        const playerFamiliarity = familiarity(player)
        const projectionPairs = rating.pair ? [rating.pair] : pairs
        const projectionKey = snapshot ? functionProjectionKey(projectionPairs.flatMap(pair => [{ phase: 'IP', position: pair.ip.position, roleCode: pair.ip.roleCode }, { phase: 'OOP', position: pair.oop.position, roleCode: pair.oop.roleCode }])) : ''
        return <Fragment key={`${option.coverage ? 'coverage' : 'primary'}-${player.id}`}>
          {preview === beforeId && activePlayer?.id !== player.id && <PlayerDropPlaceholder />}
          <BoardPlayerCard
            player={player}
            snapshot={snapshot}
            score={rating.value}
            generalScore={showScores ? generalScore(player) : null}
            scoreDetails={showScores ? scoreDetails(player).filter(detail => detail.id !== rating.pair?.ip.playerId) : []}
            showScores={showScores}
            rank={rating.rank}
            rankPopulation={rating.rankPopulation}
            coverage={option.coverage}
            source={option.coverage ? primaryLabel(player.id) : null}
            familiarity={playerFamiliarity}
            fact={fact(player.id)}
            plannedClub={plannedClub(player.id)}
            plannedConflict={plannedConflict(player.id)}
            projectionKey={projectionKey}
            familiarityTooltip={snapshot ? planningFamiliarityTooltip(snapshot, pairs) : 'Sem observação no checkpoint atual.'}
            dragging={activePlayer?.id === player.id}
            drag={(event) => startPlayerDrag(player.id, event)}
            dragEnd={stopPlayerDrag}
            open={() => open(player.id)}
            context={event => context(event, player.id)}
          />
        </Fragment>
      })}
      {preview === null && activePlayer && <PlayerDropPlaceholder />}
    </div>
    {!expanded && hidden > 0 && <button className="planning-set-expand" onClick={event => { event.stopPropagation(); toggleExpansion() }} title={`Mostrar mais ${hidden} jogador${hidden === 1 ? '' : 'es'}`} aria-label={`Expandir ${displayLabel}`}>+{hidden}</button>}
    {expanded && options.length > capacity && <button className="planning-set-collapse" onClick={event => { event.stopPropagation(); toggleExpansion() }} title="Recolher" aria-label={`Recolher ${displayLabel}`}>−</button>}
  </article>
}

function PlayerDropPlaceholder() { return <div className="planning-player-drop-placeholder" aria-hidden="true"><span>destino</span></div> }

function BoardPlayerCard({ player, snapshot, score, generalScore, scoreDetails, showScores, rank, rankPopulation, coverage, source, familiarity, fact, plannedClub, plannedConflict, projectionKey, familiarityTooltip, dragging, drag, dragEnd, open, context }: {
  player: Player
  snapshot: Snapshot | undefined
  score: number | null
  generalScore: number | null
  scoreDetails: PlanningScoreDetail[]
  showScores: boolean
  rank: number | null
  rankPopulation: number[]
  coverage: boolean
  source: string | null
  familiarity: Familiarity
  fact: PlanningMembershipFact
  plannedClub: string | null
  plannedConflict: string[]
  projectionKey: string
  familiarityTooltip: string
  dragging: boolean
  drag: (event: DragEvent<HTMLElement>) => void
  dragEnd: () => void
  open: () => void
  context: (event: ReactMouseEvent) => void
}) {
  const out = snapshot ? isPlanningOutOfPosition(familiarity) : false
  const familiarityLabel = snapshot ? planningFamiliarityLabel(familiarity) : ''
  const title = [coverage ? `Cobertura · Principal: ${source ?? 'outro conjunto'}` : null, snapshot ? `Atual: ${fact.label} — ${fact.detail}` : 'Sem observação no checkpoint atual. O planejamento foi preservado, mas nenhum dado histórico foi promovido a atual.', plannedConflict.length ? `Conflito: planejado simultaneamente em ${plannedConflict.join(', ')}` : plannedClub ? `Planejado: ${plannedClub}` : 'Sem destino planejado', out ? familiarityTooltip : null].filter(Boolean).join('\n\n')
  return <article data-planning-player-id={player.id} className={`planning-set-player-card planning-depth-player-row ${coverage ? 'is-coverage' : ''} ${out ? 'is-out-of-position' : ''} ${!snapshot ? 'is-current-unknown' : ''} ${!showScores ? 'is-score-hidden' : ''} ${dragging ? 'is-player-dragging' : ''}`} title={title || undefined} draggable onDragStart={event => { event.stopPropagation(); drag(event) }} onDragEnd={dragEnd} onContextMenu={context}>
    <span className="planning-depth-peek-slot">{snapshot && <PlayerPeek player={player} snapshot={snapshot} />}</span>
    <button className="player-name planning-depth-player-name" onClick={event => { event.stopPropagation(); open() }}><span className="planning-depth-player-name-text">{out && <span className="position-warning-icon" aria-label="Fora de posição">⚠</span>}{player.current_name}</span></button>
    {showScores && <PlanningScorePeek playerName={player.current_name} generalScore={generalScore} details={scoreDetails}>
      <span className="planning-score-wrap planning-depth-score-wrap">{snapshot ? <ScoreWithProjection playerId={player.id} currentScore={score} currentRank={rank} rankPopulation={rankPopulation} snapshot={snapshot} scoreType="function" scoreKey={projectionKey} variant="compact" opacityState={coverage ? 'coverage' : 'normal'} currentTitle={coverage ? 'Nota atual nesta função — cobertura' : 'Nota atual nesta função'} projectionTitle={'Melhor RoleScore plausível nesta função em um cenário positivo de desenvolvimento. Não é a evolução mais provável nem o PA/CP do Football Manager.'} /> : <span className="planning-score-unavailable" title="Sem observação no checkpoint atual">—</span>}</span>
    </PlanningScorePeek>}
  </article>
}


function PlanningScorePeek({ playerName, generalScore, details, children }: { playerName: string; generalScore: number | null; details: PlanningScoreDetail[]; children: ReactNode }) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const width = 284
    const height = Math.min(340, 90 + details.length * 34)
    const spaceRight = window.innerWidth - rect.right
    const left = spaceRight >= width + 12 ? rect.right + 8 : Math.max(8, rect.left - width - 8)
    const top = Math.max(8, Math.min(rect.top - 10, window.innerHeight - height - 8))
    setAnchor({ top, left })
  }
  return <span
    className="planning-score-peek-trigger"
    tabIndex={0}
    aria-label={`Ver notas de ${playerName}`}
    onMouseEnter={event => show(event.currentTarget)}
    onMouseLeave={() => setAnchor(null)}
    onFocus={event => show(event.currentTarget)}
    onBlur={() => setAnchor(null)}
    onClick={event => event.stopPropagation()}
  >
    {children}
    {anchor && createPortal(<aside className="planning-score-tooltip" role="tooltip" style={{ top: anchor.top, left: anchor.left }}>
      <header><div><h2>{playerName}</h2><p>Notas na tática atual</p></div></header>
      <div className="planning-score-tooltip-list">
        <div className="is-general"><span>Nota geral</span><ScoreBadge value={generalScore} className="score-badge-compact" showTitle={false} /></div>
        {details.map(detail => <div key={detail.id}><span>{detail.label}</span><ScoreBadge value={detail.score} className="score-badge-compact" showTitle={false} /></div>)}
        {!details.length && <p className="planning-score-tooltip-empty">Nenhuma outra posição da tática é compatível com as posições conhecidas deste jogador.</p>}
      </div>
    </aside>, document.body)}
  </span>
}

function RosterPlayerCard({ player, snapshot, score, rank, rankPopulation, compatible, contextual, scoreKey, fact, plannedClub, plannedConflict, drag, dragEnd, open, context }: { player: Player; snapshot: Snapshot | undefined; score: number | null; rank: number | null; rankPopulation: number[]; compatible: boolean; contextual: boolean; scoreKey?: string; fact: PlanningMembershipFact; plannedClub: string | null; plannedConflict: string[]; drag: (event: DragEvent<HTMLDivElement>) => void; dragEnd: () => void; open: () => void; context: (event: ReactMouseEvent) => void }) {
  const title = [snapshot ? `Atual: ${fact.label} — ${fact.detail}` : 'Sem observação no checkpoint atual. Dados anteriores continuam apenas históricos.', plannedConflict.length ? `Conflito de destino: ${plannedConflict.join(', ')}` : plannedClub ? `Planejado: ${plannedClub}` : 'Sem destino planejado'].join('\n')
  return <div className={`planning-player roster-player-card ${!compatible ? 'incompatible' : ''} ${!snapshot ? 'is-current-unknown' : ''}`} title={title} draggable onDragStart={drag} onDragEnd={dragEnd} onContextMenu={context}>{snapshot && <PlayerPeek player={player} snapshot={snapshot} />}<div className="roster-player-main"><button className="player-name" onClick={event => { event.stopPropagation(); open() }}>{player.current_name}</button><span>{snapshot ? snapshot.positions.join(', ') || 'Sem posição informada' : 'Sem observação no checkpoint atual'}</span><small>{snapshot ? [snapshot.age !== null ? `${snapshot.age} anos` : null, fact.label, plannedConflict.length ? 'Destino em conflito' : plannedClub ? `Plano: ${plannedClub}` : null].filter(Boolean).join(' · ') : ['Situação atual desconhecida', plannedConflict.length ? 'Destino em conflito' : plannedClub ? `Plano preservado: ${plannedClub}` : null].filter(Boolean).join(' · ')}</small></div><span className="planning-score-wrap roster-score-wrap">{snapshot ? <ScoreWithProjection playerId={player.id} currentScore={score} currentRank={rank} rankPopulation={rankPopulation} snapshot={snapshot} scoreType={contextual ? 'function' : 'general'} scoreKey={scoreKey} variant="compact" currentTitle={contextual ? 'Nota atual nesta função' : 'Nota atual'} /> : <span title="Sem observação no checkpoint atual">—</span>}</span></div>
}

function TransferGroupPanel({ group, playerIds, players, latest, fact, plannedClub, dragging, drop, startDrag, dragEnd, open, context, remove }: { group: Group; playerIds: string[]; players: Player[]; latest: (player: Player) => Snapshot | undefined; fact: (playerId: string) => PlanningMembershipFact; plannedClub: (playerId: string) => string | null; dragging: boolean; drop: () => void; startDrag: (id: string) => void; dragEnd: () => void; open: (id: string) => void; context: (event: ReactMouseEvent, playerId: string) => void; remove: (id: string) => void }) {
  const members = playerIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  return <section className={`transfer-group-panel planning-free-group ${dragging ? 'is-receiving' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop() }}><div className="transfer-group-summary"><span>Área livre de mercado</span><strong>{members.length} jogador{members.length === 1 ? '' : 'es'}</strong></div><div className="transfer-player-grid">{members.map(player => { const snapshot = latest(player); const current = fact(player.id); return <article className={`transfer-player-card ${!snapshot ? 'is-current-unknown' : ''}`} draggable onDragStart={() => startDrag(player.id)} onDragEnd={dragEnd} onContextMenu={event => context(event, player.id)} key={player.id}>{snapshot && <PlayerPeek player={player} snapshot={snapshot} />}<div className="transfer-player-info"><button className="player-name" onClick={() => open(player.id)}>{player.current_name}</button><span>{snapshot ? snapshot.positions.join(', ') || 'Sem posição' : 'Sem observação no checkpoint atual'}</span><small>{snapshot ? `${snapshot.age ?? '—'} anos · Atual: ${current.label} · Plano: ${plannedClub(player.id) ?? '—'}` : `Situação atual desconhecida · Plano: ${plannedClub(player.id) ?? group.name}`}</small></div><button className="transfer-remove" onClick={() => remove(player.id)} title={`Remover ${player.current_name} de ${group.name}`} aria-label={`Remover ${player.current_name} de ${group.name}`}>×</button></article> })}{!members.length && <div className="transfer-empty"><b>Arraste jogadores para {group.name.toLowerCase()}</b><span>Este grupo não utiliza posições ou funções da tática.</span></div>}</div>{dragging && <div className="transfer-drop-hint">Solte para adicionar a {group.name}</div>}</section>
}

function factBadgeLabel(fact: PlanningMembershipFact) {
  if (fact.kind === 'current') return fact.membership?.team_level === 'academy' ? 'Base' : fact.membership?.team_level === 'reserve' ? 'B' : 'Atual'
  if (fact.kind === 'loaned_in') return 'Emp. aqui'
  if (fact.kind === 'loaned_out') return 'Emp. fora'
  if (fact.kind === 'other_club') return 'Outro'
  return 'Incerto'
}

function ManagerDropPlaceholder({ label }: { label: string }) { return <div className="manager-drop-placeholder" aria-hidden="true">{label}</div> }

function planningLine(position: string): PlanningPitchLine { const value = position.toUpperCase().replaceAll(' ', ''); if (value.startsWith('GK')) return 'gk'; if (value.startsWith('ST')) return 'st'; if (value.startsWith('AM')) return 'am'; if (value.startsWith('M')) return 'm'; if (value.startsWith('DM') || value.startsWith('WB')) return 'dm'; return 'd' }
const footLabel = (foot: string | null) => {
  if (!foot) return ''
  const normalized = foot.trim().toLowerCase()
  const label = normalized === 'right' || normalized === 'direito' || normalized === 'direita' ? 'direito'
    : normalized === 'left' || normalized === 'esquerdo' || normalized === 'esquerda' ? 'esquerdo'
      : normalized === 'both' || normalized === 'ambos' ? 'ambos'
        : foot
  return `Pé ${label}`
}
