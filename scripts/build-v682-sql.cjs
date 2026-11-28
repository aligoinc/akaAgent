#!/usr/bin/env node
// Sinh migration V682 + bản gỡ: bước chống gửi lặp (public.aka_agent_apply_campaign_delivery_cooldown) đọc lịch sử của người nhận
// theo input_data_id ở cả hai nhánh của CTE recipient_history.
// Trước V682: nhánh kết quả "committed" bị planner chọn chỉ mục auto_detail_committed_delivery_v367
// (account_id, action_code, created_at DESC, input_data_id) và lặp theo từng tài khoản của CTE history_accounts (ước 1 dòng). Với mỗi
// dòng data trùng SĐT trên toàn hệ thống × mỗi tài khoản, câu quét cả khoảng ngày của tài khoản đó vì input_data_id đứng sau created_at.
// Chiến dịch 53573 (nhân viên 1108, 54 tài khoản, "tính trên mọi tài khoản", 90 ngày; SĐT đầu có trong 1.017 dòng data): 54.918 lần quét,
// 707 nghìn buffer, 4,3 giây dù đã nằm trong bộ nhớ, quá trần 3 giây của Desktop nên claim engine v2 hỏng ~1 lần / phút từ 13:11 VN 27/11.
// Viết account_id + 0 thì planner không dùng được hai chỉ mục bắt đầu bằng account_id, đi idx_campaign_details_input_data_id như nhánh
// kết quả kiểu cũ: 17,9 ms, 11.463 buffer trên cùng data (đo chỉ đọc trên production 28/11/2026). Cùng tập dòng, cùng kết quả.
// Nguồn: thân production đọc 28/11/2026 (scripts/fixtures/delivery-cooldown-v682/cooldown-live-20261128.sql, md5 kiểm trước khi thay).
// Chạy: node scripts/build-v682-sql.cjs   Kiểm: CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/delivery-cooldown-v682-smoke.cjs
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ROOT = path.resolve(__dirname, '..')
const md5 = s => crypto.createHash('md5').update(s).digest('hex')

const NAME = 'migration_v682_delivery_cooldown_history_by_input'
const ROLLBACK_NAME = 'rollback_v682_delivery_cooldown_history_by_input'
const SIG = 'public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])'
const OLD_MD5 = '018db8850de2f967b13240e6cd36158c'
// Thuộc tính production 28/11/2026; CREATE OR REPLACE giữ chủ và quyền, câu kiểm sau vẫn so lại để chắc.
const META = {
  owner: 'postgres', secdef: true, volatility: 'v',
  config: 'search_path=pg_catalog, public',
  acl: '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}'
}

const OLD = fs.readFileSync(path.join(ROOT, 'scripts/fixtures/delivery-cooldown-v682/cooldown-live-20261128.sql'), 'utf8')
if (md5(OLD) !== OLD_MD5) throw new Error(`thân production đã lưu không khớp md5 ${OLD_MD5}`)

const FROM_FILTER = '        AND hd.account_id IN (SELECT account.id FROM history_accounts AS account)\n'
const TO_FILTER = '        AND (hd.account_id + 0) IN (SELECT account.id FROM history_accounts AS account)\n'
const FROM_HEAD = '  recipient_history AS MATERIALIZED (\n    SELECT d.id AS detail_id, d.created_at, d.campaign_id,\n'
const TO_HEAD = [
  '  recipient_history AS MATERIALIZED (',
  '    -- Hai nhánh tra lịch sử theo input_data_id (idx_campaign_details_input_data_id). account_id + 0: không để planner đi chỉ mục',
  '    -- bắt đầu bằng account_id rồi lặp từng tài khoản × từng dòng data trùng người nhận (quét cả khoảng ngày mỗi lần).',
  '    SELECT d.id AS detail_id, d.created_at, d.campaign_id,',
  ''
].join('\n')

const count = (text, part) => text.split(part).length - 1
if (count(OLD, FROM_FILTER) !== 2) throw new Error('điều kiện account_id của recipient_history không xuất hiện đúng hai lần')
if (count(OLD, FROM_HEAD) !== 1) throw new Error('đầu CTE recipient_history không xuất hiện đúng một lần')
const start = OLD.indexOf(FROM_HEAD)
const end = OLD.indexOf('  history AS MATERIALIZED (', start)
if (end < 0) throw new Error('không thấy CTE history sau recipient_history')
const block = OLD.slice(start, end)
if (count(block, FROM_FILTER) !== 2) throw new Error('hai điều kiện cần thay không nằm trong recipient_history')

