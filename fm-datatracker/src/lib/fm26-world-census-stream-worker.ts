import { prepareWorldCensusSaveBytes } from './fm26-world-census-reader'
import { streamWorldCensusMembers } from './fm26-world-census-stream'
import { type WorldCensusProtocolSendMeta, type WorldCensusStreamMessage } from './world-census-protocol'

type StartRequest = {
  type: 'start'
  request_id: string
  bytes: ArrayBuffer
  file_name: string
  message_budget_bytes?: number
}
type AckRequest = { type: 'ack'; request_id: string; seq: number; message_hash: string }
type CancelRequest = { type: 'cancel'; request_id: string; reason?: string }
type WorkerRequest = StartRequest | AckRequest | CancelRequest

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: unknown) => void
}

type PendingAck = {
  seq: number
  hash: string
  sentAt: number
  resolve: () => void
  reject: (error: Error) => void
}

type ActiveRun = {
  requestId: string
  cancelled: boolean
  cancelReason: string
  pendingAck: PendingAck | null
  transport: {
    messages: number
    protocol_bytes: number
    max_message_bytes: number
    max_unacked: number
    max_synchronous_post_message_ms: number
    ack_wait_ms_total: number
    ack_wait_ms_max: number
  }
}

class WorldCensusCancelledError extends Error {
  constructor(message = 'world_census_stream_cancelled') { super(message); this.name = 'WorldCensusCancelledError' }
}

const scope = globalThis as unknown as WorkerScope
let active: ActiveRun | null = null
let runChain: Promise<void> = Promise.resolve()
const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now()

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return typeof error === 'string' ? error : 'erro desconhecido'
}

function cancelActive(reason: string): void {
  if (!active) return
  active.cancelled = true
  active.cancelReason = reason
  active.pendingAck?.reject(new WorldCensusCancelledError(reason))
  active.pendingAck = null
}

function checkCancelled(run: ActiveRun): void {
  if (run.cancelled) throw new WorldCensusCancelledError(run.cancelReason)
}

async function sendProtocol(run: ActiveRun, message: WorldCensusStreamMessage, meta: WorldCensusProtocolSendMeta): Promise<void> {
  checkCancelled(run)
  if (run.pendingAck) throw new Error('world_census_stream_multiple_unacked_messages')
  const messageHash = meta.message_hash
  const bytes = meta.serialized_bytes
  let resolveAck!: () => void
  let rejectAck!: (error: Error) => void
  const ack = new Promise<void>((resolve, reject) => { resolveAck = resolve; rejectAck = reject })
  run.pendingAck = { seq: message.seq, hash: messageHash, sentAt: now(), resolve: resolveAck, reject: rejectAck }
  run.transport.messages += 1
  run.transport.protocol_bytes += bytes
  run.transport.max_message_bytes = Math.max(run.transport.max_message_bytes, bytes)
  run.transport.max_unacked = Math.max(run.transport.max_unacked, 1)
  const postStarted = now()
  scope.postMessage({ type: 'protocol', request_id: run.requestId, message })
  run.transport.max_synchronous_post_message_ms = Math.max(run.transport.max_synchronous_post_message_ms, now() - postStarted)
  await ack
  checkCancelled(run)
}

function handleAck(request: AckRequest): void {
  const run = active
  if (!run || request.request_id !== run.requestId) return
  const pending = run.pendingAck
  if (!pending) return
  if (request.seq !== pending.seq) {
    pending.reject(new Error(`world_census_stream_ack_sequence_mismatch:${pending.seq}->${request.seq}`))
    run.pendingAck = null
    return
  }
  if (request.message_hash !== pending.hash) {
    pending.reject(new Error('world_census_stream_ack_hash_mismatch'))
    run.pendingAck = null
    return
  }
  const waited = now() - pending.sentAt
  run.transport.ack_wait_ms_total += waited
  run.transport.ack_wait_ms_max = Math.max(run.transport.ack_wait_ms_max, waited)
  run.pendingAck = null
  pending.resolve()
}

async function execute(request: StartRequest): Promise<void> {
  const run: ActiveRun = {
    requestId: request.request_id,
    cancelled: false,
    cancelReason: 'cancelled',
    pendingAck: null,
    transport: {
      messages: 0, protocol_bytes: 0, max_message_bytes: 0, max_unacked: 0,
      max_synchronous_post_message_ms: 0, ack_wait_ms_total: 0, ack_wait_ms_max: 0,
    },
  }
  active = run
  const startedAt = now()
  try {
    scope.postMessage({ type: 'status', request_id: run.requestId, status: 'World Census WC-B: preparando o save…', progress: 5 })
    const prepared = await prepareWorldCensusSaveBytes(
      new Uint8Array(request.bytes),
      request.file_name,
      (status, progress) => scope.postMessage({ type: 'status', request_id: run.requestId, status, progress }),
    )
    checkCancelled(run)
    scope.postMessage({ type: 'status', request_id: run.requestId, status: 'World Census WC-B: streaming incremental com backpressure…', progress: 30 })
    await streamWorldCensusMembers({
      gameDb: prepared.gameDb,
      playerStats: prepared.playerStats,
      checkpoint: prepared.checkpoint,
      sourceArtifact: prepared.sourceArtifact,
    }, {
      runId: `world-census:${run.requestId}`,
      messageBudgetBytes: request.message_budget_bytes,
      send: (message, meta) => sendProtocol(run, message, meta),
    })
    checkCancelled(run)
    scope.postMessage({
      type: 'done', request_id: run.requestId,
      transport: { ...run.transport, wall_ms: now() - startedAt },
    })
  } catch (error) {
    if (error instanceof WorldCensusCancelledError || run.cancelled) {
      scope.postMessage({ type: 'cancelled', request_id: run.requestId, reason: run.cancelReason })
    } else {
      scope.postMessage({ type: 'error', request_id: run.requestId, message: describeError(error) })
    }
  } finally {
    if (active === run) active = null
  }
}

scope.onmessage = event => {
  const request = event.data
  if (!request || typeof request !== 'object') return
  if (request.type === 'ack') { handleAck(request); return }
  if (request.type === 'cancel') {
    if (active?.requestId === request.request_id) cancelActive(request.reason ?? 'cancelled')
    return
  }
  if (request.type === 'start') {
    if (active) cancelActive('restarted_by_new_request')
    runChain = runChain.catch(() => {}).then(() => execute(request))
  }
}
