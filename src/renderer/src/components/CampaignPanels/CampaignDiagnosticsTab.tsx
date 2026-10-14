import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, BrainCircuit, CalendarClock, CheckCircle2, ChevronDown, CircleHelp, Clock3, Database, FileText, History, Info, ListChecks, LogIn, Play, RefreshCw, Settings2, SlidersHorizontal, Upload, UserRound, XCircle } from 'lucide-react'
import { DIAGNOSTICS_ACTIONS, formatDiagnosticTime, type CampaignDiagnosticsSnapshot, type CampaignDiagnosticsAiResult, type DiagnosticAction, type DiagnosticIssue, type DiagnosticQuota, type DiagnosticSeverity } from '../../../../shared/campaignDiagnostics'
import { useAuthStore } from '../../stores/authStore'
import { observeWebEnrichmentChanges } from '../../utils/observeWebEnrichmentChanges'
import './campaignDiagnostics.css'

const statusMeta = {
  ok: { label: 'Đã kiểm tra', Icon: CheckCircle2 },
  info: { label: 'Thông tin', Icon: Info },
  warning: { label: 'Cần chú ý', Icon: AlertTriangle },
  blocking: { label: 'Cần xử lý', Icon: XCircle },
  unknown: { label: 'Chưa xác minh', Icon: CircleHelp }
}
const actionIcons = { account: UserRound, login: LogIn, accountActions: Settings2, schedule: CalendarClock,
  limits: SlidersHorizontal, content: FileText, data: Database, importData: Upload, results: ListChecks, history: History, randomSettings: Settings2 }
