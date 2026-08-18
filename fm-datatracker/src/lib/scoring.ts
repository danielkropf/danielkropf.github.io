export type WeightedAttribute = { key: string; value: number | null; weight: number }
export const normalizeAttribute = (value: number) => ((value - 1) / 19) * 100
export const effectiveWeight=(displayWeight:number)=>({1:0,2:1,3:2,4:4,5:6}[displayWeight]??0)
export function attributeScore(attributes: WeightedAttribute[]): number | null {
  const usable = attributes.filter((a): a is WeightedAttribute & { value: number } => a.value !== null && effectiveWeight(a.weight) > 0)
  const weights = usable.reduce((sum, a) => sum + effectiveWeight(a.weight), 0)
  if (!weights) return null
  return usable.reduce((sum, a) => sum + normalizeAttribute(a.value) * effectiveWeight(a.weight), 0) / weights
}
export const fmScaleScore=(score:number)=>1+(score/100)*19
export function combinedPhaseScore(ip:number|null,oop:number|null):number|null{
  const values=[ip,oop].filter((value):value is number=>value!==null).map(fmScaleScore)
  if(!values.length)return null
  if(values.length===1)return values[0]
  return Math.sqrt(values[0]*values[1])
}
export const performanceConfidence = (minutes: number, targetMinutes = 1800) => Math.min(1, Math.sqrt(Math.max(0, minutes) / targetMinutes))
export function currentScore(attribute: number, performance: number | null, minutes: number, maxPerformanceWeight = 0.35) {
  if (performance === null) return { score: attribute, confidence: 0, performanceWeight: 0, attributeWeight: 1 }
  const confidence = performanceConfidence(minutes)
  const performanceWeight = maxPerformanceWeight * confidence
  const attributeWeight = 1 - performanceWeight
  return { score: attribute * attributeWeight + performance * performanceWeight, confidence, performanceWeight, attributeWeight }
}
