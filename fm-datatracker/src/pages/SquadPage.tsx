import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generalScoreForSnapshot } from '../lib/base-position-score'
import { pairedRoleScore, resolveRoleWeights, roleScore } from '../lib/role-scoring'
import { ScoreWithProjection } from '../components/ScoreWithProjection'
import { SaveState } from '../components/SaveState'
import { functionProjectionKey } from '../lib/projection-player'
import { CustomSelect } from '../components/CustomSelect'
import { PositionSelector } from '../components/PositionSelector'
import { DataTable } from '../components/data-table/DataTable'
import { DataTableChrome, DataTableColumnMenu, TableViewSaveDialog, type DataTableColumnMenuItem, type DataTableQuickFilter, type DataTableViewOption } from '../components/data-table/DataTableChrome'
import { readStoredDataTableViews, writeStoredDataTableViews, type StoredDataTableView } from '../components/data-table/table-view-storage'
import { DATA_TABLE_PRESETS } from '../components/data-table/presets'
import { positionRank, positionSideRank } from '../lib/positions'
import { ATTRIBUTE_CATALOG, type AttributeCategory } from '../lib/attributes'
import { generalReferencePercentile, generalReferenceScoresByFamily, normalizeCountry, referenceLevel, type ReferenceDataset, type ReferenceLevel } from '../lib/reference'
import { PITCH_NODES, positionGroup, rolesFor, type TacticPhase } from '../lib/tactics'
import { canPlayPosition } from '../lib/positions'
import { loadCurrentPlayers, loadReferenceDataset, type RichPlayer } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { PlayerPeek } from '../components/PlayerPeek'
import { PlanningStatusBadge } from '../components/PlanningStatusBadge'
import { RosterPlayerContextMenu } from '../components/RosterPlayerContextMenu'
import type { PlayerRow } from '../types/domain'
import { loadModelConfig, retryModelConfigPatch, scheduleModelConfigPatch } from '../lib/model-config'
import { describeDbError } from '../lib/db-error'
import { movePlayerAcrossClubPlans, patchClubPlanning, primaryPlanningClubId, resolveClubPlanning, resolveClubTacticId } from '../lib/multiclub-planning'
import { layoutsFor, movePlayerToSet, planningSetDisplayLabel, type FlexiblePlanning, type PlanningSetLayout, type TacticSlotDescriptor } from '../lib/planningSets'
import { usePotential } from '../features/potential/PotentialContext'
import { effectiveGeneralSortScore, effectiveRoleSortScore } from '../lib/score-sort'
import { countryFlagEmoji, currentRosterLabel, currentRosterStatus, isExternalCurrentClub, preferredTacticalPlanningGroupId, type CurrentRosterMembershipKind, type PlanningTeamLevel } from '../lib/current-roster'
import { effectivePlanningSquadGroupId, isMarketPlanningGroup, movePlayerToPlanningSquad, planningSquadLabel, reconcilePlanningSquadGroups } from '../lib/planning-squads'
import { discoverSnapshotScalarColumns, snapshotScalarValue, type SnapshotScalarColumn, type SnapshotFieldCategory } from '../lib/player-table-columns'

type DataKey = 'tacticSlot' | 'status' | 'name' | 'age' | 'nationality' | 'value' | 'team' | 'squad' | 'position' | 'height' | 'weight' | 'foot' | 'contract' | 'snapshot' | 'score' | 'reference'
type Assignment = { playerId: string; nodeId: string; position: string; roleId?: string; roleCode: string; roleName: string }
type Tactic = { id: string; name: string; ipAssignments: Assignment[]; oopAssignments: Assignment[]; roles?: { id: string; name: string; weights: Record<string, number> }[]; lineup?: Record<string, string | null> }
type TableColumn = { id: string; kind: 'data' | 'attribute' | 'role' | 'tacticRole' | 'snapshot'; key?: DataKey; attributeKey?: string; phase?: TacticPhase; position?: string; roleCode?: string; tacticId?: string; linkId?: string; snapshotSource?: 'normalized' | 'raw'; snapshotFieldKey?: string; snapshotCategory?: SnapshotFieldCategory; label: string }
type Snapshot = PlayerRow['player_snapshots'][number]
type Planning = FlexiblePlanning & { groups: Array<{ id: string; name: string }>; assignments?: Record<string, string> }
type ModelConfig = { role_weight_overrides?: Record<string, Record<string, number>>; planning?: Planning; planning_by_club?: Record<string, Planning>; tactics?: Tactic[]; selected_tactic_id?: string | null; selected_tactic_id_by_club?: Record<string, string | null> }
type Row = { player: RichPlayer; latest: Snapshot; score: number | null; sortScore: number | null; status: string; marketValue: string | null; referencePercentile: number | null; referenceLevel: ReferenceLevel | null; referenceSample: number; referenceGroup: string; columnScores: Record<string, number | null>; columnSortScores: Record<string, number | null>; tacticSlot: string | null; tacticSlotLabel: string | null; tacticGroupId: string | null; tacticOptions: Array<{ id: string; label: string }>; clubName: string | null; factualSquadName: string | null; squadName: string | null; squadGroupId: string | null; squadOptions: Array<{ id: string; label: string }>; membershipKind: CurrentRosterMembershipKind; externalClub: boolean }
type Filter = { id: string; column: Exclude<DataKey, 'tacticSlot'>; operator: 'contains' | 'equals' | 'gte' | 'lte'; value: string }
type QuickFilterId = string

type BuiltInView = { id: string; label: string; columns: () => TableColumn[]; frozenIndex?: number }

const TABLE_LAYOUT_KEY = 'fm-datatracker:squad-table-v4'
const TABLE_VIEWS_KEY = 'fm-datatracker:squad-table-views-v1'
const positions = [['GK', 'Goleiro'], ['D (L)', 'Defesa esquerda'], ['D (C)', 'Defesa central'], ['D (R)', 'Defesa direita'], ['WB (L)', 'Ala esquerdo'], ['WB (R)', 'Ala direito'], ['DM (C)', 'Médio defensivo'], ['M (L)', 'Médio esquerdo'], ['M (C)', 'Médio central'], ['M (R)', 'Médio direito'], ['AM (L)', 'Extremo esquerdo'], ['AM (C)', 'Médio ofensivo'], ['AM (R)', 'Extremo direito'], ['ST (C)', 'Atacante']] as const
const dataLabels: Record<DataKey, string> = { tacticSlot: 'Tática', status: 'Status', name: 'Nome', age: 'Idade', nationality: 'Nacionalidade', value: 'Valor', team: 'Clube', squad: 'Elenco', position: 'Posições', height: 'Altura', weight: 'Peso', foot: 'Pé preferido', contract: 'Fim do contrato', snapshot: 'Data do snapshot', score: 'Nota geral', reference: 'Nível de referência' }
const dataWidths: Record<DataKey, number> = { tacticSlot: 180, status: 104, name: 210, age: 72, nationality: 150, value: 130, team: 150, squad: 130, position: 170, height: 90, weight: 85, foot: 125, contract: 125, snapshot: 125, score: 196, reference: 180 }
const allDataKeys = Object.keys(dataLabels) as DataKey[]
const dataColumn = (key: DataKey): TableColumn => ({ id: key, kind: 'data', key, label: dataLabels[key] })
const defaultColumns = (['tacticSlot', 'status', 'name', 'age', 'nationality', 'value', 'team', 'squad', 'position', 'score', 'reference'] as DataKey[]).map(dataColumn)
const attributeColumn = (key: string, label: string): TableColumn => ({ id: `attribute|${key}`, kind: 'attribute', attributeKey: key, label })
const snapshotColumn = (column: SnapshotScalarColumn): TableColumn => ({ id: column.id, kind: 'snapshot', snapshotSource: column.source, snapshotFieldKey: column.fieldKey, snapshotCategory: column.category, label: column.label })
const roleColumn = (phase: TacticPhase, position: string, roleCode: string): TableColumn => ({ id: `role|${phase}|${position}|${roleCode}`, kind: 'role', phase, position, roleCode, label: `${phase} · ${position} · ${roleCode}` })
const tacticColumn = (tactic: Tactic, ip: Assignment, oop: Assignment): TableColumn => ({ id: `tactic|${tactic.id}|${ip.playerId}`, kind: 'tacticRole', tacticId: tactic.id, linkId: ip.playerId, label: `${tactic.name} · ${ip.position} ${ip.roleCode} ↔ ${oop.position} ${oop.roleCode}` })

