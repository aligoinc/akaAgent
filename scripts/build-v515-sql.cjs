// Sinh migration V515: sửa ba lỗi engine v2 mà bộ kịch bản 13/11/2026 tìm ra (docs/CAMPAIGN_OUTCOME_ENGINE_SCENARIO_TEST.md, mục B, C, D).
//
//   B. report_v1 (thân V507, md5 prosrc 4016395d…): mất câu trả lời của lần báo chốt data (mạng, hết giờ) thì lõi gửi lại cùng result_key;
//      lượt data đã đóng nên DB trả 'ownership_lost', lượt chạy dừng mà không nhả lease (tài khoản đứng ~3 phút). Nay lần chốt lưu câu trả
//      lời (cột mới auto_engine_target_runs.final_response, không kèm danh sách kết quả); gọi lại đúng lần chốt đó khi lease còn hạn thì
//      trả lại câu trả lời này, không áp lại hiệu ứng.
//   D. report_v1: data chốt chỉ ghi ghi chú khi có câu lỗi mới, nên data từng về hàng đợi kèm ghi chú (NET01…) rồi gửi thành công vẫn giữ
//      ghi chú cũ. Nay ghi chú là kết quả của lượt chốt, như bộ chạy Desktop (thành công thì note = null).
//   C. close_stale_v1 (thân V495, md5 prosrc 4a36295d…): mất câu trả lời của claim làm data bị bỏ "đang chạy" rồi pg_cron đóng "hoàn thành"
//      SYS01 dù chưa gửi. Thêm giá trị 'requeue_unstarted' cho engine.stale_unsent_target_action: chỉ trả về hàng đợi lượt data chưa có kết
//      quả nào; lượt đã có kết quả vẫn đóng như 'complete' (chạy lại sẽ lặp việc sau kết quả đó, ví dụ kiêm SMS không lọc trùng). Đặt
//      thiết lập sang 'requeue_unstarted'. 'requeue' và 'complete' giữ nghĩa cũ.
// Chỉ engine v2 dùng các hàm / cột / thiết lập này; bộ chạy cũ không đổi.
// Chạy: node scripts/build-v515-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v507 = require('./build-v507-sql.cjs')
const V495 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v495_campaign_outcome_engine.sql'), 'utf8')

const NAME = 'migration_v515_engine_report_replay_note_requeue'
const ROLLBACK_NAME = 'rollback_v515_engine_report_replay_note_requeue'

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

const reportOld = extract(v507.migration, 'aka_agent_engine_report_v1', 'CREATE OR REPLACE FUNCTION', 'V507')
const staleV495 = extract(V495, 'aka_agent_engine_close_stale_v1', 'CREATE FUNCTION', 'V495')
const staleOld = { block: staleV495.block.replace('CREATE FUNCTION public.aka_agent_engine_close_stale_v1(',
  'CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_stale_v1('), body: staleV495.body }

// Thân đang chạy production (đọc 13/11/2026 09:3x VN, md5(prosrc)): report_v1 = V507, close_stale_v1 = V495.
const LIVE = { report: md5(reportOld.body), closeStale: md5(staleOld.body) }
if (LIVE.report !== v507.NEW.report || LIVE.report !== '4016395dd68d36561086868a1b7f1ba3') {
  throw new Error('Thân report_v1 của V507 không còn khớp bản đang chạy production (4016395d…)')
}
if (LIVE.closeStale !== '4a36295d3b5646499f62790b80a29ffd') {
  throw new Error('Thân close_stale_v1 của V495 không còn khớp bản đang chạy production (4a36295d…)')
}

