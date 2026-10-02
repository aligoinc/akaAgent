import { useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { parseBrowserRunLimit, type BrowserRunLimits } from '../../../../shared/browserRunLimits'

export default function BrowserRunLimitsSettings({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [settings, setSettings] = useState<BrowserRunLimits | null>(null)
  const [zaloWebMax, setZaloWebMax] = useState('')
  const [facebookMax, setFacebookMax] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const generation = useRef(0)

  const load = async () => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const next = await window.electronAPI.getBrowserRunLimits()
      if (request !== generation.current) return
      setSettings(next)
      setZaloWebMax(next.zaloWebMax === null ? '' : String(next.zaloWebMax))
      setFacebookMax(next.facebookMax === null ? '' : String(next.facebookMax))
      setConflict(false)
    } catch {
      if (request === generation.current) setError('Không thể tải giới hạn tài khoản chạy. Vui lòng thử lại.')
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => { generation.current++; onBusyChange(false) }
  }, [])

  const save = async () => {
    if (!settings || loading || saving || conflict) return
    let input: BrowserRunLimits
    try {
      input = { zaloWebMax: parseBrowserRunLimit(zaloWebMax), facebookMax: parseBrowserRunLimit(facebookMax), revision: settings.revision }
    } catch (err) {
      setMessage('')
      setError(err instanceof Error ? err.message : 'Giới hạn không hợp lệ.')
      return
    }
    const request = ++generation.current
    setSaving(true)
    onBusyChange(true)
    setError('')
    setMessage('')
    try {
      const result = await window.electronAPI.saveBrowserRunLimits(input)
      if (request !== generation.current) return
      if (!result.ok) {
        setConflict(true)
        setError('Cấu hình đã thay đổi trên máy khác. Nội dung bạn nhập vẫn được giữ; hãy tải lại cấu hình trước khi lưu tiếp.')
        return
      }
      setSettings(result.settings)
      setMessage('Đã lưu giới hạn tài khoản chạy.')
    } catch {
      if (request === generation.current) setError('Chưa xác nhận được kết quả lưu. Bạn có thể thử lưu lại hoặc tải lại cấu hình.')
    } finally {
      if (request === generation.current) { setSaving(false); onBusyChange(false) }
    }
  }

  return <div className="browser-run-limits-settings">
    <h3>Giới hạn tài khoản chạy</h3>
    <p className="text-secondary">Áp dụng cho tài khoản nhân viên hiện tại trên tất cả máy.</p>
    <form onSubmit={event => { event.preventDefault(); void save() }} noValidate>
      <fieldset disabled={loading || saving || !settings}>
        <label htmlFor="browser-run-limits-zalo">Giới hạn số Zalo (trình duyệt) cùng chạy một lúc</label>
        <input id="browser-run-limits-zalo" type="text" inputMode="numeric" value={zaloWebMax}
          onChange={event => { setZaloWebMax(event.target.value); setMessage('') }} placeholder="Không giới hạn" aria-describedby="browser-run-limits-help" />
        <label htmlFor="browser-run-limits-facebook">Giới hạn số Facebook cùng chạy một lúc</label>
        <input id="browser-run-limits-facebook" type="text" inputMode="numeric" value={facebookMax}
          onChange={event => { setFacebookMax(event.target.value); setMessage('') }} placeholder="Không giới hạn" aria-describedby="browser-run-limits-help" />
      </fieldset>
      <p id="browser-run-limits-help" className="text-secondary">Để trống nếu không giới hạn. Khi đủ số tài khoản, chiến dịch tiếp theo sẽ chờ và tự chạy khi có chỗ.</p>
      <p className="text-secondary">Thời gian chờ giữa thao tác, nghỉ hoặc lướt phụ vẫn tính là đang chạy. Giảm giới hạn không ngắt lượt đang chạy.</p>
      {loading && <p role="status">Đang tải...</p>}
      {error && <p role="alert" className="browser-run-limits-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="browser-run-limits-actions">
        <button type="submit" className="btn btn-primary" disabled={loading || saving || !settings || conflict}>
          <Save size={15} />{saving ? 'Đang lưu...' : 'Lưu'}
        </button>
        {error && <button type="button" className="btn btn-secondary" disabled={loading || saving} onClick={() => void load()}>
          {settings ? 'Tải lại cấu hình' : 'Thử lại'}
        </button>}
      </div>
    </form>
  </div>
}
