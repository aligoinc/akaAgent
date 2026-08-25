-- Incremental Data Group dynamic filters.
--
-- Live source captured from linked project cgjbsmqtfhqvttudyjzq on 2026-08-25:
--   auto_assert_automation_identity(bigint,bigint,text,text)
--     md5(pg_get_functiondef) = 5a9a503db72b965eb644739f5f60905d
--   aka_agent_data_group_source_code(text)
--     md5(pg_get_functiondef) = 01de504815302ef94d7c53d711aedfde
--
-- Target checksums captured from a full linked-project rollback validation:
--   aka_agent_data_group_source_code(text)
--     4c1ea3a984cd3c3c38d04b6ee6be8e3b
--   aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)
--     c891b833f9d1624ef60fbd119cb4842c
--   aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)
--     2b21dad2b96491d4d6b07f652061b5bf
--   aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text)
--     1ac138afc4cd0b4a84ec80a9a765b2be
--   aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)
--     645fd3e31e2096b61c820b622c64152e
--
-- Every new signature and table below was absent live. The source-code helper
-- is replaced only to add the dynamic_filter mapping; all attributes and ACLs
-- from the captured live definition are preserved.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE
  v_auth oid := pg_catalog.to_regprocedure(
    'public.auto_assert_automation_identity(bigint,bigint,text,text)'
  );
  v_source_code oid := pg_catalog.to_regprocedure(
    'public.aka_agent_data_group_source_code(text)'
  );
  v_signature text;
BEGIN
  IF v_auth IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_auth))
      IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d'
  THEN
    RAISE EXCEPTION 'v250_auth_guard_missing_or_changed';
  END IF;

  IF v_source_code IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_source_code))
      IS DISTINCT FROM '01de504815302ef94d7c53d711aedfde'
  THEN
    RAISE EXCEPTION 'v250_data_group_source_helper_missing_or_changed';
  END IF;

  IF pg_catalog.to_regclass('public.auto_account_contact_group_dynamic_filters') IS NOT NULL
    OR pg_catalog.to_regclass('public.auto_account_contact_group_dynamic_filter_rules') IS NOT NULL
    OR pg_catalog.to_regclass('public.auto_account_contact_dynamic_filter_queue') IS NOT NULL
  THEN
    RAISE EXCEPTION 'v250_dynamic_filter_table_already_exists';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_dynamic_filter_enqueue_contact()',
    'public.aka_agent_dynamic_filter_enqueue_group_member()',
    'public.aka_agent_dynamic_filter_sync_chat_contact()',
    'public.aka_agent_dynamic_filter_catalog_json(text)',
    'public.aka_agent_data_group_dynamic_values_match(bigint,text,text[])',
    'public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint)',
    'public.aka_agent_data_group_dynamic_scope_matches(bigint,bigint,text)',
    'public.aka_agent_data_group_dynamic_draft_scope_matches(jsonb,bigint,text)',
    'public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)',
    'public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)',
    'public.aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text)',
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  ]
  LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NOT NULL THEN
      RAISE EXCEPTION 'v250_unexpected_existing_signature:%', v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.to_regclass('public.chat_zalo_account_conversation_tag') IS NULL
    OR pg_catalog.to_regclass('public.chat_zalo_account_tag') IS NULL
    OR pg_catalog.to_regclass('public.chat_zalo_account_conversation') IS NULL
    OR pg_catalog.to_regclass('public.chat_zalo_account_organization') IS NULL
  THEN
    RAISE EXCEPTION 'v250_chat_zalo_tag_schema_missing';
  END IF;
END;
$preflight$;

-- -------------------------------------------------------------------------
-- Category-backed catalogs. Entity values (tags, groups, accounts) continue
-- to live in their canonical entity tables; only categorical choices are
-- stored in category_type/category_item.
-- -------------------------------------------------------------------------

WITH type_seed(code, name, description) AS (
  VALUES
    ('data_filter_scope', 'Phạm vi bộ lọc data', 'Điều kiện đưa data vào hoặc loại data ra khỏi nhóm.'),
    ('data_filter_join', 'Phép nối bộ lọc data', 'Cách một điều kiện tham gia biểu thức VÀ/HOẶC.'),
    ('data_filter_operator', 'Toán tử bộ lọc data', 'Toán tử so sánh dùng cho bộ lọc động.'),
    ('data_filter_field', 'Trường bộ lọc data', 'Nguồn dữ liệu được dùng để đánh giá một điều kiện.'),
    ('zalo_friend_status', 'Trạng thái kết bạn Zalo', 'Trạng thái quan hệ bạn bè của contact Zalo.'),
    ('data_filter_queue_reason', 'Lý do đánh giá lại bộ lọc', 'Nguồn thay đổi làm contact cần được đánh giá lại.')
)
INSERT INTO public.category_type (
  namespace, code, name, managed_by, description, is_active
)
SELECT 'common', type_seed.code, type_seed.name, 'system', type_seed.description, true
FROM type_seed
ON CONFLICT (namespace, code) DO UPDATE SET
  name = EXCLUDED.name,
  managed_by = 'system',
  description = EXCLUDED.description,
  is_active = true,
  updated_at = clock_timestamp();

WITH item_seed(type_code, code, name, sort_order, description, metadata) AS (
  VALUES
    ('data_filter_scope', 'enter', 'Vào nhóm', 10, 'Biểu thức quyết định data đủ điều kiện vào nhóm.', '{}'::jsonb),
    ('data_filter_scope', 'leave', 'Ra khỏi nhóm', 20, 'Biểu thức chủ động loại data khỏi nguồn động.', '{}'::jsonb),
    ('data_filter_join', 'and', 'VÀ', 10, 'Tham gia nhánh bắt buộc; mọi điều kiện VÀ phải cùng thỏa mãn.', '{}'::jsonb),
    ('data_filter_join', 'or', 'HOẶC', 20, 'Một nhánh thay thế độc lập; chỉ cần điều kiện này thỏa mãn.', '{}'::jsonb),
    ('data_filter_operator', 'contains', 'chứa', 10, 'Có ít nhất một giá trị đã chọn.', '{"negative":false}'::jsonb),
    ('data_filter_operator', 'not_contains', 'không chứa', 20, 'Không có bất kỳ giá trị đã chọn nào.', '{"negative":true}'::jsonb),
    ('data_filter_operator', 'equals', 'bằng', 30, 'Trạng thái hoặc quan hệ bằng một giá trị đã chọn.', '{"negative":false}'::jsonb),
    ('data_filter_operator', 'not_equals', 'không bằng', 40, 'Trạng thái hoặc quan hệ không bằng các giá trị đã chọn.', '{"negative":true}'::jsonb),
    ('data_filter_operator', 'in', 'vào', 50, 'Đang thuộc quan hệ hoặc tập hợp đã chọn.', '{"negative":false}'::jsonb),
    ('data_filter_operator', 'out', 'ra', 60, 'Không còn thuộc quan hệ hoặc tập hợp đã chọn.', '{"negative":true}'::jsonb),
    ('data_filter_field', 'zalo_tag', 'Tag Zalo', 10, 'Tag gắn trên chính tài khoản Zalo.', '{"operators":["contains","not_contains","equals","not_equals"]}'::jsonb),
    ('data_filter_field', 'akabiz_tag', 'Tag akaBiz', 20, 'Tag nội bộ do akaBiz quản lý.', '{"operators":["contains","not_contains","equals","not_equals"]}'::jsonb),
    ('data_filter_field', 'zalo_group_membership', 'Trạng thái thành viên group Zalo', 30, 'Contact đang vào hoặc đã ra một group Zalo.', '{"operators":["in","out","equals","not_equals"]}'::jsonb),
    ('data_filter_field', 'zalo_friend_status', 'Trạng thái kết bạn Zalo', 40, 'Đã là bạn, chưa là bạn, đã gửi lời mời hoặc chưa rõ.', '{"operators":["equals","not_equals","in","out"]}'::jsonb),
    ('zalo_friend_status', 'friend', 'Đã là bạn', 10, 'Contact được xác nhận là bạn bè.', '{}'::jsonb),
    ('zalo_friend_status', 'not_friend', 'Chưa là bạn', 20, 'Contact được xác nhận không phải bạn bè.', '{}'::jsonb),
    ('zalo_friend_status', 'request_sent', 'Đã gửi lời mời', 30, 'Contact có dấu vết lời mời kết bạn đã gửi.', '{}'::jsonb),
    ('zalo_friend_status', 'unknown', 'Chưa xác định', 40, 'Chưa có đủ dữ liệu quan hệ bạn bè.', '{}'::jsonb),
    ('data_filter_queue_reason', 'contact_changed', 'Contact thay đổi', 10, 'Dữ liệu contact liên quan điều kiện đã thay đổi.', '{}'::jsonb),
    ('data_filter_queue_reason', 'zalo_tag_changed', 'Tag Zalo thay đổi', 20, 'Quan hệ tag Zalo của hội thoại đã thay đổi.', '{}'::jsonb),
    ('data_filter_queue_reason', 'group_membership_changed', 'Thành viên group thay đổi', 30, 'Quan hệ thành viên group Zalo đã thay đổi.', '{}'::jsonb),
    ('data_filter_queue_reason', 'filter_saved', 'Bộ lọc được lưu', 40, 'Cấu hình bộ lọc thay đổi và cần đối chiếu lại.', '{}'::jsonb)
)
INSERT INTO public.category_item (
  category_type_id, code, name, managed_by, description,
  sort_order, external_id, metadata, is_active
)
SELECT
  category_type.id,
  item_seed.code,
  item_seed.name,
  'system',
  item_seed.description,
  item_seed.sort_order,
  item_seed.code,
  item_seed.metadata,
  true
