// Sinh migration V615: theo dõi tương tác Zalo ghi lại việc người nhận từ chối lời mời kết bạn.
//
// Zalo báo về sự kiện bạn bè "reject" (zca-js FriendEventType.REJECT_REQUEST = 4) khi người nhận từ chối lời mời của
// tài khoản; trước V615 bộ theo dõi tương tác chỉ nhận "đã kết bạn" (ADD), nên lượt "Kết bạn" bị từ chối vẫn hiện
// "Đã gửi lời mời" mãi và khách tưởng app báo sai (tổ chức 446, chiến dịch 58816, 21/11/2026: 100/100 lời mời có sự kiện
// Zalo xác nhận đã gửi, 8 bị từ chối). Anh yêu cầu làm 21/11/2026 ("Làm luôn").
//
// V615: thêm cột auto_campaign_detail_zalo_engagement.rejected_at (để trống, không ghi lại bảng) và cho
// aka_agent_campaign_engagement_batch nhận loại sự kiện mới 'friend_rejected' ở cả hai chỗ ghi mốc (nhánh đăng ký đối chiếu
// sự kiện Chat đã lưu, và nhánh ghi sự kiện). Chỉ khớp lượt gửi lời mời (action_type friend_request), trong hạn theo dõi,
// giữ mốc sớm nhất như các mốc khác. Các nhánh khác giữ nguyên từng byte. Bản Desktop / ChatApi chưa gửi loại mới thì không
// có gì đổi; DB chưa có V615 mà runtime đã gửi loại mới thì hàm cũ bỏ qua sự kiện đó (không lỗi).
//
// Thân nguồn = V524 = production (md5(prosrc) 167571de…, md5(pg_get_functiondef) e5b44316…, đọc chỉ đọc 21/11/2026).
// Chạy: node scripts/build-v615-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const NAME = 'migration_v615_zalo_engagement_friend_rejected'
const ROLLBACK_NAME = 'rollback_v615_zalo_engagement_friend_rejected'
const SIG = 'public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'
const V524 = path.join(ROOT, 'migrations/migration_v524_zalo_engagement_catalog_ordered_walk.sql')
const LIVE = { src: '167571de84782301ddd8bcd1ad3b2f89', def: 'e5b4431626d8d205b1883b2b92545253' }

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const v524 = fs.readFileSync(V524, 'utf8')
const start = v524.indexOf('CREATE OR REPLACE FUNCTION public.aka_agent_campaign_engagement_batch(')
const end = v524.indexOf('$function$\n;\n', start) + '$function$\n;\n'.length
if (start < 0 || end <= start) throw new Error('Không thấy hàm trong V524')
const oldBlock = v524.slice(start, end)
const bodyOf = block => /AS \$function\$([\s\S]*)\$function\$\n;\n$/.exec(block)[1]
// pg_get_functiondef = khối CREATE bỏ dấu ";" cuối (đối chiếu từng byte với production 21/11/2026).
const defOf = block => block.replace(/\$function\$\n;\n$/, '$function$\n')
if (md5(bodyOf(oldBlock)) !== LIVE.src) throw new Error(`Thân V524 không khớp production: ${md5(bodyOf(oldBlock))}`)
if (md5(defOf(oldBlock)) !== LIVE.def) throw new Error(`Định nghĩa V524 không khớp pg_get_functiondef production: ${md5(defOf(oldBlock))}`)

let b = oldBlock
// Nhánh đăng ký: đối chiếu sự kiện Chat đã lưu trước khi lượt gửi kịp đăng ký.
b = patch(b,
  "       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='friend' AND e.action_type='friend_request') friended,\n",
  "       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='friend' AND e.action_type='friend_request') friended,\n" +
  "       -- v615: người nhận từ chối lời mời kết bạn của tài khoản.\n" +
  "       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='friend_rejected' AND e.action_type='friend_request') rejected,\n",
  1, 'đăng ký: gom mốc từ chối')
