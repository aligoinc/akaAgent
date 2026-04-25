import type { IBrowserController } from '../controllers/IBrowserController.js'

/**
 * PageRuntime — execute user JS code trong webview/page context của Channel.
 *
 * Wraps user code thành self-invoking async function với __input + __ctx
 * (fetch, log) injected. Dispatch qua IBrowserController.executeAction
 * ('evalScript', { code, args }).
 *
 * App layer (WebviewController/PlaywrightController) thực thi qua
 * webContents.executeJavaScript() hoặc page.evaluate().
 */

export interface PageRuntimeOptions {
  permissions?: {
    domains?: string[]    // whitelist fetch URLs (Phase 5b: enforce)
    timeoutMs?: number
  }
  abortSignal?: AbortSignal
}

export interface PageExecuteResult {
  success: boolean
  output?: unknown
  error?: string
  durationMs: number
  consoleLogs?: Array<{ level: string; message: string }>
}

export class PageRuntime {
  constructor(private controller: IBrowserController) {}

  async execute(
    code: string,
    input: Record<string, unknown>,
    opts: PageRuntimeOptions = {}
  ): Promise<PageExecuteResult> {
    const startedAt = Date.now()
    const wrapped = this.wrapCode(code)
    void opts

    try {
      const result = await this.controller.executeAction('evalScript', {
        code: wrapped,
        args: { input }
      })
      if (!result.success) {
        return {
          success: false,
          error: result.error ?? 'PageRuntime: evalScript failed',
          durationMs: Date.now() - startedAt
        }
      }
      // Output từ controller: { result: <value> } — depends on controller impl
      const out = result.output as Record<string, unknown> | undefined
      return {
        success: true,
        output: out?.result ?? out?.output ?? out,
        durationMs: Date.now() - startedAt
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt
      }
    }
  }

  /**
   * Wrap user code. User code phải có `async function main(input, ctx) { ... }`.
   * Result được assign vào `__result` field that controller reads back.
   */
  private wrapCode(userCode: string): string {
    return `
      (async () => {
        const __args = arguments[0] || { input: {} };
        const __input = __args.input || {};
        const __ctx = {
          fetch: typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
          log: (level, msg) => {
            try { console[level === 'error' ? 'error' : 'log']('[block]', msg) } catch {}
          },
          input: __input
        };
        try {
          ${userCode}
          if (typeof main !== 'function') {
            return { __error: 'user code must define async function main(input, ctx)' };
          }
          const result = await main(__input, __ctx);
          return { result };
        } catch (e) {
          return { __error: e && e.message ? e.message : String(e) };
        }
      })();
    `
  }
}
