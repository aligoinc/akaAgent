// Sinh migration V601: câu ghi chú khi cả lô gửi dạng chia sẻ (engine v2 Zalo) không ai nhận được.
//
// Trước V601, aka_agent_engine_report_batch_v1 ghi đè ghi chú chiến dịch bằng câu chung của Desktop
// "Toàn bộ N target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra": có chữ kỹ thuật và làm mất lý do thật
// (tổ chức 2214 ngày 20/11/2026: cả 8 group bị Zalo trả 221 "Đạt giới hạn nhắn nhóm" mà khách chỉ thấy câu chung).
// Câu mới anh duyệt qua hộp chọn 20/11/2026:
//   cả lô cùng một lý do      → "Cả N nhóm đều gửi không thành công: <lý do>. Chiến dịch đã tạm dừng."
//   các data khác lý do       → "Cả N nhóm đều gửi không thành công, phần lớn do: <lý do gặp nhiều nhất>. Chiến dịch đã tạm dừng."
//   lô chỉ 1 data             → "1 nhóm gửi không thành công: <lý do>. Chiến dịch đã tạm dừng."
//   nhắn bạn bè dạng chia sẻ  → "bạn bè" thay "nhóm".
// Lý do = ghi chú data mà report_v1 vừa chốt cho từng mục của lô (cùng câu ở "Lịch sử hành động"); không có ghi chú nào thì bỏ phần lý do.
// N = cỡ lô như câu cũ (kể cả data đã báo riêng). Không đổi khi nào tạm dừng, data đi đâu, chính sách; chỉ đổi chữ của ghi chú.
//
// Thân nguồn = bản đang chạy production, đọc chỉ đọc 20/11/2026 (akachat cgjbsmqtfhqvttudyjzq): md5(prosrc) 90994a3c… (= V503),
// md5(pg_get_functiondef) 0452e5ff…; chủ postgres, SECURITY DEFINER, VOLATILE, search_path = '', EXECUTE postgres / service_role /
// aka_agent_chat_api / aka_agent_desktop.
// Chạy: node scripts/build-v601-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v503 = require('./build-v503-sql.cjs')

const NAME = 'migration_v601_engine_share_batch_fail_note'
const ROLLBACK_NAME = 'rollback_v601_engine_share_batch_fail_note'
const SIG = 'public.aka_agent_engine_report_batch_v1(uuid,jsonb,integer,boolean)'

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]
// pg_get_functiondef trên PostgreSQL 17 (đối chiếu từng byte với production 20/11/2026).
const DEF = body => `CREATE OR REPLACE FUNCTION public.aka_agent_engine_report_batch_v1(p_lease_token uuid, p_items jsonb, p_batch_size integer DEFAULT NULL::integer, p_already_stopped boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$${body}$function$
`

