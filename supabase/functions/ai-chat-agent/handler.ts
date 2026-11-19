// API nội bộ của "Hỏi đáp AI". Không phụ thuộc Deno: index.ts nối với Supabase,
// scripts/ai-chat/edge_agent_smoke.mjs chạy chính tệp này trên Node với hàm SQL thật.
// Bên trả lời (agent): /next, /list, /start, /progress, /answer, /status, /image (tải ảnh khách gửi kèm).
// Bên hỏi (khách hàng, nhân viên): /groups, /projects (danh sách agent), /ask (kèm ảnh), /message (chờ câu trả lời), /thread, /cancel.
// Hàm SQL: aka_agent_ai_chat_worker (agent), aka_agent_ai_chat_insert (/ask), aka_agent_ai_chat_reader (/groups, /projects, /message, /thread, /cancel, /image).
// Ảnh của câu hỏi nằm ở kho media của hệ thống (Cloudflare R2), không nằm ở Supabase.

export type RpcError = { code?: string | null; message?: string | null }
export type RpcResult = { data: unknown; error: RpcError | null }
export type WorkerRpc = (action: string, payload: Record<string, unknown>) => Promise<RpcResult>
export type InsertRpc = (payload: Record<string, unknown>) => Promise<RpcResult>
export type ReaderRpc = (action: string, payload: Record<string, unknown>) => Promise<RpcResult>

/**
 * Kho media của hệ thống (Cloudflare R2, cùng kho với thư viện media của chiến dịch). Ảnh app tải lên cho câu hỏi nằm ở
 * `<địa chỉ công khai của kho>/<tiền tố kho>/ai-chat/<tổ chức>/<nhân viên>/<uuid>.<png|jpg|webp>`.
 */
export type ImageStore = {
  /** Tiền tố URL của mọi ảnh câu hỏi trong kho: `<media.storage.public_base_url>/<media.storage.key_prefix>/ai-chat/`. */
  prefix: () => Promise<string>
  /** Tải một ảnh trong kho theo URL của nó; null = không có tệp. */
  download: (url: string) => Promise<Uint8Array | null>
}

export type AiChatAgentOptions = {
  rpc: WorkerRpc
  /** Chèn câu hỏi: public.aka_agent_ai_chat_insert. */
  insert: InsertRpc
  /** Đọc / huỷ câu hỏi cho bên hỏi: public.aka_agent_ai_chat_reader. */
  reader: ReaderRpc
  /** Để trống = API mở (chế độ nội bộ). Có giá trị thì mọi lời gọi phải gửi header x-agent-key khớp. */
  agentKey?: string | null
  /** Kho media chứa ảnh của câu hỏi. Không cấu hình thì /image chỉ chuyển hướng tới URL của ảnh, không tải hộ. */
  images?: ImageStore | null
  /** Địa chỉ công khai của function (https://<ref>.supabase.co/functions/v1/ai-chat-agent) để dựng link tải ảnh trong /list, /next, /start. */
  publicBaseUrl?: string | null
  /** Chỉ dùng khi test: thay setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Chỉ dùng khi test: thay Date.now. */
  now?: () => number
}

const LEASE_SECONDS = 900
/** /message: chờ tối đa bao lâu trong một lần gọi, và bao lâu đọc lại một lần. */
const MAX_WAIT_SECONDS = 25
const POLL_INTERVAL_MS = 1500
/** Ảnh app tải lên tối đa 5 MB mỗi tệp (API Web chặn lúc tải lên); /image không trả tệp lớn hơn mức này. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Phần còn lại của URL sau tiền tố kho: <tổ chức>/<nhân viên>/<uuid>.<đuôi>. */
const IMAGE_PATH = /^[1-9][0-9]{0,14}\/[1-9][0-9]{0,14}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

const ROUTES = ['groups', 'projects', 'ask', 'message', 'thread', 'cancel', 'next', 'list', 'start', 'progress', 'answer', 'status', 'image']
const GET_ROUTES = ['groups', 'projects', 'list', 'message', 'thread', 'image']

