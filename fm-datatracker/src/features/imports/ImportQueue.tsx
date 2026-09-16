import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ImportPanel, type ImportProgress, type ImportUpdateTarget } from './ImportPanel'
import { useSaves } from '../saves/SaveContext'
import { invalidateSaveData } from '../../lib/dataCache'
import { safeStorage, safeSessionStorage } from '../../lib/safe-storage'
import { onPrivateSessionChange } from '../../lib/private-session'
import { ImportProgressRing, aggregateImportProgress } from './ImportProgressRing'
import type { Save } from '../../types/domain'

type Job = { id: string; save: Save; name: string; file?: File; csvFile?: File; updateTarget?: ImportUpdateTarget; phase: ImportProgress['phase'] | 'done'; detail: string; stage?: 'reading' | 'writing'; progress?: number; confirmation: number }
type Draft = { id: string; file: File; save: Save }
type Queue = {
  add: (files?: File[], updateTarget?: ImportUpdateTarget) => void
  automatic: boolean; setAutomatic: (value: boolean) => void; isUpdating: (id: string) => boolean
  importOpen: boolean; setImportOpen: (value: boolean) => void; remaining: number; ready: number
  jobs: Job[]; drafts: Draft[]; stage: (files: File[]) => void; removeDraft: (id: string) => void
  start: () => void; review: (id: string) => void; remove: (id: string) => void; confirm: (ids: string[]) => void
}
const Context = createContext<Queue | null>(null)
const PREFERENCE = 'fm-datatracker:imports:automatic'
const INTERRUPTED = 'fm-datatracker:imports:pending'
export function useImportQueue() { const value = useContext(Context); if (!value) throw new Error('ImportQueueProvider ausente'); return value }
export function ImportQueueProvider({ children }: { children: ReactNode }) {
  const { selected } = useSaves()
  const [jobs, setJobs] = useState<Job[]>([]), [drafts, setDrafts] = useState<Draft[]>([])
  const [active, setActive] = useState<string | null>(null), [importOpen, setImportOpen] = useState(false)
  const [automatic, setAutomaticState] = useState(() => safeStorage.getItem(PREFERENCE) === 'true')
  const [notice, setNotice] = useState('')
  const pending = jobs.filter(j => j.phase !== 'done').length
  const remaining = jobs.filter(j => j.phase === 'reading' || j.phase === 'idle' && j.file).length
  const ready = jobs.filter(j => j.phase === 'ready').length
  const jobsRef = useRef(jobs); jobsRef.current = jobs
  useEffect(() => {
    if (safeSessionStorage.getItem(INTERRUPTED)) setNotice('A página foi recarregada com tarefas pendentes. Selecione os arquivos novamente; arquivos já salvos serão reconhecidos.')
    return onPrivateSessionChange(() => { setJobs([]); setDrafts([]); setActive(null); setImportOpen(false); setNotice(''); safeSessionStorage.removeItem(INTERRUPTED) })
  }, [])
  useEffect(() => {
    if (pending) safeSessionStorage.setItem(INTERRUPTED, 'true'); else safeSessionStorage.removeItem(INTERRUPTED)
    const unload = (event: BeforeUnloadEvent) => { if (pending) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [pending])
  function setAutomatic(value: boolean) { setAutomaticState(value); safeStorage.setItem(PREFERENCE, String(value)) }
  function stage(files: File[]) {
    if (!selected) return
    setDrafts(old => [...old, ...files.filter(file => /\.fm$/i.test(file.name)).map(file => ({ id: crypto.randomUUID(), file, save: selected }))])
  }
  function start() {
    if (!drafts.length) return
    setJobs(old => [...old, ...drafts.map(d => ({ id: d.id, save: d.save, name: d.file.name, file: d.file, phase: 'idle' as const, detail: 'Na fila de leitura.', confirmation: 0 }))])
    setDrafts([]); setImportOpen(false)
  }
  function add(files: File[] = [], updateTarget?: ImportUpdateTarget) {
    if (!selected) return
    if (files.length && !updateTarget) { stage(files); setImportOpen(true); return }
    const existing = updateTarget ? jobsRef.current.find(j => j.save.id === selected.id && j.updateTarget?.id === updateTarget.id && j.phase !== 'done') : null
    if (existing) { setActive(existing.id); return }
    const id = crypto.randomUUID()
    setJobs(old => [...old, { id, save: selected, name: updateTarget?.original_filename ?? 'CSV ou importação combinada', file: files.find(f => /\.fm$/i.test(f.name)), csvFile: files.find(f => /\.csv$/i.test(f.name)), updateTarget, phase: 'idle', detail: 'Selecione os arquivos para leitura.', confirmation: 0 }])
    if (!files.length) setActive(id)
    else setImportOpen(false)
  }
  function progress(id: string, value: ImportProgress) {
    const previous = jobsRef.current.find(j => j.id === id)
    if (previous && previous.phase !== value.phase && (value.phase === 'ready' || value.phase === 'attention')) setNotice(`${value.fileName ?? previous.name}: ${value.phase === 'ready' ? 'leitura concluída. Abra Import para revisar e salvar.' : 'precisa de revisão. Abra Import para continuar.'}`)
    setJobs(old => old.map(j => j.id === id && j.phase !== 'done' ? { ...j, ...value, name: value.fileName ?? j.name } : j))
  }
  function completed(id: string, summary: string) {
    const job = jobsRef.current.find(j => j.id === id); if (!job) return
    invalidateSaveData(job.save.id)
    setJobs(old => old.map(j => j.id === id ? { ...j, phase: 'done', detail: summary, progress: 100, file: undefined, csvFile: undefined } : j))
    setActive(old => old === id ? null : old); setNotice(`${job.name}: ${summary}`)
  }
  function remove(id: string) {
    if (jobsRef.current.find(j => j.id === id)?.phase === 'writing') return
    setJobs(old => old.filter(j => j.id !== id)); setActive(old => old === id ? null : old)
  }
  function confirm(ids: string[]) {
    setJobs(old => old.map(j => ids.includes(j.id) && j.phase === 'ready' ? { ...j, confirmation: j.confirmation + 1 } : j))
  }
  return <Context.Provider value={{ add, automatic, setAutomatic, isUpdating: id => jobs.some(j => j.updateTarget?.id === id && j.phase !== 'done'), importOpen, setImportOpen, remaining, ready, jobs, drafts, stage, removeDraft: id => setDrafts(old => old.filter(d => d.id !== id)), start, review: setActive, remove, confirm }}>
    {children}
    {notice && <aside className="import-notice" role="status" aria-live="polite"><span>{notice}</span><button className="ghost" onClick={() => { setImportOpen(true); setNotice('') }}>Ver imports</button><button className="ghost" aria-label="Dispensar aviso" onClick={() => setNotice('')}>×</button></aside>}
    {jobs.filter(job => job.phase !== 'done').map(job => <div key={job.id} hidden={active !== job.id} className="import-job-host settings-overlay"><section className="import-job-dialog" role="dialog" aria-modal="true" aria-label={`Resumo: ${job.name}`}><header><strong>{job.save.name} · {job.name}</strong><button className="ghost" onClick={() => { setActive(null); setImportOpen(true) }}>Voltar à lista</button></header><ImportPanel pinnedSave={job.save} initialFmFile={job.file} initialCsvFile={job.csvFile} updateTarget={job.updateTarget} autoConfirm={automatic} confirmRequest={job.confirmation} onProgress={value => progress(job.id, value)} onCompleted={summary => completed(job.id, summary)} onCancelUpdate={() => setActive(null)} /></section></div>)}
  </Context.Provider>
}
export function ImportSettings() {
  const { automatic, setAutomatic } = useImportQueue()
  return <section className="card"><h2>Importações</h2><label className="import-queue-preference"><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} />Salvar imports sem pedir confirmação</label><p>Por padrão, a leitura termina e aguarda sua revisão antes de salvar ou atualizar os dados. Ative esta opção para salvar automaticamente os arquivos que passarem nas validações. Leituras com pendências continuarão exigindo revisão.</p></section>
}
export function ImportQueueIndicator() {
  const { jobs } = useImportQueue()
  if (!jobs.length) return null
  const stage = jobs.some(j => j.phase === 'reading' || j.phase === 'idle') ? 'reading' : jobs.some(j => j.phase === 'writing') ? 'writing' : 'reading'
  const progress = aggregateImportProgress(jobs, stage)
  return <ImportProgressRing value={progress.value} complete={jobs.every(j => j.phase === 'done')} label={jobs.every(j => j.phase === 'done') ? 'Todas as tarefas concluídas' : progress.complete ? 'Leitura concluída; aguardando confirmação' : `${progress.pending} tarefas restantes`} center={progress.complete && jobs.some(j => j.phase !== 'done') ? '!' : progress.pending} />
}
const phaseLabels = { idle: 'Na fila', reading: 'Lendo arquivo', ready: 'Aguardando confirmação', attention: 'Revisão necessária', writing: 'Salvando', done: 'Salvo' }
export function ImportQueueLauncher() {
  const { selected } = useSaves(), queue = useImportQueue()
  const fileInput = useRef<HTMLInputElement>(null)
  const [checked, setChecked] = useState<string[]>([]), [expanded, setExpanded] = useState<string | null>(null)
  const ready = queue.jobs.filter(j => j.phase === 'ready')
  const chosen = ready.filter(j => checked.includes(j.id))
  return <section className="import-center"><header><h1>Importar arquivos</h1><p>Destino dos novos arquivos: <strong>{selected?.name ?? 'Selecione um save'}</strong></p></header>
    {queue.jobs.length > 0 && <div className="import-stage-progress">{(['reading','writing'] as const).map(stage => {const p=aggregateImportProgress(queue.jobs,stage);return <div className="import-overall-progress" key={stage}><ImportProgressRing value={p.value} complete={p.complete} label={stage === 'reading' ? 'Progresso de leitura' : 'Progresso de salvamento'} /><div><strong>{stage === 'reading' ? 'Leitura' : 'Salvamento'} · {p.value}%</strong><small>{stage === 'reading' ? `${ready.length} aguardando confirmação` : `${queue.jobs.filter(j=>j.phase==='done').length} salvo(s)`}</small></div></div>})}</div>}
    <div className="import-center-toolbar"><button className="button" disabled={!selected} onClick={() => fileInput.current?.click()}>{queue.drafts.length ? 'Adicionar arquivos' : 'Selecionar arquivos .fm'}</button><input ref={fileInput} hidden aria-label="Selecionar vários saves .fm" type="file" accept=".fm" multiple disabled={!selected} onChange={e => { queue.stage(Array.from(e.target.files ?? [])); e.target.value = '' }} /><button className="ghost" disabled={!selected} onClick={() => queue.add()}>CSV ou importação combinada</button></div>
    {queue.drafts.length > 0 && <section aria-label="Arquivos selecionados"><h2>Arquivos para leitura · {queue.drafts.length}</h2><ul className="import-file-list">{queue.drafts.map(d => <li key={d.id}><div><strong>{d.file.name}</strong><small>{d.save.name} · {(d.file.size / 1024 / 1024).toFixed(1)} MB</small></div><button className="ghost" aria-label={`Remover ${d.file.name}`} onClick={() => queue.removeDraft(d.id)}>Remover</button></li>)}</ul><div className="import-center-footer"><span>Você poderá continuar usando o site durante a leitura.</span><button className="button" onClick={queue.start}>Confirmar leitura de {queue.drafts.length} arquivo(s)</button></div></section>}
    {queue.jobs.length > 0 && <section aria-label="Leituras de imports"><div className="import-center-toolbar"><h2>Leituras · {queue.jobs.length}</h2>{ready.length > 0 && <><label className="import-queue-preference"><input type="checkbox" checked={chosen.length === ready.length} onChange={e => setChecked(e.target.checked ? ready.map(j => j.id) : [])} />Selecionar prontos</label><button className="button" disabled={!chosen.length} onClick={() => { queue.confirm(chosen.map(j => j.id)); setChecked([]) }}>Salvar selecionados ({chosen.length})</button></>}</div><ul className="import-file-list">{queue.jobs.map(job => <li key={job.id} className="import-result-row"><div className="import-result-main"><ImportProgressRing value={job.phase === 'ready' || job.phase === 'done' ? 100 : job.progress ?? 0} complete={job.phase === 'ready' || job.phase === 'done'} label={`${job.name}: ${phaseLabels[job.phase]}`} /><input type="checkbox" aria-label={`Selecionar ${job.name}`} disabled={job.phase !== 'ready'} checked={job.phase === 'ready' && checked.includes(job.id)} onChange={e => setChecked(old => e.target.checked ? [...old, job.id] : old.filter(id => id !== job.id))} /><div><strong>{job.name}</strong><small>{job.save.name} · {phaseLabels[job.phase]}</small></div><div className="import-row-actions"><button className="ghost" onClick={() => job.phase === 'done' ? setExpanded(expanded === job.id ? null : job.id) : queue.review(job.id)}>Ver resumo</button>{job.phase === 'ready' && <button className="button" onClick={() => queue.confirm([job.id])}>Salvar</button>}<button className="ghost" disabled={job.phase === 'writing'} onClick={() => queue.remove(job.id)}>{job.phase === 'done' ? 'Dispensar' : 'Descartar'}</button></div></div>{(job.phase !== 'done' || expanded === job.id) && <p>{job.detail}</p>}</li>)}</ul></section>}
    {!queue.jobs.length && !queue.drafts.length && <p className="import-empty">Selecione um ou mais arquivos, confira a lista e confirme a leitura. Depois, revise os resultados para salvar.</p>}
  </section>
}
