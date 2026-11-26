// Sinh migration V661 và bản gỡ: bộ canh "tăng bất thường" của bộ kiểm lỗi chiến dịch Facebook đếm số lượt data, không đếm số dòng kết quả
// (anh chọn "Đếm theo data, mọi mã" 26/11/2026, câu 6279; câu 3300 / 6279 báo tăng bất thường nhầm vì cách đếm cũ).
//   node scripts/build-v661-sql.cjs
// Lý do: bước 1 của tick ghi private.auto_engine_error_hourly bằng count(*) các dòng auto_engine_outcomes; một data đăng nhóm có bài chờ duyệt
// sinh 20 dòng FB45 (comment#0…#19) nên 3 data mỗi giờ thành 60 "lượt" (câu 6279, chiến dịch 62576), một data 3 comment thành 3 lượt (câu 3300,
// tổ chức 729). Bước 4 so giờ hiện tại với trung bình cùng giờ 7 ngày trước theo số này.
// Sửa: đếm số lượt data khác nhau (target_run_id) theo mã / thao tác / giờ; lượt data đã có dòng cùng mã / thao tác trong cùng giờ ở lần tick
// trước (created_at <= v_from) thì không đếm lại, để một data có dòng rơi vào hai lần tick (tick 2 phút) chỉ tính một lần. Dòng không có
// target_run_id (không có trên production) tính riêng từng dòng như cũ. Phần gom ca (hits của ca "mã chưa có kết luận") không đổi.
// Mức nền 7 ngày trước V661 đếm theo dòng nên cao hơn số mới: tới khi đủ 7 ngày đếm mới, bộ canh có thể báo ít hơn (anh đã biết khi chọn).
// Thân hàm tick mới = thân V602 (đọc từ migration_v602_engine_error_watch_stale_via.sql, md5 trùng production đọc 26/11/2026 10:40 VN)
// + các chỗ vá ở PATCHES. Không sửa tay hai tệp SQL sinh ra; sửa ở đây rồi sinh lại. Sau khi đã apply thì không sinh lại nữa, viết migration mới.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'migrations')
const V602 = fs.readFileSync(path.join(MIGRATIONS, 'migration_v602_engine_error_watch_stale_via.sql'), 'utf8')
const V602_BODY_MD5 = 'ca0aa05adb6ef6eb4ea73116db7335fd' // md5(prosrc) trên production đọc 26/11/2026 10:40 VN (bản V602, không migration nào sửa sau)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const TICK_HEAD = `FUNCTION public.aka_agent_engine_error_watch_tick_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '20s' AS $f$`

function tickBody() {
  const head = 'CREATE OR REPLACE ' + TICK_HEAD
  const a = V602.indexOf(head)
  if (a < 0) throw new Error('Không tìm thấy khai báo hàm tick trong V602')
  const b = a + head.length
  const e = V602.indexOf('$f$;', b)
  if (e < 0) throw new Error('Không tìm thấy cuối thân hàm tick trong V602')
  const body = V602.slice(b, e)
  if (md5(body) !== V602_BODY_MD5) throw new Error(`Thân hàm tick V602 lệch md5: ${md5(body)}`)
  return body
}

function commentV602() {
  const head = 'COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS\n  '
  const a = V602.indexOf(head)
  if (a < 0) throw new Error('Không tìm thấy chú thích hàm tick trong V602')
  const b = a + head.length
  const e = V602.indexOf(';\n', b)
  const comment = V602.slice(b, e)
  if (!comment.startsWith(`'V574 + V588 + V593 + V594 + V599 + V602:`) || !comment.endsWith(`'`)) throw new Error('Chú thích hàm tick V602 đã đổi')
  return comment
}

