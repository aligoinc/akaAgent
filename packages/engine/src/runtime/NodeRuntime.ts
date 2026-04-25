import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'

const moduleRequire = createRequire(import.meta.url)

/**
 * NodeRuntime — execute user JS code trong sandbox.
 *
 * Phase 5 (initial): dùng `node:vm` built-in — KHÔNG cần native module.
 *   ✓ No build tools required (Windows / Mac / Linux all work out-of-box)
 *   ✓ Fast spawn (~ms)
 *   ⚠️ KHÔNG phải sandbox thật — code có thể escape via global manipulation
 *      hoặc prototype pollution. Chỉ dùng cho TRUSTED code (user/AI tự viết
 *      và xem trước trong Block Editor).
 *
 * Phase 5b (production): swap sang `isolated-vm` khi đã có MSVC build tools
 *   trên dev machine + prebuilt binary cho Electron version. isolated-vm
 *   cho memory cap + V8 isolate thật.
 *
 * Allowed modules: axios, lodash, dayjs, uuid, crypto-js. Resolved at
 *   runtime — nếu không install, throw at execute.
 */

export const ALLOWED_MODULES = ['axios', 'lodash', 'dayjs', 'uuid', 'crypto-js', 'jsonata'] as const

export interface NodeRuntimeOptions {
  permissions?: {
    modules?: readonly string[]
    timeoutMs?: number
    memoryMb?: number      // ignored với node:vm; isolated-vm sẽ honor
  }
  abortSignal?: AbortSignal
}

export interface NodeExecuteResult {
  success: boolean
  output?: unknown
  error?: string
  durationMs: number
}

export class NodeRuntime {
  /**
   * Execute user code. Code phải khai báo `async function main(input, ctx)` hoặc
   * top-level expression returning a value.
   */
  async execute(
    code: string,
    input: Record<string, unknown>,
    secrets: Record<string, string>,
    opts: NodeRuntimeOptions = {}
  ): Promise<NodeExecuteResult> {
    const startedAt = Date.now()
    const timeoutMs = opts.permissions?.timeoutMs ?? 30000
    const allowedMods = opts.permissions?.modules ?? []

    // Build sandbox context
    const sandbox: Record<string, unknown> = {
      __input: input,
      __secrets: secrets,
      console: {
        log: (..._args: unknown[]) => {/* swallowed; user use ctx.log */},
        error: (..._args: unknown[]) => {/* swallowed */}
      },
      // Inject allowed modules — use createRequire (works in ESM)
      require: (name: string) => {
        if (!allowedMods.includes(name) && !ALLOWED_MODULES.includes(name as typeof ALLOWED_MODULES[number])) {
          throw new Error(`Module '${name}' not in allowlist. Allowed: ${[...ALLOWED_MODULES].join(', ')}`)
        }
        return moduleRequire(name)
      },
      Buffer,
      // Useful globals
      JSON, Math, Date, Array, Object, Number, String, Boolean, RegExp,
      Map, Set, Promise, Error, URL, URLSearchParams,
      setTimeout, clearTimeout, setInterval, clearInterval,
      fetch
    }

    // Wrap code: assume code defines `main(input, ctx)`. Call it.
    const wrapped = `
      (async () => {
        ${code}
        if (typeof main !== 'function') throw new Error('user code must define async function main(input, ctx)')
        const __ctx = { secrets: __secrets }
        return await main(__input, __ctx)
      })()
    `

    try {
      const promise = runInNewContext(wrapped, sandbox, {
        timeout: timeoutMs,
        displayErrors: true
      }) as Promise<unknown>

      // Race against abortSignal
      const result = await this.raceAbort(promise, opts.abortSignal)
      // Cross-realm objects from vm có prototype khác — clone qua JSON để
      // host realm comparison works (assert.deepStrictEqual, JSON serialize).
      const cloned = result === undefined ? undefined : JSON.parse(JSON.stringify(result))
      return { success: true, output: cloned, durationMs: Date.now() - startedAt }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt
      }
    }
  }

  private async raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return p
    if (signal.aborted) throw new Error('NodeRuntime: aborted before execute')
    return await new Promise<T>((resolve, reject) => {
      let done = false
      const onAbort = () => {
        if (!done) { done = true; reject(new Error('NodeRuntime: aborted')) }
      }
      signal.addEventListener('abort', onAbort)
      p.then(v => { if (!done) { done = true; resolve(v) } })
       .catch(e => { if (!done) { done = true; reject(e) } })
       .finally(() => signal.removeEventListener('abort', onAbort))
    })
  }
}
