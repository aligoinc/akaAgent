// Sinh migration V588 và bản gỡ: đợt 2 của bộ kiểm lỗi chiến dịch Facebook (docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md mục 12).
//   node scripts/build-v588-sql.cjs
// Thân hàm tick mới = thân V574 (đọc từ migration_v574_engine_error_watch.sql, md5 thân trùng production) + các chỗ vá ở PATCHES.
// Không sửa tay hai tệp SQL sinh ra; sửa ở đây rồi sinh lại. Sau khi đã apply thì không sinh lại nữa, viết migration mới.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'migrations')
const V574 = fs.readFileSync(path.join(MIGRATIONS, 'migration_v574_engine_error_watch.sql'), 'utf8')
const V574_BODY_MD5 = 'a93263ce4f9af16c1e34e4bd78cf1562' // md5(prosrc) trên production, đọc 19/11/2026
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

function tickBody() {
  const head = 'CREATE FUNCTION public.aka_agent_engine_error_watch_tick_v1()'
  const a = V574.indexOf(head)
  const b = V574.indexOf('AS $f$', a) + 'AS $f$'.length
  const e = V574.indexOf('$f$;', b)
  if (a < 0 || b < 0 || e < 0) throw new Error('Không tìm thấy thân hàm tick trong V574')
  const body = V574.slice(b, e)
  if (md5(body) !== V574_BODY_MD5) throw new Error(`Thân hàm tick V574 lệch md5: ${md5(body)}`)
  return body
}

