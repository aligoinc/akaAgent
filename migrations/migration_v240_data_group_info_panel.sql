-- Full Data Group information panel: durable notes plus one bounded,
-- tenant-authenticated aggregate payload for the renderer.
--
-- Live source captured from linked project cgjbsmqtfhqvttudyjzq on 2026-08-14:
--   auto_assert_automation_identity(bigint,bigint,text,text)
--     md5(pg_get_functiondef) = 5a9a503db72b965eb644739f5f60905d
--   aka_agent_get_data_group_latest_ingest_stats(bigint,bigint,bigint)
--     md5(pg_get_functiondef) = 2ac39f53f2d9a73f4ae3114a3afb8b58
--   aka_agent_control_campaign_progress(bigint,bigint,bigint[])
--     md5(pg_get_functiondef) = fdff962116bb5f2c98830dbfaec6a7f4
--
-- The two v240 signatures were absent live. Existing RPC bodies are not
-- replaced, so later live Data Group patches remain untouched.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_guard oid := pg_catalog.to_regprocedure(
    'public.auto_assert_automation_identity(bigint,bigint,text,text)'
  );
  v_ingest_stats oid := pg_catalog.to_regprocedure(
    'public.aka_agent_get_data_group_latest_ingest_stats(bigint,bigint,bigint)'
  );
  v_progress oid := pg_catalog.to_regprocedure(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[])'
  );
  v_panel oid := pg_catalog.to_regprocedure(
    'public.aka_agent_get_data_group_panel(bigint,bigint,bigint,text,text)'
  );
  v_note oid := pg_catalog.to_regprocedure(
    'public.aka_agent_update_data_group_note(bigint,bigint,bigint,text,text,text)'
  );
  v_note_type text;
BEGIN
  IF v_guard IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard))
      IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d'
  THEN
    RAISE EXCEPTION 'v240: automation identity guard is missing or changed';
  END IF;

  IF v_ingest_stats IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_ingest_stats))
      IS DISTINCT FROM '2ac39f53f2d9a73f4ae3114a3afb8b58'
  THEN
    RAISE EXCEPTION 'v240: live Data Group ingest stats RPC is missing or changed';
  END IF;

  IF v_progress IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_progress))
      IS DISTINCT FROM 'fdff962116bb5f2c98830dbfaec6a7f4'
  THEN
    RAISE EXCEPTION 'v240: campaign progress aggregate is missing or changed';
  END IF;

  IF v_panel IS NOT NULL THEN
    RAISE EXCEPTION 'v240: unexpected panel RPC already exists (checksum %)',
      pg_catalog.md5(pg_catalog.pg_get_functiondef(v_panel));
  END IF;

  IF v_note IS NOT NULL THEN
    RAISE EXCEPTION 'v240: unexpected note RPC already exists (checksum %)',
      pg_catalog.md5(pg_catalog.pg_get_functiondef(v_note));
  END IF;

  SELECT columns.udt_name
  INTO v_note_type
  FROM information_schema.columns
  WHERE columns.table_schema = 'public'
    AND columns.table_name = 'auto_account_contact_groups'
    AND columns.column_name = 'note';

  IF v_note_type IS NOT NULL AND v_note_type <> 'text' THEN
    RAISE EXCEPTION 'v240: auto_account_contact_groups.note has unexpected type %', v_note_type;
  END IF;
END;
$preflight$;

ALTER TABLE public.auto_account_contact_groups
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN public.auto_account_contact_groups.note IS
  'Optional staff-authored note displayed in the Data Group information panel.';

