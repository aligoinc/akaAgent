import { create } from 'zustand'
import {
  emailPromptDayKey,
  emailPromptErrorMessage,
  type EmailPromptResult,
  type EmailPromptSaveResult,
  type EmailPromptState
} from '../../../shared/emailPrompt'
import type { EmailPromptAction, EmailPromptIpcResult, EmailPromptSaveRequest } from '../../../shared/emailPromptDesktop'

/**
 * Form xin email sau khi đăng nhập (V652, docs/STAFF_EMAIL_PROMPT_PLAN.md). DB quyết định có hiện hay không (`state`);
 * store chỉ giữ kết quả, trạng thái hộp thoại và cờ "đang chờ hộp thoại khác đóng". Không hẹn giờ đọc DB:
 * `state` chỉ gọi khi vào phiên và khi sang ngày VN mới (Host kiểm lúc cửa sổ được focus / hiện lại).
 */
export type EmailPromptScreen = 'enter' | 'confirm' | 'saved'
/** `auto`: DB bảo hiện; `chip`: khách bấm nhãn "Thêm email"; `change`: nút Đổi trong Thông tin tài khoản. */
export type EmailPromptOpenMode = 'auto' | 'chip' | 'change'

interface EmailPromptStore {
  scope: string | null
  state: EmailPromptState | null
  /** Ngày VN của lượt `state` gần nhất (để biết khi nào hỏi lại). */
  dayKey: string | null
  loading: boolean
  /** DB bảo hiện form nhưng đang chờ hộp thoại khác đóng. */
  pendingAuto: boolean
  open: boolean
  mode: EmailPromptOpenMode
  screen: EmailPromptScreen
  /** Email đang lưu, hiện ở màn Đổi email (Thông tin tài khoản). */
  currentEmail: string | null
  saved: EmailPromptSaveResult | null
  /** Tăng sau mỗi lần lưu thành công, để Thông tin tài khoản đọc lại email. */
  savedSeq: number
  enter(scope: string | null): void
  loadState(): Promise<void>
  showAuto(): void
  openFromChip(): void
  openChange(currentEmail: string | null): void
  showEnter(): void
  close(): void
  save(input: EmailPromptSaveRequest): Promise<EmailPromptResult<EmailPromptSaveResult>>
}

let generation = 0

async function call<A extends EmailPromptAction>(action: A, payload?: A extends 'save' ? EmailPromptSaveRequest : undefined): Promise<EmailPromptIpcResult<A>> {
  const api = window.electronAPI?.emailPromptCall
  if (!api) return { ok: false, code: 'not_installed', message: emailPromptErrorMessage('not_installed') }
  try {
    return await api(action, payload)
  } catch {
    return { ok: false, code: 'unavailable', message: emailPromptErrorMessage('unavailable') }
  }
}

export const useEmailPromptStore = create<EmailPromptStore>((set, get) => ({
  scope: null,
  state: null,
  dayKey: null,
  loading: false,
  pendingAuto: false,
  open: false,
  mode: 'auto',
  screen: 'enter',
  currentEmail: null,
  saved: null,
  savedSeq: 0,

  enter(scope) {
    if (scope === get().scope) return
    generation++
    set({
      scope, state: null, dayKey: null, loading: false, pendingAuto: false, open: false, mode: 'auto',
      screen: 'enter', currentEmail: null, saved: null
    })
  },

  async loadState() {
    const { scope, loading } = get()
    if (!scope || loading) return
    const request = generation
    set({ loading: true })
    const result = await call('state')
    if (request !== generation) return
    if (!result.ok) {
      // Lỗi / DB chưa có hàm: im lặng, không hiện gì. Ghi ngày để không hỏi lại tới hôm sau.
      set({ loading: false, dayKey: emailPromptDayKey() })
      return
    }
    const state = result.data
    const show = state.enabled && state.show !== 'none'
    set({ loading: false, state, dayKey: emailPromptDayKey(), pendingAuto: show && !get().open })
  },

  showAuto() {
    const { state, open } = get()
    if (open || !state?.enabled || state.show === 'none') { set({ pendingAuto: false }); return }
    set({ pendingAuto: false, open: true, mode: 'auto', screen: state.show === 'confirm' ? 'confirm' : 'enter', saved: null })
  },

  openFromChip() {
    const { state } = get()
    if (!state?.enabled) return
    set({ pendingAuto: false, open: true, mode: 'chip', screen: state.show === 'confirm' ? 'confirm' : 'enter', saved: null })
  },

  openChange(currentEmail) {
    set({ pendingAuto: false, open: true, mode: 'change', screen: 'enter', currentEmail, saved: null })
  },

  showEnter() { set({ screen: 'enter' }) },

  close() {
    const { open, mode, screen } = get()
    if (!open) return
    set({ open: false, pendingAuto: false })
    // Bấm × ở form tự hiện / mở từ nhãn: ghi "đã tắt hôm nay" (hôm sau hỏi lại). Màn Đã lưu, Đổi email: chỉ đóng.
    if (screen !== 'saved' && mode !== 'change') void call('dismiss')
  },

  async save(input) {
    const result = await call('save', input)
    if (!result.ok) {
      if (result.code === 'disabled') set(store => ({ state: store.state ? { ...store.state, enabled: false, chip: false } : store.state }))
      return result
    }
    set(store => ({
      screen: 'saved',
      saved: result.data,
      savedSeq: store.savedSeq + 1,
      state: store.state ? { ...store.state, show: 'none', chip: false, reason: 'has_email' } : store.state
    }))
    return result
  }
}))
