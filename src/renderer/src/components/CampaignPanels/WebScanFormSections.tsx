// Các phần riêng của form chiến dịch quét data website (nhatot, batdongsan, Trang Vàng): cấu hình tìm kiếm, thông tin lấy thêm, danh sách từ
// khoá. Bản thiết kế anh duyệt 21/11/2026 (phiên bản 10): https://claude.ai/artifact/6s57dV55jtFr6zRBWVU14y. Cài đặt lưu ở
// extra_settings.webScan; từ khoá (và link Trang Vàng) lưu thành data đầu vào, mỗi dòng một data.
import { useMemo, useState } from 'react'
import {
  WEB_SCAN_ALWAYS_FIELDS, WEB_SCAN_FIELDS, WEB_SCAN_INFO_KEYS, WEB_SCAN_YELLOWPAGES_PROVINCES, getWebScanFieldCatalog, getWebScanFieldLabel,
  isYellowPagesListingLink, parseWebScanKeywords, type WebScanCampaignSettings, type WebScanPoster, type WebScanSite
} from '../../../../shared/webScan'

interface SettingsProps {
  site: WebScanSite
  settings: WebScanCampaignSettings
  onChange: (next: WebScanCampaignSettings) => void
}

const clampInt = (value: string, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Từ khoá ở form: mỗi dòng một từ khoá; Trang Vàng nhận thêm link ngành / link tìm kiếm. */
export function parseWebScanKeywordRows(site: WebScanSite, text: string): Array<{ uid: string; name: string }> {
  return parseWebScanKeywords(text).map(keyword => {
    const link = site === 'yellowpages' && isYellowPagesListingLink(keyword) ? keyword : null
    return { uid: link || keyword, name: keyword }
  })
}

export function formatWebScanKeywordRows(rows: ReadonlyArray<{ uid?: string | null; name?: string | null }>): string {
  return rows.map(row => String(row.name || row.uid || '').trim()).filter(Boolean).join('\n')
}

/** Từ khoá Trang Vàng dán link không đúng dạng (không phải trang ngành / trang tìm kiếm). */
export function invalidWebScanLinks(site: WebScanSite, text: string): string[] {
  if (site !== 'yellowpages') return []
  return parseWebScanKeywords(text).filter(item => /^https?:\/\//i.test(item) && !isYellowPagesListingLink(item))
}

export function WebScanSearchSettings({ site, settings, onChange }: SettingsProps) {
  const [provinceFilter, setProvinceFilter] = useState('')
  const set = (patch: Partial<WebScanCampaignSettings>) => onChange({ ...settings, ...patch })
  const provinces = useMemo(() => {
    const filter = provinceFilter.trim().toLocaleLowerCase('vi')
    return WEB_SCAN_YELLOWPAGES_PROVINCES.filter(name => !filter || name.toLocaleLowerCase('vi').includes(filter))
  }, [provinceFilter])

  return (
    <>
      {site === 'batdongsan' && (
        <div className="schedule-hint" style={{ marginBottom: 12 }}>
          Batdongsan chỉ tìm được theo tên khu vực hoặc tên dự án, ví dụ "quận 7", "Vinhomes Grand Park". Mỗi từ khoá tìm ở cả mục bán và cho thuê.
        </div>
      )}
      {site === 'nhatot' && (
        <div className="schedule-hint" style={{ marginBottom: 12 }}>
          Mỗi từ khoá tìm ở cả mục mua bán và cho thuê. Từ khoá nên có loại nhà và khu vực, ví dụ "nhà quận 7".
        </div>
      )}
      {site === 'yellowpages' && (
        <div className="stepper-form-group">
          <label>Tỉnh / thành</label>
          <div className="schedule-hint" style={{ marginBottom: 8 }}>
            Không chọn tỉnh thì tìm cả nước. Link dán ở danh sách từ khoá không theo tỉnh.
          </div>
          <input
            className="stepper-input"
            value={provinceFilter}
            onChange={event => setProvinceFilter(event.target.value)}
            placeholder="Tìm tỉnh..."
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {provinces.map(name => (
              <label key={name} className="schedule-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.provinces.includes(name)}
                  onChange={event => set({
                    provinces: event.target.checked
                      ? WEB_SCAN_YELLOWPAGES_PROVINCES.filter(item => item === name || settings.provinces.includes(item))
                      : settings.provinces.filter(item => item !== name)
                  })}
                />
                <span>{name}</span>
              </label>
            ))}
          </div>
          {settings.provinces.length > 0 && (
            <div className="schedule-hint" style={{ marginTop: 6 }}>
              Đã chọn {settings.provinces.length} tỉnh.{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ provinces: [] })}>Bỏ chọn tất cả</button>
            </div>
          )}
        </div>
      )}
      {site === 'nhatot' && (
        <div className="stepper-form-group">
          <label>Lấy SĐT của</label>
          <select
            className="stepper-input"
            value={settings.poster}
            onChange={event => set({ poster: event.target.value as WebScanPoster })}
          >
            <option value="broker">Môi giới</option>
            <option value="personal">Cá nhân</option>
            <option value="both">Cả hai</option>
          </select>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="stepper-form-group">
          <label>{site === 'yellowpages' ? 'Số trang tối đa mỗi lần tìm (một từ khoá ở một tỉnh, hoặc một link)' : 'Số trang tối đa mỗi lần tìm (một từ khoá ở một mục)'}</label>
          <input
            type="number"
            className="stepper-input"
            min={1}
            max={500}
            value={settings.pagesPerSearch}
            onChange={event => set({ pagesPerSearch: clampInt(event.target.value, 1, 500, settings.pagesPerSearch) })}
          />
        </div>
        <div className="stepper-form-group">
          <label>Số data tối đa mỗi từ khoá</label>
          <input
            type="number"
            className="stepper-input"
            min={1}
            max={10000}
            value={settings.maxDataPerRun}
            onChange={event => set({ maxDataPerRun: clampInt(event.target.value, 1, 10000, settings.maxDataPerRun) })}
          />
        </div>
      </div>
      <div className="stepper-form-group">
        <label className="schedule-checkbox-label">
          <input type="checkbox" checked={settings.skipSeen} onChange={event => set({ skipSeen: event.target.checked })} />
          <span>Bỏ qua tin đã quét ở lượt trước</span>
        </label>
      </div>
      {site !== 'nhatot' && (
        <div className="stepper-form-group">
          <label className="schedule-checkbox-label">
            <input type="checkbox" checked={settings.openDetail} onChange={event => set({ openDetail: event.target.checked })} />
            <span>{site === 'yellowpages' ? 'Mở trang chi tiết từng doanh nghiệp (mỗi trang tính một lượt)' : 'Mở trang từng tin (chậm hơn)'}</span>
          </label>
        </div>
      )}
    </>
  )
}

export function WebScanFieldSettings({ site, settings, onChange }: SettingsProps) {
  const set = (patch: Partial<WebScanCampaignSettings>) => onChange({ ...settings, ...patch })
  const fields = WEB_SCAN_FIELDS[site]
  const groups: Array<{ title: string; items: typeof fields }> = [
    { title: site === 'yellowpages' ? 'Có sẵn ở trang danh sách' : site === 'nhatot' ? 'Có sẵn ở trang tin (đã mở để hiện SĐT)' : 'Có sẵn ở thẻ tin',
      items: fields.filter(field => field.group === 'list') },
    { title: site === 'yellowpages' ? 'Cần mở trang chi tiết' : 'Cần mở trang từng tin', items: fields.filter(field => field.group === 'detail') }
  ].filter(group => group.items.length > 0)
  const infoOptions = ['phone', 'name', ...getWebScanFieldCatalog(site).map(field => field.key)]

  return (
    <>
      <div className="schedule-hint" style={{ marginBottom: 12 }}>
        Luôn lấy: SĐT, {getWebScanFieldLabel(site, 'name').toLowerCase()}, {WEB_SCAN_ALWAYS_FIELDS[site].map(field => field.label.toLowerCase()).join(', ')}.
        Trường đã chọn hiện ở tab "Data tìm được" và file Excel.
      </div>
      {groups.map(group => (
        <div key={group.title} className="stepper-form-group">
          <label>{group.title}</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 4 }}>
            {group.items.map(field => {
              const disabled = field.group === 'detail' && !settings.openDetail
              return (
                <label key={field.key} className="schedule-checkbox-label" style={disabled ? { opacity: 0.55 } : undefined}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={settings.fields.includes(field.key)}
                    onChange={event => set({
                      fields: event.target.checked
                        ? fields.filter(item => item.key === field.key || settings.fields.includes(item.key)).map(item => item.key)
                        : settings.fields.filter(item => item !== field.key)
                    })}
                  />
                  <span>{field.label}</span>
                </label>
              )
            })}
          </div>
          {group.items.some(field => field.group === 'detail') && !settings.openDetail && (
            <div className="schedule-hint" style={{ marginTop: 6 }}>Bật "{site === 'yellowpages' ? 'Mở trang chi tiết từng doanh nghiệp' : 'Mở trang từng tin'}" ở phần Cấu hình tìm kiếm để lấy các trường này.</div>
          )}
        </div>
      ))}
      <div className="stepper-form-group">
        <label>Đưa vào cột Info1–Info5 của Nhóm data</label>
        <div className="schedule-hint" style={{ marginBottom: 8 }}>Dùng làm biến khi soạn tin nhắn cho data này.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {WEB_SCAN_INFO_KEYS.map((infoKey, index) => (
            <div key={infoKey}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Info{index + 1}</div>
              <select
                className="stepper-input"
                value={settings.infoMap[infoKey] || ''}
                onChange={event => set({ infoMap: { ...settings.infoMap, [infoKey]: event.target.value || null } })}
              >
                <option value="">(Không dùng)</option>
                {infoOptions.map(key => <option key={key} value={key}>{getWebScanFieldLabel(site, key)}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export function WebScanKeywordInput({ site, value, onChange }: { site: WebScanSite; value: string; onChange: (value: string) => void }) {
  const count = parseWebScanKeywords(value).length
  const invalid = invalidWebScanLinks(site, value)
  return (
    <div className="stepper-form-group">
      <label>{site === 'yellowpages' ? 'Từ khoá hoặc link ngành / link tìm kiếm Trang Vàng' : 'Từ khoá'}</label>
      <textarea
        className="stepper-textarea"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={site === 'yellowpages'
          ? 'bao bì nhựa\nin ấn\nhttps://www.yellowpages.vn/cls/...'
          : site === 'batdongsan' ? 'quận 7\nVinhomes Grand Park' : 'nhà quận 7\ncăn hộ Thủ Đức'}
        rows={6}
      />
      <div className="schedule-hint" style={{ marginTop: 6 }}>Mỗi dòng một từ khoá{site === 'yellowpages' ? ' hoặc một link' : ''}. {count > 0 ? `${count} từ khoá.` : ''}</div>
      {invalid.length > 0 && (
        <div className="schedule-hint" style={{ color: 'var(--danger, #d14343)', marginTop: 4 }}>
          Link không phải trang ngành / trang tìm kiếm của Trang Vàng: {invalid.slice(0, 3).join(', ')}{invalid.length > 3 ? '…' : ''}
        </div>
      )}
    </div>
  )
}
