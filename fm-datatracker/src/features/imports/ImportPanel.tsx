import { useEffect, useMemo, useRef, useState } from 'react'
import { chooseImportDirectory, chooseImportFile, getImportDirectoryName, IMPORT_DIRECTORY_CHANGED, supportsPersistentFilePicker, type ImportFileKind } from '../../lib/file-picker'
import { detectNameColumn, filesHash, inferSnapshotYear, isValidIsoDate, normalizeHeader, parseCsvFile, prepareRows } from '../../lib/importer'
import { matchImportRows, mergeValidatedRows, type PreparedImportRow } from '../../lib/import-match'
import { normalizedDate, normalizedFoot, normalizedText, positionsMatch } from '../../lib/fm-comparison'
import { supabase } from '../../lib/supabase'
import type { ImportPreview, ImportType } from '../../types/domain'
import { useSaves } from '../saves/SaveContext'

type PreparedRow = PreparedImportRow
type OfflineRead = { players: PreparedRow[]; diagnostics?: Record<string, unknown>; snapshot_date?: string | null; snapshot_date_precision?: 'day' | 'year' | null }
type ComparisonDifference = { player: string; field: string; csv: string; fm: string }
type DataComparison = {
  matched: number; csvTotal: number; fmTotal: number; coverage: number; valid: boolean; csvOnly: number; fmOnly: number; ambiguous: number
  checkedFields: number; matchingFields: number; divergentFields: number; unavailableFields: string[]; missingValues: number; dataCoverage: number; samples: string[]; differences: ComparisonDifference[]
}

const comparable = (value: string | null | undefined) => normalizedText(value)
const comparableNumber = (value: unknown) => {
  const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}
const readable = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value)
const csvRaw = (row: PreparedRow, names: string[]) => {
  const candidates = new Set(names.map(normalizeHeader))
  const entry = Object.entries(row.raw_data).find(([key]) => candidates.has(normalizeHeader(key)))
  return entry?.[1] ?? null
}

const unavailableFromOfflineReader = [
  'Club', 'Transfer Value', 'Wage', 'Expires (Contract)', 'Minimum Fee Release Clause',
  'Yth Apps', 'Yth Gls', 'Int Apps', 'Int Gls', 'World Reputation', 'Playing Time Happiness', 'Happiness', 'Morale',
  'Personality',
]

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const detail = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const content = [detail.message, detail.details, detail.hint].filter((value): value is string => typeof value === 'string' && Boolean(value)).join(' — ')
    return content || (typeof detail.code === 'string' ? detail.code : 'erro desconhecido')
  }
  return 'erro desconhecido'
}

