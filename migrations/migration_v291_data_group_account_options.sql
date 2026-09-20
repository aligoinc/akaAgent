-- v291: Share account eligibility between Data Group pickers and writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_data_group_account_available(bigint,bigint,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_account_available(bigint,bigint,bigint)'))) IS DISTINCT FROM 'a1ab32210c3f3cc16b814898fb26315c' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_data_group_account_available(bigint,bigint,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_data_group_validate_bound_rule(bigint,bigint,bigint,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_validate_bound_rule(bigint,bigint,bigint,jsonb)'))) IS DISTINCT FROM '469684f0be829225f8e4cf6d89e27b4a' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_data_group_validate_bound_rule(bigint,bigint,bigint,jsonb)'; END IF;
IF to_regprocedure('public.aka_agent_ensure_dataset_auto_data_group()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_ensure_dataset_auto_data_group()'))) IS DISTINCT FROM '90a468db714e8ec79f0d97928a90b1d3' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_ensure_dataset_auto_data_group()'; END IF;
IF to_regprocedure('public.aka_agent_guard_data_group_bound_account()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_guard_data_group_bound_account()'))) IS DISTINCT FROM 'fac56e4b36c7707d6cabac4065c15715' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_guard_data_group_bound_account()'; END IF;
IF to_regprocedure('public.aka_agent_guard_data_group_bound_member()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_guard_data_group_bound_member()'))) IS DISTINCT FROM '2748ad9dff6273fd7e4b9d91fee74986' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_guard_data_group_bound_member()'; END IF;
IF to_regprocedure('public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text)'))) IS DISTINCT FROM '9d3a4b9962377035ce8eae844fbb2774' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text,bigint)'))) IS DISTINCT FROM '692665cd33c7ce2f2900de239890a409' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)'))) IS DISTINCT FROM '9215d6543aa1bb2627676f280465b8fa' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)'; END IF;
IF to_regprocedure('public.aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)'))) IS DISTINCT FROM '1c392cbde23276cbeb867b3678d5eaf9' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)'; END IF;
IF to_regprocedure('public.aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text)'))) IS DISTINCT FROM 'd3d0f58f5212b696c908b9e665d4854e' THEN RAISE EXCEPTION 'v291 RPC drift: public.aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text)'; END IF;
IF to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))) IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN RAISE EXCEPTION 'v291 RPC drift: public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_data_group_account_options_internal(public.auto_account_contact_groups,bigint[])') IS NOT NULL THEN RAISE EXCEPTION 'v291 new signature already exists: public.aka_agent_data_group_account_options_internal(public.auto_account_contact_groups,bigint[])'; END IF;
IF to_regprocedure('public.aka_agent_get_data_group_account_options(bigint,bigint,bigint,bigint,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'v291 new signature already exists: public.aka_agent_get_data_group_account_options(bigint,bigint,bigint,bigint,text,text)'; END IF;
END $preflight$;
-- One bounded group scan is shared by the picker and the write guard.
-- VOLATILE retains fresh read-committed snapshots after the writer acquires the group lock.
CREATE FUNCTION public.aka_agent_data_group_account_options_internal(
  p_group public.auto_account_contact_groups, p_account_ids bigint[] DEFAULT NULL
) RETURNS TABLE(account_id bigint, account_name text, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_type text; v_total bigint; v_counts jsonb; v_sources bigint[]; v_datasets bigint;
  v_rules jsonb; v_rule jsonb; v_account record; v_bad bigint;
BEGIN
  SELECT code INTO v_type FROM public.category_item WHERE id=p_group.data_type_category_item_id;
  -- Count eligible members by account once, rather than scanning the group per option.
  WITH member_counts AS (
    SELECT c.account_id,
      c.staff_id=p_group.staff_id AND c.organization_id=p_group.organization_id
      AND NOT EXISTS (SELECT 1 FROM public.auto_account_contact_group_member_origins o
        WHERE o.membership_id=m.id AND o.is_current AND o.source_account_id IS DISTINCT FROM c.account_id) AS compatible,
      count(*) AS n
    FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts c ON c.id=m.contact_id
    WHERE m.group_id=p_group.id AND NOT m.is_delete
    GROUP BY c.account_id, compatible
  )
  SELECT COALESCE(sum(mc.n),0), COALESCE(jsonb_object_agg(mc.account_id::text,mc.n)
    FILTER (WHERE mc.account_id IS NOT NULL AND mc.compatible),'{}'::jsonb)
  INTO v_total,v_counts FROM member_counts mc;

  -- A live dataset remains a source even when its current snapshot is empty.
  WITH datasets AS (
    SELECT d.id,d.account_id FROM public.auto_account_contacts_dataset d
    WHERE d.auto_data_group_id=p_group.id AND NOT d.is_delete
    UNION
    SELECT d.id,d.account_id FROM public.auto_account_contacts_dataset d
    WHERE d.group_id=p_group.id AND NOT d.is_delete
  ), sources AS (
    SELECT d.account_id FROM datasets d
    UNION ALL
    SELECT c.account_id FROM public.auto_automation a
    LEFT JOIN public.auto_campaigns c ON c.id=a.source_campaign_id
    WHERE a.target_data_group_id=p_group.id AND a.is_active AND NOT a.is_delete
  )
  SELECT (SELECT count(*) FROM datasets),array_agg(DISTINCT s.account_id)
  INTO v_datasets,v_sources FROM sources s;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)||jsonb_build_object('field_code',f.code)),'[]'::jsonb)
  INTO v_rules FROM public.auto_account_contact_group_dynamic_filters d
  JOIN public.auto_account_contact_group_dynamic_filter_rules r ON r.dynamic_filter_id=d.id
  JOIN public.category_item f ON f.id=r.field_category_item_id WHERE d.group_id=p_group.id;

  FOR v_account IN
    SELECT NULL::bigint id, 'Không gắn tài khoản'::text name
    UNION ALL
    SELECT a.id,a.name FROM public.auto_accounts a
    WHERE a.staff_id=p_group.staff_id AND a.organization_id=p_group.organization_id
      AND a.flatform_type='zalo' AND (NOT a.is_delete OR a.id=p_group.bound_zalo_account_id)
      AND (p_account_ids IS NULL OR a.id=ANY(p_account_ids))
    ORDER BY id NULLS FIRST
  LOOP
    account_id:=v_account.id; account_name:=v_account.name; reason:=NULL;
    IF account_id IS NOT NULL THEN
      IF p_group.purpose<>'data_group' OR v_type IS NULL OR v_type NOT IN ('zalo_person','zalo_group') THEN
        reason:='data_group_bound_type_invalid';
      ELSIF NOT public.aka_agent_data_group_account_available(account_id,p_group.staff_id,p_group.organization_id) THEN
        reason:='data_group_bound_account_invalid';
      ELSIF p_group.dataset_sync_mode='dataset_auto' AND v_datasets=0 THEN
        reason:='data_group_bound_source_unknown';
      ELSIF EXISTS(SELECT 1 FROM unnest(v_sources) s(id) WHERE s.id IS DISTINCT FROM account_id) THEN
        reason:='data_group_bound_source_mismatch';
      ELSE
        v_bad:=v_total-COALESCE((v_counts->>account_id::text)::bigint,0);
        IF v_bad>0 THEN
          reason:='data_group_bound_members_mismatch:'||v_bad::text;
        ELSE
          FOR v_rule IN SELECT value FROM jsonb_array_elements(v_rules) LOOP
            BEGIN
              PERFORM public.aka_agent_data_group_validate_bound_rule(account_id,p_group.staff_id,p_group.organization_id,v_rule);
            EXCEPTION WHEN SQLSTATE 'P0001' THEN
              IF SQLERRM<>'data_group_bound_rule_mismatch' THEN RAISE; END IF;
              reason:='data_group_bound_rule_mismatch';
            END;
            EXIT WHEN reason IS NOT NULL;
          END LOOP;
        END IF;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;

