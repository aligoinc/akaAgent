#!/usr/bin/env node
// V681: engine v2 không để tài khoản kẹt "đang chạy" (anh chốt 27/11/2026: "Cả DB và app"; rồi "Bỏ, dọn một lần": không tự gỡ định kỳ).
//
// Sự cố 27/11/2026: aka_agent_engine_release_v1 / aka_agent_engine_close_stale_v1 chỉ trả tài khoản về "chờ xử lý" khi không chiến dịch
// nào của tài khoản còn dấu giữ lượt của bộ cũ (runtime_claim_token / runtime_unit_token), kể cả dấu trên chiến dịch đã xoá / tạm dừng mà
// bước nhận lượt đã bỏ qua từ V527. Bộ lập lịch Desktop / App Server / worker Fly chỉ nhận tài khoản "chờ xử lý", nên mỗi tài khoản như vậy
// chạy được một lượt rồi đứng im, không ghi lý do (153 tài khoản Zalo Server đã gỡ tay 15:21 VN 27/11:
// migrations/snapshots/engine-stale-claim-release-20261127/).
//
// - private.aka_agent_engine_legacy_hold_v1(account, now): tài khoản còn dấu giữ lượt của bộ cũ CHƯA quá hạn, đúng luật V527 của
//   aka_agent_engine_claim_target_v1 (cùng câu chữ, cùng thiết lập engine.legacy_stale_claim_minutes).
// - private.aka_agent_engine_account_holder_v1(account, now): lý do tài khoản còn bị giữ ('operation' / 'lease' / 'open_run' /
//   'legacy_claim' / 'campaign_running') hoặc NULL khi không gì giữ. Worker Fly (ChatApi) dùng ở câu tìm chiến dịch; bước dọn một lần
//   dưới đây và câu dò scripts/engine-v2-stuck-accounts.cjs dùng cùng luật.
// - release_v1, close_stale_v1: luật trả tài khoản về "chờ xử lý" dùng legacy_hold_v1 thay cho "còn token là giữ" (cùng luật với bước
//   nhận lượt). Đây là chỗ sửa lỗi; không thêm bước nào vào job close_stale (pg_cron mỗi phút) ngoài luật đó.
// - Dọn một lần lúc apply (như lần gỡ tay 15:21): xoá dấu giữ lượt quá hạn của bộ cũ trên chiến dịch đích 'server' của tài khoản Zalo
//   Server chưa xoá; trả tài khoản Zalo Server "đang chạy" mà không gì giữ, lần ghi cuối quá ONCE_GRACE_MINUTES phút, về "chờ xử lý".
//   Chỉ tài khoản Zalo Server (phạm vi của sự cố): tài khoản khác "đang chạy" lâu là đồ sót của bộ cũ (27/11: 1 tài khoản Facebook bản app
//   cũ kẹt từ 07/10), gỡ thì chiến dịch của khách tự chạy lại sau nhiều tuần. Bỏ qua dòng đang bị khoá, không gỡ lại sau đó: tài khoản còn
//   kẹt hiện ở câu dò.
// Chiến dịch "đang chạy" còn sống (có data "đang chạy", hoặc ghi / chạy trong engine.account_hold_campaign_idle_hours giờ, mặc định 6)
// vẫn giữ tài khoản: claim bộ cũ Desktop (aka_agent_claim_campaign_runtime_checked) đặt tài khoản + chiến dịch "đang chạy" mà không ghi
// token nào.
//
// Nguồn: thân release_v1 / close_stale_v1 sau V670 (scripts/build-v670-sql.cjs, defs), đã so md5 với production 27/11/2026 15:40 VN
// (prosrc d47d1828… / 09dfc2d7…, pg_get_functiondef 85ee6d85… / b4e2c166…). Thân hàm mới không ghi số migration trong chú thích: đổi số thì
// md5 thân hàm không đổi.
// Chạy: node scripts/build-v681-sql.cjs (ghi migration + bản gỡ). Không sửa tay các file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v681'
const BASE = `${VERSION}_engine_account_hold_rule`
const NAME = `migration_${BASE}`
const ROLLBACK_NAME = `rollback_${BASE}`
const LABEL = VERSION.toUpperCase()

