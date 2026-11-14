// Sinh migration V532: hai lỗi engine v2 tìm ra khi kiểm sức khoẻ 14/11/2026 13:35 VN (anh chốt "Sửa cả hai").
//
//   1. report_v1 (thân V517): hiệu ứng chiến dịch có ngưỡng (N data lỗi liền) không còn áp ngay khi kết quả không cộng chuỗi lỗi.
//      Bước phụ gắn tag / đổi tên Zalo không bao giờ đổi chuỗi (dòng chính sách theo thao tác, target_streak_effect = ignore), nên trước
//      V532 một lỗi NET01 / NET03 / lỗi code ở bước đó tạm dừng chiến dịch ngay, bỏ qua ngưỡng 4 lần anh đã duyệt (14/11: chiến dịch
//      49746, 50194 trên Fly, 55619 trên Desktop). Hiệu ứng không có ngưỡng (Z223, thiếu media, cấu hình sai…) vẫn áp ngay như cũ;
//      khoá thao tác, dừng lượt (end_unit), data đi đâu của mã vẫn giữ. Đúng nguyên tắc V501 đã ghi cho giao một phần.
//      Dò mọi cặp (mã có ngưỡng, thao tác Zalo) qua aka_agent_engine_resolve_policy trên production 14/11: chỉ hai thao tác phụ
//      zalo_tag_contact / zalo_change_alias × 7 mã đổi hành vi (err_network_offline, err_engine_runtime_unavailable, err_undefined,
//      err_engine_zalo_cancel_friend_day_limit, err_engine_zalo_join_group_day_limit, err_email_send_failed, err_email_missing_recipient).
//   2. claim_target_v1 (thân V527): câu chọn data sắp theo d.id + 0 (cùng thứ tự) để planner không đi khoá chính. Kế hoạch theo tham
//      số có lúc quét auto_campaign_input_data_pkey từ id nhỏ nhất rồi lọc theo chiến dịch: chiến dịch 34061 lọc 12,26 triệu dòng, 6,8 giây,
//      quá trần 3 giây của Desktop (256/10.057 lượt claim Desktop lỗi 500 trong 08:00–13:45 VN 14/11). Đo chỉ đọc 14/11 với câu mới:
//      34061 40 ms, chiến dịch nhiều data chờ nhất (14.966) 28–48 ms, theo kế hoạch riêng lẫn kế hoạch chung.
//
// Thân nguồn = bản đang chạy production, đọc chỉ đọc 14/11/2026 (akachat cgjbsmqtfhqvttudyjzq):
//   report_v1 md5(prosrc) 21afaaf3… (= V517), md5(pg_get_functiondef) 12b0bc8e…;
//   claim_target_v1 md5(prosrc) f8935a5a… (= V527), md5(pg_get_functiondef) 43e14ce4…;
//   cả hai: chủ postgres, SECURITY DEFINER, VOLATILE, search_path = '', EXECUTE postgres / service_role / aka_agent_chat_api /
//   aka_agent_desktop. Không hàm engine nào khác chép hai đoạn này (dò pg_proc 14/11).
// Chạy: node scripts/build-v532-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v517 = require('./build-v517-sql.cjs')
const v527 = require('./build-v527-sql.cjs')

const NAME = 'migration_v532_engine_aux_step_pause_claim_order'
const ROLLBACK_NAME = 'rollback_v532_engine_aux_step_pause_claim_order'
const SIG = {
  report: 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)',
  claim: 'public.aka_agent_engine_claim_target_v1(jsonb)'
}

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]
function extract(text, name, keyword, source) {
  const m = new RegExp(`${keyword} public\\.${name}\\([\\s\\S]*?AS \\$f\\$([\\s\\S]*?)\\$f\\$;`).exec(text)
  if (!m) throw new Error(`Không thấy ${name} trong ${source}`)
  return { block: m[0], body: m[1] }
}
// pg_get_functiondef của hai hàm trên PostgreSQL 17 (đã đối chiếu từng byte với production 14/11/2026).
const DEF = {
  report: body => `CREATE OR REPLACE FUNCTION public.aka_agent_engine_report_v1(p_target_run_id bigint, p_lease_token uuid, p_outcomes jsonb, p_final boolean DEFAULT false, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$${body}$function$
`,
  claim: body => `CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$${body}$function$
`
}

