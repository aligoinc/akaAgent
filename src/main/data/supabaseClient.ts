import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { RealtimeClientOptions } from '@supabase/realtime-js'
import * as dotenv from 'dotenv'
import { join } from 'path'
import WebSocket from 'ws'

dotenv.config({ path: join(process.cwd(), '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cgjbsmqtfhqvttudyjzq.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamJzbXF0ZmhxdnR0dWR5anpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxOTA0MzIsImV4cCI6MjA4MTc2NjQzMn0.UAukwYkUuoxWckoMUVgw0q1Eiptd9kGaPRddruf2ZOA'

let _client: SupabaseClient | null = null
let serverSecret: string | null = null
const realtimeTransport = WebSocket as unknown as NonNullable<RealtimeClientOptions['transport']>

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

function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: {
      transport: realtimeTransport
    }
  })
}

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    try {
      _client = createSupabaseClient(SUPABASE_URL, serverSecret ?? SUPABASE_ANON_KEY)
    } catch {
      if (serverSecret) throw new Error('Không khởi tạo được kết nối DB máy chủ.')
      console.error('Failed to initialize Supabase client')
      _client = createSupabaseClient('https://dummy.supabase.co', 'dummy')
    }
  }
  return _client
}

export function getSupabaseUrl(): string {
  return SUPABASE_URL
}
