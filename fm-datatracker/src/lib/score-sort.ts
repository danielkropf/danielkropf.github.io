import type { ProjectionSnapshot } from './projection-player'
import { shouldDisplayProjectionForAge } from './projection-visibility'
import { potentialRoleCeilingForSnapshot } from './potential-role-ceiling'
import { potentialGeneralCeilingForSnapshot } from './potential-general-ceiling'
import type { LoadedPotentialRoleCeilingModel } from './potential-role-ceiling-model'
import type { LoadedPotentialGeneralCeilingModel } from './potential-general-ceiling-model'

export function effectiveRoleSortScore({ showPotential, snapshot, currentScore, scoreKey, loadedModel }: {
  showPotential: boolean
  snapshot: ProjectionSnapshot | null | undefined
  currentScore: number | null
  scoreKey?: string
  loadedModel: LoadedPotentialRoleCeilingModel | null
}) {
  if (!showPotential || !shouldDisplayProjectionForAge(snapshot?.age)) return currentScore
  const potential = potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore: currentScore, scoreKey, loadedModel })
  return potential.status === 'AVAILABLE' && potential.plausibleCareerCeilingRoleScore !== null ? potential.plausibleCareerCeilingRoleScore : currentScore
}

export function effectiveGeneralSortScore({ showPotential, snapshot, currentScore, loadedGeneralModel, loadedRoleModel }: {
  showPotential: boolean
  snapshot: ProjectionSnapshot | null | undefined
  currentScore: number | null
  loadedGeneralModel: LoadedPotentialGeneralCeilingModel | null
  loadedRoleModel: LoadedPotentialRoleCeilingModel | null
}) {
  if (!showPotential || !shouldDisplayProjectionForAge(snapshot?.age)) return currentScore
  const potential = potentialGeneralCeilingForSnapshot({ snapshot, loadedGeneralModel, loadedRoleModel })
  return potential.status === 'AVAILABLE' && potential.plausibleCareerCeilingGeneralScore !== null ? potential.plausibleCareerCeilingGeneralScore : currentScore
}
