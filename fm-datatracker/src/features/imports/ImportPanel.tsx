import { useState } from 'react'
import { detectNameColumn, fileHash, inferSnapshotYear, parseCsv, prepareRows } from '../../lib/importer'
import { supabase } from '../../lib/supabase'
import { useSaves } from '../saves/SaveContext'
import type { ImportPreview, ImportType } from '../../types/domain'

export function ImportPanel({ onImported }: { onImported?: () => void }) {
  const { selected } = useSaves()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [date, setDate] = useState('')
  const [suggested, setSuggested] = useState(false)
  const [type, setType] = useState<ImportType>('unknown')
  const [nameColumn, setNameColumn] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose(file?: File) {
    if (!file) return
    try {
      const content = await file.text()
      const parsed = parseCsv(content, file.name)
      const column = detectNameColumn(parsed.headers)
      const year = inferSnapshotYear(prepareRows(parsed, column))
      setText(content); setPreview(parsed); setType(parsed.fileType); setNameColumn(column)
      setDate(year ? `${year}-01-01` : ''); setSuggested(Boolean(year)); setResult(null); setError('')
    } catch (caught) {
      setError(`Falha na leitura. Nenhum dado foi salvo. ${caught instanceof Error ? caught.message : ''}`)
    }
  }

  async function confirm() {
    if (!preview || !selected || !supabase) return
    if (!date) return setError('Escolha a data deste snapshot.')
    if (type === 'unknown') return setError('Escolha o tipo do arquivo.')
    if (!nameColumn) return setError('Selecione qual coluna contém o nome do jogador.')
    const rows = prepareRows(preview, nameColumn)
    if (!rows.length) return setError(`A coluna “${nameColumn}” não contém nomes.`)
    setBusy(true); setError('')
    const { data, error: persistenceError } = await supabase.rpc('import_fm_export', {
      p_save_id: selected.id, p_filename: preview.filename, p_file_type: type, p_snapshot_date: date,
      p_file_hash: await fileHash(text), p_delimiter: preview.delimiter, p_warnings: preview.warnings, p_rows: rows,
    })
    setBusy(false)
    if (persistenceError) setError(`Falha na persistência: ${persistenceError.message}. Nenhum import deve ser considerado concluído.`)
    else { setResult(data as Record<string, unknown>); onImported?.() }
  }

  const recognized = preview && nameColumn ? prepareRows(preview, nameColumn) : []
  return <section className="import-panel">
    <div className="title-row"><div><span className="eyebrow">IMPORTAÇÃO SEGURA</span><h2>Novo snapshot</h2><p>Quando idade e nascimento permitem, sugerimos 01/01 do ano mais provável. Você pode corrigir a data.</p></div><label className="button">Escolher CSV<input hidden type="file" accept=".csv,text/csv" onChange={event => void choose(event.target.files?.[0])} /></label></div>
    {error && <p className="error">{error}</p>}
    {result && <div className="notice"><strong>{result.duplicate ? 'Arquivo duplicado — nada foi alterado.' : 'Import concluído.'}</strong><br />{String(result.rows ?? 0)} linhas · {String(result.new_players ?? 0)} novos · {String(result.updated_players ?? 0)} reconhecidos</div>}
    {preview ? <div className="card preview">
      <div className="stats"><Metric label="Arquivo" value={preview.filename} /><Metric label="Tipo" value={type} /><Metric label="Data" value={date || 'Obrigatória'} /><Metric label="Jogadores reconhecidos" value={String(recognized.length)} /></div>
      <div className="import-fields">
        <label>Data do snapshot {suggested && <small>(sugerida)</small>}<input type="date" required value={date} onChange={event => { setDate(event.target.value); setSuggested(false) }} /></label>
        <label>Tipo<select value={type} onChange={event => setType(event.target.value as ImportType)}><option value="unknown">Selecione</option><option value="squad">Squad</option><option value="stats">Stats</option><option value="intake">Intake</option></select></label>
        <label>Coluna com o nome<select value={nameColumn} onChange={event => setNameColumn(event.target.value)}><option value="">Selecione</option>{preview.headers.map(header => <option value={header} key={header}>{header}</option>)}</select></label>
      </div>
      {recognized.length > 0 && <p className="notice">Primeiro jogador: <strong>{recognized[0].current_name}</strong></p>}
      {preview.warnings.map(warning => <p className="warning" key={warning}>⚠ {warning}</p>)}
      <details className="import-debug"><summary>Colunas detectadas <small>{preview.headers.length} campos</small></summary><div className="chips">{preview.headers.map(header => <span className={preview.ignoredColumns.includes(header) ? 'chip ignored' : 'chip'} key={header}>{header}</span>)}</div></details>
      <div className="import-actions"><button disabled={busy} onClick={() => void confirm()}>{busy ? 'Importando…' : 'Confirmar importação'}</button></div>
    </div> : <div className="drop"><strong>Importe Squad, Stats ou Intake</strong><p>A data será sugerida quando houver evidência suficiente.</p></div>}
  </section>
}

function Metric({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div> }
