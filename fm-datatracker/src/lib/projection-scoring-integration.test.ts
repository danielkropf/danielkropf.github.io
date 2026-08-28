import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { generalScoreForSnapshot } from './base-position-score'
import { projectScore } from './projection-engine'
import { projectionInputForSnapshot } from './projection-player'

const snapshot={
  snapshot_date:'2026-08-26',
  positions:['ST (C)'],
  normalized_data:{positional_ratings:{ST:18},fm_hidden:{current_ability:120,potential_ability:150}},
  raw_data:{birth_date:'2006-08-26'},
  player_attributes:ATTRIBUTE_CATALOG.map(attribute=>({attribute_key:attribute.key,value:12})),
}

describe('integração Scoring v2 + Projection v2.1',()=>{
  it('usa a BasePositionScore canônica como P0 da projeção geral',()=>{
    const canonical=generalScoreForSnapshot(snapshot)
    const input=projectionInputForSnapshot({snapshot,currentScore:3,scoreType:'general',reference:null})
    expect(input.currentScore).toBe(canonical?.score)
    expect(input.family).toBe(canonical?.family)
    expect(input.scoreKey).toBe(canonical?.scoreKey)
  })

  it('mantém projeção por função explicitamente indisponível',()=>{
    const input=projectionInputForSnapshot({snapshot,currentScore:12,scoreType:'function',scoreKey:'IP:ST(C):CF',reference:null})
    const result=projectScore(input)
    expect(result.status).toBe('unsupported_score_type')
    expect(result.modelVersion).toBe('2.0-research')
  })
})