// Cả hai câu UPDATE (đăng ký, ghi sự kiện).
b = patch(b,
  'friended_at=least(e.friended_at,m.friended),updated_at=now()',
  'friended_at=least(e.friended_at,m.friended),rejected_at=least(e.rejected_at,m.rejected),updated_at=now()',
  2, 'UPDATE: ghi rejected_at')
b = patch(b,
  "       (m.friended IS NOT NULL AND (e.friended_at IS NULL OR m.friended<e.friended_at)));\n",
  "       (m.friended IS NOT NULL AND (e.friended_at IS NULL OR m.friended<e.friended_at)) OR\n" +
  "       (m.rejected IS NOT NULL AND (e.rejected_at IS NULL OR m.rejected<e.rejected_at)));\n",
  1, 'đăng ký: điều kiện cập nhật')
// Nhánh ghi sự kiện.
b = patch(b,
  "        min((i->>'occurredAt')::timestamptz) FILTER (WHERE i->>'kind'='friend' AND e.action_type='friend_request') AS friended\n",
  "        min((i->>'occurredAt')::timestamptz) FILTER (WHERE i->>'kind'='friend' AND e.action_type='friend_request') AS friended,\n" +
  "        -- v615: người nhận từ chối lời mời kết bạn của tài khoản.\n" +
  "        min((i->>'occurredAt')::timestamptz) FILTER (WHERE i->>'kind'='friend_rejected' AND e.action_type='friend_request') AS rejected\n",
  1, 'ghi sự kiện: gom mốc từ chối')
b = patch(b,
  "         (i->>'kind'='friend' AND e.action_type='friend_request' AND (e.friended_at IS NULL OR (i->>'occurredAt')::timestamptz<e.friended_at)))\n",
  "         (i->>'kind'='friend' AND e.action_type='friend_request' AND (e.friended_at IS NULL OR (i->>'occurredAt')::timestamptz<e.friended_at)) OR\n" +
  "         (i->>'kind'='friend_rejected' AND e.action_type='friend_request' AND (e.rejected_at IS NULL OR (i->>'occurredAt')::timestamptz<e.rejected_at)))\n",
  1, 'ghi sự kiện: lọc sự kiện')
b = patch(b,
  "         (m.friended IS NOT NULL AND (e.friended_at IS NULL OR m.friended<e.friended_at))) RETURNING e.campaign_detail_id\n",
  "         (m.friended IS NOT NULL AND (e.friended_at IS NULL OR m.friended<e.friended_at)) OR\n" +
  "         (m.rejected IS NOT NULL AND (e.rejected_at IS NULL OR m.rejected<e.rejected_at))) RETURNING e.campaign_detail_id\n",
  1, 'ghi sự kiện: điều kiện cập nhật')
const NEW = { src: md5(bodyOf(b)), def: md5(defOf(b)) }

const ATTRS = `pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v'
   AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=15s']::text[]
   AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}'`

