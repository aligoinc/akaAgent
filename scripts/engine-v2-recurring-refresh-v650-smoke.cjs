// V650: engine v2 hẹn ngày chạy kế cho lịch tuần / tháng có làm mới data thay vì "hoàn thành". Kiểm trên PostgreSQL cục bộ dùng một lần:
// DB engine v2 như production (bootstrap của bộ kịch bản, engine Facebook, V561, V585, thân finish của V618 p2), rồi apply V650.
// Không mạng, không dữ liệu khách.
// Chạy: CHAT_REPO=<thư mục có module pg> PG17_BIN=<bin Postgres> LC_ALL=C node scripts/engine-v2-recurring-refresh-v650-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap: engineBootstrap } = require('./engine-v2-scenarios/bootstrap.cjs')
const { applyFacebookMigrations } = require('./engine-v2-facebook/fixture.cjs')
const { applyCampaignRepeatV561 } = require('./fixtures/campaign-outcome-engine/campaign-repeat-v561.cjs')
const V585 = require('./build-v585-sql.cjs')
const V650 = require('./build-v650-sql.cjs')
const PORT = Number(process.env.V650_TEST_PORT || 55650)

const vnMinuteNow = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes() }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v650-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  const finishMd5 = () => val(`SELECT md5(pg_get_functiondef(to_regprocedure($1)))`, [V650.SIG])
  const acl = () => val(`SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(p.proconfig::text, '') FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [V650.SIG])
  try {
    await engineBootstrap(db, [])
    await applyFacebookMigrations(db)
    await applyCampaignRepeatV561(db)
    await db.query(V585.migration)
    await db.query(V650.texts.live)
    assert.equal(await finishMd5(), V650.LIVE_MD5, 'fixture: thân finish_campaign_v2 như production (V618 p2)')

    // ---- Dữ liệu thử ------------------------------------------------------------------------------------------------------
    let nextId = 985000
    const makeCampaign = async ({ action = 'zalo_message_group', targets = 3, org = 601, staff = 7101, schedule = "now() - interval '1 minute'",
      scheduleType = 'weekly', endDate = null, extra = {}, stopTime = null, refresh = true, weekDays = '2,3,4,5,6,7,8', monthDays = null,
      name = 'Chiến dịch thử', paused = 0 } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.org_staff(id, organization_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [staff, org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Tài khoản thử', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true, false)`, [account, staff, org])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
          provisioning_state, data_target_source_mode, schedule_end_date, extra_settings, daily_stop_time, is_delete, staff_id, organization_id,
          refresh_data, schedule_week_days, schedule_days)
        OVERRIDING SYSTEM VALUE VALUES ($1, $10, $2, $3, 'chờ xử lý', ${schedule}, ${schedule}, $4, true, 'ready', 'direct', $5, $6::jsonb, $7, false, $8, $9,
          $11, $12, $13)`,
        [campaign, action, account, scheduleType, endDate, JSON.stringify(extra), stopTime, staff, org, name, refresh, weekDays, monthDays])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Nhóm ${i + 1}`, `0912${String(id).slice(-6)}`])
        ids.push(id)
      }
      if (paused > 0) await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = 'nhóm đã mất' WHERE id = ANY($1)`, [ids.slice(0, paused)])
      return { account, campaign, staff, ids, lease: null }
    }
    const ctx = c => JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign, runnerId: 'fly:v650', runtimeTarget: 'fly',
      leaseToken: c.lease ?? null, actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] })
    const claim = async c => { const res = await rpc('aka_agent_engine_claim_target_v1', ctx(c)); if (res.leaseToken) c.lease = res.leaseToken; return res }
    let rk = 0
    const okDone = cl => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken,
      JSON.stringify([{ resultKey: `v650-smoke:${++rk}`, actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }]), true, false)
    const finish = c => rpc('aka_agent_engine_finish_campaign_v2', c.account, c.lease, null)
    const release = async c => { const r = await rpc('aka_agent_engine_release_v1', c.account, c.lease); c.lease = null; return r }
    const runAll = async c => { for (;;) { const cl = await claim(c); if (cl.status !== 'claimed') return cl; await okDone(cl) } }
    const camp = c => one(`SELECT status, note, schedule FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
    const statuses = async c => (await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])).rows.map(r => r.status)
    /** Chạy hết data của lượt, gọi hàm kết thúc lượt, nhả lease. Trả câu trả lời của hàm kết thúc lượt. */
    const pass1 = async spec => {
      const c = await makeCampaign(spec)
      const last = await runAll(c)
      assert.equal(last.status, 'no_target', `chạy hết data: ${JSON.stringify(last)}`)
      const f = await finish(c)
      const after = { ...(await camp(c)), rows: await statuses(c) }
      await release(c)
      return { c, f, after }
    }


    // Ngày chạy kế như bộ cũ (resolveNextSchedule từ ngày mai): thứ 2 = 2 … chủ nhật = 8; giờ = giờ của lịch gốc.
    const vnDate = (ms = Date.now()) => new Date(ms + 7 * 3600e3)
    const expectNext = (spec, scheduleIso) => {
      const time = vnDate(new Date(scheduleIso).getTime()).toISOString().slice(11, 19)
      for (let i = 1; i <= 370; i++) {
        const d = vnDate(Date.now() + i * 86400e3)
        const wd = d.getUTCDay() === 0 ? 8 : d.getUTCDay() + 1
        const ok = spec.weekDays ? spec.weekDays.includes(wd) : spec.monthDays.includes(d.getUTCDate())
        if (ok) return new Date(`${d.toISOString().slice(0, 10)}T${time}+07:00`).getTime()
      }
      return null
    }
    const scheduleOf = async c => (await one(`SELECT original_schedule FROM public.auto_campaigns WHERE id = $1`, [c.campaign])).original_schedule
    const vnHourNow = vnDate().getUTCHours()
    if (vnHourNow >= 23) { console.log('NOTE bỏ qua: chạy sau 00:00 và trước 23:00 giờ Việt Nam'); return }

    // ---- 1. Trước V650: tái hiện "hoàn thành" mỗi ngày --------------------------------------------------------------------------------
    const bug = await pass1({})
    assert.deepEqual([bug.f.reason, bug.after.status], ['completed', 'hoàn thành'], 'thân V618: lịch tuần làm mới data → hoàn thành')
    pass('trước V650 (thân như production): lịch tuần làm mới data chạy xong → hoàn thành')

    // ---- 2. Apply, quyền, không chạy lại -----------------------------------------------------------------------------------------------
    const aclBefore = await acl()
    await db.query(V650.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await finishMd5(), V650.LIVE_MD5, 'apply rồi ROLLBACK không để lại gì')
    await db.query(V650.migration)
    assert.equal(await finishMd5(), V650.NEW_MD5)
    assert.equal(await acl(), aclBefore, 'chủ sở hữu, quyền, thuộc tính, thiết lập của hàm giữ nguyên')
    await assert.rejects(db.query(V650.migration), /đã chạy \(finish\)/)
    await db.query('ROLLBACK')
    pass('apply rồi ROLLBACK không để lại gì; apply thật đúng md5; quyền giữ nguyên; apply lần hai bị chặn')

    // ---- 3. Lịch tuần: hẹn ngày chạy kế, đặt lại data, data tạm dừng giữ nguyên --------------------------------------------------------
    for (const weekDays of [[2, 3, 4, 5, 6, 7], [2, 3, 4, 5, 6, 7, 8], [vnDate().getUTCDay() === 0 ? 8 : vnDate().getUTCDay() + 1]]) {
      const r = await pass1({ weekDays: weekDays.join(','), targets: 4, paused: 1 })
      assert.deepEqual([r.f.reason, r.after.status, r.after.note], ['rerun_scheduled', 'chờ xử lý', null], `tuần ${weekDays}`)
      assert.equal(new Date(r.after.schedule).getTime(), expectNext({ weekDays }, await scheduleOf(r.c)), `ngày chạy kế, tuần ${weekDays}`)
      assert.deepEqual(r.after.rows, ['tạm dừng', 'chờ xử lý', 'chờ xử lý', 'chờ xử lý'], 'đặt lại data trừ dòng tạm dừng')
      assert.equal(new Date(r.after.schedule).getTime() > Date.now(), true)
    }
    pass('lịch tuần (Thứ 2–7, cả tuần, chỉ hôm nay → tuần sau): hẹn đúng ngày / giờ, đặt lại data trừ dòng tạm dừng')

    // ---- 4. Lịch tháng ----------------------------------------------------------------------------------------------------------------
    const today = vnDate().getUTCDate()
    for (const monthDays of [[1, 15, 28], [today], [31]]) {
      const r = await pass1({ scheduleType: 'monthly', weekDays: null, monthDays: monthDays.join(',') })
      assert.deepEqual([r.f.reason, r.after.status], ['rerun_scheduled', 'chờ xử lý'], `tháng ${monthDays}`)
      assert.equal(new Date(r.after.schedule).getTime(), expectNext({ monthDays }, await scheduleOf(r.c)), `ngày chạy kế, tháng ${monthDays}`)
    }
    pass('lịch tháng (nhiều ngày, chỉ hôm nay → tháng sau, ngày 31 bỏ qua tháng không có ngày 31): hẹn đúng')

    // ---- 5. Các trường hợp vẫn hoàn thành như cũ ---------------------------------------------------------------------------------------
    const cases = [
      ['không làm mới data', { refresh: false }],
      ['lịch hằng ngày', { scheduleType: 'daily' }],
      ['ngày chạy kế quá ngày kết thúc', { endDate: new Date(Date.now() + 3600e3).toISOString() }],
      ['chúc mừng sinh nhật', { action: 'zalo_message_birthday' }],
      ['up tin', { action: 'facebook_comment_seeding_post', name: 'Up tin cho chiến dịch "A"' }],
      ['ngày trong tuần không hợp lệ', { weekDays: 'abc,9' }],
    ]
    for (const [label, spec] of cases) {
      const r = await pass1(spec)
      assert.equal(r.after.status, 'hoàn thành', label)
      assert.notEqual(r.f.reason, 'rerun_scheduled', label)
    }
    const allPaused = await makeCampaign({ targets: 2, paused: 2 })
    assert.equal((await runAll(allPaused)).status, 'no_target')
    const fp = await finish(allPaused); await release(allPaused)
    assert.deepEqual([fp.reason, (await camp(allPaused)).status], ['completed_no_rerun_data', 'hoàn thành'], 'mọi data tạm dừng → không có gì chạy lại')
    pass('không làm mới / hằng ngày / quá ngày kết thúc / sinh nhật / up tin / ngày sai / mọi data tạm dừng → hoàn thành như cũ')

    // ---- 6. Lượt kế: claim trước giờ hẹn không chạy; tới giờ thì chạy lại đủ data ------------------------------------------------------
    const nx = await pass1({ targets: 2 })
    const early = await claim(nx.c)
    assert.equal(early.status, 'not_due', 'trước ngày chạy kế không nhận data')
    await release(nx.c)
    await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '1 minute' WHERE id = $1`, [nx.c.campaign])
    const again = await runAll(nx.c)
    assert.equal(again.status, 'no_target')
    assert.deepEqual(await statuses(nx.c), ['hoàn thành', 'hoàn thành'], 'tới giờ: chạy lại đủ danh sách')
    await release(nx.c)
    pass('lượt kế: trước giờ hẹn không nhận data; tới giờ chạy lại đủ danh sách')

    // ---- 7. Gỡ -------------------------------------------------------------------------------------------------------------------------
    await db.query(V650.rollback)
    assert.equal(await finishMd5(), V650.LIVE_MD5)
    assert.equal(await acl(), aclBefore)
    await assert.rejects(db.query(V650.rollback), /hàm đã là bản trước/)
    await db.query('ROLLBACK')
    const back = await pass1({})
    assert.deepEqual([back.f.reason, back.after.status], ['completed', 'hoàn thành'], 'gỡ xong: lại như cũ')
    pass('gỡ trả đúng thân cũ và quyền; gỡ lần hai bị chặn')

    console.log(`\n${checks} nhóm đạt`)
  } finally {
    await db.end().catch(() => {})
    await stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
