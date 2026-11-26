#!/usr/bin/env node
// Sinh migrations/migration_v664_campaign_sheet_sync_key_speed.sql + bản gỡ từ nguyên văn V662.
// V664 chỉ làm việc lọc trùng của đồng bộ Google Sheet rẻ hơn, kết quả không đổi:
//  1. private.aka_agent_campaign_sheet_key viết lại bằng plpgsql, không SET search_path, không gọi các hàm phụ có SET
//     (mỗi lần gọi V662 đặt lại search_path 5-6 lần), SĐT gọi normalize_phone một lần thay vì hai.
//  2. Khoá mỗi dòng chỉ tính một lần: LATERAL ... OFFSET 0 (V662 bị planner gộp nên tính ở cả WHERE lẫn SELECT),
//     finish tính khoá dòng Sheet một lần vào bảng tạm rồi đếm (V662 tính ba lần), cột phone của dòng thêm lấy luôn khoá.
// Chạy: node scripts/build-v664-sql.cjs   (ghi đè 2 file; md5 V662 production đọc 26/11/2026 ở PRE).
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const v662 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v662_campaign_sheet_sync.sql'), 'utf8')

const PRE = {
  key: '7a0a346f82e754da7e0d49fbe0426d93',
  unmatched: '098cc739805ebbfb1d44ef0cb4a2389e',
  finish: '2ec84b4e87e4972aca61f0de22b22535',
  // Khoá SĐT mới = normalize_phone + kiểm dạng số, đúng thân aka_agent_internal_normalize_phone đọc 26/11/2026.
  normalizePhone: 'f6ccb574895043480e6523193f7be007',
  internalNormalizePhone: 'b3ad52bceed9a68a6648956fbc622629',
}

