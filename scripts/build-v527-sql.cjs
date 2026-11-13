// Sinh migration V527: aka_agent_engine_claim_target_v1 không trả 'legacy_busy' vì claim token bộ cũ còn sót trên chiến dịch đã xoá /
// tạm dừng (sự cố bật cờ engine v2 cho 81 tổ chức đêm 13–14/11/2026: 49 chiến dịch giữ claim treo từ 29/09–13/11 chặn 18 tài khoản Server).
//
// Thân nguồn = thân V507 đang chạy production, đọc chỉ đọc 14/11/2026 01:33 VN (akachat cgjbsmqtfhqvttudyjzq):
//   md5(prosrc) e09100fd…, md5(pg_get_functiondef) f33e534e…, chủ postgres, SECURITY DEFINER, VOLATILE, search_path = '',
//   EXECUTE postgres / service_role / aka_agent_chat_api / aka_agent_desktop. V508–V526 không đụng hàm này.
//
// Chỉ đổi đoạn kiểm token bộ cũ theo chiến dịch. Một chiến dịch của tài khoản còn claim token KHÔNG còn chặn khi đủ cả:
//   - chiến dịch đã xoá (is_delete) hoặc "tạm dừng";
//   - không giữ unit lease (runtime_unit_token rỗng);
//   - không còn data "đang chạy" (data chưa xoá, như runningTargets của engine);
//   - claim (runtime_claimed_at) và lần ghi cuối của chiến dịch (updated_at, lúc tạm dừng / xoá) đều cũ hơn
//     engine.legacy_stale_claim_minutes phút (mặc định 30, tối thiểu 10; giá trị sai định dạng dùng 30).
// Token thao tác tài khoản (kiểm trước đó), unit lease, claim trên chiến dịch chờ / đang chạy và chiến dịch vừa tạm dừng vẫn chặn như cũ.
// Hàm claim không xoá token nào (bộ mới không bao giờ dùng / xoá token bộ cũ). Tài khoản không có chiến dịch nào giữ token: chỉ một câu
// EXISTS như trước, không đọc thiết lập.
// Chạy: node scripts/build-v527-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v507 = require('./build-v507-sql.cjs')

const NAME = 'migration_v527_engine_claim_skip_stale_legacy_token'
const ROLLBACK_NAME = 'rollback_v527_engine_claim_skip_stale_legacy_token'
const SIG = 'public.aka_agent_engine_claim_target_v1(jsonb)'
const SETTING = 'engine.legacy_stale_claim_minutes'
const DEFAULT_MINUTES = 30
const FLOOR_MINUTES = 10

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
// pg_get_functiondef của hàm này trên PostgreSQL 17 (đã đối chiếu từng byte với production 14/11/2026).
const defOf = body => `CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$${body}$function$
`

const claimOld = extract(v507.migration, 'aka_agent_engine_claim_target_v1', 'CREATE OR REPLACE FUNCTION', 'V507')
const LIVE = { claim: md5(claimOld.body), def: md5(defOf(claimOld.body)) }
if (LIVE.claim !== v507.NEW.claim || LIVE.claim !== 'e09100fd2b1fedfd951e22bfd4f8ab8a') {
  throw new Error('Thân claim_target_v1 của V507 không còn khớp bản đang chạy production (e09100fd…)')
}
if (LIVE.def !== 'f33e534e806885ce2bc4837d7ed7b330') {
  throw new Error('Định nghĩa claim_target_v1 dựng lại không khớp pg_get_functiondef production (f33e534e…)')
}

// ------------------------------------------------------------------------------------------------ claim
let c = claimOld.block
c = patch(c, `  v_cd_deadline timestamptz;
BEGIN
`, `  v_cd_deadline timestamptz;
  v_legacy_setting text;
  v_legacy_before timestamptz;
BEGIN
`, 1, 'claim: biến V527')
c = patch(c, `  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'campaign');
  END IF;
`, `  -- V527: claim token bộ cũ còn sót trên chiến dịch đã xoá / tạm dừng không chặn tài khoản nữa. Trigger
  -- aka_agent_clear_campaign_runtime_claim_metadata cố ý giữ claim khi chiến dịch Server chuyển "đang chạy" → "tạm dừng" (chờ nơi chạy tự
  -- nhả) và App Server nhả tài khoản mà không xoá claim đó, nên claim treo hàng tháng. Chỉ bỏ qua khi đủ cả: tài khoản không còn token
  -- thao tác (kiểm ở trên), chiến dịch không giữ unit lease, không còn data "đang chạy", và cả lúc claim lẫn lần ghi cuối của chiến dịch
  -- (lúc tạm dừng / xoá) đã cũ hơn ${SETTING} phút (mặc định ${DEFAULT_MINUTES}, tối thiểu ${FLOOR_MINUTES}). Unit lease,
  -- claim trên chiến dịch chờ / đang chạy và chiến dịch vừa tạm dừng giữa lượt vẫn chặn. Không xoá token nào ở đây.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    v_legacy_setting := btrim(public.aka_agent_engine_setting('${SETTING}', '${DEFAULT_MINUTES}'));
    v_legacy_before := v_now - make_interval(mins => CASE WHEN v_legacy_setting ~ '^[0-9]{1,6}$'
                                                         THEN greatest(${FLOOR_MINUTES}, v_legacy_setting::integer) ELSE ${DEFAULT_MINUTES} END);
    IF EXISTS (SELECT 1 FROM public.auto_campaigns x
                WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                  AND NOT (x.runtime_unit_token IS NULL
                           AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                           AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < v_legacy_before
                           AND coalesce(x.updated_at, '-infinity'::timestamptz) < v_legacy_before
                           AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                            WHERE d.campaign_id = x.id AND d.status = 'đang chạy'
                                              AND coalesce(d.is_delete, false) = false))) THEN
      RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'campaign');
    END IF;
  END IF;
`, 1, 'claim: bỏ qua claim treo')