// ------------------------------------------------------------------------------------------------ report_v1 (B, D)
let r = reportOld.block
r = patch(r, `  v_more boolean;
`, `  v_more boolean;
  v_response jsonb;
`, 1, 'report: biến v_response')
r = patch(r, `
  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id;
  SELECT * INTO t FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
`, `
  -- V515 (B): gọi lại đúng lần báo đã chốt data (câu trả lời lần đầu bị mất: mạng, hết giờ) khi lease của lượt chạy còn hạn: trả lại câu
  -- trả lời của lần đầu, không áp lại hiệu ứng. Trước V515 lượt data đã đóng nên DB trả 'ownership_lost', lượt chạy dừng mà không nhả
  -- lease (tài khoản đứng tới khi lease hết hạn). Lease hết hạn, hay lời gọi có kết quả mới, thì đi đường cũ.
  IF NOT p_dry_run AND r.completed_at IS NOT NULL AND r.final_response IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_outcomes) x
                      WHERE NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo
                                         WHERE eo.result_key = btrim(x.value->>'resultKey') AND eo.target_run_id = r.id))
     AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
                  WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    SELECT coalesce(jsonb_agg((eo.decision->'result') || jsonb_build_object('replay', true) ORDER BY x.ordinality), '[]'::jsonb)
      INTO v_results
      FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
      JOIN public.auto_engine_outcomes eo ON eo.result_key = btrim(x.value->>'resultKey');
    RETURN r.final_response || jsonb_build_object('outcomes', v_results, 'replay', true);
  END IF;

  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id;
  SELECT * INTO t FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
`, 1, 'report: gọi lại lần chốt')
r = patch(r, `        UPDATE public.auto_campaign_input_data SET status = v_final_status,
          note = CASE WHEN v_note IS NOT NULL THEN v_note ELSE note END,
`, `        -- V515 (D): ghi chú của data là kết quả của lượt chốt này, như bộ chạy Desktop (thành công thì note = null). Trước V515 data từng
        -- về hàng đợi kèm ghi chú (NET01…) rồi gửi thành công vẫn giữ ghi chú cũ.
        UPDATE public.auto_campaign_input_data SET status = v_final_status,
          note = v_note,
`, 1, 'report: ghi chú khi chốt')
r = patch(r, `  RETURN jsonb_build_object('ok', true, 'dryRun', p_dry_run, 'next', v_next,
`, `  v_response := jsonb_build_object('ok', true, 'dryRun', p_dry_run, 'next', v_next,
`, 1, 'report: câu trả lời')
r = patch(r, `    'safety', v_safety);
END $f$;`, `    'safety', v_safety);
  -- V515 (B): lưu câu trả lời của lần chốt (không kèm danh sách kết quả, dựng lại từ auto_engine_outcomes khi gọi lại).
  IF v_target_done AND v_run_open AND NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET final_response = v_response - 'outcomes' WHERE id = r.id;
  END IF;
  RETURN v_response;
END $f$;`, 1, 'report: lưu câu trả lời')

// ------------------------------------------------------------------------------------------------ close_stale_v1 (C)
let s = staleOld.block
s = patch(s, `    ELSIF v_unsent = 'requeue' THEN
      v_code := 'err_engine_interrupted_before_send'; v_status := 'chờ xử lý';
`, `    -- V515 (C): 'requeue_unstarted' chỉ trả về hàng đợi lượt data chưa có kết quả nào, tức bộ chạy chưa làm gì với data (mất câu trả
    -- lời của claim, chết khi đang tra số). Lượt đã có kết quả (ví dụ nhắn bị từ chối rồi đã kiêm SMS) thì đóng như 'complete': chạy lại
    -- sẽ lặp các việc sau kết quả đó (kiêm SMS không lọc trùng). 'requeue' giữ nghĩa cũ: mọi lượt chưa có dấu "sắp gửi".
    ELSIF v_unsent = 'requeue'
       OR (v_unsent = 'requeue_unstarted' AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id)) THEN
      v_code := 'err_engine_interrupted_before_send'; v_status := 'chờ xử lý';
`, 1, 'close_stale: requeue_unstarted')

const NEW = { report: md5(bodyOf(r)), closeStale: md5(bodyOf(s)) }
const SIG = {
  report: 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)',
  closeStale: 'public.aka_agent_engine_close_stale_v1(integer)'
}
const SETTING = 'engine.stale_unsent_target_action'
const SETTING_OLD = { value: 'complete', description: 'V495: data dở CHƯA có dấu "sắp gửi": complete (đóng) hoặc requeue (trả về hàng đợi).' }
const SETTING_NEW = {
  value: 'requeue_unstarted',
  description: 'V495/V515: data dở CHƯA có dấu "sắp gửi": complete (đóng), requeue (trả về hàng đợi) hoặc requeue_unstarted (V515: chỉ trả về '
    + 'hàng đợi lượt data chưa có kết quả nào, lượt đã có kết quả thì đóng).'
}
const sq = text => `'${text.replace(/'/g, "''")}'`