FROM item_seed
JOIN public.category_type AS category_type
  ON category_type.namespace = 'common'
 AND category_type.code = item_seed.type_code
ON CONFLICT (category_type_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  managed_by = 'system',
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  external_id = EXCLUDED.external_id,
  metadata = EXCLUDED.metadata,
  is_active = true,
  updated_at = clock_timestamp();

WITH data_source AS (
  SELECT id
  FROM public.category_type
  WHERE namespace = 'common' AND code = 'data_source' AND is_active = true
)
INSERT INTO public.category_item (
  category_type_id, code, name, managed_by, description,
  sort_order, external_id, metadata, is_active
)
SELECT
  data_source.id,
  'dynamic_filter',
  'Bộ lọc động',
  'system',
  'Data tự vào hoặc ra khỏi Data Group theo bộ lọc động.',
  40,
  'dynamic_filter',
  '{}'::jsonb,
  true
FROM data_source
ON CONFLICT (category_type_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  managed_by = 'system',
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  external_id = EXCLUDED.external_id,
  metadata = EXCLUDED.metadata,
  is_active = true,
  updated_at = clock_timestamp();

-- Exact captured live body plus one additive mapping.
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_source_code(
  p_origin_kind text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_origin_kind, '')))
    WHEN 'manual' THEN 'upload'
    WHEN 'upload' THEN 'upload'
    WHEN 'scan' THEN 'scan'
    WHEN 'automation' THEN 'automation'
    WHEN 'dynamic_filter' THEN 'dynamic_filter'
    ELSE NULL
  END;
$function$;

ALTER FUNCTION public.aka_agent_data_group_source_code(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_data_group_source_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_data_group_source_code(text) TO postgres;

-- -------------------------------------------------------------------------
-- Durable config, category-backed rules and a contact-deduplicated queue.
-- -------------------------------------------------------------------------

CREATE TABLE public.auto_account_contact_group_dynamic_filters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  evaluation_interval_minutes integer NOT NULL DEFAULT 15,
  last_evaluated_at timestamptz,
  next_evaluation_at timestamptz,
  matched_count bigint NOT NULL DEFAULT 0,
  last_entered_count integer NOT NULL DEFAULT 0,
  last_exited_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_data_group_dynamic_filter_group UNIQUE (group_id),
  CONSTRAINT data_group_dynamic_filter_interval_check
    CHECK (evaluation_interval_minutes BETWEEN 1 AND 1440),
  CONSTRAINT data_group_dynamic_filter_stats_check
    CHECK (matched_count >= 0 AND last_entered_count >= 0 AND last_exited_count >= 0)
);

CREATE TABLE public.auto_account_contact_group_dynamic_filter_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dynamic_filter_id bigint NOT NULL
    REFERENCES public.auto_account_contact_group_dynamic_filters(id) ON DELETE CASCADE,
  scope_category_item_id bigint NOT NULL REFERENCES public.category_item(id) ON DELETE RESTRICT,
  join_category_item_id bigint NOT NULL REFERENCES public.category_item(id) ON DELETE RESTRICT,
  field_category_item_id bigint NOT NULL REFERENCES public.category_item(id) ON DELETE RESTRICT,
  operator_category_item_id bigint NOT NULL REFERENCES public.category_item(id) ON DELETE RESTRICT,
  account_id bigint REFERENCES public.auto_accounts(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  value_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_group_dynamic_filter_rule_values_check CHECK (
    jsonb_typeof(value_keys) = 'array'
    AND jsonb_typeof(value_labels) = 'array'
    AND jsonb_array_length(value_keys) BETWEEN 1 AND 50
    AND jsonb_array_length(value_labels) <= 50
  )
);

