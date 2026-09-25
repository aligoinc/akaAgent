import { net, type Session } from 'electron'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { isFacebookHost, type FacebookCookie, type FacebookSecret } from '../../shared/facebookLogin'
import { facebookTotp } from './facebookTotp'
import { encryptFacebookPassword } from './facebookPasswordEncryption'

// Android Messenger protocol fields documented by mautrix/facebook's
// maufbapi/http/login.py and state.py. Keep app identity, password envelope and
// request signing together; do not mix in the former raw-password FB4A profile.
// This is an undocumented login protocol, not the public Facebook Login OAuth API.
const AUTH_URL = 'https://b-graph.facebook.com/auth/login'
const KEY_URL = 'https://graph.facebook.com/pwd_key_fetch'
const APPROVAL_URL = 'https://graph.facebook.com/check_approved_machine'
const NAME_URL = 'https://graph.facebook.com/me?fields=id,name'
const REQUEST_TIMEOUT = 45_000
const APPROVAL_TIMEOUT = 60_000
const APPROVAL_INTERVAL = 5_000
const APPROVAL_MAX_CHECKS = 12
const NAME_TIMEOUT = 10_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const TWO_FACTOR_SUBCODES = new Set([1348162, 1348023])
// Public first-party app identity from the protocol reference, not a user token.
const APP_ID = '256002347743983'
const APP_SECRET = '374e60f8b9bb6b8cbb30f78030438895'
const APP_TOKEN = `${APP_ID}|${APP_SECRET}`
const USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 12; Pixel 3 Build/SP1A.210812.016.C2) '
  + '[FBAN/Orca-Android;FBAV/412.0.0.15.69;FBPN/com.facebook.orca;FBLC/en_US;'
  + 'FBBV/481775700;FBCR/Verizon;FBMF/Google;FBBD/google;FBDV/Pixel 3;FBSV/12;'
  + 'FBCA/arm64-v8a:null;FBDM/{density=2.75,width=1080,height=2028};]'

export interface FacebookLoginProxy {
  host: string; port: number; username?: string | null; password?: string | null; isActive?: boolean
}
export interface FacebookRequestLoginResult {
  cookies: FacebookCookie[]
  // Main-only, settles to undefined on any lookup failure; never exposes the token.
  name?: Promise<string | undefined>
}
type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonObject : undefined
const invalidResponse = (): Error => new Error('Phản hồi đăng nhập Facebook không hợp lệ. Hãy thử lại hoặc đăng nhập thủ công.')
type LoginPhase = 'password' | 'two_factor' | 'approval'
export type FacebookLoginProgress = (message: string) => void

function loginRejection(payload: JsonObject, phase: LoginPhase, expectedUid: string): Error {
  const error = object(payload.error)
  const code = (value: unknown): number | undefined => {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,10}$/.test(value))) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647 ? parsed : undefined
  }
  // Diagnostic codes only. Facebook's free-form messages/error_data may echo
  // credentials, tokens or challenge URLs and must not cross into UI or logs.
  const errorCode = code(error?.code ?? payload.error_code)
  const subcode = code(error?.error_subcode ?? payload.error_subcode)
  const details = [
    ['code', errorCode],
    ['subcode', subcode]
  ].filter(([, value]) => value !== undefined).map(([name, value]) => `${name}=${value}`).join(', ')
  let raw = error?.error_data
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = undefined } }
  const data = object(raw)
  const present = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0 && value.length <= 8192
  const uid = data?.uid ?? data?.userid ?? data?.user_id
  // Local diagnostics describe only the shape of the rejected response. They do
  // not assert that a 401 is an approval challenge or reveal any challenge values.
  // Keep the error terminal until a supported continuation is actually verified.
  console.info('[FacebookLogin] Rejected request metadata', {
    phase, code: errorCode ?? null, subcode: subcode ?? null,
    hasErrorData: !!data,
    uid: uid == null ? 'missing' : (typeof uid === 'string' || typeof uid === 'number') && String(uid) === expectedUid ? 'match' : 'mismatch',
    hasFirstFactor: present(data?.login_first_factor ?? data?.first_factor ?? data?.first_factor_id),
    hasMachineId: present(data?.machine_id),
    hasApprovalToken: present(data?.auth_token),
    hasSessionCookies: Array.isArray(payload.session_cookies) && payload.session_cookies.length > 0
  })
  return new Error(`Facebook chưa chấp nhận bước ${phase === 'password' ? 'mật khẩu' : phase === 'approval' ? 'phê duyệt' : '2FA'}${details ? ` (${details})` : ' (không có mã lỗi hợp lệ)'}. Kiểm tra thông tin hoặc đăng nhập thủ công để xác minh.`)
}

