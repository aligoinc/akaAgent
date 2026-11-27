-- Sinh bởi scripts/event-bot/fuzz/build-dynfilter-fixture.py: phần đầu viết tay (bảng / cột production còn thiếu trong v672-fixture.sql,
-- danh mục, hàm quyền gói Zalo giả), phần sau là định nghĩa hàm + trigger production chép nguyên văn (đọc chỉ đọc 27/11/2026).
-- Không phải bản chụp production: chỉ đủ cột cho các hàm của chuỗi Bộ lọc động chạy.
SET check_function_bodies = off;
CREATE TABLE public.category_type (id bigint PRIMARY KEY, namespace text NOT NULL, code text NOT NULL);
ALTER TABLE public.category_item ADD COLUMN category_type_id bigint, ADD COLUMN is_active boolean NOT NULL DEFAULT true;
INSERT INTO public.category_type VALUES (901, 'common', 'data_filter_scope'), (902, 'common', 'data_filter_join'), (903, 'common', 'data_filter_operator'),
  (904, 'common', 'data_filter_queue_reason'), (905, 'common', 'data_filter_field'), (906, 'common', 'zalo_friendship_status');
INSERT INTO public.category_item (id, code, category_type_id) VALUES (202, 'enter', 901), (203, 'leave', 901), (204, 'and', 902), (205, 'or', 902),
  (206, 'contains', 903), (207, 'not_contains', 903), (208, 'equals', 903), (210, 'in', 903),
  (220, 'contact_changed', 904), (221, 'zalo_tag_changed', 904), (222, 'group_membership_changed', 904), (223, 'filter_saved', 904),
  (212, 'zalo_tag', 905), (213, 'akabiz_tag', 905), (214, 'zalo_group_membership', 905), (215, 'zalo_friend_status', 905),
  (301, 'friend', 906), (302, 'request_sent', 906), (303, 'request_received', 906), (304, 'stranger', 906);

