#!/usr/bin/env node
// SỬA DỮ LIỆU zalo_users.global_id ghi sai (CHƯA CHẠY trên production; chỉ chạy khi anh duyệt, ngoài giờ cao điểm, sau khi kiểm đĩa).
// Nguyên nhân (đo 26/11/2026): hồ sơ thành viên nhóm Zalo (/api/social/group/members) trả globalId của CHÍNH nick đang xem; Desktop
// (accountContactRepository.ts upsertZaloUsersForGroupMembers) và WebApp (aka-agent-control.dataScan.ts saveGroupMembers) chép thẳng
// vào cột, và còn đè Global ID đúng đã có. Không đụng dòng của chính nick (zalo_uid = zalo_accounts.zalo_uid / chat_zalo_account.zalo_id).
//   R1 dòng chỉ có dữ liệu quét nhóm (raw_payload có zaloGroupId, không có khoá hồ sơ userId / username / bizPkg / phoneNumber) mà cột
//      là Global ID lần quét ghi (của người xem) hoặc Global ID của nick ⇒ để trống.
//   R2 dòng có khoá hồ sơ mà raw_payload.globalId khác cột (quét nhóm đè cột sau lần đọc hồ sơ / bạn bè): trả lại raw_payload.globalId
//      (nếu không phải Global ID của nick hiện tại).
//   R3 còn lại mang Global ID của nick (aka_agent_zalo_own_global_ids) ⇒ để trống.
// setup tạo bảng lưu private.zalo_users_gid_repair_20261126 + hàm tạm private.zalo_users_gid_repair_batch_20261126. Mỗi lô gọi hàm với
// (từ tài khoản, đến, giới hạn dòng): duyệt tài khoản Zalo theo khoá chính, mỗi tài khoản một câu account_id = hằng theo chỉ mục một phần
// idx_zalo_users_account_global_id (không để planner quét cả bảng như khi nối theo khoảng), lưu bản cũ rồi đổi, không đổi updated_at /
// last_seen_at, FOR UPDATE SKIP LOCKED (dòng đang bị ghi để lần quét lại); trả nextFrom để lô sau đi tiếp, không đọc lại tài khoản đã xong.
// Một lượt hết [lo, hi) đọc mọi dòng có Global ID của các tài khoản đó đúng một lần (toàn bảng ~6,75 GB heap ⇒ chạy ban đêm, nghỉ giữa
// lô); xong một lượt thì quét lại một lượt cho dòng bị khoá. teardown xoá hàm tạm.
//   node scripts/zalo-users-gid-repair.cjs setup | batch <từ> <đến> [limit] | rollback <lo> <hi> | report | teardown   → in SQL
'use strict'
const PROFILE_KEYS = `ARRAY['userId','username','bizPkg','phoneNumber']`
const TABLE = 'private.zalo_users_gid_repair_20261126'
const int = (v, name) => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} phải là số nguyên ≥ 0`); return n }


const scanOnly = `(zu.raw_payload ? 'zaloGroupId' AND NOT (zu.raw_payload ?| ${PROFILE_KEYS}))`
const rawGid = `NULLIF(btrim(COALESCE(zu.raw_payload->>'globalId','')),'')`
// R1 chỉ khi Global ID ở cột đúng là Global ID mà lần quét ghi (hoặc lần quét không ghi), hoặc là Global ID của nick: dòng quét nhóm mà
// sau đó được ghi Global ID khác (không phải của nick) mà không cập nhật raw_payload thì giữ.
const r1 = `(${scanOnly} AND (${rawGid} IS NULL OR ${rawGid} = zu.global_id OR zu.global_id = ANY(v_own)))`
const restorable = `(NOT ${scanOnly} AND zu.raw_payload ?| ${PROFILE_KEYS} AND ${rawGid} IS NOT NULL AND ${rawGid} <> zu.global_id AND NOT (${rawGid} = ANY(v_own)))`

// Câu cho MỘT tài khoản (v_acc, v_own, v_self, v_left là biến plpgsql): account_id = hằng ⇒ đi chỉ mục một phần
// idx_zalo_users_account_global_id. Kiểm kế hoạch: accountStatementSql thay biến bằng giá trị.
const accountStatement = `WITH cand AS (
    SELECT zu.id, zu.account_id, zu.zalo_uid, zu.global_id AS old_gid,
      CASE WHEN ${r1} THEN 'R1_group_scan_viewer_gid' WHEN ${restorable} THEN 'R2_restore_profile_gid' ELSE 'R3_own_gid' END AS reason,
      CASE WHEN NOT ${r1} AND ${restorable} THEN ${rawGid} END AS new_gid
    FROM public.zalo_users zu
    WHERE zu.account_id = v_acc AND zu.global_id IS NOT NULL AND zu.global_id <> ''
      AND NOT (zu.zalo_uid = ANY(v_self))
      AND (${r1} OR ${restorable} OR zu.global_id = ANY(v_own))
    LIMIT v_left
    FOR UPDATE OF zu SKIP LOCKED
  ),
  bk AS (
    INSERT INTO ${TABLE} (zalo_user_id, account_id, zalo_uid, old_global_id, new_global_id, reason)
    SELECT id, account_id, zalo_uid, old_gid, new_gid, reason FROM cand
    -- Dòng đã sửa trước đó mà app (bản cũ) ghi sai lại: lưu giá trị sai mới nhất (hoàn tác trả về giá trị ngay trước lần sửa này).
    ON CONFLICT (zalo_user_id) DO UPDATE SET old_global_id = EXCLUDED.old_global_id, new_global_id = EXCLUDED.new_global_id,
      reason = EXCLUDED.reason, repaired_at = now()
    RETURNING zalo_user_id
  ),
  -- bk và up chạy trong cùng một câu (nguyên khối): lưu bản cũ lỗi thì không dòng nào bị đổi. Không nối up với bk (kế hoạch chung của
  -- plpgsql nối hai CTE thành vòng lặp lồng 5.000 × 5.000).
  up AS (
    UPDATE public.zalo_users zu SET global_id = c.new_gid      -- không đổi updated_at / last_seen_at
    FROM cand c
    WHERE zu.id = c.id AND zu.global_id = c.old_gid
    RETURNING c.reason
  )
  SELECT COALESCE(sum(x.n), 0)::int, COALESCE(jsonb_object_agg(x.reason, x.n), '{}'::jsonb) FROM (SELECT reason, count(*) n FROM up GROUP BY 1) x`

const functionSql = `CREATE OR REPLACE FUNCTION private.zalo_users_gid_repair_batch_20261126(p_from bigint, p_hi bigint, p_limit integer, p_budget_ms integer DEFAULT 20000)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $f$
-- Một lô sửa zalo_users.global_id: tài khoản Zalo id ∈ [p_from, p_hi) theo thứ tự id, tối đa p_limit dòng sửa và khoảng p_budget_ms
-- (xét sau mỗi tài khoản, nên tài khoản đọc nhiều dòng không có gì để sửa không kéo dài câu). Trả số dòng đã sửa theo lý do và nextFrom
-- (tài khoản đang làm dở nếu chạm p_limit, tài khoản kế nếu hết giờ, hết khoảng thì p_hi). Mỗi tài khoản một câu theo chỉ mục.
DECLARE a record; v_acc bigint; v_own text[]; v_self text[]; v_left integer := p_limit; v_n integer; v_r jsonb; v_total integer := 0;
  v_by jsonb := '{}'::jsonb; v_next bigint := p_hi; v_accounts integer := 0; v_t0 timestamptz := clock_timestamp();
