import { useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import {
  chunkInputDuplicatePhones, formatVietnamTime, inputDuplicateScopeLabel, mergeInputDuplicateResults,
  type InputDuplicatesCheckResult
} from '../../../../shared/campaignInputDuplicates'
import { normalizeVietnamMobilePhone } from '../../../../shared/phone'
import { useUiStore } from '../../stores/uiStore'
import type { ImportDuplicateSummary } from './CampaignDataUploadModal'
import './CampaignImportDuplicates.css'

interface Props {
  note: ImportDuplicateSummary
  actionId: string
  /** Tài khoản đang chọn hiện tại của form. */
  accountIds: number[]
  /** SĐT của các dòng đang có trong danh sách data. */
  phones: () => Array<string | null | undefined>
  /** Bỏ các dòng có SĐT (sau chuẩn hóa) mà `shouldRemove` trả true. */
  removeRows: (shouldRemove: (phone: string | null | undefined) => boolean) => void
  onNoteChange: (note: ImportDuplicateSummary) => void
}

const sortedKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',')

/**
 * Ghi chú lọc trùng (V491/V493) trong mục Dữ liệu của form tạo/nhân bản chiến dịch (form thường và form Agent):
 * chỉ trong phiên form, không lưu vào nháp. Lọc theo "tài khoản đang chọn" rồi đổi tài khoản thì cảnh báo và cho
 * "Kiểm tra lại" cả danh sách với tài khoản mới (khách xác nhận bỏ số). Chép ý từ akaAgentWebApp CampaignFormPage.
 */
export function InputDuplicateFormNote({ note, actionId, accountIds, phones, removeRows, onNoteChange }: Props) {
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [dismissedKey, setDismissedKey] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const accountsKey = sortedKey(accountIds)
  const accountsChanged = note.scope === 'current' && sortedKey(note.accountIds) !== accountsKey

  const recheck = async () => {
    if (rechecking || !accountIds.length) return
    const list = Array.from(new Set(phones().map(normalizeVietnamMobilePhone).filter(Boolean)))
    setRechecking(true)
    try {
      const results: InputDuplicatesCheckResult[] = []
      for (const chunk of chunkInputDuplicatePhones(list)) {
        const result = await window.electronAPI.campaignInputDuplicates({ kind: 'check', request: {
          actionId, accountIds: [...accountIds], days: note.days, phones: chunk, excludeCampaignId: null
        } })
        if (!result.ok) throw new Error(result.message)
        results.push(result.data)
      }
      const merged = mergeInputDuplicateResults(results)
      const found = new Set(merged?.items.map(item => item.phone) ?? [])
      const update = (removed: number) => onNoteChange({ ...note, accountIds: [...accountIds],
        checkedAt: merged?.checkedAt ?? new Date().toISOString(), since: merged?.since ?? note.since, skipped: note.skipped + removed })
      if (!found.size) { update(0); showAlert('Không có số nào đã có ở chiến dịch của các tài khoản đang chọn.', 'success'); return }
      showConfirm(`${found.size.toLocaleString('vi-VN')} số trong danh sách đã có ở chiến dịch khác của các tài khoản đang chọn trong ${note.days} ngày. Bỏ các số này khỏi danh sách?`, () => {
        removeRows(phone => found.has(normalizeVietnamMobilePhone(phone)))
        update(found.size)
        showAlert(`Đã bỏ ${found.size.toLocaleString('vi-VN')} số đã có ở chiến dịch khác.`, 'success')
      }, { title: 'Kiểm tra lại trùng dữ liệu', confirmText: `Bỏ ${found.size.toLocaleString('vi-VN')} số`, cancelText: 'Giữ nguyên' })
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Chưa đối chiếu được với dữ liệu đã tải lên.', 'error')
    } finally { setRechecking(false) }
  }

  return <div style={{ display: 'grid', gap: 8, marginTop: 10, marginBottom: 10 }}>
    <div className="campaign-import-dedup-form-note" role="status"><ShieldCheck size={16} aria-hidden="true" />
      <span>Đã lọc trùng với dữ liệu {note.days} ngày của {inputDuplicateScopeLabel(note.scope, note.accountIds.length)} lúc {formatVietnamTime(note.checkedAt)} · bỏ qua {note.skipped.toLocaleString('vi-VN')} số đã có ở chiến dịch khác.</span>
    </div>
    {accountsChanged && accountIds.length > 0 && dismissedKey !== accountsKey && <div className="campaign-import-dedup-form-warning" role="status">
      <AlertTriangle size={16} aria-hidden="true" />
      <span><strong>Danh sách chưa được đối chiếu với tài khoản đang chọn hiện tại.</strong> Bạn đã đổi tài khoản sau khi lọc trùng. Kiểm tra lại để bỏ các số đã có ở chiến dịch của các tài khoản này trong {note.days} ngày.</span>
      <button type="button" className="btn btn-primary btn-sm" disabled={rechecking} onClick={() => void recheck()}>{rechecking ? 'Đang kiểm tra...' : 'Kiểm tra lại'}</button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={rechecking} onClick={() => setDismissedKey(accountsKey)}>Để sau</button>
    </div>}
  </div>
}
