// Sinh migration V512: luật phân loại cho các tín hiệu lệnh Fly mà Desktop không có (anh: "Sửa toàn bộ" sau khi rà mọi lệnh zalo_runtime,
// 12/11/2026). Chỉ thêm dòng auto_outcome_signal_rules của engine v2; không DDL, không đổi chính sách, mã lỗi hay hàm.
//
// Nguyên tắc (anh chốt 12/11): Desktop là chuẩn ở lớp tín hiệu, luật / chính sách trong DB quyết định kết quả; lỗi chỉ Fly có thì mang tín
// hiệu riêng và luật riêng. Cổng Fly (apps/system-worker flyZaloPort) từ nay báo:
//   * lệnh đọc (tra số, đọc hồ sơ, tag, trạng thái kết bạn…) không có kết quả (command_result_unknown, command_dispatch_failed) là chưa gửi
//     (before_send): lệnh đọc không đổi gì trên Zalo. Trước đây xếp "không rõ đã tới" (UNK01) nên data bị đóng mà chưa gửi.
//     → NET03 (máy gửi chưa sẵn sàng, data về hàng đợi), như Desktop: lệnh đọc lỗi không phải câu trả lời của Zalo là NET01.
//   * runtime_payload_invalid: runtime từ chối tham số lệnh (zod) trước khi gọi Zalo; gần như chỉ xảy ra khi worker và runtime lệch phiên
//     bản → NET03 (về hàng đợi, không mất data; lặp lại thì chính sách NET03 tạm dừng chiến dịch).
//   * runtime_label_session_reset: phiên tag bị huỷ giữa lượt vì runtime đóng kết nối để đăng nhập lại hoặc dừng (như Desktop đổi phiên
//     đăng nhập; từ 12/11 socket rớt rồi tự nối lại không còn huỷ, như Desktop). Trước khi ghi tag → NET03; sau khi Zalo đã ghi tag → UNK01
//     (như Desktop gặp lỗi không phải của Zalo ở thao tác gửi).
//   * gắn tag / đổi tên gợi nhớ không rõ kết quả (runtime hết 90 giây, Chat Core mất kết quả): Desktop không có hạn riêng, treo tới hạn
//     bước 150 giây thì lõi báo quá giờ trước khi gửi → NET01 (khoá thao tác Zalo một lúc, kết thúc lượt). Fly ra cùng NET01 bằng luật
//     theo thao tác (zalo_tag_contact, zalo_change_alias); thao tác phụ không tính lượt, không đếm chuỗi như cũ.
// Thứ tự khớp luật (aka_agent_engine_classify_signal): khớp chính xác trước, luật có thao tác trước luật chung, luật có pha trước luật mọi
// pha. Luật V495 (59 command_result_unknown, 67 command_dispatch_failed → UNK01) giữ nguyên cho thao tác gửi.
// Chạy: node scripts/build-v512-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const sqlText = s => `'${s.replace(/'/g, "''")}'`
const sqlArr = a => `ARRAY[${a.map(sqlText).join(', ')}]`

const NET01 = 'err_network_offline'
const NET03 = 'err_engine_runtime_unavailable'
const UNK01 = 'err_engine_unknown_delivery'
const AUX = ['zalo_tag_contact', 'zalo_change_alias']

// [action_code, phase, pattern, error_code, note]
const RULES = [
  [null, 'before_send', 'command_result_unknown', NET03, 'Lệnh đọc không có kết quả: chưa gửi gì (lệnh đọc không đổi gì trên Zalo), về hàng đợi.'],
  [null, 'before_send', 'command_dispatch_failed', NET03, 'Lệnh đọc giao cho runtime lỗi: chưa gửi gì, về hàng đợi.'],
  [null, null, 'runtime_payload_invalid', NET03, 'Runtime từ chối tham số lệnh trước khi gọi Zalo (worker và runtime lệch phiên bản): về hàng đợi.'],
  [null, 'before_send', 'runtime_label_session_reset', NET03, 'Phiên tag bị huỷ (runtime đăng nhập lại hoặc dừng) trước khi ghi tag: chưa gửi gì, về hàng đợi.'],
  [null, 'in_flight', 'runtime_label_session_reset', UNK01, 'Phiên tag bị huỷ sau khi Zalo đã ghi tag: không rõ kết quả, như Desktop.'],
  ...AUX.flatMap(action => [
    [action, null, 'command_result_unknown', NET01, 'Thao tác phụ không rõ kết quả (runtime hết giờ): như Desktop treo tới hạn bước, NET01.'],
    [action, null, 'command_dispatch_failed', NET01, 'Thao tác phụ giao cho runtime lỗi: như Desktop treo tới hạn bước, NET01.']
  ])
]
const NEW_PATTERNS = ['runtime_payload_invalid', 'runtime_label_session_reset']

