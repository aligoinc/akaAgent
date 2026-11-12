// Sinh migration V507: bỏ hẳn nhớ mục tiêu theo tài khoản của engine v2 (V499 cấu trúc, V500 đặt 30 ngày cho 11 cặp mã × thao tác).
// Anh chốt 12/11/2026: tạm hoãn kiểm "số không tồn tại" trên toàn hệ thống, bỏ nhớ theo tài khoản; bỏ cả bảng và cột. Tính năng chưa
// từng chạy trên production (bảng nhớ 0 dòng; lần chạy bộ mới cuối 11/11 21:16 VN, trước khi apply V499 lúc 12/11 00:02 VN).
//
//   claim_target_v1 (thân V505, md5 prosrc 3b99fe55…): bỏ đoạn tra bảng nhớ (quyết định 'skip', cổng target_memory).
//   report_v1 (thân V503, md5 prosrc 299d0fe3…): bỏ đoạn ghi bảng nhớ và biến v_target_key (chỉ dùng cho nhớ).
//   resolve_policy (thân V495, md5 prosrc d4091353…): bỏ trường remember_target_days.
//   Xoá bảng auto_target_memory, cột auto_outcome_policies.remember_target_days (giá trị cũ ghi vào auto_outcome_policy_history,
//   changed_by = 'migration_v507', để gỡ trả đúng) và dòng cổng target_memory của auto_engine_gates.
// Lõi (packages/campaign-engine) không đổi: nhánh xử lý quyết định 'skip' không còn được dùng tới.
// Chạy: node scripts/build-v507-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v503 = require('./build-v503-sql.cjs')
const v505 = require('./build-v505-sql.cjs')
const V495 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v495_campaign_outcome_engine.sql'), 'utf8')

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]
function extract(text, name, keyword, source) {
  const m = new RegExp(`${keyword} public\\.${name}\\([\\s\\S]*?AS \\$f\\$([\\s\\S]*?)\\$f\\$;`).exec(text)
  if (!m) throw new Error(`Không thấy ${name} trong ${source}`)
  return { block: m[0], body: m[1] }
}

const claimOld = extract(v505.migration, 'aka_agent_engine_claim_target_v1', 'CREATE OR REPLACE FUNCTION', 'V505')
const reportOld = extract(v503.migration, 'aka_agent_engine_report_v1', 'CREATE OR REPLACE FUNCTION', 'V503')
const resolveV495 = extract(V495, 'aka_agent_engine_resolve_policy', 'CREATE FUNCTION', 'V495')
const resolveOld = { block: resolveV495.block.replace('CREATE FUNCTION public.aka_agent_engine_resolve_policy(',
  'CREATE OR REPLACE FUNCTION public.aka_agent_engine_resolve_policy('), body: resolveV495.body }

const LIVE = { claim: v505.NEW.claim, report: v503.NEW.report, resolve: md5(resolveOld.body) }
if (md5(claimOld.body) !== LIVE.claim || LIVE.claim !== '3b99fe55d38b901710fc54f14a968175') {
  throw new Error('Thân claim_target_v1 của V505 không còn khớp bản đã kiểm (3b99fe55…)')
}
if (md5(reportOld.body) !== LIVE.report || LIVE.report !== '299d0fe35ed98a5f58464e11b87280be') {
  throw new Error('Thân report_v1 của V503 không còn khớp bản đã kiểm (299d0fe3…)')
}
if (LIVE.resolve !== 'd4091353bcc2fb5df6c6308da13f0caa') {
  throw new Error('Thân resolve_policy của V495 không còn khớp bản đang chạy production (d4091353…)')
}

// ------------------------------------------------------------------------------------------------ claim
let c = claimOld.block
c = patch(c, `  v_mem record;
`, '', 1, 'claim: biến v_mem')
c = patch(c, `    IF v_decision->>'decision' = 'allow' AND v_target_key IS NOT NULL THEN
      -- V499: chỉ nhớ theo đúng tài khoản đã gặp lỗi; tài khoản khác trong tổ chức vẫn tra/gửi được.
      SELECT m.error_code, m.expires_at INTO v_mem FROM public.auto_target_memory m
       WHERE m.account_id = v_account_id AND m.target_key = v_target_key
         AND m.action_code = v_code AND m.expires_at > v_now LIMIT 1;
      IF FOUND THEN
        v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_memory', 'errorCode', v_mem.error_code, 'until', v_mem.expires_at);
      END IF;
    END IF;

`, '', 1, 'claim: tra bảng nhớ')

