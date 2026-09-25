import { type Session } from 'electron'
import type { Agent } from 'node:http'
import type { Readable } from 'node:stream'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { withRequestDeadline } from './requestDeadline'
import { type FacebookSessionObservation } from '../../shared/facebookLogin'
import { type FacebookLoginProxy } from './facebookLoginRequest'

export const FACEBOOK_HOME = 'https://www.facebook.com/'
const MAX_BYTES = 8 * 1024 * 1024
type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonObject : undefined
const unknownSession = (message: string): FacebookSessionObservation => ({ state: 'unknown', message })

export function trustedFacebookUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com')) && !url.username && !url.password
  } catch { return false }
}

function routeState(url: string): FacebookSessionObservation | undefined {
  const path = new URL(url).pathname
  if (/^\/(checkpoint|challenge|two_step_verification|two_factor|recover|confirmemail)(\/|$)/.test(path))
    return { state: 'challenge', message: 'Facebook yêu cầu xác minh.' }
  if (/^\/login(?:\.php|\/|$)/.test(path)) return { state: 'logged_out' }
  return undefined
}

/** Parse server bootstrap JSON only. No DOM, selectors, script execution or public profile UID. */
export function parseFacebookSessionResponse(body: string, expectedUid?: string): FacebookSessionObservation {
  const modules = new Map<string, JsonObject[]>()
  let budget = 100_000, envelopes = 0
  const visit = (value: unknown, depth = 0): void => {
    if (--budget < 0 || depth > 40) throw new Error('Bootstrap too large')
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    const data = object(value)
    if (!data) return
    if (Array.isArray(data.define)) for (const entry of data.define) {
      if (!Array.isArray(entry) || !['CurrentUserInitialData', 'DTSGInitialData', 'SiteData'].includes(entry[0])) continue
      const payload = object(entry[2])
      if (payload) modules.set(entry[0], [...(modules.get(entry[0]) || []), payload])
    }
    for (const child of Object.values(data)) visit(child, depth + 1)
  }
  try {
    // Facebook emits data-sjs JSON envelopes in its HTTP response. Read the raw
    // text; never instantiate a browser/DOM or execute a returned script.
    for (const match of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/\bdata-sjs(?:\s|=|$)/i.test(match[1]) || !/\btype\s*=\s*["']application\/json["']/i.test(match[1])) continue
      envelopes++
      visit(JSON.parse(match[2]))
    }
    const users = modules.get('CurrentUserInitialData') || []
    if (!users.length) return unknownSession(envelopes
      ? 'Phản hồi HTTP thiếu dữ liệu CurrentUserInitialData.' : 'Phản hồi HTTP không có JSON bootstrap được hỗ trợ.')
    const identities = new Set(users.map(user => JSON.stringify([user.ACCOUNT_ID, user.USER_ID])))
    if (identities.size !== 1) return unknownSession('Phản hồi HTTP có dữ liệu danh tính mâu thuẫn.')
    const user = users[0]
    const hasDtsg = (modules.get('DTSGInitialData') || []).some(data => typeof data.token === 'string' && data.token.trim().length > 0)
    const loggedOutPackage = (modules.get('SiteData') || []).some(data => typeof data.pkg_cohort === 'string' && data.pkg_cohort.includes('comet_loggedout_pkg'))
    if (user.ACCOUNT_ID === '0' && user.USER_ID === '0' && !hasDtsg && loggedOutPackage)
      return { state: 'logged_out', message: 'Facebook trả về dữ liệu chưa đăng nhập.' }
    if (expectedUid && user.ACCOUNT_ID === expectedUid && typeof user.USER_ID === 'string' && /^\d{5,24}$/.test(user.USER_ID)
      && hasDtsg && !loggedOutPackage && !user.IS_DEACTIVATED_ALLOWED_ON_MESSENGER && !user.IS_MESSENGER_ONLY_USER)
      return { state: 'authenticated', uid: expectedUid }
    if (!expectedUid) return unknownSession('Cookie thiếu c_user hoặc xs để đối chiếu phiên.')
    if (user.ACCOUNT_ID !== expectedUid) return unknownSession('ACCOUNT_ID trong phản hồi HTTP không khớp cookie.')
    if (!hasDtsg) return unknownSession('Phản hồi HTTP thiếu token DTSG để xác minh phiên.')
    return unknownSession('Dữ liệu bootstrap chưa đáp ứng điều kiện xác minh phiên.')
  } catch { return unknownSession('Không đọc được JSON bootstrap trong phản hồi HTTP.') }
}

type Response = { status: number; body: string; redirect?: string }
async function requestPage(ses: Session, url: string, cookie: string, signal: AbortSignal, proxy?: FacebookLoginProxy | null): Promise<Response> {
  // node-fetch v3 is ESM-only; Electron's CommonJS main bundle must load it with import().
  const { default: fetch } = await import('node-fetch')
  signal.throwIfAborted()
  // Resolve the actual Chromium proxy (including system/PAC settings), then use
  // stateless HTTP so Set-Cookie and proxy-auth retries cannot alter the user's jar.
  const resolved = (await ses.resolveProxy(url)).split(';')[0].trim()
  signal.throwIfAborted()
  let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined
  if (resolved !== 'DIRECT') {
    const match = /^(PROXY|HTTPS|SOCKS|SOCKS5|SOCKS4)\s+(.+)$/.exec(resolved)
    if (!match) throw new Error('Không xác định được proxy Facebook.')
    const protocol = match[1] === 'HTTPS' ? 'https' : match[1] === 'PROXY' ? 'http' : match[1] === 'SOCKS4' ? 'socks4a' : 'socks5h'
    const address = new URL(`${protocol}://${match[2]}`)
    // URL removes default HTTP(S) ports; compare the effective endpoint so a
    // proxy on 80/443 still receives only its own partition's credentials.
    const port = Number(address.port || (protocol === 'https' ? 443 : protocol === 'http' ? 80 : 1080))
    const host = (value: string): string => value.trim().replace(/^\[|\]$/g, '').toLowerCase()
    if (proxy?.isActive !== false && proxy?.username && host(address.hostname) === host(proxy.host || '') && port === proxy.port) {
      address.username = proxy.username; address.password = proxy.password || ''
    }
    // Forward abort to the proxy's TCP/TLS socket as well: before CONNECT finishes,
    // the agent has not registered that socket, so fetch abort + agent.destroy is insufficient.
    agent = protocol.startsWith('socks') ? new SocksProxyAgent(address.href) : new HttpsProxyAgent(address, { keepAlive: false, signal })
  }
  try {
    signal.throwIfAborted()
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal, agent: agent as unknown as Agent | undefined, size: MAX_BYTES,
      // Keep node-fetch's own User-Agent for this HTTP client. Forwarding the
      // browser UA produced HTTP 400 even without cookies in live verification.
      headers: { Cookie: cookie, Accept: 'text/html', 'Cache-Control': 'no-cache' } })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      (response.body as Readable | null)?.destroy()
      return { status: response.status, body: '', redirect: new URL(location, url).href }
    }
    return { status: response.status, body: await response.text() }
  } finally { agent?.destroy() }
}