const ERROR_MESSAGES: Record<string, string> = {
  ai_chat_invalid_request: 'Body không hợp lệ. Xem lại các trường bắt buộc.',
  ai_chat_answer_required: 'Thiếu nội dung câu trả lời (answer), hoặc câu trả lời dài quá 50.000 ký tự.',
  ai_chat_answer_schema_mismatch:
    'answerJson không đúng cấu trúc của agent: phải là object và có đủ các khóa trong project.outputSchema.required (nhận được ở bước /next hoặc /start).',
  ai_chat_worker_id_required: 'Thiếu tên agent.',
  ai_chat_invalid_action: 'Hành động không hợp lệ.',
  // Bên gửi câu hỏi (/ask).
  ai_chat_question_required: 'Thiếu câu hỏi: gửi question (chuỗi không rỗng) hoặc ít nhất 1 ảnh trong images.',
  ai_chat_question_too_long: 'Câu hỏi dài quá 4.000 ký tự.',
  ai_chat_images_invalid: 'images phải là mảng URL bắt đầu bằng http:// hoặc https://, mỗi URL tối đa 2.048 ký tự, không có khoảng trắng.',
  ai_chat_too_many_images: 'Tối đa 10 ảnh cho một câu hỏi.',
  ai_chat_project_required: 'Thiếu agent: gửi projectCode (hoặc projectId), hoặc threadId để hỏi tiếp trong hội thoại có sẵn.',
  ai_chat_agent_not_found: 'Không tìm thấy agent theo projectCode/projectId đã gửi.',
  ai_chat_staff_required: 'Chưa biết câu hỏi của nhân viên nào: gửi campaignId (lấy chủ chiến dịch) hoặc staffId.',
  ai_chat_invalid_source: 'source phải là "api", "web", "ios" hoặc "desktop".',
  ai_chat_campaign_required: 'Agent này cần campaignId.',
  ai_chat_campaign_not_found: 'Không tìm thấy chiến dịch, chiến dịch đã xóa, hoặc không thuộc nhân viên/tổ chức đã gửi.',
  ai_chat_thread_not_found: 'Không tìm thấy hội thoại (threadId), hoặc hội thoại không thuộc nhân viên/tổ chức đã gửi.',
  ai_chat_access_denied: 'Nhân viên không tồn tại, đã nghỉ, hoặc không thuộc tổ chức đã gửi.',
  ai_chat_agent_unavailable: 'Agent đang tắt hoặc không mở cho nhân viên này.',
  ai_chat_agent_not_applicable: 'Agent không áp dụng cho loại chiến dịch này.',
  ai_chat_intake_required: 'Thiếu thông tin bắt buộc của agent (intake).',
  ai_chat_message_pending: 'Hội thoại đang có 1 câu chờ trả lời. Chờ câu đó xong (hoặc huỷ bằng /cancel) rồi gửi câu mới.',
  ai_chat_thread_closed: 'Hội thoại đã đóng. Bỏ threadId để mở hội thoại mới.',
  ai_chat_too_many_pending: 'Nhân viên này đang có quá nhiều câu hỏi chờ trả lời. Gửi lại khi đã có câu trả lời.',
  ai_chat_daily_limit: 'Nhân viên này đã hết số câu hỏi trong ngày.',
  ai_chat_disabled: 'Hỏi đáp AI đang tắt (ai_chat.enabled = false).',
  // Bên hỏi đọc / huỷ (/message, /thread, /cancel).
  ai_chat_message_id_required: 'Thiếu messageId (số nguyên dương) hoặc requestId (UUID đã gửi lúc /ask).',
  ai_chat_message_not_found: 'Không tìm thấy câu hỏi, hoặc câu hỏi không thuộc staffId đã gửi.',
  ai_chat_thread_id_required: 'Thiếu threadId (số nguyên dương).',
  // Danh sách agent (/groups, /projects).
  ai_chat_group_not_found: 'Không tìm thấy nhóm agent theo groupId/groupCode, hoặc nhóm đang tắt.',
  // Tải ảnh của câu hỏi (/image).
  ai_chat_image_ref_required: 'Thiếu câu hỏi của ảnh: gửi messageId, hoặc threadId kèm seq (số thứ tự câu trong hội thoại).',
  ai_chat_image_not_found: 'Câu hỏi không có ảnh ở vị trí index đã gửi (index bắt đầu từ 0), hoặc tệp ảnh không còn trong kho.',
  ai_chat_image_too_large: 'Ảnh lớn hơn 5 MB, không tải qua đường này được.',
}

/** Mã HTTP theo mã lỗi; mã không có ở đây là 400. */
const ERROR_STATUS: Record<string, number> = {
  ai_chat_access_denied: 403,
  ai_chat_agent_unavailable: 403,
  ai_chat_agent_not_found: 404,
  ai_chat_campaign_not_found: 404,
  ai_chat_thread_not_found: 404,
  ai_chat_message_not_found: 404,
  ai_chat_group_not_found: 404,
  ai_chat_image_not_found: 404,
  ai_chat_message_pending: 409,
  ai_chat_thread_closed: 409,
  ai_chat_disabled: 409,
  ai_chat_image_too_large: 413,
  ai_chat_too_many_pending: 429,
  ai_chat_daily_limit: 429,
}

