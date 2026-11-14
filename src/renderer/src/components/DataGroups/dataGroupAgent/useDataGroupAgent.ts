// Điều khiển cửa sổ Agent lọc bạn bè Zalo trên Desktop (docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md); bản Desktop của
// akaAgentWebApp apps/web/src/features/dataGroupAgent/useDataGroupAgent.ts, gọi qua IPC `data-group-agent:*` thay cho API.
// Hai mục đích:
// - `data_group`: cửa sổ Nhóm data, bấm Tạo nhóm gửi nguyên bộ lọc đã hiện (ghi DB).
// - `campaign_recipients`: form chiến dịch ("Agent chọn bạn bè"), bấm Thêm vào danh sách lấy UID và tên của mọi người khớp
//   (chỉ đọc) để form tự thêm vào danh sách data; không ghi DB. Chỉ liệt kê các tài khoản đang chọn trong form.
// Một lượt chat = một lần gọi AI. Bộ lọc, bản tóm tắt và tên nhóm gợi ý lấy từ lượt trả lời mới nhất; khi Agent xác nhận thì
// đếm thử đúng bộ lọc đó (một lượt, không theo nhịp). Đổi tài khoản, bắt đầu lại hay đóng cửa sổ thì bỏ mọi kết quả đang
// bay (epoch) và báo main hủy lượt đang chạy.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DATA_GROUP_AGENT_MAX_HISTORY_TEXT, DATA_GROUP_AGENT_MAX_HISTORY_TURNS, DATA_GROUP_AGENT_MESSAGES, redactDataGroupAgentText,
  type DataGroupAgentPurpose, type DataGroupAgentQuestion
} from '../../../../../shared/dataGroupAgent'
import {
  dataGroupAgentDesktopWording, type DataGroupAgentIpcRequest, type DataGroupAgentIpcResponses
} from '../../../../../shared/dataGroupAgentIpc'
import type {
  CreateDataGroupFromFriendFilterResult, FriendFilterSummaryLine, ZaloFriendAccount, ZaloFriendFilter, ZaloFriendFilterResult,
  ZaloFriendRecipientsResult
} from '../../../../../shared/zaloFriendFilter'

export interface DataGroupAgentTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  status?: 'ask' | 'confirm' | 'unsupported'
  questions?: DataGroupAgentQuestion[]
  assumptions?: string[]
  notes?: string[]
  error?: boolean
}

export interface DataGroupAgentPreview {
  loading: boolean
  result: ZaloFriendFilterResult | null
  error: string | null
}

class AgentIpcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AgentIpcError'
  }
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const wording = (text: string) => dataGroupAgentDesktopWording(text)
const errorText = (error: unknown, fallback: string) => wording(error instanceof Error && error.message ? error.message : fallback)

