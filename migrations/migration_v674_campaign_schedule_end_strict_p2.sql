-- V674 p2: "Đặt ngày kết thúc" dừng chiến dịch đúng ngày. SINH TỪ scripts/build-v674-sql.cjs, không sửa tay.
-- Thay thân 4 hàm (giữ chữ ký, chủ sở hữu, quyền): aka_agent_finalize_campaign và aka_agent_internal_finalize_zalo_server_maintenance_guard
-- (chiến dịch có schedule_end_strict đã qua ngày kết thúc thì hoàn thành kể cả còn data chờ, không bị mở lại), create_control_campaign_v2
-- (đọc scheduleEndStrict), update_control_campaign_atomic (đọc khoá schedule_end_strict). Thêm private.aka_agent_campaign_schedule_end_sweep
-- và job pg_cron aka-agent-campaign-schedule-end (* * * * *).
-- Nguồn: pg_get_functiondef production 27/11/2026: finalize 8a1898523d8c45a9a9209f3695de9d6f, server_guard 25de4b86bcb37801bac5ce22afc02636, create_v2 532953944687fe2ee6a50612f97418ec, update_atomic 5e2c0fdaee6a786a05e3724fa2ea35e4.
-- Bản mới: finalize 51b271cf2eaf787dda67411c916e1c56, server_guard e978f73637877782b59b2f787fd58e6a, create_v2 f3dad71514218fd37e0e6cbf60fa5541, update_atomic bf508bc242e664c34f7639945b8fddcc.
-- Chưa chiến dịch nào bật cột nên apply xong chưa đổi gì; chỉ form mới (Desktop / Web sau V674) bật cột. Cần p1. DDL làm PostgREST nạp
-- lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v674_campaign_schedule_end_strict.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v674_campaign_schedule_end_strict_p2') THEN
      RAISE EXCEPTION 'migration_v674_campaign_schedule_end_strict_p2 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname = 'schedule_end_strict' AND NOT attisdropped) THEN RAISE EXCEPTION 'V674 p2: chạy p1 trước'; END IF;
  IF to_regprocedure('private.aka_agent_campaign_schedule_end_sweep(integer)') IS NOT NULL THEN RAISE EXCEPTION 'V674 p2: private.aka_agent_campaign_schedule_end_sweep(integer) đã có'; END IF;
  IF to_regclass('public.auto_engine_leases') IS NULL THEN RAISE EXCEPTION 'V674 p2: thiếu public.auto_engine_leases'; END IF;
  -- IF lồng: câu đọc cron.job chỉ được phân tích khi pg_cron có cài.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'aka-agent-campaign-schedule-end') THEN RAISE EXCEPTION 'V674 p2: đã có job aka-agent-campaign-schedule-end'; END IF;
  END IF;
  v_oid := to_regprocedure('public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V674 p2: không có public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '51b271cf2eaf787dda67411c916e1c56' THEN RAISE EXCEPTION 'V674 p2 đã chạy (finalize)'; END IF;
  IF v_md5 IS DISTINCT FROM '8a1898523d8c45a9a9209f3695de9d6f' THEN
    RAISE EXCEPTION 'V674 p2: định nghĩa finalize khác bản production 27/11, dừng để đối chiếu bản live (finalize: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v674_acl_finalize', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_internal_finalize_zalo_server_maintenance_guard(bigint,bigint,bigint,text,boolean,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V674 p2: không có public.aka_agent_internal_finalize_zalo_server_maintenance_guard(bigint,bigint,bigint,text,boolean,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'e978f73637877782b59b2f787fd58e6a' THEN RAISE EXCEPTION 'V674 p2 đã chạy (server_guard)'; END IF;
  IF v_md5 IS DISTINCT FROM '25de4b86bcb37801bac5ce22afc02636' THEN
    RAISE EXCEPTION 'V674 p2: định nghĩa server_guard khác bản production 27/11, dừng để đối chiếu bản live (server_guard: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v674_acl_server_guard', v_acl, true);
  v_oid := to_regprocedure('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V674 p2: không có public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'f3dad71514218fd37e0e6cbf60fa5541' THEN RAISE EXCEPTION 'V674 p2 đã chạy (create_v2)'; END IF;
  IF v_md5 IS DISTINCT FROM '532953944687fe2ee6a50612f97418ec' THEN
    RAISE EXCEPTION 'V674 p2: định nghĩa create_v2 khác bản production 27/11, dừng để đối chiếu bản live (create_v2: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v674_acl_create_v2', v_acl, true);
  v_oid := to_regprocedure('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V674 p2: không có public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = 'bf508bc242e664c34f7639945b8fddcc' THEN RAISE EXCEPTION 'V674 p2 đã chạy (update_atomic)'; END IF;
  IF v_md5 IS DISTINCT FROM '5e2c0fdaee6a786a05e3724fa2ea35e4' THEN
    RAISE EXCEPTION 'V674 p2: định nghĩa update_atomic khác bản production 27/11, dừng để đối chiếu bản live (update_atomic: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v674_acl_update_atomic', v_acl, true);
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_campaign(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_note text DEFAULT NULL::text, p_update_note boolean DEFAULT false, p_expected_status text DEFAULT 'đang chạy'::text, p_auth_username text DEFAULT NULL::text, p_auth_password text DEFAULT NULL::text)
 RETURNS TABLE(completed boolean, reason text, campaign_id bigint, campaign_status text, pending_input_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign_status text;
  v_source_mode text;
  v_pending_input_count bigint := 0;
  v_strict_ended boolean := false;
  v_expected_status text := lower(btrim(COALESCE(p_expected_status, '')));
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, p_campaign_id); -- Bind Desktop token before privileged work.

  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
  THEN
    RAISE EXCEPTION 'campaign_finalize_identity_invalid';
  END IF;
  IF v_expected_status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RAISE EXCEPTION 'campaign_finalize_expected_status_invalid';
  END IF;

  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct'),
    (campaign.schedule_end_strict AND campaign.schedule_end_date IS NOT NULL AND campaign.schedule_end_date <= clock_timestamp())
  INTO v_campaign_status, v_source_mode, v_strict_ended
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  IF v_source_mode = 'data_group' THEN
    RETURN QUERY SELECT
      false,
      'specialized_finalizer_required',
      p_campaign_id,
      v_campaign_status,
      0::bigint;
    RETURN;
  END IF;

  -- V674 ("Đặt ngày kết thúc", dừng đúng ngày): khách chủ động đặt ngày kết thúc (schedule_end_strict) và ngày đó đã qua thì chiến
  -- dịch hoàn thành kể cả khi còn data chờ (data chờ giữ nguyên), và không được mở lại vì còn data chờ.
  IF COALESCE(v_strict_ended, false) THEN
    IF v_campaign_status = v_expected_status THEN
      UPDATE public.auto_campaigns AS campaign
      SET status = 'hoàn thành',
          note = 'Chiến dịch đã hết ngày kết thúc',
          updated_at = clock_timestamp()
      WHERE campaign.id = p_campaign_id
        AND campaign.status = v_expected_status;

      RETURN QUERY SELECT
        true,
        'completed',
        p_campaign_id,
        'hoàn thành'::text,
        0::bigint;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      v_campaign_status = 'hoàn thành',
      'campaign_control_won',
      p_campaign_id,
      v_campaign_status,
      0::bigint;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_pending_input_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'chờ xử lý';

  IF v_pending_input_count > 0 THEN
    IF v_campaign_status = v_expected_status OR v_campaign_status = 'hoàn thành' THEN
      UPDATE public.auto_campaigns
      SET status = 'chờ xử lý',
          note = NULL,
          completed_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = p_campaign_id;
      v_campaign_status := 'chờ xử lý';
    END IF;

    RETURN QUERY SELECT
      false,
      'pending_input_remaining',
      p_campaign_id,
      v_campaign_status,
      v_pending_input_count;
    RETURN;
  END IF;

  IF v_campaign_status = v_expected_status THEN
    UPDATE public.auto_campaigns AS campaign
    SET status = 'hoàn thành',
        note = CASE
          WHEN COALESCE(p_update_note, false) THEN p_note
          ELSE campaign.note
        END,
        updated_at = clock_timestamp()
    WHERE campaign.id = p_campaign_id;

    RETURN QUERY SELECT
      true,
      'completed',
      p_campaign_id,
      'hoàn thành'::text,
      0::bigint;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_campaign_status = 'hoàn thành',
    'campaign_control_won',
    p_campaign_id,
    v_campaign_status,
    0::bigint;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_finalize_zalo_server_maintenance_guard(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_note text, p_update_note boolean, p_expected_status text)
 RETURNS TABLE(completed boolean, reason text, campaign_id bigint, campaign_status text, pending_input_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign_status text;
  v_source_mode text;
  v_pending_input_count bigint := 0;
  v_strict_ended boolean := false;
  v_expected_status text := lower(btrim(COALESCE(p_expected_status, '')));
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
  THEN
    RAISE EXCEPTION 'campaign_finalize_identity_invalid';
  END IF;
  IF v_expected_status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RAISE EXCEPTION 'campaign_finalize_expected_status_invalid';
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- This helper is normally called by the public maintenance wrapper, which
  -- already holds these rows. Repeat the canonical first lock defensively so
  -- every invocation preserves input -> campaign -> account by itself.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct'),
    (campaign.schedule_end_strict AND campaign.schedule_end_date IS NOT NULL AND campaign.schedule_end_date <= clock_timestamp())
  INTO v_campaign_status, v_source_mode, v_strict_ended
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.is_delete, false) = false
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  IF v_source_mode = 'data_group' THEN
    RETURN QUERY SELECT
      false,
      'specialized_finalizer_required',
      p_campaign_id,
      v_campaign_status,
      0::bigint;
    RETURN;
  END IF;

  -- V674 ("Đặt ngày kết thúc", dừng đúng ngày): khách chủ động đặt ngày kết thúc (schedule_end_strict) và ngày đó đã qua thì chiến
  -- dịch hoàn thành kể cả khi còn data chờ (data chờ giữ nguyên), và không được mở lại vì còn data chờ.
  IF COALESCE(v_strict_ended, false) THEN
    IF v_campaign_status = v_expected_status THEN
      UPDATE public.auto_campaigns AS campaign
      SET status = 'hoàn thành',
          note = 'Chiến dịch đã hết ngày kết thúc',
          updated_at = clock_timestamp()
      WHERE campaign.id = p_campaign_id
        AND campaign.status = v_expected_status;

      RETURN QUERY SELECT
        true,
        'completed',
        p_campaign_id,
        'hoàn thành'::text,
        0::bigint;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      v_campaign_status = 'hoàn thành',
      'campaign_control_won',
      p_campaign_id,
      v_campaign_status,
      0::bigint;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_pending_input_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = 'chờ xử lý';

  IF v_pending_input_count > 0 THEN
    IF v_campaign_status = v_expected_status OR v_campaign_status = 'hoàn thành' THEN
      UPDATE public.auto_campaigns
      SET status = 'chờ xử lý',
          note = NULL,
          completed_at = NULL,
          updated_at = clock_timestamp()
      WHERE id = p_campaign_id;
      v_campaign_status := 'chờ xử lý';
    END IF;

    RETURN QUERY SELECT
      false,
      'pending_input_remaining',
      p_campaign_id,
      v_campaign_status,
      v_pending_input_count;
    RETURN;
  END IF;

  IF v_campaign_status = v_expected_status THEN
    UPDATE public.auto_campaigns AS campaign
    SET status = 'hoàn thành',
        note = CASE
          WHEN COALESCE(p_update_note, false) THEN p_note
          ELSE campaign.note
        END,
        updated_at = clock_timestamp()
    WHERE campaign.id = p_campaign_id
      AND campaign.status = v_expected_status;

    RETURN QUERY SELECT
      true,
      'completed',
      p_campaign_id,
      'hoàn thành'::text,
      0::bigint;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_campaign_status = 'hoàn thành',
    'campaign_control_won',
    p_campaign_id,
    v_campaign_status,
    0::bigint;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_control_campaign_v2(p_staff_id bigint, p_organization_id bigint, p_idempotency_key text, p_campaign jsonb, p_inputs jsonb DEFAULT '[]'::jsonb, p_initial_status text DEFAULT 'chờ xử lý'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_id bigint;
  v_web_form text;
BEGIN
  IF p_initial_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_campaign_initial_status';
  END IF;

  v_result := public.create_control_campaign(
    p_staff_id,
    p_organization_id,
    p_idempotency_key,
    p_campaign,
    p_inputs
  );

  -- V482: form Web đã tạo chiến dịch (form thủ công/Agent, phiên bản 1/2). Không gửi hoặc giá trị lạ = NULL
  -- (Desktop, iOS, Quy trình, nhập SQL...). Chỉ ghi lúc tạo; lần gọi lặp cùng Idempotency-Key không ghi lại.
  v_web_form := CASE WHEN p_campaign->>'webCampaignForm' IN ('form_1', 'form_2', 'agent_1', 'agent_2')
    THEN p_campaign->>'webCampaignForm' END;

  -- The inner insert and this update share a transaction, so a cloned campaign is
  -- never externally visible in the runnable state.
  IF COALESCE((v_result->>'created')::boolean, false) THEN
    v_campaign_id := NULLIF(v_result->>'campaign_id', '')::bigint;
    IF p_initial_status = 'tạm dừng' THEN
      UPDATE public.auto_campaigns
      SET status = 'tạm dừng', web_campaign_form = v_web_form, updated_at = now()
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    ELSIF v_web_form IS NOT NULL THEN
      -- Chỉ ghi cột form, không nêu status: không chạy trigger UPDATE OF status, không đổi config version.
      UPDATE public.auto_campaigns
      SET web_campaign_form = v_web_form
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
    -- "Chạy cùng lúc" từ form Web / iOS (parallelRunEnabled = true). Không gửi hay false = mặc định của cột (false). Chỉ ghi cột này.
    IF p_campaign->>'parallelRunEnabled' = 'true' THEN
      UPDATE public.auto_campaigns
      SET parallel_run_enabled = true
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
    -- "Đặt ngày kết thúc" từ form Web / iOS (scheduleEndStrict = true): chiến dịch dừng đúng ngày kết thúc. Không gửi hay false = mặc
    -- định của cột (false). Chỉ ghi cột này.
    IF p_campaign->>'scheduleEndStrict' = 'true' THEN
      UPDATE public.auto_campaigns
      SET schedule_end_strict = true
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
  END IF;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_control_campaign_atomic(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_expected_updated_at timestamp with time zone, p_campaign_patch jsonb, p_sms_inputs jsonb DEFAULT NULL::jsonb, p_update_sms_schedule boolean DEFAULT false, p_append_idempotency_key text DEFAULT NULL::text, p_expected_input_count integer DEFAULT NULL::integer, p_append_inputs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account_platform text;
  v_target_action_id text;
  v_payload_input_count integer := 0;
  v_payload_unique_input_count integer := 0;
  v_eligible_input_count integer := 0;
  v_current_eligible_input_count integer := 0;
  v_updated_inputs integer := 0;
  v_append_key text := NULLIF(btrim(COALESCE(p_append_idempotency_key, '')), '');
  v_append_input_count integer := 0;
  v_existing_append_count integer := 0;
  v_current_input_count integer := 0;
  v_appended_inputs integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_campaign_patch, '{}'::jsonb)) <> 'object'
    OR (p_sms_inputs IS NOT NULL AND jsonb_typeof(p_sms_inputs) <> 'array')
    OR (p_append_inputs IS NOT NULL AND jsonb_typeof(p_append_inputs) <> 'array') THEN
    RAISE EXCEPTION 'invalid_control_campaign_update_payload';
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    v_append_input_count := jsonb_array_length(p_append_inputs);
    IF v_append_input_count < 1 OR v_append_input_count > 5000
      OR v_append_key IS NULL OR length(v_append_key) > 200
      OR p_expected_input_count IS NULL OR p_expected_input_count < 0 THEN
      RAISE EXCEPTION 'invalid_control_campaign_append_payload';
    END IF;
  ELSIF v_append_key IS NOT NULL OR p_expected_input_count IS NOT NULL THEN
    RAISE EXCEPTION 'orphan_control_campaign_append_metadata';
  END IF;

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      (
        COALESCE(account.is_delete, false) = false
        AND (
          account.flatform_type = 'sms'
          OR (
            account.flatform_type = 'zalo'
            AND NOT (COALESCE(account.is_zalo_show_web, false)
            AND COALESCE(account.is_zalo_server, false))
            AND COALESCE(account.is_active, true) = true
          )
        )
      )
      OR (
        COALESCE(account.is_delete, false) = true
        AND p_campaign_patch ? 'account_id'
        AND EXISTS (
          SELECT 1
          FROM public.auto_accounts AS target_account
          WHERE target_account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
            AND target_account.staff_id = p_staff_id
            AND target_account.organization_id = p_organization_id
            AND target_account.flatform_type = account.flatform_type AND COALESCE(target_account.is_zalo_server, false) = COALESCE(account.is_zalo_server, false)
            AND (
              target_account.flatform_type = 'sms'
              OR (
                target_account.flatform_type = 'zalo'
                AND NOT (COALESCE(target_account.is_zalo_show_web, false)
                AND COALESCE(target_account.is_zalo_server, false))
                AND COALESCE(target_account.is_active, true) = true
              )
            )
            AND COALESCE(target_account.is_delete, false) = false
        )
      )
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  -- A network retry after the transaction committed still carries the stale
  -- version. The durable append key proves that this exact edit already won.
  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  IF p_sms_inputs IS NOT NULL OR p_append_inputs IS NOT NULL THEN
    -- SMS status recording locks an input row before it may complete the
    -- campaign. Lock every current row before taking the campaign lock so an
    -- update+append cannot commit below a concurrently completed campaign.
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    FOR UPDATE OF input_data;
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');

    SELECT
      count(*)::integer,
      count(DISTINCT NULLIF(item->>'id', '')::bigint)::integer
    INTO v_payload_input_count, v_payload_unique_input_count
    FROM jsonb_array_elements(p_sms_inputs) AS item;

    IF v_payload_input_count <> v_payload_unique_input_count
      OR v_payload_unique_input_count <> v_eligible_input_count
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_sms_inputs) AS item
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.id = NULLIF(item->>'id', '')::bigint
            AND input_data.campaign_id = p_campaign_id
            AND COALESCE(input_data.is_delete, false) = false
            AND input_data.status IN ('chờ xử lý', 'tạm dừng')
        )
      ) THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  -- Mobile status recording locks input rows before it may complete the campaign;
  -- take the campaign lock only after the SMS input locks to keep that order.
  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      (
        COALESCE(account.is_delete, false) = false
        AND (
          account.flatform_type = 'sms'
          OR (
            account.flatform_type = 'zalo'
            AND NOT (COALESCE(account.is_zalo_show_web, false)
            AND COALESCE(account.is_zalo_server, false))
            AND COALESCE(account.is_active, true) = true
          )
        )
      )
      OR (
        COALESCE(account.is_delete, false) = true
        AND p_campaign_patch ? 'account_id'
        AND EXISTS (
          SELECT 1
          FROM public.auto_accounts AS target_account
          WHERE target_account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
            AND target_account.staff_id = p_staff_id
            AND target_account.organization_id = p_organization_id
            AND target_account.flatform_type = account.flatform_type AND COALESCE(target_account.is_zalo_server, false) = COALESCE(account.is_zalo_server, false)
            AND (
              target_account.flatform_type = 'sms'
              OR (
                target_account.flatform_type = 'zalo'
                AND NOT (COALESCE(target_account.is_zalo_show_web, false)
                AND COALESCE(target_account.is_zalo_server, false))
                AND COALESCE(target_account.is_active, true) = true
              )
            )
            AND COALESCE(target_account.is_delete, false) = false
        )
      )
    )
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  IF p_campaign_patch ? 'account_id' THEN
    PERFORM account.id
    FROM public.auto_accounts AS account
    WHERE account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.flatform_type = v_account_platform AND COALESCE(account.is_zalo_server, false) = (SELECT COALESCE(source_account.is_zalo_server, false) FROM public.auto_accounts AS source_account WHERE source_account.id = v_campaign.account_id)
      AND (
        account.flatform_type = 'sms'
        OR (
          account.flatform_type = 'zalo'
          AND NOT (COALESCE(account.is_zalo_show_web, false)
          AND COALESCE(account.is_zalo_server, false))
          AND COALESCE(account.is_active, true) = true
        )
      )
      AND COALESCE(account.is_delete, false) = false
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_account_not_found';
    END IF;
  END IF;

  v_target_action_id := v_campaign.action_id;
  IF p_campaign_patch ? 'action_id' THEN
    v_target_action_id := NULLIF(btrim(COALESCE(p_campaign_patch->>'action_id', '')), '');
    IF v_target_action_id IS NULL THEN
      RAISE EXCEPTION 'control_action_not_allowed';
    END IF;

    PERFORM action.id
    FROM public.auto_campaign_actions AS action
    WHERE action.id = v_target_action_id
      AND action.flatform_type = v_account_platform
      AND COALESCE(action.is_active, true) = true
      AND COALESCE(action.is_delete, false) = false
    FOR SHARE OF action;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_action_not_allowed';
    END IF;
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    IF v_current_eligible_input_count <> v_payload_unique_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false;
    IF v_current_input_count <> p_expected_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'input_count_conflict');
    END IF;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    name = CASE WHEN p_campaign_patch ? 'name' THEN p_campaign_patch->>'name' ELSE campaign.name END,
    action_id = v_target_action_id,
    account_id = CASE WHEN p_campaign_patch ? 'account_id' THEN NULLIF(p_campaign_patch->>'account_id', '')::bigint ELSE campaign.account_id END,
    schedule = CASE WHEN p_campaign_patch ? 'schedule' THEN NULLIF(p_campaign_patch->>'schedule', '')::timestamptz ELSE campaign.schedule END,
    original_schedule = CASE WHEN p_campaign_patch ? 'original_schedule' THEN NULLIF(p_campaign_patch->>'original_schedule', '')::timestamptz ELSE campaign.original_schedule END,
    content = CASE WHEN p_campaign_patch ? 'content' THEN COALESCE(p_campaign_patch->>'content', '') ELSE campaign.content END,
    schedule_type = CASE WHEN p_campaign_patch ? 'schedule_type' THEN p_campaign_patch->>'schedule_type' ELSE campaign.schedule_type END,
    schedule_end_date = CASE WHEN p_campaign_patch ? 'schedule_end_date' THEN NULLIF(p_campaign_patch->>'schedule_end_date', '')::timestamptz ELSE campaign.schedule_end_date END,
    daily_stop_time = CASE WHEN p_campaign_patch ? 'daily_stop_time' THEN NULLIF(p_campaign_patch->>'daily_stop_time', '')::time ELSE campaign.daily_stop_time END,
    schedule_days = CASE WHEN p_campaign_patch ? 'schedule_days' THEN NULLIF(p_campaign_patch->>'schedule_days', '') ELSE campaign.schedule_days END,
    schedule_week_days = CASE WHEN p_campaign_patch ? 'schedule_week_days' THEN NULLIF(p_campaign_patch->>'schedule_week_days', '') ELSE campaign.schedule_week_days END,
    continue_next_day = CASE WHEN p_campaign_patch ? 'continue_next_day' THEN (p_campaign_patch->>'continue_next_day')::boolean ELSE campaign.continue_next_day END,
    refresh_data = CASE WHEN p_campaign_patch ? 'refresh_data' THEN (p_campaign_patch->>'refresh_data')::boolean ELSE campaign.refresh_data END,
    -- "Chạy cùng lúc": chỉ đổi khi form gửi khoá (ô đang hiện); không gửi thì giữ nguyên. Không thuộc config version.
    parallel_run_enabled = CASE WHEN p_campaign_patch ? 'parallel_run_enabled' THEN COALESCE((p_campaign_patch->>'parallel_run_enabled')::boolean, false) ELSE campaign.parallel_run_enabled END,
    -- "Đặt ngày kết thúc": chỉ đổi khi form gửi khoá; client cũ không gửi thì giữ nguyên.
    schedule_end_strict = CASE WHEN p_campaign_patch ? 'schedule_end_strict' THEN COALESCE((p_campaign_patch->>'schedule_end_strict')::boolean, false) ELSE campaign.schedule_end_strict END,
    extra_settings = CASE WHEN p_campaign_patch ? 'extra_settings' THEN p_campaign_patch->'extra_settings' ELSE campaign.extra_settings END,
    images = CASE WHEN p_campaign_patch ? 'images' THEN p_campaign_patch->'images' ELSE campaign.images END,
    status = CASE
      WHEN v_account_platform = 'zalo' THEN campaign.status
      WHEN p_campaign_patch ? 'status' THEN p_campaign_patch->>'status'
      ELSE campaign.status
    END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.updated_at IS NOT DISTINCT FROM p_expected_updated_at
  RETURNING * INTO v_campaign;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    WITH materialized AS (
      SELECT
        NULLIF(item->>'id', '')::bigint AS id,
        NULLIF(item->>'phone', '') AS phone,
        NULLIF(item->>'phoneCarrier', '') AS phone_carrier,
        NULLIF(item->>'content', '') AS content,
        NULLIF(item->>'schedule', '')::timestamptz AS schedule
      FROM jsonb_array_elements(p_sms_inputs) AS item
    )
    UPDATE public.auto_campaign_input_data AS input_data
    SET
      phone = materialized.phone,
      phone_carrier = materialized.phone_carrier,
      content = materialized.content,
      schedule = CASE WHEN p_update_sms_schedule THEN materialized.schedule ELSE input_data.schedule END
    FROM materialized
    WHERE input_data.id = materialized.id
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    GET DIAGNOSTICS v_updated_inputs = ROW_COUNT;
    IF v_updated_inputs <> v_eligible_input_count THEN
      RAISE EXCEPTION 'control_sms_inputs_changed';
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    INSERT INTO public.auto_campaign_input_data (
      campaign_id, input_id, name, phone, phone_carrier, uid, email,
      info1, info2, info3, info4, info5, content,
      status, note, schedule, is_delete, created_at,
      control_append_idempotency_key, control_append_row_index
    )
    SELECT
      p_campaign_id,
      NULL,
      NULLIF(item.value->>'name', ''),
      NULLIF(item.value->>'phone', ''),
      NULLIF(item.value->>'phoneCarrier', ''),
      NULLIF(item.value->>'uid', ''),
      NULLIF(item.value->>'email', ''),
      NULLIF(item.value->>'info1', ''),
      NULLIF(item.value->>'info2', ''),
      NULLIF(item.value->>'info3', ''),
      NULLIF(item.value->>'info4', ''),
      NULLIF(item.value->>'info5', ''),
      NULLIF(item.value->>'content', ''),
      'chờ xử lý',
      NULLIF(item.value->>'note', ''),
      NULLIF(item.value->>'schedule', '')::timestamptz,
      false,
      now(),
      v_append_key,
      (item.ordinality - 1)::integer
    FROM jsonb_array_elements(p_append_inputs) WITH ORDINALITY AS item(value, ordinality);
    GET DIAGNOSTICS v_appended_inputs = ROW_COUNT;
    IF v_appended_inputs <> v_append_input_count THEN
      RAISE EXCEPTION 'control_campaign_append_incomplete';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'campaign_id', p_campaign_id,
    'updated_input_count', v_updated_inputs,
    'appended_input_count', v_appended_inputs,
    'updated_at', v_campaign.updated_at
  );
