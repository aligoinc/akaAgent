-- V497: định tuyến tài khoản Zalo Server theo cờ org_organization.use_new_zalo_runtime cho tổ chức không có Chat
-- (kế hoạch engine v2 mục 16; sinh bằng scripts/build-v497-sql.py từ bản live đọc 11/11/2026, đừng sửa tay).
-- 1) public.aka_agent_zalo_server_flag_route(org): tổ chức bật cờ, có gói 16/18 còn hạn và có quyền Server
--    (qr_enabled + server_enabled), đúng điều kiện VPS đang dùng ở discover_zalo_server_account_runtime_users.
-- 2) aka_agent_app_access_chat_organizations thêm "OR ChatApi đã nhận tổ chức" (có dòng to_fly): App Server (nơi duy nhất
--    gọi hàm này, đọc lại mỗi 60 giây) chỉ thả tổ chức sau khi ChatApi đã tạo dòng chờ chép phiên, và chỉ nhận lại sau khi
--    ChatApi đã trả phiên. Bảng mới chưa có dòng nên lúc apply kết quả y như cũ (so ngay trong giao dịch).
-- 3) private.auto_zalo_server_session_handoff: ChatApi theo dõi việc chép phiên VPS <-> Fly (một dòng mỗi tài khoản).
-- 4) recover_server_zalo_running_state: lời gọi của App Server lúc dừng runtime ghi mốc vps_released_at cho dòng to_fly
--    đang chờ của nhân viên (qua private.aka_agent_zalo_server_mark_vps_released). Không có dòng chờ thì như cũ.
-- Không đổi aka_agent_app_access_chat_runtime (Desktop/Web dùng cho màn Chat). Code cũ chạy y như trước khi chưa tổ
-- chức nào bật cờ. Lệnh sửa schema: PostgREST nạp lại schema, apply ngoài giờ cao điểm.
-- Gỡ: rollback_v497_zalo_server_flag_route.sql (chỉ khi không còn dòng to_fly: tắt cờ và chờ phiên về VPS trước).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v497_%') THEN
      RAISE EXCEPTION 'V497 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_zalo_server_mark_vps_released(bigint)') IS NOT NULL
     OR to_regclass('private.auto_zalo_server_session_handoff') IS NOT NULL THEN
    RAISE EXCEPTION 'V497: đối tượng mới đã tồn tại';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_app_access_chat_organizations(bigint[])'::regprocedure)) <> 'b48a2ab3d264c6a1c75345cd69a7582e' THEN
    RAISE EXCEPTION 'V497: aka_agent_app_access_chat_organizations khác bản live đã đọc 11/11';
  END IF;
  IF md5(pg_get_functiondef('public.recover_server_zalo_running_state(bigint,text,boolean)'::regprocedure)) <> '02c1541f6dbfcb1a352e94da888ac0bd' THEN
    RAISE EXCEPTION 'V497: recover_server_zalo_running_state khác bản live đã đọc 11/11';
  END IF;
  IF to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') IS NULL
     OR to_regprocedure('public.aka_agent_app_access_chat_runtime(bigint,boolean)') IS NULL
     OR to_regprocedure('public.aka_agent_app_access_separate(bigint)') IS NULL THEN
    RAISE EXCEPTION 'V497: thiếu hàm quyền dùng app/khả năng Zalo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.org_organization'::regclass
                  AND attname = 'use_new_zalo_runtime' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V497: thiếu cột org_organization.use_new_zalo_runtime (V371)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'V497: thiếu role aka_agent_chat_api hoặc service_role';
  END IF;
END $pre$;

CREATE TEMP TABLE v497_before ON COMMIT DROP AS
SELECT
  ARRAY(SELECT x FROM public.aka_agent_app_access_chat_organizations(ARRAY(SELECT o.id FROM public.org_organization o)) AS x ORDER BY 1)
    AS chat_orgs,
  (SELECT proacl::text FROM pg_proc WHERE oid = 'public.aka_agent_app_access_chat_organizations(bigint[])'::regprocedure) AS chat_orgs_acl,
  (SELECT proacl::text FROM pg_proc WHERE oid = 'public.recover_server_zalo_running_state(bigint,text,boolean)'::regprocedure) AS recover_acl;