/** Mỗi chỗ vá: đoạn cũ phải có đúng một lần trong thân V574. */
const PATCHES = [
  ['khai báo biến', `  v_fired integer := 0;
  v_result jsonb;
BEGIN`, `  v_fired integer := 0;
  v_result jsonb;
  -- V588: lỗi theo từng lượt, câu cho khách
  v_items integer := 0;
  v_stale_items integer := 0;
  v_notes integer := 0;
  v_item_days integer;
  it record;
  v_old_log text;
  v_new_log text;
  -- V588: gọi lại /fire khi câu chưa ai nhận
  v_fire_retry integer;
  v_fire_max integer;
  v_refired integer := 0;
  fr record;
BEGIN`],

  ['đọc thêm cột của kết quả lỗi', `      SELECT o.target_run_id, o.action_code, o.error_code, o.created_at,
             o.decision -> 'result' ->> 'publicCode' AS public_code,`, `      SELECT o.target_run_id, o.action_code, o.error_code, o.created_at,
             o.result_key, o.input_data_id, o.campaign_id, o.account_id, o.detail_id, left(o.signal ->> 'message', 500) AS message,
             o.decision -> 'result' ->> 'publicCode' AS public_code,`],

  ['ghi từng lượt lỗi của ca', `            updated_at = v_now
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM fbo), (SELECT count(*) FROM upserted), (SELECT count(*) FROM hourly)
      INTO v_seen, v_cases, v_files;  -- v_files ở đây chỉ để buộc CTE hourly chạy`, `            updated_at = v_now
      RETURNING 1
    ), items AS (
      -- V588: mỗi kết quả lỗi thuộc một ca là một dòng (khách, tài khoản, chiến dịch, data lấy theo mã). Gọi lại không ghi trùng.
      INSERT INTO private.auto_engine_error_items
        (case_key, result_key, target_run_id, input_data_id, campaign_id, account_id, staff_id, organization_id, detail_id, error_code, public_code,
         action_code, step, message, occurred_at)
      SELECT left(f.error_code || '|' || coalesce(f.action_code, '') || '|' || f.step || '|' || f.pattern, 700), f.result_key, f.target_run_id,
             f.input_data_id, f.campaign_id, f.account_id, r.staff_id, r.organization_id, f.detail_id, f.error_code, f.public_code,
             coalesce(f.action_code, ''), f.step, f.message, f.created_at
        FROM fbo f LEFT JOIN public.auto_engine_target_runs r ON r.id = f.target_run_id
       WHERE f.error_code <> ALL (v_known)
      ON CONFLICT (result_key) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM fbo), (SELECT count(*) FROM upserted), (SELECT count(*) FROM hourly), (SELECT count(*) FROM items)
      INTO v_seen, v_cases, v_files, v_items;  -- v_files ở đây chỉ để buộc CTE hourly chạy`],

  ['lượt bỏ dở: đọc từng lượt', `    WITH stale AS (
      SELECT left('stale|' || c.action_id || '|' || coalesce(r.final_error_code, ''), 700) AS case_key, c.action_id, r.final_error_code,
             count(*) AS hits, min(r.completed_at) AS first_seen, max(r.completed_at) AS last_seen,
             (array_agg(r.id ORDER BY r.id DESC))[1:5] AS sample_runs
        FROM public.auto_engine_target_runs r
        JOIN public.auto_campaigns c ON c.id = r.campaign_id
        JOIN public.auto_campaign_actions a ON a.id = c.action_id
       WHERE r.started_at > v_stale_from AND r.started_at <= v_stale_to AND r.close_reason = 'stale' AND a.flatform_type = 'facebook'
         AND EXISTS (SELECT 1 FROM public.auto_staff_device_presence d
                      WHERE d.staff_id = r.staff_id AND d.last_seen_at >= r.completed_at - interval '2 minutes')
       GROUP BY c.action_id, r.final_error_code
    ), upserted AS (`, `    WITH stale_runs AS MATERIALIZED (
      SELECT r.id, r.input_data_id, r.campaign_id, r.account_id, r.staff_id, r.organization_id, r.completed_at, c.action_id, r.final_error_code,
             left('stale|' || c.action_id || '|' || coalesce(r.final_error_code, ''), 700) AS case_key
        FROM public.auto_engine_target_runs r
        JOIN public.auto_campaigns c ON c.id = r.campaign_id
        JOIN public.auto_campaign_actions a ON a.id = c.action_id
       WHERE r.started_at > v_stale_from AND r.started_at <= v_stale_to AND r.close_reason = 'stale' AND a.flatform_type = 'facebook'
         AND EXISTS (SELECT 1 FROM public.auto_staff_device_presence d
                      WHERE d.staff_id = r.staff_id AND d.last_seen_at >= r.completed_at - interval '2 minutes')
    ), stale AS (
      SELECT s0.case_key, s0.action_id, s0.final_error_code,
             count(*) AS hits, min(s0.completed_at) AS first_seen, max(s0.completed_at) AS last_seen,
             (array_agg(s0.id ORDER BY s0.id DESC))[1:5] AS sample_runs
        FROM stale_runs s0
       GROUP BY s0.case_key, s0.action_id, s0.final_error_code
    ), upserted AS (`],

  ['lượt bỏ dở: ghi từng lượt', `            updated_at = v_now
      RETURNING 1
    )
    SELECT count(*) INTO v_stale FROM upserted;
    st.stale_cursor_at := v_stale_to;`, `            updated_at = v_now
      RETURNING 1
    ), stale_items AS (
      INSERT INTO private.auto_engine_error_items
        (case_key, result_key, target_run_id, input_data_id, campaign_id, account_id, staff_id, organization_id, error_code, action_code, step, message, occurred_at)
      SELECT s1.case_key, 'stale:' || s1.id, s1.id, s1.input_data_id, s1.campaign_id, s1.account_id, s1.staff_id, s1.organization_id, s1.final_error_code,
             s1.action_id, '', 'Lượt bị đóng vì treo quá lâu trong khi máy khách vẫn hoạt động', coalesce(s1.completed_at, v_now)
        FROM stale_runs s1
      ON CONFLICT (result_key) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM upserted), (SELECT count(*) FROM stale_items) INTO v_stale, v_stale_items;
    st.stale_cursor_at := v_stale_to;`],

  ['dọn lỗi theo lượt cũ', `    DELETE FROM private.auto_engine_error_hourly h WHERE h.hour_at < v_now - interval '15 days';`,
  `    DELETE FROM private.auto_engine_error_hourly h WHERE h.hour_at < v_now - interval '15 days';
    -- V588: lỗi theo lượt giữ itemRetentionDays ngày (mặc định 30, ít nhất 7); lượt đã ghi câu cho khách không cần dòng này để hiển thị.
    v_item_days := greatest(private.aka_agent_engine_error_num(v_cfg ->> 'itemRetentionDays', 30)::integer, 7);
    DELETE FROM private.auto_engine_error_items i WHERE i.occurred_at < v_now - make_interval(days => v_item_days);`],

  ['chép kết luận về sổ ca', `  UPDATE private.auto_engine_error_cases k
     SET status = CASE WHEN m.status = 'hoàn thành' THEN 'reported' ELSE 'failed' END, updated_at = v_now
    FROM public.ai_message m
   WHERE k.status = 'queued' AND m.id = k.last_message_id
     AND (m.status IN ('hoàn thành', 'lỗi', 'đã hủy') OR m.deadline_at <= v_now);`, `  -- V588: báo cáo xong thì chép kết luận về sổ ca. Câu cho khách và mã lỗi đề xuất chỉ vào trạng thái "proposed": chưa ghi gì cho khách,
  --       chưa ghi gì vào bảng mã lỗi, chờ admin akaBiz duyệt. Câu / mã đã duyệt thì báo cáo sau không ghi đè.
  UPDATE private.auto_engine_error_cases k
     SET status = CASE WHEN m.status = 'hoàn thành' THEN 'reported' ELSE 'failed' END,
         report = CASE WHEN rp.has THEN m.answer_json ELSE k.report END,
         report_message_id = CASE WHEN rp.has THEN m.id ELSE k.report_message_id END,
         report_at = CASE WHEN rp.has THEN v_now ELSE k.report_at END,
         summary = CASE WHEN rp.has THEN left(m.answer_json ->> 'tom_tat', 1000) ELSE k.summary END,
         conclusion = CASE WHEN rp.has AND coalesce(m.answer_json ->> 'ket_luan', '') <> '' THEN left(m.answer_json ->> 'ket_luan', 40) ELSE k.conclusion END,
         confidence = CASE WHEN rp.has AND coalesce(m.answer_json ->> 'do_chac', '') <> '' THEN left(m.answer_json ->> 'do_chac', 20) ELSE k.confidence END,
         customer_note = CASE WHEN rp.note IS NOT NULL AND k.customer_note_status <> 'approved' THEN rp.note ELSE k.customer_note END,
         customer_note_status = CASE WHEN rp.note IS NOT NULL AND k.customer_note_status <> 'approved' AND rp.note IS DISTINCT FROM k.customer_note
                                     THEN 'proposed' ELSE k.customer_note_status END,
         code_proposal = CASE WHEN rp.code IS NOT NULL AND k.code_proposal_status NOT IN ('approved', 'applied') THEN rp.code ELSE k.code_proposal END,
         code_proposal_status = CASE WHEN rp.code IS NOT NULL AND k.code_proposal_status NOT IN ('approved', 'applied') AND rp.code IS DISTINCT FROM k.code_proposal
                                     THEN 'proposed' ELSE k.code_proposal_status END,
         updated_at = v_now
    FROM public.ai_message m
    CROSS JOIN LATERAL (
      SELECT (m.status = 'hoàn thành' AND jsonb_typeof(m.answer_json) = 'object') AS has,
             CASE WHEN m.status = 'hoàn thành' AND jsonb_typeof(m.answer_json -> 'cau_cho_khach') = 'string' AND btrim(m.answer_json ->> 'cau_cho_khach') <> ''
                  THEN left(regexp_replace(btrim(m.answer_json ->> 'cau_cho_khach'), '\\s+', ' ', 'g'), 200) END AS note,
             CASE WHEN m.status = 'hoàn thành' AND jsonb_typeof(m.answer_json -> 'de_xuat_ma_loi') = 'object' THEN m.answer_json -> 'de_xuat_ma_loi' END AS code
    ) rp
   WHERE k.status = 'queued' AND m.id = k.last_message_id
     AND (m.status IN ('hoàn thành', 'lỗi', 'đã hủy') OR m.deadline_at <= v_now);`],

  ['ghi câu cho khách đã duyệt', `  -- 6. Chèn việc.
  v_enqueue := (v_cfg -> 'enqueue') = 'true'::jsonb;`, `  -- 5b. V588: câu cho khách. Ca đã được duyệt câu: ghi câu (kèm mã công khai) vào dòng lịch sử và ghi chú data của từng lượt thuộc ca, kể cả
  --     lượt mới về sau. Ca bị bỏ duyệt: trả lại câu cũ cho các lượt đã ghi. Mỗi lượt tick tối đa 100 lượt; ghi chú data chỉ đổi khi còn đúng
  --     câu cũ (data đã chạy lại và có ghi chú khác thì giữ nguyên). Một lượt ghi lỗi thì dừng vòng, không làm hỏng phần còn lại của tick.
  FOR it IN
    SELECT i.id, i.detail_id, i.input_data_id, i.public_code, i.original_log, i.note_applied, k.customer_note,
           (k.customer_note_status = 'approved' AND k.customer_note IS NOT NULL) AS approved
      FROM private.auto_engine_error_items i JOIN private.auto_engine_error_cases k ON k.case_key = i.case_key
     WHERE i.detail_id IS NOT NULL
       AND ((k.customer_note_status = 'approved' AND k.customer_note IS NOT NULL AND i.note_applied_at IS NULL)
            OR (k.customer_note_status <> 'approved' AND i.note_applied_at IS NOT NULL))
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      IF it.approved THEN
        v_new_log := it.customer_note || CASE WHEN coalesce(it.public_code, '') <> '' THEN ' (' || it.public_code || ')' ELSE '' END;
        SELECT d.log INTO v_old_log FROM public.auto_campaign_details d WHERE d.id = it.detail_id FOR UPDATE;
        IF FOUND AND v_old_log IS DISTINCT FROM v_new_log THEN
          UPDATE public.auto_campaign_details d
             SET log = v_new_log,
                 data = coalesce(d.data, '{}'::jsonb) || jsonb_build_object('errorReview',
                   jsonb_build_object('originalLog', coalesce(d.data #>> '{errorReview,originalLog}', v_old_log), 'at', v_now))
           WHERE d.id = it.detail_id;
          UPDATE public.auto_campaign_input_data x SET note = v_new_log WHERE x.id = it.input_data_id AND x.note = v_old_log;
        END IF;
        UPDATE private.auto_engine_error_items
           SET note_applied_at = v_now, note_applied = v_new_log, original_log = coalesce(original_log, v_old_log)
         WHERE id = it.id;
      ELSE
        IF it.original_log IS NOT NULL AND it.note_applied IS NOT NULL THEN
          UPDATE public.auto_campaign_details d
             SET log = it.original_log, data = coalesce(d.data, '{}'::jsonb) - 'errorReview'
           WHERE d.id = it.detail_id AND d.log = it.note_applied;
          UPDATE public.auto_campaign_input_data x SET note = it.original_log WHERE x.id = it.input_data_id AND x.note = it.note_applied;
        END IF;
        UPDATE private.auto_engine_error_items SET note_applied_at = NULL, note_applied = NULL WHERE id = it.id;
      END IF;
      v_notes := v_notes + 1;
    EXCEPTION WHEN OTHERS THEN
      st.last_error := 'Ghi câu cho khách lỗi: ' || left(SQLERRM, 200);
      EXIT;
    END;
  END LOOP;

  -- 6. Chèn việc.
  v_enqueue := (v_cfg -> 'enqueue') = 'true'::jsonb;`],

  ['gọi /fire: cả ngoài khung chèn việc, gọi lại khi câu chưa ai nhận', `    -- 6c. Đánh thức tác vụ cloud: mỗi câu vừa chèn một lượt gọi (không có khoá chống gọi trùng nên chỉ gọi đúng một lần ở đây).
    IF v_fire AND jsonb_array_length(v_inserted) > 0 THEN
      FOR v_msg_id IN SELECT (x ->> 'messageId')::bigint FROM jsonb_array_elements(v_inserted) AS x LOOP
        BEGIN
          EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
            USING 'https://api.anthropic.com/v1/claude_code/routines/' || v_fire_routine || '/fire',
                  jsonb_build_object('text', 'messageId=' || v_msg_id),
                  jsonb_build_object('Authorization', 'Bearer ' || v_fire_token, 'anthropic-version', '2023-06-01',
                                     'anthropic-beta', 'experimental-cc-routine-2026-04-01', 'Content-Type', 'application/json');
          v_fired := v_fired + 1;
        EXCEPTION WHEN OTHERS THEN
          st.last_error := 'Gọi đánh thức tác vụ cloud lỗi: ' || left(SQLERRM, 200);
        END;
      END LOOP;
    END IF;
  END IF;

`, `  END IF;

  -- 6c (V588). Đánh thức tác vụ cloud khi có câu chưa ai nhận: gọi ngay lượt đầu sau khi chèn, rồi gọi lại sau fireRetryMinutes phút nếu câu
  -- vẫn chưa ai nhận (tối đa fireMaxPerMessage lượt mỗi câu). Chạy cả ngoài khung chèn việc. pg_net gửi sau khi giao dịch xong và không báo
  -- lỗi HTTP về đây, nên "đã gọi" chưa chắc là tác vụ đã chạy: vì vậy mới cần gọi lại.
  IF (v_cfg -> 'fire') = 'true'::jsonb THEN
    v_fire_routine := nullif(v_cfg ->> 'fireRoutineId', '');
    v_fire_token := NULL;
    IF v_fire_routine ~ '^trig_[A-Za-z0-9]+$' AND to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL
       AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
      EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1' INTO v_fire_token USING 'AKA_AGENT_ENGINE_ERROR_WATCH_FIRE_TOKEN';
    END IF;
    IF coalesce(v_fire_token, '') <> '' THEN
      v_fire_retry := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'fireRetryMinutes', 10)::integer, 4), 60);
      v_fire_max := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'fireMaxPerMessage', 3)::integer, 1), 5);
      FOR fr IN
        SELECT k.case_key, k.last_message_id, (k.fired_message_id IS DISTINCT FROM k.last_message_id) AS first_fire
          FROM private.auto_engine_error_cases k
          JOIN public.ai_message m ON m.id = k.last_message_id
         WHERE k.status = 'queued' AND m.status = 'chờ câu trả lời' AND m.deadline_at > v_now + interval '5 minutes'
           AND (k.fired_message_id IS DISTINCT FROM k.last_message_id
                OR (k.fire_count < v_fire_max AND k.fired_at <= v_now - make_interval(mins => v_fire_retry)))
         ORDER BY k.last_reported_at
         LIMIT 5
      LOOP
        BEGIN
          EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
            USING 'https://api.anthropic.com/v1/claude_code/routines/' || v_fire_routine || '/fire',
                  jsonb_build_object('text', 'messageId=' || fr.last_message_id),
                  jsonb_build_object('Authorization', 'Bearer ' || v_fire_token, 'anthropic-version', '2023-06-01',
                                     'anthropic-beta', 'experimental-cc-routine-2026-04-01', 'Content-Type', 'application/json');
          UPDATE private.auto_engine_error_cases
             SET fired_message_id = fr.last_message_id, fired_at = v_now, fire_count = CASE WHEN fr.first_fire THEN 1 ELSE fire_count + 1 END
           WHERE case_key = fr.case_key;
          v_fired := v_fired + 1;
          IF NOT fr.first_fire THEN v_refired := v_refired + 1; END IF;
        EXCEPTION WHEN OTHERS THEN
          st.last_error := 'Gọi đánh thức tác vụ cloud lỗi: ' || left(SQLERRM, 200);
        END;
      END LOOP;
    END IF;
  END IF;

`],

  ['kết quả tick', `    'fired', v_fired, 'tasksToday', st.tasks_today);`,
    `    'fired', v_fired, 'refired', v_refired, 'tasksToday', st.tasks_today, 'items', v_items + v_stale_items, 'notes', v_notes);`]
]

