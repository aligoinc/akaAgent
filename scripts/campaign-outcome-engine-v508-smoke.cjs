// V508: Zalo 126/127 khi nhắn group xử lý như group chặn riêng tài khoản (data hoàn thành, không tính lượt, không đếm chuỗi, không khoá,
// không tạm dừng, chạy tiếp group sau). Chạy lõi thật (packages/campaign-engine) + cổng Zalo giả trên PostgreSQL 17 cục bộ có đủ chuỗi
// V495 → … → V508; cùng kịch bản trước V508 (Q4), sau V508, sau khi gỡ. Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-v508-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const v504 = require('./build-v504-sql.cjs')
const v505 = require('./build-v505-sql.cjs')
const v506 = require('./build-v506-sql.cjs')
const v507 = require('./build-v507-sql.cjs')
const v508 = require('./build-v508-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V508_TEST_PORT || 55508)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v508-'))
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

const GROUP = 'zalo_message_group'

async function main() {
  const E = await loadEngine()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v508-' })
  const db = await connect()
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/migration_v508_zalo_group_126_127_per_group.sql'), 'utf8'), v508.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/rollback_v508_zalo_group_126_127_per_group.sql'), 'utf8'), v508.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506, v507]) await db.query(m.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const policy = async () => {
      const p = await val(`SELECT public.aka_agent_engine_resolve_policy('err_zalo_126_127_message_group', NULL, $1, NULL, 'fly', 'after_send')`, [GROUP])
      return { streak: p.target_streak_effect, camp: p.campaign_effect, target: p.target_effect, lock: p.lock_action_codes, run: p.run_effect, quota: p.quota_effect }
    }
    // Chính sách đã gộp của mọi cặp (mã, thao tác) Zalo, để chứng minh chỉ đúng một cặp đổi.
    const allPairs = async () => rows(`SELECT pair.error_code, pair.action_code,
        public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, 'fly', 'after_send') - 'revisions' AS p
      FROM (SELECT DISTINCT r.error_code, a.code AS action_code FROM public.auto_outcome_signal_rules r
              JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
             WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair ORDER BY 1, 2`)

    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      reportBatch: (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r',
        [tok, JSON.stringify(items), size, stopped]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 988000
    const STAFF = 9608, ORG = 698
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const make = async ({ share = false, groups }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      const extra = { enableMessage: true, ...(share ? { zaloMessageSendMode: 'share' } : {}),
        actionLimits: { byActionCode: { [GROUP]: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } } }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
        extra_settings, images) OVERRIDING SYSTEM VALUE VALUES ($1, 'Nhắn group', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5,
        'Chào cả nhà', $6::jsonb, '[]'::jsonb)`, [campaign, GROUP, account, STAFF, ORG, JSON.stringify(extra)])
      for (const g of groups) {
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [++nextId, campaign, `Nhóm ${g}`, `g${g}`])
      }
      return { account, campaign, extra }
    }
    const zaloErr = (message, code) => E.zaloPortErrorFrom(Object.assign(new Error(message), { code }), { operation: 'send', answered: true })
    const bare = id => String(id).replace(/^g/i, '')
    const run = async (c, refuse) => {
      const calls = [], lines = []
      const port = {
        getUserProfile: async (_ctx, uid) => E.normalizeZaloFoundUser({ userId: uid, display_name: `Nhóm ${uid}` }),
        saveResolvedProfile: async () => {},
        isOptedOut: async () => false,
        prepareOptOutLink: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
        takeContentIndex: async () => 0,
        businessNow: async () => new Date(),
        sendText: async (_ctx, threadId) => {
          calls.push(`text:${bare(threadId)}`)
          if (refuse.includes(bare(threadId))) throw zaloErr('Tin nhắn bị trùng lặp hoặc gửi quá nhanh', '127')
          return { response: { msgId: `m-${threadId}` }, msgId: `m-${threadId}` }
        },
        prepareMedia: async () => [], sendMedia: async () => { throw new Error('không có tệp') },
        forwardMessage: async (_ctx, input) => {
          calls.push(`forward:${input.threadIds.join(',')}`)
          return { response: { ok: true }, results: input.threadIds.map(id => refuse.includes(id)
            ? { threadId: id, ok: false, errorCode: '127', errorMessage: 'Lỗi 127' } : { threadId: id, ok: true }) }
        },
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1
      }
      const core = { id: c.campaign, actionId: GROUP, accountId: c.account, content: 'Chào cả nhà', extraSettings: c.extra, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(GROUP)
      const shared = c.extra.zaloMessageSendMode === 'share'
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v508', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actionId: GROUP,
        campaignName: 'Nhắn group', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => (shared ? [] : type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } })),
        ...(shared ? { batch: type.buildBatch(core, port, { sleepBetweenBatchesSeconds: 0, readTimeoutMs: 5000, mediaTimeoutMs: 5000, sendTimeoutMs: 5000 }) } : {}),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [c.account, info.leaseToken, info.note ?? null]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      const state = {
        calls,
        inputs: (await rows(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])).map(r => r.status),
        details: (await rows(`SELECT status, error_code, counts_toward_limit FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [c.campaign]))
          .map(d => `${d.status}|${d.error_code ?? '-'}|${d.counts_toward_limit}`),
        locked: Number(await val(`SELECT count(*) FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable`, [c.account])),
        streak: Number(await val(`SELECT coalesce((SELECT count_consecutive_bad_targets FROM public.auto_campaign_error_state WHERE campaign_id = $1), 0)`, [c.campaign])),
        campaign: await val(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
      }
      return { result, lines, ...state }
    }
    const FAILED_127 = 'thất bại|err_zalo_126_127_message_group|false'

    // ---- 1. Trước V508 (Q4): 127 coi là tài khoản bị hãm tốc ------------------------------------------------------------
    assert.deepEqual(await policy(), { streak: 'increment', camp: 'pause', target: 'requeue', lock: ['zalo_message_group'], run: 'end_unit', quota: 'no_count' })
    const pre = await run(await make({ groups: ['1', '2', '3'] }), ['1', '3'])
    assert.deepEqual(pre.calls, ['text:1'], 'Q4: group đầu bị 127 thì khoá nhắn group, kết thúc lượt, group 2 và 3 chưa chạy')
    assert.deepEqual(pre.inputs, ['chờ xử lý', 'chờ xử lý', 'chờ xử lý'])
    assert.equal(pre.locked, 1)
    const pairsBefore = await allPairs()
    pass('trước V508 (Q4): một group bị 127 làm khoá nhắn group 30 phút cả tài khoản, data về hàng đợi, kết thúc lượt')

    // ---- 2. Apply / chặn chạy lại / gỡ ----------------------------------------------------------------------------------
    await db.query(v508.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal((await policy()).camp, 'pause', 'apply trong transaction rồi ROLLBACK không đổi gì')
    await db.query(v508.migration)
    assert.deepEqual(await policy(), { streak: 'ignore', camp: 'none', target: 'complete', lock: [], run: 'continue', quota: 'no_count' })
    const pairsAfter = await allPairs()
    const changed = pairsAfter.filter((p, i) => JSON.stringify(p.p) !== JSON.stringify(pairsBefore[i].p)).map(p => `${p.error_code}/${p.action_code}`)
    assert.deepEqual(changed, ['err_zalo_126_127_message_group/zalo_message_group'], 'chỉ đúng một cặp (mã, thao tác) đổi')
    assert.equal(Number(await val(`SELECT revision FROM public.auto_outcome_policies WHERE error_code = 'err_zalo_126_127_message_group'
      AND action_code = $1`, [GROUP])), 2, 'lịch sử chính sách ghi lần sửa (revision 2)')
    await assert.rejects(db.query(v508.migration), /khác bản V500/)
    await db.query('ROLLBACK')
    await db.query(v508.rollback)
    assert.deepEqual(await policy(), { streak: 'increment', camp: 'pause', target: 'requeue', lock: ['zalo_message_group'], run: 'end_unit', quota: 'no_count' })
    assert.deepEqual((await allPairs()).map(p => p.p), pairsBefore.map(p => p.p), 'gỡ trả mọi cặp về như trước')
    await assert.rejects(db.query(v508.rollback), /chưa có V508/)
    await db.query('ROLLBACK')
    await db.query(v508.migration)
    pass('apply trong transaction rồi ROLLBACK không đổi gì; apply thật chỉ đổi đúng cặp 126/127 × nhắn group; chạy lại bị chặn; gỡ trả đúng Q4; apply lại được')

    // ---- 3. Sau V508: gửi thường ----------------------------------------------------------------------------------------
    const normal = await run(await make({ groups: ['1', '2', '3'] }), ['1', '3'])
    assert.deepEqual(normal.calls, ['text:1', 'text:2', 'text:3'], 'chạy tiếp group sau')
    assert.deepEqual(normal.details, [FAILED_127, 'thành công|-|true', FAILED_127], '127: "thất bại", không tính lượt')
    assert.deepEqual(normal.inputs, ['hoàn thành', 'hoàn thành', 'hoàn thành'], 'data hoàn thành, không về hàng đợi')
    assert.deepEqual([normal.locked, normal.streak, normal.campaign], [0, 0, 'hoàn thành'], 'không khoá, không đếm chuỗi, chiến dịch hoàn thành')
    const streakRun = await run(await make({ groups: ['1', '2', '3', '4', '5'] }), ['1', '2', '3', '4'])
    assert.deepEqual(streakRun.calls, ['text:1', 'text:2', 'text:3', 'text:4', 'text:5'])
    assert.deepEqual([streakRun.locked, streakRun.streak, streakRun.campaign], [0, 0, 'hoàn thành'], '4 group liền bị 127: không tạm dừng chiến dịch')
    pass('sau V508, gửi thường: group bị 127 ghi "thất bại" không tính lượt, data hoàn thành, không khoá, không đếm chuỗi; 4 group liền bị 127 vẫn chạy hết, chiến dịch hoàn thành')

    // ---- 4. Sau V508: gửi dạng chia sẻ ------------------------------------------------------------------------------------
    const share = await run(await make({ share: true, groups: ['1', '2', '3'] }), ['1'])
    assert.deepEqual(share.calls, ['forward:1,2,3'])
    assert.deepEqual(share.inputs, ['hoàn thành', 'hoàn thành', 'hoàn thành'], 'group bị 127 trong lô không về hàng đợi')
    assert.equal(share.details.filter(d => d === FAILED_127).length, 1)
    assert.deepEqual([share.locked, share.campaign], [0, 'hoàn thành'])
    const only = await run(await make({ share: true, groups: ['9'] }), ['9'])
    assert.deepEqual([only.inputs, only.campaign], [['hoàn thành'], 'tạm dừng'], 'lô chỉ có group bị 127: luật lô của Desktop vẫn tạm dừng chiến dịch')
    pass('sau V508, gửi dạng chia sẻ: group bị 127 trong lô hoàn thành, không khoá; lô mà cả lô thất bại vẫn tạm dừng theo luật lô của Desktop')

    // ---- 5. Apply riêng trên chuỗi production hiện tại (V495–V501, chưa có V503–V507) -----------------------------------
    const alone = startCluster({ port: PORT + 30, label: 'aka-v508-alone-' })
    const db2 = await alone.connect()
    try {
      await buildFixture(db2, [])
      await db2.query(MIGRATION)
      await db2.query(v499.migration)
      await db2.query(V500)
      await db2.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
      await db2.query(v501.migration)
      const policy2 = async runtime => {
        const p = (await db2.query(`SELECT public.aka_agent_engine_resolve_policy('err_zalo_126_127_message_group', NULL, $1, NULL, $2,
          'after_send') AS r`, [GROUP, runtime])).rows[0].r
        return { streak: p.target_streak_effect, camp: p.campaign_effect, target: p.target_effect, lock: p.lock_action_codes, run: p.run_effect, quota: p.quota_effect }
      }
      const Q4 = { streak: 'increment', camp: 'pause', target: 'requeue', lock: ['zalo_message_group'], run: 'end_unit', quota: 'no_count' }
      const AFTER = { streak: 'ignore', camp: 'none', target: 'complete', lock: [], run: 'continue', quota: 'no_count' }
      for (const rt of ['desktop', 'fly']) assert.deepEqual(await policy2(rt), Q4)
      await db2.query(v508.migration)
      for (const rt of ['desktop', 'fly']) assert.deepEqual(await policy2(rt), AFTER)
      await db2.query(v508.rollback)
      for (const rt of ['desktop', 'fly']) assert.deepEqual(await policy2(rt), Q4)
    } finally {
      await db2.end().catch(() => {})
      alone.stop()
    }
    pass('apply và gỡ được ngay trên chuỗi production hiện tại (V495–V501), không cần V503–V507; cả Desktop lẫn Fly')

    console.log(`OK V508: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
