import { DesktopSessionRejected, type DesktopSession } from './desktopSession'

interface AuthTokens {
  access_token: string
  refresh_token: string
  expires_at?: number
}
export interface DesktopSessionCredentials { username: string; password: string; fingerprintHash: string }

/** Auth HTTP calls originate on Desktop, preserving per-client IP rate limits.
 * No auth SDK state, extra DB client, write replay or anonymous data fallback. */
export function createDesktopSessionTransport(url: string, publicKey: string, send: typeof fetch = fetch) {
  async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
    const response = await send(url + path, { method: 'POST', signal,
      headers: { apikey: publicKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) throw new DesktopSessionRejected()
      throw new Error(response.status === 429
        ? 'Đăng nhập đang có nhiều yêu cầu. Vui lòng thử lại sau ít phút.'
        : 'Chưa kết nối được dịch vụ đăng nhập. Vui lòng thử lại.')
    }
    return await response.json() as T
  }
  const endpoint = <T>(body: Record<string, unknown>, signal: AbortSignal): Promise<T> =>
    post<T>('/functions/v1/aka-agent-desktop-session', body, signal)
  const tokens = (auth: AuthTokens, scope: Pick<DesktopSession, 'staffId' | 'organizationId'>): DesktopSession => {
    const claims = JSON.parse(Buffer.from(auth.access_token.split('.')[1], 'base64url').toString('utf8'))
    if (claims.role !== 'aka_agent_desktop' || typeof claims.session_id !== 'string'
      || typeof claims.exp !== 'number') throw new DesktopSessionRejected()
    return { accessToken: auth.access_token, refreshToken: auth.refresh_token, expiresAt: claims.exp,
      sessionId: claims.session_id, ...scope }
  }
  return {
    endpoint,
    async login(credentials: DesktopSessionCredentials, signal: AbortSignal): Promise<DesktopSession> {
      const challenge = await endpoint<{ tokenHash: string }>({ action: 'login', ...credentials }, signal)
      const auth = await post<AuthTokens>('/auth/v1/verify', { type: 'magiclink', token_hash: challenge.tokenHash }, signal)
      try {
        const scope = await endpoint<Pick<DesktopSession, 'staffId' | 'organizationId'>>({
          action: 'register', ...credentials, accessToken: auth.access_token
        }, signal)
        return tokens(auth, scope)
      } catch (error) {
        // Also closes a registration whose response was lost after DB commit.
        void endpoint({ action: 'logout', accessToken: auth.access_token }, AbortSignal.timeout(3_000)).catch(() => {})
        throw error
      }
    },
    async refresh(previous: DesktopSession, signal: AbortSignal): Promise<DesktopSession> {
      const auth = await post<AuthTokens>('/auth/v1/token?grant_type=refresh_token', {
        refresh_token: previous.refreshToken
      }, signal)
      return tokens(auth, { staffId: previous.staffId, organizationId: previous.organizationId })
    },
    revoke: (accessToken: string, signal: AbortSignal): Promise<unknown> => endpoint({ action: 'logout', accessToken }, signal)
  }
}