/** Các trường /ask chuyển nguyên cho hàm SQL; hàm SQL kiểm tra kiểu và giá trị. */
const ASK_FIELDS = ['question', 'images', 'projectCode', 'projectId', 'threadId', 'campaignId', 'staffId', 'organizationId', 'source', 'requestId', 'intake']

const REASON_MESSAGES: Record<string, string> = {
  not_waiting: 'Câu hỏi không còn ở trạng thái "chờ câu trả lời": agent khác đã nhận, khách đã hủy hoặc đã quá hạn.',
  not_found: 'Không tìm thấy câu hỏi.',
  not_claimed: 'Câu hỏi chưa được nhận (chưa gọi /next hoặc /start), đã xử lý xong, hoặc đã được trả về hàng đợi.',
  cancelled: 'Khách đã hủy câu hỏi này. Bỏ qua, không trả lời nữa.',
  expired: 'Câu hỏi đã quá hạn chờ. Bỏ qua, khách sẽ hỏi lại nếu còn cần.',
  not_active: 'Câu hỏi đã kết thúc (hoàn thành, lỗi hoặc đã hủy), không hủy được nữa.',
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

function failCode(code: string): Response {
  return fail(ERROR_STATUS[code] ?? 400, code, ERROR_MESSAGES[code] ?? 'Yêu cầu bị từ chối.')
}

function rpcFailure(error: RpcError, missing = 'aka_agent_ai_chat_worker'): Response {
  const code = String(error.code ?? '')
  const message = String(error.message ?? '')
  if (code === 'PGRST202' || code === '42883') {
    return fail(503, 'ai_chat_not_ready', `Database chưa có hàm ${missing}.`)
  }
  if (message.startsWith('ai_chat_')) {
    return fail(ERROR_STATUS[message] ?? 400, message, ERROR_MESSAGES[message] ?? 'Yêu cầu bị từ chối.')
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

function idOf(raw: unknown): number | null {
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,15}$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function messageIdOf(body: Record<string, unknown>): number | null {
  return idOf(body.messageId)
}

function intOf(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback
}

/** Trạng thái agent được phép đặt qua /status → tham số của RPC fail. */
function statusChangeOf(raw: unknown): { stopped: boolean; retryable: boolean } | null {
  const value = typeof raw === 'string' ? raw.normalize('NFC').trim().toLowerCase() : ''
  if (value === 'lỗi') return { stopped: false, retryable: false }
  if (value === 'dừng' || value === 'đã hủy') return { stopped: true, retryable: false }
  if (value === 'chờ câu trả lời') return { stopped: false, retryable: true }
  return null
}

function projectCodesOf(source: unknown): string[] | undefined {
  const list = Array.isArray(source) ? source : typeof source === 'string' ? source.split(',') : []
  const codes = list.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
  return codes.length > 0 ? codes : undefined
}

function agentOf(body: Record<string, unknown>): string {
  return typeof body.agent === 'string' && body.agent.trim() !== '' ? body.agent.trim().slice(0, 80) : 'agent-noi-bo'
}

/** Có câu hỏi dạng chữ, hoặc có ít nhất 1 phần tử ảnh (hàm SQL kiểm tra URL). */
function hasQuestionOrImages(body: Record<string, unknown>): boolean {
  if (typeof body.question === 'string' && body.question.trim() !== '') return true
  return Array.isArray(body.images) && body.images.some((item) => typeof item === 'string' && item.trim() !== '')
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

/** GET: lấy tham số từ query string (giá trị là chuỗi, hàm SQL tự đổi kiểu). */
function queryBody(url: URL): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of url.searchParams.entries()) body[key] = value
  return body
}

function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function pick(body: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') out[key] = body[key]
  }
  return out
}

function imageUrlsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
}

