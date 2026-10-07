-- Source: linked akachat cgjbsmqtfhqvttudyjzq, snapshots/campaign-content-v350/source.json.
-- New RPC; no existing function is replaced. Apply before v351 and updated runtimes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='aka_agent_take_campaign_content_index') THEN
    RAISE EXCEPTION 'v350: content allocator already exists; inspect live signature/body before proceeding';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_lock_campaign_input_serialization(bigint)'::regprocedure))
    IS DISTINCT FROM '74c082aacb1de27a8cedff2e824f219f' THEN
    RAISE EXCEPTION 'v350: input serialization dependency changed';
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_guard_canonical_campaign_input_payload()'::regprocedure))
    IS DISTINCT FROM '6c656e83c8b38ccea75bcc8f7d81ffed' THEN
    RAISE EXCEPTION 'v350: input payload guard changed';
  END IF;
END;
$preflight$;

-- Runtime unit claims lock input before campaign. Acquire both DDL locks without
-- waiting so a busy runtime cannot deadlock against a partially locked migration.
-- A failed subtransaction releases either acquired lock before the short retry.
DO $ddl_locks$
DECLARE attempt integer;
BEGIN
  FOR attempt IN 1..20 LOOP
    BEGIN
      LOCK TABLE public.auto_campaign_input_data, public.auto_campaigns
        IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt=20 THEN RAISE; END IF;
    END;
    PERFORM pg_sleep(0.05);
  END LOOP;
END;
$ddl_locks$;

ALTER TABLE public.auto_campaigns ADD COLUMN content_rotation_indexes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.auto_campaign_input_data ADD COLUMN content_rotation_indexes jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Constant defaults are valid for old rows. Enforce future writes without a full-table validation scan.
ALTER TABLE public.auto_campaigns ADD CONSTRAINT auto_campaigns_content_rotation_indexes_object
  CHECK (jsonb_typeof(content_rotation_indexes) = 'object') NOT VALID;
ALTER TABLE public.auto_campaign_input_data ADD CONSTRAINT auto_campaign_input_data_content_rotation_indexes_object
  CHECK (jsonb_typeof(content_rotation_indexes) = 'object') NOT VALID;

CREATE FUNCTION public.aka_agent_take_campaign_content_index(
  p_campaign_id bigint, p_account_id bigint, p_staff_id bigint,
  p_runtime_target text, p_runtime_claim_token uuid, p_runtime_unit_token uuid,
  p_input_data_id bigint, p_action_code text, p_variant_count integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org bigint;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_input public.auto_campaign_input_data%ROWTYPE;
  v_raw text;
  v_index integer;
  v_first boolean;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 OR p_runtime_target IS NULL
    OR p_runtime_target NOT IN ('desktop','server')
    OR p_runtime_claim_token IS NULL OR p_runtime_unit_token IS NULL
    OR p_action_code IS NULL OR btrim(p_action_code) = '' OR length(p_action_code) > 128
    OR p_variant_count IS NULL OR p_variant_count < 1
    OR (p_input_data_id IS NOT NULL AND p_input_data_id <= 0) THEN
    RAISE EXCEPTION 'campaign_content_invalid_arguments';
  END IF;

  SELECT organization_id INTO v_org FROM public.org_staff
  WHERE id=p_staff_id AND is_active IS TRUE FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'campaign_content_not_owner'; END IF;

  -- Same lock order as unit claim: staff -> entitlement -> serialization -> input -> campaign/account.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
  IF p_input_data_id IS NOT NULL THEN
    SELECT * INTO v_input FROM public.auto_campaign_input_data
    WHERE id=p_input_data_id AND campaign_id=p_campaign_id
      AND NOT COALESCE(is_delete,false) AND status='đang chạy' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_content_input_not_owned'; END IF;
  END IF;

  SELECT c.* INTO v_campaign FROM public.auto_campaigns c
  JOIN public.auto_accounts a ON a.id=c.account_id AND a.staff_id=c.staff_id
  WHERE c.id=p_campaign_id AND c.account_id=p_account_id AND c.staff_id=p_staff_id
    AND (c.organization_id IS NULL OR c.organization_id=v_org)
    AND (a.organization_id IS NULL OR a.organization_id=v_org)
    AND NOT COALESCE(c.is_delete,false) AND NOT COALESCE(a.is_delete,false)
    AND a.is_active IS TRUE AND a.login_status='đã đăng nhập'
    -- Server pause drains the already-claimed unit before releasing ownership.
    AND (p_runtime_target='server' OR (c.status='đang chạy' AND a.status='đang chạy'))
    AND c.runtime_claim_token=p_runtime_claim_token AND c.runtime_claim_target=p_runtime_target
    AND c.runtime_unit_token=p_runtime_unit_token AND c.runtime_unit_claimed_at IS NOT NULL
  FOR UPDATE OF c,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_content_not_owner'; END IF;
  IF p_input_data_id IS NOT NULL AND NOT COALESCE(p_input_data_id=ANY(v_campaign.runtime_unit_input_data_ids),false) THEN
    RAISE EXCEPTION 'campaign_content_input_not_in_unit';
  END IF;
  IF p_variant_count=1 THEN RETURN 0; END IF;

  v_first := p_input_data_id IS NULL OR NOT (v_input.content_rotation_indexes ? p_action_code);
  IF v_first THEN
    v_raw := v_campaign.content_rotation_indexes->>p_action_code;
    IF v_raw IS NULL AND v_campaign.action_id IN ('facebook_timeline_post','facebook_page_post')
      AND p_action_code IN ('fb_post_my_profile','fb_post_page') THEN
      v_raw := v_campaign.extra_settings->>'contentRotationIndex';
    END IF;
  ELSE
    v_raw := v_input.content_rotation_indexes->>p_action_code;
  END IF;
  -- Modulo the current snapshot size; changing templates does not clear state.
  v_index := CASE WHEN v_raw ~ '^[0-9]{1,16}$'
    THEN mod(v_raw::numeric,p_variant_count)::integer ELSE 0 END;
  IF v_first THEN
    UPDATE public.auto_campaigns SET content_rotation_indexes=jsonb_set(
      content_rotation_indexes,ARRAY[p_action_code],to_jsonb((v_index+1)%p_variant_count),true)
    WHERE id=p_campaign_id;
  END IF;
  IF p_input_data_id IS NOT NULL THEN
    UPDATE public.auto_campaign_input_data SET content_rotation_indexes=jsonb_set(
      content_rotation_indexes,ARRAY[p_action_code],to_jsonb((v_index+1)%p_variant_count),true)
    WHERE id=p_input_data_id;
  END IF;
  RETURN v_index;
END;
$function$;
ALTER FUNCTION public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)
  TO anon, authenticated, service_role, aka_agent_chat_api;
-- API metadata changes: two columns and a new RPC signature.
NOTIFY pgrst, 'reload schema';
COMMIT;
