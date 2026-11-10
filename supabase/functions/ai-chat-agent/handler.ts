// API nội bộ cho agent trả lời "Hỏi đáp AI" (V488). Không phụ thuộc Deno: index.ts nối với Supabase,
// scripts/ai-chat/edge_agent_smoke.mjs chạy chính tệp này trên Node với hàm SQL thật.
// Hợp đồng cho agent: docs/AI_CHAT_AGENT_API.md.

export type RpcError = { code?: string | null; message?: string | null }
export type RpcResult = { data: unknown; error: RpcError | null }
export type WorkerRpc = (action: string, payload: Record<string, unknown>) => Promise<RpcResult>

export type AiChatAgentOptions = {
  rpc: WorkerRpc
  /** Để trống = API mở (chế độ nội bộ). Có giá trị thì mọi lời gọi phải gửi header x-agent-key khớp. */
  agentKey?: string | null
}

const LEASE_SECONDS = 900

const ERROR_MESSAGES: Record<string, string> = {
  ai_chat_invalid_request: 'Body không hợp lệ. Xem lại các trường bắt buộc.',
  ai_chat_answer_required: 'Thiếu nội dung câu trả lời (answer), hoặc câu trả lời dài quá 50.000 ký tự.',
  ai_chat_answer_schema_mismatch:
    'answerJson không đúng cấu trúc của agent: phải là object và có đủ các khóa trong project.outputSchema.required (nhận được ở bước start).',
  ai_chat_worker_id_required: 'Thiếu tên agent.',
  ai_chat_invalid_action: 'Hành động không hợp lệ.',
}

const REASON_MESSAGES: Record<string, string> = {
  not_waiting: 'Câu hỏi không còn ở trạng thái "chờ câu trả lời": agent khác đã nhận, khách đã hủy hoặc đã quá hạn.',
  not_found: 'Không tìm thấy câu hỏi.',
  not_claimed: 'claimToken không khớp, hoặc câu hỏi đã được trả về hàng đợi. Gọi lại /list rồi /start.',
  cancelled: 'Khách đã hủy câu hỏi này. Bỏ qua, không trả lời nữa.',
  expired: 'Câu hỏi đã quá hạn chờ. Bỏ qua, khách sẽ bấm Thử lại nếu còn cần.',
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function fail(status: number, code: string, message: string): Response {
  return json(status, { ok: false, code, message })
}

function rpcFailure(error: RpcError): Response {
  const code = String(error.code ?? '')
  const message = String(error.message ?? '')
  if (code === 'PGRST202' || code === '42883') {
    return fail(503, 'ai_chat_not_ready', 'Database chưa có hàm aka_agent_ai_chat_worker (chưa apply migration V488).')
  }
  if (message.startsWith('ai_chat_')) {
    return fail(400, message, ERROR_MESSAGES[message] ?? 'Yêu cầu bị từ chối.')
  }
  console.error('ai-chat-agent rpc error', code, message)
  return fail(502, 'ai_chat_upstream_error', 'Không gọi được database. Thử lại sau vài giây.')
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asItems(value: unknown): Record<string, unknown>[] {
  const items = asObject(value).items
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : []
}

function messageIdOf(body: Record<string, unknown>): number | null {
  const raw = body.messageId
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function tokenOf(body: Record<string, unknown>): string | null {
  const raw = typeof body.claimToken === 'string' ? body.claimToken.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null
}

function projectCodesOf(source: unknown): string[] | undefined {
  const list = Array.isArray(source) ? source : typeof source === 'string' ? source.split(',') : []
  const codes = list.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
  return codes.length > 0 ? codes : undefined
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function createAiChatAgentHandler(options: AiChatAgentOptions): (req: Request) => Promise<Response> {
  const agentKey = (options.agentKey ?? '').trim()

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const route = url.pathname.replace(/\/+$/, '').split('/').pop() ?? ''
    if (agentKey !== '' && !sameKey(req.headers.get('x-agent-key') ?? '', agentKey)) {
      return fail(401, 'ai_chat_agent_key_invalid', 'Thiếu hoặc sai header x-agent-key.')
    }
    if (!['list', 'start', 'answer', 'fail'].includes(route)) {
      return fail(404, 'ai_chat_route_not_found', 'Đường dẫn không tồn tại. Dùng /list, /start, /answer hoặc /fail.')
    }
    if (req.method !== 'POST' && !(route === 'list' && req.method === 'GET')) {
      return fail(405, 'ai_chat_method_not_allowed', 'Dùng phương thức POST (riêng /list nhận cả GET).')
    }
    const body = req.method === 'GET' ? {} : await readBody(req)
    if (body === null) return fail(400, 'ai_chat_invalid_request', 'Body phải là một JSON object.')

    if (route === 'list') {
      const limit = Number(body.limit ?? url.searchParams.get('limit') ?? 20)
      const result = await options.rpc('list', {
        limit: Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.trunc(limit))) : 20,
        projectCodes: projectCodesOf(body.projectCodes ?? url.searchParams.get('projectCodes')),
      })
      if (result.error) return rpcFailure(result.error)
      const data = asObject(result.data)
      const items = asItems(data)
      return json(200, { ok: true, enabled: data.enabled !== false, count: items.length, questions: items, serverTime: data.serverTime ?? null })
    }

    const messageId = messageIdOf(body)
    if (messageId === null) return fail(400, 'ai_chat_invalid_request', 'Thiếu messageId (số nguyên dương, lấy từ /list).')

    if (route === 'start') {
      const agent = typeof body.agent === 'string' && body.agent.trim() !== '' ? body.agent.trim().slice(0, 80) : 'agent-noi-bo'
      const result = await options.rpc('claim', { workerId: agent, messageId, stage: 'working', leaseSeconds: LEASE_SECONDS })
      if (result.error) return rpcFailure(result.error)
      const data = asObject(result.data)
      if (data.enabled === false) return fail(409, 'ai_chat_disabled', 'Hỏi đáp AI đang tắt (ai_chat.enabled = false).')
      const question = asItems(data)[0]
      if (!question) return fail(409, 'not_waiting', REASON_MESSAGES.not_waiting)
      return json(200, { ok: true, question, serverTime: data.serverTime ?? null })
    }

    const claimToken = tokenOf(body)
    if (claimToken === null) return fail(400, 'ai_chat_invalid_request', 'Thiếu claimToken (uuid nhận được ở bước /start).')

    const result =
      route === 'answer'
        ? await options.rpc('answer', { messageId, claimToken, answer: body.answer, answerJson: body.answerJson ?? null, complete: true })
        : await options.rpc('fail', {
            messageId,
            claimToken,
            retryable: body.retry === true,
            errorMessage: typeof body.message === 'string' ? body.message : undefined,
          })
    if (result.error) return rpcFailure(result.error)
    const data = asObject(result.data)
    if (data.ok !== true) {
      const reason = typeof data.reason === 'string' ? data.reason : 'not_claimed'
      return json(reason === 'not_found' ? 404 : 409, {
        ok: false,
        code: reason,
        message: REASON_MESSAGES[reason] ?? REASON_MESSAGES.not_claimed,
        status: data.status ?? null,
      })
    }
    return route === 'answer'
      ? json(200, { ok: true, messageId, status: data.status, answeredAt: data.answeredAt ?? null })
      : json(200, { ok: true, messageId, status: data.status, requeued: data.requeued === true })
  }
}
