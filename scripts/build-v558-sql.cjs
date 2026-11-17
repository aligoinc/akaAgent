// Sinh migration V558: engine v2 nhận chiến dịch Facebook (đợt 0, phương án docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_PLAN.md; anh duyệt
// danh sách schema 16/11/2026 tối, docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_SCHEMA.md mục 5). Chỉ thay thân hàm engine, giữ chữ ký, chủ sở
// hữu, quyền. Mọi nhánh mới chỉ chạy với tài khoản Facebook, lượt theo lịch (mode campaign_slot) hoặc chính sách FB mới (detail_mode =
// inherit / streak_after_delivery); engine Zalo không đổi hành vi.
//
//   claim_target_v1  tài khoản Facebook: chỉ Desktop, tổ chức bật engine.facebook (tắt khẩn cấp có hiệu lực ở lần nhận sau → not_enabled),
//                    quyền gói Facebook (sản phẩm 3 / 10 còn hạn), giới hạn số tài khoản Facebook chạy cùng lúc của nhân viên
//                    (org_staff.max_running_facebook_accounts, cùng khoá và cách đếm của claim bản cũ v397); lượt theo lịch (ctx.mode =
//                    campaign_slot): mỗi mốc lịch một lượt, slot_at = lịch của chiến dịch lúc nhận; ctx.inputDataIds: chỉ nhận đúng các data
//                    này trong lượt đang giữ lease (đăng nhóm kèm chia sẻ sang các nhóm đã chọn, nhận qua claim_batch_v1).
//   action_limit     trần gói Facebook như bộ cũ (entitlementRepository getGroupedDailySendLimit, gộp sản phẩm 3 và 10).
//   resolve_policy   gộp thêm cột streak_after_delivery (V556 phần 2).
//   report_v1        detail_mode = inherit: dòng lịch sử theo trạng thái block trả, trường còn NULL theo chính sách của trạng thái đó;
//                    streak_after_delivery = ignore: lỗi sau khi data đã gửi thành công không cộng chuỗi, không áp hiệu ứng có ngưỡng;
//                    kết quả lỗi kèm statusCode lạ bị từ chối (status_unknown); kết quả không gắn thao tác (dòng "Tìm data" của tìm data
//                    Facebook, bộ cũ ghi không mã thao tác) được nhận khi có tên ghi lịch sử: không tính lượt, không ghi dấu, luật theo
//                    nền tảng của loại chiến dịch.
//   simulate_v1      cùng cách giải inherit như report_v1.
//   finish_campaign_v2  chạy lại sau N giờ khi xong (tìm data, comment seeding, newsfeed); nhiều khung giờ cho trang cá nhân / Page;
//                    chiến dịch Facebook không có dòng data sang khung kế không đặt lại gì, Page không có data thì hoàn thành.
//
// Nguồn: pg_get_functiondef nguyên văn của production, đọc chỉ đọc 16/11/2026 (scripts/fixtures/engine-v2-facebook/live-20261116; DB thử
// tới V532 cho đúng các md5 này). Preflight kiểm md5 định nghĩa đang chạy; khác thì dừng để đọc lại bản live.
// Chạy: node scripts/build-v558-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE_DIR = path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/live-20261116')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const NAME = 'migration_v558_engine_facebook_functions'
const ROLLBACK_NAME = 'rollback_v558_engine_facebook_functions'

const FUNCS = {
  claim: { file: 'aka_agent_engine_claim_target_v1.sql', sig: 'public.aka_agent_engine_claim_target_v1(jsonb)' },
  limit: { file: 'aka_agent_engine_action_limit.sql', sig: 'public.aka_agent_engine_action_limit(bigint,bigint,text)' },
  resolve: { file: 'aka_agent_engine_resolve_policy.sql', sig: 'public.aka_agent_engine_resolve_policy(text,bigint,text,text,text,text)' },
  report: { file: 'aka_agent_engine_report_v1.sql', sig: 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)' },
  simulate: { file: 'aka_agent_engine_simulate_v1.sql', sig: 'public.aka_agent_engine_simulate_v1(text,text,jsonb)' },
  finish: { file: 'aka_agent_engine_finish_campaign_v2.sql', sig: 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)' }
}
const SUMS = Object.fromEntries(fs.readFileSync(path.join(LIVE_DIR, 'MD5SUMS'), 'utf8').trim().split('\n').map(line => line.split(' ').reverse()))

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const live = {}
for (const [key, f] of Object.entries(FUNCS)) {
  live[key] = fs.readFileSync(path.join(LIVE_DIR, f.file), 'utf8')
  if (md5(live[key]) !== SUMS[f.file]) throw new Error(`${f.file}: md5 khác MD5SUMS (tệp nguồn bị sửa?)`)
}

// ------------------------------------------------------------------------------------------------ claim_target_v1
let c = live.claim
c = patch(c, `  v_legacy_before timestamptz;
BEGIN`, `  v_legacy_before timestamptz;
  -- V558: lượt theo lịch (loại chiến dịch không có dòng data: trang cá nhân, newsfeed Facebook).
  v_slot_mode boolean := coalesce(p_ctx->>'mode', '') = 'campaign_slot';
  v_slot timestamptz;
  v_is_facebook boolean;
BEGIN`, 1, 'claim: khai báo')
c = patch(c, `    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;`,
`    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  -- V558: tài khoản Facebook bắt đầu lượt trên Desktop: cùng khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397 khoá chung
  -- cho Zalo trình duyệt và Facebook), để hai lượt nhận cùng lúc không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook') THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;`, 1, 'claim: khoá giới hạn Facebook')
