import { useEffect, useRef, useState } from 'react'
import { Globe, Loader2, X, Plus, Minus, Info } from 'lucide-react'
import type { AutoAccount } from '../../../../shared/types'
import { emptyWebEnrichmentConfig, hasWebEnrichmentOverlap, normalizeWebUrl, validateWebEnrichment,
  WEB_ENRICHMENT_DEFAULT_TIME, WEB_ENRICHMENT_NOTE, WEB_ENRICHMENT_OVERLAP, type WebEnrichmentConfig } from '../../../../shared/facebookWebEnrichment'
import './WebEnrichmentModal.css'

function Chips({ label, values, onChange, orange = false }: {
  label: string; values: string[]; onChange: (values: string[]) => void; orange?: boolean
}) {
  const [text, setText] = useState('')
  function add() {
    const next = [...values]
    for (const item of text.split(/[,\n]/).map(x => x.trim()).filter(Boolean))
      if (!next.some(x => x.toLocaleLowerCase('vi') === item.toLocaleLowerCase('vi'))) next.push(item)
    onChange(next); setText('')
  }
  return <div className={`web-enrichment-chips ${orange ? 'orange' : ''}`}>
    {values.map(value => <span key={value}>{value}<button type="button" aria-label={`Xóa ${value}`} onClick={() => onChange(values.filter(x => x !== value))}><X size={12}/></button></span>)}
    <input aria-label={label} value={text} placeholder="Nhập và nhấn Enter hoặc dấu phẩy" onChange={e => setText(e.target.value)}
      onBlur={add} onKeyDown={e => {
        // Leave the draft to the IME, but stop Enter from submitting the form.
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
          if (e.key === 'Enter') e.preventDefault()
          return
        }
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
        if (e.key === 'Backspace' && !text) onChange(values.slice(0, -1))
      }}/>
  </div>
}