function defaultWidth(column: TableColumn) {
  if (column.kind === 'data') return dataWidths[column.key!]
  if (column.kind === 'attribute' || column.kind === 'snapshot') return 112
  return 196
}
function minimumColumnWidth(column: TableColumn) {
  if (column.kind === 'role' || column.kind === 'tacticRole' || (column.kind === 'data' && column.key === 'score')) return 196
  if (column.kind === 'data' && column.key === 'reference') return 160
  if (column.kind === 'data' && column.key === 'name') return 164
  if (column.kind === 'data' && column.key === 'tacticSlot') return 150
  return 64
}
function normalizeStoredColumns(columns: TableColumn[], includeRosterColumn = false) {
  const normalized = columns.map(column => column.kind === 'data' && column.key ? { ...column, label: dataLabels[column.key] } : column)
  if (!includeRosterColumn || normalized.some(column => column.id === 'squad')) return normalized
  const teamIndex = normalized.findIndex(column => column.id === 'team')
  // Migration only enriches layouts that already exposed the old Equipe column.
  // Custom views that intentionally omitted it keep their exact column set.
  if (teamIndex < 0) return normalized
  const insertion = teamIndex + 1
  return [...normalized.slice(0, insertion), dataColumn('squad'), ...normalized.slice(insertion)]
}
function readLayout(): { columns: TableColumn[]; frozenIndex: number; widths: Record<string, number> } {
  if (typeof window === 'undefined') return { columns: defaultColumns, frozenIndex: 2, widths: {} }
  for (const key of [TABLE_LAYOUT_KEY, 'fm-datatracker:squad-table-v3', 'fm-datatracker:squad-table-v2']) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (Array.isArray(saved?.columns) && saved.columns.some((column: TableColumn) => column.id === 'name')) {
        const columns = normalizeStoredColumns(saved.columns as TableColumn[], true)
        const nameIndex = columns.findIndex(column => column.id === 'name')
        return { columns, frozenIndex: Number.isInteger(saved.frozenIndex) ? Math.max(nameIndex, Math.min(columns.length - 1, saved.frozenIndex)) : nameIndex, widths: saved.widths ?? {} }
      }
    } catch { /* use defaults */ }
  }
  return { columns: defaultColumns, frozenIndex: 2, widths: {} }
}
function uniqueColumns(columns: TableColumn[]) { const seen = new Set<string>(); return columns.filter(column => !seen.has(column.id) && Boolean(seen.add(column.id))) }
const defaultPlanning = (): Planning => ({ groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'base', name: 'Base' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: {}, setLayouts: {} })
function normalizePlanning(raw: Planning | undefined): Planning { return raw ? { ...defaultPlanning(), ...raw, groups: raw.groups ?? defaultPlanning().groups, slotAssignments: raw.slotAssignments ?? {}, setLayouts: raw.setLayouts ?? {} } : defaultPlanning() }
function confirmedFieldValue<T>(field: { status: string; value: T | null } | undefined): T | null { return field?.status === 'confirmed' ? field.value : null }
function planningGroupForPlayer(planning: Planning, playerId: string) { return Object.entries(planning.slotAssignments).find(([, sets]) => Object.values(sets).some(ids => ids.includes(playerId)))?.[0] ?? null }
function marketPlanningGroupForPlayer(planning: Planning, playerId: string) { return planning.groups.find(group => isMarketPlanningGroup(group) && Object.values(planning.slotAssignments[group.id] ?? {}).some(ids => ids.includes(playerId))) ?? null }
function rosterMembershipKind(player: RichPlayer, primaryClubId: string | null): CurrentRosterMembershipKind {
  const currentClubId = confirmedFieldValue(player.current_factual.membership?.current.currentClubId)
  const ownerClubId = confirmedFieldValue(player.current_factual.membership?.current.ownerClubId)
  const isLoan = confirmedFieldValue(player.current_factual.membership?.current.isLoan)
  if (!primaryClubId) return null
  if (currentClubId === primaryClubId && isLoan === true && ownerClubId && ownerClubId !== primaryClubId) return 'loaned_in'
  if (ownerClubId === primaryClubId && currentClubId && currentClubId !== primaryClubId && isLoan === true) return 'loaned_out'
  if (currentClubId && currentClubId !== primaryClubId) return 'other_club'
  if (currentClubId === primaryClubId) return 'current'
  return 'unknown'
}
function statusPlayerClass(status: string) { return status === 'Para empréstimo' ? 'is-for-loan' : status === 'Para venda' ? 'is-for-sale' : status === 'Emprestado para fora' ? 'is-loaned-out' : status === 'Emprestado para dentro' ? 'is-loaned-in' : '' }
function clearPlayerTacticalSets(planning: Planning, playerId: string): Planning {
  return { ...planning, slotAssignments: Object.fromEntries(Object.entries(planning.slotAssignments).map(([groupId, sets]) => [groupId, groupId === 'loan' || groupId === 'sale' ? sets : Object.fromEntries(Object.entries(sets).map(([setId, ids]) => [setId, ids.filter(id => id !== playerId)]))])) }
}
function projectionKeyForColumn(column: TableColumn, model: ModelConfig) {
  if (column.kind === 'role' && column.phase && column.position && column.roleCode) return functionProjectionKey([{ phase: column.phase, position: column.position, roleCode: column.roleCode }])
  if (column.kind !== 'tacticRole' || !column.tacticId || !column.linkId) return ''
  const tactic = model.tactics?.find(item => item.id === column.tacticId)
  const ip = tactic?.ipAssignments.find(item => item.playerId === column.linkId)
  const oop = tactic?.oopAssignments.find(item => item.playerId === column.linkId) ?? ip
  return ip && oop ? functionProjectionKey([{ phase: 'IP', position: ip.position, roleCode: ip.roleCode }, { phase: 'OOP', position: oop.position, roleCode: oop.roleCode }]) : ''
}

