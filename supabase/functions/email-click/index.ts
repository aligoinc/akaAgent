import { createClient } from 'jsr:@supabase/supabase-js@2'

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate'
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function isSafeRedirectUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const supabase = createClient(
  getRequiredEnv('SUPABASE_URL'),
  getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'GET') return jsonResponse(405, { ok: false, error: 'Method not allowed' })

  try {
    const token = new URL(req.url).searchParams.get('t')?.trim()
    if (!token) return jsonResponse(404, { ok: false, error: 'Link không hợp lệ' })

    const { data, error } = await supabase.rpc('aka_agent_mark_email_click', {
      p_click_token: token,
      p_user_agent: req.headers.get('user-agent') || ''
    })
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data
    const originalUrl = row && typeof row === 'object' ? (row as Record<string, unknown>).original_url : null
    const ok = row && typeof row === 'object' ? (row as Record<string, unknown>).ok === true : false
    if (!ok || !isSafeRedirectUrl(originalUrl)) {
      return jsonResponse(404, { ok: false, error: 'Link không hợp lệ' })
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: originalUrl,
        'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate'
      }
    })
  } catch (err) {
    console.warn('[email-click] failed to mark click:', err)
    return jsonResponse(500, { ok: false, error: 'Không thể mở link' })
  }
})
