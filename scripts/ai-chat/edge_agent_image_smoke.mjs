// Đường /image và link tải ảnh của Edge Function ai-chat-agent, chạy handler trên Node với hàm DB và kho media giả
// (không cần PostgreSQL). Bản chạy với hàm SQL thật nằm ở akaAgentWebApp: scripts/test-ai-chat-images-sql.sh.
// Usage: node scripts/ai-chat/edge_agent_image_smoke.mjs   (cần Node >= 22.18 để chạy thẳng tệp .ts)
import { createAiChatAgentHandler } from '../../supabase/functions/ai-chat-agent/handler.ts'

let failed = 0
const ok = (cond, label) => { console.log(`${cond ? 'ok' : 'not ok'} - ${label}`); if (!cond) failed += 1 }

const SUPABASE = 'https://x.supabase.co'
const BASE = `${SUPABASE}/functions/v1/ai-chat-agent`
const MEDIA = 'https://pub-abc.r2.dev'
const STORE_PREFIX = `${MEDIA}/aka-agent/ai-chat/`
const stored = (path) => `${STORE_PREFIX}${path}`
const PNG_PATH = '9/7/0b7d6a2e-8a3b-4d55-9c1e-6f1c2f0e4f10.png'
const JPG_PATH = '9/7/1b7d6a2e-8a3b-4d55-9c1e-6f1c2f0e4f10.jpg'
const GONE_PATH = '9/7/2b7d6a2e-8a3b-4d55-9c1e-6f1c2f0e4f10.webp'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])
const files = new Map([[PNG_PATH, PNG], [JPG_PATH, JPG]])

// Hội thoại 45: câu 1 (id 122) đã hoàn thành có 1 ảnh; câu 2 (id 123) đang chờ có 4 phần tử ảnh.
const messages = {
  122: { id: 122, threadId: 45, seq: 1, question: 'Câu trước', images: [stored(JPG_PATH)], status: 'hoàn thành' },
  123: { id: 123, threadId: 45, seq: 2, question: 'Xem giúp ảnh', status: 'chờ câu trả lời',
    images: [stored(PNG_PATH), 'https://example.com/anh-ngoai.png', stored(GONE_PATH), `${MEDIA}/aka-agent/staff-7/2026/11/tep-thu-vien.png`] },
  124: { id: 124, threadId: 46, seq: 1, question: 'Không ảnh', images: [], status: 'chờ câu trả lời' },
}
const downloads = []
const readerCalls = []
const reader = async (action, payload) => {
  readerCalls.push([action, payload])
  if (action === 'message') {
    const message = messages[payload.messageId]
    if (!message || (payload.staffId !== undefined && Number(payload.staffId) !== 7)) return { data: null, error: { code: 'P0002', message: 'ai_chat_message_not_found' } }
    return { data: { final: message.status === 'hoàn thành', message, thread: { id: message.threadId } }, error: null }
  }
  if (action === 'thread') {
    const list = Object.values(messages).filter((m) => m.threadId === Number(payload.threadId) && m.seq > Number(payload.afterSeq ?? 0)).sort((a, b) => a.seq - b.seq)
    if (!Object.values(messages).some((m) => m.threadId === Number(payload.threadId))) return { data: null, error: { code: 'P0002', message: 'ai_chat_thread_not_found' } }
    return { data: { thread: { id: Number(payload.threadId) }, messages: list.slice(0, payload.limit ?? 50), hasMore: false }, error: null }
  }
  return { data: null, error: { code: '22023', message: 'ai_chat_invalid_action' } }
}
const question = () => ({ messageId: 123, threadId: 45, seq: 2, question: 'Xem giúp ảnh', images: [...messages[123].images], status: 'đang tìm câu trả lời', claimToken: 'bi-mat',
  history: [{ seq: 1, question: 'Câu trước', images: [...messages[122].images], answer: '...', status: 'hoàn thành' }] })
const rpc = async (action) => {
  if (action === 'list') return { data: { enabled: true, items: [{ messageId: 123, threadId: 45, seq: 2, images: [...messages[123].images] }, { messageId: 124, threadId: 46, seq: 1, images: [] }] }, error: null }
  if (action === 'claim') return { data: { enabled: true, items: [question()] }, error: null }
  return { data: { ok: true }, error: null }
}
const images = {
  prefix: async () => STORE_PREFIX,
  download: async (url) => { downloads.push(url); return files.get(url.slice(STORE_PREFIX.length)) ?? null },
}
const handler = createAiChatAgentHandler({ rpc, reader, insert: async () => ({ data: { ok: true }, error: null }), images, publicBaseUrl: `${BASE}/` })
const get = (path, init = {}) => handler(new Request(BASE + path, { method: 'GET', redirect: 'manual', ...init }))
const post = (path, body) => handler(new Request(BASE + path, { method: 'POST', body: JSON.stringify(body) }))
const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer())
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index])

