// Sinh migration V594 và bản gỡ: bộ kiểm lỗi chiến dịch Facebook theo cách anh chốt 20/11/2026 (docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md mục 14):
// tối đa maxPerHour ca mỗi giờ, ca anh "bỏ qua" tự mở lại khi trong 24 giờ có từ skipReopenHits24h lượt, sửa bước hỏi tiếp khi ảnh về.
//   node scripts/build-v594-sql.cjs
// Thân hàm tick mới = thân V593 (đọc từ migration_v593_engine_error_watch_order_images.sql, md5 thân trùng production khi apply 20/11/2026)
// + các chỗ vá ở PATCHES. Không sửa tay hai tệp SQL sinh ra; sửa ở đây rồi sinh lại. Sau khi đã apply thì không sinh lại nữa, viết migration mới.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'migrations')
const V593 = fs.readFileSync(path.join(MIGRATIONS, 'migration_v593_engine_error_watch_order_images.sql'), 'utf8')
const V593_BODY_MD5 = '88a4fb4b739fe0a87a1421fdb8996fb2' // md5(prosrc) sau khi apply V593 trên production 11:21 VN 20/11/2026
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const TICK_HEAD = `FUNCTION public.aka_agent_engine_error_watch_tick_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '20s' AS $f$`

function tickBody() {
  const head = 'CREATE OR REPLACE ' + TICK_HEAD
  const a = V593.indexOf(head)
  if (a < 0) throw new Error('Không tìm thấy khai báo hàm tick trong V593')
  const b = a + head.length
  const e = V593.indexOf('$f$;', b)
  if (e < 0) throw new Error('Không tìm thấy cuối thân hàm tick trong V593')
  const body = V593.slice(b, e)
  if (md5(body) !== V593_BODY_MD5) throw new Error(`Thân hàm tick V593 lệch md5: ${md5(body)}`)
  return body
}

