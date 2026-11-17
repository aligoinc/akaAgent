// V555: "Lặp lại sau khi chạy xong". Kiểm trên PostgreSQL cục bộ dùng một lần: fixture engine v2 dựng tới V532 như production, cộng
// các mảnh tối thiểu của trung tâm thông báo (thân hàm V475 thật), rồi apply V555. Không mạng, không dữ liệu khách.
// Chạy (container cloud, PG16, root): runuser -u postgres -- env PG17_BIN=/usr/lib/postgresql/16/bin CHAT_REPO=<thư mục có module pg> \
//   node scripts/campaign-repeat-v555-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v555 = require('./build-v555-sql.cjs')
const PORT = Number(process.env.V555_TEST_PORT || 55555)
const CORE = 'private.aka_agent_campaign_repeat_core'

async function bootstrap(db) {
  const build = n => require(`./build-v${n}-sql.cjs`).migration
  await buildFixture(db, [])
  await db.query(MIGRATION)
  await db.query(build(499))
  await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8'))
  for (const n of [501, 503, 504, 505, 506, 507, 508, 509, 512]) await db.query(build(n))
  for (const n of [515, 517, 527, 532]) await db.query(build(n))
  await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
  // Như production: completed_at do trigger đặt khi chiến dịch chuyển "hoàn thành".
  await db.query(`CREATE FUNCTION public.aka_agent_set_campaign_completed_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status = 'hoàn thành' AND OLD.status IS DISTINCT FROM NEW.status THEN NEW.completed_at = now(); END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trg_aka_agent_set_campaign_completed_at BEFORE UPDATE OF status ON public.auto_campaigns
      FOR EACH ROW EXECUTE FUNCTION public.aka_agent_set_campaign_completed_at();`)
  // Phiên Desktop: nhân viên lấy từ GUC thử.
  await db.query(`CREATE FUNCTION private.aka_agent_desktop_data_context() RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean)
    LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT nullif(current_setting('test.desktop_staff', true), '')::bigint, 601::bigint, false
       WHERE current_setting('role', true) = 'aka_agent_desktop' AND nullif(current_setting('test.desktop_staff', true), '') IS NOT NULL $$`)
  await db.query(`CREATE TABLE public.auto_campaign_logs (id bigserial PRIMARY KEY, campaign_id bigint NOT NULL, log text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
  await db.query(`CREATE TABLE public.auto_journeys (id bigint PRIMARY KEY, is_delete boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'active');
    CREATE TABLE public.auto_journey_step_campaigns (journey_id bigint NOT NULL, campaign_id bigint NOT NULL)`)
  // Trung tâm thông báo: bảng và hàm phụ tối thiểu, thân hàm ghi thông báo là bản V475 đang chạy trên production.
  await db.query(`CREATE TABLE public.auto_notification_subscriptions (staff_id bigint, event_type text, scope text, is_enabled boolean, filters jsonb, cooldown_minutes integer);
    CREATE TABLE public.auto_notifications (id bigserial PRIMARY KEY, organization_id bigint, staff_id bigint, event_type text, severity text, campaign_id bigint,
      account_id bigint, entity_key text, occurred_at timestamptz, deliver_after timestamptz, dedupe_key text UNIQUE, payload jsonb,
      content_status text NOT NULL DEFAULT 'pending', updated_at timestamptz);
    CREATE FUNCTION private.aka_agent_notification_enabled() RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE FUNCTION private.aka_agent_notification_default_filters(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"toStatuses":["hoàn thành","tạm dừng"]}'::jsonb $$;
    CREATE FUNCTION private.aka_agent_notification_int_setting(text, integer) RETURNS integer LANGUAGE sql AS 'SELECT 0';
    CREATE FUNCTION private.aka_agent_notification_staff_org(bigint, bigint) RETURNS bigint LANGUAGE sql AS 'SELECT $2';
    CREATE FUNCTION private.aka_agent_notification_change_source() RETURNS text LANGUAGE sql AS $$ SELECT 'test'::text $$;`)
  const v475 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v475_journey_campaign_notifications.sql'), 'utf8')
  const capture = /CREATE OR REPLACE FUNCTION private\.aka_agent_notification_capture_campaign\(\)[\s\S]*?\$\$;/.exec(v475)[0]
  await db.query(capture)
  await db.query(`CREATE TRIGGER trg_aka_agent_notify_campaign_status AFTER UPDATE OF status ON public.auto_campaigns FOR EACH ROW
    WHEN (old.status IS DISTINCT FROM new.status AND new.is_delete IS NOT TRUE AND new.staff_id IS NOT NULL)
    EXECUTE FUNCTION private.aka_agent_notification_capture_campaign()`)
}

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v555-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  const md5Of = sig => val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig])
  const priv = (role, fn) => val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, fn])
  try {
    await bootstrap(db)

    // ---- 1. Apply, quyền, gỡ ----------------------------------------------------------------------------------------------
    assert.equal(await md5Of(v555.FINISH_SIG), v555.LIVE.finish, 'fixture: thân finish_campaign_v2 như production')
    assert.equal(await md5Of(v555.CAPTURE_SIG), v555.LIVE.capture, 'fixture: thân hàm ghi thông báo như production')
    await db.query(v555.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await md5Of(v555.FINISH_SIG), v555.LIVE.finish)
    assert.equal(await val(`SELECT to_regclass('private.auto_campaign_repeat_state')`), null)
    await db.query(v555.migration)
    assert.equal(await md5Of(v555.FINISH_SIG), v555.NEW.finish)
    assert.equal(await md5Of(v555.CAPTURE_SIG), v555.NEW.capture)
    await assert.rejects(db.query(v555.migration), /bảng đếm lượt đã có/)
    await db.query('ROLLBACK')
    for (const sig of Object.values(v555.SIGS)) {
      const isPublic = sig.startsWith('public.')
      for (const role of ['anon', 'authenticated', 'aka_agent_chat_api']) assert.equal(await priv(role, sig), false, `${role} ${sig}`)
      assert.equal(await priv('service_role', sig), isPublic, `service_role ${sig}`)
      assert.equal(await priv('aka_agent_desktop', sig), isPublic && sig !== v555.SIGS.tickV1, `aka_agent_desktop ${sig}`)
    }
    assert.equal(await val(`SELECT value FROM public.auto_system_settings WHERE key = $1`, [v555.SETTING_KEY]), '{"audience":"admin_akabiz","sweeper":true}')
    await db.query(v555.rollback)
    assert.equal(await md5Of(v555.FINISH_SIG), v555.LIVE.finish)
    assert.equal(await md5Of(v555.CAPTURE_SIG), v555.LIVE.capture)
    assert.equal(await val(`SELECT to_regclass('private.auto_campaign_repeat_state')`), null)
    assert.equal(await val(`SELECT count(*)::int FROM public.auto_system_settings WHERE key = $1`, [v555.SETTING_KEY]), 0)
    await db.query(v555.migration)
    pass('apply rồi ROLLBACK không để lại gì; apply thật; apply lần hai bị chặn; quyền đúng từng hàm; gỡ trả hai thân hàm cũ; apply lại được')

    // ---- Dữ liệu thử ------------------------------------------------------------------------------------------------------
    let nextId = 930000
    const repeat = (every, unit, maxRuns, more = {}) => ({ repeatAfterCompletionEnabled: true, repeatAfterCompletionEvery: every,
      repeatAfterCompletionUnit: unit, repeatAfterCompletionMaxRuns: maxRuns, ...more })
    const makeCampaign = async ({ action = 'zalo_message_phone', targets = 3, org = 601, server = true, staff = 7101, schedule = "now() - interval '1 minute'",
      original = null, scheduleType = 'daily', sourceMode = 'direct', endDate = null, extra = {}, stopTime = null, platform = 'zalo' } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [org])
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Tài khoản thử', $2, 'đã đăng nhập', 'chờ xử lý', true, false, $3, $4, $5, false)`, [account, platform, staff, org, server && platform === 'zalo'])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
          provisioning_state, data_target_source_mode, schedule_end_date, extra_settings, daily_stop_time, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chiến dịch thử', $2, $3, 'chờ xử lý', ${schedule}, $4, $5, true, 'ready', $6, $7, $8::jsonb, $9, false, $10, $11)`,
        [campaign, action, account, original, scheduleType, sourceMode, endDate, JSON.stringify(extra), stopTime, staff, org])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Khách ${i + 1}`, `0912${String(id).slice(-6)}`])
        ids.push(id)
      }
      return { account, campaign, staff, ids, runtime: server ? 'fly' : 'desktop', lease: null }
    }
    const camp = c => one(`SELECT status, note, schedule, completed_at FROM public.auto_campaigns WHERE id = $1`, [c.campaign])
    const state = c => one(`SELECT * FROM private.auto_campaign_repeat_state WHERE campaign_id = $1`, [c.campaign])
    const statuses = async c => (await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])).rows.map(r => r.status)
    const core = (c, doneAt, apply = false, notBefore = null) => val(
      `SELECT ${CORE}(x, $2::timestamptz, $3, $4::timestamptz) FROM public.auto_campaigns x WHERE x.id = $1`, [c.campaign, doneAt, apply, notBefore])
    const config = c => val(`SELECT private.aka_agent_campaign_repeat_config(x) FROM public.auto_campaigns x WHERE x.id = $1`, [c.campaign])
    // Giờ Việt Nam → ISO.
    const vn = text => new Date(`${text}+07:00`).toISOString()
    const sameTime = (a, b, label) => assert.equal(new Date(a).toISOString(), new Date(b).toISOString(), label)

    // ---- 2. Phạm vi và cài đặt hợp lệ ---------------------------------------------------------------------------------------
    assert.deepEqual(await config(await makeCampaign({ extra: repeat(2, 'day', 5) })), { every: 2, unit: 'day', maxRuns: 5 })
    assert.deepEqual(await config(await makeCampaign({ extra: repeat('3', 'hour', '4') })), { every: 3, unit: 'hour', maxRuns: 4 }, 'số dạng chuỗi chữ số')
    assert.deepEqual(await config(await makeCampaign({ action: 'zalo_message_group', extra: repeat(30, 'minute', 3, { zaloMessageSendMode: 'share' }) })),
      { every: 30, unit: 'minute', maxRuns: 3 })
    assert.deepEqual(await config(await makeCampaign({ action: 'facebook_group_post', platform: 'facebook', extra: repeat(6, 'hour', 10) })), { every: 6, unit: 'hour', maxRuns: 10 })
    const off = [
      { extra: { ...repeat(2, 'day', 5), repeatAfterCompletionEnabled: false } },
      { extra: {} },
      { extra: repeat(2, 'day', 5), scheduleType: 'weekly' },
      { extra: repeat(2, 'day', 5), scheduleType: 'monthly' },
      { extra: repeat(2, 'day', 5), sourceMode: 'data_group' },
      { extra: repeat(2, 'day', 5, { multiDailyTimeSlotsEnabled: true }) },
      { extra: repeat(2, 'day', 1) }, { extra: repeat(2, 'day', 101) }, { extra: repeat(2, 'day', 2.5) },
      { extra: repeat(0, 'day', 5) }, { extra: repeat(91, 'day', 5) }, { extra: repeat(169, 'hour', 5) }, { extra: repeat(0, 'hour', 5) },
      { extra: repeat(2, 'week', 5) }, { extra: repeat(2, null, 5) }, { extra: repeat(null, 'day', 5) },
      { extra: repeat(30, 'minute', 3) },
      { action: 'zalo_message_phone', extra: repeat(30, 'minute', 3, { zaloMessageSendMode: 'share' }) },
      { action: 'zalo_message_friend', extra: repeat(4, 'minute', 3, { zaloMessageSendMode: 'share' }) },
      { action: 'zalo_message_friend', extra: repeat(1440, 'minute', 3, { zaloMessageSendMode: 'share' }) },
      ...['zalo_message_birthday', 'zalo_message_group_realtime', 'zalo_message_friend_recommendation', 'zalo_cancel_sent_friend_request',
        'facebook_newsfeed_interaction', 'facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'sms_send', 'voice_call']
        .map(action => ({ action, extra: repeat(2, 'day', 5) })),
    ]
    for (const item of off) assert.equal(await config(await makeCampaign(item)), null, JSON.stringify(item))
    const journey = await makeCampaign({ extra: repeat(2, 'day', 5) })
    await db.query(`INSERT INTO public.auto_journey_step_campaigns VALUES (1, $1)`, [journey.campaign])
    assert.equal(await config(journey), null, 'chiến dịch của Quy trình tự động')
    const deleted = await makeCampaign({ extra: repeat(2, 'day', 5) })
    await db.query(`UPDATE public.auto_campaigns SET is_delete = true WHERE id = $1`, [deleted.campaign])
    assert.equal(await config(deleted), null, 'chiến dịch đã xoá')
    pass('phạm vi: chỉ lịch Hàng ngày, data nhập trực tiếp, không nhiều khung giờ, không thuộc loại loại trừ / Quy trình; phút chỉ cho gửi dạng chia sẻ; giới hạn số')

    // ---- 3. Giờ lượt kế tiếp ------------------------------------------------------------------------------------------------
    // Giờ chạy 08:30, giờ dừng 18:00.
    const win = { original: vn('2026-11-10T08:30:00'), stopTime: '18:00:00' }
    const day2 = await makeCampaign({ ...win, extra: repeat(2, 'day', 9) })
    sameTime((await core(day2, vn('2026-11-17T15:10:00'))).next, vn('2026-11-19T08:30:00'), 'ngày: Giờ chạy của ngày (ngày xong + 2)')
    sameTime((await core(day2, vn('2026-11-17T00:20:00'))).next, vn('2026-11-19T08:30:00'), 'ngày: lượt xong sau nửa đêm vẫn tính theo ngày xong')
    const hour3 = await makeCampaign({ ...win, extra: repeat(3, 'hour', 9) })
    sameTime((await core(hour3, vn('2026-11-17T10:00:00'))).next, vn('2026-11-17T13:00:00'), 'giờ: trong khung thì giữ nguyên')
    sameTime((await core(hour3, vn('2026-11-17T15:00:00'))).next, vn('2026-11-18T08:30:00'), 'giờ: chạm giờ dừng thì sang Giờ chạy hôm sau')
    sameTime((await core(hour3, vn('2026-11-17T16:30:00'))).next, vn('2026-11-18T08:30:00'), 'giờ: quá giờ dừng thì sang Giờ chạy hôm sau')
    sameTime((await core(hour3, vn('2026-11-17T23:00:00'))).next, vn('2026-11-18T08:30:00'), 'giờ: rơi trước Giờ chạy thì dời tới Giờ chạy cùng ngày')
    const hour30 = await makeCampaign({ ...win, extra: repeat(30, 'hour', 9) })
    sameTime((await core(hour30, vn('2026-11-17T09:00:00'))).next, vn('2026-11-18T15:00:00'), 'giờ: quá 24 giờ, rơi trong khung của ngày sau')
    const noStop = await makeCampaign({ original: vn('2026-11-10T08:30:00'), extra: repeat(1, 'hour', 9) })
    sameTime((await core(noStop, vn('2026-11-17T22:30:00'))).next, vn('2026-11-17T23:30:00'), 'không đặt giờ dừng: chạy tới trước 23:59')
    sameTime((await core(noStop, vn('2026-11-17T22:59:30'))).next, vn('2026-11-18T08:30:00'), 'không đặt giờ dừng: từ 23:59 thì sang hôm sau')
    const min45 = await makeCampaign({ ...win, action: 'zalo_message_friend', extra: repeat(45, 'minute', 9, { zaloMessageSendMode: 'share' }) })
    sameTime((await core(min45, vn('2026-11-17T09:00:00'))).next, vn('2026-11-17T09:45:00'), 'phút: lúc xong + 45 phút')
    sameTime((await core(hour3, vn('2026-11-17T10:00:00'), false, vn('2026-11-17T14:20:00'))).next, vn('2026-11-17T14:20:00'), 'bộ quét xử lý trễ: không sớm hơn lúc quét')
    sameTime((await core(hour3, vn('2026-11-17T10:00:00'), false, vn('2026-11-17T19:00:00'))).next, vn('2026-11-18T08:30:00'), 'bộ quét xử lý trễ ngoài khung: Giờ chạy hôm sau')
    assert.equal(await val(`SELECT count(*)::int FROM private.auto_campaign_repeat_state`), 0, 'xem trước không ghi gì')
    pass('giờ lượt kế: ngày = Giờ chạy của ngày đích; giờ / phút = lúc xong + x rồi đưa vào khung giờ chạy; bộ quét trễ không hẹn vào quá khứ')

    // ---- 4. Đếm lượt, số lượt tối đa, ngày kết thúc --------------------------------------------------------------------------
    const cnt = await makeCampaign({ ...win, extra: repeat(1, 'day', 3) })
    let d = await core(cnt, vn('2026-11-17T09:00:00'), true)
    assert.deepEqual([d.repeat, d.run, d.maxRuns, d.reason], [true, 1, 3, 'scheduled'])
    d = await core(cnt, vn('2026-11-18T09:00:00'), true)
    assert.deepEqual([d.repeat, d.run], [true, 2])
    d = await core(cnt, vn('2026-11-19T09:00:00'), true)
    assert.deepEqual([d.repeat, d.run, d.reason, d.next], [false, 3, 'max_runs', undefined], 'lượt thứ 3 là lượt cuối')
    assert.deepEqual([(await state(cnt)).runs_done, (await state(cnt)).finishing], [3, true])
    d = await core(cnt, vn('2026-11-19T09:05:00'), true)
    assert.deepEqual([d.repeat, d.run, d.finishing], [false, 3, true], 'lượt cuối chưa hoàn thành xong (có data mới): không đếm thêm')
    await db.query(`SELECT private.aka_agent_campaign_repeat_confirm_end($1)`, [cnt.campaign])
    assert.deepEqual([(await state(cnt)).ended_reason, (await state(cnt)).finishing], ['max_runs', false])
    d = await core(cnt, vn('2026-11-25T09:00:00'), true)
    assert.deepEqual([d.repeat, d.run], [true, 1], 'đã hết lượt mà chiến dịch được chạy lại: vòng đếm mới')

    const end = await makeCampaign({ ...win, endDate: vn('2026-11-19T23:59:59'), extra: repeat(1, 'day', 50) })
    d = await core(end, vn('2026-11-17T09:00:00'), true)
    sameTime(d.next, vn('2026-11-18T08:30:00'))
    d = await core(end, vn('2026-11-18T09:00:00'), true)
    assert.deepEqual([d.repeat, d.run], [true, 2])
    d = await core(end, vn('2026-11-19T09:00:00'), true)
    assert.deepEqual([d.repeat, d.run, d.reason], [false, 3, 'end_date'], 'lượt kế rơi sau ngày kết thúc')

    const chg = await makeCampaign({ ...win, extra: repeat(1, 'day', 5) })
    await core(chg, vn('2026-11-17T09:00:00'), true)
    await core(chg, vn('2026-11-18T09:00:00'), true)
    assert.equal((await rpc('aka_agent_campaign_repeat_sync_v1', chg.staff, chg.campaign)).runsDone, 2, 'lưu lại mà không đổi cài đặt lặp: giữ bộ đếm')
    await db.query(`UPDATE public.auto_campaigns SET extra_settings = extra_settings || '{"repeatAfterCompletionMaxRuns": 8}' WHERE id = $1`, [chg.campaign])
    const synced = await rpc('aka_agent_campaign_repeat_sync_v1', chg.staff, chg.campaign)
    assert.deepEqual([synced.ok, synced.enabled, synced.runsDone, synced.maxRuns], [true, true, 0, 8], 'đổi cài đặt lặp: đếm lại từ 0')
    await db.query(`UPDATE public.auto_campaigns SET schedule_end_date = $2 WHERE id = $1`, [chg.campaign, vn('2026-12-31T23:59:59')])
    await core(chg, vn('2026-11-19T09:00:00'), true)
    assert.equal((await state(chg)).runs_done, 1, 'đổi ngày kết thúc mà chưa đồng bộ: lần chạy hết kế tiếp tự mở vòng đếm mới')
    await db.query(`SET timezone = 'Asia/Tokyo'`)
    await core(chg, vn('2026-11-20T09:00:00'), true)
    await db.query(`SET timezone = 'UTC'`)
    assert.equal((await state(chg)).runs_done, 2, 'múi giờ của phiên gọi khác nhau không làm đổi dấu vân tay cài đặt')
    await db.query(`UPDATE public.auto_campaigns SET extra_settings = extra_settings || '{"repeatAfterCompletionEnabled": false}' WHERE id = $1`, [chg.campaign])
    assert.deepEqual(await rpc('aka_agent_campaign_repeat_sync_v1', chg.staff, chg.campaign), { ok: true, enabled: false })
    assert.equal(await state(chg), undefined, 'tắt lặp: bỏ dòng đếm')
    pass('đếm lượt: đủ số lượt tối đa (tính cả lượt đầu) thì kết thúc; tới ngày kết thúc thì kết thúc; đổi cài đặt đếm lại; chạy lại sau khi hết lượt mở vòng mới')

    // ---- 5. Engine v2: hàm kết thúc lượt --------------------------------------------------------------------------------------
    const ctx = c => JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign, runnerId: `${c.runtime}:v555`,
      runtimeTarget: c.runtime, leaseToken: c.lease ?? null, actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] })
    const claim = async c => { const res = await rpc('aka_agent_engine_claim_target_v1', ctx(c)); if (res.leaseToken) c.lease = res.leaseToken; return res }
    let rk = 0
    const okDone = cl => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken,
      JSON.stringify([{ resultKey: `v555-smoke:${++rk}`, actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send', statusCode: 'campaign_detail_success' }]), true, false)
    const finish = c => rpc('aka_agent_engine_finish_campaign_v2', c.account, c.lease, null)
    const release = async c => { const r = await rpc('aka_agent_engine_release_v1', c.account, c.lease); c.lease = null; return r }
    const runAll = async c => { for (;;) { const cl = await claim(c); if (cl.status !== 'claimed') return cl; await okDone(cl) } }
    const due = c => db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '1 minute' WHERE id = $1`, [c.campaign])
    await db.query(`INSERT INTO public.auto_notification_subscriptions VALUES (7101, 'campaign.status_changed', 'own', true, NULL, NULL)`)
    const notified = c => val(`SELECT count(*)::int FROM public.auto_notifications WHERE campaign_id = $1 AND payload->>'toStatus' = 'hoàn thành'`, [c.campaign])

    const eng = await makeCampaign({ extra: repeat(1, 'day', 3) })
    await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng' WHERE id = $1`, [eng.ids[2]])
    await runAll(eng)
    let f = await finish(eng)
    assert.deepEqual([f.ok, f.reason, f.campaignStatus, f.repeat.run, f.repeat.maxRuns], [true, 'repeat_scheduled', 'chờ xử lý', 1, 3])
    assert.ok(new Date(f.schedule).getTime() > Date.now() + 3600e3, 'lượt kế ở ngày sau')
    sameTime((await camp(eng)).schedule, f.schedule)
    assert.deepEqual(await statuses(eng), ['chờ xử lý', 'chờ xử lý', 'tạm dừng'], 'đặt lại data trừ data tạm dừng')
    assert.equal((await state(eng)).runs_done, 1)
    await release(eng)
    assert.equal((await claim(eng)).status === 'claimed', false, 'chưa tới giờ lượt kế thì không nhận')
    if (eng.lease) await release(eng)
    await due(eng); await runAll(eng)
    f = await finish(eng)
    assert.deepEqual([f.reason, f.repeat.run], ['repeat_scheduled', 2])
    await release(eng)
    await due(eng); await runAll(eng)
    f = await finish(eng)
    assert.deepEqual([f.reason, f.campaignStatus, f.repeat.run, f.repeat.reason], ['completed', 'hoàn thành', 3, 'max_runs'])
    await release(eng)
    assert.deepEqual([(await camp(eng)).status, (await state(eng)).ended_reason, (await state(eng)).finishing], ['hoàn thành', 'max_runs', false])
    sameTime((await state(eng)).handled_completed_at, (await camp(eng)).completed_at, 'lần hoàn thành cuối đã được chốt, bộ quét không mở lại')
    assert.equal(await notified(eng), 1, 'engine v2: chỉ lượt cuối báo "hoàn thành"')
    assert.deepEqual(await rpc('aka_agent_campaign_repeat_tick_v1', 50), { ok: true, enabled: true, reopened: 0, ended: 0, skipped: 0, failed: 0 })

    const plain = await makeCampaign({})
    await runAll(plain)
    f = await finish(plain)
    assert.deepEqual([f.reason, f.campaignStatus, f.repeat], ['completed', 'hoàn thành', undefined], 'chiến dịch không bật lặp: như cũ')
    await release(plain)
    assert.equal(await state(plain), undefined)
    const weekly = await makeCampaign({ scheduleType: 'weekly', extra: repeat(1, 'day', 3) })
    await runAll(weekly)
    f = await finish(weekly)
    assert.deepEqual([f.reason, f.repeat], ['completed', undefined], 'lịch tuần có khoá lặp: không lặp')
    await release(weekly)
    const allPaused = await makeCampaign({ targets: 1, extra: repeat(1, 'day', 3) })
    await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng' WHERE campaign_id = $1`, [allPaused.campaign])
    await claim(allPaused)
    f = allPaused.lease ? await finish(allPaused) : null
    if (f) { assert.equal(f.reason, 'completed'); await release(allPaused) }
    assert.equal(await state(allPaused), undefined, 'không còn data để chạy lại: không đếm lượt')
    const shareOld = await makeCampaign({ action: 'zalo_message_group', extra: { zaloMessageSendMode: 'share', zaloShareRepeatEnabled: true, zaloShareRepeatAfterMinutes: 30 } })
    await runAll(shareOld)
    f = await finish(shareOld)
    assert.deepEqual([f.reason, f.repeat], ['repeat_scheduled', undefined], '"gửi lặp lại sau mỗi x phút" cũ: như V506')
    await release(shareOld)
    pass('engine v2: lượt giữa hẹn lượt kế và đặt lại data; lượt cuối hoàn thành và chốt; không bật lặp, lịch tuần, hết data chạy lại, gửi lặp kiểu cũ đều như trước')

    // ---- 6. Bộ quét dự phòng (bộ chạy chưa biết tính năng đánh "hoàn thành") --------------------------------------------------
    const complete = async c => {
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'hoàn thành' WHERE campaign_id = $1 AND status <> 'tạm dừng'`, [c.campaign])
      await db.query(`UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = $1`, [c.campaign])
    }
    const tick = () => rpc('aka_agent_campaign_repeat_tick_v1', 50)
    const before = await makeCampaign({ extra: repeat(1, 'day', 2) })
    await complete(before)
    await rpc('aka_agent_campaign_repeat_sync_v1', before.staff, before.campaign)
    assert.equal((await tick()).reopened, 0)
    assert.equal((await camp(before)).status, 'hoàn thành', 'bật lặp trên chiến dịch đã hoàn thành từ trước: không tự chạy lại')
    assert.equal(await notified(before), 1)

    const sw = await makeCampaign({ extra: repeat(1, 'day', 2) })
    await rpc('aka_agent_campaign_repeat_sync_v1', sw.staff, sw.campaign)
    await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng' WHERE id = $1`, [sw.ids[0]])
    await complete(sw)
    assert.equal(await notified(sw), 0, 'lượt giữa: không báo "hoàn thành"')
    let t = await tick()
    assert.deepEqual([t.reopened, t.ended, t.failed], [1, 0, 0])
    let cs = await camp(sw)
    assert.deepEqual([cs.status, cs.note, cs.completed_at], ['chờ xử lý', null, null])
    assert.ok(new Date(cs.schedule).getTime() > Date.now() + 3600e3)
    sameTime((await state(sw)).next_run_at, cs.schedule)
    assert.deepEqual(await statuses(sw), ['tạm dừng', 'chờ xử lý', 'chờ xử lý'])
    assert.match(await val(`SELECT log FROM public.auto_campaign_logs WHERE campaign_id = $1`, [sw.campaign]),
      /^\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{4} - ⏳ Đã chạy xong lượt 1\/2, hẹn chạy lại chiến dịch "Chiến dịch thử" lúc \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/)
    assert.equal((await tick()).reopened, 0, 'quét lại không làm gì thêm')
    await complete(sw)
    assert.equal(await notified(sw), 1, 'lượt cuối: báo "hoàn thành"')
    t = await tick()
    assert.deepEqual([t.reopened, t.ended], [0, 1])
    assert.deepEqual([(await camp(sw)).status, (await state(sw)).ended_reason, (await state(sw)).runs_done], ['hoàn thành', 'max_runs', 2])
    assert.deepEqual([(await tick()).ended, (await camp(sw)).status], [0, 'hoàn thành'], 'đã chốt: không xử lý lại')
    // Người dùng cho chạy lại sau khi hết lượt: vòng mới.
    await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', completed_at = NULL WHERE id = $1`, [sw.campaign])
    await complete(sw)
    assert.equal((await tick()).reopened, 1)
    assert.equal((await state(sw)).runs_done, 1)

    const busy = await makeCampaign({ extra: repeat(1, 'day', 3) })
    await rpc('aka_agent_campaign_repeat_sync_v1', busy.staff, busy.campaign)
    await complete(busy)
    await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token = gen_random_uuid() WHERE id = $1`, [busy.campaign])
    assert.deepEqual([(await tick()).skipped, (await camp(busy)).status, (await state(busy)).runs_done], [1, 'hoàn thành', 0], 'bộ chạy cũ còn giữ token: chờ, chưa đếm')
    await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token = NULL WHERE id = $1`, [busy.campaign])
    await db.query(`UPDATE public.auto_system_settings SET value = '{"audience":"all","sweeper":false}' WHERE key = $1`, [v555.SETTING_KEY])
    assert.deepEqual(await tick(), { ok: true, enabled: false }, 'khoá tắt khẩn')
    const offNote = await makeCampaign({ extra: repeat(1, 'day', 3) })
    await rpc('aka_agent_campaign_repeat_sync_v1', offNote.staff, offNote.campaign)
    await complete(offNote)
    assert.equal(await notified(offNote), 1, 'bộ quét tắt: báo "hoàn thành" như chiến dịch thường')
    await db.query(`UPDATE public.auto_system_settings SET value = '{"audience":"all"}' WHERE key = $1`, [v555.SETTING_KEY])
    assert.equal((await tick()).reopened, 2, 'thiếu khoá sweeper = bật')

    const noData = await makeCampaign({ targets: 2, extra: repeat(1, 'day', 3) })
    await rpc('aka_agent_campaign_repeat_sync_v1', noData.staff, noData.campaign)
    await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng' WHERE campaign_id = $1`, [noData.campaign])
    await complete(noData)
    assert.equal(await notified(noData), 1, 'không còn data chạy lại: báo "hoàn thành"')
    assert.deepEqual([(await tick()).ended, (await state(noData)).ended_reason, (await camp(noData)).status], [1, 'no_rerun_data', 'hoàn thành'])
    const timeline = await makeCampaign({ action: 'facebook_timeline_post', platform: 'facebook', targets: 0, extra: repeat(6, 'hour', 3) })
    await rpc('aka_agent_campaign_repeat_sync_v1', timeline.staff, timeline.campaign)
    await complete(timeline)
    assert.deepEqual([(await tick()).reopened, (await camp(timeline)).status], [1, 'chờ xử lý'], 'đăng trang cá nhân không có data vẫn lặp')

    const gone = await makeCampaign({ extra: repeat(1, 'day', 3) })
    await rpc('aka_agent_campaign_repeat_sync_v1', gone.staff, gone.campaign)
    await complete(gone)
    await db.query(`UPDATE public.auto_campaigns SET is_delete = true WHERE id = $1`, [gone.campaign])
    await tick()
    assert.equal(await state(gone), undefined, 'chiến dịch đã xoá: bỏ dòng đếm')

    // Lỗi khi mở lại (trigger chặn): không chặn chiến dịch khác; 5 lượt liền thì thôi.
    const bad = await makeCampaign({ extra: repeat(1, 'day', 3) })
    const good = await makeCampaign({ extra: repeat(1, 'day', 3) })
    for (const c of [bad, good]) { await rpc('aka_agent_campaign_repeat_sync_v1', c.staff, c.campaign); await complete(c) }
    await db.query(`CREATE FUNCTION public.test_block_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = ${bad.campaign} AND NEW.status = 'chờ xử lý' THEN RAISE EXCEPTION 'app_access_denied' USING ERRCODE = '42501'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_block_reopen BEFORE UPDATE OF status ON public.auto_campaigns FOR EACH ROW EXECUTE FUNCTION public.test_block_reopen()`)
    t = await tick()
    assert.deepEqual([t.reopened, t.failed], [1, 1])
    assert.deepEqual([(await camp(good)).status, (await camp(bad)).status, (await state(bad)).error_count, (await state(bad)).runs_done], ['chờ xử lý', 'hoàn thành', 1, 0],
      'lỗi của một chiến dịch được ghi lại, lượt chưa bị đếm')
    assert.deepEqual(await statuses(bad), ['hoàn thành', 'hoàn thành', 'hoàn thành'], 'giao dịch con huỷ cả phần đặt lại data')
    for (let i = 0; i < 4; i++) await tick()
    const sb = await state(bad)
    assert.deepEqual([sb.error_count, sb.ended_reason, sb.last_error], [5, 'error', 'app_access_denied'])
    assert.equal((await tick()).failed, 0, 'đã thôi: không thử nữa')
    await db.query(`DROP TRIGGER test_block_reopen ON public.auto_campaigns; DROP FUNCTION public.test_block_reopen()`)
    pass('bộ quét: mở lại lượt giữa (đặt lại data, hẹn lịch, ghi lịch sử chạy), chốt lượt cuối, bỏ qua lần hoàn thành trước khi bật lặp, chờ token, khoá tắt khẩn, lỗi cô lập')

    // ---- 7. RPC cho bộ chạy cũ và giao diện ------------------------------------------------------------------------------------
    const old = await makeCampaign({ staff: 7202, server: false, extra: repeat(2, 'hour', 2) })
    assert.deepEqual(await rpc('aka_agent_campaign_repeat_decide_v1', 7202, old.campaign), { ok: false, reason: 'not_running', campaignStatus: 'chờ xử lý' })
    await db.query(`UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = $1`, [old.campaign])
    assert.deepEqual(await rpc('aka_agent_campaign_repeat_decide_v1', 7101, old.campaign), { ok: false, reason: 'not_found' }, 'chiến dịch của nhân viên khác')
    d = await rpc('aka_agent_campaign_repeat_decide_v1', 7202, old.campaign)
    assert.deepEqual([d.ok, d.repeat, d.run, d.maxRuns, typeof d.next], [true, true, 1, 2, 'string'])
    d = await rpc('aka_agent_campaign_repeat_decide_v1', 7202, old.campaign)
    assert.deepEqual([d.repeat, d.run, d.reason], [false, 2, 'max_runs'])
    // Bộ chạy cũ hoàn thành sau lượt cuối: bộ quét chốt, không mở lại, có thông báo.
    await db.query(`INSERT INTO public.auto_notification_subscriptions VALUES (7202, 'campaign.status_changed', 'own', true, NULL, NULL)`)
    await complete(old)
    assert.equal(await notified(old), 1)
    assert.deepEqual([(await tick()).ended, (await camp(old)).status, (await state(old)).ended_reason], [1, 'hoàn thành', 'max_runs'])
    const st = await rpc('aka_agent_campaign_repeat_state_v1', 7202, [old.campaign, eng.campaign])
    assert.deepEqual(st.map(x => [x.campaignId, x.runsDone, x.maxRuns, x.unit, x.every, x.endedReason]), [[old.campaign, 2, 2, 'hour', 2, 'max_runs']], 'chỉ trả chiến dịch của nhân viên đó')
    await assert.rejects(rpc('aka_agent_campaign_repeat_state_v1', 7202, Array.from({ length: 201 }, (_, i) => i + 1)), /too_many_campaigns/)
    // Phiên Desktop: chỉ chiến dịch của chính nhân viên đăng nhập.
    await db.query(`SET ROLE aka_agent_desktop`)
    await db.query(`SELECT set_config('test.desktop_staff', '7202', false)`)
    assert.equal((await rpc('aka_agent_campaign_repeat_state_v1', 7202, [old.campaign])).length, 1)
    assert.equal((await rpc('aka_agent_campaign_repeat_sync_v1', 7202, old.campaign)).ok, true)
    for (const fn of ['aka_agent_campaign_repeat_sync_v1', 'aka_agent_campaign_repeat_decide_v1']) {
      await assert.rejects(rpc(fn, 7101, eng.campaign), /forbidden/, `${fn}: nhân viên khác`)
    }
    await assert.rejects(rpc('aka_agent_campaign_repeat_state_v1', 7101, [eng.campaign]), /forbidden/)
    await assert.rejects(rpc('aka_agent_campaign_repeat_tick_v1', 5), /permission denied/)
    await assert.rejects(db.query(`SELECT * FROM private.auto_campaign_repeat_state`), /permission denied/)
    await db.query(`SELECT set_config('test.desktop_staff', '', false)`)
    await assert.rejects(rpc('aka_agent_campaign_repeat_state_v1', 7202, [old.campaign]), /forbidden/, 'phiên Desktop không ánh xạ nhân viên')
    await db.query(`RESET ROLE`)
    pass('RPC: bộ chạy cũ đếm lượt qua decide_v1 rồi bộ quét chốt lượt cuối; state_v1 chỉ trả chiến dịch của nhân viên; phiên Desktop không chạm được chiến dịch người khác')

    // ---- 8. Thông báo của chiến dịch không lặp giữ nguyên ---------------------------------------------------------------------
    const normal = await makeCampaign({})
    await complete(normal)
    assert.equal(await notified(normal), 1)
    const keyOnly = await makeCampaign({ extra: repeat(1, 'day', 3) })
    await complete(keyOnly)
    assert.equal(await notified(keyOnly), 1, 'có khoá lặp nhưng chưa đăng ký (chưa lưu qua API / form mới): báo như thường, bộ quét không đụng')
    assert.equal((await tick()).reopened, 0)
    pass('thông báo: chiến dịch không lặp và chiến dịch chưa đăng ký lặp vẫn báo "hoàn thành" như trước')

    console.log(`\n${checks} nhóm kiểm tra đạt`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
