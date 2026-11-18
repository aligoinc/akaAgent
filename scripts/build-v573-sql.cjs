#!/usr/bin/env node
// Sinh migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql và bản gỡ từ thân hàm production đọc 18/11/2026
// (scripts/fixtures/send-exclusion-v573/live-20261118.json). Không sửa tay hai file sinh ra; sửa ở đây rồi chạy lại.
//
// Lỗi: khách xoá một tag Zalo trong app Zalo, app đọc lại danh sách tag và đánh `auto_account_contacts` (contact_type
// 'zalo_tag') is_delete = true. Nhóm loại trừ còn chọn tag đó thì aka_agent_internal_validate_send_exclusion_rules báo
// send_exclusion_option_unavailable ở đầu mỗi lượt chạy (bộ cũ và engine V504), khi lưu chiến dịch (trigger) và khi lưu
// nhóm. Bản sửa 04/11 (#594) chỉ bỏ tag đã xoá ở bước so tag khi gửi (src/shared/campaignSendExclusion.ts).
// V573: giá trị tag Zalo không còn trong danh sách nhưng là tag từng có của chính tài khoản đó (còn dòng zalo_tag, kể cả
// đã xoá) thì hợp lệ. Giá trị chưa từng có, sai kiểu, và mọi nguồn khác (tag akaBiz, trạng thái bạn bè…) giữ như cũ.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const LIVE = require('./fixtures/send-exclusion-v573/live-20261118.json')
const FN = 'aka_agent_internal_validate_send_exclusion_rules'
const SIG = `public.${FN}(jsonb,bigint,bigint,bigint)`
const live = LIVE.functions[FN]
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
if (md5(live.def) !== live.md5) throw new Error('Fixture lệch: md5 thân hàm không khớp md5 đã ghi')

const OLD_LINE = "   IF f.options_source<>'none' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(opts) o WHERE (o->>'fieldId')::bigint=f.id AND o->'value'=v) THEN RAISE EXCEPTION 'send_exclusion_option_unavailable'; END IF;"
const NEW_LINES = [
  "   IF f.options_source<>'none' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(opts) o WHERE (o->>'fieldId')::bigint=f.id AND o->'value'=v)",
  '    -- V573: tag Zalo từng có của tài khoản rồi bị xoá trong Zalo vẫn hợp lệ; lúc chạy bộ lọc bỏ qua tag không còn (bản sửa 04/11/2026).',
  "    AND NOT (f.options_source='zalo_labels' AND jsonb_typeof(v)='string' AND EXISTS(SELECT 1 FROM public.auto_account_contacts c",
  "     WHERE c.account_id=p_account AND c.contact_type='zalo_tag' AND c.uid=(v#>>'{}') AND c.staff_id=p_staff AND c.organization_id=p_org))",
  "   THEN RAISE EXCEPTION 'send_exclusion_option_unavailable'; END IF;"
]
const lines = live.def.split('\n')
const at = lines.indexOf(OLD_LINE)
if (at < 0 || lines.indexOf(OLD_LINE, at + 1) >= 0) throw new Error('Không tìm thấy đúng một dòng kiểm giá trị trong thân hàm live')
const newDef = [...lines.slice(0, at), ...NEW_LINES, ...lines.slice(at + 1)].join('\n')
const NEW_MD5 = md5(newDef)
const ACL = live.acl
if (live.owner !== 'postgres' || ACL !== '{postgres=X/postgres}') throw new Error('Owner/quyền live khác dự kiến')

