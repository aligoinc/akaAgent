// Kiểm V499 (nhớ mục tiêu theo từng tài khoản) trên PostgreSQL 17 cục bộ dùng một lần, fixture V495 dựng từ ảnh chụp
// danh mục thật (chỉ đọc). Không chạm DB thật.
//   1. Seed không bật nhớ: simulate_v1 và kịch bản chạy thật qua RPC y hệt V495.
//   2. Có chính sách nhớ: tài khoản đã gặp lỗi bỏ qua số đó; tài khoản khác CÙNG tổ chức vẫn tra được.
//   3. Bảng nhớ không trống thì không apply; gỡ trả hai hàm về đúng thân V495; apply lại được.
// Chạy: node scripts/test-v499-target-memory-per-account.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const built = require('./build-v499-sql.cjs')

const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v499_target_memory_per_account.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v499_target_memory_per_account.sql'), 'utf8')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V499_TEST_PORT || 55499), label: 'aka-v499-' })
  const db = await connect()
  const q = (text, args = []) => db.query(text, args)
  const one = async (text, args = []) => (await q(text, args)).rows[0]
  const val = async (text, args = []) => Object.values((await q(text, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  const md5Of = sig => val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = $1::regprocedure`, [sig])
  const CLAIM = 'public.aka_agent_engine_claim_target_v1(jsonb)'
  const REPORT = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'
  try {
    assert.equal(APPLY, built.migration); assert.equal(ROLLBACK, built.rollback)
    await buildFixture(db, [])
    await q(MIGRATION)
    assert.deepEqual([await md5Of(CLAIM), await md5Of(REPORT)], [built.LIVE.claim, built.LIVE.report])

    let nextId = 990000
    const makeCampaign = async ({ org = 701, phones } = {}) => {
      const account = ++nextId, campaign = ++nextId, staff = 7101
      await q(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org V499', true) ON CONFLICT (id) DO NOTHING`, [org])
      await q(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo V499', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true)`, [account, staff, org])
      await q(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chiến dịch V499', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4)`,
      [campaign, account, staff, org])
      const ids = []
      for (const phone of phones ?? [`0912${String(campaign).slice(-6)}`]) {
        const id = ++nextId
        await q(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [id, campaign, phone])
        ids.push(id)
      }
      return { account, campaign, staff, ids, lease: null }
    }
    // Chiến dịch thứ hai của CÙNG tài khoản.
    const sameAccountCampaign = async (base, phones) => {
      const campaign = ++nextId
      await q(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE SELECT $1, 'Chiến dịch V499 (2)', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, staff_id, organization_id
        FROM public.auto_campaigns WHERE id = $3`, [campaign, base.account, base.campaign])
      const ids = []
      for (const phone of phones) {
        const id = ++nextId
        await q(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [id, campaign, phone])
        ids.push(id)
      }
      return { ...base, campaign, ids, lease: null }
    }
    const claim = async c => {
      const res = await rpc('aka_agent_engine_claim_target_v1', JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign,
        runnerId: 'fly:v499', runtimeTarget: 'fly', leaseToken: c.lease,
        actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }] }))
      if (res.leaseToken) c.lease = res.leaseToken
      return res
    }
    const release = async c => { const res = await rpc('aka_agent_engine_release_v1', c.account, c.lease); c.lease = null; return res }
    let rk = 0
    const report = (cl, outcomes, final = false) => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken,
      JSON.stringify(outcomes.map(o => ({ resultKey: `v499:${++rk}:${o.actionCode}`, stepKey: o.actionCode, ...o }))), final, false)
    const notFound = { actionCode: 'zalo_find_phone_user', ok: false, phase: 'after_send', signal: { kind: 'zalo_code', code: '216', message: 'Không tồn tại' } }

    // Kịch bản so trước/sau: seed không nhớ nên kết quả phải y hệt.
    const normalize = res => JSON.parse(JSON.stringify(res, (k, v) =>
      ['targetRunId', 'detailId', 'resultKey', 'lockUntil', 'schedule', 'leaseToken', 'expiresAt', 'policy_ids', 'revisions'].includes(k) ? undefined
        : typeof v === 'string' ? v.replace(/\d{2}:\d{2} \d{2}\/\d{2}/g, 'HH:MM DD/MM') : v))
    const scenario = async () => {
      const out = []
      for (const outcome of [notFound, { actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send' }]) {
        const c = await makeCampaign()
        const cl = await claim(c)
        out.push(normalize(cl.actions), normalize(await report(cl, [outcome], true)))
        await release(c)
      }
      return out
    }
    const before = await scenario()

    // ---- 1. Apply, không đổi hành vi khi chưa bật nhớ ---------------------------------------------------------------
    await q(APPLY)
    await assert.rejects(q(APPLY), /đã có/)
    await q('ROLLBACK').catch(() => {})
    assert.deepEqual(await scenario(), before)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_target_memory`)), 0, 'seed không bật nhớ')
    pass('apply V499; apply lần hai bị chặn; seed không bật nhớ nên claim/report y hệt V495')

    // ---- 2. Nhớ theo tài khoản --------------------------------------------------------------------------------------
    await q(`INSERT INTO public.auto_outcome_policies (error_code, action_code, remember_target_days, pace_mode, source)
      VALUES ('err_zalo_user_not_found', 'zalo_find_phone_user', 30, 'none', 'test')`)
    const phone = '0987654321'
    const a = await makeCampaign({ org: 702, phones: [phone, '0987000001'] })
    let cl = await claim(a)
    assert.equal(cl.status, 'claimed')
    await report(cl, [notFound], true)
    await release(a)
    const mem = await one(`SELECT organization_id, account_id, action_code, error_code FROM public.auto_target_memory`)
    assert.deepEqual([Number(mem.organization_id), Number(mem.account_id), mem.action_code, mem.error_code], [702, a.account, 'zalo_find_phone_user', 'err_zalo_user_not_found'])

    // Cùng tài khoản, chiến dịch khác: bỏ qua tra số đó.
    const a2 = await sameAccountCampaign(a, [phone])
    cl = await claim(a2)
    assert.equal(cl.status, 'claimed')
    assert.deepEqual([cl.actions.zalo_find_phone_user.decision, cl.actions.zalo_find_phone_user.gate], ['skip', 'target_memory'])
    await report(cl, [{ actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send', statusCode: 'campaign_detail_skipped' }], true)
    await release(a2)
    // Tài khoản khác CÙNG tổ chức: vẫn tra.
    const b = await makeCampaign({ org: 702, phones: [phone] })
    cl = await claim(b)
    assert.equal(cl.status, 'claimed')
    assert.equal(cl.actions.zalo_find_phone_user.decision, 'allow', 'tài khoản khác cùng tổ chức không bị nhớ chung')
    // Tài khoản này gặp lỗi thì có dòng nhớ riêng; hai dòng cho cùng số, khác tài khoản.
    await report(cl, [notFound], true)
    await release(b)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_target_memory WHERE target_key = public.aka_agent_engine_target_key($1, NULL, NULL)`, [phone])), 2)
    pass('nhớ theo tài khoản: tài khoản đã gặp lỗi bỏ qua số đó ở chiến dịch khác; tài khoản khác cùng tổ chức vẫn tra, có dòng nhớ riêng')

    // Hết hạn nhớ thì tra lại.
    await q(`UPDATE public.auto_target_memory SET expires_at = now() - interval '1 second' WHERE account_id = $1`, [a.account])
    const a3 = await sameAccountCampaign(a, [phone])
    cl = await claim(a3)
    assert.equal(cl.actions.zalo_find_phone_user.decision, 'allow')
    await rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken, JSON.stringify([{ resultKey: `v499:${++rk}:x`, actionCode: 'zalo_find_phone_user',
      stepKey: 'zalo_find_phone_user', ok: true, phase: 'after_send' }]), true, false)
    await release(a3)
    pass('hết thời gian nhớ thì tài khoản tra lại số đó')

    // ---- 3. Bảng nhớ không trống thì không apply; gỡ; apply lại -----------------------------------------------------
    await q(ROLLBACK)
    assert.deepEqual([await md5Of(CLAIM), await md5Of(REPORT)], [built.LIVE.claim, built.LIVE.report])
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_target_memory`)), 0, 'gỡ xoá bộ nhớ đệm theo tài khoản')
    assert.equal(await val(`SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'auto_target_memory' AND column_name = 'account_id'`), 0)
    assert.notEqual(await val(`SELECT to_regclass('public.auto_target_memory_key_v495')::text`), null)
    await q(`INSERT INTO public.auto_target_memory (organization_id, target_key, action_code, error_code, expires_at)
      VALUES (702, 'phone:x', 'zalo_find_phone_user', 'err_zalo_user_not_found', now() + interval '1 day')`)
    await assert.rejects(q(APPLY), /không trống/)
    await q('ROLLBACK').catch(() => {})
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_target_memory`)), 1, 'không tự đổi dữ liệu nhớ cũ')
    await q(`DELETE FROM public.auto_target_memory`)
    await q(APPLY)
    assert.deepEqual([await md5Of(CLAIM), await md5Of(REPORT)], [built.NEW.claim, built.NEW.report])
    pass('bảng nhớ không trống thì không apply (không tự đổi dữ liệu); gỡ trả hai hàm về đúng thân V495, khoá theo tổ chức; apply lại được')

    console.log(`OK V499: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
