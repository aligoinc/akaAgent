import type { ChannelManager } from './ChannelManager.js'
import type { PlaywrightController } from '../browser/PlaywrightController.js'

export interface PickResult {
  selectorType: 'css' | 'xpath'
  expression: string
  fallbacks: Array<{ type: 'css' | 'xpath' | 'text-match'; expression: string }>
  text: string
  tagName: string
  url: string
}

/**
 * ElementPickerService — open Playwright browser, inject overlay, capture
 * user's click, return XPath/CSS + fallbacks.
 *
 * Uses existing ChannelManager so picked selectors work in same channel
 * cookie context as actual workflow run.
 *
 * Phase 8 minimum: 1 pick per session. User triggers picker → navigate
 * to URL → click element → result returned.
 */

const PICKER_OVERLAY_SCRIPT = `
(() => {
  if (window.__akabizPickerActive) return
  window.__akabizPickerActive = true

  const STYLE_ID = '__akabizPickerStyle'
  const HIGHLIGHT_ID = '__akabizPickerHighlight'

  // Inject style
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style')
    s.id = STYLE_ID
    s.textContent = \`
      #\${HIGHLIGHT_ID} {
        position: fixed; pointer-events: none;
        border: 2px dashed #4f46e5; background: rgba(79,70,229,0.15);
        z-index: 2147483647; transition: all 80ms;
      }
      #__akabizPickerBanner {
        position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
        background: #4f46e5; color: white; padding: 8px 16px;
        border-radius: 8px; font-family: sans-serif; font-size: 14px;
        z-index: 2147483647; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
    \`
    document.documentElement.appendChild(s)
  }
  const banner = document.createElement('div')
  banner.id = '__akabizPickerBanner'
  banner.textContent = '🎯 Click element to pick (ESC to cancel)'
  document.documentElement.appendChild(banner)

  const highlight = document.createElement('div')
  highlight.id = HIGHLIGHT_ID
  document.documentElement.appendChild(highlight)

  const moveHighlight = (el) => {
    if (!el) { highlight.style.display = 'none'; return }
    const r = el.getBoundingClientRect()
    highlight.style.display = 'block'
    highlight.style.left = r.left + 'px'
    highlight.style.top = r.top + 'px'
    highlight.style.width = r.width + 'px'
    highlight.style.height = r.height + 'px'
  }

  // Build robust XPath
  const xpathFor = (el) => {
    if (el === document.body) return '/html/body'
    if (!el || !el.parentNode) return ''
    const id = el.id
    if (id && /^[a-zA-Z_][\\w-]*$/.test(id) && document.querySelectorAll('#' + CSS.escape(id)).length === 1) {
      return '//*[@id="' + id + '"]'
    }
    const aria = el.getAttribute && el.getAttribute('aria-label')
    if (aria) {
      const candidate = '//*[@aria-label=' + JSON.stringify(aria) + ']'
      try {
        const r = document.evaluate('count(' + candidate + ')', document, null, XPathResult.NUMBER_TYPE, null)
        if (r.numberValue === 1) return candidate
      } catch {}
    }
    const testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test'))
    if (testid) {
      const candidate = '//*[@data-testid=' + JSON.stringify(testid) + ']'
      try {
        const r = document.evaluate('count(' + candidate + ')', document, null, XPathResult.NUMBER_TYPE, null)
        if (r.numberValue === 1) return candidate
      } catch {}
    }
    const role = el.getAttribute && el.getAttribute('role')
    if (role && el.textContent) {
      const txt = (el.textContent || '').trim().slice(0, 40)
      if (txt) {
        const candidate = '//*[@role=' + JSON.stringify(role) + ' and contains(., ' + JSON.stringify(txt) + ')]'
        try {
          const r = document.evaluate('count(' + candidate + ')', document, null, XPathResult.NUMBER_TYPE, null)
          if (r.numberValue === 1) return candidate
        } catch {}
      }
    }
    // Path-based fallback
    let path = ''
    let cur = el
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      let idx = 1
      let sib = cur.previousElementSibling
      while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling }
      const tag = cur.tagName.toLowerCase()
      path = '/' + tag + '[' + idx + ']' + path
      cur = cur.parentElement
    }
    return '/html/body' + path
  }

  // Build CSS selector
  const cssFor = (el) => {
    if (el === document.body) return 'body'
    if (el.id && /^[a-zA-Z_][\\w-]*$/.test(el.id)) {
      const sel = '#' + CSS.escape(el.id)
      try { if (document.querySelectorAll(sel).length === 1) return sel } catch {}
    }
    let path = []
    let cur = el
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      let part = cur.tagName.toLowerCase()
      if (cur.classList && cur.classList.length > 0) {
        const goodClass = Array.from(cur.classList).find(c => /^[a-zA-Z_][\\w-]*$/.test(c) && !/^(active|hover|focus|selected|css-|x[a-z0-9]{2,})/i.test(c))
        if (goodClass) part += '.' + CSS.escape(goodClass)
      }
      const parent = cur.parentElement
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName)
        if (sibs.length > 1) {
          const idx = sibs.indexOf(cur) + 1
          part += ':nth-of-type(' + idx + ')'
        }
      }
      path.unshift(part)
      cur = parent
    }
    return path.join(' > ') || el.tagName.toLowerCase()
  }

  let lastEl = null
  const onMouseOver = (e) => {
    const el = e.target
    if (!el || el === highlight || el === banner) return
    lastEl = el
    moveHighlight(el)
  }

  const onClick = (e) => {
    e.preventDefault()
    e.stopImmediatePropagation()
    const el = lastEl ?? e.target
    if (!el) return

    const xpath = xpathFor(el)
    const css = cssFor(el)
    const text = (el.textContent || el.value || '').trim().slice(0, 80)
    const tagName = el.tagName ? el.tagName.toLowerCase() : 'unknown'

    const fallbacks = []
    // text-match fallback
    if (text) {
      fallbacks.push({ type: 'text-match', expression: text.slice(0, 40) })
    }
    // CSS as fallback if XPath was primary
    if (xpath !== css) fallbacks.push({ type: 'css', expression: css })

    cleanup()

    try {
      window.__akabizPickerSelected({
        selectorType: 'xpath',
        expression: xpath,
        fallbacks,
        text,
        tagName,
        url: location.href
      })
    } catch (err) {
      console.error('akabiz picker callback failed', err)
    }
    return false
  }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      cleanup()
      try { window.__akabizPickerSelected(null) } catch {}
    }
  }

  const cleanup = () => {
    document.removeEventListener('mouseover', onMouseOver, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
    highlight.remove()
    banner.remove()
    delete window.__akabizPickerActive
  }

  document.addEventListener('mouseover', onMouseOver, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
})()
`

