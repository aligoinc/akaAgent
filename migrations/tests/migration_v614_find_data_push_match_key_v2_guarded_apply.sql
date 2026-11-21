-- V614: vá khoá so sánh của hàm đẩy data tìm được (V610) để nhận ra cùng một data ở mọi cách viết đã gặp trên dữ liệu thật.
--
-- Đo trên dữ liệu thật 21/11/2026 (chỉ đọc):
--   - UID: V610 chỉ bỏ "/" cuối, nên UID số, profile.php?id=<số>, groups/<nhóm>/user/<số>/, marketplace/profile/<số>/ của cùng một
--     người là các khoá khác nhau; tên riêng trần khác facebook.com/<tên riêng>. Chiến dịch "Nhắn tin & Kết bạn UID": data đẩy sang
--     99% là UID số, data khách nhập 57% profile.php?id=.
--   - Group: mã group số trần (~850 dòng mỗi loại chiến dịch group) khác facebook.com/groups/<mã>.
--   - Link bài: /permalink/<id>, /pending_posts/<id>, ?multi_permalinks=<id> cùng bài với /posts/<id>; story_fbid / id đổi thứ tự;
--     story.php và permalink.php.
--   - Link Zalo: tham số sau "?". Mã phân biệt hoa thường (share/<x>/<mã>, pfbid…) không còn bị hạ chữ thường.
-- Bước lọc nhanh dòng của đích: "mảnh" chữ / số của giá trị (private.aka_agent_find_data_match_tokens) thay khoá thô của V610;
-- khoá ghép từ chính các đoạn của giá trị nên hai giá trị cùng khoá luôn chung mảnh. Hàm khoá thô V610 bị xoá.
-- Thay thân hàm đẩy (chỉ phần lọc nhanh), khoá so sánh; tính lại khoá của sổ đẩy (production lúc viết: 0 dòng).
-- Sinh bằng: python3 scripts/find-data-push/build-v614-sql.py. Gỡ: migrations/rollback_v614_find_data_push_match_key_v2.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v614_%') THEN
      RAISE EXCEPTION 'V614 đã có trong sổ migration, không chạy lại';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v610_find_data_push_match_key') THEN
      RAISE EXCEPTION 'V614: cần V610 trước';
    END IF;
  END IF;
  IF to_regprocedure('private.aka_agent_find_data_match_tokens(text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V614: hàm mảnh đã có';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> 'd9fbaed069124f9fdc85f8be2036bd45'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> '3360f6e7130f9857866564c497ba26d4'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_coarse_key(text, text)'::regprocedure) <> 'f8b51af4beded560216ce3c937810be1'
  THEN
    RAISE EXCEPTION 'V614: thân hàm khác bản V610 đã kiểm';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION private.aka_agent_find_data_match_key(p_kind text, p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text := btrim(COALESCE(p_value, ''));
  v text;
  v_host text;
  v_rest text;
  v_path text;
  v_lpath text;
  v_q text;
  v_fb boolean;
  v_zalo boolean;
  m text[];
  v_id text;
  v_kept text;
  v_first text;
  v_generic text;
BEGIN
  IF v_raw = '' THEN RETURN NULL; END IF;
  IF p_kind = 'phone' THEN
    RETURN NULLIF(public.normalize_phone(v_raw), '');
  END IF;
  -- Tách máy chủ / đường dẫn / tham số. Chỉ nhận máy chủ Facebook / Zalo; giá trị không có máy chủ (mã, tên riêng trần) là đường dẫn.
  v_raw := rtrim(split_part(v_raw, '#', 1), '/');
  IF v_raw = '' THEN RETURN NULL; END IF;
  v := regexp_replace(v_raw, '^[A-Za-z][A-Za-z0-9+.-]*://', '');
  v_host := lower(COALESCE(substring(v FROM '^([^/?]*)'), ''));
  v_fb := v_host ~ '^([a-z0-9-]+\.)*(facebook|fb)\.com$';
  v_zalo := v_host ~ '^([a-z0-9-]+\.)*zalo\.me$';
  IF v_fb OR v_zalo THEN
    v_rest := substr(v, length(v_host) + 1);
  ELSIF v <> v_raw THEN
    -- Có giao thức nhưng không phải Facebook / Zalo: so cả địa chỉ (bỏ giao thức, "/" cuối), không phân biệt hoa thường.
    RETURN NULLIF(rtrim(lower(v), '/'), '');
  ELSE
    v_rest := v;
  END IF;
  v_path := regexp_replace(regexp_replace(split_part(v_rest, '?', 1), '/{2,}', '/', 'g'), '^/+|/+$', '', 'g');
  v_q := CASE WHEN position('?' IN v_rest) > 0 THEN substr(v_rest, position('?' IN v_rest) + 1) ELSE '' END;
  v_lpath := lower(v_path);
  -- Dạng chung (khi không nhận ra dạng riêng): đường dẫn + tham số không phải theo dõi, xếp theo tên. Không bỏ tham số mang danh tính.
  SELECT string_agg(p.part, '&' ORDER BY p.part) INTO v_kept
    FROM (SELECT regexp_replace(regexp_replace(x, '/+$', ''), '=$', '') AS part FROM unnest(string_to_array(lower(v_q), '&')) AS x) AS p
   WHERE p.part <> ''
     AND split_part(p.part, '=', 1) NOT IN ('mibextid', 'ref', 'locale', 'comment_id', 'reply_comment_id', 'rdid', 'share_url', 'sfnsn', 'extid', 'paipv', 'eav', '_rdr', '_rdc', 'refsrc', 'hc_ref', 'fref', 'notif_id', 'notif_t', 'acontext', 'aref', 's', 'app')
     AND left(split_part(p.part, '=', 1), 2) <> '__';
  v_generic := NULLIF(CASE WHEN v_fb THEN 'www.facebook.com/' ELSE '' END || v_lpath
    || CASE WHEN COALESCE(v_kept, '') <> '' THEN '?' || v_kept ELSE '' END, '');

  IF p_kind = 'zalo_group_link' THEN
    IF NOT v_zalo AND v_lpath ~ '^[0-9]+$' THEN RETURN v_lpath; END IF;
    IF v_zalo OR v_lpath ~ '^g/' THEN RETURN NULLIF('zalo.me/' || v_lpath, 'zalo.me/'); END IF;
    RETURN v_generic;
  END IF;

  IF p_kind = 'facebook_group' THEN
    IF NOT v_fb AND v_lpath ~ '^[0-9]{5,}$' THEN RETURN 'facebook.com/groups/' || v_lpath; END IF;
    m := regexp_match(v_lpath, '^groups/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/groups/' || m[1]; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/share/' || lower(m[1]) || '/' || m[2]; END IF;
    -- Không phải group (chiến dịch comment seeding nhận cả trang cá nhân / trang): so như UID, tiền tố riêng.
    RETURN 'profile:' || private.aka_agent_find_data_match_key('facebook_uid', p_value);
  END IF;

  IF p_kind IN ('facebook_uid', 'facebook_group_admin') THEN
    -- Cùng một người với cách bộ chạy mở (helpers.normalizeFbUrl / extractUidFromInput): UID số ở bất kỳ dạng nào.
    IF v_lpath ~ '^[0-9]{5,20}$' THEN RETURN v_lpath; END IF;
    v_id := substring(v_q FROM '(?:^|&)id=([0-9]{5,20})(?:&|$)');
    IF v_id IS NULL THEN
      v_id := (regexp_match(v_lpath, '(?:^|/)(?:user|marketplace/profile|people/[^/]+)/([0-9]{5,20})(?:/|$)'))[1];
    END IF;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'share/' || lower(m[1]) || '/' || m[2]; END IF;
    -- Tên riêng: trang cá nhân (một đoạn, hoặc thêm một trang con như /about), không phân biệt hoa thường. Đường dẫn khác (bài
    -- viết, ảnh…) so nguyên: không gộp các link bài của cùng một người.
    v_first := split_part(v_lpath, '/', 1);
    IF v_first ~ '^[a-z0-9.]{5,50}$' AND v_first NOT IN ('groups', 'marketplace', 'people', 'share', 'watch', 'reel', 'pages', 'events', 'hashtag', 'photo', 'photo.php', 'story.php', 'permalink.php', 'profile.php', 'search', 'messages', 'friends', 'videos')
      AND (v_lpath = v_first OR v_lpath ~ ('^[^/]+/(?:' || 'about|about_contact_and_basic_info|directory_contact_info|photos|friends|videos|followers|following|reels' || ')$')) THEN
      RETURN v_first;
    END IF;
    RETURN v_generic;
  END IF;

  IF p_kind = 'post_link' THEN
    m := regexp_match(v_path, '^groups/([^/]+)/(?:posts|permalink|pending_posts)/([^/]+)', 'i');
    IF m IS NOT NULL THEN
      RETURN 'facebook.com/groups/' || lower(m[1]) || '/posts/' || CASE WHEN m[2] ~* '^pfbid' THEN m[2] ELSE lower(m[2]) END;
    END IF;
    v_id := substring(v_q FROM '(?:^|&)multi_permalinks=([^&%,]+)');
    m := regexp_match(v_lpath, '^groups/([^/]+)$');
    IF v_id IS NOT NULL AND m IS NOT NULL THEN
      RETURN 'facebook.com/groups/' || m[1] || '/posts/' || CASE WHEN v_id ~* '^pfbid' THEN v_id ELSE lower(v_id) END;
    END IF;
    IF v_lpath ~ '^(permalink|story)\.php$' THEN
      v_id := substring(v_q FROM '(?:^|&)story_fbid=([^&]+)');
      IF v_id IS NOT NULL THEN
        RETURN 'facebook.com/story/' || CASE WHEN v_id ~* '^pfbid' THEN v_id ELSE lower(v_id) END
          || '/' || COALESCE(substring(v_q FROM '(?:^|&)id=([0-9]+)'), '');
      END IF;
    END IF;
    m := regexp_match(v_path, '^([^/]+)/posts/([^/]+)');
    IF m IS NOT NULL AND lower(m[1]) <> 'groups' THEN
      RETURN 'facebook.com/' || lower(m[1]) || '/posts/' || CASE WHEN m[2] ~* '^pfbid' THEN m[2] ELSE lower(m[2]) END;
    END IF;
    IF v_lpath ~ '^photo(\.php)?$' AND substring(v_q FROM '(?:^|&)fbid=([0-9]+)') IS NOT NULL THEN
      RETURN 'facebook.com/photo/' || substring(v_q FROM '(?:^|&)fbid=([0-9]+)');
    END IF;
    m := regexp_match(v_lpath, '^[^/]+/photos/(?:[^/]+/)?([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/photo/' || m[1]; END IF;
    IF v_lpath = 'watch' AND substring(v_q FROM '(?:^|&)v=([0-9]+)') IS NOT NULL THEN
      RETURN 'facebook.com/video/' || substring(v_q FROM '(?:^|&)v=([0-9]+)');
    END IF;
    m := regexp_match(v_lpath, '^(?:[^/]+/)?videos/(?:[^/]+/)*([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/video/' || m[1]; END IF;
    m := regexp_match(v_lpath, '^reel/([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/reel/' || m[1]; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/share/' || lower(m[1]) || '/' || m[2]; END IF;
    RETURN v_generic;
  END IF;

  RETURN v_generic;
END;
$function$;

CREATE FUNCTION private.aka_agent_find_data_match_tokens(p_kind text, p_value text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN ARRAY[COALESCE(NULLIF(public.normalize_phone(btrim(COALESCE(p_value, ''))), ''), '')]
    WHEN COALESCE(p_value, '') ~ '[A-Za-z0-9]' THEN regexp_split_to_array(lower(p_value), '[^a-z0-9]+')
    -- Không có chữ / số nào: lấy khoá làm mảnh (hiếm, chỉ data rác).
    ELSE ARRAY[COALESCE(private.aka_agent_find_data_match_key(p_kind, p_value), '')]
  END
$function$;

REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_tokens(text, text) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_tokens(text, text) FROM %I', r);
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

  -- Data gửi lên: khoá do DB tính (không dùng khoá app gửi), bỏ dòng thiếu giá trị / khoá, mỗi khoá giữ dòng đầu tiên.
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

      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng khoá (khoá DB tính, nên data khách
      -- nhập kiểu khác vẫn nhận ra). Khoá đầy đủ chỉ tính cho dòng có chung ít nhất một mảnh chữ / số (trừ tên miền, từ khoá đường
      -- dẫn) với data gửi lên; khoá ghép từ chính các đoạn của giá trị nên cùng khoá thì luôn chung mảnh.
      WITH item_tokens AS MATERIALIZED (
        SELECT DISTINCT t.tok
          FROM jsonb_to_recordset(v_items) AS i(value text)
          CROSS JOIN LATERAL unnest(private.aka_agent_find_data_match_tokens(v_kind, i.value)) AS t(tok)
         WHERE t.tok <> ALL (ARRAY['', 'http', 'https', 'www', 'm', 'mbasic', 'mobile', 'web', 'touch', 'facebook', 'fb', 'com', 'zalo', 'me', 'groups', 'posts', 'permalink', 'pending', 'profile', 'php', 'id', 'user', 'story', 'fbid', 'share', 'multi', 'permalinks', 'marketplace', 'people', 'photo', 'photos', 'videos', 'watch', 'reel', 'g', 'p', 'v', 'r', 'cft', 'tn', 'mibextid', 'ref', 'comment']::text[])
      ), target_keys AS MATERIALIZED (
        SELECT DISTINCT private.aka_agent_find_data_match_key(v_kind, t.raw) AS k
          FROM (
            SELECT CASE WHEN v_rule.value_column = 'phone' THEN x.phone ELSE x.uid END AS raw
              FROM public.auto_campaign_input_data AS x
             WHERE x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
          ) AS t
         WHERE EXISTS (
           SELECT 1 FROM unnest(private.aka_agent_find_data_match_tokens(v_kind, t.raw)) AS r(tok)
            WHERE r.tok IN (SELECT tok FROM item_tokens)
         )
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

DROP FUNCTION private.aka_agent_find_data_coarse_key(text, text);

-- Sổ đẩy ghi trước bản này mang khoá cũ: tính lại theo khoá mới. Hai dòng cùng liên kết ra cùng khoá thì giữ một
-- (ưu tiên dòng "inserted", rồi dòng cũ nhất). Đổi qua khoá tạm trước để không vướng ràng buộc duy nhất (link_id, value_key).
CREATE TEMP TABLE v614_rekey ON COMMIT DROP AS
  SELECT d.id, d.link_id, d.result, d.created_at,
         COALESCE(left(private.aka_agent_find_data_match_key(r.output_kind, d.value), 2048), d.value_key) AS nk
    FROM public.auto_campaign_data_link_deliveries AS d
    JOIN public.auto_campaign_data_links AS l ON l.id = d.link_id
    JOIN public.auto_campaign_data_link_rules AS r ON r.id = l.rule_id;
DELETE FROM public.auto_campaign_data_link_deliveries AS d
 USING (SELECT id, row_number() OVER (PARTITION BY link_id, nk ORDER BY (result = 'inserted') DESC, created_at, id) AS rn FROM v614_rekey) AS x
 WHERE d.id = x.id AND x.rn > 1;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = '~' || d.id
  FROM v614_rekey AS x WHERE d.id = x.id AND d.value_key IS DISTINCT FROM x.nk;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = x.nk
  FROM v614_rekey AS x WHERE d.id = x.id AND d.value_key = '~' || d.id;

DO $post$
DECLARE
  v_bad text;
BEGIN
  -- Các cách viết của cùng một data ra cùng khoá.
  SELECT string_agg(format('%s:%s→%s≠%s', c.kind, c.a, private.aka_agent_find_data_match_key(c.kind, c.a),
                           private.aka_agent_find_data_match_key(c.kind, c.b)), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/profile.php?id=100072022092879'),
      ('facebook_uid', '100072022092879', 'https://m.facebook.com/profile.php?id=100072022092879&comment_id=Y29tbWVudA%3D%3D'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/groups/975457975877822/user/100072022092879/?__cft__[0]=AZj&__tn__=R'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/marketplace/profile/100072022092879/?product_id=1&__cft__[0]=AZ'),
      ('facebook_uid', '100072022092879', 'facebook.com/100072022092879/'),
      ('facebook_uid', 'huan.khanh.1840', 'https://www.facebook.com/huan.khanh.1840/'),
      ('facebook_uid', 'https://www.facebook.com/photo/?fbid=164&set=a.107/', 'https://www.facebook.com/photo/?fbid=164&set=a.107'),
      ('facebook_uid', 'https://web.facebook.com/Huan.Khanh.1840?mibextid=abc', 'https://www.facebook.com/huan.khanh.1840/about'),
      ('facebook_group', '1856052657967796', 'https://www.facebook.com/groups/1856052657967796/'),
      ('facebook_group', 'https://www.facebook.com/groups/12345/', 'https://m.facebook.com/groups/12345?ref=share'),
      ('facebook_group', 'https://www.facebook.com/groups/AbcShop/', 'facebook.com/groups/abcshop'),
      ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://m.facebook.com/profile.php?id=61573525756908&mibextid=x'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://m.facebook.com/groups/1/posts/2?__cft__[0]=AZ&__tn__=R'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/permalink/2/'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/pending_posts/2'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/?multi_permalinks=2&ref=share'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://web.facebook.com/permalink.php?id=6157&story_fbid=pfbid0X&mibextid=abc'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://www.facebook.com/story.php?story_fbid=pfbid0X&id=6157'),
      ('post_link', 'https://www.facebook.com/inkien/posts/pfbid0itURo', 'https://m.facebook.com/inkien/posts/pfbid0itURo/?__cft__[0]=x'),
      ('post_link', 'https://www.facebook.com/watch/?v=123456', 'https://www.facebook.com/abc/videos/123456/'),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', ' HTTPS://ZALO.ME/G/ABCDEF123/ '),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', 'zalo.me/g/abcdef123?src=share'),
      ('phone', '0985794636', '+84 985 794 636')
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_match_key(c.kind, c.a) IS DISTINCT FROM private.aka_agent_find_data_match_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: khoá khác nhau: %', v_bad; END IF;
  -- Cùng khoá thì chung ít nhất một mảnh (bước lọc nhanh không bỏ sót).
  SELECT string_agg(format('%s:%s', c.kind, c.a), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/profile.php?id=100072022092879'),
      ('facebook_uid', '100072022092879', 'https://m.facebook.com/profile.php?id=100072022092879&comment_id=Y29tbWVudA%3D%3D'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/groups/975457975877822/user/100072022092879/?__cft__[0]=AZj&__tn__=R'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/marketplace/profile/100072022092879/?product_id=1&__cft__[0]=AZ'),
      ('facebook_uid', '100072022092879', 'facebook.com/100072022092879/'),
      ('facebook_uid', 'huan.khanh.1840', 'https://www.facebook.com/huan.khanh.1840/'),
      ('facebook_uid', 'https://www.facebook.com/photo/?fbid=164&set=a.107/', 'https://www.facebook.com/photo/?fbid=164&set=a.107'),
      ('facebook_uid', 'https://web.facebook.com/Huan.Khanh.1840?mibextid=abc', 'https://www.facebook.com/huan.khanh.1840/about'),
      ('facebook_group', '1856052657967796', 'https://www.facebook.com/groups/1856052657967796/'),
      ('facebook_group', 'https://www.facebook.com/groups/12345/', 'https://m.facebook.com/groups/12345?ref=share'),
      ('facebook_group', 'https://www.facebook.com/groups/AbcShop/', 'facebook.com/groups/abcshop'),
      ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://m.facebook.com/profile.php?id=61573525756908&mibextid=x'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://m.facebook.com/groups/1/posts/2?__cft__[0]=AZ&__tn__=R'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/permalink/2/'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/pending_posts/2'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/?multi_permalinks=2&ref=share'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://web.facebook.com/permalink.php?id=6157&story_fbid=pfbid0X&mibextid=abc'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://www.facebook.com/story.php?story_fbid=pfbid0X&id=6157'),
      ('post_link', 'https://www.facebook.com/inkien/posts/pfbid0itURo', 'https://m.facebook.com/inkien/posts/pfbid0itURo/?__cft__[0]=x'),
      ('post_link', 'https://www.facebook.com/watch/?v=123456', 'https://www.facebook.com/abc/videos/123456/'),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', ' HTTPS://ZALO.ME/G/ABCDEF123/ '),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', 'zalo.me/g/abcdef123?src=share'),
      ('phone', '0985794636', '+84 985 794 636')
    ) AS c(kind, a, b)
   WHERE NOT EXISTS (
     SELECT 1 FROM unnest(private.aka_agent_find_data_match_tokens(c.kind, c.a)) AS x(tok)
      WHERE x.tok <> ALL (ARRAY['', 'http', 'https', 'www', 'm', 'mbasic', 'mobile', 'web', 'touch', 'facebook', 'fb', 'com', 'zalo', 'me', 'groups', 'posts', 'permalink', 'pending', 'profile', 'php', 'id', 'user', 'story', 'fbid', 'share', 'multi', 'permalinks', 'marketplace', 'people', 'photo', 'photos', 'videos', 'watch', 'reel', 'g', 'p', 'v', 'r', 'cft', 'tn', 'mibextid', 'ref', 'comment']::text[])
        AND x.tok = ANY (private.aka_agent_find_data_match_tokens(c.kind, c.b)));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: cùng khoá mà không chung mảnh: %', v_bad; END IF;
  -- Data khác nhau ra khoá khác nhau.
  SELECT string_agg(format('%s:%s=%s', c.kind, c.a, c.b), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_uid', '100072022092879', '1000720220928790'),
      ('facebook_uid', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid022tp6iCho', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid02bJD7Puwm'),
      ('facebook_uid', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid022tp6iCho', 'https://www.facebook.com/phuonguyen.vu.3766'),
      ('facebook_uid', 'https://www.facebook.com/profile.php?id=10007202', 'https://www.facebook.com/profile.php?id=100072022'),
      ('facebook_group', 'https://www.facebook.com/groups/1/', 'https://www.facebook.com/groups/12/'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=a&id=1', 'https://www.facebook.com/permalink.php?story_fbid=b&id=1'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/posts/3/'),
      ('post_link', 'https://www.facebook.com/share/p/1AbCdEfGhI/', 'https://www.facebook.com/share/p/1abcdefghi/'),
      ('facebook_group', 'https://www.facebook.com/share/g/1AbCdEfGhI/', 'https://www.facebook.com/share/g/1abcdefghi/'),
      ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://www.facebook.com/profile.php?id=61573768148044'),
      ('facebook_uid', 'https://www.facebook.com/photo/?fbid=111', 'https://www.facebook.com/photo/?fbid=222'),
      ('zalo_group_link', 'https://zalo.me/g/abc123', 'https://zalo.me/g/abc124'),
      ('phone', '0985794636', '0985794637')
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_match_key(c.kind, c.a) = private.aka_agent_find_data_match_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: hai data khác nhau ra cùng khoá: %', v_bad; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> 'a9298a62cd6860f32bb2001b5f52388e'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> 'eced466b2910026db6c75178da5b09d1'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_tokens(text, text)'::regprocedure) <> '4358d2a568d9ad08addcdffc15262af2'
  THEN
    RAISE EXCEPTION 'V614 postflight: thân hàm khác bản sinh';
  END IF;
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V614 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF has_function_privilege('aka_agent_desktop', 'private.aka_agent_find_data_match_tokens(text, text)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'private.aka_agent_find_data_match_key(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V614 postflight: aka_agent_desktop không được gọi thẳng hàm khoá';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaign_data_link_deliveries WHERE value_key LIKE '~%') THEN
    RAISE EXCEPTION 'V614 postflight: sổ đẩy còn khoá tạm';
  END IF;
END $post$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20261121101630', 'migration_v614_find_data_push_match_key_v2', ARRAY[$ledger_ab57736f6222$-- V614: vá khoá so sánh của hàm đẩy data tìm được (V610) để nhận ra cùng một data ở mọi cách viết đã gặp trên dữ liệu thật.
--
-- Đo trên dữ liệu thật 21/11/2026 (chỉ đọc):
--   - UID: V610 chỉ bỏ "/" cuối, nên UID số, profile.php?id=<số>, groups/<nhóm>/user/<số>/, marketplace/profile/<số>/ của cùng một
--     người là các khoá khác nhau; tên riêng trần khác facebook.com/<tên riêng>. Chiến dịch "Nhắn tin & Kết bạn UID": data đẩy sang
--     99% là UID số, data khách nhập 57% profile.php?id=.
--   - Group: mã group số trần (~850 dòng mỗi loại chiến dịch group) khác facebook.com/groups/<mã>.
--   - Link bài: /permalink/<id>, /pending_posts/<id>, ?multi_permalinks=<id> cùng bài với /posts/<id>; story_fbid / id đổi thứ tự;
--     story.php và permalink.php.
--   - Link Zalo: tham số sau "?". Mã phân biệt hoa thường (share/<x>/<mã>, pfbid…) không còn bị hạ chữ thường.
-- Bước lọc nhanh dòng của đích: "mảnh" chữ / số của giá trị (private.aka_agent_find_data_match_tokens) thay khoá thô của V610;
-- khoá ghép từ chính các đoạn của giá trị nên hai giá trị cùng khoá luôn chung mảnh. Hàm khoá thô V610 bị xoá.
-- Thay thân hàm đẩy (chỉ phần lọc nhanh), khoá so sánh; tính lại khoá của sổ đẩy (production lúc viết: 0 dòng).
-- Sinh bằng: python3 scripts/find-data-push/build-v614-sql.py. Gỡ: migrations/rollback_v614_find_data_push_match_key_v2.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v614_%') THEN
      RAISE EXCEPTION 'V614 đã có trong sổ migration, không chạy lại';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v610_find_data_push_match_key') THEN
      RAISE EXCEPTION 'V614: cần V610 trước';
    END IF;
  END IF;
  IF to_regprocedure('private.aka_agent_find_data_match_tokens(text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V614: hàm mảnh đã có';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> 'd9fbaed069124f9fdc85f8be2036bd45'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> '3360f6e7130f9857866564c497ba26d4'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_coarse_key(text, text)'::regprocedure) <> 'f8b51af4beded560216ce3c937810be1'
  THEN
    RAISE EXCEPTION 'V614: thân hàm khác bản V610 đã kiểm';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION private.aka_agent_find_data_match_key(p_kind text, p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text := btrim(COALESCE(p_value, ''));
  v text;
  v_host text;
  v_rest text;
  v_path text;
  v_lpath text;
  v_q text;
  v_fb boolean;
  v_zalo boolean;
  m text[];
  v_id text;
  v_kept text;
  v_first text;
  v_generic text;
BEGIN
  IF v_raw = '' THEN RETURN NULL; END IF;
  IF p_kind = 'phone' THEN
    RETURN NULLIF(public.normalize_phone(v_raw), '');
  END IF;
  -- Tách máy chủ / đường dẫn / tham số. Chỉ nhận máy chủ Facebook / Zalo; giá trị không có máy chủ (mã, tên riêng trần) là đường dẫn.
  v_raw := rtrim(split_part(v_raw, '#', 1), '/');
  IF v_raw = '' THEN RETURN NULL; END IF;
  v := regexp_replace(v_raw, '^[A-Za-z][A-Za-z0-9+.-]*://', '');
  v_host := lower(COALESCE(substring(v FROM '^([^/?]*)'), ''));
  v_fb := v_host ~ '^([a-z0-9-]+\.)*(facebook|fb)\.com$';
  v_zalo := v_host ~ '^([a-z0-9-]+\.)*zalo\.me$';
  IF v_fb OR v_zalo THEN
    v_rest := substr(v, length(v_host) + 1);
  ELSIF v <> v_raw THEN
    -- Có giao thức nhưng không phải Facebook / Zalo: so cả địa chỉ (bỏ giao thức, "/" cuối), không phân biệt hoa thường.
    RETURN NULLIF(rtrim(lower(v), '/'), '');
  ELSE
    v_rest := v;
  END IF;
  v_path := regexp_replace(regexp_replace(split_part(v_rest, '?', 1), '/{2,}', '/', 'g'), '^/+|/+$', '', 'g');
  v_q := CASE WHEN position('?' IN v_rest) > 0 THEN substr(v_rest, position('?' IN v_rest) + 1) ELSE '' END;
  v_lpath := lower(v_path);
  -- Dạng chung (khi không nhận ra dạng riêng): đường dẫn + tham số không phải theo dõi, xếp theo tên. Không bỏ tham số mang danh tính.
  SELECT string_agg(p.part, '&' ORDER BY p.part) INTO v_kept
    FROM (SELECT regexp_replace(regexp_replace(x, '/+$', ''), '=$', '') AS part FROM unnest(string_to_array(lower(v_q), '&')) AS x) AS p
   WHERE p.part <> ''
     AND split_part(p.part, '=', 1) NOT IN ('mibextid', 'ref', 'locale', 'comment_id', 'reply_comment_id', 'rdid', 'share_url', 'sfnsn', 'extid', 'paipv', 'eav', '_rdr', '_rdc', 'refsrc', 'hc_ref', 'fref', 'notif_id', 'notif_t', 'acontext', 'aref', 's', 'app')
     AND left(split_part(p.part, '=', 1), 2) <> '__';
  v_generic := NULLIF(CASE WHEN v_fb THEN 'www.facebook.com/' ELSE '' END || v_lpath
    || CASE WHEN COALESCE(v_kept, '') <> '' THEN '?' || v_kept ELSE '' END, '');

  IF p_kind = 'zalo_group_link' THEN
    IF NOT v_zalo AND v_lpath ~ '^[0-9]+$' THEN RETURN v_lpath; END IF;
    IF v_zalo OR v_lpath ~ '^g/' THEN RETURN NULLIF('zalo.me/' || v_lpath, 'zalo.me/'); END IF;
    RETURN v_generic;
  END IF;

  IF p_kind = 'facebook_group' THEN
    IF NOT v_fb AND v_lpath ~ '^[0-9]{5,}$' THEN RETURN 'facebook.com/groups/' || v_lpath; END IF;
    m := regexp_match(v_lpath, '^groups/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/groups/' || m[1]; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/share/' || lower(m[1]) || '/' || m[2]; END IF;
    -- Không phải group (chiến dịch comment seeding nhận cả trang cá nhân / trang): so như UID, tiền tố riêng.
    RETURN 'profile:' || private.aka_agent_find_data_match_key('facebook_uid', p_value);
  END IF;

  IF p_kind IN ('facebook_uid', 'facebook_group_admin') THEN
    -- Cùng một người với cách bộ chạy mở (helpers.normalizeFbUrl / extractUidFromInput): UID số ở bất kỳ dạng nào.
    IF v_lpath ~ '^[0-9]{5,20}$' THEN RETURN v_lpath; END IF;
    v_id := substring(v_q FROM '(?:^|&)id=([0-9]{5,20})(?:&|$)');
    IF v_id IS NULL THEN
      v_id := (regexp_match(v_lpath, '(?:^|/)(?:user|marketplace/profile|people/[^/]+)/([0-9]{5,20})(?:/|$)'))[1];
    END IF;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'share/' || lower(m[1]) || '/' || m[2]; END IF;
    -- Tên riêng: trang cá nhân (một đoạn, hoặc thêm một trang con như /about), không phân biệt hoa thường. Đường dẫn khác (bài
    -- viết, ảnh…) so nguyên: không gộp các link bài của cùng một người.
    v_first := split_part(v_lpath, '/', 1);
    IF v_first ~ '^[a-z0-9.]{5,50}$' AND v_first NOT IN ('groups', 'marketplace', 'people', 'share', 'watch', 'reel', 'pages', 'events', 'hashtag', 'photo', 'photo.php', 'story.php', 'permalink.php', 'profile.php', 'search', 'messages', 'friends', 'videos')
      AND (v_lpath = v_first OR v_lpath ~ ('^[^/]+/(?:' || 'about|about_contact_and_basic_info|directory_contact_info|photos|friends|videos|followers|following|reels' || ')$')) THEN
      RETURN v_first;
    END IF;
    RETURN v_generic;
  END IF;

  IF p_kind = 'post_link' THEN
    m := regexp_match(v_path, '^groups/([^/]+)/(?:posts|permalink|pending_posts)/([^/]+)', 'i');
    IF m IS NOT NULL THEN
      RETURN 'facebook.com/groups/' || lower(m[1]) || '/posts/' || CASE WHEN m[2] ~* '^pfbid' THEN m[2] ELSE lower(m[2]) END;
    END IF;
    v_id := substring(v_q FROM '(?:^|&)multi_permalinks=([^&%,]+)');
    m := regexp_match(v_lpath, '^groups/([^/]+)$');
    IF v_id IS NOT NULL AND m IS NOT NULL THEN
      RETURN 'facebook.com/groups/' || m[1] || '/posts/' || CASE WHEN v_id ~* '^pfbid' THEN v_id ELSE lower(v_id) END;
    END IF;
    IF v_lpath ~ '^(permalink|story)\.php$' THEN
      v_id := substring(v_q FROM '(?:^|&)story_fbid=([^&]+)');
      IF v_id IS NOT NULL THEN
        RETURN 'facebook.com/story/' || CASE WHEN v_id ~* '^pfbid' THEN v_id ELSE lower(v_id) END
          || '/' || COALESCE(substring(v_q FROM '(?:^|&)id=([0-9]+)'), '');
      END IF;
    END IF;
    m := regexp_match(v_path, '^([^/]+)/posts/([^/]+)');
    IF m IS NOT NULL AND lower(m[1]) <> 'groups' THEN
      RETURN 'facebook.com/' || lower(m[1]) || '/posts/' || CASE WHEN m[2] ~* '^pfbid' THEN m[2] ELSE lower(m[2]) END;
    END IF;
    IF v_lpath ~ '^photo(\.php)?$' AND substring(v_q FROM '(?:^|&)fbid=([0-9]+)') IS NOT NULL THEN
      RETURN 'facebook.com/photo/' || substring(v_q FROM '(?:^|&)fbid=([0-9]+)');
    END IF;
    m := regexp_match(v_lpath, '^[^/]+/photos/(?:[^/]+/)?([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/photo/' || m[1]; END IF;
    IF v_lpath = 'watch' AND substring(v_q FROM '(?:^|&)v=([0-9]+)') IS NOT NULL THEN
      RETURN 'facebook.com/video/' || substring(v_q FROM '(?:^|&)v=([0-9]+)');
    END IF;
    m := regexp_match(v_lpath, '^(?:[^/]+/)?videos/(?:[^/]+/)*([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/video/' || m[1]; END IF;
    m := regexp_match(v_lpath, '^reel/([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/reel/' || m[1]; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/share/' || lower(m[1]) || '/' || m[2]; END IF;
    RETURN v_generic;
  END IF;

  RETURN v_generic;
END;
$function$;

CREATE FUNCTION private.aka_agent_find_data_match_tokens(p_kind text, p_value text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN ARRAY[COALESCE(NULLIF(public.normalize_phone(btrim(COALESCE(p_value, ''))), ''), '')]
    WHEN COALESCE(p_value, '') ~ '[A-Za-z0-9]' THEN regexp_split_to_array(lower(p_value), '[^a-z0-9]+')
    -- Không có chữ / số nào: lấy khoá làm mảnh (hiếm, chỉ data rác).
    ELSE ARRAY[COALESCE(private.aka_agent_find_data_match_key(p_kind, p_value), '')]
  END
$function$;

REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_tokens(text, text) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_tokens(text, text) FROM %I', r);
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

  -- Data gửi lên: khoá do DB tính (không dùng khoá app gửi), bỏ dòng thiếu giá trị / khoá, mỗi khoá giữ dòng đầu tiên.
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

      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng khoá (khoá DB tính, nên data khách
      -- nhập kiểu khác vẫn nhận ra). Khoá đầy đủ chỉ tính cho dòng có chung ít nhất một mảnh chữ / số (trừ tên miền, từ khoá đường
      -- dẫn) với data gửi lên; khoá ghép từ chính các đoạn của giá trị nên cùng khoá thì luôn chung mảnh.
      WITH item_tokens AS MATERIALIZED (
        SELECT DISTINCT t.tok
          FROM jsonb_to_recordset(v_items) AS i(value text)
          CROSS JOIN LATERAL unnest(private.aka_agent_find_data_match_tokens(v_kind, i.value)) AS t(tok)
         WHERE t.tok <> ALL (ARRAY['', 'http', 'https', 'www', 'm', 'mbasic', 'mobile', 'web', 'touch', 'facebook', 'fb', 'com', 'zalo', 'me', 'groups', 'posts', 'permalink', 'pending', 'profile', 'php', 'id', 'user', 'story', 'fbid', 'share', 'multi', 'permalinks', 'marketplace', 'people', 'photo', 'photos', 'videos', 'watch', 'reel', 'g', 'p', 'v', 'r', 'cft', 'tn', 'mibextid', 'ref', 'comment']::text[])
      ), target_keys AS MATERIALIZED (
        SELECT DISTINCT private.aka_agent_find_data_match_key(v_kind, t.raw) AS k
          FROM (
            SELECT CASE WHEN v_rule.value_column = 'phone' THEN x.phone ELSE x.uid END AS raw
              FROM public.auto_campaign_input_data AS x
             WHERE x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
          ) AS t
         WHERE EXISTS (
           SELECT 1 FROM unnest(private.aka_agent_find_data_match_tokens(v_kind, t.raw)) AS r(tok)
            WHERE r.tok IN (SELECT tok FROM item_tokens)
         )
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

DROP FUNCTION private.aka_agent_find_data_coarse_key(text, text);

-- Sổ đẩy ghi trước bản này mang khoá cũ: tính lại theo khoá mới. Hai dòng cùng liên kết ra cùng khoá thì giữ một
-- (ưu tiên dòng "inserted", rồi dòng cũ nhất). Đổi qua khoá tạm trước để không vướng ràng buộc duy nhất (link_id, value_key).
CREATE TEMP TABLE v614_rekey ON COMMIT DROP AS
  SELECT d.id, d.link_id, d.result, d.created_at,
         COALESCE(left(private.aka_agent_find_data_match_key(r.output_kind, d.value), 2048), d.value_key) AS nk
    FROM public.auto_campaign_data_link_deliveries AS d
    JOIN public.auto_campaign_data_links AS l ON l.id = d.link_id
    JOIN public.auto_campaign_data_link_rules AS r ON r.id = l.rule_id;
DELETE FROM public.auto_campaign_data_link_deliveries AS d
 USING (SELECT id, row_number() OVER (PARTITION BY link_id, nk ORDER BY (result = 'inserted') DESC, created_at, id) AS rn FROM v614_rekey) AS x
 WHERE d.id = x.id AND x.rn > 1;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = '~' || d.id
  FROM v614_rekey AS x WHERE d.id = x.id AND d.value_key IS DISTINCT FROM x.nk;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = x.nk
  FROM v614_rekey AS x WHERE d.id = x.id AND d.value_key = '~' || d.id;

DO $post$
DECLARE
  v_bad text;
BEGIN
  -- Các cách viết của cùng một data ra cùng khoá.
  SELECT string_agg(format('%s:%s→%s≠%s', c.kind, c.a, private.aka_agent_find_data_match_key(c.kind, c.a),
                           private.aka_agent_find_data_match_key(c.kind, c.b)), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/profile.php?id=100072022092879'),
      ('facebook_uid', '100072022092879', 'https://m.facebook.com/profile.php?id=100072022092879&comment_id=Y29tbWVudA%3D%3D'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/groups/975457975877822/user/100072022092879/?__cft__[0]=AZj&__tn__=R'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/marketplace/profile/100072022092879/?product_id=1&__cft__[0]=AZ'),
      ('facebook_uid', '100072022092879', 'facebook.com/100072022092879/'),
      ('facebook_uid', 'huan.khanh.1840', 'https://www.facebook.com/huan.khanh.1840/'),
      ('facebook_uid', 'https://www.facebook.com/photo/?fbid=164&set=a.107/', 'https://www.facebook.com/photo/?fbid=164&set=a.107'),
      ('facebook_uid', 'https://web.facebook.com/Huan.Khanh.1840?mibextid=abc', 'https://www.facebook.com/huan.khanh.1840/about'),
      ('facebook_group', '1856052657967796', 'https://www.facebook.com/groups/1856052657967796/'),
      ('facebook_group', 'https://www.facebook.com/groups/12345/', 'https://m.facebook.com/groups/12345?ref=share'),
      ('facebook_group', 'https://www.facebook.com/groups/AbcShop/', 'facebook.com/groups/abcshop'),
      ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://m.facebook.com/profile.php?id=61573525756908&mibextid=x'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://m.facebook.com/groups/1/posts/2?__cft__[0]=AZ&__tn__=R'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/permalink/2/'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/pending_posts/2'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/?multi_permalinks=2&ref=share'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://web.facebook.com/permalink.php?id=6157&story_fbid=pfbid0X&mibextid=abc'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://www.facebook.com/story.php?story_fbid=pfbid0X&id=6157'),
      ('post_link', 'https://www.facebook.com/inkien/posts/pfbid0itURo', 'https://m.facebook.com/inkien/posts/pfbid0itURo/?__cft__[0]=x'),
      ('post_link', 'https://www.facebook.com/watch/?v=123456', 'https://www.facebook.com/abc/videos/123456/'),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', ' HTTPS://ZALO.ME/G/ABCDEF123/ '),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', 'zalo.me/g/abcdef123?src=share'),
      ('phone', '0985794636', '+84 985 794 636')
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_match_key(c.kind, c.a) IS DISTINCT FROM private.aka_agent_find_data_match_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: khoá khác nhau: %', v_bad; END IF;
  -- Cùng khoá thì chung ít nhất một mảnh (bước lọc nhanh không bỏ sót).
  SELECT string_agg(format('%s:%s', c.kind, c.a), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/profile.php?id=100072022092879'),
      ('facebook_uid', '100072022092879', 'https://m.facebook.com/profile.php?id=100072022092879&comment_id=Y29tbWVudA%3D%3D'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/groups/975457975877822/user/100072022092879/?__cft__[0]=AZj&__tn__=R'),
      ('facebook_uid', '100072022092879', 'https://www.facebook.com/marketplace/profile/100072022092879/?product_id=1&__cft__[0]=AZ'),
      ('facebook_uid', '100072022092879', 'facebook.com/100072022092879/'),
      ('facebook_uid', 'huan.khanh.1840', 'https://www.facebook.com/huan.khanh.1840/'),
      ('facebook_uid', 'https://www.facebook.com/photo/?fbid=164&set=a.107/', 'https://www.facebook.com/photo/?fbid=164&set=a.107'),
      ('facebook_uid', 'https://web.facebook.com/Huan.Khanh.1840?mibextid=abc', 'https://www.facebook.com/huan.khanh.1840/about'),
      ('facebook_group', '1856052657967796', 'https://www.facebook.com/groups/1856052657967796/'),
      ('facebook_group', 'https://www.facebook.com/groups/12345/', 'https://m.facebook.com/groups/12345?ref=share'),
      ('facebook_group', 'https://www.facebook.com/groups/AbcShop/', 'facebook.com/groups/abcshop'),
      ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://m.facebook.com/profile.php?id=61573525756908&mibextid=x'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://m.facebook.com/groups/1/posts/2?__cft__[0]=AZ&__tn__=R'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/permalink/2/'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/pending_posts/2'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/?multi_permalinks=2&ref=share'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://web.facebook.com/permalink.php?id=6157&story_fbid=pfbid0X&mibextid=abc'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://www.facebook.com/story.php?story_fbid=pfbid0X&id=6157'),
      ('post_link', 'https://www.facebook.com/inkien/posts/pfbid0itURo', 'https://m.facebook.com/inkien/posts/pfbid0itURo/?__cft__[0]=x'),
      ('post_link', 'https://www.facebook.com/watch/?v=123456', 'https://www.facebook.com/abc/videos/123456/'),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', ' HTTPS://ZALO.ME/G/ABCDEF123/ '),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', 'zalo.me/g/abcdef123?src=share'),
      ('phone', '0985794636', '+84 985 794 636')
    ) AS c(kind, a, b)
   WHERE NOT EXISTS (
     SELECT 1 FROM unnest(private.aka_agent_find_data_match_tokens(c.kind, c.a)) AS x(tok)
      WHERE x.tok <> ALL (ARRAY['', 'http', 'https', 'www', 'm', 'mbasic', 'mobile', 'web', 'touch', 'facebook', 'fb', 'com', 'zalo', 'me', 'groups', 'posts', 'permalink', 'pending', 'profile', 'php', 'id', 'user', 'story', 'fbid', 'share', 'multi', 'permalinks', 'marketplace', 'people', 'photo', 'photos', 'videos', 'watch', 'reel', 'g', 'p', 'v', 'r', 'cft', 'tn', 'mibextid', 'ref', 'comment']::text[])
        AND x.tok = ANY (private.aka_agent_find_data_match_tokens(c.kind, c.b)));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: cùng khoá mà không chung mảnh: %', v_bad; END IF;
  -- Data khác nhau ra khoá khác nhau.
  SELECT string_agg(format('%s:%s=%s', c.kind, c.a, c.b), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_uid', '100072022092879', '1000720220928790'),
      ('facebook_uid', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid022tp6iCho', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid02bJD7Puwm'),
      ('facebook_uid', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid022tp6iCho', 'https://www.facebook.com/phuonguyen.vu.3766'),
      ('facebook_uid', 'https://www.facebook.com/profile.php?id=10007202', 'https://www.facebook.com/profile.php?id=100072022'),
      ('facebook_group', 'https://www.facebook.com/groups/1/', 'https://www.facebook.com/groups/12/'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=a&id=1', 'https://www.facebook.com/permalink.php?story_fbid=b&id=1'),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/posts/3/'),
      ('post_link', 'https://www.facebook.com/share/p/1AbCdEfGhI/', 'https://www.facebook.com/share/p/1abcdefghi/'),
      ('facebook_group', 'https://www.facebook.com/share/g/1AbCdEfGhI/', 'https://www.facebook.com/share/g/1abcdefghi/'),
      ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://www.facebook.com/profile.php?id=61573768148044'),
      ('facebook_uid', 'https://www.facebook.com/photo/?fbid=111', 'https://www.facebook.com/photo/?fbid=222'),
      ('zalo_group_link', 'https://zalo.me/g/abc123', 'https://zalo.me/g/abc124'),
      ('phone', '0985794636', '0985794637')
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_match_key(c.kind, c.a) = private.aka_agent_find_data_match_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: hai data khác nhau ra cùng khoá: %', v_bad; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> 'a9298a62cd6860f32bb2001b5f52388e'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> 'eced466b2910026db6c75178da5b09d1'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_tokens(text, text)'::regprocedure) <> '4358d2a568d9ad08addcdffc15262af2'
  THEN
    RAISE EXCEPTION 'V614 postflight: thân hàm khác bản sinh';
  END IF;
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V614 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF has_function_privilege('aka_agent_desktop', 'private.aka_agent_find_data_match_tokens(text, text)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'private.aka_agent_find_data_match_key(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V614 postflight: aka_agent_desktop không được gọi thẳng hàm khoá';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaign_data_link_deliveries WHERE value_key LIKE '~%') THEN
    RAISE EXCEPTION 'V614 postflight: sổ đẩy còn khoá tạm';
  END IF;
END $post$;

COMMIT;
$ledger_ab57736f6222$]);
COMMIT;
