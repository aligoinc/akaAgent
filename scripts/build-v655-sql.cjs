#!/usr/bin/env node
// Sinh migrations/migration_v655_send_exclusion_input_guards.sql (+ bản gỡ) từ thân hàm đã apply (V654 p2, V573).
// Sửa các lỗi tìm ra bằng scripts/send-exclusion-v654-fuzz.cjs: tham số số / uuid sai kiểu làm hàm DB ném lỗi ép kiểu của
// Postgres (API Web trả 500, Desktop hiện câu kỹ thuật) thay vì mã send_exclusion_*; số "đã gửi" trong danh sách chiến dịch
// không tính kết quả operationState committed trong khi bước loại trừ có tính.
// Chạy: node scripts/build-v655-sql.cjs
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ROOT = path.resolve(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const md5 = s => crypto.createHash('md5').update(s).digest('hex')

/** Khối CREATE [OR REPLACE] FUNCTION <name>(...) ... $function$; trong tệp. */
function fnBlock(sql, name) {
  const re = new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION ${name.replace(/[.$]/g, m => '\\' + m)}\\([\\s\\S]*?AS \\$function\\$[\\s\\S]*?\\$function\\$;`, 'm')
  const m = sql.match(re)
  if (!m) throw new Error('không thấy hàm ' + name)
  return m[0].replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION')
}
const prosrc = block => block.slice(block.indexOf('AS $function$') + 'AS $function$'.length, block.lastIndexOf('$function$'))
function patch(block, pairs) {
  let out = block
  for (const [from, to] of pairs) {
    const n = out.split(from).length - 1
    if (n !== 1) throw new Error(`đoạn cần thay xuất hiện ${n} lần: ${from.slice(0, 80)}`)
    out = out.replace(from, () => to)
  }
  return out
}

const p2 = read('migrations/migration_v654_send_exclusion_multi_zalo_p2.sql')
const v573 = read('migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql')
const OLD = {
  v2: fnBlock(p2, 'public.aka_agent_send_exclusion_v2'),
  sel: fnBlock(p2, 'public.aka_agent_internal_validate_send_exclusion_selection'),
  rules: fnBlock(v573, 'public.aka_agent_internal_validate_send_exclusion_rules'),
}
const KNOWN = { v2: '6620a8bda64da5a6cc5235cc400c8a9e' }
if (md5(prosrc(OLD.v2)) !== KNOWN.v2) throw new Error('thân aka_agent_send_exclusion_v2 trong V654 p2 khác md5 production')

const INT = 'private.aka_agent_send_exclusion_int'
const NEW = {
  v2: patch(OLD.v2, [
    ["v_account:=CASE WHEN jsonb_typeof(p_payload->'accountId')='number' THEN (p_payload->>'accountId')::bigint END;", `v_account:=${INT}(p_payload->'accountId');`],
    ["v_exclude:=CASE WHEN jsonb_typeof(p_payload->'excludeCampaignId')='number' THEN (p_payload->>'excludeCampaignId')::bigint END;", `v_exclude:=${INT}(p_payload->'excludeCampaignId');`],
    ["AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click') AND d.action_code IN ('zalo_message_friend','zalo_message_stranger') LIMIT 100001",
      "AND d.action_code IN ('zalo_message_friend','zalo_message_stranger')\n          AND (d.policy_snapshot->>'operationState'='committed' OR (d.policy_snapshot->>'operationState' IS NULL AND d.status IN ('thành công','đã gửi','đã nhận','đã xem','đã click'))) LIMIT 100001"],
    ["WHERE jsonb_typeof(b->'accountId') IS DISTINCT FROM 'number' OR COALESCE(b->>'matchMode','') NOT IN ('and','or'))", `WHERE ${INT}(b->'accountId') IS NULL OR COALESCE(b->>'matchMode','') NOT IN ('and','or'))`],
    ["gid:=CASE WHEN jsonb_typeof(p_payload->'id')='number' THEN (p_payload->>'id')::bigint END;",
      `gid:=${INT}(p_payload->'id');\n IF gid IS NULL AND COALESCE(p_payload->'id','null')<>'null' THEN RAISE EXCEPTION 'send_exclusion_group_not_found'; END IF;`],
    ["v_request:=(p_payload->>'requestId')::uuid;",
      "v_request:=CASE WHEN p_payload->>'requestId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_payload->>'requestId')::uuid END;"],
    ["AND jsonb_typeof(p_payload->'revision')='number' AND g.revision=(p_payload->>'revision')::bigint", `AND g.revision=${INT}(p_payload->'revision')`],
  ]),
  sel: patch(OLD.sel, [
    ["OR (entry.value->'groupId'<>'null' AND jsonb_typeof(entry.value->'groupId')<>'number') THEN RAISE EXCEPTION 'send_exclusion_group_reference_invalid'; END IF;",
      `OR (entry.value->'groupId'<>'null' AND ${INT}(entry.value->'groupId') IS NULL) THEN RAISE EXCEPTION 'send_exclusion_group_reference_invalid'; END IF;\n  IF entry.key !~ '^[0-9]{1,18}$' THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;`],
    ["IF EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->'blocklistIds') v WHERE jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<=0 OR trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;",
      `IF EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->'blocklistIds') v WHERE COALESCE(${INT}(v),0)<=0) THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;`],
    ["OR EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->v_key) v WHERE jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<=0 OR trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric))",
      `OR EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->v_key) v WHERE COALESCE(${INT}(v),0)<=0))`],
  ]),
  rules: patch(OLD.rules, [
    ["THEN RAISE EXCEPTION 'send_exclusion_rules_required'; END IF;\n",
      `THEN RAISE EXCEPTION 'send_exclusion_rules_required'; END IF;
 -- V655: id / cờ / thứ tự sai kiểu báo mã rõ ràng thay vì lỗi ép kiểu của Postgres.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
   OR ${INT}(x->'fieldId') IS NULL OR ${INT}(x->'operatorId') IS NULL
   OR COALESCE(jsonb_typeof(x->'isEnabled'),'null') NOT IN ('boolean','null')
   OR (COALESCE(x->'sortOrder','null')<>'null' AND (jsonb_typeof(x->'sortOrder')<>'number' OR (x->>'sortOrder') !~ '^-?[0-9]{1,9}$'))) THEN
  RAISE EXCEPTION 'send_exclusion_rules_invalid';
 END IF;
