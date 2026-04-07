import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { ActionResult, ActionType } from '../../shared/types'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, unlinkSync } from 'fs'

export class PlaywrightController {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private launching: boolean = false

  private cleanProfileLocks(profileDir: string): void {
    // Remove stale lock files from previous crashed sessions
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    for (const lockFile of lockFiles) {
      const lockPath = join(profileDir, lockFile)
      try {
        if (existsSync(lockPath)) unlinkSync(lockPath)
      } catch {
        // Ignore errors - file may be in use
      }
    }
  }

  async launch(headless: boolean = false, profileName: string = 'default'): Promise<void> {
    if (this.launching) return
    this.launching = true

    try {
      // Close existing context if any
      if (this.context) {
        try { await this.context.close() } catch {}
        this.context = null
        this.page = null
      }

      // Create persistent profile directory
      const profileDir = join(app.getPath('userData'), 'browser-profiles', profileName)
      mkdirSync(profileDir, { recursive: true })
      this.cleanProfileLocks(profileDir)

      // Use persistent context to save cookies, localStorage, sessions
      this.context = await chromium.launchPersistentContext(profileDir, {
        headless,
        args: ['--start-maximized', '--no-sandbox'],
        viewport: null
      })

      // Listen for context close (e.g. user closes all browser windows)
      this.context.on('close', () => {
        this.context = null
        this.page = null
      })

      this.page = this.context.pages()[0] || await this.context.newPage()
    } finally {
      this.launching = false
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      try { await this.context.close() } catch {}
      this.browser = null
      this.context = null
      this.page = null
    }
  }

  isConnected(): boolean {
    if (!this.context || !this.page) return false
    try {
      return !this.page.isClosed()
    } catch {
      return false
    }
  }

  getPage(): Page {
    if (!this.page) throw new Error('No page available. Launch browser first.')
    return this.page
  }

