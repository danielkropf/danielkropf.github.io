import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { loadProjectionReference, type ProjectionReference, type ProjectionReferenceState } from '../../lib/projection-reference'

type PotentialContextValue = {
  showPotential: boolean
  setShowPotential: (value: boolean) => void
  available: boolean
  loading: boolean
  detail: string
  reference: ProjectionReference | null
}

const PotentialContext = createContext<PotentialContextValue | null>(null)
const BASE_KEY = 'fm-datatracker:show-potential'

export function PotentialProvider({ children }: { children: ReactNode }) {
  const [ownerKey, setOwnerKey] = useState('anonymous')
  const [showPotential, setShowPotentialState] = useState(false)
  const [referenceState, setReferenceState] = useState<ProjectionReferenceState>({ status: 'loading', reference: null, detail: 'Carregando referência de desenvolvimento…' })

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

  useEffect(() => { let active = true; void loadProjectionReference().then(state => { if (active) setReferenceState(state) }); return () => { active = false } }, [])

  const available = referenceState.status === 'ready'
  const setShowPotential = (value: boolean) => {
    if (value && !available) return
    setShowPotentialState(value)
    try { localStorage.setItem(`${BASE_KEY}:${ownerKey}`, String(value)) } catch { /* local preference remains in memory */ }
  }

  const value = useMemo<PotentialContextValue>(() => ({
    showPotential: available && showPotential,
    setShowPotential,
    available,
    loading: referenceState.status === 'loading',
    detail: referenceState.detail,
    reference: referenceState.reference,
  }), [available, showPotential, ownerKey, referenceState])

  return <PotentialContext.Provider value={value}>{children}</PotentialContext.Provider>
}

export function usePotential() {
  const context = useContext(PotentialContext)
  if (!context) throw new Error('usePotential precisa estar dentro de PotentialProvider')
  return context
}