const m = /CREATE FUNCTION public\.aka_agent_engine_report_batch_v1\([\s\S]*?\nEND \$f\$;/.exec(v503.migration)
if (!m) throw new Error('Không thấy report_batch_v1 trong V503')
const oldBlock = m[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
const LIVE = { src: md5(bodyOf(oldBlock)), def: md5(DEF(bodyOf(oldBlock))) }
if (LIVE.src !== v503.NEW.reportBatch || LIVE.src !== '90994a3cbe67f6f9c1f7d5dd8f0c4c79') {
  throw new Error(`Thân report_batch_v1 của V503 không còn khớp bản đang chạy production (90994a3c…): ${LIVE.src}`)
}
if (LIVE.def !== '0452e5ff91536f9f9ac1504eac5a3d54') {
  throw new Error(`Định nghĩa report_batch_v1 dựng lại không khớp pg_get_functiondef production (0452e5ff…): ${LIVE.def}`)
}

let b = oldBlock
b = patch(b, `-- Không ai nhận được và chưa có chính sách nào dừng tài khoản / chiến dịch → tạm dừng chiến dịch với câu của Desktop.`,
`-- Không ai nhận được và chưa có chính sách nào dừng tài khoản / chiến dịch → tạm dừng chiến dịch; V601: ghi chú kèm lý do của lô
-- (câu anh duyệt 20/11/2026), không còn câu chung của Desktop.`, 1, 'chú thích đầu hàm')
b = patch(b, `  v_rejected jsonb;
BEGIN`, `  v_rejected jsonb;
  v_fail_notes text[] := '{}';
  v_reason text;
  v_reason_kinds integer;
  v_size integer;
BEGIN`, 1, 'khai báo')
b = patch(b, `      v_results := v_results || jsonb_build_array(jsonb_build_object('targetRunId', v_run, 'scope', v_scope, 'response', v_res));`,
`      v_results := v_results || jsonb_build_array(jsonb_build_object('targetRunId', v_run, 'scope', v_scope, 'response', v_res));
      -- V601: ghi chú data vừa chốt (cùng câu ở Lịch sử hành động) làm lý do cho câu tạm dừng cả lô.
      IF nullif(btrim(v_res->'target'->>'note'), '') IS NOT NULL THEN
        v_fail_notes := v_fail_notes || btrim(v_res->'target'->>'note');
      END IF;`, 1, 'gom ghi chú data')
b = patch(b, `  -- Không ai nhận được, chưa có chính sách nào dừng tài khoản / chiến dịch: tạm dừng chiến dịch để kiểm tra (như Desktop).
  IF NOT v_success AND NOT coalesce(p_already_stopped, false) AND v_stop_rank < 3 AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
       WHERE l.account_id = v_account_id AND l.lease_token = p_lease_token AND l.expires_at > clock_timestamp()) THEN
    v_note := 'Toàn bộ ' || greatest(coalesce(p_batch_size, 0), jsonb_array_length(p_items))
      || ' target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra';`,
`  -- Không ai nhận được, chưa có chính sách nào dừng tài khoản / chiến dịch: tạm dừng chiến dịch (như Desktop).
  -- V601: câu anh duyệt 20/11/2026 thay "Toàn bộ N target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra":
  -- nêu lý do (cùng một lý do: ": <lý do>"; khác nhau: ", phần lớn do: <lý do gặp nhiều nhất>", bằng nhau lấy lý do của data đầu),
  -- "bạn bè" cho nhắn bạn bè, lô 1 data viết "1 nhóm gửi không thành công". N = cỡ lô như câu cũ.
  IF NOT v_success AND NOT coalesce(p_already_stopped, false) AND v_stop_rank < 3 AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
       WHERE l.account_id = v_account_id AND l.lease_token = p_lease_token AND l.expires_at > clock_timestamp()) THEN
    v_size := greatest(coalesce(p_batch_size, 0), jsonb_array_length(p_items));
    SELECT n.note INTO v_reason FROM unnest(v_fail_notes) WITH ORDINALITY n(note, i)
     GROUP BY n.note ORDER BY count(*) DESC, min(n.i) LIMIT 1;
    SELECT count(DISTINCT n.note) INTO v_reason_kinds FROM unnest(v_fail_notes) n(note);
    v_reason := nullif(rtrim(v_reason, ' .'), '');
    v_note := CASE WHEN v_size = 1 THEN '1 ' ELSE 'Cả ' || v_size || ' ' END
      || CASE WHEN c.action_id = 'zalo_message_friend' THEN 'bạn bè' ELSE 'nhóm' END
      || CASE WHEN v_size = 1 THEN ' gửi không thành công' ELSE ' đều gửi không thành công' END
      || CASE WHEN v_reason IS NULL THEN '' WHEN v_reason_kinds > 1 THEN ', phần lớn do: ' || v_reason ELSE ': ' || v_reason END
      || '. Chiến dịch đã tạm dừng.';`, 1, 'câu tạm dừng cả lô')
const newBlock = b
const NEW = { src: md5(bodyOf(newBlock)), def: md5(DEF(bodyOf(newBlock))) }

const ATTRS = `pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR NOT p.prosecdef OR p.provolatile IS DISTINCT FROM 'v'
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]`

const preflight = (label, expect, done, msg, ledger) => `DO $pre$
DECLARE v_oid oid; p pg_catalog.pg_proc%ROWTYPE; v_md5 text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v601_%') THEN
      RAISE EXCEPTION 'V601 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}  v_oid := to_regprocedure('${SIG}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${SIG}'; END IF;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  v_md5 := md5(p.prosrc);
  IF v_md5 = '${done.src}' THEN RAISE EXCEPTION '${msg.done}'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect.src}' THEN RAISE EXCEPTION '${msg.drift} (%)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 IS DISTINCT FROM '${expect.def}' THEN RAISE EXCEPTION '${label}: định nghĩa report_batch_v1 khác bản nguồn (%)', v_md5; END IF;
  IF ${ATTRS} THEN
    RAISE EXCEPTION '${label}: chủ sở hữu / thuộc tính report_batch_v1 khác bản đã đọc';
  END IF;
  -- Hậu kiểm so lại đúng quyền đã lưu (CREATE OR REPLACE giữ chủ sở hữu và quyền).
  PERFORM set_config('aka.v601_acl', coalesce(p.proacl::text, ''), true);
END $pre$;`

const postflight = (label, expect) => `DO $post$
DECLARE v_oid oid; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  v_oid := '${SIG}'::regprocedure;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF md5(p.prosrc) IS DISTINCT FROM '${expect.src}' THEN RAISE EXCEPTION '${label} postflight: thân report_batch_v1 %', md5(p.prosrc); END IF;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expect.def}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa report_batch_v1 %', md5(pg_get_functiondef(v_oid));
  END IF;
  IF ${ATTRS}
       OR coalesce(p.proacl::text, '') IS DISTINCT FROM current_setting('aka.v601_acl', true) THEN
    RAISE EXCEPTION '${label} postflight: chủ sở hữu / quyền / thuộc tính report_batch_v1 bị đổi';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '${label} postflight: quyền report_batch_v1 quá rộng';
  END IF;
  IF NOT (has_function_privilege('service_role', v_oid, 'EXECUTE') AND has_function_privilege('aka_agent_chat_api', v_oid, 'EXECUTE')
          AND has_function_privilege('aka_agent_desktop', v_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '${label} postflight: thiếu quyền EXECUTE report_batch_v1 của bên gọi';
  END IF;
END $post$;`

const migration = `-- V601: ghi chú chiến dịch khi cả lô gửi dạng chia sẻ (engine v2 Zalo) không ai nhận được.
-- SINH TỪ scripts/build-v601-sql.cjs, không sửa tay.
--
-- Trước V601 ghi chú là câu chung "Toàn bộ N target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra" (chữ kỹ thuật, mất
-- lý do thật). Câu mới anh duyệt 20/11/2026: "Cả N nhóm đều gửi không thành công: <lý do>. Chiến dịch đã tạm dừng." (khác lý do:
-- ", phần lớn do: <lý do>"; lô 1 data: "1 nhóm gửi không thành công: …"; nhắn bạn bè: "bạn bè"). Lý do = ghi chú data của lô.
-- Chỉ thay thân aka_agent_engine_report_batch_v1 (thân V503 md5 ${LIVE.src}); CREATE OR REPLACE giữ chủ sở hữu, quyền,
-- SECURITY DEFINER, search_path. Không đổi khi nào tạm dừng, data đi đâu, chính sách, bảng, dữ liệu. Chỉ engine v2 (Desktop bản mới,
-- worker Fly) gọi hàm này; bộ chạy cũ (campaignScheduler.ts, ChatApi zaloCampaignExecutor.ts) giữ câu cũ. Ghi chú đã ghi trước V601
-- không đổi. Lệnh DDL làm PostgREST nạp lại schema (trigger DDL chung): apply ngoài giờ cao điểm.
-- Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('V601', LIVE, NEW, {
  done: 'V601 đã chạy: thân report_batch_v1 đã là bản V601',
  drift: 'V601: thân report_batch_v1 khác bản đang chạy production 20/11, dừng để đối chiếu bản live'
}, true)}

${newBlock}

${postflight('V601', NEW)}

COMMIT;
`

const rollback = `-- Gỡ V601: trả aka_agent_engine_report_batch_v1 về thân V503 (md5 prosrc ${LIVE.src}): ghi chú tạm dừng cả lô lại là câu chung
-- "Toàn bộ N target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra".
-- SINH TỪ scripts/build-v601-sql.cjs. Lệnh DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight('Gỡ V601', NEW, LIVE, {
  done: 'Gỡ V601: thân report_batch_v1 đã là bản trước V601 (chưa apply V601 hoặc đã gỡ)',
  drift: 'Gỡ V601: thân report_batch_v1 không phải bản V601'
}, false)}

${oldBlock}

${postflight('Gỡ V601', LIVE)}

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SIG, NAME, ROLLBACK_NAME, DEF, blocks: { old: oldBlock, new: newBlock } }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log('V601 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
