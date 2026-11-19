// Ảnh đính kèm câu hỏi của Hỏi đáp AI trên Desktop: dịch vụ của tiến trình chính (src/main/services/aiChatImageService.ts),
// đường gửi ảnh lên API Web (src/main/services/aiChatImageApi.ts), cổng IPC dùng chung (src/shared/aiChatDesktop.ts) và bộ điều
// khiển hội thoại (src/shared/aiChat.ts). API Web ở đây là một máy chủ HTTP cục bộ làm đúng hợp đồng của đường
// AI_CHAT_DESKTOP_IMAGE_PATH (đường thật: akaAgentWebApp apps/api/src/modules/ai-chat/aiChatDesktopImages.routes.ts, có bài
// kiểm riêng ở đó); kho media là Map trong bộ nhớ.
//   node desktop_image_smoke.mjs <bundle>                        : phần không cần database (RPC giả)
//   node desktop_image_smoke.mjs <bundle> <psql> <socket> <port> : thêm một vòng đầy đủ với RPC Desktop `aka_agent_ai_chat` thật
//                                                                  trên lõi đã vá và handler thật của Edge Function ai-chat-agent
// Chạy: bash scripts/ai-chat/desktop_image_smoke.sh ; vòng đầy đủ do akaAgentWebApp scripts/test-ai-chat-images-sql.sh gọi.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const [bundle, psqlBin, host, port] = process.argv.slice(2)
const {
  AiChatImageService, AiChatDesktopError, AiChatThreadController, AI_CHAT_DESKTOP_IMAGE_PATH, AI_CHAT_IMAGE_BASE64_MAX, aiChatErrorCode,
  createAiChatAgentHandler, createAiChatIpcTransport, newAiChatRequestId, sniffAiChatImageType, uploadAiChatImageToApi
} = await import(bundle)

let failed = 0
let total = 0
const ok = (cond, label) => { total += 1; console.log(`${cond ? 'ok' : 'not ok'} - ${label}`); if (!cond) failed += 1 }
const codeOf = promise => Promise.resolve(promise).then(() => null, error => aiChatErrorCode(error) ?? String(error?.message ?? error))
const same = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => value === b[index])

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5])
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 6])
const upload = (bytes, mimeType) => ({ mimeType, dataBase64: Buffer.from(bytes).toString('base64') })

const STORE_PREFIX = 'https://pub-e2e.r2.dev/aka-agent/ai-chat/'
const OWN = /^https:\/\/pub-e2e\.r2\.dev\/aka-agent\/ai-chat\/1\/1\/[0-9a-f-]{36}\.(png|jpg|webp)$/
const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const servers = []

/**
 * API Web giả, đúng hợp đồng của đường tải ảnh cho Desktop: Bearer token của phiên → nhân viên, tệp vào thư mục của nhân viên đó,
 * trả `{ ok: true, data }` hoặc `{ ok: false, code, message }`. `api.respond` cho phép thay câu trả lời để thử các nhánh lỗi.
 */
async function startApi() {
  const api = { sessions: new Map([['token-1-1', { staffId: 1, organizationId: 1 }], ['token-2-1', { staffId: 2, organizationId: 1 }]]),
    files: new Map(), hits: 0, requests: [], respond: null, onStore: null }
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)) }
      api.hits += 1
      const authorization = String(req.headers.authorization || '')
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = {} }
      api.requests.push({ method: req.method, path: req.url, authorization, keys: Object.keys(body).sort(), mimeType: body.mimeType })
      if (api.respond) return api.respond(send, res)
      if (req.method !== 'POST' || req.url !== AI_CHAT_DESKTOP_IMAGE_PATH) return send(404, 'Not Found', 'text/plain')
      const identity = api.sessions.get(/^Bearer (.+)$/.exec(authorization)?.[1])
      if (!identity) return send(401, { ok: false, code: 'ai_chat_access_denied', message: 'x' })
      const bytes = Buffer.from(String(body.dataBase64 || ''), 'base64')
      const mimeType = sniffAiChatImageType(bytes)
      if (!mimeType) return send(400, { ok: false, code: 'ai_chat_image_type_invalid', message: 'x' })
      if (api.onStore) await api.onStore()
      const url = `${STORE_PREFIX}${identity.organizationId}/${identity.staffId}/${randomUUID()}.${EXTENSION[mimeType]}`
      api.files.set(url, { bytes: new Uint8Array(bytes), contentType: mimeType })
      send(200, { ok: true, data: { url, mimeType, sizeBytes: bytes.length } })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  api.url = `http://127.0.0.1:${server.address().port}${AI_CHAT_DESKTOP_IMAGE_PATH}`
  return api
}

