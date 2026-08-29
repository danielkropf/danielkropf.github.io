import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { invalidateSaveData } from '../../lib/dataCache'
import { discardModelConfigState } from '../../lib/model-config'
import { loadSaveStructures } from '../../lib/longitudinal-service'
import { sanitizeSquadTablePreferencesForSaveChange } from '../../lib/squad-table-preferences'
import type { Save } from '../../types/domain'
import { createSaveRefreshRequestGuard, resolveSaveRefresh } from './save-refresh'

type NewSave = { name: string; club_name: string; country: string }
type Value = {
  saves: Save[]
  selected: Save | null
  loading: boolean
  error: string | null
  select: (save: Save) => void
  refresh: () => Promise<void>
  create: (save: NewSave) => Promise<string | null>
  deleteSave: (saveId: string) => Promise<string | null>
}

const Context = createContext<Value | null>(null)
const ACTIVE_SAVE_KEY = 'fm-datatracker:active-save'

export function SaveProvider({ children }: { children: ReactNode }) {
  const [saves, setSaves] = useState<Save[]>([])
  const [selected, setSelected] = useState<Save | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const savesRef = useRef<Save[]>([])
  const selectedRef = useRef<Save | null>(null)
  const refreshGuard = useRef(createSaveRefreshRequestGuard())

  function select(save: Save) {
    if (selectedRef.current?.id && selectedRef.current.id !== save.id) {
      sanitizeSquadTablePreferencesForSaveChange()
    }
    selectedRef.current = save
    setSelected(save)
    localStorage.setItem(ACTIVE_SAVE_KEY, save.id)
  }

  async function refresh() {
    const token = refreshGuard.current.begin()
    if (!supabase) {
      if (refreshGuard.current.isCurrent(token)) {
        setError('Banco Mestre não configurado.')
        setLoading(false)
      }
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await supabase.from('saves').select('*').eq('is_archived', false).order('created_at')
      if (!refreshGuard.current.isCurrent(token)) return

      const rawData = result.error ? null : (result.data ?? []) as Save[]
      const structuredData = rawData ? await loadSaveStructures(rawData) : null
      if (!refreshGuard.current.isCurrent(token)) return

      const resolution = resolveSaveRefresh({
        currentSaves: savesRef.current,
        currentSelected: selectedRef.current,
        rememberedId: localStorage.getItem(ACTIVE_SAVE_KEY),
        data: structuredData,
        error: result.error?.message ?? null,
      })
      setError(resolution.error)
      if (resolution.error) return
      const previousSaveId = selectedRef.current?.id ?? null
      if (previousSaveId && previousSaveId !== resolution.selected?.id) {
        sanitizeSquadTablePreferencesForSaveChange()
      }
      savesRef.current = resolution.saves
      selectedRef.current = resolution.selected
      setSaves(resolution.saves)
      setSelected(resolution.selected)
      if (resolution.persistActiveSaveId) localStorage.setItem(ACTIVE_SAVE_KEY, resolution.persistActiveSaveId)
      else if (resolution.persistActiveSaveId === null) localStorage.removeItem(ACTIVE_SAVE_KEY)
    } catch (cause) {
      if (!refreshGuard.current.isCurrent(token)) return
      setError(cause instanceof Error ? cause.message : 'Falha inesperada ao carregar os saves.')
    } finally {
      if (refreshGuard.current.isCurrent(token)) setLoading(false)
    }
  }

  async function create(input: NewSave) {
    if (!supabase) return 'Banco não configurado'
    const { error: createError } = await supabase.rpc('create_save_with_structure', {
      p_name: input.name.trim(),
      p_club_name: input.club_name.trim(),
      p_country: input.country.trim() || null,
    })
    if (createError) return createError.message
    await refresh()
    return null
  }

  async function deleteSave(saveId: string) {
    if (!supabase) return 'Banco não configurado'
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'Sessão inválida'
    const { data, error: deleteError } = await supabase.from('saves').delete().eq('id', saveId).eq('owner_id', user.id).select('id').maybeSingle()
    if (deleteError) return deleteError.message
    if (!data) return 'Save não encontrado ou sem permissão para exclusão.'
    invalidateSaveData(saveId)
    discardModelConfigState(saveId)
    if (selectedRef.current?.id === saveId) {
      sanitizeSquadTablePreferencesForSaveChange()
      selectedRef.current = null
      setSelected(null)
      localStorage.removeItem(ACTIVE_SAVE_KEY)
    }
    await refresh()
    return null
  }

  useEffect(() => { void refresh(); return () => refreshGuard.current.invalidate() }, [])

  return <Context.Provider value={{ saves, selected, loading, error, select, refresh, create, deleteSave }}>{children}</Context.Provider>
}

export function useSaves() {
  const value = useContext(Context)
  if (!value) throw new Error('SaveProvider ausente')
  return value
}
