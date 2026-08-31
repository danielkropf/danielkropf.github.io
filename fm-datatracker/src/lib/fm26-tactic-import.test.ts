import { describe, expect, it } from 'vitest'
import { buildImportedFmTactic, mergeImportedFmTactic } from './fm26-tactic-import'

const phase = (exact: string, role: string) => ({ position: { base: exact.replace(/[LR]$/, '') || exact, side: null, exact }, role })
const slot = (index: number, exact: string, ipRole: string, oopRole: string) => ({ slot: index, ip_to_oop_link: index, ip: phase(exact, ipRole), oop: phase(exact, oopRole) })
const safeSlots = () => [
  slot(0, 'GK', 'BGK', 'SK'), slot(1, 'DL', 'FB', 'FB'), slot(2, 'DCL', 'BCB', 'CB'), slot(3, 'DCR', 'CB', 'CB'), slot(4, 'DR', 'PWB', 'PFB'),
  slot(5, 'DML', 'DLP', 'DM'), slot(6, 'DMR', 'BBP', 'DM'), slot(7, 'AML', 'IW', 'W'), slot(8, 'AMC', 'AP', 'AM'), slot(9, 'AMR', 'W', 'W'), slot(10, 'ST', 'CFD', 'TCF'),
]
const candidate = (overrides: Record<string, unknown> = {}) => ({ manager_index: 0, manager_name: 'Manager', human_eid: 111, human_record_offset: 222, root_team_id: 333, resolved: true, name: '4-2-3-1 Test', record_start: 444, slots: safeSlots(), ...overrides })
const context = { fileHash: 'a'.repeat(64), fileName: 'save.fm', snapshotDate: '2026-08-30' }
const ready = () => { const plan = buildImportedFmTactic([candidate()], context); if (plan.status !== 'ready') throw new Error(plan.diagnostic); return plan }

describe('FM26 tactic import adapter', () => {
  it('maps a safe 11-slot tactic and characterized aliases', () => {
    const plan = ready()
    expect(plan.tactic.ipAssignments).toHaveLength(11); expect(plan.tactic.oopAssignments).toHaveLength(11); expect(plan.tactic.lineup).toEqual({})
    expect(plan.tactic.ipAssignments[0]).toMatchObject({ nodeId: 'gk', roleCode: 'BPGK' })
    expect(plan.tactic.ipAssignments[2]).toMatchObject({ nodeId: 'dcl', roleCode: 'BPCB' })
    expect(plan.tactic.ipAssignments[6]).toMatchObject({ nodeId: 'dmr', roleCode: 'B2BP' })
    expect(plan.tactic.ipAssignments[10]).toMatchObject({ nodeId: 'stc', roleCode: 'CF' })
  })

  it('fails closed for multiple human tactics, unmapped roles and duplicate pitch nodes', () => {
    expect(buildImportedFmTactic([candidate(), candidate({ manager_index: 1, human_eid: 222 })], context)).toMatchObject({ status: 'blocked', code: 'multiple_resolved_tactics' })
    const unmapped = safeSlots(); unmapped[2] = slot(2, 'DCL', 'WCB', 'CB')
    expect(buildImportedFmTactic([candidate({ slots: unmapped })], context)).toMatchObject({ status: 'blocked', code: 'unmapped_tactic_slot' })
    const duplicate = safeSlots(); duplicate[9] = slot(9, 'ST', 'P', 'CFD')
    expect(buildImportedFmTactic([candidate({ slots: duplicate })], context)).toMatchObject({ status: 'blocked', code: 'duplicate_tactic_node' })
  })

  it('creates imported tactics without overwriting manual tactics', () => {
    const plan = ready(); const manual = { id: 'manual-1', name: 'Manual', ipAssignments: [], oopAssignments: [], lineup: {}, roles: [] }
    const merged = mergeImportedFmTactic([manual], {}, plan.tactic, plan.source)
    expect(merged.status).toBe('ready'); if (merged.status !== 'ready') return
    expect(merged.action).toBe('created'); expect(merged.tactics[0]).toEqual(manual); expect(merged.sources[plan.tactic.id]?.source).toBe('fm26-save')
  })

  it('updates only the same .fm source while preserving manual name, lineup and custom role weights', () => {
    const plan = ready(); const first = mergeImportedFmTactic([], {}, plan.tactic, plan.source); if (first.status !== 'ready') throw new Error(first.diagnostic)
    const existing = first.tactics[0]
    const edited = { ...existing, name: 'Meu nome manual', lineup: { gk: 'player-uuid' }, roles: existing.roles.map(role => role.id === 'IP-ST-CF' ? { ...role, weights: { finishing: 99 } } : role) }
    const nextPlan = ready(); const second = mergeImportedFmTactic([edited], first.sources, nextPlan.tactic, nextPlan.source)
    expect(second.status).toBe('ready'); if (second.status !== 'ready') return
    expect(second.action).toBe('updated'); expect(second.tactics[0].name).toBe('Meu nome manual'); expect(second.tactics[0].lineup).toEqual({ gk: 'player-uuid' })
    expect(second.tactics[0].roles.find(role => role.id === 'IP-ST-CF')?.weights).toEqual({ finishing: 99 })
  })

  it('refuses same-source overwrite after a manual structural edit', () => {
    const plan = ready(); const first = mergeImportedFmTactic([], {}, plan.tactic, plan.source); if (first.status !== 'ready') throw new Error(first.diagnostic)
    const edited = { ...first.tactics[0], ipAssignments: first.tactics[0].ipAssignments.map((item, index) => index === 10 ? { ...item, nodeId: 'stl' } : item) }
    expect(mergeImportedFmTactic([edited], first.sources, plan.tactic, plan.source)).toMatchObject({ status: 'blocked', code: 'existing_tactic_structure_changed' })
  })

  it('treats an ID collision without provenance as manual', () => {
    const plan = ready(); expect(mergeImportedFmTactic([{ ...plan.tactic, name: 'Manual collision' }], {}, plan.tactic, plan.source)).toMatchObject({ status: 'blocked', code: 'manual_id_collision' })
  })
})
