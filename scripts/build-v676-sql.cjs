#!/usr/bin/env node
// Sinh migration V676 + bản gỡ: hàm so khớp loại trừ gửi (private.aka_agent_send_exclusion_match) không đòi Zalo global ID khi mọi
// danh sách Zalo ID loại trừ đã chọn thuộc tài khoản cùng nick với tài khoản gửi (gồm chính nó). Một người chỉ có một Zalo ID riêng ở mỗi
// nick, nên so thẳng Zalo ID riêng với các danh sách đó là đủ kết luận; chỉ danh sách của Zalo khác nick mới phải so theo Global ID.
// Trước V676: không có Global ID (đọc hồ sơ Zalo lỗi) thì mục 1 luôn đặt v_need, cổng loại trừ trả "Chưa xác định được khách để kiểm tra
// loại trừ." (EXC02) và data bị giữ "tạm dừng" (chiến dịch 63333 ngày 27/11/2026: danh sách "Không gửi" của chính tài khoản 1828, 364 data).
// Nguồn: thân production đọc 27/11/2026 (scripts/fixtures/send-exclusion-v676/match-live-20261127.sql, md5 kiểm trước khi thay).
// Chạy: node scripts/build-v676-sql.cjs   Kiểm: PG_MODULE_DIR=<akaAgentChatApi> LC_ALL=C node scripts/send-exclusion-v676-smoke.cjs
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ROOT = path.resolve(__dirname, '..')
const md5 = s => crypto.createHash('md5').update(s).digest('hex')

const NAME = 'migration_v676_send_exclusion_own_blocklist_uid'
const ROLLBACK_NAME = 'rollback_v676_send_exclusion_own_blocklist_uid'
const SIG = 'private.aka_agent_send_exclusion_match(auto_campaigns,bigint,jsonb,text,text,text,boolean)'
const OLD_MD5 = '86daa2d825167120257250df5b88eaba'

const OLD = fs.readFileSync(path.join(ROOT, 'scripts/fixtures/send-exclusion-v676/match-live-20261127.sql'), 'utf8')
if (md5(OLD) !== OLD_MD5) throw new Error(`thân production đã lưu không khớp md5 ${OLD_MD5}`)

const FROM = '  IF v_match IS NULL AND v_gid IS NULL THEN v_need:=true; END IF;\n END IF;\n'
const TO = [
  '  -- Danh sách của tài khoản cùng nick (gồm chính tài khoản gửi): đã so thẳng Zalo ID riêng ở trên, không khớp là không thuộc danh sách.',
  '  -- Chỉ cần Global ID khi còn danh sách của Zalo khác nick (không có Zalo ID riêng của cùng người để so).',
  '  IF v_match IS NULL AND v_gid IS NULL AND EXISTS (SELECT 1 FROM public.auto_account_contact_groups bl',
  '     WHERE bl.id=ANY(v_lists) AND NOT coalesce(bl.account_id=ANY(v_nick), false)) THEN v_need:=true; END IF;',
  ' END IF;',
  ''
].join('\n')
if (OLD.split(FROM).length !== 2) throw new Error('đoạn cần thay ở mục 1 không xuất hiện đúng một lần')
const NEW = OLD.replace(FROM, TO)
const NEW_MD5 = md5(NEW)

const guard = (label, expected, err) => `DO $${label}$
DECLARE v_md5 text := md5(pg_get_functiondef(to_regprocedure('${SIG}')));
BEGIN
  IF v_md5 IS DISTINCT FROM '${expected}' THEN
    RAISE EXCEPTION '${err} (md5 %, cần ${expected})', coalesce(v_md5, 'không có hàm');
  END IF;
END $${label}$;`

const migration = `-- V676 (27/11/2026): loại trừ gửi theo danh sách Zalo ID không đòi Zalo global ID khi danh sách thuộc tài khoản cùng nick với
-- tài khoản gửi (gồm chính nó): so thẳng Zalo ID riêng là đủ. Danh sách của Zalo khác nick, Nhóm data, chiến dịch đã gửi vẫn cần Global ID
-- như V666 / V668. Chỉ thay thân private.aka_agent_send_exclusion_match (md5 ${OLD_MD5} → ${NEW_MD5}); quyền, chủ, cấu hình giữ nguyên.
-- Có hiệu lực ngay cho mọi nơi chạy (Desktop, App Server, Fly) vì hàm chạy trong DB; không cần phát hành app.
-- Sinh bằng: node scripts/build-v676-sql.cjs   Kiểm: scripts/send-exclusion-v676-smoke.cjs   Gỡ: migrations/${ROLLBACK_NAME}.sql
-- Thay thân hàm làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $ledger$
BEGIN
  -- Hai IF lồng: một biểu thức AND vẫn phân tích bảng sổ cả khi to_regclass trả NULL (DB không có sổ).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\\_v676\\_%') THEN
      RAISE EXCEPTION 'V676 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
END $ledger$;
${guard('pre', OLD_MD5, 'Thân private.aka_agent_send_exclusion_match khác bản đã đọc 27/11/2026, dừng')}

${NEW};

${guard('post', NEW_MD5, 'Thân mới không như bản sinh')}
COMMIT;
`

const rollback = `-- Gỡ V676: trả private.aka_agent_send_exclusion_match về thân đọc 27/11/2026 (md5 ${OLD_MD5}). Sinh bằng scripts/build-v676-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
${guard('pre', NEW_MD5, 'Thân private.aka_agent_send_exclusion_match không phải bản V676, dừng')}

${OLD};

${guard('post', OLD_MD5, 'Thân sau khi gỡ không như bản đã đọc')}
COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, SIG, OLD_MD5, NEW_MD5, OLD, NEW, migration, rollback }

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations', NAME + '.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations', ROLLBACK_NAME + '.sql'), rollback)
  console.log(`V676: ${OLD_MD5} → ${NEW_MD5}; migration md5 ${md5(migration)}`)
}
