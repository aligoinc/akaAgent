// Smoke test phần Desktop của chặn danh sách Zalo quét bằng tài khoản khác (DAT04, V679; docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md):
// - src/shared/campaignUidAccountGuard.ts trùng từng byte bản gốc WebApp (đặt WEBAPP_REPO để so),
// - dịch vụ tiến trình chính (campaignUidAccountGuardService): chia lượt UID, gộp kết quả, kênh IPC, một câu chung khi chặn
//   (không tên, không số, không có cách bỏ người sai), đổi tài khoản / Tiếp tục / Thêm data, không kiểm được thì cho lưu.
// Chạy: node scripts/zalo-uid-account-guard/desktop-guard-smoke.cjs   (WEBAPP_REPO=../akaAgentWebApp để so md5)
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const root = resolve(__dirname, '../..')
let passed = 0
const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

async function main() {
  const shared = readFileSync(join(root, 'src/shared/campaignUidAccountGuard.ts'))
  const webapp = process.env.WEBAPP_REPO ? join(resolve(process.env.WEBAPP_REPO), 'packages/control-api/src/campaignUidAccountGuard.ts') : null
  if (webapp && existsSync(webapp)) {
    const md5 = buf => createHash('md5').update(buf).digest('hex')
    assert.equal(md5(shared), md5(readFileSync(webapp)), 'src/shared/campaignUidAccountGuard.ts phải chép nguyên văn từ WebApp')
    ok('hợp đồng dùng chung trùng bản WebApp')
  }

  const dir = mkdtempSync(join(tmpdir(), 'uid-guard-desktop-'))
  const outfile = join(dir, 'bundle.cjs')
  try {
    await build({
      stdin: { contents: `export * from './src/main/services/campaignUidAccountGuardService';`, resolveDir: root },
      outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning',
      plugins: [{ name: 'fakes', setup(plugin) {
        plugin.onResolve({ filter: /data\/supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'fake' }))
        plugin.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: 'export const getSupabaseClient = () => { throw new Error("không dùng DB thật") }', loader: 'js' }))
      } }],
    })
    const mod = require(outfile)

    // DB giả: luật V679 rút gọn (UID của tài khoản = gửi được; của tài khoản khác cùng tổ chức = chặn; không ở đâu = không rõ).
    const owned = new Map([[11, new Set(['a', 'b'])], [15, new Set(['c', 'd', 'e'])], [12, new Set(['b'])]])
    const names = { 11: 'thế zus', 12: 'Minh Anh 3.10', 15: 'van khanh 1' }
    const calls = []
    let mode = 'ok'
    let enabled = true
    const pending = new Map([[61799, { rows: ['c', 'd', 'a'], account: 11 }]])
    const classify = (accountId, uids) => {
      const own = uids.filter(uid => owned.get(accountId)?.has(uid))
      const blocked = uids.filter(uid => !owned.get(accountId)?.has(uid) && [...owned].some(([id, set]) => id !== accountId && set.has(uid)))
      const owners = new Map()
      for (const uid of blocked) for (const [id, set] of owned) if (id !== accountId && set.has(uid)) {
        const item = owners.get(id) || { accountId: id, accountName: names[id], count: 0, usable: true }
        item.count += 1
        owners.set(id, item)
      }
      return { accountId, accountName: names[accountId], total: uids.length, own: own.length, blocked: blocked.length,
        unknown: uids.length - own.length - blocked.length, blockedUids: blocked, owners: [...owners.values()].sort((x, y) => y.count - x.count) }
    }
    mod.setUidAccountGuardRpcForTest(async payload => {
      calls.push(payload)
      if (mode === 'missing') throw Object.assign(new Error('Could not find the function'), { code: 'PGRST202' })
      if (mode === 'timeout') throw Object.assign(new Error('canceling statement'), { code: '57014' })
      if (payload.mode === 'uids') {
        assert.ok(payload.uids.length <= 2000, 'mỗi lượt tối đa 2.000 UID')
        return { ok: true, enabled, checked: payload.uids.length, accounts: payload.accountIds.map(id => classify(id, payload.uids)) }
      }
      if (payload.mode === 'campaign') {
        const campaign = pending.get(payload.campaignId)
        const account = payload.accountId ?? campaign.account
        const result = classify(account, [...new Set(campaign.rows)])
        return { ok: true, enabled, applies: true, campaignId: payload.campaignId, currentAccountId: campaign.account,
          checkedRows: campaign.rows.length, truncated: false, account: result, blockedRows: campaign.rows.filter(uid => result.blockedUids.includes(uid)).length }
      }
      if (payload.mode === 'hold') return { ok: true, held: 2 }
      throw new Error('mode lạ')
    })

    const MESSAGE = 'Danh sách người nhận được quét bằng tài khoản Zalo khác nên tài khoản đang chọn không gửi được. Hãy chọn đúng tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này.'
    const blockedResult = { ok: true, data: { blocked: true, message: MESSAGE } }
    const allowedResult = { ok: true, data: { blocked: false, message: null } }

    // 1. Theo danh sách: chuẩn hoá + bỏ trùng, chặn bằng câu chung.
    let result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['c', 'd ', 'd_0', null] })
    assert.deepEqual(result, blockedResult)
    assert.deepEqual(calls.at(-1), { mode: 'uids', accountIds: [11], uids: ['c', 'd'] })
    ok('cả danh sách của tài khoản khác: chặn, câu chung')

    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['a', 'b', 'c', 'zz'] })
    assert.deepEqual(result, blockedResult)
    ok('danh sách lẫn: cũng chặn cả lần lưu')

    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['a', 'zz'] })
    assert.deepEqual(result, allowedResult)
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_phone', accountIds: [11], uids: ['c'] })
    assert.deepEqual(result, allowedResult)
    ok('gửi được / không rõ / loại chiến dịch khác: cho lưu')

    // 2. Chia lượt 2.000.
    calls.length = 0
    const many = Array.from({ length: 4500 }, (_, i) => `u${i}`).concat(['c'])
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_friend', accountIds: [11], uids: many })
    assert.deepEqual(calls.map(call => call.uids.length), [2000, 2000, 501])
    assert.deepEqual(result, blockedResult)
    ok('chia lượt 2.000 UID, một người sai ở lượt cuối vẫn chặn')

    // 3. Chia người nhận cho từng tài khoản (assignments) và nhiều tài khoản chung danh sách.
    calls.length = 0
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member',
      assignments: [{ accountId: 11, uids: ['a'] }, { accountId: 12, uids: ['c'] }] })
    assert.deepEqual(calls.map(call => call.accountIds), [[11], [12]])
    assert.deepEqual(result, blockedResult)
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11, 12], uids: ['c', 'd'] })
    assert.deepEqual(result, blockedResult)
    ok('chia cho từng tài khoản / nhiều tài khoản chung một danh sách')

    // 4. Không kiểm được: cho lưu.
    for (const failure of ['missing', 'timeout']) {
      mode = failure
      result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['c'] })
      assert.deepEqual(result, allowedResult)
      await mod.guardAppendRows({ id: 61799, actionId: 'zalo_message_group_member', accountId: 11 }, [{ uid: 'c' }])
    }
    mode = 'ok'
    enabled = false
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['c'] })
    assert.deepEqual(result, allowedResult)
    enabled = true
    ok('DB chưa có hàm / hết giờ / công tắc tắt: cho lưu')

    // 5. Đổi tài khoản khi sửa (handler DB_UPDATE_CAMPAIGN).
    const campaign = { id: 61799, actionId: 'zalo_message_group_member', accountId: 15, dataTargetSourceMode: 'direct', status: 'tạm dừng' }
    const blockedError = err => err.name === 'UidAccountGuardBlockedError' && err.message === MESSAGE
    pending.set(61799, { rows: ['c', 'd', 'a'], account: 15 })
    await assert.rejects(mod.guardAccountChange(campaign, 11), blockedError)
    calls.length = 0
    await mod.guardAccountChange(campaign, 15)
    await mod.guardAccountChange({ ...campaign, dataTargetSourceMode: 'data_group' }, 11)
    assert.equal(calls.length, 0)
    pending.set(61799, { rows: ['a', 'b'], account: 15 })
    await mod.guardAccountChange(campaign, 11)
    assert.equal(calls.some(call => call.mode === 'hold'), false)
    ok('đổi tài khoản: có người sai thì chặn; không đổi / Nhóm data không kiểm; đúng tài khoản thì lưu')

    // 6. Tiếp tục.
    pending.set(61799, { rows: ['c', 'd', 'a'], account: 11 })
    const paused = { ...campaign, accountId: 11 }
    await assert.rejects(mod.guardResume(paused), blockedError)
    calls.length = 0
    await mod.guardResume({ ...paused, status: 'chờ xử lý' })
    assert.equal(calls.length, 0)
    result = await mod.handleUidAccountGuardIpc({ action: 'check-resume', campaignId: 61799 })
    assert.deepEqual(result, blockedResult)
    ok('Tiếp tục: chặn; chiến dịch đang chờ không kiểm')

    // 7. Thêm data.
    const target = { id: 61799, actionId: 'zalo_message_friend', accountId: 11 }
    await assert.rejects(mod.guardAppendRows(target, [{ uid: 'a' }, { uid: 'c' }]), blockedError)
    await mod.guardAppendRows(target, [{ uid: 'a' }, { uid: 'zz' }])
    ok('Thêm data: có người sai thì chặn, toàn người đúng thì cho thêm')

    // 8. Yêu cầu sai khuôn / hành động đã bỏ không ném lỗi.
    assert.equal((await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_friend', accountIds: [], uids: [] })).ok, false)
    assert.equal((await mod.handleUidAccountGuardIpc(null)).ok, false)
    assert.equal((await mod.handleUidAccountGuardIpc({ action: 'allow-skip', campaignId: 61799 })).ok, false)
    assert.equal(typeof mod.allowSkipOnce, 'undefined')
    ok('yêu cầu sai khuôn trả lỗi, không ném; không còn đường bỏ người sai')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} PASS`)
}

main().catch(error => { console.error(error); process.exit(1) })
