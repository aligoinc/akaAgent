-- Make scan datasets and Data Group origins semantic by default, repair the
-- authoritative contact platform, and backfill only relationships that are
-- still provable from current Zalo group membership rows.

BEGIN;

DO $preflight$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)'
  );
  v_checksum text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_config text[];
  v_acl text;
  v_trigger_enabled "char";
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_finalize_contact_dataset_core_rpc';
  END IF;

  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)),
    pg_catalog.pg_get_userbyid(fn.proowner),
    fn.prosecdef,
    fn.provolatile,
    fn.proconfig,
    fn.proacl::text
  INTO
    v_checksum,
    v_owner,
    v_security_definer,
    v_volatility,
    v_config,
    v_acl
  FROM pg_catalog.pg_proc AS fn
  WHERE fn.oid = v_signature;

  IF v_checksum NOT IN (
    '8bceea12f160d767a6fa2c6799c18ee3',
    'fbf9566fb1e5e7d346980abf33362fba'
  ) THEN
    RAISE EXCEPTION 'unexpected_finalize_contact_dataset_core_checksum:%', v_checksum;
  END IF;
  IF v_owner <> 'postgres'
    OR NOT v_security_definer
    OR v_volatility <> 'v'
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_acl <> '{postgres=X/postgres,service_role=X/postgres}'
  THEN
    RAISE EXCEPTION
      'unexpected_finalize_contact_dataset_core_metadata owner=% secdef=% volatility=% config=% acl=%',
      v_owner, v_security_definer, v_volatility, v_config, v_acl;
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_derive_dataset_data_type(text,text,text,text,jsonb)'
  ) IS NULL
    OR pg_catalog.to_regprocedure(
      'public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text,bigint)'
    ) IS NULL
    OR pg_catalog.to_regprocedure(
      'public.aka_agent_membership_semantic_type(bigint)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'missing_data_group_semantic_dependency';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_stamp_account_contact_platform()'
  ) IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = pg_catalog.to_regprocedure(
      'public.aka_agent_stamp_account_contact_platform()'
    )
      AND pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)) =
        '6559974e86d24c818b2b1b1326184dc7'
      AND pg_catalog.pg_get_userbyid(fn.proowner) = 'postgres'
      AND fn.prosecdef
      AND fn.provolatile = 'v'
      AND fn.proconfig IS NOT DISTINCT FROM
        ARRAY['search_path=pg_catalog, public']::text[]
      AND fn.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'unexpected_existing_account_contact_platform_trigger_function';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.auto_account_contacts'::regclass
      AND trigger_row.tgname = 'trg_aka_agent_stamp_account_contact_platform'
      AND NOT trigger_row.tgisinternal
      AND (
        trigger_row.tgenabled IS DISTINCT FROM 'O'::"char"
        OR trigger_row.tgfoid IS DISTINCT FROM pg_catalog.to_regprocedure(
          'public.aka_agent_stamp_account_contact_platform()'
        )::oid
      )
  ) THEN
    RAISE EXCEPTION 'unexpected_account_contact_platform_trigger_definition';
  END IF;

  SELECT trigger_row.tgenabled
  INTO v_trigger_enabled
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.auto_account_contacts_dataset'::regclass
    AND trigger_row.tgname = 'trg_aka_agent_ensure_dataset_auto_data_group'
    AND NOT trigger_row.tgisinternal;
  IF v_trigger_enabled IS DISTINCT FROM 'O'::"char" THEN
    RAISE EXCEPTION 'unexpected_dataset_auto_group_trigger_state:%', v_trigger_enabled;
  END IF;

  IF EXISTS (
    WITH candidates AS (
      SELECT
        dataset.id AS dataset_id,
        dataset.auto_data_group_id,
        dataset.staff_id,
        dataset.organization_id,
        public.aka_agent_internal_dataset_auto_group_key(
          dataset.source,
          dataset.account_id,
          dataset.flatform_type,
          dataset.contact_type,
          dataset.scan_type,
          dataset.source_key,
          public.aka_agent_derive_dataset_data_type(
            dataset.source,
            dataset.flatform_type,
            dataset.contact_type,
            dataset.scan_type,
            dataset.extra_data
          )
        ) AS next_sync_key
      FROM public.auto_account_contacts_dataset AS dataset
      WHERE dataset.source = 'scan'
        AND dataset.is_delete = false
        AND dataset.data_type_category_item_id IS NULL
        AND public.aka_agent_derive_dataset_data_type(
          dataset.source,
          dataset.flatform_type,
          dataset.contact_type,
          dataset.scan_type,
          dataset.extra_data
        ) IS NOT NULL
    )
    SELECT 1
    FROM candidates AS candidate
    JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.staff_id = candidate.staff_id
     AND contact_group.organization_id = candidate.organization_id
     AND contact_group.purpose = 'data_group'
     AND contact_group.dataset_sync_mode = 'dataset_auto'
     AND contact_group.dataset_sync_key = candidate.next_sync_key
     AND contact_group.is_delete = false
     AND contact_group.id IS DISTINCT FROM candidate.auto_data_group_id
  ) THEN
    RAISE EXCEPTION 'dataset_semantic_sync_key_collision';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_contact_dataset(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint,
  p_scan_type text,
  p_contact_type text,
  p_source_key text,
  p_name text,
  p_link text,
  p_description text,
  p_status text,
  p_contact_uids text[],
  p_extra_data jsonb,
  p_data_type_category_item_id bigint DEFAULT NULL
)
RETURNS SETOF public.auto_account_contacts_dataset
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous_context text :=
    current_setting('aka_agent.data_type_category_item_id', true);
  v_flatform_type text;
  v_effective_data_type_category_item_id bigint :=
    p_data_type_category_item_id;
