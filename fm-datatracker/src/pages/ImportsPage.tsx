import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { invalidateSaveData } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { ImportPanel } from '../features/imports/ImportPanel'
import { canonicalFieldKey, displayFmPositions, normalizedDate, normalizedFoot, normalizedText, positionsMatch } from '../lib/fm-comparison'
import { deleteFmImportSafe, stampLatestImportVersion } from '../lib/import-management'
import { importVersionState, normalizeAppVersion } from '../lib/import-version'
import { createLatestSaveRequestGuard } from '../lib/latest-save-request'
import type { ImportRecord } from '../types/domain'

type ImportsPageProps = { mode?: 'import' | 'history' }
type VersionedImportRecord = ImportRecord & { source_schema?: Record<string, unknown> | null }

type RawSnapshot = {
  id: string
  raw_data: Record<string, unknown>
  normalized_data: Record<string, unknown>
  players: { fm_player_id: string; current_name: string } | { fm_player_id: string; current_name: string }[] | null
}
type RawCell = { value: unknown; source: 'csv' | 'fm' | 'both'; comparison?: 'match' | 'different' | 'uncomparable'; fmValue?: unknown }

const sourceLabel = (filename: string) => {
  const lower = filename.toLowerCase()
  if (lower.includes('.csv') && lower.includes('.fm')) return 'CSV + .fm'
  return lower.includes('.fm') ? '.fm' : 'CSV'
}
const normalizedKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const printable = (value: unknown) => value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const importAppVersion = (item: VersionedImportRecord) => normalizeAppVersion(item.source_schema?.app_version)

function ImportVersion({ item }: { item: VersionedImportRecord }) {
  const version = importAppVersion(item)
  const state = importVersionState(version, __APP_VERSION__)
  if (state === 'unknown') return <span title="Este import não registrou a versão do DataTracker. Ele pode ter sido criado antes do versionamento de imports e pode não conter campos adicionados posteriormente.">⚠ não registrada</span>
  if (state === 'older') return <span title={`Import feito na v${version}. A versão atual é v${__APP_VERSION__}; dados adicionados em versões posteriores podem estar ausentes.`}>⚠ v{version}</span>
  if (state === 'newer') return <span title={`Este import foi criado na v${version}, mais nova que a versão atualmente aberta (v${__APP_VERSION__}).`}>v{version}</span>
  return <span title="Import realizado na versão atual do DataTracker.">v{version}</span>
}

function flatten(value: unknown, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) { if (prefix) output[prefix] = value; return output }
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length && prefix) output[prefix] = value
  for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, output)
  return output
}

function fmValueForCsv(field: string, fm: Record<string, unknown>, normalized: Record<string, unknown>) {
  const key = canonicalFieldKey(field)
  if (key === 'position') return displayFmPositions(normalized.positional_ratings ?? fm.positions)
  if (key === 'preferred_foot') return normalized.preferred_foot
  if (key === 'left_foot') return (normalized.feet as Record<string, unknown> | undefined)?.left
  if (key === 'right_foot') return (normalized.feet as Record<string, unknown> | undefined)?.right
  if (key === 'personality') return undefined
  const aliases: Record<string, string[]> = {
    unique_id: ['uid'], player: ['display_name'], player_name: ['display_name'], date_of_birth: ['birth_date'], dob: ['birth_date'],
    nation: ['nation'], nationality: ['nation'], height: ['height_cm'], team_work: ['teamwork'], punching: ['punching_tendency'],
  }
  const candidates = new Set([key, ...(aliases[key] ?? [])].map(canonicalFieldKey))
  const entry = Object.entries(fm).find(([fmKey]) => {
    const leaf = fmKey.split('.').at(-1) ?? fmKey
    return candidates.has(canonicalFieldKey(leaf)) || candidates.has(canonicalFieldKey(fmKey))
  })
  return entry?.[1]
}

