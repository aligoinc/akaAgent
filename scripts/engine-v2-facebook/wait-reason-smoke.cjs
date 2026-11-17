// Câu "Lý do đang chờ" theo kết quả nhận lượt của engine v2 (src/main/engineAdapters/engineWaitReason.ts, R17 / Q21).
// Chạy: node scripts/engine-v2-facebook/wait-reason-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-wait-reason-'))
const outfile = path.join(out, 'm.cjs')
buildSync({ entryPoints: [path.join(ROOT, 'src/main/engineAdapters/engineWaitReason.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error' })
const W = require(outfile)
fs.rmSync(out, { recursive: true, force: true })

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const NOW = Date.parse('2026-11-16T08:00:00Z')
const obs = (reason, claim = null, at = NOW) => ({ accountId: 1, reason, claim, at })
const msg = (o, label = 'Facebook') => W.engineWaitMessage(o, NOW, label)

check('lý do chờ được nhớ; chạy được / hết data thì không', () => {
  for (const r of ['wait', 'busy', 'legacy_busy', 'concurrency_limit', 'account_logged_out', 'error', 'daily_boundary']) assert.equal(W.isEngineWaitingReason(r), true, r)
  for (const r of ['no_target', 'not_due', 'stopped', 'end_unit', 'max_targets', 'not_enabled', 'campaign_paused', null]) assert.equal(W.isEngineWaitingReason(r), false, String(r))
})

check('chờ khoá / hạn mức: dùng câu của DB (bỏ ⏳), hết hạn chờ thì không nói gì', () => {
  const until = new Date(NOW + 20 * 60_000).toISOString()
  assert.equal(msg(obs('wait', { wait: { note: '⏳ Đạt giới hạn 30 lượt Comment trong ngày, chạy tiếp lúc 00:00 17/11 (FB12)', until } })),
    'Đạt giới hạn 30 lượt Comment trong ngày, chạy tiếp lúc 00:00 17/11 (FB12)')
  assert.match(msg(obs('wait', { wait: { until } })), /Chạy tiếp từ \d{2}:\d{2} \d{2}\/11\/2026/)
  assert.equal(msg(obs('wait', { wait: { note: 'x', until: new Date(NOW - 1000).toISOString() } })), null)
})

check('quan sát cũ quá 10 phút thì bỏ', () => {
  assert.equal(msg(obs('legacy_busy', { scope: 'account' }, NOW - W.ENGINE_OBSERVATION_TTL_MS - 1)), null)
  assert.ok(msg(obs('legacy_busy', { scope: 'account' }, NOW - 60_000)))
})

check('lease của lượt khác, token bộ cũ theo tài khoản / chiến dịch', () => {
  assert.match(msg(obs('busy', { runnerId: 'x', expiresAt: new Date(NOW + 90_000).toISOString() })), /chưa kết thúc.*chậm nhất khoảng/)
  assert.match(msg(obs('busy', { runnerId: 'x', expiresAt: new Date(NOW - 1).toISOString() })), /sẽ chạy khi lượt đó xong\.$/)
  assert.match(msg(obs('legacy_busy', { scope: 'campaign' })), /^Một chiến dịch khác của tài khoản/)
  assert.match(msg(obs('legacy_busy', { scope: 'account' })), /^Tài khoản đang có lượt chạy hoặc tác vụ trước/)
})

check('giới hạn số tài khoản chạy cùng lúc theo nền tảng; gói; đăng nhập; tạm dừng', () => {
  assert.equal(msg(obs('concurrency_limit', { max: 3 })), 'Đã đạt giới hạn 3 tài khoản Facebook chạy đồng thời. Đang chờ có chỗ.')
  assert.equal(msg(obs('concurrency_limit', {}), 'Zalo trình duyệt'), 'Đã đạt giới hạn số tài khoản Zalo trình duyệt chạy đồng thời. Đang chờ có chỗ.')
  assert.match(msg(obs('entitlement_denied')), /Gói sử dụng/)
  assert.match(msg(obs('account_logged_out')), /chưa đăng nhập/)
  assert.match(msg(obs('account_paused')), /tạm dừng/)
})

check('giờ dừng trong ngày, sang ngày mới, chống gửi lặp chưa kiểm được, nhóm data, lỗi kết nối', () => {
  assert.equal(msg(obs('daily_boundary', { reason: 'daily_stop_due', stopTime: '21:30:00' })), 'Đã quá giờ dừng gửi 21:30. Chiến dịch không nhận lượt mới trong hôm nay.')
  assert.match(msg(obs('daily_boundary', { reason: 'daily_drain_due' })), /23:59/)
  assert.match(msg(obs('maintenance_required')), /lịch chạy ngày mới/)
  assert.equal(msg(obs('gate_unavailable', { note: 'Không thể kiểm tra giới hạn gửi lặp' })), 'Không thể kiểm tra giới hạn gửi lặp')
  assert.equal(msg(obs('data_group_waiting', {})), 'Đang chờ data mới từ Nhóm data.')
  assert.match(msg(obs('error')), /tự thử lại/)
  assert.equal(msg(obs('something_new')), null)
  assert.equal(msg(null), null)
})

console.log(`\n${passed} nhóm kiểm tra đạt`)
