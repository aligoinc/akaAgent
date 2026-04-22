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
  
  function isVisible(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  // Handle Playwright/XPath indices implicitly by returning the matching visible element if none provided?
  // Wait, if selector explicitly has [n], document.evaluate already processes [n] natively.
  // BUT native [n] doesn't know about visibility.
  // Instead of breaking standard XPath [n], we'll just evaluate standard XPath.
  // However, we can first check if we could resolve it and if it's visible.
  
  if (selector.startsWith('/') || selector.startsWith('(')) {
    // If standard XPath is used, let's try to get all nodes and find the first visible one if it doesn't have an index?
    // Actually, if it has [n], evaluate might just return that exact node, and we can't do much if it's invisible.
    // Let's implement a custom selector mechanism for visible nodes:
    // We will evaluate as ORDERED_NODE_SNAPSHOT_TYPE, filter by visibility, and if it's a single target query, take the first visible.
    
    // Check if the query ends with an index pattern like [1] or [2]
    var match = selector.match(/^(.*)\\[(\\d+)\\]$/);
    if (match) {
        var baseSelector = match[1];
        var index = parseInt(match[2], 10) - 1; // 0-based for JS
        
        var result = document.evaluate(baseSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        var visibleEls = [];
        for (var i = 0; i < result.snapshotLength; i++) {
           var n = result.snapshotItem(i);
           if (isVisible(n)) visibleEls.push(n);
        }
        return visibleEls[index] || null;
    }

    var result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
  }

  // CSS Selectors
  var els = document.querySelectorAll(selector);
  for (var i = 0; i < els.length; i++) {
    if (isVisible(els[i])) return els[i];
  }
  return null;
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
          await this.waitForElement(selector, 15000)
          await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
            el.scrollIntoView({ block: "center", inline: "center" });
            
            // Dispatch full pointer + mouse event chain to trigger React/FB event handlers
            setTimeout(function() {
              var rect = el.getBoundingClientRect();
              var cx = rect.left + rect.width / 2;
              var cy = rect.top + rect.height / 2;
              var evtInit = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };

              for (var i = 0; i < ${Number(clickCount)}; i++) {
                el.dispatchEvent(new PointerEvent("pointerdown", Object.assign({}, evtInit, { pointerId: 1, pointerType: "mouse" })));
                el.dispatchEvent(new MouseEvent("mousedown", evtInit));
                el.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, evtInit, { pointerId: 1, pointerType: "mouse" })));
                el.dispatchEvent(new MouseEvent("mouseup", evtInit));
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
          
          // Step 1: Click and focus the element to trigger Lexical mount
          await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
            el.scrollIntoView({ block: "center", inline: "center" });
            el.focus();
            if (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
              el.click();
            }
          `)

          // Step 2: Wait for Lexical to mount contenteditable
          await new Promise(r => setTimeout(r, 500))

          // Step 3: Find the actual editable, focus it, and use execCommand
          // execCommand('insertText') triggers beforeinput events that Lexical uses
          // to update its state — works without OS focus or webview visibility
          await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            // Find the actual editable target
            var target = null;
            if (el && el.isContentEditable) {
              target = el;
            } else if (el) {
              target = el.querySelector('[contenteditable="true"]');
              if (!target && el.closest) {
                var parent = el.closest('[role="complementary"], [data-testid], form, [class*="comment"]');
                if (parent) target = parent.querySelector('[contenteditable="true"]');
              }
              if (!target && el.parentElement) target = el.parentElement.querySelector('[contenteditable="true"]');
              if (!target && el.parentElement && el.parentElement.parentElement) {
                target = el.parentElement.parentElement.querySelector('[contenteditable="true"]');
              }
            }
            if (!target && document.activeElement && document.activeElement.isContentEditable) {
              target = document.activeElement;
            }
            if (!target) {
              var all = document.querySelectorAll('[contenteditable="true"]');
              if (all.length > 0) target = all[all.length - 1];
            }
            
            if (target && target.isContentEditable) {
              target.focus();
              
              if (${clearFirst}) {
                var range = document.createRange();
                range.selectNodeContents(target);
                var sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false);
              } else {
                var range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(false);
                var sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
              }
              
              // Use execCommand which triggers beforeinput -> Lexical updates state
              var lines = String(${safeJS(text)}).split('\\n');
              for (var i = 0; i < lines.length; i++) {
                if (i > 0) {
                  document.execCommand('insertParagraph', false, null);
                }
                if (lines[i].length > 0) {
                  document.execCommand('insertText', false, lines[i]);
                }
              }
              return true;
            } else if (target) {
              // Regular input/textarea
              ${clearFirst ? 'target.value = "";' : ''}
              target.value = ${clearFirst ? '' : '(target.value || "") + '}${safeJS(text)};
              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            } else {
              throw new Error("Cannot find editable element for typing");
            }
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
          // Primary mechanism: FocusEvent('focusin'). This is what Facebook's
          // href-resolver listens for (confirmed by user's Selenium setup).
          // We also call focus() and dispatch pointer/mouse events so the
          // action still serves generic hover use-cases (tooltips, etc).
          await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
            el.scrollIntoView({ block: "center", inline: "center" });

            var init = { bubbles: true, cancelable: true, view: window };

            // Primary: focusin — triggers FB's lazy href loader.
            el.dispatchEvent(new FocusEvent("focusin", init));
            try { if (typeof el.focus === "function") el.focus(); } catch (e) {}

            // Secondary: pointer + mouse events for generic hover handlers.
            var pInit = Object.assign({}, init, { pointerId: 1, pointerType: "mouse", isPrimary: true });
            try { el.dispatchEvent(new PointerEvent("pointerover", pInit)); } catch (e) {}
            try { el.dispatchEvent(new PointerEvent("pointerenter", pInit)); } catch (e) {}
            try { el.dispatchEvent(new PointerEvent("pointermove", pInit)); } catch (e) {}

            el.dispatchEvent(new MouseEvent("mouseover", init));
            el.dispatchEvent(new MouseEvent("mouseenter", init));
            el.dispatchEvent(new MouseEvent("mousemove", init));
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
          const key = input.key as string || 'Enter'
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
              // Attempt to dispatch a paste event so rich text editors (like Lexical on FB)
              // can cleanly handle newlines and generate proper paragraph blocks.
              var textToInsert = String(text);
              var dt = new DataTransfer();
              dt.setData('text/plain', textToInsert);
              var pasteEvent = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true
              });
              var handled = !el.dispatchEvent(pasteEvent);
              
              if (!handled) {
                // Fallback for basic contenteditables that do not intercept paste
                var lines = textToInsert.split('\\n');
                for (var i = 0; i < lines.length; i++) {
                  if (i > 0) {
                    document.execCommand('insertParagraph', false, null) || document.execCommand('insertLineBreak', false, null);
                  }
                  if (lines[i].length > 0) {
                    document.execCommand('insertText', false, lines[i]);
                  }
                }
              }
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
          // Ưu tiên innerText (giữ ngắt dòng đúng theo layout, bỏ qua text ẩn).
          // Fallback về textContent nếu element không phải HTMLElement.
          const text = await this.exec(`
            var el = resolveSelector(${safeJS(input.selector as string)});
            if (!el) return "";
            var t = (typeof el.innerText === 'string' && el.innerText.length > 0) ? el.innerText : (el.textContent || "");
            return t;
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

        // =========== FILE DOWNLOAD ===========
        // Tải 1 URL về file trên đĩa. Dùng Node `fetch` (undici, chạy main
        // process) — bypass hoàn toàn Chromium network stack nên không dính
        // ERR_BLOCKED_BY_CLIENT / tracking protection / webRequest filter.
        // Lấy cookie từ session của webview và gắn thủ công vào header.
        case 'downloadUrl': {
          const url = input.url as string
          if (!url || typeof url !== 'string') {
            throw new Error('downloadUrl: thiếu tham số "url"')
          }
          const timeout = (input.timeout as number) || 30000
          const requestedPath = input.outputPath as string | undefined

          // Lấy cookie áp dụng cho URL này từ session của tab webview
          let cookieHeader = ''
          try {
            const cookies = await this.wc.session.cookies.get({ url })
            cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
          } catch (cookieErr) {
            console.warn('[WebviewController] get cookies failed:', cookieErr)
          }

          const currentPageUrl = (() => {
            try { return this.wc.getURL() || 'https://www.facebook.com/' }
            catch { return 'https://www.facebook.com/' }
          })()

          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Referer': currentPageUrl,
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8'
          }
          if (cookieHeader) headers['Cookie'] = cookieHeader

          let response: Response
          try {
            response = await fetch(url, {
              method: 'GET',
              headers,
              redirect: 'follow',
              signal: AbortSignal.timeout(timeout)
            })
          } catch (fetchErr: any) {
            throw new Error(`downloadUrl failed: ${fetchErr.message || fetchErr}`)
          }

          if (!response.ok) {
            throw new Error(`downloadUrl: HTTP ${response.status} ${response.statusText}`)
          }

          const contentType = response.headers.get('content-type') || 'application/octet-stream'
          const arrayBuf = await response.arrayBuffer()
          const buf = Buffer.from(arrayBuf)

          const { writeFileSync, mkdirSync, existsSync: fsExists } = await import('fs')
          const { join: pathJoin, dirname: pathDirname, extname: pathExtname } = await import('path')
          const { tmpdir } = await import('os')

          const extFromUrl = pathExtname(new URL(url).pathname).replace('.', '').toLowerCase()
          const extFromType = contentType.split(';')[0].split('/').pop() || ''
          const ext = extFromUrl || extFromType || 'bin'

          let filePath: string
          if (requestedPath) {
            filePath = requestedPath
            const dir = pathDirname(filePath)
            if (!fsExists(dir)) mkdirSync(dir, { recursive: true })
          } else {
            filePath = pathJoin(tmpdir(), `fb-dl-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`)
          }
          writeFileSync(filePath, buf)

          output = {
            filePath,
            byteLength: buf.length,
            contentType
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
            // No-op khi rỗng (cho phép node tồn tại trong workflow mà không fail).
            output = { success: true, fileCount: 0, skipped: true }
            break
          }

          // Handle base64 data URIs → write to temp files
          const { writeFileSync, existsSync: fsExists } = await import('fs')
          const { join: pathJoin } = await import('path')
          const { tmpdir } = await import('os')
          const resolvedPaths: string[] = []
          for (let i = 0; i < filePaths.length; i++) {
            const fp = filePaths[i]
            if (fp.startsWith('data:')) {
              // data:image/png;base64,iVBOR...
              const match = fp.match(/^data:([^;]+);base64,(.+)$/)
              if (!match) throw new Error(`Invalid data URI at index ${i}`)
              const ext = match[1].split('/')[1] || 'png'
              const buf = Buffer.from(match[2], 'base64')
              const tmpPath = pathJoin(tmpdir(), `upload_${Date.now()}_${i}.${ext}`)
              writeFileSync(tmpPath, buf)
              resolvedPaths.push(tmpPath)
            } else {
              // Normalize path for Windows
              const normalizedPath = fp.replace(/\//g, '\\')
              if (!fsExists(normalizedPath) && !fsExists(fp)) {
                console.warn(`[WebviewController] uploadFile: File not found: ${fp}`)
              }
              resolvedPaths.push(fp)
            }
          }

          // Use CDP to set files on the input element
          // First, find the DOM node via JS
          await this.waitForElement(selector, 15000)
          const backendNodeId = await this.exec(`
            var el = resolveSelector(${safeJS(selector)});
            if (!el) throw new Error("File input element not found: " + ${safeJS(selector)});
            // Make sure it's a file input or create one if needed
            if (el.tagName !== 'INPUT' || el.type !== 'file') {
              // Try to find a file input inside or nearby
              var fileInput = el.querySelector('input[type="file"]');
              if (!fileInput) {
                // Look for a hidden file input in the parent
                var parent = el.closest('form') || el.parentElement || document.body;
                fileInput = parent.querySelector('input[type="file"]');
              }
              if (fileInput) el = fileInput;
            }
            // Return a unique attribute to find this node via CDP
            var uniqueId = '__upload_target_' + Date.now();
            el.setAttribute('data-upload-id', uniqueId);
            return uniqueId;
          `)

          try {
            // Attach debugger if not already attached
            this.wc.debugger.attach('1.3')
          } catch {
            // Already attached, ignore
          }

          try {
            // Get the document root
            const { root } = await this.wc.debugger.sendCommand('DOM.getDocument', {})
            
            // Find the element by attribute
            const { nodeId } = await this.wc.debugger.sendCommand('DOM.querySelector', {
              nodeId: root.nodeId,
              selector: `[data-upload-id="${backendNodeId}"]`
            })

            if (!nodeId) {
              throw new Error('Could not find file input element via CDP')
            }

            // Set files on the input
            await this.wc.debugger.sendCommand('DOM.setFileInputFiles', {
              nodeId,
              files: resolvedPaths
            })

            // Dispatch change event
            await this.exec(`
              var el = document.querySelector('[data-upload-id="${backendNodeId}"]');
              if (el) {
                el.removeAttribute('data-upload-id');
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
            `)

            output = { success: true, fileCount: resolvedPaths.length }
          } finally {
            try { this.wc.debugger.detach() } catch {}
          }
          break
        }

        // =========== DRAG-AND-DROP FILE UPLOAD (JS_DROP_FILE) ===========
        case 'dropFile': {
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
          // No-op khi filePaths rỗng — cho phép node dropFile tồn tại trong workflow
          // mà không fail khi campaign không có ảnh.
          if (!Array.isArray(filePaths) || filePaths.length === 0) {
            output = { success: true, fileCount: 0, skipped: true }
            break
          }

          // Resolve base64 data URIs → write to temp files
          const { writeFileSync: writeSync, existsSync: fsCheck } = await import('fs')
          const { join: joinPath } = await import('path')
          const { tmpdir: getTmp } = await import('os')
          const resolvedFiles: string[] = []
          for (let i = 0; i < filePaths.length; i++) {
            const fp = filePaths[i]
            if (fp.startsWith('data:')) {
              const match = fp.match(/^data:([^;]+);base64,(.+)$/)
              if (!match) throw new Error(`Invalid data URI at index ${i}`)
              const ext = match[1].split('/')[1] || 'png'
              const buf = Buffer.from(match[2], 'base64')
              const tmpPath = joinPath(getTmp(), `drop_${Date.now()}_${i}.${ext}`)
              writeSync(tmpPath, buf)
              resolvedFiles.push(tmpPath)
            } else {
              const normalizedPath = fp.replace(/\//g, '\\')
              if (!fsCheck(normalizedPath) && !fsCheck(fp)) {
                console.warn(`[WebviewController] dropFile: File not found: ${fp}`)
              }
              resolvedFiles.push(fp)
            }
          }

          await this.waitForElement(selector, 15000)

          // For each file, use JS_DROP_FILE technique:
          // 1. Inject a temporary <input type="file"> via JS
          // 2. Use CDP to set files on it
          // 3. The JS onchange handler fires synthetic drag-and-drop events onto the target element
          let uploadedCount = 0
          for (const filePath of resolvedFiles) {
            try {
              // Step 1: Inject the drop file script, which creates a temporary <input type="file">
              // and sets up the onchange handler to fire DragEvents onto the target element.
              // The script returns the temporary input element reference.
              const uniqueId = `__drop_input_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
              await this.exec(`
                var b = resolveSelector(${safeJS(selector)});
                if (!b) throw new Error("Drop target element not found: " + ${safeJS(selector)});
                var c = b.ownerDocument;
                // Scroll target into view
                var m = 0;
                while (true) {
                  var e = b.getBoundingClientRect();
                  var g = e.left + (e.width / 2);
                  var h = e.top + (e.height / 2);
                  var f = c.elementFromPoint(g, h);
                  if (f && b.contains(f)) break;
                  if (1 < ++m) { b.scrollIntoView({behavior:'instant',block:'center',inline:'center'}); break; }
                  b.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
                }
                var a = c.createElement('INPUT');
                a.setAttribute('type', 'file');
                a.setAttribute('multiple', 'true');
                a.setAttribute('data-drop-id', ${safeJS(uniqueId)});
                a.setAttribute('style', 'position:fixed;z-index:2147483647;left:0;top:0;opacity:0;');
                a.onchange = function() {
                  var e2 = b.getBoundingClientRect();
                  var g2 = e2.left + (e2.width / 2);
                  var h2 = e2.top + (e2.height / 2);
                  var f2 = c.elementFromPoint(g2, h2) || b;
                  var dt = {
                    effectAllowed: 'all',
                    dropEffect: 'none',
                    types: ['Files'],
                    files: this.files,
                    setData: function(){},
                    getData: function(){},
                    clearData: function(){},
                    setDragImage: function(){}
                  };
                  if (window.DataTransferItemList) {
                    var items = [];
                    for (var i = 0; i < this.files.length; i++) {
                      items.push(Object.setPrototypeOf({
                        kind: 'file',
                        type: this.files[i].type,
                        file: this.files[i],
                        getAsFile: function(){ return this.file; },
                        getAsString: function(cb) {
                          var reader = new FileReader();
                          reader.onload = function(ev){ cb(ev.target.result); };
                          reader.readAsText(this.file);
                        }
                      }, DataTransferItem.prototype));
                    }
                    dt.items = Object.setPrototypeOf(items, DataTransferItemList.prototype);
                  }
                  Object.setPrototypeOf(dt, DataTransfer.prototype);
                  ['dragenter', 'dragover', 'drop'].forEach(function(evtName) {
                    var d = c.createEvent('DragEvent');
                    d.initMouseEvent(evtName, true, true, c.defaultView, 0, 0, 0, g2, h2, false, false, false, false, 0, null);
                    Object.setPrototypeOf(d, null);
                    d.dataTransfer = dt;
                    Object.setPrototypeOf(d, DragEvent.prototype);
                    f2.dispatchEvent(d);
                  });
                  a.parentElement.removeChild(a);
                };
                c.documentElement.appendChild(a);
                a.getBoundingClientRect();
                return ${safeJS(uniqueId)};
              `)

              // Step 2: Use CDP to set the file on the temporary input
              try { this.wc.debugger.attach('1.3') } catch { /* already attached */ }

              try {
                const { root } = await this.wc.debugger.sendCommand('DOM.getDocument', {})
                const { nodeId } = await this.wc.debugger.sendCommand('DOM.querySelector', {
                  nodeId: root.nodeId,
                  selector: `[data-drop-id="${uniqueId}"]`
                })

                if (!nodeId) {
                  throw new Error('Could not find temporary drop input via CDP')
                }

                // Set the file — this triggers onchange which fires the DragEvents
                await this.wc.debugger.sendCommand('DOM.setFileInputFiles', {
                  nodeId,
                  files: [filePath]
                })

                uploadedCount++
                // Wait for React/framework to process the drop
                await new Promise(r => setTimeout(r, 2000))
              } finally {
                try { this.wc.debugger.detach() } catch {}
              }
            } catch (dropErr) {
              console.error(`[WebviewController] dropFile failed for ${filePath}:`, dropErr)
            }
          }

          output = { success: uploadedCount > 0, fileCount: uploadedCount }
          break
        }

        // =========== FACEBOOK COMPOUND ACTIONS ===========
        // Cao hơn primitive (navigate/click/getText...): mỗi action gói 1 thao
        // tác FB hoàn chỉnh. Workflow chỉ cần 1 node để dùng → tránh phải design
        // flow nhiều chục node với conditional/loop phức tạp.

        case 'fbScrapePost': {
          const sourceLink = input.sourceLink as string
          const includeImages = input.includeImages === true
          const appendContent = (input.appendContent as string) || ''
          // Parse appendImages: có thể là array hoặc JSON string của array
          let appendImages: string[] = []
          const rawAppendImgs = input.appendImages
          if (typeof rawAppendImgs === 'string' && rawAppendImgs) {
            try { appendImages = JSON.parse(rawAppendImgs) } catch { appendImages = [] }
          } else if (Array.isArray(rawAppendImgs)) {
            appendImages = rawAppendImgs as string[]
          }

          if (!sourceLink) {
            // Khi sourceLink rỗng → no-op. Trả appendContent + appendImages để
            // các node sau (type, dropFile) vẫn có data dùng.
            output = { scrapedText: appendContent, scrapedImages: appendImages }
            break
          }

          const url = /^https?:\/\//i.test(sourceLink.trim())
            ? sourceLink.trim()
            : (/^\d+$/.test(sourceLink.trim())
              ? `https://www.facebook.com/profile.php?id=${sourceLink.trim()}`
              : `https://www.facebook.com/${sourceLink.trim()}`)

          await this.executeAction('navigate', { url })
          await new Promise(r => setTimeout(r, 4000))
          await this.executeAction('waitForSelector', { selector: '[role="main"]', timeout: 10000 }).catch(() => null)
          await new Promise(r => setTimeout(r, 1500))
          await this.executeAction('scroll', { direction: 'down', amount: 2000 }).catch(() => null)
          await new Promise(r => setTimeout(r, 3000))

          // Container detection: PAGE union (3 nhánh) hoặc GROUP — thử theo URL
          const PAGE_CONTAINER = "(" +
            "//*[@role='feed']/following-sibling::*[not(@class)][1]/div[not(@class)]" +
            " | //*[@class='x1yztbdb']/following-sibling::*[not(@class)][1]/div[not(@class)]" +
            " | //*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')]" +
          ")[1]"
          const GROUP_CONTAINER = "(//*[@role='feed'][last()]/*/*/div[not(@class)][1])[1]"
          const isGroupUrl = /facebook\.com\/groups\//i.test(url)
          const probeOrder = isGroupUrl
            ? [GROUP_CONTAINER, PAGE_CONTAINER]
            : [PAGE_CONTAINER, GROUP_CONTAINER]
          let FIRST_CONTAINER: string | null = null
          for (const sel of probeOrder) {
            const probe = await this.executeAction('waitForSelector', { selector: sel, timeout: 1500 }).catch(() => null)
            if (probe && probe.success && probe.output?.found !== false) { FIRST_CONTAINER = sel; break }
          }
          if (!FIRST_CONTAINER) {
            output = { scrapedText: '', scrapedImages: [] }
            break
          }

          const SEE_MORE_BTN_XPATH =
            `${FIRST_CONTAINER}//*[@role='button' and (normalize-space(.)='Xem thêm' or normalize-space(.)='See more')]`
          const CONTENT_XPATH =
            `${FIRST_CONTAINER}//div[@dir='auto']//*[@data-ad-rendering-role='story_message' or @class='xh8yej3' or @id]`
          const IMG_XPATH = (i: number) =>
            `(${FIRST_CONTAINER}//*[@dir='auto' and ` +
            `.//*[@data-ad-comet-preview='message' or @data-ad-rendering-role='story_message' or @data-ad-preview='message' or @class='xh8yej3' or @id]]` +
            `/following-sibling::*[1]/div[1]//img)[${i}]`

          // Click "Xem thêm" tối đa 2 vòng (DOM có thể dựng lại sau expand)
          for (let iter = 0; iter < 2; iter++) {
            const probe = await this.executeAction('waitForSelector', { selector: SEE_MORE_BTN_XPATH, timeout: 1500 }).catch(() => null)
            if (!probe || !probe.success || probe.output?.found === false) break
            const clickRes = await this.executeAction('click', { selector: SEE_MORE_BTN_XPATH }).catch(() => null)
            if (!clickRes || !clickRes.success) break
            await new Promise(r => setTimeout(r, 1000))
          }

          // Lấy nội dung — comprehensive 3-method approach:
          //   1. Walk lên dir='auto' wrapper từ kết quả XPath C#
          //   2. Thử 3 cách extract text:
          //      a. innerText (CSS-based)
          //      b. innerHTML parse (replace <br>/</div>/</p>/... → \n + strip tags)
          //      c. walk DOM tree (block tag + computed style detect)
          //   3. Chọn method có nhiều \n nhất, hoặc dài nhất nếu không có \n
          // Trả về cả debug info (tag wrapper, length của từng method) để diagnose.
          let rawText = ''
          let debugInfo = ''
          try {
            const result = await this.exec(`
              var marker = resolveSelector(${safeJS(CONTENT_XPATH)});
              if (!marker) return { text: '', debug: 'marker not found' };

              // Walk up tìm dir='auto' wrapper
              var wrapper = marker;
              var depth = 0;
              while (wrapper && wrapper.parentElement && depth < 20) {
                if (wrapper.tagName === 'DIV' && wrapper.getAttribute && wrapper.getAttribute('dir') === 'auto') break;
                wrapper = wrapper.parentElement;
                depth++;
              }
              if (!wrapper || wrapper === document.body) wrapper = marker;

              var BLOCK = {DIV:1,P:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,LI:1,UL:1,OL:1,BLOCKQUOTE:1,ARTICLE:1,SECTION:1};
              var candidates = [];

              // Method A: innerText
              var aText = (typeof wrapper.innerText === 'string' ? wrapper.innerText : (wrapper.textContent || '')).trim();
              candidates.push({ name: 'innerText', text: aText });

              // Method B: innerHTML parse
              var html = wrapper.innerHTML || '';
              // FB render emoji bằng <img alt="😀" src="..."> → unwrap alt trước khi strip tag
              html = html.replace(/<img[^>]*\\balt="([^"]*)"[^>]*>/gi, '$1');
              html = html.replace(/<img[^>]*\\balt='([^']*)'[^>]*>/gi, '$1');
              html = html.replace(/<br\\s*\\/?\\s*>/gi, '\\n');
              html = html.replace(/<\\/(div|p|h[1-6]|li|blockquote)\\s*>/gi, '\\n');
              var tmp = document.createElement('div');
              tmp.innerHTML = html;
              var bText = (tmp.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
              candidates.push({ name: 'innerHTML', text: bText });

              // Method C: walk DOM tree
              var out = [];
              function walk(node) {
                if (node.nodeType === 3) { out.push(node.nodeValue || ''); return; }
                if (node.nodeType !== 1) return;
                if (node.tagName === 'BR') { out.push('\\n'); return; }
                if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
                // FB render emoji bằng <img alt="😀" ...> → lấy alt làm text
                if (node.tagName === 'IMG') {
                  var alt = (node.getAttribute && node.getAttribute('alt')) || '';
                  if (alt) out.push(alt);
                  return;
                }
                var isBlock = BLOCK[node.tagName] === 1;
                if (!isBlock) {
                  try {
                    var disp = window.getComputedStyle(node).display;
                    isBlock = (disp === 'block' || disp === 'flex' || disp === 'grid' || disp === 'list-item');
                  } catch(e) {}
                }
                if (isBlock && out.length && out[out.length-1].slice(-1) !== '\\n') out.push('\\n');
                for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
                if (isBlock && out.length && out[out.length-1].slice(-1) !== '\\n') out.push('\\n');
              }
              walk(wrapper);
              var cText = out.join('').replace(/\\n{3,}/g, '\\n\\n').trim();
              candidates.push({ name: 'walkDOM', text: cText });

              // Pick best: ưu tiên có \\n, rồi dài nhất
              var withBreaks = candidates.filter(function(c){ return c.text.indexOf('\\n') !== -1; });
              var pool = withBreaks.length > 0 ? withBreaks : candidates;
              var best = pool[0];
              for (var i = 1; i < pool.length; i++) {
                if (pool[i].text.length > best.text.length) best = pool[i];
              }

              var debug = 'wrapper=' + wrapper.tagName +
                          (wrapper.getAttribute ? ('[dir=' + (wrapper.getAttribute('dir')||'-') + ']') : '') +
                          ' | best=' + best.name +
                          ' | ' + candidates.map(function(c){
                            return c.name + ':' + c.text.length + (c.text.indexOf('\\n')!==-1?'(\\\\n)':'');
                          }).join(', ');
              return { text: best.text, debug: debug };
            `)
            if (result && typeof result === 'object') {
              rawText = ((result as any).text as string) || ''
              debugInfo = ((result as any).debug as string) || ''
              if (debugInfo) console.log('[fbScrapePost] ' + debugInfo + ' | preview:', rawText.substring(0, 200))
            }
          } catch (e) {
            console.warn('[fbScrapePost] getText failed:', e)
          }

          // Normalize newlines: \r\n / \r / U+2028 / U+2029 → \n
          // Tránh trường hợp FB nguồn dùng line separator khác làm
          // type/setValue handler không split đúng.
          if (rawText) {
            rawText = rawText
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n')
              .replace(/[\u2028\u2029]/g, '\n')
          }

          let scrapedText = rawText
          if (appendContent) {
            scrapedText = rawText ? `${rawText}\n${appendContent}` : appendContent
          }

          // Lấy ảnh
          const scrapedImages: string[] = []
          if (includeImages) {
            const collected: string[] = []
            for (let i = 1; i <= 8; i++) {
              const sel = IMG_XPATH(i)
              const probe = await this.executeAction('waitForSelector', { selector: sel, timeout: 1500 }).catch(() => null)
              if (!probe || !probe.success || probe.output?.found === false) break
              const attr = await this.executeAction('getAttribute', { selector: sel, attribute: 'src' }).catch(() => null)
              if (!attr || !attr.success) break
              const src = (attr.output?.value as string | undefined) || ''
              if (!src || !/^https?:\/\//i.test(src)) break
              if (!collected.includes(src)) collected.push(src)
            }
            for (const u of collected) {
              try {
                const dl = await this.executeAction('downloadUrl', { url: u, timeout: 20000 })
                if (dl.success && typeof dl.output?.filePath === 'string') {
                  scrapedImages.push(dl.output.filePath as string)
                }
              } catch {}
            }
          }

          // Merge: ảnh user upload (appendImages) đứng trước, ảnh scrape sau.
          // Để dropFile node sau này gọi 1 lần, có cả ảnh user lẫn ảnh nguồn.
          const finalImages = [...appendImages, ...scrapedImages]
          output = { scrapedText, scrapedImages: finalImages }
          break
        }

        case 'fbSharePost': {
          const sourceUrl = input.sourceUrl as string
          const content = (input.content as string) || ''
          if (!sourceUrl) throw new Error('fbSharePost: thiếu sourceUrl')

          const url = /^https?:\/\//i.test(sourceUrl.trim())
            ? sourceUrl.trim()
            : (/^\d+$/.test(sourceUrl.trim())
              ? `https://www.facebook.com/profile.php?id=${sourceUrl.trim()}`
              : `https://www.facebook.com/${sourceUrl.trim()}`)

          await this.executeAction('navigate', { url })
          await new Promise(r => setTimeout(r, 4000))

          // Cuộn xuống ~2000px để kích hoạt lazy-render của FB — nếu không, bài post có thể
          // chưa được mount vào DOM, khiến waitForSelector container fail oan.
          await this.executeAction('scroll', { direction: 'down', amount: 2000 }).catch(() => null)
          await new Promise(r => setTimeout(r, 1500))

          // Tìm container bài đăng trước (page/profile vs group khác selector — union cả hai)
          // để tránh khớp nhầm nút "Chia sẻ" của component khác (sidebar, reel, story...)
          const postContainerSel = [
            '//*[@role="feed"]/following-sibling::*[not(@class)][1]/div[not(@class)]',
            '//*[@class="x1yztbdb"]/following-sibling::*[not(@class)][1]/div[not(@class)]',
            '//*[@role="dialog" and not(@aria-label="Thông báo") and not(@aria-label="Messenger")]',
            '//*[@role="feed"][last()]/*/*/div[not(@class)][1]'
          ].join('|')
          const containerCheck = await this.executeAction('waitForSelector', { selector: postContainerSel, timeout: 10000 })
          if (!containerCheck.success || containerCheck.output?.found === false) {
            throw new Error('Không tìm thấy container bài đăng nguồn')
          }
          await new Promise(r => setTimeout(r, 1500))

          // Nút Chia sẻ scope trong container (append descendant axis `//...` sau mỗi nhánh container)
          // FB render nút Chia sẻ theo 2 dạng:
          //   (a) role=button có aria-label/text là "Chia sẻ" / "Share"
          //   (b) role=button chứa descendant có data-ad-rendering-role="share_button" (biến thể mới)
          const shareBtnInner = '//*[@role="button" and (@aria-label="Chia sẻ" or @aria-label="Share" or .="Chia sẻ" or .="Share" or .//*[@data-ad-rendering-role="share_button"])]'
          const shareBtnSel = postContainerSel.split('|').map(c => c + shareBtnInner).join('|')
          const shareClick = await this.executeAction('click', { selector: shareBtnSel })
          if (!shareClick.success) throw new Error('Không tìm thấy nút Chia sẻ trên bài đăng nguồn')
          await new Promise(r => setTimeout(r, 2500))

          const shareNowSel = '//*[@role="button" and contains(.,"Chia sẻ ngay")]'
          const shareNowClick = await this.executeAction('click', { selector: shareNowSel })
          if (!shareNowClick.success) throw new Error('Không tìm thấy nút "Chia sẻ ngay" trong menu chia sẻ')
          await new Promise(r => setTimeout(r, 3500))

          const composerSel = '[role="dialog"] [contenteditable="true"]'
          const composerCheck = await this.executeAction('waitForSelector', { selector: composerSel, timeout: 5000 })
          if (composerCheck.success && composerCheck.output?.found !== false) {
            if (content) {
              await this.executeAction('click', { selector: composerSel }).catch(() => null)
              await new Promise(r => setTimeout(r, 500))
              await this.executeAction('setValue', { selector: composerSel, value: content }).catch(() => null)
              await new Promise(r => setTimeout(r, 1500))
            }
            await this.executeAction('click', { selector: '[role="dialog"] [aria-label="Đăng"], [role="dialog"] [aria-label="Post"]' })
            await new Promise(r => setTimeout(r, 5000))
          } else {
            await new Promise(r => setTimeout(r, 2000))
          }
          output = { success: true }
          break
        }

        case 'fbSendMessage': {
          // No-op nếu enabled = false (cho phép node luôn có trong workflow)
          if (input.enabled === false) {
            output = { ok: true, skipped: true }
            break
          }
          const uid = input.uid as string
          const message = (input.content as string) || ''
          let images: string[] = []
          const rawImgs = input.images
          if (typeof rawImgs === 'string' && rawImgs) {
            try { images = JSON.parse(rawImgs) } catch { images = [] }
          } else if (Array.isArray(rawImgs)) {
            images = rawImgs as string[]
          }
          if (!uid) {
            output = { ok: false, error: 'fbSendMessage: thiếu uid' }
            break
          }

          try {
          // Navigate Messenger conversation
          await this.executeAction('navigate', { url: `https://www.facebook.com/messages/t/${uid}` })
          await new Promise(r => setTimeout(r, 4000))

          // Handle blocking dialog 1: "Khôi phục đoạn chat" — đóng dialog, rồi confirm "Không khôi phục"
          const pinDialogCheck = await this.executeAction('waitForSelector', {
            selector: '[aria-label="Đóng"], [aria-label="Close"]',
            timeout: 3000
          }).catch(() => null)
          if (pinDialogCheck && pinDialogCheck.success && pinDialogCheck.output?.found !== false) {
            await this.executeAction('click', {
              selector: '[aria-label="Đóng"], [aria-label="Close"]'
            }).catch(() => null)
            await new Promise(r => setTimeout(r, 2000))
            const confirmCheck = await this.executeAction('waitForSelector', {
              selector: '(//*[@role="button" and @aria-label="Không khôi phục tin nhắn" and @tabindex="0"])[position()=2]',
              timeout: 3000
            }).catch(() => null)
            if (confirmCheck && confirmCheck.success && confirmCheck.output?.found !== false) {
              await this.executeAction('click', {
                selector: '(//*[@role="button" and @aria-label="Không khôi phục tin nhắn" and @tabindex="0"])[position()=2]'
              }).catch(() => null)
              await new Promise(r => setTimeout(r, 2000))
            }
          }

          // Handle blocking dialog 2: "Tiếp tục" (E2EE notice)
          const continueCheck = await this.executeAction('waitForSelector', {
            selector: '//*[@role="button" and .="Tiếp tục"]',
            timeout: 2000
          }).catch(() => null)
          if (continueCheck && continueCheck.success && continueCheck.output?.found !== false) {
            await this.executeAction('click', {
              selector: '//*[@role="button" and .="Tiếp tục"]'
            }).catch(() => null)
            await new Promise(r => setTimeout(r, 2000))
          }

          // Wait for message input
          await this.executeAction('waitForSelector', {
            selector: '[role="textbox"][contenteditable="true"]',
            timeout: 15000
          })
          await new Promise(r => setTimeout(r, 1000))
          await this.executeAction('click', { selector: '[role="textbox"][contenteditable="true"]' })
          await new Promise(r => setTimeout(r, 500))

          // Type message
          if (message) {
            await this.executeAction('setValue', {
              selector: '[role="textbox"][contenteditable="true"]',
              value: message
            })
            await new Promise(r => setTimeout(r, 1000))
          }

          // Drop images (no-op nếu rỗng vì dropFile đã tự skip)
          if (images.length > 0) {
            const drop = await this.executeAction('dropFile', {
              selector: '[role="textbox"][contenteditable="true"]',
              filePaths: images
            })
            if (!drop.success) throw new Error('Không thể đính kèm ảnh vào tin nhắn')
            await new Promise(r => setTimeout(r, Math.max(3000, images.length * 1500)))
          }

          await this.executeAction('pressKey', { key: 'Enter' })
          await new Promise(r => setTimeout(r, 2000))
          output = { ok: true }
          } catch (sendErr: any) {
            // Catch để workflow chạy tiếp (sang fbAddFriend) — outcome trong output.ok
            output = { ok: false, error: sendErr?.message || String(sendErr) }
          }
          break
        }

        case 'fbDetectPostPending': {
          // Sau khi đăng bài group, FB hiện banner "đang chờ duyệt" nếu group bật moderation.
          // Action này chờ ngắn rồi probe text banner. Trả về { isPending: bool }.
          await new Promise(r => setTimeout(r, 3500))
          const selector = `//*[contains(text(),"đang chờ được duyệt") or contains(text(),"chờ phê duyệt") or contains(text(),"Bài viết đang chờ duyệt") or contains(text(),"pending approval") or contains(text(),"Post pending approval")]`
          try {
            const check = await this.executeAction('waitForSelector', { selector, timeout: 2500 })
            const found = check.success && check.output?.found !== false
            output = { isPending: found }
          } catch {
            output = { isPending: false }
          }
          break
        }

        case 'fbLeaveGroupIfPending': {
          // No-op nếu enabled=false hoặc isPending=false (chỉ rời khi bài chờ duyệt).
          if (input.enabled === false || input.isPending !== true) {
            output = { skipped: true, left: false }
            break
          }
          try {
            const joinedMenuSelector = `//*[@role="button" and (contains(@aria-label,"Đã tham gia") or contains(@aria-label,"Joined") or .="Đã tham gia" or .="Joined")]`
            const menuCheck = await this.executeAction('waitForSelector', { selector: joinedMenuSelector, timeout: 4000 })
            if (!menuCheck.success || menuCheck.output?.found === false) {
              output = { skipped: false, left: false, error: 'Không tìm thấy menu "Đã tham gia"' }
              break
            }
            await this.executeAction('click', { selector: joinedMenuSelector })
            await new Promise(r => setTimeout(r, 1500))

            const leaveItemSelector = `//*[@role="menuitem" and (contains(.,"Rời nhóm") or contains(.,"Rời khỏi nhóm") or contains(.,"Leave group") or contains(.,"Leave Group"))]`
            const leaveClick = await this.executeAction('click', { selector: leaveItemSelector })
            if (!leaveClick.success) {
              output = { skipped: false, left: false, error: 'Không tìm thấy mục "Rời nhóm" trong menu' }
              break
            }
            await new Promise(r => setTimeout(r, 1500))

            const confirmSelector = `//*[@role="button" and (.="Rời nhóm" or .="Rời khỏi nhóm" or .="Leave Group" or .="Leave group")]`
            await this.executeAction('click', { selector: confirmSelector })
            await new Promise(r => setTimeout(r, 2000))
            output = { skipped: false, left: true }
          } catch (err: any) {
            output = { skipped: false, left: false, error: err?.message || String(err) }
          }
          break
        }

        case 'fbJoinGroupIfNotMember': {
          // No-op nếu enabled=false hoặc isPending=true (chỉ join khi bài KHÔNG chờ duyệt = mình chưa member).
          if (input.enabled === false || input.isPending === true) {
            output = { skipped: true, joined: false }
            break
          }
          try {
            const joinSelector = `//*[@role="button" and (contains(@aria-label,"Tham gia nhóm") or contains(@aria-label,"Join group") or .="Tham gia nhóm" or .="Join group" or .="Tham gia" or .="Join")]`
            const check = await this.executeAction('waitForSelector', { selector: joinSelector, timeout: 2500 })
            if (!check.success || check.output?.found === false) {
              output = { skipped: true, joined: false }  // không có nút Join = đã là member
              break
            }
            await this.executeAction('click', { selector: joinSelector })
            await new Promise(r => setTimeout(r, 2500))
            output = { skipped: false, joined: true }
          } catch (err: any) {
            output = { skipped: false, joined: false, error: err?.message || String(err) }
          }
          break
        }

        case 'fbAddFriend': {
          if (input.enabled === false) {
            output = { ok: true, skipped: true }
            break
          }
          const uid = input.uid as string
          if (!uid) {
            output = { ok: false, error: 'fbAddFriend: thiếu uid' }
            break
          }

          try {
            const profileUrl = /^\d+$/.test(uid)
              ? `https://www.facebook.com/profile.php?id=${uid}`
              : `https://www.facebook.com/${uid}`
            await this.executeAction('navigate', { url: profileUrl })
            await new Promise(r => setTimeout(r, 3000))
            await this.executeAction('waitForSelector', { selector: '[role="main"]', timeout: 10000 })
            await new Promise(r => setTimeout(r, 1500))

            const addFriendResult = await this.executeAction('click', {
              selector: '//*[@role="button" and .="Thêm bạn bè"]'
            })
            if (!addFriendResult.success) {
              output = { ok: false, error: 'Không tìm thấy nút Kết bạn (đã là bạn hoặc đã gửi lời mời)' }
              break
            }
            await new Promise(r => setTimeout(r, 2000))
            output = { ok: true }
          } catch (frdErr: any) {
            output = { ok: false, error: frdErr?.message || String(frdErr) }
          }
          break
        }

        case 'fbPostReels': {
          const content = (input.content as string) || ''
          const videoPath = input.videoPath as string
          if (!videoPath) throw new Error('fbPostReels: thiếu videoPath (cần ít nhất 1 video trong Media)')

          await this.executeAction('navigate', { url: 'https://www.facebook.com/reels/create' })
          await new Promise(r => setTimeout(r, 5000))

          const upload = await this.executeAction('uploadFile', {
            selector: 'input[type="file"]',
            filePaths: [videoPath]
          })
          if (!upload.success) throw new Error('Không upload được video cho Reels')
          await new Promise(r => setTimeout(r, 6000))

          const nextSel = '//*[@role="button" and (.="Tiếp" or .="Next")]'
          await this.executeAction('click', { selector: nextSel }).catch(() => null)
          await new Promise(r => setTimeout(r, 3000))
          await this.executeAction('click', { selector: nextSel }).catch(() => null)
          await new Promise(r => setTimeout(r, 3000))

          if (content) {
            const descSel = '[contenteditable="true"][role="textbox"], [contenteditable="true"]'
            await this.executeAction('click', { selector: descSel }).catch(() => null)
            await new Promise(r => setTimeout(r, 500))
            await this.executeAction('setValue', { selector: descSel, value: content }).catch(() => null)
            await new Promise(r => setTimeout(r, 1500))
          }

          const publishSel = '//*[@role="button" and (.="Đăng" or .="Publish" or .="Post" or .="Chia sẻ")]'
          const pub = await this.executeAction('click', { selector: publishSel })
          if (!pub.success) throw new Error('Không tìm thấy nút Đăng Reels')
          await new Promise(r => setTimeout(r, 6000))
          output = { success: true }
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
    let lastScrollTime = 0
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

      // Auto-scroll down every 3 seconds to trigger lazy loading (e.g., Facebook feed)
      const now = Date.now()
      if (now - lastScrollTime > 3000) {
        try {
          await this.exec(`window.scrollBy(0, 600);`)
          lastScrollTime = now
        } catch {}
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
 * Registry to map channelId → webContentsId.
 * Used by CampaignScheduler to find the correct webview for each channel.
 */
export class WebviewRegistry {
  private registry: Map<number, number> = new Map() // channelId → webContentsId

  register(channelId: number, webContentsId: number): void {
    this.registry.set(channelId, webContentsId)
  }

  unregister(channelId: number): void {
    this.registry.delete(channelId)
  }

  isRegistered(channelId: number): boolean {
    const wcId = this.registry.get(channelId)
    if (wcId === undefined) return false
    // Verify the webContents still exists
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(channelId)
      return false
    }
    return true
  }

  getController(channelId: number): WebviewController | null {
    const wcId = this.registry.get(channelId)
    if (wcId === undefined) return null
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(channelId)
      return null
    }
    return new WebviewController(wc)
  }

  getWebContentsId(channelId: number): number | null {
    const wcId = this.registry.get(channelId)
    if (wcId === undefined) return null
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(channelId)
      return null
    }
    return wcId
  }

  listRegistered(): { channelId: number; connected: boolean }[] {
    const result: { channelId: number; connected: boolean }[] = []
    for (const [channelId] of this.registry) {
      result.push({
        channelId,
        connected: this.isRegistered(channelId)
      })
    }
    return result
  }
}
