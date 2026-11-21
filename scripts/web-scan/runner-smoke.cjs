#!/usr/bin/env node
// Bài kiểm vòng chạy một từ khoá của chiến dịch quét data website (src/main/engineAdapters/web/webScanTarget.ts) với block giả và API lõi giả:
// đếm lượt, hết lượt giữa từ khoá (WB03), bỏ tin đã quét, dùng lại số đã hiện, các mã dừng (WB01 / WB02 / WB04 / NET01 / SYS99 / RUN01), nghỉ
// giữa hai lần mở trang, đẩy data theo trang. Kèm so mã giữa lõi (packages/campaign-engine/src/web/registry.ts), src/shared/webScan.ts và
// bộ sinh migration V618. Không ra mạng, không cần DB.
//   node scripts/web-scan/runner-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
let pass = 0
let fail = 0
async function check(name, fn) {
  try { await fn(); pass += 1; console.log('PASS', name) } catch (error) { fail += 1; console.log('FAIL', name); console.log(error && error.stack || error) }
}

async function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-scan-runner-'))
  const entry = path.join(dir, 'entry.ts')
  fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/web/webScanTarget.ts'))}
export * as shared from ${JSON.stringify(path.join(ROOT, 'src/shared/webScan.ts'))}
export * as core from ${JSON.stringify(path.join(ROOT, 'packages/campaign-engine/src/web/registry.ts'))}
export * as runner from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/web/desktopWebRunner.ts'))}
`)
  const out = path.join(dir, 'bundle.cjs')
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' })
  return require(out)
}

/** API lõi giả: ghi lại mọi kết quả, DB trả "chưa chốt data". */
function fakeApi(opts = {}) {
  const reports = []
  const progress = []
  let stopAfter = opts.stopAfterReports ?? Infinity
  const success = () => ({ ok: true, dryRun: false, next: 'continue', pace: null, outcomes: [], target: { done: false, status: 'đang chạy', note: null, schedule: null },
    campaign: { effect: 'none', note: null }, account: { effect: 'none', loginEffect: 'none' }, safety: [] })
  const api = {
    targetRunId: 77, leaseToken: 'lease', target: { id: 5, campaign_id: 9, name: opts.keyword ?? 'nhà quận 7', phone: null, uid: null, email: null },
    actions: { [opts.code]: { decision: 'allow', required: true, remainingDaily: opts.remainingDaily ?? 100, remainingWindow: opts.remainingWindow ?? 100 } },
    gateSettings: {}, signal: new AbortController().signal,
    beginMilestone: async () => 'ok',
    reportMilestone: async (step, raw) => { reports.push({ step, raw }); return success() },
    reportMilestones: async entries => { for (const e of entries) reports.push(e); return success() },
    claimExtraTargets: async () => ({ items: [] }), beginExtraMilestone: async () => 'ok', reportExtra: async () => success(),
    shouldStop: () => reports.length >= stopAfter,
    progress: (text, level) => progress.push({ text, level }),
    trace: () => undefined
  }
  return { api, reports, progress }
}

function harness(M, site, blocks, opts = {}) {
  const settings = { ...M.shared.defaultWebScanCampaignSettings(site), ...(opts.settings || {}) }
  const { api, reports, progress } = fakeApi({ code: M.shared.WEB_SCAN_ACTION_CODES[site], ...opts })
  const calls = []
  const seenRecorded = []
  const pushed = []
  const sleeps = []
  const deps = {
    api, site, settings, sleepSeconds: opts.sleepSeconds ?? 15,
    runBlock: async (name, input) => {
      calls.push({ name, input })
      const fn = blocks[name]
      if (!fn) return { ok: false, error: 'không có block giả ' + name }
      const out = await fn(input)
      if (out && out.__error) return { ok: false, error: out.__error }
      return { ok: true, output: out }
    },
    loadSeen: async keys => ({ seen: new Set(keys.filter(k => (opts.seen || []).includes(k))),
      cached: new Map(keys.filter(k => opts.cached && opts.cached[k]).map(k => [k, opts.cached[k]])) }),
    recordSeen: async items => { seenRecorded.push(...items) },
    pushRecords: async records => { pushed.push([...records]) },
    sleep: async ms => { sleeps.push(ms); return true }
  }
  return { deps, api, reports, progress, calls, seenRecorded, pushed, sleeps, settings }
}

const nhatotItems = (page, count = 4) => Array.from({ length: count }, (_, i) => ({
  listingKey: `nt${page}${i}`, link: `https://www.nhatot.com/mua-ban-nha-dat/nt${page}${i}.htm`, name: `Người ${page}${i}`, isBroker: i % 2 === 0,
  fields: { title: `Tin ${page}${i}`, price: '5 tỷ', area: '60 m²' }
}))
const phoneOf = key => '09' + String(Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))).padStart(8, '0').slice(-8)

