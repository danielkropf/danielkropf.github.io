import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { loadPotentialRoleCeilingModel, type LoadedPotentialRoleCeilingModel } from '../../lib/potential-role-ceiling-model'
import { loadPotentialGeneralCeilingModel, type LoadedPotentialGeneralCeilingModel } from '../../lib/potential-general-ceiling-model'

type PotentialContextValue = {
  showPotential: boolean
  setShowPotential: (value: boolean) => void
  available: boolean
  loading: boolean
  experimental: boolean
  detail: string
  ceilingModel: LoadedPotentialRoleCeilingModel | null
  ceilingStatus: 'idle' | 'loading' | 'ready' | 'invalid'
  ceilingDetail: string
  generalCeilingModel: LoadedPotentialGeneralCeilingModel | null
  generalCeilingStatus: 'idle' | 'loading' | 'ready' | 'invalid'
  generalCeilingDetail: string
}

const PotentialContext = createContext<PotentialContextValue | null>(null)
const BASE_KEY = 'fm-datatracker:show-potential'
const IDLE_DETAIL = 'Potencial geral e Potencial na função serão carregados ao ativar Mostrar potencial.'
const CEILING_MANIFEST = `${import.meta.env.BASE_URL}reference/potential-role-ceiling.fm26-v1_1.manifest.json`
const GENERAL_CEILING_MANIFEST = `${import.meta.env.BASE_URL}reference/potential-general-ceiling.fm26-v2.manifest.json`

export function PotentialProvider({ children }: { children: ReactNode }) {
  const [ownerKey, setOwnerKey] = useState('anonymous')
  const [showPotential, setShowPotentialState] = useState(false)
  const [ceilingModel, setCeilingModel] = useState<LoadedPotentialRoleCeilingModel | null>(null)
  const [ceilingStatus, setCeilingStatus] = useState<PotentialContextValue['ceilingStatus']>('idle')
  const [ceilingDetail, setCeilingDetail] = useState('Potencial na função ainda não carregado.')
  const [ceilingLoadAttempt, setCeilingLoadAttempt] = useState(0)
  const [generalCeilingModel, setGeneralCeilingModel] = useState<LoadedPotentialGeneralCeilingModel | null>(null)
  const [generalCeilingStatus, setGeneralCeilingStatus] = useState<PotentialContextValue['generalCeilingStatus']>('idle')
  const [generalCeilingDetail, setGeneralCeilingDetail] = useState('Potencial geral ainda não carregado.')
  const [generalCeilingLoadAttempt, setGeneralCeilingLoadAttempt] = useState(0)

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
    if (!showPotential || ceilingModel || ceilingStatus === 'loading') return
    let active = true
    setCeilingStatus('loading')
    setCeilingDetail('Carregando modelo validado de Potencial na função…')
    void loadPotentialRoleCeilingModel(CEILING_MANIFEST).then(model => {
      if (!active) return
      setCeilingModel(model)
      setCeilingStatus('ready')
      setCeilingDetail(`Potencial na função · ${model.manifest.potentialModelVersion}`)
    }).catch(error => {
      if (!active) return
      setCeilingStatus('invalid')
      setCeilingDetail(error instanceof Error ? error.message : 'Não foi possível carregar o modelo de Potencial na função.')
    })
    return () => { active = false }
  }, [showPotential, ceilingModel, ceilingLoadAttempt])

  useEffect(() => {
    if (!showPotential || generalCeilingModel || generalCeilingStatus === 'loading') return
    let active = true
    setGeneralCeilingStatus('loading')
    setGeneralCeilingDetail('Carregando modelo validado de Potencial geral…')
    void loadPotentialGeneralCeilingModel(GENERAL_CEILING_MANIFEST).then(model => {
      if (!active) return
      setGeneralCeilingModel(model)
      setGeneralCeilingStatus('ready')
      setGeneralCeilingDetail(`Potencial geral · ${model.manifest.potentialModelVersion}`)
    }).catch(error => {
      if (!active) return
      setGeneralCeilingStatus('invalid')
      setGeneralCeilingDetail(error instanceof Error ? error.message : 'Não foi possível carregar o modelo de Potencial geral.')
    })
    return () => { active = false }
  }, [showPotential, generalCeilingModel, generalCeilingLoadAttempt])

  const available = ceilingStatus !== 'invalid' || generalCeilingStatus !== 'invalid'
  const experimental = false
  const setShowPotential = (value: boolean) => {
    if (value && ceilingStatus === 'invalid') {
      setCeilingStatus('idle')
      setCeilingDetail('Nova tentativa de carregar Potencial na função será realizada.')
      setCeilingLoadAttempt(current => current + 1)
    }
    if (value && generalCeilingStatus === 'invalid') {
      setGeneralCeilingStatus('idle')
      setGeneralCeilingDetail('Nova tentativa de carregar Potencial geral será realizada.')
      setGeneralCeilingLoadAttempt(current => current + 1)
    }
    setShowPotentialState(value)
    try { localStorage.setItem(`${BASE_KEY}:${ownerKey}`, String(value)) } catch { /* local preference remains in memory */ }
  }

  const value = useMemo<PotentialContextValue>(() => ({
    showPotential,
    setShowPotential,
    available,
    loading: ceilingStatus === 'loading' || generalCeilingStatus === 'loading',
    experimental,
    detail: generalCeilingStatus === 'invalid' && ceilingStatus === 'invalid' ? `${generalCeilingDetail} ${ceilingDetail} Desative e ative para tentar novamente.` : IDLE_DETAIL,
    ceilingModel,
    ceilingStatus,
    ceilingDetail,
    generalCeilingModel,
    generalCeilingStatus,
    generalCeilingDetail,
  }), [showPotential, available, experimental, ceilingModel, ceilingStatus, ceilingDetail, generalCeilingModel, generalCeilingStatus, generalCeilingDetail])

  return <PotentialContext.Provider value={value}>{children}</PotentialContext.Provider>
}

export function usePotential() {
  const context = useContext(PotentialContext)
  if (!context) throw new Error('usePotential precisa estar dentro de PotentialProvider')
  return context
}
