#!/usr/bin/env node
// V600: chọn "khách hàng cũ Zalo" (bộ lọc cột, nguồn remarketing) không còn chạm trần 60 giây khi danh sách có vài nghìn khách.
//
// Ca thật 20/11/2026: nhân viên 429 (tài khoản 1828, ~2.400 khách trong 30 ngày) bấm chọn gần 2.000 data; 12:31–15:00 VN có 9 lượt
// aka_agent_read_filtered_remarketing_v1 dừng ở 60 giây (HTTP 500, 57014), các lượt khác 14–54 giây.
// Nguyên nhân: Postgres ước mỗi CTE chỉ 1 dòng nên ở bước dựng kết quả (FROM page p JOIN filtered c ON c.id = p.id) nó chạy lại toàn bộ
// phép nối "candidate" cho MỖI dòng của trang: trang 100 dòng × 772 khách = 77.200 lượt tra, mỗi lượt quét ~310 nhóm Zalo của tài khoản
// qua idx_zalo_groups_staff_account (đo 20/11: 26,8 giây). Trang 500 dòng × 2.400 khách thì vượt 60 giây. Lượt xuất (bấm "Chọn") đọc
// từng trang 500 dòng và cả lượt chỉ có 65 giây, nên chọn từ vài trăm khách trở lên là hỏng.
//
// Sửa 2 chỗ, kết quả giữ nguyên (so trên production 20/11 trong giao dịch repeatable read rồi huỷ, bản cũ và bản mới chạy như hàm tạm):
//   1. Bước dựng kết quả không nối lại "filtered": thêm CTE page_rows (MATERIALIZED) là bản chép thân candidate nhưng chỉ chạy cho người
//      nhận có latest_id nằm trong trang (≤ 500), rồi dựng JSON từ page_rows. Phần lọc / đếm / chọn trang (matched, page) giữ nguyên,
//      nên Postgres vẫn bỏ được các phép nối không cần khi không lọc theo cột đó.
//   2. Tên nhóm tra theo khoá (account_id, zalo_group_id) (index duy nhất idx_zalo_groups_account_group_id); lọc staff / tổ chức đặt
//      ngoài LIMIT 1 để Postgres không chọn idx_zalo_groups_staff_account rồi quét mọi nhóm của tài khoản.
// Bản nháp trước (candidate MATERIALIZED, dựng đủ cột cho mọi khách) chậm hơn bản cũ ~40–50% trên dữ liệu giả của
// scripts/column-filters (bản cũ chạy đúng cách ở đó), nên bỏ.
// Đo 20/11 (production, hàm tạm; vòng đọc như Desktop, 500 dòng/trang, con trỏ; dữ liệu đã vào bộ nhớ đệm): tài khoản 1828 trang 100 dòng
// 29,9 giây → 94 ms; 30 ngày 2.394 dòng (5 trang) 1,9 giây; toàn bộ 4.552 dòng (10 trang) 5,0 giây. Dữ liệu giả scripts/column-filters:
// ngang bản cũ (remarketing-export-sim.cjs). Tài khoản lịch sử rất lớn vẫn chậm vì đọc lịch sử từ đĩa, bản này không chữa.
//
// Nguồn: thân hàm trong file V441 đã apply (md5 pg_get_functiondef production đọc chỉ đọc 20/11/2026: 969a66f2…).
// Thân hàm mới không ghi số migration trong chú thích: đổi số thì md5 thân hàm không đổi.
// Chạy: node scripts/build-v600-sql.cjs (ghi migration + bản gỡ). Không sửa tay hai file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v600'
const NAME = `migration_${VERSION}_remarketing_read_single_pass`
const ROLLBACK_NAME = `rollback_${VERSION}_remarketing_read_single_pass`
const SIG = 'public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)'
/** md5 pg_get_functiondef của hàm trên production, đọc chỉ đọc 20/11/2026 (= bản V441 sinh ra). */
const LIVE_MD5 = '969a66f21752b62804c71acb4521cd33'
const SOURCE_FILE = 'migrations/migration_v441_zalo_scan_names.sql'

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

