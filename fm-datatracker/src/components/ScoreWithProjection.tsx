import { ScoreBadge } from './ScoreBadge'
import { usePotential } from '../features/potential/PotentialContext'
import type { ProjectionSnapshot } from '../lib/projection-player'
import type { ProjectionScoreType } from '../lib/projection-reference'
import { shouldDisplayProjectionForAge } from '../lib/projection-visibility'
import { potentialRoleCeilingForSnapshot, potentialRoleUnavailableLabel } from '../lib/potential-role-ceiling'
import { potentialGeneralCeilingForSnapshot, potentialGeneralUnavailableLabel } from '../lib/potential-general-ceiling'

type Props = {
  playerId?: string
  currentScore: number | null
  currentRank?: number | null
  rankPopulation?: number[]
  snapshot: ProjectionSnapshot | null | undefined
  scoreType?: ProjectionScoreType
  scoreKey?: string
  eligible?: boolean
  variant?: 'inline' | 'stacked' | 'compact'
  opacityState?: 'normal' | 'coverage'
  className?: string
  currentTitle?: string
  projectionTitle?: string
}

const ROLE_CEILING_TOOLTIP = 'Potencial na função: melhor RoleScore plausível em um cenário positivo de desenvolvimento, calibrado em trajetórias reais. Os tetos IP e OOP são estimados separadamente e unidos pela média geométrica. Não é a evolução mais provável, não possui horizonte fixo e não representa o PA/CP do Football Manager.'
const GENERAL_CEILING_TOOLTIP = 'Potencial geral: melhor Nota Geral plausível em um cenário positivo de carreira. O modelo considera PA/headroom, idade, perfil completo de atributos e posições-base atuais elegíveis; o resultado nunca fica abaixo do melhor teto-base calculado pelo Potencial na função. Não é a evolução mais provável, não possui horizonte fixo e não representa o PA/CP do Football Manager.'

export function ScoreWithProjection({
  playerId,
  currentScore,
  currentRank = null,
  snapshot,
  scoreType = 'general',
  scoreKey,
  eligible = true,
  variant = 'inline',
  opacityState = 'normal',
  className = '',
  currentTitle = 'Nota atual',
  projectionTitle,
}: Props) {
  const potential = usePotential()
  const projectionVisible = potential.showPotential && shouldDisplayProjectionForAge(snapshot?.age)
  const functionPotential = scoreType === 'function' && projectionVisible
    ? potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore: currentScore, scoreKey, loadedModel: potential.ceilingModel })
    : null
  const generalPotential = scoreType === 'general' && projectionVisible
    ? potentialGeneralCeilingForSnapshot({ snapshot, loadedGeneralModel: potential.generalCeilingModel, loadedRoleModel: potential.ceilingModel })
    : null
  const displayedCurrentScore = scoreType === 'general' ? generalPotential?.currentGeneralScore ?? currentScore : currentScore
  const displayedCurrentRank = scoreType === 'general' && generalPotential?.currentGeneralScore !== null ? null : currentRank

  const availableScore = scoreType === 'function'
    ? (functionPotential?.status === 'AVAILABLE' ? functionPotential.plausibleCareerCeilingRoleScore : null)
    : (generalPotential?.status === 'AVAILABLE' ? generalPotential.plausibleCareerCeilingGeneralScore : null)
  const isAvailable = availableScore !== null
  const functionUnavailableTooltip = functionPotential?.unavailableReason === 'MODEL_ASSET_UNAVAILABLE'
    ? potential.ceilingStatus === 'loading'
      ? 'Potencial na função: carregando o asset do modelo validado.'
      : potential.ceilingStatus === 'invalid'
        ? `Potencial na função indisponível: ${potential.ceilingDetail}`
        : potentialRoleUnavailableLabel('MODEL_ASSET_UNAVAILABLE')
    : potentialRoleUnavailableLabel(functionPotential?.unavailableReason ?? 'MODEL_ASSET_UNAVAILABLE')
  const projectionTooltip = scoreType === 'function'
    ? functionPotential?.status === 'AVAILABLE'
      ? `${ROLE_CEILING_TOOLTIP}\nModelo: ${functionPotential.potentialModelVersion}`
      : functionUnavailableTooltip
    : generalPotential?.status === 'AVAILABLE'
      ? `${projectionTitle ? `${projectionTitle}\n` : ''}${GENERAL_CEILING_TOOLTIP}\nModelo: ${generalPotential.potentialModelVersion}`
      : generalPotential?.unavailableReason === 'MODEL_ASSET_UNAVAILABLE'
        ? potential.generalCeilingStatus === 'loading'
          ? 'Potencial geral: carregando o asset do modelo validado.'
          : potential.generalCeilingStatus === 'invalid'
            ? `Potencial geral indisponível: ${potential.generalCeilingDetail}`
            : potentialGeneralUnavailableLabel('MODEL_ASSET_UNAVAILABLE')
        : potentialGeneralUnavailableLabel(generalPotential?.unavailableReason ?? 'MODEL_ASSET_UNAVAILABLE')

  return <span className={`score-with-projection score-projection-${variant} ${opacityState === 'coverage' ? 'is-coverage' : ''} ${className}`.trim()}>
    <span className="score-current" title={currentTitle}><ScoreBadge value={displayedCurrentScore} rank={displayedCurrentRank} className="score-badge-compact" showTitle={false} /></span>
    {projectionVisible && <>
      <span className="score-projection-separator" aria-hidden="true">›</span>
      <span className={`score-projected ${isAvailable ? 'is-available' : 'is-unavailable'}`} title={projectionTooltip}>
        <span className="score-projection-arrow" aria-hidden="true">↗</span>
        {isAvailable ? <ScoreBadge value={availableScore} className="score-badge-compact projected-score-badge" showTitle={false} /> : <span className="projected-score-empty">—</span>}
      </span>
    </>}
  </span>
}

