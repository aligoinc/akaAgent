/**
 * Một lượt data của chiến dịch quét data website (một từ khoá, hoặc một link Trang Vàng) trên engine v2. Phương án docs/WEB_DATA_SCAN_PLAN.md
 * mục 4.3 / 7.4 / 7.6.
 *
 * Việc trên trang nằm ở các block "[engine] web_*" trong DB (sửa khi trang đổi giao diện không cần phát hành app); ở đây chỉ có thứ tự các
 * bước, đếm hạn mức, bỏ tin đã quét và báo kết quả cho lõi:
 * - Mỗi lần hiện SĐT (nhatot, batdongsan) / mở trang (Trang Vàng) là một dòng Lịch sử hành động có mã thao tác của trang (anh chốt 21/11/2026),
 *   báo ngay sau mỗi lần để hạn mức ngày / giờ đếm đúng cả khi app tắt ngang.
 * - Claim trả số lượt còn lại (V618); hết lượt giữa từ khoá thì báo WB03: từ khoá về hàng đợi, lượt sau làm tiếp và bỏ tin đã quét.
 * - Tin đã có số do chiến dịch khác cùng tổ chức hiện trong 30 ngày thì dùng lại, không bấm lại (anh chốt 21/11/2026).
 * - Cuối từ khoá một dòng "Tìm data" (không mã thao tác) mang phần tổng kết.
 * - Nghỉ giữa hai lần mở trang / bấm hiện số theo cài đặt (thấp nhất 10 giây, kẹp ở nơi gọi).
 *
 * Không phụ thuộc Electron: bài kiểm chạy hàm này với block giả (scripts/web-scan/runner-smoke.cjs).
 */
import {
  WEB_SCAN_ACTION_CODES, WEB_SCAN_ACTION_NAMES, isYellowPagesListingLink, normalizeVietnamMobile, pickWebScanFields, yellowPagesSearchUrl,
  type WebScanCampaignSettings, type WebScanRecord, type WebScanSection, type WebScanSite, type WebScanStopReason
} from '../../../shared/webScan'
import { monotonicNow } from '../../../shared/monotonicNow'
import { WEB_FIND_DATA_RESULT_NAME, type RawOutcome, type ReportSuccess, type WorkflowMilestone, type WorkflowStop, type WorkflowTargetApi,
  type WorkflowTargetEnd } from '../../../../packages/campaign-engine/src/index'

export const WEB_SCAN_BLOCKS = {
  nhatotList: '[engine] web_nhatot_list',
  nhatotReveal: '[engine] web_nhatot_reveal',
  batdongsanSearch: '[engine] web_batdongsan_search',
  batdongsanList: '[engine] web_batdongsan_list',
  batdongsanReveal: '[engine] web_batdongsan_reveal',
  batdongsanDetail: '[engine] web_batdongsan_detail',
  yellowpagesList: '[engine] web_yellowpages_list',
  yellowpagesDetail: '[engine] web_yellowpages_detail'
} as const
export const WEB_SCAN_BLOCK_NAMES: readonly string[] = Object.values(WEB_SCAN_BLOCKS)

const SECTIONS: readonly WebScanSection[] = ['sale', 'rent']
const SECTION_LABELS: Readonly<Record<WebScanSite, Record<WebScanSection, string>>> = {
  nhatot: { sale: 'mua bán', rent: 'cho thuê' },
  batdongsan: { sale: 'bán', rent: 'cho thuê' },
  yellowpages: { sale: '', rent: '' }
}
/** Bấm hiện số mà trang không còn như trước (không thấy nút / số) mấy tin liền thì coi như trang đổi giao diện. */
const MAX_REVEAL_LAYOUT_FAILURES = 3

export type WebBlockRun = { ok: true; output: Record<string, unknown> } | { ok: false; error: string; hang?: boolean }

export interface WebScanSeenLookup {
  seen: ReadonlySet<string>
  cached: ReadonlyMap<string, { phone: string; name: string | null; data: Record<string, unknown> }>
}

export interface WebScanSeenItem { key: string; phone?: string | null; name?: string | null; data?: Record<string, unknown> }