CREATE FUNCTION public.aka_agent_zalo_server_flag_route(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  SELECT COALESCE((SELECT organization.use_new_zalo_runtime FROM public.org_organization AS organization
                    WHERE organization.id = p_org), false)
    AND EXISTS (
      SELECT 1 FROM public.org_organization_product AS entitlement
       WHERE entitlement.organization_id = p_org
         AND entitlement.product_id IN (16, 18)
         AND entitlement.is_deleted = false
         AND entitlement.expiration_date IS NOT NULL
         AND entitlement.expiration_date >= (
           date_trunc('day', timezone('Asia/Ho_Chi_Minh', now())) AT TIME ZONE 'Asia/Ho_Chi_Minh'
         ))
    AND EXISTS (
      SELECT 1 FROM public.resolve_organization_zalo_account_capabilities(p_org) AS capability
       WHERE capability.qr_enabled = true AND capability.server_enabled = true)
$function$;
COMMENT ON FUNCTION public.aka_agent_zalo_server_flag_route(bigint) IS
  'V497: tài khoản Zalo Server của tổ chức chạy trên Fly theo cờ use_new_zalo_runtime (tổ chức bật cờ, có gói 16/18 còn hạn, có quyền QR + Server). Tổ chức có Chat vẫn theo luật Chat như cũ.';
REVOKE ALL ON FUNCTION public.aka_agent_zalo_server_flag_route(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_zalo_server_flag_route(bigint) TO service_role, aka_agent_chat_api;

CREATE TABLE private.auto_zalo_server_session_handoff (
  account_id bigint PRIMARY KEY,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('to_fly', 'to_vps')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  vps_released_at timestamptz,
  completed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX auto_zalo_server_session_handoff_open_staff_idx
  ON private.auto_zalo_server_session_handoff (staff_id) WHERE completed_at IS NULL;
CREATE INDEX auto_zalo_server_session_handoff_to_fly_org_idx
  ON private.auto_zalo_server_session_handoff (organization_id) WHERE direction = 'to_fly';
COMMENT ON TABLE private.auto_zalo_server_session_handoff IS
  'V497: chép phiên Zalo Server giữa App Server (auto_accounts.zalo_session) và Fly (chat_zalo_account_organization). Chỉ ChatApi đọc/ghi; mốc vps_released_at do App Server ghi qua recover_server_zalo_running_state.';
ALTER TABLE private.auto_zalo_server_session_handoff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_zalo_server_session_handoff FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.auto_zalo_server_session_handoff TO aka_agent_chat_api;

CREATE FUNCTION private.aka_agent_zalo_server_mark_vps_released(p_staff_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE private.auto_zalo_server_session_handoff
     SET vps_released_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE staff_id = p_staff_id AND direction = 'to_fly' AND completed_at IS NULL AND vps_released_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_app_access_chat_organizations(p_orgs bigint[])
 RETURNS SETOF bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT id FROM unnest(p_orgs) id WHERE public.aka_agent_app_access_separate(id)
    OR public.aka_agent_app_access_chat_runtime(id)
    OR EXISTS (
      SELECT 1 FROM private.auto_zalo_server_session_handoff AS handoff
       WHERE handoff.organization_id = id AND handoff.direction = 'to_fly'
    )
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

  -- V497: App Server dừng runtime của nhân viên (đã ngắt mọi kết nối Zalo, rồi gọi hàm này với
  -- p_require_server_mode false) thì ghi mốc cho việc chép phiên sang Fly. Fly (aka_agent_chat_api) và lúc
  -- khởi động (p_require_server_mode true) không ghi. Lỗi ở bước ghi mốc không được làm hỏng việc dọn của VPS.
  IF current_user = 'service_role' AND NOT COALESCE(p_require_server_mode, false) THEN
    BEGIN
      PERFORM private.aka_agent_zalo_server_mark_vps_released(p_staff_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'V497 mark_vps_released staff %: %', p_staff_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_inputs_completed', v_campaign_inputs_completed,
    'campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

DO $post$
DECLARE
  b record;
  v_after bigint[];
BEGIN
  SELECT * INTO b FROM v497_before;
  IF md5(pg_get_functiondef('public.aka_agent_app_access_chat_organizations(bigint[])'::regprocedure)) <> '020a5b0a82d3354007feb3b769a5a62d' THEN
    RAISE EXCEPTION 'V497 postflight: aka_agent_app_access_chat_organizations khác bản sinh';
  END IF;
  IF md5(pg_get_functiondef('public.recover_server_zalo_running_state(bigint,text,boolean)'::regprocedure)) <> 'e51b12406b7c1d67c36c9885c79f3a18' THEN
    RAISE EXCEPTION 'V497 postflight: recover_server_zalo_running_state khác bản sinh';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = 'public.aka_agent_app_access_chat_organizations(bigint[])'::regprocedure) IS DISTINCT FROM b.chat_orgs_acl
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.recover_server_zalo_running_state(bigint,text,boolean)'::regprocedure) IS DISTINCT FROM b.recover_acl THEN
    RAISE EXCEPTION 'V497 postflight: quyền của hàm cũ bị đổi';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('aka_agent_chat_api', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE')
     OR has_function_privilege('aka_agent_chat_api', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE')
     OR has_table_privilege('anon', 'private.auto_zalo_server_session_handoff', 'SELECT')
     OR has_table_privilege('authenticated', 'private.auto_zalo_server_session_handoff', 'SELECT')
     OR NOT has_table_privilege('aka_agent_chat_api', 'private.auto_zalo_server_session_handoff', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'V497 postflight: quyền đối tượng mới sai';
  END IF;
  -- Bảng handoff vừa tạo nên chưa có dòng to_fly: App Server phải nhận đúng danh sách cũ, kể cả khi đang có tổ chức bật cờ.
  v_after := ARRAY(SELECT x FROM public.aka_agent_app_access_chat_organizations(ARRAY(SELECT o.id FROM public.org_organization o)) AS x ORDER BY 1);
  IF v_after IS DISTINCT FROM b.chat_orgs THEN
    RAISE EXCEPTION 'V497 postflight: hàm định tuyến của App Server đổi kết quả ngay lúc apply';
  END IF;
END $post$;

COMMIT;
