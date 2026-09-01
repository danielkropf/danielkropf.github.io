import { supabase } from './supabase'
import { checkDatabaseCompatibility, resetDatabaseCompatibilityCache, type DatabaseCompatibility } from './database-compatibility'
import { describeDbError, isMissingRpcError } from './db-error'
import { addDirtyPatch, captureDirtyPatch, confirmDirtyPatch, dirtyPatchValues, type DirtyPatchState } from './model-config-dirty'

export type ModelConfigPatch = Record<string, unknown>
type ModelConfig = Record<string, unknown>
type SaveStatus = (status: string, detail?: string) => void

type PendingPatch = {
  version: string
  name: string
  timer: ReturnType<typeof setTimeout> | null
  listeners: Set<SaveStatus>
}

type DirtyMeta = { version: string; name: string }

export type ModelConfigSaveResult = {
  id: string
  config: ModelConfig
  transport: 'rpc' | 'direct-fallback' | 'noop'
  compatibility: DatabaseCompatibility
  diagnostic: string | null
}

const modelConfigCache = new Map<string, ModelConfig>()
const confirmedConfigCache = new Map<string, ModelConfig>()
const modelConfigIds = new Map<string, string>()
const modelConfigLoads = new Map<string, Promise<ModelConfig>>()
const pendingPatches = new Map<string, PendingPatch>()
const dirtyPatches = new Map<string, DirtyPatchState>()
const dirtyMeta = new Map<string, DirtyMeta>()
const writeChains = new Map<string, Promise<void>>()
let dirtyRevision = 0

function cacheKey(saveId: string, name: string) { return `${saveId}:${name}` }
function nextDirtyRevision() { dirtyRevision += 1; return dirtyRevision }
function compatibilityDiagnostic(compatibility: DatabaseCompatibility, transport: ModelConfigSaveResult['transport']) {
  if (transport === 'direct-fallback') return 'Compatibilidade temporária: a RPC de persistência não está disponível no schema online. O DataTracker salvou diretamente em scoring_models, mas a migration mais recente deve ser aplicada ao Supabase para recuperar as garantias transacionais entre abas e dispositivos.'
  if (compatibility.status === 'outdated' || compatibility.status === 'unversioned') return compatibility.diagnostic
  return null
}

function rebuildOptimisticCache(key: string) {
  const confirmed = confirmedConfigCache.get(key) ?? {}
  const dirty = dirtyPatchValues(dirtyPatches.get(key) ?? {})
  const config = { ...confirmed, ...dirty }
  modelConfigCache.set(key, config)
  return config
}

function markDirty(key: string, version: string, name: string, patch: ModelConfigPatch) {
  const current = dirtyPatches.get(key) ?? {}
  const confirmed = confirmedConfigCache.get(key) ?? {}
  const next = addDirtyPatch(current, patch, confirmed, nextDirtyRevision)
  if (Object.keys(next).length) {
    dirtyPatches.set(key, next)
    dirtyMeta.set(key, { version, name })
  } else {
    dirtyPatches.delete(key)
    dirtyMeta.delete(key)
  }
  rebuildOptimisticCache(key)
}

export async function loadModelConfig(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const cached = modelConfigCache.get(key)
  if (cached) return cached
  const existing = modelConfigLoads.get(key)
  if (existing) return existing

  const request = (async () => {
    if (!supabase) return {}
    const { data, error } = await supabase.from('scoring_models').select('id,config').eq('save_id', saveId).eq('name', name).eq('is_active', true).order('created_at').limit(2)
    if (error) throw new Error(describeDbError(error).full)
    if ((data?.length ?? 0) > 1) throw new Error('Há mais de um Model Lab ativo para este save. Aplique a migration de identidade canônica antes de continuar.')
    const row = data?.[0]
    const config = (row?.config ?? {}) as ModelConfig
    confirmedConfigCache.set(key, config)
    if (row?.id) modelConfigIds.set(key, String(row.id))
    return rebuildOptimisticCache(key)
  })().finally(() => modelConfigLoads.delete(key))

  modelConfigLoads.set(key, request)
  return request
}

export function peekModelConfig(saveId: string, name = 'Model Lab') { return modelConfigCache.get(cacheKey(saveId, name)) ?? null }
export function invalidateModelConfig(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  modelConfigCache.delete(key)
  confirmedConfigCache.delete(key)
  modelConfigIds.delete(key)
  modelConfigLoads.delete(key)
}

