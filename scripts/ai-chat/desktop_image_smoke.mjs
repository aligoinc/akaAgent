// Ảnh đính kèm câu hỏi của Hỏi đáp AI trên Desktop: dịch vụ của tiến trình chính (src/main/services/aiChatImageService.ts),
// cổng IPC dùng chung (src/shared/aiChatDesktop.ts) và bộ điều khiển hội thoại (src/shared/aiChat.ts). Kho media là giả (Map).
//   node desktop_image_smoke.mjs <bundle>                        : phần không cần database (RPC giả)
//   node desktop_image_smoke.mjs <bundle> <psql> <socket> <port> : thêm một vòng đầy đủ với RPC Desktop `aka_agent_ai_chat` thật
//                                                                  trên lõi đã vá và handler thật của Edge Function ai-chat-agent
// Chạy: bash scripts/ai-chat/desktop_image_smoke.sh ; vòng đầy đủ do akaAgentWebApp scripts/test-ai-chat-images-sql.sh gọi.
import { execFileSync } from 'node:child_process'

const [bundle, psqlBin, host, port] = process.argv.slice(2)
const {
  AiChatImageService, AiChatDesktopError, AiChatThreadController, AI_CHAT_IMAGE_BASE64_MAX, aiChatErrorCode, createAiChatAgentHandler,
  createAiChatIpcTransport, newAiChatRequestId, sniffAiChatImageType
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

const SETTINGS = {
  provider: 'r2', endpointUrl: 'https://r2.example', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'akabiz',
  publicBaseUrl: 'https://pub-e2e.r2.dev/', keyPrefix: '/aka-agent/'
}
const STORE_PREFIX = 'https://pub-e2e.r2.dev/aka-agent/ai-chat/'
const OWN = /^https:\/\/pub-e2e\.r2\.dev\/aka-agent\/ai-chat\/1\/1\/[0-9a-f-]{36}\.(png|jpg|webp)$/

/** Một "tiến trình chính" giả: phiên đăng nhập, kho media (Map) và đồng hồ đều điều khiển được. */
function createMain(options = {}) {
  const state = { identity: { staffId: 1, organizationId: 1 }, settings: { ...SETTINGS }, now: 1_000_000, files: new Map(), puts: 0, settingsReads: 0, putFails: false, onPut: null }
  const service = new AiChatImageService({
    identity: () => state.identity,
    settings: async () => { state.settingsReads += 1; if (state.settings === null) throw new Error('db'); return state.settings },
    put: async (settings, input) => {
      state.puts += 1
      if (state.putFails) throw new Error('network')
      if (state.onPut) await state.onPut()
      const url = `${settings.publicBaseUrl.replace(/\/+$/, '')}/${input.objectKey}`
      state.files.set(url, { bytes: new Uint8Array(input.body), contentType: input.contentType })
      return { cloudUrl: url }
    },
    now: () => state.now
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
  return { state, service, transport }
}

// ─────────────────────────────── Phần 1: không cần database ───────────────────────────────
{
  ok(sniffAiChatImageType(PNG) === 'image/png' && sniffAiChatImageType(JPG) === 'image/jpeg' && sniffAiChatImageType(WEBP) === 'image/webp'
    && sniffAiChatImageType(Buffer.from('GIF89a..........')) === null, 'nhận định dạng thật theo byte đầu: PNG, JPG, WEBP; GIF bị từ chối')
  ok(createAiChatIpcTransport(async () => ({ ok: true, data: {} })).uploadImage === undefined, 'cổng IPC không nối kênh tải ảnh thì không có uploadImage (giao diện ẩn nút)')

  const main = createMain()
  const png = await main.transport.uploadImage(upload(PNG, 'image/png'))
  const jpg = await main.transport.uploadImage(upload(JPG, 'image/jpeg'))
  const webp = await main.transport.uploadImage(upload(WEBP, 'image/webp'))
  ok(OWN.test(png.url) && png.url.endsWith('.png') && png.mimeType === 'image/png' && png.sizeBytes === PNG.length, 'tải PNG: URL nằm đúng thư mục <tiền tố kho>/ai-chat/<tổ chức>/<nhân viên>/<uuid>.png')
  ok(jpg.url.endsWith('.jpg') && webp.url.endsWith('.webp') && new Set([png.url, jpg.url, webp.url]).size === 3, 'tải JPG, WEBP: đuôi theo định dạng thật, mỗi ảnh một tên')
  ok(same(main.state.files.get(png.url)?.bytes, PNG) && main.state.files.get(jpg.url)?.contentType === 'image/jpeg', 'kho nhận đúng nội dung tệp và content-type')
  ok(main.state.settingsReads === 1, 'cấu hình kho chỉ đọc một lần cho cả loạt ảnh (giữ 60 giây)')
  const mislabeled = await main.transport.uploadImage(upload(JPG, 'image/png'))
  ok(mislabeled.mimeType === 'image/jpeg' && mislabeled.url.endsWith('.jpg'), 'khai PNG nhưng tệp là JPG: lưu theo định dạng thật')

  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/gif'))) === 'ai_chat_image_type_invalid', 'định dạng khai không nhận (GIF): từ chối')
  ok(await codeOf(main.transport.uploadImage(upload(Buffer.from('<html>khong phai anh</html>'), 'image/png'))) === 'ai_chat_image_type_invalid', 'tệp không phải ảnh đội lốt PNG: từ chối')
  ok(await codeOf(main.transport.uploadImage({ mimeType: 'image/png', dataBase64: 'không phải base64!' })) === 'ai_chat_images_invalid', 'base64 hỏng: từ chối')
  ok(await codeOf(main.transport.uploadImage({ mimeType: 'image/png', dataBase64: '' })) === 'ai_chat_images_invalid', 'thiếu nội dung: từ chối')
  ok(await codeOf(main.transport.uploadImage({ mimeType: 'image/png', dataBase64: 'A'.repeat(AI_CHAT_IMAGE_BASE64_MAX + 4) })) === 'ai_chat_image_too_large', 'ảnh lớn hơn 5 MB: từ chối trước khi giải mã')
  const putsBefore = main.state.puts
  await codeOf(main.transport.uploadImage(upload(PNG, 'image/gif')))
  ok(main.state.puts === putsBefore, 'ảnh bị từ chối không được ghi vào kho')

  main.state.putFails = true
  ok(await codeOf(main.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_upload_failed', 'kho lỗi lúc ghi: báo không tải được ảnh')
  main.state.putFails = false

  // Kho chưa cấu hình, chưa đăng nhập, đổi tài khoản giữa chừng.
  const unconfigured = createMain()
  unconfigured.state.settings = { ...SETTINGS, publicBaseUrl: '' }
  ok(await codeOf(unconfigured.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_images_not_ready' && unconfigured.state.puts === 0, 'kho media chưa cấu hình: báo chưa nhận ảnh, không ghi gì')
  const signedOut = createMain()
  signedOut.state.identity = null
  ok(await codeOf(signedOut.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_access_denied', 'chưa đăng nhập: từ chối')
  const switched = createMain()
  switched.state.onPut = async () => { switched.state.identity = { staffId: 2, organizationId: 1 } }
  ok(await codeOf(switched.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_unavailable', 'đổi tài khoản trong lúc tải: không trả ảnh của phiên cũ cho phiên mới')

  // Nhịp tải: 30 ảnh mỗi 10 phút cho mỗi nhân viên.
  const limited = createMain()
  for (let i = 0; i < 30; i += 1) await limited.transport.uploadImage(upload(PNG, 'image/png'))
  ok(await codeOf(limited.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_rate_limited' && limited.state.puts === 30, 'ảnh thứ 31 trong 10 phút: bị chặn')
  limited.state.now += 10 * 60_000 + 1
  ok((await limited.transport.uploadImage(upload(PNG, 'image/png'))).url.endsWith('.png'), 'sau 10 phút: tải tiếp được')
  // Tối đa 4 lượt cùng lúc.
  const busy = createMain()
  let release
  const gate = new Promise(resolve => { release = resolve })
  busy.state.onPut = () => gate
  const running = [0, 1, 2, 3].map(() => busy.transport.uploadImage(upload(PNG, 'image/png')))
  await new Promise(resolve => setTimeout(resolve, 20))
  ok(await codeOf(busy.transport.uploadImage(upload(PNG, 'image/png'))) === 'ai_chat_image_rate_limited', 'đang có 4 lượt tải: lượt thứ 5 bị chặn')
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
  const withRpc = createMain({
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
  ok(await codeOf(withRpc.transport.ask(7, { requestId: newAiChatRequestId(), question: 'Ảnh ngoài', images: ['https://example.com/a.png'] })) === 'ai_chat_images_invalid'
    && calls.length === before, 'ask kèm URL ngoài kho media: từ chối, không gọi RPC')
  ok(await codeOf(withRpc.transport.ask(7, { requestId: newAiChatRequestId(), question: 'Nhiều', images: Array.from({ length: 11 }, (_, i) => `${own}?${i}`) })) === 'ai_chat_too_many_images',
    'quá 10 URL trong một lệnh: từ chối')
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
  const main = createMain({ rpc })
  const BASE = 'https://e2e.supabase.co/functions/v1/ai-chat-agent'
  // Bộ trả lời đọc ảnh từ đúng kho mà tiến trình chính của Desktop vừa ghi.
  const handler = createAiChatAgentHandler({
    rpc: edgeCall('aka_agent_ai_chat_worker'), reader: edgeCall('aka_agent_ai_chat_reader'), insert: edgeCall('aka_agent_ai_chat_insert'),
    images: { prefix: async () => STORE_PREFIX, download: async link => main.state.files.get(link)?.bytes ?? null }, publicBaseUrl: BASE
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

console.log(failed === 0 ? `PASS_DESKTOP_IMAGES ${total}` : `FAIL_DESKTOP_IMAGES ${failed}/${total}`)
process.exit(failed === 0 ? 0 : 1)
