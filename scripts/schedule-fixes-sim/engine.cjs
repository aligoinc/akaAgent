// Engine v2: hàm thật aka_agent_engine_finish_campaign_v2 (bản V650) trên Postgres cục bộ dùng một lần, DB dựng như production
// (bootstrap của bộ kịch bản, engine Facebook, V561, V585, thân V618 p2, rồi V650). Mỗi ca: tạo chiến dịch + data đã xong, nhận lượt
// (không còn data → no_target, giữ lease), gọi hàm kết thúc lượt, đọc lại chiến dịch + data.
'use strict'
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap: engineBootstrap } = require('../engine-v2-scenarios/bootstrap.cjs')
const { applyFacebookMigrations } = require('../engine-v2-facebook/fixture.cjs')
const { applyCampaignRepeatV561 } = require('../fixtures/campaign-outcome-engine/campaign-repeat-v561.cjs')
const V585 = require('../build-v585-sql.cjs')
const V650 = require('../build-v650-sql.cjs')

async function openEngine({ port = Number(process.env.SIM_ENGINE_PORT || 55649), withV650 = true } = {}) {
  const { connect, stop } = startCluster({ port, label: 'aka-sched-sim-' })
  const db = await connect()
  await engineBootstrap(db, [])
  await applyFacebookMigrations(db)
  await applyCampaignRepeatV561(db)
  await db.query(V585.migration)
  await db.query(V650.texts.live)
  if (withV650) await db.query(V650.migration)
  await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES (601, 'Org', true) ON CONFLICT (id) DO NOTHING`)
  await db.query(`INSERT INTO public.org_staff(id, organization_id) VALUES (7101, 601) ON CONFLICT (id) DO NOTHING`)
  await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
    VALUES (601, 3, 'paid', now() + interval '30 days')`)
  await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.facebook'`, [JSON.stringify({ mode: 'orgs', organizationIds: [601] })])
  let nextId = 5_000_000
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)

  /** Chạy một ca kết thúc lượt. Trả { kind, reason, status, schedule, inputs } hoặc { skip }. */
  async function completion(k) {
    // DB chỉ cho 4 trạng thái data (auto_campaign_input_data_status_check): ca có trạng thái khác không thể có thật.
    if (k.inputs.some(i => !['chờ xử lý', 'tạm dừng', 'đang chạy', 'hoàn thành'].includes(i.status))) return { skip: 'trạng thái data ngoài CHECK' }
    const account = ++nextId, campaign = ++nextId
    const c = k.c
    await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
      OVERRIDING SYSTEM VALUE VALUES ($1, 'TK', $2, 'đã đăng nhập', 'chờ xử lý', true, false, 7101, 601, $3, false)`,
      [account, c.action_id.startsWith('facebook_') ? 'facebook' : 'zalo', !c.action_id.startsWith('facebook_')])
    await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
        provisioning_state, data_target_source_mode, schedule_end_date, extra_settings, daily_stop_time, is_delete, staff_id, organization_id,
        refresh_data, schedule_week_days, schedule_days)
      OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', now() - interval '1 minute', $5, $6, $7, 'ready', 'direct', $8, $9::jsonb, $10::time, false, 7101, 601,
        $11, $12, $13)`,
      [campaign, c.name, c.action_id, account, c.original_schedule, c.schedule_type, c.continue_next_day, c.schedule_end_date,
        JSON.stringify(c.extra_settings || {}), c.daily_stop_time, c.refresh_data, c.schedule_week_days, c.schedule_days])
    for (const i of k.inputs) {
      await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete, note)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'D', $3, $4, $5, $6)`, [++nextId, campaign, `0912${String(nextId).slice(-6)}`, i.status, !!i.is_delete, i.note ?? ''])
    }
    const runtimeTarget = c.action_id.startsWith('facebook_') ? 'desktop' : 'fly'
    const ctx = JSON.stringify({ staffId: 7101, accountId: account, campaignId: campaign, runnerId: `${runtimeTarget}:sim`, runtimeTarget, leaseToken: null,
      actions: [{ code: 'zalo_find_phone_user' }] })
    const cl = await rpc('aka_agent_engine_claim_target_v1', ctx)
    const claimedSchedule = new Date((await db.query(`SELECT schedule FROM public.auto_campaigns WHERE id = $1`, [campaign])).rows[0].schedule).toISOString()
    if (!cl.leaseToken || cl.status !== 'no_target') {
      if (cl.leaseToken) await rpc('aka_agent_engine_release_v1', account, cl.leaseToken)
      return { skip: `claim:${cl.status}` }
    }
    let f
    try {
      f = await rpc('aka_agent_engine_finish_campaign_v2', account, cl.leaseToken, null)
    } finally {
      await rpc('aka_agent_engine_release_v1', account, cl.leaseToken).catch(() => {})
    }
    const row = (await db.query(`SELECT status, schedule FROM public.auto_campaigns WHERE id = $1`, [campaign])).rows[0]
    const inputs = (await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [campaign])).rows.map(r => r.status)
    const kind = row.status === 'hoàn thành' ? 'completed' : row.status === 'chờ xử lý' ? 'rescheduled' : `status:${row.status}`
    return { kind, reason: f && f.reason, claimedSchedule, status: row.status, schedule: kind === 'rescheduled' ? new Date(row.schedule).toISOString() : null, inputs }
  }
  return { db, completion, close: async () => { await db.end().catch(() => {}); await stop() } }
}

module.exports = { openEngine }
