// Vết thao tác của block Facebook khi chạy bằng engine v2 (phương án mục 3.6, R4; anh chốt Q15 16/11/2026).
//
// - Bọc PageController: mọi thao tác nhỏ (bấm, gõ, dán, chờ phần tử, gọi API…) ghi vào RAM của lượt: thao tác, tên phần tử trong
//   auto_elements (qua helpers.element, không phải XPath), thời lượng, lỗi, URL trang khi đổi. Không ghi DB từng thao tác.
// - Block lỗi thì engine gửi toàn bộ vết của block đó (trần 200 thao tác / 64 KB) vào auto_engine_outcomes.signal; tín hiệu là thao tác
//   nhỏ bị lỗi mà block ném lại, ví dụ { kind: 'block', code: 'wait:fb_post_button' }. Luật DB theo (thao tác, phần tử) đổi ra mã.
// - Cho biết cú bấm gửi (khai ở auto_engine_block_steps.send_ops) đã thật sự chạy chưa: chưa chạy, hoặc lỗi kiểu "Element not found",
//   thì chắc chắn chưa gửi.
// - Cho bộ nhận ra block treo (Q20): thời điểm thao tác gần nhất, không tính lúc block nghỉ theo cài đặt (helpers.sleep).
//
// Không ghi nội dung khách gõ / dán, không ghi chuỗi truy vấn của URL (có thể chứa token).
import type { PageController } from '../../v2/runtime/pageController'

export interface PageTraceOp {
  /** Thao tác: click, type, paste, press, wait, evaluate, api, navigate… */
  op: string
  /** Tên phần tử trong auto_elements; phím với press; method + đường dẫn với api; host + đường dẫn với navigate. */
  el?: string
  /** Selector không đổi được ra tên phần tử: tối đa 80 ký tự đầu. */
  sel?: string
  /** Mili giây kể từ lúc block bắt đầu. */
  t: number
  ms: number
  ok: boolean
  err?: string
  /** URL trang (host + đường dẫn) lúc bắt đầu thao tác, chỉ ghi khi khác thao tác trước. */
  url?: string
}

export interface PageTraceSnapshot {
  ops: PageTraceOp[]
  /** Số thao tác bị bỏ ở giữa vì vượt trần (giữ phần đầu và phần cuối). */
  dropped: number
  sendAttempted: boolean
}

export const PAGE_TRACE_MAX_OPS = 200
export const PAGE_TRACE_MAX_BYTES = 64 * 1024
const KEEP_HEAD = 40
const MAX_ERR = 300
const MAX_TEXT = 200

/** Tên thao tác ghi trong vết theo method của PageController (chỉ các method này được ghi). */
export const PAGE_TRACE_OPS: Readonly<Record<string, string>> = {
  navigate: 'navigate', reload: 'reload', goBack: 'back', goForward: 'forward', waitForNavigation: 'waitNav',
  waitForSelector: 'wait', $: 'query', $$: 'queryAll', click: 'click', type: 'type', focus: 'focus', paste: 'paste',
  insertText: 'insertText', fill: 'fill', hover: 'hover', press: 'press', scroll: 'scroll', select: 'select',
  getText: 'getText', getValue: 'getValue', getAttribute: 'getAttribute', screenshot: 'screenshot', evaluate: 'evaluate',
  apiCall: 'api', getCookieHeader: 'cookie', downloadUrl: 'download', uploadFile: 'upload', dropFile: 'drop', dropFileDeep: 'dropDeep'
}

/** Thao tác nhận selector ở tham số đầu. */
const SELECTOR_OPS = new Set(['waitForSelector', '$', '$$', 'click', 'type', 'focus', 'paste', 'fill', 'hover', 'select', 'getText',
  'getValue', 'getAttribute', 'uploadFile', 'dropFile', 'dropFileDeep'])

/**
 * Lỗi chứng minh thao tác chưa tác động gì lên trang (không tìm thấy phần tử, trang đã đóng…). Thao tác gửi lỗi kiểu này thì chắc chắn
 * chưa gửi; lỗi khác (script hỏng giữa chừng, apiCall mất mạng sau khi gửi…) là không rõ kết quả.
 */
