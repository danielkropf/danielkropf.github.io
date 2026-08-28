import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSaves } from '../features/saves/SaveContext'
import { createLatestSaveRequestGuard } from '../lib/latest-save-request'

const EMPTY_QUALITY = { players: 0, active: 0, imports: 0, withoutSnapshots: 0, unknownType: 0 }

export function QualityPage() {
  const { selected } = useSaves()
  const [data, setData] = useState(EMPTY_QUALITY)
  const [error, setError] = useState('')
  const requestGuard = useRef(createLatestSaveRequestGuard())

  useEffect(() => {
    if (!supabase || !selected?.id) {
      requestGuard.current.invalidate()
      setData(EMPTY_QUALITY)
      return
    }

    const saveId = selected.id
    const token = requestGuard.current.begin(saveId)
    setError('')

    void Promise.all([
      supabase.from('players').select('id,is_active,player_snapshots(id)').eq('save_id', saveId),
      supabase.from('imports').select('id,file_type').eq('save_id', saveId),
    ]).then(([playersResult, importsResult]) => {
      if (!requestGuard.current.isCurrent(token)) return
      if (playersResult.error || importsResult.error) {
        setError(playersResult.error?.message ?? importsResult.error?.message ?? 'Falha ao carregar auditoria.')
        return
      }
      const players = playersResult.data ?? []
      const imports = importsResult.data ?? []
      setData({
        players: players.length,
        active: players.filter(player => player.is_active).length,
        imports: imports.length,
        withoutSnapshots: players.filter(player => !player.player_snapshots?.length).length,
        unknownType: imports.filter(item => item.file_type === 'unknown').length,
      })
    }).catch(cause => {
      if (!requestGuard.current.isCurrent(token)) return
      setError(cause instanceof Error ? cause.message : 'Falha inesperada ao carregar auditoria.')
    })

    return () => requestGuard.current.invalidate(token)
  }, [selected?.id])

  return <>
    <span className="eyebrow">AUDITORIA</span><h1>Data Quality</h1>
    <div className="metric-grid">
      <Metric n={data.players} t="Jogadores históricos" />
      <Metric n={data.active} t="Jogadores ativos" />
      <Metric n={data.imports} t="Imports" />
      <Metric n={data.withoutSnapshots} t="Sem snapshot" bad />
      <Metric n={data.unknownType} t="Tipo desconhecido" bad />
    </div>
    {error && <p className="warning">Falha ao carregar a auditoria: {error}</p>}
    <section className="card section"><h2>Regras ativas</h2><ul>
      <li>Toda fotografia gravada exige uma data completa; ano estimado nunca vira 01/01 automaticamente.</li>
      <li>CA/PA são preservados como evidência e continuam fora da pontuação.</li>
      <li>Arquivos com o mesmo conteúdo não criam uma nova fotografia só porque foram renomeados.</li>
      <li>Dado ausente permanece ausente; nunca vira zero por conveniência.</li>
      <li>ID do FM tem prioridade; sem ID, nome+nascimento é o fallback forte e nome isolado só vale quando é único.</li>
      <li>O elenco ativo é recalculado a partir das fotografias mais recentes, inclusive após excluir um import.</li>
    </ul></section>
  </>
}

function Metric({ n, t, bad }: { n: number; t: string; bad?: boolean }) {
  return <div className={`card metric ${bad && n ? 'danger' : ''}`}><b>{n}</b><span>{t}</span></div>
}
