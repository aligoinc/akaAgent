#!/usr/bin/env node
// ĐỀ XUẤT (chưa phải migration) thay "đoán Global ID ghi sai theo số dòng / tên" của V657 bằng kiểm nguồn gốc từng dòng zalo_users.
// Lấy thân hàm đang chạy (aka_agent_send_exclusion_match từ migration_v666_send_exclusion_review_fixes.sql — V666 apply 17:43:55 VN
// 26/11; gid_ok / person_keys / block_facts từ migration_v657_send_exclusion_global_match_p2.sql) rồi thay đúng các chỗ đọc zalo_users
// theo Global ID; mỗi chỗ thay phải trúng đúng một lần. SQL sinh ra mở bằng bước kiểm md5(pg_get_functiondef) = production 26/11 sau V666. Dùng cho bộ kiểm send-exclusion-gid-trust-fuzz.cjs; session viết
// migration loại trừ gửi lấy SQL này làm gốc.
//   node scripts/build-gid-trust-proposal-sql.cjs            → in SQL ra stdout
//   require('./build-gid-trust-proposal-sql.cjs').sql         → chuỗi SQL
// Nguyên nhân (đo 26/11/2026): hồ sơ thành viên nhóm Zalo trả globalId của chính nick đang xem; dòng chỉ có dữ liệu quét nhóm
// (raw_payload có zaloGroupId, không có khoá hồ sơ) luôn mang Global ID của người xem; quét nhóm còn đè cột global_id của dòng đã có
// Global ID đúng (raw_payload.globalId khác cột).
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')

