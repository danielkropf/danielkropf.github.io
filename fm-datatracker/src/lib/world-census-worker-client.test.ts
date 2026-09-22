// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { WorldCoverageManifest } from './fm26-world-census'
import { WorldCensusProtocolEmitter, type WorldCensusStreamMessage } from './world-census-protocol'
import { startWorldCensusWorkerRun } from './world-census-worker-client'

const coverage: WorldCoverageManifest = {
  version: 'world-coverage-manifest-v1',
  capabilities: [],
}

type MainRequest =
  | { type: 'start'; request_id: string }
  | { type: 'ack'; request_id: string; seq: number; message_hash: string }
  | { type: 'cancel'; request_id: string; reason?: string }

class BackpressureFakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  acks = 0
  outstanding = 0
  maxOutstanding = 0
  terminated = false
  private pending = new Map<number, () => void>()

  postMessage(request: MainRequest): void {
    if (request.type === 'ack') {
      this.acks += 1
      this.outstanding = Math.max(0, this.outstanding - 1)
      this.pending.get(request.seq)?.()
      this.pending.delete(request.seq)
      return
    }
    if (request.type === 'cancel') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'cancelled', request_id: request.request_id, reason: request.reason } } as MessageEvent))
      return
    }
    void this.run(request.request_id)
  }

  terminate(): void { this.terminated = true }

  private async run(requestId: string): Promise<void> {
    const emitter = new WorldCensusProtocolEmitter({
      runId: `world-census:${requestId}`,
      sourceArtifact: { sha256: 'a'.repeat(64), file_name: 'test.fm', byte_length: 2 },
      checkpoint: '2031-12-15',
      outputContractVersion: 'world-census-run-v1',
      representationVersion: 'world-census-representation-v1',
      readerVersion: 'wc-a-reader-v1',
      plannedCapabilities: [],
      send: message => this.sendProtocol(requestId, message),
    })
    await emitter.begin()
    await emitter.acceptBatch({ domain: 'person_records', batch_index: 0, serialized_bytes: 10, items: [{ eid: 1, uid: 2 }] })
    await emitter.finish({ manifest: coverage, decoderCatalog: [], diagnostics: { ok: true } })
    this.onmessage?.({ data: { type: 'done', request_id: requestId, transport: { messages: this.acks, protocol_bytes: 1, max_message_bytes: 1, max_unacked: this.maxOutstanding, max_synchronous_post_message_ms: 0, ack_wait_ms_total: 0, ack_wait_ms_max: 0, wall_ms: 1 } } } as MessageEvent)
  }

  private sendProtocol(requestId: string, message: WorldCensusStreamMessage): Promise<void> {
    this.outstanding += 1
    this.maxOutstanding = Math.max(this.maxOutstanding, this.outstanding)
    return new Promise(resolve => {
      this.pending.set(message.seq, resolve)
      queueMicrotask(() => this.onmessage?.({ data: { type: 'protocol', request_id: requestId, message } } as MessageEvent))
    })
  }
}

describe('World Census worker client', () => {
  it('ACKs only validated messages and keeps strict one-message backpressure', async () => {
    const fake = new BackpressureFakeWorker()
    const seen: string[] = []
    const run = startWorldCensusWorkerRun(new ArrayBuffer(2), 'test.fm', {
      requestId: 'r1', workerFactory: () => fake as unknown as Worker,
      onBatch: message => { seen.push(message.domain) },
    })
    const result = await run.promise
    expect(result.preview.logical_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(seen).toEqual(['person_records'])
    expect(fake.maxOutstanding).toBe(1)
    expect(fake.acks).toBeGreaterThanOrEqual(4)
    expect(fake.terminated).toBe(true)
  })

  it('cancels without producing a successful preview', async () => {
    const fake = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null,
      onmessageerror: null,
      terminate: vi.fn(),
      postMessage(request: MainRequest) {
        if (request.type === 'cancel') queueMicrotask(() => this.onmessage?.({ data: { type: 'cancelled', request_id: request.request_id, reason: request.reason } } as MessageEvent))
      },
    }
    const run = startWorldCensusWorkerRun(new ArrayBuffer(2), 'test.fm', { requestId: 'cancel', workerFactory: () => fake as unknown as Worker })
    run.cancel('cancel-test')
    await expect(run.promise).rejects.toMatchObject({ name: 'AbortError', message: 'cancel-test' })
    expect(fake.terminate).toHaveBeenCalledOnce()
  })

  it('fails closed on an invalid first sequence and cancels the worker', async () => {
    const requests: MainRequest[] = []
    const fake = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null,
      onmessageerror: null,
      terminate: vi.fn(),
      postMessage(request: MainRequest) {
        requests.push(request)
        if (request.type === 'start') queueMicrotask(() => this.onmessage?.({ data: { type: 'protocol', request_id: request.request_id, message: { type: 'run_begin', seq: 1, run_id: 'bad', protocol_version: 'world-census-stream-v1', message_budget_bytes: 196608, source_artifact: { sha256: null, file_name: 'x', byte_length: 1 }, checkpoint: null, output_contract_version: 'x', representation_version: 'x', reader_version: 'x', planned_capabilities: [] } } } as MessageEvent))
      },
    }
    const run = startWorldCensusWorkerRun(new ArrayBuffer(2), 'test.fm', { requestId: 'bad', workerFactory: () => fake as unknown as Worker })
    await expect(run.promise).rejects.toThrow(/sequence_gap/)
    expect(requests.some(request => request.type === 'cancel')).toBe(true)
  })
})
