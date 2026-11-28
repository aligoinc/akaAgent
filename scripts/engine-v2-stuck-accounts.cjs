#!/usr/bin/env node
// Quét CHỈ ĐỌC tài khoản kẹt "đang chạy" (sự cố 27/11/2026, V681). Dùng trong lần kiểm sức khoẻ engine v2: đếm lượt đã chạy không thấy tài
// khoản ngừng nhận lượt. Một câu SELECT qua `supabase db query --linked` trên akachat (cgjbsmqtfhqvttudyjzq); không ghi gì.
//   (A) Tài khoản "đang chạy" mà không gì giữ, lần ghi cuối quá --grace-minutes phút (mặc định 3). Luật "giữ" viết lại đúng như
//       private.aka_agent_engine_account_holder_v1 của V681 (token thao tác, lease engine, lượt engine mở, dấu giữ lượt bộ cũ chưa quá hạn
//       theo V527, chiến dịch "đang chạy" còn sống) để chạy được cả trước khi apply V681; bài kiểm V681 so hai bên. Có dòng là còn một
//       đường làm lệch trạng thái cần tìm (sau V681 không còn bước tự gỡ định kỳ, anh chốt 27/11).
//   (B) Tài khoản giữ token thao tác (auto_accounts.runtime_operation_claim_token) quá --op-minutes phút (mặc định 30), xếp theo chủ token.
//       Token có hai chủ: lượt chiến dịch bộ cũ (aka_agent_claim_campaign_runtime_v2 gắn đúng auto_campaigns.runtime_claim_token của lượt)
//       và thao tác tài khoản (quét QR, quét data, Kiểm tra SĐT…). Không chủ nào ghi lại dòng tài khoản trong lúc chạy, nên số phút là tuổi
//       của lượt giữ, không phải độ im lặng. Còn sống hay không xét bằng log chiến dịch, presence của app (tài khoản Desktop) và số SĐT đã
//       tra hôm nay:
//       - đang chạy: lượt bộ cũ có log trong --run-idle-minutes phút (mặc định 60, lướt newsfeed cộng thêm thời gian lướt), tài khoản
//         Desktop thì app còn online; Kiểm tra SĐT chưa đủ hạn mức ngày (lượt giữ tài khoản cả lúc nghỉ 60 phút khi Zalo báo giới hạn
//         giờ; lượt chết theo API Web cũng hiện ở đây, phân biệt bằng số đã tra có tăng giữa hai lần quét);
//       - app không online: tài khoản Desktop, app không gửi presence trong 5 phút (tắt, chết hoặc máy ngủ) và chưa mở lại sau lúc giữ:
//         tự gỡ ở lần đăng nhập kế;
//       - cần xem: còn lại (app đang mở mà lượt không chạy, app mở lại mà token còn, tài khoản Server không ai chạy, Kiểm tra SĐT đủ hạn
//         mức mà chưa nhả). Mỗi dòng có lý do và cách gỡ.
//   (C) Tài khoản đã xoá còn token: không bước dọn nào gỡ (đều lọc is_delete = false); chỉ làm private.app_access_held luôn đúng cho nhân
//       viên đó. Chỉ đếm.
//   (D) Chiến dịch tới giờ còn data mà đứng yên (thêm 28/11/2026 sau ca 53573: claim quá giờ ở bước chống gửi lặp, lõi thử lại mãi trong
//       lượt, không ghi chú; 34061 ngày 14/11 cùng kiểu ở câu chọn data). Chiến dịch Zalo / Facebook "chờ xử lý" / "đang chạy", lịch đã tới,
//       chưa qua giờ dừng / ngày kết thúc, còn data tới hạn, có hoạt động (kết quả hoặc dòng tiến trình) trong --recent-days ngày (mặc định 3;
//       lịch tuần ít nhất 8, lịch tháng ít nhất 35) mà đã quá --idle-minutes phút (mặc định 30) cộng thời gian nghỉ giữa hai data (nhóm tài
//       khoản trước, rồi chiến dịch, như bộ lập lịch) kể từ hoạt động cuối, hoặc từ lúc tới lịch / lần ghi cuối của dòng chiến dịch (bấm
//       Tiếp tục, sửa cấu hình, bảo trì đầu ngày) nếu muộn hơn. Lượt chỉ ra kết quả không ghi dòng lịch sử (FB45, data tạm dừng vì chống gửi
//       lặp) vẫn in tiến trình; chiến dịch chưa chạy lần nào tính hoạt động từ lúc tạo; chiến dịch lâu không chạy mà bảo trì đầu ngày vẫn
//       dời lịch sang hôm nay thì bị bỏ vì quá cửa sổ hoạt động (nên chiến dịch nghỉ lâu hơn cửa sổ rồi mới cho chạy lại mà kẹt ngay thì
//       không thấy). Bỏ chiến dịch có ghi chú chờ (hạn mức, khoá thao tác, hẹn chạy tiếp…), tài khoản đăng xuất / tạm dừng / giữ token thao
//       tác (đã ở nhóm B), nhân viên bị khoá, tổ chức hết gói Zalo Server. Xếp theo máy chạy (presence Desktop gửi trong 2 phút: bộ lập
//       lịch, bộ giữ máy ngủ, tài khoản đang chạy chiến dịch nào; lease engine; nơi chạy Fly / VPS còn chạy lượt không; tài khoản vừa ra
//       kết quả ở chiến dịch khác). Máy Windows ngủ rồi thức vài phút vẫn gửi presence, nên app Desktop chỉ tính là đang mở khi presence
//       mới trong 2 phút (nhóm B vẫn 5 phút):
//       - cần xem: máy hoặc lease báo đang chạy chính chiến dịch mà không ra kết quả (kiểu 53573), không gì giữ, kẹt cổng bảo trì đầu ngày,
//         bộ lập lịch dừng khi app đang mở, nơi chạy Fly / VPS không chạy lượt nào 10 phút;
//       - không cần làm gì: máy đang ngủ (bộ giữ máy ngủ đang giữ), tài khoản chưa sẵn sàng trên máy (ví dụ tab Facebook đóng);
//       - chỉ đếm: tài khoản đang bận chiến dịch khác, app Desktop không online.
//   Mã thoát 2 khi (A), nhóm "cần xem" của (B) hoặc nhóm "cần xem" của (D) có dòng.
//
//   node scripts/engine-v2-stuck-accounts.cjs [--grace-minutes N] [--op-minutes N] [--run-idle-minutes N] [--idle-minutes N]
//                                             [--recent-days N] [--all] [--json] [--print-sql] [--workdir DIR]
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '..')
const HOLDER_SIG = 'private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)'
const SETTING_LEGACY = 'engine.legacy_stale_claim_minutes'
const SETTING_IDLE = 'engine.account_hold_campaign_idle_hours'
const SETTING_PHONE_LIMIT = 'zalo.phone_check.daily_limit'
const NEWSFEED_ACTION = 'facebook_newsfeed_interaction'
const ONLINE_MINUTES = 5 // presence Desktop gửi 30 giây một lần
const HOLDER_LABEL = {
  operation: 'token thao tác tài khoản', lease: 'lease engine', open_run: 'lượt engine còn mở',
  legacy_claim: 'dấu giữ lượt bộ cũ còn hiệu lực', campaign_running: 'chiến dịch "đang chạy" còn sống', none: 'không gì giữ'
}
/** Lý do của nhóm (B) → nhóm hiển thị. Khớp CASE trong câu SQL. */
const HELD_STATE = {
  running: 'running', phone_check: 'running', app_closed: 'app_closed',
  server_run_idle: 'look', reopened_still_held: 'look', app_online_run_idle: 'look', app_online_operation: 'look',
  phone_check_limit_reached: 'look', server_operation: 'look'
}
/** Loại của nhóm (D) → nhóm hiển thị. Khớp CASE trong câu SQL. */
const STALL_STATE = {
  own_run_no_result: 'look', nothing_holds: 'look', maintenance_blocked: 'look', scheduler_stopped: 'look', runner_down: 'look',
  sleep_hold: 'info', account_not_ready: 'info', busy: 'count', app_offline: 'count'
}
const STALL_LABEL = {
  own_run_no_result: 'đang chạy mà không ra kết quả', nothing_holds: 'không gì giữ', maintenance_blocked: 'kẹt cổng bảo trì đầu ngày',
  scheduler_stopped: 'bộ lập lịch dừng', runner_down: 'nơi chạy không chạy lượt nào', sleep_hold: 'máy đang ngủ',
  account_not_ready: 'tài khoản chưa sẵn sàng trên máy', busy: 'tài khoản bận chiến dịch khác', app_offline: 'app Desktop không online'
}