/** Only the temporary partition's proxy is used. No cookies or response payload are logged. */
function requestJson(ses: Session, input: { url: string; method: 'GET' | 'POST'; headers: Record<string, string>;
  body?: string; timeoutMs: number; maxBytes?: number }, signal: AbortSignal, proxy?: FacebookLoginProxy | null): Promise<JsonObject> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = net.request({ url: input.url, method: input.method, session: ses, redirect: 'error',
      useSessionCookies: false, headers: input.headers })
    let finished = false, size = 0, proxyAttempts = 0
    const chunks: Buffer[] = []
    const finish = (error?: Error, result?: JsonObject): void => {
      if (finished) return
      finished = true
      clearTimeout(timer); signal.removeEventListener('abort', onAbort)
      chunks.length = 0
      if (error) { reject(error); request.abort() } else resolve(result!)
    }
    const onAbort = (): void => finish(new Error('Đã hủy đăng nhập Facebook.'))
    const timer = setTimeout(() => finish(new Error('Đăng nhập Facebook quá thời gian chờ. Kiểm tra mạng hoặc proxy.')), input.timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    request.on('login', (authInfo, callback) => {
      // Session.fetch cannot handle this event. Scope credentials to this request,
      // including when different accounts share a proxy host with different users.
      if (!finished && !signal.aborted && ++proxyAttempts === 1 && proxy?.isActive !== false && proxy?.username
        && authInfo.isProxy && authInfo.host === proxy.host && authInfo.port === proxy.port) callback(proxy.username, proxy.password || '')
      else callback()
    })
    request.on('error', () => finish(new Error('Không kết nối được Facebook. Kiểm tra mạng hoặc proxy.')))
    request.on('abort', () => finish(new Error('Đã hủy đăng nhập Facebook.')))
    request.on('response', response => {
      response.on('error', () => finish(new Error('Không đọc được phản hồi đăng nhập Facebook.')))
      response.on('aborted', () => finish(new Error('Kết nối đăng nhập Facebook bị ngắt. Hãy thử lại.')))
      response.on('data', chunk => {
        if (finished) return
        size += chunk.length
        if (size > (input.maxBytes ?? MAX_RESPONSE_BYTES)) { finish(invalidResponse()); return }
        chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => {
        if (finished) return
        if (signal.aborted) { onAbort(); return }
        if (response.statusCode === 429) { finish(new Error('Facebook đang giới hạn đăng nhập. Hãy thử lại sau.')); return }
        // Facebook can return structured authentication errors with HTTP 400/401.
        if (response.statusCode >= 500 || response.statusCode < 200 || (response.statusCode >= 300 && response.statusCode < 400)) {
          finish(new Error('Facebook chưa xử lý được yêu cầu đăng nhập. Hãy thử lại sau.')); return
        }
        try {
          const payload = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          if (!payload || (response.statusCode >= 400 && !object(payload.error))) { finish(invalidResponse()); return }
          finish(undefined, payload)
        } catch { finish(invalidResponse()) }
      })
    })
    if (signal.aborted) { onAbort(); return }
    try { request.end(input.body) } catch { finish(new Error('Không gửi được yêu cầu đăng nhập Facebook.')) }
  })
}

function requestAndroid(ses: Session, url: string, form: URLSearchParams, signal: AbortSignal,
  proxy?: FacebookLoginProxy | null): Promise<JsonObject> {
  return requestJson(ses, { url, method: 'POST', body: form.toString(), timeoutMs: REQUEST_TIMEOUT,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT,
      'X-Fb-Connection-Type': 'WIFI', 'X-Fb-Connection-Quality': 'EXCELLENT',
      'X-Fb-Server-Cluster': 'True', 'X-Fb-Friendly-Name': form.get('fb_api_req_friendly_name') || 'authenticate',
      Authorization: 'OAuth null' } }, signal, proxy)
}

function requestLogin(ses: Session, form: URLSearchParams, signal: AbortSignal, proxy?: FacebookLoginProxy | null): Promise<JsonObject> {
  const body = new URLSearchParams(form)
  body.delete('sig'); body.delete('access_token'); body.sort()
  const signature = [...body].map(([key, value]) => `${key}=${value}`).join('') + APP_SECRET
  body.set('sig', createHash('md5').update(signature, 'utf8').digest('hex'))
  body.set('access_token', APP_TOKEN)
  return requestAndroid(ses, AUTH_URL, body, signal, proxy)
}

