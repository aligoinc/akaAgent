import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Upload, Download } from 'lucide-react'
import type { FacebookImportState, FacebookLoginInput, FacebookRowStatus } from '../../../../shared/facebookLogin'
import './facebookLogin.css'

export const facebookErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Không thể hoàn tất thao tác.')
  .replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/, '')

const statusText: Record<FacebookRowStatus, string> = { invalid: 'Không hợp lệ', skipped: 'Bỏ qua', ready: 'Sẵn sàng', running: 'Đang xử lý', success: 'Thành công', failed: 'Thất bại', cancelled: 'Đã dừng' }
const normalizeStatus = (value: string) => value.trim().replace(/[.!…]+$/, '').toLocaleLowerCase('vi')

export default function FacebookImportModal({ accountGroupId, proxyId, onClose }: {
  accountGroupId: number | null; proxyId: number | null; onClose: () => void
}) {
  const [text, setText] = useState(''), [fileRows, setFileRows] = useState<FacebookLoginInput[] | null>(null)
  const [fileName, setFileName] = useState(''), [state, setState] = useState<FacebookImportState | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null), revision = useRef(0)
  useEffect(() => {
    let active = true, eventSeen = false
    const off = window.electronAPI.facebookLogin.onProgress(next => { eventSeen = true; if (active) setState(next) })
    void window.electronAPI.facebookLogin.state().then(next => { if (active && !eventSeen && next) setState(next) }).catch(error => { if (active) setError(facebookErrorMessage(error)) })
    return () => { active = false; revision.current++; off() }
  }, [])
  const changeInput = () => { revision.current++; setState(null); setError('') }
  const readFile = async (file: File) => {
    const version = ++revision.current
    setBusy(true); setError(''); setState(null)
    try {
      if (file.size > 5_000_000) throw new Error('File tối đa 5 MB.')
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellText: false, cellFormula: true })
      const sheet = workbook.Sheets.TaiKhoan
      if (!sheet) throw new Error('File cần sheet TaiKhoan. Hãy tải file mẫu.')
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
      if (range.e.r > 5000 || range.e.c > 20) throw new Error('File quá lớn. Hãy chia nhỏ danh sách.')
      const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
      const headers = (data[0] || []).map(value => String(value).trim().toUpperCase())
      const columns = ['UID','PASSWORD','TWO_FA_SECRET','COOKIE'].map(name => headers.indexOf(name))
      if (columns.some(index => index < 0)) throw new Error('Cần đủ cột UID, PASSWORD, TWO_FA_SECRET, COOKIE như file mẫu.')
      const rows: FacebookLoginInput[] = []
      for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
        const values = columns.map(column => data[rowIndex][column] ?? '')
        if (values.every(value => value === '')) continue
        for (const column of columns) {
          const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })]
          if (cell?.f) throw new Error(`Dòng ${rowIndex + 1}: nhập giá trị trực tiếp, không dùng công thức.`)
        }
        // Excel may already have rounded long numeric IDs. Never guess the lost digits.
        if (typeof values[0] === 'number') throw new Error(`Dòng ${rowIndex + 1}: UID phải được nhập ở định dạng Text. Đổi định dạng rồi dán lại UID gốc.`)
        rows.push({ uid: String(values[0]), password: String(values[1]), twoFactorSecret: String(values[2]), cookie: String(values[3]) })
      }
      if (version !== revision.current) return
      setText(''); setFileRows(rows); setFileName(file.name)
    } catch (error) { if (version === revision.current) { setFileRows(null); setFileName(''); setError(facebookErrorMessage(error)) } }
    finally { if (version === revision.current) setBusy(false) }
  }
  const preview = async () => {
    const version = revision.current
    setBusy(true); setError('')
    try {
      const result = await window.electronAPI.facebookLogin.preview({ ...(fileRows ? { rows: fileRows } : { text }), accountGroupId, proxyId })
      if (version === revision.current) { setState(result); setText(''); setFileRows(null); setFileName('') }
    } catch (error) { setError(facebookErrorMessage(error)) }
    finally { setBusy(false) }
  }
  const start = async () => {
    if (!state) return
    setBusy(true); setError('')
    try { setState(await window.electronAPI.facebookLogin.start(state.id)) }
    catch (error) { setError(facebookErrorMessage(error)) }
    finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true)
    try { await window.electronAPI.facebookLogin.stop() }
    catch (error) { setError(facebookErrorMessage(error)) }
    finally { setBusy(false) }
  }
  const counts: Record<FacebookRowStatus, number> = { invalid: 0, skipped: 0, ready: 0, running: 0, success: 0, failed: 0, cancelled: 0 }
  for (const row of state?.rows || []) counts[row.status]++
  const count = counts.ready
  const running = state?.running === true
  const hasStarted = running || counts.success + counts.failed + counts.cancelled > 0
  const processed = counts.success + counts.failed + counts.skipped + counts.invalid
  const resetInput = () => {
    if (running || busy) return
    changeInput(); setText(''); setFileRows(null); setFileName('')
  }
  return <div className="modal-overlay facebook-login-overlay">
    <section className="modal facebook-import-modal" role="dialog" aria-modal="true" aria-labelledby="facebook-import-title">
      <header className="modal-header"><h3 id="facebook-import-title">Đăng nhập FB tự động với 2FA</h3>
        <button className="btn btn-ghost btn-icon" aria-label="Đóng" onClick={onClose} disabled={running || busy}><X size={18}/></button></header>
      <div className="modal-body facebook-login-body">
        {!state && <>
          <p>Chọn file Excel hoặc dán danh sách, mỗi tài khoản một dòng.</p>
          <div className="facebook-login-toolbar">
            <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = '' }}/>
            <button className="btn btn-secondary" disabled={busy} onClick={() => input.current?.click()}><Upload size={14}/>Chọn từ Excel</button>
            <a className="btn btn-ghost" href={`${import.meta.env.BASE_URL}facebook_accounts_template.xlsx`} download="facebook_accounts_template.xlsx"><Download size={14}/>Tải Excel mẫu</a>
            {fileName && <span>{fileName} · {fileRows?.length} dòng</span>}
          </div>
          <label htmlFor="facebook-import-text">Danh sách tài khoản</label>
          <textarea id="facebook-import-text" className="stepper-input facebook-import-input" autoComplete="off" spellCheck={false} autoFocus
            disabled={busy} value={text} onChange={event => { changeInput(); setText(event.target.value); setFileRows(null); setFileName('') }}
            placeholder="UID|PASSWORD|2FA_SECRET"/>
          <p className="facebook-login-note">Nhập khóa 2FA gốc, không nhập mã OTP sáu số. Tài khoản chỉ được thêm sau khi đăng nhập thành công.</p>
          <details className="facebook-import-help">
            <summary>Xem thêm định dạng nhập</summary>
            <div>
              <p>Có cookie: <code>UID|PASSWORD|2FA_SECRET|COOKIE</code></p>
              <p>Chỉ dùng cookie: <code>UID|COOKIE</code></p>
              <p>Cookie có dạng <code>c_user=…; xs=…;</code>. Token không dùng trong form này.</p>
              <p>Các bộ UID|PASSWORD|2FA_SECRET không chứa khoảng trắng có thể cách nhau bằng một hoặc nhiều dấu cách. Có cookie hoặc khoảng trắng trong thông tin đăng nhập thì dùng dòng riêng.</p>
            </div>
          </details>
        </>}
        {error && <p className="facebook-login-error" role="alert">{error}</p>}
        {state && <>
          <div className="facebook-import-summary" role="status" aria-live="polite">
            <div className="facebook-import-summary-heading">
              <strong>{hasStarted ? `Đã xử lý ${processed}/${state.rows.length}` : `${count} tài khoản sẵn sàng`}</strong>
              <span>{state.rows.length} dòng · Giới hạn {state.limit} tài khoản/lượt</span>
            </div>
            <div className="facebook-import-counts">
              {hasStarted && <><span className="facebook-count-success">Thành công {counts.success}</span><span className="facebook-count-failed">Thất bại {counts.failed}</span></>}
              {counts.skipped > 0 && <span>Bỏ qua {counts.skipped}</span>}
              {counts.invalid > 0 && <span className="facebook-count-failed">Không hợp lệ {counts.invalid}</span>}
              {counts.cancelled > 0 && <span>Đã dừng {counts.cancelled}</span>}
            </div>
          </div>
          {hasStarted && state.rows.length > 0 && <progress className="facebook-import-progress" aria-label="Tiến độ xử lý tài khoản" value={processed} max={state.rows.length}/>}
          {count > state.limit && <p className="facebook-login-error">Vượt giới hạn. Hãy nhập lại danh sách tối đa {state.limit} tài khoản hợp lệ, chưa trùng.</p>}
          <div className="facebook-import-results"><table aria-label="Kết quả đăng nhập"><thead><tr><th>Dòng</th><th>UID</th><th>Tên Facebook</th><th>Kết quả</th></tr></thead>
            <tbody>{state.rows.map(row => <tr key={row.index} className={`facebook-row-${row.status}`}><td>{row.index + 1}</td><td>{row.uid || '—'}</td><td>{row.name || '—'}</td><td>
              <span className="facebook-status-badge">{row.status === 'running' && <Loader2 size={12} className="animate-spin" aria-hidden="true"/>}{statusText[row.status]}</span>
              {row.message.trim() && normalizeStatus(row.message) !== normalizeStatus(statusText[row.status]) && <p className="facebook-row-message">{row.message}</p>}
            </td></tr>)}</tbody></table></div>
        </>}
      </div>
      <footer className="modal-footer facebook-import-footer">
        {state && !running && <button className="btn btn-secondary facebook-import-reset" onClick={resetInput} disabled={busy}>Nhập lại danh sách</button>}
        {busy && <Loader2 size={16} className="animate-spin"/>}
        <button className="btn btn-ghost" onClick={onClose} disabled={running || busy}>Đóng</button>
        {running ? <button className="btn btn-secondary" onClick={() => void stop()} disabled={busy}>Dừng</button>
          : !state ? <button className="btn btn-primary" onClick={() => void preview()} disabled={busy || (!text.trim() && !fileRows?.length)}>Kiểm tra danh sách</button>
            : count > 0 && <button className="btn btn-primary" onClick={() => void start()} disabled={busy || count > state.limit}>Bắt đầu đăng nhập</button>}
      </footer>
    </section>
  </div>
}
