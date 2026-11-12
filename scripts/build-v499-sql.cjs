// Sinh migration V499: nhớ mục tiêu hỏng THEO TỪNG TÀI KHOẢN thay vì theo tổ chức (anh chốt 11/11/2026: "chỉ nhớ theo tài
// khoản, không có mã nào nhớ theo tổ chức", ví dụ chặn tin người lạ nhưng một tài khoản khác trong tổ chức đã là bạn bè;
// đo 02–03/11: mã 119 khi nhắn người lạ thì tài khoản khác gửi lại được 86%).
// Sinh từ đúng thân hàm của V495 (đã kiểm khớp production 11/11: md5(prosrc) của claim_target_v1 và report_v1 bằng file
// V495). Mỗi chỗ sửa so khớp đúng số lần xuất hiện, lệch thì dừng. Chạy: node scripts/build-v499-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const V495 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v495_campaign_outcome_engine.sql'), 'utf8')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

function extract(name) {
  const re = new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$f\\$([\\s\\S]*?)\\$f\\$;`)
  const m = re.exec(V495)
  if (!m) throw new Error(`Không thấy ${name} trong V495`)
  return { block: m[0], body: m[1] }
}
function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const orReplace = block => block.replace(/^CREATE FUNCTION /, 'CREATE OR REPLACE FUNCTION ')
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]

const claim = extract('aka_agent_engine_claim_target_v1')
const report = extract('aka_agent_engine_report_v1')
const LIVE = { claim: '42cf164564f065435ecc9b9bc34c5184', report: '52272025e5e3aa56cc4483c217e40205' }
if (md5(claim.body) !== LIVE.claim) throw new Error('Thân claim_target_v1 trong V495 không còn khớp bản live đã kiểm')
if (md5(report.body) !== LIVE.report) throw new Error('Thân report_v1 trong V495 không còn khớp bản live đã kiểm')

const claimNew = patch(claim.block,
  `      SELECT m.error_code, m.expires_at INTO v_mem FROM public.auto_target_memory m
       WHERE m.organization_id = coalesce(c.organization_id, 0) AND m.target_key = v_target_key
         AND m.action_code = v_code AND m.expires_at > v_now LIMIT 1;`,
  `      -- V499: chỉ nhớ theo đúng tài khoản đã gặp lỗi; tài khoản khác trong tổ chức vẫn tra/gửi được.
      SELECT m.error_code, m.expires_at INTO v_mem FROM public.auto_target_memory m
       WHERE m.account_id = v_account_id AND m.target_key = v_target_key
         AND m.action_code = v_code AND m.expires_at > v_now LIMIT 1;`, 1, 'claim memory lookup')

const reportNew = patch(report.block,
  `          INSERT INTO public.auto_target_memory AS m (organization_id, target_key, action_code, error_code, first_seen_at, last_seen_at, expires_at, hit_count)
          VALUES (coalesce(c.organization_id, 0), v_target_key, v_action, v_error_code, v_now, v_now,
                  v_now + make_interval(days => (v_policy->>'remember_target_days')::integer), 1)
          ON CONFLICT (organization_id, target_key, action_code) DO UPDATE SET error_code = EXCLUDED.error_code,`,
  `          -- V499: nhớ theo tài khoản (organization_id chỉ để tra cứu).
          INSERT INTO public.auto_target_memory AS m (organization_id, account_id, target_key, action_code, error_code, first_seen_at, last_seen_at, expires_at, hit_count)
          VALUES (coalesce(c.organization_id, 0), r.account_id, v_target_key, v_action, v_error_code, v_now, v_now,
                  v_now + make_interval(days => (v_policy->>'remember_target_days')::integer), 1)
          ON CONFLICT (account_id, target_key, action_code) DO UPDATE SET error_code = EXCLUDED.error_code,`, 1, 'report memory insert')

const NEW = { claim: md5(bodyOf(claimNew)), report: md5(bodyOf(reportNew)) }

const migration = `-- V499: nhớ mục tiêu hỏng theo từng tài khoản Zalo thay vì theo tổ chức (11/11/2026). SINH TỪ scripts/build-v499-sql.cjs, không sửa tay.
-- Anh chốt: "chỉ nhớ theo tài khoản, không có bất kỳ mã lỗi nào nhớ theo tổ chức" (ví dụ người nhận chặn tin người lạ nhưng
-- một tài khoản khác trong tổ chức đã là bạn bè). Đo 02–03/11: mã 119 khi nhắn người lạ, tài khoản khác gửi lại được 79/92 lần.
--
-- Chỉ engine v2 dùng bảng và hai hàm này (tổ chức bật cờ chạy trên Fly, Desktop bản mới chưa phát hành); bộ chạy cũ không đổi.
-- Bảng auto_target_memory phải đang trống (đọc production 11/11: 0 dòng, vì chưa chính sách nào bật nhớ); không trống thì dừng.
--   * auto_target_memory thêm account_id (NOT NULL), khoá duy nhất đổi từ (organization_id, target_key, action_code)
--     sang (account_id, target_key, action_code); organization_id giữ để tra cứu.
--   * aka_agent_engine_claim_target_v1: cổng "mục tiêu đã nhớ" chỉ xét đúng tài khoản đang chạy.
--   * aka_agent_engine_report_v1: ghi nhớ theo tài khoản.
-- Số ngày nhớ vẫn là cột remember_target_days của chính sách (0 = không nhớ, như seed V495).
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v499_target_memory_per_account.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v499_%') THEN
      RAISE EXCEPTION 'V499 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_target_memory') IS NULL THEN RAISE EXCEPTION 'V499 cần V495'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_target_memory' AND column_name = 'account_id') THEN
    RAISE EXCEPTION 'V499: auto_target_memory.account_id đã có';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'V499: thân aka_agent_engine_claim_target_v1 khác V495 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)');
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'V499: thân aka_agent_engine_report_v1 khác V495 (%)', v_md5; END IF;
END $pre$;

