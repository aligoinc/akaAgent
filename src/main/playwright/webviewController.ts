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
            
            // Re-resolve or retry if it's a FB Placeholder that hasn't swapped yet?
            // Actually, if we waited 2 seconds, it should be swapped.
            if (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
              throw new Error("Cannot type: Element is not an editable input field (React Lexical may have failed to mount)");
            }
            
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
              // Attempt to dispatch a paste event so rich text editors (like Lexical on FB)
              // can cleanly handle newlines and generate proper paragraph blocks.
              var textToInsert = String(${safeJS(text)});
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
          if (!Array.isArray(filePaths) || filePaths.length === 0) {
            throw new Error('filePaths must be a non-empty array of file paths')
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

  getWebContentsId(accountId: number): number | null {
    const wcId = this.registry.get(accountId)
    if (wcId === undefined) return null
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      this.registry.delete(accountId)
      return null
    }
    return wcId
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
