// Smoke test phần Desktop của chặn danh sách Zalo quét bằng tài khoản khác (DAT04, V679; docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md):
// - src/shared/campaignUidAccountGuard.ts trùng từng byte bản gốc WebApp (đặt WEBAPP_REPO để so),
// - dịch vụ tiến trình chính (campaignUidAccountGuardService): chia lượt UID, gộp kết quả, kênh IPC, "Bỏ N người này" dùng một lần,
//   đổi tài khoản / Tiếp tục / Thêm data, không kiểm được thì cho lưu.
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

    // 1. Theo danh sách: chuẩn hoá + bỏ trùng, chặn, câu đúng.
    let result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['c', 'd ', 'd_0', null] })
    assert.equal(result.ok, true)
    assert.equal(result.data.verdict.kind, 'all')
    assert.equal(result.data.verdict.message, 'Danh sách 2 người nhận được quét bằng tài khoản Zalo "van khanh 1". Zalo cấp cho mỗi tài khoản một mã riêng của từng người, nên chỉ tài khoản đã quét danh sách mới gửi được.')
    assert.deepEqual(calls.at(-1), { mode: 'uids', accountIds: [11], uids: ['c', 'd'] })
    assert.equal(result.data.verdict.suggestedAccountId, 15)
    ok('cả danh sách của tài khoản khác: chặn, gợi ý tài khoản đã quét')

    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['a', 'b', 'c', 'zz'] })
    assert.equal(result.data.verdict.kind, 'partial')
    assert.deepEqual(result.data.blockedUids, ['c'])
    ok('danh sách lẫn: chặn, cho "Bỏ N người này", trả UID cần bỏ')

    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['a', 'zz'] })
    assert.equal(result.data.verdict, null)
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_phone', accountIds: [11], uids: ['c'] })
    assert.equal(result.data.verdict, null)
    ok('gửi được / không rõ / loại chiến dịch khác: cho lưu')

    // 2. Chia lượt 2.000 + gộp.
    calls.length = 0
    const many = Array.from({ length: 4500 }, (_, i) => `u${i}`).concat(['c'])
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_friend', accountIds: [11], uids: many })
    assert.deepEqual(calls.map(call => call.uids.length), [2000, 2000, 501])
    assert.equal(result.data.verdict.blocked, 1)
    assert.equal(result.data.verdict.total, 4501)
    ok('chia lượt 2.000 UID và gộp số')

    // 3. Chia người nhận cho từng tài khoản (assignments) và nhiều tài khoản chung danh sách.
    calls.length = 0
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member',
      assignments: [{ accountId: 11, uids: ['a'] }, { accountId: 12, uids: ['c'] }] })
    assert.deepEqual(calls.map(call => call.accountIds), [[11], [12]])
    assert.equal(result.data.verdict.accountId, 12)
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11, 12], uids: ['c', 'd'] })
    assert.equal(result.data.verdict.kind, 'shared')
    assert.equal(result.data.verdict.title, 'Danh sách này chỉ gửi được bằng tài khoản "van khanh 1".')
    ok('chia cho từng tài khoản / nhiều tài khoản chung một danh sách')

    // 4. Không kiểm được: cho lưu.
    for (const failure of ['missing', 'timeout']) {
      mode = failure
      result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['c'] })
      assert.equal(result.data.verdict, null)
      assert.deepEqual(await mod.guardAppendRows({ id: 61799, actionId: 'zalo_message_group_member', accountId: 11 }, [{ uid: 'c' }]), [{ uid: 'c' }])
    }
    mode = 'ok'
    enabled = false
    result = await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_group_member', accountIds: [11], uids: ['c'] })
    assert.equal(result.data.verdict, null)
    enabled = true
    ok('DB chưa có hàm / hết giờ / công tắc tắt: cho lưu')

    // 5. Đổi tài khoản khi sửa (handler DB_UPDATE_CAMPAIGN).
    const campaign = { id: 61799, actionId: 'zalo_message_group_member', accountId: 15, dataTargetSourceMode: 'direct', status: 'tạm dừng' }
    pending.set(61799, { rows: ['c', 'd', 'a'], account: 15 })
    await assert.rejects(mod.guardAccountChange(campaign, 11), err => err.name === 'UidAccountGuardBlockedError' && err.message.startsWith('Có 2 người tài khoản "thế zus" không gửi được.'))
    mod.allowSkipOnce(61799, 11)
    assert.equal(await mod.guardAccountChange(campaign, 11), true)
    await assert.rejects(mod.guardAccountChange(campaign, 11), /không gửi được/)
    assert.equal(await mod.guardAccountChange(campaign, 15), false)
    assert.equal(await mod.guardAccountChange({ ...campaign, dataTargetSourceMode: 'data_group' }, 11), false)
    pending.set(61799, { rows: ['c', 'd'], account: 15 })
    mod.allowSkipOnce(61799, 11)
    await assert.rejects(mod.guardAccountChange(campaign, 11), /Tài khoản "thế zus" không gửi được cho danh sách này/)
    ok('đổi tài khoản: chặn; "Bỏ N người này" chỉ dùng một lần, không dùng được khi cả danh sách sai; Nhóm data không kiểm')

    // 6. Tiếp tục.
    pending.set(61799, { rows: ['c', 'd', 'a'], account: 11 })
    const paused = { ...campaign, accountId: 11 }
    await assert.rejects(mod.guardResume(paused), err => err.message.startsWith('Chưa chạy tiếp được: 2 người nhận được quét bằng tài khoản Zalo "van khanh 1"'))
    calls.length = 0
    mod.allowSkipOnce(61799)
    await mod.guardResume(paused)
    assert.deepEqual(calls.map(call => call.mode), ['campaign', 'hold'])
    await mod.guardResume({ ...paused, status: 'chờ xử lý' })
    result = await mod.handleUidAccountGuardIpc({ action: 'check-resume', campaignId: 61799 })
    assert.equal(result.data.verdict.kind, 'resume')
    assert.equal(result.data.verdict.canSkip, true)
    ok('Tiếp tục: chặn, "Bỏ N người này" giữ lại rồi cho chạy; chiến dịch đang chờ không kiểm')

    // 7. Thêm data.
    const target = { id: 61799, actionId: 'zalo_message_friend', accountId: 11 }
    await assert.rejects(mod.guardAppendRows(target, [{ uid: 'a' }, { uid: 'c' }]), /Có 1 người tài khoản "thế zus" không gửi được/)
    mod.allowSkipOnce(61799)
    assert.deepEqual(await mod.guardAppendRows(target, [{ uid: 'a' }, { uid: 'c ' }, { uid: 'zz' }]), [{ uid: 'a' }, { uid: 'zz' }])
    ok('Thêm data: chặn, "Bỏ N người này" bỏ đúng người sai')

    // 8. Quyền "Bỏ N người này" hết hạn sau 2 phút; yêu cầu sai khuôn không ném lỗi.
    mod.allowSkipOnce(61799, null, Date.now() - 121_000)
    await assert.rejects(mod.guardAppendRows(target, [{ uid: 'c' }]), /không gửi được/)
    assert.equal((await mod.handleUidAccountGuardIpc({ action: 'check', actionId: 'zalo_message_friend', accountIds: [], uids: [] })).ok, false)
    assert.equal((await mod.handleUidAccountGuardIpc(null)).ok, false)
    assert.equal((await mod.handleUidAccountGuardIpc({ action: 'allow-skip', campaignId: 'x' })).ok, false)
    ok('quyền bỏ qua hết hạn; yêu cầu sai khuôn trả lỗi, không ném')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} PASS`)
}

main().catch(error => { console.error(error); process.exit(1) })