c = patch(c, `  SELECT * INTO a FROM public.auto_accounts WHERE id = v_account_id FOR UPDATE;
  IF NOT FOUND OR coalesce(a.is_delete, false) OR a.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'account_not_found');
  END IF;`,
`  SELECT * INTO a FROM public.auto_accounts WHERE id = v_account_id FOR UPDATE;
  IF NOT FOUND OR coalesce(a.is_delete, false) OR a.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'account_not_found');
  END IF;
  -- V558: tài khoản Facebook chỉ chạy engine trên Desktop, khi tổ chức bật engine.facebook (anh chốt Q1). Kiểm mỗi lần nhận lượt: tắt
  -- (mode off / bỏ tổ chức khỏi danh sách) có hiệu lực ở lần nhận kế tiếp, Desktop nhận not_enabled thì chạy bộ cũ.
  v_is_facebook := lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  IF v_is_facebook THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_engine_facebook_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
  END IF;`, 1, 'claim: bật Facebook theo tổ chức')
c = patch(c, `      RETURN jsonb_build_object('status', 'entitlement_denied');
    END IF;
  END IF;
  -- V501 (G10): giới hạn số tài khoản Zalo (trình duyệt) chạy đồng thời`,
`      RETURN jsonb_build_object('status', 'entitlement_denied');
    END IF;
  END IF;
  -- V558: quyền gói Facebook như bộ cũ (entitlementRepository: Facebook dùng được khi tổ chức có gói sản phẩm 3 hoặc 10 còn hạn).
  IF v_is_facebook AND v_org IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.org_organization_product p
                      WHERE p.organization_id = v_org AND p.is_deleted = false AND p.product_id IN (3, 10)
                        AND p.expiration_date IS NOT NULL AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_vn) THEN
    RETURN jsonb_build_object('status', 'entitlement_denied');
  END IF;
  -- V501 (G10): giới hạn số tài khoản Zalo (trình duyệt) chạy đồng thời`, 1, 'claim: quyền gói Facebook')
c = patch(c, `      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;
`, `      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;
  -- V558: giới hạn số tài khoản Facebook chạy đồng thời của nhân viên, đếm như claim bản cũ (v397): chiến dịch "đang chạy" hoặc còn token
  -- của bộ cũ, trên tài khoản Facebook khác của nhân viên. Chỉ khi bắt đầu lượt (chưa giữ lease): lượt đang chạy không bị cắt.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND v_is_facebook AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook';
      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;
`, 1, 'claim: giới hạn Facebook chạy cùng lúc')
c = patch(c, `  -- V501 (G3): mỗi data chỉ thử một lần trong một lượt (như Desktop đi qua danh sách một lần): data vừa về hàng đợi`,
`  -- V558: lượt theo lịch (Q4). Mốc lịch = lịch của chiến dịch lúc nhận (chưa có lịch thì lúc tạo). Mỗi mốc chạy một lượt: mốc đã có lượt
  -- đang mở, đã thử với lease này, hoặc đã đóng mà không phải "về hàng đợi" (chờ xử lý) thì xong; claim trả no_target để nơi chạy kết thúc
  -- lượt (finish_campaign tính lịch kế tiếp như bộ cũ). Mỗi chiến dịch tối đa một lượt theo lịch đang mở (chỉ mục V557).
  IF v_slot_mode THEN
    v_slot := coalesce(c.schedule, c.created_at, v_now);
    IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr
                WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL
                  AND (tr.completed_at IS NULL
                       OR (tr.slot_at = v_slot AND (tr.lease_token = v_token OR tr.final_target_status IS DISTINCT FROM 'chờ xử lý')))) THEN
      RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token, 'nextSchedule', NULL,
        'runningTargets', (SELECT count(*) FROM public.auto_engine_target_runs tr
                            WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL AND tr.completed_at IS NULL),
        'hasTargets', true, 'dueTried', 0, 'dataGroup', false, 'slot', true, 'slotAt', v_slot, 'cooldownPaused', '[]'::jsonb);
    END IF;
  END IF;
  -- V501 (G3): mỗi data chỉ thử một lần trong một lượt (như Desktop đi qua danh sách một lần): data vừa về hàng đợi`, 1, 'claim: lượt theo lịch')
c = patch(c, `  v_cooldown := coalesce(c.extra_settings->'recentDeliveryCooldownEnabled' = 'true'::jsonb, false)`,
`  v_cooldown := NOT v_slot_mode AND coalesce(c.extra_settings->'recentDeliveryCooldownEnabled' = 'true'::jsonb, false)`, 1, 'claim: chống gửi lặp chỉ cho data')
c = patch(c, `  LOOP
    -- V532: sắp theo d.id + 0`, `  LOOP
    EXIT WHEN v_slot_mode;
    -- V532: sắp theo d.id + 0`, 1, 'claim: lượt theo lịch không chọn data')