export function SquadPage() {
  const { selected } = useSaves()
  const navigate = useNavigate()
  const potential = usePotential()
  const [players, setPlayers] = useState<RichPlayer[]>([])
  const [model, setModel] = useState<ModelConfig>({})
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 }>({ key: 'position', direction: 1 })
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [reference, setReference] = useState<ReferenceDataset | null>(null)
  const [referenceCountry, setReferenceCountry] = useState('')
  const [referenceDivision, setReferenceDivision] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<Filter[]>([])
  const [quickFilter, setQuickFilter] = useState<QuickFilterId>('all')
  const initialTable = useMemo(readLayout, [])
  const [positionFilters, setPositionFilters] = useState<string[] | null>(null)
  const [columns, setColumns] = useState<TableColumn[]>(initialTable.columns)
  const [frozenIndex, setFrozenIndex] = useState(initialTable.frozenIndex)
  const [widths, setWidths] = useState<Record<string, number>>(initialTable.widths)
  const [columnMenu, setColumnMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [activeViewId, setActiveViewId] = useState<string | null>('overview')
  const [customViews, setCustomViews] = useState<StoredDataTableView<TableColumn>[]>(() => readStoredDataTableViews<TableColumn>(TABLE_VIEWS_KEY).map(view => ({ ...view, columns: normalizeStoredColumns(view.columns) })))
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const [saveStatus, setSaveStatus] = useState('✓ Salvo')
  const [saveDetail, setSaveDetail] = useState('')
  const [playerMenu, setPlayerMenu] = useState<{ x: number; y: number; playerId: string } | null>(null)

  useEffect(() => { void loadReferenceDataset().then(setReference) }, [])
  useEffect(() => { localStorage.setItem(TABLE_LAYOUT_KEY, JSON.stringify({ columns, frozenIndex, widths })) }, [columns, frozenIndex, widths])
  const referenceCountries = useMemo(() => [...new Set(reference?.markets.map(m => m.country) ?? [])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [reference])
  const referenceDivisions = useMemo(() => reference?.markets.filter(m => m.country === referenceCountry).map(m => m.division).sort((a, b) => a - b) ?? [], [reference, referenceCountry])
  useEffect(() => { if (!referenceCountries.length) return; const matched = referenceCountries.find(country => normalizeCountry(country) === normalizeCountry(selected?.country)); setReferenceCountry(current => referenceCountries.includes(current) ? current : matched ?? referenceCountries[0]) }, [referenceCountries, selected?.country])
  useEffect(() => { if (referenceDivisions.length && !referenceDivisions.includes(referenceDivision)) setReferenceDivision(referenceDivisions[0]) }, [referenceDivisions, referenceDivision])

  useEffect(() => {
    let active = true
    if (!supabase || !selected) { setPlayers([]); setModel({}); return () => { active = false } }
    setLoading(true)
    void Promise.all([loadCurrentPlayers(selected.id), loadModelConfig(selected.id)]).then(([cached, modelConfig]) => {
      if (!active) return
      startTransition(() => { setPlayers(cached as RichPlayer[]); setModel(modelConfig as ModelConfig); setLoading(false); setSaveStatus('✓ Salvo'); setSaveDetail('') })
    }).catch(error => { if (active) { setLoading(false); setSaveStatus('⚠ Não foi possível carregar'); setSaveDetail(describeDbError(error).full) } })
    return () => { active = false }
  }, [selected?.id])

  const primaryClubId = primaryPlanningClubId(selected?.structure?.trackedClubs ?? [])
  const selectedTacticId = primaryClubId ? resolveClubTacticId(model, primaryClubId, primaryClubId, (model.tactics ?? []).map(item => item.id)) : model.selected_tactic_id ?? null
  const activeTactic = model.tactics?.find(item => item.id === selectedTacticId) ?? null
  const sourcePlanning = useMemo(() => normalizePlanning(primaryClubId ? resolveClubPlanning(model, primaryClubId, primaryClubId, defaultPlanning) : model.planning), [model, primaryClubId])
  const factualSquadState = useMemo(() => {
    const byPlayer = new Map<string, string | null>()
    const names: string[] = []
    for (const player of players) {
      const latest = player.player_snapshots[0]
      if (!latest || !player.current_factual.observedAtCheckpoint) continue
      const currentClubId = confirmedFieldValue(player.current_factual.membership?.current.currentClubId)
      const clubName = player.current_factual.currentClubName ?? latest.club ?? null
      const externalClub = isExternalCurrentClub({ currentClubId, primaryClubId, currentClubName: clubName, primaryClubName: selected?.club_name ?? null })
      const factualSquadName = confirmedFieldValue(player.current_factual.membership?.current.squadName)
      const actualSquadName = externalClub ? null : factualSquadName?.trim() || latest.squad?.trim() || null
      byPlayer.set(player.id, actualSquadName)
      if (actualSquadName) names.push(actualSquadName)
    }
    return { names, byPlayer }
  }, [players, primaryClubId, selected?.club_name])
  const factualSquadNames = factualSquadState.names
  const factualSquadByPlayer = factualSquadState.byPlayer
  const activePlanning = useMemo(() => reconcilePlanningSquadGroups(sourcePlanning, factualSquadNames, factualSquadByPlayer), [sourcePlanning, factualSquadState])
  const tacticSlotDescriptors = useMemo<TacticSlotDescriptor[]>(() => activeTactic ? activeTactic.ipAssignments.map(ip => ({ id: ip.playerId, position: ip.position, oopPosition: activeTactic.oopAssignments.find(oop => oop.playerId === ip.playerId)?.position ?? ip.position, nodeId: ip.nodeId, x: PITCH_NODES.find(node => node.id === ip.nodeId)?.x })) : [], [activeTactic])
  const tacticalSetsByGroup = useMemo(() => new Map(activePlanning.groups.filter(group => group.id !== 'loan' && group.id !== 'sale').map(group => [group.id, activeTactic ? layoutsFor(activePlanning, activeTactic.id, group.id, tacticSlotDescriptors) : []])), [activePlanning, activeTactic, tacticSlotDescriptors])
  const tacticAssignmentByPlayer = useMemo(() => {
    const output = new Map<string, { groupId: string; set: PlanningSetLayout; label: string }>()
    for (const [groupId, sets] of tacticalSetsByGroup) for (const set of sets) for (const playerId of activePlanning.slotAssignments[groupId]?.[set.id] ?? []) if (!output.has(playerId)) output.set(playerId, { groupId, set, label: planningSetDisplayLabel(set, sets, tacticSlotDescriptors) })
    return output
  }, [activePlanning.slotAssignments, tacticalSetsByGroup, tacticSlotDescriptors])
  const availableSnapshotColumns = useMemo(() => discoverSnapshotScalarColumns(players.map(player => player.player_snapshots[0])), [players])
  const referenceScores = useMemo(() => generalReferenceScoresByFamily(reference?.players.filter(player => player.c === referenceCountry && player.d === referenceDivision) ?? [], reference?.attributes ?? []), [reference, referenceCountry, referenceDivision])

  useEffect(() => {
    if (!selected || !primaryClubId || activePlanning === sourcePlanning) return
    const patch = patchClubPlanning(model, primaryClubId, primaryClubId, activePlanning)
    setModel(current => ({ ...current, ...patch }))
    scheduleModelConfigPatch(selected.id, '2.9.0', patch, updateSaveStatus)
  }, [selected?.id, primaryClubId, activePlanning, sourcePlanning])

  const allRows = useMemo(() => players.flatMap(player => {
    const latest = player.player_snapshots[0]
    if (!latest || !player.current_factual.observedAtCheckpoint) return []
    const score = generalScoreForSnapshot(latest)?.score ?? null
    const referenceResult = score !== null ? generalReferencePercentile(score, latest, referenceScores) : null
    const referenceGroup = referenceResult?.family ?? 'M'
    const referencePercentile = referenceResult?.percentile ?? null
    const referenceSample = referenceResult?.population.length ?? 0
    const planningGroupId = planningGroupForPlayer(activePlanning, player.id)
    const marketGroup = marketPlanningGroupForPlayer(activePlanning, player.id)
    const currentClubId = confirmedFieldValue(player.current_factual.membership?.current.currentClubId)
    const clubName = player.current_factual.currentClubName ?? latest.club ?? null
    const externalClub = isExternalCurrentClub({ currentClubId, primaryClubId, currentClubName: clubName, primaryClubName: selected?.club_name ?? null })
    const teamLevel = confirmedFieldValue(player.current_factual.membership?.current.teamLevel) as PlanningTeamLevel
    const factualSquadName = confirmedFieldValue(player.current_factual.membership?.current.squadName)
    const factualRosterName = currentRosterLabel({ externalClub, factualSquadName, snapshotSquadName: latest.squad, teamLevel, primaryClubName: selected?.club_name ?? null })
    const membershipKind = rosterMembershipKind(player, primaryClubId)
    const status = currentRosterStatus(externalClub, marketGroup, membershipKind)
    const existingTactic = tacticAssignmentByPlayer.get(player.id)
    const squadGroupId = effectivePlanningSquadGroupId(activePlanning, player.id, factualRosterName, teamLevel)
    const squadName = planningSquadLabel(activePlanning, squadGroupId) ?? factualRosterName
    const targetGroupId = preferredTacticalPlanningGroupId(activePlanning.groups, existingTactic?.groupId ?? squadGroupId ?? null, teamLevel, squadName)
    const targetSets = targetGroupId ? tacticalSetsByGroup.get(targetGroupId) ?? [] : []
    const tacticOptions = targetSets.map(set => ({ id: set.id, label: planningSetDisplayLabel(set, targetSets, tacticSlotDescriptors) }))
    const row: Row = {
      player, latest, score,
      sortScore: effectiveGeneralSortScore({ showPotential: potential.showPotential, snapshot: latest, currentScore: score, loadedGeneralModel: potential.generalCeilingModel, loadedRoleModel: potential.ceilingModel }),
      status, marketValue: extractMarketValue(latest), referencePercentile, referenceLevel: referencePercentile === null ? null : referenceLevel(referencePercentile), referenceSample, referenceGroup,
      columnScores: {}, columnSortScores: {}, tacticSlot: existingTactic?.set.id ?? null, tacticSlotLabel: existingTactic?.label ?? null, tacticGroupId: targetGroupId, tacticOptions, clubName, factualSquadName: factualRosterName, squadName, squadGroupId, squadOptions: activePlanning.groups.filter(group => !isMarketPlanningGroup(group)).map(group => ({ id: group.id, label: group.name })), membershipKind, externalClub,
    }
    for (const column of columns) {
      if (column.kind === 'role') row.columnScores[column.id] = scoreForRole(row, column, model)
      else if (column.kind === 'tacticRole') row.columnScores[column.id] = scoreForTacticRole(row, column, model)
      if (column.kind === 'role' || column.kind === 'tacticRole') row.columnSortScores[column.id] = effectiveRoleSortScore({ showPotential: potential.showPotential, snapshot: latest, currentScore: row.columnScores[column.id] ?? null, scoreKey: projectionKeyForColumn(column, model), loadedModel: potential.ceilingModel })
    }
    return [row]
  }), [players, referenceScores, model, columns, activePlanning, primaryClubId, selected?.club_name, tacticAssignmentByPlayer, tacticalSetsByGroup, tacticSlotDescriptors, potential.showPotential, potential.generalCeilingModel, potential.generalCeilingModel?.manifest.potentialModelVersion, potential.ceilingModel, potential.ceilingModel?.manifest.potentialModelVersion])

  const quickMatches = (row: Row, id: QuickFilterId) => id === 'all' || (id === 'in-tactic' && Boolean(row.tacticSlot)) || (id === 'out-tactic' && !row.tacticSlot) || (id === 'plans' && row.status === 'Nos planos') || (id === 'loan' && row.status === 'Para empréstimo') || (id === 'sale' && row.status === 'Para venda') || (id === 'loaned-out' && row.status === 'Emprestado para fora') || (id === 'loaned-in' && row.status === 'Emprestado para dentro') || (id === 'outside' && row.status === 'Fora do clube') || (id.startsWith('squad:') && row.squadGroupId === id.slice(6))
  const rows = useMemo(() => allRows.filter(row => row.player.current_name.toLowerCase().includes(search.toLowerCase())).filter(row => quickMatches(row, quickFilter)).filter(row => filters.every(filter => matchesFilter(row, filter)) && (positionFilters === null || positionFilters.length > 0 && positionFilters.some(target => canPlayPosition(row.latest?.positions ?? [], target)))).sort((a, b) => compareTableRows(a, b, sort.key, columns) * sort.direction || a.player.current_name.localeCompare(b.player.current_name, 'pt-BR')), [allRows, search, quickFilter, filters, positionFilters, sort, columns])

  const quickFilters = useMemo<DataTableQuickFilter[]>(() => {
    const fixed: Array<[QuickFilterId, string]> = [['all', 'Todos'], ['in-tactic', 'Na tática'], ['out-tactic', 'Sem conjunto'], ['plans', 'Nos planos'], ['loan', 'Para empréstimo'], ['sale', 'Para venda'], ['loaned-out', 'Emprestados fora'], ['loaned-in', 'Emprestados dentro'], ['outside', 'Fora do clube']]
    const squads: Array<[QuickFilterId, string]> = activePlanning.groups.filter(group => !isMarketPlanningGroup(group)).map(group => [`squad:${group.id}`, group.name])
    return [...fixed, ...squads].map(([id, label]) => ({ id, label, count: allRows.filter(row => quickMatches(row, id)).length, active: quickFilter === id, onSelect: () => setQuickFilter(id) }))
  }, [allRows, quickFilter, activePlanning.groups])

  const builtInViews = useMemo<BuiltInView[]>(() => {
    const tacticScoreColumns = activeTactic ? activeTactic.ipAssignments.map(ip => tacticColumn(activeTactic, ip, activeTactic.oopAssignments.find(item => item.playerId === ip.playerId) ?? ip)) : []
    return [
      { id: 'overview', label: 'Visão geral', columns: () => defaultColumns, frozenIndex: 2 },
      { id: 'selection', label: 'Seleção', columns: () => (['tacticSlot', 'name', 'status', 'position', 'age', 'score'] as DataKey[]).map(dataColumn), frozenIndex: 1 },
      { id: 'contract', label: 'Contrato', columns: () => (['name', 'team', 'squad', 'age', 'value', 'contract', 'nationality'] as DataKey[]).map(dataColumn), frozenIndex: 0 },
      { id: 'development', label: 'Desenvolvimento', columns: () => (['name', 'age', 'position', 'score', 'reference'] as DataKey[]).map(dataColumn), frozenIndex: 0 },
      { id: 'attributes', label: 'Atributos', columns: () => [dataColumn('name'), ...ATTRIBUTE_CATALOG.map(attribute => attributeColumn(attribute.key, attribute.label))], frozenIndex: 0 },
      { id: 'tactic', label: 'Tática atual', columns: () => uniqueColumns([dataColumn('tacticSlot'), dataColumn('name'), dataColumn('position'), dataColumn('score'), ...tacticScoreColumns]), frozenIndex: 1 },
    ]
  }, [activeTactic])
  const applyView = (viewColumns: TableColumn[], boundary: number, viewId: string) => { setColumns(uniqueColumns(viewColumns.map(column => ({ ...column })))); setFrozenIndex(boundary); setWidths({}); setActiveViewId(viewId) }
  const viewOptions = useMemo<DataTableViewOption[]>(() => [...builtInViews.map(view => ({ id: view.id, label: view.label, active: activeViewId === view.id, onSelect: () => applyView(view.columns(), view.frozenIndex ?? Math.max(0, view.columns().findIndex(column => column.id === 'name')), view.id) })), ...customViews.map(view => ({ id: view.id, label: view.name, custom: true, active: activeViewId === view.id, onSelect: () => { setColumns(normalizeStoredColumns(view.columns).map(column => ({ ...column }))); setFrozenIndex(view.frozenIndex); setWidths({ ...view.widths }); setActiveViewId(view.id) }, onDelete: () => { const next = customViews.filter(item => item.id !== view.id); setCustomViews(next); writeStoredDataTableViews(TABLE_VIEWS_KEY, next); if (activeViewId === view.id) setActiveViewId(null) } }))], [builtInViews, customViews, activeViewId])

  function markCustomized() { setActiveViewId(null) }
  function changeSort(key: string) { setSort(current => ({ key, direction: current.key === key ? current.direction === 1 ? -1 : 1 : key === 'score' || key === 'value' || key === 'reference' || key.startsWith('role|') || key.startsWith('tactic|') ? -1 : 1 })) }
  function setColumnWidth(column: TableColumn, width: number) { markCustomized(); setWidths(current => ({ ...current, [column.id]: width })) }
  function moveColumn(from: number, to: number) { if (from === to) return; markCustomized(); setColumns(current => { const next = [...current]; const item = next.splice(from, 1)[0]; next.splice(to, 0, item); setFrozenIndex(boundary => boundary < 0 ? -1 : Math.max(next.findIndex(column => column.id === 'name'), Math.min(next.length - 1, boundary))); return next }) }
  function removeColumn(index: number) { if (columns[index]?.id === 'name') return; markCustomized(); const next = columns.filter((_, itemIndex) => itemIndex !== index); setColumns(next); setFrozenIndex(boundary => boundary < 0 ? -1 : Math.min(next.length - 1, Math.max(next.findIndex(column => column.id === 'name'), index <= boundary ? boundary - 1 : boundary))); setColumnMenu(null) }
  function insertColumn(column: TableColumn, replace = false) { if (!columnMenu) return; markCustomized(); const index = columnMenu.index; setColumns(current => replace ? current.map((item, itemIndex) => itemIndex === index ? { ...column } : item) : [...current.slice(0, index + 1), { ...column }, ...current.slice(index + 1)]); setColumnMenu(null) }
  function autoSizeColumn(index: number) { const column = columns[index]; if (!column) return; const cellLength = Math.max(column.label.length, ...rows.slice(0, 120).map(row => String(cellPlainValue(row, column) ?? '').length)); setColumnWidth(column, Math.min(420, Math.max(minimumColumnWidth(column), Math.round(cellLength * 7.2 + 36)))) }
  function autoSizeAll() { markCustomized(); const next: Record<string, number> = {}; columns.forEach((column, index) => { const cellLength = Math.max(column.label.length, ...rows.slice(0, 120).map(row => String(cellPlainValue(row, column) ?? '').length)); next[column.id] = Math.min(420, Math.max(minimumColumnWidth(column), Math.round(cellLength * 7.2 + 36))) }); setWidths(next) }

  function updateSaveStatus(next: string, detail?: string) { setSaveStatus(next); setSaveDetail(detail ?? '') }
  function assignTacticSet(playerId: string, groupId: string | null, setId: string | null) {
    if (!selected || !activeTactic || !primaryClubId) return
    let nextPlanning = setId && groupId ? movePlayerToSet(activePlanning, groupId, setId, playerId) as Planning : clearPlayerTacticalSets(activePlanning, playerId)
    let planningByClub = { ...(model.planning_by_club ?? {}), [primaryClubId]: nextPlanning }
    if (setId) planningByClub = movePlayerAcrossClubPlans(planningByClub, primaryClubId, playerId, nextPlanning)
    nextPlanning = planningByClub[primaryClubId]
    const patch = patchClubPlanning({ ...model, planning_by_club: planningByClub }, primaryClubId, primaryClubId, nextPlanning)
    setModel(current => ({ ...current, ...patch }))
    scheduleModelConfigPatch(selected.id, '2.9.0', patch, updateSaveStatus)
  }
  function persistPlayerPlanning(playerId: string, nextPlanning: Planning) {
    if (!selected || !primaryClubId) return
    const planningByClub = movePlayerAcrossClubPlans({ ...(model.planning_by_club ?? {}), [primaryClubId]: nextPlanning }, primaryClubId, playerId, nextPlanning)
    const resolved = planningByClub[primaryClubId]
    const patch = patchClubPlanning({ ...model, planning_by_club: planningByClub }, primaryClubId, primaryClubId, resolved)
    setModel(current => ({ ...current, ...patch }))
    scheduleModelConfigPatch(selected.id, '2.9.0', patch, updateSaveStatus)
  }
  function assignPlanningSquad(playerId: string, groupId: string) { persistPlayerPlanning(playerId, movePlayerToPlanningSquad(activePlanning, playerId, groupId) as Planning) }
  function markPlayerForMarket(playerId: string, groupId: 'loan' | 'sale') {
    const currentSquad = allRows.find(row => row.player.id === playerId)?.squadGroupId
    let next = movePlayerToSet(activePlanning, groupId, 'market', playerId) as Planning
    if (currentSquad) next = movePlayerToPlanningSquad(next, playerId, currentSquad) as Planning
    persistPlayerPlanning(playerId, next)
  }
  async function retrySave() {
    if (!selected) return
    try {
      const result = await retryModelConfigPatch(selected.id, updateSaveStatus)
      if (!result) scheduleModelConfigPatch(selected.id, '2.9.0', { planning: model.planning ?? defaultPlanning(), planning_by_club: model.planning_by_club ?? {} }, updateSaveStatus)
    } catch (error) { updateSaveStatus('⚠ Não foi possível salvar', describeDbError(error).full) }
  }

  const catalog = useMemo(() => buildColumnCatalog(model.tactics ?? [], availableSnapshotColumns.map(snapshotColumn)), [model.tactics, availableSnapshotColumns])
  const menuItems = columnMenu ? buildColumnMenuItems(columns, columnMenu.index, catalog, column => insertColumn(column), column => insertColumn(column, true), () => removeColumn(columnMenu.index), () => autoSizeColumn(columnMenu.index), autoSizeAll, () => { markCustomized(); setFrozenIndex(columnMenu.index); setColumnMenu(null) }, () => { markCustomized(); setFrozenIndex(-1); setColumnMenu(null) }) : []

  function saveCustomView() {
    const name = saveViewName.trim(); if (!name) return
    const view: StoredDataTableView<TableColumn> = { id: `custom-${crypto.randomUUID()}`, name, columns: columns.map(column => ({ ...column })), frozenIndex, widths: { ...widths } }
    const next = [...customViews, view]; setCustomViews(next); writeStoredDataTableViews(TABLE_VIEWS_KEY, next); setActiveViewId(view.id); setSaveViewOpen(false); setSaveViewName('')
  }

  return <div className="screen-page squad-page">
    <SaveState status={saveStatus} detail={saveDetail} onRetry={saveStatus.startsWith('⚠') ? () => void retrySave() : undefined} />
    <div className="title-row"><div><h1>{selected?.club_name}</h1>{(loading || isPending) && <span className="background-loading" role="status">Atualizando elenco em segundo plano…</span>}</div><div className="squad-actions"><label>Referência<CustomSelect ariaLabel="País de referência" value={referenceCountry} options={referenceCountries.map(country => ({ value: country, label: country }))} onChange={setReferenceCountry} /></label><label>Divisão<CustomSelect ariaLabel="Divisão de referência" value={String(referenceDivision)} options={referenceDivisions.map(division => ({ value: String(division), label: `${division}ª divisão` }))} onChange={value => setReferenceDivision(Number(value))} /></label><input className="search" placeholder="Buscar jogador" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
    <DataTableChrome views={viewOptions} quickFilters={quickFilters} onCreateView={() => setSaveViewOpen(true)}>
      <PositionSelector selected={positionFilters} onChange={setPositionFilters} />
      <button className={`filter-toggle ${filters.length ? 'active' : ''}`} onClick={() => setFilterOpen(true)}>Filtros {filters.length ? `(${filters.length})` : ''}</button>
    </DataTableChrome>
    <DataTable<Row, TableColumn>
      className="squad-table customizable-squad-table"
      rows={rows}
      columns={columns}
      rowKey={row => row.player.id}
      renderCell={(row, column) => <SquadCellContent column={column} row={row} model={model} hasActiveTactic={Boolean(activeTactic)} assignTacticSet={assignTacticSet} assignPlanningSquad={assignPlanningSquad} openPlayer={() => navigate(`/players/${row.player.id}`)} />}
      getColumnWidth={column => widths[column.id] ?? defaultWidth(column)}
      getColumnMinWidth={column => minimumColumnWidth(column)}
      getColumnMaxWidth={() => 640}
      sort={sort}
      onSort={changeSort}
      selectedRowKey={selectedPlayerId}
      onSelectRow={row => setSelectedPlayerId(current => current === row.player.id ? null : row.player.id)}
      capabilities={DATA_TABLE_PRESETS.squad}
      frozenIndex={frozenIndex}
      loading={!players.length && (loading || isPending)}
      loadingMessage="Carregando jogadores…"
      emptyMessage={players.length ? 'Nenhum jogador corresponde aos filtros atuais.' : 'Nenhum jogador disponível.'}
      getCellClassName={(row, column) => `${column.kind === 'role' || column.kind === 'tacticRole' || column.key === 'score' ? 'role-score-cell' : column.kind === 'attribute' ? 'attribute-table-cell' : column.key === 'name' ? 'frozen-player-name' : column.key === 'tacticSlot' ? 'tactic-slot-table-cell' : ''}`.trim() || undefined}
      onHeaderContextMenu={(event, _, index) => { event.preventDefault(); setColumnMenu({ x: event.clientX, y: event.clientY, index }) }}
      onRowContextMenu={(event, row) => { event.preventDefault(); event.stopPropagation(); setPlayerMenu({ x: event.clientX, y: event.clientY, playerId: row.player.id }) }}
      onColumnWidthChange={(column, width) => setColumnWidth(column, width)}
      onColumnMove={moveColumn}
    />
    {columnMenu && <DataTableColumnMenu x={columnMenu.x} y={columnMenu.y} title={columns[columnMenu.index]?.label} items={menuItems} onClose={() => setColumnMenu(null)} />}
    {playerMenu && (() => { const row = allRows.find(item => item.player.id === playerMenu.playerId); return <RosterPlayerContextMenu x={playerMenu.x} y={playerMenu.y} squads={activePlanning.groups.filter(group => !isMarketPlanningGroup(group))} activeSquadId={row?.squadGroupId} onMoveSquad={groupId => { assignPlanningSquad(playerMenu.playerId, groupId); setPlayerMenu(null) }} onLoan={() => { markPlayerForMarket(playerMenu.playerId, 'loan'); setPlayerMenu(null) }} onSale={() => { markPlayerForMarket(playerMenu.playerId, 'sale'); setPlayerMenu(null) }} onClose={() => setPlayerMenu(null)} /> })()}
    <TableViewSaveDialog open={saveViewOpen} value={saveViewName} onChange={setSaveViewName} onCancel={() => { setSaveViewOpen(false); setSaveViewName('') }} onSave={saveCustomView} />
    {filterOpen && <div className="settings-overlay" onClick={() => setFilterOpen(false)}><section className="filter-modal" onClick={event => event.stopPropagation()}><header><div><span className="eyebrow">ELENCO</span><h2>Filtros</h2></div><button className="close" onClick={() => setFilterOpen(false)}>×</button></header><div className="filter-list">{filters.map(filter => <div className="filter-row" key={filter.id}><CustomSelect value={filter.column} ariaLabel="Campo do filtro" options={filterColumns.map(([value, label]) => ({ value, label }))} onChange={value => setFilters(current => current.map(item => item.id === filter.id ? { ...item, column: value as Filter['column'] } : item))} /><CustomSelect value={filter.operator} ariaLabel="Operador do filtro" options={[{ value: 'contains', label: 'contém' }, { value: 'equals', label: 'é igual a' }, { value: 'gte', label: 'maior ou igual' }, { value: 'lte', label: 'menor ou igual' }]} onChange={value => setFilters(current => current.map(item => item.id === filter.id ? { ...item, operator: value as Filter['operator'] } : item))} /><input value={filter.value} onChange={event => setFilters(current => current.map(item => item.id === filter.id ? { ...item, value: event.target.value } : item))} /><button className="column-delete" onClick={() => setFilters(current => current.filter(item => item.id !== filter.id))}>×</button></div>)}</div><footer><button className="ghost" onClick={() => setFilters([])}>Limpar</button><button onClick={() => setFilters(current => [...current, { id: crypto.randomUUID(), column: 'name', operator: 'contains', value: '' }])}>+ Adicionar filtro</button><button onClick={() => setFilterOpen(false)}>Aplicar</button></footer></section></div>}
  </div>
}

function SquadCellContent({ column, row, model, hasActiveTactic, assignTacticSet, assignPlanningSquad, openPlayer }: { column: TableColumn; row: Row; model: ModelConfig; hasActiveTactic: boolean; assignTacticSet: (playerId: string, groupId: string | null, setId: string | null) => void; assignPlanningSquad: (playerId: string, groupId: string) => void; openPlayer: () => void }) {
  if (column.kind === 'tacticRole' || column.kind === 'role') {
    const score = row.columnScores[column.id] ?? null
    return <ScoreWithProjection playerId={row.player.id} currentScore={score} snapshot={row.latest} scoreType="function" scoreKey={projectionKeyForColumn(column, model)} variant="inline" currentTitle="Nota atual nesta função" projectionTitle="Melhor RoleScore plausível nesta função em um cenário positivo de desenvolvimento." />
  }
  if (column.kind === 'attribute') { const attribute = row.latest.player_attributes.find(item => item.attribute_key === column.attributeKey); return <b>{attribute?.value ?? '—'}</b> }
  if (column.kind === 'snapshot') return <>{formatScalar(snapshotScalarValue(row.latest, { source: column.snapshotSource!, fieldKey: column.snapshotFieldKey! }))}</>
  const key = column.key!
  if (key === 'tacticSlot') {
    if (!hasActiveTactic) return <span className="dt-table-muted">Sem tática</span>
    return <select className="squad-tactic-slot-select" aria-label={`Conjunto tático de ${row.player.current_name}`} value={row.tacticSlot ?? ''} onClick={event => event.stopPropagation()} onChange={event => { event.stopPropagation(); assignTacticSet(row.player.id, row.tacticGroupId, event.target.value || null) }}><option value="">Sem conjunto</option>{row.tacticOptions.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
  }
  if (key === 'status') return <div className="squad-status-cell"><PlanningStatusBadge status={row.status} /></div>
  if (key === 'name') return <div className="squad-player-name-cell"><PlayerPeek player={row.player} snapshot={row.latest} /><button className={`player-name ${statusPlayerClass(row.status)}`} onClick={event => { event.stopPropagation(); openPlayer() }}>{row.player.current_name}</button></div>
  if (key === 'age') return <>{row.latest.age ?? '—'}</>
  if (key === 'nationality') { const flag = countryFlagEmoji(row.player.nationality); return <span className="dt-country-with-flag">{flag && <span aria-hidden="true">{flag}</span>}<span>{row.player.nationality || '—'}</span></span> }
  if (key === 'value') return <>{row.marketValue || '—'}</>
  if (key === 'team') return <span className={`squad-current-club ${row.externalClub ? 'is-external' : ''}`}>{row.clubName || '—'}</span>
  if (key === 'squad') return <select className="squad-tactic-slot-select squad-roster-select" aria-label={`Elenco de ${row.player.current_name}`} value={row.squadGroupId ?? ''} onClick={event => event.stopPropagation()} onChange={event => { event.stopPropagation(); if (event.target.value) assignPlanningSquad(row.player.id, event.target.value) }}><option value="" disabled>{row.squadName || 'Sem elenco'}</option>{row.squadOptions.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
  if (key === 'position') return <>{row.latest.positions?.join(', ') || '—'}</>
  if (key === 'height') return <>{row.latest.height ? `${row.latest.height} cm` : '—'}</>
  if (key === 'weight') return <>{row.latest.weight ? `${row.latest.weight} kg` : '—'}</>
  if (key === 'foot') return <>{row.latest.preferred_foot || '—'}</>
  if (key === 'contract') return <>{row.latest.contract_expiry || '—'}</>
  if (key === 'snapshot') return <>{row.latest.snapshot_date || '—'}</>
  if (key === 'score') return <ScoreWithProjection playerId={row.player.id} currentScore={row.score} currentRank={row.referencePercentile} snapshot={row.latest} scoreType="general" variant="inline" currentTitle="Nota atual" />
  return <>{row.referencePercentile === null ? '—' : <span className={`reference-level level-${row.referenceLevel?.toLowerCase().replaceAll(' ', '-')}`}><b>P{row.referencePercentile}</b> {row.referenceLevel} · {row.referenceGroup}</span>}</>
}

function buildColumnCatalog(tactics: Tactic[], snapshotColumns: TableColumn[]) {
  const dataColumns = allDataKeys.map(dataColumn)
  const attributeColumns = ATTRIBUTE_CATALOG.map(attribute => attributeColumn(attribute.key, attribute.label))
  const tacticScoreColumns = tactics.flatMap(tactic => tactic.ipAssignments.map(ip => tacticColumn(tactic, ip, tactic.oopAssignments.find(item => item.playerId === ip.playerId) ?? ip)))
  return { dataColumns, attributeColumns, tacticScoreColumns, snapshotColumns }
}
function menuLeaf(column: TableColumn, action: (column: TableColumn) => void): DataTableColumnMenuItem { return { id: column.id, label: column.label, onSelect: () => action(column) } }
function buildInsertBranches(columns: TableColumn[], catalog: ReturnType<typeof buildColumnCatalog>, action: (column: TableColumn) => void) {
  const missing = (column: TableColumn) => !columns.some(current => current.id === column.id)
  const attrs = (category: AttributeCategory) => catalog.attributeColumns.filter(column => ATTRIBUTE_CATALOG.find(attribute => attribute.key === column.attributeKey)?.category === category).filter(missing).map(column => menuLeaf(column, action))
  const snapshotGroup = (category: SnapshotFieldCategory, label: string): DataTableColumnMenuItem | null => { const children = catalog.snapshotColumns.filter(column => column.snapshotCategory === category).filter(missing).map(column => menuLeaf(column, action)); return children.length ? { id: `snapshot-${category}`, label, children } : null }
  const general = catalog.dataColumns.filter(missing).map(column => menuLeaf(column, action))
  const roleBranches = (['IP', 'OOP'] as TacticPhase[]).map(phase => ({ id: `roles-${phase}`, label: phase, children: positions.map(([position, label]) => ({ id: `${phase}-${position}`, label: `${position} · ${label}`, children: rolesFor(position, phase).map(([code, name]) => menuLeaf(roleColumn(phase, position, code), action)) })) }))
  const tacticBranches = catalog.tacticScoreColumns.filter(missing).map(column => menuLeaf(column, action))
  return [
    { id: 'general', label: 'Geral', children: general },
    { id: 'attributes', label: 'Atributos', children: [
      { id: 'attr-goalkeeping', label: 'Goleiro', children: attrs('goalkeeping') },
      { id: 'attr-mental', label: 'Mental', children: attrs('mental') },
      { id: 'attr-physical', label: 'Físico', children: attrs('physical') },
      { id: 'attr-technical', label: 'Técnico', children: attrs('technical') },
    ].filter(item => item.children.length) },
    { id: 'ability', label: 'Habilidade e funções', children: [{ id: 'tactic-scores', label: 'Táticas', children: tacticBranches }, ...roleBranches].filter(item => item.children?.length) },
    { id: 'save-data', label: 'Dados do save', children: [
      snapshotGroup('club', 'Clube e elenco'), snapshotGroup('contract', 'Contrato'), snapshotGroup('transfer', 'Transferência'), snapshotGroup('international', 'Internacional'), snapshotGroup('training', 'Treino e desenvolvimento'), snapshotGroup('fitness', 'Condição e lesões'), snapshotGroup('stats', 'Estatísticas'), snapshotGroup('general', 'Outros dados'),
    ].filter((item): item is DataTableColumnMenuItem => Boolean(item)) },
  ].filter(branch => branch.children?.length) as DataTableColumnMenuItem[]
}
function buildColumnMenuItems(columns: TableColumn[], index: number, catalog: ReturnType<typeof buildColumnCatalog>, insert: (column: TableColumn) => void, replace: (column: TableColumn) => void, remove: () => void, autoSize: () => void, autoSizeAll: () => void, freeze: () => void, unfreeze: () => void): DataTableColumnMenuItem[] {
  const insertBranches = buildInsertBranches(columns, catalog, insert)
  const replaceBranches = buildInsertBranches(columns.filter((_, currentIndex) => currentIndex !== index), catalog, replace)
  return [
    { id: 'insert', label: 'Inserir coluna', children: insertBranches },
    { id: 'replace', label: 'Substituir esta coluna', children: replaceBranches },
    { id: 'remove', label: 'Remover esta coluna', disabled: columns[index]?.id === 'name', onSelect: remove },
    { id: 'auto', label: 'Ajustar largura desta coluna', separatorBefore: true, onSelect: autoSize },
    { id: 'auto-all', label: 'Ajustar largura de todas', onSelect: autoSizeAll },
    { id: 'freeze', label: 'Congelar até esta coluna', separatorBefore: true, onSelect: freeze },
    { id: 'unfreeze', label: 'Remover congelamento', onSelect: unfreeze },
  ]
}

export function extractMarketValue(snapshot: Snapshot) { const normalized = snapshot.normalized_data ?? {}; for (const key of ['value', 'transfer_value', 'market_value', 'valor']) if (normalized[key] != null && String(normalized[key]).trim()) return String(normalized[key]); for (const [key, value] of Object.entries(snapshot.raw_data ?? {})) { const normalizedKey = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_'); if (['value', 'transfer_value', 'market_value', 'valor'].includes(normalizedKey) && String(value).trim()) return String(value) } return null }
function numericMarketValue(raw: string | null) { if (!raw) return -1; const first = raw.split(/\s*[-–]\s*/)[0], match = first.replace(/\s/g, '').match(/([\d.,]+)\s*([KMB])?/i); if (!match) return -1; const number = Number(match[1].replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')); return number * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B'] ?? 1) }
function rowValue(row: Row, key: Exclude<DataKey, 'tacticSlot'>) { if (key === 'status') return row.status; if (key === 'name') return row.player.current_name; if (key === 'nationality') return row.player.nationality; if (key === 'team') return row.clubName; if (key === 'squad') return row.squadName; if (key === 'position') return row.latest?.positions?.join(', '); if (key === 'age') return row.latest?.age; if (key === 'height') return row.latest?.height; if (key === 'weight') return row.latest?.weight; if (key === 'foot') return row.latest?.preferred_foot; if (key === 'contract') return row.latest?.contract_expiry; if (key === 'snapshot') return row.latest?.snapshot_date; if (key === 'score') return row.score; if (key === 'reference') return row.referencePercentile; return row.marketValue }
function cellPlainValue(row: Row, column: TableColumn) { if (column.kind === 'attribute') return row.latest?.player_attributes.find(item => item.attribute_key === column.attributeKey)?.value; if (column.kind === 'snapshot') return snapshotScalarValue(row.latest, { source: column.snapshotSource!, fieldKey: column.snapshotFieldKey! }); if (column.kind === 'role' || column.kind === 'tacticRole') return row.columnSortScores[column.id] ?? row.columnScores[column.id]; if (column.key === 'tacticSlot') return row.tacticSlotLabel ?? ''; return rowValue(row, column.key as Exclude<DataKey, 'tacticSlot'>) }
function compareRows(a: Row, b: Row, key: DataKey) { if (key === 'tacticSlot') return String(a.tacticSlotLabel ?? '').localeCompare(String(b.tacticSlotLabel ?? ''), 'pt-BR'); if (key === 'position') { const ap = a.latest?.positions ?? [], bp = b.latest?.positions ?? []; return positionRank(ap) - positionRank(bp) || positionSideRank(ap) - positionSideRank(bp) } if (key === 'score') return (a.sortScore ?? -1) - (b.sortScore ?? -1); if (key === 'reference') return (a.referencePercentile ?? -1) - (b.referencePercentile ?? -1); if (key === 'value') return numericMarketValue(a.marketValue) - numericMarketValue(b.marketValue); if (key === 'age' || key === 'height' || key === 'weight') return Number(rowValue(a, key) ?? 999) - Number(rowValue(b, key) ?? 999); return String(rowValue(a, key as Exclude<DataKey, 'tacticSlot'>) ?? '').localeCompare(String(rowValue(b, key as Exclude<DataKey, 'tacticSlot'>) ?? ''), 'pt-BR') }
function compareTableRows(a: Row, b: Row, key: string, columns: TableColumn[]) { const column = columns.find(item => item.id === key); if (!column) return 0; if (column.kind === 'tacticRole' || column.kind === 'role') return (a.columnSortScores[column.id] ?? a.columnScores[column.id] ?? -1) - (b.columnSortScores[column.id] ?? b.columnScores[column.id] ?? -1); if (column.kind === 'attribute') { const value = (row: Row) => row.latest?.player_attributes.find(item => item.attribute_key === column.attributeKey)?.value ?? -1; return value(a) - value(b) } if (column.kind === 'snapshot') return String(snapshotScalarValue(a.latest, { source: column.snapshotSource!, fieldKey: column.snapshotFieldKey! }) ?? '').localeCompare(String(snapshotScalarValue(b.latest, { source: column.snapshotSource!, fieldKey: column.snapshotFieldKey! }) ?? ''), 'pt-BR', { numeric: true }); return compareRows(a, b, column.key!) }
function scoreForRole(row: Row, column: TableColumn, model: ModelConfig) { if (!row.latest || !column.phase || !column.position || !column.roleCode) return null; const roleName = rolesFor(column.position, column.phase).find(([code]) => code === column.roleCode)?.[1] ?? column.roleCode, id = `${column.phase}-${positionGroup(column.position)}-${column.roleCode}`, weights = resolveRoleWeights({ roleId: id, roleName, overrideWeights: model.role_weight_overrides?.[id] }); return roleScore(row.latest.player_attributes, weights) }
function scoreForTacticRole(row: Row, column: TableColumn, model: ModelConfig) { if (!row.latest || !column.tacticId || !column.linkId) return null; const tactic = model.tactics?.find(item => item.id === column.tacticId), ip = tactic?.ipAssignments.find(item => item.playerId === column.linkId), oop = tactic?.oopAssignments.find(item => item.playerId === column.linkId) ?? ip; if (!tactic || !ip || !oop) return null; const weights = (assignment: Assignment, phase: 'IP' | 'OOP') => { const id = assignment.roleId ?? `${phase}-${positionGroup(assignment.position)}-${assignment.roleCode}`; return resolveRoleWeights({ roleId: id, roleName: assignment.roleName, overrideWeights: model.role_weight_overrides?.[id] ?? tactic.roles?.find(role => role.id === id)?.weights }) }; return pairedRoleScore(row.latest.player_attributes, weights(ip, 'IP'), weights(oop, 'OOP')) }
const filterColumns: Array<[Filter['column'], string]> = [['status', 'Status'], ['name', 'Nome'], ['age', 'Idade'], ['nationality', 'Nacionalidade'], ['value', 'Valor'], ['team', 'Clube'], ['squad', 'Elenco'], ['position', 'Posições'], ['score', 'Nota'], ['reference', 'Percentil']]
function filterValue(row: Row, column: Filter['column']) { return rowValue(row, column) }
function matchesFilter(row: Row, filter: Filter) { if (!filter.value.trim()) return true; const value = filterValue(row, filter.column); if (filter.operator === 'contains') return String(value ?? '').toLocaleLowerCase('pt-BR').includes(filter.value.toLocaleLowerCase('pt-BR')); if (filter.operator === 'equals') return String(value ?? '').toLocaleLowerCase('pt-BR') === filter.value.toLocaleLowerCase('pt-BR'); const left = Number(value), right = Number(filter.value); if (!Number.isFinite(left) || !Number.isFinite(right)) return false; return filter.operator === 'gte' ? left >= right : left <= right }
function formatScalar(value: unknown) { if (value === null || value === undefined || value === '') return '—'; if (typeof value === 'boolean') return value ? 'Sim' : 'Não'; return String(value) }
