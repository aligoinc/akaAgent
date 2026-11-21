-- V608: đẩy data của chiến dịch tìm data sang chiến dịch đích qua DB (quy tắc + liên kết + sổ đẩy).
--
-- Vì sao (rà 21/11/2026, docs/FIND_DATA_PUSH_LINKS_V608.md):
--   * App tự thêm dòng data vào chiến dịch đích; đích đã xoá hoặc đích chạy bằng Nhóm data bị từ chối mà khách không được báo
--     (21/11: 153 + 17 trên 365 liên kết; chiến dịch 34369 mất 8.042 group trong 30 ngày).
--   * Lọc trùng chỉ theo lịch sử của chính chiến dịch nguồn: nhiều chiến dịch nguồn cùng đẩy vào một đích thì đích nhận trùng
--     (30 ngày: "Tham gia group" 226 group / 334 dòng thừa).
--   * Quy tắc "đầu ra nào của chiến dịch tìm data đi sang loại chiến dịch nào" viết cứng trong code app; liên kết A → B chỉ là
--     mảng id trong extra_settings; không có sổ ghi data nào đã đẩy từ A sang B.
--
-- Nội dung (chỉ thêm đối tượng mới, không ALTER bảng có sẵn, không trigger trên bảng nóng):
--   1. public.auto_campaign_data_link_rules: quy tắc nguồn → đích (đầu ra, khoá bật, khoá chứa id đích, loại chiến dịch đích,
--      loại dữ liệu ngữ nghĩa, cột ghi giá trị). Đích phải nhận loại dữ liệu đó theo auto_campaign_action_data_types (can_target).
--   2. public.auto_campaign_data_links: mỗi liên kết (chiến dịch nguồn, quy tắc, chiến dịch đích) và trạng thái
--      active / blocked (kèm lý do) / removed; điền sẵn từ extra_settings của các chiến dịch tìm data hiện có.
--   3. public.auto_campaign_data_link_deliveries: sổ đẩy, mỗi (liên kết, khoá data) một dòng: inserted / existing.
--   4. public.aka_agent_find_data_push_v1(jsonb): Desktop gọi sau mỗi lượt "Tìm data" (thay việc tự thêm dòng): kiểm đích,
--      lọc trùng theo data đang có ở đích + sổ đẩy của đích (mọi nguồn), thêm dòng "chờ xử lý", mở lại đích "hoàn thành",
--      ghi sổ; trả kết quả từng đích để app in tiến trình. Đích không nhận được thì trả "blocked" + lý do, không thêm gì.
--
-- App cũ (chưa gọi hàm) vẫn tự thêm dòng như trước; hàm mới thấy các dòng đó qua phần kiểm "đã có ở đích".
-- Sinh tay, kiểm bằng scripts/find-data-push/test_v608.sh (PG16 cục bộ). Gỡ: migrations/rollback_v608_find_data_push_links.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v608_%') THEN
      RAISE EXCEPTION 'V608 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_campaign_data_link_rules') IS NOT NULL
    OR to_regclass('public.auto_campaign_data_links') IS NOT NULL
    OR to_regclass('public.auto_campaign_data_link_deliveries') IS NOT NULL
    OR to_regprocedure('public.aka_agent_find_data_push_v1(jsonb)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'V608: đối tượng của V608 đã có';
  END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'V608: thiếu private.aka_agent_desktop_data_context()';
  END IF;
  IF to_regprocedure('public.normalize_phone(text)') IS NULL THEN
    RAISE EXCEPTION 'V608: thiếu public.normalize_phone(text)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    RAISE EXCEPTION 'V608: thiếu role aka_agent_desktop';
  END IF;
  SELECT string_agg(a.id, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'facebook_find_data_group', 'facebook_find_data_search', 'facebook_message_uid', 'facebook_comment_seeding_post',
      'zalo_message_phone', 'zalo_join_group_link', 'facebook_group_post', 'facebook_comment_seeding', 'facebook_join_group'
    ]) AS a(id)
   WHERE NOT EXISTS (SELECT 1 FROM public.auto_campaign_actions AS x WHERE x.id = a.id);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'V608: thiếu loại chiến dịch: %', v_missing;
  END IF;
  SELECT string_agg(c.code, ', ') INTO v_missing
    FROM unnest(ARRAY['phone', 'zalo_group', 'facebook_person', 'facebook_post_url', 'facebook_group']) AS c(code)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.category_item AS ci JOIN public.category_type AS ct ON ct.id = ci.category_type_id
      WHERE ct.code = 'data_type' AND ci.code = c.code
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'V608: thiếu loại dữ liệu: %', v_missing;
  END IF;
  -- Mỗi quy tắc đều phải có chiến dịch đích nhận đúng loại dữ liệu (đọc auto_campaign_action_data_types như Tự động hóa).
  SELECT string_agg(r.target_action_id || '/' || r.code, ', ') INTO v_missing
    FROM (VALUES
      ('facebook_message_uid', 'facebook_person'), ('facebook_comment_seeding_post', 'facebook_post_url'),
      ('zalo_message_phone', 'phone'), ('zalo_join_group_link', 'zalo_group'), ('facebook_group_post', 'facebook_group'),
      ('facebook_comment_seeding', 'facebook_group'), ('facebook_join_group', 'facebook_group')
    ) AS r(target_action_id, code)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.auto_campaign_action_data_types AS m
       JOIN public.category_item AS ci ON ci.id = m.data_type_category_item_id
       JOIN public.category_type AS ct ON ct.id = ci.category_type_id AND ct.code = 'data_type'
      WHERE m.campaign_action_id = r.target_action_id AND ci.code = r.code
        AND m.can_target AND m.is_active AND NOT m.is_delete
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'V608: auto_campaign_action_data_types chưa cho loại chiến dịch nhận: %', v_missing;
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Quy tắc nguồn → đích
-- ---------------------------------------------------------------------------
CREATE TABLE public.auto_campaign_data_link_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_action_id text NOT NULL,
  output_kind text NOT NULL
    CHECK (output_kind IN ('phone', 'zalo_group_link', 'facebook_uid', 'post_link', 'facebook_group')),
  source_flag text NOT NULL CHECK (source_flag ~ '^[A-Za-z][A-Za-z0-9]*$'),
  link_field text NOT NULL CHECK (link_field ~ '^[A-Za-z][A-Za-z0-9]*$'),
  target_action_id text NOT NULL,
  data_type_category_item_id bigint NOT NULL,
  value_column text NOT NULL CHECK (value_column IN ('uid', 'phone')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_auto_campaign_data_link_rules_field UNIQUE (source_action_id, link_field)
);

