-- Target: cgjbsmqtfhqvttudyjzq (akachat). Additive reporting; existing opt-out RPCs stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  expected record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public.aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)', '92b00c0827a801e9ffece28d14805f84'),
    ('public.aka_agent_prepare_zalo_message_opt_out(bigint,bigint,bigint,text,text)', '0217c031e0d6aaef63c2589cbe1f7b94'),
    ('public.aka_agent_inspect_zalo_message_opt_out(uuid)', 'abd87ff2937831d2ee3ab999f2ebe091'),
    ('public.aka_agent_confirm_zalo_message_opt_out(uuid)', '4fe1c52c866b3afec96e956302a52eee')
  ) AS baseline(signature, checksum) LOOP
    IF to_regprocedure(expected.signature) IS NULL
      OR md5(pg_get_functiondef(to_regprocedure(expected.signature))) IS DISTINCT FROM expected.checksum THEN
      RAISE EXCEPTION 'v295: live opt-out definition changed: %', expected.signature;
    END IF;
  END LOOP;
  IF to_regprocedure('public.aka_agent_list_message_opt_out_customers(bigint,bigint,text,text,text,integer)') IS NOT NULL
    OR to_regprocedure('public.auto_capture_message_opt_out_source()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'auto_zalo_message_opt_outs' AND column_name = 'source_campaign_id') THEN
    RAISE EXCEPTION 'v295: reporting objects already exist; audit live definitions before proceeding';
  END IF;
END;
$preflight$;

-- No FK/cascade: reporting snapshots survive deletion of the campaign/result.
ALTER TABLE public.auto_zalo_message_opt_outs
  ADD COLUMN source_campaign_id bigint,
  ADD COLUMN source_campaign_name text,
  ADD COLUMN source_detail_id bigint,
  ADD COLUMN source_sent_at timestamptz,
  ADD COLUMN source_action_name text,
  ADD COLUMN source_status text,
  ADD COLUMN zalo_name text,
  ADD COLUMN zalo_avatar text;

CREATE INDEX auto_zalo_message_opt_outs_confirmed_page_idx
  ON public.auto_zalo_message_opt_outs (staff_id, organization_id, confirmed_at DESC, id DESC)
  WHERE confirmed_at IS NOT NULL;

CREATE FUNCTION public.auto_capture_message_opt_out_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_meta jsonb := NEW.data -> 'messageOptOutSource';
  v_id uuid;
  v_sent_at timestamptz;
  v_global_id text;
  v_scope record;
BEGIN
  IF NEW.status IS DISTINCT FROM 'thành công' OR COALESCE(NEW.is_delete, false)
    OR NEW.action_code IS NULL OR NEW.action_code NOT IN ('zalo_message_friend', 'zalo_message_stranger')
    OR jsonb_typeof(v_meta) IS DISTINCT FROM 'object' OR v_meta ->> 'version' IS DISTINCT FROM '1' THEN
    RETURN NEW;
  END IF;
  -- Invalid optional metadata must never turn a delivered message into a failed result write.
  BEGIN
    v_id := (v_meta ->> 'optOutId')::uuid;
    v_sent_at := (v_meta ->> 'sentAt')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN NEW;
  END;
  v_global_id := NULLIF(btrim(v_meta ->> 'zaloGlobalId'), '');
  IF v_id IS NULL OR v_sent_at IS NULL OR NOT isfinite(v_sent_at) OR v_global_id IS NULL
    OR v_global_id IS DISTINCT FROM NULLIF(btrim(NEW.data #>> '{target,globalId}'), '')
    OR NULLIF(btrim(NEW.data #>> '{target,uid}'), '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.staff_id, c.organization_id, c.name, i.email INTO v_scope
  FROM public.auto_campaigns c
  JOIN public.auto_accounts a ON a.id = c.account_id AND a.id = NEW.account_id
    AND a.staff_id = c.staff_id AND a.organization_id = c.organization_id AND a.flatform_type = 'zalo'
  JOIN public.auto_campaign_input_data i ON i.id = NEW.input_data_id AND i.campaign_id = c.id
  WHERE c.id = NEW.campaign_id AND c.action_id IN (
    'zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday',
    'zalo_message_group_member', 'zalo_message_group_realtime',
    'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'
  );
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- UPDATE locks the same row as confirm; PostgreSQL rechecks these predicates after waiting.
  -- A delayed result may fill the as-of-confirmation source, but never a later delivery.
  UPDATE public.auto_zalo_message_opt_outs o SET
    source_campaign_id = NEW.campaign_id,
    source_campaign_name = v_scope.name,
    source_detail_id = NEW.id,
    source_sent_at = v_sent_at,
    source_action_name = NEW.action_name,
    source_status = NEW.status,
    zalo_name = NULLIF(btrim(v_meta ->> 'zaloName'), ''),
    zalo_avatar = NULLIF(btrim(v_meta ->> 'zaloAvatar'), ''),
    email = COALESCE(NULLIF(btrim(v_scope.email), ''), o.email)
  WHERE o.id = v_id AND o.staff_id = v_scope.staff_id AND o.organization_id = v_scope.organization_id
    AND o.zalo_global_id = v_global_id
    AND v_sent_at >= o.created_at
    AND (o.confirmed_at IS NULL OR v_sent_at <= o.confirmed_at)
    AND (o.source_sent_at IS NULL OR (v_sent_at, NEW.id) > (o.source_sent_at, o.source_detail_id));
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.auto_capture_message_opt_out_source() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_capture_message_opt_out_source() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_capture_message_opt_out_source
AFTER INSERT ON public.auto_campaign_details
FOR EACH ROW
WHEN (NEW.status = 'thành công' AND NEW.action_code IN ('zalo_message_friend', 'zalo_message_stranger')
  AND NEW.data ? 'messageOptOutSource')
EXECUTE FUNCTION public.auto_capture_message_opt_out_source();

CREATE FUNCTION public.aka_agent_list_message_opt_out_customers(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_search text DEFAULT '', p_page integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_search text := left(btrim(COALESCE(p_search, '')), 200);
  v_pattern text;
  v_page integer := greatest(1, least(COALESCE(p_page, 1), 1000000));
  v_total bigint;
  v_items jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id
    AND is_active = true AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Không có quyền truy cập danh sách.';
  END IF;
  v_pattern := '%' || replace(replace(replace(v_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  SELECT count(*) INTO v_total FROM public.auto_zalo_message_opt_outs o
  WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.confirmed_at IS NOT NULL
    AND (v_search = '' OR o.zalo_name ILIKE v_pattern OR o.phone ILIKE v_pattern OR o.email ILIKE v_pattern
      OR o.zalo_global_id ILIKE v_pattern OR o.source_campaign_name ILIKE v_pattern);
  v_page := least(v_page, greatest(1, ceil(v_total::numeric / 50)::integer));
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.confirmed_at DESC, x.id DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT o.id, o.confirmed_at, jsonb_build_object(
      'id', o.id, 'phone', o.phone, 'email', o.email, 'zaloGlobalId', o.zalo_global_id,
      'zaloName', o.zalo_name, 'zaloAvatar', o.zalo_avatar, 'confirmedAt', o.confirmed_at,
      'sourceCampaignId', o.source_campaign_id, 'sourceCampaignName', o.source_campaign_name,
      'sourceDetailId', o.source_detail_id, 'sourceSentAt', o.source_sent_at,
      'sourceActionName', o.source_action_name, 'sourceStatus', o.source_status
    ) AS item
    FROM public.auto_zalo_message_opt_outs o
    WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.confirmed_at IS NOT NULL
      AND (v_search = '' OR o.zalo_name ILIKE v_pattern OR o.phone ILIKE v_pattern OR o.email ILIKE v_pattern
        OR o.zalo_global_id ILIKE v_pattern OR o.source_campaign_name ILIKE v_pattern)
    ORDER BY o.confirmed_at DESC, o.id DESC LIMIT 50 OFFSET (v_page - 1) * 50
  ) x;
  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', 50);
END;
$function$;

ALTER FUNCTION public.aka_agent_list_message_opt_out_customers(bigint,bigint,text,text,text,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_list_message_opt_out_customers(bigint,bigint,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_message_opt_out_customers(bigint,bigint,text,text,text,integer) TO anon, authenticated, service_role;

-- A new public RPC and API-visible columns require PostgREST metadata refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;
