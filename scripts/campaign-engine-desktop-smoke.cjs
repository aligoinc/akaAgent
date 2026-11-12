// Bộ chạy engine v2 của Desktop (src/main/engineAdapters) chạy thật với RPC V495 trên PG17 cục bộ:
// cổng DB qua Supabase client giả (gọi thẳng hàm SQL), nhật ký SQLite thật (better-sqlite3 của app),
// zaloRuntimeService giả (lỗi Zalo là ZaloApiError như zca-js). Kỳ vọng là hành vi chuẩn của bộ chạy Desktop.
// Chạy: node scripts/campaign-engine-desktop-smoke.cjs   (tự chạy lại dưới Electron để nạp better-sqlite3)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

const { build } = require('esbuild')
const { MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
// Chuỗi production: V495 → V499 → V500 → V501 (Desktop gọi finish_campaign_v2 của V501).
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const V500 = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V495_DESKTOP_TEST_PORT || 55497)
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

const STUBS = {
  'zca-js': `class ZaloApiError extends Error { constructor(message, code) { super(message); this.name = 'ZaloApiError'; this.code = code ?? null } }
    module.exports = { ZaloApiError }`,
  electron: `module.exports = { app: { getPath: () => globalThis.__engineTest.userData } }`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__engineTest.client }`,
  errorPolicyRepository: `module.exports = { getZaloErrorPolicyByCode: (code, action) => globalThis.__engineTest.policy(code, action) }`,
  campaignRepository: `module.exports = {
    checkZaloMessageOptOut: (...a) => globalThis.__engineTest.checkOptOut(...a),
    prepareZaloMessageOptOut: (...a) => globalThis.__engineTest.prepareOptOut(...a),
    updateCampaignInputData: (...a) => globalThis.__engineTest.updateInput(...a) }`,
  zaloCampaignEngagement: `module.exports = {
    campaignEngagementEnabled: () => globalThis.__engineTest.engagement === true,
    beginCampaignEngagementSend: (account, uid) => {
      const calls = globalThis.__engineTest.engagementCalls
      if (globalThis.__engineTest.engagement !== true || account.isZaloShowWeb) return { revision: '', sentAt: '' }
      calls.push('begin:' + uid)
      return { revision: 'rev-1', sentAt: '2026-11-12T12:00:00.000Z', accountZaloUid: account.zaloUid || 'own-desktop', operationId: 'op-' + calls.length }
    },
    abandonCampaignEngagementSend: op => globalThis.__engineTest.engagementCalls.push('abandon:' + op),
    stageCampaignEngagementSource: (source, campaignId, started) => globalThis.__engineTest.engagementCalls.push('stage:' + source.targetZaloUid + ':' + started),
    recordCampaignEngagementDetail: (detailId, source) => globalThis.__engineTest.engagementCalls.push('register:' + detailId + ':' + source.actionType) }`
}

async function loadRunner() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-engine-desktop-'))
  const outfile = path.join(out, 'runner.cjs')
  await build({
    entryPoints: [path.join(ROOT, 'src/main/engineAdapters/desktopEngineRunner.ts')], outfile, bundle: true, platform: 'node',
    format: 'cjs', logLevel: 'warning',
    plugins: [{ name: 'engine-desktop-fixture', setup(plugin) {
      // Bản dựng nằm ngoài repo: trỏ thẳng better-sqlite3 của app (bản dựng cho Electron).
      plugin.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3', { paths: [ROOT] }), external: true }))
      plugin.onResolve({ filter: /^(zca-js|electron)$|(supabaseClient|errorPolicyRepository|campaignRepository|services\/zaloCampaignEngagement)$/ }, args =>
        ({ path: args.path === 'zca-js' || args.path === 'electron' ? args.path : args.path.split('/').pop(), namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: STUBS[args.path], loader: 'js' }))
    } }]
  })
  return { mod: require(outfile), out }
}

async function main() {
  const { mod, out } = await loadRunner()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-engine-desktop-' })
  const db = await connect()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-engine-userdata-'))
  try {
    await buildFixture(db, [])
    for (const sql of [MIGRATION, v499.migration, V500, v501.migration]) await db.query(sql)

    const client = {
      rpc(name, args) {
        const run = (async () => {
          const params = [], parts = []
          for (const [key, value] of Object.entries(args)) {
            const json = value !== null && typeof value === 'object'
            params.push(json ? JSON.stringify(value) : value)
            parts.push(`${key} => $${params.length}${json ? '::jsonb' : ''}`)
          }
          try {
            const r = await db.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
            return { data: r.rows[0].r, error: null, status: 200 }
          } catch (e) {
            return { data: null, error: { message: e.message, code: e.code }, status: 400 }
          }
        })()
        return { abortSignal: () => run }
      }
    }
    const optOutCalls = [], inputUpdates = []
    globalThis.__engineTest = {
      userData, client, engagement: false, engagementCalls: [],
      policy: async (code, action) => (['221', '312'].includes(String(code)) && action === 'zalo_find_phone_user'
        ? { disableActionCodes: ['zalo_find_phone_user'], disableActionMode: 'fixed_minutes', timeDisableActions: 60 } : null),
      checkOptOut: async (campaignId, accountId, identity) => { optOutCalls.push(identity); return { isOptedOut: false, matchedBy: null } },
      prepareOptOut: async (campaignId, accountId, identity) => { optOutCalls.push({ link: identity }); return { id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false } },
      updateInput: async (id, updates) => { inputUpdates.push([id, updates]); await db.query(`UPDATE public.auto_campaign_input_data SET name = coalesce($2, name), uid = $3 WHERE id = $1`, [id, updates.name ?? null, updates.uid]) }
    }
    const { ZaloApiError } = { ZaloApiError: class extends Error { constructor(m, c) { super(m); this.name = 'ZaloApiError'; this.code = c ?? null } } }

    let nextId = 900000
    const makeCampaign = async ({ phones, extra, content, server = false }) => {
      const account = ++nextId, campaign = ++nextId, staff = 8001, org = 650
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org Desktop', false) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo QR', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, $4)`, [account, staff, org, server])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Desktop SĐT', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4, $5, $6::jsonb)`,
        [campaign, account, staff, org, content, JSON.stringify(extra)])
      const ids = {}
      for (const phone of phones) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Data ${phone.slice(-2)}`, phone])
        ids[phone] = id
      }
      return {
        ids,
        account: { id: account, name: 'Zalo QR', flatformType: 'zalo', isZaloServer: server, accountGroupSettings: { sleepBetweenActions: 1 } },
        campaign: { id: campaign, name: 'Desktop SĐT', actionId: 'zalo_message_phone', accountId: account, staffId: staff, content, extraSettings: extra,
          images: [], dataTargetSourceMode: 'direct', note: null }
      }
    }
    const fakeRuntime = behaviors => {
      const sent = []
      return {
        sent,
        findUserByPhoneOnce: async (accountId, phone, reqSrc) => {
          sent.push(`find:${phone}:${reqSrc}`)
          const b = behaviors[phone] || {}
          if (b.find?.[reqSrc]) throw new ZaloApiError(b.find[reqSrc].message, b.find[reqSrc].code)
          if (b.notFound) return null
          return { uid: `uid-${phone}`, displayName: b.name, originalName: b.name, globalId: `g-${phone}`, gender: 0, raw: {} }
        },
        sendMessageToUser: async (accountId, uid, message, attachments, campaignMedia) => {
          assert.deepEqual([attachments, campaignMedia], [[], false])
          sent.push(`text:${uid}:${message}`)
          const b = behaviors[uid.replace('uid-', '')] || {}
          b.onSend?.()
          if (b.delayMs) await new Promise(resolve => setTimeout(resolve, b.delayMs))
          if (b.textError) throw b.textError
          return { message: { msgId: `m-${uid}` }, attachment: [] }
        },
        sendFriendRequestToUser: async (accountId, uid, message) => { sent.push(`friend:${uid}:${message}`); return { ok: 1 } },
        // Loại theo UID / group / thêm thành viên / vào group bằng link (cùng chữ ký zaloRuntimeService).
        getUserProfile: async (accountId, uid) => {
          sent.push(`profile:${uid}`)
          return { uid, displayName: `Hồ sơ ${uid}`, originalName: `Hồ sơ ${uid}`, globalId: `g-${uid}`, gender: 0,
            raw: { userId: uid, displayName: `Hồ sơ ${uid}`, requestedUid: uid, getUserInfoKey: uid } }
        },
        sendMessageToGroup: async (accountId, groupId, message, attachments, campaignMedia) => {
          sent.push(`group:${groupId}:${message}`)
          return { message: { msgId: `m-${groupId}` }, attachment: [] }
        },
        addMemberToGroup: async (accountId, options) => {
          sent.push(`add:${options.groupId}:${options.memberId}:${options.useShareMethod === true}`)
          return { groupId: options.groupId, groupName: 'Nhóm Đích', groupType: 0, memberId: options.memberId, mode: 'direct_add',
            outcome: 'added', message: 'Đã thêm thành viên vào group', response: { errorMembers: [] } }
        },
        joinGroupByLink: async (accountId, link) => {
          sent.push(`join:${link}`)
          return { link, group: { groupId: '555', name: 'Nhóm Link' }, groupId: '555', groupName: 'Nhóm Link', outcome: 'pending_approval',
            zaloCode: '240', zaloMessage: 'Chờ duyệt' }
        }
      }
    }
    const linkedCampaigns = new Set()
    const runWith = async (fixture, behaviors, hostOverrides = {}) => {
      const lines = [], contacts = [], pauses = new Set()
      const runtime = fakeRuntime(behaviors)
      const host = {
        zaloRuntime: () => runtime, staffId: () => 8001, engineEnabled: () => true, zaloRuntimeBlocked: () => false, acceptingWork: () => true,
        logProgress: async (campaign, text) => { lines.push(text) },
        broadcastCampaign: async () => {}, broadcastAccounts: () => {},
        isPauseRequested: id => pauses.has(id),
        completeReleasedPause: async campaign => {
          await db.query(`UPDATE public.auto_campaigns SET status = 'tạm dừng' WHERE id = $1 AND status = 'chờ xử lý'`, [campaign.id])
          pauses.delete(campaign.id); lines.push(`⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`)
        },
        saveContact: async (account, campaign, user) => { contacts.push(user.uid) },
        saveResolvedProfile: async (account, campaign, target) => { contacts.push(`profile:${target.uid}`) },
        saveJoinedGroup: async (account, result, isJoined) => { contacts.push(`group:${result.groupId}:${isJoined}`) },
        businessNow: async () => new Date(),
        findDataSourceWaitNote: async campaign => linkedCampaigns.has(campaign.id) ? 'Đang chờ data từ chiến dịch tìm data' : null,
        noteCampaignWait: async (campaign, note) => {
          await db.query(`UPDATE public.auto_campaigns SET note = $2 WHERE id = $1`, [campaign.id, note])
          lines.push(`⚠️ Chưa thể chạy chiến dịch: ${note}`)
        },
        ...hostOverrides
      }
      const runner = new mod.DesktopEngineRunner(host)
      return { runner, runtime, lines, contacts, pauses, run: () => runner.run(fixture.account, fixture.campaign) }
    }
    const inputRow = id => db.query(`SELECT status, note, name, uid FROM public.auto_campaign_input_data WHERE id = $1`, [id]).then(r => r.rows[0])
    const details = id => db.query(`SELECT action_code, action_name, status, error_code, log FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [id]).then(r => r.rows)
    const extra = { enableMessage: true, enableAddFriend: true, friendRequestMessage: 'Kết bạn nhé #{FULL_NAME}', actionLimits: { sleepBetweenActions: 90 } }

    // D0: chọn bộ mới.
    const f0 = await makeCampaign({ phones: [], extra, content: 'x' })
    const probe = await runWith(f0, {})
    assert.equal(probe.runner.support(f0.account, f0.campaign).ok, true)
    assert.equal(probe.runner.support({ ...f0.account, isZaloServer: true }, f0.campaign).ok, false, 'tài khoản Server không chạy bộ mới trên Desktop')
    assert.equal(probe.runner.support({ ...f0.account, flatformType: 'facebook' }, f0.campaign).ok, false)
    // Theo dõi tương tác bật: cổng Desktop ghi nguồn như bộ cũ nên vẫn chạy bộ mới.
    globalThis.__engineTest.engagement = true
    assert.deepEqual(probe.runner.support(f0.account, f0.campaign), { ok: true })
    globalThis.__engineTest.engagement = false
    pass('Desktop chọn bộ mới chỉ cho tài khoản Zalo QR/Web của máy, theo tính năng chiến dịch; theo dõi tương tác bật vẫn chạy bộ mới')

    // D0b: công tắc theo tổ chức (V513, cờ use_new_zalo_runtime chốt lúc đăng nhập). Cờ tắt thì mọi chiến dịch chạy bộ cũ,
    // kể cả loại đã phủ; scheduler chỉ gọi run() khi support() đạt, nên bộ mới không nhận data nào.
    const off = await runWith(f0, {}, { engineEnabled: () => false })
    assert.deepEqual(off.runner.support(f0.account, f0.campaign), { ok: false, reason: 'org_flag_off' })
    let flag = false
    const toggled = await runWith(f0, {}, { engineEnabled: () => flag })
    assert.equal(toggled.runner.support(f0.account, f0.campaign).ok, false)
    flag = true
    assert.equal(toggled.runner.support(f0.account, f0.campaign).ok, true, 'đăng nhập lại với cờ bật: bộ mới')
    pass('công tắc theo tổ chức: cờ tắt (mặc định, lỗi đọc, DB chưa có V513) thì chạy bộ cũ; cờ bật thì chạy bộ mới cho loại đã phủ')

    // D1: chạy hết danh sách như Desktop; nghỉ theo nhóm tài khoản; lưu danh bạ + tên/UID của data; hoàn thành chiến dịch.
    const f1 = await makeCampaign({ phones: ['0922000001', '0922000002'], extra, content: 'Chào #{FULL_NAME}' })
    const r1 = await runWith(f1, { '0922000001': { name: 'An' }, '0922000002': { notFound: true } })
    const res1 = await r1.run()
    assert.equal(res1.reason, 'no_target', JSON.stringify(res1))
    assert.deepEqual(r1.lines, [
      '🚀 Bắt đầu chiến dịch "Desktop SĐT" trên tài khoản "Zalo QR"',
      '▶️ Xử lý "0922000001" trong chiến dịch "Desktop SĐT"',
      'Tìm SĐT: Đã tìm thấy SĐT 0922000001: An',
      'Nhắn tin người lạ: Đã gửi tin nhắn đến An',
      'Kết bạn: Đã gửi lời mời kết bạn đến An',
      '✅ Hoàn thành "0922000001"',
      '⏳ Nghỉ 1s trước khi xử lý mục tiếp theo...',
      '▶️ Xử lý "0922000002" trong chiến dịch "Desktop SĐT"',
      'Tìm SĐT: Không tồn tại (Z216)',
      '✅ Hoàn thành "0922000002"',
      '✅ Hoàn thành chiến dịch "Desktop SĐT"'])
    assert.deepEqual(r1.contacts, ['uid-0922000001'])
    assert.deepEqual(await inputRow(f1.ids['0922000001']), { status: 'hoàn thành', note: null, name: 'An', uid: 'uid-0922000001' })
    assert.deepEqual((await details(f1.ids['0922000001'])).map(d => [d.action_name, d.status]),
      [['Tìm SĐT', 'thành công'], ['Nhắn tin người lạ', 'thành công'], ['Kết bạn', 'thành công']])
    assert.equal((await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [f1.campaign.id])).rows[0].status, 'hoàn thành')
    assert.deepEqual(optOutCalls.slice(0, 2), [{ phone: '0922000001' }, { globalId: 'g-0922000001' }])
    // D1b: theo dõi tương tác bật: giữ chỗ trước khi gửi, giữ nguồn (insert sắp bắt đầu), đăng ký đúng dòng nhắn tin / kết bạn.
    globalThis.__engineTest.engagement = true
    globalThis.__engineTest.engagementCalls = []
    const f1b = await makeCampaign({ phones: ['0922000003'], extra, content: 'Chào #{FULL_NAME}' })
    const r1b = await runWith(f1b, { '0922000003': { name: 'Bình' } })
    assert.equal((await r1b.run()).reason, 'no_target')
    globalThis.__engineTest.engagement = false
    const sentRows = (await db.query(`SELECT id, action_code, data FROM public.auto_campaign_details WHERE input_data_id = $1 AND action_code IN
      ('zalo_message_stranger', 'zalo_add_friend') ORDER BY id`, [f1b.ids['0922000003']])).rows
    assert.deepEqual(sentRows.map(r => [r.action_code, r.data.zaloEngagementSource?.actionType, r.data.zaloEngagementPending, r.data.zaloEngagementRuntime]),
      [['zalo_message_stranger', 'message', true, undefined], ['zalo_add_friend', 'friend_request', true, undefined]])
    assert.deepEqual(globalThis.__engineTest.engagementCalls, ['begin:uid-0922000003', 'stage:uid-0922000003:true', `register:${sentRows[0].id}:message`,
      'begin:uid-0922000003', 'stage:uid-0922000003:true', `register:${sentRows[1].id}:friend_request`])
    pass('Desktop, theo dõi tương tác bật: giữ chỗ → giữ nguồn → đăng ký đúng dòng nhắn tin và kết bạn (hàm của bộ cũ), dòng lịch sử chờ đăng ký như bộ cũ')

    const journalDb = path.join(userData, 'local-data', 'campaign_engine_journal.db')
    assert.ok(fs.existsSync(journalDb))
    const Database = require('better-sqlite3')
    assert.equal(new Database(journalDb, { readonly: true }).prepare('SELECT count(*) AS n FROM engine_journal').get().n, 0, 'nhật ký trống sau khi DB xác nhận')
    pass('Desktop: chạy hết danh sách như bộ chạy cũ (câu tiến trình, lịch sử, danh bạ, tên/UID data, nghỉ theo nhóm tài khoản), hoàn thành chiến dịch, nhật ký SQLite trống')

    // D2: lỗi Zalo thật (zca-js): 122 khi nhắn → thất bại, vẫn kết bạn; 221 khi tra → thử reqSrc 40; mạng lỗi khi gửi → không rõ kết quả.
    const f2 = await makeCampaign({ phones: ['0922000003', '0922000004', '0922000005'], extra, content: 'Chào #{FULL_NAME}' })
    const r2 = await runWith(f2, {
      '0922000003': { name: 'Bình', textError: new ZaloApiError('Người nhận chặn', 122) },
      '0922000004': { name: 'Cúc', find: { 32: { code: 221, message: 'Quá giới hạn tra số' } } },
      '0922000005': { name: 'Dung', textError: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }
    })
    const res2 = await r2.run()
    assert.equal(res2.reason, 'no_target')
    assert.deepEqual((await details(f2.ids['0922000003'])).map(d => [d.action_code, d.status, d.error_code]), [
      ['zalo_find_phone_user', 'thành công', null], ['zalo_message_stranger', 'thất bại', 'err_zalo_receiver_blocks_stranger_message'],
      ['zalo_add_friend', 'thành công', null]])
    assert.deepEqual(r2.runtime.sent.filter(x => x.startsWith('find:0922000004')), ['find:0922000004:32', 'find:0922000004:40'])
    const d5 = await details(f2.ids['0922000005'])
    // V500 (Q3 đã duyệt): lỗi mạng khi đang gửi là không rõ đã tới (UNK01), không gửi lại.
    assert.deepEqual([d5[1].status, d5[1].error_code], ['thất bại', 'err_engine_unknown_delivery'])
    assert.ok(r2.lines.includes('Nhắn tin người lạ: Không xác nhận được tin đã tới; không gửi lại để tránh trùng (UNK01)'), r2.lines.join('\n'))
    pass('Desktop: lỗi zca-js đổi thành tín hiệu như Desktop đọc mã (122, 221 → thử reqSrc 40, lỗi mạng khi gửi → không rõ kết quả UNK01)')

    // D3: tạm dừng từ Desktop khi đang chạy (yêu cầu còn trong RAM): xong data hiện tại thì dừng, hoàn tất tạm dừng, data sau giữ nguyên.
    const f3 = await makeCampaign({ phones: ['0922000006', '0922000007'], extra, content: 'Chào #{FULL_NAME}' })
    const r3 = await runWith(f3, { '0922000006': { name: 'Em', onSend: () => r3.pauses.add(f3.campaign.id) } })
    const res3 = await r3.run()
    assert.equal(res3.reason, 'stopped'); assert.equal(res3.released, true)
    assert.equal((await inputRow(f3.ids['0922000006'])).status, 'hoàn thành')
    assert.equal((await inputRow(f3.ids['0922000007'])).status, 'chờ xử lý')
    assert.equal((await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [f3.campaign.id])).rows[0].status, 'tạm dừng')
    assert.equal(r3.lines.at(-1), '⏸ Chiến dịch "Desktop SĐT" đã được tạm dừng.')
    assert.ok(!r3.lines.some(l => l.startsWith('⏳ Nghỉ')), 'dừng thì không nghỉ')
    pass('Desktop: bấm Tạm dừng khi đang chạy → chạy xong data hiện tại, nhả lượt, hoàn tất tạm dừng như bộ cũ; data sau vẫn chờ')

    // D4: thoát app giữa lúc đang gửi: dừng ngay, không gửi lại ở lần chạy sau.
    const f4 = await makeCampaign({ phones: ['0922000008', '0922000009'], extra: { enableMessage: true }, content: 'Chào #{FULL_NAME}' })
    const r4 = await runWith(f4, { '0922000008': { name: 'Giang', delayMs: 400, onSend: () => setTimeout(() => r4.runner.abortAll(), 50) } })
    const res4 = await r4.run()
    assert.equal(res4.reason, 'cancelled')
    assert.equal((await inputRow(f4.ids['0922000008'])).status, 'hoàn thành', 'không rõ đã gửi chưa thì không gửi lại')
    const r4b = await runWith(f4, { '0922000009': { name: 'Hà' } })
    assert.equal((await r4b.run()).reason, 'no_target')
    assert.equal(r4b.runtime.sent.filter(x => x.startsWith('text:uid-0922000008')).length, 0, 'lần chạy sau không gửi lại data đang gửi dở')
    assert.equal((await inputRow(f4.ids['0922000009'])).status, 'hoàn thành')
    pass('Desktop: thoát app khi đang gửi → dừng ngay, data đang gửi dở hoàn thành không gửi lại; lần sau chạy tiếp data khác')

    // D5: chiến dịch chưa có data nào nhưng có chiến dịch tìm data bơm vào: chờ như bộ cũ, không tự hoàn thành;
    // không có nguồn thì hoàn thành ("✅ Hoàn thành chiến dịch"), không in "🚀 Bắt đầu" khi không có data để chạy.
    const f5 = await makeCampaign({ phones: [], extra, content: 'x' })
    linkedCampaigns.add(f5.campaign.id)
    const r5 = await runWith(f5, {})
    assert.equal((await r5.run()).reason, 'no_target')
    const c5 = (await db.query(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [f5.campaign.id])).rows[0]
    assert.deepEqual(c5, { status: 'chờ xử lý', note: 'Đang chờ data từ chiến dịch tìm data' })
    assert.deepEqual(r5.lines, ['⚠️ Chưa thể chạy chiến dịch: Đang chờ data từ chiến dịch tìm data'])
    const f6 = await makeCampaign({ phones: [], extra, content: 'x' })
    const r6 = await runWith(f6, {})
    assert.equal((await r6.run()).reason, 'no_target')
    assert.equal((await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [f6.campaign.id])).rows[0].status, 'hoàn thành')
    assert.deepEqual(r6.lines, ['✅ Hoàn thành chiến dịch "Desktop SĐT"'])
    pass('Desktop: chiến dịch chưa có data mà có nguồn tìm data thì chờ như bộ cũ; không có nguồn thì hoàn thành')

    // D6: các loại mới qua cổng Desktop thật: thành viên nhóm (hồ sơ theo UID, lưu danh bạ), bạn bè, nhắn group (sendMessageToGroup),
    // thêm thành viên (addMemberToGroup, bỏ tiền tố g), vào group bằng link (joinGroupByLink, lưu danh bạ group).
    const makeTyped = async (actionId, rows, extraSettings, content = 'Chào #{FULL_NAME}') => {
      const f = await makeCampaign({ phones: [], extra: extraSettings, content })
      await db.query(`UPDATE public.auto_campaigns SET action_id = $2 WHERE id = $1`, [f.campaign.id, actionId])
      const ids = []
      for (const row of rows) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', false)`, [id, f.campaign.id, row.name ?? null, row.uid ?? null, row.phone ?? null])
        ids.push(id)
      }
      return { ...f, ids, campaign: { ...f.campaign, actionId } }
    }
    const typed = [
      ['zalo_message_group_member', [{ name: 'Thành viên', uid: '7101' }], { enableMessage: true }, ['profile:7101', 'text:7101:Chào Hồ sơ 7101'],
        [['zalo_message_stranger', 'thành công', 'Đã gửi tin nhắn đến Hồ sơ 7101']], ['profile:7101']],
      ['zalo_message_friend', [{ name: 'Bạn', uid: '7102' }], {}, ['profile:7102', 'text:7102:Chào Hồ sơ 7102'],
        [['zalo_message_friend', 'thành công', 'Đã gửi tin nhắn đến Hồ sơ 7102']], ['profile:7102']],
      ['zalo_message_group', [{ name: 'Nhóm Bán', uid: '7103' }], {}, ['group:7103:Chào Nhóm Bán'],
        [['zalo_message_group', 'thành công', 'Đã gửi tin nhắn vào group Nhóm Bán']], []],
      ['zalo_add_group_member', [{ name: 'Người thêm', uid: '7104' }], { zaloAddGroupMemberTargetGroupId: 'g7200', zaloAddGroupMemberTargetGroupName: 'Nhóm' },
        ['profile:7104', 'add:7200:7104:false'], [['zalo_add_group_member', 'thành công', 'Đã thêm thành viên vào group cho Hồ sơ 7104 vào group Nhóm Đích']],
        ['profile:7104']],
      ['zalo_join_group_link', [{ uid: 'zalo.me/g/abcd' }], {}, ['join:https://zalo.me/g/abcd'],
        [['zalo_join_group_link', 'thành công', 'Đã gửi yêu cầu tham gia group Nhóm Link, đang chờ duyệt']], ['group:555:false']]
    ]
    for (const [actionId, rows, extraSettings, expectedSent, expectedDetails, expectedContacts] of typed) {
      const f = await makeTyped(actionId, rows, extraSettings)
      const r = await runWith(f, {})
      assert.equal(r.runner.support(f.account, f.campaign).ok, true, actionId)
      const res = await r.run()
      assert.equal(res.reason, 'no_target', `${actionId}: ${JSON.stringify(res)}`)
      assert.deepEqual(r.runtime.sent, expectedSent, actionId)
      assert.deepEqual((await details(f.ids[0])).map(d => [d.action_code, d.status, d.log]), expectedDetails, actionId)
      assert.deepEqual(r.contacts, expectedContacts, actionId)
      assert.equal((await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [f.campaign.id])).rows[0].status, 'hoàn thành', actionId)
    }
    pass('Desktop: thành viên nhóm, bạn bè, nhắn group, thêm thành viên, vào group bằng link chạy qua cổng Desktop thật, đúng câu và lịch sử')
  } finally {
    await db.end().catch(() => {})
    stop()
    fs.rmSync(out, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
