import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type DragEvent, type MouseEvent, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BASE_POSITION_DEFINITIONS, basePositionScores } from '../lib/base-position-score'
import { canonicalRoleDefaultWeights, pairedRoleScore, resolveRoleWeights, roleScore } from '../lib/role-scoring'
import { ScoreWithProjection } from '../components/ScoreWithProjection'
import { functionProjectionKey } from '../lib/projection-player'
import { ScoreBadge } from '../components/ScoreBadge'
import { canPlayPosition } from '../lib/positions'
import { SaveState } from '../components/SaveState'
import { usesLegacyRoleDefaults } from '../lib/roleWeights'
import { PITCH_NODES, positionGroup, rolesFor, type TacticPhase } from '../lib/tactics'
import { useSaves } from '../features/saves/SaveContext'
import { loadModelConfig, patchModelConfig, retryModelConfigPatch, scheduleModelConfigPatch } from '../lib/model-config'
import { describeDbError } from '../lib/db-error'
import { loadCurrentPlayers } from '../lib/dataCache'
import { createLatestSaveRequestGuard } from '../lib/latest-save-request'
import { DataTable, type DataTableColumnLike } from '../components/data-table/DataTable'
import { CustomSelect } from '../components/CustomSelect'
import { PlayerPeek } from '../components/PlayerPeek'
import { PlanningStatusBadge } from '../components/PlanningStatusBadge'
import { PositionSelector, canonicalPosition } from '../components/PositionSelector'
import { ATTRIBUTE_CATALOG, type AttributeCategory } from '../lib/attributes'
import type { PlayerRow } from '../types/domain'
import { DATA_TABLE_PRESETS } from '../components/data-table/presets'

type Role = { id: string; name: string; weights: Record<string, number> }
type Assignment = { playerId: string; nodeId: string; position: string; roleId: string; roleCode: string; roleName: string }
type Tactic = { id: string; name: string; roles: Role[]; assignments?: Assignment[]; ipAssignments: Assignment[]; oopAssignments: Assignment[]; lineup: Record<string, string | null> }
type Planning = { groups: Array<{ id: string; name: string }>; assignments?: Record<string, string>; slotAssignments?: Record<string, Record<string, string[]>> }
type Config = { role_weight_overrides: Record<string, Record<string, number>>; tactics: Tactic[]; selected_tactic_id: string | null; selected_role_id: string | null; planning?: Planning }
type Snapshot = PlayerRow['player_snapshots'][number]
type Candidate = { id: string; name: string; positions: string[]; age: number | null; attributes: Array<{ key: string; value: number }>; player: PlayerRow; latest: Snapshot | undefined }
type PlayerDataKey = 'status' | 'name' | 'age' | 'nationality' | 'team' | 'position' | 'height' | 'weight' | 'foot' | 'contract' | 'snapshot' | 'relativeScore'
type PlayerSortKey = string
type RolePicker = { phase: TacticPhase; playerId: string; position: string; roleCode: string; top: number; left: number; width: number }
type PlayerTableColumn = DataTableColumnLike & { id: string; kind: 'data' | 'attribute' | 'role' | 'tacticRole'; key?: PlayerDataKey; attributeKey?: string; phase?: TacticPhase; position?: string; roleCode?: string; tacticId?: string; linkId?: string }
type PlayerTableRow = { candidate: Candidate; relativeScore: number | null; status: string; columnScores: Record<string, number | null> }
type PlayerTableLayout = { columns: PlayerTableColumn[]; frozenIndex: number; widths: Record<string, number> }
type PickerSortKey = 'status' | 'name' | 'positions' | 'age' | 'positionScore'
type PickerRow = { candidate: Candidate; positionScore: number | null; status: string; assignedSlot: string | null; eligible: boolean }
type PickerColumn = DataTableColumnLike & { id: PickerSortKey }

const FORMATIONS: Record<string, string[]> = {
  '4-3-3': ['gk', 'dl', 'dcl', 'dcr', 'dr', 'dmc', 'mcl', 'mcr', 'aml', 'amr', 'stc'],
  '4-2-3-1': ['gk', 'dl', 'dcl', 'dcr', 'dr', 'dml', 'dmr', 'aml', 'amc', 'amr', 'stc'],
  '4-4-2': ['gk', 'dl', 'dcl', 'dcr', 'dr', 'ml', 'mcl', 'mcr', 'mr', 'stl', 'str'],
  '3-4-3': ['gk', 'dcl', 'dc', 'dcr', 'wbl', 'mcl', 'mcr', 'wbr', 'aml', 'amr', 'stc'],
  '3-5-2': ['gk', 'dcl', 'dc', 'dcr', 'wbl', 'mcl', 'mc', 'mcr', 'wbr', 'stl', 'str'],
}
const DEFAULT_NODE_IDS = FORMATIONS['4-3-3']
const fresh = (): Config => ({ role_weight_overrides: {}, tactics: [], selected_tactic_id: null, selected_role_id: null })

const TACTICS_TABLE_STORAGE_KEY = 'fm-datatracker:tactics-player-table-v2'
const PLAYER_DATA_LABELS: Record<PlayerDataKey, string> = {
  status: 'Status',
  name: 'Nome',
  age: 'Idade',
  nationality: 'Nacionalidade',
  team: 'Equipe',
  position: 'Posições',
  height: 'Altura',
  weight: 'Peso',
  foot: 'Pé preferido',
  contract: 'Fim do contrato',
  snapshot: 'Data do snapshot',
  relativeScore: 'Nota relativa',
}
const PLAYER_DATA_WIDTHS: Record<PlayerDataKey, number> = {
  status: 56, name: 210, age: 72, nationality: 140, team: 150, position: 180, height: 90, weight: 85, foot: 125, contract: 125, snapshot: 125, relativeScore: 112,
}
const GENERAL_PLAYER_COLUMNS: PlayerTableColumn[] = (Object.keys(PLAYER_DATA_LABELS) as PlayerDataKey[]).map(key => ({ id: key, kind: 'data', key, label: PLAYER_DATA_LABELS[key] }))
const DEFAULT_PLAYER_COLUMNS: PlayerTableColumn[] = (['status', 'name', 'position', 'age', 'relativeScore'] as PlayerDataKey[]).map(key => ({ id: key, kind: 'data', key, label: PLAYER_DATA_LABELS[key] }))
const PLAYER_POSITIONS = [['GK', 'Goleiro'], ['D (L)', 'Defesa esquerda'], ['D (C)', 'Defesa central'], ['D (R)', 'Defesa direita'], ['WB (L)', 'Ala esquerdo'], ['WB (R)', 'Ala direito'], ['DM (C)', 'Médio defensivo'], ['M (L)', 'Médio esquerdo'], ['M (C)', 'Médio central'], ['M (R)', 'Médio direito'], ['AM (L)', 'Extremo esquerdo'], ['AM (C)', 'Médio ofensivo'], ['AM (R)', 'Extremo direito'], ['ST (C)', 'Atacante']] as const
const PICKER_COLUMNS: PickerColumn[] = [
  { id: 'status', label: 'Status' },
  { id: 'name', label: 'Jogador' },
  { id: 'positions', label: 'Posições' },
  { id: 'age', label: 'Idade' },
  { id: 'positionScore', label: 'Nota da posição' },
]
const PICKER_COLUMN_WIDTHS: Record<PickerSortKey, number> = { status: 56, name: 220, positions: 172, age: 60, positionScore: 196 }

const attributeColumn = (key: string, label: string): PlayerTableColumn => ({ id: `attribute|${key}`, kind: 'attribute', attributeKey: key, label })
const roleColumn = (phase: TacticPhase, position: string, roleCode: string): PlayerTableColumn => ({ id: `role|${phase}|${position}|${roleCode}`, kind: 'role', phase, position, roleCode, label: `${phase} · ${position} · ${roleCode}` })
const tacticColumn = (tactic: Tactic, ip: Assignment, oop: Assignment): PlayerTableColumn => ({ id: `tactic|${tactic.id}|${ip.playerId}`, kind: 'tacticRole', tacticId: tactic.id, linkId: ip.playerId, label: `${tactic.name} · ${ip.position} ${ip.roleCode} ↔ ${oop.position} ${oop.roleCode}` })

