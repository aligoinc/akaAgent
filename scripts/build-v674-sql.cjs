#!/usr/bin/env node
// Sinh migration V674: "Đặt ngày kết thúc" dừng chiến dịch đúng ngày (anh chốt phương án A ngày 27/11/2026).
//
// p1: auto_campaigns.schedule_end_strict (mặc định false: mọi chiến dịch đang có chạy như cũ) + quyền ghi theo cột cho aka_agent_desktop.
//     Giao dịch riêng, ngắn (bảng nóng).
// p2: thay thân 4 hàm, giữ chữ ký, chủ sở hữu, quyền:
//     - aka_agent_finalize_campaign, aka_agent_internal_finalize_zalo_server_maintenance_guard (Desktop, App Server, Fly dùng khi cập nhật
//       lịch ngày mới và khi chạy hết data): chiến dịch có schedule_end_strict mà ngày kết thúc đã qua thì hoàn thành kể cả còn data chờ
//       và không bị mở lại vì còn data chờ;
//     - create_control_campaign_v2 (Web / iOS gửi scheduleEndStrict), update_control_campaign_atomic (khoá schedule_end_strict);
//     thêm private.aka_agent_campaign_schedule_end_sweep (job pg_cron mỗi phút): đóng chiến dịch schedule_end_strict đã qua ngày kết
//     thúc mà còn "chờ xử lý" (lịch kế chưa tới, khách bấm chạy lại, data mới đẩy vào…). Data chờ giữ nguyên.
// p3: chỉ mục một phần cho job quét (CREATE INDEX CONCURRENTLY, chạy riêng ngoài giao dịch; không có thì job quét cả bảng).
//
// Nguồn: pg_get_functiondef production đọc 27/11/2026 (scripts/fixtures/campaign-schedule-end/live-20261127.json).
// Chạy: node scripts/build-v674-sql.cjs (ghi 3 phần migration + bản gỡ). Không sửa tay các file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v674'
const BASE = `${VERSION}_campaign_schedule_end_strict`
const NAMES = { p1: `migration_${BASE}_p1`, p2: `migration_${BASE}_p2`, p3: `migration_${BASE}_p3`, rollback: `rollback_${BASE}` }
const FIXTURE = 'scripts/fixtures/campaign-schedule-end/live-20261127.json'
const STOPPED_NOTE = 'Chiến dịch đã hết ngày kết thúc'
const JOB_NAME = 'aka-agent-campaign-schedule-end'
const JOB_SCHEDULE = '* * * * *'
const INDEX_NAME = 'idx_auto_campaigns_schedule_end_strict'
const SWEEP_SIG = 'private.aka_agent_campaign_schedule_end_sweep(integer)'

const SIG = {
  finalize: 'public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)',
  serverGuard: 'public.aka_agent_internal_finalize_zalo_server_maintenance_guard(bigint,bigint,bigint,text,boolean,text)',
  createV2: 'public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)',
  updateAtomic: 'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)'
}

