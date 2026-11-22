import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Database, Loader2, RefreshCw, X } from 'lucide-react'
import {
  AKABIZ_AUTO_ACCOUNT_TYPE_LABELS,
  AKABIZ_AUTO_SYNC_DAY_PRESETS,
  AKABIZ_AUTO_SYNC_DEFAULT_DAYS,
  AKABIZ_AUTO_SYNC_MAX_DAYS,
  AKABIZ_AUTO_TARGET_ACTION_NAMES,
  AKABIZ_AUTO_ZALO_ACCOUNT_TYPES,
  AKABIZ_AUTO_ZALO_TYPE_LABELS,
  campaignInSelection,
  inStatusScope,
  normalizeUpdatedWithinDays,
  remainingQuota,
  settingsStorageKey,
  type AkaBizAutoCampaignScope,
  type AkaBizAutoPlatform,
  type AkaBizAutoSyncConnectResult,
  type AkaBizAutoSyncProgress,
  type AkaBizAutoSyncReport,
  type AkaBizAutoSyncSettings,
  type AkaBizAutoZaloAccountType
} from '../../../../shared/akaBizAutoSync'
import type { AkaBizIntegrationInfo } from '../../../../shared/types'
import { useAuthStore } from '../../stores/authStore'
import './akaBizAutoSync.css'

type Step = 'connect' | 'settings' | 'preview' | 'sync' | 'done'

interface Props {
  integration: AkaBizIntegrationInfo
  onClose: () => void
}

const STEPS: { key: Step; title: string; hint: string }[] = [
  { key: 'connect', title: 'Kết nối', hint: 'Xác minh akaBiz' },
  { key: 'settings', title: 'Cài đặt', hint: 'Chọn dữ liệu và loại Zalo' },
  { key: 'preview', title: 'Xem trước', hint: 'Kiểm tra trước khi chép' },
  { key: 'sync', title: 'Đồng bộ', hint: 'Chép dữ liệu' },
  { key: 'done', title: 'Hoàn tất', hint: 'Việc cần làm tiếp' }
]

const fmt = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

function readSaved(organizationId: number, staffId: number): Partial<AkaBizAutoSyncSettings> | null {
  try {
    const raw = window.localStorage.getItem(settingsStorageKey(organizationId, staffId))
    const value = raw ? JSON.parse(raw) : null
    return value && typeof value === 'object' ? value as Partial<AkaBizAutoSyncSettings> : null
  } catch {
    return null
  }
}

function writeSaved(organizationId: number, staffId: number, settings: AkaBizAutoSyncSettings): void {
  try {
    window.localStorage.setItem(settingsStorageKey(organizationId, staffId), JSON.stringify(settings))
  } catch {
    // Không lưu được thì lần sau chọn lại; không ảnh hưởng lượt đồng bộ.
  }
}

/**
 * Đồng bộ tài khoản và chiến dịch akaBiz Auto (akaBiz Desktop) sang akaAgent — phương án 2. Năm bước như bản thiết kế:
 * Kết nối (chỉ hỏi mật khẩu akaBiz) → Cài đặt → Xem trước → Đồng bộ (không đóng được khi đang chạy) → Hoàn tất.
 */