function defaultPlayerColumnWidth(column: PlayerTableColumn) {
  if (column.kind === 'data') return PLAYER_DATA_WIDTHS[column.key!]
  if (column.kind === 'attribute') return 105
  if (column.kind === 'tacticRole') return 132
  return 112
}

function defaultPlayerTableLayout(): PlayerTableLayout {
  return { columns: DEFAULT_PLAYER_COLUMNS.map(column => ({ ...column })), frozenIndex: 1, widths: {} }
}

function readPlayerTableLayout(): PlayerTableLayout {
  if (typeof window === 'undefined') return defaultPlayerTableLayout()
  try {
    const saved = JSON.parse(localStorage.getItem(TACTICS_TABLE_STORAGE_KEY) ?? 'null') as Partial<PlayerTableLayout> | null
    if (Array.isArray(saved?.columns) && saved!.columns.some(column => column.id === 'name')) {
      const columns = (saved!.columns as PlayerTableColumn[])
        .filter(column => column.id !== 'positionScore' && column.key !== 'positionScore')
        .map(column => column.kind === 'data' && (column.key as string) === 'generalScore'
          ? { ...column, id: 'relativeScore', key: 'relativeScore' as PlayerDataKey, label: PLAYER_DATA_LABELS.relativeScore }
          : column)
      if (!columns.some(column => column.id === 'name')) return defaultPlayerTableLayout()
      const nameIndex = columns.findIndex(column => column.id === 'name')
      const savedFrozen = Number.isInteger(saved!.frozenIndex) ? saved!.frozenIndex! : nameIndex
      const widths = { ...(saved!.widths ?? {}) }
      if (widths.generalScore != null && widths.relativeScore == null) widths.relativeScore = widths.generalScore
      delete widths.generalScore
      return {
        columns,
        frozenIndex: savedFrozen < 0 ? -1 : Math.max(nameIndex, Math.min(columns.length - 1, savedFrozen)),
        widths,
      }
    }
  } catch {
    // fall through to canonical defaults
  }
  return defaultPlayerTableLayout()
}


function makeAssignment(nodeId: string, phase: TacticPhase, playerId: string): Assignment {
  const node = PITCH_NODES.find(item => item.id === nodeId)!
  const role = rolesFor(node.position, phase)[0]
  return { playerId, nodeId, position: node.position, roleId: `${phase}-${positionGroup(node.position)}-${role[0]}`, roleCode: role[0], roleName: role[1] }
}

function assignmentsFor(formation: string, phase: TacticPhase) {
  return (FORMATIONS[formation] ?? DEFAULT_NODE_IDS).map((nodeId, index) => makeAssignment(nodeId, phase, `p${index}`))
}

function laneLabel(nodeId: string) {
  const x = PITCH_NODES.find(node => node.id === nodeId)?.x ?? 50
  return x < 40 ? 'Esquerda' : x > 60 ? 'Direita' : 'Centro'
}

function lineClass(position: string) {
  const group = positionGroup(position)
  if (group === 'GK') return 'gk'
  if (group === 'FB' || group === 'CB') return 'd'
  if (group === 'WB' || group === 'DM') return 'dm'
  if (group === 'WM' || group === 'CM') return 'm'
  if (group === 'W' || group === 'AM') return 'am'
  return 'st'
}

function normalizeAssignments(raw: Assignment[] | undefined, phase: TacticPhase) {
  const source = raw?.length ? raw : assignmentsFor('4-3-3', phase)
  return source.map((assignment, index) => {
    const option = rolesFor(assignment.position, phase).find(role => role[0] === assignment.roleCode) ?? rolesFor(assignment.position, phase)[0]
    return {
      ...assignment,
      playerId: assignment.playerId ?? `p${index}`,
      roleId: `${phase}-${positionGroup(assignment.position)}-${option[0]}`,
      roleCode: option[0],
      roleName: option[1],
    }
  })
}

function normalizeTactic(tactic: Partial<Tactic> & Pick<Tactic, 'id' | 'name'>): Tactic {
  const legacy = tactic.assignments
  const ipAssignments = normalizeAssignments(tactic.ipAssignments ?? legacy, 'IP')
  const oopAssignments = normalizeAssignments(tactic.oopAssignments ?? legacy, 'OOP')
  const roles = [...(tactic.roles ?? [])]
  for (const assignment of [...ipAssignments, ...oopAssignments]) {
    const existing = roles.find(role => role.id === assignment.roleId)
    if (existing) {
      existing.name = assignment.roleName
      if (usesLegacyRoleDefaults(existing.weights)) existing.weights = canonicalRoleDefaultWeights(assignment.roleId, assignment.roleName)
    } else {
      roles.push({ id: assignment.roleId, name: assignment.roleName, weights: canonicalRoleDefaultWeights(assignment.roleId, assignment.roleName) })
    }
  }
  return { id: tactic.id, name: tactic.name, roles, ipAssignments, oopAssignments, lineup: tactic.lineup ?? {} }
}

function PersonOutline() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.75 19.25c.7-4 2.8-6 6.25-6s5.55 2 6.25 6"/></svg>
}