async function main() {
  const M = await load()
  const { runWebScanTarget, WEB_SCAN_BLOCKS: B, shared, core } = M

  await check('mã chiến dịch / thao tác / tên của lõi khớp src/shared/webScan.ts và bộ sinh V618', async () => {
    const V = require('../build-v618-sql.cjs')
    for (const site of shared.WEB_SCAN_SITES) {
      const id = shared.WEB_FIND_DATA_ACTION_IDS[site]
      assert.equal(core.WEB_ACTION_CODE_BY_CAMPAIGN[id], shared.WEB_SCAN_ACTION_CODES[site])
      assert.equal(core.WEB_ACTION_NAMES[shared.WEB_SCAN_ACTION_CODES[site]], shared.WEB_SCAN_ACTION_NAMES[site])
      assert.equal(V.ACTION_IDS[site], id)
      assert.equal(V.ACTION_CODES[site], shared.WEB_SCAN_ACTION_CODES[site])
      assert.equal(V.ACTION_NAMES[site], shared.WEB_SCAN_ACTION_NAMES[site])
    }
    assert.equal(V.SETTING_KEY, shared.WEB_SCAN_SETTING_KEY)
    assert.deepEqual([...M.WEB_SCAN_BLOCK_NAMES].sort(), V.BLOCKS.map(b => b.name).sort())
    for (const e of V.ERRORS) assert.ok(fs.readFileSync(path.join(ROOT, 'src/main/engineAdapters/web/webScanTarget.ts'), 'utf8').includes(e.code), e.code)
  })

  await check('nhatot: chỉ môi giới, bỏ tin đã quét, dùng lại số đã hiện (không tốn lượt); mỗi lần hiện số một dòng có mã thao tác', async () => {
    const h = harness(M, 'nhatot', {
      [B.nhatotList]: ({ section, page }) => section === 'sale' && page <= 2 ? { items: nhatotItems(page), hasMore: page < 2 } : { items: [], empty: true },
      [B.nhatotReveal]: ({ link }) => { const key = link.match(/(nt\d+)\.htm/)[1]; return { phone: phoneOf(key), clicked: true, name: 'X', fields: { address: 'Q7' } } }
    }, { seen: ['nt10'], cached: { nt12: { phone: '0912345678', name: 'Đã hiện', data: { address: 'Q7 cũ' } } } })
    const end = await runWebScanTarget(h.deps)
    assert.deepEqual(end, { done: true })
    const uses = h.reports.filter(r => r.step.actionCode === 'web_nhatot_phone')
    // trang 1: nt10 (đã quét) bỏ, nt12 dùng lại; trang 2: nt20, nt22 bấm. Tin lẻ (cá nhân) bỏ.
    assert.equal(uses.length, 2)
    assert.ok(uses.every(r => r.raw.ok === true && r.step.quietOk === true && /^📞 Hiện SĐT Nhà Tốt "Tin 2\d": 09\d{8}$/.test(r.raw.customerLog)))
    assert.ok(uses.every(r => r.raw.data.webRecords.length === 1 && r.raw.data.webRecords[0].fields.address === 'Q7'))
    const find = h.reports.find(r => r.step.key === 'find')
    assert.equal(find.step.actionCode, '')
    assert.equal(find.step.actionName, 'Tìm data')
    assert.equal(find.raw.data.webScan.found, 3)
    assert.equal(find.raw.data.webScan.reused, 1)
    assert.equal(find.raw.data.webScan.seenSkipped, 1)
    assert.equal(find.raw.data.webRecords[0].phone, '0912345678')
    assert.equal(find.raw.data.webRecords[0].reused, true)
    assert.ok(!h.reports.some(r => r.step.key === 'stop'))
    assert.equal(h.pushed.flat().length, 3)
    assert.equal(h.pushed.length, 2, 'đẩy theo từng trang')
    assert.ok(h.calls.filter(c => c.name === B.nhatotReveal).length === 2)
    // trường lấy thêm: chỉ trường đã chọn + luôn lấy
    const rec = uses[0].raw.data.webRecords[0]
    assert.equal(rec.fields.section, 'mua bán')
    assert.equal(rec.fields.listingId, rec.listingKey)
    assert.ok(!('description' in rec.fields))
  })

  await check('nghỉ giữa hai lần mở trang / bấm hiện số theo cài đặt (lần đầu không nghỉ)', async () => {
    const h = harness(M, 'nhatot', {
      [B.nhatotList]: ({ section, page }) => section === 'sale' && page === 1 ? { items: nhatotItems(1, 2), hasMore: false } : { items: [] },
      [B.nhatotReveal]: () => ({ phone: '0987654321', clicked: true })
    }, { sleepSeconds: 12 })
    await runWebScanTarget(h.deps)
    // 1 danh sách sale + 1 bấm + 1 danh sách rent = 3 lần mở; nghỉ 2 lần, mỗi lần gần 12 giây.
    assert.equal(h.sleeps.length, 2)
    assert.ok(h.sleeps.every(ms => ms > 11_000 && ms <= 12_000), JSON.stringify(h.sleeps))
  })

  await check('hết lượt giữa từ khoá (WB03): dừng trước lần bấm vượt hạn mức, kết quả đã có vẫn báo, từ khoá về hàng đợi', async () => {
    const h = harness(M, 'nhatot', {
      [B.nhatotList]: ({ page }) => ({ items: nhatotItems(page, 10), hasMore: true }),
      [B.nhatotReveal]: ({ link }) => ({ phone: phoneOf(link), clicked: true })
    }, { remainingDaily: 3, remainingWindow: 50 })
    await runWebScanTarget(h.deps)
    assert.equal(h.calls.filter(c => c.name === B.nhatotReveal).length, 3)
    const stop = h.reports.find(r => r.step.key === 'stop')
    assert.equal(stop.raw.signal.errorCode, 'err_web_scan_quota_reached')
    assert.equal(stop.raw.phase, 'before_send')
    // Không kèm mã thao tác: dòng chính sách chỉ có mã thao tác (tính lượt, chạy tiếp) đè lên chính sách của mã lỗi (giả lập 21/11/2026).
    assert.equal(stop.step.actionCode, '')
    assert.equal(stop.step.actionName, 'Tìm data')
    assert.equal(h.reports.find(r => r.step.key === 'find').raw.data.webScan.stopReason, 'quota')
    assert.equal(h.pushed.flat().length, 3, 'data đã có vẫn được đẩy')
  })

  await check('bấm hiện số mà không ra số vẫn tính lượt (đã bấm); người bán ẩn số thì không tính', async () => {
    const h = harness(M, 'nhatot', {
      [B.nhatotList]: ({ section, page }) => section === 'sale' && page === 1 ? { items: nhatotItems(1, 6), hasMore: false } : { items: [] },
      [B.nhatotReveal]: ({ link }) => /nt10/.test(link) ? { noPhone: true, clicked: true } : /nt12/.test(link) ? { hidden: true } : { phone: '0977111222', clicked: true }
    })
    await runWebScanTarget(h.deps)
    const uses = h.reports.filter(r => r.step.actionCode === 'web_nhatot_phone')
    assert.equal(uses.length, 2)
    assert.match(uses[0].raw.customerLog, /không thấy số/)
    assert.equal(uses[0].raw.data.webRecords, undefined)
    assert.ok(h.seenRecorded.some(s => s.key === 'nt12'), 'tin ẩn số vẫn ghi đã quét')
  })

  await check('trang đòi xác minh (WB01): dừng ngay, báo mã của trang', async () => {
    const h = harness(M, 'nhatot', { [B.nhatotList]: () => ({ challenge: true, items: [], title: 'Chờ một chút…' }) })
    await runWebScanTarget(h.deps)
    const stop = h.reports.find(r => r.step.key === 'stop')
    assert.equal(stop.raw.signal.errorCode, 'err_web_scan_challenge')
    assert.equal(stop.raw.signal.message, 'Chờ một chút…')
  })

  await check('trang không còn như trước ở trang đầu (WB04): dòng "Tìm data" lỗi, không gắn thao tác', async () => {
    const h = harness(M, 'nhatot', { [B.nhatotList]: () => ({ layoutChanged: true, items: [] }) })
    await runWebScanTarget(h.deps)
    const stop = h.reports.find(r => r.step.key === 'stop')
    assert.equal(stop.raw.signal.errorCode, 'err_web_scan_layout_changed')
    assert.equal(stop.step.actionCode, '')
    assert.equal(stop.step.actionName, 'Tìm data')
  })

  await check('lỗi mở trang do mạng → NET01 (về hàng đợi); lỗi khác của block → SYS99', async () => {
    let h = harness(M, 'nhatot', { [B.nhatotList]: () => ({ __error: "ERR_NAME_NOT_RESOLVED (-105) loading 'https://www.nhatot.com/…'" }) })
    await runWebScanTarget(h.deps)
    assert.equal(h.reports.find(r => r.step.key === 'stop').raw.signal.errorCode, 'err_network_offline')
    h = harness(M, 'nhatot', { [B.nhatotList]: () => ({ __error: 'Cannot read properties of undefined' }) })
    await runWebScanTarget(h.deps)
    const stop = h.reports.find(r => r.step.key === 'stop')
    assert.equal(stop.raw.signal.errorCode, 'err_undefined')
    assert.equal(stop.step.actionCode, '')
  })

  await check('tạm dừng giữa từ khoá (RUN01): dừng sau lần bấm đang chạy, từ khoá về hàng đợi', async () => {
    const h = harness(M, 'nhatot', {
      [B.nhatotList]: ({ page }) => ({ items: nhatotItems(page, 10), hasMore: true }),
      [B.nhatotReveal]: ({ link }) => ({ phone: phoneOf(link), clicked: true })
    }, { stopAfterReports: 2 })
    await runWebScanTarget(h.deps)
    assert.equal(h.calls.filter(c => c.name === B.nhatotReveal).length, 2)
    assert.equal(h.reports.find(r => r.step.key === 'stop').raw.signal.errorCode, 'err_engine_cancelled')
  })

  await check('batdongsan: ghi trang kết quả của ô tìm (🔎), mục không hiểu từ khoá thì bỏ; hộp đăng nhập → WB02', async () => {
    const h = harness(M, 'batdongsan', {
      [B.batdongsanSearch]: ({ section }) => section === 'sale'
        ? { url: 'https://batdongsan.com.vn/nha-dat-ban-quan-7', title: 'Bán nhà đất tại Quận 7', total: 1200, resolved: true }
        : { url: 'https://batdongsan.com.vn/nha-dat-cho-thue', resolved: false },
      [B.batdongsanList]: () => ({ items: [1, 2, 3].map(i => ({ listingKey: 'p' + i, link: 'https://batdongsan.com.vn/x-pr' + i, name: 'A' + i,
        hasPhoneButton: true, fields: { title: 'Tin ' + i } })), hasMore: true }),
      [B.batdongsanReveal]: ({ listingKey }) => listingKey === 'p2' ? { loginRequired: true, clicked: true } : { phone: '0901234567', clicked: true }
    })
    await runWebScanTarget(h.deps)
    assert.ok(h.progress.some(p => p.text === '🔎 "nhà quận 7" (bán): Batdongsan mở trang "Bán nhà đất tại Quận 7" (1200 tin)'))
    assert.equal(h.reports.find(r => r.step.key === 'stop').raw.signal.errorCode, 'err_web_scan_batdongsan_login')
    assert.equal(h.reports.filter(r => r.step.actionCode === 'web_batdongsan_phone' && r.raw.ok).length, 1)
  })

  await check('batdongsan mở trang tin: bấm hết trang rồi mới mở từng tin, data đi trong dòng "Tìm data" của trang', async () => {
    const h = harness(M, 'batdongsan', {
      [B.batdongsanSearch]: ({ section }) => section === 'sale' ? { url: 'https://batdongsan.com.vn/nha-dat-ban-quan-7', title: 'Q7', resolved: true } : { resolved: false },
      [B.batdongsanList]: () => ({ items: [1, 2].map(i => ({ listingKey: 'q' + i, link: 'https://batdongsan.com.vn/y-pr' + i, name: 'B', hasPhoneButton: true,
        fields: { title: 'T' + i } })), hasMore: false }),
      [B.batdongsanReveal]: ({ listingKey }) => ({ phone: listingKey === 'q1' ? '0911000001' : '0911000002', clicked: true }),
      [B.batdongsanDetail]: ({ link }) => ({ fields: { address: 'Địa chỉ ' + link.slice(-1) } })
    }, { settings: { openDetail: true, fields: ['title', 'address'] } })
    await runWebScanTarget(h.deps)
    const order = h.calls.map(c => c.name)
    assert.deepEqual(order.slice(0, 6), [B.batdongsanSearch, B.batdongsanList, B.batdongsanReveal, B.batdongsanReveal, B.batdongsanDetail, B.batdongsanDetail])
    const pageRow = h.reports.find(r => r.step.key.startsWith('page:'))
    assert.equal(pageRow.step.actionName, 'Tìm data')
    assert.deepEqual(pageRow.raw.data.webRecords.map(r => r.fields.address), ['Địa chỉ 1', 'Địa chỉ 2'])
    assert.ok(h.reports.filter(r => r.step.actionCode === 'web_batdongsan_phone').every(r => r.raw.data.webRecords === undefined))
  })

  await check('Trang Vàng: từ khoá × tỉnh, mỗi trang danh sách một lượt; chỉ số di động, mỗi số một data; dừng ở số data tối đa', async () => {
    const h = harness(M, 'yellowpages', {
      [B.yellowpagesList]: ({ url, page }) => ({ title: 'Bao bì nhựa', hasMore: true, items: [1, 2, 3].map(i => ({
        listingKey: `${url.length}-${page}-${i}`, link: `https://www.yellowpages.vn/lgs/${page}${i}/x.html`, name: 'DN ' + i,
        phones: ['02838123456', phoneOf(`${url}-${page}-${i}`)], mobiles: [phoneOf(`${url}-${page}-${i}`)], fields: { email: 'a@b.vn', address: 'HCM' } })) })
    }, { keyword: 'bao bì nhựa', settings: { provinces: ['TP. Hồ Chí Minh (TPHCM)', 'Hà Nội'], pagesPerSearch: 2, maxDataPerRun: 8 } })
    await runWebScanTarget(h.deps)
    const lists = h.calls.filter(c => c.name === B.yellowpagesList)
    assert.equal(lists[0].input.url, shared.yellowPagesSearchUrl('bao bì nhựa', 'TP. Hồ Chí Minh (TPHCM)'))
    assert.ok(lists.some(c => c.input.url === shared.yellowPagesSearchUrl('bao bì nhựa', 'Hà Nội')))
    const uses = h.reports.filter(r => r.step.actionCode === 'web_yellowpages_page')
    assert.equal(uses.length, lists.length)
    const find = h.reports.find(r => r.step.key === 'find')
    assert.equal(find.raw.data.webScan.found, 8)
    assert.equal(find.raw.data.webScan.stopReason, 'max_data')
    const all = uses.flatMap(u => u.raw.data.webRecords || [])
    assert.ok(all.every(r => /^09/.test(r.phone) && r.email === 'a@b.vn' && r.fields.industry === 'bao bì nhựa'))
  })

  await check('Trang Vàng: data là link ngành khách dán thì quét đúng link đó', async () => {
    const link = 'https://www.yellowpages.vn/cls/123/bao-bi.html'
    const h = harness(M, 'yellowpages', { [B.yellowpagesList]: () => ({ items: [], empty: true, title: 'Bao bì' }) }, { keyword: link })
    await runWebScanTarget(h.deps)
    assert.equal(h.calls[0].input.url, link)
  })

  await check('nghỉ giữa hai lần: kẹt mức thấp nhất, mặc định theo DB khi chiến dịch chưa đặt', async () => {
    const limits = shared.WEB_SCAN_DEFAULT_LIMITS
    assert.equal(M.runner.webScanSleepSeconds({ extraSettings: {} }, limits), 15)
    assert.equal(M.runner.webScanSleepSeconds({ extraSettings: { actionLimits: { sleepBetweenActions: 3 } } }, limits), 10)
    assert.equal(M.runner.webScanSleepSeconds({ extraSettings: { actionLimits: { sleepBetweenActions: 40 } } }, limits), 40)
  })

  console.log(`\n${pass} PASS, ${fail} FAIL`)
  if (fail > 0) process.exit(1)
}
main().catch(error => { console.error(error); process.exit(1) })
