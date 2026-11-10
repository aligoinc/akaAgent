// Chạy handler của Edge Function ai-chat-agent trên Node, nối với hàm SQL thật của V488 qua psql (role service_role).
import { execFileSync } from 'node:child_process'
import { createAiChatAgentHandler } from '../../supabase/functions/ai-chat-agent/handler.ts'

const [psqlBin, host, port] = process.argv.slice(2)
let failed = 0
const ok = (cond, label) => { console.log(`${cond ? 'ok' : 'not ok'} - ${label}`); if (!cond) failed += 1 }
const lit = (text) => `'${String(text).replace(/'/g, "''")}'`
const sql = (statement) => execFileSync(psqlBin, ['-X', '-h', host, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', statement],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

let rpcReady = true
const rpc = async (action, payload) => {
  if (!rpcReady) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
  try {
    const out = sql(`SET ROLE service_role; SELECT public.aka_agent_ai_chat_worker(${lit(action)}, ${lit(JSON.stringify(payload))}::jsonb)`)
    return { data: JSON.parse(out), error: null }
  } catch (error) {
    const match = /ERROR:\s+(.*)/.exec(String(error.stderr ?? error.message))
    return { data: null, error: { code: '22023', message: match ? match[1].trim() : 'unknown' } }
  }
}
const base = 'https://x.supabase.co/functions/v1/ai-chat-agent'
const call = async (handler, path, body, init = {}) => {
  const res = await handler(new Request(base + path, { method: init.method ?? 'POST', headers: init.headers,
    body: (init.method ?? 'POST') === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body ?? {}) }))
  return { status: res.status, body: await res.json() }
}
const ask = (campaignId, question, n) => Number(sql(`SELECT (public.aka_agent_control_ai_chat(1, 1, 'web', 'open', jsonb_build_object(
  'requestId', '00000000-0000-4000-8000-0000000000${n}', 'projectId', (SELECT id FROM public.ai_project WHERE code = 'hoi-dap-chien-dich'),
  'campaignId', ${campaignId}, 'question', ${lit(question)})) #>> '{messages,0,id}')`))

const open = createAiChatAgentHandler({ rpc })
const first = ask(10, 'Tại sao chiến dịch không chạy?', '31')
const second = ask(33, 'Hôm nay gửi được bao nhiêu?', '32')

let r = await call(open, '/list', {})
ok(r.status === 200 && r.body.ok && r.body.count === 2 && r.body.questions[0].messageId === first && r.body.questions[0].status === 'chờ câu trả lời'
  && r.body.questions[0].thread.campaignName === 'Chăm sóc khách tháng 11' && !('claimToken' in r.body.questions[0]), 'list: trả câu đang chờ, cũ nhất trước, không cần header nào')
r = await call(open, '/list?limit=1', null, { method: 'GET' })
ok(r.status === 200 && r.body.count === 1, 'list: GET + limit')
ok(sql(`SELECT status FROM public.ai_message WHERE id = ${first}`) === 'chờ câu trả lời', 'list: không đổi trạng thái')

r = await call(open, '/start', { agent: 'claude-desktop' })
ok(r.status === 400 && r.body.code === 'ai_chat_invalid_request', 'start: thiếu messageId')
r = await call(open, '/answer', { messageId: first, answer: 'x', answerJson: { tom_tat: 'x' } })
ok(r.status === 409 && r.body.code === 'not_claimed' && r.body.status === 'chờ câu trả lời', 'answer: chưa /start thì chưa ghi được')
r = await call(open, '/start', { messageId: first, agent: 'claude-desktop' })
ok(r.status === 200 && r.body.question.messageId === first && r.body.question.status === 'đang tìm câu trả lời' && !('claimToken' in r.body.question)
  && r.body.question.project.outputSchema.required[0] === 'tom_tat' && r.body.question.project.rules !== '' && Array.isArray(r.body.question.history),
  'start: chuyển sang "đang tìm câu trả lời", trả quy tắc + schema + lịch sử, không có token nào')
ok(sql(`SELECT status || '|' || worker_id FROM public.ai_message WHERE id = ${first}`) === 'đang tìm câu trả lời|claude-desktop', 'start: database ghi đúng trạng thái và tên agent')
r = await call(open, '/start', { messageId: first })
ok(r.status === 409 && r.body.code === 'not_waiting', 'start: câu đã nhận thì không nhận lần hai')
r = await call(open, '/list', {})
ok(r.body.count === 1 && r.body.questions[0].messageId === second, 'list: câu đang xử lý không còn trong danh sách')

r = await call(open, '/answer', { messageId: first, answer: 'Chiến dịch đã chạm hạn mức ngày.' })
ok(r.status === 400 && r.body.code === 'ai_chat_answer_schema_mismatch', 'answer: thiếu answerJson theo outputSchema')
r = await call(open, '/answer', { messageId: first, answer: '  ', answerJson: { tom_tat: 'x' } })
ok(r.status === 400 && r.body.code === 'ai_chat_answer_required', 'answer: thiếu nội dung')
r = await call(open, '/answer', { messageId: first, answer: 'Chiến dịch đã chạm hạn mức ngày.', answerJson: { tom_tat: 'Chạm hạn mức ngày.' } })
ok(r.status === 200 && r.body.status === 'hoàn thành' && !Number.isNaN(Date.parse(r.body.answeredAt)), 'answer: chỉ cần messageId + nội dung, trả thời gian trả lời')
ok(sql(`SELECT status || '|' || answer || '|' || (answered_at IS NOT NULL AND completed_at IS NOT NULL AND claim_token IS NULL)::text FROM public.ai_message WHERE id = ${first}`)
  === 'hoàn thành|Chiến dịch đã chạm hạn mức ngày.|true', 'answer: database lưu nội dung, thời gian trả lời, trạng thái hoàn thành')
ok(sql(`SELECT (public.aka_agent_control_ai_chat(1, 1, 'web', 'sync', jsonb_build_object('threadId', (SELECT thread_id FROM public.ai_message WHERE id = ${first}))) #>> '{messages,0,answer}')`)
  === 'Chiến dịch đã chạm hạn mức ngày.', 'answer: app đọc được câu trả lời qua đồng bộ')
r = await call(open, '/answer', { messageId: first, answer: 'lần hai', answerJson: { tom_tat: 'x' } })
ok(r.status === 409, 'answer: trả lời lần hai bị từ chối')
r = await call(open, '/status', { messageId: first, status: 'lỗi' })
ok(r.status === 409 && r.body.status === 'hoàn thành', 'status: câu đã hoàn thành không đổi trạng thái được')

await call(open, '/start', { messageId: second })
r = await call(open, '/status', { messageId: second })
ok(r.status === 400 && r.body.code === 'ai_chat_invalid_status', 'status: thiếu status')
r = await call(open, '/status', { messageId: second, status: 'hoàn thành' })
ok(r.status === 400 && r.body.code === 'ai_chat_invalid_status', 'status: không nhận trạng thái ngoài lỗi/dừng/chờ câu trả lời')
r = await call(open, '/status', { messageId: second, status: 'chờ câu trả lời' })
ok(r.status === 200 && r.body.status === 'chờ câu trả lời' && r.body.requeued === true, 'status "chờ câu trả lời": trả câu về hàng đợi')
await call(open, '/start', { messageId: second })
r = await call(open, '/status', { messageId: second, status: 'lỗi', message: 'Chưa đủ dữ liệu để trả lời.' })
ok(r.status === 200 && r.body.status === 'lỗi' && r.body.requeued === false, 'status "lỗi": chuyển lỗi')
ok(sql(`SELECT status || '|' || error_message FROM public.ai_message WHERE id = ${second}`) === 'lỗi|Chưa đủ dữ liệu để trả lời.', 'status "lỗi": lưu câu báo cho khách')
const third = Number(sql(`SELECT (public.aka_agent_control_ai_chat(1, 1, 'web', 'retry', jsonb_build_object('threadId', (SELECT thread_id FROM public.ai_message WHERE id = ${second}), 'messageId', ${second})) #>> '{messages,0,id}')`))
await call(open, '/start', { messageId: third })
r = await call(open, '/status', { messageId: third, status: 'dừng', message: 'Trợ lý tạm dừng để bảo trì.' })
ok(r.status === 200 && r.body.status === 'đã hủy', 'status "dừng": chuyển đã hủy (app hiện "Đã dừng")')
ok(sql(`SELECT status || '|' || error_message || '|' || (completed_at IS NOT NULL)::text FROM public.ai_message WHERE id = ${third}`) === 'đã hủy|Trợ lý tạm dừng để bảo trì.|true', 'status "dừng": lưu lý do')

r = await call(open, '/khac', {})
ok(r.status === 404, 'đường dẫn lạ: 404')
r = await call(open, '/fail', {})
ok(r.status === 404, '/fail cũ không còn')
r = await call(open, '/start', null, { method: 'GET' })
ok(r.status === 405, 'start bằng GET: 405')
r = await call(open, '/start', '[1]')
ok(r.status === 400, 'body không phải object: 400')
r = await call(open, '/answer', '{sai json')
ok(r.status === 400, 'body không phải JSON: 400')

const locked = createAiChatAgentHandler({ rpc, agentKey: 'bi-mat' })
r = await call(locked, '/list', {})
ok(r.status === 401, 'có AI_CHAT_AGENT_KEY: thiếu header bị từ chối')
r = await call(locked, '/list', {}, { headers: { 'x-agent-key': 'bi-mat' } })
ok(r.status === 200, 'có AI_CHAT_AGENT_KEY: đúng header thì qua')

rpcReady = false
r = await call(open, '/list', {})
ok(r.status === 503 && r.body.code === 'ai_chat_not_ready', 'database chưa có V488: 503 ai_chat_not_ready')

console.log(failed === 0 ? 'PASS (edge agent)' : `FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