COMMENT ON TABLE public.auto_campaign_data_link_rules IS
  'V608: quy tắc đẩy data của chiến dịch tìm data. Một dòng = đầu ra output_kind của source_action_id (bật bằng extra_settings.<source_flag>) '
  'đi sang các chiến dịch có id trong extra_settings.<link_field>, loại target_action_id, ghi vào cột value_column. '
  'Đích phải nhận loại dữ liệu data_type_category_item_id theo auto_campaign_action_data_types (can_target).';

INSERT INTO public.auto_campaign_data_link_rules
  (source_action_id, output_kind, source_flag, link_field, target_action_id, data_type_category_item_id, value_column, label)
SELECT r.source_action_id, r.output_kind, r.source_flag, r.link_field, r.target_action_id, ci.id, r.value_column, r.label
  FROM (VALUES
    ('facebook_find_data_group',  'facebook_uid',    'isFindUid',            'findUidTargetCampaignIds',                  'facebook_message_uid',          'facebook_person',   'uid',   'UID'),
    ('facebook_find_data_group',  'post_link',       'isFindPostLink',       'findPostLinkTargetCampaignIds',             'facebook_comment_seeding_post', 'facebook_post_url', 'uid',   'link bài post'),
    ('facebook_find_data_group',  'phone',           'isFindPhone',          'findPhoneZaloMessagePhoneTargetCampaignIds','zalo_message_phone',            'phone',             'phone', 'SĐT'),
    ('facebook_find_data_group',  'zalo_group_link', 'isFindLinkGroupZalo',  'findZaloGroupLinkJoinTargetCampaignIds',    'zalo_join_group_link',          'zalo_group',        'uid',   'link group Zalo'),
    ('facebook_find_data_search', 'facebook_uid',    'isFindUid',            'findUidTargetCampaignIds',                  'facebook_message_uid',          'facebook_person',   'uid',   'UID'),
    ('facebook_find_data_search', 'post_link',       'isFindPostLink',       'findPostLinkTargetCampaignIds',             'facebook_comment_seeding_post', 'facebook_post_url', 'uid',   'link bài post'),
    ('facebook_find_data_search', 'phone',           'isFindPhone',          'findPhoneZaloMessagePhoneTargetCampaignIds','zalo_message_phone',            'phone',             'phone', 'SĐT'),
    ('facebook_find_data_search', 'zalo_group_link', 'isFindLinkGroupZalo',  'findZaloGroupLinkJoinTargetCampaignIds',    'zalo_join_group_link',          'zalo_group',        'uid',   'link group Zalo'),
    ('facebook_find_data_search', 'facebook_group',  'isFindFacebookGroup',  'findFacebookGroupPostTargetCampaignIds',    'facebook_group_post',           'facebook_group',    'uid',   'link group Facebook'),
    ('facebook_find_data_search', 'facebook_group',  'isFindFacebookGroup',  'findFacebookGroupCommentTargetCampaignIds', 'facebook_comment_seeding',      'facebook_group',    'uid',   'link group Facebook'),
    ('facebook_find_data_search', 'facebook_group',  'isFindFacebookGroup',  'findFacebookGroupJoinTargetCampaignIds',    'facebook_join_group',           'facebook_group',    'uid',   'link group Facebook')
  ) AS r(source_action_id, output_kind, source_flag, link_field, target_action_id, data_type_code, value_column, label)
  JOIN public.category_type AS ct ON ct.code = 'data_type'
  JOIN public.category_item AS ci ON ci.category_type_id = ct.id AND ci.code = r.data_type_code;

