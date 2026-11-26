#!/usr/bin/env node
// V667: engine v2 cho tài khoản Zalo Server chạy trên VPS (App Server). Anh duyệt phương án 26/11/2026 ("Code luôn", 4 điểm chốt qua
// hộp chọn): docs/ENGINE_V2_VPS_ZALO_SERVER_PLAN.md.
//
// Thêm nơi chạy thứ ba 'server' cạnh 'desktop' / 'fly'. Tổ chức bật bằng công tắc riêng engine.zalo_server_vps (không dùng cờ
// use_new_zalo_runtime, cờ đó chuyển tổ chức sang Fly). Ba phần, apply đúng thứ tự, mỗi phần một lần gọi, sau V666 (loại trừ gửi; hai bản
// cùng thay aka_agent_engine_claim_target_v1, claim của V667 dựng trên thân V666):
//   p1  ba ràng buộc runtime_target nhận 'server' (NOT VALID; DDL ngắn, giao dịch riêng)
//   p2  hàm + dữ liệu: claim nhận 'server', finish coi 'server' như 'fly', recover_server_zalo_running_state đóng lượt engine 'server'
//       còn mở trước khi đánh dấu data, bốn hàm mới, một dòng chính sách, dòng công tắc (mode off)
//
// Cùng công tắc, Desktop (bản có V667) chạy engine v2 cho tài khoản Zalo QR / trình duyệt của tổ chức trong danh sách (anh: "Làm luôn",
// 26/11/2026): hàm mới aka_agent_engine_desktop_vps_enabled_v1, Desktop đọc lúc đăng nhập. Không sửa aka_agent_engine_desktop_enabled_v1
// (V513): Desktop từ 9.9.0 dùng hàm đó để chọn tài khoản Zalo Server chạy ở Fly hay App Server (resolveZaloServerOnFlyAtLogin), sửa thì
// Desktop của tổ chức trong danh sách đưa quét QR / đăng xuất / quét data tài khoản Server sang ChatApi trong khi tài khoản vẫn ở VPS.
//   p3  VALIDATE ba ràng buộc (không khoá ghi)
//
// Nguồn: pg_get_functiondef production đọc chỉ đọc 26/11/2026, lưu ở scripts/fixtures/engine-v2-server/live-20261126.json (kèm md5,
// quyền, chủ sở hữu). Migration kiểm md5 bản live trước khi thay, bản gỡ trả đúng thân cũ. Thân hàm mới không ghi số migration trong
// chú thích: đổi số thì md5 thân hàm không đổi.
// Chạy: node scripts/build-v667-sql.cjs (ghi 3 migration + 2 bản gỡ). Không sửa tay các file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v667'
const BASE = `migration_${VERSION}_engine_server_runtime`
const NAMES = { p1: `${BASE}_p1`, p2: `${BASE}_p2`, p3: `${BASE}_p3` }
const ROLLBACK = { p1: `rollback_${VERSION}_engine_server_runtime_p1`, p2: `rollback_${VERSION}_engine_server_runtime_p2` }
const SETTING_KEY = 'engine.zalo_server_vps'
const RESET_VIA = 'server_reset'

const FIXTURE = path.join(ROOT, 'scripts/fixtures/engine-v2-server/live-20261126.json')
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
function liveFn(sig) {
  const fn = fixture.functions.find(f => f.signature === sig)
  if (!fn) throw new Error(`fixture: thiếu ${sig}`)
  if (md5(fn.definition) !== fn.md5) throw new Error(`fixture: định nghĩa ${sig} không khớp md5 đã ghi`)
  return fn
}

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const SIG = {
  claim: 'public.aka_agent_engine_claim_target_v1(jsonb)',
  finish: 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)',
  recover: 'public.recover_server_zalo_running_state(bigint,text,boolean)'
}
const NEW_SIG = {
  orgEnabled: 'public.aka_agent_engine_server_org_enabled(bigint)',
  enabledOrgs: 'public.aka_agent_engine_server_enabled_orgs_v1()',
  closeRuns: 'public.aka_agent_engine_close_server_runs_v1(bigint)',
  desktopVps: 'public.aka_agent_engine_desktop_vps_enabled_v1()'
}
const live = Object.fromEntries(Object.entries(SIG).map(([k, sig]) => [k, liveFn(sig)]))