const old = {
  report: extract(v517.migration, 'aka_agent_engine_report_v1', 'CREATE OR REPLACE FUNCTION', 'V517'),
  claim: { block: v527.blocks.new, body: bodyOf(v527.blocks.new) }
}
const LIVE = {
  report: md5(old.report.body), reportDef: md5(DEF.report(old.report.body)),
  claim: md5(old.claim.body), claimDef: md5(DEF.claim(old.claim.body))
}
if (LIVE.report !== v517.NEW.report || LIVE.report !== '21afaaf3b1300cea2bf282e3cb9650c3') {
  throw new Error(`Thân report_v1 của V517 không còn khớp bản đang chạy production (21afaaf3…): ${LIVE.report}`)
}
if (LIVE.reportDef !== '12b0bc8ee9c3b578d10fe134c6d1b31f') {
  throw new Error(`Định nghĩa report_v1 dựng lại không khớp pg_get_functiondef production (12b0bc8e…): ${LIVE.reportDef}`)
}
if (LIVE.claim !== v527.NEW.claim || LIVE.claim !== 'f8935a5a986f5ac4bcc1bde34284bbd6') {
  throw new Error(`Thân claim_target_v1 của V527 không còn khớp bản đang chạy production (f8935a5a…): ${LIVE.claim}`)
}
if (LIVE.claimDef !== v527.NEW.def || LIVE.claimDef !== '43e14ce4f69832d374d19d7ea5a0b1d5') {
  throw new Error(`Định nghĩa claim_target_v1 dựng lại không khớp pg_get_functiondef production (43e14ce4…): ${LIVE.claimDef}`)
}

// ------------------------------------------------------------------------------------------------ report_v1
let r = old.report.block
r = patch(r, `    -- Hiệu ứng chiến dịch áp ngay khi mã không có ngưỡng hoặc kết quả không tăng chuỗi
    -- (applyRuntimeErrorPolicy hiện nay); có ngưỡng và tăng chuỗi thì xét ở cuối data.
    IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
       AND ((v_contrib->>'streakThreshold') IS NULL OR v_contrib->>'streak' IS DISTINCT FROM 'increment')
       AND (v_camp_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_camp_effect = 'hold')) THEN`,
`    -- Hiệu ứng chiến dịch áp ngay khi mã không có ngưỡng (applyRuntimeErrorPolicy hiện nay). Có ngưỡng (N data lỗi liền) thì chỉ
    -- xét ở cuối data, khi kết quả tăng chuỗi. V532: kết quả có ngưỡng mà không tăng chuỗi (bước phụ gắn tag / đổi tên Zalo không
    -- bao giờ đổi chuỗi lỗi) không còn tạm dừng chiến dịch ngay, như nguyên tắc V501 cho giao một phần; khoá thao tác, dừng lượt và
    -- data đi đâu của mã vẫn giữ.
    IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
       AND (v_contrib->>'streakThreshold') IS NULL
       AND (v_camp_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_camp_effect = 'hold')) THEN`,
  1, 'report: hiệu ứng chiến dịch áp ngay')
r = patch(r, `        CASE WHEN coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
              AND ((v_contrib->>'streakThreshold') IS NULL OR v_contrib->>'streak' IS DISTINCT FROM 'increment') THEN 4 ELSE 0 END,`,
`        -- V532: cùng điều kiện với hiệu ứng áp ngay ở trên (hiệu ứng có ngưỡng chỉ dừng lượt qua nhánh ngưỡng).
        CASE WHEN coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
              AND (v_contrib->>'streakThreshold') IS NULL THEN 4 ELSE 0 END,`,
  1, 'report: hạng dừng lượt')

// ------------------------------------------------------------------------------------------------ claim_target_v1
let c = old.claim.block
c = patch(c, `  LOOP
    SELECT d.* INTO t FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false`,
`  LOOP
    -- V532: sắp theo d.id + 0 (cùng thứ tự) để planner không đi khoá chính auto_campaign_input_data_pkey. Kế hoạch theo tham số có lúc
    -- quét khoá chính từ id nhỏ nhất rồi lọc theo chiến dịch (chiến dịch 34061 ngày 14/11/2026: lọc 12,26 triệu dòng, 6,8 giây, quá
    -- trần 3 giây của Desktop). Sắp theo biểu thức buộc lấy data của chiến dịch qua chỉ mục theo chiến dịch rồi mới sắp (vài chục ms).
    SELECT d.* INTO t FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false`,
  1, 'claim: chú thích câu chọn data')
c = patch(c, `     ORDER BY d.id LIMIT 1 FOR UPDATE SKIP LOCKED;`, `     ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;`, 1, 'claim: sắp theo d.id + 0')

const NEW = {
  report: md5(bodyOf(r)), reportDef: md5(DEF.report(bodyOf(r))),
  claim: md5(bodyOf(c)), claimDef: md5(DEF.claim(bodyOf(c)))
}
const ATTRS = `pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef OR p.provolatile IS DISTINCT FROM 'v'
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]`

// Kiểm một hàm trước khi thay: thân / định nghĩa đúng bản nguồn, thuộc tính như đã đọc; lưu quyền để hậu kiểm so lại.
const preCheck = (label, key, name, expect, expectDef, done, msg) => `  v_oid := to_regprocedure('${SIG[key]}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${SIG[key]}'; END IF;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  v_md5 := md5(p.prosrc);
  IF v_md5 = '${done}' THEN RAISE EXCEPTION '${msg.done.replace('{fn}', name)}'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${msg.drift.replace('{fn}', name)} (%)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 IS DISTINCT FROM '${expectDef}' THEN RAISE EXCEPTION '${label}: định nghĩa ${name} khác bản nguồn (%)', v_md5; END IF;
  IF ${ATTRS} THEN
    RAISE EXCEPTION '${label}: chủ sở hữu / thuộc tính ${name} khác bản đã đọc';
  END IF;
  PERFORM set_config('aka.v532_acl_${key}', coalesce(p.proacl::text, ''), true);`

