import { webContents, WebContents } from 'electron'
import { ActionResult, ActionType } from '../../shared/types'

/**
 * Helper to build safe JS code: all dynamic values are serialized via JSON.stringify
 * before being embedded in the script string.
 */
function safeJS(selector: string): string {
  return JSON.stringify(selector)
}

/**
 * Shared JS function to resolve both CSS selectors and XPath expressions.
 */
const SELECTOR_RESOLVER_JS = `
function resolveSelector(selector) {
  if (!selector) return null;
  if (selector.startsWith('/') || selector.startsWith('(')) {
    var result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
  }
  return document.querySelector(selector);
}
`

/**
 * WebviewController executes browser actions on an Electron webview's webContents.
 * Replaces PlaywrightController for campaign execution so campaigns run
 * on the same embedded browser tabs (same cookies, sessions, etc.)
 */
export class WebviewController {
  private wc: WebContents

  constructor(webContentsInstance: WebContents) {
    this.wc = webContentsInstance
  }

  isConnected(): boolean {
    try {
      return !this.wc.isDestroyed()
    } catch {
      return false
    }
  }

  getURL(): string {
    return this.isConnected() ? this.wc.getURL() : ''
  }

  /**
   * Safely execute JavaScript in the webview context.
   * Wraps in try-catch and returns result or throws with details.
   */
  private async exec(code: string): Promise<any> {
    const wrappedCode = `
      (function() {
        try {
          ${SELECTOR_RESOLVER_JS}
          ${code}
        } catch(e) {
          return { __error: true, message: e.message || String(e) };
        }
      })()
    `
    try {
      const result = await this.wc.executeJavaScript(wrappedCode, true)
      if (result && typeof result === 'object' && result.__error) {
        console.log('[WebviewController] exec error:', result.message)
        throw new Error(result.message)
      }
      return result
    } catch (err: any) {
      console.log('[WebviewController] executeJavaScript threw:', err.message)
      throw err
    }
  }

