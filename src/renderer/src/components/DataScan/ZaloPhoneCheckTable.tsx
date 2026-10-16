import { memo } from 'react'
import { useStore } from 'zustand'
import { ZALO_PHONE_CHECK_LABELS } from '../../../../shared/zaloPhoneCheck'
import type { PhoneCheckFilter, ZaloPhoneCheckStore } from '../../stores/zaloPhoneCheckStore'

export const ZaloPhoneCheckTableRow = memo(function ZaloPhoneCheckTableRow({ store, id, index }: { store: ZaloPhoneCheckStore; id: string; index: number }) {
  const row = useStore(store, state => state.rows[id])
  const selected = useStore(store, state => !!state.selected[id])
  return <tr data-phone-row={id}>
    <td><input type="checkbox" aria-label={`Chọn ${row.phone}`} checked={selected} onChange={() => store.toggle(id)} /></td>
    <td>{index + 1}</td><td>{row.phone}</td><td>{row.name || '—'}</td><td>{row.uid || '—'}</td>
    <td><span className={`phone-check-status is-${row.status}`}>{ZALO_PHONE_CHECK_LABELS[row.status]}</span></td>
    <td>{row.note || '—'}</td>
  </tr>
})

function SelectVisible({ store }: { store: ZaloPhoneCheckStore }) {
  const all = useStore(store, state => state.visibleIds.length > 0 && state.visibleIds.every(id => state.selected[id]))
  return <input type="checkbox" aria-label="Chọn toàn bộ dòng đang lọc" checked={all} onChange={event => store.selectVisible(event.target.checked)} />
}

export const ZaloPhoneCheckTable = memo(function ZaloPhoneCheckTable({ store }: { store: ZaloPhoneCheckStore }) {
  const ids = useStore(store, state => state.visibleIds)
  const allIds = useStore(store, state => state.ids)
  return <div className="phone-check-table-scroll"><table>
    <thead><tr><th><SelectVisible store={store} /></th><th>STT</th><th>SĐT</th><th>Tên Zalo</th><th>Zalo ID</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
    <tbody>{ids.map(id => <ZaloPhoneCheckTableRow key={id} store={store} id={id} index={allIds.indexOf(id)} />)}
      {!ids.length && <tr><td colSpan={7} className="phone-check-empty">{allIds.length ? 'Không có số điện thoại thuộc bộ lọc này.' : 'Tải data để thêm danh sách số điện thoại.'}</td></tr>}
    </tbody>
  </table></div>
})

export function ZaloPhoneCheckSummary({ store }: { store: ZaloPhoneCheckStore }) {
  const total = useStore(store, state => state.ids.length)
  const selected = useStore(store, state => state.ids.filter(id => state.selected[id]).length)
  const processed = useStore(store, state => state.processed)
  const checking = useStore(store, state => state.checkingPhone)
  const checkingIndex = useStore(store, state => state.checkingPhone ? state.ids.indexOf(state.checkingPhone) + 1 : 0)
  const message = useStore(store, state => state.message)
  const filter = useStore(store, state => state.filter)
  return <div className="phone-check-summary">
    <div><strong>{total} SĐT</strong><span>Đã chọn {selected}</span>{total > 0 && <span>Đã có kết quả: {processed}/{total}</span>}
      <ZaloPhoneCheckDailyUsage store={store} />
      {checking && <span role="status">Đang kiểm tra số {checkingIndex}/{total}: <strong>{checking}</strong></span>}</div>
    <label>Lọc trạng thái <select className="stepper-input" value={filter} onChange={event => store.filter(event.target.value as PhoneCheckFilter)}>
      <option value="all">Tất cả</option>{Object.entries(ZALO_PHONE_CHECK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <ZaloPhoneCheckUsageError store={store} />
    {message && <p role="status">{message}</p>}
  </div>
}

function ZaloPhoneCheckDailyUsage({ store }: { store: ZaloPhoneCheckStore }) {
  const usage = useStore(store, state => state.usage)
  return usage ? <span role="status" data-phone-daily-usage title={`Còn ${usage.remaining} lượt (ngày ${usage.date.split('-').reverse().join('/')}, giờ Việt Nam)`}>
    Hôm nay: {usage.count}/{usage.limit} lượt
  </span> : null
}

function ZaloPhoneCheckUsageError({ store }: { store: ZaloPhoneCheckStore }) {
  const error = useStore(store, state => state.usageError)
  return error ? <p role="status">{error}</p> : null
}
