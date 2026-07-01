import { createClient } from 'jsr:@supabase/supabase-js@2'

const transparentPng = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
])

const imageHeaders = {
  'Content-Type': 'image/png',
  'Content-Length': String(transparentPng.byteLength),
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function imageResponse(): Response {
  return new Response(transparentPng, { status: 200, headers: imageHeaders })
}

const supabase = createClient(
  getRequiredEnv('SUPABASE_URL'),
  getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'GET') return imageResponse()

  try {
    const token = new URL(req.url).searchParams.get('t')?.trim()
    if (token) {
      await supabase.rpc('aka_agent_mark_email_open', {
        p_open_token: token,
        p_user_agent: req.headers.get('user-agent') || ''
      })
    }
  } catch (err) {
    console.warn('[email-open] failed to mark open:', err)
  }

  return imageResponse()
})