const preflight = (label, expect, done, msg, ledger) => `DO $pre$
DECLARE v_oid oid; p pg_catalog.pg_proc%ROWTYPE; v_md5 text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v532_%') THEN
      RAISE EXCEPTION 'V532 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}${preCheck(label, 'report', 'report_v1', expect.report, expect.reportDef, done.report, msg)}
${preCheck(label, 'claim', 'claim_target_v1', expect.claim, expect.claimDef, done.claim, msg)}
  -- Hậu kiểm so lại đúng quyền đã lưu (CREATE OR REPLACE giữ chủ sở hữu và quyền).
END $pre$;`

const postCheck = (label, key, name, expect, expectDef) => `  v_oid := '${SIG[key]}'::regprocedure;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF md5(p.prosrc) IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${label} postflight: thân ${name} %', md5(p.prosrc); END IF;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expectDef}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa ${name} %', md5(pg_get_functiondef(v_oid));
  END IF;
  IF ${ATTRS}
       OR coalesce(p.proacl::text, '') IS DISTINCT FROM current_setting('aka.v532_acl_${key}', true) THEN
    RAISE EXCEPTION '${label} postflight: chủ sở hữu / quyền / thuộc tính ${name} bị đổi';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '${label} postflight: quyền ${name} quá rộng';
  END IF;
  IF NOT (has_function_privilege('service_role', v_oid, 'EXECUTE') AND has_function_privilege('aka_agent_chat_api', v_oid, 'EXECUTE')
          AND has_function_privilege('aka_agent_desktop', v_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '${label} postflight: thiếu quyền EXECUTE ${name} của bên gọi';
  END IF;`

const postflight = (label, expect) => `DO $post$
DECLARE v_oid oid; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
${postCheck(label, 'report', 'report_v1', expect.report, expect.reportDef)}
${postCheck(label, 'claim', 'claim_target_v1', expect.claim, expect.claimDef)}
END $post$;`

const migration = `-- V532: hai lỗi engine v2 tìm ra khi kiểm sức khoẻ 14/11/2026.
-- SINH TỪ scripts/build-v532-sql.cjs, không sửa tay.
--
-- 1. report_v1: hiệu ứng chiến dịch có ngưỡng (N data lỗi liền) chỉ áp khi kết quả cộng chuỗi lỗi và đủ ngưỡng. Trước V532 kết quả
--    không cộng chuỗi (bước phụ gắn tag / đổi tên Zalo) áp ngay, nên một lỗi NET01 ở bước đó tạm dừng chiến dịch (14/11: 49746, 50194,
--    55619). Hiệu ứng không có ngưỡng vẫn áp ngay; khoá thao tác, dừng lượt, data đi đâu không đổi.
-- 2. claim_target_v1: câu chọn data sắp theo d.id + 0 để planner không quét khoá chính auto_campaign_input_data_pkey (chiến dịch 34061:
--    6,8 giây, quá trần 3 giây của Desktop; câu mới 40 ms).
-- Chỉ thay thân hai hàm (report_v1 thân V517 md5 ${LIVE.report}, claim_target_v1 thân V527 md5 ${LIVE.claim}); CREATE OR REPLACE giữ
-- chủ sở hữu, quyền, SECURITY DEFINER, search_path. Không đổi bảng, dữ liệu, chính sách, thiết lập. Chỉ engine v2 (Desktop bản mới,
-- worker Fly) gọi hai hàm này; bộ chạy cũ không đổi. Chiến dịch đã bị tạm dừng trước V532 giữ nguyên trạng thái.
-- Lệnh DDL làm PostgREST nạp lại schema (trigger DDL chung): apply ngoài giờ cao điểm.
-- Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('V532', LIVE, NEW, {
  done: 'V532 đã chạy: thân {fn} đã là bản V532',
  drift: 'V532: thân {fn} khác bản đang chạy production 14/11, dừng để đối chiếu bản live'
}, true)}

${r}

${c}

${postflight('V532', NEW)}

COMMIT;
`

const rollback = `-- Gỡ V532: trả aka_agent_engine_report_v1 về thân V517 (md5 prosrc ${LIVE.report}) và aka_agent_engine_claim_target_v1 về thân
-- V527 (md5 prosrc ${LIVE.claim}): lỗi ở bước phụ có ngưỡng lại tạm dừng chiến dịch ngay; câu chọn data lại sắp theo d.id.
-- SINH TỪ scripts/build-v532-sql.cjs. Lệnh DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('Gỡ V532', NEW, LIVE, {
  done: 'Gỡ V532: thân {fn} đã là bản trước V532 (chưa apply V532 hoặc đã gỡ)',
  drift: 'Gỡ V532: thân {fn} không phải bản V532'
}, false)}

${old.report.block}

${old.claim.block}

${postflight('Gỡ V532', LIVE)}

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SIG, NAME, ROLLBACK_NAME, DEF,
  blocks: { report: { old: old.report.block, new: r }, claim: { old: old.claim.block, new: c } } }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log('V532 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
