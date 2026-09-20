import { lazy, Suspense, useState } from 'react'
import type { AdminCronQuery } from '../../../../shared/admin'
import { describeCronSchedule } from '../../../../shared/adminCron'
import { api, Empty, ErrorNote, Modal, Pagination, Reload, useAdminQuery, vietnamTime } from './common'

const SqlViewer = lazy(() => import('./AdminSqlViewer'))
const statusName = (value: string) => value === 'succeeded' ? 'Thành công' : value === 'failed' ? 'Thất bại'
  : ['running', 'starting', 'connecting', 'sending'].includes(value) ? 'Đang chạy' : value

function CronDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdminQuery(() => api().getCronRun(id), [id])
  const row = query.data
  const duration = row?.startTime && row.endTime ? Math.max(0, (Date.parse(row.endTime) - Date.parse(row.startTime)) / 1000) : null
  return <Modal title="Chi tiết lượt chạy cron" onClose={onClose} wide>
    <ErrorNote error={query.error} />
    {row ? <><dl className="admin-detail-grid"><dt>Cron job</dt><dd>{row.jobName} · #{row.jobId}</dd><dt>Lượt chạy</dt><dd>#{row.id}</dd><dt>Bắt đầu</dt><dd>{vietnamTime(row.startTime)}</dd><dt>Kết thúc</dt><dd>{vietnamTime(row.endTime)}</dd><dt>Thời lượng</dt><dd>{duration === null ? '—' : `${duration.toLocaleString('vi-VN')} giây`}</dd><dt>Kết quả</dt><dd>{statusName(row.status)} ({row.status})</dd></dl>
      <h4>Thông điệp trả về</h4><pre className="admin-code">{row.returnMessage || 'Không có thông điệp.'}</pre><h4>Câu lệnh</h4><pre className="admin-code">{row.command}</pre></>
      : <Empty busy={query.busy} />}
    {query.error && <Reload busy={query.busy} onClick={() => void query.reload()} />}
  </Modal>
}

export function AdminCron() {
  const jobs = useAdminQuery(() => api().listCronJobs())
  const [filter, setFilter] = useState<AdminCronQuery>({ cursor: null, jobId: '', status: '' })
  const runs = useAdminQuery(() => api().listCronRuns(filter), [filter.cursor, filter.jobId, filter.status])
  const [detail, setDetail] = useState<string | null>(null)
  return <section className="admin-section">
    <div className="admin-toolbar"><div><h2>Cron job Supabase</h2><p>Lịch chạy theo {jobs.data?.timezone || 'timezone của cron'} · Lịch sử hiển thị giờ Việt Nam</p></div><Reload busy={jobs.busy || runs.busy} onClick={() => { void jobs.reload(); void runs.reload() }} /></div>
    <ErrorNote error={jobs.error} />
    <div className="admin-table-wrap admin-cron-jobs"><table><thead><tr><th>ID</th><th>Cron job</th><th>Lịch chạy</th><th>Trạng thái</th></tr></thead><tbody>{jobs.data?.items.map(job => <tr key={job.id} className={filter.jobId === job.id ? 'selected' : ''}><td>{job.id}</td><td><button className="admin-link-button" onClick={() => setFilter(previous => ({ ...previous, jobId: job.id, cursor: null }))}>{job.name}</button></td><td><span>{describeCronSchedule(job.schedule)}</span><small><code>{job.schedule}</code></small></td><td>{job.isActive ? 'Đang bật' : 'Đã tắt'}</td></tr>)}</tbody></table>{!jobs.data?.items.length && <Empty busy={jobs.busy}>Chưa có cron job.</Empty>}</div>
    <div className="admin-toolbar admin-cron-filter"><h3>Log chạy</h3><label>Cron job<select value={filter.jobId} onChange={e => setFilter(previous => ({ ...previous, jobId: e.target.value, cursor: null }))}><option value="">Tất cả cron job</option>{jobs.data?.items.map(job => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label><label>Kết quả<select value={filter.status} onChange={e => setFilter(previous => ({ ...previous, status: e.target.value, cursor: null }))}><option value="">Tất cả kết quả</option><option value="succeeded">Thành công</option><option value="failed">Thất bại</option><option value="running">Đang chạy / trạng thái khác</option></select></label></div>
    <ErrorNote error={runs.error} />
    {runs.error && <button className="btn btn-secondary" disabled={runs.busy} onClick={() => void runs.reload()}>Thử tải lại log</button>}
    <div className="admin-table-wrap admin-grow"><table><thead><tr><th>Ngày giờ</th><th>Cron job</th><th>Kết quả</th><th>Chi tiết</th></tr></thead><tbody>{runs.data?.items.map(run => <tr key={run.id}><td>{vietnamTime(run.startTime)}</td><td>{run.jobName}</td><td><span className={`admin-status admin-status-${run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'error' : 'pending'}`}>{statusName(run.status)}</span></td><td><button className="btn btn-secondary" disabled={runs.busy} onClick={() => setDetail(run.id)}>Xem</button></td></tr>)}</tbody></table>{!runs.data?.items.length && !runs.error && <Empty busy={runs.busy}>Không có lịch sử phù hợp.</Empty>}</div>
    <Pagination cursor={filter.cursor || null} nextCursor={runs.data?.nextCursor} busy={runs.busy} onChange={cursor => setFilter(previous => ({ ...previous, cursor }))} />
    {detail && <CronDetail id={detail} onClose={() => setDetail(null)} />}
  </section>
}

function TriggerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdminQuery(() => api().getTrigger(id), [id])
  return <Modal title="Function from Trigger — chỉ đọc" onClose={onClose} wide>
    <ErrorNote error={query.error} />
    {query.data ? <><h4>{query.data.name} · {query.data.tableName}</h4><pre className="admin-code">{query.data.definition}</pre><h4>{query.data.functionName}</h4><Suspense fallback={<Empty busy />}><SqlViewer value={query.data.functionBody} /></Suspense></> : <Empty busy={query.busy} />}
    {query.error && <Reload busy={query.busy} onClick={() => void query.reload()} />}
  </Modal>
}
export function AdminTriggers() {
  const query = useAdminQuery(() => api().listTriggers())
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<string | null>(null)
  const rows = (query.data || []).filter(row => `${row.name} ${row.tableName} ${row.functionName}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="admin-section">
    <div className="admin-toolbar"><div><h2>Function from Trigger</h2><p>Trigger và hàm của các bảng nghiệp vụ · Chỉ đọc</p></div><Reload busy={query.busy} onClick={() => void query.reload()} /></div>
    <input className="admin-search" aria-label="Tìm trigger" value={search} placeholder="Tìm trigger, bảng hoặc tên hàm…" onChange={e => setSearch(e.target.value)} />
    <ErrorNote error={query.error} />
    <div className="admin-table-wrap admin-grow"><table><thead><tr><th>Trigger name</th><th>Bảng</th><th>Sự kiện + điều kiện</th><th>Tên hàm</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}{!row.isActive && <small>Đã tắt</small>}</td><td>{row.tableName}</td><td className="admin-trigger-definition"><code>{row.timing} {row.events}{row.condition ? ` · WHEN (${row.condition})` : ''}</code></td><td className="admin-cell-message"><code>{row.functionName}</code></td><td><button className="btn btn-secondary" disabled={query.busy} onClick={() => setDetail(row.id)}>Xem body hàm</button></td></tr>)}</tbody></table>{!rows.length && <Empty busy={query.busy} />}</div>
    {detail && <TriggerDetail id={detail} onClose={() => setDetail(null)} />}
  </section>
}