-- ---------------------------------------------------------------------------
-- 2. Liên kết nguồn → đích
-- ---------------------------------------------------------------------------
CREATE TABLE public.auto_campaign_data_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id bigint NOT NULL REFERENCES public.auto_campaign_data_link_rules (id),
  source_campaign_id bigint NOT NULL,
  target_campaign_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'removed')),
  block_reason text NULL CHECK (block_reason IS NULL OR block_reason IN (
    'target_missing', 'target_deleted', 'target_other_owner', 'target_action_mismatch',
    'target_data_type_incompatible', 'target_data_group_mode', 'target_not_entitled'
  )),
  inserted_count bigint NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  existing_count bigint NOT NULL DEFAULT 0 CHECK (existing_count >= 0),
  last_push_at timestamptz NULL,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_auto_campaign_data_links UNIQUE (source_campaign_id, rule_id, target_campaign_id),
  CONSTRAINT auto_campaign_data_links_reason_check CHECK ((status = 'blocked') = (block_reason IS NOT NULL))
);

CREATE INDEX idx_auto_campaign_data_links_target ON public.auto_campaign_data_links (target_campaign_id);

COMMENT ON TABLE public.auto_campaign_data_links IS
  'V608: liên kết đẩy data (chiến dịch tìm data → chiến dịch đích theo một quy tắc). Đồng bộ từ extra_settings của chiến dịch nguồn '
  'mỗi lần aka_agent_find_data_push_v1 chạy; blocked = đích không nhận được (block_reason), removed = đã bỏ khỏi cấu hình.';

-- ---------------------------------------------------------------------------
-- 3. Sổ đẩy
-- ---------------------------------------------------------------------------
CREATE TABLE public.auto_campaign_data_link_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id bigint NOT NULL REFERENCES public.auto_campaign_data_links (id) ON DELETE CASCADE,
  source_campaign_id bigint NOT NULL,
  target_campaign_id bigint NOT NULL,
  value_key text NOT NULL CHECK (char_length(value_key) BETWEEN 1 AND 2048),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 2048),
  result text NOT NULL CHECK (result IN ('inserted', 'existing')),
  target_input_data_id bigint NULL,
  source_detail_id bigint NULL,
  source_input_data_id bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_auto_campaign_data_link_deliveries UNIQUE (link_id, value_key)
);

CREATE INDEX idx_auto_campaign_data_link_deliveries_target_key
  ON public.auto_campaign_data_link_deliveries (target_campaign_id, value_key)
  WHERE result = 'inserted';

COMMENT ON TABLE public.auto_campaign_data_link_deliveries IS
  'V608: sổ đẩy data của chiến dịch tìm data. inserted = đã thêm dòng target_input_data_id vào chiến dịch đích; '
  'existing = đích đã có data này (do app thêm trước, do nguồn khác đẩy, hoặc khách nhập) nên không thêm.';

