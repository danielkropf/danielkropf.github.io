import { canonicalRoleDefaultWeights } from './role-scoring'
import { PITCH_NODES, positionGroup, rolesFor, type PitchNode, type TacticPhase } from './tactics'

type UnknownRecord = Record<string, unknown>
type RawTacticPhase = { position: { base: string | null; side: string | null; exact: string | null }; role: string | null }
type RawTacticSlot = { slot: number | null; ip_to_oop_link: number | null; ip: RawTacticPhase; oop: RawTacticPhase }
type RawTacticCandidate = {
  manager_index: number
  manager_name: string | null
  human_eid: number | null
  human_record_offset: number | null
  root_team_id: number | null
  tactic_name: string | null
  record_start: number | null
  slots: RawTacticSlot[]
}

export type ImportedTacticAssignment = { playerId: string; nodeId: string; position: string; roleId: string; roleCode: string; roleName: string }
export type ImportedTacticRole = { id: string; name: string; weights: Record<string, number> }
export type ImportedFmTactic = { id: string; name: string; ipAssignments: ImportedTacticAssignment[]; oopAssignments: ImportedTacticAssignment[]; lineup: Record<string, string | null>; roles: ImportedTacticRole[] }
export type FmTacticSource = {
  source: 'fm26-save'
  source_identity: string
  file_hash: string
  file_name: string
  snapshot_date: string
  manager_index: number
  manager_name: string | null
  human_eid: number
  human_record_offset: number | null
  root_team_id: number
  tactic_record_start: number
  tactic_name: string
  structure_signature: string
}
export type FmTacticSourceMap = Record<string, FmTacticSource>
export type FmTacticImportContext = { fileHash: string; fileName: string; snapshotDate: string }
export type FmTacticImportPlan =
  | { status: 'none'; code: 'no_resolved_tactic'; diagnostic: string }
  | { status: 'blocked'; code: string; diagnostic: string }
  | { status: 'ready'; tactic: ImportedFmTactic; source: FmTacticSource; diagnostic: string }
export type FmTacticMergeResult =
  | { status: 'blocked'; code: string; diagnostic: string }
  | { status: 'ready'; action: 'created' | 'updated'; tactics: ImportedFmTactic[]; sources: FmTacticSourceMap; diagnostic: string }

const NODE_BY_EXACT_POSITION: Record<string, string> = {
  GK: 'gk', DL: 'dl', DCL: 'dcl', DC: 'dc', DCR: 'dcr', DR: 'dr', WBL: 'wbl', WBR: 'wbr',
  DML: 'dml', DM: 'dmc', DMR: 'dmr', ML: 'ml', MCL: 'mcl', MC: 'mc', MCR: 'mcr', MR: 'mr',
  AML: 'aml', AMCL: 'amcl', AMC: 'amc', AMCR: 'amcr', AMR: 'amr', ST: 'stc',
}
const IP_ROLE_ALIASES: Record<string, string> = { BGK: 'BPGK', BCB: 'BPCB', BBP: 'B2BP', BBM: 'B2BM', CFD: 'CF' }
const OOP_ROLE_ALIASES: Record<string, string> = { WMF: 'WM', OWM: 'WOWM', CFD: 'CF' }
const record = (value: unknown): UnknownRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? value : null

