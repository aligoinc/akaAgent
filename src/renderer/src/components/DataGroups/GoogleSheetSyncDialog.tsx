import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, FileSpreadsheet, Info, Link2, LoaderCircle, Plus, X } from 'lucide-react'
import type { DataGroup } from '../../../../shared/types'
import { SHEET_DATA_TYPES, sheetColumnName, validateSheetConfig, type DataGroupExternalSyncApi, type DataGroupExternalSyncSource, type GoogleSheetConfig, type GoogleSheetInspection, type GoogleSheetPreview, type SheetDataType, type SheetField } from '../../../../shared/googleSheetSync'
import DataGroupFormDialog from './DataGroupFormDialog'

export default function GoogleSheetSyncDialog({ group, source, api, onClose, onSaved }: {
  group: DataGroup
  source: DataGroupExternalSyncSource | null
  api: DataGroupExternalSyncApi
  onClose: () => void
  onSaved: (source: DataGroupExternalSyncSource) => Promise<void>
}) {
  const options = SHEET_DATA_TYPES.filter(t => !group.dataTypeCode || t.code === group.dataTypeCode)
  const fixedType = options.find(t => t.code === group.dataTypeCode)
  const sourceTypeChanged = !!source && !!fixedType && source.config.dataTypeCode !== fixedType.code
  const [name, setName] = useState(source?.name || '')
  const [config, setConfig] = useState<GoogleSheetConfig>(() => {
    if (source) return sourceTypeChanged && fixedType
      ? { ...source.config, dataTypeCode: fixedType.code, mapping: [] }
      : source.config
    return { url: '', dataTypeCode: options[0]?.code || 'phone', hasHeader: true, mapping: [], expectedHeaders: [] }
  })
  const [hours, setHours] = useState(String(source?.everyHours || 6))
  const [endDate, setEndDate] = useState(source?.endDate || '')
  const [enabled, setEnabled] = useState(source?.isEnabled ?? true)
  const [inspection, setInspection] = useState<GoogleSheetInspection | null>(null)
  const [columnsChanged, setColumnsChanged] = useState(false)
  const [connected, setConnected] = useState(false)
  const [preview, setPreview] = useState<GoogleSheetPreview | null>(null)
  const [busy, setBusy] = useState<'connect' | 'preview' | 'save' | null>(source ? 'connect' : null)
  const [error, setError] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const initialConfig = useRef(source ? config : null)
  const connectionSequence = useRef(0)
  const inspectedLayout = useRef({ url: config.url, hasHeader: config.hasHeader })
  const type = SHEET_DATA_TYPES.find(t => t.code === config.dataTypeCode)!
  const fields: Array<{ field: SheetField; label: string }> = [
    { field: type.field, label: type.fieldLabel },
    { field: 'name', label: 'Họ tên' },
    ...(['phone', 'email'] as SheetField[]).filter(f => f !== type.field).map(field => ({ field, label: field === 'phone' ? 'Phone' : 'Email' })),
    ...(['info1', 'info2', 'info3', 'info4', 'info5'] as const).map(field => ({ field, label: field }))
  ]
  const changeConfig = (next: GoogleSheetConfig) => { setConfig(next); setPreview(null); setError('') }
  const connect = useCallback(async (nextConfig: GoogleSheetConfig) => {
    const sequence = ++connectionSequence.current
    setBusy('connect'); setError(''); setPreview(null); setConnected(false); setInspection(null); setColumnsChanged(false)
    try {
      const result = await api.inspect(group.id, nextConfig.url, nextConfig.hasHeader)
      if (sequence !== connectionSequence.current) return
      const sameColumns = result.headers.length === nextConfig.expectedHeaders.length
      const headerModeChanged = inspectedLayout.current.url === nextConfig.url && inspectedLayout.current.hasHeader !== nextConfig.hasHeader
      const keepMapping = sameColumns && (headerModeChanged || result.headers.every((h, i) => h === nextConfig.expectedHeaders[i]))
      const next = { ...nextConfig, url: result.url, expectedHeaders: result.headers, mapping: keepMapping ? nextConfig.mapping : [] }
      // An existing source whose columns moved needs an explicit new mapping.
      // Opening the editor must never silently bind its identifier to column A.
      if (!next.mapping.length && result.headers.length && !nextConfig.expectedHeaders.length && !sourceTypeChanged) next.mapping = [{ column: 0, field: SHEET_DATA_TYPES.find(t => t.code === nextConfig.dataTypeCode)!.field }]
      setColumnsChanged(!keepMapping && nextConfig.expectedHeaders.length > 0)
      inspectedLayout.current = { url: result.url, hasHeader: nextConfig.hasHeader }
      setConfig(next); setInspection(result); setConnected(true)
      setName(previous => previous.trim() ? previous : `Sheet ${result.url.match(/\/d\/([^/]+)/)?.[1]?.slice(0, 12) || ''}`)
    } catch (err) { if (sequence === connectionSequence.current) setError(err instanceof Error ? err.message : 'Không thể kết nối Sheet.') }
    finally { if (sequence === connectionSequence.current) setBusy(null) }
  }, [api, group.id, sourceTypeChanged])
  useEffect(() => {
    if (initialConfig.current) void connect(initialConfig.current)
    return () => { connectionSequence.current++ }
  }, [connect])
  const changeHeader = (hasHeader: boolean) => {
    const next = { ...config, hasHeader }
    changeConfig(next)
    if (connected) void connect(next)
  }
  const run = async (save: boolean) => {
    setError(''); setBusy(save ? 'save' : 'preview')
    if (!save) setPreview(null)
    try {
      if (!connected) throw new Error('Hãy bấm Kết nối để kiểm tra Sheet và các cột trước.')
      validateSheetConfig(config)
      if (save) {
        if (!name.trim()) throw new Error('Vui lòng nhập tên nguồn.')
        if (!Number.isInteger(Number(hours)) || Number(hours) < 1 || Number(hours) > 8760) throw new Error('Chu kỳ phải là số giờ nguyên từ 1 đến 8.760.')
        const saved = await api.save({ groupId: group.id, id: source?.id, expectedRevision: source?.revision, requestId: requestId.current, name: name.trim(), config, everyHours: Number(hours), endDate: endDate || null, isEnabled: enabled })
        await onSaved(saved); onClose()
      } else setPreview(await api.preview(group.id, config, source?.id))
    } catch (err) { setError(err instanceof Error ? err.message : 'Không thể hoàn tất thao tác.') }
    finally { setBusy(null) }
  }
  return <DataGroupFormDialog title="Đồng bộ từ Google Sheet" subtitle={`Nhóm: ${group.name} · ${group.dataTypeName || 'Mọi loại dữ liệu'}`}
    busy={busy !== null} onClose={onClose} icon={<FileSpreadsheet size={20} />} className="google-sheet-sync-dialog">
    <div className="sheet-sync-form-body" aria-busy={busy !== null}>
      <fieldset disabled={busy !== null} className="sheet-sync-fields">
        <label className="sheet-sync-label">Link Google Sheet <span className="sheet-required">*</span>
          <div className="sheet-sync-link"><Link2 size={14} /><input aria-label="Link Google Sheet" value={config.url} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" onChange={e => { changeConfig({ ...config, url: e.target.value }); setConnected(false); setInspection(null) }} />
            <button type="button" className="sheet-sync-connect" onClick={() => void connect(config)}>{busy === 'connect' ? <><LoaderCircle size={14} className="spin" />Đang kết nối</> : 'Kết nối'}</button></div>
        </label>
        {connected && inspection ? <p className="sheet-sync-connected"><Check size={13} />Đã kết nối · {inspection.rowCount.toLocaleString('vi-VN')} dòng dữ liệu</p> : <p className="sheet-sync-help">Sheet cần quyền “Bất kỳ ai có đường liên kết”. Đọc đúng tab trong link.</p>}
        <label className="sheet-sync-checkbox"><input type="checkbox" checked={config.hasHeader} onChange={e => changeHeader(e.target.checked)} />Dòng đầu tiên là tiêu đề cột</label>
        <label className="sheet-sync-label">Tên nguồn<input maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Khách hội thảo tháng 9" /></label>
        {!group.dataTypeCode && <label className="sheet-sync-label">Loại data của nguồn<select value={config.dataTypeCode} onChange={e => changeConfig({ ...config, dataTypeCode: e.target.value as SheetDataType, mapping: [] })}>{options.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>}
        {sourceTypeChanged && <p className="sheet-sync-help" role="status">Nhóm đã đổi sang {type.label}. Hãy ghép lại cột trước khi lưu.</p>}
        {columnsChanged && !config.mapping.length && <p className="sheet-sync-help" role="status">Cột của Sheet đã thay đổi. Hãy ghép lại cột trước khi lưu.</p>}
        <div className="sheet-sync-schedule">
          <label className="sheet-sync-label">Đồng bộ mỗi (giờ) <span className="sheet-required">*</span><input type="number" min={1} max={8760} step={1} value={hours} onChange={e => setHours(e.target.value)} />
            <span className="sheet-sync-presets">{[1, 3, 6, 12, 24].map(h => <button type="button" className={Number(hours) === h ? 'is-active' : ''} key={h} onClick={() => setHours(String(h))}>{h}h</button>)}</span>
          </label>
          <label className="sheet-sync-label">Ngày dừng đồng bộ<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /><small>Để trống = chạy đến khi tắt thủ công</small></label>
        </div>
        <section className="sheet-sync-mapping" aria-label="Cột dữ liệu lấy về">
          <header><strong>Cột dữ liệu lấy về</strong><button type="button" className="sheet-sync-small-button" disabled={!connected || config.mapping.length >= fields.length} onClick={() => {
            const field = fields.find(f => !config.mapping.some(m => m.field === f.field))?.field
            if (field) changeConfig({ ...config, mapping: [...config.mapping, { column: Math.min(config.mapping.length, config.expectedHeaders.length - 1), field }] })
          }}><Plus size={11} />Thêm cột</button></header>
          {!config.mapping.length && <p className="sheet-sync-help">Kết nối Sheet rồi chọn cột cần lấy về.</p>}
          {config.mapping.map((map, index) => <div className="sheet-sync-map-row" key={index}>
            <select aria-label={`Cột nguồn ${index + 1}`} value={map.column} disabled={!connected} onChange={e => changeConfig({ ...config, mapping: config.mapping.map((m, i) => i === index ? { ...m, column: Number(e.target.value) } : m) })}>
              {config.expectedHeaders.map((h, i) => <option key={i} value={i}>Cột {sheetColumnName(i)}{h ? ` — ${h}` : ''}</option>)}</select>
            <ArrowRight size={14} />
            <select aria-label={`Trường dữ liệu ${index + 1}`} value={map.field} disabled={!connected} onChange={e => changeConfig({ ...config, mapping: config.mapping.map((m, i) => i === index ? { ...m, field: e.target.value as SheetField } : m) })}>
              {fields.map(f => <option key={f.field} value={f.field} disabled={config.mapping.some((m, i) => i !== index && m.field === f.field)}>{f.label}</option>)}</select>
            <button type="button" className="btn-icon" aria-label={`Bỏ cột ${index + 1}`} onClick={() => changeConfig({ ...config, mapping: config.mapping.filter((_, i) => i !== index) })}><X size={13} /></button>
          </div>)}
          <p className="sheet-sync-help">Trường bắt buộc: <b>{type.fieldLabel}</b>. Các trường còn lại tùy chọn.</p>
        </section>
        <div className="sheet-sync-dedupe"><Check size={17} /><div><strong>Luôn bỏ qua data đã có trong nhóm</strong><p>Chỉ thêm data mới, giữ nguyên thông tin cũ. Data đã gỡ không tự thêm lại.</p></div></div>
        <label className="sheet-sync-checkbox"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Bật lịch đồng bộ</label>
        <div className="sheet-sync-note"><Info size={14} /><span>{enabled ? `Cứ ${hours || '…'} giờ hệ thống đọc lại Sheet, kể cả khi akaAgent đã đóng.${endDate ? ` Chạy đến hết ngày ${endDate.split('-').reverse().join('/')} (giờ Việt Nam).` : ''}` : 'Nguồn được lưu ở trạng thái tạm dừng.'} Tối đa 10.000 dòng và 10 MiB mỗi Sheet.</span></div>
      </fieldset>
      {error && <div className="sheet-sync-error" role="alert">{error}</div>}
      {preview && <section className="sheet-sync-preview" aria-label="Kết quả chạy thử">
        <strong>Kết quả chạy thử · chưa ghi dữ liệu</strong>
        <p>{preview.rowCount.toLocaleString('vi-VN')} dòng · <b>{preview.newCount} mới</b> · {preview.duplicateCount} trùng · {preview.invalidCount} không hợp lệ</p>
        {preview.sample.length > 0 && <div className="sheet-sync-preview-table"><table><thead><tr><th>Định danh</th><th>Họ tên</th></tr></thead><tbody>{preview.sample.map((row, i) => <tr key={i}><td>{row[type.field]}</td><td>{row.name || '—'}</td></tr>)}</tbody></table></div>}
        {preview.errors.slice(0, 5).map(e => <p key={e.row}>Dòng {e.row}: {e.message}</p>)}
      </section>}
    </div>
    <footer className="sheet-sync-form-footer"><button type="button" className="btn" disabled={!!busy || !connected} onClick={() => void run(false)}>{busy === 'preview' && <LoaderCircle size={14} className="spin" />}Chạy thử ngay</button><span />
      <button type="button" className="btn" disabled={!!busy} onClick={onClose}>Hủy</button><button type="button" className="btn btn-primary" disabled={!!busy || !connected || !options.length} onClick={() => void run(true)}>{busy === 'save' && <LoaderCircle size={14} className="spin" />}Lưu nguồn đồng bộ</button></footer>
  </DataGroupFormDialog>
}