/** One bounded verification, using the partition's exact cookies/proxy, without changing its cookie jar. */
export async function verifyFacebookSessionRequest(ses: Session, signal: AbortSignal,
  proxy?: FacebookLoginProxy | null): Promise<FacebookSessionObservation> {
  signal.throwIfAborted()
  let requestSignal: AbortSignal | undefined
  try {
    return await withRequestDeadline(signal, async attempt => {
      requestSignal = attempt
      let url = FACEBOOK_HOME
      const initial = await ses.cookies.get({ url })
      attempt.throwIfAborted()
      const identities = new Set(initial.filter(cookie => cookie.name === 'c_user').map(cookie => cookie.value))
      if (identities.size > 1) return unknownSession('Cookie chứa nhiều c_user khác nhau.')
      const uid = [...identities][0]
      const xs = initial.find(cookie => cookie.name === 'xs')?.value
      if (!uid && !xs) return { state: 'logged_out', message: 'Không có cookie c_user và xs trong phiên kiểm tra.' }
      for (let redirects = 0; redirects < 5; redirects++) {
        attempt.throwIfAborted()
        const cookies = await ses.cookies.get({ url })
        if (cookies.some(cookie => /[\r\n\u0000]/.test(cookie.name + cookie.value))) return unknownSession('Cookie chứa ký tự không hợp lệ.')
        const response = await requestPage(ses, url, cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), attempt, proxy)
        attempt.throwIfAborted()
        if (response.redirect) {
          if (!trustedFacebookUrl(response.redirect)) return unknownSession('Facebook chuyển hướng ra ngoài địa chỉ HTTPS được phép.')
          const state = routeState(response.redirect)
          if (state) return state.state === 'logged_out' ? { ...state, message: 'Facebook chuyển hướng về trang đăng nhập.' } : state
          url = response.redirect; continue
        }
        if (response.status !== 200) return unknownSession(`Yêu cầu xác minh trả HTTP ${response.status}.`)
        return parseFacebookSessionResponse(response.body, uid && xs ? uid : undefined)
      }
      return unknownSession('Yêu cầu xác minh vượt giới hạn 5 lần tải/chuyển hướng.')
    }, 30_000)
  } catch (error) {
    signal.throwIfAborted()
    if (requestSignal?.aborted) return unknownSession('Yêu cầu xác minh quá thời gian chờ 30 giây.')
    // Only fixed messages / allowlisted codes escape; HTTP bodies, URLs and
    // transport error messages may contain cookie values or proxy credentials.
    const data = object(error)
    if (data?.type === 'max-size') return unknownSession('Phản hồi xác minh vượt giới hạn 8 MiB.')
    if (['ERR_REQUIRE_ESM', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(String(data?.code)))
      return unknownSession('Không tải được thư viện HTTP để xác minh phiên.')
    if (data?.code === 'ERR_TLS_CERT_ALTNAME_INVALID') return unknownSession('Chứng chỉ TLS không khớp máy chủ xác minh.')
    const code = typeof data?.code === 'string' && [
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPROTO',
      'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT'
    ].includes(data.code) ? data.code : undefined
    return unknownSession(`Lỗi kết nối hoặc đọc phản hồi xác minh${code ? ` (${code})` : ''}.`)
  }
}
