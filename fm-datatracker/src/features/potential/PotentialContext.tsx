import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { loadProjectionReference, resetProjectionReferenceCache, type ProjectionReference, type ProjectionReferenceState } from '../../lib/projection-reference'

type PotentialContextValue = {
  showPotential: boolean
  setShowPotential: (value: boolean) => void
  available: boolean
  loading: boolean
  experimental: boolean
  detail: string
  reference: ProjectionReference | null
}

const PotentialContext = createContext<PotentialContextValue | null>(null)
const BASE_KEY = 'fm-datatracker:show-potential'
const IDLE_DETAIL = 'Projection v2.1 será carregada ao ativar Mostrar potencial.'

export function PotentialProvider({ children }: { children: ReactNode }) {
  const [ownerKey, setOwnerKey] = useState('anonymous')
  const [showPotential, setShowPotentialState] = useState(false)
  const [referenceState, setReferenceState] = useState<ProjectionReferenceState | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    if (!supabase) return () => { active = false }
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      const key = data.user?.id ?? 'anonymous'
      setOwnerKey(key)
      try { setShowPotentialState(localStorage.getItem(`${BASE_KEY}:${key}`) === 'true') } catch { setShowPotentialState(false) }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!showPotential || referenceState?.reference || referenceState?.status === 'missing' || referenceState?.status === 'invalid') return
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    const load = () => {
      setLoading(true)
      if (attempt > 0) resetProjectionReferenceCache()
      void loadProjectionReference().then(state => {
        if (!active) return
        setReferenceState(state)
        setLoading(false)
        if (state.status === 'missing' && attempt < 2) {
          attempt += 1
          retryTimer = setTimeout(load, 1200 * attempt)
          return
        }
        if (state.status === 'missing' || state.status === 'invalid') {
          setShowPotentialState(false)
          try { localStorage.setItem(`${BASE_KEY}:${ownerKey}`, 'false') } catch { /* preference stays in memory */ }
        }
      })
    }
    load()
    return () => { active = false; if (retryTimer) clearTimeout(retryTimer) }
  }, [showPotential, ownerKey])

  const available = referenceState ? referenceState.status !== 'missing' && referenceState.status !== 'invalid' : true
  const experimental = referenceState?.status === 'experimental'
  const setShowPotential = (value: boolean) => {
    if (value && !available) return
    setShowPotentialState(value)
    try { localStorage.setItem(`${BASE_KEY}:${ownerKey}`, String(value)) } catch { /* local preference remains in memory */ }
  }

  const value = useMemo<PotentialContextValue>(() => ({
    showPotential,
    setShowPotential,
    available,
    loading,
    experimental,
    detail: referenceState?.detail ?? IDLE_DETAIL,
    reference: referenceState?.reference ?? null,
  }), [showPotential, available, loading, experimental, ownerKey, referenceState])

  return <PotentialContext.Provider value={value}>{children}</PotentialContext.Provider>
}

export function usePotential() {
  const context = useContext(PotentialContext)
  if (!context) throw new Error('usePotential precisa estar dentro de PotentialProvider')
  return context
}
