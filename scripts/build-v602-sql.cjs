// Sinh migration V602 và bản gỡ: bộ kiểm lỗi chiến dịch Facebook phân loại lượt bị bỏ dở theo đường đóng lượt (anh chốt 20/11/2026,
// câu 571: "Làm cách em khuyên").
//   node scripts/build-v602-sql.cjs
// Lý do: bước 3 của tick gom mọi lượt đóng `stale` khi máy khách còn mở vào một ca với câu "treo quá lâu". Sự kiện `interrupted` của lượt
// (V576) ghi đường đóng ở data.via: `stale` (lease hết hạn, treo thật), `orphan` (app nhận data kế tiếp cùng lease khi chưa báo xong data này),
// `desktop_reset` (app khởi động lại / đăng nhập lại dọn lượt cũ, data về hàng đợi). 24 giờ tới 15:30 VN 20/11, 3 lượt của câu 571 đều là
// `desktop_reset` (2) và `orphan` (1), không lượt nào treo.
// Sửa: bỏ lượt `desktop_reset` khỏi sổ ca; lượt `orphan` thành ca riêng (khoá thêm "|orphan", câu riêng); lượt `stale` hoặc không có sự kiện
// giữ như cũ.
// Thân hàm tick mới = thân V599 (đọc từ migration_v599_engine_error_watch_multi_images.sql, md5 thân trùng production đọc 20/11/2026 15:55 VN)
// + các chỗ vá ở PATCHES. Không sửa tay hai tệp SQL sinh ra; sửa ở đây rồi sinh lại. Sau khi đã apply thì không sinh lại nữa, viết migration mới.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'migrations')
const V599 = fs.readFileSync(path.join(MIGRATIONS, 'migration_v599_engine_error_watch_multi_images.sql'), 'utf8')
const V599_BODY_MD5 = '2cade73e5b5acb82f76d452bcc3e21da' // md5(prosrc) trên production đọc 20/11/2026 15:55 VN (sau V599)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const TICK_HEAD = `FUNCTION public.aka_agent_engine_error_watch_tick_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '20s' AS $f$`

function tickBody() {
  const head = 'CREATE OR REPLACE ' + TICK_HEAD
  const a = V599.indexOf(head)
  if (a < 0) throw new Error('Không tìm thấy khai báo hàm tick trong V599')
  const b = a + head.length
  const e = V599.indexOf('$f$;', b)
  if (e < 0) throw new Error('Không tìm thấy cuối thân hàm tick trong V599')
  const body = V599.slice(b, e)
  if (md5(body) !== V599_BODY_MD5) throw new Error(`Thân hàm tick V599 lệch md5: ${md5(body)}`)
  return body
}

function commentV599() {
  const head = 'COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS\n  '
  const a = V599.lastIndexOf(head)
  if (a < 0) throw new Error('Không tìm thấy chú thích hàm tick trong V599')
  const b = a + head.length
  const e = V599.indexOf(';\n', b)
  const comment = V599.slice(b, e)
  if (!comment.startsWith(`'V574 + V588 + V593 + V594 + V599:`) || !comment.endsWith(`'`)) throw new Error('Chú thích hàm tick V599 đã đổi')
  return comment
}

const TREO = 'Lượt bị đóng vì treo quá lâu trong khi máy khách vẫn hoạt động'
const ORPHAN = 'Lượt mồ côi: app đã nhận data kế tiếp khi chưa báo xong data này'

