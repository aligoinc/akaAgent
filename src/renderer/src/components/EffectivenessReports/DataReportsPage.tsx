// Ported from akaAgentWebApp apps/web/src/features/reports (same layout and wording); data comes over IPC.
import { useMemo, useState, type ReactNode } from 'react'
import {
  BadgeCheck, CalendarClock, Contact, Database, Gauge, History, Layers, MessagesSquare, RefreshCw, Repeat, Search, Sparkles, Trophy,
  UserPlus, UserRound
} from 'lucide-react'
import {
  DATA_REPORT_PERIODS, DATA_REPORT_SOURCE_TABS, DEFAULT_DATA_REPORT_PERIOD, buildDataReportView, formatDataReportDate,
  formatDataReportNumber, type DataReportPeriod, type DataReportSnapshot, type DataReportSourceTab, type DataReportView
} from '../../../../shared/dataReports'
import { dataReportRequest } from './dataReportApi'
import type { EffectivenessNavigation } from './effectivenessApi'
import { BarList, KpiTile } from './EffectivenessCharts'
import { CompositionBar, CoverageBar, Sparkline, StoreWeeklyChart } from './DataReportCharts'
import { DataReportJourneyDialog, isJourneyPhone } from './DataReportJourneyDialog'
import { useEffectivenessData } from './useEffectivenessData'
import './effectivenessReports.css'
import './dataReports.css'

const builtAtParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hourCycle: 'h23'
})
/** "02:02 ngày 01/11" in Vietnam time. */
function formatBuiltAt(iso: string): string | null {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  const part = (type: Intl.DateTimeFormatPartTypes) => builtAtParts.formatToParts(time).find(item => item.type === type)?.value || ''
  return `${part('hour')}:${part('minute')} ngày ${part('day')}/${part('month')}`
}
const SECTIONS = [
  { id: 'dr-store', label: 'Kho dữ liệu' },
  { id: 'dr-coverage', label: 'Độ phủ chăm sóc' },
  { id: 'dr-rhythm', label: 'Nhịp chăm sóc' },
  { id: 'dr-sources', label: 'Nguồn hiệu quả' },
  { id: 'dr-accounts', label: 'Theo tài khoản' },
  { id: 'dr-assets', label: 'Tài sản của bạn' }
] as const
const n = formatDataReportNumber
const TILE_ICONS: Readonly<Record<DataReportView['tiles'][number]['key'], ReactNode>> = {
  friends: <UserPlus size={16} />,
  groupsJoined: <MessagesSquare size={16} />,
  zaloPeople: <Contact size={16} />,
  verified: <BadgeCheck size={16} />,
  dataGroups: <Layers size={16} />
}

/**
 * "Báo cáo dữ liệu": one nightly snapshot per staff, read once per visit (no polling, no focus refresh).
 * Switching the period only rebuilds the view in memory. Every number is a positive one (contract rule).
 */
