// Lõi engine v2: các chỗ sửa để Fly ra cùng kết quả với Desktop (12/11/2026, rà mọi lệnh zalo_runtime). Không DB, không mạng.
//   1. Đọc hồ sơ bị treo: cổng có hạn riêng (runtime Fly) báo DeadlineError, lõi ném tiếp như hạn bước của Desktop (data về hàng đợi);
//      lỗi đọc hồ sơ khác vẫn giữ mục tiêu từ data như cả hai bộ chạy cũ.
//   2. Zalo trả mã mà câu rỗng: câu "Lỗi Zalo chưa xác định", không lấy tên lớp lỗi "ZcaApiError" (chữ kỹ thuật) như Desktop trước đây.
// Chạy: node scripts/campaign-engine-fly-parity-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-parity-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

async function main() {
  const E = await loadEngine()
  const ctx = (target) => ({ targetRunId: 1, leaseToken: 'l', target, state: {}, signal: new AbortController().signal, gate: undefined,
    gateSettings: {}, progress: () => undefined })
  const portWith = (getUserProfile) => ({
    getUserProfile, findUser: async () => null, phoneSearchLimitScope: async () => null, saveFoundUser: async () => {},
    saveResolvedProfile: async () => {}, isOptedOut: async () => false, takeContentIndex: async () => 0, businessNow: async () => new Date(),
    sendText: async () => ({ response: {}, msgId: null }), prepareMedia: async () => [], sendMedia: async () => ({ response: {}, msgId: null }),
    sendFriendRequest: async () => ({}), friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }),
    mirrorLabel: async () => {}, changeAlias: async () => '', applyAkaBizTags: async () => 1,
    addGroupMember: async () => ({ groupId: '1', mode: 'direct_add', outcome: 'added', message: 'Đã thêm thành viên vào group' })
  })
  const timeout = () => { throw new E.DeadlineError('get_user_profile', 90000) }
  const zaloFailed = () => { throw E.zaloPortErrorFrom(Object.assign(new Error('Không tìm thấy'), { code: -1 }), { operation: 'read', answered: true }) }

  // ---- 1. Đọc hồ sơ bị treo: ném tiếp như hạn bước của Desktop -------------------------------------------------------------
  const stranger = { id: 1, actionId: 'zalo_message_friend', accountId: 1, content: 'Chào', extraSettings: {}, images: [] }
  const resolveOf = (campaign, port, build) => build(campaign, port).find(step => step.key === 'resolve')
  const target = { id: 11, campaign_id: 1, name: 'Khách', phone: null, uid: '123', email: null }
  const slow = resolveOf(stranger, portWith(async () => timeout()), (c, p) => E.buildZaloMessagePhoneSteps(c, p))
  await assert.rejects(slow.run(ctx(target)), E.DeadlineError)
  const runnerOutcome = E.stepFailure(new E.DeadlineError('get_user_profile', 90000), slow.delivery)
  assert.deepEqual([runnerOutcome.phase, runnerOutcome.signal.kind], ['before_send', 'timeout'], 'lõi đổi thành quá giờ trước khi gửi (NET01)')
  const failed = resolveOf(stranger, portWith(async () => zaloFailed()), (c, p) => E.buildZaloMessagePhoneSteps(c, p))
  const kept = await failed.run(ctx(target))
  assert.equal(kept.ok, true, 'lỗi đọc hồ sơ khác: giữ mục tiêu từ data như trước')
  assert.equal(kept.state.zaloTarget.uid, '123')
  const member = { id: 2, actionId: 'zalo_add_group_member', accountId: 1, content: '', extraSettings: { zaloAddGroupMemberTargetGroupId: '55' }, images: [] }
  const slowMember = resolveOf(member, portWith(async () => timeout()), (c, p) => E.buildZaloAddGroupMemberSteps(c, p))
  await assert.rejects(slowMember.run(ctx(target)), E.DeadlineError)
  const failedMember = resolveOf(member, portWith(async () => zaloFailed()), (c, p) => E.buildZaloAddGroupMemberSteps(c, p))
  assert.equal((await failedMember.run(ctx(target))).ok, true)
  pass('đọc hồ sơ treo (DeadlineError của cổng): bước nhắn theo UID và thêm thành viên ném tiếp, lõi báo quá giờ trước khi gửi như hạn bước của Desktop; lỗi đọc khác vẫn giữ mục tiêu từ data')

  // ---- 2. Câu lỗi khi Zalo trả mã mà câu rỗng ------------------------------------------------------------------------------
  const zcaEmpty = (code) => Object.assign(new Error(''), { name: 'ZcaApiError', ...(code === undefined ? {} : { code }) })
  const coded = E.zaloPortErrorFrom(zcaEmpty(112), { operation: 'send', answered: true })
  assert.deepEqual([coded.message, coded.signal], ['Lỗi Zalo chưa xác định', { kind: 'zalo_code', code: '112', message: 'Lỗi Zalo chưa xác định' }])
  const plain = E.zaloPortErrorFrom(zcaEmpty(), { operation: 'send', answered: true })
  assert.deepEqual([plain.message, plain.signal, plain.phase], ['Lỗi Zalo chưa xác định', { kind: 'message_like', message: 'Lỗi Zalo chưa xác định' }, 'after_send'])
  assert.equal(E.classifyZaloError(zcaEmpty(), 'read', false).signal.message, 'Lỗi Zalo chưa xác định')
  // Câu có nội dung giữ nguyên.
  assert.equal(E.zaloPortErrorFrom(Object.assign(new Error('Người nhận chặn'), { code: 122 }), { operation: 'send', answered: true }).message, 'Người nhận chặn')
  pass('Zalo trả mã mà câu rỗng: "Lỗi Zalo chưa xác định" (không lấy tên lớp lỗi ZcaApiError), câu có nội dung giữ nguyên')

  console.log(`OK lõi Fly như Desktop: ${checks} nhóm kiểm`)
}

main().catch(error => { console.error(error); process.exit(1) })
