import { useEffect } from 'react'
import { ScoreBadge } from './ScoreBadge'
import { usePotential } from '../features/potential/PotentialContext'
import { useSaves } from '../features/saves/SaveContext'
import { projectScore, type ProjectionResult } from '../lib/projection-engine'
import { projectionInputForSnapshot, type ProjectionSnapshot } from '../lib/projection-player'
import { projectionRecordFromResult, scheduleProjectionPersistence } from '../lib/projection-storage'
import type { ProjectionScoreType } from '../lib/projection-reference'

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

const PROVISIONAL_TOOLTIP = 'Projeção experimental baseada na evolução longitudinal observada nos saves de referência atualmente disponíveis. Será recalibrada conforme novos dados forem adicionados.'

function unavailableLabel(result: ProjectionResult) {
  if (result.status === 'missing_score') return 'Projeção indisponível: nota-base atual não disponível.'
  if (result.status === 'missing_age') return 'Projeção indisponível: data de nascimento ou data do save não disponível.'
  if (result.status === 'missing_ca') return 'Projeção indisponível: CA interno não disponível neste snapshot.'
  if (result.status === 'missing_pa') return 'Projeção indisponível: PA interno não disponível neste snapshot.'
  if (result.status === 'missing_family') return 'Projeção indisponível: posição-base P0 não identificada.'
  if (result.status === 'unsupported_position') return 'Projeção indisponível: nenhuma posição-base elegível para a Nota Geral.'
  if (result.status === 'unsupported_score_type') return 'Projeção por função indisponível: ainda não existe alvo longitudinal equivalente para esta função.'
  if (result.status === 'insufficient_reference') return 'Projeção indisponível: amostra longitudinal insuficiente para esta coorte.'
  return 'Projeção indisponível: referência longitudinal v2.1 não carregada.'
}

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
  const { selected } = useSaves()
  const input = potential.showPotential && snapshot ? projectionInputForSnapshot({ snapshot, currentScore, scoreType, scoreKey, eligible, reference: potential.reference }) : null
  const projection: ProjectionResult | null = input ? projectScore(input) : null
  const displayedCurrentScore = input && scoreType === 'general' ? input.currentScore : currentScore
  const displayedCurrentRank = input && scoreType === 'general' ? null : currentRank

  useEffect(() => {
    // Projection v2.1 is explicitly provisional/calibrated=false, therefore it is never persisted as a definitive projection.
    if (!projection || !input || !selected?.id || !playerId || !snapshot?.id || potential.experimental) return
    scheduleProjectionPersistence(projectionRecordFromResult({ saveId: selected.id, playerId, snapshotId: snapshot.id, scoreType, scoreKey: input.scoreKey, currentScore: input.currentScore, result: projection }))
  }, [projection?.status, projection?.projectedScore, projection?.trajectoryQuantile, projection?.referenceVersion, input?.scoreKey, input?.currentScore, selected?.id, playerId, snapshot?.id, scoreType, potential.experimental])

  const projectionTooltip = projection?.status === 'ok'
    ? potential.experimental
      ? (projectionTitle ? `${projectionTitle}\n${PROVISIONAL_TOOLTIP}` : PROVISIONAL_TOOLTIP)
      : projectionTitle ?? 'Projeção DataTracker'
    : projection ? unavailableLabel(projection) : ''

  return <span className={`score-with-projection score-projection-${variant} ${opacityState === 'coverage' ? 'is-coverage' : ''} ${className}`.trim()}>
    <span className="score-current" title={currentTitle}><ScoreBadge value={displayedCurrentScore} rank={displayedCurrentRank} className="score-badge-compact" showTitle={false} /></span>
    {potential.showPotential && <>
      <span className="score-projection-separator" aria-hidden="true">›</span>
      <span className={`score-projected ${projection?.status === 'ok' ? 'is-available' : 'is-unavailable'} ${potential.experimental ? 'is-experimental' : ''}`} title={projectionTooltip}>
        <span className="score-projection-arrow" aria-hidden="true">↗</span>
        {projection?.status === 'ok' ? <ScoreBadge value={projection.projectedScore} className="score-badge-compact projected-score-badge" showTitle={false} /> : <span className="projected-score-empty">—</span>}
      </span>
    </>}
  </span>
}