/** Thân hàm đang chạy: cắt nguyên văn khỏi file V441 (đã apply, không đổi). pg_get_functiondef kết thúc bằng một dòng trống. */
function readLive() {
  const source = fs.readFileSync(path.join(ROOT, SOURCE_FILE), 'utf8')
  const head = 'CREATE OR REPLACE FUNCTION public.aka_agent_read_filtered_remarketing_v1('
  const tail = 'END $function$'
  const start = source.indexOf(head)
  if (start < 0 || source.indexOf(head, start + 1) >= 0) throw new Error(`${SOURCE_FILE}: cần đúng một định nghĩa remarketing`)
  const end = source.indexOf(tail, start)
  if (end < 0) throw new Error(`${SOURCE_FILE}: không thấy cuối thân hàm`)
  return source.slice(start, end + tail.length) + '\n'
}

const live = readLive()
if (md5(live) !== LIVE_MD5) throw new Error(`Thân remarketing trong ${SOURCE_FILE} không còn khớp bản đang chạy (${LIVE_MD5})`)

let next = live
// Tên nhóm theo khoá (account_id, zalo_group_id); lọc staff / tổ chức ngoài LIMIT 1. Sửa trước khi chép thân candidate để cả hai bản dùng chung.
next = patch(next,
  String.raw` LEFT JOIN public.zalo_groups g ON g.account_id=campaign.account_id AND g.staff_id=$1 AND g.organization_id=$2 AND g.zalo_group_id=COALESCE(NULLIF(btrim(c.extra_data->>'zaloGroupId'),''),NULLIF(btrim(c.extra_data->>'zalo_group_id'),''),NULLIF(btrim(member.zalo_group_id),''))`,
  String.raw` LEFT JOIN LATERAL (SELECT g1.name FROM (SELECT g0.name,g0.staff_id,g0.organization_id FROM public.zalo_groups g0 WHERE g0.account_id=campaign.account_id AND g0.zalo_group_id=COALESCE(NULLIF(btrim(c.extra_data->>'zaloGroupId'),''),NULLIF(btrim(c.extra_data->>'zalo_group_id'),''),NULLIF(btrim(member.zalo_group_id),'')) LIMIT 1) g1 WHERE g1.staff_id=$1 AND g1.organization_id=$2) g ON true`,
  1, 'tên nhóm theo khoá tài khoản + mã nhóm')

// Thân candidate (đã sửa tên nhóm): chép thành page_rows, chỉ chạy cho người nhận có latest_id nằm trong trang.
const CANDIDATE_HEAD = '), candidate AS NOT MATERIALIZED (\n'
const CANDIDATE_TAIL = '\n), filtered AS NOT MATERIALIZED ('
const candidateStart = next.indexOf(CANDIDATE_HEAD)
const candidateEnd = next.indexOf(CANDIDATE_TAIL)
if (candidateStart < 0 || next.indexOf(CANDIDATE_HEAD, candidateStart + 1) >= 0 || candidateEnd < candidateStart) throw new Error('candidate: cần đúng một khối')
const candidateBody = next.slice(candidateStart + CANDIDATE_HEAD.length, candidateEnd)
if (candidateBody.includes('%')) throw new Error('candidate: thân có ký tự %, chép vào format() sẽ sai')
const pageRowsBody = patch(candidateBody,
  ' FROM rollup r JOIN public.auto_campaign_details d ON d.id=r.latest_id',
  ' FROM (SELECT r0.* FROM rollup r0 WHERE r0.latest_id IN (SELECT pg.id FROM page pg)) r JOIN public.auto_campaign_details d ON d.id=r.latest_id',
  1, 'page_rows: chỉ người nhận của trang')

next = patch(next,
  ' page AS MATERIALIZED (SELECT * FROM matched WHERE %2$s ORDER BY created_at DESC,id DESC OFFSET $5 LIMIT $6)\n',
  ' page AS MATERIALIZED (SELECT * FROM matched WHERE %2$s ORDER BY created_at DESC,id DESC OFFSET $5 LIMIT $6),\n'
    + ' page_rows AS MATERIALIZED (\n' + pageRowsBody + '\n )\n',
  1, 'page_rows sau page')
