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
r = await call(open, '/start', { messageId: first, agent: 'claude-desktop' })
const token = r.body.question?.claimToken
ok(r.status === 200 && r.body.question.messageId === first && r.body.question.status === 'đang tìm câu trả lời' && /^[0-9a-f-]{36}$/.test(token)
  && r.body.question.project.outputSchema.required[0] === 'tom_tat' && r.body.question.project.rules !== '' && Array.isArray(r.body.question.history),
  'start: chuyển sang "đang tìm câu trả lời", trả claimToken + quy tắc + schema + lịch sử')
ok(sql(`SELECT status || '|' || worker_id FROM public.ai_message WHERE id = ${first}`) === 'đang tìm câu trả lời|claude-desktop', 'start: database ghi đúng trạng thái và tên agent')
r = await call(open, '/start', { messageId: first })
ok(r.status === 409 && r.body.code === 'not_waiting', 'start: câu đã nhận thì agent thứ hai bị từ chối')
r = await call(open, '/list', {})
ok(r.body.count === 1 && r.body.questions[0].messageId === second, 'list: câu đang xử lý không còn trong danh sách')

r = await call(open, '/answer', { messageId: first, answer: 'x', answerJson: { tom_tat: 'x' } })
ok(r.status === 400 && r.body.code === 'ai_chat_invalid_request', 'answer: thiếu claimToken')
r = await call(open, '/answer', { messageId: first, claimToken: '00000000-0000-4000-8000-00000000dead', answer: 'x', answerJson: { tom_tat: 'x' } })
ok(r.status === 409 && r.body.code === 'not_claimed', 'answer: sai claimToken')
r = await call(open, '/answer', { messageId: first, claimToken: token, answer: 'Chiến dịch đã chạm hạn mức ngày.' })
ok(r.status === 400 && r.body.code === 'ai_chat_answer_schema_mismatch', 'answer: thiếu answerJson theo outputSchema')
r = await call(open, '/answer', { messageId: first, claimToken: token, answer: '  ', answerJson: { tom_tat: 'x' } })
ok(r.status === 400 && r.body.code === 'ai_chat_answer_required', 'answer: thiếu nội dung')
r = await call(open, '/answer', { messageId: first, claimToken: token, answer: 'Chiến dịch đã chạm hạn mức ngày.', answerJson: { tom_tat: 'Chạm hạn mức ngày.' } })
ok(r.status === 200 && r.body.status === 'hoàn thành' && !Number.isNaN(Date.parse(r.body.answeredAt)), 'answer: hoàn thành, trả thời gian trả lời')
ok(sql(`SELECT status || '|' || answer || '|' || (answered_at IS NOT NULL AND completed_at IS NOT NULL AND claim_token IS NULL)::text FROM public.ai_message WHERE id = ${first}`)
  === 'hoàn thành|Chiến dịch đã chạm hạn mức ngày.|true', 'answer: database lưu nội dung, thời gian trả lời, trạng thái hoàn thành')
ok(sql(`SELECT (public.aka_agent_control_ai_chat(1, 1, 'web', 'sync', jsonb_build_object('threadId', (SELECT thread_id FROM public.ai_message WHERE id = ${first}))) #>> '{messages,0,answer}')`)
  === 'Chiến dịch đã chạm hạn mức ngày.', 'answer: app đọc được câu trả lời qua đồng bộ')
r = await call(open, '/answer', { messageId: first, claimToken: token, answer: 'lần hai', answerJson: { tom_tat: 'x' } })
ok(r.status === 409, 'answer: trả lời lần hai bị từ chối')

r = await call(open, '/start', { messageId: second })
const token2 = r.body.question.claimToken
r = await call(open, '/fail', { messageId: second, claimToken: token2, message: 'Chưa đủ dữ liệu để trả lời.' })
ok(r.status === 200 && r.body.status === 'lỗi' && r.body.requeued === false, 'fail: báo lỗi cho khách')
ok(sql(`SELECT error_message FROM public.ai_message WHERE id = ${second}`) === 'Chưa đủ dữ liệu để trả lời.', 'fail: lưu câu báo cho khách')

r = await call(open, '/khac', {})
ok(r.status === 404, 'đường dẫn lạ: 404')
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
