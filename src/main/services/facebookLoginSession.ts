import { session, type Session, type WebContents } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { isFacebookHost, type FacebookCookie, type FacebookSecret, type FacebookSessionObservation } from '../../shared/facebookLogin'
import { loginFacebookWithRequests, type FacebookLoginProxy, type FacebookLoginProgress } from './facebookLoginRequest'
import { FACEBOOK_HOME, verifyFacebookSessionRequest } from './facebookSessionRequest'
import { withRequestDeadline } from './requestDeadline'
export { FACEBOOK_HOME, trustedFacebookUrl } from './facebookSessionRequest'

export async function readFacebookCookies(ses: Session): Promise<FacebookCookie[]> {
  return (await ses.cookies.get({})).filter(cookie => isFacebookHost((cookie.domain || '').replace(/^\./, '')))
    .map(({ name, value, domain, path, secure, httpOnly, expirationDate, sameSite, hostOnly }) => ({
      name, value, domain: domain || '.facebook.com', path: path || '/', secure: secure === true, httpOnly: httpOnly === true, expirationDate, sameSite, hostOnly
    }))
}
export function cookieFingerprint(cookies: FacebookCookie[]): string {
  return createHash('sha256').update(JSON.stringify(cookies.map(cookie => ({ ...cookie })).sort((a, b) =>
    `${a.domain}/${a.path}/${a.name}`.localeCompare(`${b.domain}/${b.path}/${b.name}`)))).digest('hex')
}
export function authFingerprint(cookies: FacebookCookie[]): string {
  return cookieFingerprint(cookies.filter(cookie => cookie.name === 'c_user' || cookie.name === 'xs'))
}
/** Session changes while a request is in flight invalidate all of its conclusions. */
export async function inspectFacebookSession(ses: Session, signal: AbortSignal, proxy?: FacebookLoginProxy | null): Promise<FacebookSessionObservation> {
  signal.throwIfAborted()
  const before = authFingerprint(await readFacebookCookies(ses))
  const observation = await verifyFacebookSessionRequest(ses, signal, proxy)
  signal.throwIfAborted()
  return before === authFingerprint(await readFacebookCookies(ses)) ? observation
    : { state: 'unknown', message: 'Cookie đã thay đổi trong lúc xác minh phiên.' }
}

/** Bound navigation without stopping a visible tab that the user may have taken over. */
export async function loadFacebookHome(wc: WebContents, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  try {
    await Promise.race([wc.loadURL(FACEBOOK_HOME), new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })])
    signal.throwIfAborted()
  } catch { signal.throwIfAborted(); throw new Error('Không tải được Facebook. Kiểm tra mạng hoặc proxy.') }
  finally { if (onAbort) signal.removeEventListener('abort', onAbort) }
}

export async function writeFacebookCookies(ses: Session, cookies: FacebookCookie[], signal: AbortSignal,
  beforeWrite?: (cookie: FacebookCookie) => void): Promise<void> {
  // Write identity last so an interrupted promotion does not announce a partially copied identity.
  const ordered = [...cookies].sort((a, b) => Number(a.name === 'c_user') - Number(b.name === 'c_user'))
  for (const cookie of ordered) {
    signal.throwIfAborted()
    const host = cookie.domain.replace(/^\./, '')
    if (!isFacebookHost(host) || !cookie.path.startsWith('/') || /[\r\n\u0000]/.test(cookie.name + cookie.value)) throw new Error('Cookie Facebook không hợp lệ.')
    if (cookie.expirationDate && cookie.expirationDate <= Date.now() / 1000) continue
    const details: Electron.CookiesSetDetails = {
      url: `https://${host}${cookie.path}`, name: cookie.name, value: cookie.value,
      ...(cookie.hostOnly ? {} : { domain: cookie.domain }), path: cookie.path,
      secure: cookie.secure, httpOnly: cookie.httpOnly, expirationDate: cookie.expirationDate, sameSite: cookie.sameSite
    }
    // Chromium refuses to overwrite an HttpOnly cookie with a script-readable
    // cookie. Retire that exact UID cookie first; never downgrade xs or other secrets.
    const replaceHttpOnlyUid = cookie.name === 'c_user' && !cookie.httpOnly &&
      (await ses.cookies.get({ name: 'c_user' })).some(previous => previous.httpOnly &&
        previous.domain?.replace(/^\./, '') === host && previous.path === cookie.path &&
        previous.hostOnly === !!cookie.hostOnly)
    signal.throwIfAborted()
    beforeWrite?.(cookie)
    if (replaceHttpOnlyUid) {
      await ses.cookies.set({ ...details, httpOnly: true, expirationDate: 1 })
      signal.throwIfAborted()
    }
    await ses.cookies.set(details)
  }
  signal.throwIfAborted()
  await ses.cookies.flushStore()
}

