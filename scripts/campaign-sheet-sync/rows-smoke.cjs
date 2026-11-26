#!/usr/bin/env node
// Bài kiểm bộ chuẩn hoá dòng Google Sheet cho đồng bộ chiến dịch (V662) và hợp đồng dùng chung.
// Chạy: node scripts/campaign-sheet-sync/rows-smoke.cjs
'use strict'
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const ROOT = path.resolve(__dirname, '../..')

function load(entry) {
  const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}
const contract = load('src/shared/campaignSheetSync.ts')
const rows = load('src/shared/campaignSheetSyncRows.ts')
const verify = load('src/shared/campaignImportVerification.ts')
let passed = 0
const ok = (label, fn) => { fn(); passed++; console.log('PASS', label) }

const csv = [
  ['SĐT', 'Tên', 'Ghi chú'],
  ['0912345678', 'An', 'vip'],
  ['912 345 679', 'Bình', ''],
  ['0912345678', 'Trùng', ''],
  ['abc', 'Lỗi', ''],
  ['0912345680, 0912345681', 'Hai số', ''],
  ['', '', ''],
  ['+84 912 345 682', 'Cường', 'x']
]
const table = rows.campaignSheetTable(csv)
const link = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit?usp=sharing#gid=123'
const mapping = { phone: 0, name: 1, info1: 2 }
const config = rows.buildCampaignSheetSyncConfig({ link, table, mapping, skipHeader: true, phonePolicy: 'first', platform: 'zalo', actionId: 'zalo_message_phone' })

