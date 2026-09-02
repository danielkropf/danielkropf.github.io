import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generalScoreForSnapshot } from '../lib/base-position-score'
import { pairedRoleScore, resolveRoleWeights } from '../lib/role-scoring'
import { ScoreWithProjection } from '../components/ScoreWithProjection'
import { SaveState } from '../components/SaveState'
import { CustomSelect } from '../components/CustomSelect'
import { PositionSelector, canonicalPosition } from '../components/PositionSelector'
import { generalReferencePercentile, generalReferenceScoresByFamily, percentile, referencePairedRoleScore, type ReferenceDataset } from '../lib/reference'
import { canPlayPosition } from '../lib/positions'
import { isPlanningFamiliar, isPlanningOutOfPosition, planningFamiliarity, planningFamiliarityLabel, planningFamiliarityTooltip, type PlanningFamiliarity } from '../lib/planning-familiarity'
import { loadCurrentPlayers, loadReferenceDataset } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { usePotential } from '../features/potential/PotentialContext'
import { PlayerPeek } from '../components/PlayerPeek'
import { loadModelConfig, patchModelConfig, retryModelConfigPatch, scheduleModelConfigPatch } from '../lib/model-config'
import { describeDbError } from '../lib/db-error'
import { calculatePlanningCardLayout, resolvePlanningInsertionBefore } from '../lib/planning-layout'
import { functionProjectionKey } from '../lib/projection-player'
import { positionGroup } from '../lib/tactics'
import { derivePlanningAssignmentIndex } from '../lib/planningDistribution'
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
} from '../lib/multiclub-planning'
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
type SetDropPreview = { beforeSetId: string | null }
type FactFilter = 'all' | PlanningMembershipFactKind
type PlanningUndo = Pick<Config, 'planning' | 'planning_by_club'>

const transferGroups: Group[] = [{ id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }]
const EMPTY_ROLE_OVERRIDES: Record<string, Record<string, number>> = {}
const defaults = (): Planning => ({ groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'base', name: 'Base' }, ...transferGroups], slotAssignments: {}, setLayouts: {} })
const canPlay = canPlayPosition
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

