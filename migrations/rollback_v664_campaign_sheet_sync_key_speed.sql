-- Gỡ V664: trả 3 hàm đồng bộ Google Sheet của chiến dịch về nguyên văn V662. Sinh bằng node scripts/build-v664-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE v_tag text := 'rollback v664';
BEGIN

END
$preflight$;

CREATE OR REPLACE FUNCTION private.aka_agent_campaign_sheet_key(p_field text, p_action_id text, p_phone text, p_uid text, p_email text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $fn$
  SELECT CASE p_field
    WHEN 'phone' THEN NULLIF(public.aka_agent_internal_normalize_phone(p_phone), '')
    WHEN 'email' THEN (SELECT e FROM (SELECT lower(private.aka_agent_campaign_sheet_trim(p_email)) AS e) z
      WHERE length(e) <= 254
        AND e ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
        AND split_part(e, '@', 1) !~ '(^\.|\.$|\.\.)' AND length(split_part(e, '@', 2)) <= 253)
    ELSE (SELECT CASE WHEN length(v) <= 2048 THEN NULLIF(v, '') END FROM (SELECT CASE
      WHEN p_action_id = 'facebook_find_data_search' THEN lower(private.aka_agent_campaign_sheet_space(private.aka_agent_campaign_sheet_trim(p_uid), ' '))
      WHEN p_action_id = 'zalo_message_group_member' THEN (SELECT u FROM (SELECT private.aka_agent_campaign_sheet_space(p_uid, '') AS u) z WHERE u ~ '^[0-9]{5,30}$')
      WHEN p_action_id = 'zalo_join_group_link' THEN (SELECT 'https://zalo.me/g/' || m[1]
        FROM regexp_match(private.aka_agent_campaign_sheet_trim(p_uid), '^(?:https?://)?(?:[^/?#\s]*\.)?(?:zalo\.me/g|zaloapp\.com/qr/g)/([^/?#\s]+)', 'i') m)
      ELSE regexp_replace(private.aka_agent_campaign_sheet_space(p_uid, ''), '/+$', '') END AS v) x)
  END;
$fn$;

CREATE OR REPLACE FUNCTION private.aka_agent_campaign_sheet_unmatched_keys(
  p_field text, p_action_id text, p_values jsonb, p_campaign_ids bigint[], p_exclude text[]
) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  WITH incoming AS MATERIALIZED (
    SELECT DISTINCT private.aka_agent_campaign_sheet_key(p_field, p_action_id, x, x, x) AS key
      FROM jsonb_array_elements_text(COALESCE(p_values, '[]'::jsonb)) x
  ), existing AS MATERIALIZED (
    SELECT DISTINCT k.key FROM public.auto_campaign_input_data d
     CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(p_field, p_action_id, d.phone, d.uid, d.email) AS key) k
     WHERE d.campaign_id = ANY (COALESCE(p_campaign_ids, '{}')) AND k.key IS NOT NULL
  )
  SELECT COALESCE(array_agg(i.key ORDER BY i.key), '{}') FROM incoming i
   WHERE i.key IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM existing e WHERE e.key = i.key)
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_exclude, '{}')) s(k) WHERE s.k = i.key);
$fn$;

