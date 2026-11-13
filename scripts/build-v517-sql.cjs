// Sinh migration V517: dọn bảng vận hành của engine v2 và làm gọn dòng kết quả (anh chốt 13/11/2026 "Làm, giữ 30 ngày").
//
//   * Job pg_cron mỗi giờ (phút 23) gọi aka_agent_engine_retention_v1: xoá lượt data ĐÃ ĐÓNG của engine v2 cũ hơn
//     engine.retention_days ngày (mặc định 30) trong auto_engine_target_runs, kéo theo kết quả (auto_engine_outcomes) và sự kiện
//     (auto_engine_target_events) của lượt qua FK ON DELETE CASCADE; sự kiện không gắn lượt xoá theo giờ ghi. Lượt còn mở không bao giờ bị
//     xoá. Mỗi lần tối đa 20.000 lượt, 20 giây, lô 1.000 dòng (statement_timeout của pg_cron là 120 giây).
//   * report_v1 (thân V515): decision của mỗi dòng kết quả chỉ còn result và contrib (gọi lại lần báo, gộp lượt dùng hai phần này); bỏ
//     chính sách đã gộp (~500 byte/dòng, không hàm nào đọc lại; lịch sử auto_campaign_details đã có policyIds/revisions).
// Đo production 13/11/2026: dòng kết quả trung bình 1.627 byte (decision 1.434: contrib 522, policy 506, result 427); lịch sử ghi trung
// bình 237 nghìn dòng/ngày, Zalo 94% ⇒ bật bộ mới cho toàn bộ Zalo thì bảng engine tăng ~0,4–0,5 GB/ngày nếu không dọn.
// Chỉ engine v2 dùng các hàm, bảng, thiết lập này; bộ chạy cũ không đổi. Phải apply SAU V515 (preflight đòi thân report_v1 của V515).
// Chạy: node scripts/build-v517-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v515 = require('./build-v515-sql.cjs')
const NAME = 'migration_v517_engine_retention'
const ROLLBACK_NAME = 'rollback_v517_engine_retention'

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

const reportOld = extract(v515.migration, 'aka_agent_engine_report_v1', 'CREATE OR REPLACE FUNCTION', 'V515')
// report_v1 trước V517 = bản V515 (V515 chưa apply lúc viết; V517 chỉ chạy được sau V515).
const LIVE = { report: md5(reportOld.body) }
if (LIVE.report !== v515.NEW.report || LIVE.report !== '49cbb00b81024d3af3560922e67fd864') {
  throw new Error(`Thân report_v1 của V515 không còn là 49cbb00b… (${LIVE.report})`)
}

// ------------------------------------------------------------------------------------------------ report_v1: decision gọn
let r = reportOld.block
r = patch(r, `      v_decision := jsonb_build_object(
        'result', jsonb_build_object('resultKey', v_rk,`, `      -- V517: decision chỉ giữ result (gọi lại lần báo) và contrib (gộp lượt); chính sách đã gộp không lưu nữa (không hàm nào đọc
      -- lại; lịch sử có policyIds/revisions). Mỗi dòng auto_engine_outcomes nhẹ đi ~500 byte.
      v_decision := jsonb_build_object(
        'result', jsonb_build_object('resultKey', v_rk,`, 1, 'report: chú thích decision')
r = patch(r, `        'contrib', v_contrib,
        'policy', v_policy);`, `        'contrib', v_contrib);`, 1, 'report: bỏ policy khỏi decision')

