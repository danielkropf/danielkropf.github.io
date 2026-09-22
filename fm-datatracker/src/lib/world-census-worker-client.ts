import {
  WorldCensusStreamConsumer,
  type WorldCensusStreamBatch,
  type WorldCensusStreamMessage,
  type WorldCensusStreamPreview,
} from './world-census-protocol'

export type WorldCensusWorkerTransportDiagnostics = {
  messages: number
  protocol_bytes: number
  max_message_bytes: number
  max_unacked: number
  max_synchronous_post_message_ms: number
  ack_wait_ms_total: number
  ack_wait_ms_max: number
  wall_ms: number
}

export type WorldCensusWorkerResult = {
  preview: WorldCensusStreamPreview
  transport: WorldCensusWorkerTransportDiagnostics
}

export type WorldCensusWorkerRunOptions = {
  messageBudgetBytes?: number
  signal?: AbortSignal
  onStatus?: (status: string, progress?: number) => void
  onBatch?: (message: WorldCensusStreamBatch) => void | Promise<void>
  workerFactory?: () => Worker
  requestId?: string
}

export type WorldCensusWorkerRun = {
  request_id: string
  promise: Promise<WorldCensusWorkerResult>
  cancel: (reason?: string) => void
}

type WorkerResponse =
  | { type: 'status'; request_id: string; status: string; progress?: number }
  | { type: 'protocol'; request_id: string; message: WorldCensusStreamMessage }
  | { type: 'done'; request_id: string; transport: WorldCensusWorkerTransportDiagnostics }
  | { type: 'cancelled'; request_id: string; reason?: string }
  | { type: 'error'; request_id: string; message: string }

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./fm26-world-census-stream-worker.ts', import.meta.url), { type: 'module', name: 'fm26-world-census-stream' })
}

function cancellationError(reason: string): Error {
  const error = new Error(reason)
  error.name = 'AbortError'
  return error
}

export function startWorldCensusWorkerRun(
  bytes: ArrayBuffer,
  fileName: string,
  options: WorldCensusWorkerRunOptions = {},
): WorldCensusWorkerRun {
  const requestId = options.requestId ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `wc-${Date.now()}-${Math.random()}`)
  const worker = (options.workerFactory ?? defaultWorkerFactory)()
  const consumer = new WorldCensusStreamConsumer(options.onBatch)
  let settled = false
  let cancelReason = 'World Census cancelado.'
  let resolvePromise!: (result: WorldCensusWorkerResult) => void
  let rejectPromise!: (error: Error) => void
  const promise = new Promise<WorldCensusWorkerResult>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject })

  const finishError = (error: Error) => {
    if (settled) return
    settled = true
    options.signal?.removeEventListener('abort', abortListener)
    worker.terminate()
    rejectPromise(error)
  }
  const cancel = (reason = 'World Census cancelado.') => {
    if (settled) return
    cancelReason = reason
    worker.postMessage({ type: 'cancel', request_id: requestId, reason })
  }
  const abortListener = () => cancel(options.signal?.reason ? String(options.signal.reason) : 'World Census cancelado pelo AbortSignal.')
  options.signal?.addEventListener('abort', abortListener, { once: true })

  worker.onmessage = event => {
    const response = event.data as WorkerResponse
    if (!response || response.request_id !== requestId || settled) return
    if (response.type === 'status') {
      options.onStatus?.(response.status, response.progress)
      return
    }
    if (response.type === 'protocol') {
      void consumer.apply(response.message).then(result => {
        if (settled) return
        worker.postMessage({ type: 'ack', request_id: requestId, seq: result.seq, message_hash: result.message_hash })
      }).catch(error => {
        worker.postMessage({ type: 'cancel', request_id: requestId, reason: 'protocol_validation_failed' })
        finishError(error instanceof Error ? error : new Error(String(error)))
      })
      return
    }
    if (response.type === 'cancelled') {
      finishError(cancellationError(response.reason ?? cancelReason))
      return
    }
    if (response.type === 'error') {
      finishError(new Error(response.message))
      return
    }
    if (!consumer.isComplete || !consumer.result) {
      finishError(new Error('world_census_protocol_run_end_missing_or_unvalidated'))
      return
    }
    settled = true
    options.signal?.removeEventListener('abort', abortListener)
    worker.terminate()
    resolvePromise({ preview: consumer.result, transport: response.transport })
  }

  worker.onerror = event => {
    event.preventDefault()
    finishError(event.error instanceof Error ? event.error : new Error(event.message || 'Falha no worker World Census.'))
  }
  worker.onmessageerror = () => finishError(new Error('Falha ao transferir mensagem do World Census Worker.'))

  if (options.signal?.aborted) {
    finishError(cancellationError(options.signal.reason ? String(options.signal.reason) : 'World Census cancelado.'))
  } else {
    worker.postMessage({
      type: 'start', request_id: requestId, bytes, file_name: fileName,
      message_budget_bytes: options.messageBudgetBytes,
    }, [bytes])
  }

  return { request_id: requestId, promise, cancel }
}