const migration = `-- V515: sửa ba lỗi engine v2 của bộ kịch bản 13/11/2026 (docs/CAMPAIGN_OUTCOME_ENGINE_SCENARIO_TEST.md, mục B, C, D).
-- SINH TỪ scripts/build-v515-sql.cjs, không sửa tay.
--
--   * B (report_v1, thân V507): gọi lại lần báo đã chốt data khi lease còn hạn thì trả lại câu trả lời lần đầu (cột mới
--     auto_engine_target_runs.final_response), không còn 'ownership_lost' làm lượt chạy dừng và tài khoản đứng tới khi lease hết hạn.
--   * D (report_v1): data chốt thành công thì xoá ghi chú cũ (như bộ chạy Desktop), không còn giữ ghi chú của lần về hàng đợi trước.
--   * C (close_stale_v1, thân V495): thêm giá trị ${SETTING_NEW.value} cho ${SETTING} và đặt thiết lập sang giá trị này: data dở
--     chưa có kết quả nào (mất câu trả lời của claim) về hàng đợi thay vì bị đóng "hoàn thành" SYS01 dù chưa gửi.
-- Chỉ engine v2 dùng các hàm, cột, thiết lập này; bộ chạy cũ không đổi. DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
-- Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text; v_value text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v515_%') THEN
      RAISE EXCEPTION 'V515 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'auto_engine_target_runs' AND column_name = 'final_response') THEN
    RAISE EXCEPTION 'V515 đã chạy: auto_engine_target_runs.final_response đã có';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.report}');
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'V515: thân report_v1 khác V507 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.closeStale}');
  IF v_md5 IS DISTINCT FROM '${LIVE.closeStale}' THEN RAISE EXCEPTION 'V515: thân close_stale_v1 khác V495 (%)', v_md5; END IF;
  SELECT s.value INTO v_value FROM public.auto_system_settings s WHERE s.key = '${SETTING}';
  IF v_value IS DISTINCT FROM '${SETTING_OLD.value}' THEN
    RAISE EXCEPTION 'V515: ${SETTING} đang là %, không phải ${SETTING_OLD.value}', coalesce(v_value, '(không có dòng)');
  END IF;
END $pre$;

ALTER TABLE public.auto_engine_target_runs ADD COLUMN final_response jsonb;
COMMENT ON COLUMN public.auto_engine_target_runs.final_response IS
  'V515: câu trả lời report_v1 của lần chốt data (không kèm danh sách kết quả); gọi lại lần chốt đó khi lease còn hạn thì trả lại câu này.';

${r}

${s}

UPDATE public.auto_system_settings SET value = ${sq(SETTING_NEW.value)}, description = ${sq(SETTING_NEW.description)}, updated_at = now()
 WHERE key = '${SETTING}' AND value = ${sq(SETTING_OLD.value)};

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.report}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'V515 postflight: report_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.closeStale}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.closeStale}' THEN RAISE EXCEPTION 'V515 postflight: close_stale_v1 %', v_md5; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_engine_target_runs'
                  AND column_name = 'final_response' AND data_type = 'jsonb') THEN
    RAISE EXCEPTION 'V515 postflight: thiếu cột final_response';
  END IF;
  IF (SELECT s.value FROM public.auto_system_settings s WHERE s.key = '${SETTING}') IS DISTINCT FROM ${sq(SETTING_NEW.value)} THEN
    RAISE EXCEPTION 'V515 postflight: ${SETTING} chưa đổi';
  END IF;
  IF has_function_privilege('anon', '${SIG.report}', 'EXECUTE') OR has_function_privilege('authenticated', '${SIG.report}', 'EXECUTE')
     OR has_function_privilege('anon', '${SIG.closeStale}', 'EXECUTE') OR has_function_privilege('authenticated', '${SIG.closeStale}', 'EXECUTE') THEN
    RAISE EXCEPTION 'V515 postflight: quyền hàm quá rộng';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V515: trả report_v1 về thân V507, close_stale_v1 về thân V495, ${SETTING} về '${SETTING_OLD.value}', xoá cột
-- auto_engine_target_runs.final_response.
-- SINH TỪ scripts/build-v515-sql.cjs. DDL: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'auto_engine_target_runs' AND column_name = 'final_response') THEN
    RAISE EXCEPTION 'Gỡ V515: chưa có V515';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.report}');
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'Gỡ V515: thân report_v1 không phải bản V515 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${SIG.closeStale}');
  IF v_md5 IS DISTINCT FROM '${NEW.closeStale}' THEN RAISE EXCEPTION 'Gỡ V515: thân close_stale_v1 không phải bản V515 (%)', v_md5; END IF;
END $pre$;

${reportOld.block}

${staleOld.block}

UPDATE public.auto_system_settings SET value = ${sq(SETTING_OLD.value)}, description = ${sq(SETTING_OLD.description)}, updated_at = now()
 WHERE key = '${SETTING}' AND value = ${sq(SETTING_NEW.value)};

ALTER TABLE public.auto_engine_target_runs DROP COLUMN final_response;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.report}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'Gỡ V515 postflight: report_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${SIG.closeStale}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.closeStale}' THEN RAISE EXCEPTION 'Gỡ V515 postflight: close_stale_v1 %', v_md5; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'auto_engine_target_runs' AND column_name = 'final_response') THEN
    RAISE EXCEPTION 'Gỡ V515 postflight: còn cột final_response';
  END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SIG, SETTING, SETTING_OLD, SETTING_NEW, NAME, ROLLBACK_NAME }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log('V515 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
