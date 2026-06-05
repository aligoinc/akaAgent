import * as vm from 'vm'
import { BlockResult } from '../../../shared/v2Types'
import { PageController } from './pageController'
import { BlockHelpers, BlockRuntimeHelpers, BlockRuntimeMetadata, createBlockHelpers } from './blockHelpers'

export interface BlockExecuteContext {
  input: Record<string, unknown>
  page: PageController
  vars: Record<string, unknown>
  signal: AbortSignal
  runtimeHelpers?: BlockRuntimeHelpers
  runtimeMetadata?: BlockRuntimeMetadata
  /** Callback gọi cho mỗi `helpers.log()` — thường emit IPC realtime */
  onLog?: (line: string) => void
}

export interface BlockExecuteOptions {
  code: string
  blockName: string
  /** Hard timeout cho block (ms). Default 5 phút. */
  timeoutMs?: number
}

/**
 * BlockExecutor — chạy 1 block JS trong sandbox vm.createContext.
 *
 * Sandbox guards: KHÔNG expose `process`, `require`, `Buffer`, `electron`, `fs`.
 * Block chỉ truy cập `input`, `page`, `vars`, `helpers`, `signal` + 1 số object
 * built-in (Promise, JSON, Math, Date, RegExp, Array, Object, ...).
 *
 * Trust boundary: user tự viết block cho chính mình → không cần defend chống
 * malicious sandbox escape. Chỉ guard tai nạn (require('fs').rmSync('/')).
 *
 * Code có thể return:
 *   - object → output = object
 *   - primitive → output = { value: primitive }
 *   - undefined → output = {}
 *   - throw → success=false, error=message
 */
export class BlockExecutor {
  async execute(opts: BlockExecuteOptions, ctx: BlockExecuteContext): Promise<BlockResult> {
    const startTime = Date.now()
    const logs: string[] = []
    const helpers: BlockHelpers = createBlockHelpers(
      (line) => {
        logs.push(line)
        try {
          ctx.onLog?.(line)
        } catch {
          // Don't fail block khi onLog throw
        }
      },
      ctx.runtimeHelpers,
      ctx.runtimeMetadata
    )

    // Build sandbox global. KHÔNG expose Node-specific objects.
    const sandbox = vm.createContext({
      input: ctx.input,
      page: ctx.page,
      vars: ctx.vars,
      helpers,
      signal: ctx.signal,
      console: {
        log: (...args: unknown[]) => helpers.log(args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
        warn: (...args: unknown[]) => helpers.log('[warn] ' + args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ')),
        error: (...args: unknown[]) => helpers.log('[error] ' + args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' '))
      },
      setTimeout, clearTimeout, setInterval, clearInterval,
      Promise, JSON, Math, Date, RegExp,
      Array, Object, String, Number, Boolean,
      Map, Set, Symbol, Error, URL, URLSearchParams
    })

    // Wrap user code thành async IIFE → cho phép `await` ở top level + return.
    const wrapped = `(async () => {\n${opts.code}\n})()`

    try {
      const ret: unknown = await vm.runInContext(wrapped, sandbox, {
        timeout: opts.timeoutMs ?? 5 * 60 * 1000,
        breakOnSigint: true,
        filename: `block:${opts.blockName}`
      })
      const output = normalizeOutput(ret)
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        logs
      }
    } catch (err: any) {
      return {
        success: false,
        output: {},
        error: err?.message ? String(err.message) : String(err),
        durationMs: Date.now() - startTime,
        logs
      }
    }
  }
}

/**
 * Chuẩn hoá return value của block:
 *  - object (non-array) → giữ nguyên
 *  - primitive | array → wrap thành { value: x }
 *  - null | undefined → {}
 */
function normalizeOutput(ret: unknown): Record<string, unknown> {
  if (ret === undefined || ret === null) return {}
  if (typeof ret === 'object' && !Array.isArray(ret)) {
    return ret as Record<string, unknown>
  }
  return { value: ret }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