const SETTING_IDLE = 'engine.account_hold_campaign_idle_hours'
const SETTING_LEGACY = 'engine.legacy_stale_claim_minutes'
/** Dọn một lần lúc apply: tài khoản "đang chạy" phải không ghi gì quá chừng này phút mới trả về "chờ xử lý". */
const ONCE_GRACE_MINUTES = 3

function patch(text, from, to, label) {
  const n = text.split(from).length - 1
  if (n !== 1) throw new Error(`${label}: cần đúng 1 chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = def => {
  const m = /AS \$function\$([\s\S]*)\$function\$\n$/.exec(def)
  if (!m) throw new Error('không tách được thân hàm')
  return m[1]
}

// ---------------------------------------------------------------------------------------------------------------- nguồn (sau V670)
const v670 = require('./build-v670-sql.cjs')
const LIVE = {
  release: {
    sig: 'public.aka_agent_engine_release_v1(bigint,uuid)', def: v670.defs.release.def,
    srcMd5: 'd47d1828addaaf816451d2f3a53c3990', defMd5: '85ee6d8541b0d5cd0462063dc11bccf0'
  },
  close_stale: {
    sig: 'public.aka_agent_engine_close_stale_v1(integer)', def: v670.defs.close_stale.def,
    srcMd5: '09dfc2d77a89efc497131d78444c9f35', defMd5: 'b4e2c1664e90212edec6fa2bfd036009'
  }
}
for (const [key, live] of Object.entries(LIVE)) {
  if (md5(live.def) !== live.defMd5) throw new Error(`${key}: định nghĩa sau V670 khác bản production đã đối chiếu (${md5(live.def)})`)
  if (md5(bodyOf(live.def)) !== live.srcMd5) throw new Error(`${key}: thân sau V670 khác bản production đã đối chiếu (${md5(bodyOf(live.def))})`)
}

// ------------------------------------------------------------------------------------------------------------------- hàm mới
const LEGACY_HOLD_SIG = 'private.aka_agent_engine_legacy_hold_v1(bigint,timestamp with time zone)'
const HOLDER_SIG = 'private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)'

const legacyHoldBody = `
DECLARE
  v_setting text;
  v_before timestamptz;
BEGIN
  -- Tài khoản còn dấu giữ lượt của bộ cũ CHƯA quá hạn. Cùng luật với bước nhận lượt (aka_agent_engine_claim_target_v1): dấu trên chiến
  -- dịch đã xoá / "tạm dừng", không giữ unit lease, không còn data "đang chạy", và cả lúc claim lẫn lần ghi cuối của chiến dịch đã cũ hơn
  -- ${SETTING_LEGACY} phút (mặc định 30, tối thiểu 10) là dấu sót lại, không giữ tài khoản. Không có chiến dịch nào giữ token: chỉ
  -- một câu EXISTS, không đọc thiết lập.
  IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns x
                  WHERE x.account_id = p_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    RETURN false;
  END IF;
  v_setting := btrim(public.aka_agent_engine_setting('${SETTING_LEGACY}', '30'));
  v_before := coalesce(p_now, clock_timestamp()) - make_interval(mins => CASE WHEN v_setting ~ '^[0-9]{1,6}$'
                                                                            THEN greatest(10, v_setting::integer) ELSE 30 END);
  RETURN EXISTS (SELECT 1 FROM public.auto_campaigns x
                  WHERE x.account_id = p_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                    AND NOT (x.runtime_unit_token IS NULL
                             AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                             AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < v_before
                             AND coalesce(x.updated_at, '-infinity'::timestamptz) < v_before
                             AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                              WHERE d.campaign_id = x.id AND d.status = 'đang chạy'
                                                AND coalesce(d.is_delete, false) = false)));
END
`
const legacyHoldDef = `CREATE OR REPLACE FUNCTION private.aka_agent_engine_legacy_hold_v1(p_account_id bigint, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$${legacyHoldBody}$function$
`

const holderBody = `
DECLARE
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_hours text;
  v_alive_after timestamptz;
BEGIN
  -- Lý do tài khoản còn bị giữ, NULL khi không gì giữ (không xét trạng thái tài khoản). Thứ tự: token thao tác tài khoản (thao tác tài
  -- khoản, claim bộ cũ Server), lease engine (mọi làn, kể cả lease đã hết hạn chưa dọn), lượt engine còn mở, dấu giữ lượt của bộ cũ chưa
  -- quá hạn (luật V527), chiến dịch chưa xoá "đang chạy" còn sống: có data "đang chạy", hoặc ghi / chạy trong ${SETTING_IDLE}
  -- giờ (mặc định 6). Claim bộ cũ Desktop đặt tài khoản + chiến dịch "đang chạy" mà không ghi token nào.
  IF EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.id = p_account_id AND a.runtime_operation_claim_token IS NOT NULL) THEN
    RETURN 'operation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = p_account_id) THEN RETURN 'lease'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = p_account_id AND tr.completed_at IS NULL) THEN
    RETURN 'open_run';
  END IF;
  IF private.aka_agent_engine_legacy_hold_v1(p_account_id, v_now) THEN RETURN 'legacy_claim'; END IF;
  v_hours := btrim(public.aka_agent_engine_setting('${SETTING_IDLE}', '6'));
  v_alive_after := v_now - make_interval(hours => CASE WHEN v_hours ~ '^[0-9]{1,3}$' THEN greatest(1, v_hours::integer) ELSE 6 END);
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = p_account_id AND x.status = 'đang chạy' AND coalesce(x.is_delete, false) = false
                AND (greatest(coalesce(x.updated_at, '-infinity'::timestamptz), coalesce(x.last_run_at, '-infinity'::timestamptz)) >= v_alive_after
                     OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                 WHERE d.campaign_id = x.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false))) THEN
    RETURN 'campaign_running';
  END IF;
  RETURN NULL;