END;
$function$
;

CREATE FUNCTION private.aka_agent_campaign_schedule_end_sweep(p_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '20s' SET lock_timeout = '2s' AS $f$
-- "Đặt ngày kết thúc" (V674): đóng chiến dịch khách đã đặt ngày kết thúc (schedule_end_strict) khi ngày đó đã qua mà chiến dịch còn
-- "chờ xử lý": lịch kế chưa tới nên bước cập nhật lịch ngày mới chưa xét, khách bấm chạy lại, hoặc data mới vừa đẩy vào. Data chờ giữ
-- nguyên. Không đụng chiến dịch đang có lượt chạy (đang chạy, còn token của bộ cũ, còn giữ chỗ của bộ mới) và chiến dịch Nhóm data
-- (có hạn riêng). Mỗi chiến dịch một khối riêng: một chiến dịch lỗi không chặn các chiến dịch khác. Trả số chiến dịch đã đóng.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT c.id
      FROM public.auto_campaigns c
     WHERE c.schedule_end_strict
       AND c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now
       AND c.status = 'chờ xử lý'
       AND coalesce(c.is_delete, false) = false
       AND coalesce(c.data_target_source_mode, 'direct') <> 'data_group'
       AND c.runtime_claim_token IS NULL AND c.runtime_unit_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.campaign_id = c.id AND l.expires_at > v_now)
     ORDER BY c.id
     LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
       FOR UPDATE OF c SKIP LOCKED
  LOOP
    BEGIN
      UPDATE public.auto_campaigns
         SET status = 'hoàn thành', note = 'Chiến dịch đã hết ngày kết thúc', updated_at = clock_timestamp()
       WHERE id = r.id AND status = 'chờ xử lý';
      IF FOUND THEN v_count := v_count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'aka_agent_campaign_schedule_end_sweep: chiến dịch % không đóng được: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END