function parsePhase(value: unknown): RawTacticPhase {
  const phase = record(value); const position = record(phase.position)
  return { position: { base: text(position.base), side: text(position.side), exact: text(position.exact) }, role: text(phase.role) }
}
function parseSlot(value: unknown): RawTacticSlot {
  const slot = record(value)
  return { slot: integer(slot.slot), ip_to_oop_link: integer(slot.ip_to_oop_link), ip: parsePhase(slot.ip), oop: parsePhase(slot.oop) }
}
function parseCandidate(value: unknown, fallbackIndex: number): RawTacticCandidate | null {
  const wrapper = record(value)
  const nested = Object.keys(record(wrapper.tactic)).length ? record(wrapper.tactic) : wrapper
  if (nested.resolved !== undefined && nested.resolved !== true) return null
  return {
    manager_index: integer(wrapper.manager_index) ?? fallbackIndex,
    manager_name: text(wrapper.manager_name),
    human_eid: integer(wrapper.human_eid),
    human_record_offset: integer(wrapper.human_record_offset),
    root_team_id: integer(wrapper.root_team_id),
    tactic_name: text(nested.tactic_name) ?? text(nested.name),
    record_start: integer(nested.record_start),
    slots: Array.isArray(nested.slots) ? nested.slots.map(parseSlot) : [],
  }
}
function nodeFor(phase: RawTacticPhase): PitchNode | null {
  const id = phase.position.exact ? NODE_BY_EXACT_POSITION[phase.position.exact] : null
  return id ? PITCH_NODES.find(node => node.id === id) ?? null : null
}
function canonicalRoleCode(phase: TacticPhase, rawCode: string) { return (phase === 'IP' ? IP_ROLE_ALIASES : OOP_ROLE_ALIASES)[rawCode] ?? rawCode }
function assignmentFor(slot: RawTacticSlot, phase: TacticPhase): { assignment?: ImportedTacticAssignment; error?: string } {
  const decoded = phase === 'IP' ? slot.ip : slot.oop
  const node = nodeFor(decoded)
  if (!node) return { error: `posição ${phase} "${decoded.position.exact ?? decoded.position.base ?? 'desconhecida'}" do slot ${slot.slot ?? '?'} não possui mapeamento canônico seguro` }
  if (!decoded.role) return { error: `função ${phase} do slot ${slot.slot ?? '?'} não foi resolvida pelo leitor` }
  const roleCode = canonicalRoleCode(phase, decoded.role)
  const option = rolesFor(node.position, phase).find(([code]) => code === roleCode)
  if (!option) return { error: `função ${phase} "${decoded.role}" do slot ${slot.slot ?? '?'} não possui equivalência segura em ${node.position}` }
  const roleId = `${phase}-${positionGroup(node.position)}-${roleCode}`
  return { assignment: { playerId: `fm-slot-${slot.slot}`, nodeId: node.id, position: node.position, roleId, roleCode, roleName: option[1] } }
}
function validateSlots(slots: RawTacticSlot[]) {
  if (slots.length !== 11) return `a tática resolvida contém ${slots.length} slots; eram esperados exatamente 11`
  const ordered = [...slots].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
  if (!ordered.every((slot, index) => slot.slot === index)) return 'os identificadores de slot não formam a sequência única 0–10'
  const links = ordered.map(slot => slot.ip_to_oop_link)
  if (!links.every(link => link !== null && link >= 0 && link <= 10) || new Set(links).size !== 11) return 'a permutação IP→OOP não é bijetiva em 0–10'
  return null
}
function assignmentShape(value: unknown) {
  const assignment = record(value)
  return [text(assignment.nodeId), text(assignment.position), text(assignment.roleId), text(assignment.roleCode)]
}
function structureSignature(tacticValue: unknown) {
  const tactic = record(tacticValue)
  const ip = Array.isArray(tactic.ipAssignments) ? tactic.ipAssignments.map(assignmentShape) : []
  const oop = Array.isArray(tactic.oopAssignments) ? tactic.oopAssignments.map(assignmentShape) : []
  return JSON.stringify({ ip, oop })
}
function sourceIdentity(candidate: RawTacticCandidate) { return `fm26-save:human-eid:${candidate.human_eid}:club:${candidate.root_team_id}:selected-tactic` }
function tacticId(candidate: RawTacticCandidate) { return `fm26-human-${candidate.human_eid}-club-${candidate.root_team_id}` }