CREATE OR REPLACE FUNCTION public.aka_agent_campaign_sheet_finish(p_token uuid, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '60s' AS $fn$
DECLARE
  v_log public.auto_campaign_sheet_sync_logs%ROWTYPE; v_sync public.auto_campaign_sheet_syncs%ROWTYPE;
  v_field text; v_rows jsonb; v_active bigint[]; v_all bigint[]; v_id bigint; v_n integer; v_cursor integer;
  v_added integer := 0; v_dups integer := 0; v_invalid integer; v_read integer; v_per jsonb := '[]'::jsonb;
  v_result jsonb; v_error_code text; v_error_message text; v_permanent boolean; v_campaigns jsonb;
  v_unique integer; c record; v_line text; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_log FROM public.auto_campaign_sheet_sync_logs WHERE run_token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('stale', true); END IF;
  IF v_log.status IN ('success', 'error') AND v_log.result IS NOT NULL THEN RETURN v_log.result; END IF;
  SELECT * INTO v_sync FROM public.auto_campaign_sheet_syncs WHERE id = v_log.sync_id FOR UPDATE;
  IF NOT FOUND OR v_sync.lease_token IS DISTINCT FROM p_token OR v_log.status <> 'running' THEN
    RETURN jsonb_build_object('stale', true);
  END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'sheet_sync_invalid'; END IF;

  -- Lỗi đọc Sheet.
  IF p_result ? 'error' THEN
    v_error_code := left(COALESCE(p_result->'error'->>'code', 'sheet_read_failed'), 100);
    v_error_message := left(COALESCE(p_result->'error'->>'message', 'Không thể đọc Google Sheet.'), 1000);
    v_permanent := COALESCE(jsonb_typeof(p_result->'error'->'permanent') = 'boolean' AND (p_result->'error'->>'permanent')::boolean, false);
    v_result := jsonb_build_object('ok', false, 'errorCode', v_error_code, 'permanent', v_permanent);
    UPDATE public.auto_campaign_sheet_sync_logs SET status = 'error', finished_at = v_now, error_code = v_error_code,
      error_message = v_error_message, result = v_result WHERE id = v_log.id;
    UPDATE public.auto_campaign_sheet_syncs SET
      status = CASE WHEN v_permanent THEN 'error' ELSE 'retry' END, is_enabled = NOT v_permanent,
      last_error_code = v_error_code, last_error_message = v_error_message,
      stopped_reason = CASE WHEN v_permanent THEN v_error_code ELSE NULL END,
      stopped_at = CASE WHEN v_permanent THEN v_now ELSE NULL END,
      retry_count = retry_count + 1,
      next_run_at = v_now + make_interval(mins => CASE retry_count WHEN 0 THEN 5 WHEN 1 THEN 15 ELSE 60 END),
      lease_token = NULL, lease_until = NULL, updated_at = v_now
     WHERE id = v_sync.id;
    RETURN v_result;
  END IF;

  v_rows := p_result->'rows';
  IF jsonb_typeof(v_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(v_rows) > 20000 OR octet_length(v_rows::text) > 20971520
    OR COALESCE(p_result->>'rowCount', '') !~ '^[0-9]{1,6}$' OR COALESCE(p_result->>'invalid', '') !~ '^[0-9]{1,6}$'
    OR COALESCE(p_result->>'duplicates', '0') !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'sheet_sync_invalid';
  END IF;
  v_active := v_sync.campaign_ids;
  IF cardinality(v_active) = 0 THEN RETURN jsonb_build_object('stale', true); END IF;
  v_field := v_sync.config->>'targetField';
  v_read := (p_result->>'rowCount')::integer;
  v_invalid := (p_result->>'invalid')::integer;
  v_dups := COALESCE((p_result->>'duplicates')::integer, 0);
  SELECT array_agg((e->>'campaignId')::bigint) INTO v_all FROM jsonb_array_elements(v_sync.campaigns) e;

  -- Khoá chiến dịch đích theo thứ tự id (cùng khoá với đường nhận / thêm data của bộ chạy cũ).
  FOREACH v_id IN ARRAY v_active LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_id::text, 0));
  END LOOP;

  CREATE TEMP TABLE IF NOT EXISTS campaign_sheet_plan (
    ord integer, key text, name text, phone text, uid text, email text, info1 text, info2 text, info3 text,
    info4 text, info5 text, phone_carrier text, campaign_id bigint) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS campaign_sheet_existing (campaign_id bigint, key text) ON COMMIT DROP;
  TRUNCATE campaign_sheet_plan, campaign_sheet_existing;

  -- Dòng gửi lên: tính khoá ở DB (không tin khoá của bên gọi), mỗi khoá giữ dòng đầu.
  INSERT INTO campaign_sheet_plan (ord, key, name, phone, uid, email, info1, info2, info3, info4, info5, phone_carrier)
  SELECT DISTINCT ON (r.key) r.ord, r.key, r.name, r.phone, r.uid, r.email, r.info1, r.info2, r.info3, r.info4, r.info5, r.carrier
    FROM (
      SELECT o::integer AS ord,
             private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, x->>'phone', x->>'uid', x->>'email') AS key,
             NULLIF(left(btrim(COALESCE(x->>'name', '')), 500), '') AS name,
             CASE WHEN v_field = 'phone' THEN public.aka_agent_internal_normalize_phone(x->>'phone') END AS phone,
             CASE WHEN v_field = 'uid' THEN btrim(x->>'uid') END AS uid,
             CASE WHEN v_field = 'email' THEN lower(btrim(x->>'email')) END AS email,
             NULLIF(left(COALESCE(x->>'info1', ''), 4000), '') AS info1, NULLIF(left(COALESCE(x->>'info2', ''), 4000), '') AS info2,
             NULLIF(left(COALESCE(x->>'info3', ''), 4000), '') AS info3, NULLIF(left(COALESCE(x->>'info4', ''), 4000), '') AS info4,
             NULLIF(left(COALESCE(x->>'info5', ''), 4000), '') AS info5,
             CASE WHEN v_field = 'phone' THEN NULLIF(left(COALESCE(x->>'phoneCarrier', ''), 40), '') END AS carrier
        FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(x, o)
       WHERE jsonb_typeof(x) = 'object'
    ) r
   WHERE r.key IS NOT NULL
   ORDER BY r.key, r.ord;
  GET DIAGNOSTICS v_unique = ROW_COUNT;
  v_invalid := v_invalid + (SELECT count(*) FROM jsonb_array_elements(v_rows) x
    WHERE jsonb_typeof(x) <> 'object'
       OR private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, x->>'phone', x->>'uid', x->>'email') IS NULL)::integer;
  v_dups := v_dups + GREATEST(jsonb_array_length(v_rows) - v_unique - (SELECT count(*) FROM jsonb_array_elements(v_rows) x
    WHERE jsonb_typeof(x) <> 'object'
       OR private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, x->>'phone', x->>'uid', x->>'email') IS NULL)::integer, 0);

  -- Mốc ban đầu: dòng Upload đã đọc mà không thêm.
  DELETE FROM campaign_sheet_plan p WHERE p.key IN (SELECT unnest(v_sync.skipped_keys));
  -- Khoá data đang có của mọi chiến dịch từng nhận từ nguồn (cả dòng đã xoá mềm), tính một lần.
  INSERT INTO campaign_sheet_existing (campaign_id, key)
  SELECT DISTINCT d.campaign_id, k.key FROM public.auto_campaign_input_data d
   CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key(v_field, v_sync.action_id, d.phone, d.uid, d.email) AS key) k
   WHERE d.campaign_id = ANY (v_all) AND k.key IS NOT NULL;

  v_cursor := v_sync.split_cursor;
  IF v_sync.split_mode = 'split' THEN
    -- Bỏ dòng đã có ở bất kỳ chiến dịch nào, rồi chia lần lượt cho các chiến dịch đang nhận.
    DELETE FROM campaign_sheet_plan p USING (SELECT DISTINCT key FROM campaign_sheet_existing) e WHERE e.key = p.key;
    v_n := cardinality(v_active);
    UPDATE campaign_sheet_plan p SET campaign_id = v_active[((n.rn + v_cursor) % v_n) + 1]
      FROM (SELECT ord, (row_number() OVER (ORDER BY ord) - 1)::integer AS rn FROM campaign_sheet_plan) n
     WHERE n.ord = p.ord;
    v_cursor := (v_cursor + (SELECT count(*) FROM campaign_sheet_plan)::integer) % v_n;
  ELSE
    -- Mỗi chiến dịch đang nhận đủ dòng mới (bỏ dòng chính chiến dịch đó đã có).
    INSERT INTO campaign_sheet_plan (ord, key, name, phone, uid, email, info1, info2, info3, info4, info5, phone_carrier, campaign_id)
    SELECT p.ord, p.key, p.name, p.phone, p.uid, p.email, p.info1, p.info2, p.info3, p.info4, p.info5, p.phone_carrier, a.x
      FROM campaign_sheet_plan p CROSS JOIN unnest(v_active) a(x)
     WHERE p.campaign_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM campaign_sheet_existing e WHERE e.campaign_id = a.x AND e.key = p.key);
    DELETE FROM campaign_sheet_plan WHERE campaign_id IS NULL;
  END IF;
  v_dups := v_dups + GREATEST(v_unique - (SELECT count(DISTINCT key) FROM campaign_sheet_plan)::integer, 0);

  INSERT INTO public.auto_campaign_input_data (campaign_id, name, phone, uid, email, info1, info2, info3, info4, info5,
    phone_carrier, status)
  SELECT p.campaign_id, p.name, p.phone, p.uid, p.email, p.info1, p.info2, p.info3, p.info4, p.info5, p.phone_carrier, 'chờ xử lý'
    FROM campaign_sheet_plan p ORDER BY p.campaign_id, p.ord;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  FOR c IN SELECT p.campaign_id AS id, count(*)::integer AS n FROM campaign_sheet_plan p GROUP BY p.campaign_id ORDER BY p.campaign_id
  LOOP
    UPDATE public.auto_campaigns x SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = v_now
     WHERE x.id = c.id AND x.status = 'hoàn thành' AND NOT COALESCE(x.is_delete, false);
    v_per := v_per || jsonb_build_object('campaignId', c.id, 'added', c.n, 'reopened', FOUND);
    v_line := to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY')
      || ' - 📥 Đồng bộ Google Sheet: đã thêm ' || c.n || ' data mới';
    PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:' || c.id::text, 0));
    INSERT INTO public.auto_campaign_logs (campaign_id, log) VALUES (c.id, v_line);
  END LOOP;

  SELECT jsonb_agg(CASE WHEN pc.added IS NOT NULL
           THEN e || jsonb_build_object('added', COALESCE((e->>'added')::bigint, 0) + pc.added) ELSE e END ORDER BY o)
    INTO v_campaigns
    FROM jsonb_array_elements(v_sync.campaigns) WITH ORDINALITY AS t(e, o)
    LEFT JOIN LATERAL (SELECT (x->>'added')::bigint AS added FROM jsonb_array_elements(v_per) x
                        WHERE x->>'campaignId' = e->>'campaignId' LIMIT 1) pc ON true;
  v_result := jsonb_build_object('ok', true, 'added', v_added, 'rowCount', v_read, 'invalid', v_invalid,
    'duplicates', v_dups, 'perCampaign', v_per);
  UPDATE public.auto_campaign_sheet_sync_logs SET status = 'success', finished_at = clock_timestamp(), rows_read = v_read,
    added = v_added, duplicates = v_dups, invalid = v_invalid, per_campaign = v_per, result = v_result WHERE id = v_log.id;
  UPDATE public.auto_campaign_sheet_syncs SET status = 'success', campaigns = v_campaigns, split_cursor = v_cursor,
    last_success_at = v_now, last_added = v_added, total_added = total_added + v_added, retry_count = 0,
    last_error_code = NULL, last_error_message = NULL,
    next_run_at = v_now + make_interval(hours => every_hours),
    lease_token = NULL, lease_until = NULL, updated_at = clock_timestamp()
   WHERE id = v_sync.id;
  RETURN v_result;
END
$fn$;

-- Các hàm CREATE OR REPLACE giữ nguyên quyền cũ; khoá lại để chắc chắn.
REVOKE ALL ON FUNCTION private.aka_agent_campaign_sheet_key(text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_campaign_sheet_unmatched_keys(text,text,jsonb,bigint[],text[]) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION public.aka_agent_campaign_sheet_finish(uuid,jsonb) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_sheet_finish(uuid,jsonb) TO service_role;

DO $postflight$
DECLARE v_tag text := 'rollback v664';
BEGIN
  IF has_function_privilege('anon', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'private.aka_agent_campaign_sheet_key(text,text,text,text,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'private.aka_agent_campaign_sheet_key(text,text,text,text,text)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'private.aka_agent_campaign_sheet_unmatched_keys(text,text,jsonb,bigint[],text[])', 'EXECUTE')
  THEN RAISE EXCEPTION '%: quyền hàm sai', v_tag; END IF;
END
$postflight$;

COMMIT;