export interface WebScanTargetDeps {
  api: WorkflowTargetApi
  site: WebScanSite
  settings: WebScanCampaignSettings
  /** Nghỉ giữa hai lần mở trang / bấm hiện số (đã kẹp mức thấp nhất). */
  sleepSeconds: number
  runBlock(name: string, input: Record<string, unknown>): Promise<WebBlockRun>
  loadSeen(keys: readonly string[]): Promise<WebScanSeenLookup>
  recordSeen(items: readonly WebScanSeenItem[]): Promise<void>
  /** Đẩy data vừa tìm được (Nhóm data, chiến dịch đích). Nơi gọi tự in cảnh báo khi lỗi; không ném. */
  pushRecords(records: readonly WebScanRecord[]): Promise<void>
  /** false = lượt đã bị dừng trong lúc nghỉ. */
  sleep(ms: number): Promise<boolean>
}

class ScanStop {
  constructor(readonly reason: WebScanStopReason | 'interrupted' | 'lease', readonly message?: string, readonly stop?: WorkflowStop) {}
}

const finite = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Number.POSITIVE_INFINITY
}
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
// Mở trang quá thời gian chờ (PageController.open) cũng là lỗi mạng: trang không tải được, từ khoá về hàng đợi.
const isNetworkError = (message: string): boolean => /\bERR_[A-Z_]+\b|net::|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|Mở trang quá \d+ giây/i.test(message)

