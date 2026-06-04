import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, TestTube2, Trash2, X } from 'lucide-react'
import { AutoAccount, AutoProxy, ProxyProtocol, ProxyTestResult } from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'

interface ProxyManagerModalProps {
  proxies: AutoProxy[]
  accounts: AutoAccount[]
  initialPlatform?: string
  onClose: () => void
  onCreateProxy: (data: Partial<AutoProxy>) => Promise<AutoProxy>
  onUpdateProxy: (id: number, updates: Partial<AutoProxy>) => Promise<void>
  onDeleteProxy: (id: number) => Promise<void>
  onProxyCreated?: (proxy: AutoProxy) => void
}

const PROTOCOL_OPTIONS: { value: ProxyProtocol; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks5', label: 'SOCKS5' }
]

const PLATFORM_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'zalo', label: 'Zalo' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'other', label: 'Khác' }
]

const getErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err && 'message' in err) {
    return String((err as { message?: unknown }).message || fallback)
  }
  return fallback
}

const hasProtocol = (value: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value)

export default function ProxyManagerModal({
  proxies,
  accounts,
  initialPlatform = 'facebook',
  onClose,
  onCreateProxy,
  onUpdateProxy,
  onDeleteProxy,
  onProxyCreated
}: ProxyManagerModalProps) {
  const [selectedProxyId, setSelectedProxyId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<ProxyProtocol>('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [importValue, setImportValue] = useState('')
  const [testPlatform, setTestPlatform] = useState(initialPlatform)
  const [customTestUrl, setCustomTestUrl] = useState('')
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProxy = useMemo(
    () => proxies.find(proxy => proxy.id === selectedProxyId) || null,
    [proxies, selectedProxyId]
  )
  const isEditing = Boolean(selectedProxy)

  const usageByProxyId = useMemo(() => {
    const map = new Map<number, number>()
    for (const account of accounts) {
      if (account.isDelete || !account.proxyId) continue
      map.set(account.proxyId, (map.get(account.proxyId) || 0) + 1)
    }
    return map
  }, [accounts])

  const resetForm = () => {
    setSelectedProxyId(null)
    setName('')
    setProtocol('http')
    setHost('')
    setPort('')
    setUsername('')
    setPassword('')
    setClearPassword(false)
    setImportValue('')
    setTestResult(null)
    setError(null)
  }

  useEffect(() => {
    if (!selectedProxy) return
    setName(selectedProxy.name)
    setProtocol(selectedProxy.protocol)
    setHost(selectedProxy.host)
    setPort(String(selectedProxy.port))
    setUsername(selectedProxy.username || '')
    setPassword('')
    setClearPassword(false)
    setImportValue('')
    setTestResult(null)
    setError(null)
  }, [selectedProxy])

  const buildPayload = (): Partial<AutoProxy> => {
    const payload: Partial<AutoProxy> = {
      name: name.trim(),
      protocol,
      host: host.trim(),
      port: Number(port),
      username: username.trim() || null
    }

    if (!isEditing || password.trim() || clearPassword) {
      payload.password = clearPassword ? null : (password.trim() || null)
    }

    return payload
  }

  const handleParseImport = () => {
    setError(null)
    try {
      const raw = importValue.trim()
      if (!raw) return
      const normalizedRaw = hasProtocol(raw) ? raw : `${protocol}://${raw}`
      const parsed = new URL(normalizedRaw)
      const parsedProtocol = parsed.protocol.replace(':', '').toLowerCase() as ProxyProtocol
      if (!PROTOCOL_OPTIONS.some(option => option.value === parsedProtocol)) {
        throw new Error('Chuỗi proxy chỉ hỗ trợ http, https hoặc socks5')
      }
      setProtocol(parsedProtocol)
      setHost(parsed.hostname)
      setPort(parsed.port)
      setUsername(decodeURIComponent(parsed.username || ''))
      setPassword(decodeURIComponent(parsed.password || ''))
      setClearPassword(false)
      if (!name.trim()) {
        setName(`${parsed.hostname}:${parsed.port}`)
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Không parse được chuỗi proxy'))
    }
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const payload = buildPayload()
      if (isEditing && selectedProxy) {
        await onUpdateProxy(selectedProxy.id, payload)
        useUiStore.getState().showAlert('Đã lưu proxy. Nếu tab Trình duyệt đang mở, hãy tự tải lại trang để áp dụng proxy mới.', 'info')
      } else {
        const created = await onCreateProxy(payload)
        onProxyCreated?.(created)
        resetForm()
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Không lưu được proxy'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (proxy: AutoProxy) => {
    useUiStore.getState().showConfirm(
      `Xoá proxy "${proxy.name}"?`,
      async () => {
        try {
          await onDeleteProxy(proxy.id)
          if (selectedProxyId === proxy.id) resetForm()
        } catch (err) {
          setError(getErrorMessage(err, 'Không xoá được proxy'))
        }
      },
      { title: 'Xoá proxy', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleTest = async () => {
    if (testing || !window.electronAPI?.testProxy) return
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testProxy({
        proxyId: selectedProxy?.id,
        proxy: buildPayload(),
        platform: testPlatform,
        testUrl: customTestUrl.trim() || undefined
      })
      setTestResult(result)
    } catch (err) {
      setError(getErrorMessage(err, 'Không test được proxy'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal proxy-manager-modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">Quản lý proxy</div>
            <div className="account-info-subtitle">Dùng chung proxy cho nhiều tài khoản</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body proxy-manager-body">
          <div className="proxy-list-pane">
            <div className="proxy-toolbar">
              <button className="btn btn-secondary" onClick={resetForm} type="button">
                <Plus size={14} />
                Proxy mới
              </button>
            </div>
            <div className="proxy-list">
              {proxies.length === 0 ? (
                <div className="text-muted proxy-empty">Chưa có proxy</div>
              ) : (
                proxies.map(proxy => {
                  const usageCount = usageByProxyId.get(proxy.id) || proxy.usageCount || 0
                  return (
                    <button
                      key={proxy.id}
                      className={`proxy-list-item ${selectedProxyId === proxy.id ? 'active' : ''}`}
                      onClick={() => setSelectedProxyId(proxy.id)}
                      type="button"
                    >
                      <span>
                        <strong>{proxy.name}</strong>
                        <em>{proxy.protocol}://{proxy.host}:{proxy.port} - {usageCount} tài khoản</em>
                      </span>
                      <Trash2
                        size={14}
                        role="button"
                        tabIndex={0}
                        onClick={event => {
                          event.stopPropagation()
                          handleDelete(proxy)
                        }}
                      />
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="proxy-editor">
            <div className={`account-group-editor-heading ${isEditing ? 'is-editing' : 'is-creating'}`}>
              <div>
                <strong>{isEditing ? `Đang sửa proxy: ${selectedProxy?.name}` : 'Đang tạo proxy mới'}</strong>
                <span>{isEditing ? 'Thay đổi proxy chỉ lưu vào kho proxy; tab Trình duyệt đang mở cần tự tải lại để áp dụng.' : 'Nhập thông tin proxy hoặc paste chuỗi proxy.'}</span>
              </div>
              <em>{isEditing ? 'Sửa proxy' : 'Tạo mới'}</em>
            </div>

            <div className="proxy-import-row">
              <input
                className="stepper-input"
                value={importValue}
                onChange={event => setImportValue(event.target.value)}
                placeholder="user:pass@host:port hoặc protocol://user:pass@host:port"
              />
              <button className="btn btn-secondary" onClick={handleParseImport} type="button">Nhập</button>
            </div>

            <div className="proxy-form-grid">
              <div className="stepper-form-group">
                <label>Tên proxy</label>
                <input className="stepper-input" value={name} onChange={event => setName(event.target.value)} />
              </div>
              <div className="stepper-form-group">
                <label>Loại</label>
                <select className="stepper-input" value={protocol} onChange={event => setProtocol(event.target.value as ProxyProtocol)}>
                  {PROTOCOL_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="stepper-form-group">
                <label>Host</label>
                <input className="stepper-input" value={host} onChange={event => setHost(event.target.value)} />
              </div>
              <div className="stepper-form-group">
                <label>Port</label>
                <input className="stepper-input" type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} />
              </div>
              <div className="stepper-form-group">
                <label>Username</label>
                <input className="stepper-input" value={username} onChange={event => setUsername(event.target.value)} />
              </div>
              <div className="stepper-form-group">
                <label>Password</label>
                <input
                  className="stepper-input"
                  type="password"
                  value={password}
                  onChange={event => {
                    setPassword(event.target.value)
                    setClearPassword(false)
                  }}
                  placeholder={isEditing ? 'Để trống để giữ nguyên' : ''}
                />
              </div>
            </div>

            {isEditing && (
              <label className="proxy-clear-password">
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={event => {
                    setClearPassword(event.target.checked)
                    if (event.target.checked) setPassword('')
                  }}
                />
                Xoá mật khẩu đã lưu
              </label>
            )}

            <div className="proxy-test-panel">
              <div className="proxy-test-controls">
                <select className="stepper-input" value={testPlatform} onChange={event => setTestPlatform(event.target.value)}>
                  {PLATFORM_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  className="stepper-input"
                  value={customTestUrl}
                  onChange={event => setCustomTestUrl(event.target.value)}
                  placeholder="URL test tuỳ chọn"
                />
                <button className="btn btn-secondary" onClick={handleTest} disabled={testing} type="button">
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <TestTube2 size={14} />}
                  Test proxy
                </button>
              </div>
              {testResult && (
                <div className={`proxy-test-result ${testResult.ok ? 'is-ok' : 'is-fail'}`}>
                  <strong>{testResult.ok ? 'Kết nối thành công' : 'Kết nối thất bại'}</strong>
                  <span>{testResult.testUrl} - {testResult.latencyMs}ms{testResult.ip ? ` - IP ${testResult.ip}` : ''}</span>
                  {testResult.error && <em>{testResult.error}</em>}
                </div>
              )}
            </div>

            {error && <div className="account-info-error">{error}</div>}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Đang lưu...' : (isEditing ? 'Lưu thay đổi' : 'Tạo proxy')}
          </button>
        </div>
      </div>
    </div>
  )
}