c = patch(c, `  IF NOT v_found THEN
    RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token,`,
`  IF NOT v_found AND NOT v_slot_mode THEN
    RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token,`, 1, 'claim: no_target chỉ cho data')
c = patch(c, `    INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id, runtime_target, started_at)
    VALUES (t.id, v_campaign_id, v_account_id, v_staff, c.organization_id, v_token, v_runner, v_runtime, v_now)`,
`    INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id, runtime_target, started_at,
      slot_at)
    VALUES (CASE WHEN v_slot_mode THEN NULL ELSE t.id END, v_campaign_id, v_account_id, v_staff, c.organization_id, v_token, v_runner, v_runtime, v_now,
      CASE WHEN v_slot_mode THEN v_slot END)`, 1, 'claim: ghi mốc lịch')
c = patch(c, `    'target', (to_jsonb(t) - 'status') || jsonb_build_object('status', 'đang chạy'),`,
`    'target', CASE WHEN v_slot_mode
                THEN jsonb_build_object('id', NULL, 'campaign_id', c.id, 'name', c.name, 'phone', NULL, 'uid', NULL, 'email', NULL,
                       'status', 'đang chạy', 'slotAt', v_slot)
                ELSE (to_jsonb(t) - 'status') || jsonb_build_object('status', 'đang chạy') END,`, 1, 'claim: data giả của lượt theo lịch')

c = patch(c, `  v_is_facebook boolean;
BEGIN`, `  v_is_facebook boolean;
  -- V558: chỉ nhận đúng các data này (ctx.inputDataIds), trong lượt đang giữ lease.
  v_only_ids bigint[];
BEGIN`, 1, 'claim: khai báo danh sách data')
c = patch(c, `  IF NOT public.aka_agent_engine_scope_ok(v_staff) THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
`, `  IF NOT public.aka_agent_engine_scope_ok(v_staff) THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  -- V558: nhận thêm đúng các data này vào lượt đang chạy (đăng nhóm Facebook kèm chia sẻ sang các nhóm đã chọn trong hộp đăng bài, như bộ
  -- cũ giữ chỗ các nhóm chia sẻ cùng data chính). Chỉ khi đang giữ lease, không cho lượt theo lịch, tối đa 50 id.
  IF p_ctx ? 'inputDataIds' THEN
    IF v_req_token IS NULL OR v_slot_mode OR jsonb_typeof(p_ctx->'inputDataIds') <> 'array'
       OR jsonb_array_length(p_ctx->'inputDataIds') NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_ctx->'inputDataIds') x
                   WHERE jsonb_typeof(x.value) <> 'number' OR x.value::text !~ '^[0-9]{1,18}$') THEN
      RETURN jsonb_build_object('status', 'invalid_request');
    END IF;
    SELECT array_agg(DISTINCT x.value::text::bigint) INTO v_only_ids FROM jsonb_array_elements(p_ctx->'inputDataIds') x;
  END IF;
`, 1, 'claim: kiểm danh sách data')
c = patch(c, `       AND d.id <> ALL (v_cd_skip)
     ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;`, `       AND d.id <> ALL (v_cd_skip)
       AND (v_only_ids IS NULL OR d.id = ANY (v_only_ids))
     ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;`, 1, 'claim: chỉ nhận data trong danh sách')

// ------------------------------------------------------------------------------------------------ action_limit
let l = live.limit
l = patch(l, `  IF p_action_code <> 'zalo_find_phone_user' AND p_action_code LIKE 'zalo\\_%' THEN`,
`  -- V558: trần gói Facebook như bộ cũ (getGroupedDailySendLimit, gộp facebookCore sản phẩm 3 và facebookFanpage sản phẩm 10 cho mọi
  -- thao tác Facebook): gói trả phí không đặt số = không giới hạn; gói demo không đặt số = 30; nhiều gói lấy số lớn nhất.
  IF p_action_code <> 'zalo_find_phone_user' AND (p_action_code LIKE 'zalo\\_%' OR p_action_code LIKE 'fb\\_%') THEN`, 1, 'limit: điều kiện')
l = patch(l, `     WHERE p.organization_id = v_org AND p.is_deleted = false AND p.product_id IN (16, 18)`,
`     WHERE p.organization_id = v_org AND p.is_deleted = false
       AND p.product_id IN (SELECT x FROM unnest(CASE WHEN p_action_code LIKE 'fb\\_%' THEN ARRAY[3, 10] ELSE ARRAY[16, 18] END) x)`, 1, 'limit: sản phẩm')