export async function runWebScanTarget(deps: WebScanTargetDeps): Promise<WorkflowTargetEnd> {
  const { api, site, settings } = deps
  const actionCode = WEB_SCAN_ACTION_CODES[site]
  const actionName = WEB_SCAN_ACTION_NAMES[site]
  const text = str(api.target.name) || str(api.target.uid)
  const gate = api.actions[actionCode]
  const remaining = Math.min(finite(gate?.remainingDaily), finite(gate?.remainingWindow))
  const records: WebScanRecord[] = []
  const reused: WebScanRecord[] = []
  const phones = new Set<string>()
  let uses = 0
  let seenSkipped = 0
  let useSeq = 0
  let lastActionAt: number | null = null
  let pending: WebScanRecord[] = []
  const counts = { listings: 0, noPhone: 0 }

  if (!text) {
    return reportEnd('done', 'Data không có từ khoá')
  }

  // ------------------------------------------------------------------------------------------------------------------------------------
  // Các bước dùng chung

  const checkStop = (): void => {
    if (api.signal.aborted || api.shouldStop()) throw new ScanStop('interrupted')
  }

  /** Nghỉ giữa hai lần mở trang / bấm hiện số (lần đầu của từ khoá không nghỉ). */
  const pace = async (): Promise<void> => {
    checkStop()
    if (lastActionAt !== null) {
      const wait = lastActionAt + deps.sleepSeconds * 1000 - monotonicNow()
      if (wait > 0 && !(await deps.sleep(wait))) throw new ScanStop('interrupted')
      checkStop()
    }
    lastActionAt = monotonicNow()
  }

  const needUse = (): void => {
    if (uses >= remaining) throw new ScanStop('quota')
  }

  const run = async (name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const result = await deps.runBlock(name, input)
    if (!result.ok) {
      checkStop()
      throw new ScanStop('error', result.error)
    }
    const out = obj(result.output)
    if (out.challenge === true) throw new ScanStop('challenge', str(out.title))
    return out
  }

  const report = async (step: WorkflowMilestone, raw: RawOutcome): Promise<ReportSuccess> => {
    const res = await api.reportMilestone(step, raw)
    if ('stop' in res) throw new ScanStop('lease', undefined, res)
    return res
  }

  /** Một lần dùng hạn mức: một dòng Lịch sử hành động có mã thao tác của trang. */
  const reportUse = async (log: string, data: Record<string, unknown>, attached: readonly WebScanRecord[]): Promise<void> => {
    useSeq += 1
    const res = await report({ key: `use:${useSeq}`, actionCode, actionName, quietOk: true }, {
      ok: true, customerLog: log,
      data: { webScan: { site, ...data }, ...(attached.length > 0 ? { webRecords: attached } : {}) }
    })
    uses += 1
    api.progress(log, 'success')
    if (res.target.done) throw new ScanStop('done')
  }

  const addRecord = (record: WebScanRecord): boolean => {
    if (phones.has(record.phone)) return false
    phones.add(record.phone)
    records.push(record)
    pending.push(record)
    return true
  }

  const full = (): boolean => records.length >= settings.maxDataPerRun

  /** Đẩy data của trang vừa đọc (Nhóm data, chiến dịch đích): app tắt giữa từ khoá thì data của các trang trước vẫn đã vào nhóm. */
  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    await deps.pushRecords(batch)
  }

  const seenOf = async (keys: readonly string[]): Promise<WebScanSeenLookup> => {
    if (keys.length === 0) return { seen: new Set(), cached: new Map() }
    return deps.loadSeen(keys)
  }

  const record = (fields: Record<string, unknown>, base: Omit<WebScanRecord, 'fields' | 'site'>): WebScanRecord => ({
    site, ...base,
    fields: pickWebScanFields(site, {
      ...fields, link: base.link, listingId: base.listingKey, ...(base.section ? { section: SECTION_LABELS[site][base.section] } : {})
    }, settings)
  })

  // ------------------------------------------------------------------------------------------------------------------------------------
  // nhatot: tìm q= ở mua bán rồi cho thuê, mở trang tin chưa quét, bấm "Hiện SĐT".

  const scanNhatot = async (): Promise<void> => {
    let layoutFailures = 0
    for (const section of SECTIONS) {
      for (let pageNo = 1; pageNo <= settings.pagesPerSearch; pageNo += 1) {
        await pace()
        const list = await run(WEB_SCAN_BLOCKS.nhatotList, { keyword: text, section, page: pageNo })
        const items = Array.isArray(list.items) ? list.items.map(obj) : []
        if (items.length === 0) {
          if (pageNo === 1 && section === 'sale' && list.layoutChanged === true) throw new ScanStop('layout_changed', str(list.title))
          break
        }
        counts.listings += items.length
        const wanted = items.filter(item => settings.poster === 'both' || (settings.poster === 'broker') === (item.isBroker === true))
        const lookup = await seenOf(wanted.map(item => str(item.listingKey)).filter(Boolean))
        for (const item of wanted) {
          const key = str(item.listingKey)
          const link = str(item.link)
          if (!key || !link) continue
          if (settings.skipSeen && lookup.seen.has(key)) { seenSkipped += 1; continue }
          const title = str(obj(item.fields).title) || key
          const posterType = item.isBroker === true ? 'Môi giới' : 'Cá nhân'
          const cached = lookup.cached.get(key)
          if (cached) {
            const rec = record({ ...obj(cached.data), ...obj(item.fields), posterType }, {
              phone: cached.phone, name: cached.name || str(item.name), listingKey: key, link, section, reused: true })
            if (addRecord(rec)) {
              reused.push(rec)
              api.progress(`♻️ Tin "${title}" đã có số từ trước: ${cached.phone}`, 'info')
            }
            await deps.recordSeen([{ key }])
            if (full()) throw new ScanStop('max_data')
            continue
          }
          needUse()
          await pace()
          const out = await run(WEB_SCAN_BLOCKS.nhatotReveal, { link })
          const fields = { ...obj(item.fields), ...obj(out.fields), posterType }
          const name = str(out.name) || str(item.name)
          const phone = normalizeVietnamMobile(str(out.phone)) || ''
          if (out.clicked === true) {
            const rec = phone ? record(fields, { phone, name, listingKey: key, link, section }) : null
            const added = rec ? addRecord(rec) : false
            if (!phone) counts.noPhone += 1
            await reportUse(phone ? `📞 ${actionName} "${title}": ${phone}` : `📞 ${actionName} "${title}": không thấy số`,
              { listingKey: key, link, title, section, phone: phone || null }, added && rec ? [rec] : [])
            await deps.recordSeen([{ key, phone: phone || null, name, data: phone ? fields : undefined }])
          } else if (out.hidden === true || out.noButton === true) {
            counts.noPhone += 1
            await deps.recordSeen([{ key }])
          }
          if (out.layoutChanged === true || out.noButton === true) {
            layoutFailures += 1
            if (layoutFailures >= MAX_REVEAL_LAYOUT_FAILURES && out.layoutChanged === true) throw new ScanStop('layout_changed', title)
          } else {
            layoutFailures = 0
          }
          if (full()) throw new ScanStop('max_data')
        }
        await flush()
        if (list.hasMore === false) break
        if (pageNo === settings.pagesPerSearch) break
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------------
  // batdongsan: gõ từ khoá vào ô tìm của trang (mục bán rồi cho thuê), bấm "Hiện số" trên thẻ chưa quét; tuỳ chọn mở trang tin.

  const scanBatdongsan = async (): Promise<void> => {
    for (const section of SECTIONS) {
      await pace()
      const search = await run(WEB_SCAN_BLOCKS.batdongsanSearch, { keyword: text, section })
      const url = str(search.url)
      const label = SECTION_LABELS.batdongsan[section]
      if (search.resolved !== true || !url) {
        api.progress(`🔎 "${text}" (${label}): Batdongsan không có trang kết quả cho từ khoá này`, 'warning')
        continue
      }
      const total = Number(search.total)
      api.progress(`🔎 "${text}" (${label}): Batdongsan mở trang "${str(search.title) || url}"${Number.isFinite(total) && total > 0 ? ` (${total} tin)` : ''}`, 'info')
      for (let pageNo = 1; pageNo <= settings.pagesPerSearch; pageNo += 1) {
        await pace()
        const list = await run(WEB_SCAN_BLOCKS.batdongsanList, { url, page: pageNo })
        const items = Array.isArray(list.items) ? list.items.map(obj) : []
        if (items.length === 0) {
          if (pageNo === 1 && list.layoutChanged === true) throw new ScanStop('layout_changed', str(list.title))
          break
        }
        counts.listings += items.length
        const lookup = await seenOf(items.map(item => str(item.listingKey)).filter(Boolean))
        const pageRecords: WebScanRecord[] = []
        for (const item of items) {
          const key = str(item.listingKey)
          const link = str(item.link)
          if (!key || !link) continue
          if (settings.skipSeen && lookup.seen.has(key)) { seenSkipped += 1; continue }
          const title = str(obj(item.fields).title) || key
          const cached = lookup.cached.get(key)
          if (cached) {
            const rec = record({ ...obj(cached.data), ...obj(item.fields) }, {
              phone: cached.phone, name: cached.name || str(item.name), listingKey: key, link, section, reused: true })
            if (addRecord(rec)) {
              reused.push(rec)
              api.progress(`♻️ Tin "${title}" đã có số từ trước: ${cached.phone}`, 'info')
            }
            await deps.recordSeen([{ key }])
            if (full()) throw new ScanStop('max_data')
            continue
          }
          if (item.hasPhoneButton === false) { counts.noPhone += 1; await deps.recordSeen([{ key }]); continue }
          needUse()
          await pace()
          // Bấm trên thẻ của trang danh sách đang mở (mở trang tin để lấy thêm trường chỉ làm sau khi xong cả trang).
          const out = await run(WEB_SCAN_BLOCKS.batdongsanReveal, { listingKey: key })
          if (out.loginRequired === true) throw new ScanStop('login_required')
          const fields = obj(item.fields)
          const name = str(item.name)
          const phone = normalizeVietnamMobile(str(out.phone)) || ''
          if (out.clicked === true) {
            const rec = phone ? record(fields, { phone, name, listingKey: key, link, section }) : null
            const added = rec ? addRecord(rec) : false
            if (!phone) counts.noPhone += 1
            if (rec && added) pageRecords.push(rec)
            // Mở trang tin thì dòng lịch sử ghi sau khi có đủ trường; không mở thì ghi ngay.
            await reportUse(phone ? `📞 ${actionName} "${title}": ${phone}` : `📞 ${actionName} "${title}": không thấy số`,
              { listingKey: key, link, title, section, phone: phone || null }, added && rec && !settings.openDetail ? [rec] : [])
            await deps.recordSeen([{ key, phone: phone || null, name, data: phone ? fields : undefined }])
          } else {
            counts.noPhone += 1
            await deps.recordSeen([{ key }])
          }
          if (full()) break
        }
        if (settings.openDetail && pageRecords.length > 0) {
          for (const rec of pageRecords) {
            await pace()
            const detail = await run(WEB_SCAN_BLOCKS.batdongsanDetail, { link: rec.link })
            Object.assign(rec.fields, pickWebScanFields(site, obj(detail.fields), settings))
          }
          await reportDetailRecords(pageRecords)
        }
        await flush()
        if (full()) throw new ScanStop('max_data')
        if (list.hasMore === false || pageNo === settings.pagesPerSearch) break
      }
    }
  }

  /** batdongsan mở trang tin: data của cả trang đi trong dòng "Tìm data" của trang (không tính lượt). */
  const reportDetailRecords = async (list: readonly WebScanRecord[]): Promise<void> => {
    useSeq += 1
    await report({ key: `page:${useSeq}`, actionCode: '', actionName: WEB_FIND_DATA_RESULT_NAME, quietOk: true }, {
      ok: true, data: { webScan: { site, keyword: text, page: true }, webRecords: list }
    })
  }

  // ------------------------------------------------------------------------------------------------------------------------------------
  // Trang Vàng: từ khoá × tỉnh hoặc link khách dán; mỗi trang danh sách mở là một lượt; chỉ giữ số di động, mỗi số một data.

  const scanYellowPages = async (): Promise<void> => {
    const urls = isYellowPagesListingLink(text) ? [text]
      : settings.provinces.length > 0 ? settings.provinces.map(province => yellowPagesSearchUrl(text, province)) : [yellowPagesSearchUrl(text)]
    for (const [urlIndex, url] of urls.entries()) {
      const province = !isYellowPagesListingLink(text) && settings.provinces.length > 0 ? settings.provinces[urlIndex] : ''
      for (let pageNo = 1; pageNo <= settings.pagesPerSearch; pageNo += 1) {
        needUse()
        await pace()
        const list = await run(WEB_SCAN_BLOCKS.yellowpagesList, { url, page: pageNo })
        const items = Array.isArray(list.items) ? list.items.map(obj) : []
        const title = str(list.title) || url
        if (items.length === 0) {
          if (list.layoutChanged === true && pageNo === 1 && urls.length === 1) throw new ScanStop('layout_changed', title)
          if (pageNo === 1) api.progress(`📄 ${title}: không có doanh nghiệp nào`, 'info')
          break
        }
        counts.listings += items.length
        const lookup = await seenOf(items.map(item => str(item.listingKey)).filter(Boolean))
        const pageRecords: Array<{ link: string; recs: WebScanRecord[] }> = []
        for (const item of items) {
          const key = str(item.listingKey)
          const link = str(item.link)
          if (!key || !link) continue
          if (settings.skipSeen && lookup.seen.has(key)) { seenSkipped += 1; continue }
          const mobiles = (Array.isArray(item.mobiles) ? item.mobiles : []).map(value => normalizeVietnamMobile(str(value))).filter((v): v is string => !!v)
          if (mobiles.length === 0) { counts.noPhone += 1; continue }
          const fields = { ...obj(item.fields), industry: isYellowPagesListingLink(text) ? title : text }
          const recs: WebScanRecord[] = []
          for (const phone of [...new Set(mobiles)]) {
            const rec = record(fields, { phone, name: str(item.name), email: str(obj(item.fields).email) || undefined, listingKey: key, link })
            if (addRecord(rec)) recs.push(rec)
            if (full()) break
          }
          if (recs.length > 0) pageRecords.push({ link, recs })
          if (full()) break
        }
        const pageRecs = pageRecords.flatMap(entry => entry.recs)
        const where = isYellowPagesListingLink(text) ? title.replace(/\s*[-|]\s*Trang Vàng.*$/i, '') || text : `"${text}"${province ? ` ở ${province}` : ''}`
        await reportUse(`📄 ${actionName}: ${where}, trang ${pageNo} (${items.length} doanh nghiệp, ${pageRecs.length} SĐT mới)`,
          { url, page: pageNo, title, itemCount: items.length }, settings.openDetail ? [] : pageRecs)
        await deps.recordSeen(items.map(item => ({ key: str(item.listingKey) })).filter(item => item.key))
        if (settings.openDetail) {
          for (const entry of pageRecords) {
            needUse()
            await pace()
            const detail = await run(WEB_SCAN_BLOCKS.yellowpagesDetail, { link: entry.link })
            const extra = pickWebScanFields(site, obj(detail.fields), settings)
            for (const rec of entry.recs) Object.assign(rec.fields, extra)
            await reportUse(`📄 Mở trang chi tiết: ${entry.recs[0]?.name || entry.link}`, { url: entry.link, title: entry.recs[0]?.name || '' }, entry.recs)
          }
        }
        await flush()
        if (full()) throw new ScanStop('max_data')
        if (list.hasMore === false) break
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------------
  // Kết thúc

  async function reportEnd(reason: WebScanStopReason | 'interrupted', message?: string): Promise<WorkflowTargetEnd> {
    const summary = [
      `${records.length} SĐT`,
      seenSkipped > 0 ? `bỏ ${seenSkipped} tin đã quét` : '',
      uses > 0 ? `${uses} lần ${actionName.charAt(0).toLowerCase()}${actionName.slice(1)}` : ''
    ].filter(Boolean).join(', ')
    const log = `🔎 ${WEB_FIND_DATA_RESULT_NAME} "${text}": ${summary}`
    const entries: Array<{ step: WorkflowMilestone; raw: RawOutcome }> = [{
      step: { key: 'find', actionCode: '', actionName: WEB_FIND_DATA_RESULT_NAME, quietOk: true },
      raw: { ok: true, customerLog: log, data: {
        webScan: { site, keyword: text, stopReason: reason, found: records.length, reused: reused.length, seenSkipped, uses,
          listings: counts.listings, noPhone: counts.noPhone, fields: settings.fields, infoMap: settings.infoMap },
        ...(reused.length > 0 ? { webRecords: reused } : {})
      } }
    }]
    const failure = endFailure(reason, message)
    if (failure) entries.push({ step: { key: 'stop', actionCode: failure.actionCode, actionName: WEB_FIND_DATA_RESULT_NAME }, raw: failure.raw })
    // Tổng kết in trước, lý do dừng (dòng lỗi lõi in khi báo kết quả) in sau.
    api.progress(log, 'info')
    const res = await api.reportMilestones(entries)
    if ('stop' in res) return res
    return { done: true }
  }

  // Kết quả dừng lượt không kèm mã thao tác của trang: dòng chính sách chỉ có mã thao tác (V618: mỗi lần dùng tính một lượt, chạy tiếp)
  // được áp sau cùng và đè lên chính sách của mã lỗi, nên kèm mã thao tác thì lần dừng (hết lượt, chưa đăng nhập, tạm dừng…) bị tính thêm
  // một lượt và lượt không dừng. Khoá "Hiện SĐT Batdongsan" của WB02 nằm ở chính sách của mã lỗi, không cần mã thao tác.
  function endFailure(reason: WebScanStopReason | 'interrupted', message?: string): { actionCode: string; raw: RawOutcome } | null {
    const fail = (errorCode: string, code: string, phase: 'before_send' | 'after_send' = 'before_send') => ({
      actionCode: '',
      raw: { ok: false as const, phase, signal: { kind: 'block' as const, code: `web:${code}`, errorCode, ...(message ? { message } : {}) } }
    })
    switch (reason) {
      case 'quota': return fail('err_web_scan_quota_reached', 'quota')
      case 'challenge': return fail('err_web_scan_challenge', 'challenge')
      case 'login_required': return fail('err_web_scan_batdongsan_login', 'login_required')
      case 'layout_changed': return fail('err_web_scan_layout_changed', 'layout_changed', 'after_send')
      case 'interrupted': return fail('err_engine_cancelled', 'cancelled')
      case 'error': return message && isNetworkError(message) ? fail('err_network_offline', 'network') : fail('err_undefined', 'block_failed')
      default: return null
    }
  }

  try {
    if (site === 'nhatot') await scanNhatot()
    else if (site === 'batdongsan') await scanBatdongsan()
    else await scanYellowPages()
    await flush()
    return await reportEnd(records.length === 0 && seenSkipped > 0 ? 'all_seen' : 'done')
  } catch (error) {
    if (!(error instanceof ScanStop)) throw error
    if (error.reason === 'lease' && error.stop) return error.stop
    await flush().catch(() => undefined)
    return reportEnd(error.reason === 'lease' ? 'interrupted' : error.reason, error.message)
  }
}
