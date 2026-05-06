import { WebContents } from 'electron'

// JS code injected vào webview để resolve cả CSS selector và XPath với visibility filter.
const SELECTOR_RESOLVER_JS = `
function resolveSelector(selector) {
  if (!selector) return null;
  function isVisible(el) {
    if (!el) return false;
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }
  if (selector.startsWith('/') || selector.startsWith('(')) {
    var match = selector.match(/^(.*)\\[(\\d+)\\]$/);
    if (match) {
      var baseSelector = match[1];
      var index = parseInt(match[2], 10) - 1;
      var result = document.evaluate(baseSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      var visibleEls = [];
      for (var i = 0; i < result.snapshotLength; i++) {
        var n = result.snapshotItem(i);
        if (isVisible(n)) visibleEls.push(n);
      }
      return visibleEls[index] || null;
    }
    var r = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue;
  }
  var els = document.querySelectorAll(selector);
  for (var i = 0; i < els.length; i++) {
    if (isVisible(els[i])) return els[i];
  }
  return null;
}
function resolveAllSelector(selector) {
  if (!selector) return [];
  if (selector.startsWith('/') || selector.startsWith('(')) {
    var r = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    var arr = [];
    for (var i = 0; i < r.snapshotLength; i++) arr.push(r.snapshotItem(i));
    return arr;
  }
  return Array.from(document.querySelectorAll(selector));
}
`

const safeJS = (v: string) => JSON.stringify(v)

export interface ScrollOpts {
  selector?: string
  direction: 'up' | 'down' | 'left' | 'right'
  amount?: number
}

export interface WaitForSelectorOpts {
  timeout?: number
  state?: 'visible' | 'hidden' | 'attached'
}

export interface ApiCallOpts {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeout?: number
}

export interface ApiCallResult {
  status: number
  data: unknown
  headers: Record<string, string>
}

/**
 * PageController v2 — wrapper trên WebContents.executeJavaScript exposing
 * Playwright-style API cho block JS dùng trong sandbox.
 *
 * Chia sẻ session với <webview> đã embed cho 1 account FB → giữ login.
 *
 * Khác với engine cũ (executeAction switch theo enum), pageController có
 * method tường minh per primitive — đọc trong block dễ hơn, intellisense tốt.
 */
export class PageController {
  private wc: WebContents