/** One optional request, using the user token from this login only. Never persist it. */
async function requestFacebookName(ses: Session, token: unknown, signal: AbortSignal,
  proxy?: FacebookLoginProxy | null): Promise<string | undefined> {
  if (typeof token !== 'string' || !token || token.length > 8192 || !/^[\x21-\x7e]+$/.test(token)) return undefined
  try {
    const payload = await requestJson(ses, { url: NAME_URL, method: 'GET', timeoutMs: NAME_TIMEOUT, maxBytes: 64 * 1024,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, signal, proxy)
    // Graph IDs can be app-scoped. The name is display-only; cookies/browser still
    // establish the actual account UID and whether login succeeded.
    if (signal.aborted || payload.error != null || payload.error_code != null || typeof payload.name !== 'string'
      || /[\u0000-\u001f\u007f]/.test(payload.name)) return undefined
    return payload.name.trim().slice(0, 200) || undefined
  } catch { return undefined }
}

function readSessionCookies(payload: JsonObject, uid: string): FacebookCookie[] {
  if (!Array.isArray(payload.session_cookies) || !payload.session_cookies.length || payload.session_cookies.length > 128) throw invalidResponse()
  if (payload.uid != null && String(payload.uid) !== uid) throw new Error('Phiên Facebook trả về không khớp UID đã nhập.')
  const names = new Set<string>()
  const cookies = payload.session_cookies.map(value => {
    const cookie = object(value)
    if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') throw invalidResponse()
    const { name } = cookie, domain = typeof cookie.domain === 'string' ? cookie.domain : '.facebook.com'
    const path = typeof cookie.path === 'string' ? cookie.path : '/'
    if (!/^[\w-]+$/.test(name) || names.has(name) || /[\r\n\u0000]/.test(cookie.value)
      || !isFacebookHost(domain.replace(/^\./, '')) || !path.startsWith('/') || /[\r\n\u0000]/.test(path)) throw invalidResponse()
    names.add(name)
    const expires = typeof cookie.expires === 'string' ? Date.parse(cookie.expires) / 1000 : NaN
    const expirationDate = typeof cookie.expirationDate === 'number' ? cookie.expirationDate : expires
    if (Number.isFinite(expirationDate) && expirationDate <= Date.now() / 1000) throw invalidResponse()
    return { name, value: cookie.value, domain, path, secure: true,
      httpOnly: name === 'xs' || name === 'c_user' || cookie.httponly === true || cookie.httpOnly === true,
      ...(Number.isFinite(expirationDate) ? { expirationDate } : {}) }
  })
  const identity = cookies.find(cookie => cookie.name === 'c_user'), xs = cookies.find(cookie => cookie.name === 'xs')
  if (identity?.value !== uid) throw new Error('Phiên Facebook trả về không khớp UID đã nhập.')
  if (!xs?.value || [identity, xs].some(cookie => cookie.path !== '/' || cookie.domain.replace(/^\./, '') !== 'facebook.com')) throw invalidResponse()
  return cookies
}

interface LoginChallenge { firstFactor?: string; machineId?: string; approvalToken?: string }
function twoFactorMetadata(payload: JsonObject, uid: string, phase: LoginPhase, previous?: LoginChallenge): LoginChallenge | null {
  const error = object(payload.error)
  if (!error) {
    if (payload.error != null || payload.error_code != null) throw loginRejection(payload, phase, uid)
    return null
  }
  if (!TWO_FACTOR_SUBCODES.has(Number(error.error_subcode)) && Number(error.code) !== 406) {
    throw loginRejection(payload, phase, uid)
  }
  let raw = error.error_data
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { throw invalidResponse() } }
  const data = object(raw)
  // An OTP rejection can omit the first-factor metadata already issued by the
  // password request. Reuse it only in this same, previously validated attempt.
  const returnedUid = String(data?.uid ?? data?.userid ?? data?.user_id ?? (previous ? uid : ''))
  if (returnedUid !== uid) throw new Error('Yêu cầu xác thực Facebook không khớp UID đã nhập.')
  const field = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) throw invalidResponse()
    return value
  }
  const firstFactor = field(data?.login_first_factor ?? data?.first_factor ?? data?.first_factor_id ?? previous?.firstFactor)
  const machineId = field(data?.machine_id ?? previous?.machineId)
  // Never attach an earlier approval token to a different server-issued machine.
  const approvalToken = field(data?.auth_token ?? (machineId === previous?.machineId ? previous?.approvalToken : undefined))
  if (!firstFactor && !(machineId && approvalToken)) throw invalidResponse()
  return { firstFactor, machineId, approvalToken }
}

