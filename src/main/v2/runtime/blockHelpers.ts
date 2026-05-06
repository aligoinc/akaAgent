import { resolveXpathByName } from '../../data/repositories/elementV2Repository'

export interface BlockHelpers {
  /** Pause execution. Throws khi signal aborted. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Append a line vào run log (capture cho UI realtime + run history) */
  log(message: string): void
  /** Random integer trong [min, max] (inclusive) */
  randomBetween(min: number, max: number): number
  /** Normalize URL FB: bare uid/slug → full https://www.facebook.com/... */
  normalizeFbUrl(raw: string): string
  /** Bare UID/slug từ profile URL/profile.php?id=X */
  extractUidFromInput(raw: string): string
  /** Tách content theo `|` thành array biến thể (đã trim, bỏ rỗng) */
  splitVariants(content: string | undefined | null): string[]
  /** Cycle 1 biến thể theo index (modulo). Empty array → '' */
  cycleVariant(variants: string[], index: number): string
  /** Lookup XPath snippet từ auto_elements bằng name. Throws nếu không tìm thấy. */
  element(name: string): Promise<string>
  /** Concat multiple XPath snippets bằng name + replace ${var} placeholder */
  elementWith(name: string, vars: Record<string, string | number>): Promise<string>
}

/**
 * Tạo helpers instance gắn với 1 run/block. `logCollector` capture log để
 * (a) emit lên UI realtime qua IPC `flow:progress`/`v2:run:log`,
 * (b) lưu vào BlockResult.logs cho run history.
 */
export function createBlockHelpers(logCollector: (message: string) => void): BlockHelpers {
  return {
    async sleep(ms: number, signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) throw new Error('Block bị huỷ trước khi sleep')
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (signal) signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        const onAbort = () => {
          clearTimeout(timer)
          reject(new Error('Block bị huỷ trong khi sleep'))
        }
        if (signal) signal.addEventListener('abort', onAbort, { once: true })
      })
    },

    log(message: string): void {
      logCollector(String(message))
    },

    randomBetween(min: number, max: number): number {
      const lo = Math.ceil(min)
      const hi = Math.floor(max)
      return Math.floor(Math.random() * (hi - lo + 1)) + lo
    },

    normalizeFbUrl(raw: string): string {
      const trimmed = String(raw || '').trim()
      if (!trimmed) return trimmed
      if (/^https?:\/\//i.test(trimmed)) return trimmed
      if (/^(www\.)?facebook\.com\//i.test(trimmed)) return `https://${trimmed}`
      const cleaned = trimmed.replace(/^\/+|\/+$/g, '')
      // Group URL: prefix groups/
      if (/^groups\//i.test(cleaned)) return `https://www.facebook.com/${cleaned}`
      // Default: profile/page
      if (/^\d+$/.test(cleaned)) return `https://www.facebook.com/profile.php?id=${cleaned}`
      return `https://www.facebook.com/${cleaned}`
    },

    extractUidFromInput(raw: string): string {
      const trimmed = String(raw || '').trim()
      try {
        const url = new URL(trimmed)
        const idParam = url.searchParams.get('id')
        if (idParam) return idParam
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.length > 0) return parts[parts.length - 1]
      } catch {
        // Not a URL, return as-is
      }
      return trimmed
    },

    splitVariants(content: string | undefined | null): string[] {
      if (!content) return []
      if (!content.includes('|')) return [content]
      return content.split('|').map(s => s.trim()).filter(s => s.length > 0)
    },

    cycleVariant(variants: string[], index: number): string {
      if (!variants || variants.length === 0) return ''
      const safeIdx = ((index % variants.length) + variants.length) % variants.length
      return variants[safeIdx]
    },

    async element(name: string): Promise<string> {
      return await resolveXpathByName(name)
    },

    async elementWith(name: string, vars: Record<string, string | number>): Promise<string> {
      const tpl = await resolveXpathByName(name)
      return tpl.replace(/\$\{(\w+)\}/g, (_, k) => {
        const v = vars[k]
        return v === undefined ? '' : String(v)
      })
    }
  }
}