function patch(text, from, to, label) {
  const n = text.split(from).length - 1
  if (n !== 1) throw new Error(`${label}: cần đúng 1 chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8'))
function live(sig) {
  const key = sig.replace(/^public\./, '')
  const fn = fixture.functions[key]
  if (!fn) throw new Error(`${FIXTURE}: thiếu ${key}`)
  if (md5(fn.def) !== fn.md5) throw new Error(`${FIXTURE}: md5 của ${key} không khớp nội dung`)
  return { ...fn, source: 'bản production 27/11' }
}

// ---------- hai hàm kết thúc chiến dịch (cùng một bản vá) ----------
const FINALIZE_DECLARE = '  v_pending_input_count bigint := 0;\n'
const FINALIZE_SELECT = "  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct')\n  INTO v_campaign_status, v_source_mode\n"
const FINALIZE_PENDING = '  SELECT count(*)\n  INTO v_pending_input_count\n'
const strictBlock = `  -- V674 ("Đặt ngày kết thúc", dừng đúng ngày): khách chủ động đặt ngày kết thúc (schedule_end_strict) và ngày đó đã qua thì chiến
  -- dịch hoàn thành kể cả khi còn data chờ (data chờ giữ nguyên), và không được mở lại vì còn data chờ.
  IF COALESCE(v_strict_ended, false) THEN
    IF v_campaign_status = v_expected_status THEN
      UPDATE public.auto_campaigns AS campaign
      SET status = 'hoàn thành',
          note = '${STOPPED_NOTE}',
          updated_at = clock_timestamp()
      WHERE campaign.id = p_campaign_id
        AND campaign.status = v_expected_status;

      RETURN QUERY SELECT
        true,
        'completed',
        p_campaign_id,
        'hoàn thành'::text,
        0::bigint;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      v_campaign_status = 'hoàn thành',
      'campaign_control_won',
      p_campaign_id,
      v_campaign_status,
      0::bigint;
    RETURN;
  END IF;

`
function patchFinalize(def, label) {
  let out = patch(def, FINALIZE_DECLARE, FINALIZE_DECLARE + '  v_strict_ended boolean := false;\n', `${label}: khai báo`)
  out = patch(out, FINALIZE_SELECT,
    "  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct'),\n"
    + '    (campaign.schedule_end_strict AND campaign.schedule_end_date IS NOT NULL AND campaign.schedule_end_date <= clock_timestamp())\n'
    + '  INTO v_campaign_status, v_source_mode, v_strict_ended\n', `${label}: đọc chiến dịch`)
  out = patch(out, FINALIZE_PENDING, strictBlock + FINALIZE_PENDING, `${label}: nhánh dừng đúng ngày`)
  return out
}
const finalizeLive = live(SIG.finalize)
const finalize = patchFinalize(finalizeLive.def, 'finalize')
const serverGuardLive = live(SIG.serverGuard)
const serverGuard = patchFinalize(serverGuardLive.def, 'server_guard')

// ---------- create_control_campaign_v2 (Web / iOS gửi scheduleEndStrict = true) ----------
const createLive = live(SIG.createV2)
const createOld = `    IF p_campaign->>'parallelRunEnabled' = 'true' THEN
      UPDATE public.auto_campaigns
      SET parallel_run_enabled = true
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
`
const createNew = createOld + `    -- "Đặt ngày kết thúc" từ form Web / iOS (scheduleEndStrict = true): chiến dịch dừng đúng ngày kết thúc. Không gửi hay false = mặc
    -- định của cột (false). Chỉ ghi cột này.
    IF p_campaign->>'scheduleEndStrict' = 'true' THEN
      UPDATE public.auto_campaigns
      SET schedule_end_strict = true
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
`
const createV2 = patch(createLive.def, createOld, createNew, 'create_v2')

// ---------- update_control_campaign_atomic (Web / iOS sửa chiến dịch; API gửi khoá schedule_end_strict) ----------
const updateLive = live(SIG.updateAtomic)
const updateOld = "    parallel_run_enabled = CASE WHEN p_campaign_patch ? 'parallel_run_enabled' THEN COALESCE((p_campaign_patch->>'parallel_run_enabled')::boolean, false) ELSE campaign.parallel_run_enabled END,\n"
const updateNew = updateOld
  + '    -- "Đặt ngày kết thúc": chỉ đổi khi form gửi khoá; client cũ không gửi thì giữ nguyên.\n'
  + "    schedule_end_strict = CASE WHEN p_campaign_patch ? 'schedule_end_strict' THEN COALESCE((p_campaign_patch->>'schedule_end_strict')::boolean, false) ELSE campaign.schedule_end_strict END,\n"
const updateAtomic = patch(updateLive.def, updateOld, updateNew, 'update_atomic')

// ---------- job quét ----------
const sweepBody = `
-- "Đặt ngày kết thúc" (V674): đóng chiến dịch khách đã đặt ngày kết thúc (schedule_end_strict) khi ngày đó đã qua mà chiến dịch còn
-- "chờ xử lý": lịch kế chưa tới nên bước cập nhật lịch ngày mới chưa xét, khách bấm chạy lại, hoặc data mới vừa đẩy vào. Data chờ giữ
-- nguyên. Không đụng chiến dịch đang có lượt chạy (đang chạy, còn token của bộ cũ, còn giữ chỗ của bộ mới) và chiến dịch Nhóm data
-- (có hạn riêng). Mỗi chiến dịch một khối riêng: một chiến dịch lỗi không chặn các chiến dịch khác. Trả số chiến dịch đã đóng.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT c.id
      FROM public.auto_campaigns c
     WHERE c.schedule_end_strict
       AND c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now
       AND c.status = 'chờ xử lý'
       AND coalesce(c.is_delete, false) = false
       AND coalesce(c.data_target_source_mode, 'direct') <> 'data_group'
       AND c.runtime_claim_token IS NULL AND c.runtime_unit_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.campaign_id = c.id AND l.expires_at > v_now)
     ORDER BY c.id
     LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
       FOR UPDATE OF c SKIP LOCKED
  LOOP
    BEGIN
      UPDATE public.auto_campaigns
         SET status = 'hoàn thành', note = '${STOPPED_NOTE}', updated_at = clock_timestamp()
       WHERE id = r.id AND status = 'chờ xử lý';
      IF FOUND THEN v_count := v_count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'aka_agent_campaign_schedule_end_sweep: chiến dịch % không đóng được: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END
`
const sweepDef = `CREATE FUNCTION private.aka_agent_campaign_schedule_end_sweep(p_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '20s' SET lock_timeout = '2s' AS $f$${sweepBody}$f$`

const PATCHED = [
  { key: 'finalize', sig: SIG.finalize, live: finalizeLive, def: finalize },
  { key: 'server_guard', sig: SIG.serverGuard, live: serverGuardLive, def: serverGuard },
  { key: 'create_v2', sig: SIG.createV2, live: createLive, def: createV2 },
  { key: 'update_atomic', sig: SIG.updateAtomic, live: updateLive, def: updateAtomic }
]

const ledgerGuard = name => `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${name}') THEN
      RAISE EXCEPTION '${name} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;`
const colExists = (table, col) => `EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.${table}'::regclass AND attname = '${col}' AND NOT attisdropped)`

const p1 = `-- V674 p1: "Đặt ngày kết thúc" dừng chiến dịch đúng ngày, cột khách chọn. SINH TỪ scripts/build-v674-sql.cjs, không sửa tay.
-- Thêm auto_campaigns.schedule_end_strict (mặc định false: mọi chiến dịch đang có chạy như cũ) và quyền ghi theo cột cho Desktop (V435).
-- Giao dịch riêng, ngắn: ALTER giữ khoá bảng nóng tới hết giao dịch. Chưa có p2 thì cột chưa có tác dụng. Gỡ: ${NAMES.rollback}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
${ledgerGuard(NAMES.p1)}
  IF ${colExists('auto_campaigns', 'schedule_end_strict')} THEN RAISE EXCEPTION 'V674 p1 đã chạy (schedule_end_strict đã có)'; END IF;
END $pre$;

ALTER TABLE public.auto_campaigns ADD COLUMN schedule_end_strict boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.auto_campaigns.schedule_end_strict IS
  'Đặt ngày kết thúc (V674): true = khách chủ động đặt ngày kết thúc trên form mới, hết schedule_end_date chiến dịch hoàn thành kể cả còn data chờ. false = chiến dịch cũ, ngày kết thúc chỉ ngừng làm mới data.';
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT INSERT (schedule_end_strict), UPDATE (schedule_end_strict) ON public.auto_campaigns TO aka_agent_desktop;
  END IF;
END $grant$;

DO $post$
BEGIN
  IF NOT ${colExists('auto_campaigns', 'schedule_end_strict')} THEN RAISE EXCEPTION 'V674 p1 postflight: thiếu cột'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop')
     AND NOT (has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'schedule_end_strict', 'UPDATE')
              AND has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'schedule_end_strict', 'INSERT')) THEN
    RAISE EXCEPTION 'V674 p1 postflight: Desktop chưa có quyền ghi cột';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaigns WHERE schedule_end_strict) THEN RAISE EXCEPTION 'V674 p1 postflight: đã có chiến dịch bật cột'; END IF;
END $post$;
COMMIT;
`

const functionPre = PATCHED.map(p => `  v_oid := to_regprocedure('${p.sig}');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V674 p2: không có ${p.sig}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${md5(p.def)}' THEN RAISE EXCEPTION 'V674 p2 đã chạy (${p.key})'; END IF;
  IF v_md5 IS DISTINCT FROM '${p.live.md5}' THEN
    RAISE EXCEPTION 'V674 p2: định nghĩa ${p.key} khác ${p.live.source}, dừng để đối chiếu bản live (${p.key}: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v674_acl_${p.key}', v_acl, true);`).join('\n')

const functionPost = PATCHED.map(p => `  v_oid := to_regprocedure('${p.sig}');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${md5(p.def)}' THEN
    RAISE EXCEPTION 'V674 p2 postflight: định nghĩa ${p.key} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v674_acl_${p.key}', true) THEN RAISE EXCEPTION 'V674 p2 postflight: quyền / chủ sở hữu ${p.key} bị đổi'; END IF;`).join('\n')

const p2 = `-- V674 p2: "Đặt ngày kết thúc" dừng chiến dịch đúng ngày. SINH TỪ scripts/build-v674-sql.cjs, không sửa tay.
-- Thay thân 4 hàm (giữ chữ ký, chủ sở hữu, quyền): aka_agent_finalize_campaign và aka_agent_internal_finalize_zalo_server_maintenance_guard
-- (chiến dịch có schedule_end_strict đã qua ngày kết thúc thì hoàn thành kể cả còn data chờ, không bị mở lại), create_control_campaign_v2
-- (đọc scheduleEndStrict), update_control_campaign_atomic (đọc khoá schedule_end_strict). Thêm private.aka_agent_campaign_schedule_end_sweep
-- và job pg_cron ${JOB_NAME} (${JOB_SCHEDULE}).
-- Nguồn: pg_get_functiondef production 27/11/2026: ${PATCHED.map(p => `${p.key} ${p.live.md5}`).join(', ')}.
-- Bản mới: ${PATCHED.map(p => `${p.key} ${md5(p.def)}`).join(', ')}.
-- Chưa chiến dịch nào bật cột nên apply xong chưa đổi gì; chỉ form mới (Desktop / Web sau V674) bật cột. Cần p1. DDL làm PostgREST nạp
-- lại schema: apply ngoài giờ cao điểm. Gỡ: ${NAMES.rollback}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
${ledgerGuard(NAMES.p2)}
  IF NOT ${colExists('auto_campaigns', 'schedule_end_strict')} THEN RAISE EXCEPTION 'V674 p2: chạy p1 trước'; END IF;
  IF to_regprocedure('${SWEEP_SIG}') IS NOT NULL THEN RAISE EXCEPTION 'V674 p2: ${SWEEP_SIG} đã có'; END IF;
  IF to_regclass('public.auto_engine_leases') IS NULL THEN RAISE EXCEPTION 'V674 p2: thiếu public.auto_engine_leases'; END IF;
  -- IF lồng: câu đọc cron.job chỉ được phân tích khi pg_cron có cài.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = '${JOB_NAME}') THEN RAISE EXCEPTION 'V674 p2: đã có job ${JOB_NAME}'; END IF;
  END IF;
${functionPre}
END $pre$;

${PATCHED.map(p => p.def + ';\n').join('\n')}
${sweepDef};
-- Hàm mới ở schema private: chỉ job pg_cron (postgres) gọi.
REVOKE ALL ON FUNCTION ${SWEEP_SIG} FROM PUBLIC;
DO $grant$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION ${SWEEP_SIG} FROM %I', v_role);
    END IF;
  END LOOP;
END $grant$;

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('${JOB_NAME}', '${JOB_SCHEDULE}', 'SELECT private.aka_agent_campaign_schedule_end_sweep()');
  END IF;
END $cron$;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${functionPost}
  IF md5((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('${SWEEP_SIG}'))) IS DISTINCT FROM '${md5(sweepBody)}' THEN
    RAISE EXCEPTION 'V674 p2 postflight: thân aka_agent_campaign_schedule_end_sweep khác bản sinh';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api')
              AND has_function_privilege(r.rolname, '${SWEEP_SIG}', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V674 p2 postflight: role ứng dụng gọi được aka_agent_campaign_schedule_end_sweep';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = '${JOB_NAME}' AND j.schedule = '${JOB_SCHEDULE}') THEN
      RAISE EXCEPTION 'V674 p2 postflight: thiếu job ${JOB_NAME}';
    END IF;
  END IF;
END $post$;
COMMIT;
`

const p3 = `-- V674 p3: chỉ mục một phần cho job quét "Đặt ngày kết thúc". SINH TỪ scripts/build-v674-sql.cjs, không sửa tay.
-- MỘT lệnh, chạy riêng NGOÀI giao dịch (CREATE INDEX CONCURRENTLY không chạy được trong BEGIN … COMMIT, apply_migration hay file nhiều
-- lệnh). Chỉ chứa chiến dịch bật schedule_end_strict nên rất nhỏ. Không có chỉ mục này job vẫn đúng, chỉ là quét cả bảng mỗi phút.
-- Xong kiểm: SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.${INDEX_NAME}'::regclass;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME} ON public.auto_campaigns (schedule_end_date) WHERE schedule_end_strict;
`

const rollback = `-- Gỡ V674 ("Đặt ngày kết thúc" dừng đúng ngày). SINH TỪ scripts/build-v674-sql.cjs, không sửa tay. Chạy theo đúng thứ tự trong file.
-- Bước 0 (chạy riêng, ngoài giao dịch, nếu đã chạy p3): DROP INDEX CONCURRENTLY IF EXISTS public.${INDEX_NAME};
-- p2: huỷ job, xoá hàm quét, trả 4 hàm về bản production 27/11. p1: xoá cột (mất lựa chọn "dừng đúng ngày" của khách; chiến dịch đã
-- đặt ngày kết thúc trở lại cách chạy cũ: chạy nốt data còn chờ). Gỡ app / API đọc cột trước, hoặc chấp nhận app tự đọc lại không cột.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $pre$
BEGIN
  IF NOT ${colExists('auto_campaigns', 'schedule_end_strict')} THEN RAISE EXCEPTION 'Gỡ V674: chưa có V674 p1'; END IF;
${PATCHED.map(p => `  IF md5(pg_get_functiondef(to_regprocedure('${p.sig}'))) IS DISTINCT FROM '${md5(p.def)}' THEN
    RAISE EXCEPTION 'Gỡ V674: định nghĩa ${p.key} không phải bản V674 (có bản sửa sau V674?), dừng để đối chiếu (%)', md5(pg_get_functiondef(to_regprocedure('${p.sig}')));
  END IF;`).join('\n')}
END $pre$;
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = '${JOB_NAME}') THEN PERFORM cron.unschedule('${JOB_NAME}'); END IF;
  END IF;
END $cron$;
DROP FUNCTION IF EXISTS ${SWEEP_SIG};
${PATCHED.map(p => p.live.def + ';\n').join('\n')}
DO $post$
BEGIN
${PATCHED.map(p => `  IF md5(pg_get_functiondef(to_regprocedure('${p.sig}'))) IS DISTINCT FROM '${p.live.md5}' THEN RAISE EXCEPTION 'Gỡ V674: ${p.key} chưa về bản cũ'; END IF;`).join('\n')}
END $post$;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
DROP INDEX IF EXISTS public.${INDEX_NAME};
ALTER TABLE public.auto_campaigns DROP COLUMN IF EXISTS schedule_end_strict;
COMMIT;
`

const result = {
  p1, p2, p3, rollback, NAMES, SIG, SWEEP_SIG, JOB_NAME, JOB_SCHEDULE, INDEX_NAME, STOPPED_NOTE, sweepBody,
  defs: Object.fromEntries(PATCHED.map(p => [p.key, { sig: p.sig, liveDef: p.live.def, liveMd5: p.live.md5, def: p.def, md5: md5(p.def) }]))
}
module.exports = result

if (require.main === module) {
  const out = (name, text) => {
    fs.writeFileSync(path.join(ROOT, 'migrations', `${name}.sql`), text)
    console.log(`${name}.sql  md5 ${md5(text)}`)
  }
  out(NAMES.p1, p1)
  out(NAMES.p2, p2)
  out(NAMES.p3, p3)
  out(NAMES.rollback, rollback)
  for (const p of PATCHED) console.log(`${p.key}: ${p.live.md5} → ${md5(p.def)}`)
  console.log(`sweep prosrc ${md5(sweepBody)}`)
}
