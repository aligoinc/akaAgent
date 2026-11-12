// V507: bỏ hẳn nhớ mục tiêu theo tài khoản (bảng auto_target_memory, cột remember_target_days, dòng cổng target_memory, đoạn kiểm / ghi
// trong claim_target_v1 / report_v1 / resolve_policy). Chạy lõi thật (packages/campaign-engine) + cổng Zalo giả trên PostgreSQL 17 cục bộ có
// đủ chuỗi V495 → V499 → … → V507. Cùng một kịch bản chạy trước V507 (còn nhớ), sau V507 (không nhớ, như bộ cũ), sau khi gỡ (nhớ lại).
// Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v507-smoke.cjs
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
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V507_TEST_PORT || 55507)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v507-'))
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
const ROLES = ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']
// Các cặp (mã, thao tác) dùng để so resolve_policy trước / sau: đủ loại mã đang nhớ, mã không nhớ, kết quả thành công.
const RESOLVE_CASES = [
  ['err_zalo_161_group_not_found', 'zalo_message_group'], ['err_zalo_user_not_found', 'zalo_find_phone_user'],
  ['err_zalo_receiver_blocks_stranger_message', 'zalo_message_stranger'], ['err_zalo_126_127_message_personal', 'zalo_message_stranger'],
  ['err_zalo_112_message_group', 'zalo_message_group'], ['err_undefined', 'zalo_message_phone'], [null, 'zalo_message_group']
]

