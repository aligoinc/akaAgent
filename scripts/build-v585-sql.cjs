#!/usr/bin/env node
// V585: engine v2 đọc được danh sách "Chạy nhiều khung giờ" lưu dạng mảng (anh chốt 19/11/2026: "Viết migration").
//
// Web lưu extra_settings.multiDailyTimeSlots là mảng JSON ["08:00", "09:00"] (akaAgentWebApp packages/campaign-core/src/submission.ts),
// Desktop lưu chuỗi "08:00,09:00". aka_agent_engine_finish_campaign_v2 (thân V561) chỉ đọc kiểu string / number, kiểu khác thành chuỗi
// rỗng, nên chiến dịch tạo / sửa trên Web chạy bằng engine v2 không có khung giờ nào: chạy xong lượt đầu là "hoàn thành", không hẹn khung kế
// (19/11: chiến dịch 58847 / 58849 / 59089 của tổ chức 2214). Bộ cũ đọc được cả hai dạng vì String(mảng) nối phần tử bằng dấu phẩy
// (campaignScheduler.ts normalizeMultiDailyTimeSlots).
//
// Sửa đúng một chỗ trong thân hàm: thêm nhánh kiểu array, nối các phần tử bằng dấu phẩy rồi đi qua đúng bộ tách / chuẩn hoá đang có.
// Kiểu string / number và mọi kiểu khác (object, boolean, null, thiếu khoá) giữ nguyên cách xử lý.
//
// Nguồn: thân finish_campaign_v2 trong file V561 p2 đã apply (md5 pg_get_functiondef production đọc chỉ đọc 19/11/2026: d8c9a144…).
// Thân hàm mới không ghi số migration trong chú thích: đổi số thì md5 thân hàm không đổi.
// Chạy: node scripts/build-v585-sql.cjs (ghi migration + bản gỡ). Không sửa tay hai file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v585'
const NAME = `migration_${VERSION}_engine_multi_slot_array`
const ROLLBACK_NAME = `rollback_${VERSION}_engine_multi_slot_array`
const SIG = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'
/** md5 pg_get_functiondef của finish_campaign_v2 trên production, đọc chỉ đọc 19/11/2026 (= bản V561 sinh ra). */
const LIVE_MD5 = 'd8c9a144ae30718e7a5aed5d58914fb1'
const SOURCE_FILE = 'migrations/migration_v561_campaign_repeat_after_completion_p2.sql'

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

/** Thân hàm đang chạy: cắt nguyên văn khỏi file V561 p2 (file đã apply, không đổi). pg_get_functiondef kết thúc bằng một dòng trống. */
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

const OLD_SOURCE = String.raw`          FROM regexp_split_to_table(CASE jsonb_typeof(v_extra->'multiDailyTimeSlots') WHEN 'string' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'number' THEN v_extra->>'multiDailyTimeSlots' ELSE '' END, '[,\r\n]+') item,`
const NEW_SOURCE = String.raw`          -- Danh sách khung giờ: Desktop lưu chuỗi "08:00,09:00", Web lưu mảng ["08:00", "09:00"]. Mảng thì nối các phần tử bằng dấu phẩy
          -- (bộ cũ đọc mảng bằng String(mảng), cũng ra chuỗi đó) rồi tách và chuẩn hoá như chuỗi; phần tử null bỏ qua.
          FROM regexp_split_to_table(CASE jsonb_typeof(v_extra->'multiDailyTimeSlots') WHEN 'string' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'number' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'array' THEN (SELECT coalesce(string_agg(e.slot_text, ','), '')
                                                               FROM jsonb_array_elements_text(v_extra->'multiDailyTimeSlots') AS e(slot_text))
                                          ELSE '' END, '[,\r\n]+') item,`

const NEW_TEXT = patch(live, OLD_SOURCE, NEW_SOURCE, 1, 'finish: nguồn danh sách khung giờ')
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
const migration = `-- ${V}: engine v2 đọc được danh sách "Chạy nhiều khung giờ" lưu dạng mảng (chiến dịch tạo / sửa trên Web). SINH TỪ scripts/build-${VERSION}-sql.cjs,
-- không sửa tay. Thay thân aka_agent_engine_finish_campaign_v2 (giữ chữ ký, chủ sở hữu, quyền), đổi đúng một chỗ: extra_settings.multiDailyTimeSlots
-- kiểu array thì nối các phần tử bằng dấu phẩy rồi tách / chuẩn hoá như chuỗi. Trước đó kiểu array bị coi là không có khung giờ nào nên chiến
-- dịch chạy xong lượt đầu là hoàn thành. Kiểu string / number và mọi kiểu khác xử lý như cũ.
-- Nguồn = pg_get_functiondef production 19/11/2026 (bản V561): finish ${LIVE_MD5}. Bản mới: ${NEW_MD5}.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight(V, LIVE_MD5, NEW_MD5, `${V} đã chạy (finish)`, `${V}: định nghĩa finish khác bản production 19/11 (V561), dừng để đối chiếu bản live`, true)}

${NEW_TEXT};

${postflight(V, NEW_MD5)}

COMMIT;
`
const rollback = `-- Gỡ ${V}: trả aka_agent_engine_finish_campaign_v2 về bản V561 (production 19/11/2026). SINH TỪ scripts/build-${VERSION}-sql.cjs.
-- Sau khi gỡ, chiến dịch lưu danh sách khung giờ dạng mảng (tạo / sửa trên Web) lại hoàn thành sau lượt đầu khi chạy bằng engine v2.
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