const NEW = { claim: md5(bodyOf(c)), def: md5(defOf(bodyOf(c))) }
const ATTRS = `pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef OR p.provolatile IS DISTINCT FROM 'v'
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]`

const preflight = (label, expect, expectDef, done, msg) => `DO $pre$
DECLARE v_oid oid := to_regprocedure('${SIG}'); p pg_catalog.pg_proc%ROWTYPE; v_md5 text;
BEGIN
${label === 'V527' ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v527_%') THEN
      RAISE EXCEPTION 'V527 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${SIG}'; END IF;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  v_md5 := md5(p.prosrc);
  IF v_md5 = '${done}' THEN RAISE EXCEPTION '${msg.done}'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${msg.drift} (%)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 IS DISTINCT FROM '${expectDef}' THEN RAISE EXCEPTION '${label}: định nghĩa claim_target_v1 khác bản nguồn (%)', v_md5; END IF;
  IF ${ATTRS} THEN
    RAISE EXCEPTION '${label}: chủ sở hữu / thuộc tính claim_target_v1 khác bản đã đọc';
  END IF;
  -- Hậu kiểm so lại đúng quyền này (CREATE OR REPLACE giữ chủ sở hữu và quyền).
  PERFORM set_config('aka.v527_acl', coalesce(p.proacl::text, ''), true);
END $pre$;`

const postflight = (label, expect, expectDef) => `DO $post$
DECLARE v_oid oid := '${SIG}'::regprocedure; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF md5(p.prosrc) IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${label} postflight: thân claim_target_v1 %', md5(p.prosrc); END IF;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expectDef}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa claim_target_v1 %', md5(pg_get_functiondef(v_oid));
  END IF;
  IF ${ATTRS}
     OR coalesce(p.proacl::text, '') IS DISTINCT FROM current_setting('aka.v527_acl', true) THEN
    RAISE EXCEPTION '${label} postflight: chủ sở hữu / quyền / thuộc tính claim_target_v1 bị đổi';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '${label} postflight: quyền hàm quá rộng';
  END IF;
  IF NOT (has_function_privilege('service_role', v_oid, 'EXECUTE') AND has_function_privilege('aka_agent_chat_api', v_oid, 'EXECUTE')
          AND has_function_privilege('aka_agent_desktop', v_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '${label} postflight: thiếu quyền EXECUTE của bên gọi';
  END IF;
END $post$;`

const migration = `-- V527: claim_target_v1 không trả legacy_busy vì claim token bộ cũ còn sót trên chiến dịch đã xoá / tạm dừng.
-- SINH TỪ scripts/build-v527-sql.cjs, không sửa tay.
--
-- Trước V527: có bất kỳ chiến dịch nào của tài khoản còn runtime_claim_token / runtime_unit_token (kể cả đã xoá, đã tạm dừng hàng tháng) là
-- trả {"status":"legacy_busy","scope":"campaign"}; worker Fly thử lại mỗi 60 giây, không về bộ cũ, nên tài khoản đứng im sau khi bật cờ.
-- Sau V527: claim token trên chiến dịch đã xoá hoặc "tạm dừng", không unit lease, không data "đang chạy", claim và lần ghi cuối của chiến
-- dịch cũ hơn ${SETTING} phút (mặc định ${DEFAULT_MINUTES}, tối thiểu ${FLOOR_MINUTES}) thì bỏ qua. Token thao tác tài khoản, unit
-- lease, chiến dịch chờ / đang chạy giữ claim, chiến dịch vừa tạm dừng vẫn chặn. Hàm không xoá token.
-- Chỉ thay thân hàm claim (thân V507, md5 prosrc ${LIVE.claim}); CREATE OR REPLACE giữ chủ sở hữu, quyền, SECURITY DEFINER,
-- search_path. Không đổi bảng, dữ liệu, thiết lập. Chỉ engine v2 (Desktop bản mới, worker Fly) gọi hàm này; bộ chạy cũ không đổi.
-- Lệnh DDL làm PostgREST nạp lại schema (trigger DDL chung): apply ngoài giờ cao điểm.
-- Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('V527', LIVE.claim, LIVE.def, NEW.claim, {
  done: 'V527 đã chạy: thân claim_target_v1 đã là bản V527',
  drift: 'V527: thân claim_target_v1 khác V507, dừng để đối chiếu bản live'
})}

${c}

${postflight('V527', NEW.claim, NEW.def)}

COMMIT;
`

const rollback = `-- Gỡ V527: trả aka_agent_engine_claim_target_v1 về thân V507 (md5 prosrc ${LIVE.claim}): mọi claim / unit token bộ cũ trên
-- chiến dịch của tài khoản lại trả legacy_busy.
-- SINH TỪ scripts/build-v527-sql.cjs. Lệnh DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('Gỡ V527', NEW.claim, NEW.def, LIVE.claim, {
  done: 'Gỡ V527: thân claim_target_v1 đã là bản V507 (chưa apply V527 hoặc đã gỡ)',
  drift: 'Gỡ V527: thân claim_target_v1 không phải bản V527'
})}

${claimOld.block}

${postflight('Gỡ V527', LIVE.claim, LIVE.def)}

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SIG, SETTING, DEFAULT_MINUTES, FLOOR_MINUTES, NAME, ROLLBACK_NAME,
  blocks: { old: claimOld.block, new: c } }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log('V527 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