// Kết quả phân loại mong đợi sau V512 cho một (mã lệnh, thao tác, pha); null = giữ như trước.
const EXPECTED = `CASE
      WHEN b.code IN ('command_result_unknown', 'command_dispatch_failed') AND b.action_code = ANY (${sqlArr(AUX)}) THEN '${NET01}'
      WHEN b.code IN ('command_result_unknown', 'command_dispatch_failed') AND b.phase = 'before_send' THEN '${NET03}'
      WHEN b.code = 'runtime_payload_invalid' THEN '${NET03}'
      WHEN b.code = 'runtime_label_session_reset' AND b.phase = 'before_send' THEN '${NET03}'
      WHEN b.code = 'runtime_label_session_reset' AND b.phase = 'in_flight' THEN '${UNK01}'
      ELSE NULL END`

const CLASSIFY = `(SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase,
           jsonb_build_object('kind', 'fly_command', 'code', b.code)) cs)`

// Ảnh chụp phân loại mọi mã lệnh Fly (có luật + 2 mã mới) × thao tác Zalo × pha, chính sách đã gộp và lint; so trước / sau.
const SNAPSHOT = name => `CREATE TEMP TABLE ${name}_class ON COMMIT DROP AS
SELECT z.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', 'fly_command', 'code', z.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind = 'fly_command' AND r.pattern <> '*'
        UNION SELECT unnest(${sqlArr(NEW_PATTERNS)})) z
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE ${name}_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target, ph.p AS phase,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, ph.p) - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t)
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE ${name}_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;`

const CHECK_AFTER = (name, label, applied) => `  -- Phân loại: ${applied ? 'đúng các ô đổi theo V512, mọi ô khác giữ nguyên' : 'mọi ô về như trước V512'}.
  SELECT count(*) INTO n FROM ${name}_class b
   WHERE ${CLASSIFY}
         IS DISTINCT FROM ${applied ? `COALESCE(${EXPECTED}, b.error_code)` : 'b.error_code'};
  IF n > 0 THEN RAISE EXCEPTION '${label}: % ô (mã lệnh Fly, thao tác, pha) phân loại chưa đúng', n; END IF;
  -- Chính sách không đổi (V512 chỉ thêm luật).
  SELECT count(*) INTO n FROM ${name}_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, b.phase) - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION '${label}: % chính sách bị đổi', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM ${name}_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION '${label}: % dòng lint mới', n; END IF;`

const sqlVal = v => v === null ? 'NULL' : sqlText(v)

