// V564 (engine v2 Facebook xáo trộn danh sách group như bộ cũ) trên PostgreSQL 17 cục bộ, không chạm DB thật:
//   node scripts/engine-v2-facebook/v564-smoke.cjs
// DB engine như production (V495 → V532 + V556–V558), apply V564, chạy lõi thật (runUnit) với RPC thật và nơi chạy workflow giả. Kiểm:
// đăng nhóm bật xáo trộn đi theo thứ tự md5(id || lease) của lượt (khác thứ tự id, mỗi lượt một thứ tự), in "🔀 Đã xáo trộn danh sách N
// group" một lần ngay sau "🚀" như bộ cũ; chiến dịch không bật / loại khác đi theo id tăng dần như V558, câu trả lời không có khoá shuffle;
// migration không chạy lại; bản gỡ trả về đúng thân V558.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration, FACEBOOK_MIGRATIONS, V564_MIGRATION } = require('./fixture.cjs')
const V564 = require('../build-v564-sql.cjs')

const PORT = Number(process.env.ENGINE_FB_V564_PORT || 55564)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-fb-v564-'))
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

/** Thứ tự DB phải chọn trong một lượt: md5(id::text || lease::text), hoà thì theo id. */
const shuffledOrder = (ids, lease) => [...ids].sort((a, b) => {
  const x = md5(`${a}${lease}`), y = md5(`${b}${lease}`)
  return x < y ? -1 : x > y ? 1 : a - b
})

