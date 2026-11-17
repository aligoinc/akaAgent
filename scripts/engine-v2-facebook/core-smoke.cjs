// Lõi engine v2, chế độ workflow (Facebook): runUnit thật + RPC thật (V495 → V532 + V556–V558) trên PostgreSQL 17 cục bộ, nơi chạy
// workflow giả (không Electron, không Facebook). Kiểm các bất biến của phương án: chỉ bấm sau khi có dấu "sắp gửi", mỗi mốc một kết quả,
// dừng ở ranh giới mốc (Q2), lỗi nơi chạy / cửa sổ chết sau dấu thì "không rõ kết quả" (không gửi lại), lượt theo lịch mỗi mốc một lần.
//   node scripts/engine-v2-facebook/core-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations } = require('./fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_CORE_PORT || 55554)
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-fb-core-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

/** Đồng hồ thử: mọi lần nghỉ trả về ngay, trừ nhịp heartbeat (chờ tới khi bị huỷ). */
function testClock(heartbeatMs) {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms !== heartbeatMs) return setImmediate(() => resolve(!signal?.aborted))
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
  }
}

async function main() {
  const E = await loadEngine()
  const cluster = startCluster({ port: PORT, label: 'aka-fb-core-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const port = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok]),
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)])
    }
    const HEARTBEAT_MS = 61_237
    const STAFF = 9101, ORG = 601
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'FB lõi') ON CONFLICT DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, 'fbcore', 'pw')`, [STAFF, ORG])
    await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
      VALUES ($1, 3, 'paid', now() + interval '30 days')`, [ORG])
    await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.facebook'`, [JSON.stringify({ mode: 'orgs', organizationIds: [ORG] })])

    let nextId = 980000
    const makeCampaign = async ({ actionId = 'facebook_group_post', targets = 2 } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`,
        [account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
          extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB lõi', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5, 'daily', '{}')`,
        [campaign, actionId, account, STAFF, ORG])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Nhóm ${i + 1}`, `g${id}`])
        ids.push(id)
      }
      return { account, campaign, ids }
    }
    const run = async (entry, workflow, extra = {}) => {
      const lines = [], traces = []
      const controller = new AbortController()
      const result = await E.runUnit({ data: port, journal: new E.MemoryJournal(), clock: testClock(HEARTBEAT_MS),
        events: { progress: l => lines.push(l.text), trace: t => traces.push(t) } }, {
        runnerId: 'desktop:fbcore', runtimeTarget: 'desktop', staffId: STAFF, accountId: entry.account, campaignId: entry.campaign,
        campaignName: 'FB lõi', accountName: 'FB', actions: extra.actions ?? [{ code: 'fb_post_group' }, { code: 'fb_comment', required: false }],
        buildSteps: () => [], pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, drainTimeoutMs: 2000,
        retry: { ...E.DEFAULT_RETRY, baseDelayMs: 1, maxDelayMs: 2, callTimeoutMs: 5000 },
        workflow, ...extra.cfg
      }, controller.signal)
      return { result, lines, traces }
    }
    const status = async id => (await one('SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1', [id]))
    const details = async campaign => (await db.query(`SELECT input_data_id, action_code, status, result_key FROM public.auto_campaign_details
      WHERE campaign_id = $1 ORDER BY id`, [campaign])).rows
    const POST = { key: 'post', actionCode: 'fb_post_group', actionName: 'Đăng bài' }
    const comment = i => ({ key: `comment#${i}`, actionCode: 'fb_comment', actionName: 'Comment' })

    await check('workflow: đăng bài + 2 comment, mỗi mốc ghi dấu trước khi bấm, lõi tự chốt data', async () => {
      const entry = await makeCampaign()
      const clicks = []
      const { result } = await run(entry, {
        runTarget: async api => {
          for (const step of [POST, comment(0), comment(1)]) {
            if (api.shouldStop()) return { done: true }
            const mark = await api.beginMilestone(step)
            if (mark !== 'ok') return mark.stop ? mark : { done: true }
            clicks.push(`${api.target.id}:${step.key}`)
            const res = await api.reportMilestone(step, step.key === 'comment#1'
              ? { ok: false, phase: 'after_send', statusCode: 'campaign_detail_failed', signal: { kind: 'block', code: 'status:campaign_detail_failed' } }
              : { ok: true, customerLog: `ok ${step.key}` })
            if ('stop' in res) return res
          }
          return { done: true }
        }
      })
      assert.equal(result.reason, 'no_target'); assert.equal(result.targets, 2)
      assert.equal(clicks.length, 6)
      for (const id of entry.ids) assert.equal((await status(id)).status, 'hoàn thành')
      const rows = await details(entry.campaign)
      assert.equal(rows.length, 6)
      const marks = (await db.query(`SELECT marks FROM public.auto_engine_target_runs WHERE campaign_id = $1`, [entry.campaign])).rows
      for (const m of marks) assert.ok(m.marks.every(x => x.state !== 'pending'), 'không còn dấu treo')
    })
    await check('Q2: tạm dừng giữa data thì dừng sau mốc đang chạy; data đã gửi một mốc thì hoàn thành, không chạy tiếp', async () => {
      const entry = await makeCampaign({ targets: 2 })
      let pause = false
      const clicks = []
      const { result } = await run(entry, {
        runTarget: async api => {
          for (const step of [POST, comment(0), comment(1)]) {
            if (api.shouldStop()) return { done: true }
            assert.equal(await api.beginMilestone(step), 'ok')
            clicks.push(step.key)
            await api.reportMilestone(step, { ok: true })
            if (step.key === 'post') pause = true
          }
          return { done: true }
        }
      }, { cfg: { shouldStopAfterTarget: () => pause } })
      assert.equal(result.reason, 'stopped')
      assert.deepEqual(clicks, ['post'])
      assert.equal((await status(entry.ids[0])).status, 'hoàn thành')
      assert.equal((await status(entry.ids[1])).status, 'chờ xử lý', 'data sau chưa nhận')
    })
    await check('dừng trước mốc đầu tiên: data về hàng đợi (đã dừng), không ghi lịch sử', async () => {
      const entry = await makeCampaign({ targets: 1 })
      const { result } = await run(entry, { runTarget: async () => ({ done: true }) }, { cfg: { shouldStopAfterTarget: (() => { let n = 0; return () => n++ > 0 })() } })
      assert.equal(result.reason, 'stopped')
      assert.equal((await status(entry.ids[0])).status, 'chờ xử lý')
      assert.equal((await details(entry.campaign)).length, 0)
    })
    await check('nơi chạy lỗi sau khi ghi dấu (cửa sổ ẩn chết): không rõ kết quả, data đóng, không gửi lại', async () => {
      const entry = await makeCampaign({ targets: 1 })
      let attempts = 0
      const { result } = await run(entry, {
        runTarget: async api => {
          attempts++
          assert.equal(await api.beginMilestone(POST), 'ok')
          throw new Error('render-process-gone')
        }
      })
      assert.equal(attempts, 1)
      assert.equal(result.reason, 'no_target')
      assert.equal((await status(entry.ids[0])).status, 'hoàn thành')
      const out = await one(`SELECT o.delivery_state, o.phase, o.error_code FROM public.auto_engine_outcomes o JOIN public.auto_engine_target_runs r
        ON r.id = o.target_run_id WHERE r.campaign_id = $1`, [entry.campaign])
      assert.equal(out.phase, 'in_flight'); assert.equal(out.delivery_state, 'unknown')
    })
    await check('nơi chạy lỗi trước mốc nào: lỗi trước khi gửi, data về hàng đợi', async () => {
      const entry = await makeCampaign({ targets: 1 })
      await run(entry, { runTarget: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) } })
      // Mã cụ thể (NET01 → về hàng đợi) do luật phân loại Facebook của V559; ở đây chỉ kiểm pha và chưa giao.
      const out = await one(`SELECT o.phase, o.delivery_state FROM public.auto_engine_outcomes o JOIN public.auto_engine_target_runs r ON r.id = o.target_run_id
        WHERE r.campaign_id = $1`, [entry.campaign])
      assert.equal(out.phase, 'before_send'); assert.equal(out.delivery_state, 'not_delivered')
    })
    await check('workflow chạy hết mà không báo mốc nào: no_outcome (không "thành công giả")', async () => {
      const entry = await makeCampaign({ targets: 1 })
      await run(entry, { runTarget: async () => ({ done: true }) })
      const out = await one(`SELECT o.error_code FROM public.auto_engine_outcomes o JOIN public.auto_engine_target_runs r ON r.id = o.target_run_id
        WHERE r.campaign_id = $1`, [entry.campaign])
      assert.equal(out.error_code, 'err_engine_no_outcome')
    })
    await check('nhiều kết quả của một block (mời theo lô) báo một lần', async () => {
      const entry = await makeCampaign({ actionId: 'facebook_group_invite', targets: 1 })
      await run(entry, {
        runTarget: async api => {
          const step = { key: 'invite', actionCode: 'fb_group_invite' }
          assert.equal(await api.beginMilestone(step), 'ok')
          const res = await api.reportMilestones([0, 1, 2].map(k => ({ step: k ? { ...step, key: `invite:${k}` } : step,
            raw: k === 2 ? { ok: false, phase: 'after_send', signal: { kind: 'block', code: 'status:campaign_detail_failed' } } : { ok: true } })))
          assert.equal(res.ok, true); assert.equal(res.outcomes.length, 3)
          return { done: true }
        }
      }, { actions: [{ code: 'fb_group_invite' }] })
      assert.equal((await details(entry.campaign)).length, 3)
    })
    await check('lượt theo lịch: trang cá nhân chạy một lần mỗi mốc, data giả không có id', async () => {
      const entry = await makeCampaign({ actionId: 'facebook_timeline_post', targets: 0 })
      const seen = []
      const { result } = await run(entry, {
        slotMode: true,
        runTarget: async api => {
          seen.push(api.target)
          const step = { key: 'post', actionCode: 'fb_post_my_profile' }
          assert.equal(await api.beginMilestone(step), 'ok')
          await api.reportMilestone(step, { ok: true })
          return { done: true }
        }
      }, { actions: [{ code: 'fb_post_my_profile' }] })
      assert.equal(seen.length, 1); assert.equal(seen[0].id, null); assert.ok(seen[0].slotAt)
      assert.equal(result.reason, 'no_target')
      const rows = await details(entry.campaign)
      assert.equal(rows.length, 1); assert.equal(rows[0].input_data_id, null)
    })
    await check('nhận thêm data vào lượt (chia sẻ kèm): nơi chạy không chốt thì lõi chốt: đã ghi dấu → không rõ kết quả, chưa ghi dấu → về hàng đợi', async () => {
      const entry = await makeCampaign({ targets: 4 })
      const [main, a, b] = entry.ids
      let claimed = null
      const { result, traces } = await run(entry, {
        runTarget: async api => {
          if (api.target.id !== main) return { done: true }
          claimed = await api.claimExtraTargets([a, b, main])
          assert.ok(!('stop' in claimed), JSON.stringify(claimed))
          assert.deepEqual(claimed.items.map(i => i.target.id).sort(), [a, b].sort(), 'không nhận lại data chính')
          const runA = claimed.items.find(i => i.target.id === a).targetRunId
          assert.equal(await api.beginExtraMilestone(runA, { key: 'share_post', actionCode: 'fb_post_group' }), 'ok')
          assert.equal(await api.beginMilestone(POST), 'ok')
          const res = await api.reportMilestone(POST, { ok: true })
          return 'stop' in res ? res : { done: true }
        }
      })
      assert.notEqual(result.reason, 'error', JSON.stringify(result))
      assert.equal(result.released, true, 'mọi lượt data nhận thêm đã chốt nên nhả được lease')
      assert.ok(traces.some(t => t.type === 'claim_extra'), JSON.stringify(traces.map(t => t.type)))
      assert.equal((await status(a)).status, 'hoàn thành', 'đã ghi dấu mà không báo: không rõ kết quả, không gửi lại')
      assert.equal((await status(b)).status, 'chờ xử lý', 'chưa ghi dấu: về hàng đợi')
      const outA = await one(`SELECT o.error_code, o.delivery_state FROM public.auto_engine_outcomes o JOIN public.auto_engine_target_runs r ON r.id = o.target_run_id
        WHERE r.input_data_id = $1`, [a])
      assert.deepEqual([outA.error_code, outA.delivery_state], ['err_engine_interrupted_while_sending', 'unknown'])
    })

    await check('loại không có thao tác (tìm data): claim không cần thao tác, kết quả mặc định của lõi ghi "Tìm data" không mã thao tác', async () => {
      const entry = await makeCampaign({ actionId: 'facebook_find_data_group', targets: 1 })
      const { result } = await run(entry, { resultName: 'Tìm data', runTarget: async () => ({ done: true }) }, { actions: [] })
      assert.notEqual(result.reason, 'error', JSON.stringify(result))
      const row = await one(`SELECT action_code, action_name, status FROM public.auto_campaign_details WHERE campaign_id = $1`, [entry.campaign])
      assert.deepEqual([row.action_code, row.action_name], [null, 'Tìm data'], 'no_outcome ghi dòng "Tìm data" như mọi loại')
      const missing = await makeCampaign({ actionId: 'facebook_find_data_group', targets: 1 })
      const noName = await run(missing, { runTarget: async () => ({ done: true }) }, { actions: [] })
      assert.equal(noName.result.reason, 'error', 'không thao tác mà không có tên kết quả thì lỗi cấu hình của nơi chạy')
      await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now() WHERE campaign_id = $1 AND completed_at IS NULL`, [missing.campaign])
    })

    await check('mất lease khi ghi dấu: dừng ngay, không bấm', async () => {
      const entry = await makeCampaign({ targets: 1 })
      let clicked = false
      const { result } = await run(entry, {
        runTarget: async api => {
          await db.query(`UPDATE public.auto_engine_leases SET lease_token = gen_random_uuid() WHERE account_id = $1`, [entry.account])
          const mark = await api.beginMilestone(POST)
          if (mark === 'ok') clicked = true
          return mark === 'ok' ? { done: true } : mark.stop ? mark : { done: true }
        }
      })
      assert.equal(clicked, false)
      assert.equal(result.reason, 'ownership_lost')
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
