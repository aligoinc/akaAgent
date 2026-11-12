// V501: lịch chạy, thử lại data, kết thúc chiến dịch của engine v2. Kiểm trên PostgreSQL 17 cục bộ dùng một lần
// (fixture như campaign-outcome-engine-sql-smoke.cjs, rồi V495 → V499 → V500 → V501). Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-v501-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V501_TEST_PORT || 55501)

/** Giờ Việt Nam hiện tại theo phút trong ngày, và chuỗi HH:MM của một phút. */
const vnMinuteNow = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes() }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v501-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    // Bảng tối thiểu cho giới hạn tài khoản Zalo (trình duyệt) chạy đồng thời (production có đủ cột).
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)

    // ---- 1. Apply ---------------------------------------------------------------------------------
    const md5Of = sig => val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig])
    const CLAIM = 'public.aka_agent_engine_claim_target_v1(jsonb)'
    const REPORT = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'
    const FINISH = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'
    assert.equal(await md5Of(CLAIM), v501.LIVE.claim); assert.equal(await md5Of(REPORT), v501.LIVE.report)
    await db.query(v501.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await md5Of(CLAIM), v501.LIVE.claim)
    assert.equal(await val(`SELECT to_regprocedure($1)`, [FINISH]), null)
    await db.query(v501.migration)
    assert.equal(await md5Of(CLAIM), v501.NEW.claim); assert.equal(await md5Of(REPORT), v501.NEW.report)
    await assert.rejects(db.query(v501.migration), /campaign_schedule đã có/)
    await db.query('ROLLBACK')
    const priv = (role, fn) => val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, fn])
    assert.equal(await priv('anon', FINISH), false); assert.equal(await priv('authenticated', FINISH), false)
    for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await priv(role, FINISH), true, role)
    for (const role of ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) {
      assert.equal(await priv(role, 'public.aka_agent_engine_finalize_v501(bigint,text,text,jsonb)'), false, role)
    }
    pass('apply trong transaction rồi ROLLBACK không để lại gì; apply thật; apply lần hai bị chặn; quyền finish_v2 như v1, hàm phụ không cấp cho ai')
    // WITH_V503=1: chạy mọi ca bên dưới trên thân hàm của V503 (chế độ lô chỉ bật khi có GUC, gọi thường phải y như V501).
    if (process.env.WITH_V503 === '1') {
      await db.query(require('./build-v503-sql.cjs').migration)
      console.log('… chạy trên thân hàm V503')
    }

    // ---- Dữ liệu thử ------------------------------------------------------------------------------
    // Mã thử: về hàng đợi mà lượt chạy tiếp; hoãn chiến dịch (như update_status_campaign = 'chờ xử lý' của bản cũ).
    for (const [code, pub] of [['err_test_requeue_v501', 'TST01'], ['err_test_hold_v501', 'TST02']]) {
      await db.query(`INSERT INTO public.auto_error SELECT (jsonb_populate_record(NULL::public.auto_error,
          to_jsonb(e) || jsonb_build_object('id', (SELECT max(id) + 1 FROM public.auto_error), 'error_code', $1::text, 'public_code', $2::text, 'error_class', 'transient'))).*
        FROM public.auto_error e WHERE e.error_code = 'err_engine_unknown_delivery'`, [code, pub])
    }
    // Mã thử chèn id tường minh: đẩy sequence lên để lần apply lại (sau rollback) không trùng id.
    await db.query(`SELECT setval('auto_error_id_seq', (SELECT max(id) FROM public.auto_error))`)
    await db.query(`INSERT INTO public.auto_outcome_policies (error_code, detail_mode, quota_effect, target_streak_effect, target_effect, remaining_steps,
        lock_action_codes, run_effect, pace_mode, campaign_effect, account_effect, login_effect, source, description)
      VALUES ('err_test_requeue_v501', 'suppress', 'no_count', 'ignore', 'requeue', 'skip', '{}', 'continue', 'none', 'none', 'none', 'none', 'test', 'test'),
             ('err_test_hold_v501', 'suppress', 'no_count', 'ignore', 'complete', 'skip', '{}', 'continue', 'none', 'hold', 'none', 'none', 'test', 'test')`)

    let nextId = 910000
    const makeCampaign = async ({ action = 'zalo_message_phone', targets = 3, accountStatus = 'chờ xử lý', org = 601, server = true, web = false,
      staff = 7101, schedule = "now() - interval '1 minute'", scheduleType = 'daily', continueNextDay = true, provisioning = 'ready',
      sourceMode = 'direct', endDate = null, extra = {}, stopTime = null, note = null, targetSchedules = [] } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo thử', 'zalo', 'đã đăng nhập', $2, true, false, $3, $4, $5, $6)`, [account, accountStatus, staff, org, server, web])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, schedule_type, continue_next_day, provisioning_state,
          data_target_source_mode, schedule_end_date, extra_settings, daily_stop_time, note, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chiến dịch thử', $2, $3, 'chờ xử lý', ${schedule}, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, false, $12, $13)`,
        [campaign, action, account, scheduleType, continueNextDay, provisioning, sourceMode, endDate, JSON.stringify(extra), stopTime, note, staff, org])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete, schedule)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false, $5)`, [id, campaign, `Khách ${i + 1}`, `0912${String(id).slice(-6)}`, targetSchedules[i] ?? null])
        ids.push(id)
      }
      return { account, campaign, staff, ids, runtime: server ? 'fly' : 'desktop', lease: null }
    }
    const ctx = (c, extra = {}) => JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign, runnerId: `${c.runtime}:v501`,
      runtimeTarget: c.runtime, leaseToken: c.lease ?? null, actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }], ...extra })
    const claim = async (c, extra) => { const res = await rpc('aka_agent_engine_claim_target_v1', ctx(c, extra)); if (res.leaseToken) c.lease = res.leaseToken; return res }
    let rk = 0
    const fail = (cl, errorCode, final = true) => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken,
      JSON.stringify([{ resultKey: `v501-smoke:${++rk}`, actionCode: 'zalo_find_phone_user', ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'test', errorCode } }]), final, false)
    const okDone = cl => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken,
      JSON.stringify([{ resultKey: `v501-smoke:${++rk}`, actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }]), true, false)
    const finish = (c, note = null) => rpc('aka_agent_engine_finish_campaign_v2', c.account, c.lease, note)
    const release = async c => { const r = await rpc('aka_agent_engine_release_v1', c.account, c.lease); c.lease = null; return r }
    const camp = c => one(`SELECT status, note, schedule, completed_at FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
    const rowStatus = id => val(`SELECT status FROM public.auto_campaign_input_data WHERE id = $1`, [id])
    const rows0 = c => db.query('SELECT id, status, schedule, phone FROM public.auto_campaign_input_data WHERE campaign_id = $1', [c.campaign]).then(r => r.rows)
    const runAll = async c => { for (;;) { const cl = await claim(c); if (cl.status !== 'claimed') return cl; await okDone(cl) } }

    // ---- 2. Điều kiện nhận lượt --------------------------------------------------------------------
    assert.equal((await claim(await makeCampaign({ accountStatus: 'tạm dừng' }))).status, 'account_paused')
    const stuck = await makeCampaign({ accountStatus: 'đang chạy' })
    assert.equal((await claim(stuck)).status, 'claimed', 'tài khoản "đang chạy" sót lại (không ai giữ) vẫn chạy được')
    assert.equal((await claim(await makeCampaign({ provisioning: 'staged' }))).status, 'campaign_not_ready')
    const dg = await makeCampaign({ sourceMode: 'data_group', endDate: new Date(Date.now() - 60e3).toISOString() })
    assert.equal((await claim(dg)).status, 'data_group_hard_end')
    pass('tài khoản tạm dừng → account_paused (tài khoản "đang chạy" sót lại vẫn chạy); đang nạp data ban đầu → campaign_not_ready; Nhóm data hết hạn → data_group_hard_end')

    const yesterday = "now() - interval '1 day'"
    const weekly = await makeCampaign({ schedule: yesterday, scheduleType: 'weekly' })
    const r1 = await claim(weekly)
    assert.equal(r1.status, 'maintenance_required')
    assert.equal(await rowStatus(weekly.ids[0]), 'chờ xử lý')
    assert.equal((await claim(await makeCampaign({ schedule: yesterday, scheduleType: 'daily', continueNextDay: true }))).status, 'maintenance_required')
    const dailyNoContinue = await makeCampaign({ schedule: yesterday, scheduleType: 'daily', continueNextDay: false })
    const before = await camp(dailyNoContinue)
    assert.equal((await claim(dailyNoContinue)).status, 'claimed', 'hằng ngày không chạy tiếp hôm sau: chạy tiếp ngay như bản cũ')
    assert.ok(new Date((await camp(dailyNoContinue)).schedule) > new Date(before.schedule), 'lịch ngày cũ được ghi lại thành lúc nhận (không giữ cổng bảo trì của bộ cũ)')
    pass('lịch ngày cũ chưa qua bảo trì → maintenance_required (hằng tuần, hằng ngày chạy tiếp hôm sau); hằng ngày không chạy tiếp thì chạy ngay')

    await db.query(`INSERT INTO public.org_staff VALUES (7201, 1)`)
    const busyWeb = await makeCampaign({ staff: 7201, server: false, web: true, org: 602 })
    await db.query(`UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = $1`, [busyWeb.campaign])
    const web2 = await makeCampaign({ staff: 7201, server: false, web: true, org: 602 })
    assert.equal((await claim(web2)).status, 'concurrency_limit')
    await db.query(`UPDATE public.org_staff SET max_running_zalo_web_accounts = 2 WHERE id = 7201`)
    assert.equal((await claim(web2)).status, 'claimed')
    const qr = await makeCampaign({ staff: 7201, server: false, web: false, org: 602 })
    await db.query(`UPDATE public.org_staff SET max_running_zalo_web_accounts = 0 WHERE id = 7201`)
    assert.equal((await claim(qr)).status, 'claimed', 'giới hạn chỉ áp cho tài khoản trình duyệt')
    pass('giới hạn tài khoản Zalo (trình duyệt) chạy đồng thời như bản cũ; tài khoản QR không bị tính')

    // ---- 3. Chờ khoá / hạn mức không dời lịch ----------------------------------------------------
    const locked = await makeCampaign({ note: 'ghi chú cũ' })
    await db.query(`INSERT INTO public.auto_account_action_status (account_id, action_code, is_disable, date_enable, disabled_error_code)
      VALUES ($1, 'zalo_find_phone_user', true, now() + interval '3 hours', 'err_network_offline')`, [locked.account])
    const sched0 = (await camp(locked)).schedule
    const w1 = await claim(locked)
    assert.equal(w1.status, 'wait')
    const afterWait = await one(`SELECT schedule, note, updated_at FROM public.auto_campaigns WHERE id = $1`, [locked.campaign])
    assert.equal(afterWait.schedule.toISOString(), sched0.toISOString(), 'lịch chiến dịch giữ nguyên')
    assert.match(afterWait.note, /chạy tiếp lúc/)
    await release(locked)
    const w2 = await claim(locked)
    assert.equal(w2.status, 'wait')
    const afterWait2 = await one(`SELECT updated_at FROM public.auto_campaigns WHERE id = $1`, [locked.campaign])
    assert.equal(afterWait2.updated_at.toISOString(), afterWait.updated_at.toISOString(), 'câu chờ không đổi thì không ghi lại chiến dịch')
    await release(locked)
    pass('chờ khoá/hạn mức: không dời lịch chiến dịch, chỉ ghi câu chờ khi đổi, trả wait.until cho nơi chạy')

    const noted = await makeCampaign({ note: '⏳ câu chờ cũ (NET01)' })
    assert.equal((await claim(noted)).status, 'claimed')
    assert.equal((await camp(noted)).note, null)
    pass('bắt đầu chạy thì xoá ghi chú cũ của chiến dịch')

    // ---- 4. Mỗi data một lần trong một lượt ----------------------------------------------------------
    const retry = await makeCampaign({ targets: 3 })
    const a = await claim(retry)
    assert.equal(a.target.id, retry.ids[0])
    const ra = await fail(a, 'err_test_requeue_v501')
    assert.equal(ra.next, 'next_target', 'về hàng đợi không kết thúc lượt: ' + JSON.stringify(ra))
    assert.equal(ra.target.status, 'chờ xử lý')
    assert.equal(ra.target.morePending, true)
    const b = await claim(retry)
    assert.equal(b.target.id, retry.ids[1], 'data vừa về hàng đợi không được nhận lại trong cùng lượt')
    await okDone(b)
    const cc = await claim(retry)
    assert.equal(cc.target.id, retry.ids[2])
    const rc = await okDone(cc)
    assert.equal(rc.target.morePending, false, 'không còn data chưa thử trong lượt: không nghỉ')
    const nt = await claim(retry)
    assert.equal(nt.status, 'no_target'); assert.equal(Number(nt.dueTried), 1)
    const fin = await finish(retry)
    assert.deepEqual([fin.ok, fin.reason, Number(fin.pendingCount)], [true, 'pending_input_remaining', 1])
    assert.equal((await camp(retry)).status, 'chờ xử lý')
    await release(retry)
    const again = await claim(retry)
    assert.equal(again.target.id, retry.ids[0], 'lượt sau thử lại data đó')
    await okDone(again)
    assert.equal((await claim(retry)).status, 'no_target')
    assert.deepEqual([(await finish(retry)).reason, (await camp(retry)).status], ['completed', 'hoàn thành'])
    await release(retry)
    pass('data về hàng đợi: các data phía sau vẫn chạy trong lượt; hết lượt thì "còn data chờ" (chưa hoàn thành); lượt sau thử lại rồi hoàn thành')

    // ---- 5. Không ghi đè tạm dừng của người dùng -------------------------------------------------------
    const guard = await makeCampaign({ targets: 2 })
    const g = await claim(guard)
    await db.query(`UPDATE public.auto_campaigns SET status = 'tạm dừng' WHERE id = $1`, [guard.campaign])
    const rg = await fail(g, 'err_test_hold_v501')
    // Review 12/11: hiệu ứng không áp được thì không báo như đã áp (lõi không in ghi chú chưa hề ghi).
    assert.equal(rg.campaign.effect, 'none', 'người dùng vừa tạm dừng: không báo hiệu ứng như đã áp')
    assert.equal(rg.campaign.note ?? null, null)
    assert.equal((await camp(guard)).status, 'tạm dừng', 'người dùng vừa tạm dừng: giữ tạm dừng')
    const guard2 = await makeCampaign({ targets: 2 })
    const g2 = await claim(guard2)
    const rg2 = await fail(g2, 'err_test_hold_v501')
    assert.equal(rg2.campaign.effect, 'hold', 'không ai đổi thì báo đúng hiệu ứng đã áp')
    assert.equal((await camp(guard2)).status, 'chờ xử lý', 'không ai đổi thì hoãn như chính sách')
    pass('hiệu ứng chiến dịch của kết quả không ghi đè tạm dừng của người dùng trong lúc data chạy, và khi đó không báo như đã áp')

    // ---- 6. Kết thúc lượt ----------------------------------------------------------------------------
    const future = new Date(Date.now() + 3600e3).toISOString()
    const fut = await makeCampaign({ targets: 2, targetSchedules: [null, future] })
    await runAll(fut)
    const ff = await finish(fut)
    assert.equal(ff.reason, 'rescheduled_future_input')
    const fc = await camp(fut)
    assert.deepEqual([fc.status, fc.note, fc.schedule.toISOString()], ['chờ xử lý', null, new Date(future).toISOString()])
    await release(fut)

    const ended = await makeCampaign({ targets: 1, scheduleType: 'weekly', endDate: new Date(Date.now() - 60e3).toISOString(), note: 'xoá khi bắt đầu' })
    await runAll(ended)
    assert.equal((await camp(ended)).note, null, 'ghi chú cũ bị xoá khi bắt đầu chạy')
    await db.query(`UPDATE public.auto_campaigns SET note = 'giữ ghi chú' WHERE id = $1`, [ended.campaign])
    assert.equal((await finish(ended)).reason, 'completed_end_date')
    assert.deepEqual([(await camp(ended)).status, (await camp(ended)).note], ['hoàn thành', 'giữ ghi chú'])
    await release(ended)

    const plain = await makeCampaign({ targets: 1 })
    await runAll(plain)
    assert.equal((await finish(plain, 'Câu hoàn thành')).reason, 'completed')
    assert.equal((await camp(plain)).note, 'Câu hoàn thành')
    await release(plain)

    const dgWait = await makeCampaign({ targets: 1, sourceMode: 'data_group' })
    await runAll(dgWait)
    const dgf = await finish(dgWait)
    assert.deepEqual([dgf.ok, dgf.reason], [false, 'completion_not_supported'])
    assert.equal((await camp(dgWait)).status, 'chờ xử lý', 'Nhóm data không bao giờ bị bộ mới tự hoàn thành (trigger sẽ dừng nguồn)')
    await release(dgWait)

    const flyPaused = await makeCampaign({ targets: 0 })
    assert.equal((await claim(flyPaused)).status, 'no_target')
    await db.query(`UPDATE public.auto_accounts SET status = 'tạm dừng' WHERE id = $1`, [flyPaused.account])
    assert.equal((await finish(flyPaused)).reason, 'account_control_won')
    assert.equal((await camp(flyPaused)).status, 'chờ xử lý')
    await release(flyPaused)
    pass('kết thúc lượt: hẹn theo data tương lai (xoá ghi chú); hết ngày kết thúc (giữ ghi chú); hoàn thành; Nhóm data không tự hoàn thành; Fly: tài khoản bị tạm dừng thì không hoàn thành')

    // ---- 7. Nhiều khung giờ và gửi lặp lại (cần còn ≥ 75 phút trong ngày) -----------------------------
    const now = vnMinuteNow()
    if (now < 5 || now > 23 * 60 + 59 - 75) {
      console.log('NOTE bỏ qua nhiều khung giờ / gửi lặp lại: quá gần nửa đêm giờ Việt Nam')
    } else {
      const startSlot = hhmm(now - 3), nextSlot = hhmm(now + 30)
      const slotSchedule = `(date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '${now - 3} minutes') AT TIME ZONE 'Asia/Ho_Chi_Minh'`
      const slots = (list, more = {}) => ({ action: 'zalo_message_friend', schedule: slotSchedule, extra: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: list }, ...more })

      const ms = await makeCampaign(slots(`${startSlot}, ${nextSlot}\n${hhmm(now + 60)}, 7h`))
      await runAll(ms)
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng' WHERE id = $1`, [ms.ids[2]])
      const mf = await finish(ms)
      assert.deepEqual([mf.reason, mf.slot], ['slot_advanced', nextSlot])
      const mc = await camp(ms)
      assert.equal(mc.status, 'chờ xử lý'); assert.equal(mc.note, null)
      assert.equal(new Date(mc.schedule).getTime(), new Date(mf.schedule).getTime())
      const resetRows = (await db.query(`SELECT status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [ms.campaign])).rows
      assert.deepEqual(resetRows.map(x => x.status), ['chờ xử lý', 'chờ xử lý', 'tạm dừng'], 'đặt lại mọi data trừ "tạm dừng"')
      await release(ms)

      const msCut = await makeCampaign(slots(`${startSlot}, ${nextSlot}`, { stopTime: hhmm(now + 15) + ':00' }))
      await runAll(msCut)
      const mcut = await finish(msCut)
      assert.deepEqual([mcut.reason, mcut.slot, (await camp(msCut)).status], ['completed_slot_after_cutoff', nextSlot, 'hoàn thành'])
      await release(msCut)

      const msNone = await makeCampaign(slots(`${hhmm(now - 10)}, ${startSlot}`))
      await runAll(msNone)
      assert.equal((await finish(msNone)).reason, 'completed_no_slot')
      await release(msNone)

      const msDue = await makeCampaign(slots(`${startSlot}, ${nextSlot}`, { targets: 2 }))
      const d1 = await claim(msDue)
      await fail(d1, 'err_test_requeue_v501')
      await okDone(await claim(msDue))
      assert.equal((await claim(msDue)).status, 'no_target')
      const mdue = await finish(msDue)
      assert.equal(mdue.reason, 'due_pending')
      assert.deepEqual([(await camp(msDue)).status, (await camp(msDue)).note], ['chờ xử lý', 'Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.'])
      await release(msDue)

      const msPaused = await makeCampaign(slots(`${startSlot}, ${nextSlot}`, { targets: 1 }))
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng' WHERE campaign_id = $1`, [msPaused.campaign])
      assert.equal((await claim(msPaused)).status, 'no_target')
      const mp = await finish(msPaused)
      assert.deepEqual([mp.reason, mp.suffix], ['completed_no_rerun_data', 'ở khung giờ tiếp theo'])
      await release(msPaused)

      const msYesterday = await makeCampaign(slots(`${startSlot}, ${nextSlot}`, { schedule: yesterday, scheduleType: 'daily', continueNextDay: false }))
      await runAll(msYesterday)
      assert.equal((await finish(msYesterday)).reason, 'completed', 'khung giờ hiện tại không phải hôm nay: hoàn thành như bản cũ')
      await release(msYesterday)
      pass('nhiều khung giờ: sang khung kế tiếp (đặt lại data trừ "tạm dừng"); khung sau giờ dừng; hết khung; còn data đến lịch; chỉ còn data tạm dừng; lịch ngày cũ')

      const share = (minutes, more = {}) => ({ action: 'zalo_message_group',
        extra: { zaloMessageSendMode: 'share', zaloShareRepeatEnabled: true, zaloShareRepeatAfterMinutes: minutes, ...(more.extra || {}) }, ...more })
      const rep = await makeCampaign(share(30))
      await runAll(rep)
      const rf = await finish(rep)
      assert.equal(rf.reason, 'repeat_scheduled')
      const lag = new Date(rf.schedule).getTime() - Date.now() - 30 * 60e3
      assert.ok(Math.abs(lag) < 60e3, 'lượt kế tiếp = lúc hoàn thành + 30 phút')
      await release(rep)

      const repStr = await makeCampaign(share('45'))
      await runAll(repStr)
      assert.equal((await finish(repStr)).reason, 'repeat_scheduled', 'số phút dạng chuỗi chữ số')
      await release(repStr)

      const repDay = await makeCampaign(share(1439))
      await runAll(repDay)
      assert.equal((await finish(repDay)).reason, 'completed_repeat_next_day')
      await release(repDay)

      const repCut = await makeCampaign(share(30, { stopTime: hhmm(now + 10) + ':00' }))
      await runAll(repCut)
      assert.equal((await finish(repCut)).reason, 'completed_repeat_after_cutoff')
      await release(repCut)

      const repCooldown = await makeCampaign(share(30, { extra: { recentDeliveryCooldownEnabled: true } }))
      await runAll(repCooldown)
      assert.equal((await finish(repCooldown)).reason, 'completed', 'bật chống gửi lặp N ngày thì không gửi lặp')
      await release(repCooldown)

      const repBad = await makeCampaign(share(3))
      await runAll(repBad)
      assert.equal((await finish(repBad)).reason, 'completed', 'số phút ngoài 5–1439 thì không gửi lặp')
      await release(repBad)
      pass('gửi lặp lại: hẹn sau x phút; sang ngày mới / vượt giờ dừng thì hoàn thành; bật chống gửi lặp hoặc số phút sai thì bỏ qua')
    }

    // ---- 7b. Chống gửi lặp N ngày trong claim (RPC giả theo hợp đồng của aka_agent_apply_campaign_delivery_cooldown) ----------
    await db.query(`CREATE TABLE public.cooldown_recent (phone text PRIMARY KEY)`)
    await db.query(`CREATE FUNCTION public.aka_agent_apply_campaign_delivery_cooldown(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[])
      RETURNS TABLE(input_data_id bigint, decision text, note text, last_sent_at timestamptz, eligible_date date, source_campaign_id bigint, source_campaign_name text)
      LANGUAGE plpgsql AS $f$
      DECLARE d record;
      BEGIN
        IF (SELECT c.extra_settings->>'recentDeliveryCooldownDays' FROM public.auto_campaigns c WHERE c.id = p_campaign_id) = 'bad' THEN
          RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_days';
        END IF;
        FOR d IN SELECT x.* FROM public.auto_campaign_input_data x WHERE x.id = ANY(p_input_data_ids) ORDER BY x.id FOR UPDATE LOOP
          -- Ca ngân sách thời gian (7d): mỗi lần kiểm tốn 5 ms để chắc chắn vượt ngân sách 1 ms sau đúng một data.
          IF d.phone LIKE '0913%' THEN PERFORM pg_sleep(0.005); END IF;
          IF d.status <> 'chờ xử lý' THEN
            RETURN QUERY SELECT d.id, 'not_pending'::text, 'Data không còn ở trạng thái chờ xử lý.'::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text;
          ELSIF EXISTS (SELECT 1 FROM public.cooldown_recent r WHERE r.phone = d.phone) THEN
            UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = 'Tạm dừng: đã gửi tin trước đó ngày 10/11/2026. Gửi lại từ 13/11/2026.' WHERE id = d.id;
            RETURN QUERY SELECT d.id, 'paused_recent_delivery'::text, 'Tạm dừng: đã gửi tin trước đó ngày 10/11/2026. Gửi lại từ 13/11/2026.'::text, now(), current_date, 1::bigint, 'cũ'::text;
          ELSE
            RETURN QUERY SELECT d.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text;
          END IF;
        END LOOP;
      END $f$`)
    await db.query(`INSERT INTO public.cooldown_recent VALUES ('0912000002'), ('0912000003')`)
    const cd = await makeCampaign({ targets: 0, extra: { enableMessage: true, recentDeliveryCooldownEnabled: true } })
    const cdIds = []
    for (const phone of ['0912000001', '0912000002', '0912000003', '0912000004']) {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [id, cd.campaign, phone])
      cdIds.push(id)
    }
    const k1 = await claim(cd)
    assert.deepEqual([k1.status, k1.target.id, k1.cooldownPaused], ['claimed', cdIds[0], []])
    await okDone(k1)
    const k2 = await claim(cd)
    assert.equal(k2.target.id, cdIds[3], 'bỏ qua 2 data đã gửi gần đây, nhận data kế tiếp')
    assert.deepEqual(k2.cooldownPaused.map(x => [Number(x.inputDataId), x.phone, x.note]), [
      [cdIds[1], '0912000002', 'Tạm dừng: đã gửi tin trước đó ngày 10/11/2026. Gửi lại từ 13/11/2026.'],
      [cdIds[2], '0912000003', 'Tạm dừng: đã gửi tin trước đó ngày 10/11/2026. Gửi lại từ 13/11/2026.']])
    for (const id of [cdIds[1], cdIds[2]]) assert.equal(await rowStatus(id), 'tạm dừng')
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_campaign_details WHERE input_data_id = ANY($1::bigint[])`, [[cdIds[1], cdIds[2]]])), 0,
      'không ghi lịch sử cho data bị chặn gửi lặp')
    await okDone(k2)
    assert.equal((await claim(cd)).status, 'no_target')
    assert.equal((await finish(cd)).reason, 'completed', 'data tạm dừng vì gửi lặp không giữ chiến dịch lại')
    await release(cd)

    const cdBad = await makeCampaign({ targets: 1, extra: { enableMessage: true, recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 'bad' } })
    const kb = await claim(cdBad)
    assert.equal(kb.status, 'gate_unavailable')
    assert.match((await camp(cdBad)).note, /^Không thể kiểm tra giới hạn gửi\/đăng lặp; chiến dịch sẽ tự thử lại: Không thể kiểm tra lịch sử gửi\/đăng gần nhất: invalid_campaign_delivery_cooldown_days/)
    assert.equal(await rowStatus(cdBad.ids[0]), 'chờ xử lý', 'không kiểm được thì data giữ nguyên')
    await release(cdBad)
    await db.query(`UPDATE public.auto_engine_gates SET on_error = 'open' WHERE code = 'delivery_cooldown'`)
    assert.equal((await claim(cdBad)).status, 'claimed', 'cổng mở khi lỗi (cấu hình DB) thì vẫn gửi')
    await db.query(`UPDATE public.auto_engine_gates SET on_error = 'closed' WHERE code = 'delivery_cooldown'`)

    const cdOff = await makeCampaign({ targets: 1 })
    await db.query(`UPDATE public.auto_campaign_input_data SET phone = '0912000002' WHERE id = $1`, [cdOff.ids[0]])
    const ko = await claim(cdOff)
    assert.equal(ko.status, 'claimed', 'không bật chống gửi lặp thì không kiểm: ' + JSON.stringify(ko) + JSON.stringify(await rows0(cdOff)))
    pass('chống gửi lặp trong claim: tạm dừng data đã gửi gần đây (không lịch sử, không lượt), nhận data kế tiếp; lỗi kiểm thì chiến dịch chờ kèm ghi chú')

    // ---- 7c. Nhóm data với hàm kết thúc thật của production (aka_agent_internal_finalize_data_group_campaign_v219) ----------
    // Bảng nguồn tối thiểu + hai hàm phụ (khoá nạp data như production; kiểm tenant để trống), rồi nạp nguyên văn hàm kết thúc.
    await db.query(`CREATE TABLE public.auto_campaign_data_group_sources (id bigserial PRIMARY KEY, campaign_id bigint NOT NULL, staff_id bigint,
      organization_id bigint, status text NOT NULL, stopped_at timestamptz, stop_reason text, updated_at timestamptz DEFAULT now())`)
    await db.query(`CREATE FUNCTION public.aka_agent_internal_require_staff_tenant(p_staff_id bigint, p_organization_id bigint) RETURNS void
      LANGUAGE plpgsql AS $$ BEGIN END $$`)
    await db.query(`CREATE FUNCTION public.aka_agent_lock_campaign_input_serialization(p_campaign_id bigint) RETURNS void LANGUAGE sql
      AS $$ SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || p_campaign_id::text, 0)) $$`)
    await db.query(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/campaign-outcome-engine/data-group-finalizer-v219.sql'), 'utf8'))
    assert.equal(await md5Of('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)'), '7786668cdaed19f1b42e1cd37044734a')
    const dgCampaign = async ({ sourceStatus = 'active', targets = 2, endDate = null } = {}) => {
      const c = await makeCampaign({ targets, sourceMode: 'data_group', endDate, org: 640, staff: 7640 })
      await db.query(`INSERT INTO public.auto_campaign_data_group_sources (campaign_id, staff_id, organization_id, status) VALUES ($1, 7640, 640, $2)`,
        [c.campaign, sourceStatus])
      return c
    }
    const source = c => one(`SELECT status, stop_reason FROM public.auto_campaign_data_group_sources WHERE campaign_id = $1`, [c.campaign])
    // DG1: nguồn đang nhận: chạy hết data → hàm kết thúc giữ chờ xử lý + "Chờ data mới" (không hoàn thành, nguồn vẫn nhận).
    const dg1 = await dgCampaign()
    const end1 = await runAll(dg1)
    assert.equal(end1.status, 'no_target'); assert.equal(end1.dataGroup, true)
    const f1 = await finish(dg1)
    assert.deepEqual([f1.reason, f1.finalize.reason, f1.campaignStatus], ['data_group_waiting', 'active_source_waiting', 'chờ xử lý'])
    assert.deepEqual([(await camp(dg1)).status, (await camp(dg1)).note], ['chờ xử lý', 'Chờ data mới'])
    assert.equal((await source(dg1)).status, 'active')
    await release(dg1)
    // DG2: lượt sau khi chưa có data mới: không nhận lượt, không giữ chỗ tài khoản, không gọi hàm kết thúc (như claim bản cũ).
    const updatedBefore = (await one(`SELECT updated_at FROM public.auto_campaigns WHERE id = $1`, [dg1.campaign])).updated_at
    const idle = await claim(dg1)
    assert.equal(idle.status, 'data_group_waiting'); assert.equal(idle.leaseToken, undefined)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_engine_leases WHERE account_id = $1 AND expires_at > now()`, [dg1.account])), 0)
    assert.equal((await one(`SELECT updated_at FROM public.auto_campaigns WHERE id = $1`, [dg1.campaign])).updated_at.getTime(), updatedBefore.getTime(),
      'không ghi lại chiến dịch khi đang chờ')
    // Data mới được nạp vào (router xoá ghi chú "Chờ data mới"): lượt sau chạy ngay.
    await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
      VALUES ($1, $2, 'Mới', '0912999001', 'chờ xử lý', false)`, [++nextId, dg1.campaign])
    assert.equal((await claim(dg1)).status, 'claimed')
    await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now() WHERE lease_token = $1`, [dg1.lease]).catch(() => {})
    pass('Nhóm data: chạy hết data thì hàm kết thúc thật giữ "Chờ data mới"; lượt rảnh không giữ chỗ, không ghi gì; có data mới thì chạy')

    // DG3: nguồn đã dừng: chạy hết data → hoàn thành (source_stopped_and_drained).
    const dg3 = await dgCampaign({ sourceStatus: 'stopped' })
    assert.equal((await runAll(dg3)).status, 'no_target')
    const f3 = await finish(dg3)
    assert.deepEqual([f3.reason, f3.finalize.reason, (await camp(dg3)).status], ['data_group_completed', 'source_stopped_and_drained', 'hoàn thành'])
    await release(dg3)
    // DG4: hết hạn: claim gọi hàm kết thúc với câu của bản cũ: dừng nguồn, đóng data chờ, hoàn thành chiến dịch.
    const dg4 = await dgCampaign({ endDate: new Date(Date.now() - 60e3).toISOString() })
    const h4 = await claim(dg4)
    assert.deepEqual([h4.status, h4.finalize?.completed, h4.finalize?.reason], ['data_group_hard_end', true, 'hard_end_reached'])
    const c4 = await camp(dg4)
    assert.deepEqual([c4.status, c4.note], ['hoàn thành', 'Chiến dịch đã hết thời hạn nhận và chạy data mới'])
    assert.deepEqual((await rows0(dg4)).map(r => r.status), ['hoàn thành', 'hoàn thành'])
    assert.equal(await val(`SELECT note FROM public.auto_campaign_input_data WHERE id = $1`, [dg4.ids[0]]), 'Chiến dịch đã hết hạn')
    assert.deepEqual(await source(dg4), { status: 'stopped', stop_reason: 'hard_end_reached' })
    pass('Nhóm data: nguồn dừng thì hoàn thành; hết hạn thì claim gọi hàm kết thúc của bản cũ (dừng nguồn, đóng data chờ, hoàn thành)')

    // ---- 7d. Sửa theo review 12/11 ---------------------------------------------------------------------
    // (a) Khoá tư vấn trước khoá dòng, đúng thứ tự bản cũ. Phiên thứ hai giữ khoá; claim (lock_timeout ngắn) phải đứng chờ đúng khoá đó.
    const db2 = await connect()
    try {
      const holdLock = async key => { await db2.query('BEGIN'); await db2.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]) }
      const dgL = await makeCampaign({ sourceMode: 'data_group', targets: 1 })
      const directL = await makeCampaign({ targets: 1 })
      await holdLock(`aka-agent-campaign-input-serialization:${dgL.campaign}`)
      await db.query(`SET lock_timeout = '300ms'`)
      await assert.rejects(claim(dgL), /lock timeout/, 'chiến dịch Nhóm data: claim chờ khoá nạp data trước khi khoá dòng chiến dịch')
      await db2.query('ROLLBACK')
      await holdLock(`aka-agent-campaign-input-serialization:${directL.campaign}`)
      assert.equal((await claim(directL)).status, 'claimed', 'chiến dịch nhập trực tiếp không lấy khoá nạp data')
      await db2.query('ROLLBACK')
      assert.equal((await claim(dgL)).status, 'claimed')

      await db.query(`INSERT INTO public.org_staff VALUES (7301, 3)`)
      const webL = await makeCampaign({ staff: 7301, server: false, web: true, org: 603 })
      const qrL = await makeCampaign({ staff: 7301, server: false, web: false, org: 603 })
      await holdLock('aka-agent-browser-run-limits:7301')
      await assert.rejects(claim(webL), /lock timeout/, 'tài khoản Zalo (trình duyệt) bắt đầu lượt: chờ khoá giới hạn chạy đồng thời như bản cũ')
      assert.equal((await claim(qrL)).status, 'claimed', 'tài khoản QR không lấy khoá giới hạn')
      await db2.query('ROLLBACK')
      const webClaim = await claim(webL)
      assert.equal(webClaim.status, 'claimed')
      await holdLock('aka-agent-browser-run-limits:7301')
      assert.equal((await claim(webL, { leaseToken: webClaim.leaseToken })).status, 'claimed', 'lượt đang chạy (đã giữ lease) không lấy lại khoá')
      await db2.query('ROLLBACK')
      await db.query(`SET lock_timeout = 0`)
    } finally {
      await db2.query('ROLLBACK').catch(() => {})
      await db2.end().catch(() => {})
    }
    pass('khoá tư vấn trước khoá dòng như bản cũ: khoá nạp data của chiến dịch Nhóm data; khoá giới hạn tài khoản Zalo (trình duyệt) khi bắt đầu lượt')

    // (b) Ngân sách thời gian của vòng chống gửi lặp: hết ngân sách thì trả cooldown_scan, data đã tạm dừng được giữ, gọi lại đi tiếp.
    await db.query(`INSERT INTO public.auto_system_settings(key, value, description) VALUES ('engine.cooldown_scan_ms', '1', 'smoke')`)
    await db.query(`INSERT INTO public.cooldown_recent VALUES ('0913000001'), ('0913000002'), ('0913000003')`)
    const cdT = await makeCampaign({ targets: 0, extra: { enableMessage: true, recentDeliveryCooldownEnabled: true } })
    const tIds = []
    for (const phone of ['0913000001', '0913000002', '0913000003', '0913000004']) {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [id, cdT.campaign, phone])
      tIds.push(id)
    }
    for (let i = 0; i < 3; i++) {
      const k = await claim(cdT)
      assert.equal(k.status, 'cooldown_scan', `lần ${i + 1}: hết ngân sách thời gian sau một data`)
      assert.deepEqual(k.cooldownPaused.map(x => Number(x.inputDataId)), [tIds[i]])
      assert.equal(await rowStatus(tIds[i]), 'tạm dừng', 'data đã tạm dừng được giữ (không huỷ cả lần gọi)')
    }
    const kT = await claim(cdT)
    assert.deepEqual([kT.status, kT.target.id], ['claimed', tIds[3]])
    await okDone(kT)
    await db.query(`UPDATE public.auto_system_settings SET value = 'abc' WHERE key = 'engine.cooldown_scan_ms'`)
    assert.equal((await claim(cdT)).status, 'no_target', 'giá trị sai thì dùng mặc định, không lỗi')
    await db.query(`DELETE FROM public.auto_system_settings WHERE key = 'engine.cooldown_scan_ms'`)
    await release(cdT)
    pass('chống gửi lặp trong claim có ngân sách thời gian (engine.cooldown_scan_ms): trả cooldown_scan, giữ data đã tạm dừng, lần gọi sau đi tiếp')

    // (c) finish_v2: bộ cũ đã nhận chiến dịch (token) thì không kết thúc; lượt không nhận data nào thì xoá ghi chú của lượt trước.
    const lg = await makeCampaign({ targets: 1 })
    await okDone(await claim(lg))
    assert.equal((await claim(lg)).status, 'no_target')
    await db.query(`UPDATE public.auto_campaigns SET runtime_claim_token = gen_random_uuid() WHERE id = $1`, [lg.campaign])
    assert.equal((await finish(lg)).reason, 'legacy_busy')
    assert.equal((await camp(lg)).status, 'đang chạy', 'không đổi gì khi bộ cũ đang giữ')
    await db.query(`UPDATE public.auto_campaigns SET runtime_claim_token = NULL WHERE id = $1`, [lg.campaign])
    assert.equal((await finish(lg)).reason, 'completed')
    await release(lg)

    const staleNote = 'Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: lỗi cũ'
    const sn = await makeCampaign({ targets: 1, note: staleNote })
    await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng' WHERE campaign_id = $1`, [sn.campaign])
    assert.equal((await claim(sn)).status, 'no_target')
    assert.equal((await finish(sn)).reason, 'completed')
    assert.deepEqual([(await camp(sn)).status, (await camp(sn)).note], ['hoàn thành', null], 'ghi chú của lượt trước không còn sau khi hoàn thành')
    await release(sn)
    const kept = await makeCampaign({ targets: 1 })
    const kc = await claim(kept)
    await db.query(`UPDATE public.auto_campaigns SET note = 'ghi trong lượt' WHERE id = $1`, [kept.campaign])
    await okDone(kc)
    assert.equal((await claim(kept)).status, 'no_target')
    assert.equal((await finish(kept)).reason, 'completed')
    assert.equal((await camp(kept)).note, 'ghi trong lượt', 'lượt đã nhận data: ghi chú ghi trong lượt giữ như bản cũ')
    await release(kept)
    pass('kết thúc lượt: bộ cũ còn giữ chiến dịch → legacy_busy; lượt không nhận data thì xoá ghi chú cũ, lượt đã nhận data thì giữ')

    // ---- 8. Rollback, apply lại --------------------------------------------------------------------
    await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'test' WHERE completed_at IS NULL`)
    await db.query(`DELETE FROM public.auto_engine_leases`)
    await db.query(v501.rollback)
    assert.equal(await md5Of(CLAIM), v501.LIVE.claim); assert.equal(await md5Of(REPORT), v501.LIVE.report)
    assert.equal(await val(`SELECT to_regprocedure($1)`, [FINISH]), null)
    await db.query(v501.migration)
    assert.equal(await md5Of(CLAIM), v501.NEW.claim)
    pass('rollback trả claim/report về V499, gỡ finish_v2 và cột; apply lại được')
    console.log(`\n${checks} nhóm kiểm tra đạt`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
