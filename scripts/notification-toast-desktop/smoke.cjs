#!/usr/bin/env node
/*
 * Thông báo nổi Desktop + bộ đọc cài đặt: chạy mã thật (dựng bằng esbuild) của
 * src/renderer/src/components/Notifications/notificationToastModel.ts và src/shared/notificationCenter.ts.
 * Dùng: node scripts/notification-toast-desktop/smoke.cjs
 */
const path = require('path')
const os = require('os')
const fs = require('fs')
const assert = require('assert/strict')
const esbuild = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-toast-'))
function load(entry) {
  const file = path.join(out, path.basename(entry).replace(/\.ts$/, '.cjs'))
  esbuild.buildSync({ entryPoints: [path.join(ROOT, entry)], bundle: true, platform: 'node', format: 'cjs', outfile: file, logLevel: 'silent' })
  return require(file)
}
const storage = new Map()
global.window = { localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) } }

const model = load('src/renderer/src/components/Notifications/notificationToastModel.ts')
const center = load('src/shared/notificationCenter.ts')
let passed = 0
function ok(name, fn) { fn(); passed += 1; console.log(`ok  - ${name}`) }

const now = Date.parse('2026-11-22T05:01:00Z')
const item = (id, eventType, minutesAgo, readAt = null) => ({
  id, eventType, severity: 'info', title: `T${id}`, body: null, occurredAt: new Date(now - minutesAgo * 60_000).toISOString(),
  createdAt: new Date(now - minutesAgo * 60_000).toISOString(), readAt, emailState: 'none', pushState: 'none',
  campaignId: null, accountId: null, dataGroupId: null, entityKey: ''
})

ok('chọn thông báo mới nhất đáng nổi lên', () => {
  const items = [item(9, 'account.status_changed', 1), item(8, 'report.scheduled', 2), item(7, 'report.morning', 3)]
  assert.equal(model.pickToastNotification(items, null, now).id, 8)
})
ok('bỏ thông báo đã đọc, đã hiện, quá 3 giờ', () => {
  assert.equal(model.pickToastNotification([item(8, 'report.scheduled', 2, '2026-11-22T05:00:00Z')], null, now), null)
  assert.equal(model.pickToastNotification([item(8, 'report.scheduled', 2)], 8, now), null)
  assert.equal(model.pickToastNotification([item(8, 'campaign.status_changed', 181)], null, now), null)
  assert.equal(model.pickToastNotification([item(8, 'campaign.status_changed', 179)], 7, now).id, 8)
})
ok('chỉ kiểm khi số chưa đọc tăng hoặc lần đầu > 0', () => {
  assert.equal(model.shouldCheckForToast(null, 2), true)
  assert.equal(model.shouldCheckForToast(2, 2), false)
  assert.equal(model.shouldCheckForToast(2, 3), true)
  assert.equal(model.shouldCheckForToast(3, 1), false)
  assert.equal(model.shouldCheckForToast(null, 0), false)
  assert.equal(model.shouldCheckForToast(null, null), false)
})
ok('nhãn nút', () => {
  assert.equal(model.toastActionLabel({ eventType: 'campaign.status_changed' }), 'Xem chiến dịch')
  assert.equal(model.toastActionLabel({ eventType: 'report.morning' }), 'Xem báo cáo')
})
ok('hẹn hỏi số chưa đọc ở mốc + 1 và + 5 phút, bỏ mốc đã qua và mốc quá xa', () => {
  const in10 = new Date(now + 10 * 60_000).toISOString()
  const past = new Date(now - 30 * 60_000).toISOString()
  const recent = new Date(now - 2 * 60_000).toISOString() // + 1 phút đã qua, + 5 phút còn 3 phút
  const far = new Date(now + 30 * 60 * 60_000).toISOString()
  assert.deepEqual(model.toastRefreshDelays([in10, past, recent, far, in10, 'x'], now), [180_000, 660_000, 900_000])
  assert.deepEqual(model.toastRefreshDelays(undefined, now), [])
})
ok('chiến dịch vừa chuyển sang hoàn thành', () => {
  const before = new Map([[1, 'đang chạy'], [2, 'hoàn thành'], [3, 'chờ xử lý']])
  assert.deepEqual(model.newlyCompletedCampaignIds(before, [
    { id: 1, status: 'hoàn thành' }, { id: 2, status: 'hoàn thành' }, { id: 3, status: 'đang chạy' }, { id: 4, status: 'hoàn thành' }
  ]), [1])
})
ok('lưu id đã hiện theo phiên', () => {
  assert.equal(model.readLastShownToastId('1:4'), null)
  model.writeLastShownToastId('1:4', 42)
  assert.equal(model.readLastShownToastId('1:4'), 42)
  assert.equal(model.readLastShownToastId('1:5'), null)
})
ok('cài đặt: đọc mốc nextRunAt của mọi đăng ký, kể cả Chào ngày mới', () => {
  const settings = center.parseNotificationSettings({
    revision: 3, channels: { email: { recipients: [] }, push: {} }, devices: [],
    subscriptions: {
      scheduledReport: { enabled: true, times: ['12:00', '18:00'], nextRunAt: '2026-11-22T11:00:00Z' },
      morningReport: { enabled: true, time: '07:00', nextRunAt: '2026-11-23T00:00:00Z' },
      campaignStatus: { enabled: true, nextRunAt: null },
      extra: { nextRunAt: '2026-11-22T11:00:00Z' }
    }
  })
  assert.ok(settings)
  assert.deepEqual(settings.upcomingRunAts, ['2026-11-22T11:00:00Z', '2026-11-23T00:00:00Z'])
})
ok('nhãn loại Chào ngày mới, Trợ lý aka', () => {
  assert.equal(center.notificationEventLabel('report.morning'), 'Chào ngày mới')
  assert.equal(center.notificationEventLabel('assistant.result'), 'Trợ lý aka')
  assert.equal(center.notificationEventLabel('nope'), 'Thông báo')
})
ok('nội dung: giữ display tiles và loại assistant', () => {
  const detail = center.parseNotificationDetail({
    id: 5, eventType: 'report.morning', createdAt: '2026-11-22T00:00:00Z',
    content: { kind: 'report', headline: 'Chào ngày mới', sections: [
      { title: 'Hôm nay', display: 'tiles', rows: [{ label: 'Chiến dịch chạy', value: '4' }] },
      { title: 'Khác', display: 'grid', rows: [] }
    ] }
  })
  assert.equal(detail.content.sections[0].display, 'tiles')
  assert.equal(detail.content.sections[1].display, undefined)
  const assistant = center.parseNotificationDetail({ id: 6, eventType: 'assistant.result', createdAt: '2026-11-22T00:00:00Z', content: { kind: 'assistant', sections: [] } })
  assert.equal(assistant.content.kind, 'assistant')
})
fs.rmSync(out, { recursive: true, force: true })
console.log(`PASS (${passed})`)
