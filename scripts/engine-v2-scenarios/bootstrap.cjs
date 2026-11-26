// Dựng DB thử của engine v2 trên PostgreSQL 17 cục bộ (fixture V495 + các bản đã apply production theo đúng thứ tự). Dùng chung cho
// bộ kịch bản Zalo (run.cjs) và bộ kiểm engine Facebook (scripts/engine-v2-facebook/). Không chạm DB thật.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')

async function bootstrap(db, notes) {
  const build = n => require(`../build-v${n}-sql.cjs`).migration
  await buildFixture(db, [])
  await db.query(MIGRATION)
  await db.query(build(499))
  await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8'))
  for (const n of [501, 503, 504, 505, 506, 507, 508, 509, 512]) await db.query(build(n))
  for (const f of ['migration_v513_engine_desktop_flag.sql', 'migration_v514_status_system_group_guard.sql']) {
    try { await db.query(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')); notes.push(`${f}: đã apply`) } catch (error) {
      await db.query('ROLLBACK').catch(() => {})
      notes.push(`${f}: không apply được trên fixture (${String(error.message).slice(0, 140)})`)
    }
  }
  // Theo thứ tự production: V515 (sửa B, C, D của bộ thử 13/11) rồi V517 (dọn bảng, decision chỉ còn result + contrib); V527 (claim bỏ
  // qua claim token bộ cũ treo trên chiến dịch đã xoá / tạm dừng; apply production 14/11 02:07 VN, không phụ thuộc V515 / V517);
  // V532 (lỗi có ngưỡng ở bước phụ không tạm dừng ngay; câu nhận data không quét khoá chính; dựng trên V517 và V527);
  // V601 (ghi chú khi cả lô gửi dạng chia sẻ không ai nhận được kèm lý do; chỉ thay thân report_batch_v1 của V503).
  // SCENARIO_SKIP_MIGRATIONS=515,517,527,532,601 để chạy trên DB trước các bản đó (so trước / sau); bỏ V515 thì phải bỏ cả V517;
  // bỏ V517 hoặc V527 thì phải bỏ cả V532.
  const skip = new Set(String(process.env.SCENARIO_SKIP_MIGRATIONS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number))
  if (skip.has(515) && !skip.has(517)) throw new Error('SCENARIO_SKIP_MIGRATIONS: V517 dựng trên V515, bỏ V515 thì bỏ cả 517')
  if ((skip.has(517) || skip.has(527)) && !skip.has(532)) throw new Error('SCENARIO_SKIP_MIGRATIONS: V532 dựng trên V517 và V527, bỏ một trong hai thì bỏ cả 532')
  for (const n of [515, 517, 527, 532, 601]) {
    if (skip.has(n)) { notes.push(`V${n}: bỏ qua (SCENARIO_SKIP_MIGRATIONS)`); continue }
    await db.query(build(n))
    notes.push(`V${n}: đã apply`)
  }
  // Engine Facebook (V556–V558, chưa apply production): SCENARIO_FACEBOOK_MIGRATIONS=1 để chạy bộ kịch bản Zalo trên DB đã có các bản
  // này, chứng minh Zalo không đổi hành vi. Nạp lười để không vòng require với scripts/engine-v2-facebook/fixture.cjs.
  if (process.env.SCENARIO_FACEBOOK_MIGRATIONS === '1') {
    await require('../engine-v2-facebook/fixture.cjs').applyFacebookMigrations(db)
    notes.push('V556–V558, V564 (engine Facebook): đã apply')
  }
  // "Lặp lại sau khi chạy xong" (V561, dựng trên thân V558 của finish_campaign_v2): SCENARIO_CAMPAIGN_REPEAT=1 (kèm
  // SCENARIO_FACEBOOK_MIGRATIONS=1) để chạy bộ kịch bản trên DB đã có V561, chứng minh chiến dịch không bật lặp không đổi hành vi.
  if (process.env.SCENARIO_CAMPAIGN_REPEAT === '1') {
    if (process.env.SCENARIO_FACEBOOK_MIGRATIONS !== '1') throw new Error('SCENARIO_CAMPAIGN_REPEAT=1 cần SCENARIO_FACEBOOK_MIGRATIONS=1 (V561 dựng trên V558)')
    await require('../fixtures/campaign-outcome-engine/campaign-repeat-v561.cjs').applyCampaignRepeatV561(db)
    notes.push('V561 (lặp lại sau khi chạy xong): đã apply')
  }
  // V585 (hàm kết thúc lượt đọc danh sách "Chạy nhiều khung giờ" dạng mảng; kiểm thân finish_campaign_v2 của V561): SCENARIO_MULTI_SLOT_ARRAY=1
  // (kèm SCENARIO_CAMPAIGN_REPEAT=1) để chạy bộ kịch bản trên DB đã có V585, chứng minh danh sách dạng chuỗi và các nhánh khác không đổi.
  if (process.env.SCENARIO_MULTI_SLOT_ARRAY === '1') {
    if (process.env.SCENARIO_CAMPAIGN_REPEAT !== '1') throw new Error('SCENARIO_MULTI_SLOT_ARRAY=1 cần SCENARIO_CAMPAIGN_REPEAT=1 (V585 dựng trên thân V561)')
    await db.query(require('../build-v585-sql.cjs').migration)
    notes.push('V585 (khung giờ dạng mảng): đã apply')
  }
  // Kiểm người nhận trên toàn hệ thống (V571, dựng trên thân claim V564 và report V558): SCENARIO_TARGET_CHECK=1 (kèm SCENARIO_FACEBOOK_MIGRATIONS=1) để
  // chạy bộ kịch bản trên DB đã có V571 (thiết lập engine.target_check mặc định off), chứng minh Zalo không đổi hành vi khi chưa bật.
  if (process.env.SCENARIO_TARGET_CHECK === '1') {
    if (process.env.SCENARIO_FACEBOOK_MIGRATIONS !== '1') throw new Error('SCENARIO_TARGET_CHECK=1 cần SCENARIO_FACEBOOK_MIGRATIONS=1 (V571 dựng trên V564)')
    const phone = JSON.parse(fs.readFileSync(path.join(ROOT, 'migrations/snapshots/cooldown-history-v431/phone-dependency.json'), 'utf8'))
      .find(f => f.signature === 'normalize_phone(text)')
    if (!(await db.query(`SELECT to_regprocedure('public.normalize_phone(text)') AS f`)).rows[0].f) await db.query(phone.definition)
    // zalo_users tối thiểu (claim V571 lấy global id + cờ bạn bè theo tài khoản + UID; production có bảng đủ cột).
    if (!(await db.query(`SELECT to_regclass('public.zalo_users') AS t`)).rows[0].t) {
      await db.query(`CREATE TABLE public.zalo_users (id bigserial PRIMARY KEY, account_id bigint NOT NULL, zalo_uid text NOT NULL, global_id text,
        is_fr integer, phone_number text); CREATE UNIQUE INDEX idx_zalo_users_account_uid ON public.zalo_users (account_id, zalo_uid)`)
    }
    const v571 = require('../build-v571-sql.cjs')
    await db.query(v571.migrationP1)
    await db.query(v571.migrationP2)
    notes.push('V571 (kiểm người nhận trên toàn hệ thống, mode off): đã apply')
  }
  // V575 (mã cụ thể, lỗi tệp CFG20 / CFG01, NET01 khi mở trang Facebook, câu chờ tới 00:00 chỉ ghi ngày; apply production 18/11 17:08 VN):
  // SCENARIO_V575=1 (kèm SCENARIO_FACEBOOK_MIGRATIONS=1) để chạy bộ kịch bản trên DB như production sau V575. Kiểm trước trong file đòi V559 và
  // dấu hiệu của V563 đúng như production nên nạp hai phần đó trước.
  if (process.env.SCENARIO_V575 === '1') {
    if (process.env.SCENARIO_FACEBOOK_MIGRATIONS !== '1') throw new Error('SCENARIO_V575=1 cần SCENARIO_FACEBOOK_MIGRATIONS=1 (V575 dựng trên V558, V559, V563)')
    const fb = require('../engine-v2-facebook/fixture.cjs')
    await fb.applyFacebookMigrations(db, fb.FACEBOOK_POLICY_MIGRATIONS)
    await fb.applyV563SignsOnly(db)
    await fb.applyV575(db)
    notes.push('V559, dấu hiệu V563, V575 (mã cụ thể, câu chờ chỉ ghi ngày): đã apply')
  }
  // Nhóm data: hàm kết thúc thật của production + bảng nguồn tối thiểu (như replay.cjs).
  await db.query(`CREATE TABLE public.auto_campaign_data_group_sources (id bigserial PRIMARY KEY, campaign_id bigint NOT NULL, staff_id bigint,
    organization_id bigint, status text NOT NULL, stopped_at timestamptz, stop_reason text, updated_at timestamptz DEFAULT now())`)
  await db.query(`CREATE FUNCTION public.aka_agent_internal_require_staff_tenant(p_staff_id bigint, p_organization_id bigint) RETURNS void
    LANGUAGE plpgsql AS $$ BEGIN END $$`)
  await db.query(`CREATE FUNCTION public.aka_agent_lock_campaign_input_serialization(p_campaign_id bigint) RETURNS void LANGUAGE sql
    AS $$ SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || p_campaign_id::text, 0)) $$`)
  await db.query(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/campaign-outcome-engine/data-group-finalizer-v219.sql'), 'utf8'))
  // Chỉ ở DB thử: "thời gian trôi 70 phút" giữa hai vòng: khoá thao tác hết hạn trong 70 phút tới coi như đã mở (khoá theo ngày giữ nguyên).
  await db.query(`CREATE FUNCTION public.aka_agent_scenario_time_passes(p_accounts bigint[]) RETURNS integer LANGUAGE sql AS $f$
    WITH u AS (UPDATE public.auto_account_action_status SET date_enable = now() - interval '1 second'
      WHERE account_id = ANY(p_accounts) AND is_disable AND date_enable IS NOT NULL AND date_enable <= now() + interval '70 minutes' RETURNING 1)
    SELECT count(*)::integer FROM u $f$`)
  // Chống gửi lặp N ngày: hàm của production không có trong fixture; bản thay theo đúng hợp đồng (V367: chỉ tính lần gửi thành công,
  // cùng tài khoản hoặc mọi tài khoản của nhân viên, tạm dừng data kèm câu "đã gửi tin trước đó ngày …").
  await db.query(`CREATE FUNCTION public.aka_agent_apply_campaign_delivery_cooldown(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[])
    RETURNS TABLE(input_data_id bigint, decision text, note text, last_sent_at timestamptz, eligible_date date, source_campaign_id bigint, source_campaign_name text)
    LANGUAGE plpgsql AS $f$
    DECLARE d record; c record; v_days integer; v_all boolean; v_last record; v_note text;
    BEGIN
      SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id;
      v_days := greatest(1, coalesce(nullif(c.extra_settings->>'recentDeliveryCooldownDays', '')::integer, 3));
      v_all := coalesce((c.extra_settings->>'recentDeliveryCooldownAllAccounts')::boolean, false);
      FOR d IN SELECT x.* FROM public.auto_campaign_input_data x WHERE x.id = ANY(p_input_data_ids) ORDER BY x.id FOR UPDATE LOOP
        IF d.status <> 'chờ xử lý' THEN
          RETURN QUERY SELECT d.id, 'not_pending'::text, 'Data không còn ở trạng thái chờ xử lý.'::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text;
          CONTINUE;
        END IF;
        SELECT det.created_at, det.campaign_id, cc.name INTO v_last
          FROM public.auto_campaign_details det JOIN public.auto_campaign_input_data i ON i.id = det.input_data_id
          JOIN public.auto_campaigns cc ON cc.id = det.campaign_id
         WHERE det.status = 'thành công' AND det.action_code IN ('zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend')
           AND i.id <> d.id AND coalesce(nullif(i.phone, ''), i.uid) = coalesce(nullif(d.phone, ''), d.uid)
           AND det.created_at > now() - make_interval(days => v_days)
           AND CASE WHEN v_all THEN cc.staff_id = c.staff_id ELSE det.account_id = p_account_id END
         ORDER BY det.created_at DESC LIMIT 1;
        IF FOUND THEN
          v_note := 'Tạm dừng: đã gửi tin trước đó ngày ' || to_char(v_last.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '. Gửi lại từ '
            || to_char((v_last.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + v_days, 'DD/MM/YYYY') || '.';
          UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = v_note WHERE id = d.id;
          RETURN QUERY SELECT d.id, 'paused_recent_delivery'::text, v_note, v_last.created_at, ((v_last.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + v_days),
            v_last.campaign_id, v_last.name;
        ELSE
          RETURN QUERY SELECT d.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text;
        END IF;
      END LOOP;
    END $f$`)
  // V576 (đóng lượt bị bỏ dở cho đúng: lượt mồ côi, chốt theo kết quả đã báo, hàm reset Desktop; kiểm thân close_stale V515 / report_v1 V571):
  // SCENARIO_ORPHAN_RUNS=1 (kèm SCENARIO_TARGET_CHECK=1) để chạy bộ kịch bản trên DB đã có V576. Đặt cuối: dùng hàm khoá nạp data ở trên.
  if (process.env.SCENARIO_ORPHAN_RUNS === '1') {
    if (process.env.SCENARIO_TARGET_CHECK !== '1') throw new Error('SCENARIO_ORPHAN_RUNS=1 cần SCENARIO_TARGET_CHECK=1 (V576 kiểm thân report_v1 của V571)')
    await require('../fixtures/engine-v2-orphan-runs-v576/setup.cjs').applyV576(db, notes)
  }
  // V581 (tách Z114: TAG01, DAT02, DAT03, DAT04; chỉ dữ liệu, dựng trên chính sách V500): SCENARIO_V581=1 để chạy bộ kịch bản trên DB
  // đã có 4 mã mới (lõi mới phát tín hiệu engine uid_is_phone / target_is_self / uid_other_account).
  if (process.env.SCENARIO_V581 === '1') {
    await db.query(require('../build-v581-sql.cjs').migration)
    notes.push('V581 (tách Z114 thành 4 mã): đã apply')
  }
  // "Chạy cùng lúc" (V670): SCENARIO_PARALLEL_RUN=live cài 6 hàm V670 vá ở bản V670 dựng trên (claim sau V667: V666 loại trừ gửi + V667 nơi
  // chạy 'server'; release, close_stale, health, create_control_campaign_v2, update_control_campaign_atomic production 26/11); =1 cài rồi
  // apply V670 p1–p3. Chạy bộ kịch bản hai lần (live, 1) để chứng minh chiến dịch không tích chạy y như trước V670. Cần SCENARIO_ORPHAN_RUNS=1
  // (các hàm production 26/11 dựng trên V576). Đặt cuối.
  const parallelRun = process.env.SCENARIO_PARALLEL_RUN
  if (parallelRun === 'live' || parallelRun === '1') {
    if (process.env.SCENARIO_ORPHAN_RUNS !== '1') throw new Error('SCENARIO_PARALLEL_RUN cần SCENARIO_ORPHAN_RUNS=1 (hàm production 26/11 dựng trên V576)')
    const setup = require('../fixtures/campaign-parallel-run/setup.cjs')
    await setup.installLive(db, notes)
    if (parallelRun === '1') await setup.applyV670(db, notes)
  }
}

module.exports = { bootstrap }