BEGIN
  SELECT lower(btrim(COALESCE(account.flatform_type, '')))
  INTO v_flatform_type
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id IS NOT DISTINCT FROM p_organization_id;

  IF v_effective_data_type_category_item_id IS NULL THEN
    v_effective_data_type_category_item_id :=
      public.aka_agent_derive_dataset_data_type(
        'scan',
        v_flatform_type,
        p_contact_type,
        p_scan_type,
        COALESCE(p_extra_data, '{}'::jsonb)
      );
  END IF;
  IF v_effective_data_type_category_item_id IS NULL THEN
    RAISE EXCEPTION 'scan_data_type_unresolved';
  END IF;
  IF NOT public.aka_agent_is_data_type_category_item(
    v_effective_data_type_category_item_id, true
  ) THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    v_effective_data_type_category_item_id::text,
    true
  );
  RETURN QUERY
  SELECT *
  FROM public.aka_agent_finalize_contact_dataset_v205_internal(
    p_staff_id,
    p_organization_id,
    p_account_id,
    p_scan_type,
    p_contact_type,
    p_source_key,
    p_name,
    p_link,
    p_description,
    p_status,
    p_contact_uids,
    p_extra_data
  );
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_stamp_account_contact_platform()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_account_platform text;
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.flatform_type, '')), '') IS NOT NULL
    OR NEW.contact_type NOT IN ('person', 'group', 'page', 'page_inbox_customer')
    OR NEW.account_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT lower(btrim(COALESCE(account.flatform_type, '')))
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = NEW.account_id
    AND account.staff_id = NEW.staff_id
    AND account.organization_id IS NOT DISTINCT FROM NEW.organization_id;

  IF v_account_platform IN ('facebook', 'zalo') THEN
    NEW.flatform_type := v_account_platform;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.aka_agent_stamp_account_contact_platform()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_stamp_account_contact_platform()
  TO service_role;

DROP TRIGGER IF EXISTS trg_aka_agent_stamp_account_contact_platform
  ON public.auto_account_contacts;
CREATE TRIGGER trg_aka_agent_stamp_account_contact_platform
BEFORE INSERT OR UPDATE OF
  account_id, contact_type, flatform_type, staff_id, organization_id
ON public.auto_account_contacts
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_stamp_account_contact_platform();

-- Contact platform is authoritative for account-bound people/groups/pages.
-- Phone/email rows intentionally remain platform-neutral.
CREATE TEMP TABLE v244_contact_platform_candidates ON COMMIT DROP AS
SELECT
  contact.id AS contact_id,
  lower(btrim(account.flatform_type)) AS flatform_type
FROM public.auto_account_contacts AS contact
JOIN public.auto_accounts AS account
  ON account.id = contact.account_id
 AND account.staff_id = contact.staff_id
 AND account.organization_id IS NOT DISTINCT FROM contact.organization_id
