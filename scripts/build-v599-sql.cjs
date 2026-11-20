// Sinh migration V599 và bản gỡ: bộ kiểm lỗi chiến dịch Facebook xin ảnh lỗi từ nhiều lượt cho mỗi ca (anh chốt 20/11/2026 "Sửa cả tick xin ảnh").
//   node scripts/build-v599-sql.cjs
// Lý do: tới V594 tick chỉ xin ảnh cho đúng một lượt mỗi ca. Câu 585 (FB42 "Form đăng bài chưa đóng") có 1 ảnh nên phiên cloud đề xuất một mã;
// 6 ảnh session sửa ca xin thêm cho thấy 4 tình huống khác nhau (V597 tách ba mã).
// Thân hàm tick mới = thân V594 (đọc từ migration_v594_engine_error_watch_hourly_skip.sql, md5 thân trùng production đọc 20/11/2026 14:25 VN)
// + các chỗ vá ở PATCHES. Không sửa tay hai tệp SQL sinh ra; sửa ở đây rồi sinh lại. Sau khi đã apply thì không sinh lại nữa, viết migration mới.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'migrations')
const V594 = fs.readFileSync(path.join(MIGRATIONS, 'migration_v594_engine_error_watch_hourly_skip.sql'), 'utf8')
const V594_BODY_MD5 = '022dfb368b5e71c4a38e87d0ef8f6bd9' // md5(prosrc) trên production đọc 20/11/2026 (sau V594, V595 không đổi hàm tick)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const TICK_HEAD = `FUNCTION public.aka_agent_engine_error_watch_tick_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '20s' AS $f$`

function tickBody() {
  const head = 'CREATE OR REPLACE ' + TICK_HEAD
  const a = V594.indexOf(head)
  if (a < 0) throw new Error('Không tìm thấy khai báo hàm tick trong V594')
  const b = a + head.length
  const e = V594.indexOf('$f$;', b)
  if (e < 0) throw new Error('Không tìm thấy cuối thân hàm tick trong V594')
  const body = V594.slice(b, e)
  if (md5(body) !== V594_BODY_MD5) throw new Error(`Thân hàm tick V594 lệch md5: ${md5(body)}`)
  return body
}

// Danh sách mã yêu cầu ảnh của ca: cột mới image_request_ids; ca xin ảnh trước V599 chỉ có image_request_id.
const REQ_IDS = String.raw`CASE WHEN cs.image_request_id IS NULL THEN '{}'::bigint[]
                       WHEN coalesce(array_length(cs.image_request_ids, 1), 0) > 0 THEN cs.image_request_ids
                       ELSE ARRAY[cs.image_request_id] END`

