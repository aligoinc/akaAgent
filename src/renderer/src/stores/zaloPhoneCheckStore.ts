import { createStore } from 'zustand/vanilla'
import { createZaloPhoneCheckRow, type ZaloPhoneCheckEvent, type ZaloPhoneCheckResult, type ZaloPhoneCheckRow, type ZaloPhoneCheckStatus, type ZaloPhoneCheckUsage } from '../../../shared/zaloPhoneCheck'

export type PhoneCheckFilter = 'all' | ZaloPhoneCheckStatus
interface State {
  ids: string[]; visibleIds: string[]; rows: Record<string, ZaloPhoneCheckRow>
  selected: Record<string, boolean>; filter: PhoneCheckFilter
  runId: string | null; accountId: number | null; sequence: number
  busy: boolean; stopping: boolean; message: string
  processed: number; checkingPhone: string
  usageAccountId: number | null; usage: ZaloPhoneCheckUsage | null; usageError: string
}
const initial = (): State => ({ ids: [], visibleIds: [], rows: {}, selected: {}, filter: 'all', runId: null,
  accountId: null, sequence: 0, busy: false, stopping: false, message: '', processed: 0, checkingPhone: '',
  usageAccountId: null, usage: null, usageError: '' })
const hasResult = (status: ZaloPhoneCheckStatus) => status === 'found' || status === 'not_found'
function visible(state: State, rows = state.rows) {
  if (state.filter === 'all') return state.ids
  const ids = state.ids.filter(id => rows[id].status === state.filter)
  return ids.length === state.visibleIds.length && ids.every((id, i) => id === state.visibleIds[i]) ? state.visibleIds : ids
}
export function createZaloPhoneCheckStore() {
  const store = createStore<State>(() => initial())
  return Object.assign(store, {
    load(phones: string[]) {
      const { usage, usageAccountId, usageError } = store.getState()
      store.setState({ ...initial(), usage, usageAccountId, usageError, ids: phones, visibleIds: phones, rows: Object.fromEntries(phones.map(phone => [phone, createZaloPhoneCheckRow(phone)])) }, true)
    },
    begin(runId: string, accountId: number) {
      store.setState(state => ({ runId, accountId, sequence: 0, busy: true, stopping: false, checkingPhone: '', message: '',
        usageAccountId: accountId, usage: state.usageAccountId === accountId ? state.usage : null, usageError: '' }))
    },
    row(event: ZaloPhoneCheckEvent) {
      const state = store.getState()
      if (!state.busy || event.runId !== state.runId || event.accountId !== state.accountId || event.sequence <= state.sequence || !state.rows[event.row.id]) return
      const prior = state.rows[event.row.id]
      const row = { ...event.row }
      const rows = { ...state.rows, [row.id]: row }
      store.setState({ rows, visibleIds: visible(state, rows), sequence: event.sequence,
        processed: state.processed + Number(hasResult(row.status)) - Number(hasResult(prior.status)),
        // Keep the current phone visible during the pause before the next lookup.
        checkingPhone: row.status === 'checking' ? row.phone : state.checkingPhone,
        message: row.note, ...(event.usage ? { usage: event.usage, usageAccountId: event.accountId, usageError: '' } : {}) })
    },
    complete(result: ZaloPhoneCheckResult) {
      const state = store.getState()
      if (!state.busy || result.runId !== state.runId || result.accountId !== state.accountId || result.sequence <= state.sequence) return
      const rows = { ...state.rows }
      for (const row of result.rows) {
        const prior = rows[row.id]
        if (!prior) continue
        if (prior.status !== row.status || prior.name !== row.name || prior.uid !== row.uid || prior.note !== row.note || prior.accountId !== row.accountId) rows[row.id] = { ...row }
      }
      const processed = state.ids.filter(id => hasResult(rows[id].status)).length
      const remaining = state.ids.length - processed
      store.setState({ rows, visibleIds: visible(state, rows), sequence: result.sequence, busy: false, stopping: false,
        checkingPhone: '', processed, ...(result.usage ? { usage: result.usage, usageAccountId: result.accountId, usageError: '' } : {}),
        message: result.error || (result.stopped ? 'Đã dừng kiểm tra.' : remaining
          ? `Đã hoàn tất lượt này. Còn ${remaining} SĐT chưa có kết quả. Bấm Tiếp tục kiểm tra để chạy tiếp.`
          : 'Đã kiểm tra xong.') })
    },
    fail(message: string) {
      const state = store.getState(), rows = { ...state.rows }
      for (const id of state.ids) if (rows[id].status === 'checking') rows[id] = { ...rows[id], status: 'unknown', note: message }
      store.setState({ rows, visibleIds: visible(state, rows), busy: false, stopping: false, message, checkingPhone: '' })
    },
    filter(filter: PhoneCheckFilter) {
      const state = { ...store.getState(), filter }
      store.setState({ filter, visibleIds: visible(state) })
    },
    toggle(id: string) { store.setState(state => ({ selected: { ...state.selected, [id]: !state.selected[id] } })) },
    selectVisible(selected: boolean) {
      store.setState(state => ({ selected: { ...state.selected, ...Object.fromEntries(state.visibleIds.map(id => [id, selected])) } }))
    },
    selectedRows(): ZaloPhoneCheckRow[] { const state = store.getState(); return state.ids.filter(id => state.selected[id]).map(id => state.rows[id]) }
  })
}
export type ZaloPhoneCheckStore = ReturnType<typeof createZaloPhoneCheckStore>
