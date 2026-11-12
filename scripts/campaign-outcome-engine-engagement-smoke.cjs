// Theo dõi tương tác Zalo trong engine v2 (V339 / V510): lõi thật + cổng giả trên PostgreSQL 17 cục bộ có đủ chuỗi V495 → … → V509 → V512.
// Kiểm như dòng lịch sử của bộ chạy cũ: giữ chỗ trước khi gửi, nguồn (UID tài khoản / người nhận, mã tin, phiên bản, giờ gửi) và cờ chờ
// đăng ký trong dòng lịch sử, giữ nguồn trước khi báo, đăng ký đúng mã dòng sau khi DB ghi, bỏ giữ chỗ khi gửi lỗi; kết bạn; nhắn group
// không theo dõi; công tắc bật mà nơi chạy không ghi được nguồn thì chiến dịch nhắn tin chạy bộ cũ. Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-engagement-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const chain = ['499', '501', '503', '504', '505', '506', '507', '508', '509', '512'].map(n => require(`./build-v${n}-sql.cjs`))
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.ENGAGEMENT_TEST_PORT || 55513)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-engagement-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

const HEARTBEAT_MS = 61000
function testClock() {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms === HEARTBEAT_MS) return signal?.addEventListener('abort', () => resolve(false), { once: true })
      setImmediate(() => resolve(!signal?.aborted))
    })
  }
}