BEGIN
 FOR a IN SELECT id FROM public.auto_accounts WHERE id >= p_from AND id < p_hi AND flatform_type = 'zalo' ORDER BY id LOOP
  v_acc := a.id; v_accounts := v_accounts + 1;
  v_own := private.aka_agent_zalo_own_global_ids(v_acc);
  v_self := ARRAY(SELECT x FROM (
    SELECT NULLIF(btrim(za.zalo_uid),'') x FROM public.auto_accounts aa JOIN public.zalo_accounts za ON za.id = aa.zalo_account_id WHERE aa.id = v_acc
    UNION
    SELECT NULLIF(btrim(ca.zalo_id),'') FROM public.chat_zalo_account_organization ao JOIN public.chat_zalo_account ca ON ca.id = ao.chat_zalo_account_id
     WHERE ao.auto_account_id = v_acc) s WHERE x IS NOT NULL);
  ${accountStatement}
  INTO v_n, v_r;
  v_total := v_total + v_n; v_left := v_left - v_n;
  SELECT COALESCE(jsonb_object_agg(k, COALESCE((v_by->>k)::int, 0) + COALESCE((v_r->>k)::int, 0)), '{}'::jsonb) INTO v_by
   FROM (SELECT jsonb_object_keys(v_by) k UNION SELECT jsonb_object_keys(v_r)) kk;
  IF v_left <= 0 THEN v_next := v_acc; EXIT; END IF;
  IF clock_timestamp() - v_t0 > make_interval(secs => p_budget_ms / 1000.0) THEN v_next := v_acc + 1; EXIT; END IF;
 END LOOP;
 RETURN jsonb_build_object('updated', v_total, 'byReason', v_by, 'nextFrom', LEAST(v_next, p_hi), 'accounts', v_accounts,
  'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END $f$;
REVOKE ALL ON FUNCTION private.zalo_users_gid_repair_batch_20261126(bigint, bigint, integer, integer) FROM PUBLIC;`

function batchSql(from, hi, limit = 5000, budgetMs = 20000) {
  from = int(from, 'from'); hi = int(hi, 'hi'); limit = int(limit, 'limit'); budgetMs = int(budgetMs, 'budgetMs')
  if (limit < 1) throw new Error('limit phải ≥ 1')
  return `SELECT private.zalo_users_gid_repair_batch_20261126(${from}, ${hi}, ${limit}, ${budgetMs}) r;`
}
/** Câu của một tài khoản với tham số $1 tài khoản, $2 Global ID của nick, $3 Zalo ID của nick, $4 giới hạn (để PREPARE + EXPLAIN). */
const accountStatementSql = () => accountStatement.replace(/v_acc/g, '$1').replace(/v_own/g, '$2').replace(/v_self/g, '$3').replace(/v_left/g, '$4')
const setupSql = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  zalo_user_id bigint PRIMARY KEY,
  account_id bigint NOT NULL,
  zalo_uid text NOT NULL,
  old_global_id text NOT NULL,
  new_global_id text,
  reason text NOT NULL,
  repaired_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zalo_users_gid_repair_20261126_account ON ${TABLE} (account_id);
REVOKE ALL ON ${TABLE} FROM PUBLIC;
${functionSql}
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON ${TABLE} FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON ${TABLE} FROM authenticated'; END IF;
END $r$;`

const teardownSql = `DROP FUNCTION IF EXISTS private.zalo_users_gid_repair_batch_20261126(bigint, bigint, integer, integer);`

// Hoàn tác theo khoảng tài khoản: chỉ trả dòng vẫn đang giữ giá trị lần sửa đặt (không đè giá trị app ghi sau đó).
function rollbackSql(lo, hi) {
  lo = int(lo, 'lo'); hi = int(hi, 'hi')
  return `WITH r AS (
  SELECT r.zalo_user_id, r.old_global_id, r.new_global_id FROM ${TABLE} r WHERE r.account_id >= ${lo} AND r.account_id < ${hi}
)
UPDATE public.zalo_users zu SET global_id = r.old_global_id
FROM r WHERE zu.id = r.zalo_user_id AND zu.global_id IS NOT DISTINCT FROM r.new_global_id
RETURNING zu.id;`
}

const reportSql = `SELECT reason, count(*) n, count(*) FILTER (WHERE new_global_id IS NOT NULL) restored, count(DISTINCT account_id) accounts,
  min(repaired_at) first_at, max(repaired_at) last_at FROM ${TABLE} GROUP BY 1 ORDER BY 1;`

module.exports = { setupSql, batchSql, accountStatementSql, teardownSql, rollbackSql, reportSql, TABLE }
if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2)
  const out = cmd === 'setup' ? setupSql : cmd === 'batch' ? batchSql(a, b, c ?? 5000, process.argv[6] ?? 20000) : cmd === 'rollback' ? rollbackSql(a, b) : cmd === 'report' ? reportSql
    : cmd === 'teardown' ? teardownSql : null
  if (!out) { console.error('dùng: setup | batch <từ tài khoản> <đến> [limit] [budget_ms] | rollback <lo> <hi> | report | teardown'); process.exit(2) }
  process.stdout.write(out + '\n')
}