$f$;
-- Hàm mới ở schema private: chỉ job pg_cron (postgres) gọi.
REVOKE ALL ON FUNCTION private.aka_agent_campaign_schedule_end_sweep(integer) FROM PUBLIC;
DO $grant$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_campaign_schedule_end_sweep(integer) FROM %I', v_role);
    END IF;
  END LOOP;
END $grant$;

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('aka-agent-campaign-schedule-end', '* * * * *', 'SELECT private.aka_agent_campaign_schedule_end_sweep()');
  END IF;
END $cron$;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := to_regprocedure('public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '51b271cf2eaf787dda67411c916e1c56' THEN
    RAISE EXCEPTION 'V674 p2 postflight: định nghĩa finalize %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v674_acl_finalize', true) THEN RAISE EXCEPTION 'V674 p2 postflight: quyền / chủ sở hữu finalize bị đổi'; END IF;
  v_oid := to_regprocedure('public.aka_agent_internal_finalize_zalo_server_maintenance_guard(bigint,bigint,bigint,text,boolean,text)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'e978f73637877782b59b2f787fd58e6a' THEN
    RAISE EXCEPTION 'V674 p2 postflight: định nghĩa server_guard %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v674_acl_server_guard', true) THEN RAISE EXCEPTION 'V674 p2 postflight: quyền / chủ sở hữu server_guard bị đổi'; END IF;
  v_oid := to_regprocedure('public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'f3dad71514218fd37e0e6cbf60fa5541' THEN
    RAISE EXCEPTION 'V674 p2 postflight: định nghĩa create_v2 %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v674_acl_create_v2', true) THEN RAISE EXCEPTION 'V674 p2 postflight: quyền / chủ sở hữu create_v2 bị đổi'; END IF;
  v_oid := to_regprocedure('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM 'bf508bc242e664c34f7639945b8fddcc' THEN
    RAISE EXCEPTION 'V674 p2 postflight: định nghĩa update_atomic %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v674_acl_update_atomic', true) THEN RAISE EXCEPTION 'V674 p2 postflight: quyền / chủ sở hữu update_atomic bị đổi'; END IF;
  IF md5((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('private.aka_agent_campaign_schedule_end_sweep(integer)'))) IS DISTINCT FROM '55b1f4325d85ee40888e65b8f1ae72cd' THEN
    RAISE EXCEPTION 'V674 p2 postflight: thân aka_agent_campaign_schedule_end_sweep khác bản sinh';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api')
              AND has_function_privilege(r.rolname, 'private.aka_agent_campaign_schedule_end_sweep(integer)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V674 p2 postflight: role ứng dụng gọi được aka_agent_campaign_schedule_end_sweep';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'aka-agent-campaign-schedule-end' AND j.schedule = '* * * * *') THEN
      RAISE EXCEPTION 'V674 p2 postflight: thiếu job aka-agent-campaign-schedule-end';
    END IF;
  END IF;
END $post$;
COMMIT;
