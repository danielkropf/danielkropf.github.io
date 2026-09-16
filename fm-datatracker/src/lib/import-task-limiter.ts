/** FIFO leases; release in finally so failed jobs cannot stall the queue. */
export class ImportTaskLimiter {
  private active = 0
  private waiting: Array<() => void> = []
  constructor(private readonly limit: number) { if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency') }
  async acquire(): Promise<() => void> {
    await new Promise<void>(resolve => {
      const enter = () => { this.active++; resolve() }
      if (this.active < this.limit) enter(); else this.waiting.push(enter)
    })
    let released = false
    return () => { if (released) return; released = true; this.active--; this.waiting.shift()?.() }
  }
  async run<T>(work: () => Promise<T>): Promise<T> { const release = await this.acquire(); try { return await work() } finally { release() } }
}
export const importReadSlots = new ImportTaskLimiter(2)
export const importWriteSlots = new ImportTaskLimiter(1)