// Claim dựng trên bản của V666 (loại trừ gửi, đã vào dev_3 26/11, chưa apply lúc viết): V666 và V667 cùng thay
// aka_agent_engine_claim_target_v1 từ một bản production (8f574b0a…), nên apply V666 trước rồi V667. p2 kiểm V666 đã có trong sổ và
// claim đúng thân V666 (md5 thân V666 sinh ra = md5 đo sau khi chạy V666, scripts/fixtures/send-exclusion-v666/new-md5.json); bản gỡ trả
// claim về thân V666.
const V666 = require('./build-v666-sql.cjs')
if (V666.OLD.engineClaim !== live.claim.definition) throw new Error('V666: claim cơ sở khác bản production V667 đã đọc')
const V666_NAME = 'migration_v666_send_exclusion_review_fixes'
const CLAIM_BASE = V666.NEW.engineClaim
{
  const measured = JSON.parse(fs.readFileSync(V666.NEW_MD5_FILE, 'utf8')).engineClaim
  if (md5(CLAIM_BASE) !== measured) throw new Error(`V666: thân claim sinh ra khác md5 đo được (${md5(CLAIM_BASE)} / ${measured})`)
}

// ---------------------------------------------------------------- claim: nhận nơi chạy 'server'
let claim = CLAIM_BASE
claim = patch(claim,
  `OR v_runtime NOT IN ('desktop','fly') THEN`,
  `OR v_runtime NOT IN ('desktop','fly','server') THEN`, 1, 'claim: danh sách nơi chạy')
claim = patch(claim,
  `  IF v_runtime = 'fly'
     AND NOT coalesce((SELECT o.use_new_zalo_runtime FROM public.org_organization o WHERE o.id = c.organization_id), false) THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;
`,
  `  IF v_runtime = 'fly'
     AND NOT coalesce((SELECT o.use_new_zalo_runtime FROM public.org_organization o WHERE o.id = c.organization_id), false) THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;
  -- Tài khoản Zalo Server chạy trên VPS (App Server, nơi chạy 'server'): tổ chức đang chạy Server trên Fly thì VPS không còn giữ tài khoản
  -- (App Server tự thả tổ chức trong vòng 60 giây); tổ chức chưa bật engine.zalo_server_vps thì App Server chạy bộ cũ. Kiểm mỗi lần nhận
  -- lượt nên tắt công tắc có hiệu lực ở lần nhận kế tiếp.
  IF v_runtime = 'server' THEN
    IF public.aka_agent_zalo_server_flag_route(c.organization_id) THEN
      RETURN jsonb_build_object('status', 'runtime_not_owner');
    END IF;
    IF NOT public.aka_agent_engine_server_org_enabled(c.organization_id) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
  END IF;
`, 1, 'claim: công tắc nơi chạy server')
claim = patch(claim,
  `  IF (v_runtime = 'fly' AND (lower(btrim(coalesce(a.flatform_type, ''))) <> 'zalo' OR coalesce(a.is_zalo_show_web, false)
                              OR NOT coalesce(a.is_zalo_server, false)))`,
  `  IF (v_runtime IN ('fly', 'server') AND (lower(btrim(coalesce(a.flatform_type, ''))) <> 'zalo' OR coalesce(a.is_zalo_show_web, false)
                                           OR NOT coalesce(a.is_zalo_server, false)))`, 1, 'claim: loại tài khoản của nơi chạy server')

// ---------------------------------------------------------------- finish: 'server' như 'fly' (finalizer của VPS)
const finish = patch(live.finish.definition,
  `  IF l.runtime_target = 'fly' AND a.status IS DISTINCT FROM 'đang chạy' AND a.status IS DISTINCT FROM 'chờ xử lý' THEN`,
  `  IF l.runtime_target IN ('fly', 'server') AND a.status IS DISTINCT FROM 'đang chạy' AND a.status IS DISTINCT FROM 'chờ xử lý' THEN`,
  1, 'finish: tài khoản Server bị tạm dừng giữa lượt')