ALTER TABLE public.auto_account_contacts ADD COLUMN is_friend boolean, ADD COLUMN akabiz_tag_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN url text, ADD COLUMN email text;
ALTER TABLE public.auto_account_contacts ALTER COLUMN extra_data SET DEFAULT '{}'::jsonb;
ALTER TABLE public.zalo_users ADD COLUMN staff_id bigint, ADD COLUMN organization_id bigint;
ALTER TABLE public.auto_account_contact_group_dynamic_filters ADD COLUMN evaluation_interval_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN last_evaluated_at timestamptz, ADD COLUMN next_evaluation_at timestamptz, ADD COLUMN matched_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_entered_count integer NOT NULL DEFAULT 0, ADD COLUMN last_exited_count integer NOT NULL DEFAULT 0,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN effective_from_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE TABLE public.auto_account_contact_dynamic_filter_queue (contact_id bigint PRIMARY KEY, staff_id bigint NOT NULL, organization_id bigint NOT NULL,
  reason_category_item_id bigint NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(), attempt_count integer NOT NULL DEFAULT 0, last_error text,
  last_event_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.auto_account_contact_group_dynamic_filter_rules (id bigserial PRIMARY KEY, dynamic_filter_id bigint NOT NULL,
  scope_category_item_id bigint NOT NULL, join_category_item_id bigint NOT NULL, field_category_item_id bigint NOT NULL,
  operator_category_item_id bigint NOT NULL, account_id bigint, sort_order integer NOT NULL DEFAULT 0, value_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_labels jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.zalo_group_members (id bigserial PRIMARY KEY, account_id bigint NOT NULL, user_id bigint, group_id bigint, zalo_uid text NOT NULL,
  zalo_group_id text NOT NULL, role text NOT NULL DEFAULT 'member', role_rank integer NOT NULL DEFAULT 3, is_creator boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false, is_current boolean NOT NULL DEFAULT true, raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  staff_id bigint, organization_id bigint, UNIQUE (account_id, zalo_group_id, zalo_uid));
CREATE TABLE public.chat_zalo_account_user (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL, zalo_id text NOT NULL,
  display_name text, zalo_name text, friendship_status_category_item_id bigint, UNIQUE (chat_zalo_account_id, zalo_id));
CREATE TABLE public.chat_zalo_account_conversation (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL, zalo_id text NOT NULL,
  conversation_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_zalo_account_id, conversation_type, zalo_id));
CREATE TABLE public.chat_zalo_account_tag (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL, zalo_id text NOT NULL, name text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.chat_zalo_account_conversation_tag (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL,
  chat_zalo_account_conversation_id bigint NOT NULL, chat_zalo_account_tag_id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.chat_zalo_conversation (id bigserial PRIMARY KEY, chat_zalo_account_organization_id bigint, chat_zalo_account_conversation_id bigint,
  organization_id bigint);
CREATE TABLE public.chat_zalo_conversation_system_tag (chat_zalo_conversation_id bigint, organization_id bigint, auto_contact_tag_id bigint);
CREATE TABLE public.auto_contact_tags (id bigserial PRIMARY KEY, staff_id bigint, organization_id bigint, is_delete boolean NOT NULL DEFAULT false,
  auto_account_id bigint, name text);

-- Quyền gói Zalo theo loại tài khoản (production đọc gói của tổ chức): bản giả đọc bảng test, mặc định có đủ ba loại.
CREATE TABLE public.test_org_no_entitlement (organization_id bigint, account_subtype text);
CREATE FUNCTION private.resolve_organization_zalo_entitlement_pools(p_organization_id bigint)
RETURNS TABLE(account_subtype text, entitlement_id bigint) LANGUAGE sql STABLE AS $$
  SELECT s, 1::bigint FROM unnest(ARRAY['qr', 'server', 'web']) s
  WHERE NOT EXISTS (SELECT 1 FROM public.test_org_no_entitlement x WHERE x.organization_id = p_organization_id AND x.account_subtype = s) $$;
INSERT INTO public.auto_system_settings (key, value) VALUES ('notifications.enabled', 'true'), ('notifications.member_events.enabled', 'false')
  ON CONFLICT (key) DO NOTHING;

-- aka_agent_data_group_account_available(bigint,bigint,bigint) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_account_available(p_account_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.auto_accounts a
    JOIN LATERAL private.resolve_organization_zalo_entitlement_pools(p_organization_id) e
      ON e.account_subtype = CASE WHEN a.is_zalo_show_web THEN 'web' WHEN a.is_zalo_server THEN 'server' ELSE 'qr' END
      AND e.entitlement_id IS NOT NULL
    WHERE a.id = p_account_id AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
      AND a.flatform_type = 'zalo' AND a.is_delete = false
  );
$function$;

-- aka_agent_data_group_dynamic_scope_matches(bigint,bigint,text) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_dynamic_scope_matches(p_dynamic_filter_id bigint, p_contact_id bigint, p_scope_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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

-- aka_agent_dynamic_filter_enqueue_contact() (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_dynamic_filter_enqueue_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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

-- aka_agent_dynamic_filter_enqueue_group_member() (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_dynamic_filter_enqueue_group_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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

-- aka_agent_dynamic_filter_sync_chat_contact() (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_dynamic_filter_sync_chat_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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
        AND dynamic_filter.is_enabled = true
    )
  ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
    -- A Chat event must never revive a contact explicitly deleted in Desktop.
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

-- aka_agent_enqueue_data_group_chat_user(bigint,text,bigint) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_enqueue_data_group_chat_user(p_chat_account_id bigint, p_uid text, p_organization_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_binding record; v_contact_id bigint; v_reason_id bigint;
BEGIN
  SELECT i.id INTO v_reason_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='common' AND t.code='data_filter_queue_reason' AND i.code='contact_changed' AND i.is_active;
  FOR v_binding IN SELECT b.auto_account_id,b.organization_id,a.staff_id FROM public.chat_zalo_account_organization b
    JOIN public.auto_accounts a ON a.id=b.auto_account_id AND a.organization_id=b.organization_id
    WHERE b.chat_zalo_account_id=p_chat_account_id AND b.is_active AND NOT a.is_delete
      AND (p_organization_id IS NULL OR b.organization_id=p_organization_id)
      AND EXISTS(SELECT 1 FROM public.auto_account_contact_group_dynamic_filters f
        WHERE f.staff_id=a.staff_id AND f.organization_id=b.organization_id AND f.is_enabled)
  LOOP
    INSERT INTO public.auto_account_contacts(account_id,contact_type,name,uid,flatform_type,extra_data,is_delete,staff_id,organization_id)
    SELECT v_binding.auto_account_id::integer,'person',COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),p_uid),p_uid,'zalo','{"source":"chat_zalo_event"}'::jsonb,false,v_binding.staff_id,v_binding.organization_id
    FROM (SELECT 1) seed LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=p_chat_account_id AND u.zalo_id=p_uid
    ON CONFLICT(account_id,contact_type,uid) DO UPDATE SET updated_at=clock_timestamp()
    RETURNING id INTO v_contact_id;
    INSERT INTO public.auto_account_contact_dynamic_filter_queue(contact_id,staff_id,organization_id,reason_category_item_id,queued_at)
    VALUES(v_contact_id,v_binding.staff_id,v_binding.organization_id,v_reason_id,clock_timestamp())
    ON CONFLICT(contact_id) DO UPDATE SET reason_category_item_id=EXCLUDED.reason_category_item_id,
      queued_at=LEAST(public.auto_account_contact_dynamic_filter_queue.queued_at,EXCLUDED.queued_at),attempt_count=0,last_error=NULL;
  END LOOP;
END;
$function$;

-- private.aka_agent_notification_member_events_enabled() (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION private.aka_agent_notification_member_events_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT private.aka_agent_notification_enabled()
      OR lower(btrim(private.aka_agent_notification_setting('notifications.member_events.enabled', 'false'))) IN ('true', '1', 'on', 'yes')
$function$;

-- aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_process_data_group_dynamic_filters_core(p_staff_id bigint, p_organization_id bigint, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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
  -- V458: nhật ký vào/rời nhóm và thông báo gộp theo khung. Chỉ ghi khi bật trung tâm thông báo
  -- hoặc notifications.member_events.enabled; lỗi ghi nhật ký không bao giờ làm hỏng lượt lọc.
  v_events_enabled boolean := private.aka_agent_notification_member_events_enabled();
  v_run_id uuid := pg_catalog.gen_random_uuid();
  v_event_count integer := 0;
BEGIN
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
    SELECT queue.contact_id, queue.last_event_at
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
        SELECT dynamic_filter.id, dynamic_filter.group_id, dynamic_filter.revision
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
          AND dynamic_filter.effective_from_at <= v_queue.last_event_at
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

        IF v_group.bound_zalo_account_id IS NOT NULL AND (
          NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id)
          OR NOT EXISTS(SELECT 1 FROM public.auto_account_contacts WHERE id=v_queue.contact_id AND account_id=v_group.bound_zalo_account_id)
        ) THEN CONTINUE; END IF;
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
            IF v_events_enabled THEN
              PERFORM private.aka_agent_data_group_record_member_event(v_run_id, p_organization_id, p_staff_id,
                v_filter.group_id, v_filter.id, v_filter.revision, v_member_id, v_queue.contact_id, 'added');
              v_event_count := v_event_count + 1;
            END IF;
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
              IF v_events_enabled THEN
                PERFORM private.aka_agent_data_group_record_member_event(v_run_id, p_organization_id, p_staff_id,
                  v_filter.group_id, v_filter.id, v_filter.revision, v_member_id, v_queue.contact_id, 'removed');
                v_event_count := v_event_count + 1;
              END IF;
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
        next_evaluation_at = NULL,
        updated_at = clock_timestamp()
    WHERE dynamic_filter.id = ANY (v_touched_filter_ids);
  END IF;

  IF v_event_count > 0 THEN
    PERFORM private.aka_agent_data_group_finish_member_events(v_run_id);
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

-- aka_agent_run_data_group_dynamic_filter_worker(integer,integer) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_run_data_group_dynamic_filter_worker(p_tenant_limit integer, p_contact_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_tenant_limit integer := LEAST(20, GREATEST(1, COALESCE(p_tenant_limit, 5)));
  v_contact_limit integer := LEAST(200, GREATEST(1, COALESCE(p_contact_limit, 100)));
  v_started_at timestamptz := clock_timestamp();
  v_deadline timestamptz := v_started_at + interval '20 seconds';
  v_seen_tenants text[] := ARRAY[]::text[];
  v_tenant record;
  v_tenant_key text;
  v_result jsonb;
  v_tenants integer := 0;
  v_processed bigint := 0;
  v_pairs bigint := 0;
  v_entered bigint := 0;
  v_exited bigint := 0;
  v_busy_tenants integer := 0;
  v_has_more boolean := false;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('data-group-dynamic-filter:database-worker', 0)
  ) THEN
    RETURN jsonb_build_object(
      'tenant_count', 0,
      'processed_contact_count', 0,
      'evaluated_pair_count', 0,
      'entered_count', 0,
      'exited_count', 0,
      'busy_tenant_count', 0,
      'has_more', EXISTS (
        SELECT 1 FROM public.auto_account_contact_dynamic_filter_queue AS queue
        WHERE queue.queued_at <= clock_timestamp()
      ),
      'busy', true
    );
  END IF;

  FOR v_iteration IN 1..v_tenant_limit LOOP
    EXIT WHEN clock_timestamp() >= v_deadline;

    SELECT queue.staff_id, queue.organization_id
    INTO v_tenant
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.queued_at <= clock_timestamp()
      AND NOT (
        (queue.staff_id::text || ':' || queue.organization_id::text)
        = ANY (v_seen_tenants)
      )
    ORDER BY queue.queued_at, queue.contact_id
    LIMIT 1;

    EXIT WHEN NOT FOUND;
    v_tenant_key := v_tenant.staff_id::text || ':' || v_tenant.organization_id::text;
    v_seen_tenants := pg_catalog.array_append(v_seen_tenants, v_tenant_key);
    v_tenants := v_tenants + 1;

    v_result := public.aka_agent_process_data_group_dynamic_filters_core(
      v_tenant.staff_id,
      v_tenant.organization_id,
      v_contact_limit
    );

    v_processed := v_processed
      + COALESCE((v_result->>'processed_contact_count')::bigint, 0);
    v_pairs := v_pairs
      + COALESCE((v_result->>'evaluated_pair_count')::bigint, 0);
    v_entered := v_entered
      + COALESCE((v_result->>'entered_count')::bigint, 0);
    v_exited := v_exited
      + COALESCE((v_result->>'exited_count')::bigint, 0);
    IF COALESCE((v_result->>'busy')::boolean, false) THEN
      v_busy_tenants := v_busy_tenants + 1;
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_dynamic_filter_queue AS queue
    WHERE queue.queued_at <= clock_timestamp()
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'tenant_count', v_tenants,
    'processed_contact_count', v_processed,
    'evaluated_pair_count', v_pairs,
    'entered_count', v_entered,
    'exited_count', v_exited,
    'busy_tenant_count', v_busy_tenants,
    'has_more', v_has_more,
    'busy', false,
    'elapsed_ms', GREATEST(
      0,
      floor(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000)::bigint
    )
  );
END;
$function$;

-- aka_agent_data_group_dynamic_rule_matches(bigint,bigint) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_dynamic_rule_matches(p_rule_id bigint, p_contact_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_field_code text;
  v_operator_code text;
  v_account_id bigint;
  v_contact_account_id bigint;
  v_value_keys text[];
  v_base boolean;
BEGIN
  IF EXISTS(SELECT 1 FROM public.auto_account_contact_group_dynamic_filter_rules r
    JOIN public.auto_account_contact_group_dynamic_filters f ON f.id=r.dynamic_filter_id
    JOIN public.auto_account_contact_groups g ON g.id=f.group_id
    JOIN public.auto_account_contacts c ON c.id=p_contact_id
    WHERE r.id=p_rule_id AND g.bound_zalo_account_id IS NOT NULL AND (g.bound_zalo_account_id IS DISTINCT FROM c.account_id
      OR NOT public.aka_agent_data_group_account_available(g.bound_zalo_account_id,g.staff_id,g.organization_id))) THEN RETURN false; END IF;
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

  IF v_field_code IN ('zalo_tag','zalo_group_membership') AND NOT EXISTS(
    SELECT 1 FROM unnest(v_value_keys) k WHERE position(':' IN k)=0 OR split_part(k,':',1)=v_contact_account_id::text
  ) THEN RETURN false; END IF;
  v_base := public.aka_agent_data_group_dynamic_values_match(
    p_contact_id, v_field_code, v_value_keys
  );
  RETURN CASE
    WHEN v_operator_code IN ('not_contains', 'not_equals', 'out') THEN NOT v_base
    ELSE v_base
  END;
END;
$function$;

-- private.aka_agent_data_group_finish_member_events(uuid) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION private.aka_agent_data_group_finish_member_events(p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  UPDATE public.auto_data_group_member_events e
     SET group_total_after = t.total
    FROM (SELECT x.group_id, max(x.id) AS last_id,
                 (SELECT count(*)::integer FROM public.auto_account_contact_group_members m
                   WHERE m.group_id = x.group_id AND m.is_delete = false) AS total
            FROM public.auto_data_group_member_events x
           WHERE x.run_id = p_run_id
           GROUP BY x.group_id) t
   WHERE e.id = t.last_id;
  RETURN private.aka_agent_notification_capture_data_group(p_run_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Data group member events not finalized (%): %', SQLSTATE, left(SQLERRM, 200);
  RETURN 0;
END
$function$;

-- private.aka_agent_data_group_record_member_event(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION private.aka_agent_data_group_record_member_event(p_run_id uuid, p_organization_id bigint, p_staff_id bigint, p_group_id bigint, p_filter_id bigint, p_filter_revision bigint, p_membership_id bigint, p_contact_id bigint, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_summary text;
BEGIN
  SELECT e.filter_summary INTO v_summary FROM public.auto_data_group_member_events e
   WHERE e.run_id = p_run_id AND e.dynamic_filter_id = p_filter_id LIMIT 1;
  IF NOT FOUND THEN v_summary := private.aka_agent_data_group_filter_summary(p_filter_id); END IF;
  INSERT INTO public.auto_data_group_member_events (organization_id, staff_id, group_id, dynamic_filter_id, filter_revision, filter_summary,
                                                    membership_id, contact_id, contact_label, action, run_id)
  VALUES (p_organization_id, p_staff_id, p_group_id, p_filter_id, p_filter_revision, v_summary,
          p_membership_id, p_contact_id, private.aka_agent_data_group_contact_label(p_contact_id), p_action, p_run_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Data group member event not recorded (%): %', SQLSTATE, left(SQLERRM, 200);
END
$function$;

-- private.aka_agent_notification_enabled() (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION private.aka_agent_notification_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT lower(btrim(private.aka_agent_notification_setting('notifications.enabled', 'false'))) IN ('true', '1', 'on', 'yes')
$function$;

-- private.aka_agent_notification_setting(text,text) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION private.aka_agent_notification_setting(p_key text, p_default text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce((SELECT s.value FROM public.auto_system_settings s WHERE s.key = p_key AND s.is_active IS TRUE LIMIT 1), p_default)
$function$;

-- aka_agent_data_group_dynamic_values_match(bigint,text,text[]) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_dynamic_values_match(p_contact_id bigint, p_field_code text, p_value_keys text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_contact public.auto_account_contacts%ROWTYPE;
  v_friend_status text;
  v_facts jsonb;
  v_result boolean := false;
BEGIN
  IF COALESCE(pg_catalog.array_length(p_value_keys, 1), 0) = 0 THEN
    RETURN false;
  END IF;

  SELECT contact.* INTO v_contact
  FROM public.auto_account_contacts AS contact
  WHERE contact.id = p_contact_id;
  IF NOT FOUND THEN RETURN false; END IF;

  v_facts := public.aka_agent_data_group_zalo_facts(p_contact_id);
  IF p_field_code IN ('zalo_tag','zalo_group_membership') THEN
    SELECT array_agg(CASE WHEN position(':' IN k)>0 THEN substring(k FROM position(':' IN k)+1) ELSE k END)
      INTO p_value_keys FROM unnest(p_value_keys) k
      WHERE position(':' IN k)=0 OR split_part(k,':',1)=v_contact.account_id::text;
    IF COALESCE(array_length(p_value_keys,1),0)=0 THEN RETURN false; END IF;
  END IF;
  CASE p_field_code
    WHEN 'akabiz_tag' THEN
      SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_facts->'akabiz_tag_keys') k WHERE k=ANY(p_value_keys)) INTO v_result;

    WHEN 'zalo_tag' THEN
      IF v_facts->>'chat_account_conversation_id' IS NOT NULL THEN
        RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_facts->'zalo_tag_keys') k WHERE k=ANY(p_value_keys));
      END IF;
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
      v_friend_status := v_facts->>'zalo_friend_status';
      v_result := v_friend_status = ANY (ARRAY(SELECT CASE WHEN k IN ('not_friend','unknown','removed') THEN 'stranger' ELSE k END FROM unnest(p_value_keys) k));

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

-- aka_agent_data_group_zalo_facts(bigint) (production, đọc 27/11/2026)
CREATE OR REPLACE FUNCTION public.aka_agent_data_group_zalo_facts(p_contact_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'zalo_name', CASE WHEN c.flatform_type = 'zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),c.name) END,
    'display_name', CASE WHEN c.flatform_type = 'zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),c.name) END,
    'zalo_friend_status', CASE WHEN c.flatform_type = 'zalo' AND c.contact_type = 'person' THEN
      CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
        WHEN c.is_friend IS TRUE THEN 'friend'
        WHEN COALESCE(c.extra_data->>'friendRequestReceived',c.extra_data->>'friend_request_received','false') = 'true' THEN 'request_received'
        WHEN COALESCE(c.extra_data->>'friendRequestSent',c.extra_data->>'friend_request_sent','false') = 'true' THEN 'request_sent'
        ELSE 'stranger' END END,
    'chat_account_conversation_id', ac.id,
    'chat_conversation_id', conv.id,
    'zalo_tag_keys', CASE WHEN ac.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(t.zalo_id ORDER BY t.zalo_id)
      FROM public.chat_zalo_account_conversation_tag link JOIN public.chat_zalo_account_tag t
        ON t.id = link.chat_zalo_account_tag_id AND t.chat_zalo_account_id = ac.chat_zalo_account_id
      WHERE link.chat_zalo_account_conversation_id = ac.id
    ),'[]'::jsonb) ELSE NULL END,
    'akabiz_tag_keys', CASE WHEN conv.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(t.id::text ORDER BY t.id)
      FROM public.chat_zalo_conversation_system_tag link JOIN public.auto_contact_tags t ON t.id=link.auto_contact_tag_id
      WHERE link.chat_zalo_conversation_id=conv.id AND link.organization_id=c.organization_id
        AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete
        AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
    ),'[]'::jsonb) ELSE COALESCE((
      SELECT jsonb_agg(t.id::text ORDER BY t.id) FROM public.auto_contact_tags t
      WHERE t.id=ANY(c.akabiz_tag_ids) AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id
        AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
    ),'[]'::jsonb) END
  )
  FROM public.auto_account_contacts c
  LEFT JOIN public.zalo_users z ON z.account_id=c.account_id AND z.zalo_uid=c.uid
    AND z.staff_id=c.staff_id AND z.organization_id=c.organization_id AND c.flatform_type='zalo'
  LEFT JOIN public.chat_zalo_account_organization b ON b.auto_account_id=c.account_id
    AND b.organization_id=c.organization_id AND b.is_active AND c.flatform_type='zalo'
  LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=b.chat_zalo_account_id AND u.zalo_id=c.uid AND c.contact_type='person'
  LEFT JOIN public.category_item status ON status.id=u.friendship_status_category_item_id
  LEFT JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id
    AND ac.zalo_id=c.uid AND ac.conversation_type=CASE WHEN c.contact_type='person' THEN 'user' WHEN c.contact_type='group' THEN 'group' END
  LEFT JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id
    AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
  WHERE c.id=p_contact_id;
$function$;

CREATE TRIGGER trg_aka_agent_dynamic_filter_enqueue_contact AFTER INSERT OR UPDATE ON public.auto_account_contacts FOR EACH ROW EXECUTE FUNCTION aka_agent_dynamic_filter_enqueue_contact();

CREATE TRIGGER trg_aka_agent_dynamic_filter_enqueue_group_member AFTER INSERT OR DELETE OR UPDATE ON public.zalo_group_members FOR EACH ROW EXECUTE FUNCTION aka_agent_dynamic_filter_enqueue_group_member();

CREATE TRIGGER trg_aka_agent_dynamic_filter_sync_chat_contact AFTER INSERT OR DELETE OR UPDATE ON public.chat_zalo_account_conversation_tag FOR EACH ROW EXECUTE FUNCTION aka_agent_dynamic_filter_sync_chat_contact();
