import type { ReactNode } from 'react'
export function aggregateImportProgress(jobs: {phase: string; progress?: number}[]) {
  const pending = jobs.filter(job => job.phase !== 'done').length
  const value = jobs.length ? Math.round(jobs.reduce((sum, job) => sum + (job.phase === 'done' ? 100 : Math.min(99, Math.max(0, job.progress ?? 0))), 0) / jobs.length) : 0
  return { pending, value: pending ? Math.min(99, value) : value, complete: jobs.length > 0 && pending === 0 }
}
export function ImportProgressRing({value, complete = false, label, center}: {value: number; complete?: boolean; label: string; center?: ReactNode}) {
  const percentage = complete ? 100 : Math.min(99, Math.max(0, Math.round(value)))
  return <span className="import-progress-ring" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} title={`${label} · ${percentage}% por etapas`}>
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="import-progress-track" cx="18" cy="18" r="16" /><circle className="import-progress-fill" cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${percentage} 100`} /></svg>
    <span>{complete ? '✓' : center ?? `${percentage}%`}</span>
  </span>
}