function block (startMarker) {
  const start = v662.indexOf(startMarker)
  if (start < 0) throw new Error('không thấy ' + startMarker)
  const end = v662.indexOf('\n$fn$;\n', start)
  if (end < 0) throw new Error('không thấy cuối ' + startMarker)
  return v662.slice(start, end + '\n$fn$;\n'.length)
}
function replaceOnce (text, a, b) {
  const n = text.split(a).length - 1
  if (n !== 1) throw new Error(`cần đúng 1 chỗ, thấy ${n}: ${a.slice(0, 80)}`)
  return text.replace(a, () => b)
}
const orReplace = s => replaceOnce(s, 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')

const oldKey = block('CREATE FUNCTION private.aka_agent_campaign_sheet_key(')
const oldUnmatched = block('CREATE FUNCTION private.aka_agent_campaign_sheet_unmatched_keys(')
const oldFinish = block('CREATE FUNCTION public.aka_agent_campaign_sheet_finish(')

// Lớp ký tự khoảng trắng kiểu JS chép nguyên văn từ hàm trim của V662 (có ký tự Unicode không in được).
const trimFn = block('CREATE FUNCTION private.aka_agent_campaign_sheet_trim(')
// [\s\S] vì lớp ký tự có U+2028 / U+2029 mà "." của JS không khớp.
const ws = trimFn.match(/'\^\[([\s\S]*?)\]\+\|/)[1]
const spaceFn = block('CREATE FUNCTION private.aka_agent_campaign_sheet_space(')
if (!spaceFn.includes(`'[${ws}]+'`)) throw new Error('lớp khoảng trắng của trim / space khác nhau')
const TRIM = v => `pg_catalog.regexp_replace(${v}, '^[${ws}]+|[${ws}]+$', '', 'g')`
const SPACE = (v, w) => `pg_catalog.regexp_replace(${v}, '[${ws}]+', ${w}, 'g')`
const emailRe = oldKey.match(/AND e ~ '(.*?)'\n/)[1]
const linkRe = oldKey.match(/regexp_match\(private\.aka_agent_campaign_sheet_trim\(p_uid\), '(.*?)', 'i'\)/)[1]

const newKey = `CREATE OR REPLACE FUNCTION private.aka_agent_campaign_sheet_key(p_field text, p_action_id text, p_phone text, p_uid text, p_email text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
-- Cùng kết quả với bản V662 (luật của cửa sổ Upload, src/shared/campaignImportVerification.ts). Không SET search_path:
-- mọi hàm gọi đều ghi rõ schema; hàm chỉ được gọi từ các hàm SECURITY DEFINER đặt search_path = pg_catalog, public.
DECLARE v text; m text[];
BEGIN
  IF p_field = 'phone' THEN
    v := public.normalize_phone(p_phone);
    RETURN CASE WHEN v ~ '^0[35789][0-9]{8}$' THEN v END;
  ELSIF p_field = 'email' THEN
    v := pg_catalog.lower(${TRIM('p_email')});
    IF pg_catalog.length(v) <= 254
       AND v ~ '${emailRe}'
       AND pg_catalog.split_part(v, '@', 1) !~ '(^\\.|\\.$|\\.\\.)' AND pg_catalog.length(pg_catalog.split_part(v, '@', 2)) <= 253 THEN
      RETURN v;
    END IF;
    RETURN NULL;
  END IF;
  IF p_action_id = 'facebook_find_data_search' THEN
    v := pg_catalog.lower(${SPACE(TRIM('p_uid'), "' '")});
  ELSIF p_action_id = 'zalo_message_group_member' THEN
    v := ${SPACE('p_uid', "''")};
    IF v !~ '^[0-9]{5,30}$' THEN v := NULL; END IF;
  ELSIF p_action_id = 'zalo_join_group_link' THEN
    m := pg_catalog.regexp_match(${TRIM('p_uid')}, '${linkRe}', 'i');
    v := 'https://zalo.me/g/' || m[1];
  ELSE
    v := pg_catalog.regexp_replace(${SPACE('p_uid', "''")}, '/+$', '');
  END IF;
  RETURN CASE WHEN pg_catalog.length(v) <= 2048 THEN NULLIF(v, '') END;
END
$fn$;
`

let newUnmatched = orReplace(oldUnmatched)
newUnmatched = replaceOnce(newUnmatched,
  'CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(p_field, p_action_id, d.phone, d.uid, d.email) AS key) k',
  'CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(p_field, p_action_id, d.phone, d.uid, d.email) AS key OFFSET 0) k')

let newFinish = orReplace(oldFinish)
newFinish = replaceOnce(newFinish, '  v_unique integer; c record;', '  v_unique integer; v_nokey integer; c record;')
newFinish = replaceOnce(newFinish,
  '  CREATE TEMP TABLE IF NOT EXISTS campaign_sheet_existing (campaign_id bigint, key text) ON COMMIT DROP;\n  TRUNCATE campaign_sheet_plan, campaign_sheet_existing;\n',
  '  CREATE TEMP TABLE IF NOT EXISTS campaign_sheet_existing (campaign_id bigint, key text) ON COMMIT DROP;\n' +
  '  CREATE TEMP TABLE IF NOT EXISTS campaign_sheet_incoming (\n' +
  '    ord integer, key text, name text, uid text, email text, info1 text, info2 text, info3 text,\n' +
  '    info4 text, info5 text, phone_carrier text) ON COMMIT DROP;\n' +
  '  TRUNCATE campaign_sheet_plan, campaign_sheet_existing, campaign_sheet_incoming;\n')
const oldIncoming = newFinish.slice(newFinish.indexOf('  -- Dòng gửi lên: tính khoá ở DB'), newFinish.indexOf('  -- Mốc ban đầu: dòng Upload đã đọc mà không thêm.'))
if (!oldIncoming.includes('GET DIAGNOSTICS v_unique = ROW_COUNT;')) throw new Error('không thấy khối dòng gửi lên')
newFinish = replaceOnce(newFinish, oldIncoming, `  -- Dòng gửi lên: tính khoá ở DB (không tin khoá của bên gọi), mỗi dòng tính một lần; mỗi khoá giữ dòng đầu.
  -- Dòng không phải object hoặc không ra khoá là dòng sai. Khoá SĐT chính là SĐT đã chuẩn hoá.
  INSERT INTO campaign_sheet_incoming (ord, key, name, uid, email, info1, info2, info3, info4, info5, phone_carrier)
  SELECT o::integer, k.key,
         NULLIF(left(btrim(COALESCE(x->>'name', '')), 500), ''),
         CASE WHEN v_field = 'uid' THEN btrim(x->>'uid') END,
         CASE WHEN v_field = 'email' THEN lower(btrim(x->>'email')) END,
         NULLIF(left(COALESCE(x->>'info1', ''), 4000), ''), NULLIF(left(COALESCE(x->>'info2', ''), 4000), ''),
         NULLIF(left(COALESCE(x->>'info3', ''), 4000), ''), NULLIF(left(COALESCE(x->>'info4', ''), 4000), ''),
         NULLIF(left(COALESCE(x->>'info5', ''), 4000), ''),
         CASE WHEN v_field = 'phone' THEN NULLIF(left(COALESCE(x->>'phoneCarrier', ''), 40), '') END
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(x, o)
   CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(x) = 'object'
     THEN private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, x->>'phone', x->>'uid', x->>'email') END AS key OFFSET 0) k;
  SELECT count(*) FILTER (WHERE key IS NULL)::integer INTO v_nokey FROM campaign_sheet_incoming;
  INSERT INTO campaign_sheet_plan (ord, key, name, phone, uid, email, info1, info2, info3, info4, info5, phone_carrier)
  SELECT DISTINCT ON (i.key) i.ord, i.key, i.name, CASE WHEN v_field = 'phone' THEN i.key END, i.uid, i.email,
         i.info1, i.info2, i.info3, i.info4, i.info5, i.phone_carrier
    FROM campaign_sheet_incoming i
   WHERE i.key IS NOT NULL
   ORDER BY i.key, i.ord;
  GET DIAGNOSTICS v_unique = ROW_COUNT;
  v_invalid := v_invalid + v_nokey;
  v_dups := v_dups + GREATEST(jsonb_array_length(v_rows) - v_unique - v_nokey, 0);

`)
newFinish = replaceOnce(newFinish,
  'CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, d.phone, d.uid, d.email) AS key) k',
  'CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, d.phone, d.uid, d.email) AS key OFFSET 0) k')

const SIGS = {
  key: 'private.aka_agent_campaign_sheet_key(text,text,text,text,text)',
  unmatched: 'private.aka_agent_campaign_sheet_unmatched_keys(text,text,jsonb,bigint[],text[])',
  finish: 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)',
  normalizePhone: 'public.normalize_phone(text)',
  internalNormalizePhone: 'public.aka_agent_internal_normalize_phone(text)',
}
const md5Of = k => `md5(pg_get_functiondef('${SIGS[k]}'::regprocedure))`
const grantsCheck = `  IF has_function_privilege('anon', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', '${SIGS.key}', 'EXECUTE')
    OR has_function_privilege('anon', '${SIGS.key}', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', '${SIGS.unmatched}', 'EXECUTE')
  THEN RAISE EXCEPTION '%: quyền hàm sai', v_tag; END IF;`

function wrap (tag, ledger, expect, bodies, extraPre = '') {
  const pre = Object.entries(expect).map(([k, m]) =>
    `  IF ${md5Of(k)} IS DISTINCT FROM '${m}' THEN RAISE EXCEPTION '%: % khác bản đã đọc', v_tag, '${k}'; END IF;`).join('\n')
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE v_tag text := '${tag}';
BEGIN
${extraPre}${pre}
END
$preflight$;

${bodies.join('\n')}
-- Các hàm CREATE OR REPLACE giữ nguyên quyền cũ; khoá lại để chắc chắn.
REVOKE ALL ON FUNCTION ${SIGS.key} FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION ${SIGS.unmatched} FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION ${SIGS.finish} FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION ${SIGS.finish} TO service_role;

DO $postflight$
DECLARE v_tag text := '${tag}';
BEGIN
${grantsCheck}
END
$postflight$;
${ledger}
COMMIT;
`
}

const header = `-- V664: đồng bộ Google Sheet của chiến dịch (V662) lọc trùng rẻ hơn, kết quả không đổi. Sinh bằng node scripts/build-v664-sql.cjs.
-- Đo production 26/11/2026 (chiến dịch 8.685 dòng): khoá V662 565 ms / lượt tính (normalize_phone riêng 137 ms) và bị tính
-- hai lần mỗi dòng ⇒ ~1,2 s CPU DB mỗi chiến dịch mỗi lượt đồng bộ.
--  1. Hàm khoá: plpgsql không SET search_path, không gọi hàm phụ có SET (V662 đặt lại search_path 5-6 lần mỗi lần gọi).
--  2. Khoá mỗi dòng tính một lần (LATERAL ... OFFSET 0; finish tính khoá dòng Sheet một lần vào bảng tạm).
-- Chỉ thay thân 3 hàm, không đổi bảng / quyền. CREATE OR REPLACE FUNCTION nạp lại schema PostgREST: apply buổi tối.
`
const preNotApplied = `  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v664_%') THEN
    RAISE EXCEPTION '%: đã có trong sổ migration, không chạy lại', v_tag;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v662_campaign_sheet_sync') THEN
    RAISE EXCEPTION '%: cần V662 trước', v_tag;
  END IF;
`
const migration = header + wrap('v664', '', PRE, [newKey, newUnmatched, newFinish], preNotApplied)
fs.writeFileSync(path.join(ROOT, 'migrations/migration_v664_campaign_sheet_sync_key_speed.sql'), migration)

// Bản gỡ: trả 3 hàm về nguyên văn V662 (không kiểm md5 trước vì chỉ chạy khi cần gỡ).
const rollback = `-- Gỡ V664: trả 3 hàm đồng bộ Google Sheet của chiến dịch về nguyên văn V662. Sinh bằng node scripts/build-v664-sql.cjs.
` + wrap('rollback v664', '', {}, [orReplace(oldKey), orReplace(oldUnmatched), orReplace(oldFinish)])
fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v664_campaign_sheet_sync_key_speed.sql'), rollback)
const crypto = require('crypto')
const md5 = s => crypto.createHash('md5').update(s).digest('hex')
console.log('migration_v664', md5(migration), migration.length, 'byte')
console.log('rollback_v664', md5(rollback), rollback.length, 'byte')