export class ElementPickerService {
  private activePromise: { resolve: (v: PickResult | null) => void; reject: (e: Error) => void } | null = null
  private exposed = new WeakSet<object>()

  constructor(private channelManager: ChannelManager) {}

  async pick(args: { channelId: string; url?: string }): Promise<PickResult | null> {
    if (this.activePromise) {
      throw new Error('Element picker already active. Cancel first.')
    }

    const handle = await this.channelManager.acquire(args.channelId)
    try {
      const controller = handle.controller as PlaywrightController
      // PlaywrightController doesn't expose page directly. Use executeAction
      // for navigate, then evalScript injects overlay. Receive picked element
      // via window.__akabizPickerSelected exposed function.

      if (args.url) {
        await controller.executeAction('navigate', { url: args.url, waitUntil: 'domcontentloaded' })
      }

      const page = (controller as PlaywrightController).getPage()
      if (!page) throw new Error('PlaywrightController has no active page')

      // Expose function once per controller (page may be navigated multiple times)
      if (!this.exposed.has(controller)) {
        await page.exposeFunction('__akabizPickerSelected', (payload: PickResult | null) => {
          const p = this.activePromise
          if (p) {
            this.activePromise = null
            p.resolve(payload ?? null)
          }
        })
        this.exposed.add(controller)
      }

      const promise = new Promise<PickResult | null>((resolve, reject) => {
        this.activePromise = { resolve, reject }
      })

      await page.evaluate(PICKER_OVERLAY_SCRIPT)

      const result = await promise
      return result
    } finally {
      await handle.release()
    }
  }

  cancel(): void {
    if (this.activePromise) {
      const p = this.activePromise
      this.activePromise = null
      p.resolve(null)
    }
  }
}