ALTER TABLE public.auto_campaign_data_link_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_data_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_data_link_deliveries ENABLE ROW LEVEL SECURITY;

DO $grants$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.auto_campaign_data_link_rules', 'public.auto_campaign_data_links', 'public.auto_campaign_data_link_deliveries'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;

-- ---------------------------------------------------------------------------
-- 4. Lý do đích không nhận được (dùng chung cho điền sẵn và hàm đẩy)
-- ---------------------------------------------------------------------------
CREATE FUNCTION private.aka_agent_find_data_link_block_reason(
  p_rule_id bigint,
  p_staff_id bigint,
  p_organization_id bigint,
  p_target_campaign_id bigint,
  p_allowed_target_action_ids text[] DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rule public.auto_campaign_data_link_rules%ROWTYPE;
  v_target record;
BEGIN
  SELECT * INTO v_rule FROM public.auto_campaign_data_link_rules WHERE id = p_rule_id;
  SELECT c.id, c.staff_id, c.organization_id, c.action_id, COALESCE(c.is_delete, false) AS is_delete,
         c.data_target_source_mode
    INTO v_target
    FROM public.auto_campaigns AS c
   WHERE c.id = p_target_campaign_id;
  IF NOT FOUND THEN RETURN 'target_missing'; END IF;
  IF v_target.staff_id IS DISTINCT FROM p_staff_id OR v_target.organization_id IS DISTINCT FROM p_organization_id THEN
    RETURN 'target_other_owner';
  END IF;
  IF v_target.is_delete THEN RETURN 'target_deleted'; END IF;
  IF v_target.action_id IS DISTINCT FROM v_rule.target_action_id THEN RETURN 'target_action_mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_action_data_types AS m
     WHERE m.campaign_action_id = v_target.action_id
       AND m.data_type_category_item_id = v_rule.data_type_category_item_id
       AND m.can_target AND m.is_active AND NOT m.is_delete
  ) THEN
    RETURN 'target_data_type_incompatible';
  END IF;
  IF v_target.data_target_source_mode = 'data_group' THEN RETURN 'target_data_group_mode'; END IF;
  IF p_allowed_target_action_ids IS NOT NULL AND NOT (v_target.action_id = ANY (p_allowed_target_action_ids)) THEN
    RETURN 'target_not_entitled';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.aka_agent_find_data_link_block_reason(bigint, bigint, bigint, bigint, text[]) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_link_block_reason(bigint, bigint, bigint, bigint, text[]) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- Id chiến dịch đích trong một khoá extra_settings (mảng số / chuỗi số), bỏ trùng, bỏ chính nguồn, tối đa 50.