// ------------------------------------------------------------------------------------------------ resolve_policy
let rp = live.resolve
rp = patch(rp, `'campaign_effect','campaign_hold_minutes','account_effect','login_effect'];`,
`'campaign_effect','campaign_hold_minutes','account_effect','login_effect','streak_after_delivery'];`, 1, 'resolve: cột mới')
// detail_mode = inherit (chính sách Facebook giữ cách tính của bộ cũ, ActionStatusCatalog.resolve + actionResultRuntime.ts:151): trạng
// thái lịch sử là trạng thái kết quả gửi lên; tính lượt / chuỗi data lỗi / data đi đâu theo chính sách của trạng thái đó, trừ trường mà
// dòng theo MÃ khai rõ. Dòng theo nhóm lỗi (error_class) không áp ba trường này và không áp trạng thái. Không chính sách nào khác dùng inherit
// (Zalo, email, mã engine) nên hành vi của chúng không đổi.
rp = patch(rp, `  v_status_id bigint;
  r record;
  v_row jsonb;
BEGIN`, `  v_status_id bigint;
  r record;
  v_row jsonb;
  v_class_part jsonb := '{}'::jsonb;
  v_code_part jsonb := '{}'::jsonb;
  v_inherit boolean := false;
BEGIN`, 1, 'resolve: biến inherit')
rp = patch(rp, `      v_row := to_jsonb(r);
      v_error := v_error || coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(v_row) f
        WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
      v_ids := v_ids || r.id;
      v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
    END LOOP;
  END IF;`, `      v_row := coalesce((SELECT jsonb_object_agg(f.key, f.value) FROM jsonb_each(to_jsonb(r)) f
        WHERE f.key = ANY (c_fields) AND f.value <> 'null'::jsonb), '{}'::jsonb);
      -- V558: tách dòng theo nhóm lỗi (k = 1) và dòng theo mã (k = 2) để giải detail_mode = inherit.
      IF r.k = 1 THEN v_class_part := v_class_part || v_row; ELSE v_code_part := v_code_part || v_row; END IF;
      v_ids := v_ids || r.id;
      v_revs := v_revs || jsonb_build_object(r.id::text, r.revision);
    END LOOP;
    -- V558: inherit = cách tính của bộ cũ Facebook: lượt, chuỗi data lỗi, data đi đâu và trạng thái lịch sử theo chính sách của trạng thái
    -- kết quả, trừ khi dòng theo mã khai rõ; dòng theo nhóm lỗi không áp các trường đó.
    v_inherit := coalesce(v_code_part->>'detail_mode', v_class_part->>'detail_mode') = 'inherit';
    v_error := CASE WHEN v_inherit
      THEN (v_class_part - ARRAY['detail_status_id', 'quota_effect', 'target_streak_effect', 'target_effect']) || v_code_part
      ELSE v_class_part || v_code_part END;
  END IF;`, 1, 'resolve: gộp inherit')
rp = patch(rp, `  v_status_id := coalesce((v_guard->>'detail_status_id')::bigint, (v_error->>'detail_status_id')::bigint, p_status_id,
    (v_defaults->>'detail_status_id')::bigint);`, `  -- V558: inherit thì trạng thái kết quả gửi lên (p_status_id) đứng trước trạng thái của dòng theo mã (chỉ dùng khi không gửi trạng thái).
  v_status_id := CASE WHEN v_inherit
    THEN coalesce((v_guard->>'detail_status_id')::bigint, p_status_id, (v_code_part->>'detail_status_id')::bigint, (v_defaults->>'detail_status_id')::bigint)
    ELSE coalesce((v_guard->>'detail_status_id')::bigint, (v_error->>'detail_status_id')::bigint, p_status_id,
    (v_defaults->>'detail_status_id')::bigint) END;`, 1, 'resolve: trạng thái inherit')
rp = patch(rp, `  RETURN v_defaults || v_status || v_error || v_guard || jsonb_build_object(`, `  -- V558: bộ cũ Facebook không có pha: data hoàn thành khi trạng thái không nói khác (inputEffect 'none').
  IF v_inherit THEN v_defaults := v_defaults || jsonb_build_object('target_effect', 'complete'); END IF;
  RETURN v_defaults || v_status || v_error || v_guard || jsonb_build_object(`, 1, 'resolve: mặc định inherit')

// ------------------------------------------------------------------------------------------------ report_v1
const INHERIT = (indent, resolveCall) => `${indent}-- V558: chính sách "trạng thái theo kết quả" (detail_mode = inherit; chính sách Facebook giữ cách ghi của bộ cũ, ghi theo
${indent}-- actionResult.statusCode): dòng lịch sử lấy trạng thái kết quả gửi lên (statusCode), các trường còn NULL theo chính sách của trạng thái
${indent}-- đó. Không gửi statusCode thì dùng trạng thái của chính sách, không có thì "thất bại".
${indent}IF NOT v_ok AND v_policy->>'detail_mode' = 'inherit' THEN
${indent}  v_policy := ${resolveCall(`coalesce((SELECT s.id FROM public.auto_status s WHERE s.code = nullif(o->>'statusCode', '')
${indent}      AND s.component_type = 'campaign_detail' ORDER BY s.id LIMIT 1), (v_policy->>'detail_status_id')::bigint,
${indent}      (SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_failed' AND s.component_type = 'campaign_detail' ORDER BY s.id LIMIT 1))`)};
${indent}  IF v_policy->>'detail_mode' = 'inherit' THEN v_policy := v_policy || jsonb_build_object('detail_mode', 'write'); END IF;
${indent}END IF;
`
let r = live.report
r = patch(r, `      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
  END LOOP;`, `      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
    -- V558: kết quả lỗi kèm trạng thái (chính sách inherit ghi theo trạng thái block trả) phải là trạng thái lịch sử có thật.
    IF NOT coalesce((o->>'ok')::boolean, false) AND nullif(o->>'statusCode', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.auto_status s
         WHERE s.code = o->>'statusCode' AND s.component_type = 'campaign_detail' AND s.is_active AND NOT s.is_delete) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
  END LOOP;`, 1, 'report: kiểm trạng thái kết quả lỗi')
r = patch(r, `      v_policy := public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, c.action_id, r.runtime_target, v_phase);
      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);