// ------------------------------------------------------------------------------------------------ hàm dọn
const retention = `CREATE FUNCTION public.aka_agent_engine_retention_v1(p_max_runs integer DEFAULT 20000, p_budget_ms integer DEFAULT 20000)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_raw text := btrim(coalesce(public.aka_agent_engine_setting('engine.retention_days', '30'), ''));
  v_days integer := CASE WHEN v_raw ~ '^[0-9]{1,4}$' THEN least(greatest(v_raw::integer, 1), 3650) ELSE 30 END;
  v_cutoff timestamptz := clock_timestamp() - make_interval(days => v_days);
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => greatest(coalesce(p_budget_ms, 20000), 100) / 1000.0);
  v_max integer := greatest(coalesce(p_max_runs, 20000), 1);
  v_runs integer := 0;
  v_outcomes bigint := 0;
  v_events integer := 0;
  v_n integer;
  v_o bigint;
  v_stopped boolean := false;
BEGIN
  -- Lượt data đã đóng, cũ hơn mốc: xoá kéo theo kết quả và sự kiện của lượt (FK ON DELETE CASCADE). Lượt còn mở (completed_at NULL)
  -- không bao giờ bị xoá; close_stale_v1 đóng lượt bỏ dở sau engine.stale_target_minutes.
  LOOP
    IF v_runs >= v_max OR clock_timestamp() >= v_deadline THEN v_stopped := true; EXIT; END IF;
    WITH doomed AS (
      SELECT tr.id FROM public.auto_engine_target_runs tr
       WHERE tr.started_at < v_cutoff AND tr.completed_at IS NOT NULL
       ORDER BY tr.started_at LIMIT least(1000, v_max - v_runs)
       FOR UPDATE SKIP LOCKED
    ), gone AS (
      DELETE FROM public.auto_engine_target_runs tr USING doomed d WHERE tr.id = d.id RETURNING tr.outcome_count
    )
    SELECT count(*), coalesce(sum(gone.outcome_count), 0) INTO v_n, v_o FROM gone;
    v_runs := v_runs + v_n;
    v_outcomes := v_outcomes + v_o;
    EXIT WHEN v_n = 0;
  END LOOP;
  -- Sự kiện không gắn lượt (target_run_id NULL) hoặc còn sót: theo giờ ghi.
  LOOP
    IF clock_timestamp() >= v_deadline THEN v_stopped := true; EXIT; END IF;
    WITH doomed AS (
      SELECT e.id FROM public.auto_engine_target_events e
       WHERE e.created_at < v_cutoff ORDER BY e.created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.auto_engine_target_events e USING doomed d WHERE e.id = d.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_events := v_events + v_n;
    EXIT WHEN v_n = 0;
  END LOOP;
  RETURN jsonb_build_object('retentionDays', v_days, 'cutoff', v_cutoff, 'runs', v_runs, 'outcomes', v_outcomes, 'events', v_events,
    'stoppedEarly', v_stopped);
END $f$;`

const NEW = { report: md5(bodyOf(r)), retention: md5(bodyOf(retention)) }
const SIG = {
  report: 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)',
  retention: 'public.aka_agent_engine_retention_v1(integer,integer)'
}
const SETTING = 'engine.retention_days'
const SETTING_VALUE = '30'
const SETTING_DESCRIPTION = 'V517: số ngày giữ lượt data đã đóng của engine v2 (auto_engine_target_runs, kèm kết quả và sự kiện của lượt); job '
  + 'aka-agent-engine-retention xoá phần cũ hơn mỗi giờ. Hợp lệ 1–3650, sai định dạng thì dùng 30.'
const JOB = 'aka-agent-engine-retention'
const JOB_SCHEDULE = '23 * * * *'
const JOB_COMMAND = 'SELECT public.aka_agent_engine_retention_v1()'
const INDEX = 'auto_engine_target_events_created_v517'
const sq = text => `'${text.replace(/'/g, "''")}'`