export function DataReportsPage({ authScope, onNavigate }: { authScope: string; onNavigate: (target: EffectivenessNavigation) => void }) {
  const [revision, setRevision] = useState(0)
  const cache = useMemo(() => new Map<string, unknown>(), [authScope, revision])
  const snapshot = useEffectivenessData<DataReportSnapshot>(authScope ? `data-snapshot|${authScope}|${revision}` : null,
    signal => dataReportRequest({ kind: 'snapshot' }, signal), cache)
  const [period, setPeriod] = useState<DataReportPeriod>(DEFAULT_DATA_REPORT_PERIOD)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [journeyPhone, setJourneyPhone] = useState<string | null>(null)
  const payload = snapshot.data?.payload ?? null
  const view = useMemo(() => payload ? buildDataReportView(payload, period) : null, [payload, period])

  const openJourney = () => {
    if (!isJourneyPhone(phone)) { setPhoneError('Vui lòng nhập số điện thoại hợp lệ.'); return }
    setPhoneError(null)
    setJourneyPhone(phone.trim())
  }

  const builtAt = snapshot.data?.builtAt ? formatBuiltAt(snapshot.data.builtAt) : null
  return <>
    <div className="report-hub-body data-report">
      <header className="eff-card dr-head">
        <div className="dr-head-title">
          <h2>Báo cáo dữ liệu</h2>
          <p>Toàn cảnh kho khách hàng bạn đã xây dựng cùng akaBiz: quy mô, độ phủ, nhịp chăm sóc và những nguồn dữ liệu mang lại kết quả.</p>
          {snapshot.data?.reportDate && <span className="dr-updated"><CalendarClock size={14} aria-hidden="true" />
            Số liệu tới hết ngày {formatDataReportDate(snapshot.data.reportDate)}{builtAt ? ` · cập nhật lúc ${builtAt}` : ''}</span>}
        </div>
        <div className="dr-head-controls">
          <div className="dr-period" role="group" aria-label="Kỳ chăm sóc">
            <span>Kỳ chăm sóc</span>
            <div className="dr-segmented">
              {DATA_REPORT_PERIODS.map(item => <button key={item.value} type="button" aria-pressed={period === item.value}
                onClick={() => setPeriod(item.value)}>{item.label}</button>)}
            </div>
          </div>
          <form className="dr-lookup" onSubmit={event => { event.preventDefault(); openJourney() }}>
            <span>Tra hành trình một khách</span>
            <div>
              <label className="eff-search">
                <Search size={14} aria-hidden="true" />
                <input type="tel" inputMode="tel" placeholder="Nhập số điện thoại" value={phone} maxLength={20} aria-label="Số điện thoại cần tra"
                  aria-invalid={phoneError ? true : undefined} onChange={event => { setPhone(event.target.value); setPhoneError(null) }} />
              </label>
              <button type="submit" className="btn btn-secondary"><History size={14} />Tra cứu</button>
              <button type="button" className="btn btn-ghost" onClick={() => setRevision(value => value + 1)} title="Tải lại báo cáo">
                <RefreshCw size={14} /><span className="eff-hide-narrow">Làm mới</span>
              </button>
            </div>
            {phoneError && <p className="dr-input-hint" role="alert">{phoneError}</p>}
          </form>
        </div>
        <p className="eff-footnote">Kho dữ liệu luôn tính toàn bộ tới hết hôm qua. Kỳ chỉ áp dụng cho phần chăm sóc và hiệu quả.</p>
      </header>

      {snapshot.status === 'error' ? <div className="eff-state" role="alert">
        <span>{snapshot.error}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={snapshot.reload}>Thử lại</button>
      </div> : !snapshot.data ? <div className="eff-state" role="status">Đang tải báo cáo dữ liệu…</div>
        : !view ? <PreparingState /> : view.empty ? <GettingStarted onNavigate={onNavigate} /> : <DataReportBody view={view} onNavigate={onNavigate} />}
    </div>
    {journeyPhone && <div className="data-report"><DataReportJourneyDialog phone={journeyPhone} onClose={() => setJourneyPhone(null)} /></div>}
  </>
}

function PreparingState() {
  return <div className="eff-card eff-empty">
    <Sparkles size={22} aria-hidden="true" />
    <div>
      <strong>Báo cáo dữ liệu đang được chuẩn bị</strong>
      <p>akaBiz tổng hợp kho dữ liệu của bạn mỗi đêm. Báo cáo đầu tiên sẽ có vào sáng mai, các ngày sau tự cập nhật.</p>
    </div>
  </div>
}

function GettingStarted({ onNavigate }: { onNavigate: (target: EffectivenessNavigation) => void }) {
  return <div className="eff-card eff-empty">
    <Database size={22} aria-hidden="true" />
    <div>
      <strong>Bắt đầu xây dựng kho dữ liệu</strong>
      <p>Quét thành viên nhóm Zalo, tải danh sách số điện thoại hoặc kết bạn: akaBiz sẽ ghi lại kho khách của bạn và cập nhật báo cáo mỗi đêm.</p>
      <div className="eff-inline-actions dr-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate({ kind: 'dataScan' })}>Quét data</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'dataGroups' })}>Mở nhóm data</button>
      </div>
    </div>
  </div>
}

