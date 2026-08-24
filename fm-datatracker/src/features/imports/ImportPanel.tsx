import { useMemo, useState } from 'react'
import { detectNameColumn, filesHash, inferSnapshotYear, parseCsv, prepareRows } from '../../lib/importer'
import { supabase } from '../../lib/supabase'
import type { ImportPreview, ImportType } from '../../types/domain'
import { useSaves } from '../saves/SaveContext'

type PreparedRow = ReturnType<typeof prepareRows>[number]
type OfflineRead = { players: PreparedRow[] }
type Comparison = { matched:number; csvTotal:number; fmTotal:number; coverage:number; valid:boolean; csvOnly:number; fmOnly:number }

const rowIdentity=(row:Pick<PreparedRow,'fm_player_id'|'normalized_name'|'date_of_birth'>)=>row.fm_player_id
  ? `fm:${row.fm_player_id}`
  : `bio:${row.normalized_name}:${row.date_of_birth??'unknown'}`

function comparePlayers(csvRows:PreparedRow[],fmRows:PreparedRow[]):Comparison{
  const fmKeys=new Set(fmRows.map(rowIdentity)),fmNames=new Set(fmRows.map(row=>row.normalized_name))
  const matched=csvRows.filter(row=>fmKeys.has(rowIdentity(row))||fmNames.has(row.normalized_name)).length
  const coverage=csvRows.length?matched/csvRows.length:0
  return {matched,csvTotal:csvRows.length,fmTotal:fmRows.length,coverage,valid:matched>0&&coverage>=.9,csvOnly:Math.max(0,csvRows.length-matched),fmOnly:Math.max(0,fmRows.length-matched)}
}

function mergeRows(csvRows:PreparedRow[],fmRows:PreparedRow[]){
  const byKey=new Map(csvRows.map(row=>[rowIdentity(row),row]))
  const byName=new Map(csvRows.map(row=>[row.normalized_name,row]))
  return fmRows.map(fm=>{
    const csv=byKey.get(rowIdentity(fm))??byName.get(fm.normalized_name)
    if(!csv)return fm
    return {...fm,
      age:fm.age??csv.age,club:fm.club??csv.club,squad:fm.squad??csv.squad,
      positions:fm.positions?.length?fm.positions:csv.positions,
      date_of_birth:fm.date_of_birth??csv.date_of_birth,nationality:fm.nationality??csv.nationality,
      attributes:fm.attributes?.length?fm.attributes:csv.attributes,
      raw_data:{csv:csv.raw_data,fm:fm.raw_data},
      normalized_data:{...csv.normalized_data,...fm.normalized_data,import_source:'csv+fm26-offline'}
    } as unknown as PreparedRow
  })
}

function tagRows(rows:PreparedRow[],source:string,validation:'validated'|'unverified'|'unavailable'){
  return rows.map(row=>({...row,normalized_data:{...row.normalized_data,import_source:source,fm_validation:validation}}))
}

function isoFromYear(year:number|null){return `${year??new Date().getFullYear()}-01-01`}