CREATE FUNCTION private.aka_agent_find_data_link_target_ids(p_extra jsonb, p_field text, p_source_campaign_id bigint)
RETURNS bigint[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT COALESCE(array_agg(t.id ORDER BY t.first_ord), ARRAY[]::bigint[])
    FROM (
      SELECT (e.value #>> '{}')::bigint AS id, min(e.ord) AS first_ord
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p_extra -> p_field) = 'array' THEN p_extra -> p_field ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS e(value, ord)
       WHERE jsonb_typeof(e.value) IN ('number', 'string')
         AND (e.value #>> '{}') ~ '^[0-9]{1,18}$'
         AND (e.value #>> '{}')::numeric > 0
         AND (e.value #>> '{}')::bigint IS DISTINCT FROM p_source_campaign_id
       GROUP BY 1
       ORDER BY 2
       LIMIT 50
    ) AS t
$function$;

REVOKE ALL ON FUNCTION private.aka_agent_find_data_link_target_ids(jsonb, text, bigint) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_link_target_ids(jsonb, text, bigint) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- ---------------------------------------------------------------------------
-- 5. Hàm đẩy data (Desktop, theo phiên)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)
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

  -- Data gửi lên: bỏ dòng thiếu giá trị / khoá, mỗi khoá giữ dòng đầu tiên (giữ thứ tự gửi).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ord', y.ord, 'value', y.value, 'value_key', y.value_key, 'name', y.name)
                            ORDER BY y.ord), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT DISTINCT ON (x.value_key) x.ord, x.value, x.value_key, x.name
        FROM (
          SELECT i.ord::integer AS ord,
                 left(btrim(i.item ->> 'value'), 2048) AS value,
                 left(btrim(i.item ->> 'key'), 2048) AS value_key,
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

      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng giá trị.
      WITH plan AS (
        SELECT i.ord, i.value, i.value_key, i.name,
               EXISTS (
                 SELECT 1 FROM public.auto_campaign_data_link_deliveries AS d
                  WHERE d.target_campaign_id = v_target_id AND d.value_key = i.value_key AND d.result = 'inserted'
               )
               OR CASE v_rule.value_column
                 WHEN 'phone' THEN EXISTS (
                   SELECT 1 FROM public.auto_campaign_input_data AS x
                    WHERE md5(public.normalize_phone(x.phone)) = md5(public.normalize_phone(i.value))
                      AND x.phone IS NOT NULL AND btrim(x.phone) <> ''
                      AND x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
                 )
                 ELSE EXISTS (
                   SELECT 1 FROM public.auto_campaign_input_data AS x
                    WHERE md5(lower(btrim(x.uid))) = md5(lower(btrim(i.value)))
                      AND x.uid IS NOT NULL AND btrim(x.uid) <> ''
                      AND x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
                 )
               END AS already
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

COMMENT ON FUNCTION public.aka_agent_find_data_push_v1(jsonb) IS
  'V608: Desktop đẩy data tìm được của một lượt "Tìm data" sang các chiến dịch đích theo auto_campaign_data_link_rules. '
  'payload {sourceCampaignId, outputKind, items:[{value,key,name}], sourceDetailId?, sourceInputDataId?, allowedTargetActionIds?}. '
  'Trả {ok, targets:[{targetCampaignId, status delivered|blocked, reason, inserted, existing, reopened}]}.';

REVOKE ALL ON FUNCTION public.aka_agent_find_data_push_v1(jsonb) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_find_data_push_v1(jsonb) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_find_data_push_v1(jsonb) TO aka_agent_desktop;

-- ---------------------------------------------------------------------------
-- 6. Điền sẵn liên kết từ cấu hình hiện có (chiến dịch tìm data chưa xoá)
-- ---------------------------------------------------------------------------
INSERT INTO public.auto_campaign_data_links
  (rule_id, source_campaign_id, target_campaign_id, status, block_reason, staff_id, organization_id)
SELECT x.rule_id, x.source_campaign_id, x.target_campaign_id,
       CASE WHEN x.reason IS NULL THEN 'active' ELSE 'blocked' END, x.reason, x.staff_id, x.organization_id
  FROM (
    SELECT r.id AS rule_id, c.id AS source_campaign_id, t.target_id AS target_campaign_id, c.staff_id, c.organization_id,
           private.aka_agent_find_data_link_block_reason(r.id, c.staff_id, c.organization_id, t.target_id, NULL) AS reason
      FROM public.auto_campaigns AS c
      JOIN public.auto_campaign_data_link_rules AS r ON r.source_action_id = c.action_id
      CROSS JOIN LATERAL unnest(private.aka_agent_find_data_link_target_ids(c.extra_settings, r.link_field, c.id)) AS t(target_id)
     WHERE c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search')
       AND NOT COALESCE(c.is_delete, false)
       AND c.staff_id IS NOT NULL AND c.organization_id IS NOT NULL
       AND COALESCE(c.extra_settings ->> r.source_flag, 'false') = 'true'
  ) AS x
ON CONFLICT (source_campaign_id, rule_id, target_campaign_id) DO NOTHING;

DO $post$
DECLARE
  v_bad text;
BEGIN
  IF (SELECT count(*) FROM public.auto_campaign_data_link_rules) <> 11 THEN
    RAISE EXCEPTION 'V608 postflight: cần 11 quy tắc, có %', (SELECT count(*) FROM public.auto_campaign_data_link_rules);
  END IF;
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V608 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V608 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  SELECT string_agg(rolname || ':' || t, ', ') INTO v_bad
    FROM pg_roles
   CROSS JOIN unnest(ARRAY['public.auto_campaign_data_link_rules', 'public.auto_campaign_data_links',
                           'public.auto_campaign_data_link_deliveries']) AS t
   WHERE rolname IN ('anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api')
     AND (has_table_privilege(rolname, t, 'SELECT') OR has_table_privilege(rolname, t, 'INSERT')
          OR has_table_privilege(rolname, t, 'UPDATE') OR has_table_privilege(rolname, t, 'DELETE'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V608 postflight: role còn quyền bảng: %', v_bad; END IF;
END $post$;

COMMIT;