const NOT_DISPATCHED = [
  /^Element not found/i, /^waitForSelector timeout/i, /^Cannot find editable element/i, /^Element cannot be focused/i,
  /^Unsupported paste MIME type/i, /^HTML paste requires/i, /^Browser page is not connected/i, /^File input not found/i,
  /^Drop target not found/i, /^Cannot locate/i, /^downloadUrl:/i, /^apiCall multipart: file not found/i, /^Invalid data URI/i,
  /^URL media phải được resolve/i
]

export function isNotDispatchedError(message: string | undefined | null): boolean {
  const text = String(message ?? '').trim()
  return NOT_DISPATCHED.some(pattern => pattern.test(text))
}

function trimText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** host + đường dẫn, bỏ chuỗi truy vấn và phần #. */
export function tracePageUrl(raw: string | undefined | null): string {
  const text = String(raw ?? '')
  if (!text) return ''
  try {
    const url = new URL(text)
    return trimText(`${url.host}${url.pathname}`, MAX_TEXT)
  } catch {
    return trimText(text.split(/[?#]/)[0], MAX_TEXT)
  }
}

/** Mục trong send_ops: 'click:fb_post_button' khớp click đúng phần tử đó; 'click' khớp mọi click; 'press:Enter' khớp phím Enter. */
export function matchesSendOp(op: Pick<PageTraceOp, 'op' | 'el'>, entry: string): boolean {
  const index = entry.indexOf(':')
  const name = index < 0 ? entry : entry.slice(0, index)
  if (name !== op.op) return false
  return index < 0 || entry.slice(index + 1) === (op.el ?? '')
}

export class PageTrace {
  private ops: PageTraceOp[] = []
  private dropped = 0
  private bytes = 0
  private blockStartedAt = Date.now()
  private lastUrl = ''
  private readonly names = new Map<string, string>()
  private sendOps: readonly string[] = []
  private attempted = false
  private sleeping = 0
  private lastActivity = Date.now()

  constructor(private readonly now: () => number = Date.now) {
    this.blockStartedAt = now()
    this.lastActivity = this.blockStartedAt
  }

  /** Bắt đầu vết của một block mới; sendOps lấy từ auto_engine_block_steps của block đó. */
  beginBlock(sendOps: readonly string[] = []): void {
    this.ops = []
    this.dropped = 0
    this.bytes = 0
    this.lastUrl = ''
    this.sendOps = sendOps
    this.attempted = false
    this.sleeping = 0
    this.blockStartedAt = this.now()
    this.lastActivity = this.blockStartedAt
  }

  /** helpers.element / elementWith vừa đổi tên ra selector (giữ trong cả lượt: selector không đổi giữa các block). */
  noteElement(name: string, selector: string): void {
    if (name && selector) this.names.set(selector, name)
  }

  sleepStart(): void { this.sleeping++; this.touch() }
  sleepEnd(): void { this.sleeping = Math.max(0, this.sleeping - 1); this.touch() }

  /** Có hoạt động (thao tác bắt đầu / xong, nghỉ xong, AI trả lời…). */
  touch(): void { this.lastActivity = this.now() }

  /** Block treo (Q20): quá limitMs không có thao tác nào, không tính lúc đang nghỉ theo cài đặt. */
  idleFor(limitMs: number): boolean {
    if (this.sleeping > 0) return false
    return this.now() - this.lastActivity > limitMs
  }

  get lastActivityAt(): number { return this.lastActivity }

  clock(): number { return this.now() }

  /** Cú bấm gửi của block đã thật sự chạy chưa (lỗi kiểu "không tìm thấy phần tử" không tính). */
  get sendAttempted(): boolean { return this.attempted }

  elementName(selector: unknown): { el?: string; sel?: string } {
    if (typeof selector !== 'string' || !selector) return {}
    const name = this.names.get(selector)
    return name ? { el: name } : { sel: trimText(selector, 80) }
  }

  /** Câu lỗi gọn: thay selector đã biết tên bằng {tên}, cắt 300 ký tự. */
  cleanMessage(message: unknown): string {
    let text = String(message ?? '')
    for (const [selector, name] of this.names) {
      if (selector.length >= 8 && text.includes(selector)) text = text.split(selector).join(`{${name}}`)
    }
    return trimText(text, MAX_ERR)
  }

  record(method: string, args: unknown[], startedAt: number, error: unknown | null, pageUrl: string): PageTraceOp {
    const op = PAGE_TRACE_OPS[method] ?? method
    const entry: PageTraceOp = { op, t: Math.max(0, startedAt - this.blockStartedAt), ms: Math.max(0, this.now() - startedAt), ok: error === null }
    if (SELECTOR_OPS.has(method)) Object.assign(entry, this.elementName(args[0]))
    else if (method === 'press') entry.el = trimText(String(args[0] ?? ''), 40)
    else if (method === 'navigate') entry.el = tracePageUrl(String(args[0] ?? ''))
    else if (method === 'apiCall') {
      const opts = (args[0] ?? {}) as { url?: string; method?: string }
      entry.el = `${String(opts.method ?? 'GET').toUpperCase()} ${tracePageUrl(opts.url)}`
    } else if (method === 'downloadUrl') entry.el = tracePageUrl(String(args[0] ?? ''))
    if (error !== null) entry.err = this.cleanMessage(error instanceof Error ? error.message : error)
    if (pageUrl && pageUrl !== this.lastUrl) { entry.url = pageUrl; this.lastUrl = pageUrl }
    this.push(entry)
    if (!this.attempted && this.sendOps.some(item => matchesSendOp(entry, item))) {
      this.attempted = entry.ok || !isNotDispatchedError(entry.err)
    }
    this.touch()
    return entry
  }

  private push(entry: PageTraceOp): void {
    const size = JSON.stringify(entry).length + 1
    this.ops.push(entry)
    this.bytes += size
    while ((this.ops.length > PAGE_TRACE_MAX_OPS || this.bytes > PAGE_TRACE_MAX_BYTES) && this.ops.length > KEEP_HEAD + 1) {
      const [removed] = this.ops.splice(KEEP_HEAD, 1)
      this.bytes -= JSON.stringify(removed).length + 1
      this.dropped++
    }
  }

  snapshot(): PageTraceSnapshot {
    return { ops: this.ops.map(op => ({ ...op })), dropped: this.dropped, sendAttempted: this.attempted }
  }

  /**
   * Tín hiệu khi block kết thúc lỗi: thao tác nhỏ lỗi gần nhất mà block ném lại (câu lỗi của block chứa câu lỗi thao tác) →
   * code '<thao tác>:<phần tử>'; block tự ném lỗi khác → code 'throw'. Thao tác thử phần tử trong try (block chạy tiếp) không phải lỗi.
   */
  failureSignal(blockError: unknown): { code: string; message: string; trace: PageTraceSnapshot } {
    const message = this.cleanMessage(blockError instanceof Error ? blockError.message : blockError)
    const raw = String(blockError instanceof Error ? blockError.message : blockError ?? '')
    let code = 'throw'
    for (let index = this.ops.length - 1; index >= 0; index--) {
      const op = this.ops[index]
      if (op.ok || !op.err) continue
      const opText = op.err.replace(/…$/, '')
      if (raw.includes(opText) || message.includes(opText)) code = `${op.op}:${op.el ?? (op.sel ? 'selector' : '')}`.replace(/:$/, '')
      break
    }
    return { code, message, trace: this.snapshot() }
  }
}

/**
 * Bọc PageController: mọi method trong PAGE_TRACE_OPS ghi vết; method khác (getURL, isConnected…) đi thẳng. Block vẫn thấy đúng API cũ.
 */
export function tracePage(page: PageController, trace: PageTrace): PageController {
  const wrapped = new Map<PropertyKey, unknown>()
  return new Proxy(page, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      if (typeof property !== 'string' || !(property in PAGE_TRACE_OPS)) return value.bind(target)
      const cached = wrapped.get(property)
      if (cached) return cached
      const fn = async (...args: unknown[]) => {
        const pageUrl = tracePageUrl(safeUrl(target))
        const startedAt = trace.clock()
        trace.touch()
        try {
          const result = await (value as (...input: unknown[]) => Promise<unknown>).apply(target, args)
          trace.record(property, args, startedAt, null, pageUrl)
          return result
        } catch (error) {
          trace.record(property, args, startedAt, error ?? new Error('unknown'), pageUrl)
          throw error
        }
      }
      wrapped.set(property, fn)
      return fn
    }
  })
}

function safeUrl(page: PageController): string {
  try { return page.getURL() } catch { return '' }
}