function parseArgs(argv) {
  const opt = { graceMinutes: 3, opMinutes: 30, runIdleMinutes: 60, idleMinutes: 30, recentDays: 3, all: false, json: false, printSql: false,
    workdir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} cần giá trị`); return argv[++i] }
    const minutes = v => { if (!/^\d{1,5}$/.test(v)) throw new Error(`${a} nhận số phút nguyên`); return Number(v) }
    if (a === '--grace-minutes') opt.graceMinutes = minutes(next())
    else if (a === '--op-minutes') opt.opMinutes = minutes(next())
    else if (a === '--run-idle-minutes') opt.runIdleMinutes = minutes(next())
    else if (a === '--idle-minutes') opt.idleMinutes = minutes(next())
    else if (a === '--recent-days') {
      const v = next()
      if (!/^\d{1,3}$/.test(v) || Number(v) < 1) throw new Error(`${a} nhận số ngày nguyên từ 1`)
      opt.recentDays = Number(v)
    }
    else if (a === '--all') opt.all = true
    else if (a === '--json') opt.json = true
    else if (a === '--print-sql') opt.printSql = true
    else if (a === '--workdir') opt.workdir = path.resolve(next())
    else if (a === '-h' || a === '--help') {
      const lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(1)
      console.log(lines.slice(0, lines.findIndex(l => !l.startsWith('//'))).join('\n'))
      process.exit(0)
    } else throw new Error(`Không hiểu tham số ${a}`)
  }
  return opt
}

/** Một câu SELECT, cột report (jsonb). Luật giữ tài khoản = private.aka_agent_engine_account_holder_v1 của V681. */
function buildSql({ graceMinutes = 3, opMinutes = 30, runIdleMinutes = 60, idleMinutes = 30, recentDays = 3 } = {}) {
  if (![graceMinutes, opMinutes, runIdleMinutes, idleMinutes, recentDays].every(Number.isInteger)) throw new Error('số phút / ngày phải là số nguyên')
  return `WITH k AS (
  SELECT s.now,
         s.now - make_interval(mins => CASE WHEN s.legacy_raw ~ '^[0-9]{1,6}$' THEN greatest(10, s.legacy_raw::integer) ELSE 30 END) AS legacy_before,
         s.now - make_interval(hours => CASE WHEN s.idle_raw ~ '^[0-9]{1,3}$' THEN greatest(1, s.idle_raw::integer) ELSE 6 END) AS alive_after,
         s.now - make_interval(mins => ${opMinutes}) AS op_before,
         s.now - make_interval(mins => ${ONLINE_MINUTES}) AS online_after,
         s.now - interval '2 minutes' AS d_online_after, -- (D): máy Windows ngủ rồi thức vài phút (28/11, 63678) vẫn có presence < 5 phút
         timezone('Asia/Ho_Chi_Minh', s.now)::date AS vn_today,
         timezone('Asia/Ho_Chi_Minh', s.now)::time AS vn_time,
         CASE WHEN s.phone_raw ~ '^[1-9][0-9]{0,9}$' AND s.phone_raw::numeric <= 2147483647 THEN s.phone_raw::integer ELSE 600 END AS phone_limit
    FROM (SELECT clock_timestamp() AS now,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings WHERE key = '${SETTING_LEGACY}' AND is_active LIMIT 1), '30')) AS legacy_raw,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings WHERE key = '${SETTING_IDLE}' AND is_active LIMIT 1), '6')) AS idle_raw,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings
                                  WHERE key = '${SETTING_PHONE_LIMIT}' AND is_active AND coalesce(is_secret, false) = false LIMIT 1), '600')) AS phone_raw) s
), running AS MATERIALIZED (
  SELECT a.id, a.organization_id, a.staff_id, a.flatform_type, coalesce(a.is_zalo_server, false) AS is_server,
         coalesce(a.is_zalo_show_web, false) AS is_web, a.updated_at, a.runtime_operation_claim_token IS NOT NULL AS has_op,
         a.runtime_operation_claim_token AS op_token, a.zalo_phone_check_usage AS phone_usage
    FROM public.auto_accounts a
   WHERE a.status = 'đang chạy' AND coalesce(a.is_delete, false) = false
), judged AS (
  SELECT r.*, CASE
      WHEN r.has_op THEN 'operation'
      WHEN EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.id) THEN 'lease'
      WHEN EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = r.id AND tr.completed_at IS NULL) THEN 'open_run'
      WHEN EXISTS (SELECT 1 FROM public.auto_campaigns x, k
                    WHERE x.account_id = r.id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                      AND NOT (x.runtime_unit_token IS NULL
                               AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                               AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < k.legacy_before
                               AND coalesce(x.updated_at, '-infinity'::timestamptz) < k.legacy_before
                               AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                                WHERE d.campaign_id = x.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false))) THEN 'legacy_claim'
      WHEN EXISTS (SELECT 1 FROM public.auto_campaigns x, k
                    WHERE x.account_id = r.id AND x.status = 'đang chạy' AND coalesce(x.is_delete, false) = false
                      AND (greatest(coalesce(x.updated_at, '-infinity'::timestamptz), coalesce(x.last_run_at, '-infinity'::timestamptz)) >= k.alive_after
                           OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                       WHERE d.campaign_id = x.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false))) THEN 'campaign_running'
    END AS holder
    FROM running r
), op_held AS MATERIALIZED (
  SELECT j.* FROM judged j, k WHERE j.holder = 'operation' AND j.updated_at < k.op_before
), claims AS MATERIALIZED (
  -- Lượt bộ cũ gắn token của tài khoản bằng đúng claim token của chiến dịch. Tra theo token: chiến dịch có thể đã đổi tài khoản giữa lượt.
  SELECT x.id, x.runtime_claim_token, x.action_id, x.status, coalesce(x.is_delete, false) AS is_delete, x.runtime_claim_target,
         CASE WHEN x.action_id = '${NEWSFEED_ACTION}'
              THEN coalesce(CASE WHEN (x.extra_settings->>'newsfeedTimeMinutes') ~ '^[0-9]{1,4}$' THEN (x.extra_settings->>'newsfeedTimeMinutes')::integer END, 20)
              ELSE 0 END AS browse_minutes
    FROM public.auto_campaigns x
   WHERE x.runtime_claim_token IS NOT NULL AND x.runtime_claim_token IN (SELECT o.op_token FROM op_held o)
), held AS MATERIALIZED (
  SELECT o.id, o.organization_id, o.staff_id, o.flatform_type, o.is_server, o.is_web, o.updated_at,
         CASE WHEN o.phone_usage->>'date' = k.vn_today::text AND (o.phone_usage->>'count') ~ '^[0-9]{1,9}$'
              THEN (o.phone_usage->>'count')::integer END AS phone_today,
         c.id AS campaign_id, c.action_id AS campaign_action, c.status AS campaign_status, c.is_delete AS campaign_deleted,
         c.runtime_claim_target AS claim_target, coalesce(c.browse_minutes, 0) AS browse_minutes, lg.at AS last_log_at,
         EXISTS (SELECT 1 FROM public.auto_staff_device_presence p
                  WHERE p.staff_id = o.staff_id AND p.ended_at IS NULL AND p.last_seen_at > k.online_after) AS online,
         EXISTS (SELECT 1 FROM public.auto_staff_device_presence p WHERE p.staff_id = o.staff_id AND p.started_at > o.updated_at) AS reopened,
         lp.last_seen_at, lp.ended_at AS last_ended_at, lp.app_version, lp.scheduler_state
    FROM op_held o CROSS JOIN k
    LEFT JOIN LATERAL (SELECT cl.* FROM claims cl WHERE cl.runtime_claim_token = o.op_token ORDER BY cl.id LIMIT 1) c ON true
    LEFT JOIN LATERAL (SELECT l.created_at AS at FROM public.auto_campaign_logs l WHERE l.campaign_id = c.id ORDER BY l.id DESC LIMIT 1) lg ON true
    LEFT JOIN LATERAL (SELECT p.last_seen_at, p.ended_at, p.app_version, p.runtime_state->'scheduler'->>'state' AS scheduler_state
                         FROM public.auto_staff_device_presence p WHERE p.staff_id = o.staff_id ORDER BY p.started_at DESC LIMIT 1) lp ON true
), held_fresh AS (
  SELECT h.*, coalesce(h.last_log_at > k.now - make_interval(mins => greatest(${runIdleMinutes}, h.browse_minutes + 15)), false) AS log_fresh
    FROM held h CROSS JOIN k
), held_judged AS (
  SELECT h.*, CASE WHEN h.campaign_id IS NOT NULL THEN 'campaign' ELSE 'operation' END AS owner,
         CASE
           WHEN h.campaign_id IS NOT NULL THEN CASE
             WHEN h.is_server THEN CASE WHEN h.log_fresh THEN 'running' ELSE 'server_run_idle' END
             WHEN h.reopened THEN 'reopened_still_held'
             WHEN NOT h.online THEN 'app_closed'
             WHEN h.log_fresh THEN 'running'
             ELSE 'app_online_run_idle' END
           WHEN NOT h.is_server AND h.reopened THEN 'reopened_still_held'
           WHEN NOT h.is_server AND NOT h.online THEN 'app_closed'
           WHEN h.phone_today IS NOT NULL AND h.phone_today < k.phone_limit THEN 'phone_check'
           WHEN h.phone_today IS NOT NULL THEN 'phone_check_limit_reached'
           WHEN h.is_server THEN 'server_operation'
           ELSE 'app_online_operation'
         END AS reason
    FROM held_fresh h CROSS JOIN k
), due AS MATERIALIZED (
  SELECT c.account_id, count(*) AS n
    FROM public.auto_campaigns c, k
   WHERE c.staff_id IN (SELECT h.staff_id FROM held h) AND c.account_id IN (SELECT h.id FROM held h)
     AND c.status = 'chờ xử lý' AND coalesce(c.is_delete, false) = false AND c.schedule <= k.now
   GROUP BY c.account_id
), cd_acct_active AS MATERIALIZED (
  -- Kết quả mới nhất trên từng tài khoản trong 6 giờ: bộ lập lịch chạy lần lượt các chiến dịch của một tài khoản, nên chiến dịch chờ tới
  -- lượt sau chiến dịch khác của tài khoản là đang bận, không phải đứng yên (che lúc chuyển giữa hai chiến dịch, khi chưa ai giữ lease).
  -- Chiến dịch tích "chạy cùng lúc" chạy ở làn riêng trên Desktop / Fly nên không làm chiến dịch làn chính phải chờ, App Server chạy lần
  -- lượt cả chiến dịch tích.
  SELECT c.account_id, max(c.last_run_at) AS last_any,
         max(c.last_run_at) FILTER (WHERE NOT coalesce(c.parallel_run_enabled, false)) AS last_main
    FROM public.auto_campaigns c, k
   WHERE c.last_run_at > k.now - interval '6 hours' AND coalesce(c.is_delete, false) = false
   GROUP BY c.account_id
), cd_cand AS MATERIALIZED (
  -- (D) Chiến dịch tới giờ còn data mà đứng yên. Lọc rẻ trước (lịch, trạng thái, tài khoản, kết quả cuối), thời gian nghỉ giữa hai data
  -- lấy như bộ lập lịch (nhóm tài khoản trước, kể cả khi nhóm đặt 0 giây, rồi chiến dịch).
  SELECT c.id, c.account_id, c.staff_id, c.organization_id, c.action_id, c.status, c.schedule, c.schedule_type, c.last_run_at,
         c.updated_at, c.created_at, left(coalesce(c.note, ''), 160) AS note, coalesce(c.parallel_run_enabled, false) AS parallel,
         a.flatform_type, coalesce(a.is_zalo_server, false) AS is_server, coalesce(a.is_zalo_show_web, false) AS is_web,
         CASE WHEN NOT coalesce(a.is_zalo_server, false) THEN 'desktop' WHEN o.use_new_zalo_runtime THEN 'fly' ELSE 'server' END AS runtime,
         coalesce(CASE WHEN (g.settings->>'sleepBetweenActions') ~ '^[0-9]{1,7}([.][0-9]+)?$' THEN (g.settings->>'sleepBetweenActions')::numeric END,
                  CASE WHEN (c.extra_settings->'actionLimits'->>'sleepBetweenActions') ~ '^[0-9]{1,7}([.][0-9]+)?$'
                       THEN (c.extra_settings->'actionLimits'->>'sleepBetweenActions')::numeric END, 0) AS pace_seconds
    FROM public.auto_campaigns c
    JOIN public.auto_accounts a ON a.id = c.account_id
    JOIN public.org_staff s ON s.id = c.staff_id
    JOIN public.org_organization o ON o.id = c.organization_id
    LEFT JOIN public.auto_account_groups g ON g.id = a.account_group_id -- như bộ lập lịch: đọc cả nhóm đã xoá mềm (accountRepository nhúng không lọc)
    CROSS JOIN k
   WHERE coalesce(c.is_delete, false) = false AND c.status IN ('chờ xử lý', 'đang chạy')
     AND c.schedule <= k.now - make_interval(mins => ${idleMinutes})
     AND (c.daily_stop_time IS NULL OR k.vn_time < c.daily_stop_time)
     AND (c.schedule_end_date IS NULL OR c.schedule_end_date >= k.now)
     AND (c.last_run_at IS NULL OR c.last_run_at < k.now - make_interval(mins => ${idleMinutes}))
     AND coalesce(a.is_delete, false) = false AND a.flatform_type IN ('zalo', 'facebook') AND a.login_status = 'đã đăng nhập'
     AND a.status IS DISTINCT FROM 'tạm dừng' AND a.runtime_operation_claim_token IS NULL AND s.is_active
     AND coalesce(c.note, '') !~ '^(⏳|Đạt giới hạn)'
     AND coalesce(c.note, '') !~* '(giới hạn|chạy tiếp|tạm nghỉ|hạn chế|đang dừng|chưa đăng nhập)'
     AND (NOT coalesce(a.is_zalo_server, false) OR EXISTS (
           SELECT 1 FROM public.org_organization_product p
            WHERE p.organization_id = c.organization_id AND coalesce(p.is_deleted, false) = false AND coalesce(p.is_zalo_server, false)
              AND timezone('Asia/Ho_Chi_Minh', p.expiration_date)::date >= k.vn_today))
), cd_active AS MATERIALIZED (
  -- Hoạt động cuối = kết quả cuối (last_run_at) hoặc dòng tiến trình cuối: lượt chỉ ra kết quả không ghi dòng lịch sử (FB45 "không tìm thấy
  -- bài phù hợp", data bị tạm dừng vì chống gửi lặp / loại trừ gửi) không đổi last_run_at nhưng vẫn in tiến trình. Đứng yên tính từ lúc
  -- tới lịch hoặc lần ghi cuối của dòng chiến dịch nếu muộn hơn: chiến dịch chờ lịch tuần / giờ chạy / hạn mức hôm trước, hay vừa được
  -- bấm Tiếp tục (RPC đổi trạng thái đặt updated_at, 63710 ngày 28/11 tạm dừng vì Z223 từ 18:26, khách cho chạy lại 10:38) không phải
  -- đứng yên. Không có trigger nào tự đặt updated_at, bảo trì đầu ngày đặt khi dời lịch, claim quá giờ thì huỷ cả lượt nên không đặt.
  SELECT x.*, lg.at AS last_log_at, greatest(x.last_run_at, lg.at) AS last_activity,
         greatest(x.last_run_at, lg.at, x.schedule, x.updated_at, x.created_at) AS idle_since
    FROM cd_cand x
    LEFT JOIN LATERAL (SELECT l.created_at AS at FROM public.auto_campaign_logs l WHERE l.campaign_id = x.id ORDER BY l.id DESC LIMIT 1) lg ON true
), cd_due AS MATERIALIZED (
  SELECT x.*,
         (SELECT count(*) FROM (SELECT 1 FROM public.auto_campaign_input_data d
                                 WHERE d.campaign_id = x.id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
                                   AND (d.schedule IS NULL OR d.schedule <= k.now) LIMIT 1000) q) AS due_data
    FROM cd_active x CROSS JOIN k
   -- Cửa sổ hoạt động tính theo hoạt động thật, không theo updated_at (bảo trì đầu ngày đặt updated_at cả chiến dịch chết từ lâu), chiến
   -- dịch chưa chạy lần nào tính từ lúc tạo.
   WHERE coalesce(x.last_activity, x.created_at) > k.now - make_interval(days => CASE x.schedule_type WHEN 'monthly' THEN greatest(${recentDays}, 35)
                                                                              WHEN 'weekly' THEN greatest(${recentDays}, 8)
                                                                              ELSE ${recentDays} END)
     AND x.idle_since < k.now - make_interval(mins => ${idleMinutes}) - make_interval(secs => x.pace_seconds::double precision)
), cd_judged AS (
  -- Lease engine còn nhịp của tài khoản (ưu tiên lease của chính chiến dịch), presence Desktop đang online của nhân viên, và mục của tài
  -- khoản trong runtime_state.accounts (ready, reason, runningCampaignId).
  SELECT x.*, l.campaign_id AS lease_campaign, l.lane AS lease_lane, l.acquired_at AS lease_acquired_at, l.heartbeat_at AS lease_heartbeat_at,
         EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = x.account_id AND tr.completed_at IS NULL
                   AND tr.started_at > k.now - interval '20 minutes') AS open_run,
         EXISTS (SELECT 1 FROM cd_acct_active aa WHERE aa.account_id = x.account_id
                   AND CASE WHEN x.runtime = 'server' THEN aa.last_any WHEN NOT x.parallel THEN aa.last_main END
                       > k.now - make_interval(mins => ${idleMinutes}) - make_interval(secs => x.pace_seconds::double precision)) AS account_recent,
         p.app_version, p.runtime_state->'scheduler'->>'state' AS scheduler_state, p.runtime_state->'sleepHold'->>'since' AS sleep_since,
         acc.ready AS acc_ready, acc.reason AS acc_reason, acc.running_campaign
    FROM cd_due x CROSS JOIN k
    LEFT JOIN LATERAL (SELECT l.* FROM public.auto_engine_leases l
                        WHERE l.account_id = x.account_id AND l.heartbeat_at > k.now - interval '3 minutes'
                        ORDER BY (l.campaign_id = x.id) DESC NULLS LAST, (l.lane = 'main') DESC LIMIT 1) l ON true
    LEFT JOIN LATERAL (SELECT p.* FROM public.auto_staff_device_presence p
                        WHERE NOT x.is_server AND p.staff_id = x.staff_id AND p.ended_at IS NULL AND p.last_seen_at > k.d_online_after
                        ORDER BY p.last_seen_at DESC LIMIT 1) p ON true
    LEFT JOIN LATERAL (SELECT CASE WHEN e->>'ready' IN ('true', 'false') THEN (e->>'ready')::boolean END AS ready, e->>'reason' AS reason,
                              CASE WHEN (e->>'runningCampaignId') ~ '^[0-9]{1,18}$' THEN (e->>'runningCampaignId')::bigint END AS running_campaign
                         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.runtime_state->'accounts') = 'array'
                                                        THEN p.runtime_state->'accounts' ELSE '[]'::jsonb END) e
                        WHERE e->>'id' = x.account_id::text LIMIT 1) acc ON true
   WHERE x.due_data > 0
), cd_classified AS (
  SELECT j.*, CASE
      WHEN NOT j.is_server AND j.app_version IS NULL THEN 'app_offline'
      WHEN NOT j.is_server AND j.sleep_since IS NOT NULL THEN 'sleep_hold'
      WHEN j.open_run OR j.account_recent THEN 'busy'
      WHEN (j.running_campaign IS NOT NULL AND j.running_campaign <> j.id)
        OR (j.lease_heartbeat_at IS NOT NULL AND j.lease_campaign IS DISTINCT FROM j.id AND j.lease_lane = 'main' AND NOT j.parallel) THEN 'busy'
      WHEN j.running_campaign = j.id OR j.lease_campaign = j.id THEN 'own_run_no_result'
      WHEN NOT j.is_server AND j.acc_ready IS FALSE THEN 'account_not_ready'
      WHEN NOT j.is_server AND j.scheduler_state = 'blocked_daily_maintenance' THEN 'maintenance_blocked'
      WHEN NOT j.is_server AND j.scheduler_state = 'stopped' THEN 'scheduler_stopped'
      WHEN j.is_server AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr, k
                                        WHERE tr.runtime_target = j.runtime AND tr.started_at > k.now - interval '10 minutes') THEN 'runner_down'
      ELSE 'nothing_holds' END AS kind
    FROM cd_judged j
)
SELECT jsonb_build_object(
  'now', (SELECT now FROM k),
  'holderFunction', to_regprocedure('${HOLDER_SIG}') IS NOT NULL,
  'graceMinutes', ${graceMinutes},
  'opMinutes', ${opMinutes},
  'runIdleMinutes', ${runIdleMinutes},
  'phoneLimit', (SELECT phone_limit FROM k),
  'running', (SELECT count(*) FROM judged),
  'byHolder', coalesce((SELECT jsonb_object_agg(h, n) FROM (SELECT coalesce(holder, 'none') AS h, count(*) AS n FROM judged GROUP BY 1) q), '{}'::jsonb),
  'stuck', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'organizationId', j.organization_id, 'staffId', j.staff_id,
      'platform', j.flatform_type, 'server', j.is_server, 'web', j.is_web, 'updatedAt', j.updated_at,
      'idleMinutes', floor(extract(epoch FROM k.now - j.updated_at) / 60), 'lastActionAt', last.at) ORDER BY j.updated_at)
    FROM judged j CROSS JOIN k
    LEFT JOIN LATERAL (SELECT max(d.created_at) AS at FROM public.auto_campaign_details d WHERE d.account_id = j.id) last ON true
   WHERE j.holder IS NULL AND j.updated_at < k.now - make_interval(mins => ${graceMinutes})), '[]'::jsonb),
  'heldByReason', coalesce((SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) AS n FROM held_judged GROUP BY 1) q), '{}'::jsonb),
  'operationHeld', coalesce((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'organizationId', h.organization_id, 'staffId', h.staff_id,
      'platform', h.flatform_type, 'server', h.is_server, 'web', h.is_web,
      'heldSince', h.updated_at, 'heldMinutes', floor(extract(epoch FROM k.now - h.updated_at) / 60),
      'owner', h.owner, 'reason', h.reason,
      'state', CASE WHEN h.reason IN ('running', 'phone_check') THEN 'running' WHEN h.reason = 'app_closed' THEN 'app_closed' ELSE 'look' END,
      'campaignId', h.campaign_id, 'campaignAction', h.campaign_action, 'campaignStatus', h.campaign_status,
      'campaignDeleted', h.campaign_deleted, 'claimTarget', h.claim_target, 'lastLogAt', h.last_log_at,
      'appOnline', h.online, 'reopened', h.reopened, 'lastSeenAt', h.last_seen_at, 'sessionEnded', h.last_ended_at IS NOT NULL,
      'appVersion', h.app_version, 'schedulerState', h.scheduler_state, 'phoneToday', h.phone_today,
      'dueCampaigns', coalesce(d.n, 0)) ORDER BY h.updated_at)
    FROM held_judged h CROSS JOIN k LEFT JOIN due d ON d.account_id = h.id), '[]'::jsonb),
  'deletedHeld', (SELECT jsonb_build_object('count', count(*),
      'staffIds', coalesce(jsonb_agg(DISTINCT a.staff_id ORDER BY a.staff_id), '[]'::jsonb), 'oldest', min(a.updated_at), 'newest', max(a.updated_at))
    FROM public.auto_accounts a WHERE a.runtime_operation_claim_token IS NOT NULL AND coalesce(a.is_delete, false)),
  'idleMinutes', ${idleMinutes},
  'recentDays', ${recentDays},
  'runnersActive', coalesce((SELECT jsonb_object_agg(rt, n) FROM (SELECT tr.runtime_target AS rt, count(*) AS n
      FROM public.auto_engine_target_runs tr, k WHERE tr.started_at > k.now - interval '10 minutes' GROUP BY 1) q), '{}'::jsonb),
  'stalledByKind', coalesce((SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) AS n FROM cd_classified GROUP BY 1) q), '{}'::jsonb),
  'stalled', coalesce((SELECT jsonb_agg(jsonb_build_object('campaignId', x.id, 'actionId', x.action_id, 'organizationId', x.organization_id,
      'staffId', x.staff_id, 'accountId', x.account_id, 'platform', x.flatform_type, 'server', x.is_server, 'web', x.is_web,
      'runtime', x.runtime, 'status', x.status, 'kind', x.kind, 'lastRunAt', x.last_run_at, 'lastLogAt', x.last_log_at,
      'lastActivityAt', x.last_activity, 'schedule', x.schedule, 'updatedAt', x.updated_at, 'createdAt', x.created_at, 'idleSince', x.idle_since,
      'idleMinutes', floor(extract(epoch FROM k.now - x.idle_since) / 60),
      'paceSeconds', x.pace_seconds, 'dueData', x.due_data,
      'leaseOwn', coalesce(x.lease_campaign = x.id, false), 'leaseAcquiredAt', x.lease_acquired_at, 'leaseHeartbeatAt', x.lease_heartbeat_at,
      'runningCampaignId', x.running_campaign, 'appVersion', x.app_version, 'schedulerState', x.scheduler_state,
      'sleepSince', x.sleep_since, 'accountReason', x.acc_reason, 'note', nullif(x.note, '')) ORDER BY x.idle_since)
    FROM cd_classified x CROSS JOIN k WHERE x.kind NOT IN ('busy', 'app_offline')), '[]'::jsonb),
  'stalledCounted', coalesce((SELECT jsonb_agg(jsonb_build_object('campaignId', x.id, 'accountId', x.account_id, 'staffId', x.staff_id,
      'kind', x.kind) ORDER BY x.id) FROM cd_classified x WHERE x.kind IN ('busy', 'app_offline')), '[]'::jsonb)
) AS report`
}

function resolveWorkdir(opt) {
  const candidates = []
  if (opt.workdir) candidates.push(opt.workdir)
  candidates.push(ROOT)
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim()
    candidates.push(path.dirname(common))
  } catch { /* không phải git checkout */ }
  for (const dir of candidates) {
    const file = path.join(dir, 'supabase/.temp/project-ref')
    if (!fs.existsSync(file)) { if (dir === opt.workdir) throw new Error(`${dir} chưa link Supabase (thiếu supabase/.temp/project-ref)`); continue }
    const ref = fs.readFileSync(file, 'utf8').trim()
    if (ref !== REF) throw new Error(`${dir} đang link project ${ref}, không phải akachat ${REF}; dừng`)
    return dir
  }
  throw new Error('Không thấy thư mục đã link akachat; chạy `supabase link --project-ref cgjbsmqtfhqvttudyjzq` hoặc truyền --workdir')
}

function runQuery(sql, workdir) {
  if (sql.includes(';')) throw new Error('Câu quét phải là một câu SELECT duy nhất')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-stuck-accounts-'))
  try {
    const file = path.join(temp, 'scan.sql')
    fs.writeFileSync(file, sql, { mode: 0o600 })
    const out = execFileSync('supabase', ['db', 'query', '--linked', '--workdir', workdir, '--agent=no', '-o', 'json', '-f', file],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    const parsed = JSON.parse(out)
    const rows = Array.isArray(parsed) ? parsed : parsed.rows
    const report = rows?.[0]?.report
    return typeof report === 'string' ? JSON.parse(report) : report
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}

const vn = iso => {
  if (!iso) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}
const kind = a => a.platform === 'zalo' ? (a.server ? 'Zalo Server' : a.web ? 'Zalo trình duyệt' : 'Zalo QR') : a.platform === 'facebook' ? 'Facebook' : String(a.platform)

/** Câu giải thích + cách gỡ cho dòng "cần xem" của nhóm (B). */
function lookAdvice(a, report) {
  const advice = {
    server_run_idle: `lượt bộ cũ trên tài khoản Server không ghi log quá ${report.runIdleMinutes} phút: engine v2 trả legacy_busy cho tài khoản; gỡ khi App Server / worker Fly khởi động lại runtime của nhân viên`,
    reopened_still_held: 'app đã mở lại sau lúc giữ token mà token còn: bước dọn lúc đăng nhập (reset_desktop_running_statuses) không gỡ',
    app_online_run_idle: `app đang mở mà lượt chiến dịch không ghi log quá ${report.runIdleMinutes} phút (app treo / máy vừa thức): nhờ khách đăng xuất rồi đăng nhập lại; để qua 00:00 thì cổng bảo trì đóng mọi chiến dịch của nhân viên`,
    app_online_operation: `app đang mở, thao tác tài khoản giữ quá ${report.opMinutes} phút (quét data dài là bình thường): không có thao tác nào đang chạy thì nhờ khách đăng xuất rồi đăng nhập lại`,
    phone_check_limit_reached: `đã tra đủ hạn mức ngày (${a.phoneToday}/${report.phoneLimit} số) mà token còn: lượt Kiểm tra SĐT chưa nhả`,
    server_operation: 'thao tác trên tài khoản Server, hôm nay chưa tra SĐT nào: nghi rò; gỡ khi App Server / worker Fly khởi động lại runtime của nhân viên'
  }
  return advice[a.reason] || a.reason
}

function heldLine(a, report) {
  const owner = a.owner === 'campaign'
    ? `lượt chiến dịch ${a.campaignId} ${a.campaignAction}${a.campaignDeleted ? ' (đã xoá)' : a.campaignStatus !== 'đang chạy' ? ` (${a.campaignStatus})` : ''}, log cuối ${vn(a.lastLogAt)}`
    : 'thao tác tài khoản'
  const app = a.server ? ''
    : a.appOnline ? `, app online${a.appVersion ? ` ${a.appVersion}` : ''}${a.schedulerState ? ` (bộ lập lịch ${a.schedulerState})` : ''}`
      : a.lastSeenAt ? `, app thấy lần cuối ${vn(a.lastSeenAt)}${a.appVersion ? ` (${a.appVersion}${a.sessionEnded ? '' : ', phiên chưa đóng'})` : ''}`
        : ', chưa có presence (bản < 7.1.0)'
  const phone = a.phoneToday == null ? '' : `, Kiểm tra SĐT hôm nay ${a.phoneToday}/${report.phoneLimit} số`
  const due = a.dueCampaigns > 0 ? `, ${a.dueCampaigns} chiến dịch tới lịch trên tài khoản` : ''
  return `  ${a.id}  tổ chức ${a.organizationId}  nhân viên ${a.staffId}  ${kind(a)}  giữ từ ${vn(a.heldSince)} (${a.heldMinutes} phút)  ${owner}${app}${phone}${due}`
}

/** Một dòng của nhóm (D). */
function stalledLine(r) {
  const account = kind({ platform: r.platform, server: r.server, web: r.web })
  const where = r.runtime === 'desktop'
    ? (r.appVersion ? `app ${r.appVersion}${r.schedulerState ? ` (bộ lập lịch ${r.schedulerState})` : ''}` : 'app chưa báo bản')
    : r.runtime === 'fly' ? 'chạy trên Fly' : 'chạy trên VPS'
  const pace = Number(r.paceSeconds) > 0 ? `, nghỉ ${Number(r.paceSeconds)} giây giữa hai data` : ''
  const lease = r.leaseOwn ? `, lease của chính chiến dịch từ ${vn(r.leaseAcquiredAt)}` : ''
  const running = r.runningCampaignId ? `, máy báo đang chạy chiến dịch ${r.runningCampaignId}` : ''
  const note = r.note ? `, ghi chú "${r.note}"` : ''
  return `  ${r.campaignId} ${r.actionId}  tổ chức ${r.organizationId}  nhân viên ${r.staffId}  tài khoản ${r.accountId} ${account}  ${where}  `
    + `đứng yên từ ${vn(r.idleSince)} (${r.idleMinutes} phút${pace}; hoạt động cuối `
    + `${r.lastActivityAt ? vn(r.lastActivityAt) : `chưa có, tạo lúc ${vn(r.createdAt)}`}, lịch ${vn(r.schedule)}, ghi dòng cuối ${vn(r.updatedAt)}), `
    + `còn ${r.dueData}${Number(r.dueData) >= 1000 ? '+' : ''} data tới hạn`
    + `${lease}${running}${note}`
}

/** Câu giải thích + cách gỡ cho một dòng của nhóm (D). */
function stallAdvice(r) {
  const logs = 'postgres_logs: "statement timeout" có claim_target_v1 trong parsed.context (số dòng trong context cộng 5 là dòng của '
    + 'pg_get_functiondef)'
  const runner = r.runtime === 'fly' ? 'worker Fly' : 'App Server trên VPS'
  switch (r.kind) {
    case 'own_run_no_result':
      return `máy chạy / lease báo đang chạy chính chiến dịch này mà ${r.idleMinutes} phút không ra kết quả: thường là claim quá giờ và lõi `
        + `thử lại mãi trong lượt (như 53573 ngày 27/11); xem ${logs}`
    case 'nothing_holds':
      return r.runtime === 'desktop'
        ? `app đang mở mà không nhận chiến dịch này: xem "Lý do đang chờ" trong app và ${logs}`
        : `${runner} vẫn chạy lượt khác mà không nhận chiến dịch này: xem ${logs}`
    case 'maintenance_blocked': return 'bộ lập lịch kẹt ở cổng bảo trì đầu ngày (lượt ngày cũ chưa nhả): nhờ khách đăng xuất rồi đăng nhập lại'
    case 'scheduler_stopped': return 'app đang mở mà bộ lập lịch dừng: nhờ khách đăng xuất rồi đăng nhập lại'
    case 'runner_down': return `${runner} không chạy lượt engine nào 10 phút qua`
    case 'sleep_hold': return `máy đang ngủ, bộ giữ máy ngủ giữ từ ${vn(r.sleepSince)}; chạy tiếp khi máy thức`
    case 'account_not_ready': return `tài khoản chưa sẵn sàng trên máy (${r.accountReason || 'không rõ lý do'})`
    default: return r.kind
  }
}

function printReport(report, { all = false } = {}) {
  const by = Object.entries(report.byHolder || {}).sort((x, y) => y[1] - x[1]).map(([h, n]) => `${HOLDER_LABEL[h] || h} ${n}`).join(', ')
  console.log(`Tài khoản "đang chạy": ${report.running} (${by || 'không có'}). Hàm V681 trên DB: ${report.holderFunction ? 'có' : 'chưa có'}.`)
  const stuck = report.stuck || []
  console.log(`\n(A) Kẹt "đang chạy", không gì giữ, quá ${report.graceMinutes} phút: ${stuck.length}`)
  for (const a of stuck) {
    console.log(`  ${a.id}  tổ chức ${a.organizationId}  nhân viên ${a.staffId}  ${kind(a)}  lần ghi cuối ${vn(a.updatedAt)} (${a.idleMinutes} phút), hành động cuối ${vn(a.lastActionAt)}`)
  }

  const held = report.operationHeld || []
  const group = state => held.filter(a => a.state === state)
  const running = group('running'), closed = group('app_closed'), look = group('look')
  const phone = running.filter(a => a.reason === 'phone_check').length
  console.log(`\n(B) Giữ token thao tác quá ${report.opMinutes} phút: ${held.length} — đang chạy ${running.length} (lượt bộ cũ ${running.length - phone}, `
    + `Kiểm tra SĐT ${phone}), app không online ${closed.length} (tự gỡ ở lần đăng nhập kế), cần xem ${look.length}`)
  if (look.length) {
    console.log('  Cần xem:')
    for (const a of look) console.log(`${heldLine(a, report)}\n      → ${lookAdvice(a, report)}`)
  }
  if (all) {
    for (const [title, rows] of [['Đang chạy', running], ['App không online', closed]]) {
      if (!rows.length) continue
      console.log(`  ${title}:`)
      for (const a of rows) console.log(heldLine(a, report))
    }
  } else if (running.length || closed.length) console.log('  (--all để liệt kê cả dòng đang chạy và app không online)')

  const del = report.deletedHeld || { count: 0 }
  console.log(`\n(C) Tài khoản đã xoá còn token: ${del.count}${del.count ? ` (nhân viên ${del.staffIds.join(', ')}; giữ từ ${vn(del.oldest)} tới ${vn(del.newest)}). `
    + 'Không bước dọn nào gỡ; chỉ làm private.app_access_held luôn đúng cho các nhân viên này.' : ''}`)

  const stalled = report.stalled || []
  const byKind = report.stalledByKind || {}
  const count = k => Number(byKind[k] || 0)
  const lookRows = stalled.filter(r => STALL_STATE[r.kind] === 'look')
  const infoRows = stalled.filter(r => STALL_STATE[r.kind] === 'info')
  const lookKinds = Object.keys(STALL_STATE).filter(k => STALL_STATE[k] === 'look' && count(k) > 0)
  const runners = Object.entries(report.runnersActive || {}).map(([rt, n]) => `${rt} ${n}`).join(', ') || 'không có'
  console.log(`\n(D) Chiến dịch tới giờ còn data mà đứng yên quá ${report.idleMinutes} phút (cộng thời gian nghỉ giữa hai data), có hoạt `
    + `động trong ${report.recentDays} ngày: cần xem ${lookRows.length}${lookKinds.length ? ` (${lookKinds.map(k => `${STALL_LABEL[k]} ${count(k)}`).join(', ')})` : ''}`
    + `, máy đang ngủ ${count('sleep_hold')}, tài khoản chưa sẵn sàng ${count('account_not_ready')}; chỉ đếm: tài khoản bận chiến dịch khác `
    + `${count('busy')}, app Desktop không online ${count('app_offline')}. Lượt engine 10 phút qua: ${runners}.`)
  if (lookRows.length) {
    console.log('  Cần xem:')
    for (const r of lookRows) console.log(`${stalledLine(r)}\n      → ${stallAdvice(r)}`)
  }
  if (all && infoRows.length) {
    console.log('  Không cần làm gì:')
    for (const r of infoRows) console.log(`${stalledLine(r)}\n      → ${stallAdvice(r)}`)
  } else if (infoRows.length) console.log('  (--all để liệt kê cả máy đang ngủ và tài khoản chưa sẵn sàng)')
}

function main() {
  const opt = parseArgs(process.argv.slice(2))
  const sql = buildSql(opt)
  if (opt.printSql) { console.log(sql); return }
  const report = runQuery(sql, resolveWorkdir(opt))
  if (opt.json) console.log(JSON.stringify(report, null, 2))
  else printReport(report, opt)
  if ((report.stuck || []).length > 0 || (report.operationHeld || []).some(a => a.state === 'look')
      || (report.stalled || []).some(r => STALL_STATE[r.kind] === 'look')) process.exitCode = 2
}

if (require.main === module) {
  try { main() } catch (error) { console.error(error.message || error); process.exit(1) }
}
module.exports = { buildSql, HOLDER_LABEL, HELD_STATE, STALL_STATE }
