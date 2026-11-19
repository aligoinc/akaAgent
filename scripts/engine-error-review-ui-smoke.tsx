// Tab "Lỗi không xác định" (V588): hộp thoại thật của Desktop với IPC giả lập; không kết nối production.
// Chạy bằng scripts/run-engine-error-review-ui-smoke.cjs (Chromium của Playwright, không cần Electron).
import React from 'react'
import { createRoot } from 'react-dom/client'
import EngineErrorReviewModal from '../src/renderer/src/components/EngineErrorReview/EngineErrorReviewModal'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import {
  engineErrorReviewMessage, parseEngineErrorCase, parseEngineErrorDecision, parseEngineErrorList, sanitizeEngineErrorReviewPayload,
  type EngineErrorReviewAction, type EngineErrorReviewErrorCode
} from '../src/shared/engineErrorReview'
import '../src/renderer/src/styles/global.css'

interface FakeCase {
  caseKey: string; kind: string; errorCode: string; publicCode: string; actionCode: string; step: string; pattern: string
  hits: number; pauses: number; firstSeenAt: string; lastSeenAt: string; status: string
  conclusion: string | null; confidence: string | null; summary: string | null; reportAt: string | null
  report: Record<string, unknown> | null; answer: string | null
  customerNote: string | null; customerNoteStatus: string; customerNoteAt: string | null
  codeProposal: Record<string, string> | null; codeProposalStatus: string; codeProposalAt: string | null
  items: number
}

const state: any = { calls: [] as Array<{ action: string; payload: unknown }>, errors: [] as string[], fail: '' as string, closed: 0 }
window.addEventListener('error', event => state.errors.push(String(event.message)))
window.addEventListener('unhandledrejection', event => state.errors.push(String((event as PromiseRejectionEvent).reason)))

const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString()

function seed(): FakeCase[] {
  return [
    {
      caseKey: 'err_engine_unclassified|fb_post_group|open_composer|khong tim thay o dang bai', kind: 'chua_phan_loai',
      errorCode: 'err_engine_unclassified', publicCode: 'SYS99', actionCode: 'fb_post_group', step: 'open_composer',
      pattern: 'Không tìm thấy ô đăng bài trên trang nhóm', hits: 72, pauses: 3, firstSeenAt: at(900), lastSeenAt: at(12), status: 'reported',
      conclusion: 'facebook_doi_giao_dien', confidence: 'cao', summary: 'Nhóm mua bán dùng nút "Bán gì đó" thay ô đăng bài nên bước mở ô đăng bài không thấy gì.',
      reportAt: at(60), report: { tom_tat: 'x', ket_luan: 'facebook_doi_giao_dien' }, answer: 'Báo cáo đầy đủ của ca 1.\nBằng chứng: 72 lượt ở 9 tổ chức.',
      customerNote: 'Nhóm này chỉ cho đăng bài bán hàng nên chưa đăng được', customerNoteStatus: 'proposed', customerNoteAt: null,
      codeProposal: {
        ten_loi: 'Nhóm mua bán không có ô đăng bài', cau_cho_khach: 'Nhóm này chỉ cho đăng bài bán hàng nên chưa đăng được',
        buoc_tiep_theo: 'Bỏ nhóm này khỏi danh sách hoặc đăng bằng tay', cach_xu_ly: 'Bỏ qua data, không tính lượt', dau_hieu: 'Trang nhóm có nút "Bán gì đó"'
      },
      codeProposalStatus: 'proposed', codeProposalAt: null, items: 72
    },
    {
      caseKey: 'err_fb_comment_box_not_found|fb_comment|comment_box|timeout', kind: 'ma_chua_ket_luan',
      errorCode: 'err_fb_comment_box_not_found', publicCode: 'FB41', actionCode: 'fb_comment', step: 'comment_box',
      pattern: 'Không thấy ô bình luận', hits: 14, pauses: 0, firstSeenAt: at(600), lastSeenAt: at(40), status: 'new',
      conclusion: null, confidence: null, summary: null, reportAt: null, report: null, answer: null,
      customerNote: null, customerNoteStatus: 'none', customerNoteAt: null, codeProposal: null, codeProposalStatus: 'none', codeProposalAt: null, items: 14
    },
    {
      caseKey: 'stale|fb_message_page|send|', kind: 'luot_bo_do', errorCode: '', publicCode: '', actionCode: 'fb_message_page', step: 'send',
      pattern: '', hits: 5, pauses: 0, firstSeenAt: at(300), lastSeenAt: at(200), status: 'queued',
      conclusion: null, confidence: null, summary: null, reportAt: null, report: null, answer: null,
      customerNote: null, customerNoteStatus: 'none', customerNoteAt: null, codeProposal: null, codeProposalStatus: 'none', codeProposalAt: null, items: 5
    }
  ]
}

let cases = seed()
const fail = (code: EngineErrorReviewErrorCode) => ({ ok: false as const, code, message: engineErrorReviewMessage(code) })
const waiting = (item: FakeCase) => item.customerNoteStatus === 'proposed' || item.codeProposalStatus === 'proposed'