CREATE TABLE public.auto_account_contact_dynamic_filter_queue (
  contact_id bigint PRIMARY KEY REFERENCES public.auto_account_contacts(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  reason_category_item_id bigint NOT NULL REFERENCES public.category_item(id) ON DELETE RESTRICT,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  CONSTRAINT data_group_dynamic_filter_queue_attempt_check CHECK (attempt_count >= 0)
);

CREATE INDEX idx_data_group_dynamic_filters_scope
  ON public.auto_account_contact_group_dynamic_filters (
    staff_id, organization_id, is_enabled, updated_at, id
  );
CREATE INDEX idx_data_group_dynamic_filter_rules_filter_order
  ON public.auto_account_contact_group_dynamic_filter_rules (
    dynamic_filter_id, scope_category_item_id, sort_order, id
  );
CREATE INDEX idx_data_group_dynamic_filter_rules_field_account
  ON public.auto_account_contact_group_dynamic_filter_rules (
    field_category_item_id, account_id, dynamic_filter_id
  );
CREATE INDEX idx_data_group_dynamic_filter_queue_claim
  ON public.auto_account_contact_dynamic_filter_queue (
    staff_id, organization_id, queued_at, contact_id
  );
CREATE INDEX IF NOT EXISTS idx_auto_account_contacts_dynamic_filter_scope
  ON public.auto_account_contacts (
    staff_id, organization_id, flatform_type, contact_type, is_delete, id
  );
CREATE INDEX IF NOT EXISTS idx_zalo_group_members_dynamic_filter_lookup
  ON public.zalo_group_members (account_id, zalo_uid, is_current, zalo_group_id);

ALTER TABLE public.auto_account_contact_group_member_origins
  ADD COLUMN dynamic_filter_id bigint;
ALTER TABLE public.auto_account_contact_group_member_origins
  ADD CONSTRAINT auto_account_contact_group_member_origin_dynamic_filter_fkey
  FOREIGN KEY (dynamic_filter_id)
  REFERENCES public.auto_account_contact_group_dynamic_filters(id)
  ON DELETE CASCADE;

ALTER TABLE public.auto_account_contact_group_member_origins
  DROP CONSTRAINT auto_account_contact_group_member_origins_kind_check;
ALTER TABLE public.auto_account_contact_group_member_origins
  ADD CONSTRAINT auto_account_contact_group_member_origins_kind_check CHECK (
    kind = ANY (ARRAY[
      'manual'::text, 'upload'::text, 'scan'::text, 'automation'::text,
      'dynamic_filter'::text, 'api'::text, 'legacy'::text, 'legacy_unknown'::text
    ])
  );

CREATE UNIQUE INDEX uq_data_group_member_origin_dynamic_filter
  ON public.auto_account_contact_group_member_origins (membership_id, dynamic_filter_id)
  WHERE dynamic_filter_id IS NOT NULL;
CREATE INDEX idx_data_group_member_origin_dynamic_filter_current
  ON public.auto_account_contact_group_member_origins (
    dynamic_filter_id, is_current, membership_id
  )
  WHERE dynamic_filter_id IS NOT NULL;

ALTER TABLE public.auto_account_contact_group_dynamic_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_account_contact_group_dynamic_filter_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_account_contact_dynamic_filter_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auto_account_contact_group_dynamic_filters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.auto_account_contact_group_dynamic_filter_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.auto_account_contact_dynamic_filter_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.auto_account_contact_group_dynamic_filters_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.auto_account_contact_group_dynamic_filter_rules_id_seq FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.auto_account_contact_group_dynamic_filters IS
  'One bounded incremental dynamic-filter configuration per Data Group.';
COMMENT ON TABLE public.auto_account_contact_group_dynamic_filter_rules IS
  'Category-backed ordered conditions for a Data Group dynamic filter.';
COMMENT ON TABLE public.auto_account_contact_dynamic_filter_queue IS
  'Contact-deduplicated incremental evaluation queue; no action-by-filter fan-out is stored.';
COMMENT ON COLUMN public.auto_account_contact_group_member_origins.dynamic_filter_id IS
  'Exact dynamic-filter provenance. Retiring it never removes other current origins.';

-- -------------------------------------------------------------------------
-- Cheap row-change enqueue triggers. Every trigger first checks that the
-- tenant has an enabled filter, avoiding an ever-growing idle queue.
-- -------------------------------------------------------------------------

CREATE FUNCTION public.aka_agent_dynamic_filter_enqueue_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_reason_id bigint;
BEGIN
  IF NEW.staff_id IS NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT COALESCE((
    (NEW.flatform_type = 'zalo' AND NEW.contact_type = 'person')
    OR (
      TG_OP = 'UPDATE'
      AND OLD.flatform_type = 'zalo'
      AND OLD.contact_type = 'person'
    )
  ), false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
    AND NEW.contact_type IS NOT DISTINCT FROM OLD.contact_type
    AND NEW.flatform_type IS NOT DISTINCT FROM OLD.flatform_type
    AND NEW.uid IS NOT DISTINCT FROM OLD.uid
    AND NEW.extra_data IS NOT DISTINCT FROM OLD.extra_data
    AND NEW.akabiz_tag_ids IS NOT DISTINCT FROM OLD.akabiz_tag_ids
    AND NEW.is_friend IS NOT DISTINCT FROM OLD.is_friend
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete
    AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
    AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
  THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
    WHERE dynamic_filter.staff_id = NEW.staff_id
      AND dynamic_filter.organization_id = NEW.organization_id
      AND dynamic_filter.is_enabled = true
  ) THEN
    RETURN NEW;
  END IF;

  SELECT item.id INTO v_reason_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_queue_reason'
    AND item.code = 'contact_changed' AND item.is_active = true;

  INSERT INTO public.auto_account_contact_dynamic_filter_queue (
    contact_id, staff_id, organization_id, reason_category_item_id, queued_at
  ) VALUES (
    NEW.id, NEW.staff_id, NEW.organization_id, v_reason_id, clock_timestamp()
  )
  ON CONFLICT (contact_id) DO UPDATE SET
    staff_id = EXCLUDED.staff_id,
    organization_id = EXCLUDED.organization_id,
    reason_category_item_id = EXCLUDED.reason_category_item_id,
    queued_at = LEAST(
      public.auto_account_contact_dynamic_filter_queue.queued_at,
      EXCLUDED.queued_at
    ),
    attempt_count = 0,
    last_error = NULL;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_aka_agent_dynamic_filter_enqueue_contact
AFTER INSERT OR UPDATE ON public.auto_account_contacts
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_dynamic_filter_enqueue_contact();

CREATE FUNCTION public.aka_agent_dynamic_filter_enqueue_group_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.zalo_group_members%ROWTYPE;
  v_reason_id bigint;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_OP = 'UPDATE'
    AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
    AND NEW.zalo_uid IS NOT DISTINCT FROM OLD.zalo_uid
    AND NEW.zalo_group_id IS NOT DISTINCT FROM OLD.zalo_group_id
    AND NEW.is_current IS NOT DISTINCT FROM OLD.is_current
  THEN
    RETURN NEW;
  END IF;

  SELECT item.id INTO v_reason_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_queue_reason'
    AND item.code = 'group_membership_changed' AND item.is_active = true;

  INSERT INTO public.auto_account_contact_dynamic_filter_queue (
    contact_id, staff_id, organization_id, reason_category_item_id, queued_at
  )
  SELECT DISTINCT contact.id, contact.staff_id, contact.organization_id,
    v_reason_id, clock_timestamp()
  FROM public.auto_account_contacts AS contact
  JOIN (
    SELECT v_row.account_id AS account_id, v_row.zalo_uid AS zalo_uid
    UNION
    SELECT OLD.account_id, OLD.zalo_uid
    WHERE TG_OP = 'UPDATE'
  ) AS changed_member
    ON changed_member.account_id = contact.account_id
   AND changed_member.zalo_uid = contact.uid
  WHERE contact.contact_type = 'person'
    AND contact.staff_id IS NOT NULL
    AND contact.organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
      WHERE dynamic_filter.staff_id = contact.staff_id
        AND dynamic_filter.organization_id = contact.organization_id
        AND dynamic_filter.is_enabled = true
    )
  ON CONFLICT (contact_id) DO UPDATE SET
    reason_category_item_id = EXCLUDED.reason_category_item_id,
    queued_at = LEAST(
      public.auto_account_contact_dynamic_filter_queue.queued_at,
      EXCLUDED.queued_at
    ),
    attempt_count = 0,
    last_error = NULL;
  RETURN v_row;
END;
$function$;

CREATE TRIGGER trg_aka_agent_dynamic_filter_enqueue_group_member
AFTER INSERT OR UPDATE OR DELETE ON public.zalo_group_members
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_dynamic_filter_enqueue_group_member();

CREATE FUNCTION public.aka_agent_dynamic_filter_sync_chat_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_link public.chat_zalo_account_conversation_tag%ROWTYPE;
  v_reason_id bigint;
BEGIN
  v_link := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_OP = 'UPDATE'
    AND NEW.chat_zalo_account_conversation_id
      IS NOT DISTINCT FROM OLD.chat_zalo_account_conversation_id
    AND NEW.chat_zalo_account_tag_id
      IS NOT DISTINCT FROM OLD.chat_zalo_account_tag_id
  THEN
    RETURN NEW;
  END IF;

  -- Tagging a user in Chat API also materializes the canonical contact needed
  -- by Data Group filtering. Existing descriptive/contact fields are retained.
  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, extra_data, is_delete,
    staff_id, organization_id, flatform_type, created_at, updated_at
  )
  SELECT
    binding.auto_account_id::integer,
    'person',
    conversation.zalo_id,
    conversation.zalo_id,
    jsonb_build_object('source', 'chat_zalo_tag'),
    false,
    account.staff_id,
    binding.organization_id,
    'zalo',
    clock_timestamp(),
    clock_timestamp()
  FROM public.chat_zalo_account_conversation AS conversation
  JOIN (
    SELECT v_link.chat_zalo_account_conversation_id AS conversation_id
    UNION
    SELECT OLD.chat_zalo_account_conversation_id
    WHERE TG_OP = 'UPDATE'
  ) AS changed_link ON changed_link.conversation_id = conversation.id
  JOIN public.chat_zalo_account_organization AS binding
    ON binding.chat_zalo_account_id = conversation.chat_zalo_account_id
  JOIN public.auto_accounts AS account
    ON account.id = binding.auto_account_id
   AND account.organization_id = binding.organization_id
  WHERE conversation.conversation_type = 'user'
    AND account.staff_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
      WHERE dynamic_filter.staff_id = account.staff_id
        AND dynamic_filter.organization_id = binding.organization_id
    )
  ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
    is_delete = false,
    updated_at = clock_timestamp();

  SELECT item.id INTO v_reason_id
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common' AND type.code = 'data_filter_queue_reason'
    AND item.code = 'zalo_tag_changed' AND item.is_active = true;

  INSERT INTO public.auto_account_contact_dynamic_filter_queue (
    contact_id, staff_id, organization_id, reason_category_item_id, queued_at
  )
  SELECT contact.id, contact.staff_id, contact.organization_id, v_reason_id, clock_timestamp()
  FROM public.chat_zalo_account_conversation AS conversation
  JOIN (
    SELECT v_link.chat_zalo_account_conversation_id AS conversation_id
    UNION
    SELECT OLD.chat_zalo_account_conversation_id
    WHERE TG_OP = 'UPDATE'
  ) AS changed_link ON changed_link.conversation_id = conversation.id
  JOIN public.chat_zalo_account_organization AS binding
    ON binding.chat_zalo_account_id = conversation.chat_zalo_account_id
  JOIN public.auto_account_contacts AS contact
    ON contact.account_id = binding.auto_account_id::integer
   AND contact.contact_type = 'person'
   AND contact.uid = conversation.zalo_id
   AND contact.organization_id = binding.organization_id
  WHERE conversation.conversation_type = 'user'
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
      WHERE dynamic_filter.staff_id = contact.staff_id
        AND dynamic_filter.organization_id = contact.organization_id
        AND dynamic_filter.is_enabled = true
    )
  ON CONFLICT (contact_id) DO UPDATE SET
    reason_category_item_id = EXCLUDED.reason_category_item_id,
    queued_at = LEAST(
      public.auto_account_contact_dynamic_filter_queue.queued_at,
      EXCLUDED.queued_at
    ),
    attempt_count = 0,
    last_error = NULL;
  RETURN v_link;