function compareValue(field: string, csv: unknown, fm: unknown): RawCell['comparison'] {
  const key = canonicalFieldKey(field)
  if (key === 'personality' || key === 'left_foot' || key === 'right_foot') return 'uncomparable'
  if (key === 'date_of_birth') return normalizedDate(csv) === normalizedDate(fm) ? 'match' : 'different'
  if (key === 'preferred_foot') return normalizedFoot(csv) === normalizedFoot(fm) ? 'match' : 'different'
  if (key === 'position') return positionsMatch([String(csv)], [String(fm)]) ? 'match' : 'different'
  const csvText = normalizedText(csv).replace(/\s+/g, '')
  const fmText = normalizedText(fm).replace(/\s+/g, '')
  const csvNumber = csvText.replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  const fmNumber = fmText.replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (csvNumber && fmNumber && Number(csvNumber[0]) === Number(fmNumber[0])) return 'match'
  return csvText === fmText ? 'match' : 'different'
}

function RawImportInspector({ item, rows, onClose }: { item: ImportRecord; rows: RawSnapshot[]; onClose: () => void }) {
  const isCombined = sourceLabel(item.original_filename) === 'CSV + .fm'
  const { columns, preparedRows } = useMemo(() => {
    const csvKeys = new Set<string>(); const fmKeys = new Set<string>()
    const prepared = rows.map(row => {
      const raw = row.raw_data ?? {}
      const csv = isCombined && raw.csv && typeof raw.csv === 'object' ? flatten(raw.csv) : isCombined ? {} : sourceLabel(item.original_filename) === 'CSV' ? flatten(raw) : {}
      const fm = isCombined && raw.fm && typeof raw.fm === 'object' ? flatten(raw.fm) : isCombined ? {} : sourceLabel(item.original_filename) === '.fm' ? flatten(raw) : {}
      Object.keys(csv).forEach(key => csvKeys.add(key)); Object.keys(fm).forEach(key => fmKeys.add(key))
      const player = Array.isArray(row.players) ? row.players[0] : row.players
      return { id: player?.fm_player_id ?? String(row.normalized_data?.fm_player_id ?? '—'), name: player?.current_name ?? String(row.normalized_data?.current_name ?? '—'), csv, fm, normalized: row.normalized_data ?? {} }
    })
    const csvColumns = [...csvKeys]
    const fmColumns = [...fmKeys].filter(fmKey => !csvColumns.some(csvKey => fmValueForCsv(csvKey, { [fmKey]: '' }, {}) !== undefined))
    return { columns: ['Unique ID', 'Player (Name)', ...csvColumns, ...fmColumns.map(key => `.fm · ${key}`)], preparedRows: prepared }
  }, [isCombined, item.original_filename, rows])

  const cellFor = (row: typeof preparedRows[number], column: string): RawCell => {
    if (column === 'Unique ID') return { value: row.id, source: 'both' }
    if (column === 'Player (Name)') return { value: row.name, source: 'both' }
    if (column.startsWith('.fm · ')) return { value: row.fm[column.slice(6)], source: 'fm' }
    const csv = row.csv[column]
    if (!isCombined) return { value: sourceLabel(item.original_filename) === '.fm' ? row.fm[column] : csv, source: sourceLabel(item.original_filename) === '.fm' ? 'fm' : 'csv' }
    const fm = fmValueForCsv(column, row.fm, row.normalized)
    if (csv === undefined) return { value: fm, source: 'fm' }
    if (fm === undefined) return { value: csv, source: 'csv' }
    return { value: csv, fmValue: fm, source: 'both', comparison: compareValue(column, csv, fm) }
  }

  return <div className="settings-overlay raw-import-overlay" role="presentation" onMouseDown={onClose}>
    <section className="raw-import-modal" role="dialog" aria-modal="true" aria-label={`Dados brutos de ${item.original_filename}`} onMouseDown={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">DADOS BRUTOS · {sourceLabel(item.original_filename)}</span><h2>{item.original_filename}</h2><p>{rows.length} jogador(es). Verde: conferido nas duas fontes; âmbar: só uma fonte; vermelho: divergência — passe o mouse para comparar.</p></div><button className="ghost" type="button" onClick={onClose} aria-label="Fechar">×</button></header>
      <div className="raw-import-table-wrap"><table className="raw-import-table"><thead><tr>{columns.map((column, index) => <th key={column} className={index < 2 ? `raw-freeze-${index}` : ''}>{column}</th>)}</tr></thead><tbody>{preparedRows.map((row, rowIndex) => <tr key={`${row.id}-${rowIndex}`}>{columns.map((column, index) => { const cell = cellFor(row, column); const title = cell.comparison === 'different' ? `CSV: ${printable(cell.value)}\n.fm: ${printable(cell.fmValue)}` : cell.comparison === 'uncomparable' ? 'As duas fontes trazem este dado, mas as escalas/formatos ainda não têm equivalência segura.' : cell.source === 'csv' ? 'Disponível somente no CSV' : cell.source === 'fm' ? 'Disponível somente no arquivo .fm' : 'Dados conferidos nas duas fontes'; return <td key={column} className={`raw-${cell.source} ${cell.comparison ? `raw-${cell.comparison}` : ''} ${index < 2 ? `raw-freeze-${index}` : ''}`} title={title}>{printable(cell.value)}</td> })}</tr>)}</tbody></table></div>
    </section>
  </div>
}

export function ImportsPage({ mode = 'import' }: ImportsPageProps) {
  const { selected } = useSaves()
  const [items, setItems] = useState<VersionedImportRecord[]>([])
  const [message, setMessage] = useState('')
  const [rawItem, setRawItem] = useState<VersionedImportRecord | null>(null)
  const [rawRows, setRawRows] = useState<RawSnapshot[]>([])
  const [loadingRaw, setLoadingRaw] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const historyRequestGuard = useRef(createLatestSaveRequestGuard())
  const rawRequestGuard = useRef(createLatestSaveRequestGuard())
  const selectedIdRef = useRef<string | null>(selected?.id ?? null)
  selectedIdRef.current = selected?.id ?? null
  const compatibilityWarnings = useMemo(() => items.filter(item => {
    const state = importVersionState(importAppVersion(item), __APP_VERSION__)
    return state === 'older' || state === 'unknown'
  }).length, [items])

  async function load(saveId: string) {
    if (!supabase) return
    const token = historyRequestGuard.current.begin(saveId)
    const { data, error } = await supabase.from('imports').select('*').eq('save_id', saveId).order('created_at', { ascending: false })
    if (!historyRequestGuard.current.isCurrent(token) || selectedIdRef.current !== saveId) return
    if (error) { setMessage(`Não foi possível carregar o histórico: ${error.message}`); return }
    setItems((data ?? []) as VersionedImportRecord[])
  }
  useEffect(() => {
    const saveId = selected?.id
    if (mode !== 'history' || !saveId) {
      historyRequestGuard.current.invalidate()
      setItems([])
      return
    }
    void load(saveId)
    return () => historyRequestGuard.current.invalidate()
  }, [mode, selected?.id])

  useEffect(() => {
    rawRequestGuard.current.invalidate()
    setRawItem(null)
    setRawRows([])
    setLoadingRaw(false)
  }, [selected?.id])

  async function remove(item: VersionedImportRecord) {
    if (!selected || deletingId) return
    const saveId = selected.id
    if (!window.confirm(`Excluir permanentemente a importação “${item.original_filename}” de ${item.snapshot_date}? Os snapshots e estatísticas criados por ela também serão removidos.`)) return
    setMessage(''); setDeletingId(item.id)
    try {
      await deleteFmImportSafe(saveId, item.id)
      invalidateSaveData(saveId)
      if (selectedIdRef.current !== saveId) return
      if (rawItem?.id === item.id) { setRawItem(null); setRawRows([]) }
      await load(saveId)
      if (selectedIdRef.current === saveId) setMessage('Importação excluída.')
    } catch (error) {
      if (selectedIdRef.current === saveId) {
        setMessage(`Não foi possível excluir a importação: ${error instanceof Error ? error.message : 'falha desconhecida'}`)
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function openRaw(item: VersionedImportRecord) {
    if (!supabase || !selected) return
    const saveId = selected.id
    const token = rawRequestGuard.current.begin(saveId)
    setRawItem(item); setRawRows([]); setLoadingRaw(true)
    const { data, error } = await supabase
      .from('player_snapshots')
      .select('id,raw_data,normalized_data,players(fm_player_id,current_name)')
      .eq('save_id', saveId)
      .eq('import_id', item.id)
    if (!rawRequestGuard.current.isCurrent(token) || selectedIdRef.current !== saveId) return
    setLoadingRaw(false)
    if (error) { setMessage(`Não foi possível carregar os dados brutos: ${error.message}`); setRawItem(null); return }
    setRawRows((data ?? []) as RawSnapshot[])
  }

  function closeRaw() {
    rawRequestGuard.current.invalidate()
    setRawItem(null)
    setRawRows([])
    setLoadingRaw(false)
  }

  async function imported() {
    if (!selected) return
    const saveId = selected.id
    invalidateSaveData(saveId)
    try {
      await stampLatestImportVersion(saveId, __APP_VERSION__)
      if (selectedIdRef.current === saveId) setMessage('')
    } catch (error) {
      if (selectedIdRef.current === saveId) {
        setMessage(`Importação concluída, mas não foi possível registrar a versão do DataTracker: ${error instanceof Error ? error.message : 'falha desconhecida'}`)
      }
    }
  }

  if (mode === 'history') return <section className="settings-import-history">
    <span className="eyebrow">GERENCIAMENTO</span><h2>Importações anteriores</h2>
    <p>Consulte os arquivos já confirmados neste save. Para adicionar uma nova fotografia, use <strong>Novo import</strong> no menu lateral.</p>
    {compatibilityWarnings > 0 && <p className="warning">{compatibilityWarnings} {compatibilityWarnings === 1 ? 'import foi feito em uma versão anterior ou não possui versão registrada' : 'imports foram feitos em versões anteriores ou não possuem versão registrada'}. Eles continuam válidos, mas podem não conter dados que só passaram a ser extraídos em versões mais novas. Reimporte o snapshot quando precisar desses campos.</p>}
    <div className="table-wrap"><table><thead><tr><th>Data</th><th>Arquivo</th><th>Fonte</th><th>Versão</th><th>Linhas</th><th>Status</th><th aria-label="Ações" /></tr></thead><tbody>{items.map(item => <tr key={item.id} className="import-history-row" onClick={() => void openRaw(item)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openRaw(item) } }}><td>{item.snapshot_date}</td><td>{item.original_filename}</td><td>{sourceLabel(item.original_filename)}</td><td><ImportVersion item={item} /></td><td>{item.row_count}</td><td><span className="status">{item.status}</span></td><td><button className="ghost import-delete" disabled={deletingId !== null} onClick={event => { event.stopPropagation(); void remove(item) }} title={`Excluir ${item.original_filename}`} aria-label={`Excluir ${item.original_filename}`}>{deletingId === item.id ? '…' : '🗑'}</button></td></tr>)}</tbody></table></div>
    {message && <p className={message.startsWith('Não foi') ? 'warning' : 'notice'}>{message}</p>}
    {!items.length && <p>Nenhum import confirmado.</p>}
    {rawItem && <RawImportInspector item={rawItem} rows={rawRows} onClose={closeRaw} />}
    {rawItem && loadingRaw && <div className="settings-overlay raw-import-overlay"><div className="raw-import-loading">Carregando dados brutos…</div></div>}
  </section>

  return <div className="screen-page imports-page"><ImportPanel onImported={() => void imported()} />{message && <p className={message.startsWith('Importação concluída, mas') ? 'warning' : 'notice'}>{message}</p>}</div>
}
