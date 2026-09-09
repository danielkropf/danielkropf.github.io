let userId: string | null | undefined
let generation = 0
const listeners = new Set<() => void>()
export function privateSessionGeneration() { return generation }
export function onPrivateSessionChange(listener: () => void) { listeners.add(listener) }
export function setPrivateSession(nextUserId: string | null) {
  if (userId === nextUserId) return
  userId = nextUserId; generation++
  listeners.forEach(listener => listener())
}
export function assertPrivateSession(expected: number) {
  if (generation !== expected) throw new Error('A sessão mudou; a operação anterior foi descartada.')
}