const migration = `-- V512: luật phân loại cho tín hiệu lệnh Fly mà Desktop không có (12/11/2026, "Sửa toàn bộ" sau khi rà mọi lệnh zalo_runtime).
-- SINH TỪ scripts/build-v512-sql.cjs, không sửa tay.
--
-- Chỉ thêm ${RULES.length} dòng auto_outcome_signal_rules (source 'v512', signal_kind fly_command) của engine v2:
${RULES.map(([a, ph, pat, err]) => `--   * ${pat}${a ? ` × ${a}` : ''}${ph ? ` (${ph})` : ''} → ${err}`).join('\n')}
-- Bộ chạy cũ không đọc bảng này; Desktop không phát tín hiệu fly_command. Không DDL (bảng tạm chỉ trong giao dịch), không đổi chính sách,
-- mã lỗi hay hàm. Postflight chứng minh chỉ đúng các ô (mã lệnh, thao tác, pha) trên đổi phân loại, chính sách và lint giữ nguyên.
-- Gỡ: rollback_v512_fly_command_signal_rules.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v512_%') THEN
      RAISE EXCEPTION 'V512 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  SELECT count(*) INTO n FROM public.auto_error
   WHERE error_code = ANY (${sqlArr([NET01, NET03, UNK01])}) AND is_active AND NOT is_delete;
  IF n <> 3 THEN RAISE EXCEPTION 'V512: cần đủ 3 mã ${NET01} / ${NET03} / ${UNK01} đang bật (thấy %)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v512') THEN
    RAISE EXCEPTION 'V512: đã có luật source v512';
  END IF;
  -- Không có sẵn luật trùng (mã lệnh, thao tác, pha) với luật sắp thêm.
  SELECT count(*) INTO n FROM public.auto_outcome_signal_rules r
    JOIN (VALUES ${RULES.map(([a, ph, pat]) => `(${sqlVal(a)}, ${sqlVal(ph)}, ${sqlText(pat)})`).join(', ')}) v(action_code, phase, pattern)
      ON r.pattern = v.pattern AND r.action_code IS NOT DISTINCT FROM v.action_code AND r.phase IS NOT DISTINCT FROM v.phase
   WHERE r.platform = 'zalo' AND r.signal_kind = 'fly_command' AND r.is_active;
  IF n > 0 THEN RAISE EXCEPTION 'V512: đã có % luật trùng với luật sắp thêm', n; END IF;
  -- Trạng thái đã đọc (V495): lệnh không rõ kết quả ra UNK01 ở mọi pha và mọi thao tác.
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_find_phone_user', 'before_send',
        '{"kind": "fly_command", "code": "command_result_unknown"}'::jsonb) cs) IS DISTINCT FROM '${UNK01}'
     OR (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_tag_contact', 'in_flight',
        '{"kind": "fly_command", "code": "command_result_unknown"}'::jsonb) cs) IS DISTINCT FROM '${UNK01}' THEN
    RAISE EXCEPTION 'V512: phân loại command_result_unknown khác bản V495 đã đọc, không tự đổi';
  END IF;
END $pre$;

${SNAPSHOT('v512_before')}

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
${RULES.map(([a, ph, pat, err, note]) => `  ('zalo', ${sqlVal(a)}, ${sqlVal(ph)}, 'fly_command', ${sqlText(pat)}, 50, '${err}', 'v512', ${sqlText(`[V512] ${note}`)})`).join(',\n')};

DO $post$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.auto_outcome_signal_rules WHERE source = 'v512' AND is_active;
  IF n <> ${RULES.length} THEN RAISE EXCEPTION 'V512 postflight: cần ${RULES.length} luật mới (thấy %)', n; END IF;
${CHECK_AFTER('v512_before', 'V512 postflight', true)}
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V512: xoá luật source 'v512' (phân loại về như V495–V511).
-- SINH TỪ scripts/build-v512-sql.cjs. Chỉ dữ liệu.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v512') THEN
    RAISE EXCEPTION 'Gỡ V512: chưa có V512';
  END IF;
END $pre$;

-- Ảnh chụp trước khi gỡ; sau khi gỡ, ô V512 đổi phải về như trước V512 (UNK01 / bắt-tất-cả), ô khác giữ nguyên.
${SNAPSHOT('v512_rollback_before')}

DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v512';

DO $post$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM v512_rollback_before_class b
   WHERE ${EXPECTED} IS NULL AND ${CLASSIFY} IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V512 postflight: % ô ngoài V512 bị đổi phân loại', n; END IF;
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_find_phone_user', 'before_send',
        '{"kind": "fly_command", "code": "command_result_unknown"}'::jsonb) cs) IS DISTINCT FROM '${UNK01}' THEN
    RAISE EXCEPTION 'Gỡ V512 postflight: command_result_unknown chưa về UNK01';
  END IF;
  SELECT count(*) INTO n FROM v512_rollback_before_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, b.phase) - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V512 postflight: % chính sách bị đổi', n; END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, RULES, NET01, NET03, UNK01, AUX }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v512_fly_command_signal_rules.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v512_fly_command_signal_rules.sql'), rollback)
  console.log('V512 migration', md5(migration), 'rollback', md5(rollback))
}
