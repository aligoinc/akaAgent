import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCw, Search, Users } from 'lucide-react'
import type { CampaignResultGroupItem } from '../../../../shared/campaignResultGroups'
import { CampaignResultGroupRow } from '../CampaignResultGroups/CampaignResultGroups'
import { campaignResultGroupsClient, isNotReadyError } from '../CampaignResultGroups/campaignResultGroupsClient'
import '../CampaignResultGroups/CampaignResultGroups.css'

type Filter = 'all' | 'active' | 'paused' | 'stopped'
const FILTER_LABELS: Record<Filter, string> = { all: 'Tất cả', active: 'Đang đồng bộ', paused: 'Đã tắt', stopped: 'Đã dừng' }
const stateFilter = (item: CampaignResultGroupItem): Filter => item.state === 'active' ? 'active' : item.state === 'stopped' ? 'stopped' : 'paused'
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
const formatNumber = (value: number) => value.toLocaleString('vi-VN')

/**
 * Tự động hóa › Từ chiến dịch (chuyển từ akaAgentWebApp CampaignResultGroupsPage): các đồng bộ "Sau khi chạy: đưa khách vào
 * nhóm" của nhân viên (200 dòng mới nhất). Chỉ đọc khi mở thẻ lần đầu và khi bấm Làm mới; Tắt / Bật lại / Bỏ cập nhật đúng dòng.
 */
export default function FromCampaignsTab({ isActive, onNewCampaign }: { isActive: boolean; onNewCampaign: () => void }) {
  const [items, setItems] = useState<CampaignResultGroupItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notReady, setNotReady] = useState(false)
  const [revision, setRevision] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState(false)

  useEffect(() => { if (isActive) setOpened(true) }, [isActive])
  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    setRefreshing(true)
    setError(null)
    campaignResultGroupsClient.listAll(controller.signal)
      .then(result => { if (!controller.signal.aborted) { setItems(result.items); setNotReady(false) } })
      .catch(reason => {
        if (controller.signal.aborted) return
        if (isNotReadyError(reason)) { setNotReady(true); setItems([]); return }
        setError(reason instanceof Error && reason.message ? reason.message : 'Chưa tải được danh sách đồng bộ.')
      })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false) })
    return () => controller.abort()
  }, [opened, revision])

  const counts = useMemo(() => {
    const map: Record<Filter, number> = { all: 0, active: 0, paused: 0, stopped: 0 }
    for (const item of items ?? []) { map.all += 1; map[stateFilter(item)] += 1 }
    return map
  }, [items])
  const visible = useMemo(() => {
    const needle = normalize(query.trim())
    return (items ?? []).filter(item => (filter === 'all' || stateFilter(item) === filter)
      && (!needle || normalize(`${item.campaignName ?? ''} ${item.groupName} ${item.accountName ?? ''}`).includes(needle)))
  }, [items, filter, query])
  const added = (items ?? []).reduce((sum, item) => sum + item.added, 0)
  const replace = (next: CampaignResultGroupItem) => setItems(current => current?.map(item => item.journeyId === next.journeyId ? { ...item, ...next } : item) ?? current)

  return <div className="from-campaigns-tab">
    <div className="from-campaigns-head">
      <p>Đồng bộ khách vào nhóm theo kết quả chạy của chiến dịch. Thêm, đổi hay bỏ ở mục “Sau khi chạy: đưa khách vào nhóm” của form chiến dịch.</p>
      <div className="from-campaigns-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevision(value => value + 1)} disabled={refreshing}>
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Làm mới
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onNewCampaign}><Plus size={14} /> Thêm chiến dịch</button>
      </div>
    </div>

    {notReady && <p className="crg-note" role="note">Tính năng đưa khách vào nhóm đang được cập nhật trên máy chủ. Vui lòng thử lại sau.</p>}
    {error && <p className="crg-error" role="alert">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRevision(value => value + 1)}>Thử lại</button></p>}
    {items === null && !error && <p className="crg-hint" role="status">Đang tải đồng bộ từ chiến dịch…</p>}
    {items !== null && items.length === 0 && !notReady && <section className="from-campaigns-empty" aria-label="Chưa có đồng bộ">
      <Users size={26} aria-hidden="true" />
      <h2>Chưa có đồng bộ nào từ chiến dịch</h2>
      <p>Khi tạo hoặc sửa chiến dịch, mở mục “Sau khi chạy: đưa khách vào nhóm”, chọn nhóm và kết quả (ví dụ khách đã phản hồi, số không có Zalo, group đăng bài thành công). Data đạt kết quả sẽ tự vào nhóm.</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={onNewCampaign}><Plus size={14} /> Thêm chiến dịch</button>
    </section>}
    {items !== null && items.length > 0 && <>
      <div className="from-campaigns-kpis">
        <div><span>Đang đồng bộ</span><strong>{formatNumber(counts.active)}</strong></div>
        <div><span>Đã tắt</span><strong>{formatNumber(counts.paused)}</strong></div>
        <div><span>Data đã vào nhóm</span><strong>{formatNumber(added)}</strong></div>
      </div>
      <div className="from-campaigns-toolbar">
        <label className="from-campaigns-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={query} placeholder="Tìm chiến dịch, nhóm, tài khoản…" aria-label="Tìm đồng bộ" onChange={event => setQuery(event.target.value)} />
        </label>
        <div className="from-campaigns-filters" role="group" aria-label="Lọc theo trạng thái">
          {(Object.keys(FILTER_LABELS) as Filter[]).filter(key => key === 'all' || counts[key] > 0).map(key => <button key={key} type="button"
            aria-pressed={filter === key} className={`crg-chip${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>{FILTER_LABELS[key]} · {counts[key]}</button>)}
        </div>
      </div>
      <div className="crg">
        {visible.map(item => <CampaignResultGroupRow key={item.journeyId} item={item} onReplaced={replace} showCampaign />)}
        {visible.length === 0 && <p className="crg-hint">Không có đồng bộ nào khớp bộ lọc.</p>}
      </div>
      {items.length >= 200 && <p className="crg-hint">Đang hiện 200 đồng bộ mới nhất.</p>}
    </>}
  </div>
}