WHERE contact.is_delete = false
  AND contact.flatform_type IS NULL
  AND contact.contact_type IN ('person', 'group', 'page', 'page_inbox_customer')
  AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'zalo');

UPDATE public.auto_account_contacts AS contact
SET flatform_type = candidate.flatform_type,
    updated_at = clock_timestamp()
FROM v244_contact_platform_candidates AS candidate
WHERE contact.id = candidate.contact_id
  AND contact.flatform_type IS NULL;

CREATE TEMP TABLE v244_scan_dataset_types ON COMMIT DROP AS
SELECT
  dataset.id AS dataset_id,
  dataset.auto_data_group_id,
  public.aka_agent_derive_dataset_data_type(
    dataset.source,
    dataset.flatform_type,
    dataset.contact_type,
    dataset.scan_type,
    dataset.extra_data
  ) AS data_type_category_item_id,
  public.aka_agent_internal_dataset_auto_group_key(
    dataset.source,
    dataset.account_id,
    dataset.flatform_type,
    dataset.contact_type,
    dataset.scan_type,
    dataset.source_key,
    public.aka_agent_derive_dataset_data_type(
      dataset.source,
      dataset.flatform_type,
      dataset.contact_type,
      dataset.scan_type,
      dataset.extra_data
    )
  ) AS next_sync_key
FROM public.auto_account_contacts_dataset AS dataset
WHERE dataset.source = 'scan'
  AND dataset.is_delete = false
  AND dataset.data_type_category_item_id IS NULL
  AND public.aka_agent_derive_dataset_data_type(
    dataset.source,
    dataset.flatform_type,
    dataset.contact_type,
    dataset.scan_type,
    dataset.extra_data
  ) IS NOT NULL;

-- Updating a legacy dataset from wildcard to typed normally retires its old
-- auto group. Keep the same group identity during this one-time repair.
LOCK TABLE public.auto_account_contacts_dataset IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.auto_account_contacts_dataset
  DISABLE TRIGGER trg_aka_agent_ensure_dataset_auto_data_group;

UPDATE public.auto_account_contacts_dataset AS dataset
SET data_type_category_item_id = candidate.data_type_category_item_id,
    updated_at = clock_timestamp()
FROM v244_scan_dataset_types AS candidate
WHERE dataset.id = candidate.dataset_id
  AND dataset.data_type_category_item_id IS NULL;

ALTER TABLE public.auto_account_contacts_dataset
  ENABLE TRIGGER trg_aka_agent_ensure_dataset_auto_data_group;

-- Dataset-owned origins inherit the now authoritative dataset semantic type.
UPDATE public.auto_account_contact_group_member_origins AS origin
SET data_type_category_item_id = dataset.data_type_category_item_id,
    updated_at = clock_timestamp()
FROM public.auto_account_contacts_dataset AS dataset
WHERE dataset.id = origin.dataset_id
  AND origin.data_type_category_item_id IS NULL
  AND dataset.data_type_category_item_id IS NOT NULL;

-- Old DataScan's direct-to-group path did not retain dataset_id. Infer only
-- scan origins from their account-bound contact and platform.
WITH inferred AS (
  SELECT
    origin.id,
    public.aka_agent_derive_dataset_data_type(
      'scan',
      contact.flatform_type,
      contact.contact_type,
      COALESCE(
        NULLIF(btrim(contact.extra_data ->> 'source'), ''),
        NULLIF(btrim(contact.extra_data ->> 'scanType'), '')
      ),
      COALESCE(contact.extra_data, '{}'::jsonb)
    ) AS data_type_category_item_id
  FROM public.auto_account_contact_group_member_origins AS origin
  JOIN public.auto_account_contact_group_members AS member
    ON member.id = origin.membership_id
  JOIN public.auto_account_contacts AS contact
    ON contact.id = member.contact_id
  WHERE origin.kind = 'scan'
    AND origin.is_current = true
    AND origin.data_type_category_item_id IS NULL
    AND member.is_delete = false
    AND contact.is_delete = false
)
UPDATE public.auto_account_contact_group_member_origins AS origin
SET data_type_category_item_id = inferred.data_type_category_item_id,
    updated_at = clock_timestamp()
FROM inferred
WHERE origin.id = inferred.id
  AND inferred.data_type_category_item_id IS NOT NULL;