/** Một "tiến trình chính" giả: phiên đăng nhập và API Web đều điều khiển được; mã của Desktop là mã thật. */
async function createMain(options = {}) {
  const api = options.api ?? await startApi()
  const state = { identity: { staffId: 1, organizationId: 1 }, token: 'token-1-1', tokenFails: false, url: api.url, timeoutMs: undefined }
  const service = new AiChatImageService({
    identity: () => state.identity,
    upload: image => uploadAiChatImageToApi({
      url: state.url, fetch: (...args) => fetch(...args), timeoutMs: state.timeoutMs,
      token: async () => { if (state.tokenFails) throw new Error('no session'); return state.token }
    }, image)
  })
  // Cùng cách đóng gói kết quả với aiChatHandlers.ts.
  const wrap = async run => {
    try {
      return { ok: true, data: await run() }
    } catch (error) {
      if (error instanceof AiChatDesktopError) return { ok: false, code: error.code, message: error.message }
      return { ok: false, code: 'ai_chat_unavailable', message: String(error?.message ?? error) }
    }
  }
  const rpc = options.rpc ?? (async () => { throw new AiChatDesktopError('ai_chat_unavailable') })
  const transport = createAiChatIpcTransport(
    (action, payload) => wrap(() => service.call(action, payload, rpc)),
    image => wrap(() => service.upload(image))
  )
  return { api, state, service, transport }
}

