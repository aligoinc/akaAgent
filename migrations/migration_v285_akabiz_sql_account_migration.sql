-- v285: SQL Account migration. Live audit 2026-09-18, cgjbsmqtfhqvttudyjzq.
-- New RPC; existing portal/helper bodies are deliberately unchanged.
-- Preserve v219 tokenized subtype claims, locks and quota enforcement outside import.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE v text;
BEGIN
  SELECT md5(pg_get_functiondef(to_regprocedure('public.enforce_zalo_account_capability_and_quota()'))) INTO v;
  IF v IS NULL OR v NOT IN ('567609a81de652a65813586093accfe4','1edc48a7985f2268159ad0b605fb205b') THEN
    RAISE EXCEPTION 'v285 trigger checksum mismatch: %',v;
  END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.akabiz_migrate_sql_account_v1(jsonb)'))) INTO v;
  IF v IS NOT NULL AND v <> '529028a7ad71f71f61212d04062cad4f' THEN
    RAISE EXCEPTION 'v285 migration RPC already exists with unexpected checksum: %',v;
  END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.fn_upsert_aka_customer_v1(jsonb)'))) INTO v;
  IF v IS DISTINCT FROM 'b111013d7e1918ddffc9a13830db2012' THEN
    RAISE EXCEPTION 'v285 portal customer helper changed; audit its contract again: %',v;
  END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.akabiz_portal_create_trial_account(jsonb)'))) INTO v;
  IF v IS DISTINCT FROM 'ed7bf07f6a99905279a1cdfafd3c3e6f' THEN
    RAISE EXCEPTION 'v285 portal duplicate registration guard changed; audit again: %',v;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
    WHERE conrelid='public.org_organization'::regclass AND conname='org_organization_phone_key';
  IF v IS NOT NULL AND v <> 'UNIQUE (phone)' THEN RAISE EXCEPTION 'v285 unexpected organization phone constraint'; END IF;
END;
$preflight$;
ALTER TABLE public.org_organization DROP CONSTRAINT IF EXISTS org_organization_phone_key;
CREATE OR REPLACE FUNCTION public.enforce_zalo_account_capability_and_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_new_platform text := lower(btrim(COALESCE(NEW.flatform_type, '')));
  v_old_platform text := CASE
    WHEN TG_OP = 'UPDATE' THEN lower(btrim(COALESCE(OLD.flatform_type, '')))
    ELSE ''
  END;
  v_staff_organization_id bigint;
  v_organization_id bigint;
  v_new_subtype text;
  v_pool record;
  v_pool_subtypes text[] := ARRAY[]::text[];
  v_account_count integer := 0;
  v_requires_capability_check boolean := false;
  v_requires_quota_check boolean := false;
  v_is_existing_subtype_change boolean := false;
  v_is_claimed_subtype_cas boolean := false;