CREATE FUNCTION public.aka_agent_get_data_group_account_options(
  p_staff_id bigint, p_organization_id bigint, p_group_id bigint,
  p_data_type_category_item_id bigint, p_auth_username text, p_auth_password text
) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '15s' AS $function$
DECLARE v_group public.auto_account_contact_groups%ROWTYPE;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id,p_organization_id);
  IF p_group_id IS NOT NULL THEN
    SELECT * INTO v_group FROM public.auto_account_contact_groups
    WHERE id=p_group_id AND staff_id=p_staff_id AND organization_id=p_organization_id
      AND purpose='data_group' AND NOT is_delete;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
    IF v_group.dataset_sync_mode='dataset_auto'
      AND p_data_type_category_item_id IS DISTINCT FROM v_group.data_type_category_item_id THEN
      RAISE EXCEPTION 'dataset_auto_data_group_type_read_only';
    END IF;
  ELSE
    v_group.staff_id:=p_staff_id; v_group.organization_id:=p_organization_id;
    v_group.purpose:='data_group'; v_group.dataset_sync_mode:='manual';
  END IF;
  v_group.data_type_category_item_id:=p_data_type_category_item_id;
  RETURN QUERY SELECT to_jsonb(o) FROM public.aka_agent_data_group_account_options_internal(v_group) o;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_guard_data_group_bound_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_reason text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.bound_zalo_account_id IS NOT DISTINCT FROM OLD.bound_zalo_account_id
    AND NEW.data_type_category_item_id IS NOT DISTINCT FROM OLD.data_type_category_item_id
    AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
  IF NEW.bound_zalo_account_id IS NOT NULL THEN
    SELECT o.reason INTO v_reason
    FROM public.aka_agent_data_group_account_options_internal(NEW,ARRAY[NEW.bound_zalo_account_id]) o
    WHERE o.account_id=NEW.bound_zalo_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_bound_account_invalid'; END IF;
    IF v_reason IS NOT NULL THEN RAISE EXCEPTION '%',v_reason; END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.bound_zalo_account_id IS DISTINCT FROM OLD.bound_zalo_account_id THEN
    -- Callers take the dynamic worker advisory lock before the group row lock.
    UPDATE public.auto_account_contact_group_dynamic_filters SET effective_from_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE group_id=NEW.id;
    NEW.revision := NEW.revision+1;
  END IF;
  RETURN NEW;
END;
$function$
;

ALTER FUNCTION public.aka_agent_data_group_account_options_internal(public.auto_account_contact_groups,bigint[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_data_group_account_options_internal(public.auto_account_contact_groups,bigint[]) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.aka_agent_get_data_group_account_options(bigint,bigint,bigint,bigint,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_get_data_group_account_options(bigint,bigint,bigint,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_data_group_account_options(bigint,bigint,bigint,bigint,text,text) TO anon,authenticated,service_role;
-- A new API RPC signature requires schema-cache refresh.
NOTIFY pgrst, 'reload schema';
COMMIT;
