import { useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw, UserRound } from 'lucide-react'
import type { AutoAccount } from '../../../../shared/types'
import { RANDOM_TURN_LABELS, vietnamRunDate, type FacebookRandomDay } from '../../../../shared/facebookRandomRun'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import './facebookRandomRun.css'

export default function FacebookRandomRunPanel({ account, campaignId, active }: { account: AutoAccount; campaignId?: number | null; active: boolean }) {
  const [date, setDate] = useState(vietnamRunDate), [scope, setScope] = useState<'account' | 'campaign'>(campaignId ? 'campaign' : 'account')
  const [page, setPage] = useState(1), [data, setData] = useState<FacebookRandomDay | null>(null)
  const [dates, setDates] = useState<string[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0), [loadingDates, setLoadingDates] = useState(false)
  const generation = useRef(0)
  const retrying = useRef(false)
  const [retryBusy, setRetryBusy] = useState(false)
  const user = useAuthStore(state => state.user)
  const viewKey = [account.id, campaignId, scope, date, page, user?.staffId, user?.organizationId].join(':')
  const [loadedView, setLoadedView] = useState('')
  useEffect(() => { setScope(campaignId ? 'campaign' : 'account'); setPage(1); setDate(vietnamRunDate()); setData(null); setDates([]) }, [account.id, campaignId])
  useEffect(() => {
    setLoadingDates(false)
    if (!active) return
    const key = ++generation.current
    let busy = false, requested = false, disposed = false
    const visible = () => document.visibilityState === 'visible'
    const read = async () => {
      if (!visible() || disposed) return
      if (busy) { requested = true; return }
      busy = true; setLoading(true)
      try {
        const result = await window.electronAPI.facebookRandomRun.day(account.id, { date, campaignId: scope === 'campaign' ? campaignId : null, page })
        if (generation.current === key) { setData(result); setLoadedView(viewKey); setError('') }
      } catch (e) { if (generation.current === key) setError(e instanceof Error ? e.message : String(e)) }
      finally {
        busy = false
        if (generation.current === key) setLoading(false)
        if (requested && !disposed) { requested = false; void read() }
      }
    }
    // Share the existing visibility-aware page coordinator; no new polling clock.
    const unsubscribe = useCampaignStore.subscribe((state, old) => {
      if (state.campaignsReadAt !== old.campaignsReadAt) void read()
    })
    const onVisible = () => { if (visible()) void read() }
    document.addEventListener('visibilitychange', onVisible)
    void read()
    if (visible()) void window.electronAPI.facebookRandomRun.dates(account.id).then(value => { if (generation.current === key) setDates(value) }).catch(() => {})
    return () => { disposed = true; generation.current++; unsubscribe(); document.removeEventListener('visibilitychange', onVisible) }
  }, [account.id, campaignId, scope, date, page, active, refresh, user?.staffId, user?.organizationId, viewKey])
  const moreDates = async () => {
    const key = generation.current
    setLoadingDates(true)
    try { const next = await window.electronAPI.facebookRandomRun.dates(account.id, dates.at(-1)); if (generation.current === key) setDates(old => Array.from(new Set([...old, ...next]))) }
    catch (e) { if (generation.current === key) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (generation.current === key) setLoadingDates(false) }
  }
  const current = loadedView === viewKey && data?.accountId === account.id && data.date === date && data.page === page ? data : null
  const retryAi = async () => {
    if (retrying.current) return
    retrying.current = true; setRetryBusy(true)
    const key = generation.current
    try {
      await window.electronAPI.facebookRandomRun.retryAi(account.id)
      if (key === generation.current) { setError(''); setRefresh(n => n + 1) }
    } catch (e) { if (key === generation.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { retrying.current = false; setRetryBusy(false) }
  }
  const ai = current?.ai
  const allocation = current?.allocation
  const running = current?.activeTurn?.aiPlanId === ai?.requestId ? current?.activeTurn : null
  return <div className="random-plan">
    <div className="detail-filter-controls random-plan-filters">
      <div className="report-dropdown-field random-filter-account">
        <span>Tài khoản</span>
        <strong className="random-filter-account-name" title={account.name}><UserRound size={14} aria-hidden="true"/><span>{account.name}</span></strong>
      </div>
      <label className="report-dropdown-field random-filter-date">
        <span>Ngày</span>
        <input className="report-filter-button detail-filter-button random-filter-control" aria-label="Ngày chạy ngẫu nhiên" type="date" value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setPage(1); setData(null) } }}/>
      </label>
      <label className="report-dropdown-field random-filter-history">
        <span>Lịch sử</span>
        <div className="random-filter-select">
          <select className="report-filter-button detail-filter-button random-filter-control" aria-label="Ngày có lịch sử" value={dates.includes(date) ? date : ''} onChange={e => { if (e.target.value) { setDate(e.target.value); setPage(1); setData(null) } }}><option value="">Chọn ngày</option>{dates.map(d => <option key={d} value={d}>{d.split('-').reverse().join('/')}</option>)}</select>
          <ChevronDown size={14} aria-hidden="true"/>
        </div>
      </label>
      {dates.length >= 100 && <button className="btn btn-secondary btn-sm" disabled={loadingDates} onClick={() => void moreDates()}>Ngày cũ hơn</button>}
      <label className="report-dropdown-field random-filter-scope">
        <span>Phạm vi</span>
        <div className="random-filter-select">
          <select className="report-filter-button detail-filter-button random-filter-control" aria-label="Phạm vi tiến trình" value={scope} onChange={e => { setScope(e.target.value as 'account' | 'campaign'); setPage(1); setData(null) }}><option value="account">Toàn bộ tài khoản</option>{campaignId && <option value="campaign">Chiến dịch đang xem</option>}</select>
          <ChevronDown size={14} aria-hidden="true"/>
        </div>
      </label>
      <button className="btn btn-secondary btn-sm random-filter-refresh" disabled={loading} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} aria-hidden="true"/>Làm mới</button>
    </div>
    {error && <p className="random-error" role="alert">{error}</p>}
    {(ai || current?.aiMode) && <section className="random-ai-plan" aria-label="Kế hoạch AI">
      <div className="random-toolbar">
        <strong>Kế hoạch AI{allocation ? ` · Vòng kế hoạch ${running?.planCycle ?? allocation.cycle} · Vòng phân lượt ${allocation.coverageRound}` : ''}</strong>
        {current?.canRetryAi &&
          <button className="btn btn-secondary btn-sm" disabled={retryBusy} onClick={() => void retryAi()}>{retryBusy ? 'Đang xử lý…' : 'Thử lại AI'}</button>}
      </div>
      <p className="random-muted" role="status">{ai?.status === 'ready'
        ? `Đã phân lượt cho ${allocation?.servedCount ?? 0} chiến dịch trong vòng này. Chỉ tiêu từng dòng được giữ suốt ngày.`
        : ai?.status === 'generating' ? `AI đang lập kế hoạch (lần gọi ${ai.attempts}).`
        : ai?.status === 'retry_wait' ? `Chưa lập được kế hoạch AI. Thử lại khi đến lượt scheduler${ai.nextAttemptAt ? ' sau ' + new Date(ai.nextAttemptAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : ''}.`
        : ai?.status === 'failed' ? `${ai.error || 'Chưa lập được kế hoạch AI sau các lần thử.'}${current?.canRetryAi ? ' Bấm Thử lại AI để thử lại.' : ''}`
        : 'Kế hoạch sẽ được lập khi có chiến dịch đủ điều kiện chạy.'}</p>
      {ai?.rules && <div className="random-table-scroll"><table className="random-table random-ai-table">
        <thead><tr><th>Dòng</th><th>Hành động</th><th>Chỉ tiêu</th><th>Trạng thái</th></tr></thead>
        <tbody>{ai.rules.map((rule, index) => {
          const action = ai.context.actions.find(action => action.campaignActionId === rule.campaignActionId)
          const available = allocation?.availableActionIds?.includes(rule.campaignActionId)
          const isRunning = running?.ruleIndex === index
          return <tr key={index} className={isRunning ? 'random-ai-current' : ''} aria-current={isRunning ? 'step' : undefined}>
            <td>{index + 1}</td><td>{action?.name || rule.campaignActionId}{action?.waitingCount === 0 ? ' · Dự phòng' : ''}</td>
            <td>{rule.quantity} {rule.unit === 'minute' ? 'phút' : rule.unit === 'run' ? 'lượt' : 'data'}</td>
            <td>{isRunning ? 'Đang thực hiện' : available === false ? 'Bỏ qua ngay khi không có chiến dịch đủ điều kiện' : allocation?.pendingActionIds && !allocation.pendingActionIds.includes(rule.campaignActionId) ? 'Bỏ qua · nhóm đã đủ lượt trong vòng này' : index === allocation?.cursor ? 'Dòng xét tiếp theo' : 'Chờ phân lượt'}</td>
          </tr>
        })}</tbody></table></div>}
    </section>}
    <div className="random-table-scroll"><table className="random-table"><thead><tr><th>Thứ tự</th><th>Chiến dịch</th><th>Chỉ tiêu</th><th>Đã xử lý</th><th>Trạng thái</th><th>Lý do</th></tr></thead><tbody>
      {current?.turns.map(turn => <tr key={turn.id}><td title={`Vòng ${turn.round}, dòng ${turn.ruleIndex + 1}, cấu hình ${turn.revision}`}>{turn.order}{turn.aiPlanId && <small className="random-ai-turn-ref">Dòng {turn.ruleIndex + 1} · Vòng phân lượt {turn.coverageRound}</small>}</td><td>{turn.campaignName}</td><td>{turn.quantity} {turn.unit === 'minute' ? 'phút' : turn.unit === 'run' ? 'lượt' : 'data'}</td>
        <td>{turn.unit === 'minute' ? `${Math.floor(turn.elapsedSeconds / 60).toString().padStart(2, '0')}:${(turn.elapsedSeconds % 60).toString().padStart(2, '0')}` : `${turn.processed} ${turn.unit === 'run' ? 'lượt' : 'data'}`}</td>
        <td><span className={`random-turn-status random-turn-${turn.status}`}>{RANDOM_TURN_LABELS[turn.status]}</span></td><td>{turn.reason || '—'}</td></tr>)}
      {!current?.turns.length && <tr><td colSpan={6} className="random-empty">{loading ? 'Đang tải tiến trình…' : error ? 'Chưa tải được tiến trình.' : 'Chưa có đợt chạy ngẫu nhiên trong ngày này'}</td></tr>}
    </tbody></table></div>
    <div className="random-toolbar"><span className="random-muted">“Hoàn tất đợt” chỉ kết thúc chỉ tiêu của đợt này.</span><div className="random-pagination"><button className="btn btn-secondary btn-sm" disabled={page <= 1 || loading} onClick={() => { setData(null); setPage(n => n - 1) }}>Trước</button><span>Trang {page} · {current?.total ?? 0} đợt</span><button className="btn btn-secondary btn-sm" disabled={!current || page * 100 >= current.total || loading} onClick={() => { setData(null); setPage(n => n + 1) }}>Sau</button></div></div>
  </div>
}