next = patch(next,
  " ORDER BY p.created_at DESC,p.id DESC) FROM page p JOIN filtered c ON c.id=p.id),'[]'::jsonb),",
  " ORDER BY c.created_at DESC,c.id DESC) FROM page_rows c),'[]'::jsonb),",
  1, 'dựng kết quả từ page_rows')

const NEW_TEXT = next
const NEW_MD5 = md5(NEW_TEXT)

const preflight = (label, expect, done, msgDone, msgDrift, ledger) => `DO $pre$
DECLARE v_oid oid; v_md5 text; v_meta text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${VERSION}_%') THEN
      RAISE EXCEPTION '${VERSION.toUpperCase()} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}  v_oid := to_regprocedure('${SIG}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${SIG}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${done}' THEN RAISE EXCEPTION '${msgDone}'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${msgDrift} (remarketing: %)', v_md5; END IF;
  SELECT concat_ws('|', coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner), p.prosecdef::text, p.provolatile::text, coalesce(p.proconfig::text, ''))
    INTO v_meta FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.${VERSION}_meta', v_meta, true);
END $pre$;`
const postflight = (label, expect) => `DO $post$
DECLARE v_oid oid; v_meta text;
BEGIN
  v_oid := '${SIG}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expect}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa remarketing %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT concat_ws('|', coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner), p.prosecdef::text, p.provolatile::text, coalesce(p.proconfig::text, ''))
    INTO v_meta FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_meta IS DISTINCT FROM current_setting('aka.${VERSION}_meta', true) THEN
    RAISE EXCEPTION '${label} postflight: quyền / chủ sở hữu / thiết lập của hàm bị đổi';
  END IF;
END $post$;`

const V = VERSION.toUpperCase()
const migration = `-- ${V}: chọn "khách hàng cũ Zalo" có vài nghìn khách không còn chạm trần 60 giây. SINH TỪ scripts/build-${VERSION}-sql.cjs, không sửa tay.
-- Thay thân aka_agent_read_filtered_remarketing_v1 (giữ chữ ký, chủ sở hữu, quyền, SECURITY DEFINER, statement_timeout 60s), kết quả giữ nguyên:
-- bước dựng kết quả chỉ tính đủ cột cho người nhận của trang (CTE page_rows) thay vì nối lại toàn bộ danh sách cho từng dòng, tên nhóm
-- tra theo (account_id, zalo_group_id). Lý do và số đo: đầu scripts/build-${VERSION}-sql.cjs.
-- Nguồn = pg_get_functiondef production 20/11/2026 (bản V441): ${LIVE_MD5}. Bản mới: ${NEW_MD5}.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight(V, LIVE_MD5, NEW_MD5, `${V} đã chạy`, `${V}: định nghĩa remarketing khác bản production 20/11 (V441), dừng để đối chiếu bản live`, true)}

${NEW_TEXT};

${postflight(V, NEW_MD5)}

COMMIT;
`
const rollback = `-- Gỡ ${V}: trả aka_agent_read_filtered_remarketing_v1 về bản V441 (production 20/11/2026). SINH TỪ scripts/build-${VERSION}-sql.cjs.
-- Sau khi gỡ, chọn khách hàng cũ Zalo với vài trăm khách trở lên lại có thể chạm trần 60 giây.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight(`Gỡ ${V}`, NEW_MD5, LIVE_MD5, `Gỡ ${V}: hàm đã là bản trước ${V}`, `Gỡ ${V}: định nghĩa remarketing không phải bản ${V}`, false)}

${live};

${postflight(`Gỡ ${V}`, LIVE_MD5)}

COMMIT;
`

module.exports = { migration, rollback, NAME, ROLLBACK_NAME, SIG, LIVE_MD5, NEW_MD5, texts: { live, new: NEW_TEXT } }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${V} migration`, md5(migration), 'rollback', md5(rollback), 'remarketing', LIVE_MD5, '->', NEW_MD5)
}