BEGIN
  IF v_new_platform <> 'zalo' OR COALESCE(NEW.is_delete, false) THEN
    RETURN NEW;
  END IF;

  v_new_subtype := CASE
    WHEN COALESCE(NEW.is_zalo_show_web, false) THEN 'web'
    WHEN COALESCE(NEW.is_zalo_server, false) THEN 'server'
    ELSE 'qr'
  END;

  -- Backend-only SQL import: preserve expired entitlements, locked staff and existing
  -- legacy counts. This context is scoped/restored by akabiz_migrate_sql_account_v1.
  -- Tenant callers cannot opt in, even if they manage to set the custom GUC.
  IF TG_OP = 'INSERT'
    AND (current_setting('role', true) = 'service_role'
      OR (session_user = 'postgres' AND current_setting('role', true) IN ('none','postgres')))
    AND current_setting('aka_agent.sql_migration_org', true) = NEW.organization_id::text
    AND NEW.is_zalo_server = true AND NEW.is_zalo_show_web = false
    AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.id = NEW.staff_id
      AND s.organization_id = NEW.organization_id AND s.deleted_at IS NULL)
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_requires_capability_check := true;
    v_requires_quota_check := true;
  ELSE
    v_is_existing_subtype_change := v_old_platform = 'zalo'
      AND v_new_platform = 'zalo'
      AND OLD.id IS NOT DISTINCT FROM NEW.id
      AND OLD.flatform_type IS NOT DISTINCT FROM NEW.flatform_type
      AND COALESCE(OLD.is_delete, false) = false
      AND COALESCE(NEW.is_delete, false) = false
      AND OLD.staff_id IS NOT DISTINCT FROM NEW.staff_id
      AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
      AND (
        COALESCE(OLD.is_zalo_show_web, false)
          IS DISTINCT FROM COALESCE(NEW.is_zalo_show_web, false)
        OR COALESCE(OLD.is_zalo_server, false)
          IS DISTINCT FROM COALESCE(NEW.is_zalo_server, false)
      );
    v_is_claimed_subtype_cas := v_is_existing_subtype_change
      AND OLD.status = 'đang chạy'
      AND NEW.status = 'đang chạy'
      AND OLD.runtime_operation_claim_token IS NOT NULL
      AND OLD.runtime_operation_claim_token
        IS NOT DISTINCT FROM NEW.runtime_operation_claim_token;
    v_requires_capability_check := v_old_platform <> 'zalo'
      OR COALESCE(OLD.is_delete, false)
      OR OLD.staff_id IS DISTINCT FROM NEW.staff_id
      OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
      OR COALESCE(OLD.is_zalo_show_web, false)
        IS DISTINCT FROM COALESCE(NEW.is_zalo_show_web, false)
      OR COALESCE(OLD.is_zalo_server, false)
        IS DISTINCT FROM COALESCE(NEW.is_zalo_server, false);
    v_requires_quota_check := v_requires_capability_check;
  END IF;

  IF NOT v_requires_capability_check AND NOT v_requires_quota_check THEN
    RETURN NEW;
  END IF;

  -- Subtype ownership is changed only by the tokenized claim/CAS/release
  -- protocol. Preserve the existing fail-closed and lock-order behavior.
  IF v_is_existing_subtype_change AND NOT v_is_claimed_subtype_cas THEN
    RAISE EXCEPTION 'zalo_account_subtype_change_claim_required';
  END IF;

  IF v_is_claimed_subtype_cas THEN
    SELECT staff.organization_id
    INTO v_staff_organization_id
    FROM public.org_staff AS staff
    WHERE staff.id = NEW.staff_id
      AND staff.is_active = true;
  ELSE
    SELECT staff.organization_id
    INTO v_staff_organization_id
    FROM public.org_staff AS staff
    WHERE staff.id = NEW.staff_id
      AND staff.is_active = true
    FOR SHARE OF staff;
  END IF;

  IF NOT FOUND OR v_staff_organization_id IS NULL THEN
    RAISE EXCEPTION 'zalo_account_staff_not_active';
  END IF;

  v_organization_id := COALESCE(NEW.organization_id, v_staff_organization_id);
  IF v_organization_id IS DISTINCT FROM v_staff_organization_id THEN
    RAISE EXCEPTION 'zalo_account_organization_mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  SELECT *
  INTO v_pool
  FROM private.resolve_organization_zalo_entitlement_pools(v_organization_id)
  WHERE account_subtype = v_new_subtype;

  IF v_requires_capability_check AND v_pool.entitlement_id IS NULL THEN
    RAISE EXCEPTION 'zalo_account_capability_unavailable';
  END IF;

  IF v_requires_quota_check THEN
    SELECT COALESCE(
      array_agg(pool.account_subtype ORDER BY pool.account_subtype),
      ARRAY[]::text[]
    )
    INTO v_pool_subtypes
    FROM private.resolve_organization_zalo_entitlement_pools(
      v_organization_id
    ) AS pool
    WHERE pool.entitlement_id = v_pool.entitlement_id;

    -- This is the same transaction lock used by the atomic Control creator.
    -- Calls are re-entrant, so the RPC and trigger remain race-safe together.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('control-zalo-account:' || NEW.staff_id::text, 0)
    );

    SELECT count(*)::integer
    INTO v_account_count
    FROM public.auto_accounts AS account
    WHERE account.staff_id = NEW.staff_id
      AND (
        account.organization_id IS NULL
        OR account.organization_id = v_organization_id
      )
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_delete, false) = false
      AND (
        TG_OP <> 'UPDATE'
        OR account.id IS DISTINCT FROM NEW.id
      )
      AND (
        CASE
          WHEN COALESCE(account.is_zalo_show_web, false) THEN 'web'
          WHEN COALESCE(account.is_zalo_server, false) THEN 'server'
          ELSE 'qr'
        END
      ) = ANY(v_pool_subtypes);

    IF v_pool.max_accounts IS NOT NULL
      AND v_pool.max_accounts > 0
      AND v_account_count >= v_pool.max_accounts
    THEN
      RAISE EXCEPTION 'zalo_account_limit_reached';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.akabiz_migrate_sql_account_v1(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_sql_id text := p->>'sql_account_id';
  a jsonb := p->'account';
  v_phone text;
  v_customer bigint;
  v_customer_ids bigint[];
  v_org bigint;
  v_org_ids bigint[];
  v_link text;
  v_creator bigint;
  v_owner bigint;
  v_staff bigint;
  v_group bigint;
  v_org_customer bigint;
  v_zalo bigint;
  v_admin bigint;
  v_ids bigint[];
  v_package_ids bigint[] := '{}';
  v_selected bigint;
  v_product_id bigint;
  v_product_row bigint;
  v_package public.org_product_package%rowtype;
  v_product_name text;
  v_kind text;
  v_days numeric;
  v_ranks bigint[];
  v_staff_map jsonb := '{}';
  v_group_map jsonb := '{}';
  v_products jsonb := '[]';
  v_helper jsonb;
  v_record jsonb;
  v_previous_ctx text;
  v_bad_customer_chain boolean := false;
  v_staff_created int := 0;
  v_staff_reused int := 0;
  v_groups_created int := 0;
  v_memberships_created int := 0;
  v_products_created int := 0;
  v_products_updated int := 0;
  v_zalo_created int := 0;
BEGIN
  IF v_sql_id IS NULL OR v_sql_id !~ '^[1-9][0-9]{0,9}$' THEN
    RAISE EXCEPTION 'MIG_PAYLOAD_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('akabiz-sql-account:' || v_sql_id, 0));
  SELECT id, customer_id INTO v_org, v_customer FROM public.org_organization WHERE sql_account_id = v_sql_id;
  IF FOUND THEN
    RETURN jsonb_build_object('organization_id', v_org, 'customer_id', v_customer, 'already_migrated', true,
      'counts', jsonb_build_object('staff_created',0,'staff_reused',0,'groups_created',0,'memberships_created',0,
        'products_created',0,'products_updated',0,'zalo_accounts_created',0),
      'products','[]'::jsonb,'skipped_products','[]'::jsonb,'skipped_staff','[]'::jsonb,'skipped_shops','[]'::jsonb,'adjustments','[]'::jsonb);
  END IF;
  v_phone := public.normalize_phone(a->>'phone');
  IF v_phone IS NULL OR v_phone !~ '^0[1-9][0-9]{8}$'
    OR jsonb_typeof(p->'staff') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'staff') = 0
    OR jsonb_typeof(p->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'groups') = 0
    OR jsonb_typeof(p->'memberships') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p->'shops') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p->'product_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'product_ids') = 0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p->'product_ids') x WHERE x::bigint NOT IN (3,16,18))
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'staff') x
      WHERE x->>'id' = p->>'admin_sql_staff_id' AND (x->>'is_admin')::boolean)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'staff') x WHERE public.normalize_phone(x->>'phone') IS DISTINCT FROM x->>'phone'
      OR coalesce(x->>'phone','') !~ '^0[1-9][0-9]{8}$')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'staff') x GROUP BY x->>'phone' HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'staff') x GROUP BY x->>'id' HAVING count(*) > 1)
  THEN RAISE EXCEPTION 'MIG_PAYLOAD_INVALID'; END IF;

  -- Same phone lock as the portal helper; canonical customer row also serializes aliases.
  PERFORM pg_advisory_xact_lock(hashtextextended('zalo-referral-phone:' || v_phone, 0));
  WITH RECURSIVE matches AS (
    SELECT c.id, c.merged_into_customer_id, c.record_state, ARRAY[c.id] path, false cycle FROM public.aka_customer c
    WHERE public.normalize_phone(c.phone) = v_phone
    UNION ALL
    SELECT c.id, c.merged_into_customer_id, c.record_state, m.path || c.id, c.id = ANY(m.path)
    FROM matches m JOIN public.aka_customer c ON c.id = m.merged_into_customer_id
    WHERE NOT m.cycle AND cardinality(m.path) < 32
  ) SELECT array_agg(DISTINCT id) FILTER (WHERE merged_into_customer_id IS NULL),
      bool_or(cycle OR cardinality(path) >= 32 OR (record_state='merged' AND merged_into_customer_id IS NULL) OR (merged_into_customer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.aka_customer c WHERE c.id = matches.merged_into_customer_id)))
    INTO v_customer_ids, v_bad_customer_chain FROM matches;
  IF coalesce(v_bad_customer_chain,false) OR cardinality(v_customer_ids) > 1 THEN RAISE EXCEPTION 'MIG_CUSTOMER_AMBIGUOUS'; END IF;
  v_customer := v_customer_ids[1];
  SELECT id INTO v_creator FROM public.org_staff WHERE sql_staff_id = (a->>'creator_sql_staff_id')::bigint;
  SELECT id INTO v_owner FROM public.org_staff WHERE sql_staff_id = (a->>'owner_sql_staff_id')::bigint;
  v_creator := coalesce(v_creator,15); v_owner := coalesce(v_owner,15);
  IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id = v_creator)
    OR NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id = v_owner) THEN RAISE EXCEPTION 'MIG_INTERNAL_STAFF_MISSING'; END IF;
  IF v_customer IS NULL THEN
    v_helper := public.fn_upsert_aka_customer_v1(jsonb_build_object('phone',v_phone,'name',a->>'customer_name',
      'email',a->>'email','org_staff_id',v_owner,'overwrite',false,'use_split_rules',false,'is_create_crm',false,
      'channel','akabiz_sql_migration','creation_path','akabiz_sql_migration'));
    IF NOT coalesce((v_helper->>'ok')::boolean,false) OR v_helper->>'customer_id' IS NULL THEN
      RAISE EXCEPTION 'MIG_CUSTOMER_CREATE_FAILED';
    END IF;
    v_customer := (v_helper->>'customer_id')::bigint;
    -- The helper assigns the same actor to create/owner. Only a newly inserted customer
    -- receives the independent SQL creator/owner attribution; existing CRM is untouched.
    IF coalesce((v_helper->>'is_new')::boolean,false) THEN
      UPDATE public.aka_customer SET org_staff_create_id=v_creator, org_staff_id_owner=v_owner,
        org_staff_update_id=v_creator WHERE id=v_customer;
    END IF;
  END IF;
  PERFORM 1 FROM public.aka_customer WHERE id=v_customer FOR UPDATE;

  -- Catalog is read for every migration. Rank all best candidates; never break a tie by id.
  v_kind := a->>'package_type';
  IF v_kind NOT IN ('demo','month','1_month','year','forever') OR v_kind IS NULL THEN RAISE EXCEPTION 'MIG_PACKAGE_UNKNOWN'; END IF;
  v_days := coalesce((a->>'duration_days')::numeric, CASE WHEN v_kind IN ('month','1_month') THEN 60 WHEN v_kind='year' THEN 365 END);
  IF v_kind IN ('month','1_month','year') AND (v_days IS NULL OR v_days <= 0) THEN RAISE EXCEPTION 'MIG_PACKAGE_UNKNOWN'; END IF;
  FOR v_product_id IN SELECT DISTINCT x::bigint FROM jsonb_array_elements_text(p->'product_ids') x ORDER BY 1 LOOP
    WITH candidates AS (
      SELECT pp.*, dense_rank() OVER (ORDER BY
        CASE WHEN v_kind='forever' THEN CASE WHEN lower(pp.package_type) IN ('forever','unlimited') THEN 0 ELSE 1 END ELSE 0 END,
        CASE WHEN v_kind='forever' AND lower(pp.package_type) NOT IN ('forever','unlimited') THEN -pp.duration_days::numeric
          WHEN v_kind NOT IN ('demo','forever') THEN abs(pp.duration_days::numeric-v_days) ELSE 0 END
      ) ranking
      FROM public.org_product_package pp JOIN public.org_product pr ON pr.id=pp.product_id
      WHERE pp.product_id=v_product_id AND pr.is_active IS TRUE
        AND CASE WHEN v_kind='demo' THEN lower(pp.package_type)='demo' ELSE lower(pp.package_type)<>'demo' END
        AND (v_product_id<>16 OR (pp.is_zalo_server IS TRUE AND coalesce(pp.is_zalo_show_web,false)=false))
        AND (v_product_id<>18 OR (pp.is_zalo_show_web IS TRUE AND coalesce(pp.is_zalo_server,false)=false))
    ) SELECT array_agg(id) INTO v_ranks FROM candidates WHERE ranking=1;
    IF coalesce(cardinality(v_ranks),0)=0 THEN RAISE EXCEPTION 'MIG_PACKAGE_MISSING'; END IF;
    IF cardinality(v_ranks)<>1 THEN RAISE EXCEPTION 'MIG_PACKAGE_AMBIGUOUS'; END IF;
    v_package_ids := array_append(v_package_ids,v_ranks[1]);
  END LOOP;
  -- Lock catalog rows until quota/package projection has been written.
  PERFORM 1 FROM public.org_product_package WHERE id=ANY(v_package_ids) ORDER BY id FOR SHARE;

  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-zalo-runtime-entitlement-mutation',0));
  WITH RECURSIVE family AS (
    SELECT id FROM public.aka_customer WHERE id=v_customer
    UNION SELECT c.id FROM public.aka_customer c JOIN family f ON c.merged_into_customer_id=f.id
  ) SELECT array_agg(o.id ORDER BY o.id) INTO v_org_ids FROM public.org_organization o WHERE o.customer_id IN (SELECT id FROM family);
  IF cardinality(v_org_ids)>1 THEN RAISE EXCEPTION 'MIG_ORG_AMBIGUOUS'; END IF;
  v_org := v_org_ids[1];
  IF v_org IS NOT NULL THEN
    SELECT sql_account_id INTO v_link FROM public.org_organization WHERE id=v_org FOR UPDATE;
    IF nullif(v_link,'') IS NOT NULL THEN RAISE EXCEPTION 'MIG_SQL_LINK_CONFLICT'; END IF;
    PERFORM 1 FROM public.org_organization_product WHERE organization_id=v_org ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.org_organization_product op WHERE op.organization_id=v_org
        AND NOT coalesce(op.is_deleted,false) AND op.product_id IN (SELECT x::bigint FROM jsonb_array_elements_text(p->'product_ids') x)
        AND lower(coalesce(op.package_type,'')) <> 'demo') THEN v_org := NULL;
    END IF;
  END IF;
  IF v_org IS NULL THEN
    INSERT INTO public.org_organization(customer_id,name,phone,email,staff_id_created,staff_id_owner,max_staff)
    VALUES(v_customer,a->>'name',v_phone,a->>'email',v_creator,v_owner,
      coalesce((a->>'max_staff')::int,(SELECT max(max_staff) FROM public.org_product_package WHERE id=ANY(v_package_ids))))
    RETURNING id INTO v_org;
  END IF;

  FOREACH v_selected IN ARRAY v_package_ids LOOP
    SELECT * INTO STRICT v_package FROM public.org_product_package WHERE id=v_selected;
    SELECT name INTO v_product_name FROM public.org_product WHERE id=v_package.product_id;
    SELECT array_agg(id) INTO v_ids FROM public.org_organization_product WHERE organization_id=v_org
      AND product_id=v_package.product_id AND NOT coalesce(is_deleted,false);
    IF cardinality(v_ids)>1 THEN RAISE EXCEPTION 'MIG_PRODUCT_AMBIGUOUS'; END IF;
    v_product_row := v_ids[1];
    IF v_product_row IS NULL THEN
      INSERT INTO public.org_organization_product(organization_id,product_package_id,product_id,
        organization_phone,organization_email,product_name,package_name,package_type,max_accounts,max_staff,
        duration_days,max_sends_per_day,expiration_date,is_paid,is_chat_sync,is_zalo_server,is_zalo_show_web,created_by,updated_by)
      VALUES(v_org,v_package.id,v_package.product_id,v_phone,a->>'email',v_product_name,v_package.name,v_package.package_type,
        coalesce((a->>'max_accounts')::int,v_package.max_account),coalesce((a->>'max_staff')::int,v_package.max_staff),
        v_package.duration_days,coalesce((a->>'max_sends_per_day')::int,v_package.max_sends_per_day),
        (a->>'expiration_date')::timestamptz,v_kind<>'demo',false,v_package.product_id=16,v_package.product_id=18,v_creator,v_owner);
      v_products_created := v_products_created+1;
    ELSE
      UPDATE public.org_organization_product SET product_package_id=v_package.id,
        product_name=v_product_name,package_name=v_package.name,package_type=v_package.package_type,
        max_accounts=coalesce((a->>'max_accounts')::int,v_package.max_account),max_staff=coalesce((a->>'max_staff')::int,v_package.max_staff),
        duration_days=v_package.duration_days,max_sends_per_day=coalesce((a->>'max_sends_per_day')::int,v_package.max_sends_per_day),
        expiration_date=(a->>'expiration_date')::timestamptz,is_paid=v_kind<>'demo',is_chat_sync=false,
        is_zalo_server=v_package.product_id=16,is_zalo_show_web=v_package.product_id=18,updated_by=v_owner,updated_at=now()
      WHERE id=v_product_row;
      v_products_updated := v_products_updated+1;
    END IF;
    v_products := v_products || jsonb_build_object('product_id',v_package.product_id,'package_id',v_package.id);
  END LOOP;

  -- Deterministic phone order avoids deadlocks when distinct customers share staff phones.
  FOR v_record IN SELECT x FROM jsonb_array_elements(p->'staff') x ORDER BY x->>'phone' LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('akabiz-org-customer-phone:' || (v_record->>'phone'),0));
    SELECT array_agg(id) INTO v_ids FROM public.org_customer WHERE public.normalize_phone(phone)=v_record->>'phone';
    IF cardinality(v_ids)>1 THEN RAISE EXCEPTION 'MIG_ORG_CUSTOMER_AMBIGUOUS'; END IF;
    v_org_customer := v_ids[1];
    IF v_org_customer IS NULL THEN
      INSERT INTO public.org_customer(name,phone,email) VALUES(v_record->>'name',v_record->>'phone',v_record->>'email')
      ON CONFLICT (phone) DO NOTHING RETURNING id INTO v_org_customer;
      IF v_org_customer IS NULL THEN SELECT id INTO v_org_customer FROM public.org_customer WHERE phone=v_record->>'phone'; END IF;
    END IF;
    SELECT array_agg(id) INTO v_ids FROM public.org_staff WHERE organization_id=v_org AND public.normalize_phone(phone)=v_record->>'phone';
    IF cardinality(v_ids)>1 THEN RAISE EXCEPTION 'MIG_STAFF_AMBIGUOUS'; END IF;
    v_staff := v_ids[1];
    IF v_staff IS NULL THEN
      INSERT INTO public.org_staff(organization_id,customer_id,name,phone,email,username,password,is_admin,is_active)
      VALUES(v_org,v_org_customer,v_record->>'name',v_record->>'phone',v_record->>'email',
        v_org::text || '.' || (v_record->>'phone'),'123456',(v_record->>'is_admin')::boolean,(v_record->>'is_active')::boolean)
      RETURNING id INTO v_staff;
      v_staff_created := v_staff_created+1;
    ELSE
      IF EXISTS (SELECT 1 FROM public.org_staff WHERE id=v_staff AND (deleted_at IS NOT NULL OR sql_staff_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'MIG_STAFF_CONFLICT';
      END IF;
      UPDATE public.org_staff SET customer_id=v_org_customer,is_admin=(v_record->>'is_admin')::boolean,
        is_active=(v_record->>'is_active')::boolean,updated_at=now() WHERE id=v_staff;
      v_staff_reused := v_staff_reused+1;
    END IF;
    v_staff_map := v_staff_map || jsonb_build_object(v_record->>'id',v_staff);
    IF v_record->>'id'=p->>'admin_sql_staff_id' THEN v_admin := v_staff; END IF;
  END LOOP;
  FOR v_record IN SELECT x FROM jsonb_array_elements(p->'groups') x LOOP
    IF v_record->>'parent_id' IS NOT NULL AND NOT v_group_map ? (v_record->>'parent_id') THEN RAISE EXCEPTION 'MIG_PAYLOAD_INVALID'; END IF;
    INSERT INTO public.org_group(organization_id,parent_id,name)
    VALUES(v_org,(v_group_map->>(v_record->>'parent_id'))::bigint,v_record->>'name') RETURNING id INTO v_group;
    v_group_map := v_group_map || jsonb_build_object(v_record->>'id',v_group);
    v_groups_created := v_groups_created+1;
  END LOOP;
  FOR v_record IN SELECT x FROM jsonb_array_elements(p->'memberships') x LOOP
    v_staff := (v_staff_map->>(v_record->>'staff_id'))::bigint; v_group := (v_group_map->>(v_record->>'group_id'))::bigint;
    IF v_staff IS NULL OR v_group IS NULL THEN RAISE EXCEPTION 'MIG_PAYLOAD_INVALID'; END IF;
    INSERT INTO public.org_group_staff(organization_id,staff_id,group_id,is_admin)
    VALUES(v_org,v_staff,v_group,(v_record->>'is_admin')::boolean);
    v_memberships_created := v_memberships_created+1;
  END LOOP;

  -- Only the backend migration can import dormant/expired/over-quota legacy accounts.
  -- Runtime still evaluates current entitlements and verifies each session normally.
  v_previous_ctx := current_setting('aka_agent.sql_migration_org',true);
  PERFORM set_config('aka_agent.sql_migration_org',v_org::text,true);
  FOR v_record IN SELECT x FROM jsonb_array_elements(p->'shops') x LOOP
    v_staff := (v_staff_map->>(v_record->>'staff_id'))::bigint;
    IF v_staff IS NULL OR NOT (p->'product_ids') @> '[16]'::jsonb THEN
      RAISE EXCEPTION 'MIG_PAYLOAD_INVALID';
    END IF;
    -- A Shop that has never logged in has no Zalo identity yet. Reset per Shop
    -- so it cannot inherit the previous Shop's identity; normal login links it later.
    v_zalo := NULL;
    IF nullif(btrim(v_record->>'zalo_uid'),'') IS NOT NULL THEN
      INSERT INTO public.zalo_accounts(zalo_uid,display_name,phone)
      VALUES(v_record->>'zalo_uid',v_record->>'name',v_record->>'phone') ON CONFLICT (zalo_uid) DO NOTHING
      RETURNING id INTO v_zalo;
      IF v_zalo IS NULL THEN SELECT id INTO v_zalo FROM public.zalo_accounts WHERE zalo_uid=v_record->>'zalo_uid'; END IF;
    END IF;
    INSERT INTO public.auto_accounts(name,flatform_type,staff_id,organization_id,zalo_account_id,
      is_active,is_delete,is_zalo_server,is_zalo_show_web,login_status,status,zalo_session,zalo_session_updated_at,zalo_session_last_error)
    VALUES(v_record->>'name','zalo',v_staff,v_org,v_zalo,(v_record->>'is_active')::boolean,false,true,false,
      'chưa đăng nhập','chờ xử lý',nullif(v_record->'session','null'::jsonb),
      CASE WHEN nullif(v_record->'session','null'::jsonb) IS NOT NULL THEN now() END,
      CASE WHEN nullif(v_record->'session','null'::jsonb) IS NULL THEN 'migration_login_required' END);
    v_zalo_created := v_zalo_created+1;
  END LOOP;
  PERFORM set_config('aka_agent.sql_migration_org',coalesce(v_previous_ctx,''),true);
  UPDATE public.org_organization SET staff_admin_id=v_admin,sql_account_id=v_sql_id,
    max_staff=coalesce((a->>'max_staff')::int,(SELECT max(max_staff) FROM public.org_organization_product
      WHERE organization_id=v_org AND NOT coalesce(is_deleted,false))),updated_at=now() WHERE id=v_org;
  RETURN jsonb_build_object('organization_id',v_org,'customer_id',v_customer,'already_migrated',false,
    'counts',jsonb_build_object('staff_created',v_staff_created,'staff_reused',v_staff_reused,
      'groups_created',v_groups_created,'memberships_created',v_memberships_created,
      'products_created',v_products_created,'products_updated',v_products_updated,'zalo_accounts_created',v_zalo_created),
    'products',v_products,'skipped_products',coalesce(p->'skipped_products','[]'::jsonb),'skipped_staff',coalesce(p->'skipped_staff','[]'::jsonb),
    'skipped_shops',coalesce(p->'skipped_shops','[]'::jsonb),'adjustments',coalesce(p->'adjustments','[]'::jsonb));
END;
$function$;
ALTER FUNCTION public.akabiz_migrate_sql_account_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.akabiz_migrate_sql_account_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akabiz_migrate_sql_account_v1(jsonb) TO service_role;

-- Existing trigger owner/ACL/config are retained by CREATE OR REPLACE.
COMMENT ON FUNCTION public.akabiz_migrate_sql_account_v1(jsonb) IS
  'Backend-only atomic akaBiz SQL Account migration; no email; completion marker on org_organization.sql_account_id.';
NOTIFY pgrst, 'reload schema';
COMMIT;
