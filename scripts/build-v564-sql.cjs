#!/usr/bin/env node
// V564: engine v2 Facebook xáo trộn danh sách group như bộ cũ (anh chốt 18/11/2026: "Giữ, sửa luôn").
//
// Bộ cũ (campaignScheduler.ts, executeCampaignV2): chiến dịch "Đăng bài vào group" bật "Xáo trộn danh sách group"
// (extra_settings.shuffleGroupList) thì đầu mỗi lượt xáo các data chờ (Fisher–Yates) rồi đăng theo thứ tự đó, và in
// "🔀 Đã xáo trộn danh sách N group" khi N > 1. Engine tới V563 nhận data theo d.id tăng dần (V532) nên bỏ qua cài đặt này:
// mọi lượt đăng cùng một thứ tự, và các tài khoản dùng chung danh sách nhóm đi cùng một thứ tự (một nhóm nhận bài của nhiều tài
// khoản cách nhau vài phút). Đo 18/11: 4.060/6.208 chiến dịch đăng nhóm bật cài đặt này; tổ chức 701, 1419, 124 chạy nhiều tài khoản
// trên cùng danh sách nhóm.
//
// Sửa aka_agent_engine_claim_target_v1, chỉ nhánh chiến dịch đăng nhóm bật xáo trộn (không theo danh sách inputDataIds, không phải lượt
// theo lịch): sắp data chờ theo md5(id || lease_token). Mỗi lượt (lease) một thứ tự ngẫu nhiên riêng, trong lượt giữ nguyên thứ tự; lượt
// sau có lease mới nên thứ tự khác, như bộ cũ xáo lại ở đầu mỗi lượt. Lần nhận đầu của lease (lõi gửi leaseToken rỗng) trả thêm
// shuffle.count = số data chờ đến hạn lúc bắt đầu lượt (kể cả data vừa nhận), để lõi in dòng 🔀 như bộ cũ; lõi bản cũ bỏ qua khoá này.
// Câu chọn data của mọi chiến dịch khác giữ nguyên (V532: d.id + 0; chỉ thụt lề thêm vì nằm trong nhánh ELSE), câu trả lời không đổi.
//
// Nguồn: thân claim_target_v1 của V558 (production đọc chỉ đọc 18/11/2026: md5 pg_get_functiondef 7ddfa216…, đúng bản V558 sinh ra).
// Chạy: node scripts/build-v564-sql.cjs (ghi migration + bản gỡ). Không sửa tay hai file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const v558 = require('./build-v558-sql.cjs')

const NAME = 'migration_v564_engine_facebook_shuffle_groups'
const ROLLBACK_NAME = 'rollback_v564_engine_facebook_shuffle_groups'
const SIG = 'public.aka_agent_engine_claim_target_v1(jsonb)'
/** md5 pg_get_functiondef của claim_target_v1 trên production, đọc chỉ đọc 18/11/2026 (= bản V558 sinh ra). */
const LIVE_MD5 = '7ddfa216286849296e6b537c120e291d'

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const live = v558.texts.new.claim
if (md5(live) !== LIVE_MD5 || v558.NEW_MD5.claim !== LIVE_MD5) throw new Error(`Thân claim_target_v1 của V558 không còn khớp bản đang chạy (${LIVE_MD5})`)

let c = live
c = patch(c, `  v_only_ids bigint[];
BEGIN`, `  v_only_ids bigint[];
  -- V564: chiến dịch đăng nhóm bật "Xáo trộn danh sách group" (như bộ cũ xáo các data chờ ở đầu mỗi lượt).
  v_shuffle boolean := false;
  v_shuffle_count integer;
BEGIN`, 1, 'claim: khai báo')

const OLD_SELECT = `    SELECT d.* INTO t FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
       AND (d.schedule IS NULL OR d.schedule <= v_now)
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
       AND d.id <> ALL (v_cd_skip)
       AND (v_only_ids IS NULL OR d.id = ANY (v_only_ids))
     ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;
    v_found := FOUND;`
const NEW_SELECT = `    IF v_shuffle THEN
      -- V564: thứ tự ngẫu nhiên theo lượt (md5 theo lease): trong lượt giữ nguyên, lượt sau (lease mới) khác, như bộ cũ xáo ở đầu lượt.
      SELECT d.* INTO t FROM public.auto_campaign_input_data d
       WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
         AND (d.schedule IS NULL OR d.schedule <= v_now)
         AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
         AND d.id <> ALL (v_cd_skip)
       ORDER BY md5(d.id::text || v_token::text), d.id LIMIT 1 FOR UPDATE SKIP LOCKED;
    ELSE
  ${OLD_SELECT.split('\n').slice(0, -1).join('\n  ')}
    END IF;
    v_found := FOUND;`
c = patch(c, OLD_SELECT, NEW_SELECT, 1, 'claim: câu chọn data')

