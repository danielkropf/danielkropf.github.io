export type TacticalCandidate = { slotId: string; position: string; familiar: boolean; score: number | null }
/** Rank only known scores for familiar slots of the selected tactic. Stable ties follow tactic order. */
export function bestEligibleTacticPosition<T extends TacticalCandidate>(candidates: T[]): T | null {
  return candidates.reduce<T | null>((best, candidate) => !candidate.familiar || candidate.score === null || !Number.isFinite(candidate.score) ? best : best === null || candidate.score > best.score! ? candidate : best, null)
}
export function unassignedSquadPlayerIds(players: Array<{ id: string; squadId: string | null; observed: boolean; loanedOut?: boolean }>, groupId: string, sets: Record<string, string[]>): string[] {
  const assigned = new Set(Object.values(sets).flat())
  return players.filter(player => player.observed && !player.loanedOut && player.squadId === groupId && !assigned.has(player.id)).map(player => player.id)
}
export type UnassignedDrawerState = { search: string; position: string; selected: string[]; anchor: string | null; target: string; scrollTop: number; expanded?: Record<string, 0 | 1 | 2> }