// ─── Link tải ảnh trong /list, /next, /start ───
let r = await (await get('/list')).json()
ok(r.ok && JSON.stringify(r.questions[0].imageDownloads) === JSON.stringify([0, 1, 2, 3].map((i) => `${BASE}/image?messageId=123&index=${i}`))
  && JSON.stringify(r.questions[1].imageDownloads) === '[]' && r.questions[0].images.length === 4, 'list: mỗi câu có imageDownloads cùng thứ tự với images; câu không ảnh là mảng rỗng')
r = await (await post('/next', { agent: 'claude-code' })).json()
ok(r.ok && r.question.imageDownloads.length === 4 && r.question.imageDownloads[0] === `${BASE}/image?messageId=123&index=0`
  && JSON.stringify(r.question.history[0].imageDownloads) === JSON.stringify([`${BASE}/image?threadId=45&seq=1&index=0`]) && !('claimToken' in r.question),
  'next: câu đã nhận có imageDownloads; câu trong history tải theo threadId + seq; không lộ claimToken')
r = await (await post('/start', { messageId: 123 })).json()
ok(r.ok && r.question.imageDownloads.length === 4, 'start: câu đã nhận có imageDownloads')
const bare = createAiChatAgentHandler({ rpc, reader, insert: async () => ({ data: { ok: true }, error: null }) })
r = await (await bare(new Request(BASE + '/next', { method: 'POST', body: '{}' }))).json()
ok(r.ok && !('imageDownloads' in r.question), 'không cấu hình publicBaseUrl thì không thêm imageDownloads (phản hồi như bản 4)')

// ─── /image: ảnh trong kho ───
let res = await get('/image?messageId=123&index=0')
ok(res.status === 200 && res.headers.get('content-type') === 'image/png' && res.headers.get('content-length') === String(PNG.length)
  && res.headers.get('x-content-type-options') === 'nosniff' && res.headers.get('cache-control') === 'no-store' && res.headers.get('x-ai-chat-image-count') === '4'
  && /filename="cau-hoi-123-anh-1\.png"/.test(res.headers.get('content-disposition') ?? '') && same(await bytesOf(res), PNG),
  'image: GET theo messageId + index trả đúng tệp, đúng kiểu nội dung')
ok(downloads.at(-1) === stored(PNG_PATH), 'image: tải đúng URL của ảnh trong kho media')
res = await get('/image?messageId=123')
ok(res.status === 200 && same(await bytesOf(res), PNG), 'image: không gửi index thì lấy ảnh đầu tiên')
res = await post('/image', { messageId: '123', index: '0' })
ok(res.status === 200 && same(await bytesOf(res), PNG), 'image: POST với body JSON cũng được')
res = await get('/image?threadId=45&seq=1&index=0')
ok(res.status === 200 && res.headers.get('content-type') === 'image/jpeg' && same(await bytesOf(res), JPG)
  && JSON.stringify(readerCalls.at(-1)) === JSON.stringify(['thread', { threadId: 45, afterSeq: 0, limit: 1 }]), 'image: ảnh của câu trong history lấy theo threadId + seq')
r = await (await get('/image?messageId=123&index=0&format=json')).json()
ok(r.ok && r.external === false && r.mimeType === 'image/png' && r.sizeBytes === PNG.length && r.count === 4 && r.fileName === 'cau-hoi-123-anh-1.png'
  && same(Uint8Array.from(atob(r.dataBase64), (c) => c.charCodeAt(0)), PNG), 'image: format=json trả ảnh dạng base64 cho agent không nhận được tệp nhị phân')

// ─── /image: ảnh ngoài (bên hỏi qua /ask gửi URL công khai) ───
res = await get('/image?messageId=123&index=1')
r = await res.json()
ok(res.status === 302 && res.headers.get('location') === 'https://example.com/anh-ngoai.png' && r.external === true && r.url === 'https://example.com/anh-ngoai.png',
  'image: ảnh ngoài thì chuyển hướng tới URL gốc (function không tải hộ)')
r = await (await get('/image?messageId=123&index=1&format=json')).json()
ok(r.ok && r.external === true && r.url === 'https://example.com/anh-ngoai.png' && !('dataBase64' in r), 'image: ảnh ngoài với format=json trả URL, không tải hộ')
const before = downloads.length
await get('/image?messageId=123&index=1')
ok(downloads.length === before, 'image: ảnh ngoài thì function không tải gì')

// ─── /image: các ca lỗi ───
res = await get('/image?messageId=123&index=2')
r = await res.json()
ok(res.status === 404 && r.code === 'ai_chat_image_not_found', 'image: tệp không còn trong kho: 404 ai_chat_image_not_found')
res = await get('/image?messageId=123&index=3')
ok(res.status === 302 && res.headers.get('location') === `${MEDIA}/aka-agent/staff-7/2026/11/tep-thu-vien.png` && downloads.at(-1) !== `${MEDIA}/aka-agent/staff-7/2026/11/tep-thu-vien.png`,
  'image: URL cùng kho media nhưng ngoài thư mục ảnh câu hỏi: không tải hộ, chỉ chuyển hướng')