/** URL có phải ảnh do app tải lên kho media không (đúng tiền tố kho và đúng dạng <tổ chức>/<nhân viên>/<tệp>). */
function isStoredImage(url: string, storePrefix: string): boolean {
  return storePrefix !== '' && /^https?:\/\//i.test(storePrefix) && url.startsWith(storePrefix) && IMAGE_PATH.test(url.slice(storePrefix.length))
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function createAiChatAgentHandler(options: AiChatAgentOptions): (req: Request) => Promise<Response> {
  const agentKey = (options.agentKey ?? '').trim()
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? (() => Date.now())
  const publicBaseUrl = (options.publicBaseUrl ?? '').trim().replace(/\/+$/, '')
  const images = options.images ?? null

  type Claimed = { question: Record<string, unknown> | null; serverTime: unknown }

  /**
   * Thêm link tải ảnh cho agent: `imageDownloads[i]` là địa chỉ GET để tải `images[i]` về (đường /image của chính function này).
   * Agent tải qua `imageDownloads` thì chỉ cần gọi được function này, không cần gọi được máy chủ của kho media.
   * Câu trong `history` không có messageId nên link dùng threadId + seq.
   */
  function withImageDownloads(question: Record<string, unknown>): Record<string, unknown> {
    if (publicBaseUrl === '') return question
    const messageId = idOf(question.messageId)
    const threadId = idOf(question.threadId)
    if (messageId !== null) {
      question.imageDownloads = imageUrlsOf(question.images).map((_url, index) => `${publicBaseUrl}/image?messageId=${messageId}&index=${index}`)
    }
    if (threadId !== null && Array.isArray(question.history)) {
      for (const item of question.history as Record<string, unknown>[]) {
        const seq = idOf(asObject(item).seq)
        if (seq === null) continue
        item.imageDownloads = imageUrlsOf(item.images).map((_url, index) => `${publicBaseUrl}/image?threadId=${threadId}&seq=${seq}&index=${index}`)
      }
    }
    return question
  }

  /** Nhận câu (claim) → câu hỏi đã nhận, null nếu không có câu nào, hoặc Response lỗi. */
  async function claimQuestion(payload: Record<string, unknown>): Promise<Claimed | Response> {
    const result = await options.rpc('claim', payload)
    if (result.error) return rpcFailure(result.error)
    const data = asObject(result.data)
    if (data.enabled === false) return fail(409, 'ai_chat_disabled', ERROR_MESSAGES.ai_chat_disabled)
    const question = asItems(data)[0] ?? null
    // API nội bộ không dùng token: các bước sau chỉ cần messageId.
    if (question) {
      delete question.claimToken
      withImageDownloads(question)
    }
    return { question, serverTime: data.serverTime ?? null }
  }

  /** /image: tìm câu hỏi (theo messageId, hoặc threadId + seq) rồi trả ảnh thứ index của nó. */
  async function serveImage(body: Record<string, unknown>): Promise<Response> {
    const messageId = messageIdOf(body)
    const threadId = idOf(body.threadId)
    const seq = idOf(body.seq)
    const index = intOf(body.index, 0, 0, 1000)
    const staff = pick(body, ['staffId'])
    let message: Record<string, unknown>
    if (messageId !== null) {
      const result = await options.reader('message', { messageId, ...staff })
      if (result.error) return rpcFailure(result.error, 'aka_agent_ai_chat_reader')
      message = asObject(asObject(result.data).message)
    } else if (threadId !== null && seq !== null) {
      const result = await options.reader('thread', { threadId, afterSeq: seq - 1, limit: 1, ...staff })
      if (result.error) return rpcFailure(result.error, 'aka_agent_ai_chat_reader')
      const messages = asObject(result.data).messages
      message = asObject(Array.isArray(messages) ? messages[0] : null)
      if (idOf(message.seq) !== seq) return failCode('ai_chat_message_not_found')
    } else {
      return failCode('ai_chat_image_ref_required')
    }
    const urls = imageUrlsOf(message.images)
    const url = urls[index]
    if (url === undefined) return failCode('ai_chat_image_not_found')

    const wantsJson = body.format === 'json'
    let stored = false
    if (images) {
      try {
        stored = isStoredImage(url, await images.prefix())
      } catch (error) {
        console.error('ai-chat-agent image store config error', error instanceof Error ? error.message : String(error))
        return fail(502, 'ai_chat_upstream_error', 'Không đọc được cấu hình kho media. Thử lại sau vài giây.')
      }
    }
    if (!stored) {
      // Ảnh ngoài kho media (bên hỏi qua /ask gửi URL công khai), hoặc function chưa nối kho: không tải hộ, agent tự tải theo URL.
      if (!/^https?:\/\/\S+$/i.test(url)) return failCode('ai_chat_image_not_found')
      if (wantsJson) return json(200, { ok: true, external: true, index, count: urls.length, url })
      return new Response(JSON.stringify({ ok: true, external: true, index, count: urls.length, url }), {
        status: 302,
        headers: { location: url, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }

    let bytes: Uint8Array | null
    try {
      bytes = await (images as ImageStore).download(url)
    } catch (error) {
      console.error('ai-chat-agent image download error', error instanceof Error ? error.message : String(error))
      return fail(502, 'ai_chat_upstream_error', 'Không đọc được kho media. Thử lại sau vài giây.')
    }
    if (bytes === null) return failCode('ai_chat_image_not_found')
    if (bytes.length > IMAGE_MAX_BYTES) return failCode('ai_chat_image_too_large')
    const extension = url.slice(url.lastIndexOf('.') + 1)
    const mimeType = IMAGE_TYPES[extension] ?? 'application/octet-stream'
    const fileName = `cau-hoi-${idOf(message.id) ?? messageId ?? `${threadId}-${seq}`}-anh-${index + 1}.${extension}`
    if (wantsJson) {
      return json(200, { ok: true, external: false, index, count: urls.length, fileName, mimeType, sizeBytes: bytes.length, dataBase64: base64Of(bytes) })
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': mimeType,
        'content-length': String(bytes.length),
        'content-disposition': `inline; filename="${fileName}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-ai-chat-image-count': String(urls.length),
      },
    })
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const route = url.pathname.replace(/\/+$/, '').split('/').pop() ?? ''
    if (agentKey !== '' && !sameKey(req.headers.get('x-agent-key') ?? '', agentKey)) {
      return fail(401, 'ai_chat_agent_key_invalid', 'Thiếu hoặc sai header x-agent-key.')
    }
    if (!ROUTES.includes(route)) {
      return fail(404, 'ai_chat_route_not_found', `Đường dẫn không tồn tại. Dùng ${ROUTES.map((r) => '/' + r).join(', ')}.`)
    }
    if (req.method !== 'POST' && !(GET_ROUTES.includes(route) && req.method === 'GET')) {
      return fail(405, 'ai_chat_method_not_allowed', 'Dùng phương thức POST (riêng /groups, /projects, /list, /message, /thread, /image nhận cả GET).')
    }
    const body = req.method === 'GET' ? queryBody(url) : await readBody(req)
    if (body === null) return fail(400, 'ai_chat_invalid_request', 'Body phải là một JSON object.')

    // ───────────── Danh sách agent ─────────────
    if (route === 'groups' || route === 'projects') {
      const keys = route === 'groups' ? ['staffId', 'includeInactive'] : ['groupId', 'groupCode', 'staffId', 'includeInactive']
      const result = await options.reader(route, pick(body, keys))
      if (result.error) return rpcFailure(result.error, 'aka_agent_ai_chat_reader')
      const data = asObject(result.data)
      const items = Array.isArray(data[route]) ? (data[route] as unknown[]) : []
      return json(200, { ok: true, count: items.length, [route]: items, serverTime: data.serverTime ?? null })
    }

    // ───────────── Ảnh của câu hỏi (bên trả lời tải về để đọc) ─────────────
    if (route === 'image') return serveImage(body)

    // ───────────── Bên hỏi ─────────────
    if (route === 'ask') {
      if (body.question !== undefined && body.question !== null && typeof body.question !== 'string') {
        return fail(400, 'ai_chat_question_required', ERROR_MESSAGES.ai_chat_question_required)
      }
      if (!hasQuestionOrImages(body)) {
        return fail(400, 'ai_chat_question_required', ERROR_MESSAGES.ai_chat_question_required)
      }
      const result = await options.insert(pick(body, ASK_FIELDS))
      if (result.error) return rpcFailure(result.error, 'aka_agent_ai_chat_insert')
      const data = asObject(result.data)
      if (data.ok !== true) {
        // Không chèn: đang có câu chờ trả lời với cùng agent + chiến dịch. Trả kèm câu đang chờ đó.
        return json(409, {
          ok: false,
          code: 'ai_chat_message_pending',
          message: ERROR_MESSAGES.ai_chat_message_pending,
          threadId: data.threadId ?? null,
          messageId: data.messageId ?? null,
          status: data.status ?? null,
        })
      }
      return json(200, data)
    }

    if (route === 'message') {
      const payload = pick(body, ['messageId', 'requestId', 'staffId'])
      const waitMs = intOf(body.waitSeconds, 0, 0, MAX_WAIT_SECONDS) * 1000
      const startedAt = now()
      for (;;) {
        const result = await options.reader('message', payload)
        if (result.error) return rpcFailure(result.error, 'aka_agent_ai_chat_reader')
        const data = asObject(result.data)
        const waited = now() - startedAt
        if (data.final === true || waited + POLL_INTERVAL_MS > waitMs) {
          return json(200, { ok: true, final: data.final === true, message: data.message ?? null, thread: data.thread ?? null, serverTime: data.serverTime ?? null })
        }
        await sleep(POLL_INTERVAL_MS)
      }
    }

    if (route === 'thread') {
      const result = await options.reader('thread', pick(body, ['threadId', 'afterSeq', 'limit', 'staffId']))
      if (result.error) return rpcFailure(result.error, 'aka_agent_ai_chat_reader')
      const data = asObject(result.data)
      return json(200, { ok: true, thread: data.thread ?? null, messages: data.messages ?? [], hasMore: data.hasMore === true, serverTime: data.serverTime ?? null })
    }

    if (route === 'cancel') {
      if (messageIdOf(body) === null) return fail(400, 'ai_chat_message_id_required', ERROR_MESSAGES.ai_chat_message_id_required)
      const result = await options.reader('cancel', pick(body, ['messageId', 'staffId']))
      if (result.error) return rpcFailure(result.error, 'aka_agent_ai_chat_reader')
      const data = asObject(result.data)
      if (data.ok !== true) {
        return json(409, { ok: false, code: 'not_active', message: REASON_MESSAGES.not_active, messageId: data.messageId ?? null, status: data.status ?? null })
      }
      return json(200, { ok: true, messageId: data.messageId, status: data.status })
    }

    // ───────────── Bên agent ─────────────
    if (route === 'list') {
      const result = await options.rpc('list', {
        limit: intOf(body.limit ?? url.searchParams.get('limit'), 20, 1, 50),
        projectCodes: projectCodesOf(body.projectCodes ?? url.searchParams.get('projectCodes')),
      })
      if (result.error) return rpcFailure(result.error)
      const data = asObject(result.data)
      const items = asItems(data).map(withImageDownloads)
      return json(200, { ok: true, enabled: data.enabled !== false, count: items.length, questions: items, serverTime: data.serverTime ?? null })
    }

    if (route === 'next') {
      // Nhận câu cũ nhất trong một lệnh (khoá SKIP LOCKED trong SQL): 2 agent không giành cùng 1 câu.
      const claimed = await claimQuestion({
        workerId: agentOf(body),
        stage: 'working',
        limit: 1,
        leaseSeconds: LEASE_SECONDS,
        projectCodes: projectCodesOf(body.projectCodes),
      })
      if (claimed instanceof Response) return claimed
      return json(200, { ok: true, question: claimed.question, serverTime: claimed.serverTime })
    }

    const messageId = messageIdOf(body)
    if (messageId === null) return fail(400, 'ai_chat_invalid_request', 'Thiếu messageId (số nguyên dương, lấy từ /next hoặc /list).')

    if (route === 'start') {
      const claimed = await claimQuestion({ workerId: agentOf(body), messageId, stage: 'working', leaseSeconds: LEASE_SECONDS })
      if (claimed instanceof Response) return claimed
      if (!claimed.question) return fail(409, 'not_waiting', REASON_MESSAGES.not_waiting)
      return json(200, { ok: true, question: claimed.question, serverTime: claimed.serverTime })
    }

    let result: RpcResult
    if (route === 'progress') {
      result = await options.rpc('progress', {
        messageId,
        note: typeof body.note === 'string' ? body.note : undefined,
        stage: 'working',
        leaseSeconds: LEASE_SECONDS,
      })
    } else if (route === 'answer') {
      result = await options.rpc('answer', { messageId, answer: body.answer, answerJson: body.answerJson ?? null, complete: true })
    } else {
      const change = statusChangeOf(body.status)
      if (change === null) {
        return fail(400, 'ai_chat_invalid_status', 'status phải là "lỗi", "dừng" hoặc "chờ câu trả lời".')
      }
      result = await options.rpc('fail', {
        messageId,
        stopped: change.stopped,
        retryable: change.retryable,
        errorMessage: typeof body.message === 'string' ? body.message : undefined,
      })
    }
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
    if (route === 'progress') return json(200, { ok: true, messageId, status: data.status, leaseUntil: data.leaseUntil ?? null })
    if (route === 'answer') return json(200, { ok: true, messageId, status: data.status, answeredAt: data.answeredAt ?? null })
    return json(200, { ok: true, messageId, status: data.status, requeued: data.requeued === true })
  }
}
