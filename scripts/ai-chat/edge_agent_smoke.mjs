// Chạy handler của Edge Function ai-chat-agent trên Node, nối với hàm SQL thật của V488 + V492 qua psql (role service_role).
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
let insertReady = true
const insert = async (payload) => {
  if (!insertReady) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
  try {
    const out = sql(`SET ROLE service_role; SELECT public.aka_agent_ai_chat_insert(${lit(JSON.stringify(payload))}::jsonb)`)
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

const open = createAiChatAgentHandler({ rpc, insert })
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

// /ask: chèn câu hỏi từ nơi bất kỳ (V492). Đến đây nhân viên 1 không còn câu nào đang chờ.
const rows = () => sql(`SELECT (SELECT count(*) FROM public.ai_message_thread) || '/' || (SELECT count(*) FROM public.ai_message)`)
const before = rows()
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 11 })
ok(r.status === 400 && r.body.code === 'ai_chat_question_required', 'ask: thiếu question')
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 11, question: '   ' })
ok(r.status === 400 && r.body.code === 'ai_chat_question_required', 'ask: question trống')
r = await call(open, '/ask', { campaignId: 11, question: 'Hỏi' })
ok(r.status === 400 && r.body.code === 'ai_chat_project_required', 'ask: thiếu projectCode')
r = await call(open, '/ask', { projectCode: 'khong-co', campaignId: 11, question: 'Hỏi' })
ok(r.status === 404 && r.body.code === 'ai_chat_agent_not_found', 'ask: agent không tồn tại là 404')
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', question: 'Hỏi' })
ok(r.status === 400 && r.body.code === 'ai_chat_staff_required', 'ask: không biết nhân viên nào')
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 999, question: 'Hỏi' })
ok(r.status === 404 && r.body.code === 'ai_chat_campaign_not_found', 'ask: chiến dịch không tồn tại là 404')
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 11, staffId: 3, question: 'Hỏi' })
ok(r.status === 403 && r.body.code === 'ai_chat_access_denied', 'ask: nhân viên đã nghỉ là 403')
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 20, question: 'Hỏi' })
ok(r.status === 403 && r.body.code === 'ai_chat_agent_unavailable', 'ask: agent chưa mở cho nhân viên này là 403')
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 11, question: 'Hỏi', source: 'zalo' })
ok(r.status === 400 && r.body.code === 'ai_chat_invalid_source', 'ask: source lạ')
r = await call(open, '/ask', null, { method: 'GET' })
ok(r.status === 405, 'ask bằng GET: 405')
ok(rows() === before, 'ask: các lỗi trên không ghi dòng nào')

r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 11, staffId: null, question: 'Chiến dịch nhắc lịch đã chạy chưa?' })
const asked = r.body
ok(r.status === 200 && asked.ok && asked.inserted === true && asked.status === 'chờ câu trả lời' && asked.source === 'api' && asked.seq === 1
  && asked.staffId === 1 && asked.organizationId === 1 && asked.campaignName === 'Nhắc lịch hẹn' && asked.project.code === 'hoi-dap-chien-dich'
  && /^[0-9a-f-]{36}$/.test(asked.requestId) && !Number.isNaN(Date.parse(asked.deadlineAt)),
  'ask: chỉ cần mã agent + chiến dịch + câu hỏi, không cần header nào; trả threadId/messageId')
ok(sql(`SELECT t.source || '|' || m.status || '|' || m.question FROM public.ai_message m JOIN public.ai_message_thread t ON t.id = m.thread_id WHERE m.id = ${asked.messageId}`)
  === 'api|chờ câu trả lời|Chiến dịch nhắc lịch đã chạy chưa?', 'ask: database có câu hỏi, nguồn api')
