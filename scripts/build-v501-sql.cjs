// Sinh migration V501: lịch chạy, thử lại data và kết thúc chiến dịch của engine v2 theo đúng bộ chạy Desktop/VPS
// (đặc tả docs/engine-v2-specs/zalo-scheduling-completion.md mục 8.1). Chỉ engine v2 gọi các hàm này; bộ chạy cũ không đổi.
//
// Sửa tại chỗ claim_target_v1 và report_v1 (thân V499, đã kiểm khớp production 12/11: md5 prosrc c1d965ca… / 03e17d13…),
// thêm finish_campaign_v2 (giữ v1 không đổi). Mỗi chỗ sửa so khớp đúng số lần xuất hiện, lệch thì dừng.
//   claim:  tài khoản tạm dừng → account_paused (G7); quyền gói Zalo như bản cũ; giới hạn tài khoản Zalo (trình duyệt) chạy
//           đồng thời (G10); chiến dịch đang nạp data ban đầu (G10); lịch ngày cũ chưa qua bảo trì → maintenance_required (G1);
//           Nhóm data hết hạn → data_group_hard_end (G5); mỗi data chỉ thử một lần trong một lượt (G3); chờ khoá/hạn mức
//           KHÔNG dời lịch chiến dịch (G2, như Desktop); xoá ghi chú khi bắt đầu chạy (G6); lease giữ lịch lúc bắt đầu lượt.
//   report: bỏ "về hàng đợi thì kết thúc lượt" (G3, thay bằng mỗi data một lần/lượt); "còn data phía sau" không tính data đã
//           thử trong lượt; không ghi đè trạng thái người dùng vừa đổi (tạm dừng) (mục C); hoãn chiến dịch theo phút không
//           vượt giờ dừng trong ngày.
//   finish_campaign_v2: kết thúc lượt như handleCampaignCompletion của Desktop (hẹn theo data tương lai, hết ngày kết thúc,
//           nhiều khung giờ, gửi lặp lại, còn data chờ → chưa hoàn thành), trả lý do để lõi in đúng câu.
// Chạy: node scripts/build-v501-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v499 = require('./build-v499-sql.cjs')

function extract(text, name) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$f\\$([\\s\\S]*?)\\$f\\$;`)
  const m = re.exec(text)
  if (!m) throw new Error(`Không thấy ${name} trong V499`)
  return { block: m[0], body: m[1] }
}
function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]

const claim = extract(v499.migration, 'aka_agent_engine_claim_target_v1')
const report = extract(v499.migration, 'aka_agent_engine_report_v1')
const LIVE = { claim: v499.NEW.claim, report: v499.NEW.report }
if (md5(claim.body) !== LIVE.claim) throw new Error('Thân claim_target_v1 trong V499 không còn khớp bản live đã kiểm')
if (md5(report.body) !== LIVE.report) throw new Error('Thân report_v1 trong V499 không còn khớp bản live đã kiểm')
if (LIVE.claim !== 'c1d965ca4bd804bc1dd4f20f39d21e3f' || LIVE.report !== '03e17d13fd900cd2957e4548ba805ef8') {
  throw new Error('md5 thân V499 khác bản đã đọc production 12/11')
}

// ------------------------------------------------------------------------------------------------ claim
let c = claim.block
c = patch(c, `  v_allowed boolean;
  v_boundary text;