// ---------------------------------------------------------------- recover: đóng lượt engine 'server' trước bước đánh dấu data
const recover = patch(live.recover.definition,
  `    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  -- A recovery requested by Server may only mutate Server-subtype accounts.`,
  `    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  -- Engine v2 trên VPS: lượt engine (runtime_target = 'server') còn mở của nhân viên không còn ai chạy (App Server khởi động / dừng runtime,
  -- Fly nhận tổ chức, Desktop nhận lại tài khoản sau khi VPS đã thả). Đóng từng lượt như hàm đóng lượt của engine trước khi bước dưới đánh
  -- dấu mọi data "đang chạy" là "hoàn thành": chưa ghi dấu "sắp gửi" thì về hàng đợi, đã ghi dấu thì hoàn thành, không gửi lại.
  PERFORM public.aka_agent_engine_close_server_runs_v1(p_staff_id);

  -- A recovery requested by Server may only mutate Server-subtype accounts.`, 1, 'recover: đóng lượt engine server')

// ---------------------------------------------------------------- bốn hàm mới (định dạng pg_get_functiondef, để kiểm md5 sau khi tạo)
const settingBody = `  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = '${SETTING_KEY}' AND s.is_active LIMIT 1;`
const orgEnabled = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_server_org_enabled(p_organization_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Engine v2 cho tài khoản Zalo Server chạy trên VPS (App Server): tổ chức có trong ${SETTING_KEY} không. JSON
-- {"mode":"off|orgs|all","organizationIds":[…]}; thiếu dòng / sai định dạng = tắt. Claim gọi mỗi lần nhận lượt với nơi chạy 'server';
-- aka_agent_engine_desktop_vps_enabled_v1 gọi lúc Desktop đăng nhập.
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
${settingBody}
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN false; END IF;
  v := v_raw::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
END
$function$
`
const enabledOrgs = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_server_enabled_orgs_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- App Server đọc 60 giây một lần: tổ chức nào chạy engine v2 cho tài khoản Zalo Server trên VPS (${SETTING_KEY}). Trả
-- {"mode":"off|orgs|all","organizationIds":["…"]}; thiếu dòng / sai định dạng = off. Claim vẫn kiểm lại mỗi lần nhận lượt.
DECLARE
  v_raw text;
  v jsonb;
BEGIN
${settingBody}
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN
    RETURN jsonb_build_object('mode', 'off', 'organizationIds', '[]'::jsonb);
  END IF;
  v := v_raw::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('mode', 'off', 'organizationIds', '[]'::jsonb); END IF;
  IF v->>'mode' = 'all' THEN RETURN jsonb_build_object('mode', 'all', 'organizationIds', '[]'::jsonb); END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN jsonb_build_object('mode', 'orgs', 'organizationIds',
      (SELECT coalesce(jsonb_agg(DISTINCT (e.value #>> '{}')), '[]'::jsonb) FROM jsonb_array_elements(v->'organizationIds') e
        WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') ~ '^[0-9]{1,18}$'));
  END IF;
  RETURN jsonb_build_object('mode', 'off', 'organizationIds', '[]'::jsonb);
END
$function$
`
const closeRuns = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_server_runs_v1(p_staff_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Engine v2 trên VPS (App Server): lượt engine 'server' còn mở của nhân viên khi không còn ai chạy nó. recover_server_zalo_running_state
-- gọi hàm này trước khi đánh dấu mọi data "đang chạy" là "hoàn thành" (App Server khởi động / dừng runtime của nhân viên, Fly nhận tổ chức,
-- Desktop nhận lại tài khoản sau khi VPS đã thả). Đóng từng lượt bằng aka_agent_engine_close_run_v1 (lý do ${RESET_VIA}): chưa ghi dấu
-- "sắp gửi" thì về hàng đợi, đã ghi dấu thì hoàn thành, không gửi lại. Phiên Desktop chỉ đóng được lượt của chính nhân viên. Lượt đang bị
-- khoá (job close_stale đang đóng) thì bỏ qua: job đóng nó, không chờ khoá chéo. Trả số lượt đã đóng.
DECLARE
  v_id bigint;
  v_n integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR NOT public.aka_agent_engine_scope_ok(p_staff_id) THEN RETURN 0; END IF;
  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.staff_id = p_staff_id AND tr.runtime_target = 'server'
     ORDER BY tr.id
     FOR UPDATE OF tr SKIP LOCKED
  LOOP
    IF public.aka_agent_engine_close_run_v1(v_id, '${RESET_VIA}') <> 'skipped' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END
$function$
`

const desktopVps = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_desktop_vps_enabled_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Desktop đọc lúc đăng nhập khi cờ use_new_zalo_runtime của tổ chức tắt (aka_agent_engine_desktop_enabled_v1 trả false): tổ chức trong
  -- phiên có trong ${SETTING_KEY} không. Đúng thì tài khoản Zalo QR / trình duyệt chạy engine v2 trên Desktop như tổ chức bật cờ. Không đổi
  -- nơi chạy tài khoản Zalo Server (Desktop vẫn chọn Fly / App Server theo hàm V513). Không có phiên Desktop thì false.
  SELECT COALESCE((
    SELECT public.aka_agent_engine_server_org_enabled(ctx.organization_id)
      FROM private.aka_agent_desktop_data_context() AS ctx
     LIMIT 1
  ), false)
$function$
`

const NEW_MD5 = { claim: md5(claim), finish: md5(finish), recover: md5(recover), orgEnabled: md5(orgEnabled), enabledOrgs: md5(enabledOrgs), closeRuns: md5(closeRuns),
  desktopVps: md5(desktopVps) }
const LIVE_MD5 = { ...Object.fromEntries(Object.entries(live).map(([k, f]) => [k, f.md5])), claim: md5(CLAIM_BASE) }
// Quyền của bốn hàm mới: hàm công tắc chỉ dùng bên trong claim và hàm Desktop (cả hai SECURITY DEFINER, chủ postgres); hàm đọc danh
// sách cho App Server (service_role); hàm đóng lượt được recover_server_zalo_running_state (SECURITY INVOKER) gọi bằng quyền của người
// gọi: App Server (service_role), Fly (aka_agent_chat_api), Desktop (aka_agent_desktop); hàm Desktop chỉ cho phiên Desktop.
const NEW_GRANTS = { orgEnabled: [], enabledOrgs: ['service_role'], closeRuns: ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop'],
  desktopVps: ['aka_agent_desktop'] }

const POLICY_BEHAVIOR_COLS = ['error_code', 'error_class', 'status_id', 'action_code', 'campaign_action_id', 'detail_mode', 'detail_status_id',
  'sub_status_id', 'log_template', 'campaign_note_template', 'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect',
  'requeue_after_minutes', 'remaining_steps', 'lock_action_codes', 'lock_mode', 'lock_minutes', 'lock_days', 'lock_time', 'run_effect', 'pace_mode',
  'pace_seconds', 'campaign_effect', 'campaign_hold_minutes', 'account_effect', 'login_effect', 'description', 'is_active', 'is_delete',
  'streak_after_delivery', 'target_check_enabled', 'target_check_days']
const POLICY_SRC = 255
const POLICY_TWIN = 256
const behaviorJson = alias => `jsonb_build_object(${POLICY_BEHAVIOR_COLS.map(c => `'${c}', ${alias}.${c}`).join(', ')})`

const OLD_CHECK = `CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text])))`
const NEW_CHECK = `CHECK ((runtime_target = ANY (ARRAY['desktop'::text, 'fly'::text, 'server'::text])))`
const CHECKS = [
  ['auto_engine_leases', 'auto_engine_leases_runtime_target_check'],
  ['auto_engine_target_runs', 'auto_engine_target_runs_runtime_target_check'],
  ['auto_outcome_policies', 'auto_outcome_policies_runtime_target_check']
]
const V = VERSION.toUpperCase()
const ledgerGuard = (name, others = []) => `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${name}') THEN
      RAISE EXCEPTION '${name} đã có trong sổ migration, không chạy lại';
    END IF;
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${VERSION}_%'
                AND name NOT IN (${[name, ...others].map(n => `'${n}'`).join(', ')})) THEN
      RAISE EXCEPTION 'Số ${V} đã có migration khác trong sổ: đổi số trong scripts/build-${VERSION}-sql.cjs rồi sinh lại';
    END IF;
  END IF;`
const checkDefs = expect => CHECKS.map(([table, name]) => `  -- pg_get_constraintdef thêm " NOT VALID" khi ràng buộc chưa VALIDATE (sau p1, trước p3): so phần điều kiện.
  IF (SELECT regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') FROM pg_constraint c WHERE c.conrelid = 'public.${table}'::regclass AND c.conname = '${name}')
     IS DISTINCT FROM $c$${expect}$c$ THEN
    RAISE EXCEPTION '${V}: ràng buộc ${name} không như mong đợi';
  END IF;`).join('\n')

// ---------------------------------------------------------------- p1
const p1 = `-- ${V} p1: ba ràng buộc runtime_target nhận nơi chạy 'server' (engine v2 cho tài khoản Zalo Server trên VPS). SINH TỪ
-- scripts/build-${VERSION}-sql.cjs, không sửa tay. Chỉ đổi ràng buộc (NOT VALID: dòng cũ đều đúng, p3 VALIDATE sau). Giao dịch ngắn,
-- lock_timeout 2 giây (bảng engine được ghi liên tục). DDL làm PostgREST nạp lại schema: apply buổi tối. Thứ tự: p1 → p2 → p3.
-- Gỡ: ${ROLLBACK.p1}.sql (chỉ khi chưa có dòng 'server' nào).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
${ledgerGuard(NAMES.p1, [NAMES.p2, NAMES.p3])}
${checkDefs(OLD_CHECK)}
END $pre$;

${CHECKS.map(([table, name]) => `ALTER TABLE public.${table} DROP CONSTRAINT ${name},
  ADD CONSTRAINT ${name} CHECK (runtime_target IN ('desktop', 'fly', 'server')) NOT VALID;`).join('\n')}

DO $post$
BEGIN
${checkDefs(NEW_CHECK)}
END $post$;

COMMIT;
`
const rollbackP1 = `-- Gỡ ${V} p1: ba ràng buộc runtime_target về ('desktop','fly'). SINH TỪ scripts/build-${VERSION}-sql.cjs. Gỡ p2 trước. Chỉ chạy được khi
-- không còn dòng nào mang 'server' (lượt / lease / chính sách); lượt cũ tự dọn sau engine.retention_days ngày.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
${checkDefs(NEW_CHECK)}
  IF to_regprocedure('${NEW_SIG.closeRuns}') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ ${V} p1: gỡ p2 trước'; END IF;
${CHECKS.map(([table]) => `  IF EXISTS (SELECT 1 FROM public.${table} WHERE runtime_target = 'server') THEN
    RAISE EXCEPTION 'Gỡ ${V} p1: public.${table} còn dòng nơi chạy server';
  END IF;`).join('\n')}
END $pre$;

${CHECKS.map(([table, name]) => `ALTER TABLE public.${table} DROP CONSTRAINT ${name},
  ADD CONSTRAINT ${name} CHECK (runtime_target IN ('desktop', 'fly')) NOT VALID;`).join('\n')}
${CHECKS.map(([table, name]) => `ALTER TABLE public.${table} VALIDATE CONSTRAINT ${name};`).join('\n')}

DO $post$
BEGIN
${checkDefs(OLD_CHECK)}
END $post$;

COMMIT;
`

// ---------------------------------------------------------------- p2
const aclCapture = Object.keys(SIG).map(k => `  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('${SIG[k]}');
  PERFORM set_config('aka.${VERSION}_acl_${k}', v_acl, true);`).join('\n')
const aclCheck = (label) => Object.keys(SIG).map(k => `  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('${SIG[k]}');
  IF v_acl IS DISTINCT FROM current_setting('aka.${VERSION}_acl_${k}', true) THEN RAISE EXCEPTION '${label}: quyền / chủ sở hữu ${k} bị đổi'; END IF;`).join('\n')
const md5Check = (label, expect) => Object.keys(SIG).map(k => `  IF md5(pg_get_functiondef(to_regprocedure('${SIG[k]}'))) IS DISTINCT FROM '${expect[k]}' THEN
    RAISE EXCEPTION '${label}: định nghĩa ${k} %', md5(pg_get_functiondef(to_regprocedure('${SIG[k]}')));
  END IF;`).join('\n')
const grantSql = (sig, roles) => `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;
DO $g$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION ${sig} FROM %I', r); END IF;
  END LOOP;
${roles.map(r => `  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN GRANT EXECUTE ON FUNCTION ${sig} TO ${r}; END IF;`).join('\n')}
END $g$;`
const newFnCheck = (key, label) => `  IF to_regprocedure('${NEW_SIG[key]}') IS NULL OR md5(pg_get_functiondef(to_regprocedure('${NEW_SIG[key]}'))) IS DISTINCT FROM '${NEW_MD5[key]}' THEN
    RAISE EXCEPTION '${label}: hàm mới ${key} không như bản sinh';
  END IF;
  IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('${NEW_SIG[key]}')) IS DISTINCT FROM 'postgres'
     AND current_user = 'postgres' THEN
    RAISE EXCEPTION '${label}: hàm mới ${key} không thuộc postgres';
  END IF;`

const SETTING_VALUE = '{"mode":"off","organizationIds":[]}'
const SETTING_DESC = `Engine v2 cho tổ chức chưa bật cờ use_new_zalo_runtime (${V}): tài khoản Zalo Server chạy trên VPS (App Server) và tài khoản Zalo QR / `
  + `trình duyệt chạy trên Desktop. JSON: mode off | orgs (chỉ organizationIds) | all. Thiếu dòng / sai định dạng = off. App Server đọc 60 giây một `
  + `lần (aka_agent_engine_server_enabled_orgs_v1), claim kiểm lại mỗi lần nhận lượt nên tắt có hiệu lực ở lượt sau, chiến dịch quay về bộ cũ. `
  + `Desktop (bản có ${V}) đọc lúc đăng nhập (aka_agent_engine_desktop_vps_enabled_v1): bật / tắt có hiệu lực ở lần đăng nhập sau. Tổ chức bật cờ `
  + `use_new_zalo_runtime không bị ảnh hưởng. Phương án: docs/ENGINE_V2_VPS_ZALO_SERVER_PLAN.md.`

const p2 = `-- ${V} p2: engine v2 cho tài khoản Zalo Server chạy trên VPS (App Server). SINH TỪ scripts/build-${VERSION}-sql.cjs, không sửa tay.
-- Cần p1 và ${V666_NAME} trước (V666 cũng thay claim, ${V} dựng trên thân của V666). Thay ba hàm (giữ chữ ký, chủ sở hữu, quyền):
--   aka_agent_engine_claim_target_v1      nhận nơi chạy 'server': chỉ tài khoản Zalo Server; tổ chức đi Fly → runtime_not_owner; tổ chức
--                                         chưa bật ${SETTING_KEY} → not_enabled
--   aka_agent_engine_finish_campaign_v2   tài khoản Server bị tạm dừng giữa lượt thì chiến dịch về "chờ xử lý" cho cả 'server' (như 'fly')
--   recover_server_zalo_running_state     đóng lượt engine 'server' còn mở (aka_agent_engine_close_server_runs_v1) trước bước đánh dấu data
-- Thêm bốn hàm: aka_agent_engine_server_org_enabled, aka_agent_engine_server_enabled_orgs_v1, aka_agent_engine_close_server_runs_v1,
-- aka_agent_engine_desktop_vps_enabled_v1 (Desktop đọc lúc đăng nhập: tài khoản Zalo QR / trình duyệt của tổ chức trong ${SETTING_KEY}
-- chạy engine v2; không sửa aka_agent_engine_desktop_enabled_v1 vì Desktop dùng nó để chọn Fly / App Server cho tài khoản Zalo Server).
-- Dữ liệu: chép chính sách ${POLICY_SRC} (tra số không rõ kết quả, Desktop; giống hệt ${POLICY_TWIN} của Fly) thành bản 'server'; dòng công tắc
-- ${SETTING_KEY} = ${SETTING_VALUE} (chưa tổ chức nào bật).
-- Nguồn = pg_get_functiondef production 26/11/2026 (${path.relative(ROOT, FIXTURE)}):
--   claim ${LIVE_MD5.claim} → ${NEW_MD5.claim}
--   finish ${LIVE_MD5.finish} → ${NEW_MD5.finish}
--   recover ${LIVE_MD5.recover} → ${NEW_MD5.recover}
-- DDL làm PostgREST nạp lại schema: apply buổi tối. Gỡ: ${ROLLBACK.p2}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_acl text;
BEGIN
${ledgerGuard(NAMES.p2, [NAMES.p1, NAMES.p3])}
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${V666_NAME}') THEN
    RAISE EXCEPTION '${V} p2: cần ${V666_NAME} trước (cùng thay aka_agent_engine_claim_target_v1, ${V} dựng trên bản của V666)';
  END IF;
${checkDefs(NEW_CHECK)}
  IF md5(pg_get_functiondef(to_regprocedure('${SIG.claim}'))) = '${NEW_MD5.claim}' THEN RAISE EXCEPTION '${V} p2 đã chạy (claim)'; END IF;
${md5Check(`${V} p2: bản production khác bản đã đọc 26/11, dừng để đối chiếu`, LIVE_MD5)}
${Object.values(NEW_SIG).map(sig => `  IF to_regprocedure('${sig}') IS NOT NULL THEN RAISE EXCEPTION '${V} p2: đã có ${sig}'; END IF;`).join('\n')}
  IF to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NULL OR to_regprocedure('public.aka_agent_engine_close_run_v1(bigint,text)') IS NULL
     OR to_regprocedure('public.aka_agent_engine_scope_ok(bigint)') IS NULL OR to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION '${V} p2: thiếu hàm phụ thuộc (flag_route / close_run_v1 / scope_ok / desktop_data_context)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = '${SETTING_KEY}') THEN RAISE EXCEPTION '${V} p2: đã có dòng ${SETTING_KEY}'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.id = ${POLICY_SRC} AND p.runtime_target = 'desktop'
                  AND p.error_code = 'err_engine_unknown_delivery' AND p.action_code = 'zalo_find_phone_user' AND p.is_active AND NOT p.is_delete)
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.id = ${POLICY_TWIN} AND p.runtime_target = 'fly'
                  AND p.error_code = 'err_engine_unknown_delivery' AND p.action_code = 'zalo_find_phone_user' AND p.is_active AND NOT p.is_delete) THEN
    RAISE EXCEPTION '${V} p2: chính sách ${POLICY_SRC} / ${POLICY_TWIN} không như đã đọc';
  END IF;
  IF (SELECT ${behaviorJson('a')} FROM public.auto_outcome_policies a WHERE a.id = ${POLICY_SRC})
     IS DISTINCT FROM (SELECT ${behaviorJson('b')} FROM public.auto_outcome_policies b WHERE b.id = ${POLICY_TWIN}) THEN
    RAISE EXCEPTION '${V} p2: chính sách ${POLICY_SRC} (Desktop) và ${POLICY_TWIN} (Fly) không còn giống nhau, dừng để chọn bản chép';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies p WHERE p.runtime_target = 'server') THEN RAISE EXCEPTION '${V} p2: đã có chính sách nơi chạy server'; END IF;
${aclCapture}
END $pre$;

${orgEnabled};
${grantSql(NEW_SIG.orgEnabled, NEW_GRANTS.orgEnabled)}

${desktopVps};
${grantSql(NEW_SIG.desktopVps, NEW_GRANTS.desktopVps)}

${enabledOrgs};
${grantSql(NEW_SIG.enabledOrgs, NEW_GRANTS.enabledOrgs)}

${closeRuns};
${grantSql(NEW_SIG.closeRuns, NEW_GRANTS.closeRuns)}

${claim};

${finish};

${recover};

INSERT INTO public.auto_outcome_policies (${POLICY_BEHAVIOR_COLS.join(', ')}, runtime_target, source)
SELECT ${POLICY_BEHAVIOR_COLS.join(', ')}, 'server', '${VERSION}'
  FROM public.auto_outcome_policies WHERE id = ${POLICY_SRC};

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('${SETTING_KEY}', '${SETTING_VALUE}', '${SETTING_DESC.replace(/'/g, "''")}', false, true);

DO $post$
DECLARE v_acl text;
BEGIN
${md5Check(`${V} p2 postflight`, NEW_MD5)}
${aclCheck(`${V} p2 postflight`)}
${newFnCheck('orgEnabled', `${V} p2 postflight`)}
${newFnCheck('enabledOrgs', `${V} p2 postflight`)}
${newFnCheck('closeRuns', `${V} p2 postflight`)}
${newFnCheck('desktopVps', `${V} p2 postflight`)}
  IF (SELECT count(*) FROM public.auto_outcome_policies p WHERE p.runtime_target = 'server') <> 1
     OR (SELECT ${behaviorJson('a')} FROM public.auto_outcome_policies a WHERE a.runtime_target = 'server')
        IS DISTINCT FROM (SELECT ${behaviorJson('b')} FROM public.auto_outcome_policies b WHERE b.id = ${POLICY_SRC}) THEN
    RAISE EXCEPTION '${V} p2 postflight: chính sách nơi chạy server không như bản chép';
  END IF;
  IF public.aka_agent_engine_server_enabled_orgs_v1() IS DISTINCT FROM '{"mode": "off", "organizationIds": []}'::jsonb THEN
    RAISE EXCEPTION '${V} p2 postflight: công tắc phải đang tắt';
  END IF;
END $post$;

COMMIT;
`

const rollbackP2 = `-- Gỡ ${V} p2: trả claim về bản V666, finish / recover_server_zalo_running_state về bản production 26/11/2026, bỏ bốn hàm mới, chính sách 'server',
-- dòng công tắc ${SETTING_KEY}. SINH TỪ scripts/build-${VERSION}-sql.cjs. Trước khi gỡ: tắt công tắc, chờ App Server hết lượt engine
-- 'server' đang mở (hoặc cài lại App Server bản trước). Desktop bản có ${V} gặp hàm Desktop không còn (PGRST202) thì coi như tắt ở lần
-- đăng nhập sau; phiên đang mở giữ cách chạy đã chọn tới khi đăng nhập lại. Gỡ xong thì gỡ p1 nếu cần.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_acl text;
BEGIN
${md5Check(`Gỡ ${V} p2: định nghĩa không phải bản ${V}`, NEW_MD5)}
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.completed_at IS NULL AND tr.runtime_target = 'server') THEN
    RAISE EXCEPTION 'Gỡ ${V} p2: còn lượt engine nơi chạy server đang mở; tắt công tắc và chờ App Server chạy xong';
  END IF;
${aclCapture}
END $pre$;

${live.recover.definition};

${live.finish.definition};

${CLAIM_BASE};

DROP FUNCTION ${NEW_SIG.desktopVps};
DROP FUNCTION ${NEW_SIG.closeRuns};
DROP FUNCTION ${NEW_SIG.enabledOrgs};
DROP FUNCTION ${NEW_SIG.orgEnabled};

DELETE FROM public.auto_outcome_policies WHERE runtime_target = 'server' AND source = '${VERSION}';
DELETE FROM public.auto_system_settings WHERE key = '${SETTING_KEY}';

DO $post$
DECLARE v_acl text;
BEGIN
${md5Check(`Gỡ ${V} p2 postflight`, LIVE_MD5)}
${aclCheck(`Gỡ ${V} p2 postflight`)}
${Object.values(NEW_SIG).map(sig => `  IF to_regprocedure('${sig}') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ ${V} p2 postflight: còn ${sig}'; END IF;`).join('\n')}
END $post$;

COMMIT;
`

// ---------------------------------------------------------------- p3
const p3 = `-- ${V} p3: VALIDATE ba ràng buộc runtime_target của p1. SINH TỪ scripts/build-${VERSION}-sql.cjs, không sửa tay. Mỗi lệnh một giao dịch,
-- khoá SHARE UPDATE EXCLUSIVE (không chặn đọc / ghi, chỉ chặn DDL khác); auto_engine_target_runs ~770 MB nên mất vài giây. Chạy lại được.
SET lock_timeout = '5s';
SET statement_timeout = '300s';
${CHECKS.map(([table, name]) => `ALTER TABLE public.${table} VALIDATE CONSTRAINT ${name};`).join('\n')}
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname IN (${CHECKS.map(([, n]) => `'${n}'`).join(', ')}) AND NOT c.convalidated) THEN
    RAISE EXCEPTION '${V} p3 postflight: còn ràng buộc chưa VALIDATE';
  END IF;
${checkDefs(NEW_CHECK)}
END $post$;
`

module.exports = {
  VERSION, NAMES, ROLLBACK, SETTING_KEY, RESET_VIA, SIG, NEW_SIG, LIVE_MD5, NEW_MD5, NEW_GRANTS, V666_NAME, CLAIM_BASE,
  sql: { p1, p2, p3, rollbackP1, rollbackP2 },
  texts: { live: Object.fromEntries(Object.entries(live).map(([k, f]) => [k, f.definition])), claim, finish, recover, orgEnabled, enabledOrgs, closeRuns,
    desktopVps },
  fixture
}
if (require.main === module) {
  const out = { [NAMES.p1]: p1, [NAMES.p2]: p2, [NAMES.p3]: p3, [ROLLBACK.p1]: rollbackP1, [ROLLBACK.p2]: rollbackP2 }
  for (const [name, text] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, `migrations/${name}.sql`), text)
  console.log(`${V}`, Object.fromEntries(Object.entries(out).map(([n, t]) => [n, md5(t)])))
  console.log('md5 hàm', Object.fromEntries(Object.keys(NEW_MD5).map(k => [k, `${LIVE_MD5[k] || '(mới)'} -> ${NEW_MD5[k]}`])))
}