  async executeAction(
    actionType: ActionType,
    input: Record<string, unknown>
  ): Promise<ActionResult> {
    const startTime = Date.now()

    try {
      let output: Record<string, unknown> = {}

      switch (actionType) {
        // =========== NAVIGATION ===========
        case 'navigate': {
          await this.wc.loadURL(input.url as string)
          output = { currentUrl: this.wc.getURL() }
          break
        }
        case 'goBack': {
          this.wc.goBack()
          await this.waitForNavigation()
          output = { currentUrl: this.wc.getURL() }
          break
        }
        case 'goForward': {
          this.wc.goForward()
          await this.waitForNavigation()
          output = { currentUrl: this.wc.getURL() }
          break
        }
        case 'reload': {
          this.wc.reload()
          await this.waitForNavigation()
          output = { currentUrl: this.wc.getURL() }
          break
        }

        // =========== INTERACTION ===========
        case 'click': {
          const selector = input.selector as string
          const clickCount = (input.clickCount as number) || 1
          await this.waitForElement(selector, 15000) // Auto-wait like Playwright
          await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
            el.scrollIntoView({ block: "center", inline: "center" });
            
            // Execute the click asynchronously so if it triggers immediate navigation, 
            // the executeJavaScript IPC call can still return 'true' before the context is destroyed.
            setTimeout(function() {
              for (var i = 0; i < ${Number(clickCount)}; i++) {
                el.click();
              }
            }, 50);
            return true;
          `)
          output = { success: true }
          break
        }
        case 'type': {
          const selector = input.selector as string
          const text = String(input.text ?? '')
          const clearFirst = !!input.clearFirst
          await this.waitForElement(selector, 15000)
          await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
            el.focus();
            if (el.isContentEditable) {
              ${clearFirst ? `
              // Select all content and delete it first
              var range = document.createRange();
              range.selectNodeContents(el);
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('delete', false);
              ` : `
              // Move cursor to end
              var range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              `}
              // Use execCommand to properly trigger React/Draft.js/Lexical editor state updates
              document.execCommand('insertText', false, ${safeJS(text)});
            } else {
              ${clearFirst ? 'el.value = "";' : ''}
              el.value = ${clearFirst ? '' : '(el.value || "") + '}${safeJS(text)};
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            return true;
          `)
          output = { success: true }
          break
        }
        case 'scroll': {
          const selector = input.selector as string | undefined
          const direction = input.direction as string
          const amount = (input.amount as number) || 500
          if (selector) await this.waitForElement(selector, 10000)
          const scrollResult = await this.exec(`
            var scrollAmounts = {
              "down": [0, ${Number(amount)}],
              "up": [0, ${-Number(amount)}],
              "right": [${Number(amount)}, 0],
              "left": [${-Number(amount)}, 0]
            };
            var pair = scrollAmounts[${safeJS(direction)}] || [0, ${Number(amount)}];
            var dx = pair[0], dy = pair[1];
            ${selector ? `
            var el = resolveSelector(${safeJS(selector)});
            if (el) el.scrollBy(dx, dy);
            ` : `
            window.scrollBy(dx, dy);
            `}
            return { scrollX: window.scrollX, scrollY: window.scrollY };
          `)
          output = scrollResult || { scrollX: 0, scrollY: 0 }
          break
        }
        case 'hover': {
          const selector = input.selector as string
          await this.waitForElement(selector, 10000)
          await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
            el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
            return true;
          `)
          output = { success: true }
          break
        }
        case 'select': {
          const selector = input.selector as string
          const value = input.value as string
          await this.waitForElement(selector, 15000)
          const selectedValue = await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
            el.value = ${safeJS(value)};
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return el.value;
          `)
          output = { selectedValue: selectedValue || '' }
          break
        }
        case 'pressKey': {
          // pressKey typically doesn't need to wait for a specific element (defaults to body/activeElement),
          // but if we were pressing on a selector, we would wait. The current implementation uses activeElement.
          const key = input.key as string
          await this.exec(`
            var keyMap = {
              "Enter": { key: "Enter", code: "Enter", keyCode: 13 },
              "Tab": { key: "Tab", code: "Tab", keyCode: 9 },
              "Escape": { key: "Escape", code: "Escape", keyCode: 27 },
              "Backspace": { key: "Backspace", code: "Backspace", keyCode: 8 },
              "Delete": { key: "Delete", code: "Delete", keyCode: 46 },
              "ArrowUp": { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
              "ArrowDown": { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
              "ArrowLeft": { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
              "ArrowRight": { key: "ArrowRight", code: "ArrowRight", keyCode: 39 }
            };
            var keyInfo = keyMap[${safeJS(key)}] || { key: ${safeJS(key)}, code: ${safeJS(key)}, keyCode: 0 };
            
            // Execute asynchronously like click() to avoid aborting JS context if a navigation happens
            setTimeout(function() {
              var target = document.activeElement || document.body;
              target.dispatchEvent(new KeyboardEvent("keydown", Object.assign({}, keyInfo, { bubbles: true })));
              target.dispatchEvent(new KeyboardEvent("keypress", Object.assign({}, keyInfo, { bubbles: true })));
              target.dispatchEvent(new KeyboardEvent("keyup", Object.assign({}, keyInfo, { bubbles: true })));
            }, 50);
            return true;
          `)
          output = { success: true }
          break
        }

        // =========== DATA ===========
        case 'getValue': {
          await this.waitForElement(input.selector as string, 10000)
          const value = await this.exec(`
            var el = resolveSelector(${safeJS(input.selector as string)});
            return el ? (el.value || "") : "";
          `)
          output = { value }
          break
        }
        case 'setValue': {
          await this.waitForElement(input.selector as string, 10000)
          await this.exec(`
            var el = resolveSelector(${safeJS(input.selector as string)});
            if (!el) throw new Error("Element not found");
            var text = ${safeJS(String(input.value ?? ''))};
            el.focus();
            if (el.isContentEditable) {
              // Clear existing content
              var range = document.createRange();
              range.selectNodeContents(el);
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('delete', false);
              // Insert new text using execCommand to trigger React/Draft.js editor state
              document.execCommand('insertText', false, text);
            } else {
              el.value = text;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            return true;
          `)
          output = { success: true }
          break
        }
        case 'getText': {
          await this.waitForElement(input.selector as string, 10000)
          const text = await this.exec(`
            var el = resolveSelector(${safeJS(input.selector as string)});
            return el ? (el.textContent || "") : "";
          `)
          output = { text: text || '' }
          break
        }
        case 'getAttribute': {
          await this.waitForElement(input.selector as string, 10000)
          const value = await this.exec(`
            var el = resolveSelector(${safeJS(input.selector as string)});
            return el ? (el.getAttribute(${safeJS(input.attribute as string)}) || "") : "";
          `)
          output = { value: value || '' }
          break
        }
        case 'screenshot': {
          const image = await this.wc.capturePage()
          const buffer = image.toPNG()
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
          const timeout = (input.timeout as number) || 30000
          const selector = input.selector as string
          try {
            const found = await this.waitForElement(selector, timeout)
            output = { found }
          } catch {
            output = { found: false }
          }
          break
        }
        case 'waitForNavigation': {
          const timeout = (input.timeout as number) || 30000
          await this.waitForNavigation(timeout)
          output = { url: this.wc.getURL() }
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

  /**
   * Wait for an element to appear in the DOM.
   */
  private async waitForElement(selector: string, timeout: number): Promise<boolean> {
    const startTime = Date.now()
    console.log(`[WebviewController] waitForElement: "${selector.substring(0, 80)}..." timeout=${timeout}ms, URL=${this.getURL()}`)
    let attempts = 0
    while (Date.now() - startTime < timeout) {
      try {
        const found = await this.exec(`
          var el = resolveSelector(${safeJS(selector)});
          return el ? { found: true, tag: el.tagName, text: (el.textContent || '').substring(0, 50) } : { found: false };
        `)
        attempts++
        if (found && found.found) {
          console.log(`[WebviewController] Element FOUND after ${attempts} attempts (${Date.now() - startTime}ms): tag=${found.tag} text="${found.text}"`)
          return true
        }
      } catch (err: any) {
        console.log(`[WebviewController] waitForElement poll error: ${err.message}`)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    console.log(`[WebviewController] Element NOT FOUND after ${attempts} attempts (${timeout}ms). URL was: ${this.getURL()}`)
    return false
  }

  /**
   * Wait for navigation to complete (page stops loading).
   */
  private waitForNavigation(timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.wc.removeListener('did-finish-load', onLoad)
        this.wc.removeListener('did-fail-load', onFail)
        reject(new Error('Navigation timeout'))
      }, timeout)

      const onLoad = (): void => {
        clearTimeout(timer)
        this.wc.removeListener('did-fail-load', onFail)
        resolve()
      }

      const onFail = (): void => {
        clearTimeout(timer)
        this.wc.removeListener('did-finish-load', onLoad)
        resolve() // Resolve anyway, page may have loaded partially
      }

      this.wc.once('did-finish-load', onLoad)
      this.wc.once('did-fail-load', onFail)

      // If page is already not loading, resolve immediately
      if (!this.wc.isLoading()) {
        clearTimeout(timer)
        this.wc.removeListener('did-finish-load', onLoad)
        this.wc.removeListener('did-fail-load', onFail)
        resolve()
      }
    })
  }
}

/**
 * Registry to map accountId → webContentsId.
 * Used by CampaignScheduler to find the correct webview for each account.
 */
export class WebviewRegistry {
  private registry: Map<number, number> = new Map() // accountId → webContentsId

  register(accountId: number, webContentsId: number): void {
    this.registry.set(accountId, webContentsId)
  }

  unregister(accountId: number): void {
    this.registry.delete(accountId)
  }

  isRegistered(accountId: number): boolean {
    const wcId = this.registry.get(accountId)
    if (wcId === undefined) return false
    // Verify the webContents still exists
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(accountId)
      return false
    }
    return true
  }

  getController(accountId: number): WebviewController | null {
    const wcId = this.registry.get(accountId)
    if (wcId === undefined) return null
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(accountId)
      return null
    }
    return new WebviewController(wc)
  }

  listRegistered(): { accountId: number; connected: boolean }[] {
    const result: { accountId: number; connected: boolean }[] = []
    for (const [accountId] of this.registry) {
      result.push({
        accountId,
        connected: this.isRegistered(accountId)
      })
    }
    return result
  }
}