export default function AkaBizAutoSyncModal({ integration, onClose }: Props) {
  const user = useAuthStore(state => state.user)
  const api = window.electronAPI
  const [step, setStep] = useState<Step>('connect')
  const [password, setPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conn, setConn] = useState<AkaBizAutoSyncConnectResult | null>(null)
  const [platforms, setPlatforms] = useState<AkaBizAutoPlatform[]>([])
  const [zaloType, setZaloType] = useState<AkaBizAutoZaloAccountType | null>(null)
  const [shopIds, setShopIds] = useState<number[]>([])
  const [scope, setScope] = useState<AkaBizAutoCampaignScope>('paused_pending')
  const [limitOn, setLimitOn] = useState(true)
  const [daysText, setDaysText] = useState(String(AKABIZ_AUTO_SYNC_DEFAULT_DAYS))
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<AkaBizAutoSyncProgress | null>(null)
  const [previewReport, setPreviewReport] = useState<AkaBizAutoSyncReport | null>(null)
  const [finalReport, setFinalReport] = useState<AkaBizAutoSyncReport | null>(null)
  const [runSettings, setRunSettings] = useState<AkaBizAutoSyncSettings | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => api?.onAkaBizAutoSyncProgress?.(next => setProgress(next)), [api])
  useEffect(() => () => { void api?.akaBizAutoSyncClose?.() }, [api])
  useEffect(() => { passwordRef.current?.focus() }, [])

  const syncing = running && step === 'sync'
  const close = () => {
    if (syncing) return
    if (running) void api?.akaBizAutoSyncCancel?.()
    onClose()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const connect = async () => {
    if (!api?.akaBizAutoSyncConnect) return setError('Bản app này chưa hỗ trợ đồng bộ akaBiz Auto.')
    if (!password) return setError('Vui lòng nhập mật khẩu akaBiz.')
    setConnecting(true)
    setError(null)
    const result = await api.akaBizAutoSyncConnect(password)
    setConnecting(false)
    if (!result.ok) return setError(result.message)
    setPassword('')
    const data = result.data
    setConn(data)
    const saved = user ? readSaved(user.organizationId, user.staffId) : null
    const allowedZalo = AKABIZ_AUTO_ZALO_ACCOUNT_TYPES.filter(type => data.options.zalo[type].allowed)
    const hasZalo = data.accounts.some(account => account.platform === 'zalo')
    const hasFacebook = data.accounts.some(account => account.platform === 'facebook') && data.options.facebook.allowed
    const savedPlatforms = Array.isArray(saved?.platforms) ? saved!.platforms : null
    const nextPlatforms = ([] as AkaBizAutoPlatform[])
      .concat(hasZalo && allowedZalo.length && (!savedPlatforms || savedPlatforms.includes('zalo')) ? ['zalo'] : [])
      .concat(hasFacebook && (!savedPlatforms || savedPlatforms.includes('facebook')) ? ['facebook'] : [])
    setPlatforms(nextPlatforms)
    const savedType = saved?.zaloAccountType && allowedZalo.includes(saved.zaloAccountType) ? saved.zaloAccountType : null
    setZaloType(savedType || (data.options.defaultZaloAccountType && allowedZalo.includes(data.options.defaultZaloAccountType)
      ? data.options.defaultZaloAccountType : allowedZalo[0] || null))
    const known = new Set(data.accounts.map(account => account.shopId))
    const savedShops = Array.isArray(saved?.shopIds) ? saved!.shopIds.filter(id => known.has(id)) : []
    setShopIds(savedShops.length ? savedShops : data.accounts.filter(account => account.isActive).map(account => account.shopId))
    setScope(saved?.campaignScope === 'all' ? 'all' : 'paused_pending')
    if (saved && 'updatedWithinDays' in saved) {
      const days = normalizeUpdatedWithinDays(saved.updatedWithinDays)
      setLimitOn(days !== null)
      setDaysText(String(days ?? AKABIZ_AUTO_SYNC_DEFAULT_DAYS))
    }
    setStep('settings')
  }

  const days = normalizeUpdatedWithinDays(daysText)
  const settings: AkaBizAutoSyncSettings = useMemo(() => ({
    platforms,
    zaloAccountType: platforms.includes('zalo') ? zaloType : null,
    shopIds: conn ? shopIds.filter(id => conn.accounts.some(account => account.shopId === id && platforms.includes(account.platform))) : [],
    campaignScope: scope,
    updatedWithinDays: limitOn ? days : null
  }), [platforms, zaloType, shopIds, scope, limitOn, days, conn])

  const counts = useMemo(() => {
    if (!conn) return { paused: 0, all: 0, selected: 0, scopeTotal: 0, byPlatform: { zalo: 0, facebook: 0 } }
    const nowMs = Date.now()
    const inShops = conn.campaigns.filter(c => c.platform && platforms.includes(c.platform) && settings.shopIds.includes(c.shopId))
    const scopeTotal = inShops.filter(c => inStatusScope(c, scope)).length
    const selected = conn.campaigns.filter(c => campaignInSelection(c, { ...settings, updatedWithinDays: limitOn && days === null ? 0 : settings.updatedWithinDays }, nowMs)).length
    return {
      paused: inShops.filter(c => inStatusScope(c, 'paused_pending')).length,
      all: inShops.length,
      selected,
      scopeTotal,
      byPlatform: {
        zalo: conn.campaigns.filter(c => c.platform === 'zalo').length,
        facebook: conn.campaigns.filter(c => c.platform === 'facebook').length
      }
    }
  }, [conn, platforms, settings, scope, limitOn, days])

  const quotaProblem = useMemo(() => {
    if (!conn) return null
    if (platforms.includes('zalo') && !zaloType) return 'Tổ chức akaAgent chưa có gói Zalo phù hợp.'
    const needs = (platform: AkaBizAutoPlatform) => conn.accounts.filter(account => account.platform === platform
      && settings.shopIds.includes(account.shopId) && !account.mapped).length
    if (platforms.includes('zalo') && zaloType) {
      const remaining = remainingQuota(conn.options.zalo[zaloType])
      const need = needs('zalo')
      if (remaining !== null && need > remaining) return `Cần thêm ${need} tài khoản ${AKABIZ_AUTO_ZALO_TYPE_LABELS[zaloType].title} nhưng gói chỉ còn trống ${remaining}.`
    }
    if (platforms.includes('facebook')) {
      const remaining = remainingQuota(conn.options.facebook)
      const need = needs('facebook')
      if (remaining !== null && need > remaining) return `Cần thêm ${need} tài khoản Facebook nhưng gói chỉ còn trống ${remaining}.`
    }
    return null
  }, [conn, platforms, zaloType, settings.shopIds])

  const settingsError = !platforms.length ? 'Chọn ít nhất một nền tảng.'
    : !settings.shopIds.length ? 'Chọn ít nhất một tài khoản.'
      : limitOn && days === null ? `Nhập số ngày từ 1 đến ${AKABIZ_AUTO_SYNC_MAX_DAYS}.`
        : quotaProblem

  const run = async (dryRun: boolean, chosen: AkaBizAutoSyncSettings) => {
    if (!api?.akaBizAutoSyncRun) return
    setRunning(true)
    setError(null)
    setProgress(null)
    setRunSettings(chosen)
    const result = await api.akaBizAutoSyncRun(chosen, dryRun)
    setRunning(false)
    if (!result.ok) {
      if (result.code !== 'akabiz_sync_cancelled') setError(result.message)
      return
    }
    if (dryRun) setPreviewReport(result.data)
    else {
      setFinalReport(result.data)
      setStep('done')
    }
  }

  const startPreview = () => {
    if (settingsError || !user) return
    writeSaved(user.organizationId, user.staffId, settings)
    setPreviewReport(null)
    setStep('preview')
    void run(true, settings)
  }

  const startSync = (chosen: AkaBizAutoSyncSettings) => {
    setStep('sync')
    void run(false, chosen)
  }

  const stepIndex = STEPS.findIndex(item => item.key === step)
  const accountLabel = (shopId: number) => conn?.accounts.find(account => account.shopId === shopId)?.name || `Tài khoản ${shopId}`

  const renderStepper = () => (
    <nav className="aas-steps" aria-label="Các bước">
      {STEPS.map((item, index) => (
        <div key={item.key} className={`aas-step ${index < stepIndex ? 'done' : index === stepIndex ? 'active' : ''}`} aria-current={index === stepIndex ? 'step' : undefined}>
          <span className="aas-step-dot">{index < stepIndex ? <Check size={14} /> : index + 1}</span>
          <span className="aas-step-text"><strong>{item.title}</strong><small>{item.hint}</small></span>
        </div>
      ))}
      {conn && (
        <div className="aas-step-meta">
          <span>Nguồn</span><strong>{conn.source.username} · akaBiz Desktop</strong>
          <span>Đích</span><strong>{conn.target.username} · akaAgent</strong>
        </div>
      )}
    </nav>
  )

  const renderConnect = () => (
    <>
      <h2 className="aas-title">Xác minh tài khoản akaBiz</h2>
      <p className="aas-lead">akaAgent đọc dữ liệu akaBiz Desktop trên máy này. Dữ liệu bên akaBiz giữ nguyên.</p>
      <section className="aas-card aas-row">
        <div>
          <h3>Tài khoản akaAgent · đích</h3>
          <div>{user?.username || '-'}{user?.organizationName ? ` · ${user.organizationName}` : ''}</div>
          <small>Tài khoản đang đăng nhập app này</small>
        </div>
        <span className="aas-pill ok"><Check size={13} /> Đã đăng nhập</span>
      </section>
      <section className="aas-card">
        <h3>Tài khoản akaBiz · nguồn</h3>
        <div className="aas-grid2">
          <div className="aas-field"><span>Tên đăng nhập</span><div className="aas-readonly">{integration.username}</div></div>
          <label className="aas-field">
            <span>Mật khẩu akaBiz</span>
            <input ref={passwordRef} className="stepper-input" type="password" value={password} autoComplete="off" maxLength={200}
              placeholder="Nhập mật khẩu akaBiz" disabled={connecting}
              onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void connect() }} />
          </label>
        </div>
        <p className="aas-note">Lúc liên kết bạn chỉ cần tên đăng nhập. Để chép tài khoản và chiến dịch, cần thêm mật khẩu để xác nhận bạn là chủ dữ liệu. Mật khẩu không được lưu.</p>
      </section>
      <section className="aas-card aas-row">
        <Database size={20} />
        <div className="aas-grow">
          <h3>File dữ liệu akaBiz Desktop</h3>
          <small className="aas-break">{integration.dbPath || '-'}</small>
        </div>
      </section>
    </>
  )

  const togglePlatform = (platform: AkaBizAutoPlatform) =>
    setPlatforms(prev => prev.includes(platform) ? prev.filter(item => item !== platform) : [...prev, platform])
  const toggleShop = (shopId: number) =>
    setShopIds(prev => prev.includes(shopId) ? prev.filter(id => id !== shopId) : [...prev, shopId])

  const renderSettings = () => {
    if (!conn) return null
    const facebookAllowed = conn.options.facebook.allowed
    const visibleAccounts = conn.accounts.filter(account => platforms.includes(account.platform))
    const allChecked = visibleAccounts.length > 0 && visibleAccounts.every(account => shopIds.includes(account.shopId))
    return (
      <>
        <h2 className="aas-title">Cài đặt đồng bộ</h2>
        <p className="aas-lead">Lựa chọn được lưu cho lần sau. Bước tiếp theo chỉ xem trước, chưa có gì được ghi.</p>
        {conn.inProgress && (
          <div className="aas-banner warn">
            <AlertTriangle size={16} />
            <span className="aas-grow">Có một lượt đồng bộ chưa xong. Chạy tiếp sẽ dùng đúng cài đặt của lượt đó.</span>
            <button type="button" className="btn btn-primary" onClick={() => startSync(conn.inProgress!.settings)}>Chạy tiếp</button>
          </div>
        )}
        <section className="aas-section">
          <h3>Nền tảng</h3>
          <div className="aas-grid2">
            <label className={`aas-choice ${platforms.includes('zalo') ? 'selected' : ''}`}>
              <input type="checkbox" checked={platforms.includes('zalo')} onChange={() => togglePlatform('zalo')} />
              <span><strong>Zalo</strong><small>{conn.accounts.filter(a => a.platform === 'zalo').length} tài khoản · {counts.byPlatform.zalo} chiến dịch</small></span>
            </label>
            <label className={`aas-choice ${platforms.includes('facebook') ? 'selected' : ''} ${facebookAllowed ? '' : 'disabled'}`}>
              <input type="checkbox" disabled={!facebookAllowed} checked={platforms.includes('facebook')} onChange={() => togglePlatform('facebook')} />
              <span><strong>Facebook</strong><small>{facebookAllowed
                ? `${conn.accounts.filter(a => a.platform === 'facebook').length} tài khoản · ${counts.byPlatform.facebook} chiến dịch`
                : 'Cần gói akaAgent Facebook'}</small></span>
            </label>
          </div>
        </section>
        {platforms.includes('zalo') && (
          <section className="aas-section">
            <h3>Loại tài khoản Zalo trên akaAgent</h3>
            <small className="aas-sub">Một loại cho cả lượt đồng bộ. Chỉ chọn được loại tổ chức của bạn có gói.</small>
            <div className="aas-grid3" role="radiogroup">
              {AKABIZ_AUTO_ZALO_ACCOUNT_TYPES.map(type => {
                const quota = conn.options.zalo[type]
                const remaining = remainingQuota(quota)
                return (
                  <label key={type} className={`aas-choice column ${zaloType === type ? 'selected' : ''} ${quota.allowed ? '' : 'disabled'}`}>
                    <span className="aas-row"><input type="radio" name="aas-zalo-type" disabled={!quota.allowed} checked={zaloType === type}
                      onChange={() => setZaloType(type)} /><strong>{AKABIZ_AUTO_ZALO_TYPE_LABELS[type].title}</strong></span>
                    <small>{AKABIZ_AUTO_ZALO_TYPE_LABELS[type].description}</small>
                    <span className="aas-chips">
                      {quota.allowed && conn.options.defaultZaloAccountType === type && <span className="aas-chip accent">Theo gói của bạn</span>}
                      <span className="aas-chip">{!quota.allowed ? 'Chưa có gói' : remaining === null ? 'Không giới hạn' : `Còn trống ${remaining}/${quota.max}`}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            <p className="aas-note">{zaloType === 'zalo_server'
              ? 'Zalo Server: sau khi đồng bộ, quét mã QR trên akaAgent để đăng nhập; chiến dịch chạy cả khi tắt máy.'
              : 'Tài khoản chạy trong app akaAgent Desktop: cần mở app và đăng nhập trên máy; chiến dịch chỉ chạy khi app đang mở.'}
              {' '}Tài khoản đã đồng bộ ở lượt trước giữ nguyên loại cũ.</p>
          </section>
        )}
        <section className="aas-section">
          <div className="aas-row space">
            <div><h3>Tài khoản cần đồng bộ</h3>
              <small className="aas-sub">Đã chọn {settings.shopIds.length}/{visibleAccounts.length}</small></div>
            <label className="aas-row"><input type="checkbox" checked={allChecked} onChange={() => setShopIds(allChecked
              ? shopIds.filter(id => !visibleAccounts.some(a => a.shopId === id))
              : Array.from(new Set(shopIds.concat(visibleAccounts.map(a => a.shopId)))))} /> Chọn tất cả</label>
          </div>
          <div className="aas-table" role="table" aria-label="Tài khoản cần đồng bộ">
            <div className="aas-tr head" role="row"><span /><span>Tài khoản</span><span>Nền tảng</span><span>Trên akaAgent</span></div>
            {visibleAccounts.length === 0 && <div className="aas-empty">Không có tài khoản nào của nền tảng đã chọn.</div>}
            {visibleAccounts.map(account => (
              <label key={account.shopId} className="aas-tr" role="row">
                <span><input type="checkbox" checked={shopIds.includes(account.shopId)} onChange={() => toggleShop(account.shopId)} aria-label={account.name} /></span>
                <span className="aas-col"><strong>{account.name}</strong><small>{account.isActive ? (account.phone || '') : 'Đang tắt trong akaBiz Desktop'}</small></span>
                <span><span className="aas-chip">{account.platform === 'zalo' ? 'Zalo' : 'Facebook'}</span></span>
                <span className={account.mapped ? 'aas-ok' : 'aas-muted'}>{account.mapped
                  ? `Đã có · ${AKABIZ_AUTO_ACCOUNT_TYPE_LABELS[account.mapped.type] || account.mapped.type}, dùng lại`
                  : account.platform === 'zalo' ? 'Tạo mới · loại đã chọn' : 'Tạo mới · đăng nhập lại sau'}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="aas-section">
          <h3>Chiến dịch</h3>
          <div className="aas-col gap8" role="radiogroup">
            {(['paused_pending', 'all'] as const).map(value => (
              <label key={value} className={`aas-choice ${scope === value ? 'selected' : ''}`}>
                <input type="radio" name="aas-scope" checked={scope === value} onChange={() => setScope(value)} />
                <span><strong>{value === 'paused_pending' ? `Chỉ chiến dịch Dừng và Chờ xử lý · ${counts.paused}` : `Tất cả chiến dịch · ${counts.all}`}</strong>
                  <small>{value === 'paused_pending' ? 'Bỏ chiến dịch đang chạy và đã hoàn thành. Nên dùng cho lần đầu.' : 'Gồm cả chiến dịch đang chạy và đã hoàn thành.'}</small></span>
              </label>
            ))}
          </div>
          <div className="aas-card">
            <label className="aas-row">
              <input type="checkbox" checked={limitOn} onChange={() => setLimitOn(!limitOn)} />
              <span className="aas-col"><strong>Chỉ đồng bộ chiến dịch mới cập nhật gần đây</strong>
                <small>Ngày cập nhật gần nhất là ngày mới nhất trong: ngày tạo, ngày sửa chiến dịch, ngày dòng dữ liệu thay đổi.</small></span>
            </label>
            {limitOn && (
              <div className="aas-row wrap aas-indent">
                <label className="aas-row">Cập nhật trong
                  <input className="stepper-input aas-days" inputMode="numeric" value={daysText}
                    onChange={event => setDaysText(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
                  ngày qua (tối đa {AKABIZ_AUTO_SYNC_MAX_DAYS})</label>
                <div className="aas-row wrap" role="group" aria-label="Chọn nhanh số ngày">
                  {AKABIZ_AUTO_SYNC_DAY_PRESETS.map(preset => (
                    <button key={preset} type="button" aria-pressed={days === preset} className={`aas-preset ${days === preset ? 'selected' : ''}`}
                      onClick={() => setDaysText(String(preset))}>{preset} ngày</button>
                  ))}
                </div>
              </div>
            )}
            <div className="aas-banner info" aria-live="polite">
              <span><strong>{counts.selected}</strong> / {counts.scopeTotal} chiến dịch sẽ được đồng bộ.{' '}
                {!limitOn ? 'Không giới hạn theo ngày cập nhật.' : days === null ? `Nhập số ngày từ 1 đến ${AKABIZ_AUTO_SYNC_MAX_DAYS}.`
                  : counts.scopeTotal - counts.selected > 0 ? `Bỏ ${counts.scopeTotal - counts.selected} chiến dịch không cập nhật trong ${days} ngày qua.`
                    : `Mọi chiến dịch đều cập nhật trong ${days} ngày qua.`}</span>
            </div>
          </div>
          {settingsError && <div className="aas-banner warn" role="status"><AlertTriangle size={16} /><span>{settingsError}</span></div>}
          <ul className="aas-bullets">
            <li>Chiến dịch chép sang luôn ở trạng thái Tạm dừng; chiến dịch trong akaBiz Desktop không bị thay đổi.</li>
            <li>Không đồng bộ ảnh, video. Chiến dịch có ảnh được chép phần chữ, bạn thêm lại ảnh trên akaAgent.</li>
            <li>Không chuyển mật khẩu, proxy và phiên đăng nhập của tài khoản.</li>
          </ul>
        </section>
      </>
    )
  }

  const renderProgress = () => {
    const p = progress
    const percent = p && p.rowsTotal > 0 ? Math.min(100, Math.round(p.rowsDone * 100 / p.rowsTotal))
      : p && p.campaignsTotal > 0 ? Math.round(p.campaignsDone * 100 / p.campaignsTotal) : 0
    return (
      <div className="aas-card">
        <div className="aas-row space">
          <strong>{p?.stage === 'accounts' ? 'Đang chuẩn bị tài khoản…' : p?.stage === 'finishing' ? 'Đang hoàn tất…'
            : `Chiến dịch ${fmt(p?.campaignsDone || 0)} / ${fmt(p?.campaignsTotal || 0)} · dòng ${fmt(p?.rowsDone || 0)} / ${fmt(p?.rowsTotal || 0)}`}</strong>
          <span className="aas-percent">{percent}%</span>
        </div>
        <div className="aas-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${percent}%` }} /></div>
        {p?.current && <small>Đang xử lý: <strong>{p.current.name}</strong> · {fmt(p.current.rowsDone)} / {fmt(p.current.rowsTotal)} dòng</small>}
        {p?.note && <small className="aas-warn-text">{p.note}</small>}
        {!!p?.recent.length && (
          <div className="aas-log">
            {[...p.recent].reverse().slice(0, 6).map((entry, index) => (
              <div key={`${entry.at}-${index}`} className={entry.tone === 'warn' ? 'aas-warn-text' : ''}>
                <span>{new Date(entry.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>{entry.text}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderReport = (report: AkaBizAutoSyncReport) => {
    const created = report.accounts.filter(a => a.result === 'created' || a.result === 'would_create').length
    const reused = report.accounts.filter(a => a.result === 'reused' || a.result === 'would_reuse').length
    const accountIssues = report.accounts.filter(a => a.result === 'issue')
    const attention = report.campaigns.skipped.length + report.campaigns.issues.length
    return (
      <>
        <div className="aas-grid4">
          <div className="aas-tile"><small>Tài khoản</small><strong>{created + reused}</strong><small>{created} tạo mới · {reused} dùng lại</small></div>
          <div className="aas-tile"><small>Chiến dịch {report.dryRun ? 'chép được' : 'đã chép'}</small><strong>{report.campaigns.copied}</strong>
            <small>{report.campaigns.alreadyCopied ? `${report.campaigns.alreadyCopied} đã chép trước đó` : `trên ${report.campaigns.total} chiến dịch đã chọn`}</small></div>
          <div className="aas-tile"><small>Dòng dữ liệu</small><strong>{fmt(report.rows.imported)}</strong><small>giữ nguyên trạng thái từng dòng</small></div>
          <div className={`aas-tile ${attention ? 'warn' : ''}`}><small>Cần xem</small><strong>{attention}</strong>
            <small>{report.campaigns.skipped.length} bỏ qua · {report.campaigns.issues.length} cần xử lý</small></div>
        </div>
        {accountIssues.length > 0 && (
          <section className="aas-section"><h3>Tài khoản chưa tạo được · {accountIssues.length}</h3>
            {accountIssues.map(a => <div key={a.shopId} className="aas-item warn"><strong>{accountLabel(a.shopId)}</strong><small>{a.message || a.code}</small></div>)}
          </section>
        )}
        {report.campaigns.byAction.length > 0 && (
          <section className="aas-section"><h3>Chiến dịch {report.dryRun ? 'sẽ chép' : 'đã chép'} · {report.campaigns.copied}</h3>
            <div className="aas-table">{report.campaigns.byAction.map(item => (
              <div key={item.actionId} className="aas-tr two"><span>{AKABIZ_AUTO_TARGET_ACTION_NAMES[item.actionId] || item.actionId}</span><strong>{item.count}</strong></div>
            ))}</div>
          </section>
        )}
        {report.adjustments.length > 0 && (
          <section className="aas-section"><h3>Thay đổi khi chép</h3>
            {report.adjustments.map(item => <div key={item.code} className="aas-item info"><strong>{item.count}</strong><span>{item.message}</span></div>)}
          </section>
        )}
        {report.campaigns.skipped.length > 0 && (
          <section className="aas-section"><h3>Bỏ qua · {report.campaigns.skipped.length}</h3>
            {report.campaigns.skipped.map(item => <div key={item.sourceId} className="aas-item"><strong>{item.name}</strong><small>{item.message}</small></div>)}
          </section>
        )}
        {report.campaigns.issues.length > 0 && (
          <section className="aas-section"><h3>Cần xử lý · {report.campaigns.issues.length}</h3>
            <small className="aas-sub">Các chiến dịch khác vẫn được chép. Sửa trong akaBiz Desktop rồi bấm Đồng bộ lại, chỉ phần còn thiếu được chép.</small>
            {report.campaigns.issues.map(item => <div key={item.sourceId} className="aas-item warn"><strong>{item.name}</strong><small>{item.message}</small></div>)}
          </section>
        )}
      </>
    )
  }

  const renderPreview = () => (
    <>
      <h2 className="aas-title">Xem trước</h2>
      <p className="aas-lead">Đây là kết quả chạy thử, chưa có gì được ghi sang akaAgent.</p>
      {running && renderProgress()}
      {previewReport && renderReport(previewReport)}
    </>
  )

  const renderSync = () => (
    <>
      <h2 className="aas-title">{running ? 'Đang đồng bộ…' : 'Đồng bộ chưa xong'}</h2>
      <p className="aas-lead">Tắt máy hoặc mất mạng thì mở lại cửa sổ này, đồng bộ chạy tiếp từ chỗ đã dừng.</p>
      {renderProgress()}
    </>
  )

  const renderDone = () => {
    if (!finalReport) return null
    const created = finalReport.accounts.filter(a => a.result === 'created')
    const createdServer = created.filter(a => a.type === 'zalo_server').length
    const createdDesktop = created.length - createdServer
    return (
      <>
        <div className="aas-row">
          <span className="aas-done-icon"><CheckCircle2 size={26} /></span>
          <div><h2 className="aas-title">Đã đồng bộ xong</h2>
            <p className="aas-lead">{finalReport.accounts.filter(a => a.result !== 'issue').length} tài khoản · {finalReport.campaigns.copied} chiến dịch · {fmt(finalReport.rows.imported)} dòng dữ liệu đã có trên akaAgent</p></div>
        </div>
        <section className="aas-section"><h3>Việc cần làm tiếp</h3>
          <ol className="aas-todo">
            {created.length > 0 && <li><strong>Đăng nhập lại {created.length} tài khoản mới</strong>
              <small>{[createdServer ? `${createdServer} Zalo Server: quét mã QR trên akaAgent` : '', createdDesktop ? `${createdDesktop} tài khoản còn lại: đăng nhập trong app akaAgent Desktop` : ''].filter(Boolean).join('. ')}.</small></li>}
            <li className="warn"><strong>Dừng chiến dịch bên akaBiz Desktop trước khi bật bên akaAgent</strong>
              <small>Hai bên cùng chạy sẽ gửi trùng cho khách. akaBiz Desktop không tự dừng chiến dịch.</small></li>
            {finalReport.mediaNotCopied > 0 && <li><strong>Thêm lại ảnh cho {finalReport.mediaNotCopied} chiến dịch</strong><small>Ảnh và video không được đồng bộ.</small></li>}
            {finalReport.campaigns.issues.length > 0 && <li><strong>Xử lý {finalReport.campaigns.issues.length} chiến dịch chưa chép được</strong>
              <small>{finalReport.campaigns.issues.map(item => `${item.name}: ${item.message}`).join(' · ')}</small></li>}
          </ol>
        </section>
        {finalReport.campaigns.skipped.length > 0 && <p className="aas-note">{finalReport.campaigns.skipped.length} chiến dịch bị bỏ qua vì akaAgent chưa có loại tương ứng hoặc thiếu dữ liệu.</p>}
      </>
    )
  }

  const footer = () => {
    if (step === 'connect') return (
      <>
        <button type="button" className="btn btn-ghost" onClick={close}>Huỷ</button>
        <button type="button" className="btn btn-primary" disabled={connecting} onClick={() => void connect()}>
          {connecting ? <><Loader2 size={15} className="aas-spin" /> Đang xác minh…</> : <>Xác minh và tiếp tục <ArrowRight size={15} /></>}</button>
      </>
    )
    if (step === 'settings') return (
      <>
        <button type="button" className="btn btn-ghost" onClick={close}>Đóng</button>
        <button type="button" className="btn btn-primary" disabled={!!settingsError} title={settingsError || ''} onClick={startPreview}>Xem trước <ArrowRight size={15} /></button>
      </>
    )
    if (step === 'preview') return (
      <>
        <button type="button" className="btn btn-ghost" onClick={() => { if (running) void api?.akaBizAutoSyncCancel?.(); setStep('settings') }}>{running ? 'Dừng xem trước' : 'Quay lại'}</button>
        <button type="button" className="btn btn-primary" disabled={running || !previewReport || !runSettings}
          onClick={() => runSettings && startSync(runSettings)}>Bắt đầu đồng bộ <ArrowRight size={15} /></button>
      </>
    )
    if (step === 'sync') return running
      ? <button type="button" className="btn btn-primary" disabled><Loader2 size={15} className="aas-spin" /> Đang đồng bộ…</button>
      : (
        <>
          <button type="button" className="btn btn-ghost" onClick={close}>Để sau</button>
          <button type="button" className="btn btn-primary" onClick={() => runSettings && startSync(runSettings)}><RefreshCw size={15} /> Thử lại</button>
        </>
      )
    return (
      <>
        <button type="button" className="btn btn-ghost" onClick={() => { setFinalReport(null); setPreviewReport(null); setStep('settings') }}>Đồng bộ lại</button>
        <button type="button" className="btn btn-primary" onClick={close}>Đóng</button>
      </>
    )
  }

  return createPortal(
    // Cửa sổ nằm trong cây React của hộp Cài đặt chung: chặn click lan lên lớp phủ của hộp đó (sẽ đóng hộp Cài đặt).
    <div className="modal-overlay aas-overlay" onClick={event => { event.stopPropagation(); close() }}>
      <div className="modal aas-modal" role="dialog" aria-modal="true" aria-labelledby="aas-heading" onClick={event => event.stopPropagation()}>
        <div className="modal-header aas-header">
          <div className="modal-title" id="aas-heading">Đồng bộ từ akaBiz Desktop</div>
          <button type="button" className="btn-icon" aria-label={syncing ? 'Chưa đóng được khi đang đồng bộ' : 'Đóng'} disabled={syncing} onClick={close}><X size={16} /></button>
        </div>
        <div className="aas-body">
          {renderStepper()}
          <main className="aas-main">
            {error && <div className="aas-banner error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
            {step === 'connect' && renderConnect()}
            {step === 'settings' && renderSettings()}
            {step === 'preview' && renderPreview()}
            {step === 'sync' && renderSync()}
            {step === 'done' && renderDone()}
          </main>
        </div>
        <div className="aas-footer">
          <span className="aas-muted">{syncing ? 'Cửa sổ đóng được khi đồng bộ xong' : `Bước ${stepIndex + 1} / 5`}</span>
          <div className="aas-row">{footer()}</div>
        </div>
      </div>
    </div>,
    document.body
  )
}
