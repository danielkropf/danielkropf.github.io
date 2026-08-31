import { supabase } from './supabase'
import type { ExactRoleMatrix, ProjectedRoleScoreResult, ProjectionHorizon } from './projected-role-score'

export type ProjectedRolePersistenceRecord = {
  save_id: string
  player_id: string
  snapshot_id: string
  estimator_kind: 'fixed_horizon'
  horizon_months: ProjectionHorizon
  role_identity: string
  positional_group: string
  canonical_role_id: string | null
  is_custom_matrix: boolean
  ip_matrix_key: string | null
  oop_matrix_key: string | null
  ip_matrix_hash: string | null
  oop_matrix_hash: string | null
  current_role_score: number
  projected_role_score: number
  projected_role_gain: number
  typical_peak_through24: null
  expected_peak_through24: null
  projection_status: 'AVAILABLE'
  prediction_branch: 'COLD_START' | 'HISTORY_AWARE'
  alpha_history_applied: number
  history_span_days: number | null
  projection_model_version: string
  residual_model_version: null
  scoring_model_version: string
  role_matrix_version: string
  engine_version: string
  input_provenance_status: string
  history_support_status: string
  support_overlap_status: string
  point_estimate_validation_status: string
  prediction_interval_status: string
  external_transport_status: string
  unavailable_reason: null
  warnings: string[]
  provenance: Record<string, unknown>
  calculated_at: string
}

export function projectedRoleRecordsFromResult(input: {
  saveId: string
  playerId: string
  snapshotId: string
  matrix: ExactRoleMatrix
  result: ProjectedRoleScoreResult
}): ProjectedRolePersistenceRecord[] {
  const { saveId, playerId, snapshotId, matrix, result } = input
  if (result.status !== 'AVAILABLE' || !result.projectionModelVersion || result.currentRoleScore === null) return []
  const currentRoleScore = result.currentRoleScore
  const projectionModelVersion = result.projectionModelVersion
  return ([12, 24, 36] as const).flatMap(horizon => {
    const projected = result.horizons[horizon]
    if (projected.status !== 'AVAILABLE' || projected.projectedRoleScore === null || projected.projectedRoleGain === null || !projected.predictionBranch) return []
    return [{
      save_id: saveId,
      player_id: playerId,
      snapshot_id: snapshotId,
      estimator_kind: 'fixed_horizon' as const,
      horizon_months: horizon,
      role_identity: matrix.roleIdentity,
      positional_group: matrix.positionalGroup,
      canonical_role_id: matrix.canonicalRoleId ?? null,
      is_custom_matrix: matrix.custom,
      ip_matrix_key: matrix.ipMatrixKey ?? null,
      oop_matrix_key: matrix.oopMatrixKey ?? null,
      ip_matrix_hash: matrix.ipMatrixHash ?? null,
      oop_matrix_hash: matrix.oopMatrixHash ?? null,
      current_role_score: currentRoleScore,
      projected_role_score: projected.projectedRoleScore,
      projected_role_gain: projected.projectedRoleGain,
      typical_peak_through24: null,
      expected_peak_through24: null,
      projection_status: 'AVAILABLE' as const,
      prediction_branch: projected.predictionBranch,
      alpha_history_applied: projected.alphaHistoryApplied,
      history_span_days: projected.historySpanDays,
      projection_model_version: projectionModelVersion,
      residual_model_version: null,
      scoring_model_version: result.scoringModelVersion,
      role_matrix_version: result.roleMatrixVersion,
      engine_version: result.engineVersion,
      input_provenance_status: result.inputProvenanceStatus,
      history_support_status: projected.historySupportStatus,
      support_overlap_status: projected.supportOverlapStatus,
      point_estimate_validation_status: result.pointEstimateValidationStatus,
      prediction_interval_status: result.predictionIntervalStatus,
      external_transport_status: result.externalTransportStatus,
      unavailable_reason: null,
      warnings: [...result.warnings, ...projected.warnings],
      provenance: {
        projection_model_version: projectionModelVersion,
        scoring_model_version: result.scoringModelVersion,
        role_matrix_version: result.roleMatrixVersion,
        prediction_branch: projected.predictionBranch,
        alpha_history_applied: projected.alphaHistoryApplied,
        history_span_days: projected.historySpanDays,
        input_provenance_status: result.inputProvenanceStatus,
        history_support_status: projected.historySupportStatus,
        support_overlap_status: projected.supportOverlapStatus,
        point_estimate_validation_status: result.pointEstimateValidationStatus,
        prediction_interval_status: result.predictionIntervalStatus,
        external_transport_status: result.externalTransportStatus,
      },
      calculated_at: new Date().toISOString(),
    }]
  })
}

export async function persistProjectedRoleRecords(records: ProjectedRolePersistenceRecord[]) {
  if (!records.length) return
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const { error } = await supabase.from('player_role_projections').upsert(records, {
    onConflict: 'save_id,snapshot_id,estimator_kind,horizon_months,role_identity,projection_model_version,role_matrix_version',
  })
  if (error) throw new Error(error.message)
}