END
`
const holderDef = `CREATE OR REPLACE FUNCTION private.aka_agent_engine_account_holder_v1(p_account_id bigint, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$${holderBody}$function$
`

// ------------------------------------------------------------------------------------------------------------- vá release_v1
const TOKEN_HOLD = `       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL))
`
const LEGACY_HOLD = `       AND NOT private.aka_agent_engine_legacy_hold_v1(auto_accounts.id, v_now)
`
const HOLD_NOTE = `-- Dấu giữ lượt của bộ cũ đã quá hạn (luật V527 của bước nhận lượt) không giữ tài khoản: private.aka_agent_engine_legacy_hold_v1.`

let release = LIVE.release.def
release = patch(release, `  PERFORM 1 FROM public.auto_accounts WHERE id = p_account_id AND status = 'đang chạy' FOR UPDATE;
`, `  PERFORM 1 FROM public.auto_accounts WHERE id = p_account_id AND status = 'đang chạy' FOR UPDATE;
  ${HOLD_NOTE}
`, 'release: chú thích')
release = patch(release, TOKEN_HOLD, LEGACY_HOLD, 'release: luật giữ tài khoản')

// --------------------------------------------------------------------------------------------------------- vá close_stale_v1
let closeStale = LIVE.close_stale.def
closeStale = patch(closeStale, `    PERFORM 1 FROM public.auto_accounts WHERE id = v_lease.account_id AND status = 'đang chạy' FOR UPDATE;
`, `    PERFORM 1 FROM public.auto_accounts WHERE id = v_lease.account_id AND status = 'đang chạy' FOR UPDATE;
    ${HOLD_NOTE}