END;
$function$;

CREATE TRIGGER trg_aka_agent_dynamic_filter_sync_chat_contact
AFTER INSERT OR UPDATE OR DELETE ON public.chat_zalo_account_conversation_tag
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_dynamic_filter_sync_chat_contact();

-- -------------------------------------------------------------------------
-- Shared evaluators. One contact is evaluated against only the enabled filters
-- in its own staff/organization scope. A value list always means "any selected
-- value"; a negative operator negates that result.
-- -------------------------------------------------------------------------

CREATE FUNCTION public.aka_agent_data_group_dynamic_values_match(
  p_contact_id bigint,
  p_field_code text,
  p_value_keys text[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_contact public.auto_account_contacts%ROWTYPE;
  v_friend_status text;
  v_result boolean := false;
BEGIN
  IF COALESCE(pg_catalog.array_length(p_value_keys, 1), 0) = 0 THEN
    RETURN false;
  END IF;

  SELECT contact.* INTO v_contact
  FROM public.auto_account_contacts AS contact
  WHERE contact.id = p_contact_id;
  IF NOT FOUND THEN RETURN false; END IF;

  CASE p_field_code
    WHEN 'akabiz_tag' THEN
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(COALESCE(v_contact.akabiz_tag_ids, ARRAY[]::bigint[])) AS tag_id
        WHERE tag_id::text = ANY (p_value_keys)
      ) INTO v_result;

    WHEN 'zalo_tag' THEN
      SELECT
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(v_contact.extra_data->'zaloTags') = 'array'
                THEN v_contact.extra_data->'zaloTags'
              WHEN jsonb_typeof(v_contact.extra_data->'zalo_tags') = 'array'
                THEN v_contact.extra_data->'zalo_tags'
              ELSE '[]'::jsonb
            END
          ) AS tag(value)
          WHERE COALESCE(
            tag.value->>'id', tag.value->>'labelId', tag.value->>'label_id',
            tag.value->>'tagId', tag.value->>'tag_id', tag.value #>> '{}'
          ) = ANY (p_value_keys)
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(v_contact.extra_data->'zaloTagIds') = 'array'
                THEN v_contact.extra_data->'zaloTagIds'
              WHEN jsonb_typeof(v_contact.extra_data->'zalo_tag_ids') = 'array'
                THEN v_contact.extra_data->'zalo_tag_ids'
              WHEN jsonb_typeof(v_contact.extra_data->'labelIds') = 'array'
                THEN v_contact.extra_data->'labelIds'
              WHEN jsonb_typeof(v_contact.extra_data->'label_ids') = 'array'
                THEN v_contact.extra_data->'label_ids'
              ELSE '[]'::jsonb
            END
          ) AS tag_id(value)
          WHERE tag_id.value #>> '{}' = ANY (p_value_keys)
        )
        OR EXISTS (
          SELECT 1
          FROM public.chat_zalo_account_organization AS binding
          JOIN public.chat_zalo_account_conversation AS conversation
            ON conversation.chat_zalo_account_id = binding.chat_zalo_account_id
           AND conversation.conversation_type = 'user'
           AND conversation.zalo_id = v_contact.uid
          JOIN public.chat_zalo_account_conversation_tag AS conversation_tag
            ON conversation_tag.chat_zalo_account_conversation_id = conversation.id
          JOIN public.chat_zalo_account_tag AS tag
            ON tag.id = conversation_tag.chat_zalo_account_tag_id
           AND tag.chat_zalo_account_id = conversation.chat_zalo_account_id
          WHERE binding.auto_account_id = v_contact.account_id::bigint
            AND binding.organization_id = v_contact.organization_id
            AND tag.zalo_id = ANY (p_value_keys)
        )
      INTO v_result;

    WHEN 'zalo_friend_status' THEN
      v_friend_status := CASE
        WHEN COALESCE(v_contact.extra_data->>'friendRequestSent', 'false') = 'true'
          OR COALESCE(v_contact.extra_data->>'friend_request_sent', 'false') = 'true'
          THEN 'request_sent'
        WHEN v_contact.is_friend = true THEN 'friend'
        WHEN v_contact.is_friend = false THEN 'not_friend'
        ELSE 'unknown'
      END;
      v_result := v_friend_status = ANY (p_value_keys);

    WHEN 'zalo_group_membership' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.zalo_group_members AS group_member
        WHERE group_member.account_id = v_contact.account_id::bigint
          AND group_member.zalo_uid = v_contact.uid
          AND group_member.is_current = true
          AND group_member.zalo_group_id = ANY (p_value_keys)
      ) INTO v_result;

    ELSE
      v_result := false;
  END CASE;

  RETURN COALESCE(v_result, false);
END;
$function$;

