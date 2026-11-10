// Phần riêng của Desktop cho Hỏi đáp AI (V488). `aiChat.ts` chép nguyên văn từ akaAgentWebApp
// `packages/control-api/src/aiChat.ts` (sửa ở WebApp trước rồi chép lại); tệp này chỉ nối hợp đồng đó với IPC.
import {
  AI_CHAT_UNAVAILABLE, aiChatErrorMessage, parseAiChatAgents, parseAiChatMessagePage, parseAiChatPendingList,
  parseAiChatReadResult, parseAiChatSnapshot, parseAiChatThreadPage, type AiChatTransport
} from './aiChat'

export const AI_CHAT_IPC = { call: 'ai-chat:call' } as const

/** Đúng các action phía app của RPC `aka_agent_ai_chat`; main process từ chối mọi action khác. */
export const AI_CHAT_DESKTOP_ACTIONS = [
  'agents', 'open', 'ask', 'retry', 'sync', 'sync_pending', 'threads', 'messages', 'cancel', 'rate', 'mark_read'
] as const
export type AiChatDesktopAction = (typeof AI_CHAT_DESKTOP_ACTIONS)[number]

export type AiChatIpcResult = { ok: true; data: unknown } | { ok: false; code: string; message: string }
export type AiChatIpcCall = (action: AiChatDesktopAction, payload: Record<string, unknown>) => Promise<AiChatIpcResult>

/** Lỗi mang `code` là mã `ai_chat_*` để bộ điều khiển dùng chung phân loại (xem `aiChatErrorCode`). */
export class AiChatDesktopError extends Error {
  constructor(readonly code: string, message = aiChatErrorMessage(code)) {
    super(message)
    this.name = 'AiChatDesktopError'
  }
}

export function isAiChatDesktopAction(value: unknown): value is AiChatDesktopAction {
  return typeof value === 'string' && (AI_CHAT_DESKTOP_ACTIONS as readonly string[]).includes(value)
}

/**
 * `AiChatTransport` chạy qua IPC: renderer gửi (action, payload), main gọi RPC bằng phiên đang đăng nhập.
 * IPC không hủy được giữa chừng; `signal` chỉ để bỏ qua kết quả về muộn.
 */
export function createAiChatIpcTransport(call: AiChatIpcCall): AiChatTransport {
  const run = async <T>(action: AiChatDesktopAction, payload: Record<string, unknown>, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> => {
    const aborted = () => new DOMException('Aborted', 'AbortError')
    if (signal?.aborted) throw aborted()
    let result: AiChatIpcResult
    try {
      result = await call(action, payload)
    } catch {
      throw new AiChatDesktopError(AI_CHAT_UNAVAILABLE)
    }
    if (signal?.aborted) throw aborted()
    if (!result.ok) throw new AiChatDesktopError(result.code, result.message)
    return parse(result.data)
  }
  return {
    agents: (groupCode, signal) => run('agents', groupCode ? { groupCode } : {}, parseAiChatAgents, signal),
    open: request => run('open', { ...request }, parseAiChatSnapshot),
    ask: (threadId, request) => run('ask', { threadId, ...request }, parseAiChatSnapshot),
    sync: (threadId, afterRevision, signal) => run('sync', { threadId, afterRevision }, parseAiChatSnapshot, signal),
    pending: signal => run('sync_pending', {}, parseAiChatPendingList, signal),
    threads: (query = {}, signal) => run('threads', {
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: { lastMessageAt: query.cursor.lastMessageAt, id: query.cursor.id } } : {})
    }, parseAiChatThreadPage, signal),
    olderMessages: (threadId, beforeSeq, signal) => run('messages', { threadId, beforeSeq }, parseAiChatMessagePage, signal),
    cancel: (threadId, messageId, afterRevision) => run('cancel', { threadId, messageId, afterRevision }, parseAiChatSnapshot),
    retry: (threadId, messageId, afterRevision) => run('retry', { threadId, messageId, afterRevision }, parseAiChatSnapshot),
    rate: (threadId, messageId, rating, afterRevision, note) =>
      run('rate', { threadId, messageId, rating, afterRevision, ...(note ? { note } : {}) }, parseAiChatSnapshot),
    markRead: (threadId, seq) => run('mark_read', { threadId, seq }, parseAiChatReadResult)
  }
}