// ------------------------------------------------------------------------------------------------ report
let r = reportOld.block
r = patch(r, `  v_target_key text;
`, '', 1, 'report: biến v_target_key')
r = patch(r, `  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
`, '', 1, 'report: gán v_target_key')
r = patch(r, `        IF v_error_code IS NOT NULL AND coalesce((v_policy->>'remember_target_days')::integer, 0) > 0 AND v_target_key IS NOT NULL THEN
          -- V499: nhớ theo tài khoản (organization_id chỉ để tra cứu).
          INSERT INTO public.auto_target_memory AS m (organization_id, account_id, target_key, action_code, error_code, first_seen_at, last_seen_at, expires_at, hit_count)
          VALUES (coalesce(c.organization_id, 0), r.account_id, v_target_key, v_action, v_error_code, v_now, v_now,
                  v_now + make_interval(days => (v_policy->>'remember_target_days')::integer), 1)
          ON CONFLICT (account_id, target_key, action_code) DO UPDATE SET error_code = EXCLUDED.error_code,
            last_seen_at = EXCLUDED.last_seen_at, expires_at = EXCLUDED.expires_at, hit_count = m.hit_count + 1;
        END IF;

`, '', 1, 'report: ghi bảng nhớ')
if (/target_key|auto_target_memory|remember_target_days/.test(bodyOf(r).replace(/aka_agent_engine_target_key/g, ''))) {
  throw new Error('report: còn dấu vết nhớ mục tiêu')
}

// ------------------------------------------------------------------------------------------------ resolve_policy
let p = resolveOld.block
p = patch(p, `'remember_target_days','campaign_effect'`, `'campaign_effect'`, 1, 'resolve: danh sách trường')
p = patch(p, `jsonb_build_object('lock_action_codes', '[]'::jsonb, 'remember_target_days', 0,
`, `jsonb_build_object('lock_action_codes', '[]'::jsonb,
`, 1, 'resolve: mặc định')
for (const [label, block] of [['claim', c], ['report', r], ['resolve', p]]) {
  if (/auto_target_memory|remember_target_days/.test(bodyOf(block))) throw new Error(`${label}: còn tham chiếu bảng / cột nhớ`)
}

const NEW = { claim: md5(bodyOf(c)), report: md5(bodyOf(r)), resolve: md5(bodyOf(p)) }
const SIG = {
  claim: 'public.aka_agent_engine_claim_target_v1(jsonb)',
  report: 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)',
  resolve: 'public.aka_agent_engine_resolve_policy(text,bigint,text,text,text,text)'
}
const HISTORY_TAG = 'migration_v507'

