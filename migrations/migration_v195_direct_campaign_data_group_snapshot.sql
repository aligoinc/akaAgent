-- migration_v195_direct_campaign_data_group_snapshot.sql
-- One-time Data Group snapshots for already-saved direct campaigns, plus
-- tenant-authenticated automation reference lookups used by campaign detail UI.

BEGIN;

-- A one-time group snapshot is provenance from a group membership, but is not
-- an incremental campaign source. Keep it in the same origin_kind so existing
-- provenance filters and indexes remain correct; batch_id distinguishes it.
ALTER TABLE public.auto_data_ingest_batches
  DROP CONSTRAINT IF EXISTS auto_data_ingest_batches_operation_check;
ALTER TABLE public.auto_data_ingest_batches
  ADD CONSTRAINT auto_data_ingest_batches_operation_check CHECK (
    operation IN (
      'legacy_backfill', 'create_group', 'delete_group', 'duplicate_group', 'ingest',
      'remove_members', 'move_members', 'bind_source', 'stop_source', 'reactivate_source',
      'snapshot_campaign'
    )
  );

ALTER TABLE public.auto_campaign_input_origins
  DROP CONSTRAINT IF EXISTS auto_campaign_input_origins_source_check;
ALTER TABLE public.auto_campaign_input_origins
  ADD CONSTRAINT auto_campaign_input_origins_source_check CHECK (
    (
      origin_kind = 'group'
      AND membership_id IS NOT NULL
      AND (source_id IS NOT NULL OR batch_id IS NOT NULL)
    )
    OR (origin_kind = 'automation' AND automation_detail_id IS NOT NULL)
    OR (
      origin_kind IN ('manual', 'api')
      AND source_id IS NULL
      AND automation_detail_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_campaign_schedule timestamptz,
  p_campaign_status text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_action text;
  v_platform text;
  v_contact_type text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_input_uid text;
  v_input_phone text;
  v_input_email text;
  v_target_value text;
  v_identity_value text;
  v_uid_identity text;
  v_url_identity text;
  v_allow_alias_resolution boolean;
  v_target_kind text;
  v_scope text;
  v_candidate_key text;
  v_canonical_key text;
  v_aliases text[];
  v_mapped_keys text[];
  v_payload jsonb;
  v_input_id bigint;
  v_inserted_row boolean;
  v_info1 text;
  v_info2 text;
  v_info3 text;
  v_info4 text;
  v_info5 text;
  v_phone_carrier text;
  v_request_hash text;
  v_result jsonb;
  v_active integer := 0;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_has_relationship boolean;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_group_id IS NULL OR p_group_id <= 0
    OR p_campaign_schedule IS NULL
    OR p_campaign_status IS NULL
    OR p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng')
    OR NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_direct_campaign_group_snapshot';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'snapshot_campaign',
    'campaignId', p_campaign_id,
    'groupId', p_group_id,
    'campaignSchedule', to_char(
      p_campaign_schedule AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US'
    ),
    'campaignStatus', p_campaign_status
  )::text);

  -- Return a committed response before consulting mutable campaign/group state.
  -- This makes response-loss retries stable even if the group changes later.
  SELECT batch.*
  INTO v_batch
  FROM public.auto_data_ingest_batches AS batch
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = btrim(p_request_id)
  FOR UPDATE;
  IF FOUND THEN
    IF v_batch.operation <> 'snapshot_campaign'
      OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  -- Match the shared Data Group lock hierarchy (group -> campaign) used by
  -- ingest/bind/delete; do not invert those locks during live intake.
  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;
  IF v_campaign.data_target_source_mode IS DISTINCT FROM 'direct'
    OR v_campaign.provisioning_state IS DISTINCT FROM 'ready'
    OR v_campaign.status = 'đang chạy'
    OR EXISTS (
      SELECT 1
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.campaign_id = v_campaign.id
    )
  THEN
    RAISE EXCEPTION 'campaign_not_direct_snapshot_eligible';
  END IF;
  IF v_campaign.action_id NOT IN (
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
    FROM public.auto_campaign_actions AS action
    WHERE action.id = v_campaign.action_id
      AND action.is_active = true
      AND COALESCE(action.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'campaign_action_inactive';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'campaign_account_not_found';
  END IF;

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, source_name, request_hash,
    status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'snapshot_campaign', v_group.id, 'manual',
    'Snapshot Nhóm data: ' || v_group.name, v_request_hash,
    'processing', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'snapshot_campaign'
      OR v_batch.group_id IS DISTINCT FROM v_group.id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  v_action := btrim(COALESCE(v_campaign.action_id, ''));

  FOR v_member IN
    SELECT member.*
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id
      AND member.is_delete = false
    ORDER BY member.id
  LOOP
    v_active := v_active + 1;
    v_input_uid := NULL;
    v_input_phone := NULL;
    v_input_email := NULL;
    v_target_value := NULL;
    v_identity_value := NULL;
    v_uid_identity := NULL;
    v_url_identity := NULL;
    v_target_kind := NULL;
    v_scope := NULL;
    v_candidate_key := NULL;
    v_canonical_key := NULL;
    v_aliases := '{}'::text[];
    v_mapped_keys := '{}'::text[];
    v_allow_alias_resolution := false;
    v_input_id := NULL;
    v_inserted_row := false;
    v_has_relationship := false;

    SELECT contact.*
    INTO v_contact
    FROM public.auto_account_contacts AS contact
    WHERE contact.id = v_member.contact_id
      AND contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND COALESCE(contact.is_delete, false) = false;
    IF NOT FOUND THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;

    v_platform := lower(btrim(COALESCE(v_contact.flatform_type, '')));
    v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
    v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
    v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
    v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
    v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
      NULLIF(v_contact.phone, ''),
      NULLIF(v_contact.extra_data ->> 'phone', ''),
      CASE WHEN v_contact_type = 'phone' THEN v_contact.uid ELSE NULL END,
      ''
    ));
    v_phone := NULLIF(v_phone, '');
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
    v_info1 := NULLIF(v_contact.extra_data ->> 'info1', '');
    v_info2 := NULLIF(v_contact.extra_data ->> 'info2', '');
    v_info3 := NULLIF(v_contact.extra_data ->> 'info3', '');
    v_info4 := NULLIF(v_contact.extra_data ->> 'info4', '');
    v_info5 := NULLIF(v_contact.extra_data ->> 'info5', '');
    v_phone_carrier := COALESCE(
      NULLIF(v_contact.extra_data ->> 'phoneCarrier', ''),
      NULLIF(v_contact.extra_data ->> 'phone_carrier', '')
    );

    IF v_action IN ('facebook_group_post', 'facebook_join_group', 'facebook_find_data_group') THEN
      IF v_platform <> 'facebook' OR v_contact_type <> 'group' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_group'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_message_uid' THEN
      IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_find_data_search' THEN
      IF v_platform <> 'facebook' OR v_contact_type <> 'campaign_input' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := v_uid;
      v_target_kind := 'facebook_search'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action IN ('facebook_comment_seeding', 'facebook_comment_seeding_post') THEN
      IF v_platform <> 'facebook'
        OR (v_action = 'facebook_comment_seeding'
          AND v_contact_type NOT IN ('group', 'page', 'person', 'campaign_input'))
        OR (v_action = 'facebook_comment_seeding_post'
          AND v_contact_type <> 'campaign_input')
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := CASE WHEN v_action = 'facebook_comment_seeding_post'
        THEN 'facebook_post' ELSE 'facebook_comment_target' END;
      v_scope := 'portable'; v_input_uid := v_target_value;
    ELSIF v_action = 'zalo_message_phone' THEN
      IF v_phone IS NULL THEN v_incompatible := v_incompatible + 1; CONTINUE; END IF;
      v_target_value := v_phone; v_target_kind := 'phone'; v_scope := 'portable';
      v_input_phone := v_phone;
    ELSIF v_action = 'zalo_join_group_link' THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'group' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'zalo_group_link'; v_scope := 'portable';
      v_input_uid := v_target_value;
    ELSIF v_action = 'email_send' THEN
      IF v_email IS NULL THEN v_incompatible := v_incompatible + 1; CONTINUE; END IF;
      v_target_value := v_email; v_target_kind := 'email'; v_scope := 'portable';
      v_input_email := v_email;
    ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
      IF v_platform <> 'facebook' OR v_contact_type <> 'person'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR v_contact.is_friend IS DISTINCT FROM true
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_page_post' THEN
      IF v_platform <> 'facebook' OR v_contact_type <> 'page'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_uid, v_url);
      v_target_kind := 'facebook_page';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action IN (
      'zalo_message_friend', 'zalo_message_group_member',
      'zalo_message_remarketing_customer'
    ) THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'person'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR (v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true)
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      IF v_action IN ('zalo_message_group_member', 'zalo_message_remarketing_customer') THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = v_member.id
            AND origin.is_current = true
            AND origin.source_account_id = v_campaign.account_id
            AND origin.relationship_kind = CASE v_action
              WHEN 'zalo_message_group_member' THEN 'zalo_group_members'
              ELSE 'zalo_remarketing_customers'
            END
        ) INTO v_has_relationship;
        IF NOT v_has_relationship AND v_action = 'zalo_message_group_member' THEN
          SELECT EXISTS (
            SELECT 1
            FROM public.zalo_group_members AS relation
            WHERE relation.account_id = v_campaign.account_id
              AND relation.zalo_uid = v_uid
              AND relation.is_current = true
              AND (relation.staff_id IS NULL OR relation.staff_id = p_staff_id)
              AND (relation.organization_id IS NULL OR relation.organization_id = p_organization_id)
          ) INTO v_has_relationship;
        END IF;
        IF NOT v_has_relationship THEN
          v_incompatible := v_incompatible + 1; CONTINUE;
        END IF;
      END IF;
      v_target_value := v_uid; v_target_kind := 'zalo_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSIF v_action = 'zalo_message_group' THEN
      IF v_platform <> 'zalo' OR v_contact_type <> 'group'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR v_contact.is_joined IS DISTINCT FROM true
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := v_uid; v_target_kind := 'zalo_group';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSIF v_action = 'zalo_add_group_member' THEN
      IF v_phone IS NOT NULL THEN
        v_target_value := v_phone; v_target_kind := 'phone'; v_scope := 'portable';
        v_input_phone := v_phone; v_input_uid := '';
      ELSIF v_platform = 'zalo' AND v_contact_type = 'person'
        AND v_uid IS NOT NULL
        AND v_contact.account_id IS NOT DISTINCT FROM v_campaign.account_id
      THEN
        v_target_value := v_uid; v_target_kind := 'zalo_person';
        v_scope := 'bound:' || v_campaign.account_id::text;
        v_input_uid := v_uid;
      ELSE
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
    ELSE
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    IF NULLIF(v_target_value, '') IS NULL THEN
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    IF v_target_kind LIKE 'facebook_%' THEN
      v_uid_identity := CASE WHEN v_uid IS NULL THEN NULL
        ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_uid), '') END;
      v_url_identity := CASE WHEN v_url IS NULL THEN NULL
        ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_url), '') END;
      v_identity_value := COALESCE(
        v_uid_identity,
        v_url_identity,
        NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_target_value), '')
      );
      v_allow_alias_resolution := true;
    ELSIF v_target_kind = 'email' THEN
      v_identity_value := lower(v_target_value);
    ELSE
      v_identity_value := v_target_value;
    END IF;
    IF NULLIF(v_identity_value, '') IS NULL THEN
      v_incompatible := v_incompatible + 1; CONTINUE;
    END IF;

    v_candidate_key := v_scope || ':' || v_target_kind || ':' || v_identity_value;
    v_aliases := array_append(v_aliases, v_candidate_key);
    IF v_target_kind LIKE 'facebook_%' AND v_uid_identity IS NOT NULL THEN
      v_aliases := array_append(
        v_aliases, v_scope || ':' || v_target_kind || ':' || v_uid_identity
      );
    END IF;
    IF v_target_kind LIKE 'facebook_%' AND v_url_identity IS NOT NULL THEN
      v_aliases := array_append(
        v_aliases, v_scope || ':' || v_target_kind || ':' || v_url_identity
      );
    END IF;

    SELECT COALESCE(array_agg(DISTINCT alias.canonical_target_key), '{}'::text[])
    INTO v_mapped_keys
    FROM public.auto_campaign_input_target_aliases AS alias
    WHERE alias.campaign_id = v_campaign.id
      AND alias.alias_key = ANY(v_aliases);

    IF cardinality(v_mapped_keys) > 1
      OR (
        cardinality(v_mapped_keys) = 1
        AND NOT v_allow_alias_resolution
        AND v_mapped_keys[1] IS DISTINCT FROM v_candidate_key
      )
    THEN
      UPDATE public.auto_campaign_input_target_aliases AS alias
      SET conflict_count = alias.conflict_count + 1,
          last_conflict_at = now(),
          last_conflict_payload = jsonb_build_object(
            'membershipId', v_member.id,
            'candidateCanonicalKey', v_candidate_key,
            'mappedCanonicalKeys', to_jsonb(v_mapped_keys),
            'aliases', to_jsonb(v_aliases),
            'snapshotBatchId', v_batch.id
          ),
          updated_at = now()
      WHERE alias.campaign_id = v_campaign.id
        AND alias.alias_key = ANY(v_aliases);
      v_conflict := v_conflict + 1;
      CONTINUE;
    END IF;

    v_canonical_key := CASE
      WHEN v_allow_alias_resolution AND cardinality(v_mapped_keys) = 1
        THEN v_mapped_keys[1]
      ELSE v_candidate_key
    END;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', COALESCE(v_name, v_target_value),
      'phone', v_input_phone,
      'phone_carrier', v_phone_carrier,
      'uid', v_input_uid,
      'email', v_input_email,
      'info1', v_info1,
      'info2', v_info2,
      'info3', v_info3,
      'info4', v_info4,
      'info5', v_info5,
      'contact_id', v_contact.id,
      'membership_id', v_member.id,
      'source_account_id', v_contact.account_id,
      'contact_type', v_contact.contact_type,
      'flatform_type', v_contact.flatform_type,
      'canonical_target_key', v_canonical_key,
      'snapshot_group_id', v_group.id,
      'snapshot_group_revision', v_group.revision
    ));

    -- Legacy direct rows deliberately keep canonical_target_key=NULL. Snapshot
    -- dedupe starts with canonical inputs and never guesses/backfills identity.
    INSERT INTO public.auto_campaign_input_data (
      campaign_id, input_id, name, phone, phone_carrier, uid, email,
      info1, info2, info3, info4, info5, status, schedule, is_delete,
      canonical_target_key, created_at
    ) VALUES (
      v_campaign.id, NULL, COALESCE(v_name, v_target_value),
      v_input_phone, v_phone_carrier, v_input_uid, v_input_email,
      v_info1, v_info2, v_info3, v_info4, v_info5,
      'chờ xử lý', p_campaign_schedule, false,
      v_canonical_key, now()
    )
    ON CONFLICT (campaign_id, canonical_target_key)
      WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false
    DO NOTHING
    RETURNING id INTO v_input_id;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_campaign.id
        AND input_data.canonical_target_key = v_canonical_key
        AND COALESCE(input_data.is_delete, false) = false
      FOR UPDATE;
    ELSE
      v_inserted_row := true;
    END IF;

    INSERT INTO public.auto_campaign_input_target_aliases (
      campaign_id, alias_key, canonical_target_key, input_data_id
    )
    SELECT v_campaign.id, candidate.alias_key, v_canonical_key, v_input_id
    FROM (SELECT DISTINCT unnest(v_aliases) AS alias_key) AS candidate
    ON CONFLICT (campaign_id, alias_key) DO UPDATE
    SET input_data_id = EXCLUDED.input_data_id,
        updated_at = now()
    WHERE auto_campaign_input_target_aliases.canonical_target_key
      = EXCLUDED.canonical_target_key;

    INSERT INTO public.auto_campaign_input_origins (
      input_data_id, source_id, group_id, membership_id, batch_id,
      origin_kind, group_revision, canonical_target_key, payload_snapshot
    ) VALUES (
      v_input_id, NULL, v_group.id, v_member.id, v_batch.id,
      'group', v_group.revision, v_canonical_key, v_payload
    ) ON CONFLICT DO NOTHING;

    IF v_inserted_row THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_existing := v_existing + 1;
    END IF;
  END LOOP;

  IF v_inserted > 0 THEN
    UPDATE public.auto_campaigns AS campaign
    SET schedule = p_campaign_schedule,
        original_schedule = p_campaign_schedule,
        status = p_campaign_status,
        note = CASE
          WHEN campaign.note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
          ELSE campaign.note
        END,
        updated_at = now()
    WHERE campaign.id = v_campaign.id;
  END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'campaign_id', v_campaign.id,
    'group_id', v_group.id,
    'group_revision', v_group.revision,
    'active_membership_count', v_active,
    'inserted_count', v_inserted,
    'already_seen_count', v_existing,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict
  );

  UPDATE public.auto_data_ingest_batches AS batch
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE batch.id = v_batch.id;

  RETURN v_result;