export function TacticsPage() {
  const { selected } = useSaves()
  const navigate = useNavigate()
  const [config, setConfig] = useState<Config>(fresh)
  const [status, setStatus] = useState('Carregando…')
  const [saveDetail, setSaveDetail] = useState('')
  const [phase, setPhase] = useState<TacticPhase>('IP')
  const [dragging, setDragging] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editPlayerId, setEditPlayerId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [ipFormation, setIpFormation] = useState('4-3-3')
  const [oopFormation, setOopFormation] = useState('4-3-3')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [sideTab, setSideTab] = useState<'structure' | 'players'>('structure')
  const [positionFilters, setPositionFilters] = useState<string[] | null>(null)
  const [playerSort, setPlayerSort] = useState<{ key: PlayerSortKey; direction: 1 | -1 }>({ key: 'relativeScore', direction: -1 })
  const [playerTableLayout, setPlayerTableLayout] = useState<PlayerTableLayout>(readPlayerTableLayout)
  const [columnMenu, setColumnMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [playerPickerSlot, setPlayerPickerSlot] = useState<string | null>(null)
  const [playerPickerAnchor, setPlayerPickerAnchor] = useState<{ top: number; left: number; width: number } | null>(null)
  const [pickerEligibility, setPickerEligibility] = useState<'all' | 'eligible'>('eligible')
  const [pickerSort, setPickerSort] = useState<{ key: PickerSortKey; direction: 1 | -1 }>({ key: 'positionScore', direction: -1 })
  const [draggingCard, setDraggingCard] = useState<{ phase: TacticPhase; playerId: string } | null>(null)
  const [rolePicker, setRolePicker] = useState<RolePicker | null>(null)
  const cardWasDragged = useRef(false)
  const loaded = useRef(false)
  const loadGuard = useRef(createLatestSaveRequestGuard())

  function saveStatus(next: string, detail?: string) { setStatus(next); setSaveDetail(detail ?? '') }

  async function persistPatch(patch: Record<string, unknown>) {
    if (!selected) return
    saveStatus('Salvando…')
    try {
      const result = await patchModelConfig(selected.id, '2.9.0', patch)
      saveStatus('✓ Salvo', result.diagnostic ?? '')
    } catch (error) {
      saveStatus('⚠ Não foi possível salvar', describeDbError(error).full)
    }
  }

  async function retrySave() {
    if (!selected) return
    try {
      const result = await retryModelConfigPatch(selected.id, saveStatus)
      if (!result) await persistPatch({ tactics: config.tactics, selected_tactic_id: config.selected_tactic_id, selected_role_id: config.selected_role_id })
    } catch {
      /* shared layer already updated the status */
    }
  }

  useEffect(() => {
    loaded.current = false
    if (!supabase || !selected) { loadGuard.current.invalidate(); return }
    const token = loadGuard.current.begin(selected.id)
    saveStatus('Carregando…')
    void loadModelConfig(selected.id).then(data => {
      if (!loadGuard.current.isCurrent(token)) return
      const current = data as Partial<Config>
      setConfig({ ...fresh(), ...current, tactics: (current.tactics ?? []).map(tactic => normalizeTactic(tactic)) })
      loaded.current = true
      saveStatus('✓ Salvo')
    }).catch(error => {
      if (loadGuard.current.isCurrent(token)) saveStatus('⚠ Não foi possível carregar', describeDbError(error).full)
    })
    return () => loadGuard.current.invalidate(token)
  }, [selected?.id])

  useEffect(() => {
    let active = true
    if (!supabase || !selected) { setCandidates([]); return () => { active = false } }
    void loadCurrentPlayers(selected.id).then(rows => {
      if (!active) return
      setCandidates((rows as unknown as PlayerRow[]).map(player => {
        const latest = player.player_snapshots[0]
        return {
          id: player.id,
          name: player.current_name,
          positions: latest?.positions ?? [],
          age: latest?.age ?? null,
          attributes: (latest?.player_attributes ?? []).map(attribute => ({ key: attribute.attribute_key, value: attribute.value })),
          player,
          latest,
        }
      }))
    }).catch(error => {
      if (active) {
        setCandidates([])
        console.error('Falha ao carregar elenco atual em Táticas.', describeDbError(error).full)
      }
    })
    return () => { active = false }
  }, [selected?.id])

  useEffect(() => {
    if (!loaded.current || !selected || !supabase) return
    scheduleModelConfigPatch(selected.id, '2.9.0', {
      tactics: config.tactics,
      selected_tactic_id: config.selected_tactic_id,
      selected_role_id: config.selected_role_id,
    }, saveStatus)
  }, [config.tactics, config.selected_tactic_id, config.selected_role_id, selected?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(TACTICS_TABLE_STORAGE_KEY, JSON.stringify(playerTableLayout))
  }, [playerTableLayout])

  useEffect(() => {
    const close = () => setColumnMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close) }
  }, [])

  const tactic = config.tactics.find(item => item.id === config.selected_tactic_id)
  const assignments = tactic ? (phase === 'IP' ? tactic.ipAssignments : tactic.oopAssignments) : []
  const editing = assignments.find(assignment => assignment.playerId === editPlayerId)
  const otherAssignments = tactic ? (phase === 'IP' ? tactic.oopAssignments : tactic.ipAssignments) : []
  const linkedOther = otherAssignments.find(assignment => assignment.playerId === editPlayerId)

  function create() {
    const clean = name.trim()
    if (!clean) return
    const id = crypto.randomUUID()
    const created = normalizeTactic({ id, name: clean, roles: [], ipAssignments: assignmentsFor(ipFormation, 'IP'), oopAssignments: assignmentsFor(oopFormation, 'OOP') })
    const next = { ...config, tactics: [...config.tactics, created], selected_tactic_id: id, selected_role_id: null }
    setConfig(next)
    void persistPatch({ tactics: next.tactics, selected_tactic_id: id, selected_role_id: null })
    setName('')
    setCreateOpen(false)
  }

  function remove() {
    if (!tactic || !confirm(`Excluir a tática “${tactic.name}”?`)) return
    const next = { ...config, tactics: config.tactics.filter(item => item.id !== tactic.id), selected_tactic_id: null, selected_role_id: null }
    setConfig(next)
    void persistPatch({ tactics: next.tactics, selected_tactic_id: null, selected_role_id: null })
  }

  function selectTactic(id: string | null) {
    const next = { ...config, selected_tactic_id: id, selected_role_id: null }
    setConfig(next)
    void persistPatch({ selected_tactic_id: id, selected_role_id: null })
  }

  function updatePhase(targetPhase: TacticPhase, transform: (items: Assignment[]) => Assignment[]) {
    if (!tactic) return
    const key = targetPhase === 'IP' ? 'ipAssignments' : 'oopAssignments'
    setConfig(current => ({ ...current, tactics: current.tactics.map(item => item.id === tactic.id ? { ...item, [key]: transform(item[key]) } : item) }))
  }

  function changeRole(roleCode: string) {
    if (!tactic || !editing) return
    changeAssignmentRole(editing.playerId, phase, roleCode)
  }

  function changeAssignmentRole(slotId: string, targetPhase: TacticPhase, roleCode: string) {
    if (!tactic) return
    const key = targetPhase === 'IP' ? 'ipAssignments' : 'oopAssignments'
    const assignment = tactic[key].find(item => item.playerId === slotId)
    if (!assignment) return
    const option = rolesFor(assignment.position, targetPhase).find(role => role[0] === roleCode)!
    const roleId = `${targetPhase}-${positionGroup(assignment.position)}-${option[0]}`
    setConfig(current => ({ ...current, tactics: current.tactics.map(item => {
      if (item.id !== tactic.id) return item
      const roles = item.roles.some(role => role.id === roleId) ? item.roles : [...item.roles, { id: roleId, name: option[1], weights: canonicalRoleDefaultWeights(roleId, option[1]) }]
      return { ...item, roles, [key]: item[key].map(currentAssignment => currentAssignment.playerId === slotId ? { ...currentAssignment, roleId, roleCode: option[0], roleName: option[1] } : currentAssignment) }
    }) }))
  }

  function relinkOther(targetNodeId: string) {
    if (!editing || !linkedOther) return
    if (editing.position === 'GK' || linkedOther.position === 'GK') return
    const otherPhase: TacticPhase = phase === 'IP' ? 'OOP' : 'IP'
    updatePhase(otherPhase, items => {
      const target = items.find(item => item.nodeId === targetNodeId)
      if (!target) return items
      return items.map(item => item.nodeId === linkedOther.nodeId ? { ...item, playerId: target.playerId } : item.nodeId === target.nodeId ? { ...item, playerId: editing.playerId } : item)
    })
  }

  function selectPlayer(slotId: string, playerId: string) {
    if (!tactic) return
    setConfig(current => ({ ...current, tactics: current.tactics.map(item => {
      if (item.id !== tactic.id) return item
      const lineup = { ...item.lineup }
      if (playerId) {
        for (const [otherSlot, assignedPlayerId] of Object.entries(lineup)) {
          if (otherSlot !== slotId && assignedPlayerId === playerId) lineup[otherSlot] = null
        }
      }
      lineup[slotId] = playerId || null
      return { ...item, lineup }
    }) }))
  }

  function swapPhaseLinks(targetPhase: TacticPhase, targetPlayerId: string) {
    if (!tactic || !draggingCard || draggingCard.phase !== targetPhase || draggingCard.playerId === targetPlayerId) { setDraggingCard(null); return }
    const key = targetPhase === 'IP' ? 'ipAssignments' : 'oopAssignments'
    const sourcePlayerId = draggingCard.playerId
    const phaseAssignments = tactic[key]
    if (phaseAssignments.some(assignment => (assignment.playerId === sourcePlayerId || assignment.playerId === targetPlayerId) && assignment.position === 'GK')) { setDraggingCard(null); return }
    setConfig(current => ({ ...current, tactics: current.tactics.map(item => item.id === tactic.id ? {
      ...item,
      [key]: item[key].map(assignment => assignment.playerId === sourcePlayerId ? { ...assignment, playerId: targetPlayerId } : assignment.playerId === targetPlayerId ? { ...assignment, playerId: sourcePlayerId } : assignment),
    } : item) }))
    setDraggingCard(null)
  }

  function scoreFor(candidate: Candidate, ip: Assignment, oop: Assignment) {
    if (!tactic) return null
    const weights = (assignment: Assignment) => resolveRoleWeights({
      roleId: assignment.roleId,
      roleName: assignment.roleName,
      overrideWeights: config.role_weight_overrides[assignment.roleId] ?? tactic.roles.find(role => role.id === assignment.roleId)?.weights,
    })
    return pairedRoleScore(candidate.attributes, weights(ip), weights(oop))
  }

  function changePlayerSort(key: PlayerSortKey) {
    setPlayerSort(current => ({ key, direction: current.key === key ? (current.direction === 1 ? -1 : 1) : key === 'name' || key === 'positions' ? 1 : -1 }))
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    if (!tactic || dragging === null || assignments[dragging].nodeId === 'gk') return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * 100
    const y = (event.clientY - rect.top) / rect.height * 100
    const target = PITCH_NODES.filter(node => node.id !== 'gk').sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2))[0]
    const occupied = assignments.findIndex(assignment => assignment.nodeId === target.id)
    updatePhase(phase, items => {
      const next = items.map(item => ({ ...item }))
      const source = next[dragging]
      if (occupied >= 0) {
        const sourceNode = PITCH_NODES.find(node => node.id === source.nodeId)!
        next[occupied] = { ...makeAssignment(sourceNode.id, phase, next[occupied].playerId) }
      }
      next[dragging] = { ...makeAssignment(target.id, phase, source.playerId) }
      return next
    })
    setDragging(null)
  }

  const naturalSort = (a: Assignment, b: Assignment) => {
    const an = PITCH_NODES.find(node => node.id === a.nodeId)!
    const bn = PITCH_NODES.find(node => node.id === b.nodeId)!
    const rank: Record<string, number> = { GK: 0, FB: 1, CB: 1, WB: 2, DM: 2, WM: 3, CM: 3, W: 4, AM: 4, ST: 5 }
    return rank[positionGroup(a.position)] - rank[positionGroup(b.position)] || bn.x - an.x
  }

  const pairedRows = tactic ? [...tactic.ipAssignments].sort(naturalSort).map(ip => ({ ip, oop: tactic.oopAssignments.find(assignment => assignment.playerId === ip.playerId)! })) : []
  const playerColumns = playerTableLayout.columns

  function candidateStatus(candidate: Candidate) {
    const groupId = Object.entries(config.planning?.slotAssignments ?? {}).find(([, rows]) => Object.values(rows).some(ids => ids.includes(candidate.id)))?.[0]
    return config.planning?.groups.find(group => group.id === groupId)?.name ?? 'Não selecionado'
  }

  function scoreForRoleColumn(candidate: Candidate, column: PlayerTableColumn) {
    if (!column.phase || !column.position || !column.roleCode) return null
    const roleName = rolesFor(column.position, column.phase).find(([code]) => code === column.roleCode)?.[1] ?? column.roleCode
    const roleId = `${column.phase}-${positionGroup(column.position)}-${column.roleCode}`
    const weights = resolveRoleWeights({ roleId, roleName, overrideWeights: config.role_weight_overrides[roleId] })
    return roleScore(candidate.attributes, weights)
  }

  function scoreForTacticColumn(candidate: Candidate, column: PlayerTableColumn) {
    if (!column.tacticId || !column.linkId) return null
    const targetTactic = config.tactics.find(item => item.id === column.tacticId)
    const ip = targetTactic?.ipAssignments.find(item => item.playerId === column.linkId)
    const oop = targetTactic?.oopAssignments.find(item => item.playerId === column.linkId) ?? ip
    if (!targetTactic || !ip || !oop) return null
    const weights = (assignment: Assignment, targetPhase: TacticPhase) => {
      const roleId = assignment.roleId || `${targetPhase}-${positionGroup(assignment.position)}-${assignment.roleCode}`
      return resolveRoleWeights({
        roleId,
        roleName: assignment.roleName,
        overrideWeights: config.role_weight_overrides[roleId] ?? targetTactic.roles.find(role => role.id === roleId)?.weights,
      })
    }
    return pairedRoleScore(candidate.attributes, weights(ip, 'IP'), weights(oop, 'OOP'))
  }

  function relativeScoreForCandidate(candidate: Candidate) {
    const snapshot = candidate.latest
    if (!snapshot) return null

    // Sem recorte posicional, Nota relativa reduz exatamente ao GeneralScore
    // canônico: melhor BasePositionScore elegível do jogador.
    if (positionFilters === null) {
      const scores = basePositionScores(snapshot)
      return scores.length ? Math.max(...scores.map(item => item.score)) : null
    }
    if (!positionFilters.length) return null

    // Com posições explicitamente selecionadas, o recorte do usuário é a
    // autoridade: avaliamos as matrizes-base correspondentes somente nas
    // posições em que o jogador tem familiaridade e usamos a melhor nota.
    const seen = new Set<string>()
    const scores: number[] = []
    for (const target of positionFilters) {
      if (!canPlayPosition(candidate.positions, target)) continue
      const canonical = canonicalPosition(target)
      const definition = BASE_POSITION_DEFINITIONS.find(item => canonicalPosition(item.position) === canonical)
      if (!definition) continue
      const identity = `${definition.scoreKey}:${definition.family}`
      if (seen.has(identity)) continue
      seen.add(identity)
      const ipWeights = canonicalRoleDefaultWeights(`IP-${definition.group}-${definition.roleCode}`, definition.roleName)
      const oopWeights = canonicalRoleDefaultWeights(`OOP-${definition.group}-${definition.roleCode}`, definition.roleName)
      const score = pairedRoleScore(candidate.attributes, ipWeights, oopWeights)
      if (score !== null) scores.push(score)
    }
    return scores.length ? Math.max(...scores) : null
  }

  function makePlayerTableRow(candidate: Candidate): PlayerTableRow {
    const row: PlayerTableRow = {
      candidate,
      relativeScore: relativeScoreForCandidate(candidate),
      status: candidateStatus(candidate),
      columnScores: {},
    }
    for (const column of playerColumns) {
      if (column.kind === 'role') row.columnScores[column.id] = scoreForRoleColumn(candidate, column)
      else if (column.kind === 'tacticRole') row.columnScores[column.id] = scoreForTacticColumn(candidate, column)
    }
    return row
  }

  function playerDataValue(row: PlayerTableRow, key: PlayerDataKey) {
    const snapshot = row.candidate.latest
    if (key === 'status') return row.status
    if (key === 'name') return row.candidate.name
    if (key === 'age') return row.candidate.age
    if (key === 'nationality') return row.candidate.player.nationality
    if (key === 'team') return snapshot?.club || snapshot?.squad
    if (key === 'position') return row.candidate.positions.join(', ')
    if (key === 'height') return snapshot?.height
    if (key === 'weight') return snapshot?.weight
    if (key === 'foot') return snapshot?.preferred_foot
    if (key === 'contract') return snapshot?.contract_expiry
    if (key === 'snapshot') return snapshot?.snapshot_date
    return row.relativeScore
  }

  function comparePlayerTableRows(a: PlayerTableRow, b: PlayerTableRow, key: string) {
    const column = playerColumns.find(item => item.id === key)
    if (column?.kind === 'role' || column?.kind === 'tacticRole') return (a.columnScores[column.id] ?? -1) - (b.columnScores[column.id] ?? -1)
    if (column?.kind === 'attribute') {
      const value = (row: PlayerTableRow) => row.candidate.latest?.player_attributes.find(attribute => attribute.attribute_key === column.attributeKey)?.value ?? -1
      return value(a) - value(b)
    }
    const dataKey = column?.kind === 'data' ? column.key : key as PlayerDataKey
    const left = playerDataValue(a, dataKey!)
    const right = playerDataValue(b, dataKey!)
    if (typeof left === 'number' || typeof right === 'number') return Number(left ?? -1) - Number(right ?? -1)
    return String(left ?? '').localeCompare(String(right ?? ''), 'pt-BR')
  }

  const playerRows = candidates
    .map(makePlayerTableRow)
    .filter(row => positionFilters === null || (positionFilters.length > 0 && positionFilters.some(target => canPlayPosition(row.candidate.positions, target))))
    .sort((a, b) => comparePlayerTableRows(a, b, playerSort.key) * playerSort.direction || a.candidate.name.localeCompare(b.candidate.name, 'pt-BR'))

  const pickerPair = pairedRows.find(({ ip }) => ip.playerId === playerPickerSlot)
  const pickerRows: PickerRow[] = pickerPair ? candidates
    .map(candidate => {
      const positionScore = scoreFor(candidate, pickerPair.ip, pickerPair.oop)
      const assignedSlot = Object.entries(tactic?.lineup ?? {}).find(([slot, id]) => slot !== playerPickerSlot && id === candidate.id)?.[0] ?? null
      const eligible = canPlayPosition(candidate.positions, pickerPair.ip.position) || canPlayPosition(candidate.positions, pickerPair.oop.position)
      return { candidate, positionScore, status: candidateStatus(candidate), assignedSlot, eligible }
    })
    .filter(row => pickerEligibility === 'all' || row.eligible)
    .sort((a, b) => comparePickerRows(a, b, pickerSort.key) * pickerSort.direction || a.candidate.name.localeCompare(b.candidate.name, 'pt-BR')) : []

  function comparePickerRows(a: PickerRow, b: PickerRow, key: PickerSortKey) {
    if (key === 'status') return a.status.localeCompare(b.status, 'pt-BR')
    if (key === 'name') return a.candidate.name.localeCompare(b.candidate.name, 'pt-BR')
    if (key === 'positions') return a.candidate.positions.join(',').localeCompare(b.candidate.positions.join(','), 'pt-BR')
    if (key === 'age') return (a.candidate.age ?? 999) - (b.candidate.age ?? 999)
    return (a.positionScore ?? -1) - (b.positionScore ?? -1)
  }

  function changePickerSort(key: PickerSortKey) {
    setPickerSort(current => ({ key, direction: current.key === key ? (current.direction === 1 ? -1 : 1) : key === 'name' || key === 'positions' || key === 'status' ? 1 : -1 }))
  }

  function beginCardDrag(targetPhase: TacticPhase, playerId: string) {
    cardWasDragged.current = true
    setRolePicker(null)
    setDraggingCard({ phase: targetPhase, playerId })
  }

  function finishCardDrag() {
    setDraggingCard(null)
    window.setTimeout(() => { cardWasDragged.current = false }, 0)
  }

  function openRolePicker(event: MouseEvent<HTMLButtonElement>, assignment: Assignment, targetPhase: TacticPhase) {
    if (cardWasDragged.current) return
    const card = event.currentTarget.closest('.role-box') as HTMLElement | null
    const rect = (card ?? event.currentTarget).getBoundingClientRect()
    setRolePicker({ phase: targetPhase, playerId: assignment.playerId, position: assignment.position, roleCode: assignment.roleCode, top: rect.bottom, left: rect.left, width: rect.width })
  }

  function roleCard(assignment: Assignment, targetPhase: TacticPhase) {
    return <div
      className={`role-box line-${lineClass(assignment.position)}`}
      draggable={assignment.position !== 'GK'}
      onDragStart={() => assignment.position !== 'GK' && beginCardDrag(targetPhase, assignment.playerId)}
      onDragEnd={finishCardDrag}
      onDragOver={event => event.preventDefault()}
      onDrop={() => swapPhaseLinks(targetPhase, assignment.playerId)}
      title="Arraste para trocar o vínculo"
    >
      <b className="role-position-chip">{assignment.position}</b>
      <button type="button" className="role-inline-picker" onClick={event => openRolePicker(event, assignment, targetPhase)} aria-label={`Função ${targetPhase} de ${assignment.position}`}>
        <strong>{assignment.roleCode}</strong>
        <small>{assignment.roleName}</small>
      </button>
    </div>
  }

  function playerSlotCard(ip: Assignment, oop: Assignment) {
    const playerId = tactic?.lineup[ip.playerId]
    const candidate = candidates.find(item => item.id === playerId)
    const snapshot = candidate?.latest
    const score = candidate ? scoreFor(candidate, ip, oop) : null
    const openPicker = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      setPlayerPickerAnchor({ top: rect.top, left: rect.left, width: rect.width })
      setPlayerPickerSlot(ip.playerId)
      setPickerEligibility('eligible')
      setPickerSort({ key: 'positionScore', direction: -1 })
    }
    const activatePicker = (event: MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('button')) return
      openPicker(event.currentTarget)
    }

    return <div
      className={`tactic-player-slot ${candidate ? 'is-filled' : 'is-empty'}`}
      onClick={activatePicker}
      onKeyDown={event => {
        if ((event.target as HTMLElement).closest('button')) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openPicker(event.currentTarget)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={candidate ? `Alterar jogador: ${candidate.name}` : `Selecionar jogador para ${ip.position}`}
    >
      {candidate ? <>
        {snapshot ? <PlayerPeek player={candidate.player} snapshot={snapshot} /> : <span className="tactic-player-avatar" aria-hidden="true"><PersonOutline /></span>}
        <span className="tactic-player-slot-copy">
          <button type="button" className="player-name tactic-structure-player-name" onClick={event => { event.stopPropagation(); navigate(`/players/${candidate.id}`) }}>{candidate.name}</button>
          <small>{candidate.positions.join(', ') || 'Sem posição'} · {candidate.age ?? '—'} anos</small>
        </span>
        <span className="tactic-player-slot-score" title="Nota atual nesta função"><ScoreBadge value={score} className="score-badge-compact" showTitle={false} /></span>
      </> : <>
        <span className="tactic-player-avatar tactic-player-avatar-empty" aria-hidden="true"><PersonOutline /></span>
        <span className="tactic-player-slot-copy">
          <strong>Selecionar jogador</strong>
          <small>Slot sem jogador</small>
        </span>
        <span className="tactic-slot-add" aria-hidden="true">+</span>
      </>}
    </div>
  }

  const tacticOptions = config.tactics.map(item => ({ value: item.id, label: item.name }))


  function removePlayerColumn(index: number) {
    if (playerColumns[index]?.id === 'name') return
    const nextColumns = playerColumns.filter((_, itemIndex) => itemIndex !== index)
    setPlayerTableLayout(current => {
      if (!nextColumns.length) return current
      if (current.frozenIndex < 0) return { ...current, columns: nextColumns, frozenIndex: -1 }
      const adjusted = index <= current.frozenIndex ? current.frozenIndex - 1 : current.frozenIndex
      const nameIndex = nextColumns.findIndex(column => column.id === 'name')
      return { ...current, columns: nextColumns, frozenIndex: Math.min(nextColumns.length - 1, Math.max(adjusted, nameIndex)) }
    })
    if (playerSort.key === playerColumns[index]?.id) setPlayerSort({ key: 'name', direction: 1 })
    setColumnMenu(null)
  }

  function insertPlayerColumn(column: PlayerTableColumn) {
    const index = columnMenu?.index ?? playerColumns.length - 1
    const inserted = column.kind === 'role' || column.kind === 'tacticRole' ? { ...column, id: `${column.id}|${crypto.randomUUID()}` } : column
    setPlayerTableLayout(current => ({ ...current, columns: [...current.columns.slice(0, index + 1), inserted, ...current.columns.slice(index + 1)] }))
    setColumnMenu(null)
  }

  function movePlayerTableColumn(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    setPlayerTableLayout(current => {
      const columns = [...current.columns]
      const [item] = columns.splice(fromIndex, 1)
      columns.splice(toIndex, 0, item)
      return { ...current, columns, frozenIndex: current.frozenIndex < 0 ? -1 : Math.max(current.frozenIndex, columns.findIndex(column => column.id === 'name')) }
    })
  }

  function setPlayerColumnWidth(column: PlayerTableColumn, width: number) {
    setPlayerTableLayout(current => ({ ...current, widths: { ...current.widths, [column.id]: width } }))
  }

  function statusBadge(status: string) { return <PlanningStatusBadge status={status} /> }

  function scoreColumnMinWidth(column: PlayerTableColumn) {
    if (column.kind === 'role' || column.kind === 'tacticRole') return 112
    if (column.kind === 'data' && column.key === 'relativeScore') return 112
    if (column.kind === 'data' && column.key === 'status') return 56
    if (column.kind === 'data' && column.key === 'name') return 164
    return 64
  }

  function renderPlayerTableCell(row: PlayerTableRow, column: PlayerTableColumn): ReactNode {
    if (column.kind === 'attribute') {
      const attribute = row.candidate.latest?.player_attributes.find(item => item.attribute_key === column.attributeKey)
      return <b>{attribute?.value ?? '—'}</b>
    }
    if (column.kind === 'role' || column.kind === 'tacticRole') return <span title="Nota atual nesta função"><ScoreBadge value={row.columnScores[column.id] ?? null} className="score-badge-compact" showTitle={false} /></span>
    const key = column.key!
    const snapshot = row.candidate.latest
    if (key === 'status') return statusBadge(row.status)
    if (key === 'name') return <div className="squad-player-name-cell tactics-player-name-cell">{snapshot && <PlayerPeek player={row.candidate.player} snapshot={snapshot} />}<button type="button" className="player-name tactics-table-player-name" onClick={event => { event.stopPropagation(); navigate(`/players/${row.candidate.id}`) }}>{row.candidate.name}</button></div>
    if (key === 'age') return <>{row.candidate.age ?? '—'}</>
    if (key === 'nationality') return <>{row.candidate.player.nationality || '—'}</>
    if (key === 'team') return <>{snapshot?.club || snapshot?.squad || '—'}</>
    if (key === 'position') return <span className="tactics-table-positions">{row.candidate.positions.join(', ') || '—'}</span>
    if (key === 'height') return <>{snapshot?.height ?? '—'}</>
    if (key === 'weight') return <>{snapshot?.weight ?? '—'}</>
    if (key === 'foot') return <>{snapshot?.preferred_foot || '—'}</>
    if (key === 'contract') return <>{snapshot?.contract_expiry || '—'}</>
    if (key === 'snapshot') return <>{snapshot?.snapshot_date || '—'}</>
    return <span title="Melhor BasePositionScore entre as posições selecionadas no filtro."><ScoreBadge value={row.relativeScore} className="score-badge-compact" showTitle={false} /></span>
  }

  function pickerAssignedLabel(slotId: string | null) {
    if (!slotId) return null
    const pair = pairedRows.find(({ ip }) => ip.playerId === slotId)
    if (!pair) return 'outro slot'
    return pair.ip.position === pair.oop.position ? pair.ip.position.replaceAll(' ', '') : `${pair.ip.position.replaceAll(' ', '')} / ${pair.oop.position.replaceAll(' ', '')}`
  }

  const pickerProjectionKey = pickerPair ? functionProjectionKey([
    { phase: 'IP', position: pickerPair.ip.position, roleCode: pickerPair.ip.roleCode },
    { phase: 'OOP', position: pickerPair.oop.position, roleCode: pickerPair.oop.roleCode },
  ]) : ''

  function renderPickerCell(row: PickerRow, column: PickerColumn): ReactNode {
    const snapshot = row.candidate.latest
    if (column.id === 'status') return statusBadge(row.status)
    if (column.id === 'name') {
      const assignedLabel = pickerAssignedLabel(row.assignedSlot)
      return <div className="squad-player-name-cell picker-player-name-cell">{snapshot && <PlayerPeek player={row.candidate.player} snapshot={snapshot} />}<span className="picker-player-copy"><strong>{row.candidate.name}</strong>{assignedLabel && <small className="picker-assigned-note">Já escalado · {assignedLabel}</small>}</span></div>
    }
    if (column.id === 'positions') return <span className="picker-positions-cell"><span>{row.candidate.positions.join(', ') || '—'}</span>{pickerEligibility === 'all' && !row.eligible && <small className="picker-familiarity-badge" title={`Sem familiaridade suficiente em ${pickerPair?.ip.position ?? 'IP'} ou ${pickerPair?.oop.position ?? 'OOP'}`}>Sem familiaridade</small>}</span>
    if (column.id === 'age') return <>{row.candidate.age ?? '—'}</>
    return <ScoreWithProjection playerId={row.candidate.id} currentScore={row.positionScore} snapshot={snapshot} scoreType="function" scoreKey={pickerProjectionKey} variant="compact" currentTitle="Nota atual nesta posição" />
  }


  return <div className="tactics-page tactics-ds-page">
    <div className="title-row tactics-title-row">
      <div><span className="eyebrow">ESTRUTURA DO TIME · FM26</span><h1>Táticas</h1><p>Configure posições, funções e jogadores com e sem a bola.</p></div>
      <SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠') ? () => void retrySave() : undefined} />
    </div>

    <div className="tactic-topbar">
      <div className="tactic-toolbar">
        <div className="tactic-select-wrap"><span>Tática</span><CustomSelect className="tactics-tactic-select" ariaLabel="Tática selecionada" value={tactic?.id ?? ''} options={tacticOptions} placeholder="Selecione uma tática" onChange={value => selectTactic(value || null)} /></div>
        <button className="tactic-add-button" onClick={() => setCreateOpen(true)}>+ Adicionar</button>
        <button className="danger-button tactic-delete-button" disabled={!tactic} onClick={remove}>Excluir</button>
      </div>
      <div className="tactic-tabs" role="tablist" aria-label="Conteúdo da tática">
        <button role="tab" aria-selected={sideTab === 'structure'} className={sideTab === 'structure' ? 'active' : ''} onClick={() => setSideTab('structure')}>Estrutura</button>
        <button role="tab" aria-selected={sideTab === 'players'} className={sideTab === 'players' ? 'active' : ''} onClick={() => setSideTab('players')}>Jogadores</button>
      </div>
    </div>

    <div className="tactic-workspace">
      <section className={`football-pitch ${!tactic ? 'pitch-empty' : ''}`} onDragOver={event => event.preventDefault()} onDrop={drop}>
        <div className="phase-switch field-phase-switch" aria-label="Fase da tática">
          <button className={phase === 'IP' ? 'active' : ''} onClick={() => setPhase('IP')}>IP</button>
          <button className={phase === 'OOP' ? 'active' : ''} onClick={() => setPhase('OOP')}>OOP</button>
        </div>
        {PITCH_NODES.map(node => <i className="position-target" style={{ left: `${node.x}%`, top: `${node.y}%` }} key={node.id} />)}
        {assignments.map((assignment, index) => {
          const node = PITCH_NODES.find(item => item.id === assignment.nodeId)!
          return <div className={`pitch-player ${dragging === index ? 'dragging' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} key={assignment.playerId}>
            <button className={`role-ball line-${lineClass(assignment.position)}`} draggable={assignment.nodeId !== 'gk'} onDragStart={() => setDragging(index)} title={assignment.nodeId === 'gk' ? 'Goleiro fixo' : 'Arraste para outra posição'}><span>{assignment.roleCode}</span></button>
            <button className="player-edit" onClick={() => setEditPlayerId(assignment.playerId)} aria-label={`Editar ${assignment.position}`} title="Editar função">✎</button>
            <small>{assignment.position}</small>
          </div>
        })}
        {!tactic && <div className="empty-pitch-action"><h2>Comece pela sua primeira tática</h2><p>Crie uma estrutura para configurar fases, funções e jogadores.</p><button onClick={() => setCreateOpen(true)}>Criar nova tática</button></div>}
      </section>

      <aside className="tactic-side-panel">
        {sideTab === 'structure' ? <div className={`role-summary ${tactic ? 'has-tactic' : ''}`}>
          {tactic && <div className="role-pair-head"><span>In Possession</span><span>Out of Possession</span><span>Jogador</span><span>Ações</span></div>}
          {pairedRows.map(({ ip, oop }) => <div className="role-pair-row" key={ip.playerId}>
            {roleCard(ip, 'IP')}
            {roleCard(oop, 'OOP')}
            {playerSlotCard(ip, oop)}
            <button className="tactic-slot-edit" onClick={() => setEditPlayerId(ip.playerId)} aria-label={`Editar ${ip.position} e ${oop.position}`} title="Editar vínculo e função">✎</button>
          </div>)}
          {!tactic && <div className="tactic-side-empty"><span className="tactic-player-avatar tactic-player-avatar-empty"><PersonOutline /></span><h2>Nenhuma tática selecionada</h2><p>Crie ou selecione uma tática para organizar as funções.</p></div>}
        </div> : <div className="player-ranking tactics-player-ranking">
          <div className="player-ranking-controls tactics-table-toolbar">
            <PositionSelector selected={positionFilters} onChange={setPositionFilters} className="tactics-position-filter" />
            <span className="table-customization-hint tactics-table-hint">Clique com o botão direito no cabeçalho para adicionar, remover ou congelar colunas.</span>
            <span className="tactics-player-count">{playerRows.length} jogador{playerRows.length === 1 ? '' : 'es'}</span>
          </div>
          <DataTable<PlayerTableRow, PlayerTableColumn>
            rows={playerRows}
            columns={playerColumns}
            rowKey={row => row.candidate.id}
            renderCell={renderPlayerTableCell}
            getColumnWidth={column => playerTableLayout.widths[column.id] ?? defaultPlayerColumnWidth(column)}
            getColumnMinWidth={column => scoreColumnMinWidth(column)}
            getColumnMaxWidth={() => 640}
            onColumnWidthChange={setPlayerColumnWidth}
            onColumnMove={movePlayerTableColumn}
            onHeaderContextMenu={(event, _column, index) => { event.preventDefault(); setColumnMenu({ x: event.clientX, y: event.clientY, index }) }}
            frozenIndex={playerTableLayout.frozenIndex}
            fillContainer
            sort={playerSort}
            onSort={changePlayerSort}
            capabilities={DATA_TABLE_PRESETS.tactics}
            className="tactics-player-table customizable-squad-table"
            emptyMessage="Nenhum jogador corresponde a este recorte."
            getCellClassName={(_row, column) => column.kind === 'role' || column.kind === 'tacticRole' || column.key === 'relativeScore' ? 'role-score-cell tactics-table-score-cell' : column.kind === 'attribute' ? 'attribute-table-cell' : column.key === 'name' ? 'frozen-player-name' : undefined}
          />
          {columnMenu && <TacticsColumnContextMenu
            x={columnMenu.x}
            y={columnMenu.y}
            column={playerColumns[columnMenu.index]}
            dataColumns={GENERAL_PLAYER_COLUMNS.filter(column => !playerColumns.some(current => current.kind === 'data' && current.key === column.key))}
            attributeColumns={ATTRIBUTE_CATALOG.filter(attribute => !playerColumns.some(current => current.kind === 'attribute' && current.attributeKey === attribute.key)).map(attribute => attributeColumn(attribute.key, attribute.label))}
            tactics={config.tactics}
            insert={insertPlayerColumn}
            remove={() => removePlayerColumn(columnMenu.index)}
            freeze={() => { setPlayerTableLayout(current => ({ ...current, frozenIndex: columnMenu.index })); setColumnMenu(null) }}
            unfreeze={() => { setPlayerTableLayout(current => ({ ...current, frozenIndex: -1 })); setColumnMenu(null) }}
          />}
        </div>}
      </aside>
    </div>

    {rolePicker && createPortal(<><button className="role-card-dropdown-dismiss" aria-label="Fechar seletor de função" onClick={() => setRolePicker(null)} /><div className={`role-card-dropdown line-${lineClass(rolePicker.position)}`} style={{ top: rolePicker.top, left: rolePicker.left, width: rolePicker.width }} role="listbox" aria-label={`Funções para ${rolePicker.position}`}>{rolesFor(rolePicker.position, rolePicker.phase).map(([code, label]) => <button type="button" className={code === rolePicker.roleCode ? 'active' : ''} onClick={() => { changeAssignmentRole(rolePicker.playerId, rolePicker.phase, code); setRolePicker(null) }} role="option" aria-selected={code === rolePicker.roleCode} key={code}><b>{code}</b><span>{label}</span></button>)}</div></>, document.body)}

    {createOpen && <div className="settings-overlay" onClick={() => setCreateOpen(false)}><section className="tactic-modal" onClick={event => event.stopPropagation()}><header><div><span className="eyebrow">NOVA ESTRUTURA</span><h2>Criar tática</h2></div><button className="close" onClick={() => setCreateOpen(false)}>×</button></header><label>Nome da tática<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: 4-3-3 Posicional" /></label><div className="formation-grid"><label>Formação In Possession<select value={ipFormation} onChange={event => setIpFormation(event.target.value)}>{Object.keys(FORMATIONS).map(formation => <option key={formation}>{formation}</option>)}</select></label><label>Formação Out of Possession<select value={oopFormation} onChange={event => setOopFormation(event.target.value)}>{Object.keys(FORMATIONS).map(formation => <option key={formation}>{formation}</option>)}</select></label></div><footer><button className="ghost" onClick={() => setCreateOpen(false)}>Cancelar</button><button onClick={create} disabled={!name.trim()}>Criar tática</button></footer></section></div>}

    {playerPickerSlot && pickerPair && <div className="settings-overlay player-picker-overlay" onClick={() => setPlayerPickerSlot(null)}><section className="advanced-picker-modal tactics-player-picker-modal" style={playerPickerAnchor ? { top: Math.max(12, Math.min(playerPickerAnchor.top, window.innerHeight - 610)), left: Math.max(12, Math.min(playerPickerAnchor.left, window.innerWidth - Math.min(780, window.innerWidth - 24) - 12)), width: Math.min(780, window.innerWidth - 24) } : undefined} onClick={event => event.stopPropagation()}><header><div><span className="eyebrow">{pickerPair.ip.position} {pickerPair.ip.roleCode} · {pickerPair.oop.position} {pickerPair.oop.roleCode}</span><h2>Selecionar jogador</h2></div><button className="close" onClick={() => setPlayerPickerSlot(null)}>×</button></header><div className="tactics-picker-toolbar"><label className="tactics-picker-all-toggle"><input type="checkbox" checked={pickerEligibility === 'all'} onChange={event => setPickerEligibility(event.target.checked ? 'all' : 'eligible')} /><span>Mostrar todos os jogadores</span></label><span>{pickerRows.length} jogador{pickerRows.length === 1 ? '' : 'es'}</span></div><DataTable<PickerRow, PickerColumn>
      rows={pickerRows}
      columns={PICKER_COLUMNS}
      rowKey={row => row.candidate.id}
      renderCell={renderPickerCell}
      getColumnWidth={column => PICKER_COLUMN_WIDTHS[column.id]}
      sort={pickerSort}
      onSort={key => changePickerSort(key as PickerSortKey)}
      selectedRowKey={tactic?.lineup[playerPickerSlot] ?? null}
      onSelectRow={row => { selectPlayer(playerPickerSlot, row.candidate.id); setPlayerPickerSlot(null) }}
      capabilities={{ sorting: true, resizing: false, reordering: false, freezing: false, selection: true }}
      fillContainer
      className="tactics-picker-table"
      emptyMessage="Nenhum jogador corresponde ao filtro posicional."
      getCellClassName={(_row, column) => column.id === 'positionScore' ? 'role-score-cell tactics-table-score-cell' : column.id === 'name' ? 'picker-name-column' : undefined}
      getRowClassName={row => [row.assignedSlot ? 'tactics-picker-row-assigned' : '', pickerEligibility === 'all' && !row.eligible ? 'tactics-picker-row-unfamiliar' : ''].filter(Boolean).join(' ') || undefined}
    /><footer><button className="ghost" onClick={() => { selectPlayer(playerPickerSlot, ''); setPlayerPickerSlot(null) }}>Remover jogador</button></footer></section></div>}

    {editing && <div className="settings-overlay" onClick={() => setEditPlayerId(null)}><section className="tactic-modal role-modal" onClick={event => event.stopPropagation()}><header><div><span className="eyebrow">{phase} · {editing.position}</span><h2>Editar jogador</h2></div><button className="close" onClick={() => setEditPlayerId(null)}>×</button></header><div className="role-editor-layout"><div><h3>Função em {phase}</h3><div className="role-options">{rolesFor(editing.position, phase).map(([code, label]) => <button className={editing.roleCode === code ? 'active' : ''} onClick={() => changeRole(code)} key={code}><b>{code}</b><span>{label}</span></button>)}</div></div><div><h3>Posição vinculada em {phase === 'IP' ? 'OOP' : 'IP'}</h3><div className="mini-link-pitch">{PITCH_NODES.map(node => <i className="position-target" style={{ left: `${node.x}%`, top: `${node.y}%` }} key={node.id} />)}{otherAssignments.map(assignment => {
      const node = PITCH_NODES.find(item => item.id === assignment.nodeId)!
      return <button className={`mini-player line-${lineClass(assignment.position)} ${linkedOther?.nodeId === assignment.nodeId ? 'linked' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} disabled={editing.position === 'GK' || assignment.position === 'GK'} onClick={() => relinkOther(assignment.nodeId)} title={`${assignment.position} · ${laneLabel(assignment.nodeId)}`} key={assignment.nodeId}>{assignment.roleCode}</button>
    })}</div><p className="modal-hint">A posição realçada representa este mesmo jogador na outra formação.</p></div></div><footer><button onClick={() => setEditPlayerId(null)}>Concluir</button></footer></section></div>}
  </div>
}