export function ImportPanel({onImported}:{onImported?:()=>void}){
  const {selected}=useSaves()
  const [csvFile,setCsvFile]=useState<File|null>(null)
  const [fmFile,setFmFile]=useState<File|null>(null)
  const [preview,setPreview]=useState<ImportPreview|null>(null)
  const [nameColumn,setNameColumn]=useState('')
  const [snapshotDate,setSnapshotDate]=useState('')
  const [type,setType]=useState<ImportType>('squad')
  const [fmRead,setFmRead]=useState<OfflineRead|null>(null)
  const [fmStatus,setFmStatus]=useState('')
  const [loadingFm,setLoadingFm]=useState(false)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('')
  const [shareForDiagnostics,setShareForDiagnostics]=useState(false)
  const [sendingDiagnostics,setSendingDiagnostics]=useState(false)

  const csvRows=useMemo(()=>preview?prepareRows(preview,nameColumn):[],[preview,nameColumn])
  const fmRows=useMemo(()=>fmRead?.players??[],[fmRead])
  const comparison=useMemo(()=>csvRows.length&&fmRows.length?comparePlayers(csvRows,fmRows):null,[csvRows,fmRows])
  const {importRows,importMode}=useMemo(()=>{
    if(csvRows.length&&fmRows.length){
      if(comparison?.valid)return {importRows:tagRows(mergeRows(csvRows,fmRows),'csv+fm26-offline','validated'),importMode:'validated'}
      return {importRows:tagRows(csvRows,'csv-only','unavailable'),importMode:'csv-fallback'}
    }
    if(fmRows.length)return {importRows:tagRows(fmRows,'fm26-offline-beta','unverified'),importMode:'fm-beta'}
    return {importRows:tagRows(csvRows,'csv-only','unavailable'),importMode:'csv-only'}
  },[comparison,csvRows,fmRows])
  const effectiveType=importMode==='fm-beta'||importMode==='validated'?'squad':type
  const canConfirm=Boolean(selected&&importRows.length&&!saving)

  async function chooseCsv(file:File|undefined){
    if(!file)return
    setMessage('')
    setCsvFile(file)
    const next=parseCsv(await file.text(),file.name)
    setPreview(next)
    const detected=detectNameColumn(next.headers)
    setNameColumn(detected)
    setType(next.fileType==='unknown'?'squad':next.fileType)
    setSnapshotDate(isoFromYear(inferSnapshotYear(prepareRows(next,detected))))
  }

  async function chooseFm(file:File|undefined){
    if(!file)return
    setMessage('')
    setFmFile(file)
    setFmRead(null)
    setLoadingFm(true)
    setFmStatus('Lendo o save localmente…')
    try{
      const {readFmSave}=await import('../../lib/fm26-offline-normalizer')
      const read=await readFmSave(file,setFmStatus)
      setFmRead(read as unknown as OfflineRead)
      setFmStatus(`${read.players.length} jogadores identificados pelo leitor beta.`)
    }catch(error){
      setFmStatus(`Não foi possível ler o arquivo .fm: ${error instanceof Error?error.message:'erro desconhecido'}`)
    }finally{setLoadingFm(false)}
  }

  async function uploadDiagnostics(){
    if(!shareForDiagnostics||!supabase||!selected||!fmFile||!csvFile||!comparison)return
    setSendingDiagnostics(true);setMessage('')
    try{
      const {data:{user}}=await supabase.auth.getUser()
      if(!user)throw new Error('Sua sessão expirou. Entre novamente para enviar o diagnóstico.')
      const prefix=`${user.id}/${crypto.randomUUID()}`
      const [fmUpload,csvUpload]=await Promise.all([
        supabase.storage.from('fm-reader-samples').upload(`${prefix}/${fmFile.name}`,fmFile,{upsert:false}),
        supabase.storage.from('fm-reader-samples').upload(`${prefix}/${csvFile.name}`,csvFile,{upsert:false})
      ])
      if(fmUpload.error)throw fmUpload.error
      if(csvUpload.error)throw csvUpload.error
      const {error}=await supabase.from('fm_reader_samples').insert({owner_id:user.id,save_id:selected.id,fm_path:fmUpload.data.path,csv_path:csvUpload.data.path,comparison,parser_version:'offline-v0.22'})
      if(error)throw error
      setMessage('Arquivos enviados de forma privada para diagnóstico. Obrigado por ajudar a melhorar o leitor.')
    }catch(error){setMessage(`Não foi possível enviar o diagnóstico: ${error instanceof Error?error.message:'erro desconhecido'}`)}
    finally{setSendingDiagnostics(false)}
  }

  async function confirm(){
    if(!selected||!canConfirm)return
    setSaving(true);setMessage('')
    try{
      if(!supabase)throw new Error('Banco mestre não configurado.')
      const warnings=[...(preview?.warnings??[])]
      if(importMode==='fm-beta')warnings.push('Leitura .fm em beta: campos podem estar vazios ou incorretos.')
      if(importMode==='csv-only')warnings.push('Importação CSV: recursos que dependem do arquivo .fm ficam indisponíveis.')
      if(importMode==='csv-fallback')warnings.push('A validação CSV × .fm não foi suficiente; os dados do .fm não foram usados nesta importação.')
      const {error}=await supabase.rpc('import_fm_export',{p_save_id:selected.id,p_filename:[csvFile?.name,fmFile?.name].filter(Boolean).join(' + '),p_file_hash:await filesHash([csvFile,fmFile].filter((file):file is File=>Boolean(file))),p_file_type:effectiveType,p_snapshot_date:snapshotDate||isoFromYear(inferSnapshotYear(importRows)),p_rows:importRows,p_warnings:warnings})
      if(error)throw error
      setMessage(importMode==='validated'?'Importação concluída: CSV e .fm foram validados juntos.':'Importação concluída.')
      onImported?.()
    }catch(error){setMessage(`Falha na persistência: ${error instanceof Error?error.message:'erro desconhecido'}`)}
    finally{setSaving(false)}
  }

  return <section className="import-panel">
    <div className="title-row"><div><span className="eyebrow">IMPORTAÇÃO SEGURA</span><h1>Novo Snapshot</h1><p>Envie CSV, arquivo <code>.fm</code> ou os dois para validar a leitura do save.</p></div></div>
    <div className="preview fm-import-preview">
      <div className="import-file-pickers">
        <label className="fm-file-button"><span>CSV (estável)</span><input type="file" accept=".csv,text/csv" onChange={event=>void chooseCsv(event.target.files?.[0])}/><strong>{csvFile?.name??'Escolher CSV'}</strong></label>
        <label className="fm-file-button fm-file-button-beta"><span>Save .fm (beta)</span><input type="file" accept=".fm,application/octet-stream" onChange={event=>void chooseFm(event.target.files?.[0])}/><strong>{fmFile?.name??'Escolher .fm'}</strong></label>
      </div>
      {loadingFm&&<p className="notice">{fmStatus}</p>}
      {fmFile&&!csvFile&&<p className="warning">Leitura <code>.fm</code> em construção e testes: ela pode trazer jogadores ou campos incorretos e valores vazios. Revise os dados antes de usar o snapshot.</p>}
      {csvFile&&!fmFile&&<p className="notice">O CSV continua sendo o caminho estável. Alguns dados e recursos que dependem da leitura do save não ficam disponíveis sem o arquivo <code>.fm</code>.</p>}
      {preview&&<>
        <div className="stats"><div><span>Arquivo CSV</span><strong>{preview.filename}</strong></div><div><span>Tipo</span><strong>{type}</strong></div><div><span>Jogadores reconhecidos</span><strong>{csvRows.length}</strong></div><div><span>Data sugerida</span><strong>{snapshotDate||'—'}</strong></div></div>
        <div className="import-fields"><label>Data do snapshot<input value={snapshotDate} onChange={event=>setSnapshotDate(event.target.value)} placeholder="AAAA-MM-DD"/></label><label>Tipo<select value={type} onChange={event=>setType(event.target.value as ImportType)}><option value="squad">Elenco</option><option value="intake">Intake</option><option value="stats">Estatísticas</option></select></label><label>Coluna com o nome<select value={nameColumn} onChange={event=>setNameColumn(event.target.value)}>{preview.headers.map(header=><option key={header} value={header}>{header}</option>)}</select></label></div>
        {csvRows.length===0&&<p className="warning">Nenhum jogador com nome foi encontrado. Escolha uma coluna de nome válida.</p>}
        <details className="import-debug"><summary>Colunas detectadas <small>{preview.headers.length} colunas · abrir apenas para conferir o mapeamento</small></summary><div className="chips">{preview.headers.map(header=><span key={header} className={preview.ignoredColumns.includes(header)?'chip muted':'chip'}>{header}</span>)}</div></details>
      </>}
      {fmRead&&<div className="fm-reader-status"><strong>Leitor .fm beta</strong><span>{fmStatus}</span></div>}
      {comparison&&<div className={`fm-comparison ${comparison.valid?'valid':'invalid'}`}><strong>{comparison.valid?'Leitura validada':'Validação incompleta'}</strong><span>{comparison.matched} de {comparison.csvTotal} jogadores do CSV foram identificados no <code>.fm</code> ({Math.round(comparison.coverage*100)}%).</span>{comparison.valid?<small>Os dados do .fm serão combinados ao CSV para habilitar recursos que dependem do save.</small>:<small>Por segurança, esta importação usará apenas o CSV; recursos do .fm permanecem desabilitados.</small>}</div>}
      {comparison&&!comparison.valid&&<div className="diagnostic-consent"><label><input type="checkbox" checked={shareForDiagnostics} onChange={event=>setShareForDiagnostics(event.target.checked)}/> Autorizo o envio privado destes dois arquivos para diagnóstico e melhoria do leitor.</label><button className="ghost" disabled={!shareForDiagnostics||sendingDiagnostics} onClick={()=>void uploadDiagnostics()}>{sendingDiagnostics?'Enviando…':'Enviar arquivos para diagnóstico'}</button></div>}
      {message&&<p className={message.startsWith('Falha')||message.startsWith('Não foi')?'warning':'notice'}>{message}</p>}
      <div className="import-actions"><button className="primary" disabled={!canConfirm} onClick={()=>void confirm()}>{saving?'Importando…':importMode==='csv-fallback'?'Importar CSV sem dados do .fm':'Confirmar importação'}</button></div>
    </div>
  </section>
}
