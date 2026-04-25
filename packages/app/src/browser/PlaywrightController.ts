import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import type { IBrowserController, ActionResult } from '@akabiz/engine'

/**
 * PlaywrightController — implement IBrowserController dùng Playwright.
 *
 * Phase 6: support 20 browser primitives của engine. Persistent context per
 * channel (cookie/localStorage giữ giữa runs).
 *
 * Action names: bare ('navigate', 'click', ...) — engine strip 'core.' prefix.
 */

export interface PlaywrightControllerOptions {
  headless?: boolean
  profilePath?: string
  userAgent?: string
  locale?: string
  timezoneId?: string
  proxyUrl?: string
  viewport?: { width: number; height: number }
}

export class PlaywrightController implements IBrowserController {
  private browser: Browser | BrowserContext | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  constructor(private opts: PlaywrightControllerOptions = {}) {}

  isConnected(): boolean {
    return this.context !== null && this.page !== null
  }

  /** Expose internal Page for advanced use cases (element picker, raw evaluate). */
  getPage(): Page | null {
    return this.page
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return

    const launchOpts: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: this.opts.headless ?? false,
      ...(this.opts.userAgent ? { userAgent: this.opts.userAgent } : {}),
      ...(this.opts.locale ? { locale: this.opts.locale } : {}),
      ...(this.opts.timezoneId ? { timezoneId: this.opts.timezoneId } : {}),
      ...(this.opts.viewport ? { viewport: this.opts.viewport } : {}),
      ...(this.opts.proxyUrl ? { proxy: { server: this.opts.proxyUrl } } : {})
    }