/** Mỗi chỗ vá: đoạn cũ phải có đúng một lần trong thân V599. */
const PATCHES = [
  ['chú thích bước 3', `  v_stale_to := v_now - interval '30 minutes';
`, `  --    V602: phân loại theo đường đóng lượt ở sự kiện interrupted (data.via, V576). desktop_reset (app khởi động lại / đăng nhập lại dọn lượt
  --    cũ, data về hàng đợi) không vào sổ ca; orphan (app nhận data kế tiếp cùng lease khi chưa báo xong) thành ca riêng, khoá thêm "|orphan";
  --    stale hoặc không có sự kiện: treo, giữ như cũ.
  v_stale_to := v_now - interval '30 minutes';
`],

  ['lượt bỏ dở theo đường đóng lượt', `    WITH stale_runs AS MATERIALIZED (
      SELECT r.id, r.input_data_id, r.campaign_id, r.account_id, r.staff_id, r.organization_id, r.completed_at, c.action_id, r.final_error_code,
             left('stale|' || c.action_id || '|' || coalesce(r.final_error_code, ''), 700) AS case_key
        FROM public.auto_engine_target_runs r
        JOIN public.auto_campaigns c ON c.id = r.campaign_id
        JOIN public.auto_campaign_actions a ON a.id = c.action_id
       WHERE r.started_at > v_stale_from AND r.started_at <= v_stale_to AND r.close_reason = 'stale' AND a.flatform_type = 'facebook'
         AND EXISTS (SELECT 1 FROM public.auto_staff_device_presence d
                      WHERE d.staff_id = r.staff_id AND d.last_seen_at >= r.completed_at - interval '2 minutes')
    ), stale AS (
      SELECT s0.case_key, s0.action_id, s0.final_error_code,
             count(*) AS hits, min(s0.completed_at) AS first_seen, max(s0.completed_at) AS last_seen,
`, `    WITH stale_runs AS MATERIALIZED (
      SELECT r.id, r.input_data_id, r.campaign_id, r.account_id, r.staff_id, r.organization_id, r.completed_at, c.action_id, r.final_error_code,
             left('stale|' || c.action_id || '|' || coalesce(r.final_error_code, '') || CASE WHEN v.via = 'orphan' THEN '|orphan' ELSE '' END, 700) AS case_key,
             CASE WHEN v.via = 'orphan' THEN '${ORPHAN}'
                  ELSE '${TREO}' END AS pattern
        FROM public.auto_engine_target_runs r
        JOIN public.auto_campaigns c ON c.id = r.campaign_id
        JOIN public.auto_campaign_actions a ON a.id = c.action_id
        LEFT JOIN LATERAL (SELECT e.data ->> 'via' AS via FROM public.auto_engine_target_events e
                            WHERE e.input_data_id = r.input_data_id AND e.target_run_id = r.id AND e.kind = 'interrupted' AND e.data ? 'via'
                            ORDER BY e.id LIMIT 1) v ON true
       WHERE r.started_at > v_stale_from AND r.started_at <= v_stale_to AND r.close_reason = 'stale' AND a.flatform_type = 'facebook'
         AND v.via IS DISTINCT FROM 'desktop_reset'
         AND EXISTS (SELECT 1 FROM public.auto_staff_device_presence d
                      WHERE d.staff_id = r.staff_id AND d.last_seen_at >= r.completed_at - interval '2 minutes')
    ), stale AS (
      SELECT s0.case_key, s0.action_id, s0.final_error_code, min(s0.pattern) AS pattern,
             count(*) AS hits, min(s0.completed_at) AS first_seen, max(s0.completed_at) AS last_seen,
`],

  ['câu của ca theo đường đóng lượt', `      SELECT s.case_key, 'facebook', 'luot_bo_do', s.final_error_code, s.action_id, '', '${TREO}',
             s.hits, s.sample_runs, s.first_seen, s.last_seen
`, `      SELECT s.case_key, 'facebook', 'luot_bo_do', s.final_error_code, s.action_id, '', s.pattern,
             s.hits, s.sample_runs, s.first_seen, s.last_seen
`],

  ['câu của lượt lỗi theo đường đóng lượt', `             s1.action_id, '', '${TREO}', coalesce(s1.completed_at, v_now)
`, `             s1.action_id, '', s1.pattern, coalesce(s1.completed_at, v_now)
`]
]

function patchedBody() {
  let body = tickBody()
  for (const [name, from, to] of PATCHES) {
    const n = body.split(from).length - 1
    if (n !== 1) throw new Error(`Chỗ vá "${name}": đoạn cũ xuất hiện ${n} lần (phải đúng 1)`)
    body = body.replace(from, () => to)
  }
  if (body.split(TREO).length - 1 !== 1) throw new Error('Câu "treo quá lâu" còn chỗ chưa vá')
  return body
}