CREATE FUNCTION public.aka_agent_data_group_dynamic_rule_matches(
  p_rule_id bigint,
  p_contact_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_field_code text;
  v_operator_code text;
  v_account_id bigint;
  v_contact_account_id bigint;
  v_value_keys text[];
  v_base boolean;
BEGIN
  SELECT field_item.code, operator_item.code, rule.account_id,
    ARRAY(
      SELECT value #>> '{}'
      FROM jsonb_array_elements(rule.value_keys) AS value
      WHERE btrim(value #>> '{}') <> ''
    )
  INTO v_field_code, v_operator_code, v_account_id, v_value_keys
  FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
  JOIN public.category_item AS field_item ON field_item.id = rule.field_category_item_id
  JOIN public.category_item AS operator_item ON operator_item.id = rule.operator_category_item_id
  WHERE rule.id = p_rule_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT contact.account_id::bigint INTO v_contact_account_id
  FROM public.auto_account_contacts AS contact
  WHERE contact.id = p_contact_id;
  IF NOT FOUND OR (v_account_id IS NOT NULL AND v_account_id IS DISTINCT FROM v_contact_account_id) THEN
    RETURN false;
  END IF;

  v_base := public.aka_agent_data_group_dynamic_values_match(
    p_contact_id, v_field_code, v_value_keys
  );
  RETURN CASE
    WHEN v_operator_code IN ('not_contains', 'not_equals', 'out') THEN NOT v_base
    ELSE v_base
  END;
END;
$function$;

CREATE FUNCTION public.aka_agent_data_group_dynamic_scope_matches(
  p_dynamic_filter_id bigint,
  p_contact_id bigint,
  p_scope_code text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_and_seen boolean := false;
  v_and_result boolean := true;
  v_or_result boolean := false;
  v_rule record;
  v_match boolean;
BEGIN
  FOR v_rule IN
    SELECT rule.id, join_item.code AS join_code
    FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
    JOIN public.category_item AS scope_item ON scope_item.id = rule.scope_category_item_id
    JOIN public.category_item AS join_item ON join_item.id = rule.join_category_item_id
    WHERE rule.dynamic_filter_id = p_dynamic_filter_id
      AND scope_item.code = p_scope_code
    ORDER BY rule.sort_order, rule.id
  LOOP
    v_match := public.aka_agent_data_group_dynamic_rule_matches(v_rule.id, p_contact_id);
    IF v_rule.join_code = 'or' THEN
      v_or_result := v_or_result OR v_match;
    ELSE
      v_and_seen := true;
      v_and_result := v_and_result AND v_match;
    END IF;
  END LOOP;
  RETURN (v_and_seen AND v_and_result) OR v_or_result;
END;
$function$;

CREATE FUNCTION public.aka_agent_data_group_dynamic_draft_scope_matches(
  p_rules jsonb,
  p_contact_id bigint,
  p_scope_code text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_contact_account_id bigint;
  v_rule jsonb;
  v_join_code text;
  v_operator_code text;
  v_account_id bigint;
  v_values text[];
  v_match boolean;
  v_and_seen boolean := false;
  v_and_result boolean := true;
  v_or_result boolean := false;
BEGIN
  SELECT account_id::bigint INTO v_contact_account_id
  FROM public.auto_account_contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN false; END IF;

  FOR v_rule IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) WITH ORDINALITY AS input(value, ordinality)
    WHERE value->>'scope_code' = p_scope_code
    ORDER BY COALESCE((value->>'sort_order')::integer, ordinality::integer), ordinality
  LOOP
    v_join_code := COALESCE(NULLIF(v_rule->>'join_code', ''), 'and');
    v_operator_code := COALESCE(v_rule->>'operator_code', '');
    v_account_id := NULLIF(v_rule->>'account_id', '')::bigint;
    SELECT ARRAY(
      SELECT value #>> '{}'
      FROM jsonb_array_elements(COALESCE(v_rule->'value_keys', '[]'::jsonb)) AS value
      WHERE btrim(value #>> '{}') <> ''
    ) INTO v_values;

    v_match := (v_account_id IS NULL OR v_account_id = v_contact_account_id)
      AND public.aka_agent_data_group_dynamic_values_match(
        p_contact_id, v_rule->>'field_code', v_values
      );
    IF v_operator_code IN ('not_contains', 'not_equals', 'out')
      AND (v_account_id IS NULL OR v_account_id = v_contact_account_id)
    THEN
      v_match := NOT public.aka_agent_data_group_dynamic_values_match(
        p_contact_id, v_rule->>'field_code', v_values
      );
    END IF;

    IF v_join_code = 'or' THEN
      v_or_result := v_or_result OR v_match;
    ELSE
      v_and_seen := true;
      v_and_result := v_and_result AND v_match;
    END IF;
  END LOOP;
  RETURN (v_and_seen AND v_and_result) OR v_or_result;
END;
$function$;

-- -------------------------------------------------------------------------
-- Tenant RPCs for loading, saving and bounded preview.
-- -------------------------------------------------------------------------

CREATE FUNCTION public.aka_agent_dynamic_filter_catalog_json(
  p_type_code text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'code', item.code,
    'name', item.name,
    'description', item.description,
    'sort_order', item.sort_order,
    'metadata', item.metadata
  ) ORDER BY item.sort_order, item.id), '[]'::jsonb)
  FROM public.category_type AS type
  JOIN public.category_item AS item ON item.category_type_id = type.id
  WHERE type.namespace = 'common'
    AND type.code = p_type_code
    AND type.is_active = true
    AND item.is_active = true;
$function$;

CREATE FUNCTION public.aka_agent_get_data_group_dynamic_filter(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_filter public.auto_account_contact_group_dynamic_filters%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  SELECT dynamic_filter.* INTO v_filter
  FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
  WHERE dynamic_filter.group_id = p_group_id
    AND dynamic_filter.staff_id = p_staff_id
    AND dynamic_filter.organization_id = p_organization_id;

  SELECT jsonb_build_object(
    'filter', jsonb_build_object(
      'id', v_filter.id,
      'group_id', p_group_id,
      'is_enabled', COALESCE(v_filter.is_enabled, false),
      'revision', COALESCE(v_filter.revision, 0),
      'evaluation_interval_minutes', COALESCE(v_filter.evaluation_interval_minutes, 15),
      'last_evaluated_at', v_filter.last_evaluated_at,
      'next_evaluation_at', v_filter.next_evaluation_at,
      'matched_count', COALESCE(v_filter.matched_count, 0),
      'last_entered_count', COALESCE(v_filter.last_entered_count, 0),
      'last_exited_count', COALESCE(v_filter.last_exited_count, 0)
    ),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rule.id,
        'scope_code', scope_item.code,
        'join_code', join_item.code,
        'field_code', field_item.code,
        'operator_code', operator_item.code,
        'account_id', rule.account_id,
        'sort_order', rule.sort_order,
        'value_keys', rule.value_keys,
        'value_labels', rule.value_labels
      ) ORDER BY scope_item.sort_order, rule.sort_order, rule.id)
      FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
      JOIN public.category_item AS scope_item ON scope_item.id = rule.scope_category_item_id
      JOIN public.category_item AS join_item ON join_item.id = rule.join_category_item_id
      JOIN public.category_item AS field_item ON field_item.id = rule.field_category_item_id
      JOIN public.category_item AS operator_item ON operator_item.id = rule.operator_category_item_id
      WHERE rule.dynamic_filter_id = v_filter.id
    ), '[]'::jsonb),
    'catalog', jsonb_build_object(
      'scopes', public.aka_agent_dynamic_filter_catalog_json('data_filter_scope'),
      'joins', public.aka_agent_dynamic_filter_catalog_json('data_filter_join'),
      'operators', public.aka_agent_dynamic_filter_catalog_json('data_filter_operator'),
      'fields', public.aka_agent_dynamic_filter_catalog_json('data_filter_field')
    ),
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', account.id, 'name', account.name, 'is_delete', account.is_delete
      ) ORDER BY account.is_delete, account.name, account.id)
      FROM public.auto_accounts AS account
      WHERE account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND account.flatform_type = 'zalo'
    ), '[]'::jsonb),
    'values', COALESCE((
      SELECT jsonb_agg(to_jsonb(value_catalog) ORDER BY value_catalog.field_order, value_catalog.label, value_catalog.key)
      FROM (
        SELECT DISTINCT 10 AS field_order, 'zalo_tag'::text AS field_code,
          tag.zalo_id AS key, COALESCE(tag.name, tag.zalo_id) AS label,
          binding.auto_account_id AS account_id, account.name AS account_name,
          'Tag Zalo'::text AS secondary_label
        FROM public.chat_zalo_account_tag AS tag
        JOIN public.chat_zalo_account_organization AS binding
          ON binding.chat_zalo_account_id = tag.chat_zalo_account_id
         AND binding.organization_id = p_organization_id
        JOIN public.auto_accounts AS account ON account.id = binding.auto_account_id
        WHERE account.staff_id = p_staff_id
        UNION ALL
        SELECT 20, 'akabiz_tag', contact_tag.id::text, contact_tag.name,
          contact_tag.auto_account_id, account.name, 'Tag akaBiz'
        FROM public.auto_contact_tags AS contact_tag
        LEFT JOIN public.auto_accounts AS account ON account.id = contact_tag.auto_account_id
        WHERE contact_tag.staff_id = p_staff_id
          AND contact_tag.organization_id = p_organization_id
          AND contact_tag.is_delete = false
        UNION ALL
        SELECT DISTINCT 30, 'zalo_group_membership', zalo_group.zalo_group_id,
          COALESCE(zalo_group.name, zalo_group.zalo_group_id),
          zalo_group.account_id, account.name, 'Group Zalo'
        FROM public.zalo_groups AS zalo_group
        JOIN public.auto_accounts AS account ON account.id = zalo_group.account_id
        WHERE zalo_group.staff_id = p_staff_id
          AND zalo_group.organization_id = p_organization_id
        UNION ALL
        SELECT 40, 'zalo_friend_status', friend_status.code, friend_status.name,
          NULL::bigint, NULL::text, 'Trạng thái kết bạn'
        FROM public.category_type AS friend_type
        JOIN public.category_item AS friend_status ON friend_status.category_type_id = friend_type.id
        WHERE friend_type.namespace = 'common'
          AND friend_type.code = 'zalo_friend_status'
          AND friend_status.is_active = true
      ) AS value_catalog
    ), '[]'::jsonb),
    'queue_count', (
      SELECT count(*)::bigint
      FROM public.auto_account_contact_dynamic_filter_queue AS queue
      WHERE queue.staff_id = p_staff_id AND queue.organization_id = p_organization_id
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE FUNCTION public.aka_agent_save_data_group_dynamic_filter(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_is_enabled boolean,
  p_rules jsonb,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_filter_id bigint;
  v_rule_count integer;
  v_inserted_count integer;
  v_queued_count integer := 0;
  v_reason_id bigint;
  v_group_type_code text;
  v_revision bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  SELECT data_type.code INTO v_group_type_code
  FROM public.auto_account_contact_groups AS contact_group
  LEFT JOIN public.category_item AS data_type
    ON data_type.id = contact_group.data_type_category_item_id
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE OF contact_group;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF v_group_type_code IS DISTINCT FROM 'zalo_person' THEN
    RAISE EXCEPTION 'dynamic_filter_requires_zalo_person_group';
  END IF;

  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'dynamic_filter_rules_must_be_array';
  END IF;
  v_rule_count := jsonb_array_length(COALESCE(p_rules, '[]'::jsonb));
  IF v_rule_count > 50 THEN RAISE EXCEPTION 'dynamic_filter_rule_limit_exceeded'; END IF;
  IF COALESCE(p_is_enabled, false) AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE rule->>'scope_code' = 'enter'
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_enter_rule_required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE jsonb_typeof(COALESCE(rule->'value_keys', 'null'::jsonb)) <> 'array'
      OR jsonb_typeof(COALESCE(rule->'value_labels', 'null'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_rule_values_invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) AS rule
    WHERE jsonb_array_length(rule->'value_keys') NOT BETWEEN 1 AND 50
      OR jsonb_array_length(rule->'value_labels') > 50
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_rule_values_invalid';
  END IF;

  INSERT INTO public.auto_account_contact_group_dynamic_filters (
    group_id, staff_id, organization_id, is_enabled, revision,
    next_evaluation_at, updated_at
  ) VALUES (
    p_group_id, p_staff_id, p_organization_id, COALESCE(p_is_enabled, false), 1,
    CASE WHEN COALESCE(p_is_enabled, false) THEN clock_timestamp() ELSE NULL END,
    clock_timestamp()
  )
  ON CONFLICT (group_id) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    revision = public.auto_account_contact_group_dynamic_filters.revision + 1,
    next_evaluation_at = CASE
      WHEN EXCLUDED.is_enabled THEN clock_timestamp()
      ELSE public.auto_account_contact_group_dynamic_filters.next_evaluation_at
    END,
    updated_at = clock_timestamp()
  RETURNING id, revision INTO v_filter_id, v_revision;

  DELETE FROM public.auto_account_contact_group_dynamic_filter_rules
  WHERE dynamic_filter_id = v_filter_id;

  WITH raw_rule AS MATERIALIZED (
    SELECT
      input.value AS rule,
      input.ordinality::integer AS ordinality,
      row_number() OVER (
        PARTITION BY input.value->>'scope_code'
        ORDER BY COALESCE((input.value->>'sort_order')::integer, input.ordinality::integer), input.ordinality
      ) AS scope_position
    FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb))
      WITH ORDINALITY AS input(value, ordinality)
  ), normalized_rule AS MATERIALIZED (
    SELECT
      raw_rule.rule->>'scope_code' AS scope_code,
      CASE WHEN raw_rule.scope_position = 1 THEN 'and'
        ELSE COALESCE(NULLIF(raw_rule.rule->>'join_code', ''), 'and') END AS join_code,
      raw_rule.rule->>'field_code' AS field_code,
      raw_rule.rule->>'operator_code' AS operator_code,
      NULLIF(raw_rule.rule->>'account_id', '')::bigint AS account_id,
      COALESCE((raw_rule.rule->>'sort_order')::integer, raw_rule.ordinality) AS sort_order,
      raw_rule.rule->'value_keys' AS value_keys,
      raw_rule.rule->'value_labels' AS value_labels
    FROM raw_rule
  )
  INSERT INTO public.auto_account_contact_group_dynamic_filter_rules (
    dynamic_filter_id,
    scope_category_item_id,
    join_category_item_id,
    field_category_item_id,
    operator_category_item_id,
    account_id,
    sort_order,
    value_keys,
    value_labels
  )
  SELECT
    v_filter_id,
    scope_item.id,
    join_item.id,
    field_item.id,
    operator_item.id,
    normalized_rule.account_id,
    normalized_rule.sort_order,
    normalized_rule.value_keys,
    normalized_rule.value_labels
  FROM normalized_rule
  JOIN public.category_type AS scope_type
    ON scope_type.namespace = 'common' AND scope_type.code = 'data_filter_scope'
  JOIN public.category_item AS scope_item
    ON scope_item.category_type_id = scope_type.id
   AND scope_item.code = normalized_rule.scope_code AND scope_item.is_active = true
  JOIN public.category_type AS join_type
    ON join_type.namespace = 'common' AND join_type.code = 'data_filter_join'
  JOIN public.category_item AS join_item
    ON join_item.category_type_id = join_type.id
   AND join_item.code = normalized_rule.join_code AND join_item.is_active = true
  JOIN public.category_type AS field_type
    ON field_type.namespace = 'common' AND field_type.code = 'data_filter_field'
  JOIN public.category_item AS field_item
    ON field_item.category_type_id = field_type.id
   AND field_item.code = normalized_rule.field_code AND field_item.is_active = true
  JOIN public.category_type AS operator_type
    ON operator_type.namespace = 'common' AND operator_type.code = 'data_filter_operator'
  JOIN public.category_item AS operator_item
    ON operator_item.category_type_id = operator_type.id
   AND operator_item.code = normalized_rule.operator_code AND operator_item.is_active = true
   AND field_item.metadata->'operators' ? operator_item.code
  LEFT JOIN public.auto_accounts AS account
    ON account.id = normalized_rule.account_id
   AND account.staff_id = p_staff_id
   AND account.organization_id = p_organization_id
   AND account.flatform_type = 'zalo'
  WHERE normalized_rule.account_id IS NULL OR account.id IS NOT NULL;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> v_rule_count THEN
    RAISE EXCEPTION 'dynamic_filter_rule_category_or_account_invalid';
  END IF;

  IF COALESCE(p_is_enabled, false) THEN
    SELECT item.id INTO v_reason_id
    FROM public.category_type AS type
    JOIN public.category_item AS item ON item.category_type_id = type.id
    WHERE type.namespace = 'common' AND type.code = 'data_filter_queue_reason'
      AND item.code = 'filter_saved' AND item.is_active = true;

    INSERT INTO public.auto_account_contact_dynamic_filter_queue (
      contact_id, staff_id, organization_id, reason_category_item_id, queued_at
    )
    SELECT contact.id, p_staff_id, p_organization_id, v_reason_id, clock_timestamp()
    FROM public.auto_account_contacts AS contact
    WHERE contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND contact.flatform_type = 'zalo'
      AND contact.contact_type = 'person'
    ON CONFLICT (contact_id) DO UPDATE SET
      reason_category_item_id = EXCLUDED.reason_category_item_id,
      queued_at = LEAST(
        public.auto_account_contact_dynamic_filter_queue.queued_at,
        EXCLUDED.queued_at
      ),
      attempt_count = 0,
      last_error = NULL;
    GET DIAGNOSTICS v_queued_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'filter_id', v_filter_id,
    'group_id', p_group_id,
    'revision', v_revision,
    'rule_count', v_inserted_count,
    'queued_count', v_queued_count
  );