`, 'close_stale: chú thích')
closeStale = patch(closeStale, TOKEN_HOLD, LEGACY_HOLD, 'close_stale: luật giữ tài khoản')

const PATCHED = [
  { key: 'release', sig: LIVE.release.sig, live: LIVE.release, def: release },
  { key: 'close_stale', sig: LIVE.close_stale.sig, live: LIVE.close_stale, def: closeStale }
]
for (const p of PATCHED) {
  if (p.def === p.live.def) throw new Error(`${p.key}: không đổi gì`)
  if (!p.def.endsWith('$function$\n')) throw new Error(`${p.key}: cuối định nghĩa lạ`)
}
const NEW = {
  release: { src: md5(bodyOf(release)), def: md5(release) },
  close_stale: { src: md5(bodyOf(closeStale)), def: md5(closeStale) },
  legacy_hold: { src: md5(legacyHoldBody), def: md5(legacyHoldDef) },
  holder: { src: md5(holderBody), def: md5(holderDef) }
}

// ------------------------------------------------------------------------------------------------------------------- migration
const roleGuard = (role, sql) => `  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
    ${sql}
  END IF;`
const attrsOf = sig => `(SELECT coalesce(fp.proacl::text, '') || '|' || pg_get_userbyid(fp.proowner) || '|' || fp.prosecdef::text || '|' || fp.provolatile::text
          || '|' || coalesce(array_to_string(fp.proconfig, ','), '') FROM pg_catalog.pg_proc fp WHERE fp.oid = to_regprocedure('${sig}'))`

const functionPre = PATCHED.map(p => `  v_oid := to_regprocedure('${p.sig}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${LABEL}: không có ${p.sig}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${md5(p.def)}' THEN RAISE EXCEPTION '${LABEL} đã chạy (${p.key})'; END IF;
  IF v_md5 IS DISTINCT FROM '${p.live.defMd5}' THEN
    RAISE EXCEPTION '${LABEL}: định nghĩa ${p.key} khác bản sau V670 đã đối chiếu, dừng để đối chiếu bản live (%)', v_md5;
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid)) IS DISTINCT FROM '${p.live.srcMd5}' THEN
    RAISE EXCEPTION '${LABEL}: thân ${p.key} khác bản sau V670 đã đối chiếu';
  END IF;
  PERFORM set_config('aka.${VERSION}_attrs_${p.key}', ${attrsOf(p.sig)}, true);`).join('\n')

const functionPost = PATCHED.map(p => `  IF md5(pg_get_functiondef(to_regprocedure('${p.sig}'))) IS DISTINCT FROM '${md5(p.def)}' THEN
    RAISE EXCEPTION '${LABEL} postflight: định nghĩa ${p.key} %', md5(pg_get_functiondef(to_regprocedure('${p.sig}')));
  END IF;
  IF ${attrsOf(p.sig)} IS DISTINCT FROM current_setting('aka.${VERSION}_attrs_${p.key}', true) THEN
    RAISE EXCEPTION '${LABEL} postflight: quyền / chủ sở hữu / thuộc tính ${p.key} bị đổi';
  END IF;`).join('\n')

const newFunctionPost = [
  { key: 'legacy_hold', sig: LEGACY_HOLD_SIG, src: NEW.legacy_hold.src },
  { key: 'holder', sig: HOLDER_SIG, src: NEW.holder.src }
].map(f => `  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('${f.sig}');
  IF NOT FOUND THEN RAISE EXCEPTION '${LABEL} postflight: thiếu ${f.sig}'; END IF;
  IF md5(p.prosrc) IS DISTINCT FROM '${f.src}' OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
     OR p.provolatile IS DISTINCT FROM 's' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION '${LABEL} postflight: ${f.key} sai thân / thuộc tính';
  END IF;
  IF has_function_privilege('public', '${f.sig}', 'EXECUTE') THEN RAISE EXCEPTION '${LABEL} postflight: PUBLIC còn quyền ${f.key}'; END IF;`).join('\n')

const onceCleanup = `-- Dọn một lần lúc apply (anh chốt 27/11/2026 "Bỏ, dọn một lần": không tự gỡ định kỳ; như lần gỡ tay 15:21 VN 27/11). Luật mới ở trên có
-- hiệu lực từ lần nhả lượt sau, nên tài khoản đang kẹt và dấu quá hạn hiện có được gỡ ở đây. Bỏ qua dòng đang bị khoá (SKIP LOCKED), không
-- gỡ lại sau đó: tài khoản còn kẹt hiện ở câu dò scripts/engine-v2-stuck-accounts.cjs.
DO $once$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_setting text := btrim(public.aka_agent_engine_setting('${SETTING_LEGACY}', '30'));
  v_before timestamptz;
  r record;
  v_cleared integer := 0;
  v_reset integer := 0;