function Issue({ issue, onAction, children, additionalActions, analysis = false }: { issue: DiagnosticIssue; onAction: (action: DiagnosticAction) => void; children?: ReactNode; additionalActions?: ReactNode; analysis?: boolean }) {
  const [expanded, setExpanded] = useState(issue.severity !== 'ok')
  const contentId = useId()
  const { Icon, label } = statusMeta[issue.severity]
  const checkDetails = Array.from(new Set([issue.cause, issue.explanation])).filter(text => text && text !== issue.problem).join('\n')
  const sections = analysis
    ? [['Vấn đề / Hiện tượng', issue.problem], ['Nguyên nhân', issue.cause], ['Vì sao phát sinh', issue.explanation], ['Giải pháp', issue.solution]]
    : [['Kết quả kiểm tra', issue.problem], ...(checkDetails ? [['Chi tiết', checkDetails]] : [])]
  return <article className={`diagnostic-issue diagnostic-${issue.severity}`}>
    <button type="button" className="diagnostic-check-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
      <span className="diagnostic-status-icon" role="img" aria-label={label}><Icon size={16} aria-hidden="true" /></span>
      <span className="diagnostic-check-heading"><strong>{issue.title}</strong><span>{issue.problem}</span></span>
      <ChevronDown size={16} className="diagnostic-chevron" aria-hidden="true" />
    </button>
    <div id={contentId} className="diagnostic-explanation" hidden={!expanded}>
      <dl>{sections.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
      {children}
      {issue.evidence?.length ? <ul className="diagnostic-evidence">{issue.evidence.map((text, index) => <li key={index}>{text}</li>)}</ul> : null}
      <div className="diagnostic-remedy"><h4>Thao tác</h4>
        {!analysis && <p className="diagnostic-action-hint">{issue.solution}</p>}
        <div className="diagnostic-actions">{issue.actions.map(action => {
          const ActionIcon = actionIcons[action]
          return <button type="button" key={action} className="diagnostic-button" onClick={() => onAction(action)}><ActionIcon size={14} aria-hidden="true" />{DIAGNOSTICS_ACTIONS[action]}</button>
        })}
          {additionalActions}
          {analysis && !issue.actions.length && !additionalActions && <span>Chưa có nút thao tác phù hợp; làm theo hướng dẫn ở trên.</span>}
        </div>
      </div>
    </div>
  </article>
}

function LimitProgress({ name, label, used, limit, checked }: { name: string; label: string; used: number | null; limit: number; checked: boolean }) {
  const ratio = used == null ? null : limit > 0 ? Math.max(0, Math.min(used / limit, 1)) : 1
  const tone = !checked || ratio == null ? 'unknown' : ratio >= 1 ? 'blocking' : ratio >= 0.7 ? 'warning' : 'ok'
  return <div className={`diagnostic-limit diagnostic-${tone}`}>
    <div className="diagnostic-limit-label"><span>{label}</span><strong>{used == null ? 'Chưa xác minh' : `${used.toLocaleString('vi-VN')} / ${limit.toLocaleString('vi-VN')}`}</strong></div>
    {used == null ? <div className="diagnostic-progress diagnostic-progress-unknown" aria-hidden="true" />
      : <div className="diagnostic-progress" role="meter" aria-label={`${name} · ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((ratio ?? 0) * 100)} aria-valuetext={`${used} / ${limit} lượt${checked ? '' : ', không áp dụng kiểm tra giới hạn lượt'}`}><span style={{ width: `${(ratio ?? 0) * 100}%` }} /></div>}
  </div>
}

function QuotaDetails({ quotas }: { quotas: DiagnosticQuota[] }) {
  return <div className="diagnostic-quotas">{quotas.map(quota => <div className="diagnostic-quota" key={quota.code}>
    <h4>{quota.name}</h4>
    {!quota.checked && <p className="diagnostic-muted">Không áp dụng kiểm tra giới hạn lượt cho hành động này.</p>}
    <div className="diagnostic-limit-grid">
      <LimitProgress name={quota.name} label="Trong ngày" used={quota.dayUsed} limit={quota.dayLimit} checked={quota.checked} />
      <LimitProgress name={quota.name} label={`Trong ${quota.windowMinutes} phút`} used={quota.windowUsed} limit={quota.windowLimit} checked={quota.checked} />
    </div>
  </div>)}</div>
}

function Restrictions({ quotas }: { quotas: DiagnosticQuota[] }) {
  const restricted = quotas.filter(quota => quota.disabled)
  if (!restricted.length) return null
  return <div className="diagnostic-table-wrap"><table aria-label="Hành động đang bị hạn chế">
    <thead><tr><th>Hành động</th><th>Thời điểm mở lại</th><th>Thông báo đã ghi nhận</th></tr></thead>
    <tbody>{restricted.map(quota => <tr key={quota.code}><td>{quota.name}</td><td><span className="diagnostic-reopen"><CalendarClock size={13} aria-hidden="true" />{formatDiagnosticTime(quota.enableAt)}</span></td><td>{quota.reason || 'Chưa có thông báo nguyên nhân.'}</td></tr>)}</tbody>
  </table></div>
}
export default function CampaignDiagnosticsTab({ campaignId, accountId, active = true, revision = 0, accountConfigVersion = '', canResume, onResume, onAction }: {
  campaignId: number; accountId: number; active?: boolean; revision?: number; accountConfigVersion?: string; canResume: boolean
  onResume: () => Promise<boolean>; onAction: (action: DiagnosticAction) => void
}) {
  const staffId = useAuthStore(state => state.user?.staffId), organizationId = useAuthStore(state => state.user?.organizationId)
  const [authRevision, setAuthRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<CampaignDiagnosticsSnapshot | null>(null)
  const [ai, setAi] = useState<CampaignDiagnosticsAiResult | null>(null)
  const [busy, setBusy] = useState<'read' | 'ai' | 'resume' | null>(null), [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [runtimeStale, setRuntimeStale] = useState(false)
  const root = useRef<HTMLElement>(null)
  const activeRequest = useRef<string | null>(null), generation = useRef(0)
  const resuming = useRef(false)
  const cancel = () => {
    generation.current++
    if (activeRequest.current) void window.electronAPI.cancelCampaignDiagnostics(activeRequest.current).catch(() => {})
    activeRequest.current = null
  }
  const run = async (analyze: boolean) => {
    if (activeRequest.current) return
    cancel()
    const owner = generation.current, requestId = crypto.randomUUID()
    activeRequest.current = requestId
    setBusy(analyze ? 'ai' : 'read'); setError('')
    if (!analyze) setStale(true)
    try {
      if (analyze && snapshot) {
        const result = await window.electronAPI.analyzeCampaignDiagnostics({ campaignId, snapshotId: snapshot.id, requestId })
        if (generation.current !== owner) return
        setSnapshot(result.snapshot); setAi(result); setStale(false); setRuntimeStale(false)
      } else {
        const result = await window.electronAPI.getCampaignDiagnostics({ campaignId, requestId })
        if (generation.current !== owner) return
        setSnapshot(result); setRuntimeStale(false)
      }
    } catch {
      if (generation.current === owner) setError(analyze ? 'Chưa thể phân tích bằng AI. Bấm Chẩn đoán AI để thử lại. Kết quả kiểm tra hiện tại vẫn được giữ.' : 'Chưa tải được đầy đủ dữ liệu. Bấm Kiểm tra lại để thử lại.')
    } finally { if (generation.current === owner) { activeRequest.current = null; setBusy(null) } }
  }
  const resume = async () => {
    if (!canResume || resuming.current || activeRequest.current) return
    resuming.current = true
    const owner = generation.current
    setBusy('resume'); setError('')
    try {
      const success = await onResume()
      if (generation.current !== owner) return
      if (success) await run(false)
    } catch {
      if (generation.current === owner) setError('Chưa thể tiếp tục chiến dịch. Kiểm tra trạng thái rồi thử lại.')
    } finally {
      resuming.current = false
      if (generation.current === owner) setBusy(null)
    }
  }
  useEffect(() => useAuthStore.subscribe((next, previous) => {
    if ((!next.user || !previous.user) && next.user !== previous.user
      || next.user?.staffId !== previous.user?.staffId || next.user?.organizationId !== previous.user?.organizationId) {
      cancel(); setSnapshot(null); setAi(null); setBusy(null); setAuthRevision(value => value + 1)
    }
  }), [])
  useEffect(() => {
    setSnapshot(null); setAi(null); setRuntimeStale(false)
    return () => cancel()
  }, [campaignId, staffId, organizationId, authRevision])
  useEffect(() => observeWebEnrichmentChanges(changed => {
    if (changed && !changed.has(accountId)) return
    if (activeRequest.current) { cancel(); setBusy(null) }
    setStale(true); setRuntimeStale(true)
  }), [accountId, staffId, organizationId, authRevision])
  useEffect(() => {
    if (active) root.current?.closest('.detail-dock-tab-content')?.scrollTo({ top: 0 })
    if (staffId && active) void run(false)
    return () => cancel()
  }, [campaignId, staffId, organizationId, revision, accountConfigVersion, authRevision, active])
  const severity: DiagnosticSeverity = !snapshot ? 'unknown' : snapshot.checks.some(check => check.severity === 'blocking') ? 'blocking'
    : snapshot.checks.some(check => check.severity === 'warning') ? 'warning' : !snapshot.complete ? 'unknown'
      : snapshot.checks.some(check => check.severity === 'info') || !snapshot.checks.length ? 'info' : 'ok'
  const BannerIcon = statusMeta[severity].Icon
  return <section ref={root} hidden={!active} className="campaign-diagnostics" aria-label="Chẩn đoán chiến dịch" aria-busy={!!busy}>
    <div className="diagnostic-content">
      <div className={`diagnostic-banner diagnostic-${severity}${snapshot ? ' diagnostic-overview' : ''}`}>
        <div className="diagnostic-banner-message" role="status">
          {busy === 'read' ? <RefreshCw size={20} className="diagnostic-spin" aria-hidden="true" /> : <BannerIcon size={20} aria-hidden="true" />}
          <div><h3>{snapshot?.headline || (busy === 'read' ? 'Đang tải dữ liệu chẩn đoán' : 'Chưa có kết quả kiểm tra')}</h3>
            <p>{snapshot ? `Cập nhật: ${formatDiagnosticTime(snapshot.checkedAt)} · ${snapshot.complete ? 'Đã tải các nhóm dữ liệu' : 'Một số mục chưa đủ dữ liệu'}` : 'Kiểm tra điều kiện chạy, tài khoản và dữ liệu của chiến dịch.'}</p>
          </div>
        </div>
        <div className="diagnostic-actions diagnostic-toolbar">
          <button type="button" className="diagnostic-button diagnostic-button-ghost" disabled={!!busy} onClick={() => void run(false)}><RefreshCw size={15} className={busy === 'read' ? 'diagnostic-spin' : undefined} aria-hidden="true" />Kiểm tra lại</button>
          <button type="button" className="diagnostic-button diagnostic-button-ai" disabled={!!busy || !snapshot} onClick={() => void run(true)}><BrainCircuit size={16} className={busy === 'ai' ? 'diagnostic-pulse' : undefined} aria-hidden="true" />{busy === 'ai' ? 'Đang phân tích…' : 'Chẩn đoán AI'}</button>
        </div>
      </div>
      {error && <div role="alert" className="diagnostic-notice diagnostic-warning"><AlertTriangle size={16} aria-hidden="true" /><span>{error}</span></div>}
      {runtimeStale && <div role="status" className="diagnostic-notice diagnostic-warning"><Info size={16} aria-hidden="true" /><span>Trạng thái làm giàu lịch sử Web đã thay đổi. Bấm Kiểm tra lại để cập nhật kết quả.</span></div>}
      {(ai || busy === 'ai') && <section className="diagnostic-ai" aria-label="Phân tích AI">
        <div className="diagnostic-ai-header"><span className="diagnostic-ai-icon"><BrainCircuit size={18} aria-hidden="true" /></span>
          <div><h3>Trợ lý akaBiz <span className="diagnostic-ai-tag">Phân tích AI</span></h3>
            {busy === 'ai' ? <p role="status">Đang đối chiếu dữ liệu để tìm nguyên nhân và hướng xử lý…</p> : ai && <p><Clock3 size={12} aria-hidden="true" />{formatDiagnosticTime(ai.generatedAt)}<span>· {ai.model}</span></p>}
          </div>
        </div>
        {ai && <>
          {stale && <div className="diagnostic-notice diagnostic-warning"><Info size={16} aria-hidden="true" /><span>Kết quả AI thuộc lần kiểm tra trước. Bấm Chẩn đoán AI để phân tích lại dữ liệu mới.</span></div>}
          <p className="diagnostic-ai-summary">{ai.summary}</p>
          <div className="diagnostic-checks">{ai.issues.map(issue => <Issue key={issue.id} issue={issue} onAction={onAction} analysis />)}</div>
        </>}
        {!ai && busy === 'ai' && <div className="diagnostic-ai-skeleton" aria-hidden="true"><span /><span /><span /></div>}
      </section>}
      {busy === 'read' && !snapshot && <div className="diagnostic-skeletons" aria-hidden="true">{[0, 1, 2].map(index => <div key={index} />)}</div>}
      {snapshot && <>
        <div className="diagnostic-checks">{snapshot.checks.map(issue => <Issue key={issue.id} issue={issue} onAction={onAction}
          additionalActions={issue.id === 'runtime' && canResume && <button type="button" className="diagnostic-button" disabled={!!busy} onClick={() => void resume()}
            title="Đưa chiến dịch về chờ xử lý, chạy theo lịch và giới hạn đã đặt.">
            {busy === 'resume' ? <RefreshCw size={14} className="diagnostic-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {busy === 'resume' ? 'Đang tiếp tục…' : 'Tiếp tục chiến dịch'}
          </button>}>
          {issue.id === 'limits' && !!snapshot.quotas.length && <QuotaDetails quotas={snapshot.quotas} />}
          {issue.id === 'restrictions' && <Restrictions quotas={snapshot.quotas} />}
        </Issue>)}</div>
        <div className="diagnostic-source-counts"><div><Database size={13} aria-hidden="true" />Dữ liệu gần nhất · tối đa 30 mỗi nhóm</div>
          <div className="diagnostic-source-pills">{[
            ['Lịch sử tài khoản', snapshot.facts.accountHistory], ['Lịch sử chạy', snapshot.facts.campaignHistory],
            ['Kết quả chạy', snapshot.facts.results], ['Data mẫu', snapshot.facts.inputs]
          ].map(([label, rows]) => <span key={String(label)}>{String(label)}<strong>{rows == null ? 'Chưa tải' : rows.length}</strong></span>)}</div>
        </div>
      </>}
    </div>
  </section>
}
