-- Preview the number of unique runnable targets a Data Group would materialize
-- for a campaign account. This keeps the campaign form from presenting the
-- raw membership count as if every member would become an input row.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_preview_data_group_target_key(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_membership_id bigint,
  p_action_id text,
  p_account_id bigint
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_contact public.auto_account_contacts%ROWTYPE;
  v_action text := btrim(COALESCE(p_action_id, ''));
  v_platform text;
  v_contact_type text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_target_value text;
  v_identity_value text;
  v_target_kind text;
  v_scope text;
  v_has_relationship boolean := false;
BEGIN
  IF NOT public.aka_agent_data_group_membership_semantic_compatible(
    p_membership_id, v_action, p_group_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT contact.*
  INTO v_contact
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contacts AS contact
    ON contact.id = member.contact_id
  WHERE member.id = p_membership_id
    AND member.group_id = p_group_id
    AND member.is_delete = false
    AND contact.staff_id = p_staff_id
    AND contact.organization_id = p_organization_id
    AND COALESCE(contact.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_platform := lower(btrim(COALESCE(v_contact.flatform_type, '')));
  v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
  v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
  v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
  v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
    NULLIF(v_contact.phone, ''),
    NULLIF(v_contact.extra_data ->> 'phone', ''),
    CASE WHEN v_contact_type = 'phone' THEN v_contact.uid ELSE NULL END,
    ''
  )), '');
  v_email := NULLIF(lower(btrim(COALESCE(
    NULLIF(v_contact.email, ''),
    NULLIF(v_contact.extra_data ->> 'email', ''),
    CASE WHEN v_contact_type = 'email' THEN v_contact.uid ELSE NULL END,
    ''
  ))), '');
  IF v_email IS NOT NULL AND (
    v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(v_email) > 254
  ) THEN
    v_email := NULL;
  END IF;

  IF v_action IN (
    'facebook_group_post', 'facebook_join_group',
    'facebook_find_data_group'
  ) THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'group' THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_group';
    v_scope := 'portable';
  ELSIF v_action = 'facebook_message_uid' THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'portable';
  ELSIF v_action = 'facebook_find_data_search' THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'campaign_input' THEN
      RETURN NULL;
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'facebook_search';
    v_scope := 'portable';
  ELSIF v_action IN (
    'facebook_comment_seeding', 'facebook_comment_seeding_post'
  ) THEN
    IF v_platform <> 'facebook'
      OR (
        v_action = 'facebook_comment_seeding'
        AND v_contact_type NOT IN ('group', 'page', 'person', 'campaign_input')
      )
      OR (
        v_action = 'facebook_comment_seeding_post'
        AND v_contact_type <> 'campaign_input'
      )
    THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := CASE
      WHEN v_action = 'facebook_comment_seeding_post' THEN 'facebook_post'
      ELSE 'facebook_comment_target'
    END;
    v_scope := 'portable';
  ELSIF v_action = 'zalo_message_phone' THEN
    IF v_phone IS NULL THEN
      RETURN NULL;
    END IF;
    v_target_value := v_phone;
    v_target_kind := 'phone';
    v_scope := 'portable';
  ELSIF v_action = 'zalo_join_group_link' THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'group' THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'zalo_group_link';
    v_scope := 'portable';
  ELSIF v_action = 'email_send' THEN
    IF v_email IS NULL THEN
      RETURN NULL;
    END IF;
    v_target_value := v_email;
    v_target_kind := 'email';
    v_scope := 'portable';
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    IF v_platform <> 'facebook'
      OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
      OR v_contact.is_friend IS DISTINCT FROM true
    THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'facebook_page_post' THEN
    IF v_platform <> 'facebook'
      OR v_contact_type <> 'page'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
    THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action IN (
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer'
  ) THEN
    IF v_platform <> 'zalo'
      OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
      OR v_uid IS NULL
      OR (
        v_action = 'zalo_message_friend'
        AND v_contact.is_friend IS DISTINCT FROM true
      )
    THEN
      RETURN NULL;
    END IF;
    IF v_action = 'zalo_message_group_member' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS origin
        WHERE origin.membership_id = p_membership_id
          AND origin.is_current = true
          AND origin.source_account_id = p_account_id
          AND origin.relationship_kind = 'zalo_group_members'
      ) OR EXISTS (
        SELECT 1
        FROM public.zalo_group_members AS relation
        WHERE relation.account_id = p_account_id
          AND relation.zalo_uid = v_uid
          AND relation.is_current = true
          AND (relation.staff_id IS NULL OR relation.staff_id = p_staff_id)
          AND (
            relation.organization_id IS NULL
            OR relation.organization_id = p_organization_id
          )
      )
      INTO v_has_relationship;
      IF NOT v_has_relationship THEN
        RETURN NULL;
      END IF;
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_person';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'zalo_message_group' THEN
    IF v_platform <> 'zalo'
      OR v_contact_type <> 'group'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
      OR v_contact.is_joined IS DISTINCT FROM true
    THEN
      RETURN NULL;
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_group';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'zalo_add_group_member' THEN
    IF v_phone IS NOT NULL THEN
      v_target_value := v_phone;
      v_target_kind := 'phone';
      v_scope := 'portable';
    ELSIF v_platform = 'zalo'
      AND v_contact_type = 'person'
      AND v_uid IS NOT NULL
      AND v_contact.account_id IS NOT DISTINCT FROM p_account_id
    THEN
      v_target_value := v_uid;
      v_target_kind := 'zalo_person';
      v_scope := 'bound:' || p_account_id::text;
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  IF NULLIF(v_target_value, '') IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_target_kind LIKE 'facebook_%' THEN
    v_identity_value := COALESCE(
      NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_uid), ''),
      NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_url), ''),
      NULLIF(
        public.aka_agent_internal_normalize_facebook_identity(v_target_value),
        ''
      )
    );
  ELSIF v_target_kind = 'email' THEN
    v_identity_value := lower(v_target_value);
  ELSE
    v_identity_value := v_target_value;
  END IF;
  IF NULLIF(v_identity_value, '') IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_scope || ':' || v_target_kind || ':' || v_identity_value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_preview_data_group_campaign_targets(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_action_id text,
  p_account_ids bigint[]
)
RETURNS TABLE (
  account_id bigint,
  active_membership_count bigint,
  compatible_membership_count bigint,
  valid_target_count bigint,
  incompatible_membership_count bigint,
  duplicate_target_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_action text := btrim(COALESCE(p_action_id, ''));
  v_requested_account_count integer;
  v_valid_account_count integer;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF p_group_id IS NULL OR p_group_id <= 0
    OR p_account_ids IS NULL
    OR cardinality(p_account_ids) NOT BETWEEN 1 AND 100
    OR EXISTS (
      SELECT 1 FROM unnest(p_account_ids) AS requested(id)
      WHERE requested.id IS NULL OR requested.id <= 0
    )
  THEN
    RAISE EXCEPTION 'invalid_data_group_campaign_preview';
  END IF;
  IF v_action NOT IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid',
    'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_comment_seeding', 'facebook_comment_seeding_post',
    'zalo_message_phone', 'zalo_join_group_link', 'email_send',
    'facebook_message_friend', 'facebook_group_invite', 'facebook_page_post',
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer', 'zalo_message_group',
    'zalo_add_group_member'
  ) THEN
    RAISE EXCEPTION 'data_group_campaign_action_incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;
  IF NOT public.aka_agent_data_group_type_compatible(p_group_id, v_action) THEN
    RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
  END IF;

  SELECT count(DISTINCT requested.id)::integer
  INTO v_requested_account_count
  FROM unnest(p_account_ids) AS requested(id);

  SELECT count(DISTINCT account.id)::integer
  INTO v_valid_account_count
  FROM unnest(p_account_ids) AS requested(id)
  JOIN public.auto_accounts AS account
    ON account.id = requested.id
  WHERE account.staff_id = p_staff_id
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND COALESCE(account.is_delete, false) = false;
  IF v_valid_account_count IS DISTINCT FROM v_requested_account_count THEN
    RAISE EXCEPTION 'data_group_campaign_account_not_found';
  END IF;

  RETURN QUERY
  WITH requested_accounts AS (
    SELECT DISTINCT requested.id AS account_id
    FROM unnest(p_account_ids) AS requested(id)
  ), active_members AS (
    SELECT member.id AS membership_id
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = p_group_id
      AND member.is_delete = false
  ), routed AS (
    SELECT
      requested.account_id,
      member.membership_id,
      public.aka_agent_internal_preview_data_group_target_key(
        p_staff_id,
        p_organization_id,
        p_group_id,
        member.membership_id,
        v_action,
        requested.account_id
      ) AS target_key
    FROM requested_accounts AS requested
    LEFT JOIN active_members AS member ON true
  ), counts AS (
    SELECT
      routed.account_id,
      count(routed.membership_id)::bigint AS active_count,
      count(routed.membership_id) FILTER (
        WHERE routed.target_key IS NOT NULL
      )::bigint AS compatible_count,
      count(DISTINCT routed.target_key)::bigint AS target_count
    FROM routed
    GROUP BY routed.account_id
  )
  SELECT
    counts.account_id,
    counts.active_count,
    counts.compatible_count,
    counts.target_count,
    counts.active_count - counts.compatible_count,
    counts.compatible_count - counts.target_count
  FROM counts
  ORDER BY counts.account_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_preview_data_group_campaign_targets(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_action_id text,
  p_account_ids bigint[],
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  account_id bigint,
  active_membership_count bigint,
  compatible_membership_count bigint,
  valid_target_count bigint,
  incompatible_membership_count bigint,
  duplicate_target_count bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  RETURN QUERY
  SELECT *
  FROM public.aka_agent_preview_data_group_campaign_targets(
    p_staff_id, p_organization_id, p_group_id, p_action_id, p_account_ids
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_internal_preview_data_group_target_key(
  bigint, bigint, bigint, bigint, text, bigint
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_preview_data_group_campaign_targets(
  bigint, bigint, bigint, text, bigint[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_preview_data_group_campaign_targets(
  bigint, bigint, bigint, text, bigint[]
) TO service_role;

REVOKE ALL ON FUNCTION public.aka_agent_preview_data_group_campaign_targets(
  bigint, bigint, bigint, text, bigint[], text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_preview_data_group_campaign_targets(
  bigint, bigint, bigint, text, bigint[], text, text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_preview_data_group_campaign_targets(
  bigint, bigint, bigint, text, bigint[], text, text
) IS
  'Tenant-authenticated read preview of unique Data Group targets that would materialize for each campaign account.';

NOTIFY pgrst, 'reload schema';

COMMIT;