ok('cấu hình: link chuẩn giữ gid, tiêu đề, cột', () => {
  assert.equal(config.url, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit#gid=123')
  assert.deepEqual(config.expectedHeaders, ['SĐT', 'Tên', 'Ghi chú'])
  assert.equal(config.columnCount, 3)
  assert.equal(config.targetField, 'phone')
})
ok('link không phải Google Sheet thì không đồng bộ', () => {
  assert.equal(rows.buildCampaignSheetSyncConfig({ link: 'https://example.com/x.csv', table, mapping, skipHeader: true, phonePolicy: 'first', platform: 'zalo', actionId: 'zalo_message_phone' }), null)
  assert.equal(contract.canonicalCampaignSheetUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit'), 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit')
  assert.equal(contract.canonicalCampaignSheetUrl('http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit'), null)
})
ok('lượt đồng bộ ra đúng dòng hợp lệ như cửa sổ Upload', () => {
  const upload = verify.verifyImportRows(verify.mapImportTable(table, mapping, 1, 'Link sheet'), { platform: 'zalo', actionId: 'zalo_message_phone', kind: 'sheet', phonePolicy: 'first' })
  const synced = rows.campaignSheetSyncRows(table, config, 'zalo_message_phone')
  assert.deepEqual(synced.rows.map(r => r.phone), upload.valid.map(e => e.normalizedValue))
  assert.deepEqual(synced.rows.map(r => r.phone), ['0912345678', '0912345679', '0912345680', '0912345682'])
  assert.equal(synced.invalid, upload.rejected.length)
  assert.equal(synced.duplicates, upload.duplicates.length)
  assert.equal(synced.rows[0].name, 'An'); assert.equal(synced.rows[0].info1, 'vip')
  assert.ok(synced.rows[0].phoneCarrier)
})
ok('mốc ban đầu = giá trị hợp lệ đã đọc', () => {
  const upload = verify.verifyImportRows(verify.mapImportTable(table, mapping, 1, 'Link sheet'), { platform: 'zalo', actionId: 'zalo_message_phone', kind: 'sheet', phonePolicy: 'first' })
  assert.deepEqual(rows.campaignSheetSyncValues(upload), ['0912345678', '0912345679', '0912345680', '0912345682'])
})
ok('chính sách "lấy tất cả SĐT"', () => {
  const synced = rows.campaignSheetSyncRows(table, { ...config, phonePolicy: 'all' }, 'zalo_message_phone')
  assert.ok(synced.rows.some(r => r.phone === '0912345681'))
})
ok('cột đổi thì dừng (lỗi vĩnh viễn)', () => {
  const changed = rows.campaignSheetTable([['Tên', 'SĐT', 'Ghi chú'], ['An', '0912345678', '']])
  assert.throws(() => rows.campaignSheetSyncRows(changed, config, 'zalo_message_phone'), e => e.code === 'sheet_columns_changed' && e.permanent)
})
ok('thêm cột mới ở cuối không làm dừng', () => {
  const more = rows.campaignSheetTable([['SĐT', 'Tên', 'Ghi chú', 'Mới'], ['0912345678', 'An', '', 'z']])
  assert.equal(rows.campaignSheetSyncRows(more, config, 'zalo_message_phone').rows.length, 1)
})
ok('không có dòng tiêu đề: đọc từ dòng đầu', () => {
  const plain = rows.campaignSheetTable([['0912345678', 'An'], ['0912345679', 'Bình']])
  const cfg = rows.buildCampaignSheetSyncConfig({ link, table: plain, mapping: { phone: 0, name: 1 }, skipHeader: false, phonePolicy: 'first', platform: 'zalo', actionId: 'zalo_message_phone' })
  assert.deepEqual(cfg.expectedHeaders, [])
  assert.equal(rows.campaignSheetSyncRows(plain, cfg, 'zalo_message_phone').rows.length, 2)
})
ok('UID Zalo / link nhóm / email theo đúng loại chiến dịch', () => {
  const t = rows.campaignSheetTable([['Link'], ['https://zalo.me/g/abcXYZ'], ['zalo.me/g/abcXYZ'], ['khong']])
  const cfg = rows.buildCampaignSheetSyncConfig({ link, table: t, mapping: { uid: 0 }, skipHeader: true, phonePolicy: 'first', platform: 'zalo', actionId: 'zalo_join_group_link' })
  const r = rows.campaignSheetSyncRows(t, cfg, 'zalo_join_group_link')
  assert.deepEqual(r.rows.map(x => x.uid), ['https://zalo.me/g/abcXYZ']); assert.equal(r.duplicates, 1); assert.equal(r.invalid, 1)
  const e = rows.campaignSheetTable([['Email'], ['A@X.vn'], ['bad']])
  const ecfg = rows.buildCampaignSheetSyncConfig({ link, table: e, mapping: { email: 0 }, skipHeader: true, phonePolicy: 'first', platform: 'email', actionId: 'email_send' })
  assert.deepEqual(rows.campaignSheetSyncRows(e, ecfg, 'email_send').rows.map(x => x.email), ['a@x.vn'])
})
ok('quá 10.000 dòng thì dừng', () => {
  const big = rows.campaignSheetTable([['SĐT'], ...Array.from({ length: 10_002 }, (_, i) => ['09' + String(i).padStart(8, '0')])])
  const cfg = rows.buildCampaignSheetSyncConfig({ link, table: big, mapping: { phone: 0 }, skipHeader: true, phonePolicy: 'first', platform: 'zalo', actionId: 'zalo_message_phone' })
  assert.throws(() => rows.campaignSheetSyncRows(big, cfg, 'zalo_message_phone'), e => e.code === 'sheet_too_large')
})
ok('ngày dừng: mặc định +30, tối đa +365, không quá ngày kết thúc chiến dịch', () => {
  const now = new Date('2026-11-26T20:00:00Z') // 27/11 theo giờ Việt Nam
  const d = contract.campaignSheetSyncEndDates(now)
  assert.deepEqual(d, { minDate: '2026-11-27', defaultDate: '2026-12-27', maxDate: '2027-11-27' })
  assert.equal(contract.campaignSheetSyncEndDates(now, '2026-12-10T16:59:59Z').defaultDate, '2026-12-10')
  assert.equal(contract.validateCampaignSheetSyncSchedule(6, '2027-11-27', now), null)
  assert.match(contract.validateCampaignSheetSyncSchedule(6, '2027-11-28', now), /365/)
  assert.match(contract.validateCampaignSheetSyncSchedule(25, '2026-12-27', now), /24 giờ/)
  assert.match(contract.validateCampaignSheetSyncSchedule(6, '2026-11-26', now), /đã qua/)
})
ok('loại chiến dịch: SMS chưa hỗ trợ, đúng danh sách DB', () => {
  assert.equal(contract.supportsCampaignSheetSync('zalo_message_phone'), true)
  assert.equal(contract.supportsCampaignSheetSync('sms_send'), false)
  const fs = require('node:fs')
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/migration_v662_campaign_sheet_sync.sql'), 'utf8')
  const list = sql.match(/aka_agent_campaign_sheet_action_allowed[\s\S]*?ARRAY\[([\s\S]*?)\]/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1))
  assert.deepEqual([...list].sort(), [...contract.CAMPAIGN_SHEET_SYNC_ACTIONS].sort())
})
ok('mã lỗi RPC → câu tiếng Việt', () => {
  assert.equal(contract.campaignSheetSyncErrorCode('ERROR: sheet_sync_campaign_taken'), 'sheet_sync_campaign_taken')
  assert.match(contract.campaignSheetSyncErrorMessage('sheet_sync_limit', '20'), /20 nguồn/)
})
ok('bản đóng gói Edge khớp mã nguồn', () => {
  const r = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'build-edge-core.cjs'), '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
console.log(`\n${passed} PASS`)