  constructor(wc: WebContents) {
    this.wc = wc
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

  /** Wrap JS với SELECTOR_RESOLVER + try-catch trả lỗi vào main */
  private async exec<T = unknown>(code: string): Promise<T> {
    const wrapped = `
      (function() {
        try {
          ${SELECTOR_RESOLVER_JS}
          ${code}
        } catch (e) {
          return { __error: true, message: e.message || String(e) };
        }
      })()
    `
    const result: any = await this.wc.executeJavaScript(wrapped, true)
    if (result && typeof result === 'object' && result.__error) {
      throw new Error(result.message)
    }
    return result as T
  }

  // =========== NAVIGATION ===========
  async navigate(url: string): Promise<void> {
    await this.wc.loadURL(url)
  }

  async reload(): Promise<void> {
    this.wc.reload()
    await this.waitForNavigation(30000)
  }

  async goBack(): Promise<void> {
    this.wc.goBack()
    await this.waitForNavigation(30000)
  }

  async goForward(): Promise<void> {
    this.wc.goForward()
    await this.waitForNavigation(30000)
  }

  // =========== WAITING ===========
  async waitForNavigation(timeoutMs = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`waitForNavigation timeout sau ${timeoutMs}ms`))
      }, timeoutMs)
      const onDone = () => {
        cleanup()
        resolve()
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.wc.removeListener('did-finish-load', onDone)
        this.wc.removeListener('did-stop-loading', onDone)
      }
      this.wc.once('did-finish-load', onDone)
      this.wc.once('did-stop-loading', onDone)
    })
  }

  async waitForSelector(selector: string, opts: WaitForSelectorOpts = {}): Promise<boolean> {
    const timeout = opts.timeout ?? 30000
    const state = opts.state ?? 'visible'
    const startTime = Date.now()
    const interval = 200
    let polls = 0
    while (Date.now() - startTime < timeout) {
      const found = await this.exec<boolean>(`
        var el = resolveSelector(${safeJS(selector)});
        ${state === 'attached'
          ? 'return !!el;'
          : state === 'hidden'
            ? 'return !el;'
            : 'return !!el;' /* resolveSelector đã filter visible */}
      `).catch(() => false)
      if (found) return true
      polls++
      if (state !== 'hidden' && this.shouldLazyLoadFacebookCommentBox(selector) && polls % 3 === 0) {
        await this.exec(`
          window.scrollBy(0, Math.max(600, Math.floor((window.innerHeight || 800) * 0.85)));
          return true;
        `).catch(() => false)
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      await new Promise(r => setTimeout(r, interval))
    }
    throw new Error(`waitForSelector timeout: ${selector}`)
  }

  private shouldLazyLoadFacebookCommentBox(selector: string): boolean {
    return (
      selector.includes('Write a comment') ||
      selector.includes('Viết bình luận') ||
      selector.includes('Viáº¿t bÃ¬nh luáº­n')
    )
  }

  // =========== ELEMENT QUERY ===========
  async $(selector: string): Promise<{ xpath: string } | null> {
    const found = await this.exec<boolean>(`
      var el = resolveSelector(${safeJS(selector)});
      return !!el;
    `).catch(() => false)
    return found ? { xpath: selector } : null
  }

  async $$(selector: string): Promise<{ xpath: string }[]> {
    const count = await this.exec<number>(`
      var arr = resolveAllSelector(${safeJS(selector)});
      return arr.length;
    `).catch(() => 0)
    const out: { xpath: string }[] = []
    for (let i = 1; i <= count; i++) {
      out.push({ xpath: `(${selector})[${i}]` })
    }
    return out
  }

  // =========== INTERACTION ===========
  async click(selector: string, opts: { clickCount?: number } = {}): Promise<void> {
    const clickCount = opts.clickCount ?? 1
    await this.waitForSelector(selector, { timeout: 15000 })
    await this.exec(`
      var el = resolveSelector(${safeJS(selector)});
      if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
      el.scrollIntoView({ block: "center", inline: "center" });
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
      return true;
    `)
  }

  async type(selector: string, text: string, opts: { clearFirst?: boolean } = {}): Promise<void> {
    const clearFirst = !!opts.clearFirst
    await this.waitForSelector(selector, { timeout: 15000 })
    await this.exec(`
      var el = resolveSelector(${safeJS(selector)});
      if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
      el.scrollIntoView({ block: "center", inline: "center" });
      el.focus();
      if (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') el.click();
    `)
    await new Promise(r => setTimeout(r, 500))
    await this.exec(`
      var el = resolveSelector(${safeJS(selector)});
      var target = null;
      if (el && el.isContentEditable) target = el;
      else if (el) {
        target = el.querySelector('[contenteditable="true"]');
        if (!target && el.parentElement) target = el.parentElement.querySelector('[contenteditable="true"]');
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
        var lines = String(${safeJS(text)}).split('\\n');
        for (var i = 0; i < lines.length; i++) {
          if (i > 0) document.execCommand('insertParagraph', false, null);
          if (lines[i].length > 0) document.execCommand('insertText', false, lines[i]);
        }
        return true;
      } else if (target) {
        ${clearFirst ? 'target.value = "";' : ''}
        target.value = ${clearFirst ? '' : '(target.value || "") + '}${safeJS(text)};
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } else {
        throw new Error("Cannot find editable element for typing");
      }
    `)
  }

  /**
   * setValue equivalent — paste-based, hỗ trợ Lexical (FB rich text).
   * Mạnh hơn type() khi cần chắc chắn nội dung được set, có thể vượt qua các
   * Lexical handler không trigger qua execCommand.
   */
  async fill(selector: string, value: string): Promise<void> {
    await this.waitForSelector(selector, { timeout: 15000 })
    await this.exec(`
      var el = resolveSelector(${safeJS(selector)});
      if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
      var text = ${safeJS(value)};
      el.focus();
      if (el.isContentEditable) {
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false);
        var dt = new DataTransfer();
        dt.setData('text/plain', String(text));
        var pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        var handled = !el.dispatchEvent(pasteEvent);
        if (!handled) {
          var lines = String(text).split('\\n');
          for (var i = 0; i < lines.length; i++) {
            if (i > 0) document.execCommand('insertParagraph', false, null) || document.execCommand('insertLineBreak', false, null);
            if (lines[i].length > 0) document.execCommand('insertText', false, lines[i]);
          }
        }
      } else {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    `)
  }

  async hover(selector: string): Promise<void> {
    await this.waitForSelector(selector, { timeout: 10000 })
    // FB pattern: focusin trước (lazy href loader), rồi pointer/mouse cho generic hover
    await this.exec(`
      var el = resolveSelector(${safeJS(selector)});
      if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
      el.scrollIntoView({ block: "center", inline: "center" });
      var init = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new FocusEvent("focusin", init));
      try { if (typeof el.focus === "function") el.focus(); } catch (e) {}
      var pInit = Object.assign({}, init, { pointerId: 1, pointerType: "mouse", isPrimary: true });
      try { el.dispatchEvent(new PointerEvent("pointerover", pInit)); } catch (e) {}
      try { el.dispatchEvent(new PointerEvent("pointerenter", pInit)); } catch (e) {}
      try { el.dispatchEvent(new PointerEvent("pointermove", pInit)); } catch (e) {}
      el.dispatchEvent(new MouseEvent("mouseover", init));
      el.dispatchEvent(new MouseEvent("mouseenter", init));
      el.dispatchEvent(new MouseEvent("mousemove", init));
      return true;
    `)
  }

  async press(key: string): Promise<void> {
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
        "ArrowRight": { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
        "Space": { key: " ", code: "Space", keyCode: 32 }
      };
      var keyInfo = keyMap[${safeJS(key)}] || { key: ${safeJS(key)}, code: ${safeJS(key)}, keyCode: 0 };
      var target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", Object.assign({}, keyInfo, { bubbles: true })));
      target.dispatchEvent(new KeyboardEvent("keypress", Object.assign({}, keyInfo, { bubbles: true })));
      target.dispatchEvent(new KeyboardEvent("keyup", Object.assign({}, keyInfo, { bubbles: true })));
      return true;
    `)
  }

  async scroll(opts: ScrollOpts): Promise<{ scrollX: number; scrollY: number }> {
    const { selector, direction, amount = 500 } = opts
    if (selector) await this.waitForSelector(selector, { timeout: 10000 }).catch(() => false)
    return await this.exec(`
      var amounts = { "down": [0, ${Number(amount)}], "up": [0, ${-Number(amount)}], "right": [${Number(amount)}, 0], "left": [${-Number(amount)}, 0] };
      var pair = amounts[${safeJS(direction)}] || [0, ${Number(amount)}];
      ${selector
        ? `var el = resolveSelector(${safeJS(selector)}); if (el) el.scrollBy(pair[0], pair[1]);`
        : `window.scrollBy(pair[0], pair[1]);`}
      return { scrollX: window.scrollX, scrollY: window.scrollY };
    `)
  }

  async select(selector: string, value: string): Promise<string> {
    await this.waitForSelector(selector, { timeout: 15000 })
    return await this.exec(`
      var el = resolveSelector(${safeJS(selector)});
      if (!el) throw new Error("Element not found: " + ${safeJS(selector)});
      el.value = ${safeJS(value)};
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    `)
  }

  // =========== DATA ===========
  async getText(selector: string): Promise<string> {
    await this.waitForSelector(selector, { timeout: 10000 })
    const text = await this.exec<string>(`
      var el = resolveSelector(${safeJS(selector)});
      if (!el) return "";
      return (typeof el.innerText === 'string' && el.innerText.length > 0) ? el.innerText : (el.textContent || "");
    `)
    return text || ''
  }

  async getValue(selector: string): Promise<string> {
    await this.waitForSelector(selector, { timeout: 10000 })
    const value = await this.exec<string>(`
      var el = resolveSelector(${safeJS(selector)});
      return el ? (el.value || "") : "";
    `)
    return value || ''
  }

  async getAttribute(selector: string, attribute: string): Promise<string | null> {
    await this.waitForSelector(selector, { timeout: 10000 })
    const v = await this.exec<string | null>(`
      var el = resolveSelector(${safeJS(selector)});
      return el ? (el.getAttribute(${safeJS(attribute)})) : null;
    `)
    return v
  }

  async screenshot(opts: { fullPage?: boolean } = {}): Promise<string> {
    void opts
    const image = await this.wc.capturePage()
    return image.toPNG().toString('base64')
  }

  // =========== GENERIC EVAL ===========
  async evaluate<T = unknown>(code: string, ...args: unknown[]): Promise<T> {
    const argsJSON = JSON.stringify(args)
    const wrapped = `
      (async function() {
        var __args = ${argsJSON};
        ${code}
      })()
    `
    return await this.wc.executeJavaScript(wrapped, true)
  }

  // =========== NETWORK ===========
  async apiCall(opts: ApiCallOpts): Promise<ApiCallResult> {
    const method = opts.method ?? 'GET'
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
    const fetchOptions: RequestInit = { method, headers }
    if (['POST', 'PUT', 'PATCH'].includes(method) && opts.body !== undefined) {
      fetchOptions.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
    }
    const timeout = opts.timeout ?? 30000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    fetchOptions.signal = controller.signal
    try {
      const response = await fetch(opts.url, fetchOptions)
      clearTimeout(timer)
      let data: unknown
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) data = await response.json()
      else data = await response.text()
      const respHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => { respHeaders[k] = v })
      return { status: response.status, data, headers: respHeaders }
    } catch (err: any) {
      clearTimeout(timer)
      throw new Error(`apiCall failed: ${err.message}`)
    }
  }

  /** Tải URL về file local. Lấy cookie từ webview session để bypass FB block. */
  async downloadUrl(url: string, opts: { timeout?: number } = {}): Promise<{ filePath: string; byteLength: number; contentType: string }> {
    if (!url) throw new Error('downloadUrl: thiếu url')
    const timeout = opts.timeout ?? 30000

    let cookieHeader = ''
    try {
      const cookies = await this.wc.session.cookies.get({ url })
      cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
    } catch {}

    const currentPageUrl = (() => {
      try { return this.wc.getURL() || 'https://www.facebook.com/' } catch { return 'https://www.facebook.com/' }
    })()

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Referer': currentPageUrl,
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
    }
    if (cookieHeader) headers['Cookie'] = cookieHeader

    const response = await fetch(url, { method: 'GET', headers, redirect: 'follow', signal: AbortSignal.timeout(timeout) })
    if (!response.ok) throw new Error(`downloadUrl: HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const buf = Buffer.from(await response.arrayBuffer())

    const { writeFileSync } = await import('fs')
    const { join: pathJoin, extname: pathExtname } = await import('path')
    const { tmpdir } = await import('os')

    const extFromUrl = pathExtname(new URL(url).pathname).replace('.', '').toLowerCase()
    const extFromType = contentType.split(';')[0].split('/').pop() || ''
    const ext = extFromUrl || extFromType || 'bin'
    const filePath = pathJoin(tmpdir(), `dl-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`)
    writeFileSync(filePath, buf)
    return { filePath, byteLength: buf.length, contentType }
  }

  // =========== FILE UPLOAD (CDP) ===========
  async uploadFile(selector: string, filePaths: string[]): Promise<{ fileCount: number }> {
    if (!filePaths || filePaths.length === 0) return { fileCount: 0 }
    const resolved = await this.resolveFilePaths(filePaths)
    await this.waitForSelector(selector, { timeout: 15000 })

    const uniqueId = `__upload_${Date.now()}_${Math.random().toString(36).slice(2)}`
    await this.exec(`
      var el = resolveSelector(${safeJS(selector)});
      if (!el) throw new Error("File input not found: " + ${safeJS(selector)});
      if (el.tagName !== 'INPUT' || el.type !== 'file') {
        var fi = el.querySelector('input[type="file"]');
        if (!fi) {
          var p = el.closest('form') || el.parentElement || document.body;
          fi = p.querySelector('input[type="file"]');
        }
        if (fi) el = fi;
      }
      el.setAttribute('data-upload-id', ${safeJS(uniqueId)});
      return true;
    `)

    try { this.wc.debugger.attach('1.3') } catch {}
    try {
      const { root } = await this.wc.debugger.sendCommand('DOM.getDocument', {})
      const { nodeId } = await this.wc.debugger.sendCommand('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: `[data-upload-id="${uniqueId}"]`
      })
      if (!nodeId) throw new Error('Cannot locate file input via CDP')
      await this.wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: resolved })
      await this.exec(`
        var el = document.querySelector('[data-upload-id="${uniqueId}"]');
        if (el) {
          el.removeAttribute('data-upload-id');
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `)
      return { fileCount: resolved.length }
    } finally {
      try { this.wc.debugger.detach() } catch {}
    }
  }

  /** Drag-and-drop file qua DragEvent — dùng cho FB composer/messenger */
  async dropFile(selector: string, filePaths: string[]): Promise<{ fileCount: number }> {
    if (!filePaths || filePaths.length === 0) return { fileCount: 0 }
    const resolved = await this.resolveFilePaths(filePaths)
    await this.waitForSelector(selector, { timeout: 15000 })

    let count = 0
    for (const filePath of resolved) {
      const uniqueId = `__drop_${Date.now()}_${Math.random().toString(36).slice(2)}`
      try {
        await this.exec(`
          var b = resolveSelector(${safeJS(selector)});
          if (!b) throw new Error("Drop target not found");
          var c = b.ownerDocument;
          var attempt = 0;
          while (true) {
            var rect = b.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var hit = c.elementFromPoint(cx, cy);
            if (hit && b.contains(hit)) break;
            if (1 < ++attempt) { b.scrollIntoView({behavior:'instant', block:'center'}); break; }
            b.scrollIntoView({behavior:'instant', block:'center'});
          }
          var a = c.createElement('INPUT');
          a.setAttribute('type', 'file');
          a.setAttribute('multiple', 'true');
          a.setAttribute('data-drop-id', ${safeJS(uniqueId)});
          a.setAttribute('style', 'position:fixed;z-index:2147483647;left:0;top:0;opacity:0;');
          a.onchange = function() {
            var rect2 = b.getBoundingClientRect();
            var cx2 = rect2.left + rect2.width / 2;
            var cy2 = rect2.top + rect2.height / 2;
            var target = c.elementFromPoint(cx2, cy2) || b;
            var dt = {
              effectAllowed: 'all', dropEffect: 'none',
              types: ['Files'], files: this.files,
              setData: function(){}, getData: function(){},
              clearData: function(){}, setDragImage: function(){}
            };
            if (window.DataTransferItemList) {
              var items = [];
              for (var i = 0; i < this.files.length; i++) {
                items.push(Object.setPrototypeOf({
                  kind: 'file', type: this.files[i].type, file: this.files[i],
                  getAsFile: function() { return this.file; },
                  getAsString: function(cb) { var r = new FileReader(); r.onload = function(e){ cb(e.target.result); }; r.readAsText(this.file); }
                }, DataTransferItem.prototype));
              }
              dt.items = Object.setPrototypeOf(items, DataTransferItemList.prototype);
            }
            Object.setPrototypeOf(dt, DataTransfer.prototype);
            ['dragenter', 'dragover', 'drop'].forEach(function(name) {
              var d = c.createEvent('DragEvent');
              d.initMouseEvent(name, true, true, c.defaultView, 0, 0, 0, cx2, cy2, false, false, false, false, 0, null);
              Object.setPrototypeOf(d, null);
              d.dataTransfer = dt;
              Object.setPrototypeOf(d, DragEvent.prototype);
              target.dispatchEvent(d);
            });
            a.parentElement.removeChild(a);
          };
          c.documentElement.appendChild(a);
          a.getBoundingClientRect();
          return ${safeJS(uniqueId)};
        `)

        try { this.wc.debugger.attach('1.3') } catch {}
        try {
          const { root } = await this.wc.debugger.sendCommand('DOM.getDocument', {})
          const { nodeId } = await this.wc.debugger.sendCommand('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: `[data-drop-id="${uniqueId}"]`
          })
          if (!nodeId) throw new Error('Cannot locate drop input via CDP')
          await this.wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [filePath] })
          count++
          await new Promise(r => setTimeout(r, 2000))
        } finally {
          try { this.wc.debugger.detach() } catch {}
        }
      } catch (err) {
        console.error(`[PageController] dropFile failed for ${filePath}:`, err)
      }
    }
    return { fileCount: count }
  }

  /** Resolve data: URI thành temp file paths. Trả filesystem paths. */
  private async resolveFilePaths(paths: string[]): Promise<string[]> {
    const { writeFileSync, existsSync } = await import('fs')
    const { join: pathJoin } = await import('path')
    const { tmpdir } = await import('os')
    const out: string[] = []
    for (let i = 0; i < paths.length; i++) {
      const fp = paths[i]
      if (fp.startsWith('data:')) {
        const m = fp.match(/^data:([^;]+);base64,(.+)$/)
        if (!m) throw new Error(`Invalid data URI at index ${i}`)
        const ext = m[1].split('/')[1] || 'png'
        const buf = Buffer.from(m[2], 'base64')
        const tmp = pathJoin(tmpdir(), `upload_${Date.now()}_${i}.${ext}`)
        writeFileSync(tmp, buf)
        out.push(tmp)
      } else {
        if (!existsSync(fp)) console.warn(`[PageController] file not found: ${fp}`)
        out.push(fp)
      }
    }
    return out
  }
}

/**
 * Registry mapping accountId → PageController. Engine v2 lookup PageController
 * theo account hiện tại để chạy block. Đăng ký bởi BrowserPage qua IPC khi
 * webview mount/unmount.
 *
 * Pattern này tách biệt với WebviewRegistry cũ (bên webviewController.ts) để
 * v2 không phụ thuộc engine cũ — sau khi drop engine cũ chỉ cần xóa file kia.
 */
export class PageControllerRegistry {
  private map = new Map<number, PageController>()

  register(accountId: number, wc: WebContents): void {
    this.map.set(accountId, new PageController(wc))
  }

  unregister(accountId: number): void {
    this.map.delete(accountId)
  }

  get(accountId: number): PageController | null {
    return this.map.get(accountId) ?? null
  }

  isRegistered(accountId: number): boolean {
    return this.map.has(accountId)
  }
}