CREATE FUNCTION public.aka_agent_update_data_group_note(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_note text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF p_note IS NOT NULL AND length(p_note) > 2000 THEN
    RAISE EXCEPTION 'data_group_note_too_long';
  END IF;

  UPDATE public.auto_account_contact_groups AS contact_group
  SET note = NULLIF(btrim(p_note), ''),
      updated_at = clock_timestamp()
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  RETURNING contact_group.* INTO v_group;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  RETURN jsonb_build_object(
    'group_id', v_group.id,
    'note', v_group.note,
    'updated_at', v_group.updated_at
  );
END;
$function$;

CREATE FUNCTION public.aka_agent_get_data_group_panel(
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
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_creator_name text;
  v_data_type_code text;
  v_data_type_name text;
  v_campaign_ids bigint[] := ARRAY[]::bigint[];
  v_unique_target_count bigint := 0;
  v_campaign_input_count bigint := 0;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  SELECT staff.name, data_type.code, data_type.name
  INTO v_creator_name, v_data_type_code, v_data_type_name
  FROM public.auto_account_contact_groups AS contact_group
  LEFT JOIN public.org_staff AS staff
    ON staff.id = contact_group.staff_id
   AND staff.organization_id = contact_group.organization_id
  LEFT JOIN public.category_item AS data_type
    ON data_type.id = contact_group.data_type_category_item_id
  WHERE contact_group.id = v_group.id;

  SELECT
    stats.unique_compatible_target_count,
    stats.campaign_input_count
  INTO
    v_unique_target_count,
    v_campaign_input_count
  FROM public.aka_agent_get_data_group_latest_ingest_stats(
    p_staff_id,
    p_organization_id,
    p_group_id
  ) AS stats;

  SELECT COALESCE(array_agg(campaign.id ORDER BY campaign.id), ARRAY[]::bigint[])
  INTO v_campaign_ids
  FROM public.auto_campaigns AS campaign
  LEFT JOIN public.auto_campaign_data_group_sources AS source
    ON source.campaign_id = campaign.id
   AND source.staff_id = p_staff_id
   AND source.organization_id = p_organization_id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(source.group_id, campaign.data_group_id) = p_group_id;

  RETURN jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id,
      'name', v_group.name,
      'color', v_group.color,
      'note', v_group.note,
      'creator_name', COALESCE(v_creator_name, '—'),
      'data_type_category_item_id', v_group.data_type_category_item_id,
      'data_type_code', v_data_type_code,
      'data_type_name', COALESCE(v_data_type_name, 'Mọi loại dữ liệu'),
      'dataset_sync_mode', v_group.dataset_sync_mode,
      'revision', v_group.revision,
      'created_at', v_group.created_at,
      'updated_at', v_group.updated_at,
      'latest_data_added_at', (
        SELECT max(COALESCE(origin.created_at, member.created_at))
        FROM public.auto_account_contact_group_members AS member
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
      )
    ),
    'summary', jsonb_build_object(
      'active_membership_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
      ),
      'unique_target_count', COALESCE(v_unique_target_count, 0),
      'duplicate_count', GREATEST(
        0,
        (
          SELECT count(*)::bigint
          FROM public.auto_account_contact_group_members AS member
          WHERE member.group_id = v_group.id
            AND member.is_delete = false
        ) - COALESCE(v_unique_target_count, 0)
      ),
      'campaign_input_count', COALESCE(v_campaign_input_count, 0),
      'campaign_count', COALESCE(cardinality(v_campaign_ids), 0),
      'active_campaign_count', (
        SELECT count(*)::bigint
        FROM public.auto_campaigns AS campaign
        LEFT JOIN public.auto_campaign_data_group_sources AS source
          ON source.campaign_id = campaign.id
         AND source.staff_id = p_staff_id
         AND source.organization_id = p_organization_id
        WHERE campaign.id = ANY(v_campaign_ids)
          AND campaign.status IN ('chờ xử lý', 'đang chạy', 'tạm dừng')
          AND COALESCE(source.status, 'active') <> 'stopped'
      ),
      'run_count', (
        SELECT count(*)::bigint
        FROM public.auto_runs AS run
        WHERE run.campaign_id = ANY(v_campaign_ids)
      )
    ),
    'quality', jsonb_build_object(
      'with_link_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
          AND NULLIF(btrim(contact.url), '') IS NOT NULL
      ),
      'with_phone_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
          AND NULLIF(btrim(contact.phone), '') IS NOT NULL
      ),
      'with_uid_count', (
        SELECT count(*)::bigint
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
          AND NULLIF(btrim(contact.uid), '') IS NOT NULL
      ),
      'duplicate_count', GREATEST(
        0,
        (
          SELECT count(*)::bigint
          FROM public.auto_account_contact_group_members AS member
          WHERE member.group_id = v_group.id
            AND member.is_delete = false
        ) - COALESCE(v_unique_target_count, 0)
      )
    ),
    'source_breakdown', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'kind', source_rows.kind,
          'count', source_rows.member_count
        )
        ORDER BY source_rows.member_count DESC, source_rows.kind
      )
      FROM (
        SELECT
          COALESCE(origin.kind, 'legacy_unknown') AS kind,
          count(*)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY COALESCE(origin.kind, 'legacy_unknown')
      ) AS source_rows
    ), '[]'::jsonb),
    'data_type_breakdown', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'data_type_category_item_id', type_rows.data_type_category_item_id,
          'code', type_rows.code,
          'name', type_rows.name,
          'count', type_rows.member_count
        )
        ORDER BY type_rows.member_count DESC, type_rows.name
      )
      FROM (
        SELECT
          COALESCE(origin.data_type_category_item_id, v_group.data_type_category_item_id)
            AS data_type_category_item_id,
          COALESCE(data_type.code, contact.flatform_type || '_' || contact.contact_type, 'unknown')
            AS code,
          COALESCE(
            data_type.name,
            CASE
              WHEN contact.flatform_type = 'facebook' AND contact.contact_type = 'person' THEN 'Facebook · User'
              WHEN contact.flatform_type = 'facebook' AND contact.contact_type = 'group' THEN 'Facebook · Group'
              WHEN contact.flatform_type = 'facebook' AND contact.contact_type = 'page' THEN 'Facebook · Page'
              WHEN contact.flatform_type = 'zalo' AND contact.contact_type = 'person' THEN 'Zalo · User'
              WHEN contact.flatform_type = 'zalo' AND contact.contact_type = 'group' THEN 'Zalo · Group'
              WHEN contact.contact_type = 'phone' THEN 'Số điện thoại'
              WHEN contact.contact_type = 'email' THEN 'Email'
              ELSE 'Chưa xác định'
            END
          ) AS name,
          count(*)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        LEFT JOIN public.category_item AS data_type
          ON data_type.id = COALESCE(
            origin.data_type_category_item_id,
            v_group.data_type_category_item_id
          )
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY
          COALESCE(origin.data_type_category_item_id, v_group.data_type_category_item_id),
          data_type.code,
          data_type.name,
          contact.flatform_type,
          contact.contact_type
      ) AS type_rows
    ), '[]'::jsonb),
    'account_breakdown', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'account_id', account_rows.account_id,
          'name', account_rows.name,
          'is_delete', account_rows.is_delete,
          'count', account_rows.member_count
        )
        ORDER BY account_rows.member_count DESC, account_rows.name
      )
      FROM (
        SELECT
          COALESCE(origin.source_account_id, contact.account_id::bigint) AS account_id,
          COALESCE(account.name, 'Chưa gắn tài khoản') AS name,
          COALESCE(account.is_delete, false) AS is_delete,
          count(*)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        LEFT JOIN public.auto_account_contact_group_member_origins AS origin
          ON origin.id = member.primary_origin_id
        LEFT JOIN public.auto_accounts AS account
          ON account.id = COALESCE(origin.source_account_id, contact.account_id::bigint)
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY
          COALESCE(origin.source_account_id, contact.account_id::bigint),
          account.name,
          account.is_delete
      ) AS account_rows
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', tag_rows.id,
          'name', tag_rows.name,
          'color', tag_rows.color,
          'count', tag_rows.member_count
        )
        ORDER BY tag_rows.member_count DESC, tag_rows.name
      )
      FROM (
        SELECT
          tag.id,
          tag.name,
          tag.color,
          count(DISTINCT member.id)::bigint AS member_count
        FROM public.auto_account_contact_group_members AS member
        JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
        CROSS JOIN LATERAL unnest(COALESCE(contact.akabiz_tag_ids, ARRAY[]::bigint[])) AS tag_id
        JOIN public.auto_contact_tags AS tag
          ON tag.id = tag_id
         AND tag.staff_id = p_staff_id
         AND tag.organization_id = p_organization_id
         AND tag.is_delete = false
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
        GROUP BY tag.id, tag.name, tag.color
      ) AS tag_rows
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', history_rows.id,
          'operation', history_rows.operation,
          'kind', history_rows.kind,
          'source_name', history_rows.source_name,
          'status', history_rows.status,
          'result', COALESCE(history_rows.result, '{}'::jsonb),
          'is_target_group', history_rows.target_group_id = v_group.id,
          'created_at', history_rows.created_at,
          'updated_at', history_rows.updated_at
        )
        ORDER BY history_rows.created_at DESC, history_rows.id DESC
      )
      FROM (
        SELECT batch.*
        FROM public.auto_data_ingest_batches AS batch
        WHERE batch.staff_id = p_staff_id
          AND batch.organization_id = p_organization_id
          AND (batch.group_id = v_group.id OR batch.target_group_id = v_group.id)
        ORDER BY batch.created_at DESC, batch.id DESC
        LIMIT 20
      ) AS history_rows
    ), '[]'::jsonb),
    'campaigns', COALESCE((
      WITH progress AS (
        SELECT *
        FROM public.aka_agent_control_campaign_progress(
          p_staff_id,
          p_organization_id,
          v_campaign_ids
        )
      ),
      detail_counts AS (
        SELECT
          detail.campaign_id,
          count(*) FILTER (
            WHERE detail.status IN ('thành công', 'hoàn thành', 'đã xem', 'đã click')
          )::bigint AS success_count,
          count(*) FILTER (
            WHERE detail.status IN ('thất bại', 'không tồn tại')
          )::bigint AS failure_count,
          count(*) FILTER (WHERE detail.status = 'lỗi')::bigint AS error_count
        FROM public.auto_campaign_details AS detail
        WHERE detail.campaign_id = ANY(v_campaign_ids)
          AND COALESCE(detail.is_delete, false) = false
        GROUP BY detail.campaign_id
      ),
      run_counts AS (
        SELECT run.campaign_id, count(*)::bigint AS run_count
        FROM public.auto_runs AS run
        WHERE run.campaign_id = ANY(v_campaign_ids)
        GROUP BY run.campaign_id
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', campaign.id,
          'name', campaign.name,
          'action_id', campaign.action_id,
          'action_name', COALESCE(action.name, campaign.action_id, '—'),
          'account_id', campaign.account_id,
          'account_name', COALESCE(account.name, '—'),
          'status', campaign.status,
          'schedule', campaign.schedule,
          'original_schedule', campaign.original_schedule,
          'schedule_type', campaign.schedule_type,
          'schedule_days', campaign.schedule_days,
          'schedule_week_days', campaign.schedule_week_days,
          'last_run_at', campaign.last_run_at,
          'completed_at', campaign.completed_at,
          'created_at', campaign.created_at,
          'updated_at', campaign.updated_at,
          'daily_limit', account.daily_limit,
          'source_status', source.status,
          'input_total', COALESCE(progress.input_total, 0),
          'input_completed', COALESCE(progress.input_completed, 0),
          'input_failed', COALESCE(progress.input_failed, 0),
          'success_count', COALESCE(detail_counts.success_count, 0),
          'failure_count', COALESCE(detail_counts.failure_count, 0),
          'error_count', COALESCE(detail_counts.error_count, 0),
          'run_count', COALESCE(run_counts.run_count, 0)
        )
        ORDER BY
          CASE campaign.status
            WHEN 'đang chạy' THEN 0
            WHEN 'tạm dừng' THEN 1
            WHEN 'chờ xử lý' THEN 2
            WHEN 'lỗi' THEN 3
            WHEN 'hoàn thành' THEN 4
            ELSE 5
          END,
          campaign.updated_at DESC,
          campaign.id DESC
      )
      FROM public.auto_campaigns AS campaign
      LEFT JOIN public.auto_campaign_actions AS action ON action.id = campaign.action_id
      LEFT JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      LEFT JOIN public.auto_campaign_data_group_sources AS source
        ON source.campaign_id = campaign.id
       AND source.staff_id = p_staff_id
       AND source.organization_id = p_organization_id
      LEFT JOIN progress ON progress.campaign_id = campaign.id
      LEFT JOIN detail_counts ON detail_counts.campaign_id = campaign.id
      LEFT JOIN run_counts ON run_counts.campaign_id = campaign.id
      WHERE campaign.id = ANY(v_campaign_ids)
    ), '[]'::jsonb)
  );