-- Type dataset-owned groups in place only when every owned dataset and every
-- current origin agrees. Manual wildcard groups remain intentionally wildcard.
WITH uniform_dataset_groups AS (
  SELECT
    contact_group.id AS group_id,
    min(dataset.data_type_category_item_id) AS data_type_category_item_id,
    min(public.aka_agent_internal_dataset_auto_group_key(
      dataset.source,
      dataset.account_id,
      dataset.flatform_type,
      dataset.contact_type,
      dataset.scan_type,
      dataset.source_key,
      dataset.data_type_category_item_id
    )) AS next_sync_key
  FROM public.auto_account_contact_groups AS contact_group
  JOIN public.auto_account_contacts_dataset AS dataset
    ON dataset.auto_data_group_id = contact_group.id
   AND dataset.group_id IS NULL
   AND dataset.is_delete = false
  WHERE contact_group.purpose = 'data_group'
    AND contact_group.dataset_sync_mode = 'dataset_auto'
    AND contact_group.is_delete = false
    AND contact_group.data_type_category_item_id IS NULL
  GROUP BY contact_group.id
  HAVING count(*) = count(dataset.data_type_category_item_id)
     AND count(DISTINCT dataset.data_type_category_item_id) = 1
     AND count(DISTINCT public.aka_agent_internal_dataset_auto_group_key(
       dataset.source,
       dataset.account_id,
       dataset.flatform_type,
       dataset.contact_type,
       dataset.scan_type,
       dataset.source_key,
       dataset.data_type_category_item_id
     )) = 1
), safe_groups AS (
  SELECT candidate.*
  FROM uniform_dataset_groups AS candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = candidate.group_id
      AND member.is_delete = false
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = member.id
            AND origin.is_current = true
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = member.id
            AND origin.is_current = true
            AND origin.data_type_category_item_id IS DISTINCT FROM
              candidate.data_type_category_item_id
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_data_group_sources AS source
    JOIN public.auto_campaigns AS campaign ON campaign.id = source.campaign_id
    WHERE source.group_id = candidate.group_id
      AND source.status IN ('baselining', 'active')
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_action_data_types AS mapping
        WHERE mapping.campaign_action_id = campaign.action_id
          AND mapping.data_type_category_item_id = candidate.data_type_category_item_id
          AND mapping.can_target = true
          AND mapping.is_active = true
          AND mapping.is_delete = false
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.auto_automation AS automation
    WHERE automation.target_data_group_id = candidate.group_id
      AND automation.is_active = true
      AND automation.is_delete = false
      AND automation.data_type_category_item_id IS DISTINCT FROM
        candidate.data_type_category_item_id
  )
)
UPDATE public.auto_account_contact_groups AS contact_group
SET data_type_category_item_id = safe_group.data_type_category_item_id,
    dataset_sync_key = safe_group.next_sync_key,
    updated_at = clock_timestamp()
FROM safe_groups AS safe_group
WHERE contact_group.id = safe_group.group_id;

-- Set one relationship proof per membership/account. Multiple historical scan
-- origins may point at the same proof, so updating all would violate the
-- current-origin uniqueness contract.
WITH proven_origins AS (
  SELECT
    origin.id,
    member.id AS membership_id,
    contact.account_id,
    row_number() OVER (
      PARTITION BY member.id, contact.account_id
      ORDER BY (member.primary_origin_id = origin.id) DESC,
               origin.created_at DESC,
               origin.id DESC
    ) AS proof_rank
  FROM public.auto_account_contact_group_member_origins AS origin
  JOIN public.auto_account_contact_group_members AS member
    ON member.id = origin.membership_id
  JOIN public.auto_account_contacts AS contact
    ON contact.id = member.contact_id
  WHERE origin.kind = 'scan'
    AND origin.is_current = true
    AND origin.relationship_kind IS NULL
    AND member.is_delete = false
    AND contact.is_delete = false
    AND contact.flatform_type = 'zalo'
    AND contact.contact_type = 'person'
    AND NULLIF(btrim(COALESCE(contact.uid, '')), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.zalo_group_members AS relation
      WHERE relation.account_id = contact.account_id
        AND relation.staff_id = contact.staff_id
        AND relation.organization_id IS NOT DISTINCT FROM contact.organization_id
        AND relation.zalo_uid = contact.uid
        AND relation.is_current = true
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_member_origins AS existing_origin
      WHERE existing_origin.membership_id = member.id
        AND existing_origin.source_account_id = contact.account_id
        AND existing_origin.relationship_kind = 'zalo_group_members'
        AND existing_origin.is_current = true
    )
)
UPDATE public.auto_account_contact_group_member_origins AS origin
SET source_account_id = proven.account_id,
    relationship_kind = 'zalo_group_members',
    updated_at = clock_timestamp()
