import { createClient } from 'jsr:@supabase/supabase-js@2'
import { createAiChatAgentHandler } from './handler.ts'

// Nội bộ, mở theo yêu cầu: verify_jwt = false và không cần header nào.
// Muốn khóa lại: `supabase secrets set AI_CHAT_AGENT_KEY=<chuỗi bí mật>`, khi đó mọi lời gọi phải gửi x-agent-key.
const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Tiền tố URL của ảnh câu hỏi trong kho media: <media.storage.public_base_url>/<media.storage.key_prefix>/ai-chat/.
// Đọc từ auto_system_settings (cùng cấu hình với thư viện media), giữ 5 phút.
const IMAGE_PREFIX_TTL_MS = 5 * 60_000
let imagePrefix: { value: string; at: number } | null = null
async function imageStorePrefix(): Promise<string> {
  if (imagePrefix && Date.now() - imagePrefix.at < IMAGE_PREFIX_TTL_MS) return imagePrefix.value
  const { data, error } = await supabase.from('auto_system_settings').select('key,value')
    .in('key', ['media.storage.public_base_url', 'media.storage.key_prefix']).eq('is_active', true)
  if (error) throw new Error(error.message)
  const settings = new Map((data ?? []).map((row) => [String(row.key), String(row.value ?? '')]))
  const base = (settings.get('media.storage.public_base_url') ?? '').trim().replace(/\/+$/, '')
  const keyPrefix = (settings.get('media.storage.key_prefix') ?? '').trim().replace(/^\/+|\/+$/g, '')
  // Kho chưa cấu hình: chuỗi rỗng, /image chỉ chuyển hướng tới URL của ảnh.
  const value = base === '' ? '' : `${[base, keyPrefix, 'ai-chat'].filter(Boolean).join('/')}/`
  imagePrefix = { value, at: Date.now() }
  return value
}

async function downloadStoredImage(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
  if (response.status === 404) { await response.body?.cancel(); return null }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`media store HTTP ${response.status}`) }
  return new Uint8Array(await response.arrayBuffer())
}

const handler = createAiChatAgentHandler({
  agentKey: Deno.env.get('AI_CHAT_AGENT_KEY'),
  // Link tải ảnh trong /list, /next, /start trỏ về chính function này (đường /image).
  publicBaseUrl: `${supabaseUrl}/functions/v1/ai-chat-agent`,
  rpc: async (action, payload) => {
    const { data, error } = await supabase.rpc('aka_agent_ai_chat_worker', { p_action: action, p_payload: payload })
    return { data, error: error ? { code: error.code, message: error.message } : null }
  },
  insert: async (payload) => {
    const { data, error } = await supabase.rpc('aka_agent_ai_chat_insert', { p_payload: payload })
    return { data, error: error ? { code: error.code, message: error.message } : null }
  },
  reader: async (action, payload) => {
    const { data, error } = await supabase.rpc('aka_agent_ai_chat_reader', { p_action: action, p_payload: payload })
    return { data, error: error ? { code: error.code, message: error.message } : null }
  },
  // Ảnh của câu hỏi nằm ở kho media của hệ thống (Cloudflare R2, cùng kho với thư viện media): function tải hộ qua địa chỉ
  // công khai của kho để bộ trả lời chỉ cần gọi được function này. Chỉ tải URL nằm dưới tiền tố ảnh câu hỏi của kho.
  images: { prefix: imageStorePrefix, download: downloadStoredImage },
})

Deno.serve(handler)
