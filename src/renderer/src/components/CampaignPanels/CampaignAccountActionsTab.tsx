import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Clock3, Lock, RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { CampaignListItem } from '../../../../shared/types'
import {
  CAMPAIGN_ACCOUNT_ACTION_UNITS, CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE, campaignAccountActionLimit, describeCampaignActionLimitSource,
  type CampaignAccountActionRow, type CampaignAccountActionsResult
} from '../../../../shared/campaignAccountActions'
import {
  campaignLimitActionView, campaignLimitResume, formatCampaignLimitTime,
  type CampaignLimitActionView, type CampaignLimitProgressItem
} from '../../../../shared/campaignLimitProgress'
import { campaignActionsEstimate } from '../../../../shared/campaignActionsView'
import { useAuthStore } from '../../stores/authStore'
import { useServerClock } from '../../hooks/useCampaignLimitProgress'
import './CampaignAccountActionsTab.css'

/** Số liệu sống của cột "Giới hạn lượt" (cùng bộ tính): mới hơn lượt đọc của tab thì ghi đè số đếm của tab. */
export interface CampaignActionsLive {
  item: CampaignLimitProgressItem
  checkedAtMs: number
  nextDayStartsAtMs: number
  clockOffsetMs: number
}

interface CampaignAccountActionsTabProps {
  campaign: Pick<CampaignListItem, 'id' | 'accountId' | 'accountName'>
    & Partial<Pick<CampaignListItem, 'status' | 'note' | 'inputDataTotalCount' | 'inputDataCompletedCount'>>
  /** Tên nhóm của tài khoản theo danh sách tài khoản (dùng khi tab đọc bằng bộ đọc cũ, chưa có tên nhóm từ V502). */
  accountGroupName?: string | null
  /** Đổi khi hành động của tài khoản vừa được mở khóa hoặc giới hạn vừa sửa ở nơi khác: tải lại. */
  refreshKey?: number
  live?: CampaignActionsLive | null
  onCount?(campaignId: number, count: number | null): void
  onActionsChanged?(accountId: number): void
  /** Mở cửa sổ "Cập nhật giới hạn gửi" của chiến dịch (vắng thì không hiện nút). */
  onEditLimits?(): void
}

