import { useState } from 'react'
import { useSaves } from '../features/saves/SaveContext'
import { startPlanningSeason } from '../lib/planning-maintenance'
export function SeasonStartButton() {
  const {selected,currentCheckpoint}=useSaves()
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('')
  async function start(){
    if(!selected || busy || !window.confirm('Iniciar temporada e limpar todas as marcações para venda e empréstimo deste save? Os conjuntos e elencos serão mantidos.')) return
    setBusy(true);setMessage('')
    try {await startPlanningSeason(selected.id,currentCheckpoint.date);setMessage('Temporada iniciada. Listas limpas.')}
    catch {setMessage('Não foi possível salvar. Tente novamente.')}
    finally {setBusy(false)}
  }
  return <div>{message && <button type="button" className="ghost" onClick={()=>setMessage('')}>{message}</button>}<button className="ghost" type="button" disabled={!selected || busy} onClick={()=>void start()}>{busy?'Iniciando…':'Iniciar temporada'}</button></div>
}
