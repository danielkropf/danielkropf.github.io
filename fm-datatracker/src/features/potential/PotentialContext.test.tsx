// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PotentialProvider, usePotential } from './PotentialContext'
import { ScoreWithProjection } from '../../components/ScoreWithProjection'

const mocks = vi.hoisted(() => ({
  loadPotentialRoleCeilingModel: vi.fn(),
  loadPotentialGeneralCeilingModel: vi.fn(),
  roleCeiling: vi.fn(),
  generalCeiling: vi.fn(),
}))

vi.mock('../../lib/potential-role-ceiling-model', () => ({
  loadPotentialRoleCeilingModel: (...args: unknown[]) => mocks.loadPotentialRoleCeilingModel(...args),
}))
vi.mock('../../lib/potential-general-ceiling-model', () => ({
  loadPotentialGeneralCeilingModel: (...args: unknown[]) => mocks.loadPotentialGeneralCeilingModel(...args),
}))
vi.mock('../../lib/potential-role-ceiling', () => ({
  potentialRoleCeilingForSnapshot: (...args: unknown[]) => mocks.roleCeiling(...args),
  potentialRoleUnavailableLabel: () => 'role unavailable',
}))
vi.mock('../../lib/potential-general-ceiling', () => ({
  potentialGeneralCeilingForSnapshot: (...args: unknown[]) => mocks.generalCeiling(...args),
  potentialGeneralUnavailableLabel: () => 'general unavailable',
}))

function Probe() {
  const potential = usePotential()
  return <>
    <button type="button" onClick={() => potential.setShowPotential(true)}>Ativar</button>
    <button type="button" onClick={() => potential.setShowPotential(false)}>Desativar</button>
    <span data-testid="status">{potential.ceilingStatus}</span>
    <span data-testid="model">{potential.ceilingModel?.manifest.potentialModelVersion ?? 'none'}</span>
    <span data-testid="general-status">{potential.generalCeilingStatus}</span>
    <span data-testid="general-model">{potential.generalCeilingModel?.manifest.potentialModelVersion ?? 'none'}</span>
  </>
}