function fnBlock(sql, name) {
  const re = new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION ${name.replace(/[.$]/g, m => '\\' + m)}\\([\\s\\S]*?AS \\$function\\$[\\s\\S]*?\\$function\\$\\s*;`, 'm')
  const m = sql.match(re)
  if (!m) throw new Error('không thấy hàm ' + name)
  return m[0].replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION')
}
function patch(block, pairs) {
  let out = block
  for (const [from, to] of pairs) {
    const n = out.split(from).length - 1
    if (n !== 1) throw new Error(`đoạn cần thay xuất hiện ${n} lần: ${from.slice(0, 120)}`)
    out = out.replace(from, () => to)
  }
  return out
}

const TRUST = 'private.aka_agent_zalo_user_gid_trusted(zu.raw_payload, zu.global_id)'
const p2 = read('migrations/migration_v657_send_exclusion_global_match_p2.sql')
const v666 = read('migrations/migration_v666_send_exclusion_review_fixes.sql')
// md5(pg_get_functiondef) production đọc 26/11/2026 sau V666 (17:43:55 VN): chỉ aka_agent_send_exclusion_match đổi so với V657.
const LIVE_MD5 = [
  ['private.aka_agent_zalo_gid_ok(bigint,text)', '1b8c3ec56d0a289aaa73309be1f876a2'],
  ['private.aka_agent_send_exclusion_person_keys(bigint,text,text,text,text)', '01b21650e451fa8855e27477fd341297'],
  ['private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)', '634462cc73b51aecc5a7aa80d3f989c3'],
  ['private.aka_agent_send_exclusion_block_facts(public.auto_campaigns,bigint,text,text,jsonb)', '907673fd7a7d58c594bdcae574fba6c2']
]
const preflight = `DO $pre$
DECLARE r record; v_md5 text;
BEGIN
 IF to_regprocedure('private.aka_agent_zalo_user_gid_trusted(jsonb,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'Đề xuất Global ID theo nguồn gốc: private.aka_agent_zalo_user_gid_trusted đã có (đã apply?)';
 END IF;
 FOR r IN SELECT * FROM (VALUES ${LIVE_MD5.map(([sig, m]) => `('${sig}','${m}')`).join(',\n  ')}) x(sig, md5) LOOP
  SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM r.md5 THEN RAISE EXCEPTION 'Đề xuất Global ID theo nguồn gốc: % khác bản production 26/11 sau V666 (md5 %)', r.sig, v_md5; END IF;
 END LOOP;
END $pre$;`

const trusted = `CREATE OR REPLACE FUNCTION private.aka_agent_zalo_user_gid_trusted(p_raw jsonb, p_gid text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
 -- Global ID của một dòng zalo_users có phải của chính người đó không, theo nguồn gốc dòng. Hồ sơ thành viên nhóm Zalo
 -- (/api/social/group/members) trả globalId của CHÍNH nick đang xem (đo 26/11/2026: mọi dòng chỉ có dữ liệu quét nhóm mang Global ID
 -- của người xem). Không tin khi: dòng chỉ có dữ liệu quét nhóm (raw_payload có zaloGroupId, không có khoá hồ sơ userId / username /
 -- bizPkg / phoneNumber), hoặc cột global_id khác raw_payload.globalId (quét nhóm đè Global ID đúng đọc từ hồ sơ / bạn bè).
 SELECT NULLIF(btrim(COALESCE(p_gid,'')),'') IS NOT NULL
  AND NOT (COALESCE(p_raw,'{}'::jsonb) ? 'zaloGroupId'
           AND NOT (COALESCE(p_raw,'{}'::jsonb) ?| ARRAY['userId','username','bizPkg','phoneNumber']))
  AND (NULLIF(btrim(COALESCE(p_raw->>'globalId','')),'') IS NULL OR btrim(p_raw->>'globalId') = btrim(p_gid));
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_zalo_user_gid_trusted(jsonb, text) FROM PUBLIC;`

const gidOk = `CREATE OR REPLACE FUNCTION private.aka_agent_zalo_gid_ok(p_account bigint, p_gid text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- Global ID p_gid ghi ở zalo_users của tài khoản p_account có dùng được làm Global ID của MỘT người không: không phải Global ID của
 -- chính nick; dưới 4 dòng cùng Global ID ở tài khoản này (đọc tối đa 4 dòng qua idx_zalo_users_account_global_id); có ít nhất một
 -- dòng tin được nếu có dòng (private.aka_agent_zalo_user_gid_trusted); và luật cũ "2–3 dòng mỗi dòng một tên" xét trên các dòng tin được (dòng
 -- quét nhóm mang Global ID người xem không được tính, nên không còn lọt khi nick không ghi nhận / đổi nick / có tên rỗng; dòng không có
 -- dấu vết nguồn gốc vẫn bị luật tên chặn như V657). Nơi đọc dòng theo Global ID phải lọc thêm dòng tin được.
 SELECT CASE
  WHEN NULLIF(btrim(COALESCE(p_gid,'')),'') IS NULL THEN false
  WHEN btrim(p_gid) = ANY(private.aka_agent_zalo_own_global_ids(p_account)) THEN false
  -- Không có dòng nào: dùng được (như V657; nhánh chiến dịch đã gửi so data->'target'->>'globalId' của tài khoản không lưu dòng).
  ELSE (SELECT count(*) < 4 AND (count(*) = 0 OR count(*) FILTER (WHERE x.ok) >= 1)
      AND NOT (count(*) FILTER (WHERE x.ok) >= 2 AND count(DISTINCT x.nm) FILTER (WHERE x.ok) = count(*) FILTER (WHERE x.ok)) FROM (
    SELECT ${TRUST} ok,
      lower(btrim(COALESCE(NULLIF(btrim(zu.zalo_name),''),NULLIF(btrim(zu.display_name),'')))) nm FROM public.zalo_users zu
     WHERE zu.account_id = p_account AND zu.global_id = btrim(p_gid) AND zu.global_id IS NOT NULL AND zu.global_id <> '' LIMIT 4) x)
 END;
$function$;`

const personKeys = patch(fnBlock(p2, 'private.aka_agent_send_exclusion_person_keys'), [
  [`(SELECT NULLIF(btrim(zu.global_id),'') FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=btrim(COALESCE(p_uid,'')))) gid),`,
   `(SELECT NULLIF(btrim(zu.global_id),'') FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=btrim(COALESCE(p_uid,''))\n     AND ${TRUST})) gid),`],
  [`FROM g JOIN public.zalo_users zu ON zu.account_id=p_account AND zu.global_id=g.gid AND zu.global_id IS NOT NULL AND zu.global_id<>''`,
   `FROM g JOIN public.zalo_users zu ON zu.account_id=p_account AND zu.global_id=g.gid AND zu.global_id IS NOT NULL AND zu.global_id<>''\n    AND ${TRUST}`]
])

const match = patch(fnBlock(v666, 'private.aka_agent_send_exclusion_match'), [
  // (a) Global ID của data từ Zalo ID ở tài khoản gửi
  [`SELECT NULLIF(btrim(zu.global_id),'') INTO v_gid FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=v_uid;`,
   `SELECT NULLIF(btrim(zu.global_id),'') INTO v_gid FROM public.zalo_users zu WHERE zu.account_id=p_account AND zu.zalo_uid=v_uid\n   AND ${TRUST};`],
  // (b) danh sách Zalo ID
  [`WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>'') ELSE false END)`,
   `WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>''\n        AND ${TRUST}) ELSE false END)`],
  // (c) Nhóm data Zalo UID
  [`CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE v_has_person AND zu.account_id=a.id AND zu.global_id=v_gid\n        AND zu.global_id IS NOT NULL AND zu.global_id<>'' OFFSET 0) zu`,
   `CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE v_has_person AND zu.account_id=a.id AND zu.global_id=v_gid\n        AND zu.global_id IS NOT NULL AND zu.global_id<>'' AND ${TRUST} OFFSET 0) zu`],
  // (d) chiến dịch đã gửi: mọi Zalo ID của Global ID
  [`CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE zu.account_id=a.id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>'' OFFSET 0) zu`,
   `CROSS JOIN LATERAL (SELECT zu.zalo_uid FROM public.zalo_users zu WHERE zu.account_id=a.id AND zu.global_id=v_gid AND zu.global_id IS NOT NULL AND zu.global_id<>''\n      AND ${TRUST} OFFSET 0) zu`],
  // (e) chiến dịch đã gửi: Zalo ID của data đã gửi thuộc Global ID ở tài khoản đã gửi
  [`OR EXISTS(SELECT 1 FROM public.zalo_users zu WHERE zu.account_id=d.account_id AND zu.zalo_uid=i.iuid AND zu.global_id=v_gid))))`,
   `OR EXISTS(SELECT 1 FROM public.zalo_users zu WHERE zu.account_id=d.account_id AND zu.zalo_uid=i.iuid AND zu.global_id=v_gid\n             AND ${TRUST}))))`]
])

const blockFacts = patch(fnBlock(p2, 'private.aka_agent_send_exclusion_block_facts'), [
  [`   WHERE zu.account_id=p_block_account AND zu.global_id=p_global_id AND zu.global_id IS NOT NULL AND zu.global_id<>'';`,
   `   WHERE zu.account_id=p_block_account AND zu.global_id=p_global_id AND zu.global_id IS NOT NULL AND zu.global_id<>''\n     AND ${TRUST};`]
])

const sql = [preflight, trusted, gidOk, personKeys, match, blockFacts].join('\n\n') + '\n'
// Bản gỡ: trả 4 hàm về đúng thân production 26/11 sau V666 rồi xoá hàm mới (kiểm md5 sau khi trả).
const rollbackSql = [fnBlock(p2, 'private.aka_agent_zalo_gid_ok'), fnBlock(p2, 'private.aka_agent_send_exclusion_person_keys'),
  fnBlock(v666, 'private.aka_agent_send_exclusion_match'), fnBlock(p2, 'private.aka_agent_send_exclusion_block_facts'),
  'DROP FUNCTION IF EXISTS private.aka_agent_zalo_user_gid_trusted(jsonb, text);',
  preflight.replace("IF to_regprocedure('private.aka_agent_zalo_user_gid_trusted(jsonb,text)') IS NOT NULL THEN", "IF false THEN")
    .replace(/Đề xuất Global ID theo nguồn gốc: % khác bản production/, 'Gỡ đề xuất Global ID: % chưa về bản production')].join('\n\n') + '\n'
// File migration V668 p2 (hàm private.aka_agent_zalo_user_gid_trusted đã có từ V668 p1, apply 18:34 VN 26/11).
const P1_TRUSTED_MD5 = '5cb04d481f679bcd5bf24de8a202b011'
const migrationP2 = `-- V668 p2 (26/11/2026): hàm so khớp loại trừ gửi chỉ dùng dòng zalo_users có Global ID tin được (nguồn gốc dòng, V668 p1).
-- Sinh bằng: node scripts/build-gid-trust-proposal-sql.cjs --migration-p2 (thân match từ V666, gid_ok / person_keys / block_facts
-- từ V657 p2; 9 chỗ thay). Kiểm: scripts/send-exclusion-gid-trust-smoke.cjs, send-exclusion-gid-trust-fuzz.cjs, smoke V657 qua
-- scripts/gid-trust-preload.cjs. Gỡ: migrations/rollback_v668_zalo_users_global_id_guard_p2.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v668_zalo_users_global_id_guard_p1') THEN
  RAISE EXCEPTION 'V668 p2 cần V668 p1 trước';
 END IF;
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v668_zalo_users_global_id_guard_p2') THEN
  RAISE EXCEPTION 'V668 p2 đã có trong sổ migration, không chạy lại';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_zalo_user_gid_trusted(jsonb,text)'))) IS DISTINCT FROM '${P1_TRUSTED_MD5}' THEN
  RAISE EXCEPTION 'V668 p2: private.aka_agent_zalo_user_gid_trusted khác bản V668 p1';
 END IF;
