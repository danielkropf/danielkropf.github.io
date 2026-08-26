import { supabase } from './supabase'

export type ModelConfigPatch = Record<string, unknown>
type ModelConfig = Record<string, unknown>
type SaveStatus = (status: string) => void

type PendingPatch = {
  patch: ModelConfigPatch
  version: string
  name: string
  timer: ReturnType<typeof setTimeout> | null
  listeners: Set<SaveStatus>
}

const modelConfigCache = new Map<string, ModelConfig>()
const modelConfigLoads = new Map<string, Promise<ModelConfig>>()
const pendingPatches = new Map<string, PendingPatch>()

function cacheKey(saveId: string, name: string) {
  return `${saveId}:${name}`
}

export async function loadModelConfig(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const cached = modelConfigCache.get(key)
  if (cached) return cached

  const existing = modelConfigLoads.get(key)
  if (existing) return existing

  const request = (async () => {
    if (!supabase) return {}
    const { data, error } = await supabase
      .from('scoring_models')
      .select('config')
      .eq('save_id', saveId)
      .eq('name', name)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (error) throw error
    const config = (data?.config ?? {}) as ModelConfig
    modelConfigCache.set(key, config)
    return config
  })().finally(() => modelConfigLoads.delete(key))

  modelConfigLoads.set(key, request)
  return request
}

export function peekModelConfig(saveId: string, name = 'Model Lab') {
  return modelConfigCache.get(cacheKey(saveId, name)) ?? null
}

export function invalidateModelConfig(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  modelConfigCache.delete(key)
  modelConfigLoads.delete(key)
}

/** Removes every local Model Lab resource for a deleted save, including a queued autosave. */
export function discardModelConfigState(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const pending = pendingPatches.get(key)
  if (pending?.timer) clearTimeout(pending.timer)
  pendingPatches.delete(key)
  modelConfigCache.delete(key)
  modelConfigLoads.delete(key)
}

export async function patchModelConfig(saveId: string, version: string, patch: ModelConfigPatch, name = 'Model Lab') {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const key = cacheKey(saveId, name)
  const current = modelConfigCache.get(key) ?? {}
  modelConfigCache.set(key, { ...current, ...patch })

  const { data, error } = await supabase.rpc('patch_scoring_model_config', {
    p_save_id: saveId,
    p_name: name,
    p_version: version,
    p_patch: patch,
  })
  if (error) throw error
  const result = data as { id?: string; config?: ModelConfig } | null
  if (!result?.id) throw new Error('O Banco Mestre não retornou o modelo salvo.')
  const config = result.config ?? { ...current, ...patch }
  modelConfigCache.set(key, config)
  return { id: result.id, config }
}

export function scheduleModelConfigPatch(
  saveId: string,
  version: string,
  patch: ModelConfigPatch,
  onStatus?: SaveStatus,
  name = 'Model Lab',
  delay = 450,
) {
  const key = cacheKey(saveId, name)
  const current = modelConfigCache.get(key) ?? {}
  modelConfigCache.set(key, { ...current, ...patch })

  const pending = pendingPatches.get(key) ?? {
    patch: {},
    version,
    name,
    timer: null,
    listeners: new Set<SaveStatus>(),
  }
  pending.patch = { ...pending.patch, ...patch }
  pending.version = version
  pending.name = name
  if (onStatus) pending.listeners.add(onStatus)
  if (pending.timer) clearTimeout(pending.timer)
  pending.listeners.forEach(listener => listener('Salvando…'))
  pending.timer = setTimeout(() => {
    const queued = pendingPatches.get(key)
    if (!queued) return
    pendingPatches.delete(key)
    void patchModelConfig(saveId, queued.version, queued.patch, queued.name)
      .then(() => queued.listeners.forEach(listener => listener('Salvo automaticamente')))
      .catch(error => queued.listeners.forEach(listener => listener(`Erro: ${error instanceof Error ? error.message : 'falha ao salvar'}`)))
  }, delay)
  pendingPatches.set(key, pending)
}

export async function flushModelConfigPatch(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const pending = pendingPatches.get(key)
  if (!pending) return null
  pendingPatches.delete(key)
  if (pending.timer) clearTimeout(pending.timer)
  try {
    const result = await patchModelConfig(saveId, pending.version, pending.patch, pending.name)
    pending.listeners.forEach(listener => listener('Salvo automaticamente'))
    return result
  } catch (error) {
    pending.listeners.forEach(listener => listener(`Erro: ${error instanceof Error ? error.message : 'falha ao salvar'}`))
    throw error
  }
}
