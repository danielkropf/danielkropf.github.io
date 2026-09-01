// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PotentialProvider, usePotential } from './PotentialContext'

const mocks = vi.hoisted(() => ({
  loadPotentialRoleCeilingModel: vi.fn(),
  loadPotentialGeneralCeilingModel: vi.fn(),
}))

vi.mock('../../lib/potential-role-ceiling-model', () => ({
  loadPotentialRoleCeilingModel: (...args: unknown[]) => mocks.loadPotentialRoleCeilingModel(...args),
}))
vi.mock('../../lib/potential-general-ceiling-model', () => ({
  loadPotentialGeneralCeilingModel: (...args: unknown[]) => mocks.loadPotentialGeneralCeilingModel(...args),
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
