import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { ActionResult, ActionType } from '../../shared/types'

export class PlaywrightController {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  async launch(headless: boolean = false): Promise<void> {
    // Use system-installed Chromium or download path
    this.browser = await chromium.launch({
      headless,
      args: ['--start-maximized']
    })
    this.context = await this.browser.newContext({
      viewport: null
    })
    this.page = await this.context.newPage()
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
    }
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected()
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
          const text = input.text as string
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
          await page.fill(input.selector as string, input.value as string)
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
