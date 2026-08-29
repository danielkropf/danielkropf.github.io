import{describe,expect,it}from'vitest'
import{generalScoreForSnapshot}from'./base-position-score'
import{explainBasePositionScore}from'./score-explanation'

describe('base score explanation',()=>{
  it('explica a mesma posição usada pela nota geral sem alterar a fórmula',()=>{
    const snapshot={positions:['ST (C)'],player_attributes:[{attribute_key:'finishing',value:15},{attribute_key:'first_touch',value:14},{attribute_key:'passing',value:10}],normalized_data:{},raw_data:{}}
    const score=generalScoreForSnapshot(snapshot)
    const explanation=explainBasePositionScore(snapshot,score)
    expect(score?.scoreKey).toBe('ST')
    expect(explanation?.scoreKey).toBe(score?.scoreKey)
    expect(explanation?.attributes[0].priority).toBeGreaterThan(0)
  })
})