async function waitForApproval(ses: Session, form: URLSearchParams, challenge: LoginChallenge, uid: string,
  signal: AbortSignal, proxy?: FacebookLoginProxy | null, onProgress?: FacebookLoginProgress): Promise<JsonObject> {
  if (!challenge.machineId || !challenge.approvalToken) throw invalidResponse()
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), APPROVAL_TIMEOUT)
  const waiting = AbortSignal.any([signal, deadline.signal])
  const expired = (): Error => new Error('Chưa nhận được phê duyệt Facebook trong thời gian chờ. Hãy thử lại hoặc đăng nhập thủ công.')
  try {
    onProgress?.('Đang chờ bạn phê duyệt thông báo đăng nhập trên thiết bị khác (tối đa 60 giây)…')
    for (let check = 0; check < APPROVAL_MAX_CHECKS; check++) {
      if (check > 0) await delay(APPROVAL_INTERVAL, undefined, { signal: waiting })
      waiting.throwIfAborted()
      const result = await requestAndroid(ses, APPROVAL_URL, new URLSearchParams({
        u: uid, m: challenge.machineId, locale: 'en_US', client_country_code: 'US', method: 'GET',
        fb_api_req_friendly_name: 'checkApprovedMachine', fb_api_caller_class: 'TwoFacServiceHandler', access_token: APP_TOKEN
      }), waiting, proxy)
      waiting.throwIfAborted()
      if (result.error != null || result.error_code != null) throw loginRejection(result, 'approval', uid)
      const approved = Array.isArray(result.data) && result.data.length === 1 ? object(result.data[0])?.approved : undefined
      if (typeof approved !== 'boolean') throw invalidResponse()
      if (!approved) continue
      // Approval itself is not a login. Exchange exactly once, then validate the
      // returned cookies and HTTP session through the existing caller.
      onProgress?.('Đã nhận phê duyệt. Đang hoàn tất đăng nhập…')
      const exchange = new URLSearchParams(form)
      for (const key of ['twofactor_code', 'first_factor', 'userid', 'sim_serials']) exchange.delete(key)
      exchange.set('credentials_type', 'transient_token'); exchange.set('password', challenge.approvalToken)
      exchange.set('email', uid); exchange.set('machine_id', challenge.machineId)
      const payload = await requestLogin(ses, exchange, waiting, proxy)
      waiting.throwIfAborted()
      if (payload.error != null || payload.error_code != null) throw loginRejection(payload, 'approval', uid)
      return payload
    }
    throw expired()
  } catch (error) {
    if (signal.aborted) throw new Error('Đã hủy đăng nhập Facebook.')
    if (deadline.signal.aborted) throw expired()
    throw error
  } finally { clearTimeout(timer) }
}

