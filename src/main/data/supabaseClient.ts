import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { RealtimeClientOptions } from '@supabase/realtime-js'
import * as dotenv from 'dotenv'
import { join } from 'path'
import WebSocket from 'ws'
import { DesktopSessionManager } from './desktopSession'
import { createDesktopSessionTransport } from './desktopSessionTransport'

dotenv.config({ path: join(process.cwd(), '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cgjbsmqtfhqvttudyjzq.supabase.co'
// This identifies the project only. Database access requires the user's login JWT.
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_cxvej8Ts6st_I5grW-bBuQ_tmfFtsaA'

let _client: SupabaseClient | null = null
let serverSecret: string | null = null
const realtimeTransport = WebSocket as unknown as NonNullable<RealtimeClientOptions['transport']>
const bootstrapRpcs = new Set(['aka_agent_staff_client', 'aka_agent_staff_access',
  'aka_agent_recover_staff_credentials', 'aka_agent_staff_security_status',
  'aka_agent_prepare_device_change', 'aka_agent_prepare_device_change_v2',
  'aka_agent_reset_device_binding', 'aka_agent_reset_device_binding_v2',
  'aka_agent_desktop_startup_policy', 'aka_agent_desktop_login_content'])

export const desktopSessionTransport = createDesktopSessionTransport(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
export const callDesktopSessionEndpoint = desktopSessionTransport.endpoint
export const desktopSession = new DesktopSessionManager(desktopSessionTransport.refresh, Date.now, desktopSessionTransport.revoke)

async function desktopFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.origin !== new URL(SUPABASE_URL).origin) throw new Error('Địa chỉ truy cập DB không hợp lệ.')
  const rpc = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.slice('/rest/v1/rpc/'.length) : ''
  const headers = new Headers(request.headers)
  if (bootstrapRpcs.has(rpc)) headers.delete('Authorization')
  else headers.set('Authorization', `Bearer ${await desktopSession.token(request.signal)}`)
  request.signal.throwIfAborted()
  // No retry/fallback: a failed/uncertain write is returned to its existing caller.
  return fetch(new Request(request, { headers }))
}

/** Called only by the trusted, centrally operated App Server entry point.
 * The secret is provisioned on that host or in its private Server installer;
 * never included in Desktop or returned over IPC. */
export function configureTrustedServerSupabase(secret: string): void {
  if (_client) throw new Error('Phải cấu hình quyền máy chủ trước khi khởi động dịch vụ.')
  let elevated = /^sb_secret_[A-Za-z0-9_-]+$/.test(secret)
  if (!elevated) {
    try {
      const claims = JSON.parse(Buffer.from(secret.split('.')[1] || '', 'base64url').toString('utf8'))
      elevated = claims.role === 'service_role' && secret.split('.').length === 3
    } catch { /* Invalid credential; never print its value. */ }
  }
  if (!elevated) throw new Error('Khóa Supabase máy chủ không hợp lệ.')
  serverSecret = secret
}

export function isTrustedServerSupabaseConfigured(): boolean { return serverSecret !== null }

function createSupabaseClient(url: string, apiKey: string): SupabaseClient {
  return createClient(url, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: serverSecret ? undefined : { fetch: desktopFetch },
    realtime: {
      transport: realtimeTransport
    }
  })
}

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    try {
      _client = createSupabaseClient(SUPABASE_URL, serverSecret ?? SUPABASE_PUBLISHABLE_KEY)
    } catch {
      if (serverSecret) throw new Error('Không khởi tạo được kết nối DB máy chủ.')
      console.error('Failed to initialize Supabase client')
      throw new Error('Không khởi tạo được kết nối dữ liệu Desktop.')
    }
  }
  return _client
}

export function getSupabaseUrl(): string {
  return SUPABASE_URL
}