const OLD_BODY = tickBody()
const NEW_BODY = patchedBody()
const NEW_BODY_MD5 = md5(NEW_BODY)
const COMMENT_V599 = commentV599()
const COMMENT_V602 = COMMENT_V599.replace(`'V574 + V588 + V593 + V594 + V599:`, `'V574 + V588 + V593 + V594 + V599 + V602:`)
  .replace(/'$/, ` V602: lượt bị bỏ dở phân loại theo đường đóng lượt (desktop_reset bỏ qua, orphan thành ca riêng khoá "|orphan").'`)

const MIGRATION = `-- V602: bộ kiểm lỗi chiến dịch Facebook phân loại lượt bị bỏ dở theo đường đóng lượt. SINH BẰNG scripts/build-v602-sql.cjs, không sửa tay.
-- Anh chốt 20/11/2026 (câu 571, "Làm cách em khuyên"). Tới V599, mọi lượt đóng stale khi máy khách còn mở vào một ca "treo quá lâu", kể cả lượt
-- app khởi động lại dọn đi và lượt mồ côi. Đường đóng lượt đọc ở sự kiện interrupted của lượt (data.via, V576):
--   * desktop_reset (app khởi động lại / đăng nhập lại, data về hàng đợi): không vào sổ ca, không thành lượt lỗi.
--   * orphan (app nhận data kế tiếp cùng lease khi chưa báo xong data này): ca riêng, khoá "stale|<thao tác>|<mã>|orphan", câu
--     "${ORPHAN}".
--   * stale hoặc lượt không có sự kiện: như cũ (khoá "stale|<thao tác>|<mã>", câu "${TREO}").
-- Ca, lượt lỗi đã ghi trước V602 giữ nguyên. Tra sự kiện theo chỉ mục (input_data_id, id) của auto_engine_target_events.
-- Thân hàm tick: md5 ${V599_BODY_MD5} → ${NEW_BODY_MD5}. Không đổi bảng, thiết lập. CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema:
-- apply ngoài giờ cao điểm, vào phút lẻ (tick chạy giây :00 của phút chẵn). Gỡ: rollback_v602_engine_error_watch_stale_via.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v602_%') THEN
      RAISE EXCEPTION 'V602: sổ migration đã có V602, không apply lại';
    END IF;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V599_BODY_MD5}' THEN
    RAISE EXCEPTION 'V602: thân hàm tick đang chạy có md5 % (chờ bản V599 ${V599_BODY_MD5})', v_md5;
  END IF;
  IF to_regclass('public.auto_engine_target_events') IS NULL OR to_regclass('public.auto_engine_target_events_input_v495') IS NULL THEN
    RAISE EXCEPTION 'V602: thiếu bảng auto_engine_target_events hoặc chỉ mục auto_engine_target_events_input_v495';
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${NEW_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V602};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN RAISE EXCEPTION 'V602: thân hàm tick sau khi thay có md5 % (chờ ${NEW_BODY_MD5})', v_md5; END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V602: hàm tick mất SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
         AND has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V602: quyền của hàm tick sau khi apply không đúng';
  END IF;
END $post$;

COMMIT;
`

const ROLLBACK = `-- Gỡ V602 (bộ kiểm lỗi phân loại lượt bị bỏ dở theo đường đóng lượt). SINH BẰNG scripts/build-v602-sql.cjs, không sửa tay.
-- Trả hàm tick về thân V599: mọi lượt đóng stale khi máy khách còn mở lại vào một ca "treo quá lâu". Ca "|orphan" đã tạo vẫn còn trong sổ
-- (không nhận thêm lượt).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V602: thân hàm tick đang chạy (md5 %) không phải bản V602; có migration sau đã sửa hàm, gỡ bản đó trước', v_md5;
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${OLD_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  ${COMMENT_V599};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V599_BODY_MD5}' THEN RAISE EXCEPTION 'Gỡ V602: thân hàm tick sau khi gỡ có md5 % (chờ ${V599_BODY_MD5})', v_md5; END IF;
END $post$;

COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(MIGRATIONS, 'migration_v602_engine_error_watch_stale_via.sql'), MIGRATION)
  fs.writeFileSync(path.join(MIGRATIONS, 'rollback_v602_engine_error_watch_stale_via.sql'), ROLLBACK)
  console.log(`migration_v602_engine_error_watch_stale_via.sql  md5 ${md5(MIGRATION)}  (${MIGRATION.length} ký tự)`)
  console.log(`rollback_v602_engine_error_watch_stale_via.sql   md5 ${md5(ROLLBACK)}`)
  console.log(`thân hàm tick: V599 ${V599_BODY_MD5} → V602 ${NEW_BODY_MD5}`)
}
module.exports = { V599_BODY_MD5, NEW_BODY_MD5, TREO, ORPHAN }
