-- Gỡ V614: trả khoá so sánh, khoá thô và hàm đẩy về đúng bản V610, xoá hàm mảnh, tính lại khoá sổ đẩy theo khoá V610.
-- Dòng sổ migration giữ lại.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION private.aka_agent_find_data_match_key(p_kind text, p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v text := lower(btrim(COALESCE(p_value, '')));
  v_group text;
  v_base text;
  v_query text;
  v_kept text;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF p_kind = 'phone' THEN
    RETURN NULLIF(public.normalize_phone(v), '');
  END IF;
  IF p_kind = 'facebook_group' THEN
    v_group := substring(v FROM 'groups/([^/?#&[:space:]]+)');
    IF v_group IS NOT NULL THEN RETURN 'facebook.com/groups/' || v_group; END IF;
    RETURN NULLIF(rtrim(v, '/'), '');
  END IF;
  IF p_kind = 'zalo_group_link' THEN
    v := regexp_replace(split_part(v, '#', 1), '^https?://', '');
    v := regexp_replace(v, '^www\.', '');
    RETURN NULLIF(rtrim(v, '/'), '');
  END IF;
  IF p_kind = 'post_link' THEN
    v := regexp_replace(split_part(v, '#', 1), '^https?://', '');
    v := regexp_replace(v, '^((m|mbasic|mobile|web|www)\.)?facebook\.com', 'www.facebook.com');
    v_base := rtrim(split_part(v, '?', 1), '/');
    v_query := CASE WHEN position('?' IN v) > 0 THEN substr(v, position('?' IN v) + 1) ELSE '' END;
    SELECT string_agg(p.part, '&' ORDER BY p.ord) INTO v_kept
      FROM unnest(string_to_array(v_query, '&')) WITH ORDINALITY AS p(part, ord)
     WHERE p.part <> ''
       AND split_part(p.part, '=', 1) NOT IN ('mibextid', 'ref', 'locale', 'comment_id', 'reply_comment_id')
       AND left(split_part(p.part, '=', 1), 2) <> '__';
    RETURN NULLIF(v_base || CASE WHEN COALESCE(v_kept, '') <> '' THEN '?' || v_kept ELSE '' END, '');
  END IF;
  -- facebook_uid và mặc định: bỏ "/" cuối, không phân biệt hoa thường.
  RETURN NULLIF(rtrim(v, '/'), '');
END;
$function$;

CREATE FUNCTION private.aka_agent_find_data_coarse_key(p_kind text, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN NULLIF(public.normalize_phone(p_value), '')
    WHEN p_kind = 'facebook_group' THEN COALESCE(
      'facebook.com/groups/' || substring(lower(p_value) FROM 'groups/([^/?#&[:space:]]+)'),
      NULLIF(rtrim(lower(btrim(p_value)), '/'), ''))
    ELSE NULLIF(
      rtrim(split_part(split_part(regexp_replace(lower(btrim(p_value)), '^https?://((m|mbasic|mobile|web|www)[.])?', ''), '#', 1), '?', 1), '/')
      || COALESCE('|' || substring(lower(p_value) FROM '[?&]story_fbid=([^&#]+)'), '')
      || COALESCE('|' || substring(lower(p_value) FROM '[?&](?:id|v|fbid)=([^&#]+)'), ''), '')
  END
$function$;

REVOKE ALL ON FUNCTION private.aka_agent_find_data_coarse_key(text, text) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_coarse_key(text, text) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

CREATE OR REPLACE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_ctx record;
  v_source record;
  v_source_id bigint;
  v_kind text;
  v_detail_id bigint;
  v_input_id bigint;
  v_allowed text[];
  v_item_count integer;
  v_rule public.auto_campaign_data_link_rules%ROWTYPE;
  v_target_ids bigint[];
  v_target_id bigint;
  v_target record;
  v_link_id bigint;
  v_reason text;
  v_inserted integer;
  v_existing integer;
  v_reopened boolean;
  v_note text;
  v_now timestamptz := clock_timestamp();
  v_items jsonb;
  v_ledger_existing integer;
  v_targets jsonb := '[]'::jsonb;
BEGIN
  SELECT ctx.staff_id, ctx.organization_id INTO v_ctx FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1;
  IF v_ctx.staff_id IS NULL THEN
    RAISE EXCEPTION 'find_data_push_unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR NOT (COALESCE(p_payload ->> 'sourceCampaignId', '') ~ '^[0-9]{1,18}$')
    OR jsonb_typeof(p_payload -> 'items') IS DISTINCT FROM 'array'
    OR COALESCE(p_payload ->> 'outputKind', '') NOT IN ('phone', 'zalo_group_link', 'facebook_uid', 'post_link', 'facebook_group')
  THEN
    RAISE EXCEPTION 'find_data_push_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_source_id := (p_payload ->> 'sourceCampaignId')::bigint;
  v_kind := p_payload ->> 'outputKind';
  v_detail_id := CASE WHEN COALESCE(p_payload ->> 'sourceDetailId', '') ~ '^[0-9]{1,18}$'
    THEN (p_payload ->> 'sourceDetailId')::bigint END;
  v_input_id := CASE WHEN COALESCE(p_payload ->> 'sourceInputDataId', '') ~ '^[0-9]{1,18}$'
    THEN (p_payload ->> 'sourceInputDataId')::bigint END;
  IF jsonb_typeof(p_payload -> 'allowedTargetActionIds') = 'array' THEN
    SELECT COALESCE(array_agg(x.value), ARRAY[]::text[]) INTO v_allowed
      FROM jsonb_array_elements_text(p_payload -> 'allowedTargetActionIds') AS x(value);
  END IF;
  v_item_count := jsonb_array_length(p_payload -> 'items');
  IF v_item_count > 5000 THEN
    RAISE EXCEPTION 'find_data_push_too_many_items' USING ERRCODE = '22023';
  END IF;

  SELECT c.id, c.name, c.action_id, c.extra_settings
    INTO v_source
    FROM public.auto_campaigns AS c
   WHERE c.id = v_source_id
     AND c.staff_id = v_ctx.staff_id
     AND c.organization_id = v_ctx.organization_id
     AND NOT COALESCE(c.is_delete, false)
     AND c.action_id IN (SELECT r.source_action_id FROM public.auto_campaign_data_link_rules AS r);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'find_data_push_source_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_note := 'Đã thêm từ chiến dịch "' || left(COALESCE(v_source.name, ''), 200) || '"';

  -- Data gửi lên: khoá do DB tính (V610, không dùng khoá app gửi), bỏ dòng thiếu giá trị / khoá, mỗi khoá giữ dòng đầu tiên.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ord', y.ord, 'value', y.value, 'value_key', y.value_key, 'name', y.name)
                            ORDER BY y.ord), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT DISTINCT ON (x.value_key) x.ord, x.value, x.value_key, x.name
        FROM (
          SELECT i.ord::integer AS ord,
                 left(btrim(i.item ->> 'value'), 2048) AS value,
                 left(private.aka_agent_find_data_match_key(v_kind, i.item ->> 'value'), 2048) AS value_key,
                 NULLIF(left(btrim(COALESCE(i.item ->> 'name', '')), 500), '') AS name
            FROM jsonb_array_elements(p_payload -> 'items') WITH ORDINALITY AS i(item, ord)
           WHERE jsonb_typeof(i.item) = 'object'
        ) AS x
       WHERE COALESCE(x.value, '') <> '' AND COALESCE(x.value_key, '') <> ''
       ORDER BY x.value_key, x.ord
    ) AS y;

  FOR v_rule IN
    SELECT * FROM public.auto_campaign_data_link_rules AS r
     WHERE r.source_action_id = v_source.action_id AND r.output_kind = v_kind AND r.is_active
     ORDER BY r.id
  LOOP
    IF COALESCE(v_source.extra_settings ->> v_rule.source_flag, 'false') <> 'true' THEN
      v_target_ids := ARRAY[]::bigint[];
    ELSE
      v_target_ids := private.aka_agent_find_data_link_target_ids(v_source.extra_settings, v_rule.link_field, v_source.id);
    END IF;

    -- Liên kết đã bỏ khỏi cấu hình.
    UPDATE public.auto_campaign_data_links AS l
       SET status = 'removed', block_reason = NULL, updated_at = v_now
     WHERE l.source_campaign_id = v_source.id AND l.rule_id = v_rule.id
       AND l.status <> 'removed' AND NOT (l.target_campaign_id = ANY (v_target_ids));

    FOREACH v_target_id IN ARRAY v_target_ids LOOP
      v_reason := private.aka_agent_find_data_link_block_reason(
        v_rule.id, v_ctx.staff_id, v_ctx.organization_id, v_target_id, v_allowed);

      INSERT INTO public.auto_campaign_data_links AS l
        (rule_id, source_campaign_id, target_campaign_id, status, block_reason, staff_id, organization_id, created_at, updated_at)
      VALUES (v_rule.id, v_source.id, v_target_id, CASE WHEN v_reason IS NULL THEN 'active' ELSE 'blocked' END,
              v_reason, v_ctx.staff_id, v_ctx.organization_id, v_now, v_now)
      ON CONFLICT (source_campaign_id, rule_id, target_campaign_id) DO UPDATE
        SET status = EXCLUDED.status, block_reason = EXCLUDED.block_reason, updated_at = v_now
      RETURNING l.id INTO v_link_id;

      IF v_reason IS NOT NULL THEN
        SELECT c.name INTO v_target FROM public.auto_campaigns AS c
         WHERE c.id = v_target_id AND c.staff_id = v_ctx.staff_id AND c.organization_id = v_ctx.organization_id;
        v_targets := v_targets || jsonb_build_object(
          'targetCampaignId', v_target_id, 'targetCampaignName', CASE WHEN FOUND THEN v_target.name END,
          'targetActionId', v_rule.target_action_id, 'linkId', v_link_id, 'label', v_rule.label,
          'status', 'blocked', 'reason', v_reason, 'inserted', 0, 'existing', 0, 'reopened', false);
        CONTINUE;
      END IF;

      -- Một lượt đẩy vào cùng một đích tại một thời điểm (hai nguồn đẩy cùng lúc không thêm trùng).
      PERFORM pg_advisory_xact_lock(hashtextextended('aka_agent_find_data_push:' || v_target_id::text, 608));

      SELECT c.id, c.name, c.status INTO v_target FROM public.auto_campaigns AS c WHERE c.id = v_target_id;

      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng khoá (V610: khoá DB tính, nên data khách
      -- nhập kiểu khác vẫn nhận ra). Khoá đầy đủ chỉ tính cho dòng có khoá thô trùng data gửi lên (khoá thô: SQL thuần, rẻ; cùng khoá
      -- đầy đủ thì chắc chắn cùng khoá thô), đích 60.000 dòng không phải tính khoá đầy đủ cho từng dòng.
      WITH item_coarse AS MATERIALIZED (
        SELECT DISTINCT private.aka_agent_find_data_coarse_key(v_kind, i.value) AS c
          FROM jsonb_to_recordset(v_items) AS i(value text)
      ), target_keys AS MATERIALIZED (
        SELECT DISTINCT private.aka_agent_find_data_match_key(v_kind, t.raw) AS k
          FROM (
            SELECT CASE WHEN v_rule.value_column = 'phone' THEN x.phone ELSE x.uid END AS raw
              FROM public.auto_campaign_input_data AS x
             WHERE x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
          ) AS t
         WHERE private.aka_agent_find_data_coarse_key(v_kind, t.raw) IN (SELECT c FROM item_coarse)
      ), plan AS (
        SELECT i.ord, i.value, i.value_key, i.name,
               EXISTS (
                 SELECT 1 FROM public.auto_campaign_data_link_deliveries AS d
                  WHERE d.target_campaign_id = v_target_id AND d.value_key = i.value_key AND d.result = 'inserted'
               )
               OR EXISTS (SELECT 1 FROM target_keys AS tk WHERE tk.k = i.value_key) AS already
          FROM jsonb_to_recordset(v_items) AS i(ord integer, value text, value_key text, name text)
      ), ins AS (
        INSERT INTO public.auto_campaign_input_data (campaign_id, name, uid, phone, status, note)
        SELECT v_target_id,
               p.name,
               CASE WHEN v_rule.value_column = 'uid' THEN p.value END,
               CASE WHEN v_rule.value_column = 'phone' THEN p.value END,
               'chờ xử lý',
               v_note
          FROM plan AS p
         WHERE NOT p.already
         ORDER BY p.ord
        RETURNING id, CASE WHEN v_rule.value_column = 'phone' THEN phone ELSE uid END AS value
      ), ledger_inserted AS (
        INSERT INTO public.auto_campaign_data_link_deliveries
          (link_id, source_campaign_id, target_campaign_id, value_key, value, result, target_input_data_id,
           source_detail_id, source_input_data_id, created_at)
        SELECT v_link_id, v_source.id, v_target_id, p.value_key, p.value, 'inserted', ins.id, v_detail_id, v_input_id, v_now
          FROM ins JOIN plan AS p ON p.value = ins.value AND NOT p.already
        ON CONFLICT (link_id, value_key) DO UPDATE
          SET result = 'inserted', target_input_data_id = EXCLUDED.target_input_data_id,
              source_detail_id = EXCLUDED.source_detail_id, source_input_data_id = EXCLUDED.source_input_data_id,
              created_at = EXCLUDED.created_at
        RETURNING 1
      ), ledger_existing AS (
        INSERT INTO public.auto_campaign_data_link_deliveries
          (link_id, source_campaign_id, target_campaign_id, value_key, value, result, source_detail_id, source_input_data_id, created_at)
        SELECT v_link_id, v_source.id, v_target_id, p.value_key, p.value, 'existing', v_detail_id, v_input_id, v_now
          FROM plan AS p
         WHERE p.already
        ON CONFLICT (link_id, value_key) DO NOTHING
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM ledger_inserted)::integer,
             (SELECT count(*) FROM plan WHERE already)::integer,
             (SELECT count(*) FROM ledger_existing)::integer
        INTO v_inserted, v_existing, v_ledger_existing;

      v_reopened := false;
      IF v_inserted > 0 AND v_target.status = 'hoàn thành' THEN
        UPDATE public.auto_campaigns AS c
           SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = v_now
         WHERE c.id = v_target_id AND c.status = 'hoàn thành' AND NOT COALESCE(c.is_delete, false);
        v_reopened := FOUND;
      END IF;

      UPDATE public.auto_campaign_data_links AS l
         SET inserted_count = l.inserted_count + v_inserted,
             existing_count = l.existing_count + v_existing,
             last_push_at = v_now,
             updated_at = v_now
       WHERE l.id = v_link_id;

      v_targets := v_targets || jsonb_build_object(
        'targetCampaignId', v_target_id, 'targetCampaignName', v_target.name,
        'targetActionId', v_rule.target_action_id, 'linkId', v_link_id, 'label', v_rule.label,
        'status', 'delivered', 'reason', NULL, 'inserted', v_inserted, 'existing', v_existing, 'reopened', v_reopened);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sourceCampaignId', v_source.id,
    'outputKind', v_kind,
    'itemCount', jsonb_array_length(v_items),
    'targets', v_targets
  );