/** Mỗi chỗ vá: đoạn cũ phải có đúng một lần trong thân V593. */
const PATCHES = [
  ['khai báo biến', `  v_images_ready boolean;
`, `  v_images_ready boolean;
  -- V594: trần việc mỗi giờ; mở lại ca đã bỏ qua
  v_max_hour integer;
  v_tasks_hour integer := 0;
  v_reopen_hits integer;
  v_reopened integer := 0;
`],

  // Anh "bỏ qua" một ca thì ca sang status 'muted' (do lệnh hộp thư ghi). Bỏ qua chỉ là tạm thời: loại lỗi đó xuất hiện nhiều trên toàn hệ thống
  // thì phải kiểm lại (anh chốt 20/11/2026: từ 30 lượt trong 24 giờ).
  ['mở lại ca đã bỏ qua', `  -- 6. Chèn việc.
`, `  -- 5b (V594). Ca anh đã bỏ qua (status muted): mở lại để Claude kiểm lại khi trong 24 giờ có từ skipReopenHits24h lượt trở lên trên toàn
  --      hệ thống (mặc định 30). Đếm theo lượt lỗi của ca (auto_engine_error_items, chỉ mục case_key + occurred_at), dừng đếm khi đủ ngưỡng.
  --      Ca "tăng bất thường" mỗi ngày là một ca mới (khoá có ngày) nên bỏ qua loại ca này chỉ có tác dụng trong ngày đó.
  v_reopen_hits := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'skipReopenHits24h', 30)::integer, 1), 100000);
  WITH muted AS (
    SELECT k.case_key,
           (SELECT count(*) FROM (SELECT 1 FROM private.auto_engine_error_items i
                                   WHERE i.case_key = k.case_key AND i.occurred_at > v_now - interval '24 hours' LIMIT v_reopen_hits) z) AS n
      FROM private.auto_engine_error_cases k
     WHERE k.status = 'muted' AND k.platform = 'facebook'
  ), reopened AS (
    UPDATE private.auto_engine_error_cases k
       SET status = 'new',
           note = 'Mở lại sau khi bỏ qua: từ ' || m.n || ' lượt trong 24 giờ (' || to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ')',
           updated_at = v_now
      FROM muted m
     WHERE k.case_key = m.case_key AND k.status = 'muted' AND m.n >= v_reopen_hits
    RETURNING 1
  )
  SELECT count(*) INTO v_reopened FROM reopened;

  -- 6. Chèn việc.
`],

  ['đọc trần việc mỗi giờ', `    v_image_wait := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageWaitMinutes', 15)::integer, 0), 120);
`, `    v_image_wait := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageWaitMinutes', 15)::integer, 0), 120);
    -- V594: tối đa maxPerHour câu mỗi giờ (cả câu hỏi tiếp khi ảnh về); 0 hoặc bỏ trống = không giới hạn theo giờ như V593. Tối đa 10.
    v_max_hour := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'maxPerHour', 0)::integer, 0), 10);
`],

  ['tính chỗ trống theo giờ', `    v_slots := least(v_max_pending - v_pending, v_max_day - st.tasks_today);
`, `    v_slots := least(v_max_pending - v_pending, v_max_day - st.tasks_today);
    IF v_max_hour > 0 THEN
      -- Đếm câu đã chèn trong giờ đồng hồ hiện tại (giờ VN lệch UTC đúng 7 giờ nên đầu giờ trùng nhau).
      SELECT count(*) INTO v_tasks_hour
        FROM public.ai_message_thread t JOIN public.ai_message m ON m.thread_id = t.id
       WHERE t.project_id = v_project.id AND t.org_staff_id = v_staff AND NOT t.is_delete AND m.created_at >= date_trunc('hour', v_now);
      v_slots := least(v_slots, v_max_hour - v_tasks_hour);
    END IF;
`],

  // V593 cho bước 6a nhận cả ca 'failed' chưa từng có báo cáo, nên ca hỏng có ảnh bị hỏi bằng câu ngắn "chỉ báo điều mới so với báo cáo trước"
  // (thiếu số liệu, lượt mẫu; câu 585 ngày 20/11/2026). Ca 'failed' để bước 6b hỏi bằng câu đầy đủ, kèm dòng "anh da ve".
  ['bước 6a chỉ nhận ca đã có báo cáo', `       WHERE k.image_request_id IS NOT NULL AND k.image_followup_at IS NULL AND k.status IN ('reported', 'failed') AND k.thread_id IS NOT NULL`,
    `       WHERE k.image_request_id IS NOT NULL AND k.image_followup_at IS NULL AND k.status = 'reported' AND k.thread_id IS NOT NULL`],

  ['câu hỏi ghi ca được mở lại', `        || 'khoa: ' || cs.case_key || E'\\n'
        || 'ma: '`, `        || 'khoa: ' || cs.case_key || E'\\n'
        || CASE WHEN cs.status = 'new' AND cs.note LIKE 'Mở lại sau khi bỏ qua%'
             THEN 'ghi chu: ' || cs.note || '. Anh đã bỏ qua ca này trước đó; kiểm xem có gì mới so với báo cáo trước.' || E'\\n' ELSE '' END
        || 'ma: '`],

  ['kết quả tick đếm việc trong giờ và ca mở lại', `'tasksToday', st.tasks_today,`, `'tasksToday', st.tasks_today, 'tasksHour', v_tasks_hour, 'reopened', v_reopened,`]
]

function patchedBody() {
  let body = tickBody()
  for (const [name, from, to] of PATCHES) {
    const n = body.split(from).length - 1
    if (n !== 1) throw new Error(`Chỗ vá "${name}": đoạn cũ xuất hiện ${n} lần (phải đúng 1)`)
    body = body.replace(from, () => to)
  }
  return body
}

const OLD_BODY = tickBody()
const NEW_BODY = patchedBody()
const NEW_BODY_MD5 = md5(NEW_BODY)
const COMMENT_V593 = `'V574 + V588 + V593: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca và lỗi theo lượt), enqueue (chèn câu vào Hỏi đáp AI), imageRequests (xin ảnh lỗi), imageWaitMinutes (chờ ảnh về trước khi hỏi, mặc định 15, 0 = hỏi ngay), fire (đánh thức tác vụ cloud). V588: chép kết luận về sổ ca, ghi câu cho khách đã duyệt. V593: chọn ca theo mức ảnh hưởng (kể cả ca gửi lại), xin ảnh cho mọi loại ca có ảnh.'`
const COMMENT_V594 = `'V574 + V588 + V593 + V594: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca và lỗi theo lượt), enqueue (chèn câu vào Hỏi đáp AI), maxPerHour / maxPerDay (trần câu mỗi giờ / mỗi ngày), imageRequests (xin ảnh lỗi), imageWaitMinutes (chờ ảnh về trước khi hỏi, mặc định 15, 0 = hỏi ngay), skipReopenHits24h (ca bỏ qua mở lại khi đủ số lượt trong 24 giờ, mặc định 30), fire (đánh thức tác vụ cloud). V588: chép kết luận về sổ ca, ghi câu cho khách đã duyệt. V593: chọn ca theo mức ảnh hưởng (kể cả ca gửi lại), xin ảnh cho mọi loại ca có ảnh. V594: trần mỗi giờ, mở lại ca bỏ qua, hỏi tiếp vì ảnh chỉ với ca đã có báo cáo.'`
if (!V593.includes(`COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS\n  ${COMMENT_V593};`)) throw new Error('Chú thích hàm tick V593 đã đổi')