BEGIN
  v_before := v_now - make_interval(mins => CASE WHEN v_setting ~ '^[0-9]{1,6}$' THEN greatest(10, v_setting::integer) ELSE 30 END);
  -- (1) Dấu giữ lượt quá hạn của bộ cũ (luật V527) trên chiến dịch đích 'server' của tài khoản Zalo Server chưa xoá.
  FOR r IN
    SELECT c.id, c.runtime_claim_token
      FROM public.auto_campaigns c
      JOIN public.auto_accounts a ON a.id = c.account_id
     WHERE c.runtime_claim_token IS NOT NULL AND c.runtime_unit_token IS NULL AND c.runtime_claim_target = 'server'
       AND (coalesce(c.is_delete, false) OR c.status = 'tạm dừng')
       AND coalesce(c.runtime_claimed_at, '-infinity'::timestamptz) < v_before
       AND coalesce(c.updated_at, '-infinity'::timestamptz) < v_before
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                        WHERE d.campaign_id = c.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false)
       AND coalesce(a.is_delete, false) = false AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
       AND coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false)
     ORDER BY c.id
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    UPDATE public.auto_campaigns
       SET runtime_claim_token = NULL, runtime_claim_target = NULL, runtime_claim_vietnam_date = NULL, runtime_claimed_at = NULL
     WHERE id = r.id AND runtime_claim_token = r.runtime_claim_token AND runtime_unit_token IS NULL;
    IF FOUND THEN v_cleared := v_cleared + 1; END IF;
  END LOOP;
  -- (2) Tài khoản Zalo Server "đang chạy" mà không gì giữ (private.aka_agent_engine_account_holder_v1, kiểm bằng câu riêng sau khi khoá
  -- dòng), lần ghi cuối quá ${ONCE_GRACE_MINUTES} phút: về "chờ xử lý".
  FOR r IN
    SELECT a.id FROM public.auto_accounts a
     WHERE a.status = 'đang chạy' AND a.runtime_operation_claim_token IS NULL AND coalesce(a.is_delete, false) = false
       AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false)
       AND a.updated_at < v_now - make_interval(mins => ${ONCE_GRACE_MINUTES})
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = a.id AND tr.completed_at IS NULL)
     ORDER BY a.id
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    IF private.aka_agent_engine_account_holder_v1(r.id, v_now) IS NULL THEN
      UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now
       WHERE id = r.id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL;
      IF FOUND THEN v_reset := v_reset + 1; END IF;
    END IF;
  END LOOP;
  RAISE NOTICE '${LABEL} dọn một lần: % dấu giữ lượt quá hạn đã xoá, % tài khoản về "chờ xử lý"', v_cleared, v_reset;
END $once$;`

const migration = `-- ${LABEL}: engine v2 không để tài khoản kẹt "đang chạy". SINH TỪ scripts/build-v681-sql.cjs, không sửa tay.
-- release_v1 / close_stale_v1 trả tài khoản về "chờ xử lý" theo cùng luật dấu bộ cũ quá hạn với bước nhận lượt (V527). Thêm
-- private.aka_agent_engine_legacy_hold_v1 / private.aka_agent_engine_account_holder_v1 (worker Fly đọc được). Dọn một lần lúc apply: dấu
-- giữ lượt quá hạn trên chiến dịch đích 'server', tài khoản Zalo Server "đang chạy" không gì giữ. Không có bước tự gỡ định kỳ. Nguồn: thân production
-- sau V670 (kiểm md5). Gỡ: ${ROLLBACK_NAME}.sql.
-- DDL (CREATE FUNCTION): PostgREST nạp lại schema; apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${NAME}') THEN
      RAISE EXCEPTION '${NAME} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regnamespace('private') IS NULL THEN RAISE EXCEPTION '${LABEL}: thiếu schema private'; END IF;
  IF to_regprocedure('public.aka_agent_engine_setting(text,text)') IS NULL THEN RAISE EXCEPTION '${LABEL}: thiếu aka_agent_engine_setting'; END IF;
  IF to_regprocedure('${LEGACY_HOLD_SIG}') IS NOT NULL OR to_regprocedure('${HOLDER_SIG}') IS NOT NULL THEN
    RAISE EXCEPTION '${LABEL} đã chạy (hàm giữ tài khoản đã có)';
  END IF;
${functionPre}
END $pre$;

${legacyHoldDef};
${holderDef};
REVOKE ALL ON FUNCTION ${LEGACY_HOLD_SIG} FROM PUBLIC;
REVOKE ALL ON FUNCTION ${HOLDER_SIG} FROM PUBLIC;
DO $grant$
BEGIN
${['anon', 'authenticated', 'aka_agent_desktop'].map(role => roleGuard(role,
  `REVOKE ALL ON FUNCTION ${LEGACY_HOLD_SIG} FROM ${role}; REVOKE ALL ON FUNCTION ${HOLDER_SIG} FROM ${role};`)).join('\n')}
