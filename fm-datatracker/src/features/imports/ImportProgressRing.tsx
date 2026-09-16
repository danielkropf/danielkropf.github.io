import type { ReactNode } from 'react'
type ProgressJob = {phase: string; stage?: string; progress?: number}
export function aggregateImportProgress(jobs: ProgressJob[], stage: 'reading' | 'writing' = 'reading') {
  const eligible = stage === 'writing' ? jobs.filter(j => j.stage === 'writing' || j.phase === 'writing' || j.phase === 'done') : jobs
  const finished = (j: ProgressJob) => stage === 'reading' ? (j.stage === 'writing' || ['ready','writing','done'].includes(j.phase)) : j.phase === 'done'
  const pending = eligible.filter(j => !finished(j)).length
  const value = eligible.length ? Math.round(eligible.reduce((sum,j) => sum + (finished(j) ? 100 : Math.min(99, Math.max(0,j.progress ?? 0))),0)/eligible.length) : 0
  return {pending,value: pending ? Math.min(99,value) : value,complete:eligible.length > 0 && pending === 0}
}
export function ImportProgressRing({value, complete = false, label, center}: {value: number; complete?: boolean; label: string; center?: ReactNode}) {
  const percentage = complete ? 100 : Math.min(100, Math.max(0, Math.round(value)))
  return <span className="import-progress-ring" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} title={`${label} · ${percentage}% por etapas`}>
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="import-progress-track" cx="18" cy="18" r="16" /><circle className="import-progress-fill" cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${percentage} 100`} /></svg>
    <span>{complete ? '✓' : center ?? `${percentage}%`}</span>
  </span>
}