function patchedBody() {
  let body = tickBody()
  for (const [name, from, to] of PATCHES) {
    const count = body.split(from).length - 1
    if (count !== 1) throw new Error(`Chỗ vá "${name}": đoạn cũ có ${count} lần trong thân hàm (cần đúng 1)`)
    body = body.replace(from, () => to)
  }
  return body
}

const OLD_BODY = tickBody()
const NEW_BODY = patchedBody()
const NEW_BODY_MD5 = md5(NEW_BODY)
const TICK_HEAD = `FUNCTION public.aka_agent_engine_error_watch_tick_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '20s' AS $f$`

const REVIEW_FN = String.raw`CREATE FUNCTION public.aka_agent_engine_error_review(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET lock_timeout = '2s' SET statement_timeout = '8s' AS $f$
DECLARE
  v_staff bigint := nullif(private.aka_agent_staff_scope_for_request(), 0);
  v_admin boolean;
  v_payload jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  v_key text := nullif(v_payload ->> 'caseKey', '');
  v_decision text := v_payload ->> 'decision';
  v_limit integer := least(greatest(private.aka_agent_engine_error_num(v_payload ->> 'limit', 50)::integer, 1), 200);
  v_offset integer := least(greatest(private.aka_agent_engine_error_num(v_payload ->> 'offset', 0)::integer, 0), 100000);
  v_status text := nullif(v_payload ->> 'status', '');
  v_kind text := nullif(v_payload ->> 'kind', '');
  v_q text := nullif(btrim(coalesce(v_payload ->> 'q', '')), '');
  v_review boolean := coalesce((v_payload -> 'needsReview') = 'true'::jsonb, false);
  v_note text;
  v_now timestamptz := clock_timestamp();
  k private.auto_engine_error_cases%ROWTYPE;
  v_cfg jsonb;
  v_raw text;
  v_out jsonb;
BEGIN
  -- Chỉ phiên Desktop của nhân viên là admin akaBiz.
  IF v_staff IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'no_session'); END IF;
  SELECT s.is_admin_akabiz INTO v_admin FROM public.org_staff s WHERE s.id = v_staff AND s.is_active;
  IF NOT coalesce(v_admin, false) THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;

  IF p_action = 'list' THEN
    SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.error_watch' AND s.is_active;
    BEGIN v_cfg := v_raw::jsonb; EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
    SELECT jsonb_build_object(
      'ok', true,
      'settings', jsonb_build_object('enabled', coalesce((v_cfg -> 'enabled') = 'true'::jsonb, false), 'enqueue', coalesce((v_cfg -> 'enqueue') = 'true'::jsonb, false),
        'imageRequests', coalesce((v_cfg -> 'imageRequests') = 'true'::jsonb, false), 'fire', coalesce((v_cfg -> 'fire') = 'true'::jsonb, false)),
      'state', (SELECT jsonb_build_object('lastTickAt', st.last_tick_at, 'lastError', st.last_error, 'tasksToday', st.tasks_today)
                  FROM private.auto_engine_error_watch_state st WHERE st.id),
      'counts', (SELECT coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb) FROM (SELECT x.status, count(*) AS n FROM private.auto_engine_error_cases x GROUP BY x.status) c),
      'needsReview', (SELECT count(*) FROM private.auto_engine_error_cases x WHERE x.customer_note_status = 'proposed' OR x.code_proposal_status = 'proposed'),
      'total', (SELECT count(*) FROM private.auto_engine_error_cases x
                 WHERE (v_status IS NULL OR x.status = v_status) AND (v_kind IS NULL OR x.kind = v_kind)
                   AND (NOT v_review OR x.customer_note_status = 'proposed' OR x.code_proposal_status = 'proposed')
                   AND (v_q IS NULL OR x.pattern ILIKE '%' || v_q || '%' OR x.public_code ILIKE v_q || '%' OR x.error_code ILIKE '%' || v_q || '%')),
      'cases', coalesce((SELECT jsonb_agg(z.j ORDER BY z.rn) FROM (
        SELECT row_number() OVER (ORDER BY (x.customer_note_status = 'proposed' OR x.code_proposal_status = 'proposed') DESC, x.last_seen_at DESC, x.case_key) AS rn,
               jsonb_build_object('caseKey', x.case_key, 'kind', x.kind, 'errorCode', x.error_code, 'publicCode', x.public_code, 'actionCode', x.action_code,
                 'step', x.step, 'pattern', x.pattern, 'hits', x.hits, 'pauses', x.pauses, 'firstSeenAt', x.first_seen_at, 'lastSeenAt', x.last_seen_at,
                 'status', x.status, 'conclusion', x.conclusion, 'confidence', x.confidence, 'summary', x.summary, 'reportAt', x.report_at,
                 'customerNote', x.customer_note, 'customerNoteStatus', x.customer_note_status, 'codeProposalStatus', x.code_proposal_status,
                 'itemCount', it.n, 'organizationCount', it.orgs, 'campaignCount', it.campaigns) AS j
          FROM private.auto_engine_error_cases x
          CROSS JOIN LATERAL (SELECT count(*) AS n, count(DISTINCT i.organization_id) AS orgs, count(DISTINCT i.campaign_id) AS campaigns
                                FROM private.auto_engine_error_items i WHERE i.case_key = x.case_key) it
         WHERE (v_status IS NULL OR x.status = v_status) AND (v_kind IS NULL OR x.kind = v_kind)
           AND (NOT v_review OR x.customer_note_status = 'proposed' OR x.code_proposal_status = 'proposed')
           AND (v_q IS NULL OR x.pattern ILIKE '%' || v_q || '%' OR x.public_code ILIKE v_q || '%' OR x.error_code ILIKE '%' || v_q || '%')
         ORDER BY (x.customer_note_status = 'proposed' OR x.code_proposal_status = 'proposed') DESC, x.last_seen_at DESC, x.case_key
         LIMIT v_limit OFFSET v_offset) z), '[]'::jsonb))
      INTO v_out;
    RETURN v_out;
  END IF;

  IF v_key IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'case_required'); END IF;

  IF p_action = 'case' THEN
    SELECT * INTO k FROM private.auto_engine_error_cases x WHERE x.case_key = v_key;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'case_not_found'); END IF;
    RETURN jsonb_build_object('ok', true,
      'case', jsonb_build_object('caseKey', k.case_key, 'kind', k.kind, 'errorCode', k.error_code, 'publicCode', k.public_code, 'actionCode', k.action_code,
        'step', k.step, 'pattern', k.pattern, 'hits', k.hits, 'pauses', k.pauses, 'firstSeenAt', k.first_seen_at, 'lastSeenAt', k.last_seen_at,
        'status', k.status, 'conclusion', k.conclusion, 'confidence', k.confidence, 'summary', k.summary, 'reportAt', k.report_at, 'report', k.report,
        'answer', (SELECT m.answer FROM public.ai_message m WHERE m.id = k.report_message_id),
        'customerNote', k.customer_note, 'customerNoteStatus', k.customer_note_status, 'customerNoteAt', k.customer_note_at,
        'codeProposal', k.code_proposal, 'codeProposalStatus', k.code_proposal_status, 'codeProposalAt', k.code_proposal_at,
        'threadId', k.thread_id, 'note', k.note),
      'itemTotal', (SELECT count(*) FROM private.auto_engine_error_items i WHERE i.case_key = k.case_key),
      'items', coalesce((SELECT jsonb_agg(z.j ORDER BY z.rn) FROM (
        SELECT row_number() OVER (ORDER BY i.occurred_at DESC, i.id DESC) AS rn,
               jsonb_build_object('id', i.id, 'occurredAt', i.occurred_at, 'targetRunId', i.target_run_id, 'inputDataId', i.input_data_id,
                 'dataName', (SELECT left(d.name, 120) FROM public.auto_campaign_input_data d WHERE d.id = i.input_data_id),
                 'campaignId', i.campaign_id, 'campaignName', (SELECT c.name FROM public.auto_campaigns c WHERE c.id = i.campaign_id),
                 'accountId', i.account_id, 'accountName', (SELECT a.name FROM public.auto_accounts a WHERE a.id = i.account_id),
                 'staffId', i.staff_id, 'staffName', (SELECT s.username FROM public.org_staff s WHERE s.id = i.staff_id),
                 'organizationId', i.organization_id, 'organizationName', (SELECT o.name FROM public.org_organization o WHERE o.id = i.organization_id),
                 'publicCode', i.public_code, 'message', i.message, 'noteAppliedAt', i.note_applied_at) AS j
          FROM private.auto_engine_error_items i
         WHERE i.case_key = k.case_key
         ORDER BY i.occurred_at DESC, i.id DESC
         LIMIT v_limit OFFSET v_offset) z), '[]'::jsonb));
  END IF;

  SELECT * INTO k FROM private.auto_engine_error_cases x WHERE x.case_key = v_key FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'case_not_found'); END IF;

  IF p_action = 'note' THEN
    -- Duyệt / bỏ duyệt câu cho khách. Duyệt: câu (admin sửa được) sẽ được hàm tick ghi vào dòng lịch sử và ghi chú data của mọi lượt thuộc ca.
    IF v_decision = 'approve' THEN
      v_note := regexp_replace(btrim(coalesce(nullif(v_payload ->> 'note', ''), k.customer_note, '')), '\s+', ' ', 'g');
      IF char_length(v_note) < 5 OR char_length(v_note) > 200 THEN RETURN jsonb_build_object('ok', false, 'code', 'note_length'); END IF;
      UPDATE private.auto_engine_error_cases
         SET customer_note = v_note, customer_note_status = 'approved', customer_note_by = v_staff, customer_note_at = v_now, updated_at = v_now
       WHERE case_key = k.case_key;
      -- Câu đổi so với lần ghi trước thì ghi lại cho các lượt đã ghi.
      UPDATE private.auto_engine_error_items i SET note_applied_at = NULL
       WHERE i.case_key = k.case_key AND i.note_applied_at IS NOT NULL
         AND i.note_applied IS DISTINCT FROM v_note || CASE WHEN coalesce(i.public_code, '') <> '' THEN ' (' || i.public_code || ')' ELSE '' END;
    ELSIF v_decision = 'reject' THEN
      UPDATE private.auto_engine_error_cases
         SET customer_note_status = 'rejected', customer_note_by = v_staff, customer_note_at = v_now, updated_at = v_now
       WHERE case_key = k.case_key;
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'bad_decision');
    END IF;
  ELSIF p_action = 'code' THEN
    -- Duyệt / bỏ đề xuất mã lỗi mới. Chỉ ghi quyết định; thêm mã vào bảng mã lỗi vẫn làm bằng migration sau khi duyệt.
    IF k.code_proposal IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'no_proposal'); END IF;
    IF v_decision NOT IN ('approve', 'reject') THEN RETURN jsonb_build_object('ok', false, 'code', 'bad_decision'); END IF;
    UPDATE private.auto_engine_error_cases
       SET code_proposal_status = CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'rejected' END, code_proposal_by = v_staff, code_proposal_at = v_now,
           updated_at = v_now
     WHERE case_key = k.case_key AND code_proposal_status <> 'applied';
  ELSIF p_action = 'mark' THEN
    -- known: ca đã có kết luận, không báo nữa. new: mở lại để báo.
    IF v_payload ->> 'status' NOT IN ('known', 'new') OR v_payload ->> 'status' IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'bad_status'); END IF;
    IF k.status = 'queued' THEN RETURN jsonb_build_object('ok', false, 'code', 'case_queued'); END IF;
    UPDATE private.auto_engine_error_cases SET status = v_payload ->> 'status', updated_at = v_now WHERE case_key = k.case_key;
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'bad_action');
  END IF;

  SELECT * INTO k FROM private.auto_engine_error_cases x WHERE x.case_key = v_key;
  RETURN jsonb_build_object('ok', true, 'case', jsonb_build_object('caseKey', k.case_key, 'status', k.status, 'customerNote', k.customer_note,
    'customerNoteStatus', k.customer_note_status, 'customerNoteAt', k.customer_note_at, 'codeProposalStatus', k.code_proposal_status,
    'codeProposalAt', k.code_proposal_at));
END $f$;`