res = await get('/image?messageId=123&index=9')
ok(res.status === 404 && (await res.json()).code === 'ai_chat_image_not_found', 'image: index vượt số ảnh: 404')
res = await get('/image?messageId=124&index=0')
ok(res.status === 404 && (await res.json()).code === 'ai_chat_image_not_found', 'image: câu không có ảnh: 404')
res = await get('/image?messageId=999')
ok(res.status === 404 && (await res.json()).code === 'ai_chat_message_not_found', 'image: không có câu hỏi: 404 ai_chat_message_not_found')
res = await get('/image?threadId=45&seq=9')
ok(res.status === 404 && (await res.json()).code === 'ai_chat_message_not_found', 'image: hội thoại không có câu số đó: 404')
res = await get('/image?threadId=99&seq=1')
ok(res.status === 404 && (await res.json()).code === 'ai_chat_thread_not_found', 'image: không có hội thoại: 404 ai_chat_thread_not_found')
res = await get('/image?index=0')
ok(res.status === 400 && (await res.json()).code === 'ai_chat_image_ref_required', 'image: thiếu messageId và threadId + seq: 400')
res = await get('/image?threadId=45')
ok(res.status === 400 && (await res.json()).code === 'ai_chat_image_ref_required', 'image: có threadId mà thiếu seq: 400')
res = await get('/image?messageId=123&staffId=8')
ok(res.status === 404 && (await res.json()).code === 'ai_chat_message_not_found', 'image: gửi staffId không phải chủ câu hỏi: 404')
res = await get('/image?messageId=123&staffId=7')
ok(res.status === 200, 'image: gửi đúng staffId thì tải được')
res = await handler(new Request(BASE + '/image?messageId=123', { method: 'PUT' }))
ok(res.status === 405, 'image: phương thức khác GET, POST: 405')

// Kho ảnh lỗi tạm thời: 502, không lộ chi tiết.
messages[125] = { id: 125, threadId: 47, seq: 1, images: [stored(PNG_PATH)], status: 'chờ câu trả lời' }
const broken = createAiChatAgentHandler({ rpc, reader, insert: rpc, images: { prefix: async () => STORE_PREFIX, download: async () => { throw new Error('secret storage detail') } }, publicBaseUrl: BASE })
res = await broken(new Request(BASE + '/image?messageId=125', { method: 'GET' }))
r = await res.json()
ok(res.status === 502 && r.code === 'ai_chat_upstream_error' && !JSON.stringify(r).includes('secret'), 'image: kho media lỗi: 502, không lộ chi tiết')
const noConfig = createAiChatAgentHandler({ rpc, reader, insert: rpc, images: { prefix: async () => { throw new Error('db down') }, download: async () => PNG }, publicBaseUrl: BASE })
res = await noConfig(new Request(BASE + '/image?messageId=125', { method: 'GET' }))
ok(res.status === 502 && (await res.json()).code === 'ai_chat_upstream_error', 'image: không đọc được cấu hình kho media: 502')
const unset = createAiChatAgentHandler({ rpc, reader, insert: rpc, images: { prefix: async () => '', download: async () => PNG }, publicBaseUrl: BASE })
res = await unset(new Request(BASE + '/image?messageId=125', { method: 'GET', redirect: 'manual' }))
ok(res.status === 302 && res.headers.get('location') === stored(PNG_PATH), 'image: kho media chưa cấu hình: chuyển hướng tới URL của ảnh')
// Tệp lớn hơn 5 MB (không thể có qua app; chặn để function không trả tệp lớn bất thường).
const huge = createAiChatAgentHandler({ rpc, reader, insert: rpc, images: { prefix: async () => STORE_PREFIX, download: async () => new Uint8Array(5 * 1024 * 1024 + 1) }, publicBaseUrl: BASE })
res = await huge(new Request(BASE + '/image?messageId=125', { method: 'GET' }))
ok(res.status === 413 && (await res.json()).code === 'ai_chat_image_too_large', 'image: tệp lớn hơn 5 MB: 413')
// Function chưa nối kho media: mọi ảnh đều chuyển hướng tới URL của nó (URL của kho media mở thẳng được).
res = await bare(new Request(BASE + '/image?messageId=125', { method: 'GET', redirect: 'manual' }))
ok(res.status === 302 && res.headers.get('location') === stored(PNG_PATH), 'image: chưa nối kho media: chuyển hướng tới URL của ảnh')
// Có khóa AI_CHAT_AGENT_KEY: /image cũng phải gửi header.
const locked = createAiChatAgentHandler({ rpc, reader, insert: rpc, images, publicBaseUrl: BASE, agentKey: 'khoa' })
res = await locked(new Request(BASE + '/image?messageId=123', { method: 'GET' }))
ok(res.status === 401, 'image: có AI_CHAT_AGENT_KEY mà thiếu header: 401')
res = await locked(new Request(BASE + '/image?messageId=123', { method: 'GET', headers: { 'x-agent-key': 'khoa' } }))
ok(res.status === 200, 'image: đúng header x-agent-key thì tải được')

console.log(failed === 0 ? 'PASS (edge agent image)' : `FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