r = await call(open, '/list', {})
ok(r.body.count === 1 && r.body.questions[0].messageId === asked.messageId && r.body.questions[0].question === 'Chiến dịch nhắc lịch đã chạy chưa?',
  'ask → list: bộ trả lời thấy câu vừa chèn')
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 11, question: 'Câu thứ hai' })
ok(r.status === 409 && r.body.code === 'ai_chat_message_pending' && r.body.messageId === asked.messageId && r.body.threadId === asked.threadId
  && r.body.status === 'chờ câu trả lời', 'ask: cùng agent + chiến dịch đang có câu chờ thì 409 kèm câu đang chờ')
r = await call(open, '/ask', { threadId: asked.threadId, question: 'Hỏi tiếp' })
ok(r.status === 409 && r.body.code === 'ai_chat_message_pending', 'ask hỏi tiếp khi câu trước chưa xong: 409')

await call(open, '/start', { messageId: asked.messageId })
r = await call(open, '/answer', { messageId: asked.messageId, answer: 'Đã chạy lúc 9 giờ.', answerJson: { tom_tat: 'Đã chạy lúc 9 giờ.' } })
ok(r.status === 200 && r.body.status === 'hoàn thành', 'ask → start → answer: câu chèn qua API được trả lời như câu từ app')
const followId = '00000000-0000-4000-8000-0000000000f1'
r = await call(open, '/ask', { threadId: asked.threadId, question: 'Vậy hôm nay gửi được bao nhiêu?', requestId: followId })
const follow = r.body
ok(r.status === 200 && follow.inserted === true && follow.threadId === asked.threadId && follow.seq === 2 && follow.requestId === followId,
  'ask hỏi tiếp: chỉ cần threadId + question')
r = await call(open, '/ask', { threadId: asked.threadId, question: 'Vậy hôm nay gửi được bao nhiêu?', requestId: followId })
ok(r.status === 200 && r.body.inserted === false && r.body.messageId === follow.messageId, 'ask: gửi lại cùng requestId không tạo câu thứ hai')
r = await call(open, '/ask', { threadId: 999999, question: 'Hỏi' })
ok(r.status === 404 && r.body.code === 'ai_chat_thread_not_found', 'ask: hội thoại không tồn tại là 404')
await call(open, '/ask', { projectId: asked.project.id, campaignId: 31, staffId: 1, organizationId: 1, question: 'Loạt 1?', source: 'desktop' })
await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 34, question: 'Loạt 4?' })
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 35, question: 'Loạt 5?' })
ok(r.status === 429 && r.body.code === 'ai_chat_too_many_pending', 'ask: nhân viên đã có 3 câu chờ thì 429')
ok(sql(`SELECT string_agg(source, ',' ORDER BY id) FROM public.ai_message_thread WHERE campaign_id IN (11, 31, 34)`) === 'api,desktop,api', 'ask: source ghi đúng theo body')

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

const locked = createAiChatAgentHandler({ rpc, insert, agentKey: 'bi-mat' })
r = await call(locked, '/list', {})
ok(r.status === 401, 'có AI_CHAT_AGENT_KEY: thiếu header bị từ chối')
r = await call(locked, '/list', {}, { headers: { 'x-agent-key': 'bi-mat' } })
ok(r.status === 200, 'có AI_CHAT_AGENT_KEY: đúng header thì qua')
r = await call(locked, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 36, question: 'Hỏi' })
ok(r.status === 401, 'có AI_CHAT_AGENT_KEY: /ask thiếu header cũng bị từ chối')

insertReady = false
r = await call(open, '/ask', { projectCode: 'hoi-dap-chien-dich', campaignId: 36, question: 'Hỏi' })
ok(r.status === 503 && r.body.code === 'ai_chat_not_ready' && r.body.message.includes('V492'), 'database chưa có V492: /ask trả 503, các đường khác vẫn chạy')
r = await call(open, '/list', {})
ok(r.status === 200, 'database chưa có V492: /list vẫn 200')

rpcReady = false
r = await call(open, '/list', {})
ok(r.status === 503 && r.body.code === 'ai_chat_not_ready', 'database chưa có V488: 503 ai_chat_not_ready')

console.log(failed === 0 ? 'PASS (edge agent)' : `FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