BEGIN`, `  v_allowed boolean;
  v_boundary text;
  v_org bigint;
  v_cap_qr boolean;
  v_cap_web boolean;
  v_cap_server boolean;
  v_max integer;
  v_running bigint;
  v_day_start timestamptz := ((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_wait_note text;
  v_found boolean := false;
  v_cooldown boolean;
  v_cd_decision text;
  v_cd_note text;
  v_cd_error text;
  v_cd_paused jsonb := '[]'::jsonb;
  v_cd_skip bigint[] := '{}';
  v_cd_scanned integer := 0;
  v_dg_result jsonb;
  v_cd_deadline timestamptz;
BEGIN`, 1, 'claim declare')

// Review 12/11 (agent đọc độc lập V501): khoá tư vấn trước khoá dòng, đúng thứ tự của bản cũ.
//   - Nhóm data: nhánh hết hạn gọi hàm kết thúc v219, hàm này lấy khoá nạp data của chiến dịch; luồng nạp Nhóm data, v219 và
//     finish_campaign_v2 đều lấy khoá đó TRƯỚC khoá dòng chiến dịch. Claim khoá dòng trước rồi mới gọi v219 là ngược thứ tự.
//   - Giới hạn tài khoản Zalo (trình duyệt) chạy đồng thời: claim bản cũ (v397) lấy khoá tư vấn theo nhân viên trước khoá dòng
//     để hai lượt nhận cùng lúc không cùng thấy N-1 và cùng vượt giới hạn; bộ mới đếm cùng công thức nên phải lấy cùng khoá.
c = patch(c, `  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;`, `  -- V501 (review 12/11): khoá tư vấn trước khoá dòng, đúng thứ tự của bản cũ. Chiến dịch Nhóm data: khoá nạp data của chiến dịch
  -- (cùng khoá với aka_agent_lock_campaign_input_serialization; luồng nạp Nhóm data, hàm kết thúc v219 và finish_campaign_v2 lấy
  -- khoá này trước khoá dòng chiến dịch), vì nhánh hết hạn bên dưới gọi hàm kết thúc v219.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = v_campaign_id AND x.data_target_source_mode = 'data_group') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  END IF;
  -- Tài khoản Zalo (trình duyệt) bắt đầu lượt trên Desktop: khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397), để
  -- hai lượt nhận cùng lúc (của bộ mới hay bộ cũ) không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo'
                   AND coalesce(xa.is_zalo_show_web, false) AND NOT coalesce(xa.is_zalo_server, false)) THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;`, 1, 'claim admission locks')

c = patch(c, `  IF a.is_active IS NOT TRUE OR a.login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN jsonb_build_object('status', 'account_logged_out', 'loginStatus', a.login_status);
  END IF;`, `  IF a.is_active IS NOT TRUE OR a.login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN jsonb_build_object('status', 'account_logged_out', 'loginStatus', a.login_status);
  END IF;
  -- V501 (G7): tài khoản tạm dừng (hay trạng thái khác "chờ xử lý"/"đang chạy") không nhận lượt, như bản cũ. "đang chạy" mà
  -- không còn ai giữ (bộ cũ đã kiểm ở trên bằng token, bộ mới bằng lease bên dưới) là sót lại sau khi app/worker tắt đột ngột.
  IF coalesce(a.status, 'chờ xử lý') NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'account_paused', 'accountStatus', a.status);
  END IF;`, 1, 'claim account status')

c = patch(c, `  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_staff_time_allowed($1)' INTO v_allowed USING v_staff;
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'staff_time_blocked'); END IF;
  END IF;`, `  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_staff_time_allowed($1)' INTO v_allowed USING v_staff;
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'staff_time_blocked'); END IF;
  END IF;
  -- V501: quyền gói Zalo của tổ chức như claim của bản cũ (aka_agent_claim_campaign_runtime_checked): Server cần QR + Server,
  -- tài khoản trình duyệt cần Web, tài khoản QR cần QR.
  v_org := coalesce(c.organization_id, a.organization_id);
  IF lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND v_org IS NOT NULL
     AND to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT x.qr_enabled, x.web_enabled, x.server_enabled FROM public.resolve_organization_zalo_account_capabilities($1) x'
      INTO v_cap_qr, v_cap_web, v_cap_server USING v_org;
    IF (coalesce(a.is_zalo_server, false) AND NOT (coalesce(v_cap_qr, false) AND coalesce(v_cap_server, false)))
       OR (NOT coalesce(a.is_zalo_server, false) AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_web, false))
       OR (NOT coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_qr, false)) THEN
      RETURN jsonb_build_object('status', 'entitlement_denied');
    END IF;
  END IF;
  -- V501 (G10): giới hạn số tài khoản Zalo (trình duyệt) chạy đồng thời của nhân viên, đếm như bản cũ (v397). Chỉ khi bắt đầu
  -- lượt (chưa giữ lease): lượt đang chạy không bị cắt giữa chừng.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
     AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(a.is_zalo_server, false)
     AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo' AND xa.is_zalo_show_web = true AND xa.is_zalo_server = false;
      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;`, 1, 'claim capabilities and concurrency')

c = patch(c, `  INSERT INTO public.auto_engine_leases AS el (account_id, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at)
  VALUES (v_account_id, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds))
  ON CONFLICT (account_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,`,
`  -- V501: campaign_schedule = lịch của chiến dịch lúc bắt đầu lượt (khung giờ hiện tại của chiến dịch nhiều khung giờ).
  INSERT INTO public.auto_engine_leases AS el (account_id, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at, campaign_schedule)
  VALUES (v_account_id, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds), c.schedule)
  ON CONFLICT (account_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,
    campaign_schedule = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.campaign_schedule ELSE EXCLUDED.campaign_schedule END,`,
  1, 'claim lease upsert')

c = patch(c, `  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule > v_now THEN
    RETURN jsonb_build_object('status', 'not_due', 'schedule', c.schedule, 'leaseToken', v_token);
  END IF;`, `  -- V501 (G10): chiến dịch đang nạp data ban đầu chưa được chạy, như bản cũ.
  IF coalesce(c.provisioning_state, 'ready') <> 'ready' THEN
    RETURN jsonb_build_object('status', 'campaign_not_ready', 'leaseToken', v_token, 'provisioningState', c.provisioning_state);
  END IF;
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule > v_now THEN
    RETURN jsonb_build_object('status', 'not_due', 'schedule', c.schedule, 'leaseToken', v_token);
  END IF;
  -- V501 (G1): lịch còn là ngày cũ mà chiến dịch chưa qua bảo trì lịch ngày mới: không chạy, nơi chạy cập nhật lịch rồi hỏi
  -- lại (như daily_maintenance_required của bản cũ, v340). Riêng hằng ngày không bật "chạy tiếp hôm sau" thì chạy tiếp ngay.
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule < v_day_start
     AND NOT (coalesce(nullif(c.schedule_type, ''), 'daily') = 'daily' AND c.continue_next_day IS NOT TRUE) THEN
    RETURN jsonb_build_object('status', 'maintenance_required', 'leaseToken', v_token, 'schedule', c.schedule);
  END IF;
  -- V501 (G5): chiến dịch theo Nhóm data đã hết hạn nhận và chạy data mới: không nhận lượt; kết thúc bằng đúng hàm kết thúc Nhóm data
  -- của bản cũ (finalizeDataGroupCampaignAtHardEnd: dừng nguồn, đóng data chờ "Chiến dịch đã hết hạn", hoàn thành khi không còn data
  -- đang chạy). Hàm chưa có (DB thử) thì chỉ không nhận lượt.
  IF c.data_target_source_mode = 'data_group' AND c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now THEN
    IF to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
      EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_dg_result
        USING c.staff_id, c.organization_id, c.id, 'Chiến dịch đã hết thời hạn nhận và chạy data mới';
    END IF;
    RETURN jsonb_build_object('status', 'data_group_hard_end', 'leaseToken', v_token, 'finalize', v_dg_result);
  END IF;`, 1, 'claim provisioning, maintenance, data group')

c = patch(c, `  -- Giữ chỗ tài khoản có hạn. Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ`, `  -- V501 (G5): chiến dịch Nhóm data đang chờ data mới (không có data đến hạn, không có data đang chạy) khi bắt đầu lượt: như claim của
  -- bản cũ (v397) không nhận lượt và không ghi gì; hàm kết thúc Nhóm data chỉ chạy ở cuối một lượt đã chạy data (finish_campaign_v2).
  IF v_req_token IS NULL AND c.data_target_source_mode = 'data_group' AND c.status = 'chờ xử lý'
     AND NOT (c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now)
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false
                        AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND (d.schedule IS NULL OR d.schedule <= v_now)))) THEN
    RETURN jsonb_build_object('status', 'data_group_waiting', 'note', c.note);
  END IF;

  -- Giữ chỗ tài khoản có hạn. Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ`, 1, 'claim data group waiting')

c = patch(c, `  SELECT * INTO t FROM public.auto_campaign_input_data
   WHERE campaign_id = v_campaign_id AND status = 'chờ xử lý' AND coalesce(is_delete, false) = false
     AND (schedule IS NULL OR schedule <= v_now)
   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN`, `  -- V501 (G3): mỗi data chỉ thử một lần trong một lượt (như Desktop đi qua danh sách một lần): data vừa về hàng đợi
  -- được thử lại ở lượt sau, các data phía sau vẫn chạy trong lượt này.
  -- V501: chống gửi lặp N ngày (applyRecentDeliveryCooldown của Desktop, trước khi nhận data và trước bước tra số): gọi đúng
  -- RPC của bộ cũ cho data sắp nhận (còn "chờ xử lý", đã khoá). RPC tự tạm dừng data đã gửi gần đây; lõi in "⏸️ Bỏ qua …".
  -- Không ghi lịch sử, không tính lượt, không đổi chuỗi lỗi, không nghỉ. Mỗi lần gọi xét tối đa 50 data, và dừng khi hết ngân sách
  -- thời gian (engine.cooldown_scan_ms, mặc định 1.500 ms tính từ đầu lần gọi; review 12/11): lần gọi từ Desktop có trần 3 giây của
  -- vai trò aka_agent_desktop, quá trần thì cả lần gọi bị huỷ (kể cả các data đã tạm dừng) và lần gọi lại làm lại từ đầu. Trả
  -- cooldown_scan thì các data đã tạm dừng được giữ, lõi gọi lại ngay và đi tiếp từ data kế tiếp.
  v_cooldown := coalesce(c.extra_settings->'recentDeliveryCooldownEnabled' = 'true'::jsonb, false)
    AND to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') IS NOT NULL;
  v_cd_deadline := v_now + make_interval(secs => (CASE WHEN public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500') ~ '^[0-9]{1,6}$'
                                                       THEN greatest(1, public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500')::integer)
                                                       ELSE 1500 END) / 1000.0);
  LOOP
    SELECT d.* INTO t FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
       AND (d.schedule IS NULL OR d.schedule <= v_now)
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
       AND d.id <> ALL (v_cd_skip)
     ORDER BY d.id LIMIT 1 FOR UPDATE SKIP LOCKED;
    v_found := FOUND;
    EXIT WHEN NOT v_found OR NOT v_cooldown;
    v_cd_decision := NULL; v_cd_note := NULL; v_cd_error := NULL;
    BEGIN
      EXECUTE 'SELECT x.decision, x.note FROM public.aka_agent_apply_campaign_delivery_cooldown($1, $2, $3, ARRAY[$4]::bigint[]) x'
        INTO v_cd_decision, v_cd_note USING v_campaign_id, v_account_id, v_staff, t.id;
    EXCEPTION WHEN OTHERS THEN
      v_cd_error := SQLERRM;
    END;
    IF v_cd_error IS NOT NULL THEN
      IF coalesce((SELECT g.on_error FROM public.auto_engine_gates g WHERE g.code = 'delivery_cooldown'), 'closed') = 'open' THEN EXIT; END IF;
      -- Như Desktop: chiến dịch chờ, ghi chú lý do, tự thử lại ở nhịp sau; data giữ nguyên.
      v_wait_note := 'Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: Không thể kiểm tra lịch sử gửi/đăng gần nhất: ' || v_cd_error;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
       WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
      RETURN jsonb_build_object('status', 'gate_unavailable', 'leaseToken', v_token, 'gate', 'delivery_cooldown', 'note', v_wait_note,
        'cooldownPaused', v_cd_paused);
    END IF;
    EXIT WHEN v_cd_decision = 'allowed';
    IF v_cd_decision IN ('paused_recent_delivery', 'paused_unidentifiable') THEN
      v_cd_paused := v_cd_paused || jsonb_build_object('inputDataId', t.id, 'name', t.name, 'phone', t.phone, 'uid', t.uid, 'email', t.email,
        'note', coalesce(nullif(btrim(v_cd_note), ''), 'Tạm dừng vì giới hạn gửi/đăng lặp.'));
    END IF;
    v_cd_skip := v_cd_skip || t.id;
    v_cd_scanned := v_cd_scanned + 1;
    IF v_cd_scanned >= 50 OR clock_timestamp() >= v_cd_deadline THEN
      RETURN jsonb_build_object('status', 'cooldown_scan', 'leaseToken', v_token, 'cooldownPaused', v_cd_paused);
    END IF;
  END LOOP;
  IF NOT v_found THEN`, 1, 'claim target selection')

c = patch(c, `      -- Chiến dịch chưa có data nào (khác "đã chạy hết"): host có thể chờ nguồn bơm data thay vì hoàn thành.
      'hasTargets', EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                             WHERE d.campaign_id = v_campaign_id AND coalesce(d.is_delete, false) = false));`,
`      -- Chiến dịch chưa có data nào (khác "đã chạy hết"): host có thể chờ nguồn bơm data thay vì hoàn thành.
      'hasTargets', EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                             WHERE d.campaign_id = v_campaign_id AND coalesce(d.is_delete, false) = false),
      -- V501: data đến hạn đã thử trong lượt này (về hàng đợi): lượt kết thúc, lượt sau thử lại.
      'dueTried', (SELECT count(*) FROM public.auto_campaign_input_data d
                    WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
                      AND (d.schedule IS NULL OR d.schedule <= v_now)
                      AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)),
      'dataGroup', c.data_target_source_mode = 'data_group',
      'cooldownPaused', v_cd_paused);`, 1, 'claim no_target')

c = patch(c, `  -- Bước bắt buộc phải chờ (khoá / hạn mức): không nhận data; hẹn chiến dịch qua schedule để không bị hỏi lại liên tục.
  IF v_target_wait IS NOT NULL THEN
    UPDATE public.auto_campaigns SET
      status = 'chờ xử lý',
      schedule = CASE WHEN v_target_wait->>'until' IS NOT NULL THEN greatest(coalesce(schedule, v_now), (v_target_wait->>'until')::timestamptz) ELSE schedule END,
      note = public.aka_agent_engine_wait_note(v_target_wait->>'errorCode', nullif(v_target_wait->>'until', '')::timestamptz),
      updated_at = v_now
    WHERE id = v_campaign_id;
    RETURN jsonb_build_object('status', 'wait', 'leaseToken', v_token, 'wait', v_target_wait, 'actions', v_decisions);`, `  -- Bước bắt buộc phải chờ (khoá / hạn mức): không nhận data. V501 (G2): như Desktop, KHÔNG dời lịch chiến dịch (dời lịch
  -- sang ngày sau làm chiến dịch thoát bảo trì lịch ngày mới, chạy lúc 00:00 hay vào ngày không hẹn, và đổi giờ gốc của lịch
  -- lặp khi original_schedule rỗng); chỉ ghi câu chờ khi đổi. Nơi chạy nhớ wait.until để không hỏi lại liên tục.
  IF v_target_wait IS NOT NULL THEN
    v_wait_note := public.aka_agent_engine_wait_note(v_target_wait->>'errorCode', nullif(v_target_wait->>'until', '')::timestamptz);
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
     WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
    RETURN jsonb_build_object('status', 'wait', 'leaseToken', v_token, 'wait', v_target_wait, 'actions', v_decisions, 'cooldownPaused', v_cd_paused);`, 1, 'claim wait')

c = patch(c, `    UPDATE public.auto_campaigns SET status = 'đang chạy',
           schedule = CASE WHEN schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN v_now ELSE schedule END,
           updated_at = v_now`, `    -- V501 (G6): bắt đầu chạy thì xoá ghi chú (câu chờ cũ), như claim của bản cũ (v397). Lịch ngày cũ chỉ còn tới đây với
    -- hằng ngày không chạy tiếp hôm sau (G1 ở trên).
    UPDATE public.auto_campaigns SET status = 'đang chạy',
           schedule = CASE WHEN schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN v_now ELSE schedule END,
           note = CASE WHEN status = 'chờ xử lý' THEN NULL ELSE note END,
           updated_at = v_now`, 1, 'claim start note')

c = patch(c, `    RETURN jsonb_build_object('status', 'daily_boundary', 'leaseToken', v_token, 'reason', v_boundary,`,
  `    -- V501: kèm giờ dừng đã cấu hình để lõi in đúng câu ⏹ của Desktop (giờ dừng riêng hay mốc 23:59).
    RETURN jsonb_build_object('status', 'daily_boundary', 'leaseToken', v_token, 'reason', v_boundary, 'stopTime', c.daily_stop_time,`,
  1, 'claim boundary stop time')

c = patch(c, `    'campaign', jsonb_build_object('id', c.id, 'actionId', c.action_id, 'status', 'đang chạy'));`,
  `    'campaign', jsonb_build_object('id', c.id, 'actionId', c.action_id, 'status', 'đang chạy'),
    'cooldownPaused', v_cd_paused);`, 1, 'claim claimed cooldown lines')

// ------------------------------------------------------------------------------------------------ report
let r = report.block
r = patch(r, `    -- Data vừa trả về hàng đợi không được nhận lại ngay trong cùng lượt (tránh lặp nóng).
    IF v_final_status = 'chờ xử lý' AND (v_schedule IS NULL OR v_schedule <= v_now) AND v_run_rank < 2 THEN
      v_run_rank := 2;
      v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'requeue_ends_unit'));
    END IF;