const MIGRATION = `-- V588: đợt 2 của bộ kiểm lỗi chiến dịch Facebook (docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md mục 12). SINH BẰNG scripts/build-v588-sql.cjs, không sửa tay.
--   * Bảng private.auto_engine_error_items: mỗi kết quả lỗi thuộc một ca là một dòng (khách, tài khoản, chiến dịch, data, câu lỗi), giữ 30 ngày.
--   * Sổ ca thêm kết luận của Claude (conclusion, summary, report), câu cho khách và mã lỗi mới do Claude đề xuất, cả hai ở trạng thái chờ duyệt.
--   * Hàm tick: ghi từng lượt lỗi, chép kết luận về sổ ca khi báo cáo xong, ghi câu cho khách ĐÃ ĐƯỢC DUYỆT vào dòng lịch sử
--     (auto_campaign_details.log) và ghi chú data (auto_campaign_input_data.note) của các lượt thuộc ca; bỏ duyệt thì trả lại câu cũ.
--   * Hàm public.aka_agent_engine_error_review(action, payload) cho tab "Lỗi không xác định" của Desktop, chỉ admin akaBiz: xem ca, xem lượt,
--     duyệt câu cho khách, duyệt đề xuất mã lỗi (chỉ ghi quyết định; thêm mã vào bảng mã lỗi vẫn bằng migration), đánh dấu ca đã biết.
-- Không tự ghi gì cho khách và không tự thêm mã lỗi: mọi thứ Claude đề xuất đều chờ duyệt (anh chốt 19/11/2026).
-- Có DDL (bảng private, hàm public) nên PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v588_engine_error_review.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v588_%') THEN
      RAISE EXCEPTION 'V588 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('private.auto_engine_error_cases') IS NULL OR to_regprocedure('public.aka_agent_engine_error_watch_tick_v1()') IS NULL THEN
    RAISE EXCEPTION 'V588: thiếu V574 (sổ ca lỗi, hàm tick)';
  END IF;
  IF to_regclass('private.auto_engine_error_items') IS NOT NULL OR to_regprocedure('public.aka_agent_engine_error_review(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'V588 đã chạy: đã có bảng lỗi theo lượt hoặc hàm review';
  END IF;
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN RAISE EXCEPTION 'V588: thiếu private.aka_agent_staff_scope_for_request()'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_staff' AND column_name = 'is_admin_akabiz') THEN
    RAISE EXCEPTION 'V588: thiếu org_staff.is_admin_akabiz';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_message' AND column_name = 'answer_json') THEN
    RAISE EXCEPTION 'V588: thiếu ai_message.answer_json';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_engine_outcomes' AND column_name = 'detail_id') THEN
    RAISE EXCEPTION 'V588: thiếu auto_engine_outcomes.detail_id';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V574_BODY_MD5}' THEN
    RAISE EXCEPTION 'V588: thân hàm tick đang chạy (md5 %) không phải bản V574; đọc lại thân production rồi sinh lại', v_md5;
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Sổ ca: kết luận, câu cho khách, đề xuất mã lỗi
-- ---------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE private.auto_engine_error_cases
  ADD COLUMN conclusion text,
  ADD COLUMN confidence text,
  ADD COLUMN summary text,
  ADD COLUMN report jsonb,
  ADD COLUMN report_message_id bigint,
  ADD COLUMN report_at timestamptz,
  ADD COLUMN customer_note text CHECK (customer_note IS NULL OR char_length(customer_note) <= 200),
  ADD COLUMN customer_note_status text NOT NULL DEFAULT 'none' CHECK (customer_note_status IN ('none', 'proposed', 'approved', 'rejected')),
  ADD COLUMN customer_note_by bigint,
  ADD COLUMN customer_note_at timestamptz,
  ADD COLUMN code_proposal jsonb,
  ADD COLUMN code_proposal_status text NOT NULL DEFAULT 'none' CHECK (code_proposal_status IN ('none', 'proposed', 'approved', 'rejected', 'applied')),
  ADD COLUMN code_proposal_by bigint,
  ADD COLUMN code_proposal_at timestamptz,
  ADD COLUMN fired_message_id bigint,
  ADD COLUMN fired_at timestamptz,
  ADD COLUMN fire_count integer NOT NULL DEFAULT 0 CHECK (fire_count >= 0);
COMMENT ON COLUMN private.auto_engine_error_cases.customer_note IS
  'V588: câu cho khách của ca. proposed = Claude đề xuất, chưa ghi gì cho khách; approved = admin akaBiz đã duyệt, hàm tick ghi vào dòng lịch sử và ghi chú data của các lượt thuộc ca.';
COMMENT ON COLUMN private.auto_engine_error_cases.code_proposal IS
  'V588: mã lỗi mới do Claude đề xuất (ten_loi, cau_cho_khach, buoc_tiep_theo, cach_xu_ly, dau_hieu). Duyệt chỉ ghi quyết định; thêm mã vào bảng mã lỗi bằng migration (khi xong đặt status = applied).';

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Lỗi theo từng lượt
-- ---------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE private.auto_engine_error_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_key text NOT NULL REFERENCES private.auto_engine_error_cases (case_key) ON DELETE CASCADE,
  result_key text NOT NULL UNIQUE CHECK (char_length(result_key) BETWEEN 1 AND 300),
  target_run_id bigint,
  input_data_id bigint,
  campaign_id bigint,
  account_id bigint,
  staff_id bigint,
  organization_id bigint,
  detail_id bigint,
  error_code text,
  public_code text,
  action_code text,
  step text,
  message text,
  occurred_at timestamptz NOT NULL,
  original_log text,
  note_applied text,
  note_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX auto_engine_error_items_case_v588 ON private.auto_engine_error_items (case_key, occurred_at DESC, id DESC);
CREATE INDEX auto_engine_error_items_time_v588 ON private.auto_engine_error_items (occurred_at);
COMMENT ON TABLE private.auto_engine_error_items IS
  'V588: mỗi kết quả lỗi của engine v2 thuộc một ca trong sổ ca lỗi là một dòng (result_key của auto_engine_outcomes; lượt bỏ dở là stale:<mã lượt>). Chỉ giữ mã (tổ chức, nhân viên, tài khoản, chiến dịch, data, dòng lịch sử) và câu lỗi; tên đọc lúc xem. original_log / note_applied: câu cũ và câu cho khách đã ghi vào dòng lịch sử. Giữ itemRetentionDays ngày (mặc định 30).';

ALTER TABLE private.auto_engine_error_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_engine_error_items FROM PUBLIC;
DO $grants_tables$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON TABLE private.auto_engine_error_items FROM %I', r); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT ALL ON TABLE private.auto_engine_error_items TO service_role; END IF;
END $grants_tables$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Hàm tick: thân V574 + các chỗ vá (md5 thân mới ${NEW_BODY_MD5})
-- ---------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE ${TICK_HEAD}${NEW_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  'V574 + V588: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca và lỗi theo lượt), enqueue (chèn câu vào Hỏi đáp AI), imageRequests (xin ảnh lỗi), fire (đánh thức tác vụ cloud). V588: chép kết luận về sổ ca, ghi câu cho khách đã duyệt.';

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Hàm cho tab "Lỗi không xác định" của Desktop (chỉ admin akaBiz)
-- ---------------------------------------------------------------------------------------------------------------------------------------
${REVIEW_FN}
COMMENT ON FUNCTION public.aka_agent_engine_error_review(text, jsonb) IS
  'V588: tab "Lỗi không xác định" của Desktop, chỉ nhân viên admin akaBiz (lấy từ phiên). action: list | case | note (duyệt / bỏ duyệt câu cho khách) | code (duyệt / bỏ đề xuất mã lỗi, chỉ ghi quyết định) | mark (known / new). Trả {ok, …} hoặc {ok:false, code}.';

REVOKE ALL ON FUNCTION public.aka_agent_engine_error_review(text, jsonb) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_error_review(text, jsonb) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_engine_error_review(text, jsonb) TO aka_agent_desktop;
  END IF;
END $grants$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Dữ liệu sẵn có: kết luận của các ca đã có báo cáo, lượt lỗi của các ca trong sổ (tới mốc hàm tick đã đọc), khuôn đầu ra của agent
-- ---------------------------------------------------------------------------------------------------------------------------------------
UPDATE private.auto_engine_error_cases k
   SET report = m.answer_json, report_message_id = m.id, report_at = coalesce(m.answered_at, m.created_at),
       summary = left(m.answer_json ->> 'tom_tat', 1000),
       conclusion = nullif(left(m.answer_json ->> 'ket_luan', 40), ''),
       confidence = nullif(left(m.answer_json ->> 'do_chac', 20), '')
  FROM public.ai_message m
 WHERE k.thread_id = m.thread_id AND m.status = 'hoàn thành' AND jsonb_typeof(m.answer_json) = 'object'
   AND m.id = (SELECT max(m2.id) FROM public.ai_message m2 WHERE m2.thread_id = k.thread_id AND m2.status = 'hoàn thành' AND jsonb_typeof(m2.answer_json) = 'object');

INSERT INTO private.auto_engine_error_items
  (case_key, result_key, target_run_id, input_data_id, campaign_id, account_id, staff_id, organization_id, detail_id, error_code, public_code, action_code,
   step, message, occurred_at)
SELECT k.case_key, o.result_key, o.target_run_id, o.input_data_id, o.campaign_id, o.account_id, r.staff_id, r.organization_id, o.detail_id, o.error_code,
       o.decision -> 'result' ->> 'publicCode', coalesce(o.action_code, ''), regexp_replace(split_part(o.result_key, ':', 3), '#[0-9]+$', ''),
       left(o.signal ->> 'message', 500), o.created_at
  FROM public.auto_engine_outcomes o
  JOIN public.auto_campaigns c ON c.id = o.campaign_id
  JOIN public.auto_campaign_actions a ON a.id = c.action_id
  JOIN private.auto_engine_error_cases k
    ON k.case_key = left(o.error_code || '|' || coalesce(o.action_code, '') || '|' || regexp_replace(split_part(o.result_key, ':', 3), '#[0-9]+$', '')
                         || '|' || private.aka_agent_engine_error_pattern(o.signal ->> 'message'), 700)
  LEFT JOIN public.auto_engine_target_runs r ON r.id = o.target_run_id
 WHERE o.created_at >= (SELECT coalesce(min(x.first_seen_at), now()) FROM private.auto_engine_error_cases x) - interval '1 minute'
   AND o.created_at <= coalesce((SELECT st.cursor_at FROM private.auto_engine_error_watch_state st WHERE st.id), now())
   AND a.flatform_type = 'facebook' AND NOT o.ok AND o.error_code IS NOT NULL
ON CONFLICT (result_key) DO NOTHING;

UPDATE public.ai_project p
   SET output_schema = jsonb_set(jsonb_set(p.output_schema, '{properties,cau_cho_khach}', '{"type": "string", "maxLength": 200}'::jsonb),
         '{properties,de_xuat_ma_loi}',
         '{"type": "object", "properties": {"ten_loi": {"type": "string"}, "cau_cho_khach": {"type": "string"}, "buoc_tiep_theo": {"type": "string"}, "cach_xu_ly": {"type": "string"}, "dau_hieu": {"type": "string"}}}'::jsonb),
       version = p.version + 1, updated_at = now()
 WHERE p.code = 'kiem-loi-chien-dich-facebook' AND jsonb_typeof(p.output_schema -> 'properties') = 'object';

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN RAISE EXCEPTION 'V588: thân hàm tick sau khi thay có md5 % (chờ ${NEW_BODY_MD5})', v_md5; END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'V588: hàm tick mất SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aka_agent_engine_error_review(text, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_engine_error_review(text, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_error_review(text, jsonb)', 'EXECUTE')
     OR has_table_privilege('aka_agent_desktop', 'private.auto_engine_error_items', 'SELECT')
     OR has_table_privilege('anon', 'private.auto_engine_error_items', 'SELECT') THEN
    RAISE EXCEPTION 'V588: quyền sau khi apply không đúng';
  END IF;
END $post$;

COMMIT;
`