const migration = `-- V507: bỏ hẳn nhớ mục tiêu theo tài khoản của engine v2 (V499 cấu trúc, V500 đặt 30 ngày) (12/11/2026).
-- SINH TỪ scripts/build-v507-sql.cjs, không sửa tay.
--
-- Tính năng chưa từng chạy trên production (bảng nhớ 0 dòng; lần chạy bộ mới cuối 11/11 21:16 VN, trước khi apply V499).
--   * claim_target_v1 (thân V505): bỏ đoạn tra bảng nhớ; không còn quyết định 'skip' của cổng target_memory.
--   * report_v1 (thân V503): bỏ đoạn ghi bảng nhớ.
--   * resolve_policy (thân V495): bỏ trường remember_target_days.
--   * Xoá cột auto_outcome_policies.remember_target_days (giá trị cũ ghi vào auto_outcome_policy_history, changed_by = '${HISTORY_TAG}', để
--     gỡ trả đúng), bảng auto_target_memory và dòng cổng target_memory của auto_engine_gates.
-- Chỉ engine v2 dùng các đối tượng này; bộ chạy cũ không đổi. DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm, sau V506.
-- Gỡ: rollback_v507_engine_drop_target_memory.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text; v_rows bigint;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v507_%') THEN
      RAISE EXCEPTION 'V507 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_engine_sms_push_v1(bigint,uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'V507 cần V506'; END IF;
  IF to_regclass('public.auto_target_memory') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'auto_outcome_policies' AND column_name = 'remember_target_days') THEN
    RAISE EXCEPTION 'V507 đã chạy: không còn auto_target_memory / remember_target_days';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.claim}');
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'V507: thân claim_target_v1 khác V505 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.report}');
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'V507: thân report_v1 khác V503 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.resolve}');
  IF v_md5 IS DISTINCT FROM '${LIVE.resolve}' THEN RAISE EXCEPTION 'V507: thân resolve_policy khác V495 (%)', v_md5; END IF;
  -- Ngoài 3 hàm trên, không hàm / view nào được dùng bảng hay cột nhớ.
  IF EXISTS (SELECT 1 FROM pg_proc pr
              WHERE (pr.prosrc ILIKE '%auto_target_memory%' OR pr.prosrc ILIKE '%remember_target_days%')
                AND pr.oid NOT IN (to_regprocedure('${SIG.claim}'), to_regprocedure('${SIG.report}'), to_regprocedure('${SIG.resolve}')))
     OR EXISTS (SELECT 1 FROM pg_views v WHERE v.definition ILIKE '%auto_target_memory%' OR v.definition ILIKE '%remember_target_days%') THEN
    RAISE EXCEPTION 'V507: còn hàm / view khác dùng auto_target_memory hoặc remember_target_days';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policy_history WHERE changed_by = '${HISTORY_TAG}') THEN
    RAISE EXCEPTION 'V507: auto_outcome_policy_history đã có dòng ${HISTORY_TAG}';
  END IF;
  SELECT count(*) INTO v_rows FROM public.auto_target_memory;
  RAISE NOTICE 'V507: auto_target_memory có % dòng, xoá cùng bảng', v_rows;
END $pre$;

-- Giá trị cũ của cột (kể cả 0) ghi như một lần sửa chính sách, để gỡ trả đúng.
INSERT INTO public.auto_outcome_policy_history (policy_id, revision, op, before_row, after_row, changed_by)
SELECT p.id, p.revision, 'update', jsonb_build_object('remember_target_days', p.remember_target_days),
       jsonb_build_object('note', 'V507: bỏ cột remember_target_days (bỏ nhớ mục tiêu theo tài khoản)'), '${HISTORY_TAG}'
  FROM public.auto_outcome_policies p
 WHERE p.remember_target_days IS NOT NULL;

${c}

${r}

${p}

DELETE FROM public.auto_engine_gates WHERE code = 'target_memory';
DROP TABLE public.auto_target_memory;
ALTER TABLE public.auto_outcome_policies DROP COLUMN remember_target_days;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.claim}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.claim}' THEN RAISE EXCEPTION 'V507 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.report}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'V507 postflight: report_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.resolve}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.resolve}' THEN RAISE EXCEPTION 'V507 postflight: resolve_policy %', v_md5; END IF;
  IF to_regclass('public.auto_target_memory') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'auto_outcome_policies' AND column_name = 'remember_target_days')
     OR EXISTS (SELECT 1 FROM public.auto_engine_gates WHERE code = 'target_memory')
     OR EXISTS (SELECT 1 FROM pg_proc pr WHERE pr.prosrc ILIKE '%auto_target_memory%' OR pr.prosrc ILIKE '%remember_target_days%') THEN
    RAISE EXCEPTION 'V507 postflight: còn đối tượng nhớ mục tiêu';
  END IF;
  IF has_function_privilege('anon', '${SIG.claim}', 'EXECUTE') OR has_function_privilege('authenticated', '${SIG.report}', 'EXECUTE')
     OR has_function_privilege('anon', '${SIG.resolve}', 'EXECUTE') THEN
    RAISE EXCEPTION 'V507 postflight: quyền hàm quá rộng';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V507: tạo lại bảng auto_target_memory (rỗng, đúng dạng sau V499), cột auto_outcome_policies.remember_target_days với giá trị cũ
-- (lấy từ auto_outcome_policy_history changed_by = '${HISTORY_TAG}', không tăng revision), dòng cổng target_memory, và thân cũ của
-- claim_target_v1 (V505), report_v1 (V503), resolve_policy (V495).
-- SINH TỪ scripts/build-v507-sql.cjs. DDL: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('public.auto_target_memory') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'auto_outcome_policies' AND column_name = 'remember_target_days') THEN
    RAISE EXCEPTION 'Gỡ V507: chưa có V507';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policy_history WHERE changed_by = '${HISTORY_TAG}') THEN
    RAISE EXCEPTION 'Gỡ V507: thiếu giá trị cũ trong auto_outcome_policy_history (${HISTORY_TAG})';
  END IF;
END $pre$;

CREATE TABLE public.auto_target_memory (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL,
  target_key text NOT NULL,
  action_code text NOT NULL REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  error_code text NOT NULL REFERENCES public.auto_error(error_code) ON DELETE RESTRICT,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 1,
  account_id bigint NOT NULL
);
CREATE UNIQUE INDEX auto_target_memory_account_key_v499 ON public.auto_target_memory (account_id, target_key, action_code);
CREATE INDEX auto_target_memory_expires_v495 ON public.auto_target_memory (expires_at);
COMMENT ON TABLE public.auto_target_memory IS 'V495/V499: nhớ mục tiêu hỏng theo từng tài khoản (chỉ ghi khi chính sách có remember_target_days); organization_id chỉ để tra cứu.';
COMMENT ON COLUMN public.auto_target_memory.account_id IS 'V499: tài khoản đã gặp lỗi; chỉ tài khoản này bỏ qua mục tiêu trong thời gian nhớ.';

DO $grants$
DECLARE v_seq text := pg_get_serial_sequence('public.auto_target_memory', 'id');
BEGIN
  ALTER TABLE public.auto_target_memory ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.auto_target_memory FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', v_seq);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.auto_target_memory FROM anon;
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', v_seq);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.auto_target_memory FROM authenticated;
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM authenticated', v_seq);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auto_target_memory TO service_role;
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
  END IF;
END $grants$;

INSERT INTO public.auto_engine_gates (code, on_error, retry_after_seconds, description)
VALUES ('target_memory', 'open', 0, 'Mục tiêu đã nhớ là hỏng cố định.');

ALTER TABLE public.auto_outcome_policies ADD COLUMN remember_target_days integer
  CONSTRAINT auto_outcome_policies_remember_target_days_check CHECK (remember_target_days >= 0);
ALTER TABLE public.auto_outcome_policies DISABLE TRIGGER auto_outcome_policies_revision_v495;
ALTER TABLE public.auto_outcome_policies DISABLE TRIGGER auto_outcome_policies_history_v495;
UPDATE public.auto_outcome_policies p SET remember_target_days = (h.before_row->>'remember_target_days')::integer
  FROM public.auto_outcome_policy_history h
 WHERE h.changed_by = '${HISTORY_TAG}' AND h.policy_id = p.id;
ALTER TABLE public.auto_outcome_policies ENABLE TRIGGER auto_outcome_policies_revision_v495;
ALTER TABLE public.auto_outcome_policies ENABLE TRIGGER auto_outcome_policies_history_v495;
DELETE FROM public.auto_outcome_policy_history WHERE changed_by = '${HISTORY_TAG}';

${resolveOld.block}

${claimOld.block}

${reportOld.block}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.claim}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'Gỡ V507 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.report}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'Gỡ V507 postflight: report_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.resolve}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.resolve}' THEN RAISE EXCEPTION 'Gỡ V507 postflight: resolve_policy %', v_md5; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_gates WHERE code = 'target_memory') THEN
    RAISE EXCEPTION 'Gỡ V507 postflight: thiếu dòng cổng target_memory';
  END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SIG, HISTORY_TAG }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v507_engine_drop_target_memory.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v507_engine_drop_target_memory.sql'), rollback)
  console.log('V507 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