/** Removes every local Model Lab resource for a deleted save, including queued/dirty autosaves. */
export function discardModelConfigState(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const pending = pendingPatches.get(key)
  if (pending?.timer) clearTimeout(pending.timer)
  pendingPatches.delete(key)
  dirtyPatches.delete(key)
  dirtyMeta.delete(key)
  writeChains.delete(key)
  modelConfigCache.delete(key)
  confirmedConfigCache.delete(key)
  modelConfigIds.delete(key)
  modelConfigLoads.delete(key)
}

async function withBrowserFallbackLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined') return task()
  const lockManager = (navigator as Navigator & { locks?: { request: <R>(name: string, callback: () => Promise<R>) => Promise<R> } }).locks
  if (!lockManager?.request) return task()
  return lockManager.request(`fm-datatracker:model-config:${key}`, task)
}

async function directPatchModelConfig(saveId: string, version: string, patch: ModelConfigPatch, name: string) {
  const client = supabase
  if (!client) throw new Error('Banco Mestre não configurado.')
  return withBrowserFallbackLock(cacheKey(saveId, name), async () => {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError) throw new Error(describeDbError(authError).full)
    const user = authData.user
    if (!user) throw new Error('Sessão inválida.')

    // Match the RPC ownership check even on older schemas whose scoring_models
    // policy validated only owner_id.
    const { data: ownedSave, error: saveError } = await client.from('saves').select('id').eq('id', saveId).eq('owner_id', user.id).maybeSingle()
    if (saveError) throw new Error(describeDbError(saveError).full)
    if (!ownedSave) throw new Error('Save não encontrado ou não pertence ao usuário autenticado.')

    const { data: rows, error: readError } = await client.from('scoring_models').select('id,config').eq('owner_id', user.id).eq('save_id', saveId).eq('name', name).eq('is_active', true).order('created_at').limit(2)
    if (readError) throw new Error(describeDbError(readError).full)
    if ((rows?.length ?? 0) > 1) throw new Error('Há mais de um Model Lab ativo para este save. O fallback recusou escolher um registro arbitrariamente; aplique a migration mais recente.')

    const existing = rows?.[0]
    const current = existing?.config && typeof existing.config === 'object' && !Array.isArray(existing.config) ? existing.config as ModelConfig : {}
    const config = { ...current, ...patch }
    if (existing?.id) {
      const { data, error } = await client.from('scoring_models').update({ config, version, is_active: true }).eq('id', existing.id).eq('owner_id', user.id).eq('save_id', saveId).select('id,config').single()
      if (error) throw new Error(describeDbError(error).full)
      return { id: String(data.id), config: (data.config ?? config) as ModelConfig }
    }

    const { data, error } = await client.from('scoring_models').insert({ owner_id: user.id, save_id: saveId, name, version, config, is_active: true }).select('id,config').single()
    if (error) throw new Error(describeDbError(error).full)
    return { id: String(data.id), config: (data.config ?? config) as ModelConfig }
  })
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
  console.warn('RPC patch_scoring_model_config ausente; usando fallback direto temporário.', { saveId, name, version, error: info })
  const direct = await directPatchModelConfig(saveId, version, patch, name)
  // Do not pin an outdated/unversioned answer for the rest of the session.
  resetDatabaseCompatibilityCache()
  const refreshedCompatibility = await checkDatabaseCompatibility(true)
  return { ...direct, transport: 'direct-fallback', compatibility: refreshedCompatibility, diagnostic: compatibilityDiagnostic(refreshedCompatibility, 'direct-fallback') }
}

async function noopResult(key: string): Promise<ModelConfigSaveResult> {
  const compatibility = await checkDatabaseCompatibility()
  return {
    id: modelConfigIds.get(key) ?? '',
    config: rebuildOptimisticCache(key),
    transport: 'noop',
    compatibility,
    diagnostic: compatibilityDiagnostic(compatibility, 'noop'),
  }
}

