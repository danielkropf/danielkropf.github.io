import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { generalScoreForSnapshot } from './base-position-score'
import { pairedRoleScore, resolveRoleWeights } from './role-scoring'
import { positionalRating } from './position-aptitude'
import { generalReferencePercentile } from './reference'

const attrs=(value=12)=>ATTRIBUTE_CATALOG.map(attribute=>({attribute_key:attribute.key,value}))
const withValues=(base:ReturnType<typeof attrs>, values:Record<string,number>)=>base.map(attribute=>({...attribute,value:values[attribute.attribute_key]??attribute.value}))

function snapshot(position:string,rating:number,attributes=attrs()){
  const code=position.replace(/[^A-Z]/gi,'').toUpperCase()
  return{positions:[position],normalized_data:{positional_ratings:{[code]:rating}},player_attributes:attributes}
}

describe('Scoring v2 canônico',()=>{
  it('não deixa atributos específicos de goleiro contaminar a Nota Geral de linha',()=>{
    const low=withValues(attrs(),Object.fromEntries(ATTRIBUTE_CATALOG.filter(a=>a.category==='goalkeeping').map(a=>[a.key,1])))
    const high=withValues(attrs(),Object.fromEntries(ATTRIBUTE_CATALOG.filter(a=>a.category==='goalkeeping').map(a=>[a.key,20])))
    expect(generalScoreForSnapshot(snapshot('ST (C)',18,low))?.score).toBeCloseTo(generalScoreForSnapshot(snapshot('ST (C)',18,high))?.score??-1,10)
  })

  it('não deixa atributos claramente de linha contaminar a Nota Geral de goleiro',()=>{
    const keys=['crossing','dribbling','finishing','heading','long_shots','marking','tackling','off_the_ball']
    const low=withValues(attrs(),Object.fromEntries(keys.map(key=>[key,1])))
    const high=withValues(attrs(),Object.fromEntries(keys.map(key=>[key,20])))
    expect(generalScoreForSnapshot(snapshot('GK',18,low))?.score).toBeCloseTo(generalScoreForSnapshot(snapshot('GK',18,high))?.score??-1,10)
  })

  it('calcula RoleScore mesmo quando a função não é natural para o jogador',()=>{
    const player=snapshot('D (C)',18)
    const ip=resolveRoleWeights({roleId:'IP-test-centre-forward',roleName:'Centre Forward'})
    const oop=resolveRoleWeights({roleId:'OOP-test-centre-forward',roleName:'Centre Forward'})
    expect(pairedRoleScore(player.player_attributes,ip,oop)).not.toBeNull()
    expect(generalScoreForSnapshot(player)?.position).toBe('D (C)')
  })

  it('deriva percentil exatamente da mesma Nota Geral exibida',()=>{
    const player=snapshot('ST (C)',18)
    const score=generalScoreForSnapshot(player)?.score??0
    const result=generalReferencePercentile(score,player,{GK:[],D:[],WB:[],DM:[],M:[],AM:[],ST:[score-1,score,score+1]})
    expect(result?.family).toBe('ST')
    expect(result?.percentile).toBe(67)
    expect(result?.population).toEqual([score-1,score,score+1])
  })

  it('aceita aliases documentados dentro de positional_ratings e positional_ability',()=>{
    expect(positionalRating({positions:[],normalized_data:{positional_ratings:{'D (C)':17}}},'D (C)')).toBe(17)
    expect(positionalRating({positions:[],normalized_data:{positional_ability:{defender_center:16}}},'D (C)')).toBe(16)
  })

  it('usa aptidão >=15 para elegibilidade geral e mantém a leitura posicional compartilhada',()=>{
    const player={positions:['D (C)','ST (C)'],normalized_data:{positional_ratings:{DC:18,ST:4}},player_attributes:attrs()}
    expect(positionalRating(player,'D (C)')).toBe(18)
    expect(positionalRating(player,'ST (C)')).toBe(4)
    expect(generalScoreForSnapshot(player)?.position).toBe('D (C)')
  })
})