export function buildImportedFmTactic(values: unknown[], context: FmTacticImportContext): FmTacticImportPlan {
  const candidates = values.map(parseCandidate).filter((value): value is RawTacticCandidate => value !== null)
  if (!candidates.length) return { status: 'none', code: 'no_resolved_tactic', diagnostic: 'Nenhuma tática de human manager foi resolvida com segurança no arquivo .fm.' }
  if (candidates.length > 1) return { status: 'blocked', code: 'multiple_resolved_tactics', diagnostic: `${candidates.length} táticas de human managers foram resolvidas; não há seleção inequívoca para persistência automática.` }
  const candidate = candidates[0]
  if (!candidate.tactic_name) return { status: 'blocked', code: 'missing_tactic_name', diagnostic: 'A tática foi resolvida, mas o nome não possui identidade textual segura.' }
  if (candidate.record_start === null) return { status: 'blocked', code: 'missing_tactic_identity', diagnostic: 'A tática foi resolvida, mas o endereço do registro binário não foi preservado para formar uma identidade auditável.' }
  if (candidate.human_eid === null) return { status: 'blocked', code: 'missing_human_identity', diagnostic: 'A tática foi resolvida, mas o EID do human manager não foi identificado com segurança.' }
  if (candidate.root_team_id === null) return { status: 'blocked', code: 'missing_manager_club', diagnostic: 'A tática foi resolvida, mas o clube do human manager não foi identificado com segurança.' }
  const slotError = validateSlots(candidate.slots)
  if (slotError) return { status: 'blocked', code: 'invalid_tactic_structure', diagnostic: slotError }

  const ipAssignments: ImportedTacticAssignment[] = []; const oopAssignments: ImportedTacticAssignment[] = []
  const nodes: Record<TacticPhase, Set<string>> = { IP: new Set(), OOP: new Set() }; const roles = new Map<string, ImportedTacticRole>()
  for (const slot of [...candidate.slots].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))) {
    for (const phase of ['IP', 'OOP'] as const) {
      const mapped = assignmentFor(slot, phase)
      if (!mapped.assignment) return { status: 'blocked', code: 'unmapped_tactic_slot', diagnostic: mapped.error ?? 'slot sem mapeamento seguro' }
      const assignment = mapped.assignment
      if (nodes[phase].has(assignment.nodeId)) return { status: 'blocked', code: 'duplicate_tactic_node', diagnostic: `Dois slots ${phase} convergem para ${assignment.nodeId}; nenhuma lateralidade será inventada.` }
      nodes[phase].add(assignment.nodeId); (phase === 'IP' ? ipAssignments : oopAssignments).push(assignment)
      if (!roles.has(assignment.roleId)) roles.set(assignment.roleId, { id: assignment.roleId, name: assignment.roleName, weights: canonicalRoleDefaultWeights(assignment.roleId, assignment.roleName) })
    }
  }
  const tactic: ImportedFmTactic = { id: tacticId(candidate), name: candidate.tactic_name, ipAssignments, oopAssignments, lineup: {}, roles: [...roles.values()] }
  const source: FmTacticSource = {
    source: 'fm26-save', source_identity: sourceIdentity(candidate), file_hash: context.fileHash, file_name: context.fileName,
    snapshot_date: context.snapshotDate, manager_index: candidate.manager_index, manager_name: candidate.manager_name,
    human_eid: candidate.human_eid, human_record_offset: candidate.human_record_offset, root_team_id: candidate.root_team_id,
    tactic_record_start: candidate.record_start, tactic_name: candidate.tactic_name, structure_signature: structureSignature(tactic),
  }
  return { status: 'ready', tactic, source, diagnostic: `Tática "${candidate.tactic_name}" mapeada com 11 slots; lineup não foi inferida sem vínculo inequívoco UID→player UUID.` }
}

