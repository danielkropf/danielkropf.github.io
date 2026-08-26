import { supabase } from './supabase'
import { checkDatabaseCompatibility, type DatabaseCompatibility } from './database-compatibility'
import { describeDbError, isMissingRpcError } from './db-error'

export type ModelConfigPatch = Record<string, unknown>
type ModelConfig = Record<string, unknown>
type SaveStatus = (status: string, detail?: string) => void

type PendingPatch = {
  patch: ModelConfigPatch
  version: string
  name: string
  timer: ReturnType<typeof setTimeout> | null
  listeners: Set<SaveStatus>
}

type FailedPatch = Omit<PendingPatch, 'timer'>

export type ModelConfigSaveResult = {
  id: string
  config: ModelConfig
  transport: 'rpc' | 'direct-fallback'
  compatibility: DatabaseCompatibility
  diagnostic: string | null
}

const modelConfigCache = new Map<string, ModelConfig>()
const modelConfigLoads = new Map<string, Promise<ModelConfig>>()
const pendingPatches = new Map<string, PendingPatch>()
const failedPatches = new Map<string, FailedPatch>()
const writeChains = new Map<string, Promise<void>>()

function cacheKey(saveId: string, name: string) { return `${saveId}:${name}` }
function compatibilityDiagnostic(compatibility: DatabaseCompatibility, transport: ModelConfigSaveResult['transport']) {
  if (transport === 'direct-fallback') return 'A RPC de persistência não está disponível no schema online. O DataTracker salvou diretamente em scoring_models usando as mesmas regras de RLS. A migration mais recente ainda deve ser aplicada ao Supabase.'
  if (compatibility.status === 'outdated' || compatibility.status === 'unversioned') return compatibility.diagnostic
  return null
}

export async function loadModelConfig(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const cached = modelConfigCache.get(key)
  if (cached) return cached
  const existing = modelConfigLoads.get(key)
  if (existing) return existing

  const request = (async () => {
    if (!supabase) return {}
    const { data, error } = await supabase.from('scoring_models').select('config').eq('save_id', saveId).eq('name', name).eq('is_active', true).order('created_at').limit(1).maybeSingle()
    if (error) throw new Error(describeDbError(error).full)
    const config = (data?.config ?? {}) as ModelConfig
    modelConfigCache.set(key, config)
    return config
  })().finally(() => modelConfigLoads.delete(key))

  modelConfigLoads.set(key, request)
  return request
}

export function peekModelConfig(saveId: string, name = 'Model Lab') { return modelConfigCache.get(cacheKey(saveId, name)) ?? null }
export function invalidateModelConfig(saveId: string, name = 'Model Lab') { const key = cacheKey(saveId, name); modelConfigCache.delete(key); modelConfigLoads.delete(key) }

/** Removes every local Model Lab resource for a deleted save, including queued/failed autosaves. */
export function discardModelConfigState(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const pending = pendingPatches.get(key)
  if (pending?.timer) clearTimeout(pending.timer)
  pendingPatches.delete(key)
  failedPatches.delete(key)
  writeChains.delete(key)
  modelConfigCache.delete(key)
  modelConfigLoads.delete(key)
}

async function directPatchModelConfig(saveId: string, version: string, patch: ModelConfigPatch, name: string) {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(describeDbError(authError).full)
  const user = authData.user
  if (!user) throw new Error('Sessão inválida.')

  const { data: existing, error: readError } = await supabase.from('scoring_models').select('id,config').eq('save_id', saveId).eq('name', name).eq('is_active', true).order('created_at').limit(1).maybeSingle()
  if (readError) throw new Error(describeDbError(readError).full)

  const current = existing?.config && typeof existing.config === 'object' && !Array.isArray(existing.config) ? existing.config as ModelConfig : {}
  const config = { ...current, ...patch }
  if (existing?.id) {
    const { data, error } = await supabase.from('scoring_models').update({ config, version, is_active: true }).eq('id', existing.id).eq('save_id', saveId).select('id,config').single()
    if (error) throw new Error(describeDbError(error).full)
    return { id: String(data.id), config: (data.config ?? config) as ModelConfig }
  }

  const { data, error } = await supabase.from('scoring_models').insert({ owner_id: user.id, save_id: saveId, name, version, config, is_active: true }).select('id,config').single()
  if (error) throw new Error(describeDbError(error).full)
  return { id: String(data.id), config: (data.config ?? config) as ModelConfig }
}