-- Khoá bảng trước rồi mới kiểm trống, để không có dòng nào chen vào giữa lúc kiểm và lúc đổi cột.
LOCK TABLE public.auto_target_memory IN ACCESS EXCLUSIVE MODE;
DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_target_memory) THEN
    RAISE EXCEPTION 'V499: auto_target_memory không trống; không tự đổi dữ liệu nhớ theo tổ chức sang theo tài khoản';
  END IF;
END $empty$;

ALTER TABLE public.auto_target_memory ADD COLUMN account_id bigint NOT NULL;
DROP INDEX public.auto_target_memory_key_v495;
CREATE UNIQUE INDEX auto_target_memory_account_key_v499 ON public.auto_target_memory (account_id, target_key, action_code);
COMMENT ON TABLE public.auto_target_memory IS 'V495/V499: nhớ mục tiêu hỏng theo từng tài khoản (chỉ ghi khi chính sách có remember_target_days); organization_id chỉ để tra cứu.';
COMMENT ON COLUMN public.auto_target_memory.account_id IS 'V499: tài khoản đã gặp lỗi; chỉ tài khoản này bỏ qua mục tiêu trong thời gian nhớ.';

${orReplace(claimNew)}

${orReplace(reportNew)}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.claim}' THEN RAISE EXCEPTION 'V499 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'V499 postflight: report_v1 %', v_md5; END IF;
  IF to_regclass('public.auto_target_memory_key_v495') IS NOT NULL OR to_regclass('public.auto_target_memory_account_key_v499') IS NULL THEN
    RAISE EXCEPTION 'V499 postflight: khoá duy nhất của auto_target_memory chưa đổi';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V499: trả hai hàm về thân V495 và khoá nhớ theo tổ chức. SINH TỪ scripts/build-v499-sql.cjs.
-- Dữ liệu nhớ theo tài khoản bị XOÁ (chỉ là bộ nhớ đệm lỗi: mất thì lần sau tài khoản tra/gửi lại số đó như hôm nay),
-- vì nhiều tài khoản cùng tổ chức có thể nhớ cùng một số, không gộp được về khoá theo tổ chức.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_target_memory' AND column_name = 'account_id') THEN
    RAISE EXCEPTION 'Gỡ V499: chưa có V499';
  END IF;
END $pre$;

LOCK TABLE public.auto_target_memory IN ACCESS EXCLUSIVE MODE;
DELETE FROM public.auto_target_memory;
DROP INDEX public.auto_target_memory_account_key_v499;
ALTER TABLE public.auto_target_memory DROP COLUMN account_id;
CREATE UNIQUE INDEX auto_target_memory_key_v495 ON public.auto_target_memory (organization_id, target_key, action_code);
COMMENT ON TABLE public.auto_target_memory IS 'V495: nhớ mục tiêu hỏng cố định trong phạm vi tổ chức (chỉ ghi khi chính sách có remember_target_days).';

${orReplace(claim.block)}

${orReplace(report.block)}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'Gỡ V499 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'Gỡ V499 postflight: report_v1 %', v_md5; END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW }
if (require.main === module) {
  for (const f of ['migration_v499_engine_retry_limit.sql', 'rollback_v499_engine_retry_limit.sql']) {
    const p = path.join(ROOT, 'migrations', f)
    if (fs.existsSync(p)) fs.unlinkSync(p) // bản nháp thử lại có giới hạn đã bỏ (anh chốt 11/11: lỗi mạng không do data)
  }
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v499_target_memory_per_account.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v499_target_memory_per_account.sql'), rollback)
  console.log('V499 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
