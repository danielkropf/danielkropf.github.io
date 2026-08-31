export {}

type FmWorkerRequest = { id: string; bytes: ArrayBuffer; fileName: string }
type WorkerScope = {
  onmessage: ((event: MessageEvent<FmWorkerRequest>) => void) | null
  postMessage: (message: unknown) => void
}

const scope = globalThis as unknown as WorkerScope

function describeWorkerError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` — causa: ${error.cause.message}` : ''
    return `${error.name}: ${error.message}${cause}`
  }
  if (typeof error === 'string' && error.trim()) return error
  try { return JSON.stringify(error) || 'erro desconhecido' } catch { return 'erro desconhecido' }
}

scope.onmessage = event => {
  void (async () => {
    let id = 'unknown'
    let stage = 'validando a requisição do worker'
    try {
      const request = event.data
      if (!request || typeof request.id !== 'string' || !(request.bytes instanceof ArrayBuffer) || typeof request.fileName !== 'string') {
        throw new Error('Requisição inválida recebida pelo worker .fm.')
      }
      id = request.id
      const { bytes, fileName } = request

      stage = 'carregando os módulos do leitor .fm'
      scope.postMessage({ id, type: 'status', status: 'Worker .fm iniciado; carregando módulos do leitor…' })
      const { readFmSaveBytes } = await import('./fm26-offline-normalizer')

      stage = 'abrindo o arquivo .fm'
      scope.postMessage({ id, type: 'status', status: 'Módulos do leitor carregados; abrindo o save…' })
      const result = await readFmSaveBytes(
        new Uint8Array(bytes),
        fileName,
        status => {
          stage = status
          scope.postMessage({ id, type: 'status', status })
        },
      )

      stage = 'enviando o resultado normalizado para a interface'
      scope.postMessage({
        id,
        type: 'result',
        result: {
          players: result.players,
          tactics: result.tactics,
          diagnostics: result.diagnostics,
          snapshot_date: result.snapshot_date,
          snapshot_date_precision: result.snapshot_date_precision,
        },
      })
    } catch (error) {
      scope.postMessage({ id, type: 'error', message: `${stage}: ${describeWorkerError(error)}` })
    }
  })()
}