async function flushDirtyModelConfig(saveId: string, version: string, name: string): Promise<ModelConfigSaveResult> {
  const key = cacheKey(saveId, name)
  const previous = writeChains.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const marker = new Promise<void>(resolve => { release = resolve })
  writeChains.set(key, previous.catch(() => undefined).then(() => marker))

  try {
    await previous.catch(() => undefined)
    const state = dirtyPatches.get(key) ?? {}
    const snapshot = captureDirtyPatch(state)
    if (!snapshot) return noopResult(key)

    const meta = dirtyMeta.get(key)
    const effectiveVersion = meta?.version ?? version
    const effectiveName = meta?.name ?? name
    const result = await persistModelConfig(saveId, effectiveVersion, snapshot.patch, effectiveName)
    confirmedConfigCache.set(key, result.config)
    modelConfigIds.set(key, result.id)

    const after = confirmDirtyPatch(dirtyPatches.get(key) ?? {}, snapshot)
    if (Object.keys(after).length) dirtyPatches.set(key, after)
    else {
      dirtyPatches.delete(key)
      dirtyMeta.delete(key)
    }
    result.config = rebuildOptimisticCache(key)
    return result
  } finally {
    release()
  }
}

export async function patchModelConfig(saveId: string, version: string, patch: ModelConfigPatch, name = 'Model Lab'): Promise<ModelConfigSaveResult> {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const key = cacheKey(saveId, name)
  markDirty(key, version, name, patch)
  return flushDirtyModelConfig(saveId, version, name)
}

export function scheduleModelConfigPatch(saveId: string, version: string, patch: ModelConfigPatch, onStatus?: SaveStatus, name = 'Model Lab', delay = 450) {
  const key = cacheKey(saveId, name)
  markDirty(key, version, name, patch)

  const pending = pendingPatches.get(key) ?? { version, name, timer: null, listeners: new Set<SaveStatus>() }
  pending.version = version
  pending.name = name
  if (onStatus) pending.listeners.add(onStatus)
  if (pending.timer) clearTimeout(pending.timer)
  pending.listeners.forEach(listener => listener('Salvando…'))
  pending.timer = setTimeout(() => {
    const queued = pendingPatches.get(key)
    if (!queued) return
    pendingPatches.delete(key)
    void flushDirtyModelConfig(saveId, queued.version, queued.name)
      .then(result => queued.listeners.forEach(listener => listener('✓ Salvo', result.diagnostic ?? undefined)))
      .catch(error => {
        const detail = describeDbError(error).full
        queued.listeners.forEach(listener => listener('⚠ Não foi possível salvar', detail))
      })
  }, delay)
  pendingPatches.set(key, pending)
}

export async function flushModelConfigPatch(saveId: string, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const pending = pendingPatches.get(key)
  if (pending) {
    pendingPatches.delete(key)
    if (pending.timer) clearTimeout(pending.timer)
  }
  const meta = dirtyMeta.get(key)
  if (!pending && !meta) return null
  const version = pending?.version ?? meta!.version
  const effectiveName = pending?.name ?? meta!.name
  try {
    const result = await flushDirtyModelConfig(saveId, version, effectiveName)
    pending?.listeners.forEach(listener => listener('✓ Salvo', result.diagnostic ?? undefined))
    return result
  } catch (error) {
    const detail = describeDbError(error).full
    pending?.listeners.forEach(listener => listener('⚠ Não foi possível salvar', detail))
    throw error
  }
}

/** Best-effort lifecycle flush for every queued Model Lab autosave. */
export async function flushAllModelConfigPatches() {
  const keys = [...new Set([...pendingPatches.keys(), ...dirtyPatches.keys()])]
  const results = await Promise.allSettled(keys.map(key => {
    const separator = key.indexOf(':')
    if (separator < 1) return Promise.resolve(null)
    return flushModelConfigPatch(key.slice(0, separator), key.slice(separator + 1))
  }))
  return results
}

export async function retryModelConfigPatch(saveId: string, onStatus?: SaveStatus, name = 'Model Lab') {
  const key = cacheKey(saveId, name)
  const meta = dirtyMeta.get(key)
  if (!meta || !Object.keys(dirtyPatches.get(key) ?? {}).length) return null
  onStatus?.('Salvando…')
  resetDatabaseCompatibilityCache()
  try {
    const result = await flushDirtyModelConfig(saveId, meta.version, meta.name)
    onStatus?.('✓ Salvo', result.diagnostic ?? undefined)
    return result
  } catch (error) {
    const detail = describeDbError(error).full
    onStatus?.('⚠ Não foi possível salvar', detail)
    throw error
  }
}

/** Exposed for diagnostics/tests without leaking patch values. */
export function hasDirtyModelConfig(saveId: string, name = 'Model Lab') {
  return Object.keys(dirtyPatches.get(cacheKey(saveId, name)) ?? {}).length > 0
}