export function PlanningPage() {
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
    setSetDropPreview(null)
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
        const legacyPlanning = primaryId && planningByClub[primaryId] ? planningByClub[primaryId] : normalizePlanning(existing.planning)
        setConfig({ ...existing, planning: legacyPlanning, planning_by_club: planningByClub, selected_tactic_id_by_club: selectedTacticByClub })
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
    if (!loaded.current || !selected || !supabase) return
    const patch: Record<string, unknown> = {
      planning_by_club: config.planning_by_club ?? {},
      selected_tactic_id_by_club: config.selected_tactic_id_by_club ?? {},
    }
    if (config.planning !== undefined) patch.planning = config.planning
    scheduleModelConfigPatch(selected.id, '2.9.0', patch, saveStatus)
  }, [config.planning, config.planning_by_club, config.selected_tactic_id_by_club, selected?.id])

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
  const slotDescriptors: TacticSlotDescriptor[] = useMemo(() => pairs.map(pair => ({ id: pair.ip.playerId, position: pair.ip.position, oopPosition: pair.oop.position })), [pairs])
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
  function stopSetDrag() { setDraggingSetId(null); setSetDropPreview(null) }
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
      if (!result) await persistPatch({
        planning: config.planning ?? defaults(),
        planning_by_club: config.planning_by_club ?? {},
        selected_tactic_id: config.selected_tactic_id ?? null,
        selected_tactic_id_by_club: config.selected_tactic_id_by_club ?? {},
      })
    } catch { /* status is already updated by the shared persistence layer */ }
  }

  function commitSetDrop(beforeId: string | null) {
    if (draggingSetId) reorderSet(draggingSetId, beforeId)
    stopSetDrag()
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

  return <div className="screen-page planning-page planning-flex-page">
    <div className="title-row planning-title-row"><div><h1>Planejamento{selectedClub && planningClubs.length > 1 ? ` · ${selectedClub.club.name}` : ''}</h1>{(loading || isPending) && <span className="background-loading" role="status">Carregando em segundo plano…</span>}</div><SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠') ? () => void retrySave() : undefined} /></div>

    <section className="planning-matrix-toolbar planning-aligned-toolbar planning-flex-toolbar">
      {planningClubs.length > 1 && <CustomSelect className="tactic-custom-select" ariaLabel="Clube do planejamento" value={selectedClubId ?? ''} options={planningClubs.map(item => ({ value: item.club_id, label: item.tracking_role === 'primary' ? `${item.club.name} · Principal` : item.club.name }))} placeholder="Clube" onChange={changePlanningClub} />}
      <CustomSelect className="tactic-custom-select" ariaLabel="Tática selecionada" value={tactic?.id ?? ''} options={tactics.map(item => ({ value: item.id, label: item.name }))} placeholder={tactics.length ? 'Tática' : 'Nenhuma tática criada'} disabled={!tactics.length || isTransferGroup} disabledReason={isTransferGroup ? 'Táticas não se aplicam a grupos de mercado' : !tactics.length ? 'Nenhuma tática criada' : undefined} onChange={selectClubTactic} />
      <div className="squad-pagination planning-group-selector"><button onClick={() => changeGroup(-1)} disabled={planning.groups.length < 2}>‹</button><strong>{currentGroup?.name ?? 'Nenhum elenco'}</strong><span>{planning.groups.length ? `${currentGroupIndex + 1} de ${planning.groups.length}` : '0 de 0'}</span><button onClick={() => changeGroup(1)} disabled={planning.groups.length < 2}>›</button></div>
      <label className={`coverage-toggle ${isTransferGroup || !tactic ? 'is-disabled' : ''}`} title={isTransferGroup ? 'Coberturas não se aplicam a grupos de mercado' : !tactic ? 'Crie uma tática para visualizar coberturas' : undefined}><input type="checkbox" checked={showCoverages} disabled={isTransferGroup || !tactic} onChange={event => setShowCoverages(event.target.checked)} /><span>Mostrar coberturas</span></label>
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
        <div className="planning-player-list">
          {!players.length && (loading || isPending) && <div className="background-loader-panel" role="status">Carregando elenco… você pode trocar de aba enquanto isso.</div>}
          {roster.map(({ player, score, rank, rankPopulation, compatible, pair, fact }) => <RosterPlayerCard player={player} snapshot={latest(player)!} score={score} rank={rank} rankPopulation={rankPopulation} compatible={compatible} contextual={contextualPairs.length > 0} scoreKey={pair ? functionProjectionKey([{ phase: 'IP', position: pair.ip.position, roleCode: pair.ip.roleCode }, { phase: 'OOP', position: pair.oop.position, roleCode: pair.oop.roleCode }]) : undefined} fact={fact} plannedClub={plannedClubName(player.id)} plannedConflict={plannedClubConflict(player.id)} drag={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', player.id); setDragging({ type: 'player', id: player.id }) }} dragEnd={stopPlayerDrag} open={() => navigate(`/players/${player.id}`)} context={event => openPlayerMenu(event, player.id)} key={player.id} />)}
        </div>
      </article>

      <div className={`planning-flex-board ${expandedSets.size ? 'has-expanded' : ''} ${isTransferGroup ? 'is-transfer' : ''}`}>
        {isTransferGroup && currentGroup ? <TransferGroupPanel group={currentGroup} playerIds={planning.slotAssignments[currentGroup.id]?.market ?? []} players={players} latest={latest} fact={membershipFact} plannedClub={plannedClubName} dragging={Boolean(activePlayer)} drop={() => { if (activePlayer) placePlayer(currentGroup.id, 'market', activePlayer.id); stopPlayerDrag() }} startDrag={id => setDragging({ type: 'player', id })} dragEnd={stopPlayerDrag} open={id => navigate(`/players/${id}`)} context={openPlayerMenu} remove={removePlayer} />
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
                fact={membershipFact}
                plannedClub={plannedClubName}
                plannedConflict={plannedClubConflict}
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
                context={openPlayerMenu}
              />
            </Fragment>)}
            {draggingSetId && setDropPreview?.beforeSetId === null && <SetDropPlaceholder drop={() => commitSetDrop(null)} />}
          </div> : <div className="empty planning-no-tactic"><h2>Nenhuma tática disponível</h2><p>Crie uma tática para organizar o elenco por posição e função.</p><button onClick={() => navigate('/tactics')}>Criar primeira tática</button></div>}
      </div>
    </section>

    {manageSquadsOpen && <div className="settings-overlay" onClick={() => setManageSquadsOpen(false)}><section className="squad-manager planning-squad-manager" onClick={event => event.stopPropagation()}><header><h2>Gerenciar elencos</h2><button className="close" onClick={() => setManageSquadsOpen(false)}>×</button></header><div className="squad-manager-list">{planning.groups.map((group, index) => { const fixed = transferGroups.some(item => item.id === group.id); const previewBefore = managerGroupPreview === group.id && managerGroupDragging !== group.id; return <Fragment key={group.id}>{previewBefore && <ManagerDropPlaceholder label="Mover elenco para cá" />}<div className={`planning-squad-manager-row ${fixed ? 'fixed-planning-group' : ''} ${managerGroupDragging === group.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerGroupPreview(event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null) }} onDrop={event => { if (!managerGroupDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderGroup(managerGroupDragging, event.clientY < rect.top + rect.height / 2 ? group.id : planning.groups[index + 1]?.id ?? null); setManagerGroupDragging(null); setManagerGroupPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', group.id); setManagerGroupDragging(group.id); setManagerGroupPreview(group.id) }} onDragEnd={() => { setManagerGroupDragging(null); setManagerGroupPreview(undefined) }} title={`Arrastar ${group.name}`} aria-label={`Reordenar ${group.name}`}>⠿</button><input value={group.name} readOnly={fixed} onChange={event => renameGroup(group.id, event.target.value)} />{fixed ? <span className="market-group-label">GRUPO MERCADO</span> : <button className="manager-trash" onClick={() => removeGroup(group.id)} title={`Excluir ${group.name}`} aria-label={`Excluir ${group.name}`}>🗑</button>}</div></Fragment> })}{managerGroupDragging && managerGroupPreview === null && <ManagerDropPlaceholder label="Mover elenco para o final" />}</div><footer className="planning-squad-manager-footer"><div className="planning-add-squad"><input placeholder="Novo elenco" value={newGroup} onChange={event => setNewGroup(event.target.value)} onKeyDown={event => event.key === 'Enter' && addGroup()} /><button onClick={addGroup}>+ Adicionar</button></div><button className="danger-button clear-all-squads" disabled={!Object.keys(assignmentIndex).length} onClick={clearPlanning}>Limpar todos os elencos</button></footer></section></div>}

    {manageSetsOpen && tactic && currentGroup && !isTransferGroup && <div className="settings-overlay" onClick={() => setManageSetsOpen(false)}><section className="squad-manager planning-set-manager" onClick={event => event.stopPropagation()}><header><div><h2>Organizar posições</h2><p>Organização visual de {currentGroup.name}; a tática não é alterada.</p></div><button className="close" onClick={() => setManageSetsOpen(false)}>×</button></header><div className="planning-set-manager-list">{currentSets.map((set, index) => { const effectiveLabel = displaySetLabel(set); const previewBefore = managerSetPreview === set.id && managerSetDragging !== set.id; const nextSet = currentSets[index + 1]; const canGroupNext = Boolean(nextSet && canGroupAdjacentPlanningSets(set, nextSet, slotDescriptors)); return <Fragment key={set.id}>{previewBefore && <ManagerDropPlaceholder label="Mover posição para cá" />}<div className={`planning-set-manager-row ${set.slotIds.length > 1 ? 'is-grouped-manager-row' : ''} ${managerSetDragging === set.id ? 'is-manager-dragging' : ''}`} onDragOver={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setManagerSetPreview(event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null) }} onDrop={event => { if (!managerSetDragging) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); reorderSet(managerSetDragging, event.clientY < rect.top + rect.height / 2 ? set.id : currentSets[index + 1]?.id ?? null); setManagerSetDragging(null); setManagerSetPreview(undefined) }}><button className="manager-drag-handle" draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', set.id); setManagerSetDragging(set.id); setManagerSetPreview(set.id) }} onDragEnd={() => { setManagerSetDragging(null); setManagerSetPreview(undefined) }} title={`Arrastar ${effectiveLabel}`} aria-label={`Reordenar ${effectiveLabel}`}>⠿</button>{set.slotIds.length > 1 ? <><button className="split-set-button" onClick={() => splitSet(set.id)} title="Desagrupar" aria-label={`Desagrupar ${effectiveLabel}`}>−</button><div className="grouped-set-fields"><label>Nome geral<input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /></label>{set.slotIds.map((slotId, slotIndex) => <label key={slotId}>Posição {slotIndex + 1}<input value={planningSlotDisplayLabel(set, slotId, slotDescriptors)} onChange={event => renameSetSlot(set.id, slotId, event.target.value)} /></label>)}</div></> : <><span className="set-manager-order">{index + 1}</span><input value={effectiveLabel} onChange={event => renameSet(set.id, event.target.value)} /><small>1 posição</small></>}</div>{canGroupNext && <button className="adjacent-group-button" type="button" title={`Agrupar ${effectiveLabel} e ${displaySetLabel(nextSet)}`} onClick={() => groupSet(set.id, nextSet.id)}>+</button>}</Fragment> })}{managerSetDragging && managerSetPreview === null && <ManagerDropPlaceholder label="Mover posição para o final" />}</div><footer><button className="ghost" onClick={restoreSets}>Restaurar ordem e grupos da tática</button><button onClick={() => setManageSetsOpen(false)}>Concluir</button></footer></section></div>}

    {menu && <div className="planning-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={event => event.stopPropagation()}>
      <button role="menuitem" onClick={() => moveMenuPlayer('loan')}>Adicionar a Empréstimo</button>
      <button role="menuitem" onClick={() => moveMenuPlayer('sale')}>Adicionar a Venda</button>
      <button role="menuitem" className="is-danger" onClick={() => { removePlayer(menu.playerId); setMenu(null) }}>Remover do planejamento</button>
    </div>}
  </div>
}

function useCompactCapacity(grouped: boolean, optionCount: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { showPotential } = usePotential()
  const [capacity, setCapacity] = useState(grouped ? 8 : 4)
  const [columns, setColumns] = useState(4)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const layout = calculatePlanningCardLayout(node.clientWidth, grouped, optionCount, showPotential)
      node.style.setProperty('--planning-card-width', `${layout.cardWidth}px`)
      setCapacity(layout.capacity)
      setColumns(layout.columns)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [grouped, optionCount, showPotential])
  return { ref, capacity, columns }
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


function PlanningSetRow({ set, displayLabel, pairs, assignedIds, players, latest, expanded, focused, coverages, showCoverages, primaryLabel, activePlayer, draggingSetId, playerDropPreview, nextSetId, score, familiarity, fact, plannedClub, plannedConflict, toggle, focus, startPlayerDrag, stopPlayerDrag, previewPlayer, dropPlayer, startSetDrag, stopSetDrag, previewSet, dropSet, open, context }: {
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

    <div ref={cardsRef} className={`planning-set-cards ${isPlanningFamiliar(activeFamiliarity) ? 'is-compatible-drop' : isPlanningOutOfPosition(activeFamiliarity) ? 'is-training-drop' : ''}`} onDragOver={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; previewPlayer(insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id, preview)) }} onDrop={event => { if (!activePlayer) return; event.preventDefault(); event.stopPropagation(); dropPlayer(preview ?? insertionBeforePlayer(event.currentTarget, event.clientX, event.clientY, activePlayer.id, preview)) }}>
      {visible.map((option, index) => {
        const player = option.player
        const snapshot = latest(player)
        if (!snapshot) return null
        const rating = score(player)
        const beforeId = player.id
        const playerFamiliarity = familiarity(player)
        const projectionPairs = rating.pair ? [rating.pair] : pairs
        const projectionKey = functionProjectionKey(projectionPairs.flatMap(pair => [{ phase: 'IP', position: pair.ip.position, roleCode: pair.ip.roleCode }, { phase: 'OOP', position: pair.oop.position, roleCode: pair.oop.roleCode }]))
        return <Fragment key={`${option.coverage ? 'coverage' : 'primary'}-${player.id}`}>
          {preview === beforeId && activePlayer?.id !== player.id && <PlayerDropPlaceholder />}
          <BoardPlayerCard
            player={player}
            snapshot={snapshot}
            score={rating.value}
            rank={rating.rank}
            rankPopulation={rating.rankPopulation}
            coverage={option.coverage}
            source={option.coverage ? primaryLabel(player.id) : null}
            familiarity={playerFamiliarity}
            fact={fact(player.id)}
            plannedClub={plannedClub(player.id)}
            plannedConflict={plannedConflict(player.id)}
            projectionKey={projectionKey}
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

function BoardPlayerCard({ player, snapshot, score, rank, rankPopulation, coverage, source, familiarity, fact, plannedClub, plannedConflict, projectionKey, familiarityTooltip, dragging, drag, dragEnd, open, context }: {
  player: Player
  snapshot: Snapshot
  score: number | null
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
  const out = isPlanningOutOfPosition(familiarity)
  const familiarityLabel = planningFamiliarityLabel(familiarity)
  const title = [coverage ? `Cobertura · Principal: ${source ?? 'outro conjunto'}` : null, `Atual: ${fact.label} — ${fact.detail}`, plannedConflict.length ? `Conflito: planejado simultaneamente em ${plannedConflict.join(', ')}` : plannedClub ? `Planejado: ${plannedClub}` : 'Sem destino planejado', out ? familiarityTooltip : null].filter(Boolean).join('\n\n')
  return <article data-planning-player-id={player.id} className={`planning-set-player-card ${coverage ? 'is-coverage' : ''} ${out ? 'is-out-of-position' : ''} ${dragging ? 'is-player-dragging' : ''}`} title={title || undefined} draggable onDragStart={event => { event.stopPropagation(); drag(event) }} onDragEnd={dragEnd} onContextMenu={context}>
    <button className="player-name" onClick={event => { event.stopPropagation(); open() }}>{out && <span className="position-warning-icon" aria-label="Fora de posição">⚠</span>}{player.current_name}</button>
    <span className="planning-score-wrap"><ScoreWithProjection playerId={player.id} currentScore={score} currentRank={rank} rankPopulation={rankPopulation} snapshot={snapshot} scoreType="function" scoreKey={projectionKey} variant="compact" opacityState={coverage ? 'coverage' : 'normal'} currentTitle={coverage ? 'Nota atual nesta função — cobertura' : 'Nota atual nesta função'} projectionTitle={'Melhor RoleScore plausível nesta função em um cenário positivo de desenvolvimento. Não é a evolução mais provável nem o PA/CP do Football Manager.'} /></span>
    <div className="planning-card-meta"><small>{snapshot.age ?? '—'} anos</small><span className="planning-card-badges"><b className={`membership-badge is-${fact.kind}`} title={fact.detail}>{factBadgeLabel(fact)}</b>{plannedConflict.length ? <b className="planning-conflict-badge" title={`Planejado em ${plannedConflict.join(', ')}`}>Conflito</b> : null}{coverage && <b className="coverage-badge">Cobertura</b>}{familiarityLabel && <b className="out-position-badge">{familiarityLabel.includes('IP/OOP') ? 'Fora pos. IP/OOP' : familiarityLabel.includes('IP') ? 'Fora pos. IP' : familiarityLabel.includes('OOP') ? 'Fora pos. OOP' : 'Fora pos.'}</b>}</span></div>
  </article>
}

function RosterPlayerCard({ player, snapshot, score, rank, rankPopulation, compatible, contextual, scoreKey, fact, plannedClub, plannedConflict, drag, dragEnd, open, context }: { player: Player; snapshot: Snapshot; score: number | null; rank: number | null; rankPopulation: number[]; compatible: boolean; contextual: boolean; scoreKey?: string; fact: PlanningMembershipFact; plannedClub: string | null; plannedConflict: string[]; drag: (event: DragEvent<HTMLDivElement>) => void; dragEnd: () => void; open: () => void; context: (event: ReactMouseEvent) => void }) {
  const title = [`Atual: ${fact.label} — ${fact.detail}`, plannedConflict.length ? `Conflito de destino: ${plannedConflict.join(', ')}` : plannedClub ? `Planejado: ${plannedClub}` : 'Sem destino planejado'].join('\n')
  return <div className={`planning-player roster-player-card ${!compatible ? 'incompatible' : ''}`} title={title} draggable onDragStart={drag} onDragEnd={dragEnd} onContextMenu={context}><PlayerPeek player={player} snapshot={snapshot} /><div className="roster-player-main"><button className="player-name" onClick={event => { event.stopPropagation(); open() }}>{player.current_name}</button><span>{snapshot.positions.join(', ') || 'Sem posição informada'}</span><small>{[snapshot.age !== null ? `${snapshot.age} anos` : null, fact.label, plannedConflict.length ? 'Destino em conflito' : plannedClub ? `Plano: ${plannedClub}` : null].filter(Boolean).join(' · ')}</small></div><span className="planning-score-wrap roster-score-wrap"><ScoreWithProjection playerId={player.id} currentScore={score} currentRank={rank} rankPopulation={rankPopulation} snapshot={snapshot} scoreType={contextual ? 'function' : 'general'} scoreKey={scoreKey} variant="compact" currentTitle={contextual ? 'Nota atual nesta função' : 'Nota atual'} /></span></div>
}

function TransferGroupPanel({ group, playerIds, players, latest, fact, plannedClub, dragging, drop, startDrag, dragEnd, open, context, remove }: { group: Group; playerIds: string[]; players: Player[]; latest: (player: Player) => Snapshot | undefined; fact: (playerId: string) => PlanningMembershipFact; plannedClub: (playerId: string) => string | null; dragging: boolean; drop: () => void; startDrag: (id: string) => void; dragEnd: () => void; open: (id: string) => void; context: (event: ReactMouseEvent, playerId: string) => void; remove: (id: string) => void }) {
  const members = playerIds.map(id => players.find(player => player.id === id)).filter((player): player is Player => Boolean(player))
  return <section className={`transfer-group-panel planning-free-group ${dragging ? 'is-receiving' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); drop() }}><div className="transfer-group-summary"><span>Área livre de mercado</span><strong>{members.length} jogador{members.length === 1 ? '' : 'es'}</strong></div><div className="transfer-player-grid">{members.map(player => { const snapshot = latest(player); const current = fact(player.id); return snapshot ? <article className="transfer-player-card" draggable onDragStart={() => startDrag(player.id)} onDragEnd={dragEnd} onContextMenu={event => context(event, player.id)} key={player.id}><PlayerPeek player={player} snapshot={snapshot} /><div className="transfer-player-info"><button className="player-name" onClick={() => open(player.id)}>{player.current_name}</button><span>{snapshot.positions.join(', ') || 'Sem posição'}</span><small>{snapshot.age ?? '—'} anos · Atual: {current.label} · Plano: {plannedClub(player.id) ?? '—'}</small></div><button className="transfer-remove" onClick={() => remove(player.id)} title={`Remover ${player.current_name} de ${group.name}`} aria-label={`Remover ${player.current_name} de ${group.name}`}>×</button></article> : null })}{!members.length && <div className="transfer-empty"><b>Arraste jogadores para {group.name.toLowerCase()}</b><span>Este grupo não utiliza posições ou funções da tática.</span></div>}</div>{dragging && <div className="transfer-drop-hint">Solte para adicionar a {group.name}</div>}</section>
}

function factBadgeLabel(fact: PlanningMembershipFact) {
  if (fact.kind === 'current') return fact.membership?.team_level === 'academy' ? 'Base' : fact.membership?.team_level === 'reserve' ? 'B' : 'Atual'
  if (fact.kind === 'loaned_in') return 'Emp. aqui'
  if (fact.kind === 'loaned_out') return 'Emp. fora'
  if (fact.kind === 'other_club') return 'Outro'
  return 'Incerto'
}

function ManagerDropPlaceholder({ label }: { label: string }) { return <div className="manager-drop-placeholder" aria-hidden="true">{label}</div> }


function planningLine(position: string) { const value = position.toUpperCase().replaceAll(' ', ''); if (value.startsWith('GK')) return 'gk'; if (value.startsWith('ST')) return 'st'; if (value.startsWith('AM')) return 'am'; if (value.startsWith('M')) return 'm'; if (value.startsWith('DM') || value.startsWith('WB')) return 'dm'; return 'd' }
const footLabel = (foot: string | null) => {
  if (!foot) return ''
  const normalized = foot.trim().toLowerCase()
  const label = normalized === 'right' || normalized === 'direito' || normalized === 'direita' ? 'direito'
    : normalized === 'left' || normalized === 'esquerdo' || normalized === 'esquerda' ? 'esquerdo'
      : normalized === 'both' || normalized === 'ambos' ? 'ambos'
        : foot
  return `Pé ${label}`
}