END $pre$;
${preflight.replace(/ IF to_regprocedure\('private\.aka_agent_zalo_user_gid_trusted\(jsonb,text\)'\) IS NOT NULL THEN\n  RAISE EXCEPTION [^\n]*\n END IF;\n/, '')}

${[gidOk, personKeys, match, blockFacts].join('\n\n')}

COMMIT;
`
const rollbackP2 = `-- Gỡ V668 p2: trả 4 hàm so khớp về thân production 26/11 sau V666 (md5 kiểm sau khi trả), giữ V668 p1.
BEGIN;
SET LOCAL lock_timeout = '5s';
${[fnBlock(p2, 'private.aka_agent_zalo_gid_ok'), fnBlock(p2, 'private.aka_agent_send_exclusion_person_keys'),
  fnBlock(v666, 'private.aka_agent_send_exclusion_match'), fnBlock(p2, 'private.aka_agent_send_exclusion_block_facts')].join('\n\n')}

${preflight.replace(/ IF to_regprocedure\('private\.aka_agent_zalo_user_gid_trusted\(jsonb,text\)'\) IS NOT NULL THEN\n  RAISE EXCEPTION [^\n]*\n END IF;\n/, '').replace(/Đề xuất Global ID theo nguồn gốc: % khác bản production/, 'Gỡ V668 p2: % chưa về bản production')}

COMMIT;
`
module.exports = { sql, rollbackSql, migrationP2, rollbackP2, LIVE_MD5, parts: { preflight, trusted, gidOk, personKeys, match, blockFacts } }
if (require.main === module) {
  const a = process.argv.slice(2)
  process.stdout.write(a.includes('--migration-p2') ? migrationP2 : a.includes('--rollback-p2') ? rollbackP2 : a.includes('--rollback') ? rollbackSql : sql)
}
