// V585: engine v2 đọc được danh sách "Chạy nhiều khung giờ" lưu dạng mảng (chiến dịch tạo / sửa trên Web). Kiểm trên PostgreSQL 17 cục bộ
// dùng một lần: DB engine v2 như production (bootstrap của bộ kịch bản tới V532, engine Facebook V556–V558 + V564, V561), rồi apply V585.
// Không mạng, không dữ liệu khách.
// Chạy: CHAT_REPO=<thư mục có module pg> LC_ALL=C node scripts/engine-v2-multi-slot-array-v585-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap: engineBootstrap } = require('./engine-v2-scenarios/bootstrap.cjs')
const { applyFacebookMigrations } = require('./engine-v2-facebook/fixture.cjs')
const { applyCampaignRepeatV561 } = require('./fixtures/campaign-outcome-engine/campaign-repeat-v561.cjs')
const V585 = require('./build-v585-sql.cjs')
const PORT = Number(process.env.V585_TEST_PORT || 55585)

const vnMinuteNow = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes() }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v585-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  const finishMd5 = () => val(`SELECT md5(pg_get_functiondef(to_regprocedure($1)))`, [V585.SIG])
  const acl = () => val(`SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(p.proconfig::text, '') FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [V585.SIG])
  try {
    await engineBootstrap(db, [])
    await applyFacebookMigrations(db)
    await applyCampaignRepeatV561(db)
    assert.equal(await finishMd5(), V585.LIVE_MD5, 'fixture: thân finish_campaign_v2 như production (V561)')

    // ---- Dữ liệu thử ------------------------------------------------------------------------------------------------------
    let nextId = 985000
    const makeCampaign = async ({ action = 'zalo_message_group', targets = 3, org = 601, staff = 7101, schedule = "now() - interval '1 minute'",
      scheduleType = 'weekly', endDate = null, extra = {}, stopTime = null } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.org_staff(id, organization_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [staff, org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Tài khoản thử', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true, false)`, [account, staff, org])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
          provisioning_state, data_target_source_mode, schedule_end_date, extra_settings, daily_stop_time, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chiến dịch thử', $2, $3, 'chờ xử lý', ${schedule}, NULL, $4, true, 'ready', 'direct', $5, $6::jsonb, $7, false, $8, $9)`,
        [campaign, action, account, scheduleType, endDate, JSON.stringify(extra), stopTime, staff, org])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Nhóm ${i + 1}`, `0912${String(id).slice(-6)}`])
        ids.push(id)
      }
      return { account, campaign, staff, ids, lease: null }
    }
    const ctx = c => JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign, runnerId: 'fly:v585', runtimeTarget: 'fly',
      leaseToken: c.lease ?? null, actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] })
    const claim = async c => { const res = await rpc('aka_agent_engine_claim_target_v1', ctx(c)); if (res.leaseToken) c.lease = res.leaseToken; return res }
    let rk = 0
    const okDone = cl => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken,
      JSON.stringify([{ resultKey: `v585-smoke:${++rk}`, actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }]), true, false)
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

    const now = vnMinuteNow()
    if (now < 15 || now > 23 * 60 + 59 - 75) {
      console.log('NOTE bỏ qua: bài kiểm cần còn ít nhất 75 phút trong ngày giờ Việt Nam (và sau 00:15)')
      return
    }
    const startSlot = hhmm(now - 3), nextSlot = hhmm(now + 30), laterSlot = hhmm(now + 60)
    const slotSchedule = `(date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '${now - 3} minutes') AT TIME ZONE 'Asia/Ho_Chi_Minh'`
    const slots = (list, more = {}) => ({ schedule: slotSchedule, ...more,
      extra: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: list, zaloMessageSendMode: 'share', ...(more.extra || {}) } })
    const nextAt = slot => new Date(`${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}T${slot}:00+07:00`).getTime()

    // ---- 1. Trước V585: tái hiện lỗi production --------------------------------------------------------------------------------
    const bug = await pass1(slots([startSlot, nextSlot, laterSlot]))
    assert.deepEqual([bug.f.reason, bug.after.status], ['completed', 'hoàn thành'], 'thân V561: danh sách dạng mảng bị coi là không có khung giờ')
    const stringBefore = await pass1(slots(`${startSlot},${nextSlot},${laterSlot}`))
    assert.deepEqual([stringBefore.f.reason, stringBefore.f.slot, stringBefore.after.status], ['slot_advanced', nextSlot, 'chờ xử lý'])
    pass('trước V585 (thân V561 như production): danh sách khung giờ dạng mảng → hoàn thành sau lượt đầu; dạng chuỗi → hẹn khung kế')

    // ---- 2. Apply, quyền, không chạy lại ------------------------------------------------------------------------------------------
    const aclBefore = await acl()
    await db.query(V585.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await finishMd5(), V585.LIVE_MD5, 'apply rồi ROLLBACK không để lại gì')
    await db.query(V585.migration)
    assert.equal(await finishMd5(), V585.NEW_MD5)
    assert.equal(await acl(), aclBefore, 'chủ sở hữu, quyền, thuộc tính, thiết lập của hàm giữ nguyên')
    await assert.rejects(db.query(V585.migration), /đã chạy \(finish\)/)
    await db.query('ROLLBACK')
    assert.equal(await finishMd5(), V585.NEW_MD5)
    pass('apply rồi ROLLBACK không để lại gì; apply thật ra đúng md5 thân mới; quyền / chủ sở hữu giữ nguyên; apply lần hai bị chặn')

    // ---- 3. Sau V585: danh sách dạng mảng -----------------------------------------------------------------------------------------
    const arr = await pass1(slots([startSlot, nextSlot, laterSlot]))
    assert.deepEqual([arr.f.reason, arr.f.slot, arr.after.status, arr.after.note], ['slot_advanced', nextSlot, 'chờ xử lý', null])
    assert.equal(new Date(arr.after.schedule).getTime(), nextAt(nextSlot), 'lịch chiến dịch = khung kế tiếp hôm nay')
    assert.deepEqual(arr.after.rows, ['chờ xử lý', 'chờ xử lý', 'chờ xử lý'], 'data được đặt lại cho khung kế')
    const friend = await pass1(slots([startSlot, nextSlot], { action: 'zalo_message_friend', scheduleType: 'daily' }))
    assert.deepEqual([friend.f.reason, friend.f.slot], ['slot_advanced', nextSlot], 'nhắn bạn bè, lịch hàng ngày')
    const unsorted = await pass1(slots([laterSlot, nextSlot, startSlot, nextSlot]))
    assert.deepEqual([unsorted.f.reason, unsorted.f.slot], ['slot_advanced', nextSlot], 'mảng không theo thứ tự, có phần tử trùng')
    // Phần tử lạ: null, số, đối tượng, mảng lồng, chữ sai, khoảng trắng, cách viết "7h" / "H:M". Phần tử sai bị bỏ, phần tử đúng vẫn dùng.
    const messy = await pass1(slots([null, ` ${startSlot} `, { a: 1 }, ['x'], 'abc', '25:00', true, `${Math.floor((now + 30) / 60)}h${(now + 30) % 60}`, laterSlot]))
    assert.deepEqual([messy.f.reason, messy.f.slot], ['slot_advanced', nextSlot], 'phần tử lạ bị bỏ, phần tử viết kiểu "HhM" vẫn đọc được')
    pass('sau V585: mảng → hẹn khung kế, đặt lại data; nhắn bạn bè; mảng lộn xộn / trùng; phần tử lạ bị bỏ')

    // ---- 4. Sau V585: các nhánh khác của nhiều khung giờ với mảng ------------------------------------------------------------------
    const cut = await pass1(slots([startSlot, nextSlot], { stopTime: hhmm(now + 15) + ':00' }))
    assert.deepEqual([cut.f.reason, cut.f.slot, cut.after.status], ['completed_slot_after_cutoff', nextSlot, 'hoàn thành'], 'khung kế từ giờ dừng trong ngày trở đi')
    const none = await pass1(slots([hhmm(now - 10), startSlot]))
    assert.deepEqual([none.f.reason, none.after.status], ['completed_no_slot', 'hoàn thành'], 'không còn khung nào hôm nay')
    for (const list of [[], [nextSlot], [null, 'abc'], { 0: startSlot, 1: nextSlot }, true]) {
      const r = await pass1(slots(list))
      assert.deepEqual([r.f.reason, r.after.status], ['completed', 'hoàn thành'], `dưới 2 khung hợp lệ: ${JSON.stringify(list)}`)
    }
    const off = await pass1({ schedule: slotSchedule, extra: { multiDailyTimeSlotsEnabled: false, multiDailyTimeSlots: [startSlot, nextSlot] } })
    assert.deepEqual([off.f.reason, off.after.status], ['completed', 'hoàn thành'], 'không bật nhiều khung giờ thì mảng không có tác dụng')
    const phone = await pass1(slots([startSlot, nextSlot], { action: 'zalo_message_phone' }))
    assert.deepEqual([phone.f.reason, phone.after.status], ['completed', 'hoàn thành'], 'loại chiến dịch không hỗ trợ nhiều khung giờ')
    pass('sau V585, mảng: khung kế vượt giờ dừng; hết khung; dưới 2 khung hợp lệ / kiểu khác; không bật; loại không hỗ trợ → hoàn thành như cũ')

    // ---- 5. Sau V585: dạng chuỗi không đổi ---------------------------------------------------------------------------------------
    const stringAfter = await pass1(slots(`${startSlot},${nextSlot},${laterSlot}`))
    assert.deepEqual([stringAfter.f.reason, stringAfter.f.slot, stringAfter.after.status], [stringBefore.f.reason, stringBefore.f.slot, stringBefore.after.status])
    assert.deepEqual(Object.keys(stringAfter.f).sort(), Object.keys(stringBefore.f).sort(), 'câu trả lời cùng khoá')
    const stringMixed = await pass1(slots(`${startSlot}, ${nextSlot}\n${laterSlot}, 7h`))
    assert.deepEqual([stringMixed.f.reason, stringMixed.f.slot], ['slot_advanced', nextSlot])
    assert.deepEqual(Object.keys(arr.f).sort(), Object.keys(stringAfter.f).sort(), 'mảng và chuỗi trả cùng khoá')
    pass('sau V585: danh sách dạng chuỗi (Desktop) trả lời y như trước')

    // ---- 6. Cài đặt của khách (tổ chức 2214): 08:00 … 23:00, giờ dừng 23:30, lịch tuần, gửi dạng chia sẻ, lịch 08:00 hôm nay -----
    const hourly = Array.from({ length: 16 }, (_, i) => hhmm((8 + i) * 60))
    const expected = hourly.find(slot => nextAt(slot) > Date.now() + 5000)
    const customer = await pass1({ schedule: `(date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '8 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh'`,
      targets: 8, stopTime: '23:30:00', endDate: '2026-12-31T16:59:59Z',
      extra: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: hourly, zaloMessageSendMode: 'share', refreshData: true } })
    if (now < 8 * 60) {
      console.log('NOTE ca của khách: trước 08:00 giờ Việt Nam lịch 08:00 chưa tới, bỏ qua so khung kế')
    } else if (expected) {
      assert.deepEqual([customer.f.reason, customer.f.slot, customer.after.status], ['slot_advanced', expected, 'chờ xử lý'])
      assert.equal(new Date(customer.after.schedule).getTime(), nextAt(expected))
    } else {
      assert.deepEqual([customer.f.reason, customer.after.status], ['completed_no_slot', 'hoàn thành'])
    }
    pass(`cài đặt của khách (16 khung 08:00–23:00, giờ dừng 23:30): ${expected ? `hẹn khung ${expected}` : 'hết khung trong ngày'}`)

    // ---- 7. Gỡ ---------------------------------------------------------------------------------------------------------------------
    await db.query(V585.rollback)
    assert.equal(await finishMd5(), V585.LIVE_MD5)
    assert.equal(await acl(), aclBefore)
    await assert.rejects(db.query(V585.rollback), /hàm đã là bản trước/)
    await db.query('ROLLBACK')
    const back = await pass1(slots([startSlot, nextSlot, laterSlot]))
    assert.deepEqual([back.f.reason, back.after.status], ['completed', 'hoàn thành'], 'gỡ xong: lại như thân V561')
    await db.query(V585.migration)
    assert.equal(await finishMd5(), V585.NEW_MD5)
    pass('gỡ trả đúng thân V561 và quyền; gỡ lần hai bị chặn; apply lại được')

    console.log(`\n${checks} nhóm đạt`)
  } finally {
    await db.end().catch(() => {})
    await stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