const migration = `-- V517: dọn bảng vận hành của engine v2 (giữ 30 ngày) và làm gọn dòng kết quả.
-- SINH TỪ scripts/build-v517-sql.cjs, không sửa tay.
--
--   * aka_agent_engine_retention_v1 + job pg_cron ${JOB} (${JOB_SCHEDULE}): xoá lượt data ĐÃ ĐÓNG cũ hơn ${SETTING}
--     (mặc định ${SETTING_VALUE}) ngày, kéo theo kết quả và sự kiện của lượt (FK ON DELETE CASCADE); sự kiện không gắn lượt xoá theo giờ ghi
--     (chỉ mục mới ${INDEX}). Lượt còn mở không bao giờ bị xoá. Mỗi lần tối đa 20.000 lượt, 20 giây, lô 1.000.
--   * report_v1 (thân V515): decision chỉ còn result và contrib; bỏ chính sách đã gộp (~500 byte/dòng, không hàm nào đọc lại).
-- Chỉ engine v2 dùng các hàm, bảng, thiết lập này; bộ chạy cũ không đổi. Phải apply SAU V515. DDL làm PostgREST nạp lại schema: apply
-- ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql (dòng đã xoá không lấy lại được).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v517_%') THEN
      RAISE EXCEPTION 'V517 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('${SIG.retention}') IS NOT NULL THEN RAISE EXCEPTION 'V517 đã chạy: đã có aka_agent_engine_retention_v1'; END IF;
  IF to_regclass('public.${INDEX}') IS NOT NULL THEN RAISE EXCEPTION 'V517 đã chạy: đã có chỉ mục ${INDEX}'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings s WHERE s.key = '${SETTING}') THEN RAISE EXCEPTION 'V517: đã có thiết lập ${SETTING}'; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.report}');
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN
    RAISE EXCEPTION 'V517: thân report_v1 không phải bản V515 (%); apply V515 trước', v_md5;
  END IF;
  -- IF lồng: câu đọc cron.job chỉ được phân tích khi pg_cron có cài.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = '${JOB}') THEN RAISE EXCEPTION 'V517: đã có job ${JOB}'; END IF;
  END IF;
END $pre$;

CREATE INDEX ${INDEX} ON public.auto_engine_target_events (created_at);

${r}

${retention}
COMMENT ON FUNCTION ${SIG.retention} IS
  'V517: xoá lượt data đã đóng của engine v2 cũ hơn ${SETTING} ngày (kèm kết quả, sự kiện); job pg_cron ${JOB} gọi mỗi giờ.';

INSERT INTO public.auto_system_settings (key, value, description) VALUES (${sq(SETTING)}, ${sq(SETTING_VALUE)}, ${sq(SETTING_DESCRIPTION)});

DO $grants$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION ${SIG.retention} FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SIG.retention} FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SIG.retention} FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SIG.retention} FROM aka_agent_chat_api'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN EXECUTE 'REVOKE ALL ON FUNCTION ${SIG.retention} FROM aka_agent_desktop'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION ${SIG.retention} TO service_role'; END IF;
END $grants$;

-- pg_cron: mỗi giờ phút 23 (tránh giây :00 của các job mỗi phút và các mốc */15, */30).
DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('${JOB}', '${JOB_SCHEDULE}', '${JOB_COMMAND}');
  END IF;
END $cron$;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.report}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'V517 postflight: report_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.retention}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.retention}' THEN RAISE EXCEPTION 'V517 postflight: retention_v1 %', v_md5; END IF;
  IF (SELECT s.value FROM public.auto_system_settings s WHERE s.key = '${SETTING}') IS DISTINCT FROM '${SETTING_VALUE}' THEN
    RAISE EXCEPTION 'V517 postflight: thiếu thiết lập ${SETTING}';
  END IF;
  IF to_regclass('public.${INDEX}') IS NULL THEN RAISE EXCEPTION 'V517 postflight: thiếu chỉ mục ${INDEX}'; END IF;
  IF has_function_privilege('anon', '${SIG.retention}', 'EXECUTE') OR has_function_privilege('authenticated', '${SIG.retention}', 'EXECUTE')
     OR has_function_privilege('anon', '${SIG.report}', 'EXECUTE') OR has_function_privilege('authenticated', '${SIG.report}', 'EXECUTE') THEN
    RAISE EXCEPTION 'V517 postflight: quyền hàm quá rộng';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = '${JOB}' AND j.schedule = '${JOB_SCHEDULE}' AND j.command = '${JOB_COMMAND}') THEN
      RAISE EXCEPTION 'V517 postflight: thiếu job ${JOB}';
    END IF;
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V517: bỏ job ${JOB}, hàm aka_agent_engine_retention_v1, thiết lập ${SETTING}, chỉ mục ${INDEX}; trả report_v1
-- về thân V515 (decision lại có policy). Dòng đã bị xoá không lấy lại được; dòng kết quả ghi trong lúc có V517 vẫn không có policy (vô hại).
-- SINH TỪ scripts/build-v517-sql.cjs. DDL: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('${SIG.retention}') IS NULL THEN RAISE EXCEPTION 'Gỡ V517: chưa có V517'; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.report}');
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'Gỡ V517: thân report_v1 không phải bản V517 (%)', v_md5; END IF;
END $pre$;

DO $cron$
BEGIN
  -- IF lồng: câu đọc cron.job chỉ được phân tích khi pg_cron có cài.
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = '${JOB}';
  END IF;
END $cron$;

${reportOld.block}

DROP FUNCTION ${SIG.retention};
DELETE FROM public.auto_system_settings WHERE key = '${SETTING}';
DROP INDEX public.${INDEX};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.report}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'Gỡ V517 postflight: report_v1 %', v_md5; END IF;
  IF to_regprocedure('${SIG.retention}') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V517 postflight: còn retention_v1'; END IF;
  IF to_regclass('public.${INDEX}') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V517 postflight: còn chỉ mục ${INDEX}'; END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = '${JOB}') THEN RAISE EXCEPTION 'Gỡ V517 postflight: còn job ${JOB}'; END IF;
  END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SIG, SETTING, SETTING_VALUE, JOB, JOB_SCHEDULE, JOB_COMMAND, INDEX, NAME, ROLLBACK_NAME }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log('V517 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