END;
$function$;

CREATE FUNCTION public.aka_agent_preview_data_group_dynamic_filter(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_rules jsonb,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_limit integer := LEAST(100, GREATEST(1, COALESCE(p_limit, 50)));
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    JOIN public.category_item AS data_type
      ON data_type.id = contact_group.data_type_category_item_id
     AND data_type.code = 'zalo_person'
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'dynamic_filter_requires_zalo_person_group';
  END IF;
  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_rules, '[]'::jsonb)) > 50
  THEN
    RAISE EXCEPTION 'dynamic_filter_rules_invalid';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT contact.id, contact.name, contact.uid, contact.account_id,
      account.name AS account_name,
      contact.is_delete,
      row_number() OVER (ORDER BY contact.id) AS candidate_number
    FROM public.auto_account_contacts AS contact
    LEFT JOIN public.auto_accounts AS account ON account.id = contact.account_id::bigint
    WHERE contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND contact.flatform_type = 'zalo'
      AND contact.contact_type = 'person'
    ORDER BY contact.id
    LIMIT 2001
  ), evaluated AS MATERIALIZED (
    SELECT candidates.*,
      CASE WHEN candidates.is_delete = true THEN false ELSE
        public.aka_agent_data_group_dynamic_draft_scope_matches(
          p_rules, candidates.id, 'enter'
        ) END AS enter_satisfied,
      CASE WHEN candidates.is_delete = true THEN true ELSE
        public.aka_agent_data_group_dynamic_draft_scope_matches(
          p_rules, candidates.id, 'leave'
        ) END AS leave_satisfied
    FROM candidates
    WHERE candidates.candidate_number <= 2000
  ), matched AS MATERIALIZED (
    SELECT * FROM evaluated
    WHERE enter_satisfied AND NOT leave_satisfied
  )
  SELECT jsonb_build_object(
    'scanned_count', (SELECT count(*) FROM evaluated),
    'matched_count', (SELECT count(*) FROM matched),
    'truncated', EXISTS (SELECT 1 FROM candidates WHERE candidate_number > 2000),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'contact_id', item.id,
        'name', item.name,
        'uid', item.uid,
        'account_id', item.account_id,
        'account_name', item.account_name,
        'enter_satisfied', item.enter_satisfied,
        'leave_satisfied', item.leave_satisfied
      ) ORDER BY item.id)
      FROM (SELECT * FROM matched ORDER BY id LIMIT v_limit) AS item
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- -------------------------------------------------------------------------
-- One bounded processor RPC. Queue contacts are materialized/locked first;
-- expensive rule evaluation happens only for that small driver set.
-- -------------------------------------------------------------------------