type MenuLevelState = { active: string | null; setActive: Dispatch<SetStateAction<string | null>>; keepOpen: () => void; scheduleClose: () => void }
const MenuLevelContext = createContext<MenuLevelState | null>(null)

function MenuRoot({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)
  const keepOpen = () => { if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null } }
  const scheduleClose = () => { keepOpen(); closeTimer.current = window.setTimeout(() => setActive(null), 150) }
  useEffect(() => () => keepOpen(), [])
  return <MenuLevelContext.Provider value={{ active, setActive, keepOpen, scheduleClose }}>{children}</MenuLevelContext.Provider>
}

function NestedMenuLevel({ children, parent }: { children: ReactNode; parent: MenuLevelState }) {
  const [active, setActive] = useState<string | null>(null)
  return <MenuLevelContext.Provider value={{ ...parent, active, setActive }}>{children}</MenuLevelContext.Provider>
}

function MenuBranch({ label, children }: { label: string; children: ReactNode }) {
  const level = useContext(MenuLevelContext)
  const id = useId()
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openState = level?.active === id
  const open = (element: HTMLElement) => { level?.keepOpen(); level?.setActive(id); setPosition(null); setAnchor(element.getBoundingClientRect()) }
  useLayoutEffect(() => {
    if (!anchor || !panelRef.current) return
    const panel = panelRef.current.getBoundingClientRect()
    const gap = 5
    const padding = 12
    const left = anchor.right + gap + panel.width <= window.innerWidth - padding ? anchor.right + gap : Math.max(padding, anchor.left - gap - panel.width)
    const top = Math.max(padding, Math.min(anchor.top, window.innerHeight - panel.height - padding))
    setPosition({ left, top })
  }, [anchor, children])
  useEffect(() => { if (!openState) { setAnchor(null); setPosition(null) } }, [openState])
  if (!level) return null
  return <div className="context-branch" onMouseEnter={level.keepOpen} onMouseLeave={level.scheduleClose}>
    <button onMouseEnter={event => open(event.currentTarget)} onFocus={event => open(event.currentTarget)}><span>{label}</span><span>›</span></button>
    {openState && anchor && createPortal(<div ref={panelRef} className="context-submenu-portal" style={{ left: position?.left ?? -10000, top: position?.top ?? -10000, visibility: position ? 'visible' : 'hidden' }} onMouseEnter={level.keepOpen} onMouseLeave={level.scheduleClose} onClick={event => event.stopPropagation()}><NestedMenuLevel parent={level}>{children}</NestedMenuLevel></div>, document.body)}
  </div>
}

