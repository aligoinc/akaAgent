#!/usr/bin/env node
// V648: engine v2 không đánh "hoàn thành" chiến dịch lịch tuần / tháng có "làm mới data" khi chạy xong danh sách trong ngày
// (anh duyệt phương án 24/11/2026: "Vậy hãy thực thi phương án").
//
// Trước: aka_agent_engine_finish_campaign_v2 hoàn thành chiến dịch; tới lượt bảo trì lịch ngày chạy kế (Desktop / App Server
// maintainCampaignSchedules, chỉ chạy khi app mở) mới đặt lại data và về "chờ xử lý". Khách thấy "✅ Hoàn thành chiến dịch" mỗi ngày
// và nghĩ chiến dịch đã kết thúc (khách Ly Ocean Park, tổ chức 1353, lịch Thứ 2–7).
// Sau: như bộ cũ (campaignScheduler.ts handleRecurringRefreshAfterCompletion): tính ngày chạy kế (từ ngày mai, theo
// schedule_week_days / schedule_days, giờ theo original_schedule), không quá ngày kết thúc thì đi bước 6 có sẵn (đặt lại data trừ
// "tạm dừng", chiến dịch về "chờ xử lý" với lịch là ngày chạy kế). Lý do trả về là 'rerun_scheduled' (đã có câu tiến trình
// "⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch … lúc …" ở mọi bản lõi đang chạy), nên Desktop / Fly không cần cập nhật.
// Không áp dụng: up tin, chúc mừng sinh nhật, đề xuất kết bạn, huỷ lời mời kết bạn (bảo trì lịch có cách riêng), chiến dịch đã có
// nhánh lặp khác trong lượt (nhiều khung giờ, gửi lặp, lặp lại sau khi xong).
//
// Nguồn: thân finish_campaign_v2 trong file V618 p2 đã apply (md5 pg_get_functiondef production đọc chỉ đọc 24/11/2026: ed7406cb…).
// Thân hàm mới không ghi số migration trong chú thích: đổi số thì md5 thân hàm không đổi.
// Chạy: node scripts/build-v648-sql.cjs (ghi migration + bản gỡ). Không sửa tay hai file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v648'
const NAME = `migration_${VERSION}_engine_recurring_refresh_pass`
const ROLLBACK_NAME = `rollback_${VERSION}_engine_recurring_refresh_pass`
const SIG = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'
/** md5 pg_get_functiondef của finish_campaign_v2 trên production, đọc chỉ đọc 24/11/2026 (= bản V618 p2 sinh ra). */
const LIVE_MD5 = 'ed7406cbccac16af32af4f329aabb170'
const SOURCE_FILE = 'migrations/migration_v618_web_data_scan_p2.sql'

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

function readLive() {
  const source = fs.readFileSync(path.join(ROOT, SOURCE_FILE), 'utf8')
  const head = 'CREATE OR REPLACE FUNCTION public.aka_agent_engine_finish_campaign_v2('
  const tail = 'END $function$'
  const start = source.indexOf(head)
  if (start < 0 || source.indexOf(head, start + 1) >= 0) throw new Error(`${SOURCE_FILE}: cần đúng một định nghĩa finish_campaign_v2`)
  const end = source.indexOf(tail, start)
  if (end < 0) throw new Error(`${SOURCE_FILE}: không thấy cuối thân hàm`)
  return source.slice(start, end + tail.length) + '\n'
}

const live = readLive()
if (md5(live) !== LIVE_MD5) throw new Error(`Thân finish_campaign_v2 trong ${SOURCE_FILE} không còn khớp bản đang chạy (${LIVE_MD5})`)

const OLD_DECL = `  -- V561: lặp lại sau khi chạy xong.
  v_repeat jsonb;
BEGIN`
const NEW_DECL = `  -- V561: lặp lại sau khi chạy xong.
  v_repeat jsonb;
  -- Lịch tuần / tháng có làm mới data: ngày chạy kế.
  v_rec_type text;
  v_rec_days integer[] := ARRAY[]::integer[];
  v_rec_token text;
  v_rec_number numeric;
  v_rec_date date;
  v_rec_offset integer;
BEGIN`

// Sau bước "chạy lại sau N giờ" (V558), trước bước hoàn thành: như thứ tự handleCampaignCompletion của bộ cũ (handleRerunAfterCompletion
// trước handleRecurringRefreshAfterCompletion). Đặt trước V558 thì lịch tuần / tháng bật "chạy lại sau N giờ" bị hẹn sang ngày chạy kế
// (giả lập 24/11/2026 tìm ra).
const ANCHOR = `  IF v_mode IS NULL THEN
    v_raw := public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed',`
