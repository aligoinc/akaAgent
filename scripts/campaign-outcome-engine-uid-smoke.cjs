// "Nhắn tin thành viên nhóm" (zalo_message_group_member) và "Nhắn tin khách cũ" (zalo_message_remarketing_customer) bằng lõi thật
// (packages/campaign-engine) + cổng Zalo giả, trên PostgreSQL 17 cục bộ có đủ chuỗi production V495 → V499 → V500 → V501.
// Kỳ vọng là hành vi của bộ chạy Desktop (preflightZaloMessageOptOut, zaloResolveGroupMemberTarget,
// zaloResolveRemarketingCustomerTarget, zaloSendPhoneMessage, zaloSendPhoneFriendRequest) cộng các thay đổi đã duyệt (DAT01 cho
// data thiếu UID). Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-uid-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.UID_TEST_PORT || 55503)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-uid-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

function testClock(heartbeatMs = 60000) {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms !== heartbeatMs) return setImmediate(() => resolve(!signal?.aborted))
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
  }
}

const GROUP = 'zalo_message_group_member'
const REMARKETING = 'zalo_message_remarketing_customer'
const FRIEND = 'zalo_message_friend'
const GROUP_MESSAGE = 'zalo_message_group'
const ADD_MEMBER = 'zalo_add_group_member'
const JOIN_LINK = 'zalo_join_group_link'

