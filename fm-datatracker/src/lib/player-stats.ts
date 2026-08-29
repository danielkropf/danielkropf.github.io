import { performanceConfidence } from './scoring'
import { supabase } from './supabase'
import type { PlayerStat } from '../types/domain'

export type StatsSample = {
  minutes: number
  confidence: number
  label: 'Sem amostra' | 'Amostra baixa' | 'Amostra parcial' | 'Amostra forte'
}

const numeric = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

export function statsSample(minutes: number | null | undefined): StatsSample {
  const resolved = Math.max(0, minutes ?? 0)
  const confidence = performanceConfidence(resolved)
  const label = resolved <= 0 ? 'Sem amostra' : confidence < .4 ? 'Amostra baixa' : confidence < .75 ? 'Amostra parcial' : 'Amostra forte'
  return { minutes: resolved, confidence, label }
}

const LABELS: Record<string,string> = {
  avg_rating:'Média',pom:'PoM',goals:'Gols',assists:'Assistências',g_a:'G+A',xg:'xG',xa:'xA',g_xg:'G-xG',a_xa:'A-xA',
  shots:'Finalizações',shots_on_target:'No alvo',key_passes:'Passes-chave',dribbles:'Dribles',progressive_passes_psp:'Passes progressivos',
  pass_completion:'Passes certos %',pass_completion_pct:'Passes certos %',tackles_completed:'Desarmes',interceptions:'Interceptações',
  possession_won_90:'Posse ganha/90',press_attempts:'Pressões',press_completed:'Pressões completas',press_success:'Pressão %',press_success_pct:'Pressão %',
  clean_sheets:'Clean sheets',goals_conceded:'Gols sofridos',save:'Defesas %',save_pct:'Defesas %'
}
const HIDDEN = new Set(['season','competition','team','club','minutes','appearances','starts','sub_appearances','name','nome','player','position','positions','id_fm','fm_player_id'])
export function statMetricEntries(stat: Pick<PlayerStat,'normalized_stats'>, limit=10) {
  return Object.entries(stat.normalized_stats ?? {})
    .filter(([key,value]) => !HIDDEN.has(key) && value !== null && value !== '' && (numeric(value) !== null || typeof value === 'string'))
    .map(([key,value]) => ({ key, label: LABELS[key] ?? key.replace(/_/g,' '), value }))
    .sort((a,b) => Number(Boolean(LABELS[b.key])) - Number(Boolean(LABELS[a.key])))
    .slice(0,limit)
}

export function statContextLabel(stat: Pick<PlayerStat,'season'|'competition'|'team'|'snapshot_date'>) {
  return [stat.season, stat.competition, stat.team].filter((value): value is string => Boolean(value)).join(' · ') || stat.snapshot_date
}

export async function loadPlayerStats(saveId:string,playerId:string):Promise<PlayerStat[]> {
  if(!supabase)return[]
  const result=await supabase
    .from('player_stats')
    .select('id,player_id,save_id,import_id,snapshot_date,season,competition,team,minutes,appearances,starts,sub_appearances,raw_stats,normalized_stats,created_at')
    .eq('save_id',saveId)
    .eq('player_id',playerId)
    .order('snapshot_date',{ascending:false})
    .order('created_at',{ascending:false})
  if(result.error)throw result.error
  return(result.data??[]) as unknown as PlayerStat[]
}