const statement = def => def.trimEnd() + ';\n'
const guard = (label, expectMd5) => `DO $guard$
DECLARE v_md5 text; v_owner text; v_acl text; v_secdef boolean; v_cfg text[]; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = '${FN}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V573 ${label}: có % bản ${FN}, cần đúng 1', v_n; END IF;
  SELECT md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.proconfig
    INTO v_md5, v_owner, v_acl, v_secdef, v_cfg FROM pg_proc p WHERE p.oid = to_regprocedure('${SIG}');
  IF v_md5 IS DISTINCT FROM '${expectMd5}' THEN RAISE EXCEPTION 'V573 ${label}: thân ${FN} là %, cần ${expectMd5}', v_md5; END IF;
  IF v_owner <> 'postgres' OR v_acl IS DISTINCT FROM '${ACL}' OR NOT v_secdef OR v_cfg IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'V573 ${label}: owner/quyền/thiết lập của ${FN} khác dự kiến (% % % %)', v_owner, v_acl, v_secdef, v_cfg;
  END IF;
END $guard$;
`
const ledgerGuard = (forbid) => `DO $ledger$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND ${forbid ? '' : 'NOT '}EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v573_%') THEN
    RAISE EXCEPTION '${forbid ? 'V573: sổ migration đã có một bản v573, không chạy lại / số đã bị dùng' : 'Gỡ V573: sổ migration chưa có V573'}';
  END IF;
END $ledger$;
`

const header = `-- V573: tag Zalo đã xoá trong nhóm điều kiện loại trừ không còn chặn chiến dịch.
-- Sinh bằng scripts/build-v573-sql.cjs từ thân hàm production đọc 18/11/2026; không sửa tay.
--
-- Lỗi (18/11/2026, chiến dịch 48267): khách xoá tag Zalo trong app Zalo, app đọc lại danh sách tag và đánh dòng
-- auto_account_contacts (contact_type 'zalo_tag') is_delete = true. Nhóm loại trừ còn chọn tag đó thì
-- ${FN} báo send_exclusion_option_unavailable ở đầu mỗi lượt chạy
-- (aka_agent_campaign_send_exclusion_runtime 'snapshot', aka_agent_engine_send_exclusion_v1), khi lưu chiến dịch
-- (trigger auto_validate_campaign_send_exclusion) và khi lưu nhóm (aka_agent_send_exclusion_groups 'save').
-- Bộ chạy cũ tạm dừng chiến dịch "Không thể tải cấu hình loại trừ…", engine v2 CFG18, Web báo mã tham chiếu ngẫu nhiên.
-- Bản sửa 04/11 (#594) chỉ bỏ tag đã xoá khi so tag lúc gửi (src/shared/campaignSendExclusion.ts, lõi engine).
--
-- Đổi: chỉ một điều kiện trong ${FN}. Giá trị của trường nguồn 'zalo_labels' không còn trong
-- danh sách lựa chọn nhưng là chuỗi khớp uid của một dòng zalo_tag (kể cả đã xoá) của chính tài khoản/nhân viên/tổ chức
-- thì hợp lệ. Giá trị chưa từng có, sai kiểu, tag akaBiz và các nguồn khác giữ như cũ. Không đổi dữ liệu, bảng, quyền.
-- Tra cứu đi qua uq_auto_account_contacts_account_type_uid (account_id, contact_type, uid) và chỉ chạy khi giá trị
-- không có trong danh sách.
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
-- md5 pg_get_functiondef: ${live.md5} -> ${NEW_MD5}. Gỡ: rollback_v573_send_exclusion_deleted_zalo_tags.sql.
`

const migration = `${header}
BEGIN;
SET LOCAL lock_timeout = '3s';
${ledgerGuard(true)}${guard('preflight', live.md5)}
${statement(newDef)}
${guard('postflight', NEW_MD5)}COMMIT;
`

const rollback = `-- Gỡ V573: đặt lại ${FN} như trước V573 (thân production đọc 18/11/2026).
-- Sinh bằng scripts/build-v573-sql.cjs; không sửa tay. Không xoá dòng sổ migration.
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema: chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
${ledgerGuard(false)}${guard('rollback preflight', NEW_MD5)}
${statement(live.def)}
${guard('rollback postflight', live.md5)}COMMIT;
`

fs.writeFileSync(path.join(ROOT, 'migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql'), migration)
fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v573_send_exclusion_deleted_zalo_tags.sql'), rollback)
console.log(JSON.stringify({ liveMd5: live.md5, newMd5: NEW_MD5, migrationMd5: md5(migration), rollbackMd5: md5(rollback) }))
module.exports = { NEW_MD5 }
