// Sinh migration V508: Zalo 126/127 khi nhắn group xử lý như group chặn riêng tài khoản, không phải tài khoản bị hãm tốc (anh chốt
// 12/11/2026 "Chỉ 126/127"; 112 giữ nguyên). Chỉ sửa dữ liệu một dòng chính sách của engine v2; bộ chạy cũ (auto_error) không đổi.
//
// Đo trên production 12/11 (chỉ đọc): 7 ngày 753 lô chia sẻ có 127 mà 0 lô nhiều group bị 127 toàn bộ; luôn đúng cặp tài khoản–group
// (15007: 2 group 12/12 lô, 50789: 1 group 486/486 lô); đã bị thì kéo dài (một group nhận đều 2 phút/lần 3 ngày rồi 127 liền 1.164 lần
// trong 4 ngày); gửi thường 30 ngày 127 chỉ 31 lượt ở 1 chiến dịch, không lần nào 3 lượt liền. Bộ cũ không đếm 127 vào chuỗi.
//
// Dòng (err_zalo_126_127_message_group, zalo_message_group) của V500 (Q4): requeue, đếm chuỗi ngưỡng 3 rồi tạm dừng chiến dịch, và kế thừa
// khoá zalo_message_group 30 phút + kết thúc lượt từ dòng mã / nhóm lỗi. Sau V508: data hoàn thành ("thất bại"), không tính lượt, không đếm
// chuỗi, không khoá, không tạm dừng, chạy tiếp group sau. Lô chia sẻ mà cả lô thất bại vẫn tạm dừng theo luật lô của Desktop (V503).
// Chạy: node scripts/build-v508-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

const KEY = `error_code = 'err_zalo_126_127_message_group' AND action_code = 'zalo_message_group' AND status_id IS NULL AND error_class IS NULL
     AND campaign_action_id IS NULL AND runtime_target IS NULL AND is_active AND NOT is_delete`
const Q4 = { streak: 'increment', thr: 3, camp: 'pause', target: 'requeue', quota: 'no_count', remaining: 'skip', description: '[Q4] 126/127 nhắn nhóm.' }
const V508 = {
  streak: 'ignore', camp: 'none', target: 'complete', lock: '{}', run: 'continue',
  description: '[Q4→V508] 126/127 nhắn group: group chặn riêng tài khoản (đo 12/11/2026); không khoá, không dừng, không đếm chuỗi, data hoàn thành.'
}
const sqlText = s => `'${s.replace(/'/g, "''")}'`

// Ảnh chụp chính sách đã gộp của mọi cặp (mã, thao tác) Zalo mà luật phân loại đi tới, cả hai nơi chạy; so trước / sau để chứng minh
// chỉ đúng một cặp đổi. Bảng tạm (pg_temp) không làm PostgREST nạp lại schema.
const SNAPSHOT = name => `CREATE TEMP TABLE ${name} ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, 'after_send') - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t);`

const CHANGED_ONLY = (before, label) => `  SELECT count(*) INTO n FROM ${before} b
   WHERE NOT (b.error_code = 'err_zalo_126_127_message_group' AND b.action_code = 'zalo_message_group')
     AND (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, 'after_send') - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION '${label}: % cặp (mã, thao tác) khác bị đổi theo', n; END IF;`