  async executeAction(
    actionType: ActionType,
    input: Record<string, unknown>
  ): Promise<ActionResult> {
    const startTime = Date.now()
    const page = this.getPage()

    try {
      let output: Record<string, unknown> = {}

      switch (actionType) {
        // =========== NAVIGATION ===========
        case 'navigate': {
          await page.goto(input.url as string, { waitUntil: 'domcontentloaded' })
          output = { currentUrl: page.url() }
          break
        }
        case 'goBack': {
          await page.goBack()
          output = { currentUrl: page.url() }
          break
        }
        case 'goForward': {
          await page.goForward()
          output = { currentUrl: page.url() }
          break
        }
        case 'reload': {
          await page.reload()
          output = { currentUrl: page.url() }
          break
        }

        // =========== INTERACTION ===========
        case 'click': {
          const selector = input.selector as string
          const button = (input.button as 'left' | 'right' | 'middle') || 'left'
          const clickCount = (input.clickCount as number) || 1
          await page.click(selector, { button, clickCount })
          output = { success: true }
          break
        }
        case 'type': {
          const selector = input.selector as string
          const text = String(input.text ?? '')
          const delay = (input.delay as number) || 50
          if (input.clearFirst) {
            await page.fill(selector, '')
          }
          await page.type(selector, text, { delay })
          output = { success: true }
          break
        }
        case 'scroll': {
          const selector = input.selector as string | undefined
          const direction = input.direction as string
          const amount = (input.amount as number) || 500
          const scrollMap: Record<string, [number, number]> = {
            down: [0, amount],
            up: [0, -amount],
            right: [amount, 0],
            left: [-amount, 0]
          }
          const [deltaX, deltaY] = scrollMap[direction] || [0, amount]
          if (selector) {
            await page.locator(selector).evaluate(
              (el, { dx, dy }) => el.scrollBy(dx, dy),
              { dx: deltaX, dy: deltaY }
            )
          } else {
            await page.mouse.wheel(deltaX, deltaY)
          }
          const scrollPos = await page.evaluate(() => ({
            scrollX: window.scrollX,
            scrollY: window.scrollY
          }))
          output = scrollPos
          break
        }
        case 'hover': {
          await page.hover(input.selector as string)
          output = { success: true }
          break
        }
        case 'select': {
          const values = await page.selectOption(input.selector as string, input.value as string)
          output = { selectedValue: values[0] || '' }
          break
        }
        case 'pressKey': {
          await page.keyboard.press(input.key as string)
          output = { success: true }
          break
        }

        // =========== DATA ===========
        case 'getValue': {
          const value = await page.inputValue(input.selector as string)
          output = { value }
          break
        }
        case 'setValue': {
          await page.fill(input.selector as string, String(input.value ?? ''))
          output = { success: true }
          break
        }
        case 'getText': {
          const text = await page.textContent(input.selector as string)
          output = { text: text || '' }
          break
        }
        case 'getAttribute': {
          const value = await page.getAttribute(
            input.selector as string,
            input.attribute as string
          )
          output = { value: value || '' }
          break
        }
        case 'screenshot': {
          const screenshotOptions: Record<string, unknown> = {}
          if (input.fullPage) screenshotOptions.fullPage = true
          let buffer: Buffer
          if (input.selector) {
            buffer = await page.locator(input.selector as string).screenshot()
          } else {
            buffer = await page.screenshot(screenshotOptions)
          }
          output = { imageBase64: buffer.toString('base64') }
          break
        }

        // =========== UTILITY ===========
        case 'sleep': {
          await new Promise(resolve => setTimeout(resolve, input.ms as number))
          output = {}
          break
        }
        case 'waitForSelector': {
          try {
            await page.waitForSelector(input.selector as string, {
              timeout: (input.timeout as number) || 30000,
              state: (input.state as 'visible' | 'hidden' | 'attached' | 'detached') || 'visible'
            })
            output = { found: true }
          } catch {
            output = { found: false }
          }
          break
        }
        case 'waitForNavigation': {
          await page.waitForLoadState('domcontentloaded', {
            timeout: (input.timeout as number) || 30000
          })
          output = { url: page.url() }
          break
        }

        // =========== API CALL ===========
        case 'apiCall': {
          const url = input.url as string
          const method = (input.method as string) || 'GET'
          let headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (input.headers) {
            const h = typeof input.headers === 'string' ? JSON.parse(input.headers) : input.headers
            headers = { ...headers, ...h }
          }
          const fetchOptions: RequestInit = { method, headers }
          if (['POST', 'PUT', 'PATCH'].includes(method) && input.body) {
            fetchOptions.body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body)
          }
          const timeout = (input.timeout as number) || 30000
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeout)
          fetchOptions.signal = controller.signal

          try {
            const response = await fetch(url, fetchOptions)
            clearTimeout(timer)
            let data: unknown
            const contentType = response.headers.get('content-type') || ''
            if (contentType.includes('application/json')) {
              data = await response.json()
            } else {
              data = await response.text()
            }
            const respHeaders: Record<string, string> = {}
            response.headers.forEach((v, k) => { respHeaders[k] = v })
            output = { status: response.status, data, headers: respHeaders }
          } catch (fetchErr: any) {
            clearTimeout(timer)
            throw new Error(`API call failed: ${fetchErr.message}`)
          }
          break
        }

        // =========== FILE UPLOAD ===========
        case 'uploadFile': {
          const selector = input.selector as string
          let filePaths: string[]
          const rawPaths = input.filePaths
          if (typeof rawPaths === 'string') {
            try { filePaths = JSON.parse(rawPaths) } catch { filePaths = [rawPaths] }
          } else if (Array.isArray(rawPaths)) {
            filePaths = rawPaths as string[]
          } else {
            filePaths = []
          }
          if (!Array.isArray(filePaths) || filePaths.length === 0) {
            throw new Error('filePaths must be a non-empty array of file paths')
          }
          await page.setInputFiles(selector, filePaths)
          output = { success: true, fileCount: filePaths.length }
          break
        }

        default:
          throw new Error(`Unknown action type: ${actionType}`)
      }

      return {
        success: true,
        output,
        durationMs: Date.now() - startTime
      }
    } catch (error) {
      return {
        success: false,
        output: {},
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      }
    }
  }
}
