/** Bound reads/cleanup, or claims whose DB protocol rejects requests after confirmed cancellation. */
export async function withRequestDeadline<T>(
  parent: AbortSignal,
  request: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = 18_000
): Promise<T> {
  const deadline = new AbortController()
  const signal = AbortSignal.any([parent, deadline.signal])
  const timer = setTimeout(() => deadline.abort(new Error('Yêu cầu quá thời gian chờ. Vui lòng thử lại.')), timeoutMs)
  let onAbort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      // Consume late completion/rejection even if a transport ignores cancellation.
      void Promise.resolve().then(() => { signal.throwIfAborted(); return request(signal) }).then(resolve, reject)
    })
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
