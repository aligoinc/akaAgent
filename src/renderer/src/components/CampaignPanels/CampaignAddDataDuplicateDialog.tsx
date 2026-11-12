import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ListChecks, Users, X } from 'lucide-react'
import { writeFile } from 'xlsx'
import {
  INPUT_DUPLICATES_DAY_PRESETS, INPUT_DUPLICATES_DEFAULT_DAYS, INPUT_DUPLICATES_MAX_DAYS, chunkInputDuplicatePhones, formatVietnamDate,
  formatVietnamTime, inputDuplicateStatusLabel, inputDuplicateWindowStart, mergeInputDuplicateResults,
  type InputDuplicateItem, type InputDuplicatesCheckResult
} from '../../../../shared/campaignInputDuplicates'
import { pendingExistingExportMatrix } from '../../../../shared/campaignImportVerification'
import { createImportMatrixWorkbook } from '../../../../shared/campaignImportWorkbook'
import { normalizeVietnamMobilePhone } from '../../../../shared/phone'
import type { CampaignInputData } from '../../../../shared/types'
import { useAuthStore } from '../../stores/authStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import { getAccountPlatformLabel } from '../../utils/accountLabels'
import { inputDuplicateMemoryKey, readDuplicateMemory, writeDuplicateMemory } from '../../utils/inputDuplicateMemory'
import { InputDuplicateAccountPicker, type InputDuplicateAccountOption } from './InputDuplicateAccountPicker'
import './CampaignImportDuplicates.css'
import './CampaignAddData.css'

export type AddDataDuplicateScope = 'current' | 'picked'

/** Kết quả một lượt "Kiểm tra trùng" trên danh sách chờ thêm; `removed` = khách bấm "Bỏ N số". */
export interface AddDataDuplicateOutcome {
  scope: AddDataDuplicateScope
  days: number
  accountIds: number[]
  checkedAt: string
  since: string
  /** SĐT (đã chuẩn hóa) đã gửi đi đối chiếu. */
  checkedPhones: string[]
  found: InputDuplicateItem[]
  removed: boolean
}

interface Props {
  actionId: string
  /** Chiến dịch đang nhận data: không so với chính nó. */
  campaignId: number
  account: { id: number; name: string }
  rows: Partial<CampaignInputData>[]
  defaultDays: number
  maxDays: number
  onClose: () => void
  onDone: (outcome: AddDataDuplicateOutcome) => void
}

const RESULT_PREVIEW_ROWS = 100
const number = (value: number) => value.toLocaleString('vi-VN')

/**
 * "Thêm data" → Kiểm tra trùng với chiến dịch khác: đối chiếu cả danh sách chờ thêm (V491/V493, cùng IPC với cửa sổ Upload),
 * khách xem kết quả rồi mới quyết định bỏ số hay giữ nguyên. Không có lựa chọn "Chỉ trong file này" vì danh sách đã ra khỏi file.
 * Chép từ akaAgentWebApp `apps/web/src/features/CampaignAddDataDuplicateDialog.tsx`; Desktop lấy tài khoản Zalo từ danh sách
 * tài khoản đã tải của app và gọi IPC tuần tự từng lượt 1.000 số (IPC không hủy được: Hủy dừng trước lượt kế tiếp).
 */