const migration = `-- V508: Zalo 126/127 khi nhắn group là group chặn riêng tài khoản, không phải tài khoản bị hãm tốc (12/11/2026, anh chốt; 112 giữ nguyên).
-- SINH TỪ scripts/build-v508-sql.cjs, không sửa tay.
--
-- Chỉ sửa dữ liệu dòng chính sách (err_zalo_126_127_message_group, zalo_message_group) của engine v2 (V500, Q4): data hoàn thành ("thất bại"),
-- không tính lượt, không đếm chuỗi, không khoá thao tác, không tạm dừng chiến dịch, chạy tiếp group sau (trước: về hàng đợi, khoá nhắn group
-- 30 phút, kết thúc lượt, 3 lần liền thì tạm dừng). Lô chia sẻ mà cả lô thất bại vẫn tạm dừng theo luật lô của Desktop (V503).
-- Không DDL (bảng tạm chỉ trong giao dịch), không đổi hàm; bộ chạy cũ đọc auto_error nên không đổi. Không phụ thuộc V503–V507.
-- Gỡ: rollback_v508_zalo_group_126_127_per_group.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE r public.auto_outcome_policies%ROWTYPE; n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v508_%') THEN
      RAISE EXCEPTION 'V508 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies WHERE ${KEY};
  IF n <> 1 THEN RAISE EXCEPTION 'V508: cần đúng 1 dòng chính sách 126/127 × zalo_message_group (thấy %)', n; END IF;
  SELECT * INTO r FROM public.auto_outcome_policies WHERE ${KEY};
  IF r.target_streak_effect IS DISTINCT FROM '${Q4.streak}' OR r.streak_threshold IS DISTINCT FROM ${Q4.thr}
     OR r.campaign_effect IS DISTINCT FROM '${Q4.camp}' OR r.target_effect IS DISTINCT FROM '${Q4.target}'
     OR r.quota_effect IS DISTINCT FROM '${Q4.quota}' OR r.remaining_steps IS DISTINCT FROM '${Q4.remaining}'
     OR r.lock_action_codes IS NOT NULL OR r.run_effect IS NOT NULL THEN
    RAISE EXCEPTION 'V508: dòng chính sách 126/127 nhắn group khác bản V500 (Q4), không tự đổi';
  END IF;
END $pre$;

${SNAPSHOT('v508_before')}

UPDATE public.auto_outcome_policies
   SET target_streak_effect = '${V508.streak}', streak_threshold = NULL, campaign_effect = '${V508.camp}', target_effect = '${V508.target}',
       lock_action_codes = '${V508.lock}', run_effect = '${V508.run}', description = ${sqlText(V508.description)}
 WHERE ${KEY};

DO $post$
DECLARE p jsonb; n integer; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['desktop', 'fly'] LOOP
    p := public.aka_agent_engine_resolve_policy('err_zalo_126_127_message_group', NULL, 'zalo_message_group', NULL, t, 'after_send');
    IF p->>'target_streak_effect' IS DISTINCT FROM 'ignore' OR p->>'campaign_effect' IS DISTINCT FROM 'none'
       OR p->>'target_effect' IS DISTINCT FROM 'complete' OR jsonb_array_length(coalesce(p->'lock_action_codes', '[]'::jsonb)) <> 0
       OR p->>'run_effect' IS DISTINCT FROM 'continue' OR p->>'quota_effect' IS DISTINCT FROM 'no_count' THEN
      RAISE EXCEPTION 'V508 postflight: chính sách 126/127 nhắn group (%) chưa đúng: %', t, p;
    END IF;
  END LOOP;
${CHANGED_ONLY('v508_before', 'V508 postflight')}
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V508: trả dòng chính sách (err_zalo_126_127_message_group, zalo_message_group) về bản V500 (Q4).
-- SINH TỪ scripts/build-v508-sql.cjs. Chỉ dữ liệu; lịch sử chính sách ghi lại lần sửa này.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE r public.auto_outcome_policies%ROWTYPE; n integer;
BEGIN
  SELECT count(*) INTO n FROM public.auto_outcome_policies WHERE ${KEY};
  IF n <> 1 THEN RAISE EXCEPTION 'Gỡ V508: cần đúng 1 dòng chính sách 126/127 × zalo_message_group (thấy %)', n; END IF;
  SELECT * INTO r FROM public.auto_outcome_policies WHERE ${KEY};
  IF r.target_streak_effect IS DISTINCT FROM '${V508.streak}' OR r.campaign_effect IS DISTINCT FROM '${V508.camp}'
     OR r.target_effect IS DISTINCT FROM '${V508.target}' OR r.run_effect IS DISTINCT FROM '${V508.run}'
     OR r.lock_action_codes IS DISTINCT FROM '${V508.lock}'::text[] THEN
    RAISE EXCEPTION 'Gỡ V508: chưa có V508 (dòng chính sách không phải bản V508)';
  END IF;
END $pre$;

${SNAPSHOT('v508_rollback_before')}

UPDATE public.auto_outcome_policies
   SET target_streak_effect = '${Q4.streak}', streak_threshold = ${Q4.thr}, campaign_effect = '${Q4.camp}', target_effect = '${Q4.target}',
       lock_action_codes = NULL, run_effect = NULL, description = ${sqlText(Q4.description)}
 WHERE ${KEY};

DO $post$
DECLARE p jsonb; n integer;
BEGIN
  p := public.aka_agent_engine_resolve_policy('err_zalo_126_127_message_group', NULL, 'zalo_message_group', NULL, 'fly', 'after_send');
  IF p->>'target_streak_effect' IS DISTINCT FROM 'increment' OR p->>'campaign_effect' IS DISTINCT FROM 'pause' OR p->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'Gỡ V508 postflight: chính sách 126/127 nhắn group chưa về Q4: %', p;
  END IF;
${CHANGED_ONLY('v508_rollback_before', 'Gỡ V508 postflight')}
END $post$;

COMMIT;
`

module.exports = { migration, rollback, Q4, V508 }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v508_zalo_group_126_127_per_group.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v508_zalo_group_126_127_per_group.sql'), rollback)
  console.log('V508 migration', md5(migration), 'rollback', md5(rollback))
}