const NEW_BLOCK = String.raw`  -- 5c. (sau "chạy lại sau N giờ") Lịch tuần / tháng có làm mới data (refresh_data): chạy xong danh sách trong ngày thì không hoàn thành mà hẹn ngày chạy kế
  -- (từ ngày mai, theo ngày trong tuần / trong tháng đã chọn, giờ theo original_schedule) rồi đi bước 6: đặt lại data (trừ "tạm dừng"),
  -- chiến dịch về "chờ xử lý". Ngày chạy kế quá ngày kết thúc, không tính được, hay không còn data chạy lại được thì hoàn thành như cũ.
  -- Như handleRecurringRefreshAfterCompletion của bộ cũ (campaignScheduler.ts). Up tin, sinh nhật, đề xuất kết bạn, huỷ lời mời: bảo trì
  -- lịch ngày mới có cách riêng, giữ như cũ. Lý do trả về 'rerun_scheduled' để mọi bản lõi đang chạy in đúng câu hẹn chạy lại.
  -- So khớp đúng từng ký tự như bộ cũ (Desktop / ChatApi): " weekly" / "Weekly" không phải lịch tuần (giả lập 24/11/2026).
  v_rec_type := coalesce(nullif(c.schedule_type, ''), 'daily');
  IF v_mode IS NULL AND v_repeat IS NULL AND v_rec_type IN ('weekly', 'monthly') AND c.refresh_data IS TRUE
     AND c.action_id NOT IN ('zalo_message_birthday', 'zalo_message_friend_recommendation', 'zalo_cancel_sent_friend_request')
     AND NOT (c.action_id = 'facebook_comment_seeding_post' AND coalesce(c.name, '') LIKE 'Up tin cho chiến dịch %')
     AND coalesce(c.original_schedule, c.schedule) IS NOT NULL THEN
    FOREACH v_rec_token IN ARRAY string_to_array(CASE WHEN v_rec_type = 'weekly' THEN coalesce(c.schedule_week_days, '')
                                                      ELSE coalesce(c.schedule_days, '') END, ',') LOOP
      CONTINUE WHEN btrim(v_rec_token) !~ '^\+?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$';
      BEGIN
        v_rec_number := btrim(v_rec_token)::numeric;
        IF v_rec_number = trunc(v_rec_number)
           AND ((v_rec_type = 'weekly' AND v_rec_number BETWEEN 2 AND 8) OR (v_rec_type = 'monthly' AND v_rec_number BETWEEN 1 AND 31))
           AND NOT v_rec_number::integer = ANY(v_rec_days) THEN
          v_rec_days := array_append(v_rec_days, v_rec_number::integer);
        END IF;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN NULL;
      END;
    END LOOP;
    v_rec_date := NULL;
    IF cardinality(v_rec_days) > 0 THEN
      FOR v_rec_offset IN 1..(CASE WHEN v_rec_type = 'weekly' THEN 14 ELSE 370 END) LOOP
        IF (v_rec_type = 'weekly' AND (extract(isodow FROM v_vn + v_rec_offset)::integer + 1) = ANY(v_rec_days))
           OR (v_rec_type = 'monthly' AND extract(day FROM v_vn + v_rec_offset)::integer = ANY(v_rec_days)) THEN
          v_rec_date := v_vn + v_rec_offset;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF v_rec_date IS NOT NULL THEN
      v_candidate := ((v_rec_date + date_trunc('second', coalesce(c.original_schedule, c.schedule) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)::timestamp
                      AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF c.schedule_end_date IS NULL OR v_candidate <= c.schedule_end_date THEN
        v_next := v_candidate;
        v_mode := 'rerun_scheduled';
        v_suffix := 'ở ngày chạy kế tiếp';
      END IF;
    END IF;
  END IF;

`

let NEW_TEXT = patch(live, OLD_DECL, NEW_DECL, 1, 'finish: khai báo biến')
NEW_TEXT = patch(NEW_TEXT, ANCHOR, NEW_BLOCK + ANCHOR, 1, 'finish: bước 5c lịch tuần / tháng')
const NEW_MD5 = md5(NEW_TEXT)

const preflight = (label, expect, done, msgDone, msgDrift, ledger) => `DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${VERSION}_%') THEN
      RAISE EXCEPTION '${VERSION.toUpperCase()} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}  v_oid := to_regprocedure('${SIG}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${SIG}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${done}' THEN RAISE EXCEPTION '${msgDone}'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${msgDrift} (finish: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.${VERSION}_acl_finish', v_acl, true);
END $pre$;`
const postflight = (label, expect) => `DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := '${SIG}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expect}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa finish %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.${VERSION}_acl_finish', true) THEN RAISE EXCEPTION '${label} postflight: quyền / chủ sở hữu finish bị đổi'; END IF;
END $post$;`

const V = VERSION.toUpperCase()
const migration = `-- ${V}: engine v2 hẹn ngày chạy kế cho lịch tuần / tháng có làm mới data thay vì hoàn thành. SINH TỪ scripts/build-${VERSION}-sql.cjs,
-- không sửa tay. Thay thân aka_agent_engine_finish_campaign_v2 (giữ chữ ký, chủ sở hữu, quyền), thêm bước 5c; mọi nhánh khác giữ nguyên.
-- Nguồn = pg_get_functiondef production 24/11/2026 (bản V618 p2): finish ${LIVE_MD5}. Bản mới: ${NEW_MD5}.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight(V, LIVE_MD5, NEW_MD5, `${V} đã chạy (finish)`, `${V}: định nghĩa finish khác bản production 24/11 (V618 p2), dừng để đối chiếu bản live`, true)}

${NEW_TEXT};

${postflight(V, NEW_MD5)}

COMMIT;
`
const rollback = `-- Gỡ ${V}: trả aka_agent_engine_finish_campaign_v2 về bản V618 p2 (production 24/11/2026). SINH TỪ scripts/build-${VERSION}-sql.cjs.
-- Sau khi gỡ, lịch tuần / tháng chạy bằng engine v2 lại "hoàn thành" sau mỗi ngày chạy, bảo trì lịch ngày chạy kế mới đặt lại data.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight(`Gỡ ${V}`, NEW_MD5, LIVE_MD5, `Gỡ ${V}: hàm đã là bản trước ${V}`, `Gỡ ${V}: định nghĩa finish không phải bản ${V}`, false)}

${live};

${postflight(`Gỡ ${V}`, LIVE_MD5)}

COMMIT;
`

module.exports = { migration, rollback, NAME, ROLLBACK_NAME, SIG, LIVE_MD5, NEW_MD5, texts: { live, new: NEW_TEXT } }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${V} migration`, md5(migration), 'rollback', md5(rollback), 'finish', LIVE_MD5, '->', NEW_MD5)
}