const NEW = OLD.slice(0, start) + block.replace(FROM_HEAD, TO_HEAD).split(FROM_FILTER).join(TO_FILTER) + OLD.slice(end)
const NEW_MD5 = md5(NEW)
if (count(NEW, TO_FILTER) !== 2 || count(NEW, FROM_FILTER) !== 0) throw new Error('bản mới thay chưa đủ')

const guard = (label, expected, err) => `DO $${label}$
DECLARE
  v_oid regprocedure := to_regprocedure('${SIG}');
  v_md5 text := md5(pg_get_functiondef(v_oid));
  p record;
BEGIN
  IF v_md5 IS DISTINCT FROM '${expected}' THEN
    RAISE EXCEPTION '${err} (md5 %, cần ${expected})', coalesce(v_md5, 'không có hàm');
  END IF;
  SELECT pg_get_userbyid(proowner) AS owner, prosecdef, provolatile, proconfig, proacl::text AS acl INTO p FROM pg_proc WHERE oid = v_oid;
  IF p.owner IS DISTINCT FROM '${META.owner}' OR p.prosecdef IS DISTINCT FROM ${META.secdef} OR p.provolatile IS DISTINCT FROM '${META.volatility}'
     OR p.proconfig IS DISTINCT FROM ARRAY['${META.config}']::text[] OR p.acl IS DISTINCT FROM '${META.acl}' THEN
    RAISE EXCEPTION 'Chủ / quyền / cấu hình của hàm khác bản đã đọc 28/11/2026: %', row_to_json(p);
  END IF;
END $${label}$;`

const migration = `-- V682 (28/11/2026): bước chống gửi lặp (public.aka_agent_apply_campaign_delivery_cooldown) tra lịch sử người nhận theo input_data_id ở cả
-- hai nhánh của recipient_history. Trước đây nhánh kết quả "committed" đi chỉ mục (account_id, action_code, created_at, input_data_id) và lặp
-- từng tài khoản × từng dòng data trùng người nhận: chiến dịch có SĐT trùng nhiều và bật "tính trên mọi tài khoản" mất vài giây mỗi data,
-- quá trần 3 giây của Desktop nên claim engine v2 hỏng mãi (53573: 4,3 giây → 17,9 ms trên cùng data, đo chỉ đọc 28/11/2026).
-- Chỉ thêm "+ 0" vào hai điều kiện account_id và một chú thích: cùng tập dòng, cùng kết quả, cùng chữ ký; quyền, chủ, cấu hình giữ nguyên.
-- md5 pg_get_functiondef ${OLD_MD5} → ${NEW_MD5}. Có hiệu lực ngay cho mọi nơi gọi (claim engine v2, bộ cũ Desktop / App Server, Fly).
-- Sinh bằng: node scripts/build-v682-sql.cjs   Kiểm: scripts/delivery-cooldown-v682-smoke.cjs   Gỡ: migrations/${ROLLBACK_NAME}.sql
-- Thay thân hàm làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $ledger$
BEGIN
  -- Hai IF lồng: một biểu thức AND vẫn phân tích bảng sổ cả khi to_regclass trả NULL (DB không có sổ).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\\_v682\\_%') THEN
      RAISE EXCEPTION 'V682 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
END $ledger$;
${guard('pre', OLD_MD5, 'Thân public.aka_agent_apply_campaign_delivery_cooldown khác bản đã đọc 28/11/2026, dừng')}

${NEW};

${guard('post', NEW_MD5, 'Thân mới không như bản sinh')}
COMMIT;
`

const rollback = `-- Gỡ V682: trả public.aka_agent_apply_campaign_delivery_cooldown về thân đọc 28/11/2026 (md5 ${OLD_MD5}). Sinh bằng scripts/build-v682-sql.cjs.
-- Thay thân hàm làm PostgREST nạp lại schema: chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
${guard('pre', NEW_MD5, 'Thân public.aka_agent_apply_campaign_delivery_cooldown không phải bản V682, dừng')}

${OLD};

${guard('post', OLD_MD5, 'Thân sau khi gỡ không như bản đã đọc')}
COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  fs.writeFileSync(path.join(ROOT, 'scripts/fixtures/delivery-cooldown-v682/cooldown-v682.sql'), NEW)
  console.log(`${NAME}.sql: ${OLD_MD5} -> ${NEW_MD5}`)
  console.log(`${ROLLBACK_NAME}.sql`)
}
module.exports = { NAME, ROLLBACK_NAME, SIG, OLD, NEW, OLD_MD5, NEW_MD5, META, migration, rollback }
