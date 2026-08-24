import { readFmSaveBytes } from './fm26-offline-normalizer'

type Request = { id: string; bytes: ArrayBuffer; fileName: string }
type WorkerScope = {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage: (message: unknown) => void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = event => {
  void (async () => {
    const { id, bytes, fileName } = event.data
    try {
      const result = await readFmSaveBytes(new Uint8Array(bytes), fileName, status => scope.postMessage({ id, type: 'status', status }))
      // The normalized rows include their own auditable raw player data. Do not clone the full parsed save back to the UI thread.
      scope.postMessage({ id, type: 'result', result: { players: result.players, diagnostics: result.diagnostics, snapshot_date: result.snapshot_date, snapshot_date_precision: result.snapshot_date_precision } })
    } catch (error) {
      scope.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'erro desconhecido' })
    }
  })()
}