`, `      v_policy := public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, c.action_id, r.runtime_target, v_phase);
${INHERIT('      ', s => `public.aka_agent_engine_resolve_policy(v_error_code, ${s}, v_action, c.action_id, r.runtime_target, v_phase)`)}      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);
`, 1, 'report: inherit')
r = patch(r, `          || CASE WHEN v_scope = 'target_only' THEN jsonb_build_object('target_streak_effect', 'ignore') ELSE '{}'::jsonb END;
      END IF;
`, `          || CASE WHEN v_scope = 'target_only' THEN jsonb_build_object('target_streak_effect', 'ignore') ELSE '{}'::jsonb END;
      END IF;

      -- V558: lỗi khi data đã có kết quả gửi thành công trong lượt này (đăng bài xong rồi comment lỗi): chính sách khai
      -- streak_after_delivery = ignore thì không cộng chuỗi data lỗi, hiệu ứng chiến dịch có ngưỡng không áp (targetOnlyFailure của bộ cũ
      -- cho comment Facebook, actionResultRuntime.ts:160-161). Hiệu ứng không ngưỡng, khoá thao tác, data đi đâu vẫn theo chính sách.
      IF NOT v_ok AND v_policy->>'streak_after_delivery' = 'ignore'
         AND (EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = r.id AND eo.delivery_state IN ('delivered', 'partial'))
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_call_new) x WHERE x.value->>'delivery' IN ('delivered', 'partial'))) THEN
        v_policy := v_policy || jsonb_build_object('target_streak_effect', 'ignore',
          'campaign_effect', CASE WHEN (v_policy->>'streak_threshold') IS NOT NULL THEN 'none' ELSE v_policy->>'campaign_effect' END);
      END IF;