c = patch(c, `  LOOP
    EXIT WHEN v_slot_mode;`, `  -- V564: đăng nhóm bật "Xáo trộn danh sách group" (lưu kiểu boolean, đo 18/11): xáo khi nhận data kế tiếp của lượt; nhận theo danh sách
  -- inputDataIds (nhóm chia sẻ kèm) và lượt theo lịch không xáo. Mọi chiến dịch khác giữ câu chọn theo d.id + 0 (V532).
  v_shuffle := NOT v_slot_mode AND v_only_ids IS NULL AND c.action_id = 'facebook_group_post'
    AND coalesce(c.extra_settings->'shuffleGroupList' = 'true'::jsonb, false);
  LOOP
    EXIT WHEN v_slot_mode;`, 1, 'claim: bật xáo trộn')

c = patch(c, `  -- Trigger phân quyền ứng dụng (V445) có thể từ chối chuyển "đang chạy": hoàn tác cả bước nhận data`,
  `  -- V564: lần nhận đầu của lượt ở chiến dịch xáo trộn (lease mới, hoặc lõi báo lượt chưa nhận data nào: lần gọi trước trả cooldown_scan đã
  -- cấp lease): số data chờ đến hạn lúc bắt đầu lượt (kể cả data vừa nhận, chưa chuyển "đang chạy"), để lõi in "🔀 Đã xáo trộn danh sách N
  -- group" như bộ cũ (N > 1).
  IF v_shuffle AND (v_req_token IS DISTINCT FROM v_token OR p_ctx->>'unitStarted' = 'false') THEN
    SELECT count(*)::integer INTO v_shuffle_count FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
       AND (d.schedule IS NULL OR d.schedule <= v_now);
  END IF;

  -- Trigger phân quyền ứng dụng (V445) có thể từ chối chuyển "đang chạy": hoàn tác cả bước nhận data`, 1, 'claim: số data lúc đầu lượt')

c = patch(c, `    'cooldownPaused', v_cd_paused);
END $function$`, `    'cooldownPaused', v_cd_paused)
    -- V564: chỉ chiến dịch xáo trộn, lần nhận đầu của lượt; câu trả lời của mọi chiến dịch khác không đổi.
    || CASE WHEN v_shuffle_count IS NOT NULL THEN jsonb_build_object('shuffle', jsonb_build_object('count', v_shuffle_count)) ELSE '{}'::jsonb END;
END $function$`, 1, 'claim: câu trả lời')

const NEW_TEXT = c
const NEW_MD5 = md5(NEW_TEXT)

const preflight = (label, expect, done, msgDone, msgDrift, ledger) => `DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v564_%') THEN
      RAISE EXCEPTION 'V564 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}  v_oid := to_regprocedure('${SIG}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${SIG}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${done}' THEN RAISE EXCEPTION '${msgDone}'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${msgDrift} (claim: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v564_acl_claim', v_acl, true);
END $pre$;`
const postflight = (label, expect) => `DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := '${SIG}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expect}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa claim %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v564_acl_claim', true) THEN RAISE EXCEPTION '${label} postflight: quyền / chủ sở hữu claim bị đổi'; END IF;
END $post$;`

const migration = `-- V564: engine v2 Facebook xáo trộn danh sách group như bộ cũ. SINH TỪ scripts/build-v564-sql.cjs, không sửa tay.
-- Thay thân aka_agent_engine_claim_target_v1 (giữ chữ ký, chủ sở hữu, quyền). Chỉ chiến dịch "Đăng bài vào group" bật "Xáo trộn danh sách
-- group" đổi cách chọn data: mỗi lượt (lease) một thứ tự ngẫu nhiên riêng (md5 theo lease), lần nhận đầu của lượt trả thêm shuffle.count cho
-- dòng 🔀. Mọi chiến dịch khác (Zalo, Facebook không bật xáo trộn) giữ câu chọn và câu trả lời như V558.
-- Nguồn = pg_get_functiondef production 18/11/2026 (bản V558): claim ${LIVE_MD5}. Bản mới: ${NEW_MD5}.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('V564', LIVE_MD5, NEW_MD5, 'V564 đã chạy (claim)', 'V564: định nghĩa claim khác bản production 18/11 (V558), dừng để đối chiếu bản live', true)}

${NEW_TEXT};

${postflight('V564', NEW_MD5)}

COMMIT;
`
const rollback = `-- Gỡ V564: trả aka_agent_engine_claim_target_v1 về bản V558 (production 18/11/2026). SINH TỪ scripts/build-v564-sql.cjs.
-- Chiến dịch đăng nhóm bật xáo trộn lại nhận data theo id tăng dần; lõi không nhận shuffle.count thì không in dòng 🔀.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('Gỡ V564', NEW_MD5, LIVE_MD5, 'Gỡ V564: hàm đã là bản trước V564', 'Gỡ V564: định nghĩa claim không phải bản V564', false)}

${live};

${postflight('Gỡ V564', LIVE_MD5)}

COMMIT;
`

module.exports = { migration, rollback, NAME, ROLLBACK_NAME, LIVE_MD5, NEW_MD5, texts: { live, new: NEW_TEXT } }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log('V564 migration', md5(migration), 'rollback', md5(rollback), 'claim', LIVE_MD5, '->', NEW_MD5)
}
