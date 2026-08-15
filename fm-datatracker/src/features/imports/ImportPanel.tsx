import { useState } from 'react'
import { parseCsv } from '../../lib/importer'
import type { ImportPreview } from '../../types/domain'

export function ImportPanel() {
  const [preview, setPreview] = useState<ImportPreview | null>(null); const [error, setError] = useState('')
  async function choose(file?: File) { if (!file) return; try { setError(''); setPreview(parseCsv(await file.text(), file.name)) } catch (cause) { setError(`Falha durante a leitura do CSV. Nenhum dado foi salvo. ${cause instanceof Error ? cause.message : ''}`) } }
  return <section><div className="title-row"><div><span className="eyebrow">IMPORTAÇÃO SEGURA</span><h2>Novo snapshot</h2></div><label className="button">Escolher CSV<input hidden type="file" accept=".csv,text/csv" onChange={e => void choose(e.target.files?.[0])}/></label></div>{error && <p className="error">{error}</p>}{preview ? <div className="card preview"><div className="stats"><Metric label="Arquivo" value={preview.filename}/><Metric label="Tipo" value={preview.fileType}/><Metric label="Snapshot" value={preview.snapshotDate ?? 'Defina manualmente'}/><Metric label="Linhas" value={String(preview.rowCount)}/></div>{preview.warnings.map(w => <p className="warning" key={w}>⚠ {w}</p>)}<h3>Colunas detectadas</h3><div className="chips">{preview.headers.map(h => <span className={preview.ignoredColumns.includes(h) ? 'chip ignored' : 'chip'} key={h}>{h}</span>)}</div><button disabled title="A persistência será ligada após o Supabase ser configurado">Confirmar importação</button></div> : <div className="drop"><strong>Importe Squad, Stats ou Intake</strong><p>A data e o tipo serão detectados antes de qualquer persistência.</p></div>}</section>
}
function Metric({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div> }