async function main() {
  const E = await loadEngine()

  // ---- 1. Bảng loại, hỗ trợ, kế hoạch claim -------------------------------------------------------------------
  for (const actionId of [GROUP, REMARKETING]) {
    const type = E.zaloCampaignType(actionId)
    assert.ok(type, `${actionId} có trong bảng loại`)
    const core = { id: 1, actionId, accountId: 7, content: 'x', extraSettings: { enableMessage: true }, images: [], dataTargetSourceMode: null }
    assert.deepEqual(E.zaloCampaignV2Support(core, { engagementTrackingEnabled: false }), { ok: true })
    assert.deepEqual(type.claimPlan(core), { actions: [{ code: 'zalo_message_stranger' }] }, 'không tra số: chỉ khoá/hạn mức của thao tác gửi')
    const both = { ...core, extraSettings: { enableMessage: true, enableAddFriend: true, actionLimits: { continueWhenActionLimitReached: true } } }
    assert.deepEqual(type.claimPlan(both), {
      actions: [
        { code: 'zalo_message_stranger', required: false, skippableGates: ['quota'] },
        { code: 'zalo_add_friend', required: false, skippableGates: ['quota'] }
      ],
      requireAny: ['zalo_message_stranger', 'zalo_add_friend']
    })
    assert.equal(type.targetLabel({ id: 1, name: 'Lan', uid: '123', phone: '0912' }), 'Lan', 'nhãn data: tên → UID → SĐT')
    assert.equal(type.targetLabel({ id: 1, name: '', uid: '123', phone: '0912' }), '123')
    assert.equal(type.actionNames.zalo_message_stranger, 'Nhắn tin người lạ')
    assert.equal(type.actionNames.zalo_find_phone_user, undefined)
    const support = extra => E.zaloCampaignV2Support({ ...core, extraSettings: { enableMessage: true, ...extra } }, { engagementTrackingEnabled: false })
    assert.deepEqual(support({ zaloOptOutLinkEnabled: true }), { ok: true }, 'link từ chối nhận tin chạy bộ mới')
    assert.deepEqual(support({ zaloSendExclusionsByAccountId: { 7: { groupId: 5, blocklistIds: [] } } }), { ok: true }, 'loại trừ gửi chạy bộ mới (V504)')
    assert.deepEqual(E.zaloCampaignV2Support({ ...core, dataTargetSourceMode: 'data_group' }, { engagementTrackingEnabled: false }), { ok: true },
      'Nhóm data chạy bộ mới (V501 gọi hàm kết thúc Nhóm data của bản cũ)')
    assert.deepEqual(E.zaloCampaignV2Support(core, { engagementTrackingEnabled: true }), { ok: false, reason: 'engagement_tracking' })
  }
  // Kiêm gửi SMS chỉ có ở SĐT và thành viên nhóm (EXTERNAL_SMS_ZALO_ACTION_IDS): khách cũ bỏ qua cấu hình SMS như Desktop. Kiêm SMS nội bộ
  // chạy bộ mới ở cả hai nơi (V506); akaBiz Sms chỉ ở nơi có tích hợp (Desktop), Fly chạy bộ cũ.
  const sms = (actionId, extra, env = {}) => E.zaloCampaignV2Support({ id: 1, actionId, accountId: 7, content: 'x', images: [], dataTargetSourceMode: null,
    extraSettings: { enableMessage: true, ...extra } }, { engagementTrackingEnabled: false, ...env })
  assert.deepEqual(sms(GROUP, { internalSmsEnabled: true }), { ok: true })
  assert.deepEqual(sms(GROUP, { externalSmsEnabled: true }), { ok: false, reason: 'sms_push_external' })
  assert.deepEqual(sms(GROUP, { externalSmsEnabled: true }, { externalSmsPush: true }), { ok: true })
  assert.deepEqual(sms(REMARKETING, { externalSmsEnabled: true }), { ok: true })
  // Bước sau khi ghi của khách cũ chỉ còn đăng ký tương tác (cổng không có thì không có bước), kể cả khi bật kiêm SMS.
  assert.equal(E.zaloCampaignType(REMARKETING).afterReport({ id: 1, actionId: REMARKETING, accountId: 1, content: 'x',
    extraSettings: { enableMessage: true, internalSmsEnabled: true }, images: [] }, {}, { targetLabel: () => '' }), null, 'khách cũ không kiêm SMS')
  // Nhắn tin group (workflow 268): một thao tác bắt buộc; gửi dạng chia sẻ chạy theo lô (V503, campaign-outcome-engine-share-smoke.cjs).
  {
    const type = E.zaloCampaignType(GROUP_MESSAGE)
    const core = extra => ({ id: 1, actionId: GROUP_MESSAGE, accountId: 7, content: 'x', extraSettings: extra, images: [], dataTargetSourceMode: null })
    const support = extra => E.zaloCampaignV2Support(core(extra), { engagementTrackingEnabled: true })
    assert.deepEqual(support({ zaloOptOutLinkEnabled: true, zaloSendExclusionsByAccountId: { 7: { groupId: 5 } }, internalSmsEnabled: true }), { ok: true },
      'nhóm không có link từ chối, loại trừ gửi, theo dõi tương tác, kiêm SMS (như Desktop)')
    assert.deepEqual(support({ zaloMessageSendMode: 'share' }), { ok: true }, 'gửi dạng chia sẻ chạy bộ mới theo lô')
    assert.deepEqual(type.claimPlan(core({})), { actions: [{ code: 'zalo_message_group' }] })
    assert.equal(type.actionNames.zalo_message_group, 'Nhắn tin group')
  }
  // Nhắn tin bạn bè (workflow 266): một thao tác bắt buộc, luôn nhắn tin; chia sẻ chạy theo lô; "toàn bộ / theo tag" lấy data đầu lượt (V505).
  {
    const type = E.zaloCampaignType(FRIEND)
    const core = extra => ({ id: 1, actionId: FRIEND, accountId: 7, content: 'x', extraSettings: extra, images: [], dataTargetSourceMode: null })
    const support = extra => E.zaloCampaignV2Support(core(extra), { engagementTrackingEnabled: false })
    assert.deepEqual(support({}), { ok: true }, 'không cần enableMessage')
    assert.deepEqual(type.claimPlan(core({ actionLimits: { continueWhenActionLimitReached: true } })), { actions: [{ code: 'zalo_message_friend' }] })
    assert.deepEqual(support({ zaloMessageSendMode: 'share' }), { ok: true }, 'gửi dạng chia sẻ chạy bộ mới theo lô')
    assert.deepEqual(support({ zaloFriendTargetMode: 'all_friends' }), { ok: true }, 'toàn bộ bạn bè: bước lấy data đầu lượt (V505)')
    assert.equal(typeof type.prepareTargets(core({ zaloFriendTargetMode: 'all_friends' }), {}, { campaignName: 'x' }), 'function')
    assert.equal(type.prepareTargets(core({}), {}, { campaignName: 'x' }), null, 'chọn tay: không lấy data đầu lượt')
    assert.deepEqual(support({ zaloFriendTargetMode: 'tagged_friends', zaloFriendDataMaterializedAt: '2026-11-01T00:00:00Z' }), { ok: true })
    assert.deepEqual(support({ zaloFriendTargetMode: 'lạ' }), { ok: true }, 'chế độ lạ coi như chọn tay')
    assert.deepEqual(support({ zaloFriendBlocklistEnabled: true }), { ok: true }, 'danh sách không gửi tin kiểu cũ chạy bộ mới (V504)')
    assert.deepEqual(support({ zaloFriendBlocklistEnabled: true, zaloSendExclusionsByAccountId: { 7: { groupId: null, blocklistIds: [] } } }), { ok: true },
      'đã có cấu hình loại trừ gửi mới thì bỏ danh sách cũ')
    assert.deepEqual(support({ internalSmsEnabled: true }), { ok: true }, 'không kiêm SMS')
    assert.equal(type.actionNames.zalo_message_friend, 'Nhắn tin bạn bè')
    assert.equal(type.validate(core({ formattedContentEnabled: false }), { zaloWeb: true }).length, 0)
    assert.deepEqual(type.validate({ ...core({}), images: [{ name: 'a.pdf', cloudUrl: 'https://x/a.pdf' }] }, { zaloWeb: true }).map(i => i.publicCode),
      ['CFG10'], 'Zalo Web chỉ gửi ảnh: kiểm cả khi không có công tắc enableMessage')
  }
  pass('bảng loại: hỗ trợ, kế hoạch claim không tra số, nhãn tên → UID → SĐT, kiêm SMS chỉ ở thành viên nhóm')

  // ---- 2. Chạy thật với RPC ---------------------------------------------------------------------------------
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-uid-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    for (const sql of [MIGRATION, v499.migration, V500, v501.migration]) await db.query(sql)
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 930000
    const make = async ({ actionId = GROUP, extra = {}, content = 'Chào #{FULL_NAME}', targets }) => {
      const account = ++nextId, campaign = ++nextId, staff = 9201, org = 651
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, staff, org])
      const extraSettings = { enableMessage: true, ...extra }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings, images)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Theo UID', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5, $6, $7::jsonb, '[]'::jsonb)`,
        [campaign, actionId, account, staff, org, content, JSON.stringify(extraSettings)])
      const ids = []
      for (const t of targets) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', false)`, [id, campaign, t.name ?? null, t.uid ?? null, t.phone ?? null])
        ids.push(id)
      }
      return { account, campaign, staff, ids, actionId, extra: extraSettings, content }
    }
    const err = (message, code) => Object.assign(new Error(message), code === undefined ? {} : { code })
    const run = async (c, b = {}, cfgOverride = {}) => {
      const calls = [], lines = []
      const port = {
        findUser: async (_ctx, phone, reqSrc) => {
          calls.push(`find:${phone}:${reqSrc}`)
          return b.found === false ? null : E.normalizeZaloFoundUser({ userId: `p-${phone}`, display_name: 'Khách SĐT', zalo_name: 'Khách SĐT', globalId: `g-${phone}` })
        },
        joinGroupByLink: async (_ctx, link) => {
          calls.push(`join:${link}`)
          if (b.join instanceof Error) throw b.join
          return { link, group: { groupId: 'gr-1', name: 'Nhóm Link' }, groupId: 'gr-1', groupName: 'Nhóm Link', outcome: b.join ?? 'joined',
            response: { ok: 1 }, zaloCode: b.join === 'already_joined' ? '178' : b.join === 'pending_approval' ? '240' : null, zaloMessage: null }
        },
        saveJoinedGroup: async (_ctx, result, isJoined) => { calls.push(`saveGroup:${result.groupId}:${isJoined}`) },
        addGroupMember: async (_ctx, input) => {
          calls.push(`add:${input.groupId}:${input.memberId}:${input.useShareMethod}`)
          if (b.add instanceof Error) throw b.add
          return { groupId: input.groupId, groupName: 'Nhóm Đích', groupType: 0, mode: input.useShareMethod ? 'share_group_link' : 'direct_add',
            outcome: b.add ?? (input.useShareMethod ? 'link_sent' : 'added'),
            message: b.add === 'already_member' ? 'Đã là thành viên của group' : input.useShareMethod ? 'Gửi lời mời thành công' : 'Đã thêm thành viên vào group',
            groupLink: input.useShareMethod ? 'https://zalo.me/g/abc' : null, response: { ok: 1 } }
        },
        phoneSearchLimitScope: async () => null,
        saveFoundUser: async (_ctx, target) => { calls.push(`saveFound:${target.uid}`) },
        getUserProfile: async (_ctx, uid) => {
          calls.push(`profile:${uid}`)
          if (b.profile instanceof Error) throw b.profile
          if (b.profile === null) return null
          return E.normalizeZaloFoundUser({ userId: uid, display_name: 'Lan Zalo', zalo_name: 'Lan Gốc', phoneNumber: b.profilePhone ?? '84912000777',
            globalId: `g-${uid}`, avatar: 'https://a/x.jpg' })
        },
        saveResolvedProfile: async (_ctx, target) => {
          calls.push(`save:${target.uid}:${Object.keys(target.raw?.profile ?? {}).length > 0}`)
          if (b.save) throw b.save
        },
        prepareOptOutLink: async (_ctx, identity) => {
          calls.push(`link:${identity.globalId}`)
          if (b.link instanceof Error) throw b.link
          return { id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: b.link === 'opted_out' }
        },
        isOptedOut: async (_ctx, identity) => {
          calls.push(`optout:${identity.phone ?? identity.globalId}`)
          if (b.optOut instanceof Error) throw b.optOut
          return b.optOut === (identity.phone ?? identity.globalId)
        },
        takeContentIndex: async (_ctx, _action, count) => (b.rotation = ((b.rotation ?? -1) + 1)) % count,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid, message, threadType = 'user') => {
          calls.push(`text:${threadType === 'group' ? 'group:' : ''}${uid}:${message}`)
          if (b.text) throw b.text
          return { response: { msgId: 'mt' }, msgId: 'mt' }
        },
        prepareMedia: async () => [],
        sendMedia: async () => { throw new Error('không có tệp') },
        sendFriendRequest: async (_ctx, uid, message) => { calls.push(`friend:${uid}:${message}`); if (b.friend) throw b.friend; return {} },
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '',
        applyAkaBizTags: async (_ctx, contactType, uid) => { calls.push(`akabiz:${contactType}:${uid}`); return 1 }
      }
      const core = { id: c.campaign, actionId: c.actionId, accountId: c.account, content: c.content, extraSettings: c.extra, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(c.actionId)
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:uid', runtimeTarget: 'desktop', staffId: c.staff, accountId: c.account, campaignId: c.campaign, actionId: c.actionId,
        campaignName: 'Theo UID', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } }),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) AS r', [c.account, info.leaseToken]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: 60000, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }, ...cfgOverride
      }, new AbortController().signal)
      return { result, calls, lines }
    }
    const details = id => rows(`SELECT action_code, status, error_code, counts_toward_limit, log, data FROM public.auto_campaign_details
      WHERE input_data_id = $1 ORDER BY id`, [id])
    const input = id => rows(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [id]).then(r => r[0])

    // U1: thành viên nhóm có UID: đọc hồ sơ → từ chối nhận tin (SĐT data, SĐT hồ sơ, global ID) → lưu danh bạ → tag akaBiz → nhắn tin.
    const u1 = await make({ extra: { enableAkaBizTag: true, akaBizTagIds: [3] }, targets: [{ name: 'Lan', uid: '1001', phone: '0912000111' }] })
    const r1 = await run(u1)
    assert.deepEqual(r1.calls, [
      'profile:1001', 'optout:0912000111', 'optout:84912000777', 'optout:g-1001', 'save:1001:true', 'akabiz:person:1001', 'text:1001:Chào Lan Zalo'
    ], 'thứ tự như Desktop: hồ sơ → từ chối nhận tin → lưu danh bạ → tag akaBiz → nhắn tin; không tra SĐT')
    const d1 = await details(u1.ids[0])
    assert.deepEqual(d1.map(d => [d.action_code, d.status, d.log]), [['zalo_message_stranger', 'thành công', 'Đã gửi tin nhắn đến Lan Zalo']])
    assert.equal(d1[0].data.target.globalId, 'g-1001')
    assert.equal(d1[0].data.target.raw.inputData.uid, '1001', 'mục tiêu giữ data gốc như normalizeZaloTargetFromInputData')
    assert.equal((await input(u1.ids[0])).status, 'hoàn thành')
    assert.ok(r1.lines.some(l => l.startsWith('▶️') && l.includes('"Lan"')), 'nhãn data trong tiến trình: tên')
    assert.ok(r1.lines.includes('✅ Hoàn thành "Lan"'))
    assert.ok(r1.lines.includes('🏷️ Đã gắn tag akaBiz cho Lan Zalo'))
    pass('thành viên nhóm: hồ sơ theo UID → từ chối nhận tin → lưu danh bạ → tag akaBiz → nhắn tin, không tra SĐT, nhãn theo tên')

    // U2: thiếu UID → DAT01 (Nhắn tin người lạ), không gọi Zalo, data hoàn thành; câu đúng của từng loại.
    const u2 = await make({ targets: [{ name: 'Không UID' }] })
    const r2 = await run(u2)
    assert.deepEqual(r2.calls, [], 'không gọi Zalo')
    const d2 = await details(u2.ids[0])
    assert.deepEqual([d2[0].action_code, d2[0].error_code, d2[0].counts_toward_limit], ['zalo_message_stranger', 'err_input_invalid', false])
    assert.match(JSON.stringify(d2[0]), /UID thành viên group Zalo không hợp lệ/)
    assert.equal((await input(u2.ids[0])).status, 'hoàn thành')
    const u2b = await make({ actionId: REMARKETING, targets: [{ name: 'Không UID' }] })
    await run(u2b)
    assert.match(JSON.stringify((await details(u2b.ids[0]))[0]), /UID khách hàng cũ Zalo không hợp lệ/)
    pass('thiếu UID: DAT01 cho Nhắn tin người lạ, không gọi Zalo, không tính lượt; câu riêng của thành viên nhóm / khách cũ')

    // U3: đọc hồ sơ lỗi → giữ mục tiêu từ data, cảnh báo thiếu global ID, vẫn gửi; không lưu danh bạ (không có hồ sơ).
    const u3 = await make({ targets: [{ name: 'Minh', uid: '1003' }] })
    const r3 = await run(u3, { profile: E.zaloPortErrorFrom(err('Lỗi mạng', undefined), { operation: 'read', answered: false }) })
    assert.deepEqual(r3.calls, ['profile:1003', 'text:1003:Chào Minh'])
    assert.ok(r3.lines.includes('⚠️ "Minh": Không lấy được Zalo global ID; vẫn tiếp tục gửi, cá nhân hoá từ chối nhận tin (nếu có) dùng trang thông báo lỗi.'))
    assert.equal((await details(u3.ids[0]))[0].status, 'thành công')
    pass('đọc hồ sơ lỗi: dùng tên/UID của data, cảnh báo thiếu global ID như Desktop, vẫn gửi; không lưu danh bạ')

    // U4: bị chặn theo global ID → không gửi, không lưu danh bạ, không tag akaBiz.
    const u4 = await make({ extra: { enableAkaBizTag: true, akaBizTagIds: [3] }, targets: [{ name: 'Hoa', uid: '1004' }] })
    const r4 = await run(u4, { optOut: 'g-1004' })
    assert.deepEqual(r4.calls, ['profile:1004', 'optout:84912000777', 'optout:g-1004'])
    const i4 = await input(u4.ids[0])
    assert.deepEqual([i4.status, i4.note], ['tạm dừng', 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo (OPT01)'], 'như blockZaloMessageOptOutTarget, kèm mã ngắn')
    pass('người nhận đã từ chối nhận tin: data tạm dừng kèm ghi chú như Desktop; không gửi, không lưu danh bạ, không tag akaBiz')

    // U5: chỉ kết bạn: lời mời cắt 150 ký tự, gửi theo UID; lưu danh bạ lỗi không đổi kết quả.
    const long = 'Xin chào #{FULL_NAME} '.repeat(20)
    const u5 = await make({ extra: { enableMessage: false, enableAddFriend: true, friendRequestMessage: long }, targets: [{ name: 'Tú', uid: '1005' }] })
    const r5 = await run(u5, { save: new Error('DB lỗi') })
    const f5 = r5.calls.find(x => x.startsWith('friend:'))
    assert.ok(f5 && f5.length === 'friend:1005:'.length + 150, 'lời mời cắt 150 ký tự')
    assert.ok(!r5.calls.some(x => x.startsWith('text:')))
    assert.deepEqual((await details(u5.ids[0])).map(d => [d.action_code, d.status]), [['zalo_add_friend', 'thành công']])
    pass('chỉ kết bạn: lời mời theo UID, cắt 150 ký tự; lưu danh bạ lỗi không đổi kết quả')

    // U6: nhắn tin lỗi 122 → kết bạn vẫn chạy (như workflow 272: chuỗi bước không dừng khi nhắn tin lỗi).
    const u6 = await make({ extra: { enableAddFriend: true, friendRequestMessage: 'Kết bạn nhé' }, targets: [{ name: 'Nga', uid: '1006' }] })
    const r6 = await run(u6, { text: E.zaloPortErrorFrom(err('Người nhận chặn tin nhắn từ người lạ', 122), { operation: 'send', answered: true }) })
    assert.deepEqual(r6.calls.filter(x => x.startsWith('text:') || x.startsWith('friend:')), ['text:1006:Chào Lan Zalo', 'friend:1006:Kết bạn nhé'])
    assert.deepEqual((await details(u6.ids[0])).map(d => [d.action_code, d.status]),
      [['zalo_message_stranger', 'thất bại'], ['zalo_add_friend', 'thành công']])
    pass('nhắn tin lỗi 122: kết bạn vẫn chạy như Desktop')

    // U7: khách cũ: không có hồ sơ (null) → dùng tên data; nhắn tin theo UID.
    const u7 = await make({ actionId: REMARKETING, targets: [{ name: 'Khách cũ', uid: '1007' }] })
    const r7 = await run(u7, { profile: null })
    assert.deepEqual(r7.calls, ['profile:1007', 'text:1007:Chào Khách cũ'])
    assert.equal((await details(u7.ids[0]))[0].log, 'Đã gửi tin nhắn đến Khách cũ')
    pass('khách cũ: Zalo không trả hồ sơ → dùng tên data, gửi theo UID')

    // U8: "tiếp tục khi chạm giới hạn" + hết lượt ngày của thao tác gửi duy nhất: không nhận data (requireAny tới DB), chiến dịch
    // chờ kèm câu giới hạn, không có dòng SYS07 (hồi quy: runUnit từng không gửi requireAny nên data bị nhận rồi đóng SYS07).
    const u8 = await make({ extra: { actionLimits: { continueWhenActionLimitReached: true, dailyLimit: 1,
      byActionCode: { zalo_message_stranger: { dailyLimit: 1 } }, enabledActionCodes: ['zalo_message_stranger'] } },
    targets: [{ name: 'A', uid: '1008' }, { name: 'B', uid: '1009' }] })
    const r8 = await run(u8)
    assert.deepEqual(r8.calls.filter(x => x.startsWith('text:')), ['text:1008:Chào Lan Zalo'])
    assert.equal(r8.result.reason, 'wait')
    assert.equal((await input(u8.ids[1])).status, 'chờ xử lý', 'data sau không bị nhận')
    assert.deepEqual(await details(u8.ids[1]), [])
    const c8 = (await rows(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [u8.campaign]))[0]
    assert.equal(c8.status, 'chờ xử lý')
    assert.match(c8.note || '', /giới hạn/)
    pass('hết lượt mọi thao tác gửi (tiếp tục khi chạm giới hạn): không nhận data, chiến dịch chờ, không SYS07')

    // F1: nhắn tin bạn bè: hồ sơ → từ chối nhận tin → lưu danh bạ → nhắn tin (thao tác zalo_message_friend), không kết bạn.
    const f1 = await make({ actionId: FRIEND, extra: { enableMessage: false, enableAddFriend: true, friendRequestMessage: 'x' },
      targets: [{ name: 'Bạn A', uid: '2001' }] })
    const rf1 = await run(f1)
    assert.deepEqual(rf1.calls, ['profile:2001', 'optout:84912000777', 'optout:g-2001', 'save:2001:true', 'text:2001:Chào Lan Zalo'],
      'nhắn tin luôn chạy, không có bước kết bạn')
    assert.deepEqual((await details(f1.ids[0])).map(d => [d.action_code, d.status, d.log]),
      [['zalo_message_friend', 'thành công', 'Đã gửi tin nhắn đến Lan Zalo']])
    assert.equal(Number((await rows(`SELECT count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = 'zalo_message_friend'`,
      [f1.account]))[0]?.count_action_in_day ?? 0), 1, 'tính lượt Nhắn tin bạn bè')
    pass('nhắn tin bạn bè: hồ sơ → từ chối nhận tin → lưu danh bạ → nhắn tin bạn bè, tính lượt đúng thao tác, không kết bạn')

    // F2: bạn bè thiếu UID → DAT01 của Nhắn tin bạn bè.
    const f2 = await make({ actionId: FRIEND, targets: [{ name: 'Không UID' }] })
    await run(f2)
    const df2 = await details(f2.ids[0])
    assert.deepEqual([df2[0].action_code, df2[0].error_code], ['zalo_message_friend', 'err_input_invalid'])
    assert.match(JSON.stringify(df2[0]), /UID bạn bè Zalo không hợp lệ/)
    pass('bạn bè thiếu UID: DAT01 của Nhắn tin bạn bè')

    // F3: bạn bè "toàn bộ" đã lấy data một lần mà không có dòng nào: chờ kèm ghi chú như Desktop, không hoàn thành; lần quét sau
    // cùng ghi chú thì không in lại.
    const f3 = await make({ actionId: FRIEND, extra: { zaloFriendTargetMode: 'all_friends', zaloFriendDataMaterializedAt: '2026-11-01T00:00:00Z' },
      targets: [] })
    const rf3 = await run(f3)
    const c3 = (await rows(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [f3.campaign]))[0]
    assert.deepEqual([c3.status, c3.note], ['chờ xử lý', 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy'])
    assert.ok(rf3.lines.includes('⚠️ Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy'))
    const rf3b = await run(f3, {}, { campaignNote: c3.note })
    assert.ok(!rf3b.lines.some(l => l.includes('đã lấy data bạn bè')), 'cùng ghi chú: không in lại mỗi lần quét')
    pass('bạn bè "toàn bộ / theo tag" đã lấy data nhưng không có dòng nào: chờ kèm ghi chú, không hoàn thành, không in lặp')

    // G1: nhắn tin group: gửi vào hội thoại nhóm (ID giữ nguyên), không đọc hồ sơ / từ chối nhận tin; tag akaBiz group sau khi gửi
    // thành công; không tag Zalo / đổi tên dù cờ còn trong cấu hình.
    const g1 = await make({ actionId: GROUP_MESSAGE, content: 'Chào cả nhóm #{FULL_NAME}',
      extra: { enableAkaBizTag: true, akaBizTagIds: [3], enableZaloTag: true, zaloTagId: 9, enableZaloAlias: true, zaloAliasTemplate: 'x',
        zaloOptOutLinkEnabled: true }, targets: [{ name: 'Nhóm Bán Hàng', uid: '7001' }] })
    const rg1 = await run(g1)
    assert.deepEqual(rg1.calls, ['text:group:7001:Chào cả nhóm Nhóm Bán Hàng', 'akabiz:group:7001'])
    assert.deepEqual((await details(g1.ids[0])).map(d => [d.action_code, d.status, d.log, d.data.groupId]),
      [['zalo_message_group', 'thành công', 'Đã gửi tin nhắn vào group Nhóm Bán Hàng', '7001']])
    assert.ok(rg1.lines.includes('🏷️ Đã gắn tag akaBiz cho group Nhóm Bán Hàng'))
    pass('nhắn tin group: gửi vào nhóm, tag akaBiz group sau khi gửi được; không hồ sơ, không từ chối nhận tin, không tag / đổi tên')

    // G2: gửi lỗi 112 (nhóm từ chối): không tag akaBiz; G3: thiếu ID group → DAT01 của Nhắn tin group.
    const g2 = await make({ actionId: GROUP_MESSAGE, extra: { enableAkaBizTag: true, akaBizTagIds: [3] },
      targets: [{ name: 'Nhóm Khoá', uid: '7002' }, { name: 'Không ID' }] })
    const rg2 = await run(g2, { text: E.zaloPortErrorFrom(err('Không có quyền gửi tin nhắn vào nhóm', 112), { operation: 'send', answered: true }) })
    assert.ok(!rg2.calls.some(c => c.startsWith('akabiz:')), 'gửi lỗi thì không tag akaBiz')
    assert.equal((await details(g2.ids[0]))[0].action_code, 'zalo_message_group')
    const dg3 = await details(g2.ids[1])
    assert.deepEqual([dg3[0].action_code, dg3[0].error_code], ['zalo_message_group', 'err_input_invalid'])
    assert.match(JSON.stringify(dg3[0]), /ID group Zalo không hợp lệ/)
    pass('nhắn tin group: gửi lỗi thì không tag akaBiz; thiếu ID group → DAT01 của Nhắn tin group')

    // A1: thêm thành viên theo UID: hồ sơ + lưu danh bạ (không tag akaBiz) → thêm trực tiếp; tính lượt. A2: đã là thành viên: không tính lượt.
    const groupCfg = { zaloAddGroupMemberTargetGroupId: 'g9001', zaloAddGroupMemberTargetGroupName: 'Nhóm Cấu Hình', enableAkaBizTag: true, akaBizTagIds: [3] }
    const a1 = await make({ actionId: ADD_MEMBER, extra: groupCfg, targets: [{ name: 'Lan', uid: '3001' }] })
    const ra1 = await run(a1)
    assert.deepEqual(ra1.calls, ['profile:3001', 'save:3001:true', 'add:9001:3001:false'], 'bỏ tiền tố g của group; UID không tag akaBiz')
    const da1 = await details(a1.ids[0])
    assert.deepEqual(da1.map(d => [d.action_code, d.status, d.log, d.counts_toward_limit]),
      [['zalo_add_group_member', 'thành công', 'Đã thêm thành viên vào group cho Lan Zalo vào group Nhóm Đích', true]])
    assert.equal(da1[0].data.mode, 'direct_add')
    const a2 = await make({ actionId: ADD_MEMBER, extra: groupCfg, targets: [{ name: 'Lan', uid: '3002' }] })
    await run(a2, { add: 'already_member' })
    const da2 = await details(a2.ids[0])
    assert.deepEqual(da2.map(d => [d.status, d.log, d.counts_toward_limit]), [['đã là thành viên', 'Lan Zalo đã là thành viên của group Nhóm Đích', false]])
    pass('thêm thành viên theo UID: hồ sơ, lưu danh bạ, thêm (tính lượt); đã là thành viên ghi "đã là thành viên", không tính lượt')

    // A3: gửi link group; A4: data chỉ có SĐT: Tìm SĐT (dòng lịch sử, lưu UID) → tag akaBiz → thêm.
    const a3 = await make({ actionId: ADD_MEMBER, extra: { ...groupCfg, zaloAddGroupMemberUseShareMethod: true }, targets: [{ name: 'Mai', uid: '3003' }] })
    await run(a3)
    assert.equal((await details(a3.ids[0]))[0].log, 'Gửi lời mời thành công đến Lan Zalo qua link group Nhóm Đích')
    const a4 = await make({ actionId: ADD_MEMBER, extra: groupCfg, targets: [{ phone: '0912333444' }] })
    const ra4 = await run(a4)
    assert.deepEqual(ra4.calls, ['find:0912333444:32', 'saveFound:p-0912333444', 'akabiz:person:p-0912333444', 'add:9001:p-0912333444:false'])
    assert.deepEqual((await details(a4.ids[0])).map(d => [d.action_code, d.status]),
      [['zalo_find_phone_user', 'thành công'], ['zalo_add_group_member', 'thành công']])
    pass('thêm thành viên: gửi link group; data chỉ có SĐT tra số (dòng Tìm SĐT), tag akaBiz rồi thêm')

    // A5: "Tìm SĐT" đang bị khoá: data chỉ có SĐT về hàng đợi, không dòng lịch sử, dừng lượt; data có UID vẫn chạy (không bị khoá oan).
    const a5 = await make({ actionId: ADD_MEMBER, extra: groupCfg, targets: [{ name: 'Có UID', uid: '3005' }, { phone: '0912333555' }] })
    await db.query(`INSERT INTO public.auto_account_action_status(account_id, action_code, is_disable, date_enable, disabled_error_code, count_action_in_day, count_date)
      VALUES ($1, 'zalo_find_phone_user', true, now() + interval '1 hour', 'err_zalo_find_phone_limit', 0, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`, [a5.account])
    const ra5 = await run(a5)
    assert.ok(ra5.calls.includes('add:9001:3005:false'), 'data có UID vẫn thêm')
    assert.ok(!ra5.calls.some(c => c.startsWith('find:')), 'không tra số khi đang bị khoá')
    assert.deepEqual(await details(a5.ids[1]), [])
    assert.equal((await input(a5.ids[1])).status, 'chờ xử lý')
    assert.ok(ra5.lines.some(l => l.startsWith('⚠️ Bỏ qua Tìm SĐT')), ra5.lines.join('\n'))
    assert.equal(ra5.result.reason, 'end_unit')
    pass('"Tìm SĐT" bị khoá: data chỉ có SĐT về hàng đợi, không lịch sử, dừng lượt; data có UID vẫn chạy')

    // A6: không UID, không SĐT → DAT01; A7: Desktop tự ném "Link group Zalo chưa được bật" → thất bại (không phải không rõ đã tới).
    const a6 = await make({ actionId: ADD_MEMBER, extra: groupCfg, targets: [{ name: 'Trống' }, { name: 'Link tắt', uid: '3007' }] })
    await run(a6, { add: E.zaloPortErrorFrom(err('Link group Zalo chưa được bật'), { phase: 'after_send' }) })
    const da6 = await details(a6.ids[0])
    assert.deepEqual([da6[0].action_code, da6[0].error_code], ['zalo_add_group_member', 'err_input_invalid'])
    assert.match(JSON.stringify(da6[0]), /Data cần có SĐT hoặc UID Zalo/)
    const da7 = await details(a6.ids[1])
    assert.deepEqual([da7[0].status, da7[0].error_code], ['thất bại', 'err_zalo_api_business_failed'])
    // Hỗ trợ: chưa chọn group / Nhóm data chạy bộ cũ.
    const sup = extra => E.zaloCampaignV2Support({ id: 1, actionId: ADD_MEMBER, accountId: 7, content: '', extraSettings: extra, images: [],
      dataTargetSourceMode: null }, { engagementTrackingEnabled: false })
    assert.deepEqual(sup({}), { ok: false, reason: 'add_member_group_missing' })
    assert.deepEqual(sup({ zaloAddGroupMemberTargetGroupId: '9' }), { ok: true })
    pass('thêm thành viên: thiếu UID và SĐT → DAT01; link group tắt → thất bại; chưa chọn group chạy bộ cũ')

    // J1–J4: vào group bằng link (link ở cột uid): chuẩn hoá, tham gia, lưu danh bạ group; đã tham gia không tính lượt; link sai → DAT01.
    const jrun = async (link, outcome) => {
      const c = await make({ actionId: JOIN_LINK, targets: [{ uid: link }] })
      const r = await run(c, { join: outcome })
      return { c, r, d: await details(c.ids[0]) }
    }
    const jj = await jrun('zalo.me/g/abc123', 'joined')
    assert.deepEqual(jj.r.calls, ['join:https://zalo.me/g/abc123', 'saveGroup:gr-1:true'])
    assert.deepEqual(jj.d.map(d => [d.action_code, d.status, d.log, d.counts_toward_limit]),
      [['zalo_join_group_link', 'thành công', 'Đã tham gia group Nhóm Link', true]])
    const ja = await jrun('https://zaloapp.com/qr/g/xyz', 'already_joined')
    assert.deepEqual(ja.r.calls, ['join:https://zalo.me/g/xyz', 'saveGroup:gr-1:true'])
    assert.deepEqual(ja.d.map(d => [d.status, d.log, d.counts_toward_limit]), [['đã tham gia', 'Tài khoản đã tham gia group Nhóm Link từ trước', false]])
    const jp = await jrun('www.zalo.me/g/pend', 'pending_approval')
    assert.deepEqual(jp.r.calls, ['join:https://zalo.me/g/pend', 'saveGroup:gr-1:false'])
    assert.deepEqual(jp.d.map(d => [d.status, d.log, d.counts_toward_limit]), [['thành công', 'Đã gửi yêu cầu tham gia group Nhóm Link, đang chờ duyệt', true]])
    const jx = await jrun('https://example.com/g/abc', 'joined')
    assert.deepEqual(jx.r.calls, [], 'link sai: không gọi Zalo')
    assert.deepEqual([jx.d[0].action_code, jx.d[0].error_code], ['zalo_join_group_link', 'err_input_invalid'])
    assert.match(JSON.stringify(jx.d[0]), /Link group Zalo không hợp lệ/)
    assert.equal(E.normalizeZaloGroupInviteLink('zaloapp.com/qr/g/Abc'), 'https://zalo.me/g/Abc')
    assert.equal(E.normalizeZaloGroupInviteLink('https://zalo.me/abc'), '')
    pass('vào group bằng link: chuẩn hoá như Desktop, tham gia / đã tham gia (không tính lượt) / chờ duyệt, lưu danh bạ group; link sai → DAT01')

    // L1–L4: link từ chối nhận tin (thành viên nhóm): token → link riêng; không token → chân trang; đã từ chối → chặn; tạo link lỗi → cảnh báo, vẫn gửi.
    const LINK = E.buildStopMessagesLink('0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f')
    const l1 = await make({ extra: { zaloOptOutLinkEnabled: true }, content: 'Chào #{FULL_NAME}, bỏ theo dõi: #{STOP_MESSAGES_LINK}',
      targets: [{ name: 'Lan', uid: '4001' }] })
    const rl1 = await run(l1)
    assert.deepEqual(rl1.calls.filter(c => c.startsWith('link:') || c.startsWith('text:')), ['link:g-4001', `text:4001:Chào Lan Zalo, bỏ theo dõi: ${LINK}`])
    const dl1 = (await details(l1.ids[0]))[0]
    assert.equal(dl1.status, 'thành công')
    assert.deepEqual([dl1.data.messageOptOutSource?.optOutId, dl1.data.messageOptOutSource?.zaloGlobalId, dl1.data.messageOptOutSource?.version],
      ['0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', 'g-4001', 1], 'nguồn của link cho trigger trg_capture_message_opt_out_source')
    const l2 = await make({ extra: { zaloOptOutLinkEnabled: true }, content: 'Chào #{FULL_NAME}', targets: [{ name: 'Mai', uid: '4002' }] })
    const rl2 = await run(l2)
    const sent2 = rl2.calls.find(c => c.startsWith('text:'))
    assert.ok(sent2.startsWith('text:4002:Chào Lan Zalo') && sent2.endsWith(LINK), sent2)
    const l3 = await make({ extra: { zaloOptOutLinkEnabled: true }, targets: [{ name: 'Hoa', uid: '4003' }] })
    const rl3 = await run(l3, { link: 'opted_out' })
    assert.ok(!rl3.calls.some(c => c.startsWith('text:')), 'đã từ chối: không gửi')
    assert.equal((await input(l3.ids[0])).status, 'tạm dừng')
    const l4 = await make({ extra: { zaloOptOutLinkEnabled: true }, content: 'Chào #{STOP_MESSAGES_LINK}', targets: [{ name: 'Tú', uid: '4004' }] })
    const rl4 = await run(l4, { link: new Error('Không thể tạo link từ chối nhận tin Zalo: timeout') })
    assert.ok(rl4.lines.some(l => l.startsWith('⚠️ "Tú": Không thể tạo link từ chối nhận tin Zalo; vẫn tiếp tục gửi')), rl4.lines.join('\n'))
    assert.deepEqual(rl4.calls.filter(c => c.startsWith('text:')), [`text:4004:Chào ${E.STOP_MESSAGES_ERROR_URL}`], 'link lỗi: dùng trang thông báo lỗi')
    assert.equal((await details(l4.ids[0]))[0].data.messageOptOutSource, undefined, 'không có link thì không ghi nguồn')
    pass('link từ chối nhận tin: link riêng / chân trang, ghi nguồn cho trigger; đã từ chối thì chặn; tạo link lỗi thì cảnh báo và dùng trang lỗi')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${checks}/${checks} nhóm kiểm đạt`)
}

main().catch(error => { console.error(error); process.exit(1) })