    if (this.opts.profilePath) {
      this.context = await chromium.launchPersistentContext(this.opts.profilePath, launchOpts)
      // launchPersistentContext returns BrowserContext directly
    } else {
      const browser = await chromium.launch({ headless: this.opts.headless ?? false })
      this.browser = browser
      this.context = await browser.newContext(launchOpts)
    }
    const pages = this.context.pages()
    this.page = pages.length > 0 ? pages[0]! : await this.context.newPage()
  }

  async close(): Promise<void> {
    try {
      if (this.context) await this.context.close()
      if (this.browser && 'close' in this.browser) await this.browser.close()
    } catch (err) {
      console.warn('[PlaywrightController] close error:', err)
    } finally {
      this.context = null
      this.browser = null
      this.page = null
    }
  }

  async executeAction(actionType: string, input: Record<string, unknown>): Promise<ActionResult> {
    if (!this.isConnected()) await this.connect()
    const page = this.page!
    const startedAt = Date.now()

    try {
      // Pre-resolve named selector (async DB lookup) → cache, sync dispatch reads.
      if (input.selector) await this.preResolveSelector(input.selector)
      const output = await this.dispatch(actionType, input, page)
      return { success: true, output, durationMs: Date.now() - startedAt }
    } catch (err) {
      return {
        success: false,
        output: {},
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt
      }
    }
  }

  // ========== action dispatch ==========

  private async dispatch(action: string, input: Record<string, unknown>, page: Page): Promise<Record<string, unknown>> {
    switch (action) {
      // Navigation
      case 'navigate': {
        const url = String(input.url ?? '')
        const waitUntil = (input.waitUntil ?? 'load') as 'load' | 'domcontentloaded' | 'networkidle'
        await page.goto(url, { waitUntil })
        return { currentUrl: page.url() }
      }
      case 'goBack':
        await page.goBack()
        return { currentUrl: page.url() }
      case 'goForward':
        await page.goForward()
        return { currentUrl: page.url() }
      case 'reload':
        await page.reload()
        return { currentUrl: page.url() }

      // Interaction
      case 'click': {
        const sel = this.resolveSelector(input.selector)
        const button = (input.button ?? 'left') as 'left' | 'right' | 'middle'
        const clickCount = Number(input.clickCount ?? 1)
        const timeout = Number(input.timeout ?? 30000)
        await page.locator(sel).first().click({ button, clickCount, timeout })
        return { success: true }
      }
      case 'type': {
        const sel = this.resolveSelector(input.selector)
        const text = String(input.text ?? '')
        const delay = Number(input.delay ?? 50)
        const clearFirst = Boolean(input.clearFirst ?? true)
        const loc = page.locator(sel).first()
        if (clearFirst) await loc.fill('')
        await loc.type(text, { delay })
        return { success: true }
      }
      case 'scroll': {
        const direction = (input.direction ?? 'down') as 'down' | 'up' | 'left' | 'right'
        const amount = Number(input.amount ?? 500)
        const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
        const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
        if (input.selector) {
          const sel = this.resolveSelector(input.selector)
          await page.locator(sel).first().evaluate((el, d) => {
            (el as HTMLElement).scrollBy({ left: d.x, top: d.y, behavior: 'smooth' })
          }, { x: dx, y: dy })
        } else {
          await page.evaluate((d) => window.scrollBy({ left: d.x, top: d.y, behavior: 'smooth' }), { x: dx, y: dy })
        }
        const pos = await page.evaluate(() => ({ scrollX: window.scrollX, scrollY: window.scrollY }))
        return { scrollX: pos.scrollX, scrollY: pos.scrollY }
      }
      case 'hover': {
        const sel = this.resolveSelector(input.selector)
        const timeout = Number(input.timeout ?? 30000)
        await page.locator(sel).first().hover({ timeout })
        return { success: true }
      }
      case 'select': {
        const sel = this.resolveSelector(input.selector)
        const value = input.value !== undefined && input.value !== null ? String(input.value) : undefined
        const label = input.label !== undefined && input.label !== null ? String(input.label) : undefined
        if (value !== undefined) await page.locator(sel).first().selectOption({ value })
        else if (label !== undefined) await page.locator(sel).first().selectOption({ label })
        return { success: true }
      }
      case 'pressKey': {
        const key = String(input.key ?? '')
        if (input.selector) {
          await page.locator(this.resolveSelector(input.selector)).first().press(key)
        } else {
          await page.keyboard.press(key)
        }
        return { success: true }
      }

      // Data extraction
      case 'getValue': {
        const sel = this.resolveSelector(input.selector)
        const value = await page.locator(sel).first().inputValue()
        return { value }
      }
      case 'setValue': {
        const sel = this.resolveSelector(input.selector)
        await page.locator(sel).first().fill(String(input.value ?? ''))
        return { success: true }
      }
      case 'getText': {
        const sel = this.resolveSelector(input.selector)
        const text = (await page.locator(sel).first().textContent()) ?? ''
        return { text }
      }
      case 'getAttribute': {
        const sel = this.resolveSelector(input.selector)
        const attr = String(input.attribute ?? '')
        const value = (await page.locator(sel).first().getAttribute(attr)) ?? ''
        return { value }
      }
      case 'screenshot': {
        const fullPage = Boolean(input.fullPage ?? false)
        let buf: Buffer
        if (input.selector) {
          buf = await page.locator(this.resolveSelector(input.selector)).first().screenshot()
        } else {
          buf = await page.screenshot({ fullPage })
        }
        return { screenshotBase64: buf.toString('base64') }
      }

      // Waiting
      case 'waitForSelector': {
        const sel = this.resolveSelector(input.selector)
        const state = (input.state ?? 'visible') as 'visible' | 'hidden' | 'attached' | 'detached'
        const timeout = Number(input.timeout ?? 30000)
        try {
          await page.locator(sel).first().waitFor({ state, timeout })
          return { found: true }
        } catch {
          return { found: false }
        }
      }
      case 'waitForNavigation': {
        const timeout = Number(input.timeout ?? 30000)
        const waitUntil = (input.waitUntil ?? 'load') as 'load' | 'domcontentloaded' | 'networkidle'
        await page.waitForLoadState(waitUntil, { timeout })
        return { currentUrl: page.url() }
      }

      // File
      case 'uploadFile': {
        const sel = this.resolveSelector(input.selector)
        const filePath = String(input.filePath ?? '')
        await page.locator(sel).first().setInputFiles(filePath)
        return { success: true }
      }
      case 'downloadUrl': {
        const url = String(input.url ?? '')
        const res = await page.context().request.get(url)
        const buf = await res.body()
        return { savedPath: '', sizeBytes: buf.length, contentBase64: buf.toString('base64') }
      }

      // Eval (page-runtime code)
      case 'evalScript': {
        const code = String(input.code ?? '')
        const args = input.args ?? {}
        // page.evaluate accepts function only. Wrap user code as Function.
        const result = await page.evaluate((bundle) => {
          // eslint-disable-next-line no-new-func
          const fn = new Function(`return ${bundle.code}`)()
          return fn(bundle.args)
        }, { code, args })
        return { result }
      }

      default:
        throw new Error(`PlaywrightController: unsupported action '${action}'`)
    }
  }

  /** Hook for named selector resolution (set by app boot). */
  public namedSelectorResolver: ((name: string) => Promise<{ type: 'css' | 'xpath' | 'text-match'; expression: string; fallbacks?: Array<{ type: string; expression: string }> } | null>) | null = null

  private namedSelectorCache = new Map<string, string>()

  private async resolveNamedSelector(name: string): Promise<string> {
    const cached = this.namedSelectorCache.get(name)
    if (cached) return cached
    if (!this.namedSelectorResolver) {
      throw new Error(`Named selector '${name}' — resolver not configured`)
    }
    const sel = await this.namedSelectorResolver(name)
    if (!sel) throw new Error(`Named selector '${name}' not found in DB`)
    const playwrightSel = sel.type === 'xpath' ? `xpath=${sel.expression}` : sel.expression
    this.namedSelectorCache.set(name, playwrightSel)
    return playwrightSel
  }

  private resolveSelector(raw: unknown): string {
    if (raw == null) throw new Error('selector is required')
    if (typeof raw === 'string') return raw
    if (typeof raw === 'object') {
      const sel = raw as { kind?: string; type?: string; expression?: string; name?: string }
      if (sel.kind === 'inline' && sel.expression) {
        if (sel.type === 'xpath') return `xpath=${sel.expression}`
        return sel.expression
      }
      if (sel.kind === 'named' && sel.name) {
        // Sync wrapper — namedSelectorCache must be pre-populated, OR
        // dispatch is async. For now, throw if not cached. Caller should
        // pre-warm via resolveNamedSelectorAsync below.
        const cached = this.namedSelectorCache.get(sel.name)
        if (cached) return cached
        throw new Error(`Named selector '${sel.name}' not pre-resolved. Call resolveNamedSelectorAsync first or use inline.`)
      }
    }
    throw new Error(`Invalid selector: ${JSON.stringify(raw)}`)
  }

  /** Async pre-resolve named selector before sync dispatch. Used by handler. */
  async preResolveSelector(raw: unknown): Promise<void> {
    if (raw && typeof raw === 'object') {
      const sel = raw as { kind?: string; name?: string }
      if (sel.kind === 'named' && sel.name && !this.namedSelectorCache.has(sel.name)) {
        await this.resolveNamedSelector(sel.name)
      }
    }
  }
}