/** Một lượt IPC; lỗi thành AgentIpcError. Bị hủy (signal) thì báo main dừng lượt có cùng requestId và bỏ kết quả. */
async function invoke<R extends DataGroupAgentIpcRequest>(request: R, signal?: AbortSignal): Promise<DataGroupAgentIpcResponses[R['kind']]> {
  const requestId = 'request' in request ? (request.request as { requestId?: string }).requestId : undefined
  const onAbort = () => { if (requestId) void window.electronAPI.cancelDataGroupAgent(requestId) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await window.electronAPI.dataGroupAgent(request)
    if (signal?.aborted) throw new AgentIpcError('friend_filter_cancelled', '')
    if (result.ok) return result.data as DataGroupAgentIpcResponses[R['kind']]
    throw new AgentIpcError(result.code, result.message)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

const isCancelled = (error: unknown) => error instanceof AgentIpcError && error.code === 'friend_filter_cancelled'

export interface DataGroupAgentOptions {
  purpose?: DataGroupAgentPurpose
  /** `campaign_recipients`: tài khoản đang chọn trong form theo đúng thứ tự; tài khoản đầu là mặc định. */
  accountIds?: readonly number[]
}

export function useDataGroupAgent(scope: string, options: DataGroupAgentOptions = {}) {
  const purpose: DataGroupAgentPurpose = options.purpose ?? 'data_group'
  const recipientsMode = purpose === 'campaign_recipients'
  const formAccountKey = recipientsMode ? (options.accountIds ?? []).join(',') : ''
  const [accounts, setAccounts] = useState<ZaloFriendAccount[] | null>(null)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [turns, setTurns] = useState<DataGroupAgentTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<ZaloFriendFilter | null>(null)
  const [status, setStatus] = useState<DataGroupAgentTurn['status'] | null>(null)
  const [summary, setSummary] = useState<string[]>([])
  const [summaryLines, setSummaryLines] = useState<FriendFilterSummaryLine[]>([])
  const [groupName, setGroupNameState] = useState('')
  const [preview, setPreview] = useState<DataGroupAgentPreview>({ loading: false, result: null, error: null })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const epochRef = useRef(0)
  const accountsEpochRef = useRef(0)
  const turnAbortRef = useRef<AbortController | null>(null)
  const previewAbortRef = useRef<AbortController | null>(null)
  const recipientsAbortRef = useRef<AbortController | null>(null)
  const nameTouchedRef = useRef(false)
  const createRequestRef = useRef<{ key: string; id: string } | null>(null)

  const account = useMemo(() => accounts?.find(item => item.id === accountId) ?? null, [accounts, accountId])

  const loadAccounts = useCallback(async () => {
    const epoch = ++accountsEpochRef.current
    setAccountsError(null)
    try {
      const { accounts: all } = await invoke({ kind: 'accounts' })
      if (epoch !== accountsEpochRef.current) return
      // Form chiến dịch: chỉ các tài khoản đang chọn, đúng thứ tự của form; mặc định tài khoản đầu (như nút chọn tay).
      const formIds = formAccountKey ? formAccountKey.split(',').map(Number) : []
      const list = recipientsMode ? formIds.flatMap(id => all.find(item => item.id === id) ?? []) : all
      setAccounts(list)
      if (recipientsMode && !list.length) setAccountsError('Tài khoản đang chọn trong chiến dịch chưa lọc được bạn bè bằng Agent.')
      setAccountId(current => current !== null && list.some(item => item.id === current) ? current
        : recipientsMode ? list[0]?.id ?? null
          : list.find(item => item.available && item.friendCount > 0)?.id ?? list.find(item => item.available)?.id ?? null)
    } catch (error) {
      if (epoch !== accountsEpochRef.current) return
      setAccounts([])
      setAccountsError(errorText(error, 'Không tải được danh sách tài khoản Zalo.'))
    }
  }, [formAccountKey, recipientsMode])

  // Một lượt khi mở cửa sổ (và khi phiên đổi); không theo nhịp.
  useEffect(() => { void loadAccounts() }, [loadAccounts, scope])

  const abortAll = () => {
    turnAbortRef.current?.abort(); turnAbortRef.current = null
    previewAbortRef.current?.abort(); previewAbortRef.current = null
    recipientsAbortRef.current?.abort(); recipientsAbortRef.current = null
  }
  const reset = useCallback(() => {
    epochRef.current++
    abortAll()
    setTurns([]); setBusy(false); setFilter(null); setStatus(null); setSummary([]); setSummaryLines([])
    setGroupNameState(''); nameTouchedRef.current = false; createRequestRef.current = null
    setPreview({ loading: false, result: null, error: null }); setCreateError(null)
  }, [])
  useEffect(() => () => { epochRef.current++; accountsEpochRef.current++; abortAll() }, [])
  useEffect(() => { reset() }, [scope, reset])

  const changeAccount = useCallback((id: number | null) => { reset(); setAccountId(id) }, [reset])

  const runPreview = useCallback(async (next: ZaloFriendFilter) => {
    previewAbortRef.current?.abort()
    const controller = new AbortController()
    previewAbortRef.current = controller
    const epoch = epochRef.current
    setPreview({ loading: true, result: null, error: null })
    try {
      const result = await invoke({ kind: 'filter', request: { requestId: newId(), mode: 'page', filter: next, offset: 0, limit: 20 } }, controller.signal)
      if (epoch !== epochRef.current || controller.signal.aborted) return
      setPreview({ loading: false, result, error: null })
    } catch (error) {
      if (epoch !== epochRef.current || controller.signal.aborted || isCancelled(error)) return
      setPreview({ loading: false, result: null, error: errorText(error, 'Không đếm được số bạn bè khớp.') })
    }
  }, [])

  const send = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || busy || accountId === null) return
    const epoch = epochRef.current
    turnAbortRef.current?.abort()
    const controller = new AbortController()
    turnAbortRef.current = controller
    const history = turns.filter(turn => !turn.error).slice(-DATA_GROUP_AGENT_MAX_HISTORY_TURNS * 2)
      .map(turn => ({ role: turn.role, text: redactDataGroupAgentText(turn.text).slice(0, DATA_GROUP_AGENT_MAX_HISTORY_TEXT) }))
    setTurns(current => [...current, { id: newId(), role: 'user', text }])
    setBusy(true)
    try {
      const result = await invoke({ kind: 'turn', request: {
        requestId: newId(), purpose, sourceType: 'zalo_friends', accountId, message: redactDataGroupAgentText(text),
        history, draft: filter, groupName: recipientsMode ? null : groupName.trim() || null,
        lastPreview: preview.result ? { matched: preview.result.matched, totalFriends: preview.result.totalFriends } : null
      } }, controller.signal)
      if (epoch !== epochRef.current || controller.signal.aborted) return
      if (!result.ok) {
        if (result.code === 'cancelled') return
        setTurns(current => [...current, { id: newId(), role: 'assistant', text: wording(result.message || DATA_GROUP_AGENT_MESSAGES.unavailable), error: true }])
        return
      }
      const reply = result.reply
      setTurns(current => [...current, { id: newId(), role: 'assistant', text: wording(reply.message), status: reply.status,
        questions: reply.questions, assumptions: reply.assumptions, notes: reply.notes.map(wording) }])
      setStatus(reply.status)
      setFilter(reply.filter)
      setSummary(reply.summary)
      setSummaryLines(reply.summaryLines)
      if (reply.groupName && !nameTouchedRef.current) setGroupNameState(reply.groupName)
      setCreateError(null)
      if (reply.status === 'confirm' && reply.filter) void runPreview(reply.filter)
      else { previewAbortRef.current?.abort(); setPreview({ loading: false, result: null, error: null }) }
    } catch (error) {
      if (epoch !== epochRef.current || controller.signal.aborted || isCancelled(error)) return
      setTurns(current => [...current, { id: newId(), role: 'assistant', text: errorText(error, DATA_GROUP_AGENT_MESSAGES.unavailable), error: true }])
    } finally {
      if (epoch === epochRef.current && turnAbortRef.current === controller) { turnAbortRef.current = null; setBusy(false) }
    }
  }, [accountId, busy, filter, groupName, preview.result, purpose, recipientsMode, runPreview, turns])

  const stop = useCallback(() => {
    if (!turnAbortRef.current) return
    turnAbortRef.current.abort(); turnAbortRef.current = null
    setBusy(false)
    setTurns(current => [...current, { id: newId(), role: 'assistant', text: 'Đã dừng. Bạn có thể gửi lại hoặc mô tả khác.', error: true }])
  }, [])

  const setGroupName = useCallback((value: string) => { nameTouchedRef.current = true; setGroupNameState(value) }, [])

  const canCreate = status === 'confirm' && !!filter && !busy && !creating && !preview.loading && !!preview.result
    && preview.result.matched > 0 && (recipientsMode || groupName.trim().length > 0)

  const create = useCallback(async (): Promise<CreateDataGroupFromFriendFilterResult | null> => {
    if (!canCreate || !filter) return null
    const name = groupName.trim()
    // Cùng bộ lọc + tên thì dùng lại mã yêu cầu: bấm lại sau lỗi mạng không tạo nhóm thứ hai.
    const key = JSON.stringify([filter, name])
    if (createRequestRef.current?.key !== key) createRequestRef.current = { key, id: newId() }
    const epoch = epochRef.current
    setCreating(true); setCreateError(null)
    try {
      const result = await invoke({ kind: 'create', request: { requestId: createRequestRef.current.id, name, color: null, filter, summary } })
      return epoch === epochRef.current ? result : null
    } catch (error) {
      if (epoch === epochRef.current) setCreateError(errorText(error, 'Không tạo được nhóm data.'))
      return null
    } finally {
      if (epoch === epochRef.current) setCreating(false)
    }
  }, [canCreate, filter, groupName, summary])

  /** Form chiến dịch: UID và tên của mọi người khớp đúng bộ lọc đã hiện (chỉ đọc). Kết quả về muộn sau khi bỏ thì null. */
  const addRecipients = useCallback(async (): Promise<ZaloFriendRecipientsResult | null> => {
    if (!recipientsMode || !canCreate || !filter) return null
    const epoch = epochRef.current
    recipientsAbortRef.current?.abort()
    const controller = new AbortController()
    recipientsAbortRef.current = controller
    setCreating(true); setCreateError(null)
    try {
      const result = await invoke({ kind: 'recipients', request: { requestId: newId(), filter } }, controller.signal)
      return epoch === epochRef.current && !controller.signal.aborted ? result : null
    } catch (error) {
      if (epoch === epochRef.current && !controller.signal.aborted && !isCancelled(error)) {
        setCreateError(errorText(error, 'Không lấy được danh sách bạn bè. Vui lòng thử lại.'))
      }
      return null
    } finally {
      if (recipientsAbortRef.current === controller) recipientsAbortRef.current = null
      if (epoch === epochRef.current) setCreating(false)
    }
  }, [canCreate, filter, recipientsMode])

  return {
    purpose, addRecipients,
    accounts, accountsError, account, accountId, changeAccount, reloadAccounts: loadAccounts,
    turns, busy, send, stop, reset, filter, status, summary, summaryLines,
    groupName, setGroupName, preview, recount: () => filter ? runPreview(filter) : undefined,
    canCreate, creating, createError, create
  }
}

export type DataGroupAgentController = ReturnType<typeof useDataGroupAgent>