/** Mỗi chỗ vá: đoạn cũ phải có đúng một lần trong thân V594. */
const PATCHES = [
  ['khai báo biến', `  v_req_status text;
`, `  v_req_status text;
  -- V599: xin ảnh từ nhiều lượt mỗi ca
  v_image_runs integer;
  v_shot record;
  v_req_ids bigint[];
  v_wait_pending integer;
  v_wait_pending_all integer;
  v_req_list text;
`],

  ['đọc số lượt lấy ảnh mỗi ca', `    v_max_hour := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'maxPerHour', 0)::integer, 0), 10);
`, `    v_max_hour := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'maxPerHour', 0)::integer, 0), 10);
    -- V599: số lượt lấy ảnh lỗi cho mỗi ca, mỗi lượt của một nhân viên khác nhau (mặc định 5, từ 1 tới 10).
    v_image_runs := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageRunsPerCase', 5)::integer, 1), 10);
`],

  // Bước 6a: ca đã có báo cáo, ảnh về sau thì hỏi tiếp. Một ca có thể có nhiều yêu cầu (mỗi máy khách một yêu cầu).
  ['bước 6a đọc mọi yêu cầu ảnh của ca', String.raw`      SELECT q.status, (SELECT count(*) FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id)
        INTO v_req_status, v_files FROM public.auto_desktop_diagnostic_requests q WHERE q.id = cs.image_request_id;
      IF v_req_status IS NULL OR v_req_status IN ('no_images', 'expired', 'failed') OR (v_req_status = 'done' AND v_files = 0) THEN
        UPDATE private.auto_engine_error_cases SET image_followup_at = v_now, note = 'Yêu cầu ảnh kết thúc không có ảnh', updated_at = v_now WHERE case_key = cs.case_key;
        CONTINUE;
      END IF;
      CONTINUE WHEN v_req_status <> 'done' OR v_slots <= 0;
      v_request := md5(cs.case_key || ':anh:' || cs.image_request_id)::uuid;
      v_question := '[Tự động] Đã có ' || v_files || ' ảnh lỗi từ máy khách cho ca này (yêu cầu ảnh ' || cs.image_request_id || E').\n'
        || 'khoa: ' || cs.case_key || E'\n' || 'Xem ảnh rồi bổ sung kết luận; chỉ báo điều mới so với báo cáo trước.';`,
  String.raw`      -- V599: mọi yêu cầu ảnh của ca. Chưa có ảnh nào mà mọi yêu cầu đã kết thúc thì thôi. Có ảnh thì hỏi khi không còn yêu cầu nào đang
      -- chờ dưới 60 phút (máy khách tắt thì yêu cầu chờ tới 7 ngày; không đợi máy đó).
      v_req_ids := ${REQ_IDS};
      SELECT count(*) FILTER (WHERE q.status IN ('pending', 'uploading') AND q.created_at > v_now - interval '60 minutes'),
             count(*) FILTER (WHERE q.status IN ('pending', 'uploading')),
             coalesce(sum(fc.n) FILTER (WHERE q.status = 'done'), 0)
        INTO v_wait_pending, v_wait_pending_all, v_files
        FROM public.auto_desktop_diagnostic_requests q
        CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id) fc
       WHERE q.id = ANY (v_req_ids);
      IF v_files = 0 AND v_wait_pending_all = 0 THEN
        UPDATE private.auto_engine_error_cases SET image_followup_at = v_now, note = 'Yêu cầu ảnh kết thúc không có ảnh', updated_at = v_now WHERE case_key = cs.case_key;
        CONTINUE;
      END IF;
      CONTINUE WHEN v_files = 0 OR v_wait_pending > 0 OR v_slots <= 0;
      v_req_list := array_to_string(v_req_ids, ', ');
      v_request := md5(cs.case_key || ':anh:' || cs.image_request_id)::uuid;
      v_question := '[Tự động] Đã có ' || v_files || ' ảnh lỗi từ máy khách cho ca này (yêu cầu ảnh ' || v_req_list || E').\n'
        || 'khoa: ' || cs.case_key || E'\n' || 'yeu cau anh: ' || v_req_list || E'\n'
        || 'Xem ảnh rồi bổ sung kết luận; chỉ báo điều mới so với báo cáo trước.';`],

  // Bước 6b: xin ảnh lần đầu cho ca.
  ['bước 6b xin ảnh từ nhiều lượt', String.raw`      -- Ảnh lỗi cho ca chưa phân loại: mỗi ca một yêu cầu, mỗi nhân viên khách một yêu cầu mỗi ngày, ngừng khi bảng ảnh vượt trần dung lượng.
      IF v_images AND cs.kind <> 'luot_bo_do' AND cs.image_request_id IS NULL AND cs.screenshot_run IS NOT NULL THEN
        SELECT r.staff_id INTO v_shot_staff FROM public.auto_engine_target_runs r WHERE r.id = cs.screenshot_run;
        IF v_shot_staff IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.auto_desktop_diagnostic_requests q
                            WHERE q.staff_id = v_shot_staff AND q.requested_by = 'error-watch' AND q.created_at >= v_vn_start)
           AND pg_total_relation_size('public.auto_desktop_diagnostic_files'::regclass) <= v_image_cap_mb * 1048576 THEN
          BEGIN
            v_req_id := public.aka_agent_desktop_diagnostic_request_v1(v_shot_staff, jsonb_build_object('targetRunId', cs.screenshot_run), 'error-watch');
            cs.image_request_id := v_req_id;
            v_image_requests := v_image_requests + 1;
            UPDATE private.auto_engine_error_cases SET image_request_id = v_req_id, updated_at = v_now WHERE case_key = cs.case_key;
          EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped || jsonb_build_object('khoa', cs.case_key, 'ly_do', 'xin_anh: ' || SQLERRM);
          END;
        END IF;
      END IF;
`, String.raw`      -- V599: ảnh lỗi từ tối đa imageRunsPerCase lượt có ảnh của ca, mỗi lượt của một nhân viên khác nhau (một ảnh chỉ cho thấy một tình huống:
      -- câu 585 có 4 tình huống trong 6 ảnh). Lấy trong 300 lượt gần nhất của ca trong 3 ngày, cộng lượt screenshot_run; ưu tiên nhân viên đang mở
      -- app, rồi lượt mới nhất. Mỗi nhân viên khách vẫn chỉ một yêu cầu mỗi ngày; ngừng khi bảng ảnh vượt trần dung lượng.
      IF v_images AND cs.kind <> 'luot_bo_do' AND cs.image_request_id IS NULL AND cs.screenshot_run IS NOT NULL THEN
        v_req_ids := '{}'::bigint[];
        FOR v_shot IN
          SELECT c.target_run_id, c.staff_id FROM (
            SELECT DISTINCT ON (x.staff_id) x.target_run_id, x.staff_id, x.occurred_at
              FROM (
                SELECT i.target_run_id, i.staff_id, i.occurred_at
                  FROM (SELECT i0.target_run_id, i0.staff_id, i0.occurred_at, i0.result_key
                          FROM private.auto_engine_error_items i0
                         WHERE i0.case_key = cs.case_key AND i0.occurred_at > v_now - interval '3 days'
                         ORDER BY i0.occurred_at DESC LIMIT 300) i
                 WHERE i.staff_id IS NOT NULL AND i.target_run_id IS NOT NULL
                   AND EXISTS (SELECT 1 FROM public.auto_engine_outcomes o WHERE o.result_key = i.result_key AND o.signal ? 'screenshotId')
                UNION ALL
                SELECT r.id, r.staff_id, r.started_at FROM public.auto_engine_target_runs r WHERE r.id = cs.screenshot_run AND r.staff_id IS NOT NULL
              ) x
             ORDER BY x.staff_id, x.occurred_at DESC) c
           WHERE NOT EXISTS (SELECT 1 FROM public.auto_desktop_diagnostic_requests q
                              WHERE q.staff_id = c.staff_id AND q.requested_by = 'error-watch' AND q.created_at >= v_vn_start)
           ORDER BY EXISTS (SELECT 1 FROM public.auto_staff_device_presence p
                             WHERE p.staff_id = c.staff_id AND p.ended_at IS NULL AND p.last_seen_at > v_now - interval '5 minutes') DESC,
                    c.occurred_at DESC, c.target_run_id DESC
           LIMIT v_image_runs
        LOOP
          EXIT WHEN pg_total_relation_size('public.auto_desktop_diagnostic_files'::regclass) > v_image_cap_mb * 1048576;
          BEGIN
            v_req_id := public.aka_agent_desktop_diagnostic_request_v1(v_shot.staff_id, jsonb_build_object('targetRunId', v_shot.target_run_id), 'error-watch');
            v_req_ids := v_req_ids || v_req_id;
            v_image_requests := v_image_requests + 1;
          EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped || jsonb_build_object('khoa', cs.case_key, 'ly_do', 'xin_anh: ' || SQLERRM);
          END;
        END LOOP;
        IF coalesce(array_length(v_req_ids, 1), 0) > 0 THEN
          cs.image_request_id := v_req_ids[1];
          cs.image_request_ids := v_req_ids;
          UPDATE private.auto_engine_error_cases SET image_request_id = v_req_ids[1], image_request_ids = v_req_ids, updated_at = v_now
           WHERE case_key = cs.case_key;
        END IF;
      END IF;
`],

  // Bước 6b: chờ ảnh về trước khi hỏi (V593), nay chờ mọi yêu cầu của ca.
  ['bước 6b chờ mọi yêu cầu ảnh', String.raw`      v_images_ready := false;
      IF cs.image_request_id IS NOT NULL AND cs.image_followup_at IS NULL THEN
        v_wait_status := NULL; v_wait_created := NULL; v_wait_files := 0;
        SELECT q.status, q.created_at, (SELECT count(*) FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id)
          INTO v_wait_status, v_wait_created, v_wait_files FROM public.auto_desktop_diagnostic_requests q WHERE q.id = cs.image_request_id;
        v_images_ready := coalesce(v_wait_status = 'done' AND v_wait_files > 0, false);
        IF v_image_wait > 0 AND v_wait_status IN ('pending', 'uploading') AND v_wait_created > v_now - make_interval(mins => v_image_wait) THEN
          v_image_waiting := v_image_waiting + 1;
          CONTINUE;
        END IF;
      END IF;
`, String.raw`      v_images_ready := false;
      v_req_ids := ${REQ_IDS};
      IF cs.image_request_id IS NOT NULL AND cs.image_followup_at IS NULL THEN
        -- V599: chờ tới khi mọi yêu cầu của ca xong, hoặc quá imageWaitMinutes phút; rồi hỏi với các ảnh đã về.
        SELECT count(*) FILTER (WHERE q.status IN ('pending', 'uploading') AND q.created_at > v_now - make_interval(mins => v_image_wait)),
               coalesce(sum(fc.n) FILTER (WHERE q.status = 'done'), 0)
          INTO v_wait_pending, v_wait_files
          FROM public.auto_desktop_diagnostic_requests q
          CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id) fc
         WHERE q.id = ANY (v_req_ids);
        v_images_ready := v_wait_files > 0;
        IF v_image_wait > 0 AND v_wait_pending > 0 THEN
          v_image_waiting := v_image_waiting + 1;
          CONTINUE;
        END IF;
      END IF;
`],

  ['câu hỏi liệt kê mọi yêu cầu ảnh', String.raw`        || CASE WHEN cs.image_request_id IS NOT NULL THEN E'\nyeu cau anh: ' || cs.image_request_id ELSE '' END
        || CASE WHEN v_images_ready THEN E'\nanh da ve: ' || v_wait_files || ' ảnh, xem bằng public.aka_agent_desktop_diagnostic_files_v1('
             || cs.image_request_id || ')' ELSE '' END;`,
  String.raw`        || CASE WHEN cs.image_request_id IS NOT NULL THEN E'\nyeu cau anh: ' || array_to_string(v_req_ids, ', ') ELSE '' END
        || CASE WHEN v_images_ready THEN E'\nanh da ve: ' || v_wait_files || ' ảnh, xem bằng public.aka_agent_desktop_diagnostic_files_v1(<mã yêu cầu>)'
             || ' với từng mã ở dòng yeu cau anh' ELSE '' END;`],

  ['intake ghi mọi yêu cầu ảnh', `'luot_mau', to_jsonb(cs.sample_runs), 'yeu_cau_anh', cs.image_request_id, 'anh_da_ve', v_images_ready);`,
    `'luot_mau', to_jsonb(cs.sample_runs), 'yeu_cau_anh', cs.image_request_id, 'yeu_cau_anh_ds', to_jsonb(v_req_ids), 'anh_da_ve', v_images_ready);`]
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
const COMMENT_V594 = `'V574 + V588 + V593 + V594: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca và lỗi theo lượt), enqueue (chèn câu vào Hỏi đáp AI), maxPerHour / maxPerDay (trần câu mỗi giờ / mỗi ngày), imageRequests (xin ảnh lỗi), imageWaitMinutes (chờ ảnh về trước khi hỏi, mặc định 15, 0 = hỏi ngay), skipReopenHits24h (ca bỏ qua mở lại khi đủ số lượt trong 24 giờ, mặc định 30), fire (đánh thức tác vụ cloud). V588: chép kết luận về sổ ca, ghi câu cho khách đã duyệt. V593: chọn ca theo mức ảnh hưởng (kể cả ca gửi lại), xin ảnh cho mọi loại ca có ảnh. V594: trần mỗi giờ, mở lại ca bỏ qua, hỏi tiếp vì ảnh chỉ với ca đã có báo cáo.'`
const COMMENT_V599 = `'V574 + V588 + V593 + V594 + V599: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca và lỗi theo lượt), enqueue (chèn câu vào Hỏi đáp AI), maxPerHour / maxPerDay (trần câu mỗi giờ / mỗi ngày), imageRequests (xin ảnh lỗi), imageRunsPerCase (số lượt lấy ảnh mỗi ca, mỗi lượt một nhân viên khác nhau, mặc định 5), imageWaitMinutes (chờ ảnh về trước khi hỏi, mặc định 15, 0 = hỏi ngay), skipReopenHits24h (ca bỏ qua mở lại khi đủ số lượt trong 24 giờ, mặc định 30), fire (đánh thức tác vụ cloud). V588: chép kết luận về sổ ca, ghi câu cho khách đã duyệt. V593: chọn ca theo mức ảnh hưởng (kể cả ca gửi lại), xin ảnh cho mọi loại ca có ảnh. V594: trần mỗi giờ, mở lại ca bỏ qua, hỏi tiếp vì ảnh chỉ với ca đã có báo cáo. V599: xin ảnh từ nhiều lượt mỗi ca (cột image_request_ids).'`
if (!V594.includes(`COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS\n  ${COMMENT_V594};`)) throw new Error('Chú thích hàm tick V594 đã đổi')

const MIGRATION = `-- V599: bộ kiểm lỗi chiến dịch Facebook xin ảnh lỗi từ nhiều lượt mỗi ca. SINH BẰNG scripts/build-v599-sql.cjs, không sửa tay.
-- Anh chốt 20/11/2026 ("Sửa cả tick xin ảnh"). Tới V594 tick xin ảnh cho đúng một lượt mỗi ca; câu 585 có 1 ảnh trong khi 6 ảnh cho thấy 4 tình huống.
--   * Thêm cột private.auto_engine_error_cases.image_request_ids (mọi mã yêu cầu ảnh của ca); image_request_id giữ mã đầu tiên như cũ.
--   * Ca được hỏi lần đầu: xin ảnh từ tối đa imageRunsPerCase lượt (mặc định 5), mỗi lượt của một nhân viên khác nhau, ưu tiên nhân viên đang mở
--     app. Mỗi nhân viên khách vẫn một yêu cầu mỗi ngày; dừng khi bảng ảnh vượt imageMaxTableMb.
--   * Chờ mọi yêu cầu xong hoặc quá imageWaitMinutes phút rồi mới hỏi; câu hỏi ghi mọi mã yêu cầu ở dòng "yeu cau anh".
--   * Hỏi tiếp vì ảnh (ca đã có báo cáo): khi có ảnh và không còn yêu cầu nào chờ dưới 60 phút.
-- Thân hàm tick: md5 ${V594_BODY_MD5} → ${NEW_BODY_MD5}. Không đổi thiết lập. ALTER TABLE + CREATE OR REPLACE FUNCTION làm PostgREST nạp
-- lại schema: apply ngoài giờ cao điểm, vào phút lẻ (tick chạy giây :00 của phút chẵn). Gỡ: rollback_v599_engine_error_watch_multi_images.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v599_%') THEN
      RAISE EXCEPTION 'V599: sổ migration đã có V599, không apply lại';
    END IF;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V594_BODY_MD5}' THEN
    RAISE EXCEPTION 'V599: thân hàm tick đang chạy có md5 % (chờ bản V594 ${V594_BODY_MD5})', v_md5;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'private' AND table_name = 'auto_engine_error_cases' AND column_name = 'image_request_ids') THEN
    RAISE EXCEPTION 'V599: sổ ca đã có cột image_request_ids';
  END IF;
  IF to_regclass('public.auto_staff_device_presence') IS NULL OR to_regclass('private.auto_engine_error_items') IS NULL THEN
    RAISE EXCEPTION 'V599: thiếu bảng presence hoặc bảng lượt lỗi';
  END IF;
END $pre$;

ALTER TABLE private.auto_engine_error_cases ADD COLUMN image_request_ids bigint[] NOT NULL DEFAULT '{}'::bigint[];
COMMENT ON COLUMN private.auto_engine_error_cases.image_request_ids IS
  'V599: mọi mã yêu cầu ảnh lỗi của ca (mỗi máy khách một yêu cầu); image_request_id là mã đầu tiên.';
UPDATE private.auto_engine_error_cases SET image_request_ids = ARRAY[image_request_id] WHERE image_request_id IS NOT NULL;

CREATE OR REPLACE ${TICK_HEAD}${NEW_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V599};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN RAISE EXCEPTION 'V599: thân hàm tick sau khi thay có md5 % (chờ ${NEW_BODY_MD5})', v_md5; END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V599: hàm tick mất SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
         AND has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V599: quyền của hàm tick sau khi apply không đúng';
  END IF;
  IF EXISTS (SELECT 1 FROM private.auto_engine_error_cases WHERE image_request_id IS NOT NULL AND image_request_ids <> ARRAY[image_request_id]) THEN
    RAISE EXCEPTION 'V599: chép mã yêu cầu ảnh cũ sang image_request_ids không khớp';
  END IF;
END $post$;

COMMIT;
`

const ROLLBACK = `-- Gỡ V599 (bộ kiểm lỗi xin ảnh từ nhiều lượt mỗi ca). SINH BẰNG scripts/build-v599-sql.cjs, không sửa tay.
-- Trả hàm tick về thân V594 và bỏ cột image_request_ids. Yêu cầu ảnh đã tạo vẫn còn; ca giữ image_request_id (mã đầu tiên). Muốn chỉ xin một
-- lượt mà không gỡ: đặt "imageRunsPerCase": 1 trong engine.error_watch.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V599: thân hàm tick đang chạy (md5 %) không phải bản V599; có migration sau đã sửa hàm, gỡ bản đó trước', v_md5;
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${OLD_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V594};
ALTER TABLE private.auto_engine_error_cases DROP COLUMN image_request_ids;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V594_BODY_MD5}' THEN RAISE EXCEPTION 'Gỡ V599: thân hàm tick sau khi gỡ có md5 % (chờ ${V594_BODY_MD5})', v_md5; END IF;
END $post$;

COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(MIGRATIONS, 'migration_v599_engine_error_watch_multi_images.sql'), MIGRATION)
  fs.writeFileSync(path.join(MIGRATIONS, 'rollback_v599_engine_error_watch_multi_images.sql'), ROLLBACK)
  console.log(`migration_v599_engine_error_watch_multi_images.sql  md5 ${md5(MIGRATION)}  (${MIGRATION.length} ký tự)`)
  console.log(`rollback_v599_engine_error_watch_multi_images.sql   md5 ${md5(ROLLBACK)}`)
  console.log(`thân hàm tick: V594 ${V594_BODY_MD5} → V599 ${NEW_BODY_MD5}`)
}
module.exports = { V594_BODY_MD5, NEW_BODY_MD5 }