// ─────────────────────────────── Phần 1: không cần database ───────────────────────────────
{
  ok(sniffAiChatImageType(PNG) === 'image/png' && sniffAiChatImageType(JPG) === 'image/jpeg' && sniffAiChatImageType(WEBP) === 'image/webp'
    && sniffAiChatImageType(Buffer.from('GIF89a..........')) === null, 'nhận định dạng thật theo byte đầu: PNG, JPG, WEBP; GIF bị từ chối')
  ok(createAiChatIpcTransport(async () => ({ ok: true, data: {} })).uploadImage === undefined, 'cổng IPC không nối kênh tải ảnh thì không có uploadImage (giao diện ẩn nút)')
  ok(AI_CHAT_DESKTOP_IMAGE_PATH === '/api/aka-agent/desktop/v1/ai-chat/images', 'đường tải ảnh của Desktop trên API Web lấy từ hợp đồng dùng chung')

  const main = await createMain()
  const png = await main.transport.uploadImage(upload(PNG, 'image/png'))
  const jpg = await main.transport.uploadImage(upload(JPG, 'image/jpeg'))
  const webp = await main.transport.uploadImage(upload(WEBP, 'image/webp'))
  ok(OWN.test(png.url) && png.url.endsWith('.png') && png.mimeType === 'image/png' && png.sizeBytes === PNG.length, 'tải PNG qua API Web: URL nằm đúng thư mục <tiền tố kho>/ai-chat/<tổ chức>/<nhân viên>/<uuid>.png')
  ok(jpg.url.endsWith('.jpg') && webp.url.endsWith('.webp') && new Set([png.url, jpg.url, webp.url]).size === 3, 'tải JPG, WEBP: đuôi theo định dạng thật, mỗi ảnh một tên')
  ok(same(main.api.files.get(png.url)?.bytes, PNG) && main.api.files.get(jpg.url)?.contentType === 'image/jpeg', 'API nhận đúng nội dung tệp')
  const sent = main.api.requests[0]
  ok(sent.method === 'POST' && sent.path === AI_CHAT_DESKTOP_IMAGE_PATH && sent.authorization === 'Bearer token-1-1' && same(sent.keys, ['dataBase64', 'mimeType']),
    'Desktop gửi POST kèm token phiên; thân chỉ có mimeType và dataBase64 (không gửi nhân viên, tổ chức hay khóa kho)')
  const mislabeled = await main.transport.uploadImage(upload(JPG, 'image/png'))
  ok(mislabeled.mimeType === 'image/jpeg' && mislabeled.url.endsWith('.jpg') && main.api.requests.at(-1).mimeType === 'image/jpeg', 'khai PNG nhưng tệp là JPG: gửi và lưu theo định dạng thật')

  const hitsBefore = main.api.hits
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/gif'))) === 'ai_chat_image_type_invalid', 'định dạng khai không nhận (GIF): từ chối')
  ok(await codeOf(main.transport.uploadImage(upload(Buffer.from('<html>khong phai anh</html>'), 'image/png'))) === 'ai_chat_image_type_invalid', 'tệp không phải ảnh đội lốt PNG: từ chối')
  ok(await codeOf(main.transport.uploadImage({ mimeType: 'image/png', dataBase64: 'không phải base64!' })) === 'ai_chat_images_invalid', 'base64 hỏng: từ chối')
  ok(await codeOf(main.transport.uploadImage({ mimeType: 'image/png', dataBase64: '' })) === 'ai_chat_images_invalid', 'thiếu nội dung: từ chối')
  ok(await codeOf(main.transport.uploadImage({ mimeType: 'image/png', dataBase64: 'A'.repeat(AI_CHAT_IMAGE_BASE64_MAX + 4) })) === 'ai_chat_image_too_large', 'ảnh lớn hơn 5 MB: từ chối trước khi giải mã')
  ok(main.api.hits === hitsBefore, 'ảnh bị từ chối ngay trên máy không được gửi lên API')

  // Câu trả lời lỗi của API và các trường hợp API không trả theo hợp đồng.
  const filesBefore = main.api.files.size
  main.api.respond = send => send(429, { ok: false, code: 'ai_chat_image_rate_limited', message: 'x' })
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_rate_limited', 'API báo quá nhịp tải (30 ảnh / 10 phút): giữ nguyên mã lỗi của API')
  main.api.respond = send => send(503, { ok: false, code: 'ai_chat_images_not_ready', message: 'x' })
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_images_not_ready', 'API báo kho media chưa cấu hình: báo chưa nhận ảnh')
  main.api.respond = send => send(404, 'Not Found', 'text/plain')
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_images_not_ready', 'API Web chưa có đường này (404, bản API cũ): báo chưa nhận ảnh')
  main.api.respond = send => send(401, 'Unauthorized', 'text/plain')
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_access_denied', 'cổng trung gian trả 401 không theo hợp đồng: báo không có quyền')
  main.api.respond = send => send(502, '<html>Bad gateway</html>', 'text/html')
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_upload_failed', 'lỗi máy chủ không theo hợp đồng: báo không tải được ảnh')
  main.api.respond = send => send(200, { ok: true, data: { url: 'javascript:alert(1)', mimeType: 'image/png', sizeBytes: 3 } })
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_upload_failed', 'API trả URL không phải http(s): không nhận')
  main.api.respond = send => send(200, { ok: true, data: { mimeType: 'image/png' } })
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_upload_failed', 'API trả dữ liệu thiếu trường: không nhận')
  main.api.respond = () => undefined
  main.state.timeoutMs = 150
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_upload_failed', 'API không trả lời: bỏ lượt tải khi hết hạn chờ')
  main.state.timeoutMs = undefined
  main.api.respond = null
  main.state.url = 'http://127.0.0.1:9/khong-co-may-chu'
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_upload_failed', 'không nối được API: báo không tải được ảnh')
  main.state.url = main.api.url
  main.state.tokenFails = true
  const hitsNoToken = main.api.hits
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_unavailable' && main.api.hits === hitsNoToken, 'không lấy được token phiên: không gửi gì lên API')
  main.state.tokenFails = false
  main.state.token = 'token-da-thu-hoi'
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_access_denied', 'API từ chối token của phiên đã thu hồi')
  main.state.token = 'token-1-1'
  ok(main.api.files.size === filesBefore && (await main.transport.uploadImage(upload(PNG, 'image/png'))).url.endsWith('.png'), 'các lượt lỗi không để lại tệp; sau đó tải lại bình thường')

  // Chưa đăng nhập, đổi tài khoản giữa chừng.
  const signedOut = await createMain()
  signedOut.state.identity = null
  ok(await codeOf(signedOut.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_access_denied' && signedOut.api.hits === 0, 'chưa đăng nhập: từ chối, không gửi gì')
  const switched = await createMain()
  switched.api.onStore = async () => { switched.state.identity = { staffId: 2, organizationId: 1 } }
  ok(await codeOf(switched.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_unavailable', 'đổi tài khoản trong lúc tải: không trả ảnh của phiên cũ cho phiên mới')

  // Tối đa 4 lượt cùng lúc trên một app.
  const busy = await createMain()
  let release
  const gate = new Promise(resolve => { release = resolve })
  busy.api.onStore = () => gate
  const running = [0, 1, 2, 3].map(() => busy.transport.uploadImage(upload(PNG, 'image/png')))
  await new Promise(resolve => setTimeout(resolve, 80))
  ok(await codeOf(busy.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_rate_limited' && busy.api.hits === 4, 'đang có 4 lượt tải: lượt thứ 5 bị chặn ngay trên máy')
  release()
  ok((await Promise.all(running)).length === 4, '4 lượt tải cùng lúc đều xong')

  // open / ask: kiểm ảnh trước khi gọi RPC.
  const calls = []
  const snapshotOf = (payload, images) => ({
    changed: true, full: true, revision: 1, hasMore: false, serverTime: new Date().toISOString(),
    thread: { id: 7, projectId: 1, projectCode: 'x', projectName: 'X', campaignId: null, campaignName: null, name: 'n', status: 'đang mở', source: 'desktop',
      revision: 1, lastMessageSeq: 1, lastMessageStatus: 'chờ câu trả lời', lastMessageAt: new Date().toISOString(), lastReadSeq: 0, pending: true, unread: false, createdAt: new Date().toISOString() },
    messages: [{ id: 70, threadId: 7, seq: 1, requestId: payload.requestId, question: payload.question || '[Gửi ảnh]', images, status: 'chờ câu trả lời', threadRev: 1,
      progressNote: null, answer: null, answerJson: null, askedAt: new Date().toISOString(), queuedAt: new Date().toISOString(), startedAt: null, answeredAt: null,
      completedAt: null, deadlineAt: new Date(Date.now() + 60_000).toISOString(), errorCode: null, errorMessage: null, rating: null }]
  })
  let dbStoresImages = true
  const withRpc = await createMain({
    rpc: async (action, payload) => {
      calls.push({ action, payload })
      if (action === 'cancel') return { changed: false, revision: 2, lastReadSeq: 0, serverTime: new Date().toISOString() }
      return snapshotOf(payload, dbStoresImages ? (payload.images ?? []) : [])
    }
  })
  const own = (await withRpc.transport.uploadImage(upload(PNG, 'image/png'))).url
  const requestId = newAiChatRequestId()
  let opened = await withRpc.transport.open({ requestId, projectId: 1, campaignId: null, question: 'Có ảnh', intake: {}, images: [own, own] })
  ok(opened.changed && same(opened.messages[0].images, [own]) && same(calls.at(-1).payload.images, [own]), 'open kèm ảnh của mình: gửi tới RPC, URL trùng được gộp')
  await withRpc.transport.open({ requestId: newAiChatRequestId(), projectId: 1, campaignId: null, question: 'Không ảnh', intake: {}, images: [] })
  ok(!('images' in calls.at(-1).payload), 'open không có ảnh: không gửi khóa images (giống lệnh cũ)')
  const before = calls.length
  const foreign = `${STORE_PREFIX}1/2/0b7d6a2e-8a3b-4d55-9c1e-6f1c2f0e4f1a.png`
  ok(await codeOf(withRpc.transport.open({ requestId: newAiChatRequestId(), projectId: 1, campaignId: null, question: 'Ảnh người khác', intake: {}, images: [foreign] })) === 'ai_chat_images_invalid'
    && calls.length === before, 'open kèm ảnh trong thư mục của nhân viên khác: từ chối, không gọi RPC')
  const notUploadedHere = `${STORE_PREFIX}1/1/0b7d6a2e-8a3b-4d55-9c1e-6f1c2f0e4f1a.png`
  ok(await codeOf(withRpc.transport.ask(7, { requestId: newAiChatRequestId(), question: 'Ảnh không qua nút đính kèm', images: [notUploadedHere] })) === 'ai_chat_images_invalid'
    && calls.length === before, 'ask kèm URL không phải ảnh vừa tải lên trong phiên này: từ chối, không gọi RPC')
  ok(await codeOf(withRpc.transport.ask(7, { requestId: newAiChatRequestId(), question: 'Ảnh ngoài', images: ['https://example.com/a.png'] })) === 'ai_chat_images_invalid'
    && calls.length === before, 'ask kèm URL ngoài kho media: từ chối, không gọi RPC')
  ok(await codeOf(withRpc.transport.ask(7, { requestId: newAiChatRequestId(), question: 'Nhiều', images: Array.from({ length: 11 }, (_, i) => `${own}?${i}`) })) === 'ai_chat_too_many_images',
    'quá 10 URL trong một lệnh: từ chối')
  // Đổi sang tài khoản khác trên cùng app: ảnh của phiên trước không dùng được nữa.
  withRpc.state.identity = { staffId: 2, organizationId: 1 }
  ok(await codeOf(withRpc.transport.ask(7, { requestId: newAiChatRequestId(), question: 'Ảnh của phiên trước', images: [own] })) === 'ai_chat_images_invalid'
    && calls.length === before, 'đổi tài khoản: ảnh do phiên trước tải lên bị từ chối')
  withRpc.state.identity = { staffId: 1, organizationId: 1 }
  dbStoresImages = false
  ok(await codeOf(withRpc.transport.ask(7, { requestId: newAiChatRequestId(), question: 'DB cũ', images: [own] })) === 'ai_chat_images_not_ready'
    && calls.at(-1).action === 'cancel' && calls.at(-1).payload.messageId === 70, 'database chưa nhận ảnh (lõi cũ bỏ qua images): dừng câu vừa ghi rồi báo rõ')
}

// ─────────────────────────────── Phần 2: RPC Desktop thật trên lõi đã vá ───────────────────────────────
if (psqlBin) {
  const lit = text => `'${String(text).replace(/'/g, "''")}'`
  const sql = statement => execFileSync(psqlBin, ['-X', '-h', host, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', statement],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const CLAIMS = `SET ROLE aka_agent_desktop; SELECT set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}', false);`
  // Giả lập aiChatRepository.callAiChat: cùng cách phân loại lỗi.
  const rpc = async (action, payload) => {
    try {
      const out = sql(`${CLAIMS} SELECT public.aka_agent_ai_chat(1, 1, 'ha', 'pw1', ${lit(action)}, ${lit(JSON.stringify(payload))}::jsonb)`)
      return JSON.parse(out.split('\n').pop())
    } catch (error) {
      const message = /ERROR:\s+(.*)/.exec(String(error.stderr ?? error.message))?.[1]?.trim() ?? ''
      throw new AiChatDesktopError(/(?:^|[^a-z_])(ai_chat_[a-z_]+)/.exec(message)?.[1] ?? 'ai_chat_unavailable')
    }
  }
  const edgeCall = fn => async (...args) => {
    try {
      const params = args.map(arg => typeof arg === 'string' ? lit(arg) : `${lit(JSON.stringify(arg))}::jsonb`).join(', ')
      return { data: JSON.parse(sql(`SET ROLE service_role; SELECT public.${fn}(${params})`)), error: null }
    } catch (error) {
      return { data: null, error: { code: '22023', message: /ERROR:\s+(.*)/.exec(String(error.stderr ?? error.message))?.[1]?.trim() ?? 'unknown' } }
    }
  }
  const main = await createMain({ rpc })
  const BASE = 'https://e2e.supabase.co/functions/v1/ai-chat-agent'
  // Bộ trả lời đọc ảnh từ đúng kho mà API Web vừa ghi cho Desktop.
  const handler = createAiChatAgentHandler({
    rpc: edgeCall('aka_agent_ai_chat_worker'), reader: edgeCall('aka_agent_ai_chat_reader'), insert: edgeCall('aka_agent_ai_chat_insert'),
    images: { prefix: async () => STORE_PREFIX, download: async link => main.api.files.get(link)?.bytes ?? null }, publicBaseUrl: BASE
  })
  const post = async (path, body) => (await handler(new Request(BASE + path, { method: 'POST', body: JSON.stringify(body ?? {}) }))).json()
  const download = async link => {
    const res = await handler(new Request(link, { method: 'GET', redirect: 'manual' }))
    return { status: res.status, type: res.headers.get('content-type'), bytes: new Uint8Array(await res.arrayBuffer()) }
  }

  const agents = await main.transport.agents()
  const project = agents.groups.flatMap(group => group.projects).find(item => item.code === 'hoi-dap-chien-dich')
  ok(agents.enabled && agents.limits.maxImagesPerQuestion === 3 && !!project, 'agents qua RPC Desktop: lõi đã vá báo tối đa 3 ảnh mỗi câu (giao diện hiện nút đính ảnh)')

  const a = await main.transport.uploadImage(upload(PNG, 'image/png'))
  const b = await main.transport.uploadImage(upload(JPG, 'image/jpeg'))
  const opened = await main.transport.open({ requestId: newAiChatRequestId(), projectId: project.id, campaignId: 10, question: 'Tại sao chiến dịch không chạy?', intake: {}, images: [a.url, b.url] })
  ok(opened.changed && opened.thread.source === 'desktop' && same(opened.messages[0].images, [a.url, b.url]), 'open từ Desktop kèm 2 ảnh: câu hỏi lưu đủ ảnh, nguồn desktop')
  const first = opened.messages[0].id

  let r = await post('/next', { agent: 'claude-code', projectCodes: ['hoi-dap-chien-dich'] })
  ok(r.ok && r.question?.messageId === first && r.question.imageDownloads?.length === 2, 'bộ trả lời /next: nhận câu của Desktop, có 2 link tải ảnh')
  const got = await Promise.all(r.question.imageDownloads.map(download))
  ok(got[0].status === 200 && got[0].type === 'image/png' && same(got[0].bytes, PNG) && got[1].type === 'image/jpeg' && same(got[1].bytes, JPG),
    'bộ trả lời /image: tải về đúng hai tệp người dùng Desktop đã đính kèm')
  r = await post('/answer', { messageId: first, answer: 'Đã xem hai ảnh.', answerJson: { tom_tat: 'Đã xem hai ảnh.' } })
  ok(r.ok && r.status === 'hoàn thành', 'bộ trả lời /answer: trả lời câu có ảnh')

  // Hỏi tiếp chỉ có ảnh qua bộ điều khiển dùng chung (đúng đường của ô hỏi tiếp trong tab Trợ lý).
  const controller = new AiChatThreadController({ transport: main.transport })
  controller.setVisible(false)
  await controller.load(opened.thread.id)
  const c = await main.transport.uploadImage(upload(WEBP, 'image/webp'))
  const asked = await controller.ask('', [c.url])
  const second = controller.getState().messages.at(-1)
  ok(asked && second?.question === '[Gửi 1 ảnh]' && same(second.images, [c.url]) && same(controller.getState().messages[0].images, [a.url, b.url]),
    'hỏi tiếp chỉ có ảnh: câu lưu là "[Gửi 1 ảnh]" kèm ảnh, câu trước vẫn còn ảnh')
  controller.dispose()
  r = await post('/start', { messageId: second.id, agent: 'claude-code' })
  const again = await download(r.question.history[0].imageDownloads[0])
  ok(r.ok && same((await download(r.question.imageDownloads[0])).bytes, WEBP) && same(again.bytes, PNG), 'bộ trả lời: tải ảnh của câu mới và tải lại ảnh của câu trước (history)')
  await post('/status', { messageId: second.id, status: 'dừng' })

  const d = await main.transport.uploadImage(upload(PNG, 'image/png'))
  ok(await codeOf(main.transport.ask(opened.thread.id, { requestId: newAiChatRequestId(), question: 'Bốn ảnh', images: [a.url, b.url, c.url, d.url] })) === 'ai_chat_too_many_images',
    'ask kèm 4 ảnh: database từ chối theo cài đặt 3 ảnh mỗi câu')
  ok(await codeOf(main.transport.ask(opened.thread.id, { requestId: newAiChatRequestId(), question: '', images: [] })) === 'ai_chat_question_required',
    'ask không chữ không ảnh: database từ chối')
  const plain = await main.transport.ask(opened.thread.id, { requestId: newAiChatRequestId(), question: 'Câu không ảnh' })
  ok(plain.changed && plain.messages.at(-1).images.length === 0, 'ask không ảnh vẫn chạy như trước')
}

for (const server of servers) { server.closeAllConnections?.(); server.close() }
console.log(failed === 0 ? `PASS_DESKTOP_IMAGES ${total}` : `FAIL_DESKTOP_IMAGES ${failed}/${total}`)
process.exit(failed === 0 ? 0 : 1)