function tacticIdOf(value: unknown): string | null { const id = record(value).id; return text(id) }
function parseSources(value: unknown): { sources: FmTacticSourceMap } | { error: string } {
  if (value === null || value === undefined) return { sources: {} }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'fm_tactic_sources existente não é um objeto válido.' }
  const sources: FmTacticSourceMap = {}
  for (const [id, sourceValue] of Object.entries(value as UnknownRecord)) {
    const source = record(sourceValue)
    if (source.source !== 'fm26-save' || !text(source.source_identity) || !text(source.structure_signature)) return { error: `provenance da tática ${id} está malformada ou não possui estrutura importada auditável.` }
    sources[id] = source as FmTacticSource
  }
  return { sources }
}
function preservedRoles(existingValue: unknown, incoming: ImportedTacticRole[]) {
  const existing = Array.isArray(existingValue) ? existingValue.map(record) : []
  return incoming.map(role => {
    const current = existing.find(item => item.id === role.id)
    const weights = current && current.weights && typeof current.weights === 'object' && !Array.isArray(current.weights) ? current.weights as Record<string, number> : role.weights
    return { ...role, weights }
  })
}

export function mergeImportedFmTactic(existingTacticsValue: unknown, existingSourcesValue: unknown, tactic: ImportedFmTactic, source: FmTacticSource): FmTacticMergeResult {
  const existingTactics = existingTacticsValue === null || existingTacticsValue === undefined ? [] : existingTacticsValue
  if (!Array.isArray(existingTactics)) return { status: 'blocked', code: 'invalid_existing_tactics', diagnostic: 'model_config.tactics existente não é um array; nenhuma escrita automática foi feita.' }
  if (existingTactics.some(item => tacticIdOf(item) === null)) return { status: 'blocked', code: 'invalid_existing_tactic_entry', diagnostic: 'Há uma tática existente sem ID válido; nenhuma escrita automática foi feita.' }
  const parsed = parseSources(existingSourcesValue); if ('error' in parsed) return { status: 'blocked', code: 'invalid_existing_sources', diagnostic: parsed.error }
  const tacticIds = new Set(existingTactics.map(item => tacticIdOf(item) as string))
  const sources = Object.fromEntries(Object.entries(parsed.sources).filter(([id]) => tacticIds.has(id))) as FmTacticSourceMap
  const matching = Object.entries(sources).filter(([, item]) => item.source_identity === source.source_identity).map(([id]) => id)
  if (matching.length > 1) return { status: 'blocked', code: 'ambiguous_existing_source', diagnostic: 'Mais de uma tática existente declara a mesma identidade de origem .fm; nenhuma foi sobrescrita.' }
  if (matching.length === 1) {
    const existingId = matching[0]; const existing = existingTactics.find(item => tacticIdOf(item) === existingId) as UnknownRecord | undefined
    const previousSource = sources[existingId]
    if (!existing || structureSignature(existing) !== previousSource.structure_signature) return { status: 'blocked', code: 'existing_tactic_structure_changed', diagnostic: 'A estrutura da tática importada foi editada manualmente desde o último .fm; o update automático foi recusado.' }
    const currentName = text(existing.name) ?? tactic.name
    const currentLineup = existing.lineup && typeof existing.lineup === 'object' && !Array.isArray(existing.lineup) ? existing.lineup as Record<string, string | null> : {}
    const updated: ImportedFmTactic = { ...tactic, id: existingId, name: currentName, lineup: currentLineup, roles: preservedRoles(existing.roles, tactic.roles) }
    const nextSource = { ...source, structure_signature: structureSignature(updated) }
    return { status: 'ready', action: 'updated', tactics: existingTactics.map(item => tacticIdOf(item) === existingId ? updated : item) as ImportedFmTactic[], sources: { ...sources, [existingId]: nextSource }, diagnostic: `Tática .fm existente (${existingId}) atualizada pela mesma origem; nome, lineup e pesos customizados foram preservados.` }
  }
  if (tacticIds.has(tactic.id)) return { status: 'blocked', code: 'manual_id_collision', diagnostic: `Já existe uma tática com o ID ${tactic.id}, mas sem provenance .fm correspondente; ela foi tratada como manual e preservada.` }
  return { status: 'ready', action: 'created', tactics: [...existingTactics, tactic] as ImportedFmTactic[], sources: { ...sources, [tactic.id]: source }, diagnostic: `Tática .fm ${tactic.id} adicionada sem alterar táticas manuais existentes.` }
}
