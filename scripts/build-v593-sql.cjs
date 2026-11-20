// Sinh migration V593 và bản gỡ: bộ kiểm lỗi chiến dịch Facebook chọn ca theo mức ảnh hưởng và cho ảnh lỗi về trước khi hỏi Claude
// (docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md mục 13).
//   node scripts/build-v593-sql.cjs
// Thân hàm tick mới = thân V588 (đọc từ migration_v588_engine_error_review.sql, md5 thân trùng production 20/11/2026) + các chỗ vá ở PATCHES.
// Không sửa tay hai tệp SQL sinh ra; sửa ở đây rồi sinh lại. Sau khi đã apply thì không sinh lại nữa, viết migration mới.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'migrations')
const V588 = fs.readFileSync(path.join(MIGRATIONS, 'migration_v588_engine_error_review.sql'), 'utf8')
const V588_BODY_MD5 = 'b4e8c5008ce2b9c50501c14c66b6c5de' // md5(prosrc) trên production, đọc 20/11/2026
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const TICK_HEAD = `FUNCTION public.aka_agent_engine_error_watch_tick_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '20s' AS $f$`

function tickBody() {
  const head = 'CREATE OR REPLACE ' + TICK_HEAD
  const a = V588.indexOf(head)
  if (a < 0) throw new Error('Không tìm thấy khai báo hàm tick trong V588')
  const b = a + head.length
  const e = V588.indexOf('$f$;', b)
  if (e < 0) throw new Error('Không tìm thấy cuối thân hàm tick trong V588')
  const body = V588.slice(b, e)
  if (md5(body) !== V588_BODY_MD5) throw new Error(`Thân hàm tick V588 lệch md5: ${md5(body)}`)
  return body
}