export function CampaignAddDataDuplicateDialog({ actionId, campaignId, account, rows, defaultDays, maxDays, onClose, onDone }: Props) {
  const showAlert = useUiStore(state => state.showAlert)
  const authUser = useAuthStore(state => state.user)
  const storeAccounts = useCampaignStore(state => state.accounts)
  const storageKey = inputDuplicateMemoryKey(authUser?.organizationId, authUser?.staffId)
  const dayLimit = Math.max(1, Math.min(INPUT_DUPLICATES_MAX_DAYS, Math.floor(maxDays)))
  const dayPresets = INPUT_DUPLICATES_DAY_PRESETS.filter(days => days <= dayLimit)
  const phones = useMemo(() => Array.from(new Set(rows.map(row => normalizeVietnamMobilePhone(row.phone)).filter(Boolean))), [rows])
  // Tài khoản Zalo của nhân viên (danh sách tài khoản của app đã theo nhân viên/tổ chức); DB kiểm lại từng tài khoản.
  const zaloAccounts = useMemo<InputDuplicateAccountOption[]>(() => storeAccounts
    .filter(item => item.flatformType === 'zalo' && !item.isDelete)
    .map(item => ({
      id: item.id, name: item.name || `Tài khoản ${item.id}`, groupName: item.accountGroupName?.trim() || '',
      typeLabel: getAccountPlatformLabel(item), current: item.id === account.id
    })), [storeAccounts, account.id])
  // Mở ra chọn sẵn "Các tài khoản Zalo bạn chọn": phạm vi này thấy cả số đã chia cho tài khoản khác lúc tạo chiến dịch.
  const [scope, setScope] = useState<AddDataDuplicateScope>('picked')
  const [days, setDays] = useState(() => {
    const remembered = readDuplicateMemory(storageKey).days
    return remembered && remembered >= 1 && remembered <= dayLimit ? remembered : Math.min(dayLimit, defaultDays || INPUT_DUPLICATES_DEFAULT_DAYS)
  })
  const [daysText, setDaysText] = useState('')
  const [pickedIds, setPickedIds] = useState<number[]>(() => {
    const available = new Set(zaloAccounts.map(option => option.id))
    const remembered = (readDuplicateMemory(storageKey).pickedIds ?? []).filter(id => available.has(id))
    return remembered.length ? remembered : zaloAccounts.map(option => option.id)
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failure, setFailure] = useState('')
  const [outcome, setOutcome] = useState<Omit<AddDataDuplicateOutcome, 'removed'> | null>(null)
  const runRef = useRef<{ cancelled: boolean } | null>(null)
  const daysInvalid = daysText !== '' && !(Number.isInteger(Number(daysText)) && Number(daysText) >= 1 && Number(daysText) <= dayLimit)

  useEffect(() => () => { if (runRef.current) runRef.current.cancelled = true }, [])

  const changeDays = (next: number, text = '') => {
    setDays(next); setDaysText(text); setFailure('')
    writeDuplicateMemory(storageKey, { days: next })
  }
  const changeDaysText = (text: string) => {
    const value = Number(text)
    if (text !== '' && Number.isInteger(value) && value >= 1 && value <= dayLimit) changeDays(value, text)
    else setDaysText(text)
  }
  const savePicked = (ids: number[]) => {
    setPickedIds(ids); setPickerOpen(false); setFailure('')
    writeDuplicateMemory(storageKey, { pickedIds: ids })
  }
  const accountIds = scope === 'current' ? [account.id] : pickedIds
  const running = progress !== null
  const blocked = daysInvalid || phones.length === 0 || accountIds.length === 0

  const run = async () => {
    if (running || blocked) return
    const current = { cancelled: false }
    if (runRef.current) runRef.current.cancelled = true
    runRef.current = current
    const chunks = chunkInputDuplicatePhones(phones)
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const runScope = scope, runDays = days, runAccountIds = [...accountIds]
    setFailure(''); setProgress({ done: 0, total })
    const results: InputDuplicatesCheckResult[] = []
    try {
      let done = 0
      for (const chunk of chunks) {
        const result = await window.electronAPI.campaignInputDuplicates({ kind: 'check', request: {
          actionId, accountIds: runAccountIds, days: runDays, phones: chunk, excludeCampaignId: campaignId
        } })
        if (current.cancelled) return
        if (!result.ok) throw new Error(result.message)
        results.push(result.data)
        done += chunk.length
        setProgress({ done, total })
      }
      const merged = mergeInputDuplicateResults(results)
      setOutcome({ scope: runScope, days: runDays, accountIds: runAccountIds, checkedAt: merged?.checkedAt ?? new Date().toISOString(),
        since: merged?.since ?? '', checkedPhones: phones, found: merged?.items ?? [] })
    } catch (error) {
      if (current.cancelled) return
      setFailure(error instanceof Error ? error.message : 'Chưa đối chiếu được với dữ liệu đã tải lên.')
    } finally {
      if (runRef.current === current) { runRef.current = null; setProgress(null) }
    }
  }
  const cancelRun = () => {
    if (runRef.current) runRef.current.cancelled = true
    runRef.current = null
    setProgress(null)
  }
  // Đã có kết quả mà đóng hộp = giữ nguyên danh sách (lượt đối chiếu vẫn được ghi nhận).
  const close = () => {
    if (running) return
    if (outcome) onDone({ ...outcome, removed: false })
    else onClose()
  }

  const foundEntries = useMemo(() => {
    if (!outcome?.found.length) return []
    const byPhone = new Map(outcome.found.map(item => [item.phone, item]))
    return rows.flatMap(row => {
      const existing = byPhone.get(normalizeVietnamMobilePhone(row.phone))
      return existing ? [{ row, existing }] : []
    })
  }, [outcome, rows])
  const exportFound = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      writeFile(createImportMatrixWorkbook(pendingExistingExportMatrix(foundEntries), 'Đã có ở chiến dịch khác'), `du-lieu-da-co-o-chien-dich-khac-${timestamp}.xlsx`)
    } catch (error) { showAlert(error instanceof Error ? error.message : 'Không thể xuất Excel.', 'error') }
  }
  const scopeText = (value: AddDataDuplicateScope, count: number) => value === 'current' ? `tài khoản ${account.name}` : `${number(count)} tài khoản Zalo`
  const windowText = (value: { since: string; days: number }) => value.since ? formatVietnamDate(value.since) : inputDuplicateWindowStart(value.days)
  const pickedNames = zaloAccounts.filter(item => pickedIds.includes(item.id)).map(item => item.name)
  const pickedSummary = pickedNames.length > 3 ? `${pickedNames.slice(0, 3).join(', ')} và ${pickedNames.length - 3} tài khoản khác` : pickedNames.join(', ')
  const foundCount = foundEntries.length

  return <>{createPortal(<div className="modal-overlay" style={{ zIndex: 3600 }} onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <div className="modal add-data-dup-dialog" role="dialog" aria-modal="true" aria-labelledby="add-data-dup-title" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title" id="add-data-dup-title">Kiểm tra trùng với chiến dịch khác</div>
        <button type="button" className="btn-icon" onClick={close} title="Đóng" aria-label="Đóng" disabled={running}><X size={18} /></button>
      </div>

      {!outcome && <>
        <div className="modal-body add-data-dup-body">
          <div className="add-data-dup-intro">Đối chiếu <strong>{number(phones.length)} số</strong> đang chờ thêm với dữ liệu đã tải vào chiến dịch khác cùng loại. Không tính chính chiến dịch này.</div>
          <fieldset className="add-data-dup-scope" disabled={running}>
            <legend>So với</legend>
            <div className={`campaign-import-dedup-option${scope === 'picked' ? ' active' : ''}`}>
              <label><input type="radio" name="add-data-dup-scope" checked={scope === 'picked'} onChange={() => { setScope('picked'); setFailure('') }} />
                <span className="campaign-import-dedup-option-text">
                  <span className="campaign-import-dedup-option-title">Các tài khoản Zalo bạn chọn</span>
                  <span className="campaign-import-dedup-option-desc">Thấy cả số đã chia cho tài khoản khác lúc tạo chiến dịch.</span>
                </span></label>
              {scope === 'picked' && <div className="campaign-import-dedup-extra">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}><Users size={14} /> Chọn tài khoản · {number(pickedIds.length)}/{number(zaloAccounts.length)}</button>
                {pickedSummary && <span>{pickedSummary}</span>}
              </div>}
            </div>
            <div className={`campaign-import-dedup-option${scope === 'current' ? ' active' : ''}`}>
              <label><input type="radio" name="add-data-dup-scope" checked={scope === 'current'} onChange={() => { setScope('current'); setFailure('') }} />
                <span className="campaign-import-dedup-option-text">
                  <span className="campaign-import-dedup-option-title">Chỉ tài khoản của chiến dịch này<span className="campaign-import-dedup-chip">{account.name}</span></span>
                  <span className="campaign-import-dedup-option-desc">Nhanh hơn, nhưng không thấy số đã nằm ở chiến dịch của tài khoản khác.</span>
                </span></label>
            </div>
          </fieldset>
          <fieldset className="campaign-import-dedup-window add-data-dup-window" disabled={running}>
            <div className="campaign-import-dedup-window-row" role="group" aria-label="Khoảng thời gian kiểm tra trùng">
              <span className="campaign-import-dedup-window-label">Khoảng thời gian</span>
              {dayPresets.map(preset => <button key={preset} type="button" className="campaign-import-dedup-preset" aria-pressed={daysText === '' && days === preset}
                onClick={() => changeDays(preset)}>{preset} ngày</button>)}
              <label className="campaign-import-dedup-days">Khác
                <input className="stepper-input" type="number" inputMode="numeric" min={1} max={dayLimit} step={1} aria-label="Số ngày kiểm tra trùng"
                  aria-invalid={daysInvalid} value={daysText !== '' ? daysText : dayPresets.includes(days) ? '' : String(days)}
                  onChange={event => changeDaysText(event.target.value)} />ngày</label>
            </div>
            {daysInvalid
              ? <span className="campaign-import-dedup-field-error" role="alert">Số ngày phải từ 1 đến {dayLimit}.</span>
              : <span>Đối chiếu dữ liệu tải lên từ <strong>{inputDuplicateWindowStart(days)}</strong> đến hôm nay.</span>}
            <span className="campaign-import-dedup-note">Chỉ đối chiếu chiến dịch cùng loại. Chiến dịch đã xóa chỉ tính các số đã chạy.</span>
          </fieldset>
          {progress && <div className="campaign-import-dedup-progress" role="status">
            <div className="campaign-import-dedup-progress-head">
              <span>Đang đối chiếu với dữ liệu đã tải lên <strong>{number(progress.done)}/{number(progress.total)}</strong> số…</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={cancelRun}>Hủy kiểm tra</button>
            </div>
            <div className="campaign-import-dedup-progress-bar" role="progressbar" aria-label="Tiến độ đối chiếu" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style={{ width: `${progress.total ? Math.round(100 * progress.done / progress.total) : 0}%` }} />
            </div>
          </div>}
          {failure && !running && <div className="campaign-import-dedup-error" role="alert">
            <strong>Chưa đối chiếu được với dữ liệu đã tải lên</strong>
            <span>{failure} Danh sách chờ thêm vẫn giữ nguyên.</span>
          </div>}
        </div>
        <div className="modal-footer add-current-data-footer">
          <span className="add-current-data-summary">{running ? 'Hủy thì không có số nào bị bỏ.' : 'Bước này chưa bỏ số nào khỏi danh sách.'}</span>
          <div className="add-current-data-footer-actions">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={running}>Huỷ</button>
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={running || blocked}>
              <ListChecks size={14} /> {running ? 'Đang kiểm tra…' : failure ? 'Thử lại' : `Kiểm tra ${number(phones.length)} số`}
            </button>
          </div>
        </div>
      </>}

      {outcome && <>
        <div className="modal-body add-data-dup-body">
          <div className="campaign-import-confirm-total add-data-dup-total" role="status">
            <strong>{number(foundCount)}</strong>
            <span>{foundCount ? `số đã có ở chiến dịch khác, trên ${number(outcome.checkedPhones.length)} số đã đối chiếu.` : `Không có số nào trong ${number(outcome.checkedPhones.length)} số đã có ở chiến dịch khác.`}</span>
            <span className="add-data-dup-total-meta">Trong {outcome.days} ngày ({windowText(outcome)} – hôm nay) · {scopeText(outcome.scope, outcome.accountIds.length)} · đối chiếu lúc {formatVietnamTime(outcome.checkedAt)}.</span>
          </div>
          {foundCount > 0 && <>
            <div className="add-current-data-preview-header add-data-dup-found-header">
              <span>Các số đã có</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportFound}><Download size={13} /> Tải Excel {number(foundCount)} số</button>
            </div>
            <div className="add-data-dup-table">
              <table className="campaign-grid"><thead><tr><th>Số điện thoại</th><th>Đã có ở chiến dịch</th><th>Tài khoản</th><th>Ngày tải lên</th><th>Trạng thái</th></tr></thead>
                <tbody>{foundEntries.slice(0, RESULT_PREVIEW_ROWS).map(({ row, existing }, index) => {
                  const latest = existing.latest
                  return <tr key={`${index}-${existing.phone}`}>
                    <td>{row.phone}</td>
                    <td>{latest.campaignDeleted ? `${latest.campaignName} (đã xóa)` : latest.campaignName}{existing.campaignCount > 1 ? ` · +${existing.campaignCount - 1} chiến dịch` : ''}</td>
                    <td>{latest.accountName}</td>
                    <td>{formatVietnamDate(latest.uploadedAt)}</td>
                    <td><span className="campaign-import-status-pill">{inputDuplicateStatusLabel(latest)}</span></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
            {foundCount > RESULT_PREVIEW_ROWS && <div className="text-muted add-data-dup-note">Hiển thị {RESULT_PREVIEW_ROWS}/{number(foundCount)} số. Tải Excel để xem đủ danh sách.</div>}
            <div>Bỏ {number(foundCount)} số này thì còn <strong>{number(rows.length - foundCount)}</strong> data chờ thêm. Giữ nguyên thì cả {number(rows.length)} data vẫn ở lại danh sách.</div>
          </>}
          <div className="text-muted add-data-dup-note">Số được tải lên ở chiến dịch khác sau {formatVietnamTime(outcome.checkedAt)} chưa được tính.</div>
        </div>
        <div className="modal-footer">
          {foundCount > 0
            ? <><button type="button" className="btn btn-secondary" onClick={() => onDone({ ...outcome, removed: false })}>Giữ nguyên</button>
              <button type="button" className="btn btn-primary" onClick={() => onDone({ ...outcome, removed: true })}>Bỏ {number(foundCount)} số</button></>
            : <button type="button" className="btn btn-primary" onClick={() => onDone({ ...outcome, removed: false })}>Xong</button>}
        </div>
      </>}
    </div>
  </div>, document.body)}
  {pickerOpen && <InputDuplicateAccountPicker accounts={zaloAccounts} selectedIds={pickedIds} onClose={() => setPickerOpen(false)} onSave={savePicked} />}
  </>
}
