import { useEffect } from 'react'
import { ScoreBadge } from './ScoreBadge'
import { usePotential } from '../features/potential/PotentialContext'
import { useSaves } from '../features/saves/SaveContext'
import { projectScore, type ProjectionResult } from '../lib/projection-engine'
import { projectionInputForSnapshot, type ProjectionSnapshot } from '../lib/projection-player'
import { projectionRecordFromResult, scheduleProjectionPersistence } from '../lib/projection-storage'
import { percentile } from '../lib/reference'
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

function unavailableLabel(result: ProjectionResult) {
  if (result.status === 'missing_cp') return 'Projeção indisponível: CP não encontrado neste snapshot.'
  if (result.status === 'missing_score') return 'Projeção indisponível: nota atual não disponível.'
  if (result.status === 'missing_age') return 'Projeção indisponível: data de nascimento ou data do save não disponível.'
  if (result.status === 'peak_reached') return 'Pico etário de projeção atingido.'
  if (result.status === 'unsupported_position') return 'Projeção indisponível: familiaridade insuficiente para esta função.'
  return 'Projeção indisponível: referência de desenvolvimento não carregada.'
}

export function ScoreWithProjection({
  playerId,
  currentScore,
  currentRank = null,
  rankPopulation = [],
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
  useEffect(() => {
    if (!projection || !input || !selected?.id || !playerId || !snapshot?.id || potential.experimental) return
    scheduleProjectionPersistence(projectionRecordFromResult({ saveId: selected.id, playerId, snapshotId: snapshot.id, scoreType, scoreKey: input.scoreKey, currentScore, result: projection }))
  }, [projection?.status, projection?.projectedScore, projection?.trajectoryQuantile, projection?.referenceVersion, input?.scoreKey, selected?.id, playerId, snapshot?.id, scoreType, currentScore, potential.experimental])
  const projectedRank = projection?.status === 'ok'
    ? (rankPopulation.length ? percentile(projection.projectedScore!, rankPopulation) : currentRank)
    : null

  const projectionTooltip = projection?.status === 'ok'
    ? potential.experimental
      ? (scoreType === 'general'
        ? 'Projeção experimental no pico\nReferência alpha1 para teste do fluxo; ainda não validada para precisão. O CP do Football Manager não é exibido.'
        : 'Projeção experimental nesta função no pico\nA alpha1 reutiliza o delta genérico apenas para teste visual; ainda não validada para precisão.')
      : projectionTitle ?? (scoreType === 'general' ? 'Projeção média no pico\nEstimativa do DataTracker; não é o CP do Football Manager.' : 'Projeção média nesta função no pico\nEstimativa do DataTracker; não é o CP do Football Manager.')
    : projection ? unavailableLabel(projection) : ''

  return <span className={`score-with-projection score-projection-${variant} ${opacityState === 'coverage' ? 'is-coverage' : ''} ${className}`.trim()}>
    <span className="score-current" title={currentTitle}><ScoreBadge value={currentScore} rank={currentRank} className="score-badge-compact" showTitle={false} /></span>
    {potential.showPotential && <>
      <span className="score-projection-separator" aria-hidden="true">›</span>
      <span className={`score-projected ${projection?.status === 'ok' ? 'is-available' : 'is-unavailable'} ${potential.experimental ? 'is-experimental' : ''}`} title={projectionTooltip}>
        <span className="score-projection-arrow" aria-hidden="true">↗</span>
        {projection?.status === 'ok' ? <ScoreBadge value={projection.projectedScore} rank={projectedRank} className="score-badge-compact projected-score-badge" showTitle={false} /> : <span className="projected-score-empty">—</span>}
      </span>
    </>}
  </span>
}