/** Positive wording only; a per-day pace below one customer is never printed (the contract leaves it null). */
function opportunityText(opportunity: NonNullable<DataReportView['opportunity']>): string {
  if (opportunity.runwayDays && opportunity.perDay) {
    return `Với nhịp ${n(opportunity.perDay)} khách mới mỗi ngày như hiện tại, kho đủ cho khoảng ${n(opportunity.runwayDays)} ngày chăm sóc tiếp theo.`
  }
  if (opportunity.runwayDays) return `Với nhịp chăm sóc hiện tại, kho đủ cho khoảng ${n(opportunity.runwayDays)} ngày chăm sóc tiếp theo.`
  if (opportunity.perDay) return `Mỗi ngày bạn đang chăm sóc khoảng ${n(opportunity.perDay)} khách mới từ kho.`
  return 'Tạo chiến dịch từ nhóm data để đưa những khách này vào hành trình chăm sóc.'
}

function SectionHead({ id, icon, title, note }: { id: string; icon: ReactNode; title: string; note?: string | null }) {
  return <div className="dr-section-head">
    <h3 id={`${id}-title`}><span aria-hidden="true">{icon}</span>{title}</h3>
    {note && <span>{note}</span>}
  </div>
}

function DataReportBody({ view, onNavigate }: { view: DataReportView; onNavigate: (target: EffectivenessNavigation) => void }) {
  const firstSource = DATA_REPORT_SOURCE_TABS.find(tab => view.sources[tab.value].rows.length > 0)?.value ?? 'groups'
  const [sourceTab, setSourceTab] = useState<DataReportSourceTab>(firstSource)
  const source = view.sources[sourceTab]
  const sourceLabel = DATA_REPORT_SOURCE_TABS.find(tab => tab.value === sourceTab)?.label || ''
  const star = (tracked: boolean) => tracked ? '*' : ''
  const showInteracted = view.accounts.some(account => account.interacted !== null)
  const visible = new Set<string>(['dr-store', 'dr-coverage', 'dr-sources', 'dr-assets'])
  if (view.rhythm) visible.add('dr-rhythm')
  if (view.accounts.length) visible.add('dr-accounts')
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const scanAction = <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate({ kind: 'dataScan' })}>Quét thêm dữ liệu</button>

  return <div className="dr-body">
    <nav className="dr-section-nav" aria-label="Các phần của báo cáo">
      {SECTIONS.filter(section => visible.has(section.id)).map(section => <button key={section.id} type="button" onClick={() => jump(section.id)}>{section.label}</button>)}
    </nav>

    <section id="dr-store" className="dr-section" aria-labelledby="dr-store-title">
      <SectionHead id="dr-store" icon={<Database size={16} />} title="Kho dữ liệu của bạn" note={`Toàn bộ tới hết ngày ${formatDataReportDate(view.reportDate)}`} />
      <div className="eff-card dr-hero">
        <div>
          <span className="dr-hero-label">Khách trong kho</span>
          <div className="dr-hero-value">{n(view.store.total)}{view.store.growth && <span className="eff-growth">{view.store.growth} trong {view.periodLabel} qua</span>}</div>
          <p className="eff-footnote">Mỗi khách chỉ tính một lần, dù nằm ở nhiều tài khoản hay nhiều nhóm data.</p>
        </div>
      </div>
      {view.tiles.length > 0 && <div className="eff-kpis">
        {view.tiles.map(tile => <KpiTile key={tile.key} icon={TILE_ICONS[tile.key]} label={tile.label} value={n(tile.value)} note={tile.note} badge={tile.delta} />)}
      </div>}
      <div className="eff-grid-2">
        {view.store.weekly.length >= 2 && <div className="eff-card">
          <div className="dr-card-title"><h4>Kho lớn dần theo tuần</h4><span>13 tuần gần nhất · theo nguồn đầu tiên đưa khách vào kho</span></div>
          <StoreWeeklyChart weeks={view.store.weekly} />
        </div>}
        {view.store.composition.length > 0 && <div className="eff-card">
          <div className="dr-card-title"><h4>Cơ cấu kho theo nguồn</h4></div>
          <CompositionBar items={view.store.composition} />
          <p className="eff-footnote">Khách có ở nhiều nguồn được tính vào nguồn đầu tiên đưa khách vào kho.</p>
        </div>}
      </div>
    </section>

    <section id="dr-coverage" className="dr-section" aria-labelledby="dr-coverage-title">
      <SectionHead id="dr-coverage" icon={<Gauge size={16} />} title="Độ phủ chăm sóc" note={`Trong ${view.periodLabel} qua`} />
      <div className="eff-grid-2">
        <div className="eff-card">
          <div className="dr-card-title"><h4>Từ kho tới khách tương tác</h4></div>
          <BarList ariaLabel="Từ kho tới khách tương tác" items={view.steps.map(step => ({
            key: step.key, label: `${step.label}${star(step.tracked)}`, value: step.value, detail: ` ${step.note}`, tone: step.tracked ? 'success' : 'primary'
          }))} />
        </div>
        <div className="dr-stack-col">
          {view.opportunity && <div className="eff-card dr-opportunity">
            <div className="dr-card-title"><h4><Sparkles size={15} aria-hidden="true" /> {n(view.opportunity.ready)} khách sẵn sàng để chăm sóc</h4></div>
            <p className="eff-insight">{opportunityText(view.opportunity)}</p>
            <div className="eff-inline-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate({ kind: 'campaigns' })}>Tạo chiến dịch</button>
              {scanAction}
            </div>
          </div>}
          {view.coverage.length > 0 && <div className="eff-card">
            <div className="dr-card-title"><h4>Độ phủ theo nhóm data</h4><span>từ trước tới nay</span></div>
            <ul className="dr-coverage">
              {view.coverage.map(group => <li key={group.id}>
                <div className="dr-coverage-head"><strong title={group.name}>{group.name}</strong><span>{n(group.size)} khách</span></div>
                <CoverageBar cared={group.caredEver} ready={group.ready} label={group.name} />
                <div className="dr-coverage-note">
                  <span><i className="is-cared" />{n(group.caredEver)} đã được chăm sóc</span>
                  {group.ready > 0 && <span><i className="is-ready" />{n(group.ready)} sẵn sàng</span>}
                </div>
              </li>)}
            </ul>
          </div>}
        </div>
      </div>
    </section>

    {view.rhythm && <section id="dr-rhythm" className="dr-section" aria-labelledby="dr-rhythm-title">
      <SectionHead id="dr-rhythm" icon={<Repeat size={16} />} title="Nhịp chăm sóc" note={`Trong ${view.periodLabel} qua`} />
      <div className="eff-grid-2">
        {view.rhythm.histogram.length > 0 && <div className="eff-card">
          <div className="dr-card-title"><h4>Khách theo số lần được chăm sóc</h4>
            <span>{n(view.rhythm.caredInPeriod)} khách được chăm sóc trong {view.periodLabel} qua</span></div>
          <BarList ariaLabel="Khách theo số lần được chăm sóc" items={view.rhythm.histogram.map(item => ({ key: item.label, label: item.label, value: item.value, tone: 'info' }))} />
          {(view.rhythm.medianGapDays || view.rhythm.cooldownAvoided) && <ul className="dr-facts">
            {view.rhythm.medianGapDays && <li><CalendarClock size={14} aria-hidden="true" />
              <span>Khoảng cách thường gặp giữa hai lần chăm sóc: <strong>{view.rhythm.medianGapDays.toLocaleString('vi-VN')} ngày</strong></span></li>}
            {view.rhythm.cooldownAvoided && <li><Sparkles size={14} aria-hidden="true" />
              <span>akaBiz đã tự tránh <strong>{n(view.rhythm.cooldownAvoided)} lần nhắn trùng</strong> cho bạn</span></li>}
          </ul>}
        </div>}
        {view.rhythm.groupMessages && <div className="eff-card">
          <div className="dr-card-title"><h4>Nhịp nhóm Zalo</h4>
            <span>{n(view.rhythm.groupMessages.messages)} tin tới {n(view.rhythm.groupMessages.groups)} nhóm
              {view.rhythm.groupMessages.perGroupPerWeek ? ` · trung bình ${view.rhythm.groupMessages.perGroupPerWeek.toLocaleString('vi-VN')} tin mỗi nhóm mỗi tuần` : ''}</span></div>
          {view.rhythm.groupMessages.top.length > 0 && <>
            <BarList ariaLabel="Nhóm Zalo nhận nhiều tin nhất" items={view.rhythm.groupMessages.top.map((item, index) => ({ key: `${index}:${item.name}`, label: item.name, value: item.messages, tone: 'info' }))} />
            <p className="eff-footnote">Nhóm nhận nhiều tin nhất trong 30 ngày qua.</p>
          </>}
        </div>}
      </div>
    </section>}

    <section id="dr-sources" className="dr-section" aria-labelledby="dr-sources-title">
      <SectionHead id="dr-sources" icon={<Layers size={16} />} title="Nguồn dữ liệu hiệu quả" note={`Trong ${view.periodLabel} qua`} />
      <div className="eff-card">
        <div className="dr-tabs" role="tablist" aria-label="Loại nguồn">
          {DATA_REPORT_SOURCE_TABS.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={sourceTab === tab.value}
            onClick={() => setSourceTab(tab.value)}>{tab.label}</button>)}
        </div>
        {source.rows.length ? <>
          <div className="dr-card-title"><h4>Nguồn dẫn đầu</h4>
            <span>{source.metric === 'interacted' ? `Xếp theo khách tương tác* trong ${view.periodLabel} qua` : `Xếp theo khách được chăm sóc trong ${view.periodLabel} qua`}</span></div>
          <div className="eff-table-wrap">
            <table className="eff-table dr-source-table dr-responsive-table">
              <thead><tr><th>#</th><th>Nguồn</th><th className="is-num">Khách</th><th className="is-num">Có Zalo</th><th className="is-num">Đã chăm sóc</th>
                {source.metric === 'interacted' && <th className="is-num">Tương tác*</th>}</tr></thead>
              <tbody>{source.rows.map((row, index) => <tr key={row.id}>
                <td className="dr-cell-rank">{index + 1}</td>
                <td className="dr-source-name dr-cell-title" title={row.name}>{row.name}</td>
                <td className="is-num" data-label="Khách">{row.size > 0 ? n(row.size) : null}</td>
                <td className="is-num" data-label="Có Zalo">{row.zalo > 0 ? n(row.zalo) : null}</td>
                <td className="is-num" data-label="Đã chăm sóc">{row.cared > 0 ? n(row.cared) : null}</td>
                {source.metric === 'interacted' && <td className="is-num" data-label="Tương tác*">{row.interacted > 0 ? <strong>{n(row.interacted)}</strong> : null}</td>}
              </tr>)}</tbody>
            </table>
          </div>
        </> : <p className="eff-muted">Khi bạn chăm sóc khách từ {sourceLabel.toLowerCase()}, những nguồn mang lại kết quả tốt nhất sẽ hiện ở đây.</p>}
        <p className="eff-footnote">Mẹo: lưu danh sách vào nhóm data trước khi chạy chiến dịch để akaBiz theo dõi được hiệu quả của từng nguồn.</p>
      </div>
    </section>

    {view.accounts.length > 0 && <section id="dr-accounts" className="dr-section" aria-labelledby="dr-accounts-title">
      <SectionHead id="dr-accounts" icon={<UserRound size={16} />} title="Dữ liệu theo tài khoản Zalo" note={`Bạn mới, thao tác chăm sóc và tương tác tính trong ${view.periodLabel} qua`} />
      <div className="eff-card">
        <div className="eff-table-wrap">
          <table className="eff-table dr-account-table dr-responsive-table">
            <thead><tr><th>Tài khoản</th><th>Bạn bè · 13 tuần</th><th className="is-num">Bạn mới</th><th className="is-num">Nhóm đã tham gia</th>
              <th className="is-num">Thao tác chăm sóc</th>{showInteracted && <th className="is-num">Khách tương tác*</th>}</tr></thead>
            <tbody>{view.accounts.map(account => <tr key={account.accountId}>
              <td className="dr-cell-title"><strong>{account.name}</strong><small>{account.kindLabel}</small></td>
              <td data-label="Bạn bè">{account.friends > 0 ? <div className="dr-friends-cell"><span>{n(account.friends)}</span>
                <Sparkline values={account.friendsWeekly} label={`Bạn bè của ${account.name} theo tuần`} /></div> : null}</td>
              <td className="is-num" data-label="Bạn mới">{account.newFriends ? <span className="eff-growth">+{n(account.newFriends)}</span> : null}</td>
              <td className="is-num" data-label="Nhóm đã tham gia">{account.groupsJoined > 0 ? n(account.groupsJoined) : null}</td>
              <td className="is-num" data-label="Thao tác chăm sóc">{account.careActions ? n(account.careActions) : null}</td>
              {showInteracted && <td className="is-num" data-label="Khách tương tác*">{account.interacted ? n(account.interacted) : null}</td>}
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>}

    <section id="dr-assets" className="dr-section" aria-labelledby="dr-assets-title">
      <SectionHead id="dr-assets" icon={<Trophy size={16} />} title="Tài sản akaBiz đang giữ cho bạn"
        note={view.assets.since ? `Từ ngày ${formatDataReportDate(view.assets.since)}${view.assets.months ? ` · ${n(view.assets.months)} tháng lịch sử chăm sóc` : ''}` : null} />
      <div className="eff-card">
        {view.assets.items.length > 0 && <ul className="dr-assets">
          {view.assets.items.map(item => <li key={item.key}><strong>{item.value}</strong><span>{item.label}{star(item.tracked)}</span></li>)}
        </ul>}
        {(view.assets.milestones.reached.length > 0 || view.assets.milestones.next) && <div className="dr-milestones">
          <h4>Cột mốc kho dữ liệu</h4>
          <div className="eff-milestones">
            {view.assets.milestones.reached.map(item => <span key={item.value} className="eff-milestone is-achieved">
              {n(item.value)} khách · {formatDataReportDate(item.reachedOn)}</span>)}
            {view.assets.milestones.next && <span className="eff-milestone">{n(view.assets.milestones.next.value)} khách</span>}
          </div>
          {view.assets.milestones.next && <div className="eff-progress" aria-label={`Tiến tới cột mốc ${n(view.assets.milestones.next.value)} khách`}>
            <span style={{ width: `${Math.max(2, Math.round(view.assets.milestones.next.progress * 100))}%` }} />
            <em>Còn {n(view.assets.milestones.next.remaining)} khách nữa để đạt cột mốc {n(view.assets.milestones.next.value)} khách</em>
          </div>}
        </div>}
        <p className="eff-footnote">Toàn bộ dữ liệu này luôn thuộc về bạn. akaBiz lưu giữ và dùng nó để mỗi chiến dịch sau chăm sóc khách tốt hơn chiến dịch trước.</p>
      </div>
    </section>

    {view.engagementShown && <p className="eff-footnote dr-star-note">* Tính trên các tài khoản được theo dõi tương tác: đã xem, phản hồi, thả cảm xúc và đồng ý kết bạn sau khi gửi.</p>}
  </div>
}
