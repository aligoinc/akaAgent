-- Gỡ V497: trả aka_agent_app_access_chat_organizations và recover_server_zalo_running_state về bản live 11/11/2026,
-- xoá hàm luật cờ, hàm ghi mốc và bảng handoff (sinh bằng scripts/build-v497-sql.py, đừng sửa tay).
-- Chỉ chạy khi không còn dòng to_fly: tắt cờ các tổ chức không Chat và chờ ChatApi trả phiên về VPS (dòng thành to_vps),
-- nếu không VPS và Fly có thể cùng nối một tài khoản. Lệnh sửa schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('private.auto_zalo_server_session_handoff') IS NULL
     OR to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NULL
     OR to_regprocedure('private.aka_agent_zalo_server_mark_vps_released(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Rollback V497: thiếu đối tượng của V497';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_app_access_chat_organizations(bigint[])'::regprocedure)) <> '020a5b0a82d3354007feb3b769a5a62d'
     OR md5(pg_get_functiondef('public.recover_server_zalo_running_state(bigint,text,boolean)'::regprocedure)) <> 'e51b12406b7c1d67c36c9885c79f3a18' THEN
    RAISE EXCEPTION 'Rollback V497: hàm đã bị đổi sau V497, không ghi đè';
  END IF;
  IF EXISTS (SELECT 1 FROM private.auto_zalo_server_session_handoff WHERE direction = 'to_fly') THEN
    RAISE EXCEPTION 'Rollback V497: còn tài khoản đang ở Fly theo cờ; tắt cờ và chờ phiên về VPS trước';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_app_access_chat_organizations(p_orgs bigint[])
 RETURNS SETOF bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT id FROM unnest(p_orgs) id WHERE public.aka_agent_app_access_separate(id)
    OR public.aka_agent_app_access_chat_runtime(id)
$function$;

CREATE OR REPLACE FUNCTION public.recover_server_zalo_running_state(p_staff_id bigint, p_expected_mode_revision text DEFAULT NULL::text, p_require_server_mode boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_recovery_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_id bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'update') AS staff
  WHERE staff.id = p_staff_id
  ;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  IF NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NOT NULL
    AND v_capabilities.capability_revision IS DISTINCT FROM btrim(p_expected_mode_revision)
  THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  IF COALESCE(p_require_server_mode, false) AND (
    NOT COALESCE(v_capabilities.server_enabled, false)
    OR NOT COALESCE(v_capabilities.qr_enabled, false)
    OR v_capabilities.entitlement_id IS NULL
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime_mode_revision_mismatch';
  END IF;

  -- Claims/finalizers serialize campaign/input rows through this barrier.
  -- Recovery can touch more than one campaign, so acquire the complete set in
  -- ascending ID order before its first child/campaign row mutation. The staff
  -- row lock above prevents a new runtime claim from entering while this
  -- candidate set is established.
  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  -- A recovery requested by Server may only mutate Server-subtype accounts.
  -- With p_require_server_mode=false this also cleans an interrupted Server
  -- account after its capability/entitlement expired, without touching local.
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE input_data.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND input_data.status = 'đang chạy'
      AND COALESCE(input_data.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

    UPDATE public.auto_campaign_inputs AS campaign_input
    SET status = 'hoàn thành', note = v_recovery_note
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign_input.campaign_id = campaign.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND campaign_input.status = 'đang chạy'
      AND COALESCE(campaign_input.is_delete, false) = false;
    GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

    UPDATE public.auto_campaigns AS campaign
    SET status = 'chờ xử lý', updated_at = now()
    FROM public.auto_accounts AS account
    WHERE campaign.account_id = account.id
      AND campaign.staff_id = p_staff_id
      AND COALESCE(campaign.is_delete, false) = false
      AND campaign.status = 'đang chạy'
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false;
    GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

    UPDATE public.auto_accounts AS account
    SET status = 'chờ xử lý', updated_at = now()
    WHERE account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_zalo_show_web, false) = false
      AND COALESCE(account.is_zalo_server, false) = true
      AND COALESCE(account.is_delete, false) = false
      AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_inputs_completed', v_campaign_inputs_completed,
    'campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

DROP FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint);
DROP TABLE private.auto_zalo_server_session_handoff;
DROP FUNCTION public.aka_agent_zalo_server_flag_route(bigint);

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_app_access_chat_organizations(bigint[])'::regprocedure)) <> 'b48a2ab3d264c6a1c75345cd69a7582e'
     OR md5(pg_get_functiondef('public.recover_server_zalo_running_state(bigint,text,boolean)'::regprocedure)) <> '02c1541f6dbfcb1a352e94da888ac0bd' THEN
    RAISE EXCEPTION 'Rollback V497 postflight: hàm chưa về bản live';
  END IF;
END $post$;

COMMIT;
