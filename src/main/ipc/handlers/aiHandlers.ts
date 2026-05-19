import { ipcMain } from 'electron'
import { AiRewriteContentRequest, AiWriteMultiOtherContentRequest, IPC_EVENTS } from '../../../shared/types'
import { requireCurrentUser } from '../../data/currentUser'

const AKA_AI_BASE_URL = 'https://api.akaapp.vn'
const AKA_AI_SOURCE = 'aka_agent'
const AI_REQUEST_TIMEOUT_MS = 120_000

interface AkaAiResponse {
  status?: number | string
  data?: unknown
  message?: unknown
}

function requireContent(input: unknown): string {
  const content = typeof input === 'string' ? input.trim() : ''
  if (!content) {
    throw new Error('Vui lòng soạn 1 nội dung trong form nội dung.')
  }
  return content
}

function unwrapAiContent(payload: unknown): string {
  const response = payload as AkaAiResponse
  const ok = response?.status === 1 || response?.status === '1'
  if (!ok) {
    const message = typeof response?.message === 'string' && response.message.trim()
      ? response.message.trim()
      : 'AI không thể xử lý nội dung lúc này.'
    throw new Error(message)
  }
  if (typeof response.data !== 'string') {
    throw new Error('AI trả về nội dung không hợp lệ.')
  }
  return response.data
}

async function postAiContent(path: string, body: Record<string, unknown>): Promise<string> {
  requireCurrentUser()

  const response = await fetch(`${AKA_AI_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`AI trả về lỗi ${response.status}.`)
  }

  return unwrapAiContent(await response.json())
}

export function registerAiHandlers(): void {
  ipcMain.handle(IPC_EVENTS.AI_REWRITE_CONTENT, async (_, request: AiRewriteContentRequest) => {
    const content = requireContent(request?.content)
    return postAiContent('/api/AI/rewriteContent', {
      content,
      questionContentName: 'rewrite_content',
      source: AKA_AI_SOURCE
    })
  })

  ipcMain.handle(IPC_EVENTS.AI_WRITE_MULTI_OTHER_CONTENT, async (_, request: AiWriteMultiOtherContentRequest) => {
    const content = requireContent(request?.content)
    const countContent = Math.floor(Number(request?.countContent))
    if (!Number.isFinite(countContent) || countContent < 2) {
      throw new Error('Số lượng nội dung khác nhau phải từ 2 nội dung trở lên.')
    }

    return postAiContent('/api/AI/writeMultiOtherContent', {
      countContent,
      content,
      questionContentName: 'write_multi_other_content',
      source: AKA_AI_SOURCE
    })
  })
}