/** One password-key refresh only on the explicit server response; at most two distinct OTP windows. */
export async function loginFacebookWithRequests(ses: Session, secret: FacebookSecret, signal: AbortSignal,
  proxy?: FacebookLoginProxy | null, nameSignal?: AbortSignal, onProgress?: FacebookLoginProgress): Promise<FacebookRequestLoginResult> {
  signal.throwIfAborted()
  if (!secret.password) throw new Error('Chưa có mật khẩu để đăng nhập Facebook bằng request.')
  const deviceId = randomUUID()
  onProgress?.('Đang chuẩn bị đăng nhập Facebook…')
  const key = await requestAndroid(ses, KEY_URL, new URLSearchParams({
    device_id: deviceId, version: '2', flow: 'CONTROLLER_INITIALIZATION', method: 'GET', format: 'json',
    locale: 'en_US', client_country_code: 'US', fb_api_req_friendly_name: 'pwdKeyFetch',
    fb_api_caller_class: 'AuthOperations', access_token: APP_TOKEN
  }), signal, proxy)
  signal.throwIfAborted()
  if (key.error != null || key.error_code != null) throw new Error('Không lấy được khóa mã hóa đăng nhập Facebook. Hãy thử lại sau.')
  const encryptedPassword = encryptFacebookPassword(secret.password, key.key_id, key.public_key)
  const form = new URLSearchParams({
    adid: randomBytes(8).toString('hex'), format: 'json', device_id: deviceId, email: secret.uid, password: encryptedPassword,
    generate_analytics_claim: '1', community_id: '', cpl: 'true', try_num: '1',
    secure_family_device_id: '', credentials_type: 'password', enroll_misauth: 'false', generate_session_cookies: '1',
    generate_machine_id: '1', source: 'login', meta_inf_fbmeta: 'NO_FILE',
    currently_logged_in_userid: '0', locale: 'en_US', client_country_code: 'US',
    fb_api_req_friendly_name: 'authenticate', fb_api_caller_class: 'AuthOperations$PasswordAuthOperation',
    jazoest: `2${[...deviceId].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`, api_key: APP_ID
  })
  onProgress?.('Đang gửi yêu cầu đăng nhập Facebook…')
  let payload = await requestLogin(ses, form, signal, proxy)
  signal.throwIfAborted()
  // Observed with real accounts: pwd_key_fetch can return a key that auth/login
  // rejects with 418/2779001 and a replacement pwd_enc_key_pkg. Re-encrypt once
  // in this same attempt/device, never retry arbitrary password or network errors.
  const rejection = object(payload.error)
  if (Number(rejection?.code) === 418 && Number(rejection?.error_subcode) === 2779001) {
    let raw = rejection?.error_data
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { throw invalidResponse() } }
    const data = object(raw)
    let rawKey = data?.pwd_enc_key_pkg
    if (typeof rawKey === 'string') { try { rawKey = JSON.parse(rawKey) } catch { throw invalidResponse() } }
    const replacement = object(rawKey)
    if (replacement && (replacement.public_key !== key.public_key || Number(replacement.key_id) !== Number(key.key_id))) {
      const returnedUid = data?.uid ?? data?.userid ?? data?.user_id
      if (returnedUid != null && String(returnedUid) !== secret.uid) throw new Error('Yêu cầu xác thực Facebook không khớp UID đã nhập.')
      const ttl = replacement.seconds_to_live, machineId = data?.machine_id
      if ((ttl != null && (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0))
        || (machineId != null && (typeof machineId !== 'string' || !machineId.trim() || machineId.length > 8192
          || /[\u0000-\u001f\u007f]/.test(machineId)))) throw invalidResponse()
      // The encryption helper validates the replacement key and never falls back
      // to plaintext. Both requests share the caller's original deadline/signal.
      form.set('password', encryptFacebookPassword(secret.password, replacement.key_id, replacement.public_key))
      if (typeof machineId === 'string') form.set('machine_id', machineId)
      onProgress?.('Đang cập nhật khóa mã hóa đăng nhập Facebook…')
      signal.throwIfAborted()
      payload = await requestLogin(ses, form, signal, proxy)
      signal.throwIfAborted()
    }
  }
  let metadata = twoFactorMetadata(payload, secret.uid, 'password')
  let previousWindow = -1
  for (let attempt = 0; metadata && secret.twoFactorSecret && metadata.firstFactor && attempt < 2; attempt++) {
    onProgress?.('Đang xác thực bằng mã 2FA…')
    // Wait only after an explicit 2FA response; never retry transport failures or checkpoint.
    const now = Date.now()
    if (Math.floor(now / 30_000) === previousWindow || now % 30_000 > 27_000) await delay(30_000 - now % 30_000 + 100, undefined, { signal })
    signal.throwIfAborted()
    const time = Date.now(), otp = facebookTotp(secret.twoFactorSecret, time)
    previousWindow = Math.floor(time / 30_000)
    form.set('credentials_type', 'two_factor'); form.set('try_num', String(attempt + 2))
    form.set('password', otp); form.set('twofactor_code', otp); form.set('userid', secret.uid)
    form.set('first_factor', metadata.firstFactor); form.set('sim_serials', '[]')
    if (metadata.machineId) form.set('machine_id', metadata.machineId)
    payload = await requestLogin(ses, form, signal, proxy)
    signal.throwIfAborted()
    metadata = twoFactorMetadata(payload, secret.uid, 'two_factor', metadata)
  }
  if (metadata) {
    if (metadata.machineId && metadata.approvalToken) payload = await waitForApproval(ses, form, metadata, secret.uid, signal, proxy, onProgress)
    else throw new Error(secret.twoFactorSecret ? 'Facebook chưa chấp nhận mã 2FA. Kiểm tra khóa 2FA và giờ trên máy.'
      : 'Facebook yêu cầu mã 2FA nhưng tài khoản chưa có khóa 2FA; phản hồi không đủ dữ liệu để chờ phê duyệt.')
  }
  signal.throwIfAborted()
  const cookies = readSessionCookies(payload, secret.uid)
  return { cookies, ...(nameSignal ? { name: requestFacebookName(ses, payload.access_token,
    AbortSignal.any([signal, nameSignal]), proxy) } : {}) }
}