async function persistModelConfig(saveId: string, version: string, patch: ModelConfigPatch, name: string): Promise<ModelConfigSaveResult> {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const compatibility = await checkDatabaseCompatibility()
  const { data, error } = await supabase.rpc('patch_scoring_model_config', { p_save_id: saveId, p_name: name, p_version: version, p_patch: patch })

  if (!error) {
    const result = data as { id?: string; config?: ModelConfig } | null
    if (!result?.id) throw new Error('O Banco Mestre não retornou o modelo salvo.')
    return { id: result.id, config: result.config ?? patch, transport: 'rpc', compatibility, diagnostic: compatibilityDiagnostic(compatibility, 'rpc') }
  }

  if (!isMissingRpcError(error)) {
    const info = describeDbError(error)
    console.error('Falha ao persistir Model Lab via patch_scoring_model_config.', { saveId, name, version, error: info })
    throw new Error(info.full)
  }

  const info = describeDbError(error)
  console.warn('RPC patch_scoring_model_config ausente; usando fallback direto protegido por RLS.', { saveId, name, version, error: info })
  const direct = await directPatchModelConfig(saveId, version, patch, name)
  return { ...direct, transport: 'direct-fallback', compatibility, diagnostic: compatibilityDiagnostic(compatibility, 'direct-fallback') }
}

function rememberFailure(key: string, version: string, name: string, patch: ModelConfigPatch, listeners: Iterable<SaveStatus> = []) {
  const previous = failedPatches.get(key)
  failedPatches.set(key, { version, name, patch: { ...(previous?.patch ?? {}), ...patch }, listeners: new Set([...(previous?.listeners ?? []), ...listeners]) })
}

export async function patchModelConfig(saveId: string, version: string, patch: ModelConfigPatch, name = 'Model Lab'): Promise<ModelConfigSaveResult> {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const key = cacheKey(saveId, name)
  const current = modelConfigCache.get(key) ?? {}
  modelConfigCache.set(key, { ...current, ...patch })

  const previous = writeChains.get(key) ?? Promise.resolve()
  let resolveChain: () => void = () => {}
  const chainMarker = new Promise<void>(resolve => { resolveChain = resolve })
  writeChains.set(key, previous.catch(() => undefined).then(() => chainMarker))

  try {
    await previous.catch(() => undefined)
    const result = await persistModelConfig(saveId, version, patch, name)
    modelConfigCache.set(key, result.config)
    failedPatches.delete(key)
    return result
  } catch (error) {
    rememberFailure(key, version, name, patch)
    throw error
  } finally {
    resolveChain()
  }
}

export function scheduleModelConfigPatch(saveId: string, version: string, patch: ModelConfigPatch, onStatus?: SaveStatus, name = 'Model Lab', delay = 450) {
  const key = cacheKey(saveId, name)
  const current = modelConfigCache.get(key) ?? {}
  modelConfigCache.set(key, { ...current, ...patch })

  const pending = pendingPatches.get(key) ?? { patch: {}, version, name, timer: null, listeners: new Set<SaveStatus>() }
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
      .then(result => queued.listeners.forEach(listener => listener('✓ Salvo', result.diagnostic ?? undefined)))
      .catch(error => {
        const detail = describeDbError(error).full
        rememberFailure(key, queued.version, queued.name, queued.patch, queued.listeners)
        queued.listeners.forEach(listener => listener('⚠ Não foi possível salvar', detail))
      })
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
    pending.listeners.forEach(listener => listener('✓ Salvo', result.diagnostic ?? undefined))
    return result
  } catch (error) {
    const detail = describeDbError(error).full
    rememberFailure(key, pending.version, pending.name, pending.patch, pending.listeners)
    pending.listeners.forEach(listener => listener('⚠ Não foi possível salvar', detail))
    throw error
  }
}

export async function retryModelConfigPatch(saveId: string, onStatus?: SaveStatus, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const failed = failedPatches.get(key)
  if (!failed) return null
  if (onStatus) failed.listeners.add(onStatus)
  failed.listeners.forEach(listener => listener('Salvando…'))
  try {
    const result = await patchModelConfig(saveId, failed.version, failed.patch, failed.name)
    failedPatches.delete(key)
    failed.listeners.forEach(listener => listener('✓ Salvo', result.diagnostic ?? undefined))
    return result
  } catch (error) {
    const detail = describeDbError(error).full
    failed.listeners.forEach(listener => listener('⚠ Não foi possível salvar', detail))
    throw error
  }
}
