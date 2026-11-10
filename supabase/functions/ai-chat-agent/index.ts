import { createClient } from 'jsr:@supabase/supabase-js@2'
import { createAiChatAgentHandler } from './handler.ts'

// Nội bộ, mở theo yêu cầu: verify_jwt = false và không cần header nào.
// Muốn khóa lại: `supabase secrets set AI_CHAT_AGENT_KEY=<chuỗi bí mật>`, khi đó mọi lời gọi phải gửi x-agent-key.
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

const handler = createAiChatAgentHandler({
  agentKey: Deno.env.get('AI_CHAT_AGENT_KEY'),
  rpc: async (action, payload) => {
    const { data, error } = await supabase.rpc('aka_agent_ai_chat_worker', { p_action: action, p_payload: payload })
    return { data, error: error ? { code: error.code, message: error.message } : null }
  },
  insert: async (payload) => {
    const { data, error } = await supabase.rpc('aka_agent_ai_chat_insert', { p_payload: payload })
    return { data, error: error ? { code: error.code, message: error.message } : null }
  },
})

Deno.serve(handler)
