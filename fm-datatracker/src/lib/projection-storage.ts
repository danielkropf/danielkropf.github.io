import { supabase } from './supabase'
import type { ProjectionResult } from './projection-engine'
import type { ProjectionScoreType } from './projection-reference'

export type ProjectionPersistenceRecord = {
  save_id: string
  player_id: string
  snapshot_id: string
  score_type: ProjectionScoreType
  score_key: string
  current_score: number | null
  projected_score: number | null
  projection_status: string
  projection_model_version: string
  exact_age: number | null
  peak_age: number | null
  cp_percentile: number | null
  mdi: number | null
  personality_shift: number
  history_shift: number
  trajectory_quantile: number | null
  personality_source: string
  reference_version: string | null
  calculated_at: string
}

const pending = new Map<string, ProjectionPersistenceRecord>()
let timer: ReturnType<typeof setTimeout> | null = null

function key(record: ProjectionPersistenceRecord) {
  return [record.save_id, record.snapshot_id, record.score_type, record.score_key, record.projection_model_version].join('|')
}

async function flush() {
  timer = null
  if (!supabase || !pending.size) return
  const rows = [...pending.values()]
  pending.clear()
  const { error } = await supabase.from('player_projections').upsert(rows, { onConflict: 'save_id,snapshot_id,score_type,score_key,projection_model_version' })
  if (error) console.warn('Não foi possível persistir projeções calculadas.', error)
}

export function scheduleProjectionPersistence(record: ProjectionPersistenceRecord) {
  pending.set(key(record), record)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void flush() }, 700)
}

export function projectionRecordFromResult({ saveId, playerId, snapshotId, scoreType, scoreKey, currentScore, result }: {
  saveId: string
  playerId: string
  snapshotId: string
  scoreType: ProjectionScoreType
  scoreKey: string
  currentScore: number | null
  result: ProjectionResult
}): ProjectionPersistenceRecord {
  return {
    save_id: saveId,
    player_id: playerId,
    snapshot_id: snapshotId,
    score_type: scoreType,
    score_key: scoreKey,
    current_score: currentScore,
    projected_score: result.projectedScore,
    projection_status: result.status,
    projection_model_version: result.modelVersion,
    exact_age: result.exactAge,
    peak_age: result.peakAge,
    cp_percentile: result.cpPercentile,
    mdi: result.mdi,
    personality_shift: result.personalityShift,
    history_shift: result.historyShift,
    trajectory_quantile: result.trajectoryQuantile,
    personality_source: result.personalitySource,
    reference_version: result.referenceVersion,
    calculated_at: new Date().toISOString(),
  }
}
