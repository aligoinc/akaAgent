import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { CAMPAIGN_FORM_AI_TIMEOUT } from '../../shared/campaignFormAi'

const failed = () => new Error('Không thể đọc ảnh trên máy. Vui lòng thử lại.')

/** Own the native worker before initialization so every startup stage is cancellable.
 * This small adapter follows the pinned tesseract.js 7 worker protocol (createWorker.js).
 * Its public createWorker promise can remain pending after loadLanguage/initialize errors.
 */
export async function runAgentOcrWorker(worker: Worker, image: Buffer, langPath: string, parent: AbortSignal): Promise<string> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(CAMPAIGN_FORM_AI_TIMEOUT)])
  const workerId = randomUUID()
  let failure: Error | undefined
  let pending: { id: string; action: string; resolve: (data: unknown) => void; reject: (error: Error) => void } | undefined
  const fail = (error: Error) => { failure = error; pending?.reject(error); pending = undefined }
  const abort = () => fail(new Error('cancelled'))
  const error = () => fail(failed())
  const exit = () => fail(failed())
  const message = (packet: { workerId?: string; jobId?: string; action?: string; status?: string; data?: unknown }) => {
    if (!pending || packet.workerId !== workerId || packet.jobId !== pending.id || packet.action !== pending.action) return
    if (packet.status === 'reject') { fail(failed()); return }
    if (packet.status === 'resolve') { const owned = pending; pending = undefined; owned.resolve(packet.data) }
  }
  // Native diagnostics may contain file paths/image details. Consume without logging.
  worker.stdout?.resume(); worker.stderr?.resume()
  worker.on('message', message); worker.on('error', error); worker.on('exit', exit)
  signal.addEventListener('abort', abort, { once: true })
  const run = (action: string, payload: object): Promise<unknown> => {
    signal.throwIfAborted()
    if (failure) throw failure
    return new Promise((resolve, reject) => {
      const jobId = randomUUID()
      pending = { id: jobId, action, resolve, reject }
      try { worker.postMessage({ workerId, jobId, action, payload }) } catch { fail(failed()) }
    })
  }
  try {
    await run('load', { options: { lstmOnly: true, logging: false } })
    await run('loadLanguage', { langs: 'vie+eng', options: { langPath, cacheMethod: 'none', gzip: true, lstmOnly: true } })
    await run('initialize', { langs: 'vie+eng', oem: 1, config: {} })
    await run('setParameters', { params: { preserve_interword_spaces: '1' } })
    const data = await run('recognize', { image, options: {}, output: { text: true } })
    signal.throwIfAborted()
    if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string') throw failed()
    return data.text
  } finally {
    signal.removeEventListener('abort', abort)
    // Await the native termination promise, not Tesseract's fire-and-forget wrapper.
    await worker.terminate()
    worker.off('message', message); worker.off('error', error); worker.off('exit', exit)
  }
}

export function recognizeAgentOcr(image: Buffer, langPath: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const worker = new Worker(require.resolve('tesseract.js/src/worker-script/node/index.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), {
    stdout: true, stderr: true
  })
  return runAgentOcrWorker(worker, image, langPath, signal)
}
