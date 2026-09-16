import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ImportPanel, type ImportProgress, type ImportUpdateTarget } from './ImportPanel'
import { useSaves } from '../saves/SaveContext'
import { invalidateSaveData } from '../../lib/dataCache'
import { safeStorage, safeSessionStorage } from '../../lib/safe-storage'
import { onPrivateSessionChange } from '../../lib/private-session'
import type { Save } from '../../types/domain'

type Job = { id: string; save: Save; name: string; file?: File; updateTarget?: ImportUpdateTarget; phase: ImportProgress['phase'] | 'done'; detail: string }
type Queue = { add: (files?: File[], updateTarget?: ImportUpdateTarget) => void; automatic: boolean; setAutomatic: (value: boolean) => void; isUpdating: (id:string) => boolean }
const Context = createContext<Queue | null>(null)
const PREFERENCE = 'fm-datatracker:imports:automatic'
const INTERRUPTED = 'fm-datatracker:imports:pending'
export function useImportQueue() { const value=useContext(Context); if(!value)throw new Error('ImportQueueProvider ausente'); return value }
export function ImportQueueProvider({children}:{children:ReactNode}) {
  const {selected}=useSaves()
  const [jobs,setJobs]=useState<Job[]>([]), [active,setActive]=useState<string|null>(null)
  const [automatic,setAutomaticState]=useState(()=>safeStorage.getItem(PREFERENCE)==='true')
  const [open,setOpen]=useState(false), [notice,setNotice]=useState('')
  const pending=jobs.filter(j=>j.phase!=='done').length
  const jobsRef=useRef(jobs);jobsRef.current=jobs
  useEffect(()=>{
    if(safeSessionStorage.getItem(INTERRUPTED))setNotice('A página foi recarregada com tarefas pendentes. Selecione os arquivos novamente. Se uma gravação já terminou, o mesmo arquivo será reconhecido como duplicado.')
    const reset=()=>{setJobs([]);setActive(null);setNotice('');safeSessionStorage.removeItem(INTERRUPTED)}
    return onPrivateSessionChange(reset)
  },[])
  useEffect(()=>{
    if(pending)safeSessionStorage.setItem(INTERRUPTED,'true');else safeSessionStorage.removeItem(INTERRUPTED)
    const unload=(event:BeforeUnloadEvent)=>{if(pending){event.preventDefault();event.returnValue=''}}
    window.addEventListener('beforeunload',unload)
    return()=>window.removeEventListener('beforeunload',unload)
  },[pending])
  function setAutomatic(value:boolean){setAutomaticState(value);safeStorage.setItem(PREFERENCE,String(value))}
  function add(files:File[]=[],updateTarget?:ImportUpdateTarget){
    if(!selected)return
    const existing=updateTarget?jobsRef.current.find(j=>j.save.id===selected.id&&j.updateTarget?.id===updateTarget.id&&j.phase!=='done'):null
    if(existing){setActive(existing.id);setOpen(true);return}
    const added=(files.length?files:[undefined]).map(file=>({id:crypto.randomUUID(),save:selected,name:updateTarget?.original_filename??file?.name??'Novo import',file,updateTarget,phase:'idle' as const,detail:'Aguardando arquivo ou leitura.'}))
    setJobs(old=>[...old,...added]);setOpen(true)
    if(!files.length)setActive(added[0].id)
  }
  function progress(id:string,value:ImportProgress){
    const previous=jobsRef.current.find(j=>j.id===id)
    if(previous&&previous.phase!==value.phase&&(value.phase==='ready'||value.phase==='attention'))setNotice(`${previous.name}: ${value.phase==='ready'?'leitura concluída; revise e confirme a importação.':'precisa de atenção. Abra a tarefa para continuar.'}`)
    setJobs(old=>old.map(j=>j.id===id&&j.phase!=='done'?{...j,...value,name:value.fileName??j.name}:j))
  }
  function completed(id:string,summary:string){
    const job=jobsRef.current.find(j=>j.id===id);if(!job)return
    invalidateSaveData(job.save.id)
    setJobs(old=>old.map(j=>j.id===id?{...j,phase:'done',detail:summary,file:undefined}:j))
    setActive(old=>old===id?null:old);setNotice(`${job.name}: ${summary}`);setOpen(true)
  }
  return <Context.Provider value={{add,automatic,setAutomatic,isUpdating:id=>jobs.some(j=>j.updateTarget?.id===id&&j.phase!=='done')}}>{children}
    {(jobs.length>0||notice)&&<aside className="import-queue-dock" aria-label="Central de importações"><button className="button" onClick={()=>setOpen(v=>!v)}>Importações · {pending} pendente(s) {open?'▾':'▴'}</button>
      <div role="status" aria-live="polite" className="import-queue-notice">{notice&&<><span>{notice}</span><button className="ghost" aria-label="Dispensar aviso" onClick={()=>setNotice('')}>×</button></>}</div>
      {open&&<div className="import-queue-list">{jobs.map(job=><article key={job.id}><strong>{job.name}</strong><small>{job.save.name} · {job.phase==='done'?'Concluído':job.phase==='reading'?'Lendo em segundo plano':job.phase==='writing'?'Gravando na fila':job.phase==='ready'?'Pronto para confirmar':job.phase==='attention'?'Precisa de atenção':'Na fila'}</small><p>{job.detail}</p><div>{job.phase!=='done'&&<button className="ghost" onClick={()=>setActive(job.id)}>Abrir</button>}<button className="ghost" disabled={job.phase==='writing'} onClick={()=>{setJobs(old=>old.filter(j=>j.id!==job.id));setActive(old=>old===job.id?null:old)}}>{job.phase==='done'?'Dispensar':'Cancelar tarefa'}</button></div></article>)}</div>}
    </aside>}
    {jobs.filter(job=>job.phase!=='done').map(job=><div key={job.id} hidden={active!==job.id} className="import-job-host settings-overlay"><section className="import-job-dialog" role="dialog" aria-modal="true" aria-label={`Importação: ${job.name}`}><header><strong>{job.save.name} · {job.name}</strong><button className="ghost" onClick={()=>setActive(null)}>Continuar usando o site</button></header><ImportPanel pinnedSave={job.save} initialFmFile={job.file} updateTarget={job.updateTarget} autoConfirm={automatic} onProgress={value=>progress(job.id,value)} onCompleted={summary=>completed(job.id,summary)} onCancelUpdate={()=>setActive(null)}/></section></div>)}
  </Context.Provider>
}
export function ImportQueueLauncher(){
  const {selected}=useSaves(),{add,automatic,setAutomatic}=useImportQueue()
  const fileInput=useRef<HTMLInputElement>(null)
  return <section className="card"><h1>Importar arquivos</h1><p>Destino: <strong>{selected?.name??'Selecione um save'}</strong>. Você pode continuar navegando enquanto os arquivos são lidos e importados.</p><label className="import-queue-preference"><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/>Importar automaticamente após leitura e validação</label><p>{automatic?'Arquivos válidos serão gravados diretamente. Você receberá o resumo ao concluir.':'Você será avisado quando a leitura estiver pronta e poderá revisar antes de confirmar.'} Dados incompletos continuam exigindo revisão.</p><button className="button" disabled={!selected} onClick={()=>fileInput.current?.click()}>Selecionar saves .fm</button><input ref={fileInput} style={{display:'none'}} aria-label="Selecionar vários saves .fm" type="file" accept=".fm" multiple disabled={!selected} onChange={e=>{const files=Array.from(e.target.files??[]);if(files.length)add(files);e.target.value=''}}/><button className="ghost" disabled={!selected} onClick={()=>add()}>CSV ou importação combinada</button><p>Até duas leituras em paralelo; gravações seguem uma fila para preservar os dados. Mantenha esta aba aberta até concluir.</p></section>
}