`, `    -- V501 (G3): data vừa về hàng đợi không được nhận lại trong cùng lượt (claim bỏ qua data đã thử với lease này), nên
    -- lượt chạy tiếp các data phía sau thay vì kết thúc.
`, 1, 'report requeue_ends_unit')

r = patch(r, `    v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
      WHERE d.campaign_id = r.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
        AND (d.schedule IS NULL OR d.schedule <= v_now));`, `    -- V501: không tính data đã thử trong lượt này (lượt sau mới thử lại).
    v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
      WHERE d.campaign_id = r.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
        AND (d.schedule IS NULL OR d.schedule <= v_now)
        AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = r.lease_token));`,
  1, 'report more pending')

r = patch(r, `      UPDATE public.auto_campaigns SET
        status = CASE v_camp_effect WHEN 'pause' THEN 'tạm dừng' ELSE 'chờ xử lý' END,
        schedule = CASE WHEN v_camp_effect = 'hold' AND coalesce(v_camp_hold, 0) > 0 THEN v_now + make_interval(mins => v_camp_hold) ELSE schedule END,
        note = coalesce(v_camp_note, note), updated_at = v_now
      WHERE id = r.campaign_id;`, `      -- V501: không ghi đè trạng thái người dùng vừa đổi trong lúc data chạy (tạm dừng từ Web/Desktop), như VPS. Hoãn theo
      -- phút chỉ dời lịch khi còn trong ngày, trước giờ dừng (G2).
      UPDATE public.auto_campaigns SET
        status = CASE v_camp_effect WHEN 'pause' THEN 'tạm dừng' ELSE 'chờ xử lý' END,
        schedule = CASE WHEN v_camp_effect = 'hold' AND coalesce(v_camp_hold, 0) > 0
                         AND v_now + make_interval(mins => v_camp_hold)
                             < ((v_vn + least(coalesce(daily_stop_time, time '23:59:00'), time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                        THEN v_now + make_interval(mins => v_camp_hold) ELSE schedule END,
        note = coalesce(v_camp_note, note), updated_at = v_now
      WHERE id = r.campaign_id AND status IN ('đang chạy', 'chờ xử lý');`, 1, 'report campaign effect')

// Review 12/11: người dùng vừa tạm dừng (hay chiến dịch đã đổi trạng thái) thì câu UPDATE trên không đổi dòng nào; khi đó không
// báo hiệu ứng như đã áp (lõi sẽ in ghi chú chưa hề ghi). Lượt vẫn dừng nhờ claim / heartbeat thấy "tạm dừng".
r = patch(r, `  v_camp_applied text := 'none';`, `  v_camp_applied text := 'none';
  v_camp_rows integer;`, 1, 'report declare camp rows')
r = patch(r, `      WHERE id = r.campaign_id AND status IN ('đang chạy', 'chờ xử lý');
      v_camp_applied := v_camp_effect;`, `      WHERE id = r.campaign_id AND status IN ('đang chạy', 'chờ xử lý');
      GET DIAGNOSTICS v_camp_rows = ROW_COUNT;
      v_camp_applied := CASE WHEN v_camp_rows > 0 THEN v_camp_effect ELSE 'none' END;`, 1, 'report camp applied rows')

// Giao một phần (gửi được tệp rồi chữ lỗi, hoặc chữ rồi tệp lỗi): như finalizeZaloPartialSendDetail của Desktop. Luôn ghi dòng
// "thất bại" kèm tiền tố, tính lượt (đã có), không đổi chuỗi data lỗi trừ khi do media quá giờ, không bao giờ gửi lại.
r = patch(r, `        WHEN v_phase = 'in_flight' OR v_policy->>'error_class' = 'unknown_delivery' OR v_evidence->>'deliveryState' = 'unknown' THEN 'unknown'
        ELSE 'not_delivered' END;
`, `        WHEN v_phase = 'in_flight' OR v_policy->>'error_class' = 'unknown_delivery' OR v_evidence->>'deliveryState' = 'unknown' THEN 'unknown'
        ELSE 'not_delivered' END;
      -- V501: giao một phần như finalizeZaloPartialSendDetail của Desktop: luôn ghi dòng "thất bại", không đổi chuỗi data lỗi
      -- (trừ khi do media quá giờ), data hoàn thành; chính sách không ghi lịch sử (như khoá 802 với người lạ) vẫn ghi.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_policy := v_policy || jsonb_build_object('detail_mode', 'write',
          'detail_status_id', coalesce((SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_failed' AND s.component_type = 'campaign_detail'
                                         ORDER BY s.id LIMIT 1), (v_policy->>'detail_status_id')::bigint),
          'target_streak_effect', CASE WHEN v_signal->>'code' = 'campaign_media_timeout' THEN v_policy->>'target_streak_effect' ELSE 'ignore' END,
          -- Hiệu ứng chiến dịch phụ thuộc ngưỡng (N lần liền, ví dụ 127 [Q4]) chỉ có nghĩa khi kết quả cộng chuỗi; không cộng chuỗi
          -- thì không được áp ngay (khoá thao tác của mã vẫn giữ).
          'campaign_effect', CASE WHEN v_signal->>'code' IS DISTINCT FROM 'campaign_media_timeout' AND (v_policy->>'streak_threshold') IS NOT NULL
                                  THEN 'none' ELSE v_policy->>'campaign_effect' END,
          'target_effect', 'complete');
        SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);
      END IF;
`, 1, 'report partial policy')

r = patch(r, `             || CASE WHEN v_err.public_code IS NOT NULL THEN ' (' || v_err.public_code || ')' ELSE '' END
        END;
`, `             || CASE WHEN v_err.public_code IS NOT NULL THEN ' (' || v_err.public_code || ')' ELSE '' END
        END;
      -- V501: tiền tố của Desktop cho giao một phần.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_log := CASE WHEN v_evidence->>'partialStage' = 'media_after_content' THEN 'Đã gửi nội dung nhưng gửi file thất bại. '
                      ELSE 'Đã gửi file nhưng gửi nội dung thất bại. ' END || v_log;
      END IF;
`, 1, 'report partial log prefix')

// ------------------------------------------------------------------------------------------------ finish v2
const finishV2 = `CREATE FUNCTION public.aka_agent_engine_finalize_v501(p_campaign_id bigint, p_note text, p_reason text, p_extra jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Như aka_agent_finalize_campaign (v214): còn data "chờ xử lý" (kể cả chưa đến lịch) thì chưa hoàn thành, chiến dịch về
-- "chờ xử lý", xoá ghi chú; không còn thì "hoàn thành" (ghi chú giữ nguyên trừ khi truyền câu mới). Chỉ finish_campaign_v2 gọi.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_pending bigint;
BEGIN
  SELECT count(*) INTO v_pending FROM public.auto_campaign_input_data d
   WHERE d.campaign_id = p_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false;
  IF v_pending > 0 THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = v_now WHERE id = p_campaign_id;
    RETURN jsonb_build_object('ok', true, 'reason', 'pending_input_remaining', 'pendingCount', v_pending, 'campaignStatus', 'chờ xử lý');
  END IF;
  UPDATE public.auto_campaigns SET status = 'hoàn thành', note = coalesce(p_note, note), updated_at = v_now WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'reason', p_reason, 'campaignStatus', 'hoàn thành') || coalesce(p_extra, '{}'::jsonb);
END $f$;

CREATE FUNCTION public.aka_agent_engine_finish_campaign_v2(p_account_id bigint, p_lease_token uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Hết data khi còn giữ lease: kết thúc lượt như Desktop (campaignScheduler.ts, cuối executeCampaignV2 + handleCampaignCompletion +
-- rescheduleCompletedCampaignPass), theo đúng thứ tự. Trả lý do; lõi in câu tiến trình theo lý do.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_campaign_id bigint;
  l public.auto_engine_leases%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  v_extra jsonb;
  v_next timestamptz;
  v_cutoff time;
  v_slots text[];
  v_slot text;
  v_slot_minute integer;
  v_current_minute integer;
  v_candidate timestamptz;
  v_next_slot text;
  v_minutes integer;
  v_raw jsonb;
  v_mode text;
  v_suffix text;
  v_total bigint;
  v_resettable bigint;
  v_m text[];
BEGIN
  SELECT el.campaign_id INTO v_campaign_id FROM public.auto_engine_leases el
   WHERE el.account_id = p_account_id AND el.lease_token = p_lease_token AND el.expires_at > v_now;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  -- Thứ tự khoá như bản cũ: khoá nạp data của chiến dịch (cùng khoá với aka_agent_lock_campaign_input_serialization và luồng nạp
  -- Nhóm data), rồi chiến dịch, tài khoản, rồi lease (claim cũng khoá chiến dịch → tài khoản → lease).
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  SELECT * INTO a FROM public.auto_accounts WHERE id = p_account_id FOR UPDATE;
  SELECT * INTO l FROM public.auto_engine_leases
   WHERE account_id = p_account_id AND lease_token = p_lease_token AND expires_at > v_now FOR UPDATE;
  IF NOT FOUND OR l.campaign_id IS DISTINCT FROM v_campaign_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  IF c.id IS NULL OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'campaign_deleted'); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_control_won', 'campaignStatus', c.status);
  END IF;
  -- Review 12/11: máy chưa cập nhật (bộ cũ) đã nhận chiến dịch giữa lúc lõi hết data và lúc kết thúc lượt: không kết thúc / đặt lại
  -- data, như release_v1 và close_stale_v1 (chỉ đụng chiến dịch không còn token của bộ cũ).
  IF c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'legacy_busy');
  END IF;
  -- Như finalizer của VPS: tài khoản Server bị tạm dừng trong lượt thì chiến dịch về "chờ xử lý", không hoàn thành.
  IF l.runtime_target = 'fly' AND a.status IS DISTINCT FROM 'đang chạy' AND a.status IS DISTINCT FROM 'chờ xử lý' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'account_control_won', 'accountStatus', a.status, 'campaignStatus', 'chờ xử lý');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.campaign_id = c.id AND tr.completed_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                 WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Data đến hạn chưa thử trong lượt này (vừa được thêm vào): chạy tiếp, chưa kết thúc.
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)
                AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = p_lease_token)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Review 12/11: bản cũ xoá ghi chú khi bắt đầu mỗi lượt (claim v397); bộ mới chỉ xoá khi nhận được data (chiến dịch sang "đang
  -- chạy"). Lượt không nhận data nào (chiến dịch còn "chờ xử lý", ví dụ mọi data còn lại bị chống gửi lặp tạm dừng) thì ghi chú đang
  -- có là của lượt trước (câu chờ khoá / hạn mức, không kiểm được giới hạn gửi lặp): xoá trước khi hoàn thành / hẹn lại.
  IF c.status = 'chờ xử lý' AND c.note IS NOT NULL THEN
    UPDATE public.auto_campaigns SET note = NULL, updated_at = v_now WHERE id = c.id;
    c.note := NULL;
  END IF;

  -- 0. Như executeCampaignV2 (isZaloFriendAutoDataCampaign && không có data): chiến dịch nhắn bạn bè "toàn bộ / theo tag" đã lấy
  -- data một lần mà không còn dòng nào thì giữ "chờ xử lý" kèm ghi chú, không hoàn thành (chế độ lạ coi như "selected").
  IF c.action_id = 'zalo_message_friend'
     AND coalesce(c.extra_settings->>'zaloFriendTargetMode', 'selected') IN ('all_friends', 'tagged_friends')
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy',
      updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'friend_auto_no_data', 'campaignStatus', 'chờ xử lý');
  END IF;

  -- 1. Data chưa đến lịch: hẹn chiến dịch tới data sớm nhất (deferCampaignUntilFutureInput), trước mọi nhánh khác.
  SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
   WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
  IF v_next IS NOT NULL THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled_future_input', 'schedule', v_next, 'campaignStatus', 'chờ xử lý');
  END IF;

  -- 2. Nhóm data (handleCampaignCompletion bước 1): đúng hàm kết thúc của bản cũ (aka_agent_internal_finalize_data_group_campaign_v219,
  -- cùng lõi với bản Desktop và bản Zalo Server): data chờ / về hàng đợi → chờ xử lý; nguồn đang nhận → chờ xử lý + "Chờ data mới";
  -- nguồn dừng / hết hạn / bị xoá → hoàn thành. Lease của lượt là bằng chứng sở hữu (thay kiểm runtime của hai bản bọc).
  IF c.data_target_source_mode = 'data_group'
     AND to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_raw
      USING c.staff_id, c.organization_id, c.id, p_note;
    RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN (v_raw->>'completed')::boolean THEN 'data_group_completed' ELSE 'data_group_waiting' END,
      'finalize', v_raw, 'campaignStatus', v_raw->>'status');
  END IF;
  -- Nhóm theo thời gian thực có bộ kết thúc riêng của bản cũ; Nhóm data khi DB chưa có hàm kết thúc (DB thử): không tự hoàn thành
  -- (hoàn thành làm trigger dừng hẳn nguồn Nhóm data).
  IF c.data_target_source_mode = 'data_group' OR c.action_id = 'zalo_message_group_realtime' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = c.id AND status = 'đang chạy';
    RETURN jsonb_build_object('ok', false, 'reason', 'completion_not_supported', 'campaignStatus', 'chờ xử lý');
  END IF;

  v_cutoff := least(coalesce(c.daily_stop_time, time '23:59:00'), time '23:59:00');
  v_extra := coalesce(c.extra_settings, '{}'::jsonb);

  -- 3. Hết ngày kết thúc.
  IF c.schedule_end_date IS NOT NULL AND v_now >= c.schedule_end_date THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_end_date', NULL);
  END IF;

  -- 4. Nhiều khung giờ (handleMultiDailyTimeSlotAfterCompletion): khung hiện tại = lịch lúc bắt đầu lượt, phải cùng ngày hôm nay.
  IF c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb THEN
    -- Tách theo dấu phẩy/xuống dòng, chuẩn hoá H, H:M, HhM, Hh (giờ 0–23, phút 0–59), bỏ trùng theo phút, xếp tăng dần.
    SELECT coalesce(array_agg(s.slot ORDER BY s.minute), '{}'::text[]) INTO v_slots FROM (
      SELECT DISTINCT ON (x.minute) x.minute, x.slot FROM (
        SELECT (m[1])::integer * 60 + coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer AS minute,
               lpad(m[1]::integer::text, 2, '0') || ':' || lpad(coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer::text, 2, '0') AS slot
          FROM regexp_split_to_table(CASE jsonb_typeof(v_extra->'multiDailyTimeSlots') WHEN 'string' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'number' THEN v_extra->>'multiDailyTimeSlots' ELSE '' END, '[,\\r\\n]+') item,
               LATERAL regexp_match(regexp_replace(lower(btrim(item)), '\\s+', '', 'g'), '^(\\d{1,2})(?::(\\d{1,2})|h(\\d{1,2})?|h)?$') m
         WHERE m IS NOT NULL AND (m[1])::integer BETWEEN 0 AND 23 AND coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer BETWEEN 0 AND 59
      ) x ORDER BY x.minute
    ) s;
    IF cardinality(v_slots) >= 2 AND l.campaign_schedule IS NOT NULL
       AND (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_vn THEN
      v_current_minute := extract(hour FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer * 60
                        + extract(minute FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer;
      FOREACH v_slot IN ARRAY v_slots LOOP
        v_slot_minute := split_part(v_slot, ':', 1)::integer * 60 + split_part(v_slot, ':', 2)::integer;
        CONTINUE WHEN v_slot_minute <= v_current_minute;
        v_candidate := ((v_vn + make_interval(mins => v_slot_minute))::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
        CONTINUE WHEN v_candidate <= v_now;
        v_next_slot := v_slot;
        EXIT;
      END LOOP;
      IF v_next_slot IS NULL THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_slot', NULL);
      END IF;
      IF (v_candidate AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_slot_after_cutoff', jsonb_build_object('slot', v_next_slot));
      END IF;
      v_next := v_candidate;
      v_mode := 'slot_advanced';
      v_suffix := 'ở khung giờ tiếp theo';
    END IF;
  END IF;

  -- 5. Gửi lặp lại sau x phút (handleZaloShareRepeatAfterCompletion): nhắn bạn bè/nhóm dạng chia sẻ, không nhiều khung giờ,
  -- không bật chống gửi lặp N ngày, số phút 5–1439 (số, hoặc chuỗi 1–4 chữ số).
  IF v_mode IS NULL AND c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'zaloShareRepeatEnabled' = 'true'::jsonb
     AND v_extra->>'zaloMessageSendMode' = 'share' AND v_extra->'multiDailyTimeSlotsEnabled' IS DISTINCT FROM 'true'::jsonb
     AND v_extra->'recentDeliveryCooldownEnabled' IS DISTINCT FROM 'true'::jsonb THEN
    v_raw := v_extra->'zaloShareRepeatAfterMinutes';
    v_minutes := CASE
      WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\\d+$' THEN (v_raw #>> '{}')::integer
      WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\\d{1,4}$' THEN btrim(v_raw #>> '{}')::integer END;
    IF v_minutes BETWEEN 5 AND 1439 THEN
      v_next := v_now + make_interval(mins => v_minutes);
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         OR (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> v_vn THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_next_day', NULL);
      END IF;
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_after_cutoff', NULL);
      END IF;
      v_mode := 'repeat_scheduled';
      v_suffix := 'ở lượt gửi lặp kế tiếp';
    END IF;
  END IF;

  IF v_mode IS NULL THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed', NULL);
  END IF;

  -- 6. Hẹn lượt kế tiếp (rescheduleCompletedCampaignPass).
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.', updated_at = v_now
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'due_pending', 'campaignStatus', 'chờ xử lý');
  END IF;
  SELECT count(*), count(*) FILTER (WHERE d.status <> 'tạm dừng') INTO v_total, v_resettable
    FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false;
  IF v_resettable = 0 THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_data', jsonb_build_object('suffix', v_suffix));
  END IF;
  UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
   WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END;
END $f$;`

const FINISH_SIG = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'
const FINALIZE_SIG = 'public.aka_agent_engine_finalize_v501(bigint,text,text,jsonb)'
const finishBodies = [...finishV2.matchAll(/AS \$f\$([\s\S]*?)\$f\$;/g)].map(m => m[1])
const NEW = { claim: md5(bodyOf(c)), report: md5(bodyOf(r)), finalize: md5(finishBodies[0]), finish: md5(finishBodies[1]) }

const migration = `-- V501: lịch chạy, thử lại data và kết thúc chiến dịch của engine v2 theo đúng bộ chạy Desktop/VPS (12/11/2026).
-- SINH TỪ scripts/build-v501-sql.cjs, không sửa tay. Đặc tả: docs/engine-v2-specs/zalo-scheduling-completion.md mục 8.1.
--
-- Chỉ engine v2 gọi các hàm này (Fly chỉ khi tổ chức bật cờ, Desktop chỉ bản cài mới); bộ chạy cũ không đổi. Không đổi dữ
-- liệu cũ. Cột mới nằm trên bảng của engine (auto_engine_leases). DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
--   * claim_target_v1: tài khoản tạm dừng → account_paused; quyền gói Zalo như claim bản cũ (entitlement_denied); giới hạn
--     tài khoản Zalo (trình duyệt) chạy đồng thời (concurrency_limit); chiến dịch đang nạp data ban đầu (campaign_not_ready);
--     lịch ngày cũ chưa qua bảo trì (maintenance_required); Nhóm data hết hạn (data_group_hard_end); mỗi data một lần/lượt;
--     chờ khoá/hạn mức không dời lịch; xoá ghi chú khi bắt đầu chạy; lease nhớ lịch lúc bắt đầu lượt.
--   * report_v1: bỏ "về hàng đợi thì kết thúc lượt"; không ghi đè tạm dừng của người dùng; hoãn theo phút không vượt giờ dừng.
--   * finish_campaign_v2 (mới, v1 giữ nguyên): kết thúc lượt như Desktop, trả lý do.
-- Gỡ: rollback_v501_engine_schedule_completion.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v501_%') THEN
      RAISE EXCEPTION 'V501 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_leases') IS NULL THEN RAISE EXCEPTION 'V501 cần V495'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_engine_leases' AND column_name = 'campaign_schedule') THEN
    RAISE EXCEPTION 'V501: auto_engine_leases.campaign_schedule đã có';
  END IF;
  IF to_regprocedure('${FINISH_SIG}') IS NOT NULL OR to_regprocedure('${FINALIZE_SIG}') IS NOT NULL THEN
    RAISE EXCEPTION 'V501: finish_campaign_v2 đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_cfg_advanced_content_invalid' OR public_code = 'CFG16') THEN
    RAISE EXCEPTION 'V501: mã CFG16 đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE signal_kind = 'engine' AND pattern = 'action_waiting') THEN
    RAISE EXCEPTION 'V501: luật action_waiting đã có';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_engine_gate_unavailable' AND action_code IS NULL) THEN
    RAISE EXCEPTION 'V501: thiếu chính sách err_engine_gate_unavailable (V495)';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'V501: thân aka_agent_engine_claim_target_v1 khác V499 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)');
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'V501: thân aka_agent_engine_report_v1 khác V499 (%)', v_md5; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaigns' AND column_name = 'provisioning_state')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaigns' AND column_name = 'continue_next_day') THEN
    RAISE EXCEPTION 'V501: auto_campaigns thiếu cột provisioning_state/continue_next_day';
  END IF;
END $pre$;

ALTER TABLE public.auto_engine_leases ADD COLUMN campaign_schedule timestamptz;

-- CFG16: nội dung nâng cao không có mục nào, hoặc có mục không chữ không tệp (getAdvancedContentConfigError của Desktop). Như các
-- mã cấu hình khác của engine: kiểm đầu lượt, tạm dừng chiến dịch một lần kèm câu cụ thể, data về hàng đợi (bản cũ: chờ + ghi chú).
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_cfg_advanced_content_invalid', 'Nội dung nâng cao chưa hợp lệ',
  'Cấu hình: nội dung nâng cao không có mục nào, hoặc có mục không có chữ và không chọn tệp.',
  NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'CFG16', 'content_config', 'Nội dung nâng cao chưa hợp lệ',
  'Thêm ít nhất 1 nội dung nâng cao, nhập chữ hoặc chọn tệp cho mục đang rỗng, hoặc chuyển về chế độ Cơ bản.');
INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, quota_effect, target_streak_effect, target_effect,
  remaining_steps, lock_action_codes, run_effect, pace_mode, remember_target_days, campaign_effect, account_effect, login_effect, description, source)
SELECT 'err_cfg_advanced_content_invalid', 'suppress', s.id, '{message}', 'no_count', 'ignore', 'requeue', 'skip', '{}'::text[], 'stop_campaign',
  'none', 0, 'pause', 'none', 'none', 'Cấu hình sai: tạm dừng chiến dịch một lần.', 'v501'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_failed';
-- Thao tác không bắt buộc của bước đang bị khoá / hết lượt khi data cần đúng bước đó (EngineStep.onGateWait 'requeue', ví dụ "Tìm SĐT"
-- của data chỉ có SĐT trong chiến dịch thêm thành viên): như Desktop kiểm khoá lúc chạy (checkZaloFindPhoneUserRuntimeLimit): không
-- ghi lịch sử, không tính lượt, data về hàng đợi, dừng lượt. Dùng đúng chính sách của err_engine_gate_unavailable (V495).
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('system', NULL, NULL, 'engine', 'action_waiting', 50, 'err_engine_gate_unavailable', 'v501',
   'Thao tác của bước đang bị khoá / hết lượt (data cần bước đó): chưa gọi nền tảng, data về hàng đợi, dừng lượt.');