END;
$function$;

DROP FUNCTION IF EXISTS private.aka_agent_find_data_match_tokens(text, text);

-- Sổ đẩy ghi trước bản này mang khoá cũ: tính lại theo khoá mới. Hai dòng cùng liên kết ra cùng khoá thì giữ một
-- (ưu tiên dòng "inserted", rồi dòng cũ nhất). Đổi qua khoá tạm trước để không vướng ràng buộc duy nhất (link_id, value_key).
CREATE TEMP TABLE v614_unkey ON COMMIT DROP AS
  SELECT d.id, d.link_id, d.result, d.created_at,
         COALESCE(left(private.aka_agent_find_data_match_key(r.output_kind, d.value), 2048), d.value_key) AS nk
    FROM public.auto_campaign_data_link_deliveries AS d
    JOIN public.auto_campaign_data_links AS l ON l.id = d.link_id
    JOIN public.auto_campaign_data_link_rules AS r ON r.id = l.rule_id;
DELETE FROM public.auto_campaign_data_link_deliveries AS d
 USING (SELECT id, row_number() OVER (PARTITION BY link_id, nk ORDER BY (result = 'inserted') DESC, created_at, id) AS rn FROM v614_unkey) AS x
 WHERE d.id = x.id AND x.rn > 1;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = '~' || d.id
  FROM v614_unkey AS x WHERE d.id = x.id AND d.value_key IS DISTINCT FROM x.nk;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = x.nk
  FROM v614_unkey AS x WHERE d.id = x.id AND d.value_key = '~' || d.id;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> 'd9fbaed069124f9fdc85f8be2036bd45'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> '3360f6e7130f9857866564c497ba26d4'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_coarse_key(text, text)'::regprocedure) <> 'f8b51af4beded560216ce3c937810be1'
  THEN
    RAISE EXCEPTION 'gỡ V614: thân hàm không về đúng bản V610';
  END IF;
END $post$;

COMMIT;
