import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadCurrentPlayers, type CurrentPlayerSummary } from '../lib/dataCache'
import { loadModelConfig } from '../lib/model-config'
import { derivePlanningDistribution, type PlanningDistributionSource } from '../lib/planningDistribution'
import { SquadDistribution } from '../components/SquadDistribution'
import { useSaves } from '../features/saves/SaveContext'

type ModelConfig = {
  planning?: PlanningDistributionSource
  tactics?: Array<{ id: string; name: string }>
  selected_tactic_id?: string | null
}
type ImportInfo = { snapshot_date: string; original_filename: string; row_count: number; status: string }

export function Dashboard() {
  const { selected } = useSaves()
  const [players, setPlayers] = useState<CurrentPlayerSummary[]>([])
  const [model, setModel] = useState<ModelConfig>({})
  const [lastImport, setLastImport] = useState<ImportInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!selected || !supabase) {
      setPlayers([])
      setModel({})
      setLastImport(null)
      setLoading(false)
      return () => { active = false }
    }

    setLoading(true)
    void Promise.all([
      loadCurrentPlayers(selected.id, { summary: true }),
      loadModelConfig(selected.id),
      supabase
        .from('imports')
        .select('snapshot_date,original_filename,row_count,status')
        .eq('save_id', selected.id)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([currentPlayers, modelConfig, importResult]) => {
      if (!active) return
      setPlayers(currentPlayers)
      setModel(modelConfig as ModelConfig)
      setLastImport(importResult.data as ImportInfo | null)
      setLoading(false)
    }).catch(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [selected?.id])

  const summary = useMemo(() => {
    const latest = players.map(player => player.player_snapshots[0]).filter(Boolean)
    const ages = latest.map(snapshot => snapshot.age).filter((age): age is number => age !== null)
    const distribution = derivePlanningDistribution(players.map(player => player.id), model.planning)
    const young = ages.filter(age => age <= 21).length
    const prime = ages.filter(age => age >= 22 && age <= 29).length
    const veterans = ages.filter(age => age >= 30).length
    const tactic = model.tactics?.find(item => item.id === model.selected_tactic_id)?.name ?? model.tactics?.[0]?.name ?? null

    return { ...distribution, young, prime, veterans, tactic }
  }, [players, model.planning, model.tactics, model.selected_tactic_id])

  if (!selected) return <section className="dashboard-empty card">
    <span className="eyebrow">PRIMEIROS PASSOS</span>
    <h1>Comece criando seu save</h1>
    <p>O painel passa a acompanhar elenco, planejamento e evolução assim que os primeiros dados forem importados.</p>
    <Link className="button" to="/saves">Criar save</Link>
  </section>

  return <div className={`dashboard-v2 ${loading ? 'is-loading' : ''}`}>
    <header className="dashboard-heading">
      <div>
        <span className="eyebrow">CENTRAL DO SAVE</span>
        <h1>{selected.name}</h1>
        <p>{selected.club_name}{selected.current_season ? ` · ${selected.current_season}` : ''}</p>
      </div>
    </header>

    <section className="dashboard-kpis">
      <Insight value={players.length} label="jogadores ativos" hint={`${summary.assigned} já organizados`}/>
      <Insight value={summary.unassigned} label="sem elenco definido" hint={summary.unassigned ? 'Revisar no Planejamento' : 'Elenco totalmente organizado'}/>
      <Insight value={model.tactics?.length ?? 0} label="táticas criadas" hint={summary.tactic ? `Ativa: ${summary.tactic}` : 'Crie a estrutura do time'}/>
      <Insight value={lastImport ? formatDate(lastImport.snapshot_date) : '—'} label="última fotografia" hint={lastImport ? `${lastImport.row_count} linhas · ${lastImport.original_filename}` : 'Nenhum import concluído'}/>
    </section>

    <section className="dashboard-main-grid">
      <article className="card dashboard-planning">
        <header>
          <div><span className="eyebrow">PLANEJAMENTO</span><h2>Distribuição do elenco</h2></div>
          <Link to="/planning">Organizar →</Link>
        </header>
        {players.length
          ? <>
              <SquadDistribution groups={summary.groups} unassigned={summary.unassigned} total={summary.active}/>
              {summary.duplicatePlayerIds.length > 0 && <p className="distribution-note warning">{summary.duplicatePlayerIds.length} jogador(es) apareciam em mais de um elenco e foram contados apenas uma vez.</p>}
            </>
          : <Empty text="Crie os elencos e distribua seus jogadores." action="Abrir Planejamento" to="/planning"/>}
      </article>

      <article className="card dashboard-age">
        <header>
          <div><span className="eyebrow">PERFIL DO GRUPO</span><h2>Faixa etária</h2></div>
          <Link to="/squad">Ver elenco →</Link>
        </header>
        <div className="age-breakdown">
          <Age value={summary.young} label="Até 21" tone="young"/>
          <Age value={summary.prime} label="22–29" tone="prime"/>
          <Age value={summary.veterans} label="30+" tone="veteran"/>
        </div>
        <p>Use o equilíbrio entre desenvolvimento, auge e experiência para orientar o planejamento.</p>
      </article>

      <article className="card dashboard-next">
        <span className="eyebrow">PRÓXIMAS DECISÕES</span>
        <h2>{nextTitle(players.length, summary.unassigned, model.tactics?.length ?? 0)}</h2>
        <p>{nextText(players.length, summary.unassigned, model.tactics?.length ?? 0)}</p>
        <div>
          <Link className="button" to={players.length ? summary.unassigned ? '/planning' : '/squad' : '/imports'}>{players.length ? summary.unassigned ? 'Organizar elenco' : 'Analisar jogadores' : 'Importar jogadores'}</Link>
          <Link className="ghost button" to="/scoring">Revisar pontuação</Link>
        </div>
      </article>
    </section>
  </div>
}

function Insight({ value, label, hint }: { value: number | string; label: string; hint: string }) {
  return <article className="card dashboard-insight"><strong>{value}</strong><span>{label}</span><small>{hint}</small></article>
}
function Age({ value, label, tone }: { value: number; label: string; tone: string }) {
  return <div className={tone}><strong>{value}</strong><span>{label}</span></div>
}
function Empty({ text, action, to }: { text: string; action: string; to: string }) {
  return <div className="dashboard-inline-empty"><p>{text}</p><Link to={to}>{action} →</Link></div>
}
function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR').format(date)
}
function nextTitle(players: number, unassigned: number, tactics: number) {
  if (!players) return 'Construa sua primeira base de dados'
  if (!tactics) return 'Defina como seu time joga'
  if (unassigned) return `${unassigned} jogadores ainda precisam de destino`
  return 'O save está pronto para análise'
}
function nextText(players: number, unassigned: number, tactics: number) {
  if (!players) return 'Importe uma view de atributos do FM para iniciar o acompanhamento.'
  if (!tactics) return 'Crie uma tática para comparar funções, organizar profundidade e selecionar o time.'
  if (unassigned) return 'Complete a distribuição para enxergar a profundidade real de cada elenco.'
  return 'Compare jogadores, ajuste os pesos e acompanhe a evolução no próximo snapshot.'
}
