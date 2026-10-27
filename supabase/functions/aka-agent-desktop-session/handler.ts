import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.99.1'

class Rejected extends Error {}
class InvalidRequest extends Error {}
class RateLimited extends Error {}
function authError(error: { status?: number } | null): void {
  if (!error) return
  if (error.status === 429) throw new RateLimited()
  if (error.status && [400, 401, 403, 404, 422].includes(error.status)) throw new Rejected()
  throw new Error('auth_unavailable')
}

/** Issue a one-time Auth challenge and bind only server-verified Auth sessions.
 * Desktop calls managed Auth verify/refresh directly, avoiding shared Edge IP limits. */
export function createSessionHandler(admin: SupabaseClient) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return new Response('', { status: 405, headers })
    try {
      // Read at most 16 KiB; never log credentials, Auth errors, links or tokens.
      const reader = request.body?.getReader()
      if (!reader) throw new InvalidRequest()
      let size = 0, bodyText = ''
      const decoder = new TextDecoder()
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 16_384) { await reader.cancel(); return new Response('{}', { status: 413, headers }) }
        bodyText += decoder.decode(chunk.value, { stream: true })
      }
      bodyText += decoder.decode()
      let body
      try { body = JSON.parse(bodyText) } catch { throw new InvalidRequest() }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InvalidRequest()
      const action = body.action
      if (!['check', 'login', 'register', 'logout'].includes(action)) throw new InvalidRequest()
      const allowed = action === 'logout' ? ['action', 'accessToken'] : ['action', 'username', 'password', 'fingerprintHash', ...(action === 'register' ? ['accessToken'] : [])]
      if (Object.keys(body).some(key => !allowed.includes(key))) throw new InvalidRequest()
      const call = async (operation: string, data: Record<string, unknown>) => {
        const result = await admin.rpc('aka_agent_desktop_session_admin', { p_operation: operation, p_data: data })
          .abortSignal(AbortSignal.timeout(12_000))
        if (result.error) {
          if (result.error.code === 'P0001' && /^desktop_(auth|device|session)/.test(result.error.message)) throw new Rejected()
          throw new Error('auth_unavailable')
        }
        return result.data
      }
      if (action !== 'logout' && (typeof body.username !== 'string' || !body.username.trim() || body.username.length > 255
        || typeof body.password !== 'string' || !body.password || body.password.length > 1024
        || typeof body.fingerprintHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprintHash))) throw new InvalidRequest()
      const credentials = { username: body.username, password: body.password, fingerprintHash: body.fingerprintHash }
      if (action === 'check') return new Response(JSON.stringify(await call('check', credentials)), { headers })
      if (action === 'login') {
        let owner = await call('prepare', credentials)
        if (!owner.authUserId) {
          const email = `${crypto.randomUUID()}@desktop-session.akaagent.invalid`
          const created = await admin.auth.admin.createUser({ email, email_confirm: true, role: 'aka_agent_desktop',
            app_metadata: { provider: 'email', providers: ['email'], aka_agent_desktop: true } })
          authError(created.error)
          if (!created.data.user) throw new Error('auth_unavailable')
          // A failed response can follow a committed bind. Keep that identity so
          // a retry can reuse it, including when another login has already done so.
          owner = await call('bind_user', { ...credentials, authUserId: created.data.user.id })
          // Only a successful bind identifying a different canonical user proves
          // that this request's newly created sibling is unused and safe to delete.
          if (owner.authUserId && owner.authUserId !== created.data.user.id) await admin.auth.admin.deleteUser(created.data.user.id)
        }
        const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: owner.email })
        authError(link.error)
        if (!link.data.user || link.data.user.id !== owner.authUserId || link.data.user.role !== 'aka_agent_desktop'
          || !link.data.properties?.hashed_token) throw new Error('auth_unavailable')
        return new Response(JSON.stringify({ tokenHash: link.data.properties.hashed_token }), { headers })
      }
      if (typeof body.accessToken !== 'string' || !body.accessToken || body.accessToken.length > 8192) throw new InvalidRequest()
      const verified = await admin.auth.getUser(body.accessToken)
      authError(verified.error)
      if (verified.data.user?.role !== 'aka_agent_desktop') throw new Rejected()
      const claims = JSON.parse(atob(body.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (claims.sub !== verified.data.user.id || claims.role !== 'aka_agent_desktop'
        || typeof claims.session_id !== 'string') throw new Rejected()
      const identity = { authUserId: verified.data.user.id, sessionId: claims.session_id }
      if (action === 'logout') {
        // Managed Auth revokes refresh access. An already issued JWT remains valid
        // until expiry; this change deliberately adds no per-query session guards.
        const signedOut = await admin.auth.admin.signOut(body.accessToken, 'local')
        authError(signedOut.error)
        return new Response(JSON.stringify({ ok: true }), { headers })
      }
      const scope = await call('register_session', { ...credentials, ...identity })
      return new Response(JSON.stringify({ staffId: scope.staffId, organizationId: scope.organizationId }), { headers })
    } catch (error) {
      const status = error instanceof InvalidRequest ? 400 : error instanceof Rejected ? 401 : error instanceof RateLimited ? 429 : 503
      return new Response(JSON.stringify({ error: status === 503 || status === 429 ? 'Dịch vụ đăng nhập tạm thời chưa sẵn sàng.' : 'Không xác thực được phiên truy cập dữ liệu.' }), { status, headers })
    }
  }
}