`, 1, 'report: streak_after_delivery')
// Dòng lịch sử Facebook: link bài / comment ở cột post_url như bộ cũ (createCampaignDetail ghi postUrl), giao diện và Up tin đọc cột này.
// Vết thao tác của block lỗi (signal.trace, tới 64 KB, Q15) chỉ giữ ở auto_engine_outcomes (dọn sau 30 ngày), không chép vào lịch sử khách xem.
r = patch(r, `          INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, status_id, sub_status_id,
            error_code, counts_toward_limit, report_group, log, data, policy_snapshot, result_key, created_at)
          VALUES (r.input_data_id, r.campaign_id, r.account_id, v_action_name, v_action, coalesce(v_sem.status_value, 'thất bại'),
            (v_policy->>'detail_status_id')::bigint, (v_policy->>'sub_status_id')::bigint, v_error_code, v_count, v_sem.report_group, v_log,
            jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal, 'evidence', v_evidence)`,
`          INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, status_id, sub_status_id,
            error_code, counts_toward_limit, report_group, log, data, policy_snapshot, result_key, created_at, post_url)
          VALUES (r.input_data_id, r.campaign_id, r.account_id, v_action_name, v_action, coalesce(v_sem.status_value, 'thất bại'),
            (v_policy->>'detail_status_id')::bigint, (v_policy->>'sub_status_id')::bigint, v_error_code, v_count, v_sem.report_group, v_log,
            jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal - 'trace', 'evidence', v_evidence)`,
1, 'report: post_url + trace')
r = patch(r, `            v_rk, v_now)
          RETURNING id INTO v_detail_id;`, `            v_rk, v_now, nullif(o->'data'->>'postUrl', ''))
          RETURNING id INTO v_detail_id;`, 1, 'report: post_url value')

r = patch(r, `    IF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = o->>'actionCode') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
    END IF;`, `    -- V558: kết quả không gắn thao tác (dòng "Tìm data" của tìm data Facebook: bộ cũ ghi không mã thao tác, không tính lượt) phải có tên
    -- ghi lịch sử và chỉ cho chiến dịch Facebook. Engine Zalo không gửi loại này.
    IF nullif(btrim(coalesce(o->>'actionCode', '')), '') IS NULL THEN
      IF nullif(btrim(coalesce(o->>'actionName', '')), '') IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.auto_campaigns xc JOIN public.auto_campaign_actions xa ON xa.id = xc.action_id
            WHERE xc.id = r.campaign_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = o->>'actionCode') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
    END IF;`, 1, 'report: kết quả không gắn thao tác (kiểm)')
r = patch(r, `      v_action := o->>'actionCode';
      SELECT aa.flatform_type, coalesce(aa.operation_class, 'delivery'), aa.name INTO v_platform, v_op_class, v_action_name
        FROM public.auto_account_actions aa WHERE aa.code = v_action;
      -- Tên thao tác ghi vào lịch sử: như helper Desktop ("Tìm SĐT"…) khi bộ chạy gửi kèm, không thì tên trong danh mục.
      v_action_name := coalesce(nullif(left(btrim(coalesce(o->>'actionName', '')), 120), ''), v_action_name);`,
`      v_action := nullif(btrim(coalesce(o->>'actionCode', '')), '');
      SELECT aa.flatform_type, coalesce(aa.operation_class, 'delivery'), aa.name INTO v_platform, v_op_class, v_action_name
        FROM public.auto_account_actions aa WHERE aa.code = v_action;
      -- Tên thao tác ghi vào lịch sử: như helper Desktop ("Tìm SĐT"…) khi bộ chạy gửi kèm, không thì tên trong danh mục.
      v_action_name := coalesce(nullif(left(btrim(coalesce(o->>'actionName', '')), 120), ''), v_action_name);
      -- V558: kết quả không gắn thao tác: luật phân loại theo nền tảng của loại chiến dịch; không phải thao tác gửi.
      IF v_action IS NULL THEN
        SELECT lower(btrim(xa.flatform_type)) INTO v_platform FROM public.auto_campaign_actions xa WHERE xa.id = c.action_id;
        v_op_class := 'result';
      END IF;`, 1, 'report: kết quả không gắn thao tác (nền tảng)')
r = patch(r, `      v_count := CASE v_policy->>'quota_effect' WHEN 'count' THEN true WHEN 'no_count' THEN false
                 ELSE v_delivery IN ('delivered', 'partial', 'unknown') END
                 OR v_delivery = 'partial';`, `      v_count := CASE v_policy->>'quota_effect' WHEN 'count' THEN true WHEN 'no_count' THEN false
                 ELSE v_delivery IN ('delivered', 'partial', 'unknown') END
                 OR v_delivery = 'partial';
      -- V558: kết quả không gắn thao tác không tính lượt (như bộ cũ ghi dòng "Tìm data").
      IF v_action IS NULL THEN v_count := false; END IF;`, 1, 'report: kết quả không gắn thao tác (không tính lượt)')

r = patch(r, `        VALUES (v_rk, r.id, r.input_data_id, r.campaign_id, r.account_id, v_action, v_phase, v_ok, v_error_code,`,
`        -- V558: kết quả không gắn thao tác ghi chuỗi rỗng ở bảng nội bộ này (cột bắt buộc); dòng lịch sử để trống mã thao tác như bộ cũ.
        VALUES (v_rk, r.id, r.input_data_id, r.campaign_id, r.account_id, coalesce(v_action, ''), v_phase, v_ok, v_error_code,`, 1,
  'report: kết quả không gắn thao tác (bảng kết quả)')

// Anh duyệt câu cho khách 17/11 (Q23 / R13): dừng theo chuỗi data lỗi thì ghi chú chiến dịch nối câu bước tiếp theo (customer_help) của mã
// Facebook sau câu lỗi; mã khác (Zalo, SYS…) giữ nguyên câu cũ.
r = patch(r, `      v_camp_note := 'Dừng sau ' || v_streak_count || ' data lỗi/thất bại liên tiếp (ngưỡng ' || v_thr_threshold || '): '
        || coalesce(v_note, 'Lỗi không xác định');`, `      v_camp_note := 'Dừng sau ' || v_streak_count || ' data lỗi/thất bại liên tiếp (ngưỡng ' || v_thr_threshold || '): '
        || coalesce(v_note, 'Lỗi không xác định')
        -- V558: câu bước tiếp theo của mã Facebook (anh duyệt 17/11, Q23) nối sau câu dừng; mã khác (Zalo, SYS) giữ nguyên câu cũ.
        || coalesce('. ' || nullif(btrim((SELECT e.customer_help FROM public.auto_error e
                                          WHERE e.error_code = v_last_error_code AND e.public_code LIKE 'FB%')), ''), '');`, 1,
  'report: câu bước tiếp theo khi dừng theo chuỗi (FB)')

// Q11 (anh chốt 16/11; 17/11 chỉ SYS99): câu trả lời cho biết mã lỗi cuối của data vừa chốt, để host Facebook nhận ra chiến dịch dừng theo
// chuỗi lỗi chưa phân loại (SYS99) và cho AI đọc ảnh viết câu lý do như bộ cũ. Trường thêm, lõi / Fly bỏ qua.
r = patch(r, `    'streak', CASE WHEN v_target_done THEN jsonb_build_object('effect', v_streak, 'count', v_streak_count, 'threshold', v_thr_threshold, 'source', v_thr_source) END,`,
`    'streak', CASE WHEN v_target_done THEN jsonb_build_object('effect', v_streak, 'count', v_streak_count, 'threshold', v_thr_threshold, 'source', v_thr_source,
      'lastErrorCode', v_last_error_code) END,`, 1, 'report: mã lỗi cuối trong câu trả lời (Q11)')

// ------------------------------------------------------------------------------------------------ simulate_v1
let s = live.simulate
s = patch(s, `  v_error_code text;
BEGIN`, `  v_error_code text;
  v_policy jsonb;
BEGIN`, 1, 'simulate: khai báo')
s = patch(s, `  RETURN jsonb_build_object('ok', true, 'errorCode', v_error_code, 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
    'isCatchAll', v_catch_all,
    'publicCode', (SELECT e.public_code FROM public.auto_error e WHERE e.error_code = v_error_code),
    'policy', public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, p_campaign_action_id, p_runtime_target, v_phase));`,
`  v_policy := public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, p_campaign_action_id, p_runtime_target, v_phase);
  -- V558: cùng cách giải detail_mode = inherit như report_v1.
  IF NOT coalesce((p_outcome->>'ok')::boolean, false) AND v_policy->>'detail_mode' = 'inherit' THEN
    v_policy := public.aka_agent_engine_resolve_policy(v_error_code,
      coalesce((SELECT s.id FROM public.auto_status s WHERE s.code = nullif(p_outcome->>'statusCode', '') AND s.component_type = 'campaign_detail'
                 ORDER BY s.id LIMIT 1), (v_policy->>'detail_status_id')::bigint,
               (SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_failed' AND s.component_type = 'campaign_detail' ORDER BY s.id LIMIT 1)),
      v_action, p_campaign_action_id, p_runtime_target, v_phase);
    IF v_policy->>'detail_mode' = 'inherit' THEN v_policy := v_policy || jsonb_build_object('detail_mode', 'write'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'errorCode', v_error_code, 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
    'isCatchAll', v_catch_all,
    'publicCode', (SELECT e.public_code FROM public.auto_error e WHERE e.error_code = v_error_code),
    'policy', v_policy);`, 1, 'simulate: inherit')

// ------------------------------------------------------------------------------------------------ finish_campaign_v2
// Đặc tả bộ cũ (campaignScheduler.ts handleCampaignCompletion 2373-2420, handleMultiDailyTimeSlotAfterCompletion 2476-2532,
// rescheduleCompletedCampaignPass 2539-2655, handleRerunAfterCompletion 2711-2786; đọc 16/11/2026).
let f = live.finish
f = patch(f, `  v_rt_slot time;
BEGIN`, `  v_rt_slot time;
  -- V558: chạy lại sau N giờ (giờ, số nguyên ≥ 1).
  v_hours numeric;
BEGIN`, 1, 'finish: khai báo')
f = patch(f, `  IF c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb THEN`,
`  -- V558: như MULTI_DAILY_TIME_SLOT_ACTION_IDS của bộ cũ (campaignScheduler.ts:666), gồm cả trang cá nhân và Page Facebook.
  IF c.action_id IN ('zalo_message_friend', 'zalo_message_group', 'facebook_timeline_post', 'facebook_page_post')
     AND v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb THEN`, 1, 'finish: nhiều khung giờ Facebook')
f = patch(f, `  IF v_mode IS NULL THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed', NULL);
  END IF;`, `  -- V558: chạy lại sau N giờ khi xong (handleRerunAfterCompletion, campaignScheduler.ts:2711-2786): tìm data trong group / bằng search,
  -- comment seeding, newsfeed; findDataRerunEnabled đúng true, findDataRerunAfterHours lấy phần nguyên, dưới 1 hoặc sai thì tắt (hoàn thành
  -- như thường). Lịch kế = bây giờ + N giờ; khác ngày nhận lượt hoặc khác hôm nay → hoàn thành; từ giờ dừng trong ngày → hoàn thành. Trừ
  -- newsfeed (không có data): mọi data chưa xoá, khác "tạm dừng" về "chờ xử lý" (ghi chú rỗng, date_action NULL); không còn data nào như
  -- vậy → hoàn thành. Không qua bước "còn data đến hạn" và không đòi có data (khác nhánh 6).
  IF v_mode IS NULL AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction')
     AND v_extra->'findDataRerunEnabled' = 'true'::jsonb THEN
    v_raw := v_extra->'findDataRerunAfterHours';
    v_hours := CASE
      WHEN jsonb_typeof(v_raw) = 'number' THEN floor((v_raw #>> '{}')::numeric)
      WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^[0-9]{1,6}(\\.[0-9]+)?$' THEN floor(btrim(v_raw #>> '{}')::numeric) END;
    IF v_hours >= 1 AND v_hours <= 1000000 THEN
      v_next := v_now + make_interval(hours => v_hours::integer);
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         OR (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> v_vn THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_next_day', NULL);
      END IF;
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_after_cutoff', jsonb_build_object('hours', v_hours));
      END IF;
      IF c.action_id <> 'facebook_newsfeed_interaction' THEN
        SELECT count(*) INTO v_resettable FROM public.auto_campaign_input_data d
         WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng';
        IF v_resettable = 0 THEN
          RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_no_data', NULL);
        END IF;
        UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
         WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
      END IF;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'rerun_scheduled', 'schedule', v_next, 'hours', v_hours, 'campaignStatus', 'chờ xử lý');
    END IF;
  END IF;

  IF v_mode IS NULL THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed', NULL);
  END IF;`, 1, 'finish: chạy lại sau N giờ')
f = patch(f, `  IF v_resettable = 0 THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_data', jsonb_build_object('suffix', v_suffix));
  END IF;`, `  IF v_resettable = 0 THEN
    -- V558: như rescheduleCompletedCampaignPass của bộ cũ: Page không có dòng data nào thì hoàn thành ("không có page…"); chiến dịch Facebook
    -- khác không có dòng data nào (trang cá nhân) thì hẹn khung kế mà không đặt lại gì. Có data mà không đặt lại được thì hoàn thành như Zalo.
    IF c.action_id = 'facebook_page_post' AND v_total = 0 THEN
      RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_page', jsonb_build_object('suffix', v_suffix));
    END IF;
    IF c.action_id LIKE 'facebook\\_%' AND v_total = 0 THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
        || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END;
    END IF;
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_data', jsonb_build_object('suffix', v_suffix));
  END IF;`, 1, 'finish: khung kế cho chiến dịch Facebook không có data')

const NEW_TEXT = { claim: c, limit: l, resolve: rp, report: r, simulate: s, finish: f }
const LIVE_MD5 = Object.fromEntries(Object.keys(FUNCS).map(k => [k, md5(live[k])]))
const NEW_MD5 = Object.fromEntries(Object.keys(FUNCS).map(k => [k, md5(NEW_TEXT[k])]))

const check = (label, key, expect, done, msgDone, msgDrift) => `  v_oid := to_regprocedure('${FUNCS[key].sig}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${FUNCS[key].sig}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${done}' THEN RAISE EXCEPTION '${msgDone} (${key})'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${msgDrift} (${key}: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v558_acl_${key}', v_acl, true);`
const preflight = (label, expect, done, msgDone, msgDrift, ledger, extra) => `DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v558_%') THEN
      RAISE EXCEPTION 'V558 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}${extra}${Object.keys(FUNCS).map(k => check(label, k, expect[k], done[k], msgDone, msgDrift)).join('\n')}
END $pre$;`
const postflight = (label, expect) => `DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${Object.keys(FUNCS).map(k => `  v_oid := '${FUNCS[k].sig}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expect[k]}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa ${k} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v558_acl_${k}', true) THEN RAISE EXCEPTION '${label} postflight: quyền / chủ sở hữu ${k} bị đổi'; END IF;`).join('\n')}
END $post$;`
const REQUIRES = `  -- Cần V556 (hàm bật Facebook, cột streak_after_delivery) và V557 (slot_at) trước.
  IF to_regprocedure('public.aka_agent_engine_facebook_org_enabled(bigint)') IS NULL THEN RAISE EXCEPTION 'V558: chưa chạy V556 phần 1'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass AND attname = 'streak_after_delivery' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V558: chưa chạy V556 phần 2';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_engine_target_runs'::regclass AND attname = 'slot_at' AND NOT attisdropped)
     OR to_regclass('public.auto_engine_target_runs_slot_open_v557') IS NULL THEN
    RAISE EXCEPTION 'V558: chưa chạy V557 (slot_at, chỉ mục lượt theo lịch)';
  END IF;
`
const body = texts => Object.keys(FUNCS).map(k => `${texts[k]};`).join('\n\n')

const migration = `-- V558: engine v2 nhận chiến dịch Facebook (đợt 0). SINH TỪ scripts/build-v558-sql.cjs, không sửa tay.
-- Thay thân 6 hàm engine (giữ chữ ký, chủ sở hữu, quyền): claim_target_v1 (Facebook theo engine.facebook, quyền gói 3/10, giới hạn chạy
-- cùng lúc, lượt theo lịch), action_limit (trần gói Facebook), resolve_policy (cột streak_after_delivery), report_v1 (detail_mode inherit,
-- streak_after_delivery, kiểm trạng thái kết quả lỗi), simulate_v1 (inherit), finish_campaign_v2 (chạy lại sau N giờ, khung giờ Facebook).
-- Nguồn = pg_get_functiondef production 16/11/2026: ${Object.entries(LIVE_MD5).map(([k, v]) => `${k} ${v}`).join(', ')}.
-- Không đổi hành vi engine Zalo: nhánh mới chỉ chạy với tài khoản Facebook, ctx.mode = campaign_slot, hoặc chính sách FB mới.
-- Cần V556 (phần 1, 2) và V557 trước. DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('V558', LIVE_MD5, NEW_MD5, 'V558 đã chạy', 'V558: định nghĩa khác bản production 16/11, dừng để đối chiếu bản live', true, REQUIRES)}

${body(NEW_TEXT)}

${postflight('V558', NEW_MD5)}

COMMIT;
`
const rollback = `-- Gỡ V558: trả 6 hàm engine về bản production 16/11/2026 (trước V558). SINH TỪ scripts/build-v558-sql.cjs.
-- Lượt theo lịch / chính sách inherit đã ghi vẫn còn trong bảng; gỡ V559 (chính sách FB) trước nếu muốn bỏ hẳn.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('Gỡ V558', NEW_MD5, LIVE_MD5, 'Gỡ V558: hàm đã là bản trước V558', 'Gỡ V558: định nghĩa không phải bản V558', false, '')}

-- Hàm trước V558 không hiểu detail_mode = inherit / streak_after_delivery: còn chính sách dùng hai thứ này (V559) thì gỡ V559 trước.
DO $inherit$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE is_active AND NOT is_delete
               AND (detail_mode = 'inherit' OR streak_after_delivery IS NOT NULL)) THEN
    RAISE EXCEPTION 'Gỡ V558: còn chính sách dùng detail_mode inherit / streak_after_delivery, gỡ V559 (rollback_v559_engine_facebook_policies.sql) trước';
  END IF;
END $inherit$;

${body(live)}

${postflight('Gỡ V558', LIVE_MD5)}

COMMIT;
`

module.exports = { migration, rollback, LIVE_MD5, NEW_MD5, FUNCS, NAME, ROLLBACK_NAME, texts: { live, new: NEW_TEXT } }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log('V558 migration', md5(migration), 'rollback', md5(rollback))
  console.log('thân mới', JSON.stringify(NEW_MD5))
}