function comparePlayers(csvRows: PreparedRow[], fmRows: PreparedRow[]): DataComparison {
  const association = matchImportRows(csvRows, fmRows)
  let checkedFields = 0; let matchingFields = 0; let missingValues = 0
  const samples: string[] = []
  const differences: ComparisonDifference[] = []

  for (const { csv, fm } of association.matches) {
    const compare = (label: string, left: unknown, right: unknown, normalize?: (value: unknown) => string | null) => {
      if (!comparable(left === null || left === undefined ? null : String(left)) || !comparable(right === null || right === undefined ? null : String(right))) { missingValues += 1; return }
      checkedFields += 1
      const leftComparable = normalize ? normalize(left) : comparable(String(left))
      const rightComparable = normalize ? normalize(right) : comparable(String(right))
      if (leftComparable && rightComparable && leftComparable === rightComparable) matchingFields += 1
      else {
        if (samples.length < 4) samples.push(`${csv.current_name}: ${label}`)
        if (differences.length < 30) differences.push({ player: csv.current_name, field: label, csv: readable(left), fm: readable(right) })
      }
    }

    const fmRaw = fm.raw_data as Record<string, unknown>
    if (csv.fm_player_id) compare('Unique ID', csv.fm_player_id, fm.fm_player_id)
    compare('Player (Name)', csv.current_name, fm.current_name)
    const positionChecked = csv.positions.length && fm.positions.length
    if (positionChecked) {
      checkedFields += 1
      if (positionsMatch(csv.positions, fm.positions)) matchingFields += 1
      else {
        if (samples.length < 4) samples.push(`${csv.current_name}: Position`)
        if (differences.length < 30) differences.push({ player: csv.current_name, field: 'Position', csv: csv.positions.join(', '), fm: fm.positions.join(', ') })
      }
    } else missingValues += 1
    compare('Date of Birth', csv.date_of_birth, fm.date_of_birth, normalizedDate)
    const csvAge = csvRaw(csv, ['age'])
    if (comparableNumber(csvAge) !== null && fm.age !== null) compare('Age', String(comparableNumber(csvAge)), String(fm.age))
    compare('Nation', csv.nationality, fm.nationality)
    const csvHeight = csvRaw(csv, ['height'])
    const fmHeight = fmRaw.height_cm
    if (comparableNumber(csvHeight) !== null && comparableNumber(fmHeight) !== null) compare('Height', String(comparableNumber(csvHeight)), String(comparableNumber(fmHeight)))
    const csvFoot = csvRaw(csv, ['preferred foot', 'preferred_foot'])
    const fmFoot = (fm.normalized_data as Record<string, unknown>).preferred_foot
    if (normalizedFoot(csvFoot) && normalizedFoot(fmFoot)) compare('Preferred Foot', csvFoot, fmFoot, normalizedFoot)
    const fmAttributes = new Map(fm.attributes.map(attribute => [attribute.attribute_key, attribute.value]))
    for (const attribute of csv.attributes) {
      const value = fmAttributes.get(attribute.attribute_key)
      if (value === undefined) continue
      checkedFields += 1
      if (value === attribute.value) matchingFields += 1
      else {
        if (samples.length < 4) samples.push(`${csv.current_name}: ${attribute.attribute_label}`)
        if (differences.length < 30) differences.push({ player: csv.current_name, field: attribute.attribute_label, csv: String(attribute.value), fm: String(value) })
      }
    }
  }

  const dataCoverage = checkedFields ? matchingFields / checkedFields : 0
  const divergentFields = checkedFields - matchingFields
  const valid = csvRows.length > 0
    && association.csvOnly === 0
    && association.ambiguous === 0
    && divergentFields === 0
    && checkedFields > 0

  return {
    matched: association.matches.length,
    csvTotal: csvRows.length,
    fmTotal: fmRows.length,
    coverage: association.coverage,
    valid,
    csvOnly: association.csvOnly,
    fmOnly: association.fmOnly,
    ambiguous: association.ambiguous,
    checkedFields,
    matchingFields,
    divergentFields,
    unavailableFields: unavailableFromOfflineReader,
    missingValues,
    dataCoverage,
    samples,
    differences,
  }
}

function tagRows(rows: PreparedRow[], source: string, validation: 'validated' | 'unverified' | 'unavailable') {
  return rows.map(row => ({ ...row, normalized_data: { ...row.normalized_data, import_source: source, fm_validation: validation } }))
}