CREATE FUNCTION public.aka_agent_process_data_group_dynamic_filters(
  p_staff_id bigint,
  p_organization_id bigint,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_limit integer := LEAST(500, GREATEST(1, COALESCE(p_limit, 200)));
  v_queue record;
  v_filter record;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member_id bigint;
  v_origin_current boolean;
  v_was_member boolean;
  v_enter boolean;
  v_leave boolean;
  v_should_be_member boolean;
  v_processed integer := 0;
  v_pairs integer := 0;
  v_entered integer := 0;
  v_exited integer := 0;
  v_remaining bigint := 0;
  v_touched_filter_ids bigint[] := ARRAY[]::bigint[];
  v_changed_group_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:' || p_staff_id::text, 0)
  ) THEN
    RETURN jsonb_build_object(
      'processed_contact_count', 0,
      'evaluated_pair_count', 0,
      'entered_count', 0,
      'exited_count', 0,
      'remaining_queue_count', (
        SELECT count(*) FROM public.auto_account_contact_dynamic_filter_queue AS queue
        WHERE queue.staff_id = p_staff_id AND queue.organization_id = p_organization_id
      ),
      'busy', true
    );
  END IF;

  FOR v_queue IN
    SELECT queue.contact_id
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.staff_id = p_staff_id
      AND queue.organization_id = p_organization_id
      AND queue.queued_at <= clock_timestamp()
    ORDER BY queue.queued_at, queue.contact_id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  LOOP
    BEGIN
      FOR v_filter IN
        SELECT dynamic_filter.id, dynamic_filter.group_id
        FROM public.auto_account_contact_group_dynamic_filters AS dynamic_filter
        JOIN public.auto_account_contact_groups AS contact_group
          ON contact_group.id = dynamic_filter.group_id
         AND contact_group.staff_id = p_staff_id
         AND contact_group.organization_id = p_organization_id
         AND contact_group.purpose = 'data_group'
         AND contact_group.is_delete = false
        JOIN public.category_item AS data_type
          ON data_type.id = contact_group.data_type_category_item_id
         AND data_type.code = 'zalo_person'
        WHERE dynamic_filter.staff_id = p_staff_id
          AND dynamic_filter.organization_id = p_organization_id
          AND dynamic_filter.is_enabled = true
          AND EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_dynamic_filter_rules AS rule
            JOIN public.category_item AS scope_item ON scope_item.id = rule.scope_category_item_id
            WHERE rule.dynamic_filter_id = dynamic_filter.id
              AND scope_item.code = 'enter'
          )
        ORDER BY dynamic_filter.id
      LOOP
        v_member_id := NULL;
        v_origin_current := false;
        v_was_member := false;
        v_pairs := v_pairs + 1;
        IF NOT v_filter.id = ANY (v_touched_filter_ids) THEN
          v_touched_filter_ids := pg_catalog.array_append(v_touched_filter_ids, v_filter.id);
          UPDATE public.auto_account_contact_group_dynamic_filters
          SET last_entered_count = 0, last_exited_count = 0
          WHERE id = v_filter.id;
        END IF;

        SELECT contact_group.* INTO v_group
        FROM public.auto_account_contact_groups AS contact_group
        WHERE contact_group.id = v_filter.group_id
        FOR UPDATE;

        IF EXISTS (
          SELECT 1 FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type = 'zalo'
            AND contact.contact_type = 'person'
            AND contact.is_delete = false
        ) THEN
          v_enter := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'enter'
          );
          v_leave := public.aka_agent_data_group_dynamic_scope_matches(
            v_filter.id, v_queue.contact_id, 'leave'
          );
          v_should_be_member := v_enter AND NOT v_leave;
        ELSE
          v_should_be_member := false;
        END IF;

        SELECT member.id, member.is_delete = false
        INTO v_member_id, v_was_member
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_filter.group_id
          AND member.contact_id = v_queue.contact_id
        FOR UPDATE;

        SELECT origin.is_current INTO v_origin_current
        FROM public.auto_account_contact_group_member_origins AS origin
        WHERE origin.membership_id = v_member_id
          AND origin.dynamic_filter_id = v_filter.id;

        IF v_should_be_member THEN
          INSERT INTO public.auto_account_contact_group_members (
            group_id, contact_id, is_delete, change_revision, updated_at
          ) VALUES (
            v_filter.group_id, v_queue.contact_id, false, v_group.revision + 1, clock_timestamp()
          )
          ON CONFLICT (group_id, contact_id) DO UPDATE SET
            is_delete = false,
            change_revision = v_group.revision + 1,
            updated_at = clock_timestamp()
          RETURNING id INTO v_member_id;

          INSERT INTO public.auto_account_contact_group_member_origins (
            membership_id, kind, dynamic_filter_id, source_account_id,
            source_name_snapshot, is_current, data_type_category_item_id, updated_at
          )
          SELECT
            v_member_id, 'dynamic_filter', v_filter.id, contact.account_id::bigint,
            'Bộ lọc động', true, v_group.data_type_category_item_id, clock_timestamp()
          FROM public.auto_account_contacts AS contact
          WHERE contact.id = v_queue.contact_id
          ON CONFLICT (membership_id, dynamic_filter_id)
            WHERE dynamic_filter_id IS NOT NULL
          DO UPDATE SET
            source_account_id = EXCLUDED.source_account_id,
            source_name_snapshot = EXCLUDED.source_name_snapshot,
            is_current = true,
            data_type_category_item_id = EXCLUDED.data_type_category_item_id,
            updated_at = clock_timestamp();

          IF NOT COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = matched_count + 1
            WHERE id = v_filter.id;
          END IF;

          IF NOT COALESCE(v_was_member, false) THEN
            v_entered := v_entered + 1;
            v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
            UPDATE public.auto_account_contact_group_dynamic_filters
            SET last_entered_count = last_entered_count + 1
            WHERE id = v_filter.id;
          END IF;
        ELSE
          IF COALESCE(v_origin_current, false) THEN
            UPDATE public.auto_account_contact_group_member_origins
            SET is_current = false, updated_at = clock_timestamp()
            WHERE membership_id = v_member_id
              AND dynamic_filter_id = v_filter.id
              AND is_current = true;

            UPDATE public.auto_account_contact_group_dynamic_filters
            SET matched_count = GREATEST(0, matched_count - 1)
            WHERE id = v_filter.id;

            IF COALESCE(v_was_member, false) AND NOT EXISTS (
              SELECT 1
              FROM public.auto_account_contact_group_member_origins AS origin
              WHERE origin.membership_id = v_member_id
                AND origin.is_current = true
            ) THEN
              UPDATE public.auto_account_contact_group_members
              SET is_delete = true,
                  primary_origin_id = NULL,
                  change_revision = v_group.revision + 1,
                  updated_at = clock_timestamp()
              WHERE id = v_member_id;
              v_exited := v_exited + 1;
              v_changed_group_ids := pg_catalog.array_append(v_changed_group_ids, v_filter.group_id);
              UPDATE public.auto_account_contact_group_dynamic_filters
              SET last_exited_count = last_exited_count + 1
              WHERE id = v_filter.id;
            END IF;
          END IF;
        END IF;
      END LOOP;

      DELETE FROM public.auto_account_contact_dynamic_filter_queue
      WHERE contact_id = v_queue.contact_id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.auto_account_contact_dynamic_filter_queue
      SET attempt_count = attempt_count + 1,
          last_error = left(SQLERRM, 1000),
          queued_at = clock_timestamp() + make_interval(
            secs => CASE
              WHEN attempt_count >= 8 THEN 3600
              ELSE 5 * (attempt_count + 1) * (attempt_count + 1)
            END
          )
      WHERE contact_id = v_queue.contact_id;
    END;
  END LOOP;

  IF pg_catalog.array_length(v_changed_group_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_groups AS contact_group
    SET revision = contact_group.revision + 1,
        updated_at = clock_timestamp()
    WHERE contact_group.id = ANY (v_changed_group_ids);
  END IF;

  IF pg_catalog.array_length(v_touched_filter_ids, 1) IS NOT NULL THEN
    UPDATE public.auto_account_contact_group_dynamic_filters AS dynamic_filter
    SET last_evaluated_at = clock_timestamp(),
        next_evaluation_at = clock_timestamp()
          + make_interval(mins => dynamic_filter.evaluation_interval_minutes),
        updated_at = clock_timestamp()
    WHERE dynamic_filter.id = ANY (v_touched_filter_ids);
  END IF;

  SELECT count(*)::bigint INTO v_remaining
  FROM public.auto_account_contact_dynamic_filter_queue AS queue
  WHERE queue.staff_id = p_staff_id
    AND queue.organization_id = p_organization_id
    AND queue.queued_at <= clock_timestamp();

  RETURN jsonb_build_object(
    'processed_contact_count', v_processed,
    'evaluated_pair_count', v_pairs,
    'entered_count', v_entered,
    'exited_count', v_exited,
    'remaining_queue_count', v_remaining,
    'busy', false
  );
END;
$function$;

-- -------------------------------------------------------------------------
-- RPC ownership/ACL and fail-closed postflight.
-- -------------------------------------------------------------------------

ALTER FUNCTION public.aka_agent_dynamic_filter_enqueue_contact() OWNER TO postgres;
ALTER FUNCTION public.aka_agent_dynamic_filter_enqueue_group_member() OWNER TO postgres;
ALTER FUNCTION public.aka_agent_dynamic_filter_sync_chat_contact() OWNER TO postgres;
ALTER FUNCTION public.aka_agent_dynamic_filter_catalog_json(text) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_data_group_dynamic_values_match(bigint,text,text[]) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_data_group_dynamic_scope_matches(bigint,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_data_group_dynamic_draft_scope_matches(jsonb,bigint,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.aka_agent_dynamic_filter_enqueue_contact() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_dynamic_filter_enqueue_group_member() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_dynamic_filter_sync_chat_contact() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_dynamic_filter_catalog_json(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_data_group_dynamic_values_match(bigint,text,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_data_group_dynamic_scope_matches(bigint,bigint,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_data_group_dynamic_draft_scope_matches(jsonb,bigint,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_dynamic_filter_enqueue_contact() TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_dynamic_filter_enqueue_group_member() TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_dynamic_filter_sync_chat_contact() TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_dynamic_filter_catalog_json(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_data_group_dynamic_values_match(bigint,text,text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_data_group_dynamic_scope_matches(bigint,bigint,text) TO postgres;
GRANT EXECUTE ON FUNCTION public.aka_agent_data_group_dynamic_draft_scope_matches(jsonb,bigint,text) TO postgres;

ALTER FUNCTION public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text) OWNER TO postgres;
ALTER FUNCTION public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text) IS
  'Tenant-authenticated dynamic-filter config plus category/entity catalogs.';
COMMENT ON FUNCTION public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text) IS
  'Atomically replaces category-backed rules and queues a bounded incremental rebuild.';
COMMENT ON FUNCTION public.aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text) IS
  'Bounded dry-run preview over at most 2,000 canonical Zalo contacts.';
COMMENT ON FUNCTION public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text) IS
  'Single-worker, SKIP LOCKED, contact-deduplicated incremental dynamic-filter processor.';

DO $postflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_acl_valid boolean;
BEGIN
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.aka_agent_data_group_source_code(text)')
  )) IS DISTINCT FROM '4c1ea3a984cd3c3c38d04b6ee6be8e3b' THEN
    RAISE EXCEPTION 'v250_target_source_helper_checksum_mismatch';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
    AND proc.prosecdef = false
    AND proc.provolatile = 'i'
    AND proc.proparallel = 's'
    AND proc.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
    AND proc.proacl IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(proc.proacl) AS acl
      WHERE acl.grantee <> pg_catalog.to_regrole('postgres')::oid
        OR acl.privilege_type <> 'EXECUTE'
        OR acl.is_grantable
    )
  INTO v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = pg_catalog.to_regprocedure(
    'public.aka_agent_data_group_source_code(text)'
  );
  IF v_acl_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v250_target_source_helper_metadata_or_acl_mismatch';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_dynamic_filter_enqueue_contact()',
    'public.aka_agent_dynamic_filter_enqueue_group_member()',
    'public.aka_agent_dynamic_filter_sync_chat_contact()',
    'public.aka_agent_dynamic_filter_catalog_json(text)',
    'public.aka_agent_data_group_dynamic_values_match(bigint,text,text[])',
    'public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint)',
    'public.aka_agent_data_group_dynamic_scope_matches(bigint,bigint,text)',
    'public.aka_agent_data_group_dynamic_draft_scope_matches(jsonb,bigint,text)'
  ]
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'v250_missing_internal_signature:%', v_signature; END IF;
    SELECT
      pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
      AND proc.prosecdef = true
      AND proc.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
      AND proc.proacl IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
    INTO v_acl_valid
    FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid;
    IF v_acl_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'v250_internal_metadata_or_acl_mismatch:%', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)',
    'public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)',
    'public.aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text)',
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)'
  ]
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'v250_missing_target_signature:%', v_signature; END IF;
    SELECT
      pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
      AND proc.prosecdef = true
      AND proc.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
      AND proc.proacl IS NOT NULL
      AND pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ]) OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable
      )
    INTO v_acl_valid
    FROM pg_catalog.pg_proc AS proc WHERE proc.oid = v_oid;
    IF v_acl_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'v250_rpc_metadata_or_acl_mismatch:%', v_signature;
    END IF;
  END LOOP;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
