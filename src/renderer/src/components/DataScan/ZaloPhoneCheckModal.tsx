import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { X } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import type { DataGroup, DataTypeCategoryItem } from '../../../../shared/types'
import { normalizeZaloCheckPhones, zaloPhoneCheckExport, zaloPhoneCheckGroupRows } from '../../../../shared/zaloPhoneCheck'
import { createZaloPhoneCheckStore } from '../../stores/zaloPhoneCheckStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import CampaignDataUploadModal from '../CampaignPanels/CampaignDataUploadModal'
import DataGroupPickerModal from '../DataGroups/DataGroupPickerModal'
import { ZaloPhoneCheckSummary, ZaloPhoneCheckTable } from './ZaloPhoneCheckTable'
import './ZaloPhoneCheckModal.css'

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Không thể thực hiện thao tác. Vui lòng thử lại.'

export default function ZaloPhoneCheckModal({ onClose, initialAccountId }: { onClose: () => void; initialAccountId?: number }) {
  const [store] = useState(createZaloPhoneCheckStore)
  const accounts = useCampaignStore(state => state.accounts)
  const staffId = useAuthStore(state => state.user?.staffId)
  const busy = useStore(store, state => state.busy)
  const stopping = useStore(store, state => state.stopping)
  const hasRun = useStore(store, state => state.runId !== null)
  const allChecked = useStore(store, state => state.ids.length > 0 && state.processed === state.ids.length)
  const [accountId, setAccountId] = useState(initialAccountId || 0)
  const dailyLimit = useStore(store, state => state.usageAccountId === accountId ? state.usage?.limit ?? null : null)
  const [limit, setLimit] = useState<string | null>(null)
  const limitValue = limit ?? (dailyLimit === null ? '' : String(dailyLimit))
  const [upload, setUpload] = useState(false)
  const [chooseType, setChooseType] = useState(false)
  const [groupType, setGroupType] = useState<DataTypeCategoryItem | null>(null)
  const [saving, setSaving] = useState(false)
  const modalRef = useRef<HTMLElement>(null)
  const mounted = useRef(true)
  const pending = useRef<Promise<unknown> | null>(null)
  const usageReadGeneration = useRef(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const zaloAccounts = accounts.filter(account => account.flatformType === 'zalo')
  const showError = (error: unknown) => useUiStore.getState().showAlert(messageOf(error), 'error')

  useEffect(() => {
    if (dailyLimit !== null) setLimit(value => value !== null && Number(value) > dailyLimit ? String(dailyLimit) : value)
  }, [dailyLimit])

  useEffect(() => {
    let active = true
    const generation = ++usageReadGeneration.current
    store.setState({ usage: null, usageAccountId: accountId || null, usageError: '' })
    if (accountId && staffId) {
      // One read on selection. Run events become authoritative once Start is pressed.
      void window.electronAPI.zaloPhoneCheck.usage(accountId).then(usage => {
        if (active && !store.getState().busy && usageReadGeneration.current === generation) store.setState({ usage, usageError: '' })
      }).catch(error => {
        if (active && !store.getState().busy && usageReadGeneration.current === generation) store.setState({ usageError: messageOf(error) })
      })
    }
    return () => { active = false }
  }, [accountId, staffId, store])

  useEffect(() => {
    mounted.current = true
    const previousFocus = document.activeElement as HTMLElement | null
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const offRow = window.electronAPI.zaloPhoneCheck.onRow(store.row)
    const offComplete = window.electronAPI.zaloPhoneCheck.onCompleted(store.complete)
    return () => {
      mounted.current = false
      offRow(); offComplete()
      const state = store.getState()
      if (state.busy && state.runId) void window.electronAPI.zaloPhoneCheck.cancel(state.runId).catch(() => undefined)
      store.fail('Đã đóng phiên kiểm tra.')
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [store])

  useEffect(() => {
    if (!staffId) closeRef.current()
  }, [staffId])

  const stop = async () => {
    const state = store.getState()
    if (!state.busy || !state.runId) return
    store.setState({ stopping: true })
    try {
      await window.electronAPI.zaloPhoneCheck.cancel(state.runId)
      await pending.current
    } catch (error) { if (mounted.current) showError(error) }
    finally { if (mounted.current) store.setState({ stopping: false }) }
  }
  const close = () => {
    if (saving || stopping) return
    if (!store.getState().busy) return onClose()
    useUiStore.getState().showConfirm('Lượt kiểm tra đang chạy. Dừng lượt kiểm tra và đóng cửa sổ?', async () => {
      await stop()
      if (!store.getState().busy) closeRef.current()
    }, { title: 'Dừng kiểm tra SĐT', confirmText: 'Dừng và đóng', cancelText: 'Tiếp tục kiểm tra' })
  }
  const start = async () => {
    if (store.getState().busy || saving) return
    try {
      if (!zaloAccounts.some(account => account.id === accountId)) throw new Error('Vui lòng chọn tài khoản Zalo.')
      if (dailyLimit === null) throw new Error('Vui lòng chờ xác nhận hạn mức ngày của tài khoản.')
      const count = Number(limitValue)
      if (!Number.isInteger(count) || count < 1 || count > dailyLimit) throw new Error(`Số lượng kiểm tra phải từ 1 đến ${dailyLimit}.`)
      const state = store.getState()
      const phones = normalizeZaloCheckPhones(state.ids.filter(id => state.rows[id].status === 'pending' || state.rows[id].status === 'unknown'), dailyLimit)
      const runId = crypto.randomUUID()
      // Upload resets runId; it must never make a pre-run usage read current again.
      usageReadGeneration.current++
      store.begin(runId, accountId)
      const request = window.electronAPI.zaloPhoneCheck.start({ runId, accountId, limit: count, phones })
      pending.current = request
      try { const result = await request; if (mounted.current) store.complete(result) }
      catch (error) { if (mounted.current && store.getState().runId === runId) store.fail(messageOf(error)) }
      finally { if (pending.current === request) pending.current = null }
    } catch (error) { showError(error) }
  }
  const selectedRows = () => {
    const rows = store.selectedRows()
    if (!rows.length) throw new Error('Vui lòng tích chọn các dòng cần sử dụng.')
    return rows
  }
  const exportExcel = (template: boolean) => {
    try {
      const sheet = utils.aoa_to_sheet(zaloPhoneCheckExport(selectedRows(), template))
      // All values are strings, including leading-zero phones and long UIDs.
      sheet['!cols'] = (template ? [24, 20, 18, 22, 18, 18, 18, 18, 18] : [7, 18, 24, 24, 26, 65]).map(wch => ({ wch }))
      const book = utils.book_new()
      utils.book_append_sheet(book, sheet, template ? 'akaBiz' : 'Kết quả')
      writeFile(book, template ? 'Mau-akaBiz-SDT.xlsx' : 'Kiem-tra-SDT-Zalo.xlsx')
    } catch (error) { showError(error) }
  }
  const pickGroup = async (code: 'phone' | 'zalo_person') => {
    try {
      zaloPhoneCheckGroupRows(selectedRows(), code)
      setSaving(true)
      const types = await window.electronAPI.listDataTypeCategoryItems()
      if (!mounted.current) return
      const type = types.find(item => item.code === code && item.isActive)
      if (!type) throw new Error('Không tìm thấy loại nhóm data phù hợp.')
      setChooseType(false); setGroupType(type)
    } catch (error) { if (mounted.current) showError(error) }
    finally { if (mounted.current) setSaving(false) }
  }
  const saveGroup = async (group: DataGroup) => {
    if (!groupType || saving) return
    try {
      if (group.dataTypeCategoryItemId !== groupType.id) throw new Error('Vui lòng chọn nhóm có đúng loại data đã chọn.')
      const selected = selectedRows()
      if (groupType.code === 'zalo_person' && group.boundZaloAccountId && selected.some(row => row.accountId !== group.boundZaloAccountId)) {
        throw new Error('Nhóm Zalo UID này thuộc tài khoản khác với tài khoản đã kiểm tra. Vui lòng chọn hoặc tạo nhóm phù hợp.')
      }
      const rows = zaloPhoneCheckGroupRows(selected, groupType.code as 'phone' | 'zalo_person')
      setSaving(true)
      const result = await window.electronAPI.ingestDataGroup({ requestId: crypto.randomUUID(), groupId: group.id,
        kind: 'scan', rows, dataTypeCategoryItemId: groupType.id, sourceName: 'Kiểm tra SĐT có Zalo' })
      if (!mounted.current) return
      setGroupType(null)
      const issues = result.invalidCount + result.incompatibleCount + result.conflictCount
      useUiStore.getState().showAlert(`Đã thêm ${result.insertedMembershipCount + result.reactivatedMembershipCount} dòng vào nhóm; ${result.alreadyMemberCount} dòng đã có.${issues ? ` ${issues} dòng chưa được lưu: ${result.conflicts.map(item => item.message).join('; ') || 'Dữ liệu không phù hợp.'}` : ''}`, issues ? 'error' : 'success')
    } catch (error) { if (mounted.current) showError(error) }
    finally { if (mounted.current) setSaving(false) }
  }

  return createPortal(<div className="modal-overlay phone-check-overlay">
    <section ref={modalRef} className="phone-check-modal" onKeyDown={event => {
      if (upload || groupType || chooseType) return
      if (event.key === 'Escape') { event.stopPropagation(); close(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'))
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }} role="dialog" aria-modal="true" aria-labelledby="phone-check-title">
      <header className="modal-header"><h2 id="phone-check-title">Kiểm tra SĐT có Zalo</h2><button className="btn-icon" aria-label="Đóng kiểm tra SĐT" onClick={close} disabled={stopping || saving}><X size={18} /></button></header>
      <div className="phone-check-config">
        <label>Tài khoản Zalo<select className="stepper-input" value={accountId} onChange={event => setAccountId(Number(event.target.value))} disabled={busy || saving}>
          <option value={0}>Chọn tài khoản</option>{zaloAccounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.isZaloServer ? 'Zalo Server' : account.isZaloShowWeb ? 'Web' : 'QR'}</option>)}
        </select></label>
        <label>Số lượng kiểm tra<input className="stepper-input" type="number" min={1} max={dailyLimit ?? undefined} value={limitValue} onChange={event => setLimit(event.target.value)} disabled={busy || saving || dailyLimit === null} /></label>
        <button className="btn btn-secondary" disabled={busy || saving || dailyLimit === null} onClick={() => setUpload(true)}>Tải data</button>
        {busy ? <button className="btn btn-danger" disabled={stopping} onClick={() => void stop()}>{stopping ? 'Đang dừng…' : 'Dừng'}</button>
          : <button className="btn btn-primary" disabled={saving || allChecked || dailyLimit === null} onClick={() => void start()}>{hasRun ? 'Tiếp tục kiểm tra' : 'Bắt đầu kiểm tra'}</button>}
      </div>
      <p className="phone-check-hint">{dailyLimit === null ? 'Chọn tài khoản và chờ xác nhận hạn mức ngày để tải data.' : `Tối đa ${dailyLimit} SĐT hợp lệ, không trùng theo hạn mức ngày.`} Mỗi lượt kiểm tra các số Chưa kiểm tra hoặc Chưa xác định theo thứ tự danh sách và số lượng đã đặt.</p>
      <ZaloPhoneCheckSummary store={store} /><ZaloPhoneCheckTable store={store} />
      <footer className="modal-footer">
        <button className="btn btn-secondary" disabled={busy || saving} onClick={() => { try { selectedRows(); setChooseType(true) } catch (error) { showError(error) } }}>Lưu vào nhóm data</button>
        <button className="btn btn-secondary" disabled={saving} onClick={() => exportExcel(false)}>Tải về Excel</button>
        <button className="btn btn-secondary" disabled={saving} onClick={() => exportExcel(true)}>Tải về Excel mẫu akaBiz</button>
      </footer>
      {chooseType && <div className="phone-check-subdialog" role="dialog" aria-modal="true" aria-label="Chọn loại nhóm data"><div>
        <h3>Lưu các dòng đã chọn vào nhóm</h3><p>Nhóm Zalo UID chỉ nhận dòng Có Zalo và giữ tài khoản đã kiểm tra.</p>
        <button className="btn btn-primary" disabled={saving} onClick={() => void pickGroup('phone')}>Nhóm SĐT</button>
        <button className="btn btn-secondary" disabled={saving} onClick={() => void pickGroup('zalo_person')}>Nhóm Zalo UID</button>
        <button className="btn btn-ghost" disabled={saving} onClick={() => setChooseType(false)}>Hủy</button>
      </div></div>}
    </section>
    {upload && <CampaignDataUploadModal platform="zalo" actionId="zalo_message_phone" accountIds={[]} showDatasetName={false}
      title="Tải danh sách SĐT kiểm tra Zalo" submitLabel="Thêm SĐT" contextSlot={<p>Chỉ lấy số điện thoại. Tên, UID, Email và Info từ nguồn nhập sẽ được bỏ.</p>}
      onInsert={() => undefined} onClose={() => setUpload(false)} onSubmitRows={({ rows }) => {
        // Copy only phones across the importer boundary; never retain imported identities or metadata.
        if (dailyLimit === null) throw new Error('Chưa xác nhận được hạn mức kiểm tra SĐT.')
        const phones = normalizeZaloCheckPhones(rows.map(row => row.phone), dailyLimit)
        store.load(phones)
      }} />}
    {groupType && <DataGroupPickerModal compatibleDataTypeCategoryItemId={groupType.id} onSelect={group => void saveGroup(group)} onClose={() => { if (!saving) setGroupType(null) }} />}
  </div>, document.body)
}