const ROLLBACK = `-- Gỡ V588 (đợt 2 của bộ kiểm lỗi chiến dịch Facebook). SINH BẰNG scripts/build-v588-sql.cjs, không sửa tay.
-- Trả hàm tick về thân V574, xoá hàm review, bảng lỗi theo lượt và các cột kết luận / câu cho khách / đề xuất mã lỗi của sổ ca.
-- Câu cho khách đã ghi vào dòng lịch sử và ghi chú data KHÔNG tự trả lại: muốn trả thì bỏ duyệt từng ca (action note, decision reject) và chờ
-- hàm tick trả xong (note_applied_at của mọi lượt về NULL) rồi mới gỡ; bản gỡ dừng nếu còn lượt đang mang câu đã ghi, trừ khi đặt
-- SET LOCAL aka.v588_rollback_keep_notes = 'on' trước khi chạy.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text; v_applied bigint;
BEGIN
  IF to_regclass('private.auto_engine_error_items') IS NULL OR to_regprocedure('public.aka_agent_engine_error_review(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Gỡ V588: chưa thấy bảng lỗi theo lượt hoặc hàm review, không có gì để gỡ';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW_BODY_MD5}' THEN
    RAISE EXCEPTION 'Gỡ V588: thân hàm tick đang chạy (md5 %) không phải bản V588; có migration sau đã sửa hàm, gỡ bản đó trước', v_md5;
  END IF;
  SELECT count(*) INTO v_applied FROM private.auto_engine_error_items i WHERE i.note_applied_at IS NOT NULL;
  IF v_applied > 0 AND coalesce(current_setting('aka.v588_rollback_keep_notes', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Gỡ V588: còn % lượt đang mang câu cho khách đã ghi; bỏ duyệt các ca đó và chờ hàm tick trả lại câu cũ, hoặc đặt aka.v588_rollback_keep_notes = on để giữ nguyên', v_applied;
  END IF;
END $pre$;

CREATE OR REPLACE ${TICK_HEAD}${OLD_BODY}$f$;
COMMENT ON FUNCTION public.aka_agent_engine_error_watch_tick_v1() IS
  'V574: bộ tạo việc kiểm lỗi chiến dịch Facebook cho Claude Code (job pg_cron aka-agent-engine-error-watch, 2 phút). Thiết lập engine.error_watch: enabled (đọc lỗi, ghi sổ ca), enqueue (chèn câu vào Hỏi đáp AI), imageRequests (xin ảnh lỗi), fire (đánh thức tác vụ cloud).';

DROP FUNCTION public.aka_agent_engine_error_review(text, jsonb);
DROP TABLE private.auto_engine_error_items;
ALTER TABLE private.auto_engine_error_cases
  DROP COLUMN conclusion, DROP COLUMN confidence, DROP COLUMN summary, DROP COLUMN report, DROP COLUMN report_message_id, DROP COLUMN report_at,
  DROP COLUMN customer_note, DROP COLUMN customer_note_status, DROP COLUMN customer_note_by, DROP COLUMN customer_note_at,
  DROP COLUMN code_proposal, DROP COLUMN code_proposal_status, DROP COLUMN code_proposal_by, DROP COLUMN code_proposal_at,
  DROP COLUMN fired_message_id, DROP COLUMN fired_at, DROP COLUMN fire_count;

UPDATE public.ai_project p
   SET output_schema = p.output_schema #- '{properties,cau_cho_khach}' #- '{properties,de_xuat_ma_loi}', version = p.version + 1, updated_at = now()
 WHERE p.code = 'kiem-loi-chien-dich-facebook' AND jsonb_typeof(p.output_schema -> 'properties') = 'object';

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${V574_BODY_MD5}' THEN RAISE EXCEPTION 'Gỡ V588: thân hàm tick sau khi gỡ có md5 % (chờ ${V574_BODY_MD5})', v_md5; END IF;
  IF to_regclass('private.auto_engine_error_items') IS NOT NULL OR to_regprocedure('public.aka_agent_engine_error_review(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Gỡ V588: còn sót đối tượng';
  END IF;
END $post$;

COMMIT;
`

fs.writeFileSync(path.join(MIGRATIONS, 'migration_v588_engine_error_review.sql'), MIGRATION)
fs.writeFileSync(path.join(MIGRATIONS, 'rollback_v588_engine_error_review.sql'), ROLLBACK)
console.log(`migration_v588_engine_error_review.sql  md5 ${md5(MIGRATION)}  (${MIGRATION.length} ký tự)`)
console.log(`rollback_v588_engine_error_review.sql   md5 ${md5(ROLLBACK)}`)
console.log(`thân hàm tick: V574 ${V574_BODY_MD5} → V588 ${NEW_BODY_MD5}`)