async function main() {
  const E = await loadEngine()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v507-' })
  const db = await connect()
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/migration_v507_engine_drop_target_memory.sql'), 'utf8'), v507.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/rollback_v507_engine_drop_target_memory.sql'), 'utf8'), v507.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506]) await db.query(m.migration)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const md5s = async () => {
      const out = {}
      for (const [k, sig] of Object.entries(v507.SIG)) out[k] = await val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = $1::regprocedure`, [sig])
      return out
    }
    const state = async () => ({
      table: await val(`SELECT to_regclass('public.auto_target_memory')::text`),
      column: await val(`SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_outcome_policies'
        AND column_name = 'remember_target_days'`),
      gate: await val(`SELECT count(*)::int FROM public.auto_engine_gates WHERE code = 'target_memory'`),
      refs: await val(`SELECT count(*)::int FROM pg_proc WHERE prosrc ILIKE '%auto_target_memory%' OR prosrc ILIKE '%remember_target_days%'`),
      tagged: await val(`SELECT count(*)::int FROM public.auto_outcome_policy_history WHERE changed_by = $1`, [v507.HISTORY_TAG])
    })
    const privileges = async () => {
      const out = {}
      for (const [k, sig] of Object.entries(v507.SIG)) for (const role of ROLES) {
        out[`${k}:${role}`] = await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, sig])
      }
      return out
    }
    const resolveAll = async () => {
      const ok = await val(`SELECT id FROM public.auto_status WHERE code = 'campaign_detail_success' AND component_type = 'campaign_detail' ORDER BY id LIMIT 1`)
      const out = []
      for (const [code, action] of RESOLVE_CASES) {
        const p = await val(`SELECT public.aka_agent_engine_resolve_policy($1, $2, $3, NULL, 'fly', 'after_send')`, [code, code ? null : ok, action])
        const { policy_ids: _ids, revisions: _revs, ...rest } = p
        out.push(rest)
      }
      return out
    }

    // ---- Dữ liệu và bộ chạy (lõi thật, cổng Zalo giả) ----------------------------------------------------------------
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
    let nextId = 987000
    const STAFF = 9607, ORG = 697
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    const make = async ({ share = false, account = null, targets }) => {
      if (!account) {
        account = ++nextId
        await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
          OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      }
      const campaign = ++nextId
      const extra = { enableMessage: true, ...(share ? { zaloMessageSendMode: 'share' } : {}),
        actionLimits: { byActionCode: { [GROUP]: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } } }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
        extra_settings, images) OVERRIDING SYSTEM VALUE VALUES ($1, 'Nhắn group', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5,
        'Chào cả nhà', $6::jsonb, '[]'::jsonb)`, [campaign, GROUP, account, STAFF, ORG, JSON.stringify(extra)])
      for (const t of targets) {
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [++nextId, campaign, t.name, t.uid])
      }
      return { account, campaign, extra }
    }
    const zaloErr = (message, code) => E.zaloPortErrorFrom(Object.assign(new Error(message), { code }), { operation: 'send', answered: true })
    const bare = id => String(id).replace(/^g/i, '')
    const decisions = []
    const watchedData = { ...data, claimTarget: async ctx => { const res = await data.claimTarget(ctx); decisions.push(res?.actions ?? {}); return res } }
    const run = async (c, b = {}) => {
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
          if ((b.gone ?? []).includes(bare(threadId))) throw zaloErr('Group not found', '161')
          return { response: { msgId: `m-${threadId}` }, msgId: `m-${threadId}` }
        },
        prepareMedia: async () => [], sendMedia: async () => { throw new Error('không có tệp') },
        forwardMessage: async (_ctx, input) => {
          calls.push(`forward:${input.threadIds.join(',')}`)
          return { response: { ok: true }, results: input.threadIds.map(id => (b.gone ?? []).includes(id)
            ? { threadId: id, ok: false, errorCode: '161', errorMessage: 'Lỗi 161' } : { threadId: id, ok: true }) }
        },
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1
      }
      const core = { id: c.campaign, actionId: GROUP, accountId: c.account, content: 'Chào cả nhà', extraSettings: c.extra, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(GROUP)
      const shared = c.extra.zaloMessageSendMode === 'share'
      const result = await E.runUnit({ data: watchedData, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v507', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actionId: GROUP,
        campaignName: 'Nhắn group', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => (shared ? [] : type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } })),
        ...(shared ? { batch: type.buildBatch(core, port, { sleepBetweenBatchesSeconds: 0, readTimeoutMs: 5000, mediaTimeoutMs: 5000, sendTimeoutMs: 5000 }) } : {}),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [c.account, info.leaseToken, info.note ?? null]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      return { result, calls, lines }
    }
    const details = c => rows(`SELECT status, error_code, counts_toward_limit, log FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
    // Chiến dịch 1 gặp 161 ở group g7001; chiến dịch 2 cùng tài khoản gửi lại group đó và một group khác.
    const scenario = async (share = false) => {
      const first = await make({ share, targets: [{ name: 'Nhóm Cũ', uid: 'g7001' }] })
      await run(first, { gone: ['7001'] })
      const second = await make({ share, account: first.account, targets: [{ name: 'Nhóm Cũ', uid: 'g7001' }, { name: 'Nhóm Mới', uid: 'g7002' }] })
      decisions.length = 0
      const r2 = await run(second, { gone: ['7001'] })
      return { first: await details(first), second: await details(second), calls: r2.calls, skipDecisions: decisions.flatMap(d => Object.values(d)).filter(x => x?.decision === 'skip').length }
    }

    // ---- 1. Trước V507: nhớ theo tài khoản còn chạy --------------------------------------------------------------------
    const before = await state()
    assert.deepEqual([before.table, before.column, before.gate, before.tagged], ['auto_target_memory', 1, 1, 0])
    assert.equal(before.refs, 3, 'claim_target_v1, report_v1, resolve_policy')
    assert.deepEqual(await md5s(), v507.LIVE)
    const pre = await scenario()
    assert.deepEqual(pre.calls, ['text:7002'], 'trước V507: group đã nhớ không được gửi lại')
    assert.equal(pre.second.find(d => d.status === 'bỏ qua')?.log, 'Nhắn tin group: bỏ qua')
    assert.equal(pre.skipDecisions, 1)
    const policySnapshot = await rows(`SELECT id, remember_target_days, revision FROM public.auto_outcome_policies WHERE remember_target_days IS NOT NULL ORDER BY id`)
    const revisionsBefore = await rows(`SELECT id, revision FROM public.auto_outcome_policies ORDER BY id`)
    const historyBefore = Number(await val(`SELECT count(*) FROM public.auto_outcome_policy_history`))
    const privBefore = await privileges()
    const resolveBefore = await resolveAll()
    assert.ok(resolveBefore.every(p => 'remember_target_days' in p))
    assert.ok(policySnapshot.some(p => p.remember_target_days === 30) && policySnapshot.some(p => p.remember_target_days === 0))
    pass(`trước V507: nhớ theo tài khoản còn chạy (group 161 bị bỏ qua); ${policySnapshot.length} dòng chính sách có remember_target_days`)

    // ---- 2. Apply / chặn chạy lại -----------------------------------------------------------------------------------------
    await db.query(v507.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await state(), before, 'apply trong transaction rồi ROLLBACK không để lại gì')
    await db.query(v507.migration)
    const after = await state()
    assert.deepEqual([after.table, after.column, after.gate, after.refs, after.tagged], [null, 0, 0, 0, policySnapshot.length])
    assert.deepEqual(await md5s(), v507.NEW)
    assert.deepEqual(await privileges(), privBefore, 'quyền của 3 hàm giữ nguyên')
    const resolveAfter = await resolveAll()
    assert.deepEqual(resolveAfter, resolveBefore.map(({ remember_target_days: _r, ...rest }) => rest), 'resolve_policy chỉ mất trường remember_target_days')
    assert.deepEqual(await rows(`SELECT id, revision FROM public.auto_outcome_policies ORDER BY id`), revisionsBefore, 'không tăng revision chính sách')
    await assert.rejects(db.query(v507.migration), /V507 đã chạy/)
    await db.query('ROLLBACK')
    pass('apply trong transaction rồi ROLLBACK không đổi gì; apply thật xoá bảng, cột, dòng cổng, mọi tham chiếu; quyền, revision và các trường khác của resolve_policy giữ nguyên; chạy lại bị chặn')

    // ---- 3. Sau V507: không còn bỏ qua, chạy như bộ cũ ---------------------------------------------------------------------
    const post = await scenario()
    assert.deepEqual(post.calls, ['text:7001', 'text:7002'], 'sau V507: group đã gặp 161 được gửi lại như bộ cũ')
    assert.equal(post.skipDecisions, 0, 'claim không còn quyết định bỏ qua')
    assert.ok(!post.second.some(d => d.status === 'bỏ qua'))
    assert.deepEqual(post.second.map(d => d.status), [post.first[0].status, 'thành công'], 'gặp lại 161 thì ghi như lần đầu')
    assert.deepEqual(post.first, pre.first, 'lần gặp 161 đầu tiên ghi y như trước V507')
    const share = await scenario(true)
    assert.deepEqual(share.calls, ['forward:7001,7002'], 'gửi dạng chia sẻ: cả hai group vào cùng lô')
    assert.equal(share.skipDecisions, 0)
    assert.ok(!share.second.some(d => d.status === 'bỏ qua'))
    pass('sau V507: group đã gặp 161 được gửi lại và ghi "không tồn tại" như bộ cũ, cả gửi thường lẫn gửi dạng chia sẻ; không còn quyết định bỏ qua')

    // ---- 4. Gỡ: trả đúng như trước, nhớ chạy lại; apply lại được --------------------------------------------------------------
    await db.query(v507.rollback)
    const back = await state()
    assert.deepEqual([back.table, back.column, back.gate, back.refs, back.tagged], ['auto_target_memory', 1, 1, 3, 0])
    assert.deepEqual(await md5s(), v507.LIVE)
    assert.deepEqual(await rows(`SELECT id, remember_target_days, revision FROM public.auto_outcome_policies WHERE remember_target_days IS NOT NULL ORDER BY id`),
      policySnapshot, 'giá trị cũ của cột và revision trả đúng')
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_policy_history`)), historyBefore, 'gỡ không để lại dòng lịch sử thừa')
    assert.deepEqual(await privileges(), privBefore)
    assert.deepEqual(await resolveAll(), resolveBefore)
    assert.equal(await val(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auto_target_memory'::regclass`), true)
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await val(`SELECT has_table_privilege($1, 'public.auto_target_memory', 'SELECT')`, [role]), false, role)
    }
    const again = await scenario()
    assert.deepEqual(again.calls, ['text:7002'], 'sau khi gỡ: nhớ theo tài khoản chạy lại')
    await assert.rejects(db.query(v507.rollback), /chưa có V507/)
    await db.query('ROLLBACK')
    await db.query(v507.migration)
    assert.equal((await state()).table, null)
    pass('gỡ trả bảng (rỗng, RLS, không cấp anon/authenticated), cột với đúng giá trị và revision cũ, dòng cổng, thân 3 hàm; nhớ chạy lại; apply lại được')

    console.log(`OK V507: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