export default function WebEnrichmentModal({ account, onClose }: { account: AutoAccount; onClose: () => void }) {
  const [config, setConfig] = useState(emptyWebEnrichmentConfig)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(''), [url, setUrl] = useState(''), [time, setTime] = useState(WEB_ENRICHMENT_DEFAULT_TIME)
  const dialog = useRef<HTMLFormElement>(null), generation = useRef(0)
  const close = useRef(onClose); close.current = onClose
  const busy = useRef(false); busy.current = saving
  const patch = (value: Partial<WebEnrichmentConfig>) => setConfig(c => ({ ...c, ...value }))
  async function load() {
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const result = await window.electronAPI.webEnrichment.get(account.id)
      if (request === generation.current) { setConfig(result.config); setEnabled(result.enabled); setUrl(''); setTime(WEB_ENRICHMENT_DEFAULT_TIME); setLoaded(true) }
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Không tải được cài đặt.') }
    finally { if (request === generation.current) setLoading(false) }
  }
  useEffect(() => {
    void load()
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { generation.current++; previous?.focus() }
  }, [account.id])
  function addUrl() {
    if (!url.trim()) return
    try {
      const value = normalizeWebUrl(url)
      if (config.websites.includes(value)) throw new Error('Website này đã có trong danh sách.')
      if (config.websites.length >= 3) throw new Error('Danh sách gồm đúng 3 website.')
      patch({ websites: [...config.websites, value] }); setUrl(''); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Website không hợp lệ.') }
  }
  function addTime() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setError('Vui lòng chọn giờ hợp lệ.'); return }
    patch({ slots: Array.from(new Set([...config.slots, time])).sort() }); setTime(WEB_ENRICHMENT_DEFAULT_TIME); setError('')
  }
  async function save() {
    setError('')
    try {
      const value = validateWebEnrichment({ enabled, config })
      setSaving(true)
      await window.electronAPI.webEnrichment.save(account.id, value)
      close.current()
    } catch (e) { setError(e instanceof Error ? e.message : 'Không lưu được cài đặt.') }
    finally { setSaving(false) }
  }
  return <div className="web-enrichment-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose() }}>
    <form className="web-enrichment-modal" role="dialog" aria-modal="true" aria-labelledby="web-enrichment-title" tabIndex={-1} ref={dialog} noValidate
      onSubmit={e => { e.preventDefault(); if (loaded && !loading && !saving) void save() }}
      onKeyDown={e => {
        if (e.key === 'Escape' && !busy.current) { e.preventDefault(); close.current() }
        if (e.key === 'Tab') {
          const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? []).filter(el => !el.closest('fieldset:disabled'))
          const first = focusable[0], last = focusable.at(-1)
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
        }
      }}>
      <header><div className="web-enrichment-icon"><Globe size={20}/></div><div className="web-enrichment-heading">
        <h2 id="web-enrichment-title">Làm giàu lịch sử Web</h2><p>{account.name}</p></div>
        <label className={`web-enrichment-toggle ${enabled ? 'enabled' : ''}`}><input type="checkbox" checked={enabled} disabled={!loaded || loading || saving}
          aria-label="Bật làm giàu lịch sử Web" onChange={e => setEnabled(e.target.checked)}/>{enabled ? 'Đang bật' : 'Đang tắt'}</label>
        <button className="web-enrichment-close" type="button" disabled={saving} aria-label="Đóng" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="web-enrichment-body">
        {loading ? <div role="status" className="web-enrichment-loading"><Loader2 size={18} className="spin"/> Đang tải cài đặt…</div> :
        <fieldset disabled={saving}>
          <section><label htmlFor="web-industry"><b>1</b>Mô tả lĩnh vực khách hàng <em>*</em></label>
            <textarea id="web-industry" rows={3} maxLength={8000} placeholder="Mô tả lĩnh vực, sản phẩm hoặc dịch vụ của khách hàng…" value={config.industry} onChange={e => patch({ industry: e.target.value })}/></section>
          <section><label><b>2</b>Từ khóa thường tìm kiếm trên Google <em>*</em><small>{config.keywords.length} từ khóa</small></label>
            <Chips label="Từ khóa Google" values={config.keywords} onChange={keywords => patch({ keywords })}/><p className="web-enrichment-hint">Nhập tối thiểu 3 từ khóa khác nhau.</p></section>
          <section><label htmlFor="web-url"><b>3</b>Website thường xuyên truy cập <em>*</em><small>{config.websites.length}/3 website</small></label>
            <div className="web-enrichment-websites">{config.websites.map((value, i) => <div key={value}><span className={`website-icon color-${i}`}>{value.replace(/^https?:\/\//, '').charAt(0).toUpperCase()}</span>
              <span className="website-url" title={value}>{value}</span><button type="button" aria-label={`Xóa website ${i + 1}`} onClick={() => patch({ websites: config.websites.filter(x => x !== value) })}><X size={14}/></button></div>)}</div>
            <div className="web-enrichment-add"><input id="web-url" value={url} placeholder="Nhập địa chỉ website" onChange={e => setUrl(e.target.value)} onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                if (e.key === 'Enter') e.preventDefault()
                return
              }
              if (e.key === 'Enter') { e.preventDefault(); addUrl() }
            }}/>
              <button type="button" onClick={addUrl} disabled={config.websites.length >= 3}><Plus size={14}/>Thêm web</button></div><p className="web-enrichment-hint">Truy cập trực tiếp 3 website. Tự bổ sung https:// nếu chưa nhập.</p>
            {config.websites.length > 3 && <p className="web-enrichment-warning">Cấu hình cũ có {config.websites.length} website. Giữ lại đúng 3 website trước khi lưu bật tính năng.</p>}</section>
          <section><label><b>4</b>Sở thích ngoài công việc <small>Không bắt buộc</small></label><Chips label="Sở thích ngoài công việc" values={config.hobbies} orange onChange={hobbies => patch({ hobbies })}/></section>
          <section><label htmlFor="web-minutes"><b>5</b>Thời lượng mỗi phiên <em>*</em></label><div className="web-enrichment-duration">
            <div className="web-enrichment-stepper"><button type="button" aria-label="Giảm 5 phút" onClick={() => patch({ minutesPerSession: Math.max(5, config.minutesPerSession - 5) })}><Minus size={14}/></button>
              <input id="web-minutes" type="number" min={5} max={240} step={5} value={config.minutesPerSession} onChange={e => patch({ minutesPerSession: Number(e.target.value) })}/><span>phút</span>
              <button type="button" aria-label="Tăng 5 phút" onClick={() => patch({ minutesPerSession: Math.min(240, config.minutesPerSession + 5) })}><Plus size={14}/></button></div>
            <div className="web-enrichment-presets">{[15, 30, 45, 60, 90].map(n => <button key={n} type="button" aria-pressed={config.minutesPerSession === n} onClick={() => patch({ minutesPerSession: n })}>{n} phút</button>)}</div></div></section>
          <section><label htmlFor="web-time"><b>6</b>Khung giờ hay lướt <em>*</em><small>Giờ Việt Nam</small></label>
            <div className="web-enrichment-add"><input id="web-time" type="time" value={time} onChange={e => setTime(e.target.value)}/><button type="button" onClick={addTime}><Plus size={14}/>Thêm giờ</button></div>
            <div className="web-enrichment-chips times">{config.slots.map(slot => <span key={slot}>{slot}<button type="button" aria-label={`Xóa giờ ${slot}`} onClick={() => patch({ slots: config.slots.filter(x => x !== slot) })}><X size={12}/></button></span>)}</div>
            {hasWebEnrichmentOverlap(config.slots, config.minutesPerSession) && <p className="web-enrichment-warning" role="status">{WEB_ENRICHMENT_OVERLAP}</p>}</section>
          <section><label htmlFor="web-stop">Ngày dừng <small>Không bắt buộc</small></label><input id="web-stop" type="date" value={config.stopDate ?? ''} onChange={e => patch({ stopDate: e.target.value || null })}/><p className="web-enrichment-hint">Chạy đến hết ngày đã chọn theo giờ Việt Nam.</p></section>
          <div className="web-enrichment-note"><Info size={16}/><p><strong>Cơ chế hoạt động</strong>{WEB_ENRICHMENT_NOTE}</p></div>
        </fieldset>}
        {error && <div role="alert" className="web-enrichment-error">{error}<button type="button" disabled={saving || loading} onClick={() => void load()}>Tải lại cài đặt</button></div>}
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>Hủy</button><button type="submit" className="primary" disabled={!loaded || loading || saving}>{saving && <Loader2 size={14} className="spin"/>}{saving ? 'Đang lưu…' : 'Lưu cài đặt'}</button></footer>
    </form>
  </div>
}
