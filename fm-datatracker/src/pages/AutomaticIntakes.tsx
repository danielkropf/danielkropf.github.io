import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { paginatedQuery } from '../lib/paginated-query'
import { aggregateIntakes, type IntakeObservation, type IntakeReview } from '../lib/intake-archive'
import type { RichPlayer } from '../lib/dataCache'

type Identity = { id: string; fm_player_id: string; date_of_birth: string | null }
export function AutomaticIntakes({saveId, currentPlayers}: {saveId: string; currentPlayers: RichPlayer[]}) {
  const [observations,setObservations]=useState<IntakeObservation[]>([])
  const [reviews,setReviews]=useState<IntakeReview[]>([])
  const [identities,setIdentities]=useState<Identity[]>([])
  const [error,setError]=useState(''), [loading,setLoading]=useState(true), [saving,setSaving]=useState(false)
  const [filter,setFilter]=useState('all')
  useEffect(()=>{
    let active=true
    setObservations([]);setReviews([]);setIdentities([]);setLoading(true);setError('')
    const db=supabase
    if (!db) { setError('Banco mestre indisponível.');setLoading(false);return }
    void Promise.all([
      paginatedQuery(()=>db.from('fm_intake_observations').select('*').eq('save_id',saveId).order('id')),
      paginatedQuery(()=>db.from('fm_intake_reviews').select('*').eq('save_id',saveId).order('cohort_key')),
      paginatedQuery(()=>db.from('players').select('id,fm_player_id,date_of_birth').eq('save_id',saveId).order('id')),
    ]).then(([obs,rev,ids])=>{
      if (!active) return
      setObservations(obs.data as IntakeObservation[]);setReviews(rev.data as IntakeReview[]);setIdentities(ids.data as Identity[])
    }).catch(cause=>{if(active)setError(`Não foi possível carregar os intakes automáticos: ${String(cause.message??cause)}`)}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[saveId])
  const classes=useMemo(()=>aggregateIntakes(observations,reviews),[observations,reviews])
  const currentById=useMemo(()=>new Map(currentPlayers.map(p=>[p.id,p])),[currentPlayers])
  async function review(key:string,decision:'confirmed'|'rejected'|null) {
    const db=supabase;if(!db||saving)return
    setSaving(true);setError('')
    try {
      const {data,error:authError}=await db.auth.getUser()
      if(authError||!data.user)throw new Error('Sessão inválida.')
      const row={save_id:saveId,owner_id:data.user.id,cohort_key:key,decision,reviewed_at:new Date().toISOString()}
      const result=decision ? await db.from('fm_intake_reviews').upsert(row) : await db.from('fm_intake_reviews').delete().eq('save_id',saveId).eq('cohort_key',key)
      if(result.error)throw result.error
      setReviews(old=>[...old.filter(r=>r.cohort_key!==key),...(decision?[{cohort_key:key,decision,reviewed_at:row.reviewed_at}]:[])])
    }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao registrar revisão.')}
    finally{setSaving(false)}
  }
  return <section aria-label="Intakes identificados no save">
    <header className="roadmap-heading"><div><h2>Intakes identificados no save</h2><p>A turma preserva quem chegou na formação, mesmo após sair do clube. Notícias compatíveis dão suporte à identificação; grupos de testes isolados precisam de revisão.</p></div></header>
    {error&&<p role="alert" className="warning">{error}</p>}
    <label>Exibir <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todas as turmas</option><option value="review">Pendentes de revisão</option><option value="confirmed">Confirmadas por você</option><option value="rejected">Descartadas</option></select></label>
    {loading?<p>Carregando intakes…</p>:!classes.length?<p>Nenhum intake registrado. Importe ou atualize um .fm salvo durante a chegada dos candidatos. Um save posterior ao fim dos testes pode não conservar a evidência.</p>:null}
    <div className="academy-grid">{classes.filter(c=>filter==='all'||(filter==='review'?!c.decision:c.decision===filter)).map(c=><article className="card academy-class" key={c.key}>
      <details><summary className="academy-class-toggle"><span><span className="eyebrow">{c.club_name}</span><strong>Turma de {c.intake_date.slice(0,4)}</strong><small>{c.intake_date} · {c.identity_conflict?'Conflito de identidade':c.decision==='confirmed'?'Confirmada por você':c.decision==='rejected'?'Descartada':c.confidence==='supported'?'Sustentada por notícia e candidatos':'Candidata — revisar'}</small></span><b>{c.members.length}</b></summary>
      <div className="academy-members">{c.members.map(m=>{
        const identity=identities.find(p=>p.fm_player_id===m.uid&&p.date_of_birth===m.birth_date)
        const current=identity?currentById.get(identity.id):null
        const observed=!!current?.current_factual.observedAtCheckpoint
        return <div key={`${m.uid}:${m.birth_date}`}><span>{identity?<Link to={`/players/${identity.id}`}>{m.name}</Link>:m.name}<small>Nascimento: {m.birth_date} · UID {m.uid}</small></span><em>{observed?current?.current_factual.currentClubName??'Observado; vínculo incerto':'Sem observação atual'}</em></div>
      })}</div>
      <p>{c.observations.length} checkpoint(s) com evidência. {c.members.length < c.expected_members ? `${c.expected_members-c.members.length} identidade(s) ainda não resolvida(s).` : ''} A data de entrada vem dos registros de testes compatíveis.</p>
      {c.identity_conflict&&<p className="warning">Há biografias diferentes para o mesmo UID. Não tratamos esses jogadores como a mesma pessoa. Revise a ramificação do save.</p>}
      <details><summary>Origem da identificação</summary>{c.observations.map(o=><p key={o.id}>{o.checkpoint_date} · {o.evidence.method==='news_envelope_and_trial_cohort'?'Notícia compatível e grupo de testes':'Grupo de testes de 42 dias'} · {o.evidence.members.length} nomes preservados</p>)}</details>
      <div className="roadmap-toolbar"><button type="button" className="button" disabled={saving||c.identity_conflict||c.decision==='confirmed'} onClick={()=>void review(c.key,'confirmed')}>Confirmar turma</button><button type="button" className="ghost" disabled={saving||c.decision==='rejected'} onClick={()=>void review(c.key,'rejected')}>Descartar identificação</button>{c.decision&&<button type="button" className="ghost" disabled={saving} onClick={()=>void review(c.key,null)}>Reabrir revisão</button>}</div>
      </details></article>)}</div>
  </section>
}