async function main() {
  const E = await loadEngine()
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v564-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    // Tới V558 như production trước V564; V564 apply riêng bên dưới.
    await applyFacebookMigrations(db, FACEBOOK_MIGRATIONS.filter(name => name !== V564_MIGRATION))
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const claimMd5 = async () => (await one(`SELECT md5(pg_get_functiondef('public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure)) AS m`)).m
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const claims = []
    const port = {
      claimTarget: async ctx => { const r = await rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]); claims.push(r); return r },
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok]),
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)])
    }
    const HEARTBEAT_MS = 61_237
    const STAFF = 9201, ORG = 701
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'FB xáo trộn') ON CONFLICT DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, 'fbshuffle', 'pw')`, [STAFF, ORG])
    await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
      VALUES ($1, 3, 'paid', now() + interval '30 days')`, [ORG])
    await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.facebook'`, [JSON.stringify({ mode: 'orgs', organizationIds: [ORG] })])

    let nextId = 990000
    const LIMITS = { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 }
    const makeCampaign = async ({ actionId = 'facebook_group_post', targets = 10, shuffle = true, extraData = [] } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`,
        [account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
          extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB xáo trộn', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5, 'daily', $6)`,
        [campaign, actionId, account, STAFF, ORG, JSON.stringify({ actionLimits: LIMITS, shuffleGroupList: shuffle })])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Nhóm ${i + 1}`, `g${id}`])
        ids.push(id)
      }
      for (const row of extraData) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete, schedule) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Nhóm hẹn sau', $3, 'chờ xử lý', false, $4)`, [id, campaign, `g${id}`, row.schedule])
      }
      return { account, campaign, ids, actionId }
    }
    const POST = { key: 'post', actionCode: 'fb_post_group', actionName: 'Đăng bài' }
    const COMMENT = { key: 'comment#0', actionCode: 'fb_comment', actionName: 'Comment' }
    /** Một lượt (lease) của lõi thật: mỗi data một mốc thành công. Trả thứ tự data đã chạy, mã lease, các dòng tiến trình. */
    const runUnit = async entry => {
      const lines = []
      const before = claims.length
      const step = entry.actionId === 'facebook_group_post' ? POST : COMMENT
      const result = await E.runUnit({ data: port, journal: new E.MemoryJournal(), clock: testClock(HEARTBEAT_MS),
        events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:fbshuffle', runtimeTarget: 'desktop', staffId: STAFF, accountId: entry.account, campaignId: entry.campaign,
        campaignName: 'FB xáo trộn', accountName: 'FB', actions: [{ code: step.actionCode }],
        buildSteps: () => [], pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, drainTimeoutMs: 2000,
        retry: { ...E.DEFAULT_RETRY, baseDelayMs: 1, maxDelayMs: 2, callTimeoutMs: 5000 },
        workflow: {
          runTarget: async api => {
            const mark = await api.beginMilestone(step)
            if (mark !== 'ok') return mark.stop ? mark : { done: true }
            const res = await api.reportMilestone(step, { ok: true, customerLog: 'ok' })
            return 'stop' in res ? res : { done: true }
          }
        }
      }, new AbortController().signal)
      const runs = (await db.query(`SELECT input_data_id, lease_token FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND started_at IS NOT NULL
          ORDER BY id`, [entry.campaign])).rows
      const leases = [...new Set(runs.map(r => r.lease_token))]
      const lease = leases[leases.length - 1]
      const order = runs.filter(r => r.lease_token === lease).map(r => Number(r.input_data_id))
      return { result, lines, lease, order, claims: claims.slice(before).filter(c => c.status === 'claimed') }
    }
    /** Lượt kế tiếp như finish_campaign đặt lại: data về chờ, chiến dịch chờ. */
    const resetPass = async entry => {
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý' WHERE campaign_id = $1 AND (schedule IS NULL OR schedule <= now())`, [entry.campaign])
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = now() - interval '1 minute' WHERE id = $1`, [entry.campaign])
      await db.query(`UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = $1`, [entry.account])
    }

    const migration = readMigration(`${V564.NAME}.sql`)
    const rollback = readMigration(`${V564.ROLLBACK_NAME}.sql`)
    assert.equal(md5(migration), md5(V564.migration), 'file migration khác bản bộ sinh tạo, chạy lại node scripts/build-v564-sql.cjs')
    assert.equal(md5(rollback), md5(V564.rollback), 'file gỡ khác bản bộ sinh tạo')

    await check('DB thử: claim_target_v1 = bản production 18/11 (V558)', async () => {
      assert.equal(await claimMd5(), V564.LIVE_MD5)
    })
    await check('V564 gỡ từ chối khi chưa apply', async () => {
      await assert.rejects(db.query(rollback), /Gỡ V564: hàm đã là bản trước V564/)
      await db.query('ROLLBACK').catch(() => {})
    })
    await check('V564 apply: thân hàm đúng bản sinh, giữ quyền', async () => {
      const aclBefore = (await one(`SELECT coalesce(proacl::text, '') || '|' || pg_get_userbyid(proowner) AS a FROM pg_proc
        WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure`)).a
      await db.query(migration)
      assert.equal(await claimMd5(), V564.NEW_MD5)
      const aclAfter = (await one(`SELECT coalesce(proacl::text, '') || '|' || pg_get_userbyid(proowner) AS a FROM pg_proc
        WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure`)).a
      assert.equal(aclAfter, aclBefore)
    })
    await check('V564 không apply lại', async () => {
      await assert.rejects(db.query(migration), /V564 đã chạy/)
      await db.query('ROLLBACK').catch(() => {})
    })

    const shuffled = await makeCampaign({ targets: 10, extraData: [{ schedule: new Date(Date.now() + 3_600_000).toISOString() }] })
    let first
    await check('đăng nhóm bật xáo trộn: lượt đi theo thứ tự md5(id || lease), khác thứ tự id, đủ mỗi data một lần', async () => {
      first = await runUnit(shuffled)
      assert.equal(first.result.reason, 'no_target', JSON.stringify(first.result))
      assert.equal(first.order.length, 10)
      assert.deepEqual([...first.order].sort((a, b) => a - b), shuffled.ids, 'đủ 10 data, không trùng, không lấy data hẹn sau')
      assert.deepEqual(first.order, shuffledOrder(shuffled.ids, first.lease))
      assert.notDeepEqual(first.order, shuffled.ids, 'không còn đi theo id tăng dần')
    })
    await check('dòng 🔀 như bộ cũ: một lần, ngay sau 🚀, N = data chờ đến hạn lúc đầu lượt', async () => {
      const start = first.lines.findIndex(t => t.startsWith('🚀 Bắt đầu chiến dịch'))
      assert.ok(start >= 0, first.lines.join('\n'))
      assert.equal(first.lines[start + 1], '🔀 Đã xáo trộn danh sách 10 group')
      assert.equal(first.lines.filter(t => t.startsWith('🔀')).length, 1)
      assert.ok(first.lines[start + 2].startsWith('▶️ Xử lý'), first.lines[start + 2])
      assert.deepEqual(first.claims.map(c => c.shuffle ?? null), [{ count: 10 }, ...Array(9).fill(null)], 'chỉ lần nhận đầu của lượt có shuffle')
    })
    await check('lượt sau (lease mới) xáo thứ tự khác, in lại 🔀', async () => {
      await resetPass(shuffled)
      const second = await runUnit(shuffled)
      assert.notEqual(second.lease, first.lease)
      assert.deepEqual(second.order, shuffledOrder(shuffled.ids, second.lease))
      assert.notDeepEqual(second.order, first.order)
      assert.equal(second.lines.filter(t => t === '🔀 Đã xáo trộn danh sách 10 group').length, 1)
    })
    await check('đăng nhóm không bật xáo trộn: id tăng dần, không 🔀, câu trả lời không có shuffle', async () => {
      const plain = await makeCampaign({ targets: 5, shuffle: false })
      const r = await runUnit(plain)
      assert.deepEqual(r.order, plain.ids)
      assert.equal(r.lines.some(t => t.startsWith('🔀')), false)
      assert.ok(r.claims.length === 5 && r.claims.every(c => !('shuffle' in c)))
    })
    await check('comment seeding có cờ xáo trộn (chỉ đăng nhóm xáo như bộ cũ): id tăng dần, không 🔀', async () => {
      const seeding = await makeCampaign({ actionId: 'facebook_comment_seeding', targets: 5, shuffle: true })
      const r = await runUnit(seeding)
      assert.deepEqual(r.order, seeding.ids)
      assert.equal(r.lines.some(t => t.startsWith('🔀')), false)
      assert.ok(r.claims.every(c => !('shuffle' in c)))
    })
    await check('lease đã cấp mà lượt chưa nhận data (như sau cooldown_scan): unitStarted=false vẫn có shuffle, thiếu cờ thì không', async () => {
      const held = await makeCampaign({ targets: 4, shuffle: true })
      const token = crypto.randomUUID()
      await db.query(`INSERT INTO public.auto_engine_leases (account_id, lease_token, runner_id, runtime_target, campaign_id, expires_at)
        VALUES ($1, $2, 'desktop:fbshuffle', 'desktop', $3, now() + interval '3 minutes')`, [held.account, token, held.campaign])
      const ctx = extra => ({ staffId: STAFF, accountId: held.account, campaignId: held.campaign, runnerId: 'desktop:fbshuffle', runtimeTarget: 'desktop',
        leaseToken: token, actions: [{ code: 'fb_post_group' }], ...extra })
      const firstClaim = await port.claimTarget(ctx({ unitStarted: false }))
      assert.equal(firstClaim.status, 'claimed', JSON.stringify(firstClaim))
      assert.equal(firstClaim.leaseToken, token)
      assert.deepEqual(firstClaim.shuffle, { count: 4 })
      assert.equal(Number(firstClaim.target.id), shuffledOrder(held.ids, token)[0])
      await port.report(firstClaim.targetRunId, token, [{ resultKey: `v2:${firstClaim.targetRunId}:post`, actionCode: 'fb_post_group', stepKey: 'post',
        ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }], true)
      const next = await port.claimTarget(ctx({}))
      assert.equal(next.status, 'claimed', JSON.stringify(next))
      assert.equal('shuffle' in next, false, 'lượt đã nhận data: không có shuffle')
      assert.equal(Number(next.target.id), shuffledOrder(held.ids, token)[1])
      await port.report(next.targetRunId, token, [{ resultKey: `v2:${next.targetRunId}:post`, actionCode: 'fb_post_group', stepKey: 'post',
        ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }], true)
      await port.release(held.account, token)
    })
    await check('một data chờ: không in 🔀 (bộ cũ chỉ in khi N > 1)', async () => {
      const single = await makeCampaign({ targets: 1, shuffle: true })
      const r = await runUnit(single)
      assert.deepEqual(r.order, single.ids)
      assert.deepEqual(r.claims.map(c => c.shuffle ?? null), [{ count: 1 }])
      assert.equal(r.lines.some(t => t.startsWith('🔀')), false)
    })
    await check('gỡ V564: trả đúng thân V558, chiến dịch xáo trộn lại đi theo id', async () => {
      await db.query(rollback)
      assert.equal(await claimMd5(), V564.LIVE_MD5)
      await resetPass(shuffled)
      const r = await runUnit(shuffled)
      assert.deepEqual(r.order, shuffled.ids)
      assert.equal(r.lines.some(t => t.startsWith('🔀')), false)
      await db.query(migration)
      assert.equal(await claimMd5(), V564.NEW_MD5, 'apply lại được sau khi gỡ')
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