`],
  ]),
}
const SIG = {
  v2: 'public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)',
  sel: 'public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)',
  rules: 'public.aka_agent_internal_validate_send_exclusion_rules(jsonb,bigint,bigint,bigint)',
}
const before = Object.fromEntries(Object.keys(OLD).map(k => [SIG[k], md5(prosrc(OLD[k]))]))
const after = Object.fromEntries(Object.keys(NEW).map(k => [SIG[k], md5(prosrc(NEW[k]))]))
const HELPER = `CREATE FUNCTION ${INT}(p_value jsonb)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 -- Số nguyên không âm ≤ 18 chữ số trong jsonb; khác (chuỗi, số thực, âm, quá lớn, null) thì NULL.
 SELECT CASE WHEN jsonb_typeof(p_value)='number' AND (p_value#>>'{}') ~ '^[0-9]{1,18}$' THEN (p_value#>>'{}')::bigint END;
$function$;
REVOKE ALL ON FUNCTION ${INT}(jsonb) FROM PUBLIC;`
const guard = (label, expect, ledgerName) => `DO $guard$
DECLARE v_expected jsonb := '${JSON.stringify(expect)}'::jsonb; v_key text; v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE '${ledgerName}') THEN
      RAISE EXCEPTION '${label}: sổ migration đã có bản này, không chạy lại';
    END IF;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_expected->>v_key THEN RAISE EXCEPTION '${label}: thân % là %, cần %', v_key, v_md5, v_expected->>v_key; END IF;
  END LOOP;
END $guard$;`
const post = (label, expect) => `DO $post$
DECLARE v_expected jsonb := '${JSON.stringify(expect)}'::jsonb; v_key text; v_md5 text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_expected->>v_key THEN RAISE EXCEPTION '${label} postflight: thân % là %, cần %', v_key, v_md5, v_expected->>v_key; END IF;
  END LOOP;
END $post$;`

const migration = `-- V655: chặn tham số sai kiểu ở các hàm loại trừ gửi (sau V654), sửa số "đã gửi" trong danh sách chiến dịch.
-- Sinh bằng: node scripts/build-v655-sql.cjs (không sửa tay). Tìm ra bằng scripts/send-exclusion-v654-fuzz.cjs.
--   * aka_agent_send_exclusion_v2: accountId / excludeCampaignId / id / revision / requestId sai kiểu (số thực, âm, quá lớn,
--     chuỗi, uuid sai) trả mã send_exclusion_* thay vì lỗi ép kiểu; số "đã gửi" của danh sách chiến dịch tính cả kết quả
--     operationState committed như bước loại trừ.
--   * aka_agent_internal_validate_send_exclusion_selection: khoá Zalo không phải số, groupId / id danh sách là số thực hoặc quá lớn.
--   * aka_agent_internal_validate_send_exclusion_rules (dùng chung form cũ và mới): fieldId / operatorId / isEnabled / sortOrder sai
--     kiểu báo send_exclusion_rules_invalid. App và API Web luôn gửi đúng kiểu nên không đổi hành vi của cấu hình đang có.
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema. Gỡ: rollback_v655_send_exclusion_input_guards.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
${guard('V655', before, 'migration_v655_%')}

${HELPER}

${NEW.rules}

${NEW.sel}

${NEW.v2}

${post('V655', after)}
COMMIT;
`
const rollback = `-- Gỡ V655: trả thân hàm V654 / V573, bỏ hàm phụ. Sinh bằng node scripts/build-v655-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE v_expected jsonb := '${JSON.stringify(after)}'::jsonb; v_key text; v_md5 text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_key);
    IF v_md5 IS DISTINCT FROM v_expected->>v_key THEN RAISE EXCEPTION 'gỡ V655: thân % là %, cần %', v_key, v_md5, v_expected->>v_key; END IF;
  END LOOP;
END $guard$;

${OLD.rules}

${OLD.sel}

${OLD.v2}

DROP FUNCTION ${INT}(jsonb);
${post('gỡ V655', before)}
COMMIT;
`
fs.writeFileSync(path.join(ROOT, 'migrations/migration_v655_send_exclusion_input_guards.sql'), migration)
fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v655_send_exclusion_input_guards.sql'), rollback)
console.log('before', before)
console.log('after', after)
console.log('migration md5', md5(migration))