END;
$$;

-- Batch resolve exact automation rules for input provenance. No automation
-- table privileges are exposed to the desktop role.
CREATE OR REPLACE FUNCTION public.aka_agent_list_automation_refs_by_detail_ids(
  p_staff_id bigint,
  p_organization_id bigint,
  p_detail_ids bigint[],
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  automation_detail_id bigint,
  automation_id bigint,
  automation_name text,
  source_campaign_id bigint,
  target_campaign_id bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF COALESCE(cardinality(p_detail_ids), 0) > 500 THEN
    RAISE EXCEPTION 'too_many_automation_detail_ids';
  END IF;

  RETURN QUERY
  SELECT
    detail.id,
    automation.id,
    automation.name,
    source_campaign.id,
    target_campaign.id
  FROM public.auto_automation_detail AS detail
  JOIN public.auto_automation AS automation
    ON automation.id = detail.automation_id
   AND automation.staff_id = p_staff_id
   AND automation.organization_id = p_organization_id
  LEFT JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = detail.source_campaign_id
   AND source_campaign.staff_id = p_staff_id
   AND source_campaign.organization_id = p_organization_id
  LEFT JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = detail.target_campaign_id
   AND target_campaign.staff_id = p_staff_id
   AND target_campaign.organization_id = p_organization_id
  WHERE detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
    AND detail.id = ANY(COALESCE(p_detail_ids, '{}'::bigint[]))
  ORDER BY detail.id;
END;
$$;

-- Resolve the one-to-many executions created by each exact source result row.
-- Campaign ownership and every returned automation/detail row are tenant-bound.
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_detail_automation_triggers(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_campaign_detail_ids bigint[],
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  source_campaign_detail_id bigint,
  automation_detail_id bigint,
  automation_id bigint,
  automation_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(cardinality(p_campaign_detail_ids), 0) > 500
  THEN
    RAISE EXCEPTION 'invalid_campaign_detail_automation_trigger_query';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  RETURN QUERY
  SELECT
    detail.source_campaign_detail_id,
    detail.id,
    automation.id,
    automation.name
  FROM public.auto_automation_detail AS detail
  JOIN public.auto_automation AS automation
    ON automation.id = detail.automation_id
   AND automation.staff_id = p_staff_id
   AND automation.organization_id = p_organization_id
  JOIN public.auto_campaign_details AS source_detail
    ON source_detail.id = detail.source_campaign_detail_id
   AND source_detail.campaign_id = p_campaign_id
   AND COALESCE(source_detail.is_delete, false) = false
  WHERE detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
    AND detail.source_campaign_id = p_campaign_id
    AND detail.source_campaign_detail_id
      = ANY(COALESCE(p_campaign_detail_ids, '{}'::bigint[]))
  ORDER BY detail.source_campaign_detail_id, detail.id;
END;
$$;

COMMENT ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) IS
  'Idempotent one-time snapshot of compatible current Data Group memberships into an existing direct campaign; never creates an incremental source.';

REVOKE ALL ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_automation_refs_by_detail_ids(
  bigint, bigint, bigint[], text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_automation_refs_by_detail_ids(
  bigint, bigint, bigint[], text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_detail_automation_triggers(
  bigint, bigint, bigint, bigint[], text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_detail_automation_triggers(
  bigint, bigint, bigint, bigint[], text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