/** Bản giả của hàm DB: cùng tên thao tác, cùng khuôn trả về, cùng luật chính (độ dài câu, ca đang chờ không đổi trạng thái). */
function fakeDb(action: EngineErrorReviewAction, payload: Record<string, any>): unknown {
  if (action === 'list') {
    const rows = cases.filter(item =>
      (!payload.status || item.status === payload.status) && (!payload.kind || item.kind === payload.kind) &&
      (!payload.needsReview || waiting(item)) &&
      (!payload.q || item.pattern.toLowerCase().includes(String(payload.q).toLowerCase()) || item.publicCode.toLowerCase().startsWith(String(payload.q).toLowerCase()))
    ).sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || b.lastSeenAt.localeCompare(a.lastSeenAt))
    const limit = payload.limit ?? 50
    const offset = payload.offset ?? 0
    const counts: Record<string, number> = {}
    for (const item of cases) counts[item.status] = (counts[item.status] ?? 0) + 1
    return {
      ok: true, settings: { enabled: true, enqueue: true, imageRequests: false, fire: false },
      state: { lastTickAt: at(1), lastError: null, tasksToday: 7 }, counts, needsReview: cases.filter(waiting).length, total: rows.length,
      cases: rows.slice(offset, offset + limit).map(item => ({ ...item, itemCount: item.items, organizationCount: 9, campaignCount: 21 }))
    }
  }
  const found = cases.find(item => item.caseKey === payload.caseKey)
  if (!found) return { ok: false, code: 'case_not_found' }
  if (action === 'case') {
    const limit = payload.limit ?? 50
    const offset = payload.offset ?? 0
    const all = Array.from({ length: found.items }, (_, index) => ({
      id: 1000 + index, occurredAt: at(12 + index), targetRunId: 5000 + index, inputDataId: 9000 + index, dataName: `Nhóm thử ${index + 1}`,
      campaignId: 58000 + (index % 3), campaignName: `Đăng nhóm ${index % 3}`, accountId: 135, accountName: 'fb LD',
      staffId: 4, staffName: 'nhutlq', organizationId: 1, organizationName: 'akaBiz',
      publicCode: found.publicCode, message: `${found.pattern} (lượt ${index + 1})`, noteAppliedAt: null
    }))
    return { ok: true, case: { ...found, threadId: 77, note: null }, itemTotal: found.items, items: all.slice(offset, offset + limit) }
  }
  if (action === 'note') {
    if (payload.decision === 'approve') {
      const note = String(payload.note ?? found.customerNote ?? '').trim().replace(/\s+/g, ' ')
      if (note.length < 5 || note.length > 200) return { ok: false, code: 'note_length' }
      found.customerNote = note
      found.customerNoteStatus = 'approved'
    } else found.customerNoteStatus = 'rejected'
    found.customerNoteAt = at(0)
  } else if (action === 'code') {
    if (!found.codeProposal) return { ok: false, code: 'no_proposal' }
    found.codeProposalStatus = payload.decision === 'approve' ? 'approved' : 'rejected'
    found.codeProposalAt = at(0)
  } else {
    if (found.status === 'queued') return { ok: false, code: 'case_queued' }
    found.status = payload.status
  }
  return { ok: true, case: found }
}

/** Đi đúng đường của tiến trình chính: lọc payload, gọi "DB", đọc bằng bộ đọc dùng chung. */
async function call(action: EngineErrorReviewAction, payload: unknown): Promise<any> {
  state.calls.push({ action, payload })
  if (state.fail) return fail(state.fail)
  const clean = sanitizeEngineErrorReviewPayload(action, payload)
  if (!clean) return fail('bad_decision')
  try {
    const raw = JSON.parse(JSON.stringify(fakeDb(action, JSON.parse(JSON.stringify(clean)))))
    const data = action === 'list' ? parseEngineErrorList(raw) : action === 'case' ? parseEngineErrorCase(raw) : parseEngineErrorDecision(raw)
    return { ok: true, data }
  } catch (error: any) {
    return fail(error?.code ?? 'unavailable')
  }
}

;(window as any).electronAPI = {
  engineErrorReviewList: (query?: unknown) => call('list', query ?? {}),
  engineErrorReviewCase: (caseKey: string, page?: object) => call('case', { caseKey, ...page }),
  engineErrorReviewNote: (caseKey: string, decision: string, note?: string) => call('note', { caseKey, decision, note }),
  engineErrorReviewCode: (caseKey: string, decision: string) => call('code', { caseKey, decision }),
  engineErrorReviewMark: (caseKey: string, status: string) => call('mark', { caseKey, status })
}

const root = createRoot(document.getElementById('root') as HTMLElement)
function mount(): void {
  root.render(<EngineErrorReviewModal key={Date.now()} onClose={() => { state.closed += 1 }} />)
}

;(window as any).engineErrorSmoke = {
  state,
  reset(options: { fail?: string } = {}) {
    cases = seed()
    state.calls = []
    state.fail = options.fail ?? ''
    useUiStore.getState().closeAlert()
    useUiStore.getState().closeConfirm()
    mount()
  },
  setFail(code: string) { state.fail = code },
  ui: () => {
    const ui = useUiStore.getState()
    return { alert: ui.alert.isOpen ? { type: ui.alert.type, message: ui.alert.message } : null, confirm: ui.confirm.isOpen ? ui.confirm.message : null }
  },
  async confirm() {
    const run = useUiStore.getState().confirm.onConfirm
    useUiStore.getState().closeConfirm()
    if (run) await run()
  },
  cases: () => cases
}
mount()