function TacticsColumnContextMenu({ x, y, column, dataColumns, attributeColumns, tactics, insert, remove, freeze, unfreeze }: {
  x: number
  y: number
  column: PlayerTableColumn
  dataColumns: PlayerTableColumn[]
  attributeColumns: PlayerTableColumn[]
  tactics: Tactic[]
  insert: (column: PlayerTableColumn) => void
  remove: () => void
  freeze: () => void
  unfreeze: () => void
}) {
  const categories: Array<[AttributeCategory, string]> = [['technical', 'Técnico'], ['mental', 'Mental'], ['physical', 'Físico'], ['goalkeeping', 'Goleiro']]
  return <aside className="squad-column-context" style={{ left: Math.max(12, Math.min(x, window.innerWidth - 260)), top: Math.max(12, Math.min(y, window.innerHeight - 190)) }} onClick={event => event.stopPropagation()}>
    <button onClick={freeze}>Congelar até esta coluna</button>
    <button onClick={unfreeze}>Remover congelamento</button>
    <button onClick={remove} disabled={column.id === 'name'}>Remover coluna</button>
    <hr />
    <MenuRoot><MenuBranch label="Adicionar coluna">
      <MenuBranch label="Geral">{dataColumns.length ? dataColumns.map(item => <button onClick={() => insert(item)} key={item.id}>{item.label}</button>) : <small>Todas já adicionadas</small>}</MenuBranch>
      <MenuBranch label="Atributos">{categories.map(([category, label]) => <MenuBranch label={label} key={category}>{attributeColumns.filter(item => ATTRIBUTE_CATALOG.find(attribute => attribute.key === item.attributeKey)?.category === category).map(item => <button onClick={() => insert(item)} key={item.id}>{item.label}</button>)}</MenuBranch>)}</MenuBranch>
      <MenuBranch label="Notas">
        <MenuBranch label="Táticas">{tactics.length ? tactics.map(tactic => <MenuBranch label={tactic.name} key={tactic.id}>{tactic.ipAssignments.map(ip => { const oop = tactic.oopAssignments.find(item => item.playerId === ip.playerId) ?? ip; return <button onClick={() => insert(tacticColumn(tactic, ip, oop))} key={ip.playerId}>{ip.position} {ip.roleCode} ↔ {oop.position} {oop.roleCode}</button> })}</MenuBranch>) : <small>Nenhuma tática criada</small>}</MenuBranch>
        {(['IP', 'OOP'] as TacticPhase[]).map(targetPhase => <MenuBranch label={targetPhase} key={targetPhase}>{PLAYER_POSITIONS.map(([position, label]) => <MenuBranch label={`${position} · ${label}`} key={position}>{rolesFor(position, targetPhase).map(([code, name]) => <button onClick={() => insert(roleColumn(targetPhase, position, code))} key={code}>{code} · {name}</button>)}</MenuBranch>)}</MenuBranch>)}
      </MenuBranch>
    </MenuBranch></MenuRoot>
  </aside>
}