/** Mỗi chỗ vá: đoạn cũ phải có đúng một lần trong thân V602. */
const PATCHES = [
  ['số theo giờ đếm lượt data', `      SELECT 'facebook', f.error_code, coalesce(f.action_code, ''), date_trunc('hour', f.created_at), count(*)
        FROM fbo f GROUP BY 2, 3, 4
`, `      -- V661 (26/11/2026, câu 3300 / 6279): đếm số lượt data khác nhau, không đếm số dòng kết quả (một data đăng nhóm có 20 comment bị bỏ qua
      -- từng thành 20 lượt FB45). Lượt data đã có dòng cùng mã / thao tác trong cùng giờ ở lần tick trước thì không đếm lại.
      SELECT 'facebook', f.error_code, coalesce(f.action_code, ''), date_trunc('hour', f.created_at),
             count(DISTINCT coalesce(f.target_run_id::text, 'dòng:' || f.result_key))
        FROM fbo f
       WHERE f.target_run_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes p
                          WHERE p.target_run_id = f.target_run_id AND NOT p.ok AND p.error_code = f.error_code
                            AND coalesce(p.action_code, '') = coalesce(f.action_code, '')
                            AND p.created_at >= date_trunc('hour', f.created_at) AND p.created_at <= v_from)
       GROUP BY 2, 3, 4
`],
  ['chú thích bước 4', `  -- 4. Mã đã có kết luận tăng bất thường: giờ hiện tại >= 20 lượt và >= 3 lần trung bình cùng giờ của 7 ngày trước (cần >= 3 ngày dữ liệu).
`, `  -- 4. Mã đã có kết luận tăng bất thường: giờ hiện tại >= 20 lượt và >= 3 lần trung bình cùng giờ của 7 ngày trước (cần >= 3 ngày dữ liệu).
  --    Từ V661 "lượt" là số lượt data khác nhau (trước V661 là số dòng kết quả).
`]
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
const COMMENT_V602 = commentV602()
const COMMENT_V661 = COMMENT_V602.replace(`'V574 + V588 + V593 + V594 + V599 + V602:`, `'V574 + V588 + V593 + V594 + V599 + V602 + V661:`)
  .replace(/'$/, ` V661: số theo giờ của bộ canh tăng bất thường đếm số lượt data khác nhau, không đếm số dòng kết quả.'`)

const MIGRATION = `-- V661: bộ canh "tăng bất thường" của bộ kiểm lỗi chiến dịch Facebook đếm số lượt data, không đếm số dòng kết quả. SINH BẰNG
-- scripts/build-v661-sql.cjs, không sửa tay. Anh chọn "Đếm theo data, mọi mã" 26/11/2026 (câu 6279). Tới V602, bước 1 của tick ghi
-- private.auto_engine_error_hourly bằng số dòng auto_engine_outcomes: một data đăng nhóm có 20 comment bị bỏ qua thành 20 lượt FB45, câu 3300 /
-- 6279 báo tăng bất thường nhầm vì vậy. Từ V661: số lượt data khác nhau theo mã / thao tác / giờ; lượt data đã có dòng cùng mã / thao tác trong
-- cùng giờ ở lần tick trước thì không đếm lại (tra theo chỉ mục auto_engine_outcomes_run_v495). Gom ca, hits của ca, thiết lập không đổi.
-- Số theo giờ đã ghi trước V661 giữ nguyên (mức nền 7 ngày đầu cao hơn số mới).
-- Thân hàm tick: md5 ${V602_BODY_MD5} → ${NEW_BODY_MD5}. Không đổi bảng. CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema:
-- apply ngoài giờ cao điểm, vào phút lẻ (tick chạy giây :00 của phút chẵn). Gỡ: rollback_v661_engine_error_watch_spike_per_data.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v661_%') THEN
      RAISE EXCEPTION 'V661: sổ migration đã có V661, không apply lại';
    END IF;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V602_BODY_MD5}' THEN
    RAISE EXCEPTION 'V661: thân hàm tick đang chạy có md5 % (chờ bản V602 ${V602_BODY_MD5})', v_md5;
  END IF;
  IF to_regclass('public.auto_engine_outcomes_run_v495') IS NULL THEN
    RAISE EXCEPTION 'V661: thiếu chỉ mục auto_engine_outcomes_run_v495 (target_run_id)';
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${NEW_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V661};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN RAISE EXCEPTION 'V661: thân hàm tick sau khi thay có md5 % (chờ ${NEW_BODY_MD5})', v_md5; END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V661: hàm tick mất SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
         AND has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V661: quyền của hàm tick sau khi apply không đúng';
  END IF;
END $post$;

COMMIT;
`

const ROLLBACK = `-- Gỡ V661 (bộ canh tăng bất thường đếm theo lượt data). SINH BẰNG scripts/build-v661-sql.cjs, không sửa tay.
-- Trả hàm tick về thân V602: số theo giờ lại đếm số dòng kết quả. Số đã ghi sau V661 giữ nguyên.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V661: thân hàm tick đang chạy (md5 %) không phải bản V661; có migration sau đã sửa hàm, gỡ bản đó trước', v_md5;
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${OLD_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V602};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V602_BODY_MD5}' THEN RAISE EXCEPTION 'Gỡ V661: thân hàm tick sau khi gỡ có md5 % (chờ ${V602_BODY_MD5})', v_md5; END IF;
END $post$;

COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(MIGRATIONS, 'migration_v661_engine_error_watch_spike_per_data.sql'), MIGRATION)
  fs.writeFileSync(path.join(MIGRATIONS, 'rollback_v661_engine_error_watch_spike_per_data.sql'), ROLLBACK)
  console.log(`migration_v661_engine_error_watch_spike_per_data.sql  md5 ${md5(MIGRATION)}  (${MIGRATION.length} ký tự)`)
  console.log(`rollback_v661_engine_error_watch_spike_per_data.sql   md5 ${md5(ROLLBACK)}`)
  console.log(`thân hàm tick: V602 ${V602_BODY_MD5} → V661 ${NEW_BODY_MD5}`)
}
module.exports = { V602_BODY_MD5, NEW_BODY_MD5 }
