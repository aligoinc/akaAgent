// Đường Desktop của Hỏi đáp AI: createAiChatIpcTransport + AiChatThreadController (src/shared) gọi RPC Desktop
// `aka_agent_ai_chat` thật qua psql (role aka_agent_desktop + claim JWT), bộ trả lời gọi RPC worker bằng service_role.
import { execFileSync } from 'node:child_process'
const [bundle, psqlBin, host, port] = process.argv.slice(2)
const { createAiChatIpcTransport, AiChatThreadController, AiChatAttentionController, newAiChatRequestId, aiChatErrorCode } = await import(bundle)

let failed = 0
const ok = (cond, label) => { console.log(`${cond ? 'ok' : 'not ok'} - ${label}`); if (!cond) failed += 1 }
const lit = text => `'${String(text).replace(/'/g, "''")}'`
const sql = statement => execFileSync(psqlBin, ['-X', '-h', host, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', statement],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const CLAIMS = `SET ROLE aka_agent_desktop; SELECT set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}', false);`

// Giả lập main process: cùng cách phân loại lỗi với aiChatRepository.toAiChatDesktopError.
let password = 'pw1'
const ipcCall = async (action, payload) => {
  try {
    const out = sql(`${CLAIMS} SELECT public.aka_agent_ai_chat(1, 1, 'ha', ${lit(password)}, ${lit(action)}, ${lit(JSON.stringify(payload))}::jsonb)`)
    return { ok: true, data: JSON.parse(out.split('\n').pop()) }
  } catch (error) {
    const message = /ERROR:\s+(.*)/.exec(String(error.stderr ?? error.message))?.[1]?.trim() ?? ''
    const code = /(?:^|[^a-z_])(ai_chat_[a-z_]+)/.exec(message)?.[1]
    if (code) return { ok: false, code, message: code }
    if (/automation_auth_(?:required|invalid)|desktop_[a-z_]+_denied/.test(message)) return { ok: false, code: 'ai_chat_access_denied', message }
    return { ok: false, code: 'ai_chat_unavailable', message }
  }
}
const worker = (action, payload) => JSON.parse(sql(`SET ROLE service_role; SELECT public.aka_agent_ai_chat_worker(${lit(action)}, ${lit(JSON.stringify(payload))}::jsonb)`))
const transport = createAiChatIpcTransport(ipcCall)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (check, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await sleep(50) } return false }

const agents = await transport.agents()
const project = agents.groups[0]?.projects[0]
ok(agents.enabled && project?.code === 'hoi-dap-chien-dich' && agents.limits.maxPendingPerStaff === 3, 'agents: Desktop thấy agent và giới hạn')

const opened = await transport.open({ requestId: newAiChatRequestId(), projectId: project.id, campaignId: 10, question: 'Tại sao chiến dịch không chạy?', intake: {} })
ok(opened.changed && opened.thread.source === 'desktop' && opened.thread.campaignName === 'Chăm sóc khách tháng 11' && opened.messages[0].status === 'chờ câu trả lời',
  'open: tạo hội thoại nguồn desktop, câu đầu đang chờ')
const threadId = opened.thread.id
const pending = await transport.pending()
ok(pending.items.length === 1 && pending.items[0].id === threadId && pending.items[0].pending, 'pending: hội thoại đang chờ nằm trong danh sách cần chú ý')

// Bộ điều khiển dùng chung: tự hỏi lại theo nhịp và thấy câu trả lời do bộ trả lời ghi.
const settled = []
const attention = new AiChatAttentionController({ transport })
const controller = new AiChatThreadController({ transport, onSettled: (thread, message) => settled.push(message.status), onPendingChanged: () => { void attention.refresh() } })
controller.setVisible(true)
controller.adopt(opened)
ok(controller.getState().thread?.id === threadId && controller.getState().messages.length === 1, 'controller: nhận ảnh chụp từ modal, không gọi lại server')
const firstId = opened.messages[0].id
worker('claim', { workerId: 'smoke', messageId: firstId, stage: 'working' })
ok(await until(() => controller.getState().messages[0]?.status === 'đang tìm câu trả lời'), 'controller: thấy trạng thái "đang tìm câu trả lời"')
worker('answer', { messageId: firstId, answer: 'Chiến dịch đã chạm hạn mức ngày.', answerJson: { tom_tat: 'Chạm hạn mức ngày.' }, complete: true })
ok(await until(() => controller.getState().messages[0]?.status === 'hoàn thành'), 'controller: thấy câu trả lời khi hoàn thành')
ok(controller.getState().messages[0].answer === 'Chiến dịch đã chạm hạn mức ngày.' && settled[0] === 'hoàn thành', 'controller: nội dung trả lời đúng, có báo kết thúc')

await controller.ask('Vậy khi nào chạy tiếp?')
ok(controller.getState().messages.length === 2 && controller.getState().messages[1].status === 'chờ câu trả lời', 'ask: hỏi tiếp trong cùng hội thoại')
const blocked = await transport.ask(threadId, { requestId: newAiChatRequestId(), question: 'Hỏi chồng' }).then(() => null, error => aiChatErrorCode(error))
ok(blocked === 'ai_chat_message_pending', 'ask: đang chờ thì không hỏi thêm được (mã lỗi tới được renderer)')
await controller.cancel()
ok(controller.getState().messages[1].status === 'đã hủy', 'cancel: dừng câu đang chờ')
await controller.retry()
ok(controller.getState().messages[1].status === 'chờ câu trả lời', 'retry: hỏi lại câu đã dừng')
const secondId = controller.getState().messages[1].id
worker('claim', { workerId: 'smoke', messageId: secondId, stage: 'working' })
worker('fail', { messageId: secondId, stopped: true, errorMessage: 'Trợ lý tạm dừng để bảo trì.' })
ok(await until(() => controller.getState().messages[1]?.status === 'đã hủy' && controller.getState().messages[1].errorMessage === 'Trợ lý tạm dừng để bảo trì.'),
  'controller: bộ trả lời dừng thì thấy "đã hủy" kèm lý do')

await controller.rate(firstId, 1)
ok(controller.getState().messages[0].rating === 1, 'rate: đánh giá câu trả lời')
await controller.markRead()
const page = await transport.threads({ campaignId: 10 })
ok(page.items.length === 1 && page.items[0].id === threadId && page.items[0].unread === false, 'threads: lịch sử theo chiến dịch, đã đọc')
const older = await transport.olderMessages(threadId, 2)
ok(older.messages.length === 1 && older.messages[0].id === firstId, 'messages: tải tin cũ hơn')
const other = await transport.open({ requestId: newAiChatRequestId(), projectId: project.id, campaignId: 20, question: 'Chiến dịch của người khác' }).then(() => null, error => aiChatErrorCode(error))
ok(other === 'ai_chat_campaign_not_found', 'open: chiến dịch của nhân viên khác bị từ chối')

password = 'sai'
const denied = await transport.agents().then(() => null, error => aiChatErrorCode(error))
ok(denied === 'ai_chat_access_denied', 'sai mật khẩu phiên: ai_chat_access_denied')
controller.dispose()
attention.clear()
console.log(failed === 0 ? 'PASS (desktop transport)' : `FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