${['service_role', 'aka_agent_chat_api'].map(role => roleGuard(role,
  `GRANT EXECUTE ON FUNCTION ${LEGACY_HOLD_SIG} TO ${role}; GRANT EXECUTE ON FUNCTION ${HOLDER_SIG} TO ${role};`)).join('\n')}
END $grant$;

${release};
${closeStale};

DO $post$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
${functionPost}
${newFunctionPost}
  IF private.aka_agent_engine_account_holder_v1(-1, clock_timestamp()) IS NOT NULL
     OR private.aka_agent_engine_legacy_hold_v1(-1, clock_timestamp()) THEN
    RAISE EXCEPTION '${LABEL} postflight: tài khoản không tồn tại mà vẫn bị giữ';
  END IF;
END $post$;

${onceCleanup}
COMMIT;
`

// ------------------------------------------------------------------------------------------------------------------- bản gỡ
const rollback = `-- Gỡ ${LABEL}. SINH TỪ scripts/build-v681-sql.cjs, không sửa tay.
-- Trả release_v1 / close_stale_v1 về thân sau V670 và xoá hai hàm giữ tài khoản. Worker Fly bản đọc
-- private.aka_agent_engine_account_holder_v1 tự bỏ điều kiện đó khi hàm mất (ChatApi engineAccountSelfHeal.ts). Bước dọn một lần lúc apply
-- (dấu giữ lượt quá hạn đã xoá, tài khoản đã trả về "chờ xử lý") không được khôi phục.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
${PATCHED.map(p => `  IF md5(pg_get_functiondef(to_regprocedure('${p.sig}'))) IS DISTINCT FROM '${md5(p.def)}' THEN
    RAISE EXCEPTION 'Gỡ ${LABEL}: ${p.key} không phải bản ${LABEL} (%), dừng', md5(pg_get_functiondef(to_regprocedure('${p.sig}')));
  END IF;
  PERFORM set_config('aka.${VERSION}_rb_attrs_${p.key}', ${attrsOf(p.sig)}, true);`).join('\n')}
END $pre$;

${LIVE.release.def};
${LIVE.close_stale.def};
DROP FUNCTION ${HOLDER_SIG};
DROP FUNCTION ${LEGACY_HOLD_SIG};

DO $post$
BEGIN
${PATCHED.map(p => `  IF md5(pg_get_functiondef(to_regprocedure('${p.sig}'))) IS DISTINCT FROM '${p.live.defMd5}' THEN
    RAISE EXCEPTION 'Gỡ ${LABEL} postflight: ${p.key} chưa về bản sau V670';
  END IF;
  IF ${attrsOf(p.sig)} IS DISTINCT FROM current_setting('aka.${VERSION}_rb_attrs_${p.key}', true) THEN
    RAISE EXCEPTION 'Gỡ ${LABEL} postflight: quyền / chủ sở hữu / thuộc tính ${p.key} bị đổi';
  END IF;`).join('\n')}
  IF to_regprocedure('${HOLDER_SIG}') IS NOT NULL OR to_regprocedure('${LEGACY_HOLD_SIG}') IS NOT NULL THEN
    RAISE EXCEPTION 'Gỡ ${LABEL} postflight: còn hàm của ${LABEL}';
  END IF;
END $post$;
COMMIT;
`

const result = {
  NAME, ROLLBACK_NAME, LABEL, LIVE, NEW, migration, rollback,
  defs: { release, close_stale: closeStale, legacy_hold: legacyHoldDef, holder: holderDef },
  bodies: { legacy_hold: legacyHoldBody, holder: holderBody },
  SETTINGS: { SETTING_IDLE, SETTING_LEGACY }, ONCE_GRACE_MINUTES, onceCleanup, LEGACY_HOLD_SIG, HOLDER_SIG
}

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations', `${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`), rollback)
  console.log(`wrote migrations/${NAME}.sql (${md5(migration)}) and migrations/${ROLLBACK_NAME}.sql (${md5(rollback)})`)
  for (const [k, v] of Object.entries(NEW)) console.log(`  ${k}: prosrc ${v.src}, def ${v.def}`)
}
module.exports = result
