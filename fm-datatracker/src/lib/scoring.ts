export type WeightedAttribute = { key: string; value: number | null; weight: number }
export const normalizeAttribute = (value: number) => ((value - 1) / 19) * 100
export function attributeScore(attributes: WeightedAttribute[]): number | null {
  const usable = attributes.filter((a): a is WeightedAttribute & { value: number } => a.value !== null && a.weight > 0)
  const weights = usable.reduce((sum, a) => sum + a.weight, 0)
  if (!weights) return null
  return usable.reduce((sum, a) => sum + normalizeAttribute(a.value) * a.weight, 0) / weights
}
export const performanceConfidence = (minutes: number, targetMinutes = 1800) => Math.min(1, Math.sqrt(Math.max(0, minutes) / targetMinutes))
export function currentScore(attribute: number, performance: number | null, minutes: number, maxPerformanceWeight = 0.35) {
  if (performance === null) return { score: attribute, confidence: 0, performanceWeight: 0, attributeWeight: 1 }
  const confidence = performanceConfidence(minutes)
  const performanceWeight = maxPerformanceWeight * confidence
  const attributeWeight = 1 - performanceWeight
  return { score: attribute * attributeWeight + performance * performanceWeight, confidence, performanceWeight, attributeWeight }
}