/** Cookie storage and HTTP only: no BrowserWindow or webContents is created. */
export class FacebookLoginSession {
  readonly partition: string
  constructor(readonly signal: AbortSignal, partition?: string) {
    signal.throwIfAborted()
    this.partition = partition || `facebook-login-${randomUUID()}`
  }
  get ses(): Session { return session.fromPartition(this.partition) }
  async dispose(): Promise<void> {
    if (!this.partition.startsWith('persist:')) {
      // This partition is unique to the finished attempt. A late native cleanup
      // cannot touch a visible browser or a later login, so it may finish separately.
      await withRequestDeadline(new AbortController().signal, () => this.ses.clearStorageData()).catch(() => {})
    }
  }
  async observe(proxy?: FacebookLoginProxy | null): Promise<FacebookSessionObservation> {
    return inspectFacebookSession(this.ses, this.signal, proxy)
  }
  async login(secret: FacebookSecret, proxy?: FacebookLoginProxy | null, lookupName = false,
    onProgress?: FacebookLoginProgress): Promise<FacebookSessionObservation> {
    this.signal.throwIfAborted()
    if (secret.cookies.length) {
      await writeFacebookCookies(this.ses, secret.cookies, this.signal)
      const observation = await this.observe(proxy)
      this.signal.throwIfAborted()
      if (observation.state === 'authenticated') return observation
      if (observation.state !== 'logged_out') throw new Error(observation.state === 'challenge'
        ? 'Cookie cần xác minh trên Facebook. Hãy đăng nhập thủ công.' : 'Chưa xác định được phiên Facebook; không thử mật khẩu khi mạng chưa ổn định.')
      if (!secret.password) throw new Error('Cookie đã hết phiên và chưa có mật khẩu để đăng nhập lại.')
      // Do not merge a rejected cookie session with the newly issued login session.
      // All callers authenticate in a temporary partition; persistent sessions are verification-only.
      // On timeout/abort, abandon this attempt before sending the password. Native
      // cleanup may finish later, but can only clear this attempt's temporary storage.
      await withRequestDeadline(this.signal, () => this.ses.clearStorageData())
      this.signal.throwIfAborted()
    }
    const nameController = new AbortController()
    try {
      const result = await loginFacebookWithRequests(this.ses, secret, this.signal, proxy, lookupName ? nameController.signal : undefined, onProgress)
      this.signal.throwIfAborted()
      onProgress?.('Đang xác minh phiên Facebook…')
      await writeFacebookCookies(this.ses, result.cookies, this.signal)
      const verified = await this.observe(proxy)
      this.signal.throwIfAborted()
      if (verified.state !== 'authenticated') throw new Error(verified.state === 'challenge'
        ? 'Facebook yêu cầu xác minh thêm. Hãy đăng nhập thủ công.'
        : `Chưa xác minh được cookie sau đăng nhập bằng request. ${verified.message || 'Chưa xác định được nguyên nhân.'}`)
      if (verified.uid !== secret.uid) throw new Error('Phiên Facebook trả về không khớp UID đã nhập.')
      // The optional name lookup runs alongside HTTP verification. Do not delay account
      // creation (or consume its remaining deadline) if Graph is slower than session verification.
      nameController.abort()
      const name = await result.name
      this.signal.throwIfAborted()
      return { ...verified, ...(name ? { name } : {}) }
    } finally { nameController.abort() }
  }
}