END;
$function$;

ALTER FUNCTION public.aka_agent_update_data_group_note(
  bigint, bigint, bigint, text, text, text
) OWNER TO postgres;

ALTER FUNCTION public.aka_agent_get_data_group_panel(
  bigint, bigint, bigint, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.aka_agent_update_data_group_note(
  bigint, bigint, bigint, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_get_data_group_panel(
  bigint, bigint, bigint, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_update_data_group_note(
  bigint, bigint, bigint, text, text, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_get_data_group_panel(
  bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_update_data_group_note(
  bigint, bigint, bigint, text, text, text
) IS 'Tenant-authenticated update for the optional Data Group information-panel note.';

COMMENT ON FUNCTION public.aka_agent_get_data_group_panel(
  bigint, bigint, bigint, text, text
) IS 'Tenant-authenticated bounded aggregate for the Data Group information panel, including quality, provenance, tags, ingest history and linked Campaign summaries.';

DO $postflight$
DECLARE
  v_panel oid := pg_catalog.to_regprocedure(
    'public.aka_agent_get_data_group_panel(bigint,bigint,bigint,text,text)'
  );
  v_note oid := pg_catalog.to_regprocedure(
    'public.aka_agent_update_data_group_note(bigint,bigint,bigint,text,text,text)'
  );
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_acl_valid boolean;
BEGIN
  IF v_panel IS NULL OR v_note IS NULL THEN
    RAISE EXCEPTION 'v240: expected Data Group panel functions are missing';
  END IF;

  FOR v_panel IN SELECT unnest(ARRAY[v_panel, v_note])
  LOOP
    SELECT
      pg_catalog.pg_get_userbyid(proc.proowner),
      proc.prosecdef,
      proc.provolatile,
      proc.proconfig,
      proc.proacl IS NOT NULL
        AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 4
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(proc.proacl) AS acl
          WHERE acl.grantee <> ALL(ARRAY[
            pg_catalog.to_regrole('postgres')::oid,
            pg_catalog.to_regrole('anon')::oid,
            pg_catalog.to_regrole('authenticated')::oid,
            pg_catalog.to_regrole('service_role')::oid
          ])
            OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
            OR acl.privilege_type <> 'EXECUTE'
            OR acl.is_grantable
        )
    INTO v_owner, v_security_definer, v_volatility, v_config, v_acl_valid
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = v_panel;

    IF v_owner IS DISTINCT FROM 'postgres'
      OR v_security_definer IS DISTINCT FROM true
      OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
      OR v_acl_valid IS DISTINCT FROM true
    THEN
      RAISE EXCEPTION 'v240: function metadata or ACL mismatch for %', v_panel::regprocedure;
    END IF;
  END LOOP;

  SELECT proc.provolatile
  INTO v_volatility
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = pg_catalog.to_regprocedure(
    'public.aka_agent_get_data_group_panel(bigint,bigint,bigint,text,text)'
  );
  IF v_volatility IS DISTINCT FROM 's'::"char" THEN
    RAISE EXCEPTION 'v240: panel RPC must remain STABLE';
  END IF;
END;
$postflight$;

COMMIT;