/** Mỗi chỗ vá: đoạn cũ phải có đúng một lần trong thân V588. */
const PATCHES = [
  ['khai báo biến', `  v_image_requests integer := 0;
`, `  v_image_requests integer := 0;
  -- V593: chờ ảnh lỗi về trước khi hỏi
  v_image_wait integer;
  v_image_waiting integer := 0;
  v_wait_status text;
  v_wait_created timestamptz;
  v_wait_files integer;
  v_images_ready boolean;
`],

  ['đọc thời gian chờ ảnh', `    v_image_cap_mb := greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageMaxTableMb', 2048), 0);
`, `    v_image_cap_mb := greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageMaxTableMb', 2048), 0);
    -- V593: số phút chờ ảnh lỗi về trước khi hỏi (0 = hỏi ngay như V588), tối đa 120.
    v_image_wait := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageWaitMinutes', 15)::integer, 0), 120);
`],

  // V588 xếp mọi ca 'failed' (câu trước hết hạn / lỗi) sau mọi ca 'new': sổ còn nhiều ca mới thì ca hỏng không bao giờ tới lượt
  // (20/11/2026: ba ca nặng nhất đều 'failed' từ 19/11). Nay xếp theo mức ảnh hưởng trước; trần gửi lại mỗi ngày (resendPerDay) vẫn giữ.
  ['thứ tự chọn ca theo mức ảnh hưởng', `       ORDER BY (k.status = 'failed'), k.pauses DESC, k.hits DESC, k.first_seen_at`,
    `       ORDER BY k.pauses DESC, k.hits DESC, (k.status = 'failed'), k.first_seen_at`],

  // V588 chỉ xin ảnh cho ca chưa phân loại; ca mã chung (FB42, FB41…) mới là ca cần ảnh nhất. Lượt bị bỏ dở không có ảnh.
  ['xin ảnh cho mọi loại ca có ảnh', `      IF v_images AND cs.kind = 'chua_phan_loai' AND cs.image_request_id IS NULL AND cs.screenshot_run IS NOT NULL THEN`,
    `      IF v_images AND cs.kind <> 'luot_bo_do' AND cs.image_request_id IS NULL AND cs.screenshot_run IS NOT NULL THEN`],

  ['chờ ảnh về trước khi hỏi', `      v_kind_label := CASE cs.kind WHEN 'chua_phan_loai' THEN 'lỗi chưa phân loại'`, `      -- V593: ca đang chờ ảnh lỗi từ máy khách thì chưa hỏi, để Claude có ảnh ngay lượt kiểm đầu (không tốn chỗ trong ngày). Quá
      -- imageWaitMinutes phút mà ảnh chưa về (máy khách tắt…) thì hỏi không có ảnh; ảnh về sau thì bước 6a hỏi tiếp như V588.
      v_images_ready := false;
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

      v_kind_label := CASE cs.kind WHEN 'chua_phan_loai' THEN 'lỗi chưa phân loại'`],

  ['câu hỏi báo ảnh đã về', `        || CASE WHEN cs.image_request_id IS NOT NULL THEN E'\\nyeu cau anh: ' || cs.image_request_id ELSE '' END;`,
    `        || CASE WHEN cs.image_request_id IS NOT NULL THEN E'\\nyeu cau anh: ' || cs.image_request_id ELSE '' END
        || CASE WHEN v_images_ready THEN E'\\nanh da ve: ' || v_wait_files || ' ảnh, xem bằng public.aka_agent_desktop_diagnostic_files_v1('
             || cs.image_request_id || ')' ELSE '' END;`],

  ['intake ghi ảnh đã về', `        'luot_mau', to_jsonb(cs.sample_runs), 'yeu_cau_anh', cs.image_request_id);`,
    `        'luot_mau', to_jsonb(cs.sample_runs), 'yeu_cau_anh', cs.image_request_id, 'anh_da_ve', v_images_ready);`],

  ['đã hỏi kèm ảnh thì không hỏi tiếp vì ảnh', `           SET status = 'queued', thread_id = (v_res ->> 'threadId')::bigint, last_message_id = v_msg_id, last_reported_at = v_now, hits_at_last_report = cs.hits,
`, `           SET status = 'queued', thread_id = (v_res ->> 'threadId')::bigint, last_message_id = v_msg_id, last_reported_at = v_now, hits_at_last_report = cs.hits,
               image_followup_at = CASE WHEN v_images_ready THEN v_now ELSE image_followup_at END,
`],

  ['kết quả tick đếm ca đang chờ ảnh', `'imageRequests', v_image_requests,`, `'imageRequests', v_image_requests, 'imageWaiting', v_image_waiting,`]
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
const COMMENT_V588 = `'V574 + V588: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca và lỗi theo lượt), enqueue (chèn câu vào Hỏi đáp AI), imageRequests (xin ảnh lỗi), fire (đánh thức tác vụ cloud). V588: chép kết luận về sổ ca, ghi câu cho khách đã duyệt.'`
const COMMENT_V593 = `'V574 + V588 + V593: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca và lỗi theo lượt), enqueue (chèn câu vào Hỏi đáp AI), imageRequests (xin ảnh lỗi), imageWaitMinutes (chờ ảnh về trước khi hỏi, mặc định 15, 0 = hỏi ngay), fire (đánh thức tác vụ cloud). V588: chép kết luận về sổ ca, ghi câu cho khách đã duyệt. V593: chọn ca theo mức ảnh hưởng (kể cả ca gửi lại), xin ảnh cho mọi loại ca có ảnh.'`
if (!V588.includes(`COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS\n  ${COMMENT_V588};`)) throw new Error('Chú thích hàm tick V588 đã đổi')

const MIGRATION = `-- V593: bộ kiểm lỗi chiến dịch Facebook (docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md mục 13). SINH BẰNG scripts/build-v593-sql.cjs, không sửa tay.
-- Chỉ thay thân hàm tick (md5 ${V588_BODY_MD5} → ${NEW_BODY_MD5}):
--   * Chọn ca theo mức ảnh hưởng (số lần dừng chiến dịch, số lượt) cả với ca gửi lại; V588 xếp mọi ca 'failed' sau mọi ca 'new' nên ca
--     hỏng nặng nhất không bao giờ tới lượt khi sổ còn ca mới (20/11/2026: FB46, FB42, FB41).
--   * Xin ảnh lỗi cho mọi loại ca có ảnh (V588 chỉ ca chưa phân loại), vẫn mỗi ca một yêu cầu, mỗi khách một yêu cầu mỗi ngày, trần dung lượng.
--   * Chờ ảnh về tối đa imageWaitMinutes phút (mặc định 15) rồi mới hỏi, để Claude có ảnh ngay lượt kiểm đầu; quá hạn thì hỏi không ảnh.
-- Xin ảnh vẫn chỉ chạy khi engine.error_watch có "imageRequests": true. Không đổi bảng, quyền hay thiết lập.
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v593_engine_error_watch_order_images.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v593_%') THEN
      RAISE EXCEPTION 'V593: sổ migration đã có V593, không apply lại';
    END IF;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V588_BODY_MD5}' THEN
    RAISE EXCEPTION 'V593: thân hàm tick đang chạy có md5 % (chờ bản V588 ${V588_BODY_MD5})', v_md5;
  END IF;
  IF to_regclass('public.auto_desktop_diagnostic_requests') IS NULL OR to_regclass('public.auto_desktop_diagnostic_files') IS NULL THEN
    RAISE EXCEPTION 'V593: thiếu bảng yêu cầu ảnh của V556';
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${NEW_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V593};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN RAISE EXCEPTION 'V593: thân hàm tick sau khi thay có md5 % (chờ ${NEW_BODY_MD5})', v_md5; END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V593: hàm tick mất SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
         AND has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V593: quyền của hàm tick sau khi apply không đúng';
  END IF;
END $post$;

COMMIT;
`

const ROLLBACK = `-- Gỡ V593 (bộ kiểm lỗi chiến dịch Facebook). SINH BẰNG scripts/build-v593-sql.cjs, không sửa tay.
-- Trả hàm tick về thân V588. Yêu cầu ảnh đã tạo giữ nguyên (V588 vẫn đọc được). Tắt riêng việc chờ ảnh không cần gỡ: đặt
-- "imageWaitMinutes": 0 trong engine.error_watch.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V593: thân hàm tick đang chạy (md5 %) không phải bản V593; có migration sau đã sửa hàm, gỡ bản đó trước', v_md5;
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${OLD_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V588};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V588_BODY_MD5}' THEN RAISE EXCEPTION 'Gỡ V593: thân hàm tick sau khi gỡ có md5 % (chờ ${V588_BODY_MD5})', v_md5; END IF;
END $post$;

COMMIT;
`

fs.writeFileSync(path.join(MIGRATIONS, 'migration_v593_engine_error_watch_order_images.sql'), MIGRATION)
fs.writeFileSync(path.join(MIGRATIONS, 'rollback_v593_engine_error_watch_order_images.sql'), ROLLBACK)
console.log(`migration_v593_engine_error_watch_order_images.sql  md5 ${md5(MIGRATION)}  (${MIGRATION.length} ký tự)`)
console.log(`rollback_v593_engine_error_watch_order_images.sql   md5 ${md5(ROLLBACK)}`)
console.log(`thân hàm tick: V588 ${V588_BODY_MD5} → V593 ${NEW_BODY_MD5}`)
module.exports = { V588_BODY_MD5, NEW_BODY_MD5 }