FROM proven_origins AS proven
WHERE origin.id = proven.id
  AND proven.proof_rank = 1;

DO $postflight$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)'
  );
  v_checksum text;
  v_trigger_enabled "char";
  v_platform_trigger_checksum text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid))
  INTO v_checksum
  FROM pg_catalog.pg_proc AS fn
  WHERE fn.oid = v_signature;

  SELECT trigger_row.tgenabled
  INTO v_trigger_enabled
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.auto_account_contacts_dataset'::regclass
    AND trigger_row.tgname = 'trg_aka_agent_ensure_dataset_auto_data_group'
    AND NOT trigger_row.tgisinternal;
  IF v_trigger_enabled IS DISTINCT FROM 'O'::"char" THEN
    RAISE EXCEPTION 'dataset_auto_group_trigger_not_restored:%', v_trigger_enabled;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.auto_account_contacts'::regclass
      AND trigger_row.tgname = 'trg_aka_agent_stamp_account_contact_platform'
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'account_contact_platform_trigger_not_enabled';
  END IF;

  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid))
  INTO v_platform_trigger_checksum
  FROM pg_catalog.pg_proc AS fn
  WHERE fn.oid = pg_catalog.to_regprocedure(
    'public.aka_agent_stamp_account_contact_platform()'
  );
  IF v_checksum <> 'fbf9566fb1e5e7d346980abf33362fba'
    OR v_platform_trigger_checksum <> '6559974e86d24c818b2b1b1326184dc7'
  THEN
    RAISE EXCEPTION
      'v244_function_postflight_failed finalize=% contact_platform=%',
      v_checksum, v_platform_trigger_checksum;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.source = 'scan'
      AND dataset.is_delete = false
      AND dataset.data_type_category_item_id IS NULL
      AND public.aka_agent_derive_dataset_data_type(
        dataset.source,
        dataset.flatform_type,
        dataset.contact_type,
        dataset.scan_type,
        dataset.extra_data
      ) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'deriveable_scan_dataset_type_backfill_incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM v244_contact_platform_candidates AS candidate
    JOIN public.auto_account_contacts AS contact ON contact.id = candidate.contact_id
    WHERE contact.flatform_type IS DISTINCT FROM candidate.flatform_type
  ) THEN
    RAISE EXCEPTION 'account_bound_contact_platform_backfill_incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
    WHERE member.is_delete = false
      AND contact.is_delete = false
      AND contact.flatform_type = 'zalo'
      AND contact.contact_type = 'person'
      AND EXISTS (
        SELECT 1
        FROM public.zalo_group_members AS relation
        WHERE relation.account_id = contact.account_id
          AND relation.staff_id = contact.staff_id
          AND relation.organization_id IS NOT DISTINCT FROM contact.organization_id
          AND relation.zalo_uid = contact.uid
          AND relation.is_current = true
      )
      AND EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS scan_origin
        WHERE scan_origin.membership_id = member.id
          AND scan_origin.kind = 'scan'
          AND scan_origin.is_current = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS proof_origin
        WHERE proof_origin.membership_id = member.id
          AND proof_origin.source_account_id = contact.account_id
          AND proof_origin.relationship_kind = 'zalo_group_members'
          AND proof_origin.is_current = true
      )
  ) THEN
    RAISE EXCEPTION 'provable_zalo_group_relationship_backfill_incomplete';
  END IF;

END;
$postflight$;

COMMENT ON FUNCTION public.aka_agent_finalize_contact_dataset(
  bigint, bigint, bigint, text, text, text, text, text, text, text,
  text[], jsonb, bigint
) IS
  'Finalizes an account scan dataset and derives a non-null semantic data type when legacy callers omit it.';
COMMENT ON FUNCTION public.aka_agent_stamp_account_contact_platform() IS
  'Stamps authoritative Facebook/Zalo platform on account-bound contacts, including writes from legacy clients.';

NOTIFY pgrst, 'reload schema';

COMMIT;