async function main() {
  const E = await loadEngine()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-engagement-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(chain[0].migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of chain.slice(1)) await db.query(m.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 991000
    const STAFF = 9613, ORG = 713
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const make = async ({ actionId = 'zalo_message_phone', extra = { enableMessage: true }, inputs = [{ phone: '0912000001' }] } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
        extra_settings, images) OVERRIDING SYSTEM VALUE VALUES ($1, 'Thử', $2, $3, 'chờ xử lý', now() - interval '1 minute', false,
        $4, $5, 'Chào bạn', $6::jsonb, '[]'::jsonb)`, [campaign, actionId, account, STAFF, ORG, JSON.stringify(extra)])
      for (const input of inputs) {
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Khách', $3, $4, 'chờ xử lý', false)`, [++nextId, campaign, input.phone ?? null, input.uid ?? null])
      }
      return { account, campaign, actionId, extra }
    }
    // Cổng giả kiểu Desktop: theo dõi tương tác với nhật ký thao tác.
    const run = async (c, { fail = null, engagementOn = true } = {}) => {
      const events = []
      let operation = 0
      const port = {
        findUser: async (_ctx, phone) => E.normalizeZaloFoundUser({ userId: `uid-${phone}`, display_name: 'Lan', zalo_name: 'Lan', globalId: `g-${phone}` }),
        getUserProfile: async (_ctx, uid) => E.normalizeZaloFoundUser({ userId: uid, display_name: 'Bạn', zalo_name: 'Bạn' }),
        phoneSearchLimitScope: async () => null, saveFoundUser: async () => {}, saveResolvedProfile: async () => {},
        isOptedOut: async () => false, takeContentIndex: async () => 0, businessNow: async () => new Date(),
        sendText: async (_ctx, uid) => {
          events.push(`send:${uid}`)
          if (fail === 'text') throw E.zaloPortErrorFrom(Object.assign(new Error('Người nhận chặn'), { code: 122 }), { operation: 'send', answered: true })
          return { response: { message: { msgId: `m-${uid}` } }, msgId: `m-${uid}` }
        },
        prepareMedia: async () => [], sendMedia: async () => ({ response: {}, msgId: null }),
        sendFriendRequest: async (_ctx, uid) => { events.push(`friend:${uid}`); return { ok: true } },
        rewriteMessage: async (_ctx, content) => content,
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1,
        ...(engagementOn ? {
          engagementBegin: (_ctx, uid) => { const op = `op-${++operation}`; events.push(`begin:${uid}:${op}`)
            return { revision: '2026-11-12T11:02:06.561Z', sentAt: '2026-11-12T12:00:00.000Z', accountZaloUid: 'own-1', operationId: op,
              detailData: { zaloEngagementRuntime: 'chat' } } },
          engagementAbandon: (_ctx, send) => events.push(`abandon:${send.operationId}`),
          engagementStage: (_ctx, source) => events.push(`stage:${source.targetZaloUid}:${source.messageIds.join(',')}`),
          engagementRegister: (detailId, source) => events.push(`register:${detailId}:${source.actionType}`)
        } : {})
      }
      const core = { id: c.campaign, actionId: c.actionId, accountId: c.account, content: 'Chào bạn', extraSettings: c.extra, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(c.actionId)
      const afterReport = type.afterReport?.(core, port, { targetLabel: type.targetLabel }) ?? undefined
      await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: () => {}, trace: () => {} } }, {
        runnerId: 'desktop:engagement', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign,
        campaignName: 'Thử', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } }),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        ...(afterReport ? { afterReport } : {}),
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) AS r', [c.account, info.leaseToken]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      const details = await rows(`SELECT id, action_code, status, data FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
      return { events, details }
    }

    // ---- 1. Nhắn tin theo SĐT, gửi được --------------------------------------------------------------------------------------
    const ok = await run(await make())
    const sent = ok.details.find(d => d.action_code === 'zalo_message_stranger')
    assert.ok(sent, 'có dòng nhắn người lạ')
    assert.deepEqual(sent.data.zaloEngagementSource, { version: 1, operationId: 'op-1', accountZaloUid: 'own-1', targetZaloUid: 'uid-0912000001',
      actionType: 'message', sentAt: '2026-11-12T12:00:00.000Z', messageIds: ['m-uid-0912000001'], revision: '2026-11-12T11:02:06.561Z' })
    assert.equal(sent.data.zaloEngagementPending, true)
    assert.equal(sent.data.zaloEngagementRuntime, 'chat', 'trường của nơi chạy (Fly) vào dòng lịch sử')
    assert.deepEqual(ok.events, ['begin:uid-0912000001:op-1', 'send:uid-0912000001', 'stage:uid-0912000001:m-uid-0912000001',
      `register:${sent.id}:message`], 'giữ chỗ trước khi gửi, giữ nguồn trước khi báo, đăng ký đúng dòng sau khi ghi')
    pass('nhắn tin theo SĐT: nguồn tương tác (mã tin, giờ gửi, phiên bản) và cờ chờ đăng ký trong dòng lịch sử như bộ cũ; thứ tự giữ chỗ → gửi → giữ nguồn → đăng ký đúng dòng')

    // ---- 2. Gửi lỗi: bỏ giữ chỗ, không có nguồn --------------------------------------------------------------------------------
    const bad = await run(await make(), { fail: 'text' })
    assert.deepEqual(bad.events, ['begin:uid-0912000001:op-1', 'send:uid-0912000001', 'abandon:op-1'])
    assert.ok(bad.details.every(d => d.data.zaloEngagementSource === undefined && d.data.zaloEngagementPending === undefined))
    pass('gửi lỗi: bỏ giữ chỗ (abandonCampaignEngagementSend), dòng lịch sử không có nguồn, không đăng ký')

    // ---- 3. Kết bạn ------------------------------------------------------------------------------------------------------------
    const friend = await run(await make({ extra: { enableAddFriend: true, friendRequestMessage: 'Kết bạn nhé' } }))
    const req = friend.details.find(d => d.action_code === 'zalo_add_friend')
    assert.ok(req, 'có dòng kết bạn')
    assert.equal(req.data.zaloEngagementSource.actionType, 'friend_request')
    assert.deepEqual(req.data.zaloEngagementSource.messageIds, [])
    assert.ok(friend.events.includes(`register:${req.id}:friend_request`))
    pass('kết bạn: nguồn friend_request không có mã tin, đăng ký đúng dòng')

    // ---- 4. Nhắn group không theo dõi; nơi chạy không ghi được nguồn thì không có gì ----------------------------------------------
    const group = await run(await make({ actionId: 'zalo_message_group', extra: {}, inputs: [{ uid: 'g123' }] }))
    assert.equal(group.events.filter(e => e.startsWith('begin') || e.startsWith('register')).length, 0, 'nhắn group không theo dõi')
    const off = await run(await make(), { engagementOn: false })
    assert.ok(off.details.every(d => d.data.zaloEngagementSource === undefined))
    pass('nhắn group không theo dõi tương tác (như Desktop); cổng không có hàm theo dõi thì dòng lịch sử không có nguồn')

    // ---- 5. Điều kiện chạy bộ mới khi công tắc bật -------------------------------------------------------------------------------
    const c = { id: 1, actionId: 'zalo_message_phone', accountId: 1, content: 'x', extraSettings: { enableMessage: true }, images: [] }
    const share = { id: 2, actionId: 'zalo_message_friend', accountId: 1, content: 'x', extraSettings: { zaloMessageSendMode: 'share' }, images: [] }
    assert.deepEqual(E.zaloCampaignV2Support(c, { engagementTrackingEnabled: true }), { ok: false, reason: 'engagement_tracking' })
    assert.deepEqual(E.zaloCampaignV2Support(c, { engagementTrackingEnabled: true, engagementSupported: true }), { ok: true })
    assert.deepEqual(E.zaloCampaignV2Support(share, { engagementTrackingEnabled: true }), { ok: false, reason: 'engagement_tracking' })
    assert.equal(E.zaloCampaignV2Support(share, { engagementTrackingEnabled: true, engagementSupported: true }).reason === 'engagement_tracking', false)
    pass('công tắc theo dõi bật: nơi chạy ghi được nguồn thì chạy bộ mới (gửi thường và chia sẻ cho bạn bè), không ghi được thì về bộ cũ như trước')

    console.log(`OK theo dõi tương tác: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
