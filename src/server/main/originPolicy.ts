import { isIP } from 'net'

export interface WildcardOriginRule {
  protocol: 'http:' | 'https:'
  hostnameSuffix: string
  port: string
}

export interface OriginPolicy {
  allowAny: boolean
  exactOrigins: ReadonlySet<string>
  wildcardOrigins: readonly WildcardOriginRule[]
  invalidEntries: readonly string[]
  configured: boolean
}

const WILDCARD_HOST_MARKER = 'akaagent-origin-wildcard'

export const DEFAULT_REALTIME_ALLOWED_ORIGINS = [
  'https://aka-agent-web-app.vercel.app',
  'https://*.akabiz.net'
] as const

function parseStrictHttpUrl(value: string): URL | null {
  const normalized = value.trim()
  if (
    !normalized ||
    normalized === 'null' ||
    normalized.includes('\\') ||
    !/^https?:\/\/[^/?#]+\/?$/i.test(normalized)
  ) {
    return null
  }
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

export function normalizeHttpOrigin(value: string | null | undefined): string | null {
  const url = parseStrictHttpUrl(String(value || ''))
  if (!url || url.hostname.includes('*')) return null
  return url.origin
}

export function compileOriginPolicy(
  value: string | readonly string[] | null | undefined
): OriginPolicy {
  const entries = Array.isArray(value) ? value : String(value || '').split(',')
  const exactOrigins = new Set<string>()
  const wildcardOrigins: WildcardOriginRule[] = []
  const wildcardKeys = new Set<string>()
  const invalidEntries: string[] = []
  let allowAny = false

  for (const entry of entries) {
    const candidate = String(entry || '').trim()
    if (!candidate) continue
    if (candidate === '*') {
      allowAny = true
      continue
    }

    const wildcardMatch = candidate.match(/^(https?):\/\/\*\.(.+)$/i)
    if (wildcardMatch) {
      const [, scheme, remainder] = wildcardMatch
      const url = parseStrictHttpUrl(`${scheme}://${WILDCARD_HOST_MARKER}.${remainder}`)
      const markerPrefix = `${WILDCARD_HOST_MARKER}.`
      const hostnameSuffix = url?.hostname.startsWith(markerPrefix)
        ? url.hostname.slice(markerPrefix.length)
        : ''
      if (
        !url ||
        !hostnameSuffix ||
        hostnameSuffix.includes('*') ||
        hostnameSuffix.startsWith('.') ||
        hostnameSuffix.endsWith('.') ||
        hostnameSuffix.includes('..') ||
        isIP(hostnameSuffix) !== 0
      ) {
        invalidEntries.push(candidate)
        continue
      }
      const rule: WildcardOriginRule = {
        protocol: url.protocol as 'http:' | 'https:',
        hostnameSuffix,
        port: url.port
      }
      const key = `${rule.protocol}//*.${rule.hostnameSuffix}:${rule.port}`
      if (!wildcardKeys.has(key)) {
        wildcardKeys.add(key)
        wildcardOrigins.push(rule)
      }
      continue
    }

    const origin = normalizeHttpOrigin(candidate)
    if (!origin) {
      invalidEntries.push(candidate)
      continue
    }
    exactOrigins.add(origin)
  }

  return {
    allowAny,
    exactOrigins,
    wildcardOrigins,
    invalidEntries,
    configured: allowAny || exactOrigins.size > 0 || wildcardOrigins.length > 0
  }
}

export function isOriginAllowed(
  policy: OriginPolicy,
  value: string | null | undefined
): boolean {
  const origin = normalizeHttpOrigin(value)
  if (!origin) return false
  if (policy.allowAny || policy.exactOrigins.has(origin)) return true

  const url = new URL(origin)
  return policy.wildcardOrigins.some(rule => (
    url.protocol === rule.protocol &&
    url.port === rule.port &&
    url.hostname.length > rule.hostnameSuffix.length + 1 &&
    url.hostname.endsWith(`.${rule.hostnameSuffix}`)
  ))
}