// Lệnh "bỏ qua câu N" của hộp thư (scripts/engine-v2-facebook/error-watch-inbox.cjs skip): ca của câu sang 'muted'; p_skip = false thì trả lại
// (lỡ tay bỏ qua). Chỉ người vận hành gọi qua supabase db query (role postgres); không cấp quyền cho role nào của app.
const SKIP_FN = `CREATE FUNCTION private.aka_agent_engine_error_case_skip_v1(p_message_id bigint, p_skip boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '10s' AS $f$
DECLARE
  v_key text;
  v_case private.auto_engine_error_cases%ROWTYPE;
  v_cfg jsonb;
  v_threshold integer;
  v_n integer;
  v_at text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI');
BEGIN
  SELECT t.intake_data ->> 'khoa' INTO v_key
    FROM public.ai_message m JOIN public.ai_message_thread t ON t.id = m.thread_id JOIN public.ai_project p ON p.id = t.project_id
   WHERE m.id = p_message_id AND p.code = 'kiem-loi-chien-dich-facebook';
  IF v_key IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'case_not_found', 'messageId', p_message_id); END IF;
  SELECT * INTO v_case FROM private.auto_engine_error_cases WHERE case_key = v_key FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'case_not_found', 'messageId', p_message_id); END IF;

  IF p_skip THEN
    -- Ca đang được kiểm (queued) thì chờ báo cáo về rồi mới bỏ qua: bước chép báo cáo chỉ nhận ca 'queued'.
    IF v_case.status NOT IN ('new', 'reported', 'failed') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'status_' || v_case.status, 'khoa', v_key);
    END IF;
    UPDATE private.auto_engine_error_cases SET status = 'muted', note = 'Bỏ qua theo người vận hành lúc ' || v_at || ' (câu ' || p_message_id || ')',
           updated_at = now() WHERE case_key = v_key;
  ELSE
    IF v_case.status <> 'muted' THEN RETURN jsonb_build_object('ok', false, 'code', 'not_muted', 'khoa', v_key, 'status', v_case.status); END IF;
    UPDATE private.auto_engine_error_cases SET status = CASE WHEN v_case.report_at IS NOT NULL THEN 'reported' ELSE 'new' END,
           note = 'Bỏ chế độ bỏ qua lúc ' || v_at, updated_at = now() WHERE case_key = v_key;
  END IF;

  SELECT CASE WHEN s.value IS NULL OR btrim(s.value) = '' THEN '{}'::jsonb ELSE s.value::jsonb END INTO v_cfg
    FROM public.auto_system_settings s WHERE s.key = 'engine.error_watch';
  v_threshold := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'skipReopenHits24h', 30)::integer, 1), 100000);
  SELECT count(*) INTO v_n FROM private.auto_engine_error_items i WHERE i.case_key = v_key AND i.occurred_at > now() - interval '24 hours';
  RETURN jsonb_build_object('ok', true, 'khoa', v_key, 'ma', v_case.public_code, 'status', CASE WHEN p_skip THEN 'muted'
           WHEN v_case.report_at IS NOT NULL THEN 'reported' ELSE 'new' END, 'hits24h', v_n, 'reopenHits24h', v_threshold);
END $f$;
REVOKE ALL ON FUNCTION private.aka_agent_engine_error_case_skip_v1(bigint, boolean) FROM PUBLIC;
COMMENT ON FUNCTION private.aka_agent_engine_error_case_skip_v1(bigint, boolean) IS
  'V594: lệnh "bỏ qua câu N" của hộp thư lỗi. p_skip true: ca của câu sang muted (tick mở lại khi đủ skipReopenHits24h lượt trong 24 giờ); false: trả lại. Chỉ role postgres.';`