COMMENT ON COLUMN public.auto_engine_leases.campaign_schedule IS 'V501: lịch của chiến dịch lúc bắt đầu lượt (khung giờ hiện tại của chiến dịch nhiều khung giờ).';

${c.replace(/^CREATE OR REPLACE FUNCTION /, 'CREATE OR REPLACE FUNCTION ')}

${r}

${finishV2}

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['${FINISH_SIG}', '${FINALIZE_SIG}'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
  END LOOP;
  -- Hàm phụ hoàn thành chỉ finish_campaign_v2 gọi (chủ sở hữu postgres), không cấp cho ai (thu hồi cả quyền mặc định của Supabase).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION ${FINALIZE_SIG} FROM service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ${FINISH_SIG} TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${FINISH_SIG} TO aka_agent_chat_api'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${FINISH_SIG} TO aka_agent_desktop'; END IF;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.claim}' THEN RAISE EXCEPTION 'V501 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'V501 postflight: report_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${FINALIZE_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.finalize}' THEN RAISE EXCEPTION 'V501 postflight: finalize_v501 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${FINISH_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.finish}' THEN RAISE EXCEPTION 'V501 postflight: finish_campaign_v2 %', v_md5; END IF;
  IF has_function_privilege('anon', '${FINISH_SIG}', 'EXECUTE') OR has_function_privilege('authenticated', '${FINALIZE_SIG}', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND has_function_privilege('service_role', '${FINALIZE_SIG}', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V501 postflight: quyền hàm mới quá rộng';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V501: trả claim_target_v1/report_v1 về thân V499, xoá finish_campaign_v2 và cột lịch của lease. SINH TỪ scripts/build-v501-sql.cjs.
-- Nơi chạy đang gọi finish_campaign_v2 phải được đưa về bản trước (hoặc tắt cờ tổ chức) trước khi gỡ.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regprocedure('${FINISH_SIG}') IS NULL THEN RAISE EXCEPTION 'Gỡ V501: chưa có V501'; END IF;
END $pre$;

DROP FUNCTION ${FINISH_SIG};
DROP FUNCTION ${FINALIZE_SIG};
ALTER TABLE public.auto_engine_leases DROP COLUMN campaign_schedule;
DELETE FROM public.auto_outcome_signal_rules WHERE signal_kind = 'engine' AND pattern = 'action_waiting' AND source = 'v501';
-- CFG16: xoá nếu chưa dòng lịch sử nào dùng, còn thì chỉ tắt (như cách gỡ mã engine của V495).
DELETE FROM public.auto_outcome_policies WHERE error_code = 'err_cfg_advanced_content_invalid' AND source = 'v501';
UPDATE public.auto_error SET is_active = false WHERE error_code = 'err_cfg_advanced_content_invalid';
DELETE FROM public.auto_error e WHERE e.error_code = 'err_cfg_advanced_content_invalid'
   AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_details d WHERE d.error_code = e.error_code)
   AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes o WHERE o.error_code = e.error_code)
   AND NOT EXISTS (SELECT 1 FROM public.auto_account_action_status a WHERE a.disabled_error_code = e.error_code);

${claim.block}

${report.block}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'Gỡ V501 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'Gỡ V501 postflight: report_v1 %', v_md5; END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v501_engine_schedule_completion.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v501_engine_schedule_completion.sql'), rollback)
  console.log('V501 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