beforeEach(() => {
  mocks.loadPotentialRoleCeilingModel.mockReset()
  mocks.loadPotentialGeneralCeilingModel.mockReset().mockResolvedValue({ manifest: { potentialModelVersion: 'pccgs-profileq95-coarseq90-phasefloor-20260901-v2' }, model: { profile: { featureCount: 62, trees: [] }, coarse: { featureCount: 15, trees: [] } } })
  mocks.roleCeiling.mockReset().mockReturnValue({ status: 'AVAILABLE', plausibleCareerCeilingRoleScore: 14, potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1' })
  mocks.generalCeiling.mockReset().mockReturnValue({ status: 'AVAILABLE', currentGeneralScore: 11, plausibleCareerCeilingGeneralScore: 15, potentialModelVersion: 'pccgs-profileq95-coarseq90-phasefloor-20260901-v2' })
  localStorage.clear()
})

afterEach(cleanup)

describe('PotentialProvider function-ceiling lifecycle', () => {
  it('keeps the pending model request active when status changes to loading', async () => {
    let resolveModel!: (model: unknown) => void
    mocks.loadPotentialRoleCeilingModel.mockImplementation(() => new Promise(resolve => { resolveModel = resolve }))

    render(<PotentialProvider><Probe /></PotentialProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('loading'))

    await act(async () => {
      resolveModel({
        manifest: { potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1' },
        model: { phase: {}, individualRoleCount: 83 },
      })
    })

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(screen.getByTestId('model').textContent).toBe('pccrs-phase-hgbq925-20260901-v1.1')
    expect(mocks.loadPotentialRoleCeilingModel).toHaveBeenCalledTimes(1)
  })

  it('keeps the General model request active when status changes to loading', async () => {
    mocks.loadPotentialRoleCeilingModel.mockResolvedValue({ manifest: { potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1' }, model: { phase: {}, individualRoleCount: 83 } })
    let resolveModel!: (model: unknown) => void
    mocks.loadPotentialGeneralCeilingModel.mockImplementation(() => new Promise(resolve => { resolveModel = resolve }))
    render(<PotentialProvider><Probe /></PotentialProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(screen.getByTestId('general-status').textContent).toBe('loading'))
    await act(async () => resolveModel({ manifest: { potentialModelVersion: 'pccgs-profileq95-coarseq90-phasefloor-20260901-v2' }, model: { profile: { featureCount: 62, trees: [] }, coarse: { featureCount: 15, trees: [] } } }))
    await waitFor(() => expect(screen.getByTestId('general-status').textContent).toBe('ready'))
    expect(screen.getByTestId('general-model').textContent).toBe('pccgs-profileq95-coarseq90-phasefloor-20260901-v2')
    expect(mocks.loadPotentialGeneralCeilingModel).toHaveBeenCalledTimes(1)
  })

  it('allows a failed pair of assets to be retried after toggling off and on', async () => {
    mocks.loadPotentialRoleCeilingModel.mockRejectedValueOnce(new Error('role offline')).mockResolvedValueOnce({ manifest: { potentialModelVersion: 'role-recovered' }, model: { phase: {}, individualRoleCount: 83 } })
    mocks.loadPotentialGeneralCeilingModel.mockRejectedValueOnce(new Error('general offline')).mockResolvedValueOnce({ manifest: { potentialModelVersion: 'general-recovered' }, model: { profile: { featureCount: 62, trees: [] }, coarse: { featureCount: 15, trees: [] } } })
    render(<PotentialProvider><Probe /></PotentialProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('invalid'))
    await waitFor(() => expect(screen.getByTestId('general-status').textContent).toBe('invalid'))

    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    await waitFor(() => expect(screen.getByTestId('general-status').textContent).toBe('ready'))
    expect(mocks.loadPotentialRoleCeilingModel).toHaveBeenCalledTimes(2)
    expect(mocks.loadPotentialGeneralCeilingModel).toHaveBeenCalledTimes(2)
  })
})


const scoreSnapshot = {
  snapshot_date: '2026-09-01', age: 18, positions: ['M (C)'], club: 'Fluminense', squad: 'Principal',
  preferred_foot: 'right', height: 180, weight: 75, player_attributes: [], raw_data: {}, normalized_data: {},
} as any

async function activatePotential() {
  fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
  await waitFor(() => expect(screen.getByTestId('general-status').textContent).toBe('ready'))
}

describe('ScoreWithProjection performance invariants', () => {
  it('reuses General Potential only for the same player/snapshot/model inputs', async () => {
    mocks.loadPotentialRoleCeilingModel.mockResolvedValue({ manifest: { potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1' }, model: { phase: {}, individualRoleCount: 83 } })
    const view = render(<PotentialProvider><Probe /></PotentialProvider>)
    await activatePotential()
    mocks.generalCeiling.mockClear()

    const score = (snapshot: typeof scoreSnapshot, className = '') => <PotentialProvider><><Probe /><ScoreWithProjection playerId="player-a" currentScore={11} currentRank={50} rankPopulation={[10, 11, 12]} snapshot={snapshot} scoreType="general" variant="compact" className={className} /></></PotentialProvider>
    view.rerender(score(scoreSnapshot))
    expect(mocks.generalCeiling).toHaveBeenCalledTimes(1)

    view.rerender(score(scoreSnapshot, 'parent-only-change'))
    expect(mocks.generalCeiling).toHaveBeenCalledTimes(1)

    view.rerender(score({ ...scoreSnapshot }, 'parent-only-change'))
    expect(mocks.generalCeiling).toHaveBeenCalledTimes(2)
  })

  it('reuses role Potential only for the same player/snapshot/function/model inputs', async () => {
    mocks.loadPotentialRoleCeilingModel.mockResolvedValue({ manifest: { potentialModelVersion: 'pccrs-phase-hgbq925-20260901-v1.1' }, model: { phase: {}, individualRoleCount: 83 } })
    const view = render(<PotentialProvider><Probe /></PotentialProvider>)
    await activatePotential()
    mocks.roleCeiling.mockClear()

    const score = (scoreKey: string, className = '') => <PotentialProvider><><Probe /><ScoreWithProjection playerId="player-a" currentScore={12} snapshot={scoreSnapshot} scoreType="function" scoreKey={scoreKey} variant="compact" className={className} /></></PotentialProvider>
    view.rerender(score('IP:M(C):AP|OOP:DM(C):DM'))
    expect(mocks.roleCeiling).toHaveBeenCalledTimes(1)

    view.rerender(score('IP:M(C):AP|OOP:DM(C):DM', 'parent-only-change'))
    expect(mocks.roleCeiling).toHaveBeenCalledTimes(1)

    view.rerender(score('IP:M(C):CM|OOP:DM(C):DM', 'parent-only-change'))
    expect(mocks.roleCeiling).toHaveBeenCalledTimes(2)
  })
})
