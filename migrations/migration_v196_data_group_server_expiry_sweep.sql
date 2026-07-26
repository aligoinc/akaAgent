-- Data Group lifecycle finalizers for the QR-only Zalo Server runtime.
--
-- The desktop keeps using the credential-authenticated v186 wrappers. The
-- installed App Server intentionally ships only the anon key, so these narrow
-- SECURITY DEFINER entry points validate the live Server ownership revision
-- before delegating to the service-role-only v186 implementations. The opaque
-- revision is a freshness/CAS boundary, not a secret; authorization comes from
-- the live Product 16/18 mode plus the narrow tenant/account/action predicates.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_require_zalo_server_data_group_runtime(
  p_staff_id bigint,
  p_organization_id bigint,
  p_expected_mode_revision text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_staff_organization_id bigint;
  v_mode record;
  v_expected_mode_revision text := btrim(COALESCE(p_expected_mode_revision, ''));
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR v_expected_mode_revision = ''
  THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;

  SELECT staff.organization_id INTO v_staff_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_staff_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;

  -- Serialize ownership validation with the existing Product 16/18 mode
  -- mutation barrier used by all Zalo desktop/server runtime RPCs.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(p_organization_id);

  IF NOT COALESCE(v_mode.qr_enabled, false)
    OR COALESCE(v_mode.web_enabled, false)
    OR NOT COALESCE(v_mode.is_zalo_server, false)
    OR btrim(COALESCE(v_mode.mode_revision, '')) IS DISTINCT FROM v_expected_mode_revision
  THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;
END;
$function$;

-- A running QR Zalo Server campaign also reaches the ordinary Data Group
-- finalizer when it drains its current inputs. Keep that lifecycle path on the
-- same ownership boundary as the hard-end sweep.
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_data_group_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_expected_mode_revision text,
  p_campaign_id bigint,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_campaign_id bigint;
BEGIN
  PERFORM public.aka_agent_internal_require_zalo_server_data_group_runtime(
    p_staff_id,
    p_organization_id,
    p_expected_mode_revision
  );

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  -- The public server surface cannot finalize a Facebook, Email, Web-Zalo or
  -- another tenant's campaign. Lock the campaign before handing it to the v186
  -- implementation so action/account ownership cannot change in between.
  SELECT campaign.id INTO v_campaign_id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  JOIN public.auto_campaign_data_group_sources AS source
    ON source.campaign_id = campaign.id
   AND source.staff_id = campaign.staff_id
   AND source.organization_id = campaign.organization_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.data_target_source_mode = 'data_group'
    AND campaign.action_id IN (
      'zalo_message_phone',
      'zalo_join_group_link',
      'zalo_message_friend',
      'zalo_message_group_member',
      'zalo_message_remarketing_customer',
      'zalo_message_group',
      'zalo_add_group_member'
    )
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  RETURN public.aka_agent_finalize_data_group_campaign(
    p_staff_id,
    p_organization_id,
    v_campaign_id,
    p_note
  );
END;
$function$;

-- Sweep only hard-ended Data Group campaigns owned by QR Zalo accounts. The
-- desktop remains responsible for Facebook, Email and Web-Zalo campaigns in
-- the same tenant. SKIP LOCKED keeps concurrent scheduler ticks non-blocking.
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(
  p_staff_id bigint,
  p_organization_id bigint,
  p_expected_mode_revision text,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  campaign_id bigint,
  campaign_status text,
  result jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_candidate record;
  v_result jsonb;
  v_limit integer := COALESCE(p_limit, 200);
BEGIN
  PERFORM public.aka_agent_internal_require_zalo_server_data_group_runtime(
    p_staff_id,
    p_organization_id,
    p_expected_mode_revision
  );

  IF v_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_expired_data_group_campaign_limit';
  END IF;

  FOR v_candidate IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    JOIN public.auto_campaign_data_group_sources AS source
      ON source.campaign_id = campaign.id
     AND source.staff_id = p_staff_id
     AND source.organization_id = p_organization_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND campaign.data_target_source_mode = 'data_group'
      AND campaign.action_id IN (
        'zalo_message_phone',
        'zalo_join_group_link',
        'zalo_message_friend',
        'zalo_message_group_member',
        'zalo_message_remarketing_customer',
        'zalo_message_group',
        'zalo_add_group_member'
      )
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND campaign.schedule_end_date IS NOT NULL
      AND campaign.schedule_end_date <= now()
      AND (
        campaign.status <> 'hoàn thành'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS pending_input
          WHERE pending_input.campaign_id = campaign.id
            AND COALESCE(pending_input.is_delete, false) = false
            AND pending_input.status IN ('chờ xử lý', 'đang chạy')
        )
      )
    ORDER BY campaign.schedule_end_date, campaign.id
    FOR UPDATE OF campaign SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_result := public.aka_agent_finalize_data_group_campaign(
      p_staff_id,
      p_organization_id,
      v_candidate.id,
      'Chiến dịch đã hết hạn'
    );
    campaign_id := v_candidate.id;
    campaign_status := v_result ->> 'status';
    result := v_result;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_internal_require_zalo_server_data_group_runtime(
  bigint, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_finalize_zalo_server_data_group_campaign(
  bigint, bigint, text, bigint, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_finalize_zalo_server_data_group_campaign(
  bigint, bigint, text, bigint, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(
  bigint, bigint, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(
  bigint, bigint, text, integer
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_finalize_zalo_server_data_group_campaign(
  bigint, bigint, text, bigint, text
) IS
  'Finalize one QR Zalo Server Data Group campaign after validating active tenant ownership and the exact runtime mode revision.';
COMMENT ON FUNCTION public.aka_agent_finalize_expired_zalo_server_data_group_campaigns(
  bigint, bigint, text, integer
) IS
  'Sweep only hard-ended QR Zalo Server Data Group campaigns for the active tenant and exact runtime mode revision.';

NOTIFY pgrst, 'reload schema';

COMMIT;