const unitOf = (code: string) => CAMPAIGN_ACCOUNT_ACTION_UNITS[code] || 'lượt'
const percent = (used: number, limit: number) => Math.min(100, Math.max(0, Math.round(used / Math.max(1, limit) * 100)))
const minuteCeil = (ms: number) => Math.ceil(ms / 60_000) * 60_000
const SLOT_CHIPS = 12
/** Ngày dd/MM theo giờ Việt Nam; cùng ngày với `now` thì ghi "hôm nay". */
const dayLabel = (ms: number, now: number) => {
  const day = (value: number) => { const date = new Date(value + 7 * 3600_000); return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}` }
  return day(ms) === day(now) ? 'hôm nay' : day(ms)
}
const SCHEDULE_TYPE_LABELS: Record<string, string> = { daily: 'hằng ngày', weekly: 'hằng tuần', monthly: 'hằng tháng', once: '1 lần' }
const errorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : ''
  // IPC bọc lỗi main bằng tiền tố "Error invoking remote method ...: Error: ".
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback
}

/** Ghi đè số đếm của tab bằng số liệu sống của danh sách khi danh sách đọc sau tab. */
function withLive(row: CampaignAccountActionRow, live: CampaignActionsLive | null | undefined, checkedAtMs: number): CampaignAccountActionRow {
  const action = live && live.checkedAtMs > checkedAtMs ? live.item.actions.find(item => item.code === row.code) : null
  if (!action) return row
  return {
    ...row, dayUsed: action.dayUsed, windowUsed: row.limited ? action.windowUsed : row.windowUsed, windowTimes: action.windowTimes,
    windowAtLeast: action.windowAtLeast, disabled: action.locked, enableAt: action.lockedUntil,
    disabledReason: action.locked ? action.lockReason ?? row.disabledReason : null
  }
}

function StatusChip({ view }: { view: CampaignLimitActionView }) {
  if (view.state === 'locked') return <span className="campaign-actions-status is-locked"><Lock size={12} aria-hidden="true" />Bị giới hạn</span>
  if (view.state === 'day') return <span className="campaign-actions-status is-full"><Check size={12} aria-hidden="true" />Đủ lượt hôm nay</span>
  if (view.state === 'window') return <span className="campaign-actions-status is-window"><Clock3 size={12} aria-hidden="true" />Nghỉ theo giờ</span>
  return <span className="campaign-actions-status is-ok"><CheckCircle2 size={12} aria-hidden="true" />Bình thường</span>
}

/** Dòng "khi nào chạy lại" của một hành động. */
function resumeLine(view: CampaignLimitActionView, now: number): string | null {
  if (view.state === 'locked') return view.resumeAt !== null ? `Mở lại ${formatCampaignLimitTime(minuteCeil(view.resumeAt), now)}` : 'Chưa có giờ mở lại'
  if (view.state === 'day') return view.resumeAt !== null ? `Lượt mới từ ${formatCampaignLimitTime(view.resumeAt, now)}` : null
  if (view.state === 'window') return view.resumeAt !== null ? `Chạy tiếp khoảng ${formatCampaignLimitTime(minuteCeil(view.resumeAt), now)}` : null
  return null
}

interface Banner { tone: 'ok' | 'wait' | 'lock' | 'idle'; title: string; detail: string }

/** Dòng đầu tab: chiến dịch đang chạy, hay sớm nhất khi nào chạy lại theo giới hạn lượt và lịch đã lưu. */
function bannerOf(
  data: CampaignAccountActionsResult, rows: CampaignAccountActionRow[], status: string, note: string | null | undefined, now: number, nextDayStartsAt: number
): Banner | null {
  const management = data.management
  if (!management) return null
  if (status === 'hoàn thành') return { tone: 'idle', title: 'Chiến dịch đã hoàn thành', detail: 'Số bên dưới là lượt của tài khoản trong hôm nay.' }
  const blocking = new Set(management.blockingCodes)
  const resume = campaignLimitResume({
    campaignId: data.campaignId, accountId: data.accountId, resumeKnown: management.resumeKnown, skippableCodes: management.skippableCodes,
    actions: rows.filter(row => blocking.has(row.code)).map(campaignAccountActionLimit)
  }, now, nextDayStartsAt)
  const blocker = resume.blocked ? rows.find(row => row.code === resume.actionCode) : null
  const limitDetail = blocker
    ? resume.state === 'locked' ? `${blocker.name} đang bị khóa${blocker.disabledReason ? `: ${blocker.disabledReason.replace(/[\s.]+$/, '')}.` : '.'}`
      : resume.state === 'day' ? `Đã đủ lượt ${blocker.name} hôm nay. Chiến dịch chạy lại theo lịch gửi sau khi có lượt mới.`
        : `Đang chờ lượt ${blocker.name} trong giờ.`
    : ''
  const resumeText = resume.resumeAt !== null
    ? `${resume.state === 'day' ? 'từ' : 'khoảng'} ${formatCampaignLimitTime(resume.state === 'day' ? resume.resumeAt : minuteCeil(resume.resumeAt), now)}` : ''
  if (status === 'tạm dừng') return {
    tone: 'idle', title: 'Chiến dịch đang tạm dừng',
    detail: resume.blocked ? `${limitDetail} Bấm Tiếp tục thì sớm nhất ${resumeText || 'chưa có giờ'} mới chạy lại.` : 'Giới hạn lượt còn chỗ: bấm Tiếp tục để chạy.'
  }
  if (status === 'đang chạy' && !resume.blocked) return { tone: 'ok', title: 'Chiến dịch đang chạy', detail: 'Giới hạn lượt chưa chặn hành động nào.' }
  if (resume.blocked) return {
    tone: resume.state === 'locked' ? 'lock' : 'wait',
    title: resumeText ? `Chạy tiếp sớm nhất ${resumeText}` : 'Chưa có giờ chạy lại',
    detail: `${limitDetail}${management.skippableCodes.length ? ' Chiến dịch cài tiếp tục hành động khác, nhưng các hành động đó cũng đang bị chặn.' : ''}`
  }
  if (!management.resumeKnown) return { tone: 'idle', title: 'Xem trạng thái từng hành động bên dưới', detail: 'Chiến dịch Facebook: chưa xác định được hành động nào làm chiến dịch đứng.' }
  const scheduleMs = management.schedule ? Date.parse(management.schedule) : Number.NaN
  if (Number.isFinite(scheduleMs) && scheduleMs > now) return {
    tone: 'idle', title: `Theo lịch, chạy lúc ${formatCampaignLimitTime(scheduleMs, now)}`, detail: 'Giới hạn lượt không chặn chiến dịch.'
  }
  return {
    tone: 'ok', title: 'Giới hạn lượt không chặn chiến dịch',
    detail: note?.trim() || 'Nếu chiến dịch chưa chạy, nguyên nhân nằm ở chỗ khác: xem ghi chú trên danh sách hoặc bấm "Tại sao CD không chạy?".'
  }
}

/**
 * Tab "Hành động" của chi tiết chiến dịch (port giao diện thẻ từ Web, 12/11/2026): mỗi hành động một thẻ gồm trạng
 * thái và giờ chạy lại, giới hạn và số đã chạy trong ngày/trong giờ, giờ từng lượt rời khung giờ, kết quả hôm nay;
 * phía trên là mốc chạy lại của cả chiến dịch, phía dưới là nhịp chạy, dự kiến hoàn thành và thông tin tài khoản.
 * Một lượt đọc khi mở tab/bấm Làm mới/sau mở khóa; số đếm theo số liệu sống của danh sách khi có; số "trong giờ"
 * tự giảm theo đồng hồ. Không polling riêng, không tự thử lại. Phản hồi của phiên/chiến dịch cũ bị bỏ.
 * DB chưa có V502 thì main dùng bộ đọc cũ: thẻ vẫn hiện, chưa có mốc chạy lại, kết quả hôm nay và phần quản trị.
 */
export default function CampaignAccountActionsTab({ campaign, accountGroupName, refreshKey = 0, live = null, onCount, onActionsChanged, onEditLimits }: CampaignAccountActionsTabProps) {
  const user = useAuthStore(state => state.user)
  const [data, setData] = useState<CampaignAccountActionsResult | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enablingCode, setEnablingCode] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const enabling = useRef(false)
  const onCountRef = useRef(onCount)
  onCountRef.current = onCount

  const load = useCallback(async () => {
    if (!window.electronAPI?.getCampaignAccountActions) return
    const version = ++requestVersion.current
    const isCurrent = () => requestVersion.current === version && useAuthStore.getState().user === user
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getCampaignAccountActions(campaign.id)
      if (!isCurrent()) return
      const checkedAt = Date.parse(result.checkedAt)
      setClockOffsetMs(Number.isFinite(checkedAt) ? checkedAt - Date.now() : 0)
      setData(result)
      onCountRef.current?.(campaign.id, result.actions.length)
    } catch (reason) {
      if (isCurrent()) setError(errorMessage(reason, CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [campaign.id, user])

  useEffect(() => {
    void load()
    return () => { requestVersion.current += 1 }
  }, [load, refreshKey])

  const now = useServerClock(data ? clockOffsetMs : null, !!data)

  const enableNow = useCallback(async (code: string) => {
    if (!window.electronAPI?.enableAccountActionNow || enabling.current || !data?.actions.some(row => row.code === code && row.disabled)) return
    if (useAuthStore.getState().user !== user) return
    const version = requestVersion.current
    const accountId = data.accountId
    enabling.current = true
    setEnablingCode(code)
    setError(null)
    try {
      await window.electronAPI.enableAccountActionNow(accountId, code)
      if (useAuthStore.getState().user !== user) return
      onActionsChanged?.(accountId)
      if (requestVersion.current === version) await load()
    } catch (reason) {
      if (requestVersion.current === version && useAuthStore.getState().user === user) {
        setError(errorMessage(reason, 'Không thể chạy lại hành động ngay.'))
      }
    } finally {
      enabling.current = false
      setEnablingCode(null)
    }
  }, [data, load, onActionsChanged, user])

  const checkedAtMs = data ? Date.parse(data.checkedAt) : 0
  const liveForCampaign = live && live.item.campaignId === campaign.id ? live : null
  const rows = (data?.actions ?? []).map(row => withLive(row, liveForCampaign, checkedAtMs))
  const nextDayStartsAt = data ? Date.parse(data.nextDayStartsAt) : 0
  const updatedAtMs = Math.max(checkedAtMs, liveForCampaign?.checkedAtMs ?? 0)
  const limitedCount = rows.filter(row => row.limited).length
  const groupLabel = data?.groupName ?? accountGroupName ?? null
  const groupSourced = !!data?.groupApplied && rows.some(row => row.dayLimitSource === 'group' || row.windowLimitSource === 'group')
  const capped = rows.some(row => row.dayLimitCapped)
  const packageDailyLimit = rows.find(row => row.limited && row.packageDailyLimit)?.packageDailyLimit ?? null
  const management = data?.management ?? null
  const status = campaign.status ?? management?.status ?? ''
  const banner = data ? bannerOf(data, rows, status, campaign.note, now, nextDayStartsAt) : null
  const pending = campaign.inputDataTotalCount === undefined ? null
    : Math.max(0, Number(campaign.inputDataTotalCount || 0) - Number(campaign.inputDataCompletedCount || 0))
  const estimate = management ? campaignActionsEstimate(rows, pending, now, nextDayStartsAt, management.scheduleType === 'daily', management.skippableCodes) : null
  const scheduleMs = management?.schedule ? Date.parse(management.schedule) : Number.NaN
  const others = new Map<string, { name: string | null; counted: number }>()
  for (const row of rows) for (const item of row.today?.campaigns ?? []) if (!item.current && item.counted > 0) {
    const entry = others.get(String(item.campaignId)) ?? { name: item.name, counted: 0 }
    entry.counted += item.counted
    others.set(String(item.campaignId), entry)
  }

  return <div className="campaign-actions-view">
    <div className="campaign-actions-toolbar">
      <div className="campaign-actions-heading">
        <strong>Hành động của chiến dịch</strong>
        <span>Tài khoản {campaign.accountName || `#${campaign.accountId}`}{data && updatedAtMs ? ` · Cập nhật lúc ${formatCampaignLimitTime(updatedAtMs, now)}` : ''}</span>
      </div>
      <div className="campaign-actions-toolbar-buttons">
        {onEditLimits && data && ['chờ xử lý', 'đang chạy', 'tạm dừng'].includes(status) && <button type="button" className="btn btn-ghost btn-sm" onClick={onEditLimits}>
          <SlidersHorizontal size={14} aria-hidden="true" /> Sửa giới hạn
        </button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (!enabling.current) void load() }} disabled={loading || !!enablingCode}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" /> Làm mới
        </button>
      </div>
    </div>
    {banner && rows.length > 0 && <div className={`campaign-actions-banner is-${banner.tone}`} role="status">
      <strong>{banner.title}</strong><span>{banner.detail}</span>
    </div>}
    {data && (groupSourced || capped || limitedCount > 1) && <ul className="campaign-actions-notes">
      {groupSourced && <li>Tài khoản thuộc nhóm {groupLabel ? <strong>{groupLabel}</strong> : 'tài khoản'}: giới hạn đã cài trong nhóm được ưu tiên hơn cài đặt của chiến dịch.</li>}
      {capped && <li>{packageDailyLimit
        ? <>Gói hiện tại giới hạn tối đa <strong>{packageDailyLimit}</strong> lượt/ngày cho mỗi hành động của tài khoản.</>
        : 'Gói hiện tại giới hạn số lượt/ngày của một số hành động; giới hạn ngày đã được cắt theo gói.'}</li>}
      {limitedCount > 1 && <li>{data.continueWhenActionLimitReached
        ? 'Khi 1 hành động đạt giới hạn, chiến dịch tiếp tục chạy các hành động còn lượt.'
        : 'Khi 1 hành động đạt giới hạn, chiến dịch tạm không chạy và tự chạy lại khi giới hạn được mở.'}</li>}
    </ul>}
    {error && <div role="alert" className="account-info-error campaign-actions-error"><AlertTriangle size={14} /><span>{error}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading || !!enablingCode}>Thử lại</button></div>}
    {!data ? (loading && <div role="status" className="text-center text-secondary account-info-loading">Đang tải hành động của chiến dịch...</div>)
      : !rows.length ? <div className="text-center text-muted account-info-loading">Chiến dịch chưa có hành động nào được bật.</div>
        : <div className="campaign-actions-cards">{rows.map(row => {
          const unit = unitOf(row.code)
          const actionView = campaignLimitActionView(campaignAccountActionLimit(row), now, nextDayStartsAt)
          const dayUsed = now >= nextDayStartsAt ? 0 : row.dayUsed
          const resume = resumeLine(actionView, now)
          const spinning = enablingCode === row.code
          const slots = actionView.slotTimes
          const daySource = describeCampaignActionLimitSource(row.dayLimitSource, {
            groupName: groupLabel, campaignValue: row.campaignDayLimit, effectiveValue: row.dayLimit,
            capped: row.dayLimitCapped, packageDailyLimit: row.packageDailyLimit })
          const windowSource = describeCampaignActionLimitSource(row.windowLimitSource, {
            groupName: groupLabel, campaignValue: row.campaignWindowLimit, effectiveValue: row.windowLimit })
          return <section key={row.code} className={`campaign-actions-card is-${actionView.state}`} aria-label={row.name}>
            <div className="campaign-actions-group campaign-actions-identity">
              <strong className="campaign-actions-name">{row.name}</strong>
              <StatusChip view={actionView} />
              {resume && <strong className="campaign-actions-reopen">{resume}</strong>}
              {actionView.state === 'locked' && row.disabledReason && <small className="campaign-actions-reason" title={row.disabledReason}>{row.disabledReason}</small>}
              {actionView.state === 'locked' && row.lockedAt && <small>Khóa từ {formatCampaignLimitTime(Date.parse(row.lockedAt), now)}</small>}
              {row.lastRunAt && <small>Lượt gần nhất {formatCampaignLimitTime(Date.parse(row.lastRunAt), now)}</small>}
              {row.disabled && <button type="button" className="btn btn-secondary btn-sm account-info-run-now-btn" disabled={!!enablingCode || loading}
                onClick={() => void enableNow(row.code)} title="Bật lại hành động này ngay"><RotateCcw size={13} className={spinning ? 'spin' : ''} aria-hidden="true" /><span>{spinning ? 'Đang mở...' : 'Chạy lại ngay'}</span></button>}
            </div>
            <div className="campaign-actions-group" data-label="Hôm nay">
              <span className="campaign-actions-caption">Hôm nay</span>
              {dayUsed === null ? <span className="text-muted" title="Bộ đếm ghi ngày sau hôm nay, chưa xác minh được">—</span>
                : row.limited && row.dayLimit !== null ? <>
                  <strong className="campaign-actions-count">{dayUsed}/{row.dayLimit} {unit}</strong>
                  <span className="campaign-actions-meter" role="progressbar" aria-label={`${row.name} đã chạy trong ngày`} aria-valuemin={0} aria-valuemax={row.dayLimit}
                    aria-valuenow={Math.min(dayUsed, row.dayLimit)} aria-valuetext={`${dayUsed}/${row.dayLimit}`}><span style={{ width: `${percent(dayUsed, row.dayLimit)}%` }} /></span>
                  <small>{actionView.dayFull ? 'Đã đủ lượt hôm nay' : `Còn ${row.dayLimit - dayUsed} ${unit}`}{daySource ? ` · ${daySource}` : ''}</small>
                </> : <><strong className="campaign-actions-count">{dayUsed} {unit}</strong><small>Không giới hạn lượt</small></>}
            </div>
            <div className="campaign-actions-group" data-label="Trong giờ">
              <span className="campaign-actions-caption">Trong giờ{row.limited && row.windowMinutes ? ` (${row.windowMinutes} phút)` : ''}</span>
              {row.limited && row.windowLimit !== null ? <>
                <strong className="campaign-actions-count">{actionView.windowUsed}{row.windowAtLeast ? '+' : ''}/{row.windowLimit} {unit}</strong>
                {actionView.windowFull
                  ? slots.length > 0 && <><small>Giờ từng lượt rời khung:</small><span className="campaign-actions-slots">
                    {slots.slice(0, SLOT_CHIPS).map((at, index) => <i key={`${at}-${index}`} className={index === actionView.windowUsed - (row.windowLimit as number) ? 'is-next' : undefined}>{formatCampaignLimitTime(minuteCeil(at), now)}</i>)}
                    {slots.length > SLOT_CHIPS && <i>+{slots.length - SLOT_CHIPS}</i>}
                  </span></>
                  : actionView.windowMoot
                    // Giới hạn giờ không thấp hơn giới hạn ngày (ví dụ Tìm SĐT 1.000/1.000): chỉ cần một dòng.
                    ? <small>Giới hạn giờ không thấp hơn giới hạn ngày nên không chặn trước.</small>
                    : <small>{`Còn ${(row.windowLimit as number) - actionView.windowUsed} ${unit}`}{slots.length ? ` · lượt cũ nhất rời khung ${formatCampaignLimitTime(minuteCeil(slots[0]), now)}` : ''}</small>}
                {windowSource && !(actionView.windowMoot && !actionView.windowFull) && <small>{windowSource}</small>}
              </> : <span className="text-muted">Không giới hạn theo giờ</span>}
            </div>
            {row.today !== undefined && <div className="campaign-actions-group" data-label="Kết quả hôm nay">
              <span className="campaign-actions-caption">Kết quả hôm nay</span>
              {row.today ? <>
                <span className="campaign-actions-results">{row.today.statuses.map(item => <span key={item.status}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)} <strong>{item.counted + item.uncounted}</strong></span>)}</span>
                {row.today.uncounted > 0 && <small>{row.today.uncounted} lượt không tính vào giới hạn</small>}
                {row.limited && row.today.campaigns.some(item => !item.current && item.counted > 0) && <small>Lượt tính giới hạn: {row.today.campaigns.map(item =>
                  `${item.current ? 'chiến dịch này' : item.name ? `“${item.name}”` : 'chiến dịch khác'} ${item.counted}`).join(' · ')}</small>}
              </> : <span className="text-muted">Chưa có kết quả hôm nay</span>}
            </div>}
          </section>
        })}</div>}
    {data && management && rows.length > 0 && <div className="campaign-actions-management">
      <section aria-label="Nhịp chạy và lịch">
        <strong>Nhịp chạy và lịch</strong>
        {management.sleepSeconds !== null && <div><span>Nghỉ giữa 2 lần</span><span>{management.sleepSeconds} giây</span></div>}
        {Number.isFinite(scheduleMs) && <div><span>Lần chạy theo lịch</span><span>{formatCampaignLimitTime(scheduleMs, now)}{management.scheduleType ? ` · ${SCHEDULE_TYPE_LABELS[management.scheduleType] || management.scheduleType}` : ''}</span></div>}
        {management.dailyStopTime && <div><span>Giờ dừng trong ngày</span><span>{management.dailyStopTime.slice(0, 5)}</span></div>}
        {limitedCount > 1 && <div><span>Khi đạt giới hạn</span><span>{data.continueWhenActionLimitReached ? 'Tiếp tục hành động còn lượt' : 'Dừng chờ giới hạn mở lại'}</span></div>}
      </section>
      {estimate && pending !== null && <section aria-label="Dự kiến">
        <strong>Dự kiến <small>(ước tính)</small></strong>
        <div><span>Data còn chờ</span><span>{pending}</span></div>
        <div><span>Hôm nay còn</span><span>tối đa {estimate.remainingToday} {unitOf(estimate.todayLimitedBy.code)}{estimate.todayLimitedBy !== estimate.bottleneck ? ` · theo ${estimate.todayLimitedBy.name}` : ''}</span></div>
        {pending > 0 && <div><span>Cần thêm</span><span>khoảng {estimate.sendDays} ngày gửi, theo {estimate.dayLimit} {unitOf(estimate.bottleneck.code)}/ngày của {estimate.bottleneck.name}{estimate.finishAt !== null ? ` · xong khoảng ${dayLabel(estimate.finishAt, now)}` : ''}</span></div>}
      </section>}
      <section aria-label="Tài khoản">
        <strong>Tài khoản {campaign.accountName || `#${campaign.accountId}`}</strong>
        <div><span>Nguồn giới hạn</span><span>{groupSourced && groupLabel ? `Nhóm ${groupLabel}` : 'Cài đặt chiến dịch'}{packageDailyLimit ? ` · gói tối đa ${packageDailyLimit} lượt/ngày` : ''}</span></div>
        <div><span>Chiến dịch khác</span><span>{others.size
          ? `Hôm nay dùng chung lượt với ${Array.from(others.values()).map(item => `${item.name ? `“${item.name}”` : 'chiến dịch khác'} (${item.counted})`).join(', ')}`
          : rows.some(row => (row.sharedCampaigns ?? 0) > 0) ? 'Có chiến dịch khác cùng hành động chạy hôm nay, chưa dùng lượt nào' : 'Không có chiến dịch khác dùng chung lượt hôm nay'}</span></div>
      </section>
    </div>}
  </div>
}
