import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { invalidateSaveData } from '../lib/dataCache'
import { useSaves } from '../features/saves/SaveContext'
import { ImportPanel } from '../features/imports/ImportPanel'
import type { ImportRecord } from '../types/domain'

type ImportsPageProps = { mode?: 'import' | 'history' }

export function ImportsPage({ mode = 'import' }: ImportsPageProps) {
  const { selected } = useSaves()
  const [items, setItems] = useState<ImportRecord[]>([])
  async function load() {
    if (!supabase || !selected) return
    const { data } = await supabase.from('imports').select('*').eq('save_id', selected.id).order('created_at', { ascending: false })
    setItems((data ?? []) as ImportRecord[])
  }
  useEffect(() => { if (mode === 'history') void load() }, [mode, selected?.id])

  if (mode === 'history') return <section className="settings-import-history">
    <span className="eyebrow">GERENCIAMENTO</span><h2>Importações anteriores</h2>
    <p>Consulte os arquivos já confirmados neste save. Para adicionar uma nova fotografia, use <strong>Novo import</strong> no menu lateral.</p>
    <div className="table-wrap"><table><thead><tr><th>Data</th><th>Arquivo</th><th>Tipo</th><th>Linhas</th><th>Status</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{item.snapshot_date}</td><td>{item.original_filename}</td><td>{item.file_type}</td><td>{item.row_count}</td><td><span className="status">{item.status}</span></td></tr>)}</tbody></table></div>
    {!items.length && <p>Nenhum import confirmado.</p>}
  </section>

  return <div className="screen-page imports-page"><ImportPanel onImported={() => { if (selected) invalidateSaveData(selected.id) }} /></div>
}