const MIGRATION = `-- V594: bộ kiểm lỗi chiến dịch Facebook (docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md mục 14). SINH BẰNG scripts/build-v594-sql.cjs, không sửa tay.
-- Chỉ thay thân hàm tick (md5 ${V593_BODY_MD5} → ${NEW_BODY_MD5}), theo cách anh chốt 20/11/2026:
--   * Tối đa maxPerHour câu mỗi giờ đồng hồ (đặt 2 trong engine.error_watch; bỏ trống = như V593), cùng trần maxPerDay mỗi ngày.
--   * Ca anh "bỏ qua" (status muted, do lệnh hộp thư ghi) tự mở lại để kiểm lại khi trong 24 giờ có từ skipReopenHits24h lượt
--     (mặc định 30) trên toàn hệ thống; câu hỏi ghi rõ ca được mở lại.
--   * Bước hỏi tiếp khi ảnh về chỉ nhận ca đã có báo cáo; ca câu trước hỏng thì được hỏi bằng câu đầy đủ kèm ảnh (V593 hỏi bằng câu ngắn).
--   * Thêm hàm private.aka_agent_engine_error_case_skip_v1 cho lệnh "bỏ qua câu N" của hộp thư (chỉ role postgres gọi được).
-- Không đổi bảng hay thiết lập. CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
-- Gỡ: rollback_v594_engine_error_watch_hourly_skip.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v594_%') THEN
      RAISE EXCEPTION 'V594: sổ migration đã có V594, không apply lại';
    END IF;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V593_BODY_MD5}' THEN
    RAISE EXCEPTION 'V594: thân hàm tick đang chạy có md5 % (chờ bản V593 ${V593_BODY_MD5})', v_md5;
  END IF;
  IF to_regclass('private.auto_engine_error_items') IS NULL THEN
    RAISE EXCEPTION 'V594: thiếu bảng lượt lỗi của V588';
  END IF;
  IF to_regprocedure('private.aka_agent_engine_error_case_skip_v1(bigint,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'V594: đã có hàm private.aka_agent_engine_error_case_skip_v1';
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${NEW_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V594};

${SKIP_FN}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN RAISE EXCEPTION 'V594: thân hàm tick sau khi thay có md5 % (chờ ${NEW_BODY_MD5})', v_md5; END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V594: hàm tick mất SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
         AND has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V594: quyền của hàm tick sau khi apply không đúng';
  END IF;
  IF has_function_privilege('anon', 'private.aka_agent_engine_error_case_skip_v1(bigint,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.aka_agent_engine_error_case_skip_v1(bigint,boolean)', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
         AND has_function_privilege('aka_agent_desktop', 'private.aka_agent_engine_error_case_skip_v1(bigint,boolean)', 'EXECUTE'))
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api')
         AND has_function_privilege('aka_agent_chat_api', 'private.aka_agent_engine_error_case_skip_v1(bigint,boolean)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V594: hàm bỏ qua ca không được cấp quyền cho role của app';
  END IF;
END $post$;

COMMIT;
`

const ROLLBACK = `-- Gỡ V594 (bộ kiểm lỗi chiến dịch Facebook). SINH BẰNG scripts/build-v594-sql.cjs, không sửa tay.
-- Trả hàm tick về thân V593. Ca đang bỏ qua (status muted) giữ nguyên và không tự mở lại nữa. Tắt riêng trần mỗi giờ không cần gỡ: bỏ
-- "maxPerHour" khỏi engine.error_watch.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V594: thân hàm tick đang chạy (md5 %) không phải bản V594; có migration sau đã sửa hàm, gỡ bản đó trước', v_md5;
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${OLD_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V593};
DROP FUNCTION IF EXISTS private.aka_agent_engine_error_case_skip_v1(bigint, boolean);

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V593_BODY_MD5}' THEN RAISE EXCEPTION 'Gỡ V594: thân hàm tick sau khi gỡ có md5 % (chờ ${V593_BODY_MD5})', v_md5; END IF;
END $post$;

COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(MIGRATIONS, 'migration_v594_engine_error_watch_hourly_skip.sql'), MIGRATION)
  fs.writeFileSync(path.join(MIGRATIONS, 'rollback_v594_engine_error_watch_hourly_skip.sql'), ROLLBACK)
  console.log(`migration_v594_engine_error_watch_hourly_skip.sql  md5 ${md5(MIGRATION)}  (${MIGRATION.length} ký tự)`)
  console.log(`rollback_v594_engine_error_watch_hourly_skip.sql   md5 ${md5(ROLLBACK)}`)
  console.log(`thân hàm tick: V593 ${V593_BODY_MD5} → V594 ${NEW_BODY_MD5}`)
}
module.exports = { V593_BODY_MD5, NEW_BODY_MD5 }
