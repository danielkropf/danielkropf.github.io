import { BASE_POSITION_DEFINITIONS, type BasePositionScoreResult, type GeneralScoreSnapshot } from './base-position-score'
import { canonicalRoleDefaultWeights, roleScore } from './role-scoring'
import { effectiveWeight } from './scoring'

export type ScoreAttributeEvidence = {
  key: string
  value: number
  ipWeight: number
  oopWeight: number
  priority: number
}

export type BaseScoreExplanation = {
  position: string
  scoreKey: string
  roleName: string
  ipScore: number | null
  oopScore: number | null
  attributes: ScoreAttributeEvidence[]
}

export function explainBasePositionScore(snapshot:GeneralScoreSnapshot,result:BasePositionScoreResult|null):BaseScoreExplanation|null{
  if(!result)return null
  const definition=BASE_POSITION_DEFINITIONS.find(item=>item.scoreKey===result.scoreKey&&item.family===result.family)
  if(!definition)return null
  const ip=canonicalRoleDefaultWeights(`IP-${definition.group}-${definition.roleCode}`,definition.roleName)
  const oop=canonicalRoleDefaultWeights(`OOP-${definition.group}-${definition.roleCode}`,definition.roleName)
  const attributes=snapshot.player_attributes.flatMap(attribute=>{
    if(attribute.value===null)return[]
    const ipWeight=ip[attribute.attribute_key]??1,oopWeight=oop[attribute.attribute_key]??1
    const priority=(effectiveWeight(ipWeight)+effectiveWeight(oopWeight))/2
    return priority>0?[{key:attribute.attribute_key,value:attribute.value,ipWeight,oopWeight,priority}]:[]
  }).sort((a,b)=>b.priority-a.priority||b.value-a.value||a.key.localeCompare(b.key))
  return{position:result.position,scoreKey:result.scoreKey,roleName:definition.roleName,ipScore:roleScore(snapshot.player_attributes,ip),oopScore:roleScore(snapshot.player_attributes,oop),attributes}
}