export function ImportPanel({ onImported }: { onImported?: () => void }) {
  const { selected } = useSaves()
  const csvInput = useRef<HTMLInputElement>(null)
  const fmInput = useRef<HTMLInputElement>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [fmFile, setFmFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [nameColumn, setNameColumn] = useState('')
  const [snapshotDate, setSnapshotDate] = useState('')
  const [type, setType] = useState<ImportType>('squad')
  const [fmRead, setFmRead] = useState<OfflineRead | null>(null)
  const [csvStatus, setCsvStatus] = useState('Aguardando arquivo CSV.')
  const [fmStatus, setFmStatus] = useState('Aguardando arquivo .fm.')
  const [loadingCsv, setLoadingCsv] = useState(false)
  const [loadingFm, setLoadingFm] = useState(false)
  const [directoryNames, setDirectoryNames] = useState<Record<ImportFileKind, string | null>>({ csv: null, fm: null })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [shareForDiagnostics, setShareForDiagnostics] = useState(false)
  const [sendingDiagnostics, setSendingDiagnostics] = useState(false)
  const [comparisonModal, setComparisonModal] = useState<'differences' | 'unavailable' | null>(null)

  useEffect(() => {
    void Promise.all([getImportDirectoryName('csv'), getImportDirectoryName('fm')]).then(([csv, fm]) => setDirectoryNames({ csv, fm }))
    const onDirectoryChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: ImportFileKind; name: string }>).detail
      if (detail) setDirectoryNames(current => ({ ...current, [detail.kind]: detail.name }))
    }
    window.addEventListener(IMPORT_DIRECTORY_CHANGED, onDirectoryChanged)
    return () => window.removeEventListener(IMPORT_DIRECTORY_CHANGED, onDirectoryChanged)
  }, [])

  const csvRows = useMemo(() => preview ? prepareRows(preview, nameColumn) : [], [preview, nameColumn])
  const fmRows = useMemo(() => fmRead?.players ?? [], [fmRead])
  const comparison = useMemo(() => csvRows.length && fmRows.length ? comparePlayers(csvRows, fmRows) : null, [csvRows, fmRows])
  const { importRows, importMode } = useMemo(() => {
    if (csvRows.length && fmRows.length) {
      if (type === 'stats') return { importRows: tagRows(csvRows, 'csv-only', 'unavailable'), importMode: 'csv-stats' }
      if (comparison?.valid) return { importRows: tagRows(mergeValidatedRows(csvRows, matchImportRows(csvRows, fmRows).matches), 'csv+fm26-offline', 'validated'), importMode: 'validated' }
      return { importRows: tagRows(csvRows, 'csv-only', 'unavailable'), importMode: 'csv-fallback' }
    }
    if (fmRows.length) return { importRows: tagRows(fmRows, 'fm26-offline-beta', 'unverified'), importMode: 'fm-beta' }
    return { importRows: tagRows(csvRows, 'csv-only', 'unavailable'), importMode: 'csv-only' }
  }, [comparison, csvRows, fmRows, type])
  const effectiveType: ImportType = importMode === 'fm-beta' ? 'squad' : type
  const isReading = loadingCsv || loadingFm
  const suggestedSnapshotYear = useMemo(() => inferSnapshotYear(csvRows), [csvRows])
  const exactFmDate = fmRead?.snapshot_date_precision === 'day' ? fmRead.snapshot_date ?? null : null
  const confirmedFmYear = fmRead?.snapshot_date_precision === 'year' && fmRead.snapshot_date ? fmRead.snapshot_date.slice(0, 4) : null
  const snapshotDateValid = isValidIsoDate(snapshotDate) && (!confirmedFmYear || snapshotDate.startsWith(`${confirmedFmYear}-`))
  const canConfirm = Boolean(selected && importRows.length && !saving && !isReading && snapshotDateValid)

  async function chooseCsv(file: File | undefined) {
    if (!file) return
    setMessage(''); setCsvFile(file); setPreview(null); setLoadingCsv(true); setCsvStatus('Lendo CSV em segundo plano…')
    try {
      const next = await parseCsvFile(file)
      const detected = detectNameColumn(next.headers)
      setPreview(next); setNameColumn(detected); setType(next.fileType === 'unknown' ? 'squad' : next.fileType)
      if (!fmFile && !snapshotDate) setSnapshotDate('')
      setCsvStatus(`${next.rowCount} linhas e ${next.headers.length} dados detectados.`)
    } catch (error) { setCsvStatus(`Não foi possível ler o CSV: ${errorMessage(error)}`) }
    finally { setLoadingCsv(false) }
  }

  async function readFmInWorker(file: File): Promise<OfflineRead> {
    const worker = new Worker(new URL('../../lib/fm26-offline-worker.ts', import.meta.url), { type: 'module' })
    const id = crypto.randomUUID()
    const bytes = await file.arrayBuffer()
    return new Promise((resolve, reject) => {
      worker.onmessage = event => {
        const response = event.data as { id: string; type: 'status' | 'result' | 'error'; status?: string; result?: OfflineRead; message?: string }
        if (response.id !== id) return
        if (response.type === 'status') { setFmStatus(response.status ?? 'Lendo o save localmente…'); return }
        worker.terminate()
        if (response.type === 'result' && response.result) resolve(response.result)
        else reject(new Error(response.message ?? 'O leitor não retornou um resultado.'))
      }
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Falha no worker do leitor .fm.')) }
      worker.postMessage({ id, bytes, fileName: file.name }, [bytes])
    })
  }

  async function chooseFm(file: File | undefined) {
    if (!file) return
    setMessage(''); setFmFile(file); setFmRead(null); setType('squad'); setLoadingFm(true); setFmStatus('Lendo o save localmente em segundo plano…')
    try {
      const read = await readFmInWorker(file)
      setFmRead(read)
      if (read.snapshot_date_precision === 'day' && read.snapshot_date) setSnapshotDate(read.snapshot_date)
      else if (read.snapshot_date_precision === 'year' && read.snapshot_date) {
        const year = read.snapshot_date.slice(0, 4)
        setSnapshotDate(current => current.startsWith(`${year}-`) ? current : '')
      } else setSnapshotDate('')
      setFmStatus(`${read.players.length} jogadores identificados pelo leitor beta.${read.snapshot_date ? read.snapshot_date_precision === 'day' ? ` Data atual do save: ${read.snapshot_date}.` : ` Ano confirmado no save: ${read.snapshot_date.slice(0, 4)}. Informe dia e mês antes de confirmar; 01/01 não será usado como data inventada.` : ' A data exata do save ainda não foi localizada pelo leitor; informe a data manualmente antes de confirmar.'}`)
    } catch (error) { setFmStatus(`Não foi possível ler o arquivo .fm: ${errorMessage(error)}`) }
    finally { setLoadingFm(false) }
  }

  async function openFile(kind: ImportFileKind) {
    try {
      const file = await chooseImportFile(kind)
      if (file) await (kind === 'csv' ? chooseCsv(file) : chooseFm(file))
      else if (!supportsPersistentFilePicker()) (kind === 'csv' ? csvInput : fmInput).current?.click()
    } catch (error) { setMessage(`Não foi possível abrir o seletor de arquivo: ${errorMessage(error)}`) }
  }

  async function chooseFolder(kind: ImportFileKind) {
    try {
      const name = await chooseImportDirectory(kind)
      const persistedName = await getImportDirectoryName(kind)
      if (name || persistedName) setDirectoryNames(current => ({ ...current, [kind]: persistedName ?? name }))
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage(`Não foi possível definir a pasta padrão: ${errorMessage(error)}`)
    }
  }

  async function uploadDiagnostics() {
    if (!shareForDiagnostics || !supabase || !selected || !fmFile || !csvFile || !comparison) return
    setSendingDiagnostics(true); setMessage('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sua sessão expirou. Entre novamente para enviar o diagnóstico.')
      const prefix = `${user.id}/${crypto.randomUUID()}`
      const [fmUpload, csvUpload] = await Promise.all([
        supabase.storage.from('fm-reader-samples').upload(`${prefix}/${fmFile.name}`, fmFile, { upsert: false }),
        supabase.storage.from('fm-reader-samples').upload(`${prefix}/${csvFile.name}`, csvFile, { upsert: false }),
      ])
      if (fmUpload.error) throw fmUpload.error
      if (csvUpload.error) throw csvUpload.error
      const { error } = await supabase.from('fm_reader_samples').insert({ owner_id: user.id, save_id: selected.id, fm_path: fmUpload.data.path, csv_path: csvUpload.data.path, comparison, parser_version: 'offline-v0.22' })
      if (error) throw error
      setMessage('Arquivos enviados de forma privada para diagnóstico. Obrigado por ajudar a melhorar o leitor.')
    } catch (error) { setMessage(`Não foi possível enviar o diagnóstico: ${errorMessage(error)}`) }
    finally { setSendingDiagnostics(false) }
  }

  async function confirm() {
    if (!selected || !canConfirm) return
    setSaving(true); setMessage('')
    try {
      if (!supabase) throw new Error('Banco mestre não configurado.')
      if (!snapshotDateValid) throw new Error(confirmedFmYear ? `Informe uma data completa de ${confirmedFmYear} antes de confirmar.` : 'Informe uma data completa e válida antes de confirmar.')
      const warnings = [...(preview?.warnings ?? [])]
      if (importMode === 'fm-beta') warnings.push('Leitura .fm em beta: campos podem estar vazios ou incorretos.')
      if (importMode === 'csv-only') warnings.push('Importação CSV: recursos que dependem do arquivo .fm ficam indisponíveis.')
      if (importMode === 'csv-fallback') warnings.push('A validação CSV × .fm não foi suficiente; os dados do .fm não foram usados nesta importação.')
      const { data, error } = await supabase.rpc('import_fm_export', {
        p_save_id: selected.id, p_filename: [csvFile?.name, fmFile?.name].filter(Boolean).join(' + '),
        p_file_hash: await filesHash([csvFile, fmFile].filter((file): file is File => Boolean(file))), p_file_type: effectiveType,
        p_snapshot_date: snapshotDate, p_delimiter: preview?.delimiter ?? ',',
        p_rows: importRows, p_warnings: warnings,
      })
      if (error) throw error
      const result = data as { duplicate?: boolean } | null
      if (result?.duplicate) {
        setMessage('Este mesmo conteúdo já foi importado neste save; nenhuma nova fotografia foi criada.')
        return
      }
      setMessage(importMode === 'validated' ? 'Importação concluída: CSV e .fm foram validados juntos.' : 'Importação concluída.')
      onImported?.()
    } catch (error) { setMessage(`Falha na persistência: ${errorMessage(error)}`) }
    finally { setSaving(false) }
  }

  const detectedSummary = preview
    ? `${preview.headers.length} dados do CSV · ${csvRows.length} jogadores reconhecidos`
    : 'Aguardando CSV para detectar dados.'
  const fmSummary = fmRead ? `${fmRows.length} jogadores · atributos, posições e dados de save` : 'Aguardando arquivo .fm.'
  const sourceLabel = csvFile && fmFile ? 'CSV + .fm' : fmFile ? '.fm' : csvFile ? 'CSV' : 'Aguardando arquivos'

  return <section className="import-panel">
    <div className="title-row"><div><span className="eyebrow">IMPORTAÇÃO SEGURA</span><h1>Novo Snapshot</h1><p>Envie CSV, arquivo <code>.fm</code> ou os dois para validar a leitura do save.</p></div></div>
    <div className="preview fm-import-preview">
      <div className="import-file-pickers">
        <div className="fm-file-picker"><button type="button" className="fm-file-button" onClick={() => void openFile('csv')}><span>CSV (estável)</span><strong>{csvFile?.name ?? 'Escolher CSV'}</strong><small>{loadingCsv ? 'Leitura em andamento…' : csvStatus}</small></button><input ref={csvInput} type="file" accept=".csv,text/csv" onChange={event => void chooseCsv(event.target.files?.[0])} /><div className="default-folder"><span>Pasta padrão: <b>{directoryNames.csv ?? 'não definida'}</b></span><button type="button" className="ghost" onClick={() => void chooseFolder('csv')} disabled={!supportsPersistentFilePicker()}>Definir pasta</button></div></div>
        <div className="fm-file-picker"><button type="button" className="fm-file-button fm-file-button-beta" onClick={() => void openFile('fm')}><span>Save .fm (beta)</span><strong>{fmFile?.name ?? 'Escolher .fm'}</strong><small>{loadingFm ? 'Leitura em andamento…' : fmStatus}</small></button><input ref={fmInput} type="file" accept=".fm,application/octet-stream" onChange={event => void chooseFm(event.target.files?.[0])} /><div className="default-folder"><span>Pasta padrão: <b>{directoryNames.fm ?? 'não definida'}</b></span><button type="button" className="ghost" onClick={() => void chooseFolder('fm')} disabled={!supportsPersistentFilePicker()}>Definir pasta</button></div></div>
      </div>
      {fmFile && !csvFile && <p className="warning">Leitura <code>.fm</code> em construção e testes: ela pode trazer jogadores ou campos incorretos e valores vazios. Revise os dados antes de usar o snapshot.</p>}
      {csvFile && !fmFile && <p className="notice">O CSV continua sendo o caminho estável. Alguns dados e recursos que dependem da leitura do save não ficam disponíveis sem o arquivo <code>.fm</code>.</p>}
      <div className="stats import-overview"><div><span>Save</span><strong>{selected?.name ?? 'Nenhum save ativo'}</strong></div><div><span>Snapshot</span><strong>{snapshotDate || (confirmedFmYear ? `Ano ${confirmedFmYear} confirmado · falta dia/mês` : suggestedSnapshotYear ? `Ano sugerido: ${suggestedSnapshotYear}` : 'Informe a data')}</strong></div><div><span>Dados detectados</span><strong>{detectedSummary}</strong></div><div><span>Leitura .fm</span><strong>{fmSummary}</strong></div></div>
      <div className="import-fields"><label>{exactFmDate ? 'Data atual do save .fm' : confirmedFmYear ? `Data do snapshot (ano ${confirmedFmYear} confirmado)` : 'Data do snapshot'}<input type="date" value={snapshotDate} onChange={event => setSnapshotDate(event.target.value)} placeholder="AAAA-MM-DD" disabled={Boolean(exactFmDate)} /></label><label>Fonte dos dados<input value={sourceLabel} disabled /></label><label>Tipo<select value={type} onChange={event => setType(event.target.value as ImportType)} disabled={Boolean(fmFile)}><option value="squad">Elenco</option><option value="intake">Intake</option><option value="stats">Estatísticas</option></select></label><label>Coluna com o nome<select value={nameColumn} onChange={event => setNameColumn(event.target.value)} disabled={!preview}>{preview ? preview.headers.map(header => <option key={header} value={header}>{header}</option>) : <option>Carregue um CSV</option>}</select></label></div>
      {(csvFile || fmFile) && !snapshotDateValid && <p className="warning">{confirmedFmYear ? `O leitor confirmou apenas o ano ${confirmedFmYear}. Informe dia e mês reais para liberar a importação.` : suggestedSnapshotYear ? `O CSV sugere o ano ${suggestedSnapshotYear}, mas a data completa precisa ser confirmada manualmente.` : 'Informe uma data completa e válida para o snapshot.'}</p>}
      {preview && csvRows.length === 0 && <p className="warning">Nenhum jogador com nome foi encontrado. Escolha uma coluna de nome válida.</p>}
      <details className="import-debug"><summary>Dados detectados <small>{preview ? `${preview.headers.length} dados · abrir para conferir o mapeamento` : 'a leitura do CSV exibirá os dados aqui'}</small></summary>{preview && <div className="chips">{preview.headers.map(header => <span key={header} className={preview.ignoredColumns.includes(header) ? 'chip muted' : 'chip'}>{header}</span>)}</div>}</details>
      <div className={`fm-reader-status ${fmFile ? (loadingFm ? 'reading' : fmRead ? 'valid' : 'invalid') : ''}`}><strong>Arquivo .fm</strong><span>{fmStatus}</span></div>
      <div className={`fm-comparison ${comparison ? (comparison.valid ? 'valid' : 'invalid') : ''}`}><strong>Validação CSV × .fm</strong>{comparison ? <><span>{comparison.matched}/{comparison.csvTotal} jogadores associados · {comparison.matchingFields}/{comparison.checkedFields} dados coincidem ({Math.round(comparison.dataCoverage * 100)}%).</span><small>{comparison.valid ? `Validação aprovada. O CSV define os ${comparison.csvTotal} jogadores persistidos; ${comparison.fmOnly} jogador(es) extra(s) do .fm ficam fora deste import. ${comparison.unavailableFields.length} campos ainda não têm equivalência confirmada e não entraram no cálculo.` : `Validação recusada: ${comparison.csvOnly} jogador(es) do CSV sem associação, ${comparison.ambiguous} associação(ões) ambígua(s) e ${comparison.divergentFields} divergência(s) objetiva(s). Por segurança, serão usados apenas dados CSV.`}</small><div className="comparison-actions">{comparison.differences.length > 0 && <button type="button" className="ghost" onClick={() => setComparisonModal('differences')}>Ver {comparison.divergentFields} divergência(s)</button>}{comparison.unavailableFields.length > 0 && <button type="button" className="ghost" onClick={() => setComparisonModal('unavailable')}>Ver campos ainda não comparáveis</button>}</div>{comparison.missingValues > 0 && <small>{comparison.missingValues} comparação(ões) foram ignoradas porque o valor estava vazio em pelo menos um dos arquivos.</small>}</> : <span>Envie os dois arquivos para validar identidade, posições, atributos, nascimento e nacionalidade.</span>}</div>
      {comparison && !comparison.valid && <div className="diagnostic-consent"><label><input type="checkbox" checked={shareForDiagnostics} onChange={event => setShareForDiagnostics(event.target.checked)} /> Autorizo o envio privado destes dois arquivos para diagnóstico e melhoria do leitor.</label><button className="ghost" disabled={!shareForDiagnostics || sendingDiagnostics} onClick={() => void uploadDiagnostics()}>{sendingDiagnostics ? 'Enviando…' : 'Enviar arquivos para diagnóstico'}</button></div>}
      {message && <p className={message.startsWith('Falha') || message.startsWith('Não foi') ? 'warning' : 'notice'}>{message}</p>}
      <div className="import-actions"><button className="primary" disabled={!canConfirm} onClick={() => void confirm()}>{saving ? 'Importando…' : isReading ? 'Aguardando leitura…' : importMode === 'csv-fallback' ? 'Importar CSV sem dados do .fm' : 'Confirmar importação'}</button></div>
      {comparisonModal && comparison && <div className="settings-overlay import-comparison-overlay" role="presentation" onMouseDown={() => setComparisonModal(null)}><section className="import-comparison-modal" role="dialog" aria-modal="true" aria-label="Detalhes da validação" onMouseDown={event => event.stopPropagation()}><header><div><span className="eyebrow">VALIDAÇÃO CSV × .FM</span><h2>{comparisonModal === 'differences' ? 'Divergências encontradas' : 'Campos ainda não comparáveis'}</h2></div><button className="ghost" type="button" onClick={() => setComparisonModal(null)} aria-label="Fechar">×</button></header><div className="import-comparison-modal-body">{comparisonModal === 'differences' ? <><p>Mostrando as primeiras {comparison.differences.length} de {comparison.divergentFields} divergências objetivas.</p><ul>{comparison.differences.map((difference, index) => <li key={`${difference.player}-${difference.field}-${index}`}><b>{difference.player}</b><span>{difference.field}</span><code>CSV: {difference.csv}</code><code>.fm: {difference.fm}</code></li>)}</ul></> : <><p>Estes campos ainda não têm uma equivalência segura: alguns não foram mapeados pelo leitor <code>.fm</code>; outros existem nas duas fontes, mas usam escalas ou formatos diferentes. Eles não entram no cálculo da validação.</p><ul className="field-list">{comparison.unavailableFields.map(field => <li key={field}>{field}</li>)}</ul></>}</div></section></div>}
    </div>
  </section>
}
