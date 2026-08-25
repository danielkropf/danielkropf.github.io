import { supabase } from './supabase'

export type ModelConfigPatch = Record<string, unknown>

export async function patchModelConfig(saveId: string, version: string, patch: ModelConfigPatch, name = 'Model Lab') {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const { data, error } = await supabase.rpc('patch_scoring_model_config', {
    p_save_id: saveId,
    p_name: name,
    p_version: version,
    p_patch: patch,
  })
  if (error) throw error
  const result = data as { id?: string; config?: Record<string, unknown> } | null
  if (!result?.id) throw new Error('O Banco Mestre não retornou o modelo salvo.')
  return { id: result.id, config: result.config ?? {} }
}
