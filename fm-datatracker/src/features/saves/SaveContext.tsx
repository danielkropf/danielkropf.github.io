import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import type { Save } from '../../types/domain'

type Value = { saves: Save[]; selected: Save | null; select: (save: Save) => void; refresh: () => Promise<void> }
const Context = createContext<Value | null>(null)
export function SaveProvider({ children }: { children: ReactNode }) {
  const [saves, setSaves] = useState<Save[]>([]); const [selected, setSelected] = useState<Save | null>(null)
  async function refresh() { if (!supabase) return; const { data } = await supabase.from('saves').select('*').eq('is_archived', false).order('created_at'); const list = (data ?? []) as Save[]; setSaves(list); setSelected(current => list.find(s => s.id === current?.id) ?? list[0] ?? null) }
  useEffect(() => { void refresh() }, [])
  return <Context.Provider value={{ saves, selected, select: setSelected, refresh }}>{children}</Context.Provider>
}
export function useSaves() { const value = useContext(Context); if (!value) throw new Error('useSaves fora do SaveProvider'); return value }