const migration = `-- V615: theo dõi tương tác Zalo ghi việc người nhận từ chối lời mời kết bạn (cột rejected_at, loại sự kiện
-- 'friend_rejected'). Sinh bằng: node scripts/build-v615-sql.cjs (không sửa tay). Xem docs/ZALO_FRIEND_REJECTED_V615.md.
-- Thân hàm nguồn = V524 = production 21/11/2026: md5(prosrc) ${LIVE.src}, md5(pg_get_functiondef) ${LIVE.def}.
-- Chỉ thêm 6 chỗ cho mốc từ chối (gom mốc, UPDATE, điều kiện) ở nhánh đăng ký và nhánh ghi sự kiện; các nhánh khác giữ
-- nguyên từng byte. Giữ chữ ký, owner, SECURITY DEFINER, VOLATILE, search_path, statement_timeout 15s và ACL.
-- Cột mới để trống (không ghi lại bảng); danh sách kết quả trả to_jsonb(engagement) nên Web / Desktop tự nhận trường mới.
-- ALTER TABLE và CREATE OR REPLACE FUNCTION là DDL ⇒ PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm.
-- ALTER đặt cuối giao dịch để khoá bảng tương tác chỉ giữ vài mili giây.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE v_oid oid := to_regprocedure('${SIG}');
BEGIN
 IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
   IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v615_%') THEN
     RAISE EXCEPTION 'v615 already recorded in supabase_migrations.schema_migrations';
   END IF;
 END IF;
 IF v_oid IS NULL THEN RAISE EXCEPTION 'v615 engagement batch missing'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=v_oid) IS DISTINCT FROM '${LIVE.src}' THEN
   RAISE EXCEPTION 'v615 engagement batch drift (expected V524 body): %',(SELECT md5(prosrc) FROM pg_proc WHERE oid=v_oid);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND ${ATTRS}) THEN
   RAISE EXCEPTION 'v615 engagement function attributes drift';
 END IF;
 IF to_regclass('public.auto_campaign_detail_zalo_engagement') IS NULL THEN RAISE EXCEPTION 'v615 engagement table missing'; END IF;
 IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.auto_campaign_detail_zalo_engagement'::regclass AND attname='rejected_at' AND NOT attisdropped) THEN
   RAISE EXCEPTION 'v615 rejected_at already exists';
 END IF;
END;
$preflight$;

${b}
ALTER TABLE public.auto_campaign_detail_zalo_engagement ADD COLUMN rejected_at timestamptz;

DO $postflight$
DECLARE v_oid oid := to_regprocedure('${SIG}');
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND md5(prosrc)='${NEW.src}'
   AND md5(pg_get_functiondef(v_oid))='${NEW.def}' AND ${ATTRS}) THEN
   RAISE EXCEPTION 'v615 engagement function postflight mismatch';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.auto_campaign_detail_zalo_engagement'::regclass AND attname='rejected_at'
   AND NOT attisdropped AND NOT attnotnull AND atttypid='timestamptz'::regtype AND NOT atthasdef) THEN
   RAISE EXCEPTION 'v615 rejected_at postflight mismatch';
 END IF;
END;
$postflight$;

COMMIT;
`

const rollback = `-- Rollback V615: trả aka_agent_campaign_engagement_batch về đúng thân V524 (md5(prosrc) ${LIVE.src},
-- md5(pg_get_functiondef) ${LIVE.def}) và bỏ cột rejected_at (mất các mốc "Đã từ chối kết bạn" đã ghi).
-- Sinh bằng: node scripts/build-v615-sql.cjs. Chỉ chạy khi hàm đang là thân V615. DDL ⇒ PostgREST nạp lại schema.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE v_oid oid := to_regprocedure('${SIG}');
BEGIN
 IF v_oid IS NULL OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=v_oid) IS DISTINCT FROM '${NEW.src}' THEN
   RAISE EXCEPTION 'rollback v615: function is not the V615 body';
 END IF;
END;
$preflight$;

${oldBlock}
ALTER TABLE public.auto_campaign_detail_zalo_engagement DROP COLUMN rejected_at;

DO $postflight$
DECLARE v_oid oid := to_regprocedure('${SIG}');
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND md5(prosrc)='${LIVE.src}'
   AND md5(pg_get_functiondef(v_oid))='${LIVE.def}' AND ${ATTRS}) THEN
   RAISE EXCEPTION 'rollback v615: function postflight mismatch';
 END IF;
END;
$postflight$;

COMMIT;
`

fs.writeFileSync(path.join(ROOT, 'migrations', `${NAME}.sql`), migration)
fs.writeFileSync(path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`), rollback)
console.log(JSON.stringify({ name: NAME, from: LIVE, to: NEW, migrationMd5: md5(migration), rollbackMd5: md5(rollback) }, null, 1))
module.exports = { NAME, LIVE, NEW, oldBlock, newBlock: b }
