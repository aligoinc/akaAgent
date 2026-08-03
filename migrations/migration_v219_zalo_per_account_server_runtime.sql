-- Route Zalo QR-local, Web-local and zca-js Server independently per account.
--
-- The newest effective Product 16/18 row remains the single source of Zalo
-- quota/capability truth. Web and Server are additive capabilities for new
-- binaries, while the v218 global-mode resolver/RPCs stay unchanged so old
-- binaries continue to observe Web-over-Server behavior.

BEGIN;

-- Keep legacy product data honest before adding the per-account owner. Product
-- flags outside the Zalo products indicate a bad admin write and must not be
-- silently reinterpreted as a Zalo capability.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.org_organization_product
    WHERE COALESCE(is_zalo_server, false) = true
      AND product_id IS DISTINCT FROM 16
      AND product_id IS DISTINCT FROM 18
  ) THEN
    RAISE EXCEPTION 'invalid_zalo_server_product_row';
  END IF;
END;
$preflight$;

ALTER TABLE public.org_organization_product
  DROP CONSTRAINT IF EXISTS chk_org_product_zalo_server_product16_18;
ALTER TABLE public.org_organization_product
  ADD CONSTRAINT chk_org_product_zalo_server_product16_18
  CHECK (
    NOT COALESCE(is_zalo_server, false)
    OR COALESCE(product_id IN (16, 18), false)
  ) NOT VALID;
ALTER TABLE public.org_organization_product
  VALIDATE CONSTRAINT chk_org_product_zalo_server_product16_18;

ALTER TABLE public.auto_accounts
  ADD COLUMN IF NOT EXISTS is_zalo_server boolean;

-- No static DEFAULT is intentional. A BEFORE INSERT trigger must distinguish
-- an old client that omitted the column from a new client that explicitly
-- selected QR-local (false).
ALTER TABLE public.auto_accounts
  ALTER COLUMN is_zalo_server DROP DEFAULT;

-- Existing QR rows inherit the effective v218 global owner exactly once.
-- Existing Web and non-Zalo rows are always desktop-owned.
WITH account_legacy_owners AS (
  SELECT
    account.id,
    lower(btrim(COALESCE(account.flatform_type, ''))) AS platform,
    COALESCE(account.is_zalo_show_web, false) AS is_zalo_show_web,
    COALESCE(legacy_mode.is_zalo_server, false) AS legacy_is_zalo_server
  FROM public.auto_accounts AS account
  LEFT JOIN public.org_staff AS staff
    ON staff.id = account.staff_id
  LEFT JOIN LATERAL public.resolve_organization_zalo_runtime_mode(
    COALESCE(account.organization_id, staff.organization_id)
  ) AS legacy_mode
    ON COALESCE(account.organization_id, staff.organization_id) IS NOT NULL
  WHERE account.is_zalo_server IS NULL
)
UPDATE public.auto_accounts AS account
SET is_zalo_server = (
  owner.platform = 'zalo'
  AND NOT owner.is_zalo_show_web
  AND owner.legacy_is_zalo_server
)
FROM account_legacy_owners AS owner
WHERE owner.id = account.id;

-- Defensive fallback for orphaned legacy rows without a resolvable staff/org.
UPDATE public.auto_accounts
SET is_zalo_server = false
WHERE is_zalo_server IS NULL;

CREATE OR REPLACE FUNCTION public.normalize_legacy_zalo_account_server_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_legacy_is_zalo_server boolean := false;
BEGIN
  -- Explicit true/false is a new-client subtype decision. Only omitted/NULL
  -- values use the legacy v218 organization-wide owner.
  IF NEW.is_zalo_server IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF lower(btrim(COALESCE(NEW.flatform_type, ''))) <> 'zalo'
    OR COALESCE(NEW.is_zalo_show_web, false)
  THEN
    NEW.is_zalo_server := false;
    RETURN NEW;
  END IF;

  v_organization_id := NEW.organization_id;
  IF v_organization_id IS NULL AND NEW.staff_id IS NOT NULL THEN
    SELECT staff.organization_id
    INTO v_organization_id
    FROM public.org_staff AS staff
    WHERE staff.id = NEW.staff_id;
  END IF;

  IF v_organization_id IS NOT NULL THEN
    SELECT COALESCE(mode.is_zalo_server, false)
    INTO v_legacy_is_zalo_server
    FROM public.resolve_organization_zalo_runtime_mode(v_organization_id) AS mode;
  END IF;

  NEW.is_zalo_server := COALESCE(v_legacy_is_zalo_server, false);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_legacy_zalo_account_server_owner
  ON public.auto_accounts;
CREATE TRIGGER trg_normalize_legacy_zalo_account_server_owner
BEFORE INSERT ON public.auto_accounts
FOR EACH ROW
EXECUTE FUNCTION public.normalize_legacy_zalo_account_server_owner();

ALTER TABLE public.auto_accounts
  ALTER COLUMN is_zalo_server SET NOT NULL;

ALTER TABLE public.auto_accounts
  DROP CONSTRAINT IF EXISTS chk_auto_accounts_zalo_server_platform;
ALTER TABLE public.auto_accounts
  ADD CONSTRAINT chk_auto_accounts_zalo_server_platform
  CHECK (
    NOT is_zalo_server
    OR lower(btrim(COALESCE(flatform_type, ''))) = 'zalo'
  ) NOT VALID;
ALTER TABLE public.auto_accounts
  VALIDATE CONSTRAINT chk_auto_accounts_zalo_server_platform;

ALTER TABLE public.auto_accounts
  DROP CONSTRAINT IF EXISTS chk_auto_accounts_zalo_runtime_subtype;
ALTER TABLE public.auto_accounts
  ADD CONSTRAINT chk_auto_accounts_zalo_runtime_subtype
  CHECK (NOT (is_zalo_show_web AND is_zalo_server)) NOT VALID;
ALTER TABLE public.auto_accounts
  VALIDATE CONSTRAINT chk_auto_accounts_zalo_runtime_subtype;

CREATE INDEX IF NOT EXISTS idx_auto_accounts_zalo_runtime_owner
  ON public.auto_accounts (staff_id, is_zalo_server, is_zalo_show_web, id)
  WHERE lower(btrim(COALESCE(flatform_type, ''))) = 'zalo'
    AND COALESCE(is_delete, false) = false;

COMMENT ON COLUMN public.auto_accounts.is_zalo_server IS
  'Per-account Zalo owner. False/false is QR-local, true/false is Web-local, and false/true is zca-js Server (is_zalo_show_web/is_zalo_server). No static default: legacy omitted inserts inherit the v218 global owner in a BEFORE INSERT trigger.';
COMMENT ON COLUMN public.org_organization_product.is_zalo_server IS
  'Products 16 and 18 only. On the newest effective Zalo row, true additively grants Server-account capability even when Web capability is also granted.';

-- New binaries use this additive resolver. Do not replace or delegate the
-- legacy resolve_organization_zalo_runtime_mode(): old binaries intentionally
-- keep its Web-over-Server global-mode result.
CREATE OR REPLACE FUNCTION public.resolve_organization_zalo_account_capabilities(
  p_organization_id bigint
)
RETURNS TABLE(
  entitlement_id bigint,
  product_id bigint,
  product_name text,
  package_name text,
  package_type text,
  expiration_date timestamptz,
  max_sends_per_day integer,
  max_accounts integer,
  created_at timestamptz,
  qr_enabled boolean,
  web_enabled boolean,
  server_enabled boolean,
  capability_revision text
)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
  WITH selected AS (
    SELECT
      entitlement.id,
      entitlement.product_id,
      entitlement.product_name,
      entitlement.package_name,
      entitlement.package_type,
      entitlement.expiration_date,
      entitlement.max_sends_per_day,
      entitlement.max_accounts,
      entitlement.created_at,
      entitlement.xmin::text AS entitlement_xmin,
      COALESCE(entitlement.is_zalo_show_web, false) AS grants_web,
      COALESCE(entitlement.is_zalo_server, false) AS grants_server
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.organization_id = p_organization_id
      AND entitlement.product_id IN (16, 18)
      AND entitlement.is_deleted = false
      AND entitlement.expiration_date IS NOT NULL
      AND entitlement.expiration_date >= (
        date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
          AT TIME ZONE 'Asia/Ho_Chi_Minh'
      )
    ORDER BY
      entitlement.created_at DESC NULLS LAST,
      entitlement.id DESC
    LIMIT 1
  )
  SELECT
    selected.id,
    selected.product_id,
    selected.product_name,
    selected.package_name,
    selected.package_type,
    selected.expiration_date,
    CASE
      WHEN selected.id IS NULL THEN NULL
      WHEN selected.max_sends_per_day > 0 THEN selected.max_sends_per_day
      WHEN lower(btrim(COALESCE(selected.package_type, ''))) = 'demo' THEN 30
      ELSE NULL
    END AS max_sends_per_day,
    selected.max_accounts,
    selected.created_at,
    selected.id IS NOT NULL AS qr_enabled,
    selected.id IS NOT NULL AND selected.grants_web AS web_enabled,
    selected.id IS NOT NULL AND selected.grants_server AS server_enabled,
    CASE
      WHEN selected.id IS NULL THEN 'none:' || p_organization_id::text
      ELSE selected.id::text || ':' || selected.entitlement_xmin
    END AS capability_revision
  FROM (VALUES (1)) AS singleton(seed)
  LEFT JOIN selected ON true;
$function$;

-- Serialize every path that adds a live Zalo row to the shared quota and
-- revalidate the destination subtype from the live selected Product 16/18
-- row. This closes the desktop direct-insert race with control-web creation;
-- cached AuthUser limits remain only an early, user-friendly preflight.
CREATE OR REPLACE FUNCTION public.enforce_zalo_account_capability_and_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_new_platform text := lower(btrim(COALESCE(NEW.flatform_type, '')));
  v_old_platform text := CASE
    WHEN TG_OP = 'UPDATE' THEN lower(btrim(COALESCE(OLD.flatform_type, '')))
    ELSE ''
  END;
  v_staff_organization_id bigint;
  v_organization_id bigint;
  v_capabilities record;
  v_account_count integer := 0;
  v_requires_capability_check boolean := false;
  v_requires_quota_check boolean := false;
  v_is_existing_subtype_change boolean := false;
  v_is_claimed_subtype_cas boolean := false;
BEGIN
  IF v_new_platform <> 'zalo' OR COALESCE(NEW.is_delete, false) THEN
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
    v_requires_quota_check := v_old_platform <> 'zalo'
      OR COALESCE(OLD.is_delete, false)
      OR OLD.staff_id IS DISTINCT FROM NEW.staff_id;
  END IF;

  IF NOT v_requires_capability_check AND NOT v_requires_quota_check THEN
    RETURN NEW;
  END IF;

  -- v219 subtype ownership is changed only by the tokenized claim/CAS/release
  -- protocol. Reject legacy or raw same-row subtype writes before taking a
  -- staff lock: besides enforcing the ownership invariant, this prevents an
  -- old non-token claim from forming account -> staff against recovery's
  -- staff -> account order. Existing binaries keep running their current
  -- subtype; an attempted subtype edit fails closed and their release restores
  -- the previous account status.
  IF v_is_existing_subtype_change AND NOT v_is_claimed_subtype_cas THEN
    RAISE EXCEPTION 'zalo_account_subtype_change_claim_required';
  END IF;

  IF v_is_claimed_subtype_cas THEN
    -- PostgreSQL has already locked the account tuple before entering this
    -- row trigger. Recovery deliberately locks staff -> account, so taking a
    -- staff row lock here would invert that order and can deadlock a direct
    -- subtype CAS. This narrow branch requires the unchanged tokenized claim
    -- and running state; that claim already excluded running child work, while
    -- the account CAS prevents recovery from committing a stale owner. The
    -- statement-snapshot read validates unchanged staff/org, and the entitlement
    -- advisory lock below still serializes/revalidates live capability.
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
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  IF v_requires_capability_check AND (
    NOT COALESCE(v_capabilities.qr_enabled, false)
    OR (
      COALESCE(NEW.is_zalo_show_web, false)
      AND NOT COALESCE(v_capabilities.web_enabled, false)
    )
    OR (
      COALESCE(NEW.is_zalo_server, false)
      AND NOT COALESCE(v_capabilities.server_enabled, false)
    )
  ) THEN
    RAISE EXCEPTION 'zalo_account_capability_unavailable';
  END IF;

  IF v_requires_quota_check THEN
    -- Use the same lock key as create_control_zalo_account_atomic(). Advisory
    -- locks are transaction-reentrant, so the RPC and this trigger compose.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('control-zalo-account:' || NEW.staff_id::text, 0)
    );
    SELECT count(*)::integer
    INTO v_account_count
    FROM public.auto_accounts AS account
    WHERE account.staff_id = NEW.staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND COALESCE(account.is_delete, false) = false;

    IF v_capabilities.max_accounts IS NOT NULL
      AND v_capabilities.max_accounts > 0
      AND v_account_count >= v_capabilities.max_accounts
    THEN
      RAISE EXCEPTION 'zalo_account_limit_reached';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_zalo_account_capability_and_quota
  ON public.auto_accounts;
CREATE TRIGGER trg_validate_zalo_account_capability_and_quota
BEFORE INSERT OR UPDATE OF
  flatform_type,
  is_zalo_show_web,
  is_zalo_server,
  is_delete,
  staff_id,
  organization_id
ON public.auto_accounts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_zalo_account_capability_and_quota();

REVOKE ALL ON FUNCTION public.enforce_zalo_account_capability_and_quota()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_staff_zalo_account_capabilities(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_capabilities record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.is_active = true;

  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'organization_id', v_organization_id,
    'entitlement_id', v_capabilities.entitlement_id,
    'product_id', v_capabilities.product_id,
    'product_name', v_capabilities.product_name,
    'package_name', v_capabilities.package_name,
    'package_type', v_capabilities.package_type,
    'expiration_date', v_capabilities.expiration_date,
    'max_sends_per_day', v_capabilities.max_sends_per_day,
    'max_accounts', v_capabilities.max_accounts,
    'created_at', v_capabilities.created_at,
    'zalo_qr_enabled', COALESCE(v_capabilities.qr_enabled, false),
    'zalo_web_enabled', COALESCE(v_capabilities.web_enabled, false),
    'zalo_server_enabled', COALESCE(v_capabilities.server_enabled, false),
    'revision', COALESCE(
      v_capabilities.capability_revision,
      'none:' || v_organization_id::text
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.discover_zalo_server_account_runtime_users(
  p_after_staff_id bigint DEFAULT 0,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $function$
DECLARE
  v_page_size integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_result jsonb;
BEGIN
  IF p_after_staff_id IS NULL OR p_after_staff_id < 0 THEN
    RAISE EXCEPTION 'After staff ID must be zero or greater';
  END IF;

  WITH organization_capabilities AS (
    SELECT capabilities.*, organizations.organization_id
    FROM (
      SELECT DISTINCT entitlement.organization_id
      FROM public.org_organization_product AS entitlement
      WHERE entitlement.product_id IN (16, 18)
        AND entitlement.is_deleted = false
        AND entitlement.expiration_date IS NOT NULL
        AND entitlement.expiration_date >= (
          date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
            AT TIME ZONE 'Asia/Ho_Chi_Minh'
        )
    ) AS organizations
    CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(
      organizations.organization_id
    ) AS capabilities
    WHERE capabilities.qr_enabled = true
      AND capabilities.server_enabled = true
  ),
  page_candidates AS (
    SELECT
      staff.id AS staff_id,
      staff.organization_id,
      staff.name AS staff_name,
      staff.phone AS staff_phone,
      staff.username,
      COALESCE(staff.is_admin_akabiz, false) AS is_admin_akabiz,
      COALESCE(staff.use_test_workflow, false) AS use_test_workflow,
      organization.name AS organization_name,
      capabilities.entitlement_id,
      capabilities.capability_revision AS mode_revision,
      capabilities.product_id,
      capabilities.product_name,
      capabilities.package_name,
      capabilities.package_type,
      capabilities.expiration_date,
      capabilities.max_sends_per_day,
      capabilities.max_accounts,
      capabilities.created_at,
      capabilities.qr_enabled,
      capabilities.web_enabled,
      capabilities.server_enabled
    FROM organization_capabilities AS capabilities
    JOIN public.org_staff AS staff
      ON staff.organization_id = capabilities.organization_id
    JOIN public.org_organization AS organization
      ON organization.id = staff.organization_id
    WHERE staff.is_active = true
      AND staff.id > p_after_staff_id
    ORDER BY staff.id ASC
    LIMIT v_page_size + 1
  ),
  page_items AS (
    SELECT candidate.*
    FROM page_candidates AS candidate
    ORDER BY candidate.staff_id ASC
    LIMIT v_page_size
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'staff_id', item.staff_id,
          'organization_id', item.organization_id,
          'staff_name', item.staff_name,
          'staff_phone', item.staff_phone,
          'username', item.username,
          'is_admin_akabiz', item.is_admin_akabiz,
          'use_test_workflow', item.use_test_workflow,
          'organization_name', item.organization_name,
          'entitlement_id', item.entitlement_id,
          'mode_revision', item.mode_revision,
          'product_id', item.product_id,
          'product_name', item.product_name,
          'package_name', item.package_name,
          'package_type', item.package_type,
          'expiration_date', item.expiration_date,
          'max_sends_per_day', item.max_sends_per_day,
          'max_accounts', item.max_accounts,
          'created_at', item.created_at,
          'zalo_qr_enabled', item.qr_enabled,
          'zalo_web_enabled', item.web_enabled,
          'zalo_server_enabled', item.server_enabled
        ) ORDER BY item.staff_id ASC
      ) FROM page_items AS item
    ), '[]'::jsonb),
    'next_after_staff_id', CASE
      WHEN (SELECT count(*) FROM page_candidates) > v_page_size
        THEN (SELECT max(item.staff_id) FROM page_items AS item)
      ELSE NULL
    END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recover_server_zalo_running_state(
  p_staff_id bigint,
  p_expected_mode_revision text DEFAULT NULL,
  p_require_server_mode boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
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
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;

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

CREATE OR REPLACE FUNCTION public.aka_agent_authenticate_control_session(
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_session public.auto_control_sessions%ROWTYPE;
  v_staff public.org_staff%ROWTYPE;
  v_organization public.org_organization%ROWTYPE;
  v_zalo_package public.org_organization_product%ROWTYPE;
  v_sms_package public.org_organization_product%ROWTYPE;
  v_zalo_capabilities record;
  v_zalo_qr_enabled boolean := false;
  v_zalo_web_enabled boolean := false;
  v_zalo_server_enabled boolean := false;
  v_sms_enabled boolean := false;
  v_now timestamptz := now();
  v_vietnam_day_start timestamptz := (
    date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
BEGIN
  SELECT session.* INTO v_session
  FROM public.auto_control_sessions AS session
  WHERE session.token_hash = p_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > v_now
  LIMIT 1;
  IF v_session.id IS NULL THEN RETURN jsonb_build_object('status', 'invalid_session'); END IF;

  SELECT staff.* INTO v_staff
  FROM public.org_staff AS staff
  WHERE staff.id = v_session.staff_id
  LIMIT 1;
  IF v_staff.id IS NULL
    OR v_staff.is_active IS DISTINCT FROM true
    OR v_staff.organization_id IS DISTINCT FROM v_session.organization_id
  THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_staff');
  END IF;

  SELECT organization.* INTO v_organization
  FROM public.org_organization AS organization
  WHERE organization.id = v_staff.organization_id
  LIMIT 1;
  IF v_organization.id IS NULL THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'invalid_organization');
  END IF;

  SELECT * INTO v_zalo_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_staff.organization_id);
  IF v_zalo_capabilities.entitlement_id IS NOT NULL THEN
    SELECT entitlement.* INTO v_zalo_package
    FROM public.org_organization_product AS entitlement
    WHERE entitlement.id = v_zalo_capabilities.entitlement_id;
  END IF;

  SELECT entitlement.* INTO v_sms_package
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_staff.organization_id
    AND entitlement.is_deleted = false
    AND entitlement.product_id = 17
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_zalo_qr_enabled := COALESCE(v_zalo_capabilities.qr_enabled, false);
  v_zalo_web_enabled := COALESCE(v_zalo_capabilities.web_enabled, false);
  v_zalo_server_enabled := v_zalo_qr_enabled
    AND COALESCE(v_zalo_capabilities.server_enabled, false);
  v_sms_enabled := v_sms_package.id IS NOT NULL;

  IF NOT v_zalo_server_enabled AND NOT v_sms_enabled THEN
    UPDATE public.auto_control_sessions SET revoked_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
    RETURN jsonb_build_object('status', 'capability_unavailable');
  END IF;
  IF v_session.last_seen_at <= v_now - interval '5 minutes' THEN
    UPDATE public.auto_control_sessions SET last_seen_at = v_now
    WHERE id = v_session.id AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', 'authenticated',
    'session', jsonb_build_object(
      'id', v_session.id, 'staff_id', v_session.staff_id,
      'organization_id', v_session.organization_id,
      'client_type', v_session.client_type, 'user_agent', v_session.user_agent,
      'created_at', v_session.created_at, 'last_seen_at', v_session.last_seen_at,
      'expires_at', v_session.expires_at, 'revoked_at', v_session.revoked_at
    ),
    'staff', jsonb_build_object(
      'id', v_staff.id, 'organization_id', v_staff.organization_id,
      'name', v_staff.name, 'username', v_staff.username,
      'phone', v_staff.phone, 'email', v_staff.email,
      'is_active', v_staff.is_active, 'is_zalo_server', v_zalo_server_enabled
    ),
    'organization', jsonb_build_object('id', v_organization.id, 'name', v_organization.name),
    'capabilities', jsonb_build_object(
      'zalo_qr', v_zalo_qr_enabled,
      'zalo_web', v_zalo_web_enabled,
      'zalo_server', v_zalo_server_enabled,
      'sms', v_sms_enabled
    ),
    'zalo_account_capabilities', jsonb_build_object(
      'qr', v_zalo_qr_enabled,
      'web', v_zalo_web_enabled,
      'server', v_zalo_server_enabled,
      'revision', v_zalo_capabilities.capability_revision
    ),
    'zalo_package', CASE WHEN v_zalo_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_zalo_package.id,
      'product_id', v_zalo_package.product_id,
      'product_package_id', v_zalo_package.product_package_id,
      'product_name', v_zalo_package.product_name,
      'package_name', v_zalo_package.package_name,
      'max_accounts', v_zalo_capabilities.max_accounts,
      'max_staff', v_zalo_package.max_staff,
      'max_sends_per_day', v_zalo_capabilities.max_sends_per_day,
      'expiration_date', v_zalo_package.expiration_date,
      'created_at', v_zalo_package.created_at,
      'capability_revision', v_zalo_capabilities.capability_revision
    ) END,
    'sms_package', CASE WHEN v_sms_package.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_sms_package.id,
      'product_id', v_sms_package.product_id,
      'product_package_id', v_sms_package.product_package_id,
      'product_name', v_sms_package.product_name,
      'package_name', v_sms_package.package_name,
      'max_accounts', v_sms_package.max_accounts,
      'max_staff', v_sms_package.max_staff,
      'max_sends_per_day', v_sms_package.max_sends_per_day,
      'expiration_date', v_sms_package.expiration_date,
      'created_at', v_sms_package.created_at
    ) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses(
  p_staff_id bigint,
  p_exclude_zalo boolean DEFAULT false,
  p_zalo_uncertain_no_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_accounts_reset integer := 0;
  v_campaigns_reset integer := 0;
  v_campaign_notes_reset integer := 0;
  v_campaign_inputs_reset integer := 0;
  v_campaign_input_data_reset integer := 0;
  v_exclude_zalo boolean := COALESCE(p_exclude_zalo, false);
  v_zalo_uncertain_no_retry boolean := COALESCE(p_zalo_uncertain_no_retry, false);
  v_handoff_note constant text := 'Dừng do thay đổi chế độ runtime, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_campaign_id bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  -- Acquire every campaign/input barrier in one deterministic pass before the
  -- bulk child updates below. This is the same superset used by the no-retry
  -- wrapper, so the wrapper can safely delegate back into this function.
  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.action_id <> 'sms_send'
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
      AND COALESCE(account.is_delete, false) = false
      AND (
        lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
        OR COALESCE(account.is_zalo_server, false) = false
      )
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

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE input_data.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_reset = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET
    status = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN 'hoàn thành' ELSE 'chờ xử lý' END,
    note = CASE
      WHEN v_zalo_uncertain_no_retry
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      THEN v_handoff_note ELSE campaign_input.note END
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_reset = ROW_COUNT;

  SELECT count(*)::integer INTO v_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON campaign.account_id = account.id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    );

  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id <> 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    );
  GET DIAGNOSTICS v_campaigns_reset = ROW_COUNT;

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
    AND COALESCE(account.is_delete, false) = false
    AND (
      lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
      OR COALESCE(account.is_zalo_server, false) = false
    )
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_accounts_reset = ROW_COUNT;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'exclude_zalo', v_exclude_zalo,
    'zalo_uncertain_no_retry', v_zalo_uncertain_no_retry,
    'accounts_reset', v_accounts_reset,
    'campaigns_reset', v_campaigns_reset,
    'campaign_notes_reset', v_campaign_notes_reset,
    'campaign_inputs_reset', v_campaign_inputs_reset,
    'campaign_input_data_reset', v_campaign_input_data_reset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_control_zalo_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_max_accounts integer,
  p_account jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_account_id bigint;
  v_account_count integer := 0;
  v_account_group_id bigint := NULLIF(p_account->>'accountGroupId', '')::bigint;
  v_proxy_id bigint := NULLIF(p_account->>'proxyId', '')::bigint;
  v_capabilities record;
  v_resource_local_count integer := 0;
  v_resource_server_count integer := 0;
  v_resource_lock_key bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR jsonb_typeof(COALESCE(p_account, '{}'::jsonb)) <> 'object'
    OR NULLIF(btrim(COALESCE(p_account->>'name', '')), '') IS NULL
  THEN RAISE EXCEPTION 'invalid_control_zalo_account_payload'; END IF;

  PERFORM 1 FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN RAISE EXCEPTION 'inactive_control_staff'; END IF;

  -- Serialize reference validation with account assignment/subtype changes and
  -- with control-web resource mutations. Both keys are acquired in numeric
  -- order so an account carrying a group and proxy cannot deadlock another path.
  FOR v_resource_lock_key IN
    SELECT DISTINCT resource.lock_key
    FROM (
      VALUES
        (CASE WHEN v_account_group_id IS NULL THEN NULL ELSE hashtextextended(
          'control-zalo-account-group:' || v_account_group_id::text, 0
        ) END),
        (CASE WHEN v_proxy_id IS NULL THEN NULL ELSE hashtextextended(
          'control-zalo-proxy:' || v_proxy_id::text, 0
        ) END)
    ) AS resource(lock_key)
    WHERE resource.lock_key IS NOT NULL
    ORDER BY resource.lock_key
  LOOP
    PERFORM pg_advisory_xact_lock(v_resource_lock_key);
  END LOOP;

  IF v_account_group_id IS NOT NULL THEN
    PERFORM account_group.id
    FROM public.auto_account_groups AS account_group
    WHERE account_group.id = v_account_group_id
      AND account_group.staff_id = p_staff_id
      AND account_group.organization_id = p_organization_id
      AND account_group.flatform_type = 'zalo'
      AND COALESCE(account_group.is_delete, false) = false
    FOR UPDATE OF account_group;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('created', false, 'reason', 'account_group_not_found');
    END IF;

    SELECT
      count(*) FILTER (WHERE
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND NOT (
          COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )::integer,
      count(*) FILTER (WHERE
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )::integer
    INTO v_resource_local_count, v_resource_server_count
    FROM public.auto_accounts AS account
    WHERE account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.account_group_id = v_account_group_id
      AND COALESCE(account.is_delete, false) = false;

    IF v_resource_local_count > 0 AND v_resource_server_count = 0 THEN
      RETURN jsonb_build_object('created', false, 'reason', 'account_group_local_only');
    END IF;
  END IF;

  IF v_proxy_id IS NOT NULL THEN
    PERFORM proxy.id
    FROM public.auto_proxies AS proxy
    WHERE proxy.id = v_proxy_id
      AND proxy.staff_id = p_staff_id
      AND proxy.organization_id = p_organization_id
      AND COALESCE(proxy.is_delete, false) = false
    FOR UPDATE OF proxy;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('created', false, 'reason', 'proxy_not_found');
    END IF;

    SELECT
      count(*) FILTER (WHERE
        NOT (
          lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )::integer,
      count(*) FILTER (WHERE
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )::integer
    INTO v_resource_local_count, v_resource_server_count
    FROM public.auto_accounts AS account
    WHERE account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.proxy_id = v_proxy_id
      AND COALESCE(account.is_delete, false) = false;

    IF v_resource_local_count > 0 AND v_resource_server_count = 0 THEN
      RETURN jsonb_build_object('created', false, 'reason', 'proxy_local_only');
    END IF;
  END IF;

  -- Match the BEFORE-trigger chain exactly: resource locks precede entitlement
  -- validation, which precedes the shared staff quota lock. Taking entitlement
  -- first can deadlock behind a queued exclusive entitlement writer while a
  -- direct account mutation holds the resource lock and waits for entitlement.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN jsonb_build_object('created', false, 'reason', 'capability_unavailable');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('control-zalo-account:' || p_staff_id::text, 0)
  );
  SELECT count(*)::integer INTO v_account_count
  FROM public.auto_accounts AS account
  WHERE account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false;

  -- p_max_accounts remains wire-compatible; the one selected Product 16/18
  -- limit and one shared count of every non-deleted QR/Web/Server row are
  -- authoritative. Hidden/lost-capability subtypes still consume their slot.
  IF v_capabilities.max_accounts IS NOT NULL
    AND v_capabilities.max_accounts > 0
    AND v_account_count >= v_capabilities.max_accounts
  THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'account_limit_reached',
      'max_accounts', v_capabilities.max_accounts
    );
  END IF;

  -- Subtype input is deliberately ignored. This control surface is the only
  -- authoritative creator for Server accounts and always writes Server=true.
  INSERT INTO public.auto_accounts (
    name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active, account_group_id, proxy_id,
    staff_id, organization_id, is_delete
  ) VALUES (
    btrim(p_account->>'name'), 'zalo', false, true,
    'chưa đăng nhập', 'chờ xử lý',
    COALESCE((p_account->>'isActive')::boolean, true), v_account_group_id,
    v_proxy_id, p_staff_id, p_organization_id, false
  ) RETURNING id INTO v_account_id;

  RETURN jsonb_build_object('created', true, 'account_id', v_account_id);
END;
$function$;

-- Account reference/subtype changes take shared advisory locks. Control Web
-- resource mutations take the matching exclusive lock, giving a serial order
-- without locking account rows after an updater has already entered a trigger.
CREATE OR REPLACE FUNCTION public.lock_auto_account_control_resources()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_old_account_group_id bigint;
  v_old_proxy_id bigint;
  v_lock_key bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_account_group_id := OLD.account_group_id;
    v_old_proxy_id := OLD.proxy_id;
  END IF;

  FOR v_lock_key IN
    SELECT DISTINCT resource.lock_key
    FROM (
      VALUES
        (CASE WHEN v_old_account_group_id IS NULL THEN NULL ELSE hashtextextended(
          'control-zalo-account-group:' || v_old_account_group_id::text, 0
        ) END),
        (CASE WHEN NEW.account_group_id IS NULL THEN NULL ELSE hashtextextended(
          'control-zalo-account-group:' || NEW.account_group_id::text, 0
        ) END),
        (CASE WHEN v_old_proxy_id IS NULL THEN NULL ELSE hashtextextended(
          'control-zalo-proxy:' || v_old_proxy_id::text, 0
        ) END),
        (CASE WHEN NEW.proxy_id IS NULL THEN NULL ELSE hashtextextended(
          'control-zalo-proxy:' || NEW.proxy_id::text, 0
        ) END)
    ) AS resource(lock_key)
    WHERE resource.lock_key IS NOT NULL
    ORDER BY resource.lock_key
  LOOP
    PERFORM pg_advisory_xact_lock_shared(v_lock_key);
  END LOOP;

  -- A reference that waited behind a soft delete must fail rather than attach
  -- to a resource that became invisible while it was blocked on the lock.
  IF NOT COALESCE(NEW.is_delete, false)
    AND NEW.account_group_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_account_groups AS account_group
      WHERE account_group.id = NEW.account_group_id
        AND COALESCE(account_group.is_delete, false) = false
    )
  THEN
    RAISE EXCEPTION 'account_group_not_found';
  END IF;
  IF NOT COALESCE(NEW.is_delete, false)
    AND NEW.proxy_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_proxies AS proxy
      WHERE proxy.id = NEW.proxy_id
        AND COALESCE(proxy.is_delete, false) = false
    )
  THEN
    RAISE EXCEPTION 'proxy_not_found';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_auto_account_control_resources
  ON public.auto_accounts;
CREATE TRIGGER trg_lock_auto_account_control_resources
BEFORE INSERT OR UPDATE OF
  account_group_id,
  proxy_id,
  flatform_type,
  is_zalo_show_web,
  is_zalo_server,
  is_delete,
  staff_id,
  organization_id
ON public.auto_accounts
FOR EACH ROW
EXECUTE FUNCTION public.lock_auto_account_control_resources();

REVOKE ALL ON FUNCTION public.lock_auto_account_control_resources()
  FROM PUBLIC, anon, authenticated, service_role;

-- One campaign-scoped barrier lets the preserved Data Group router keep its
-- campaign -> canonical-input implementation while newer Control/Server paths
-- keep input -> campaign -> account. Every participant acquires this advisory
-- lock before its first campaign/input row lock, so the row-order difference
-- can never form a wait cycle.
CREATE OR REPLACE FUNCTION public.aka_agent_lock_campaign_input_serialization(
  p_campaign_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'campaign_input_serialization_id_invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'aka-agent-campaign-input-serialization:' || p_campaign_id::text, 0
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_lock_campaign_input_serialization(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_lock_campaign_input_serialization(bigint)
  TO anon, authenticated, service_role;

-- The legacy one-time Data Group snapshot is a Desktop surface. Keep its v206
-- public signature/retry semantics. The preserved core keeps its historical
-- batch -> group prefix, then joins the common campaign barrier before locking
-- campaign/account/input rows. Ownership is checked after the campaign lock;
-- the account SHARE lock prevents a concurrent subtype conversion from
-- changing a local account to Server during the snapshot.
DO $patch_v205_direct_snapshot_owner$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  );
  v_definition text;
  v_old_declaration text := $old$
  v_has_relationship boolean;
BEGIN
$old$;
  v_new_declaration text := $new$
  v_has_relationship boolean;
  v_account_is_server boolean;
BEGIN
$new$;
  v_old_account_guard text := $old$
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'campaign_account_not_found';
  END IF;
$old$;
  v_new_account_guard text := $new$
  -- Campaign is already locked above. Lock account second so campaign claims
  -- and subtype conversion cannot race this Desktop ownership decision.
  SELECT COALESCE(account.is_zalo_server, false)
  INTO v_account_is_server
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_account_not_found';
  END IF;
  IF v_account_is_server THEN
    RAISE EXCEPTION 'direct_campaign_runtime_not_owner';
  END IF;
$new$;
  v_old_group_barrier text := $old$
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  SELECT campaign.*
$old$;
  v_new_group_barrier text := $new$
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  -- Keep the shared Data Group hierarchy: batch -> group -> barrier ->
  -- campaign -> account/input. Bind/reactivate/router paths take the same
  -- group-before-barrier order.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.*
$new$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v206_direct_campaign_snapshot_core';
  END IF;

  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  IF strpos(v_definition, 'direct_campaign_runtime_not_owner') = 0 THEN
    IF (
      length(v_definition)
      - length(replace(v_definition, v_old_declaration, ''))
    ) <> length(v_old_declaration)
      OR (
        length(v_definition)
        - length(replace(v_definition, v_old_account_guard, ''))
      ) <> length(v_old_account_guard)
    THEN
      RAISE EXCEPTION 'unexpected_v206_direct_campaign_snapshot_shape';
    END IF;

    EXECUTE replace(
      replace(v_definition, v_old_declaration, v_new_declaration),
      v_old_account_guard,
      v_new_account_guard
    );
  END IF;

  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  IF strpos(v_definition, 'aka_agent_lock_campaign_input_serialization') = 0 THEN
    IF (
      length(v_definition)
      - length(replace(v_definition, v_old_group_barrier, ''))
    ) <> length(v_old_group_barrier)
    THEN
      RAISE EXCEPTION 'unexpected_v206_direct_campaign_group_lock_shape';
    END IF;
    EXECUTE replace(v_definition, v_old_group_barrier, v_new_group_barrier);
  END IF;

  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  IF strpos(v_definition, 'direct_campaign_runtime_not_owner') = 0
    OR strpos(v_definition, 'FOR SHARE OF account') = 0
    OR strpos(v_definition, 'aka_agent_lock_campaign_input_serialization') = 0
    OR strpos(v_definition, 'Reuse order for one-time snapshots:') = 0
    OR strpos(v_definition, 'aka_agent_data_group_membership_semantic_compatible') = 0
  THEN
    RAISE EXCEPTION 'v219_direct_campaign_snapshot_patch_verification_failed';
  END IF;
END;
$patch_v205_direct_snapshot_owner$;

CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_campaign_schedule timestamptz,
  p_campaign_status text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_action_id text;
  v_completed_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  -- Preserve the pre-v206 retry contract: a committed request returns its
  -- immutable result even if the group/account subtype changed afterward.
  -- No campaign/input mutation occurs on this branch.
  SELECT batch.result
  INTO v_completed_result
  FROM public.auto_data_ingest_batches AS batch
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = btrim(COALESCE(p_request_id, ''))
    AND batch.operation = 'snapshot_campaign'
    AND batch.group_id = p_group_id
    AND batch.result IS NOT NULL;

  IF v_completed_result IS NULL THEN
    SELECT campaign.action_id
    INTO v_action_id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = p_group_id
     AND contact_group.staff_id = p_staff_id
     AND contact_group.organization_id = p_organization_id
     AND contact_group.purpose = 'data_group'
     AND contact_group.is_delete = false
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false;

    IF v_action_id IS NOT NULL
      AND NOT public.aka_agent_data_group_type_compatible(
        p_group_id, v_action_id
      )
    THEN
      RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
    END IF;
  END IF;

  RETURN public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_campaign_id,
    p_group_id,
    p_campaign_schedule,
    p_campaign_status,
    p_auth_username,
    p_auth_password
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) IS
  'Desktop one-time Data Group snapshot; core serializes group-before-campaign, immutable retries remain idempotent, and Server-owned campaigns fail closed.';

-- v184 completes uncertain Facebook/Email children before delegating to the
-- ordinary Desktop recovery. Acquire the full delegated recovery superset in
-- one sorted pass; locking only the Facebook/Email subset first could deadlock
-- another reset that already holds a lower-ID local Zalo campaign barrier.
CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses_no_retry(
  p_staff_id bigint,
  p_exclude_zalo boolean DEFAULT false,
  p_zalo_uncertain_no_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_non_zalo_accounts_reset integer := 0;
  v_non_zalo_campaigns_reset integer := 0;
  v_non_zalo_campaign_notes_reset integer := 0;
  v_interrupted_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_campaign_id bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  -- Hold the same staff-row barrier as campaign/account claims for the entire
  -- no-retry completion + existing recovery sequence.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR UPDATE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  -- Match the delegated recovery's global order exactly:
  -- staff -> entitlement (shared) -> campaign barriers -> rows.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.action_id IS DISTINCT FROM 'sms_send'
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
      AND COALESCE(account.is_delete, false) = false
      AND (
        lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
        OR COALESCE(account.is_zalo_server, false) = false
      )
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

  UPDATE public.auto_campaign_input_data AS input_data
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

  SELECT count(*)::integer INTO v_non_zalo_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;

  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;
  GET DIAGNOSTICS v_non_zalo_campaigns_reset = ROW_COUNT;

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_non_zalo_accounts_reset = ROW_COUNT;

  v_result := public.reset_desktop_running_statuses(
    p_staff_id,
    COALESCE(p_exclude_zalo, false),
    COALESCE(p_zalo_uncertain_no_retry, false)
  );

  RETURN v_result || jsonb_build_object(
    'accounts_reset', COALESCE((v_result ->> 'accounts_reset')::integer, 0) + v_non_zalo_accounts_reset,
    'campaigns_reset', COALESCE((v_result ->> 'campaigns_reset')::integer, 0) + v_non_zalo_campaigns_reset,
    'campaign_notes_reset', COALESCE((v_result ->> 'campaign_notes_reset')::integer, 0) + v_non_zalo_campaign_notes_reset,
    'non_zalo_uncertain_no_retry', true,
    'non_zalo_campaign_inputs_completed', v_campaign_inputs_completed,
    'non_zalo_campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

COMMENT ON FUNCTION public.reset_desktop_running_statuses_no_retry(
  bigint, boolean, boolean
) IS
  'Completes uncertain non-Zalo inputs without retry after deterministically serializing every campaign the delegated Desktop recovery can touch.';
REVOKE ALL ON FUNCTION public.reset_desktop_running_statuses_no_retry(
  bigint, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_desktop_running_statuses_no_retry(
  bigint, boolean, boolean
) TO anon, authenticated, service_role;

-- v188's automation materializer intentionally locks automation -> execution
-- -> target campaign/source before it can settle a hard-ended Data Group. Keep
-- that implementation byte-for-byte and add the campaign barrier between its
-- execution lock prefix and every target campaign/input mutation.
DO $preserve_v188_materializer$
BEGIN
  IF to_regprocedure(
    'public.materialize_auto_automation_detail_v188_serialized_internal(bigint,bigint,bigint,text,jsonb,text,text)'
  ) IS NULL THEN
    IF to_regprocedure(
      'public.materialize_auto_automation_detail(bigint,bigint,bigint,text,jsonb,text,text)'
    ) IS NULL THEN
      RAISE EXCEPTION 'missing_v188_materialize_auto_automation_detail';
    END IF;
    ALTER FUNCTION public.materialize_auto_automation_detail(
      bigint, bigint, bigint, text, jsonb, text, text
    ) RENAME TO materialize_auto_automation_detail_v188_serialized_internal;
  END IF;
END;
$preserve_v188_materializer$;

REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail_v188_serialized_internal(
  bigint, bigint, bigint, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.materialize_auto_automation_detail(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_detail_id bigint,
  p_worker_id text,
  p_target_input jsonb,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_automation_id bigint;
  v_target_campaign_id bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT detail.automation_id
  INTO v_automation_id
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id;

  IF FOUND THEN
    PERFORM automation.id
    FROM public.auto_automation AS automation
    WHERE automation.id = v_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
    FOR UPDATE OF automation;

    IF FOUND THEN
      SELECT detail.target_campaign_id
      INTO v_target_campaign_id
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = p_automation_detail_id
        AND detail.automation_id = v_automation_id
        AND detail.staff_id = p_staff_id
        AND detail.organization_id = p_organization_id
      FOR UPDATE OF detail;

      IF FOUND AND v_target_campaign_id IS NOT NULL THEN
        PERFORM public.aka_agent_lock_campaign_input_serialization(
          v_target_campaign_id
        );
      END IF;
    END IF;
  END IF;

  RETURN public.materialize_auto_automation_detail_v188_serialized_internal(
    p_staff_id,
    p_organization_id,
    p_automation_detail_id,
    p_worker_id,
    p_target_input,
    p_auth_username,
    p_auth_password
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) TO anon, authenticated, service_role;

-- The shared Data Group finalizer is reached by desktop lifecycle calls and by
-- preserved ingest/router code. Join the same campaign barrier before its
-- legacy campaign -> source -> input mutation order so every caller is safe,
-- including callers that do not pass through a v219 Server wrapper.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_finalize_data_group_campaign_v219(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_has_pending boolean;
  v_has_inflight boolean;
  v_before_hard_end boolean;
  v_hard_terminal boolean;
  v_status text;
  v_reason text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT * INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.data_target_source_mode = 'data_group'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_campaign_not_found'; END IF;

  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý'
  ), EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'đang chạy'
  ) INTO v_has_pending, v_has_inflight;

  v_before_hard_end := NOT COALESCE(v_campaign.is_delete, false)
    AND (v_campaign.schedule_end_date IS NULL OR v_campaign.schedule_end_date > now());
  v_hard_terminal := COALESCE(v_campaign.is_delete, false)
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now())
    OR v_campaign.status = 'hoàn thành';

  -- Hard terminal state wins over the ordinary pending-input race. No new
  -- target may start after delete/end/explicit completion; an already-running
  -- target is allowed to finish and the next finalize call completes cleanup.
  IF v_hard_terminal THEN
    IF v_source.id IS NOT NULL AND v_source.status <> 'stopped' THEN
      UPDATE public.auto_campaign_data_group_sources
      SET status = 'stopped',
          stopped_at = COALESCE(stopped_at, now()),
          stop_reason = COALESCE(stop_reason, CASE
            WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
            WHEN v_campaign.status = 'hoàn thành' THEN 'campaign_completed'
            ELSE 'hard_end_reached'
          END),
          updated_at = now()
      WHERE id = v_source.id;
    END IF;

    UPDATE public.auto_campaign_input_data
    SET status = 'hoàn thành',
        note = COALESCE(note, CASE
          WHEN COALESCE(v_campaign.is_delete, false) THEN 'Chiến dịch đã bị xoá'
          WHEN v_campaign.status = 'hoàn thành' THEN 'Chiến dịch đã hoàn thành'
          ELSE 'Chiến dịch đã hết hạn'
        END),
        date_action = COALESCE(date_action, now())
    WHERE campaign_id = v_campaign.id
      AND COALESCE(is_delete, false) = false
      AND status = 'chờ xử lý';
    v_has_pending := false;

    IF v_has_inflight THEN
      RETURN jsonb_build_object(
        'completed', false,
        'status', v_campaign.status,
        'reason', 'terminal_input_inflight'
      );
    END IF;

    UPDATE public.auto_campaigns
    SET status = 'hoàn thành',
        note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), note),
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_campaign.id;
    RETURN jsonb_build_object(
      'completed', true,
      'status', 'hoàn thành',
      'reason', CASE
        WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
        WHEN v_campaign.status = 'hoàn thành' THEN 'campaign_completed'
        ELSE 'hard_end_reached'
      END
    );
  END IF;

  -- Durable client pause wins every finalize race.
  IF v_campaign.status = 'tạm dừng' THEN
    RETURN jsonb_build_object(
      'completed', false, 'status', v_campaign.status, 'reason', 'paused'
    );
  END IF;
  IF v_has_inflight THEN
    RETURN jsonb_build_object(
      'completed', false, 'status', v_campaign.status, 'reason', 'input_inflight'
    );
  END IF;

  IF v_has_pending THEN
    v_status := 'chờ xử lý';
    v_reason := 'pending_input_raced';
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = NULLIF(btrim(COALESCE(p_note, '')), ''),
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  ELSIF v_source.id IS NOT NULL AND v_source.status IN ('baselining', 'active')
    AND v_before_hard_end THEN
    v_status := 'chờ xử lý';
    v_reason := 'active_source_waiting';
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = 'Chờ data mới',
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  ELSE
    v_status := 'hoàn thành';
    v_reason := CASE
      WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
      WHEN NOT v_before_hard_end THEN 'hard_end_reached'
      WHEN v_source.id IS NULL THEN 'source_missing'
      ELSE 'source_stopped_and_drained'
    END;
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), note),
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  END IF;

  SELECT status INTO v_status
  FROM public.auto_campaigns
  WHERE id = v_campaign.id;
  RETURN jsonb_build_object(
    'completed', v_status = 'hoàn thành',
    'status', v_status,
    'reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_internal_finalize_data_group_campaign_v219(
  bigint, bigint, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the legacy public signature for old Desktop binaries, but make it
-- authoritative per-account and fail closed without raising when the target
-- has moved to the Server owner. Internal router/Server paths call the revoked
-- core explicitly after establishing their own ownership boundary.
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_data_group_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_campaign_status text;
  v_account_platform text;
  v_is_zalo_server boolean;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT
    campaign.status,
    lower(btrim(COALESCE(account.flatform_type, ''))),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_platform,
    v_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
   AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.data_target_source_mode = 'data_group'
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_campaign_not_found';
  END IF;

  IF v_account_platform = 'zalo' AND v_is_zalo_server THEN
    RETURN jsonb_build_object(
      'completed', false,
      'status', v_campaign_status,
      'reason', 'runtime_not_owner',
      'runtime_owner', 'server'
    );
  END IF;

  RETURN public.aka_agent_internal_finalize_data_group_campaign_v219(
    p_staff_id,
    p_organization_id,
    p_campaign_id,
    p_note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_finalize_data_group_campaign(
  bigint, bigint, bigint, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_finalize_data_group_campaign(
  bigint, bigint, bigint, text
) TO service_role;

-- The desktop sweep owns every expired Data Group campaign except a Zalo
-- account explicitly assigned to the Server runtime. Candidate discovery is
-- lock-free; each candidate joins the common barrier before authoritative
-- campaign/account locks, then delegates to the serialized legacy finalizer.
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_expired_data_group_campaigns(
  p_staff_id bigint,
  p_organization_id bigint,
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
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF v_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_expired_data_group_campaign_limit';
  END IF;

  FOR v_candidate IN
    SELECT campaign.id, campaign.schedule_end_date
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
      AND NOT (
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_server, false) = true
      )
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
    LIMIT v_limit
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_candidate.id);

    -- Recheck both hard-end eligibility and owner subtype while holding the
    -- rows. This closes a candidate-read race with per-account owner changes.
    PERFORM campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account
      ON account.id = campaign.account_id
     AND account.staff_id = campaign.staff_id
    JOIN public.auto_campaign_data_group_sources AS source
      ON source.campaign_id = campaign.id
     AND source.staff_id = p_staff_id
     AND source.organization_id = p_organization_id
    WHERE campaign.id = v_candidate.id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND campaign.data_target_source_mode = 'data_group'
      AND NOT (
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_server, false) = true
      )
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
    FOR UPDATE OF campaign, account;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

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

-- Preserve v206 semantic filtering and the v205/v190/v186 compatibility chain,
-- adding only the common barrier before the legacy core can lock campaign and
-- then insert/select its canonical input row.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member(
  p_source_id bigint,
  p_membership_id bigint,
  p_batch_id bigint,
  p_group_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_campaign_id bigint;
  v_action_id text;
  v_group_id bigint;
  v_staff_id bigint;
  v_organization_id bigint;
  v_campaign_is_delete boolean;
  v_campaign_schedule_end_date timestamptz;
BEGIN
  SELECT
    campaign.id,
    campaign.action_id,
    source.group_id,
    campaign.staff_id,
    campaign.organization_id
  INTO
    v_campaign_id,
    v_action_id,
    v_group_id,
    v_staff_id,
    v_organization_id
  FROM public.auto_campaign_data_group_sources AS source
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = source.campaign_id
  WHERE source.id = p_source_id;

  IF v_campaign_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_members AS member
      WHERE member.id = p_membership_id
        AND member.group_id = v_group_id
    )
    AND NOT public.aka_agent_data_group_membership_semantic_compatible(
      p_membership_id, v_action_id, v_group_id
    )
  THEN
    RETURN jsonb_build_object(
      'status', 'incompatible',
      'reason', 'data_group_member_semantic_type_mismatch'
    );
  END IF;

  IF v_campaign_id IS NOT NULL THEN
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);

    -- The preserved v186 core dynamically calls the legacy public finalizer
    -- after taking its campaign row. Settle the same delete/hard-end cases via
    -- the private core now, while the common barrier still precedes that row
    -- lock, and return the exact legacy route outcome without entering it.
    SELECT
      COALESCE(campaign.is_delete, false),
      campaign.schedule_end_date
    INTO
      v_campaign_is_delete,
      v_campaign_schedule_end_date
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = v_campaign_id
      AND campaign.staff_id = v_staff_id
      AND campaign.organization_id = v_organization_id
      AND campaign.data_target_source_mode = 'data_group'
    FOR UPDATE OF campaign;

    IF FOUND AND (
      v_campaign_is_delete
      OR (
        v_campaign_schedule_end_date IS NOT NULL
        AND v_campaign_schedule_end_date <= now()
      )
    ) THEN
      PERFORM public.aka_agent_internal_finalize_data_group_campaign_v219(
        v_staff_id,
        v_organization_id,
        v_campaign_id,
        CASE
          WHEN v_campaign_is_delete THEN 'Chiến dịch đã bị xoá'
          ELSE 'Chiến dịch đã hết hạn'
        END
      );
      RETURN jsonb_build_object(
        'status', 'no_intake', 'reason', 'campaign_hard_ended'
      );
    END IF;
  END IF;

  RETURN public.aka_agent_internal_route_data_group_member_v205_internal(
    p_source_id, p_membership_id, p_batch_id, p_group_revision
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member(
  bigint, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;

-- Latest definition is based on v186 (Data Group pending-input semantics),
-- with account subtype checked before any ownership-sensitive finalization.
CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_zalo boolean;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  -- Expired Server Data Group cleanup must not start from the ordinary
  -- campaign-first claim lock. Route the optimistic candidate through the
  -- Server wrapper, which revalidates ownership after locking inputs first.
  IF v_runtime_target = 'server'
    AND COALESCE(v_capabilities.qr_enabled, false)
    AND COALESCE(v_capabilities.server_enabled, false)
    AND EXISTS (
      SELECT 1
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
        AND campaign.account_id = p_account_id
        AND (
          campaign.organization_id IS NULL
          OR campaign.organization_id = v_organization_id
        )
        AND campaign.data_target_source_mode = 'data_group'
        AND campaign.schedule_end_date IS NOT NULL
        AND campaign.schedule_end_date <= now()
        AND (
          account.organization_id IS NULL
          OR account.organization_id = v_organization_id
        )
        AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
    )
  THEN
    PERFORM public.aka_agent_finalize_zalo_server_data_group_campaign(
      p_staff_id,
      v_organization_id,
      v_capabilities.capability_revision,
      p_campaign_id,
      'Chiến dịch đã hết hạn'
    );
    RETURN false;
  END IF;

  -- Desktop hard-end cleanup follows the same optimistic-before-row-lock
  -- shape. It owns non-Zalo campaigns plus Zalo accounts whose per-account
  -- owner remains desktop, and never enters the Server account branch.
  IF v_runtime_target = 'desktop'
    AND EXISTS (
      SELECT 1
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
        AND campaign.account_id = p_account_id
        AND (
          campaign.organization_id IS NULL
          OR campaign.organization_id = v_organization_id
        )
        AND campaign.data_target_source_mode = 'data_group'
        AND campaign.schedule_end_date IS NOT NULL
        AND campaign.schedule_end_date <= now()
        AND (
          account.organization_id IS NULL
          OR account.organization_id = v_organization_id
        )
        AND NOT (
          lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
          AND COALESCE(account.is_zalo_server, false) = true
        )
    )
  THEN
    PERFORM public.aka_agent_finalize_data_group_campaign(
      p_staff_id,
      v_organization_id,
      p_campaign_id,
      'Chiến dịch đã hết hạn'
    );
    RETURN false;
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    THEN RETURN false; END IF;
  ELSIF v_is_zalo AND (
    v_is_server
    OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
    OR (NOT v_is_web AND NOT v_is_server
      AND NOT COALESCE(v_capabilities.qr_enabled, false))
  ) THEN RETURN false; END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.schedule_end_date IS NOT NULL
    AND v_campaign.schedule_end_date <= now()
  THEN
    -- Expiry can race the optimistic checks above. Do not enter either
    -- finalizer after acquiring campaign/account rows; a later claim or owner
    -- sweep will start from the common campaign/input barrier instead.
    RETURN false;
  END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS NULL
    OR v_campaign.schedule > now()
    OR COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready'
    OR (
      v_campaign.data_target_source_mode = 'data_group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý'
          AND (input_data.schedule IS NULL OR input_data.schedule <= now())
      )
    )
    OR (v_campaign.daily_stop_time IS NOT NULL
      AND v_campaign.daily_stop_time < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN RETURN false; END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_requires_login boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_capabilities record;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'staff_not_active');
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = campaign_input.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign_input.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND input_data.status = 'đang chạy'
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'work_running');
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
    OR (COALESCE(p_requires_login, true) AND v_account.login_status <> 'đã đăng nhập')
    OR v_account.status NOT IN ('chờ xử lý', 'tạm dừng')
  THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_not_available');
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  IF (v_runtime_target = 'server' AND (
      v_is_web
      OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_is_server
      OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
      OR (NOT v_is_web AND NOT v_is_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false))
    ))
  THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'runtime_not_owner');
  END IF;

  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_account.status,
    'runtime_target', v_runtime_target
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_previous_status text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  -- Release is cleanup, not a new operation. Capability loss does not prevent
  -- either runtime from releasing its own subtype.
  IF (v_runtime_target = 'server' AND (v_is_web OR NOT v_is_server))
    OR (v_runtime_target = 'desktop' AND v_is_server)
  THEN RETURN false; END IF;

  UPDATE public.auto_accounts
  SET status = v_previous_status, updated_at = now()
  WHERE id = p_account_id AND status = 'đang chạy';
  RETURN FOUND;
END;
$function$;

-- Tokenized overload used by subtype conversion and other CAS-sensitive
-- account-only operations. It mirrors v184's non-Zalo claim protocol.
CREATE OR REPLACE FUNCTION public.claim_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_previous_status text,
  p_claim_token uuid,
  p_requires_login boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
  v_capabilities record;
  v_is_web boolean;
  v_is_server boolean;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'staff_not_active'
    );
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_found'
    );
  END IF;

  IF COALESCE(v_account.is_delete, false)
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  v_is_web := COALESCE(v_account.is_zalo_show_web, false);
  v_is_server := COALESCE(v_account.is_zalo_server, false);
  IF (v_runtime_target = 'server' AND (
      v_is_web
      OR NOT v_is_server
      OR NOT COALESCE(v_capabilities.qr_enabled, false)
      OR NOT COALESCE(v_capabilities.server_enabled, false)
    ))
    OR (v_runtime_target = 'desktop' AND (
      v_is_server
      OR (v_is_web AND NOT COALESCE(v_capabilities.web_enabled, false))
      OR (NOT v_is_web AND NOT v_is_server
        AND NOT COALESCE(v_capabilities.qr_enabled, false))
    ))
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'runtime_not_owner'
    );
  END IF;

  -- Retry of the same token is idempotent after an ambiguous response.
  IF v_account.status = 'đang chạy'
    AND v_account.runtime_operation_claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'account_id', p_account_id,
      'previous_status', v_previous_status,
      'claim_token', p_claim_token,
      'runtime_target', v_runtime_target
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_inputs AS campaign_input
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = campaign_input.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND campaign_input.status = 'đang chạy'
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE campaign.account_id = p_account_id
      AND campaign.staff_id = p_staff_id
      AND input_data.status = 'đang chạy'
  ) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'work_running'
    );
  END IF;

  IF v_account.status IS DISTINCT FROM v_previous_status
    OR (
      COALESCE(p_requires_login, true)
      AND (
        v_account.is_active IS NOT TRUE
        OR v_account.login_status IS DISTINCT FROM 'đã đăng nhập'
      )
    )
  THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = 'đang chạy',
    runtime_operation_claim_token = p_claim_token,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.status = v_previous_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'account_id', p_account_id,
      'reason', 'account_not_available'
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'account_id', p_account_id,
    'previous_status', v_previous_status,
    'claim_token', p_claim_token,
    'runtime_target', v_runtime_target
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_zalo_account_runtime_operation(
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_previous_status text,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_previous_status text := btrim(COALESCE(p_previous_status, ''));
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;
  IF v_previous_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'Previous account status must be pending or paused';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Runtime claim token is required';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  UPDATE public.auto_accounts AS account
  SET
    status = v_previous_status,
    runtime_operation_claim_token = NULL,
    updated_at = now()
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND account.status = 'đang chạy'
    AND account.runtime_operation_claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$;


CREATE OR REPLACE FUNCTION public.aka_agent_advance_zalo_server_multi_daily_slot(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_next_schedule timestamptz
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  reset_count integer
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_reset_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF p_next_schedule IS NULL THEN RAISE EXCEPTION 'Next schedule is required'; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Input status mutations use input -> campaign -> account. Lock every live
  -- row in the same deterministic order before advancing the whole slot so a
  -- concurrent pause/resume cannot invert the order or commit a stale state.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id IN ('zalo_message_friend', 'zalo_message_group')
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0; RETURN; END IF;
  IF v_campaign_is_delete THEN RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_is_delete THEN RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF NOT v_account_is_active THEN RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' OR v_account_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', note = '', date_action = NULL
  WHERE campaign_id = p_campaign_id
    AND COALESCE(is_delete, false) = false
    AND status <> 'tạm dừng';
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý', schedule = p_next_schedule, note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  RETURN QUERY SELECT true, 'advanced', 'chờ xử lý', v_account_status, v_reset_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_campaign_zalo_realtime_group_event(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text,
  p_group_id text,
  p_group_name text,
  p_trigger_type text,
  p_target_uid text,
  p_target_name text,
  p_event_time timestamptz,
  p_schedule_at timestamptz,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(inserted boolean, event_id bigint, input_data_id bigint)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_event_id bigint;
  v_input_data_id bigint;
  v_organization_id bigint;
  v_capabilities record;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_target_uid text := btrim(COALESCE(p_target_uid, ''));
  v_target_name text := NULLIF(btrim(COALESCE(p_target_name, '')), '');
  v_group_id text := btrim(COALESCE(p_group_id, ''));
  v_group_name text := NULLIF(btrim(COALESCE(p_group_name, '')), '');
  v_schedule_at timestamptz := COALESCE(p_schedule_at, now());
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN RAISE EXCEPTION 'campaign_id is required'; END IF;
  IF p_account_id IS NULL OR p_account_id <= 0 THEN RAISE EXCEPTION 'account_id is required'; END IF;
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN RAISE EXCEPTION 'staff_id is required'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN RAISE EXCEPTION 'runtime target must be desktop or server'; END IF;
  IF v_group_id = '' THEN RAISE EXCEPTION 'group_id is required'; END IF;
  IF v_target_uid = '' OR v_target_uid = '0' THEN RAISE EXCEPTION 'target_uid is required'; END IF;
  IF p_trigger_type NOT IN ('join', 'leave', 'interact') THEN RAISE EXCEPTION 'invalid trigger_type: %', p_trigger_type; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RAISE EXCEPTION 'active staff % was not found', p_staff_id; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR (v_runtime_target = 'server'
      AND NOT COALESCE(v_capabilities.server_enabled, false))
  THEN RAISE EXCEPTION 'runtime_not_owner'; END IF;

  PERFORM 1
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id = 'zalo_message_group_realtime'
    AND campaign.status IN ('chờ xử lý', 'đang chạy')
    AND COALESCE(campaign.is_delete, false) = false
  FOR SHARE OF campaign;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_control_paused'; END IF;

  PERFORM 1
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND (
      (v_runtime_target = 'server' AND COALESCE(account.is_zalo_server, false) = true)
      OR (v_runtime_target = 'desktop' AND COALESCE(account.is_zalo_server, false) = false)
    )
    AND account.is_active = true
    AND account.status IN ('chờ xử lý', 'đang chạy')
    AND COALESCE(account.is_delete, false) = false
  FOR SHARE OF account;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_control_paused'; END IF;

  INSERT INTO public.auto_campaign_zalo_realtime_group_events (
    campaign_id, account_id, group_id, group_name, trigger_type,
    target_uid, target_name, event_time, raw_payload
  ) VALUES (
    p_campaign_id, p_account_id, v_group_id, v_group_name, p_trigger_type,
    v_target_uid, v_target_name, COALESCE(p_event_time, now()), COALESCE(p_raw_payload, '{}'::jsonb)
  ) ON CONFLICT (campaign_id, target_uid) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT event.id, event.input_data_id INTO v_event_id, v_input_data_id
    FROM public.auto_campaign_zalo_realtime_group_events AS event
    WHERE event.campaign_id = p_campaign_id AND event.target_uid = v_target_uid;
    RETURN QUERY SELECT false, v_event_id, v_input_data_id;
    RETURN;
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, uid, status, note, schedule
  ) VALUES (
    p_campaign_id, NULL, v_target_name, v_target_uid, 'chờ xử lý', '', v_schedule_at
  ) RETURNING id INTO v_input_data_id;

  UPDATE public.auto_campaign_zalo_realtime_group_events
  SET input_data_id = v_input_data_id, updated_at = now()
  WHERE id = v_event_id;
  UPDATE public.auto_campaigns
  SET schedule = v_schedule_at, updated_at = now()
  WHERE id = p_campaign_id AND account_id = p_account_id
    AND status IN ('chờ xử lý', 'đang chạy')
    AND (schedule IS NULL OR schedule < now() OR schedule > v_schedule_at);

  RETURN QUERY SELECT true, v_event_id, v_input_data_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_zalo_server_run_unit(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_input_data_ids bigint[] DEFAULT ARRAY[]::bigint[]
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_status text,
  account_status text,
  claimed_count integer
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_input_data_ids bigint[] := ARRAY(
    SELECT DISTINCT ids.input_id
    FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    ORDER BY ids.input_id
  );
  v_input_data_id bigint;
  v_claimed_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) AS ids(input_id)
    WHERE ids.input_id IS NULL OR ids.input_id <= 0
  ) THEN RAISE EXCEPTION 'Input data IDs must be positive integers'; END IF;
  IF cardinality(v_input_data_ids) > 50 THEN
    RAISE EXCEPTION 'A Zalo Server run unit cannot contain more than 50 input rows';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Match Control input pause/resume: requested inputs are always the first
  -- mutable rows in the lock chain, followed by campaign and account below.
  -- The status predicate is rechecked by PostgreSQL after any blocked updater.
  IF cardinality(v_input_data_ids) > 0 THEN
    FOR v_input_data_id IN
      SELECT input_data.id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = ANY(v_input_data_ids)
        AND input_data.campaign_id = p_campaign_id
        AND COALESCE(input_data.is_delete, false) = false
        AND input_data.status = 'chờ xử lý'
      ORDER BY input_data.id
      FOR UPDATE OF input_data
    LOOP
      v_claimed_count := v_claimed_count + 1;
    END LOOP;
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_found', NULL::text, NULL::text, 0; RETURN; END IF;
  IF v_campaign_is_delete THEN RETURN QUERY SELECT false, 'campaign_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_is_delete THEN RETURN QUERY SELECT false, 'account_deleted', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF NOT v_account_is_active THEN RETURN QUERY SELECT false, 'account_inactive', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN RETURN QUERY SELECT false, 'account_logged_out', v_campaign_status, v_account_status, 0; RETURN; END IF;
  IF v_campaign_status IS DISTINCT FROM 'đang chạy' OR v_account_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT false, 'runtime_control_paused', v_campaign_status, v_account_status, 0;
    RETURN;
  END IF;

  IF cardinality(v_input_data_ids) > 0 THEN
    IF v_claimed_count <> cardinality(v_input_data_ids) THEN
      RETURN QUERY SELECT false, 'input_not_pending', v_campaign_status, v_account_status, 0;
      RETURN;
    END IF;
    UPDATE public.auto_campaign_input_data
    SET status = 'đang chạy', date_action = now()
    WHERE id = ANY(v_input_data_ids) AND campaign_id = p_campaign_id;
  END IF;

  RETURN QUERY SELECT true, 'claimed', v_campaign_status, v_account_status, v_claimed_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_campaign(
  p_campaign_id bigint,
  p_staff_id bigint,
  p_note text,
  p_update_note boolean
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_id bigint,
  account_id bigint,
  campaign_status text,
  account_status text
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_account_id bigint;
  v_campaign_status text;
  v_account_status text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;
  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Serialize the final pending-input decision with Control pause/resume and
  -- run-unit claims. The campaign/account lock is deliberately taken only
  -- after every live input row is stable for the rest of this transaction.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.account_id, campaign.status, account.status
  INTO v_account_id, v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::bigint, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_campaign_status IS DISTINCT FROM 'đang chạy' THEN
    RETURN QUERY SELECT true, 'campaign_control_won', p_campaign_id, v_account_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;
  IF v_account_status IS DISTINCT FROM 'đang chạy' THEN
    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', note = NULL, updated_at = now()
    WHERE id = p_campaign_id AND status = 'đang chạy';
    RETURN QUERY SELECT true, 'account_control_won', p_campaign_id, v_account_id, 'chờ xử lý', v_account_status;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý'
  ) THEN
    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', note = NULL, updated_at = now()
    WHERE id = p_campaign_id AND status = 'đang chạy';
    RETURN QUERY SELECT true, 'pending_input_remaining', p_campaign_id, v_account_id, 'chờ xử lý', v_account_status;
    RETURN;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET status = 'hoàn thành',
    note = CASE WHEN COALESCE(p_update_note, false) THEN p_note ELSE campaign.note END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id AND campaign.status = 'đang chạy';
  RETURN QUERY SELECT true, 'completed', p_campaign_id, v_account_id, 'hoàn thành', v_account_status;
END;
$function$;

-- Preserve the v210 Data Group waiting-note behavior while changing owner.
CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_campaign_status(
  p_campaign_id bigint,
  p_staff_id bigint,
  p_status text
)
RETURNS TABLE(
  ok boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  account_status text
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_capabilities record;
  v_campaign_status text;
  v_account_status text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Campaign and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status, account.status
  INTO v_campaign_status, v_account_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_campaign_id, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_campaign_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_campaign_id, v_campaign_status, v_account_status;
    RETURN;
  END IF;
  IF (v_target_status = 'tạm dừng' AND v_campaign_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_campaign_status = 'tạm dừng')
  THEN
    UPDATE public.auto_campaigns AS campaign
    SET
      status = v_target_status,
      note = CASE
        WHEN campaign.data_target_source_mode = 'data_group'
          AND btrim(COALESCE(campaign.note, '')) IN ('Chờ data phù hợp', 'Chờ data mới')
        THEN campaign.note
        ELSE NULL
      END,
      updated_at = now()
    WHERE campaign.id = p_campaign_id;
    RETURN QUERY SELECT true, 'updated', p_campaign_id, v_target_status, v_account_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'invalid_transition', p_campaign_id, v_campaign_status, v_account_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_zalo_server_account_status(
  p_account_id bigint,
  p_staff_id bigint,
  p_status text
)
RETURNS TABLE(
  ok boolean,
  reason text,
  account_id bigint,
  account_status text,
  campaign_status text
)
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_target_status text := lower(btrim(COALESCE(p_status, '')));
  v_organization_id bigint;
  v_capabilities record;
  v_account_status text;
  v_campaign_status text;
BEGIN
  IF p_account_id IS NULL OR p_account_id <= 0 OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Account and staff IDs must be positive integers';
  END IF;
  IF v_target_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RETURN QUERY SELECT false, 'invalid_transition', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(v_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RETURN QUERY SELECT false, 'runtime_not_owner', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT account.status INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', p_account_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT campaign.status INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  WHERE campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = v_organization_id
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status IN ('đang chạy', 'tạm dừng', 'chờ xử lý')
  ORDER BY CASE campaign.status WHEN 'đang chạy' THEN 0 WHEN 'tạm dừng' THEN 1 ELSE 2 END,
    campaign.updated_at DESC NULLS LAST, campaign.id DESC
  LIMIT 1;

  IF v_account_status = v_target_status THEN
    RETURN QUERY SELECT true, 'already_target', p_account_id, v_account_status, v_campaign_status;
    RETURN;
  END IF;
  IF (v_target_status = 'tạm dừng' AND v_account_status IN ('chờ xử lý', 'đang chạy'))
    OR (v_target_status = 'chờ xử lý' AND v_account_status = 'tạm dừng')
  THEN
    UPDATE public.auto_accounts SET status = v_target_status, updated_at = now()
    WHERE id = p_account_id;
    RETURN QUERY SELECT true, 'updated', p_account_id, v_target_status, v_campaign_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT false, 'invalid_transition', p_account_id, v_account_status, v_campaign_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_zalo_server_run_control_state(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint
)
RETURNS TABLE(
  campaign_id bigint,
  account_id bigint,
  campaign_status text,
  account_status text,
  account_login_status text,
  account_is_active boolean,
  account_is_delete boolean,
  campaign_is_delete boolean,
  pause_requested boolean,
  should_stop boolean,
  hard_stop_reason text
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_campaign_status text;
  v_account_status text;
  v_account_login_status text;
  v_account_is_active boolean;
  v_account_is_delete boolean;
  v_campaign_is_delete boolean;
  v_pause_requested boolean := false;
  v_hard_stop_reason text;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    v_hard_stop_reason := 'runtime_not_owner';
  END IF;

  SELECT campaign.status, account.status, account.login_status,
    COALESCE(account.is_active, false), COALESCE(account.is_delete, false),
    COALESCE(campaign.is_delete, false)
  INTO v_campaign_status, v_account_status, v_account_login_status,
    v_account_is_active, v_account_is_delete, v_campaign_is_delete
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id AND account.staff_id = campaign.staff_id
  WHERE campaign.id = p_campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.staff_id = p_staff_id
    AND (campaign.organization_id IS NULL OR campaign.organization_id = v_organization_id)
    AND (account.organization_id IS NULL OR account.organization_id = v_organization_id)
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true;

  IF NOT FOUND THEN
    v_hard_stop_reason := COALESCE(v_hard_stop_reason, 'not_found');
  ELSE
    v_pause_requested := v_campaign_status IS DISTINCT FROM 'đang chạy'
      OR v_account_status IS DISTINCT FROM 'đang chạy';
    IF v_hard_stop_reason IS NULL AND v_campaign_is_delete THEN
      v_hard_stop_reason := 'campaign_deleted';
    ELSIF v_hard_stop_reason IS NULL AND v_account_is_delete THEN
      v_hard_stop_reason := 'account_deleted';
    ELSIF v_hard_stop_reason IS NULL AND NOT v_account_is_active THEN
      v_hard_stop_reason := 'account_inactive';
    ELSIF v_hard_stop_reason IS NULL AND v_account_login_status IS DISTINCT FROM 'đã đăng nhập' THEN
      v_hard_stop_reason := 'account_logged_out';
    END IF;
  END IF;

  RETURN QUERY SELECT p_campaign_id, p_account_id, v_campaign_status,
    v_account_status, v_account_login_status, v_account_is_active,
    v_account_is_delete, v_campaign_is_delete, v_pause_requested,
    v_pause_requested OR v_hard_stop_reason IS NOT NULL, v_hard_stop_reason;
END;
$function$;

CREATE OR REPLACE FUNCTION public.inspect_staff_zalo_running_state(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_organization_id bigint;
  v_accounts_running integer := 0;
  v_campaigns_running integer := 0;
  v_campaign_inputs_running integer := 0;
  v_campaign_input_data_running integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Active staff % was not found', p_staff_id;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  -- This barrier follows durable account ownership and remains usable after
  -- entitlement loss. Concurrent QR/Web-local work must not block Server drain.
  SELECT count(*)::integer INTO v_accounts_running
  FROM public.auto_accounts AS account
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';

  SELECT count(*)::integer INTO v_campaigns_running
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND campaign.status = 'đang chạy';

  SELECT count(*)::integer INTO v_campaign_inputs_running
  FROM public.auto_campaign_inputs AS campaign_input
  JOIN public.auto_campaigns AS campaign ON campaign.id = campaign_input.campaign_id
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(campaign_input.is_delete, false) = false
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy';

  SELECT count(*)::integer INTO v_campaign_input_data_running
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign ON campaign.id = input_data.campaign_id
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(input_data.is_delete, false) = false
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy';

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'has_running_state',
      v_accounts_running > 0 OR v_campaigns_running > 0
      OR v_campaign_inputs_running > 0 OR v_campaign_input_data_running > 0,
    'accounts_running', v_accounts_running,
    'campaigns_running', v_campaigns_running,
    'campaign_inputs_running', v_campaign_inputs_running,
    'campaign_input_data_running', v_campaign_input_data_running
  );
END;
$function$;

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
  v_capabilities record;
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

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);

  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
    OR btrim(COALESCE(v_capabilities.capability_revision, ''))
      IS DISTINCT FROM v_expected_mode_revision
  THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;
END;
$function$;

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
  -- This is a cleanup/finalization path for work that was already claimed.
  -- Capability/revision changes prevent the next run-unit claim, but must not
  -- strand the target that is currently being settled. Keep tenant/staff and
  -- persisted Server-subtype checks below as the ownership boundary.
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR NULLIF(btrim(COALESCE(p_expected_mode_revision, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;

  PERFORM 1
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_server_runtime_not_owner';
  END IF;

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  -- Reject an unowned/local target before the SECURITY DEFINER function locks
  -- any input row. The same proof is repeated authoritatively after locking.
  PERFORM campaign.id
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
    AND COALESCE(account.is_zalo_server, false) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- The shared Data Group finalizer takes campaign/source before inspecting
  -- inputs. Pre-lock all live inputs here so the effective Server lock order
  -- remains input -> campaign -> account and cannot invert Control pause/resume.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

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
    AND COALESCE(account.is_zalo_server, false) = true
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_server_campaign_not_found';
  END IF;

  RETURN public.aka_agent_internal_finalize_data_group_campaign_v219(
    p_staff_id,
    p_organization_id,
    v_campaign_id,
    p_note
  );
END;
$function$;

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
      AND COALESCE(account.is_zalo_server, false) = true
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
    -- Do not pre-lock campaign here: the per-candidate wrapper first locks all
    -- live inputs, then campaign/account. Concurrent sweeps remain idempotent
    -- because the wrapper/global finalizer rechecks durable terminal state.
    ORDER BY campaign.schedule_end_date, campaign.id
    LIMIT v_limit
  LOOP
    v_result := public.aka_agent_finalize_zalo_server_data_group_campaign(
      p_staff_id,
      p_organization_id,
      p_expected_mode_revision,
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

CREATE OR REPLACE FUNCTION public.aka_agent_internal_require_zalo_server_runtime(
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
  v_capabilities record;
  v_expected_mode_revision text := btrim(COALESCE(p_expected_mode_revision, ''));
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR v_expected_mode_revision = ''
  THEN
    RAISE EXCEPTION 'zalo_server_runtime_not_owner';
  END IF;

  SELECT staff.organization_id INTO v_staff_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;

  IF NOT FOUND OR v_staff_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'zalo_server_runtime_not_owner';
  END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);

  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
    OR btrim(COALESCE(v_capabilities.capability_revision, ''))
      IS DISTINCT FROM v_expected_mode_revision
  THEN
    RAISE EXCEPTION 'zalo_server_runtime_not_owner';
  END IF;
END;
$function$;

-- v216's public maintenance wrapper keeps its schedule calculations. Tighten
-- the final mutation guard so even a caller-selected local campaign can never
-- cross the Server account boundary.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_finalize_zalo_server_maintenance_guard(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_note text,
  p_update_note boolean,
  p_expected_status text
)
RETURNS TABLE(
  completed boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  pending_input_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_campaign_status text;
  v_source_mode text;
  v_pending_input_count bigint := 0;
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

  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct')
  INTO v_campaign_status, v_source_mode
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
$function$;

-- Keep v216's schedule-candidate proof, but reject a local account before the
-- wrapper takes any campaign/account row lock. The internal guard below is a
-- second ownership boundary immediately before mutation.
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_expected_mode_revision text,
  p_campaign_id bigint,
  p_note text,
  p_update_note boolean
)
RETURNS TABLE(
  completed boolean,
  reason text,
  campaign_id bigint,
  campaign_status text,
  pending_input_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_authorized_campaign_id bigint;
  v_action_id text;
  v_schedule timestamptz;
  v_original_schedule timestamptz;
  v_schedule_type text;
  v_schedule_days text;
  v_schedule_week_days text;
  v_schedule_end_date timestamptz;
  v_schedule_time time without time zone;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_candidate_date date;
  v_next_schedule timestamptz;
  v_allowed_days integer[] := ARRAY[]::integer[];
  v_day_token text;
  v_day_numeric numeric;
  v_day_number integer;
  v_day_offset integer;
  v_is_birthday_maintenance boolean := false;
  v_is_schedule_end_maintenance boolean := false;
  v_maintenance_note text;
BEGIN
  PERFORM public.aka_agent_internal_require_zalo_server_runtime(
    p_staff_id,
    p_organization_id,
    p_expected_mode_revision
  );

  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'zalo_server_maintenance_campaign_invalid';
  END IF;

  -- Avoid locking rows for a local or cross-tenant campaign through this
  -- SECURITY DEFINER surface. The full schedule/candidate proof is repeated
  -- with campaign/account row locks after the input-first barrier.
  PERFORM campaign.id
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
    AND COALESCE(campaign.data_target_source_mode, 'direct') = 'direct'
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Maintenance may complete the campaign based on its current input set.
  -- Stabilize that set before the schedule proof locks campaign/account.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT
    campaign.id,
    campaign.action_id,
    campaign.schedule,
    campaign.original_schedule,
    COALESCE(NULLIF(campaign.schedule_type, ''), 'daily'),
    campaign.schedule_days,
    campaign.schedule_week_days,
    campaign.schedule_end_date
  INTO
    v_authorized_campaign_id,
    v_action_id,
    v_schedule,
    v_original_schedule,
    v_schedule_type,
    v_schedule_days,
    v_schedule_week_days,
    v_schedule_end_date
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
    AND COALESCE(campaign.data_target_source_mode, 'direct') = 'direct'
    AND campaign.action_id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.schedule IS NOT NULL
    AND campaign.schedule < (
      date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
    )
    AND campaign.status IN ('chờ xử lý', 'hoàn thành')
    AND (
      account.organization_id IS NULL
      OR account.organization_id = p_organization_id
    )
    AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND COALESCE(account.is_zalo_show_web, false) = false
    AND COALESCE(account.is_zalo_server, false) = true
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  -- Mirror resolveNextSchedule() in campaignRepository.ts. The capability
  -- revision is a freshness/CAS boundary rather than a secret, so the public
  -- Server RPC independently proves this is a real maintenance candidate.
  v_schedule_time := (
    date_trunc(
      'second',
      COALESCE(v_original_schedule, v_schedule)
        AT TIME ZONE 'Asia/Ho_Chi_Minh'
    )
  )::time;

  IF v_schedule_type = 'daily' THEN
    v_candidate_date := v_today;
  ELSIF v_schedule_type IN ('weekly', 'monthly') THEN
    FOREACH v_day_token IN ARRAY string_to_array(
      CASE
        WHEN v_schedule_type = 'weekly' THEN COALESCE(v_schedule_week_days, '')
        ELSE COALESCE(v_schedule_days, '')
      END,
      ','
    )
    LOOP
      BEGIN
        v_day_numeric := btrim(v_day_token)::numeric;
        IF v_day_numeric = trunc(v_day_numeric)
          AND (
            (v_schedule_type = 'weekly' AND v_day_numeric BETWEEN 2 AND 8)
            OR (v_schedule_type = 'monthly' AND v_day_numeric BETWEEN 1 AND 31)
          )
        THEN
          v_day_number := v_day_numeric::integer;
          IF NOT v_day_number = ANY(v_allowed_days) THEN
            v_allowed_days := array_append(v_allowed_days, v_day_number);
          END IF;
        END IF;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          NULL;
      END;
    END LOOP;

    IF cardinality(v_allowed_days) > 0 THEN
      FOR v_day_offset IN 0..(
        CASE WHEN v_schedule_type = 'weekly' THEN 13 ELSE 369 END
      )
      LOOP
        v_candidate_date := v_today + v_day_offset;
        IF (
          v_schedule_type = 'weekly'
          AND (extract(isodow FROM v_candidate_date)::integer + 1) = ANY(v_allowed_days)
        ) OR (
          v_schedule_type = 'monthly'
          AND extract(day FROM v_candidate_date)::integer = ANY(v_allowed_days)
        ) THEN
          EXIT;
        END IF;
        v_candidate_date := NULL;
      END LOOP;
    END IF;
  END IF;

  IF v_candidate_date IS NOT NULL THEN
    v_next_schedule := (
      v_candidate_date + v_schedule_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  END IF;

  v_is_birthday_maintenance := (
    v_schedule_type = 'daily'
    AND v_action_id = 'zalo_message_birthday'
  );
  v_is_schedule_end_maintenance := (
    v_schedule_end_date IS NOT NULL
    AND v_next_schedule IS NOT NULL
    AND v_next_schedule > v_schedule_end_date
  );

  IF NOT v_is_birthday_maintenance AND NOT v_is_schedule_end_maintenance THEN
    RETURN QUERY SELECT
      false,
      'not_found',
      p_campaign_id,
      NULL::text,
      0::bigint;
    RETURN;
  END IF;

  v_maintenance_note := CASE
    WHEN v_is_schedule_end_maintenance THEN 'Chiến dịch đã hết ngày kết thúc'
    ELSE 'Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày'
  END;

  RETURN QUERY
  SELECT
    result.completed,
    result.reason,
    result.campaign_id,
    result.campaign_status,
    result.pending_input_count
  FROM public.aka_agent_internal_finalize_zalo_server_maintenance_guard(
    p_staff_id,
    p_organization_id,
    v_authorized_campaign_id,
    v_maintenance_note,
    true,
    'chờ xử lý'
  ) AS result;
END;
$function$;

-- Reassert authoritative Control Web mutations with row-locked per-account
-- ownership. SMS retains its existing contract; Zalo creation/edit/append
-- accepts only the exact headless Server subtype.

CREATE OR REPLACE FUNCTION public.create_control_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_idempotency_key text,
  p_campaign jsonb,
  p_inputs jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign_id bigint;
  v_account_id bigint;
  v_action_id text;
  v_action_platform text;
  v_account_platform text;
  v_input_count integer := 0;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF jsonb_typeof(COALESCE(p_campaign, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_control_campaign_payload';
  END IF;
  IF jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'too_many_campaign_inputs';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_staff_id::text || ':' || v_key, 0));

  SELECT campaign.id INTO v_campaign_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.control_idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    PERFORM account.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = v_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND (
        account.flatform_type = 'sms'
        OR (
          account.flatform_type = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
        )
      )
      AND COALESCE(account.is_delete, false) = false
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'control_account_not_found';
    END IF;

    SELECT count(*)::integer INTO v_input_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = v_campaign_id AND COALESCE(is_delete, false) = false;
    RETURN jsonb_build_object(
      'campaign_id', v_campaign_id,
      'input_count', v_input_count,
      'created', false
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff
    WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  v_account_id := NULLIF(p_campaign->>'accountId', '')::bigint;
  v_action_id := NULLIF(btrim(COALESCE(p_campaign->>'actionId', '')), '');
  IF v_account_id IS NULL OR v_action_id IS NULL THEN
    RAISE EXCEPTION 'campaign_account_and_action_required';
  END IF;

  SELECT account.flatform_type INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'control_account_not_found';
  END IF;

  SELECT action.flatform_type INTO v_action_platform
  FROM public.auto_campaign_actions AS action
  WHERE action.id = v_action_id
    AND action.flatform_type IN ('zalo', 'sms')
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false;
  IF NOT FOUND OR v_action_platform IS DISTINCT FROM v_account_platform THEN
    RAISE EXCEPTION 'control_action_not_allowed';
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, schedule, original_schedule,
    content, schedule_type, schedule_end_date,
    daily_stop_time, schedule_days, schedule_week_days, continue_next_day,
    refresh_data, extra_settings, images, is_delete, staff_id, organization_id,
    control_idempotency_key, created_at, updated_at
  ) VALUES (
    btrim(p_campaign->>'name'),
    v_action_id,
    v_account_id,
    'chờ xử lý',
    NULLIF(p_campaign->>'schedule', '')::timestamptz,
    NULLIF(p_campaign->>'schedule', '')::timestamptz,
    COALESCE(p_campaign->>'content', ''),
    COALESCE(NULLIF(p_campaign->>'scheduleType', ''), 'daily'),
    NULLIF(p_campaign->>'scheduleEndDate', '')::timestamptz,
    NULLIF(p_campaign->>'dailyStopTime', '')::time,
    NULLIF(p_campaign->>'scheduleDays', ''),
    NULLIF(p_campaign->>'scheduleWeekDays', ''),
    COALESCE((p_campaign->>'continueNextDay')::boolean, false),
    COALESCE((p_campaign->>'refreshData')::boolean, false),
    CASE WHEN jsonb_typeof(p_campaign->'extraSettings') = 'object'
      THEN p_campaign->'extraSettings' ELSE '{}'::jsonb END,
    CASE WHEN jsonb_typeof(p_campaign->'images') = 'array'
      THEN p_campaign->'images' ELSE '[]'::jsonb END,
    false,
    p_staff_id,
    p_organization_id,
    v_key,
    now(),
    now()
  ) RETURNING id INTO v_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, phone, phone_carrier, uid, email,
    info1, info2, info3, info4, info5, content,
    status, note, schedule, is_delete, created_at
  )
  SELECT
    v_campaign_id,
    NULL,
    NULLIF(item->>'name', ''),
    NULLIF(item->>'phone', ''),
    NULLIF(item->>'phoneCarrier', ''),
    NULLIF(item->>'uid', ''),
    NULLIF(item->>'email', ''),
    NULLIF(item->>'info1', ''),
    NULLIF(item->>'info2', ''),
    NULLIF(item->>'info3', ''),
    NULLIF(item->>'info4', ''),
    NULLIF(item->>'info5', ''),
    NULLIF(item->>'content', ''),
    'chờ xử lý',
    NULLIF(item->>'note', ''),
    NULLIF(item->>'schedule', '')::timestamptz,
    false,
    now()
  FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) AS item;
  GET DIAGNOSTICS v_input_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign_id,
    'input_count', v_input_count,
    'created', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_control_campaign_v2(
  p_staff_id bigint,
  p_organization_id bigint,
  p_idempotency_key text,
  p_campaign jsonb,
  p_inputs jsonb DEFAULT '[]'::jsonb,
  p_initial_status text DEFAULT 'chờ xử lý'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_result jsonb;
  v_campaign_id bigint;
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

  -- The inner insert and this update share a transaction, so a cloned campaign is
  -- never externally visible in the runnable state.
  IF p_initial_status = 'tạm dừng' AND COALESCE((v_result->>'created')::boolean, false) THEN
    v_campaign_id := NULLIF(v_result->>'campaign_id', '')::bigint;
    UPDATE public.auto_campaigns
    SET status = 'tạm dừng', updated_at = now()
    WHERE id = v_campaign_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND COALESCE(is_delete, false) = false;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_control_campaign_inputs(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_idempotency_key text,
  p_expected_input_count integer,
  p_inputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign_status text;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_input_count integer := 0;
  v_existing_count integer := 0;
  v_inserted integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) < 1
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'invalid_control_campaign_inputs';
  END IF;

  -- Validate tenant ownership before taking any row locks.
  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- SMS status recording locks an input row before it may complete its campaign.
  -- Follow the same input -> campaign order so appending cannot leave new pending
  -- data underneath a campaign that concurrently became completed.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND control_append_idempotency_key = v_key;
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('inserted', v_existing_count, 'created', false);
  END IF;

  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'campaign_running');
  END IF;
  IF v_campaign_status = 'hoàn thành' THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'campaign_completed');
  END IF;

  SELECT count(*)::integer INTO v_input_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND COALESCE(is_delete, false) = false;
  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'input_count_conflict');
  END IF;

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
    v_key,
    (item.ordinality - 1)::integer
  FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_inserted, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_control_campaign_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_expected_updated_at timestamptz,
  p_campaign_patch jsonb,
  p_sms_inputs jsonb DEFAULT NULL,
  p_update_sms_schedule boolean DEFAULT false,
  p_append_idempotency_key text DEFAULT NULL,
  p_expected_input_count integer DEFAULT NULL,
  p_append_inputs jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
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
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false;

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
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false
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
      AND account.flatform_type = v_account_platform
      AND (
        account.flatform_type = 'sms'
        OR (
          account.flatform_type = 'zalo'
          AND COALESCE(account.is_zalo_show_web, false) = false
          AND COALESCE(account.is_zalo_server, false) = true
          AND COALESCE(account.is_active, true) = true
          AND account.status IN ('chờ xử lý', 'tạm dừng')
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
$$;

CREATE OR REPLACE FUNCTION public.delete_control_campaign_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign_status text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;

  -- This is an optimistic platform read only; it deliberately takes no campaign
  -- row lock. The mutation locks input rows before taking the campaign row lock.
  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
    )
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
    )
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET is_delete = true, updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status <> 'đang chạy';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  RETURN jsonb_build_object('deleted', true, 'campaign_id', p_campaign_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_control_campaign_input_rows(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_idempotency_key text,
  p_expected_input_count integer,
  p_inputs jsonb,
  p_campaign_schedule timestamptz,
  p_campaign_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign_status text;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_input_count integer := 0;
  v_existing_count integer := 0;
  v_inserted integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF p_campaign_schedule IS NULL THEN
    RAISE EXCEPTION 'invalid_campaign_schedule';
  END IF;
  IF p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_campaign_status';
  END IF;
  IF jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) < 1
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'invalid_control_campaign_inputs';
  END IF;

  -- Validate tenant ownership before taking locks.
  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Keep the same input -> campaign lock order as SMS completion recording.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND control_append_idempotency_key = v_key;
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('inserted', v_existing_count, 'created', false);
  END IF;

  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'campaign_running');
  END IF;

  SELECT count(*)::integer INTO v_input_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND COALESCE(is_delete, false) = false;
  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'input_count_conflict');
  END IF;

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
    v_key,
    (item.ordinality - 1)::integer
  FROM jsonb_array_elements(p_inputs) WITH ORDINALITY AS item(value, ordinality);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.auto_campaigns
  SET schedule = p_campaign_schedule,
      original_schedule = p_campaign_schedule,
      status = p_campaign_status,
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object('inserted', v_inserted, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_control_campaign_input_statuses_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_input_ids bigint[],
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_input_ids bigint[];
  v_from_status text;
  v_campaign_status text;
  v_account_platform text;
  v_is_zalo_show_web boolean;
  v_is_zalo_server boolean;
  v_updated_count integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0
  THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF p_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_input_status';
  END IF;
  IF p_input_ids IS NULL
    OR cardinality(p_input_ids) < 1
    OR cardinality(p_input_ids) > 5000
    OR EXISTS (
      SELECT 1
      FROM unnest(p_input_ids) AS requested(input_id)
      WHERE requested.input_id IS NULL OR requested.input_id <= 0
    )
  THEN
    RAISE EXCEPTION 'invalid_control_input_ids';
  END IF;

  SELECT array_agg(DISTINCT requested.input_id ORDER BY requested.input_id)
  INTO v_input_ids
  FROM unnest(p_input_ids) AS requested(input_id);
  v_from_status := CASE p_status
    WHEN 'tạm dừng' THEN 'chờ xử lý'
    ELSE 'tạm dừng'
  END;

  -- Optimistic tenant/owner read. The authoritative check is repeated while
  -- holding both the campaign and account rows below.
  SELECT
    campaign.status,
    account.flatform_type,
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_platform,
    v_is_zalo_show_web,
    v_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'campaign_not_found'
    );
  END IF;
  IF v_account_platform = 'zalo'
    AND (v_is_zalo_show_web OR NOT v_is_zalo_server)
  THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'account_not_server'
    );
  ELSIF v_account_platform NOT IN ('zalo', 'sms') THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'invalid_owner'
    );
  END IF;

  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  -- Keep the established input -> campaign -> account lock order shared with
  -- SMS completion recording and the other control-web mutations.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND input_data.id = ANY(v_input_ids)
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE OF input_data;

  SELECT
    campaign.status,
    account.flatform_type,
    COALESCE(account.is_zalo_show_web, false),
    COALESCE(account.is_zalo_server, false)
  INTO
    v_campaign_status,
    v_account_platform,
    v_is_zalo_show_web,
    v_is_zalo_server
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign, account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'campaign_not_found'
    );
  END IF;
  IF v_account_platform = 'zalo'
    AND (v_is_zalo_show_web OR NOT v_is_zalo_server)
  THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'account_not_server'
    );
  ELSIF v_account_platform NOT IN ('zalo', 'sms') THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'invalid_owner'
    );
  END IF;
  IF v_account_platform = 'zalo'
    AND v_campaign_status = 'hoàn thành'
    AND p_status = 'chờ xử lý'
  THEN
    RETURN jsonb_build_object(
      'updated', false,
      'updated_count', 0,
      'reason', 'campaign_completed'
    );
  END IF;

  UPDATE public.auto_campaign_input_data AS input_data
  SET
    status = p_status,
    note = CASE WHEN p_note IS NULL THEN input_data.note ELSE p_note END
  WHERE input_data.campaign_id = p_campaign_id
    AND input_data.id = ANY(v_input_ids)
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.status = v_from_status;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'updated', true,
    'updated_count', v_updated_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_control_campaign_input_statuses_atomic(
  bigint, bigint, bigint, bigint[], text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_control_campaign_input_statuses_atomic(
  bigint, bigint, bigint, bigint[], text, text
) TO service_role;

-- Data Group service entrypoints default to Server ownership for Zalo.
-- Existing credentialed desktop overloads set a transaction-local context
-- so QR/Web accounts continue to use the same implementation safely.

CREATE OR REPLACE FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_group_id bigint
)
RETURNS TABLE (
  allowed boolean,
  reason text,
  canonical_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  canonical_count := 0;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false) THEN
    allowed := false;
    reason := 'data_group_campaign_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Ownership precedes every early-return branch, including `unchanged`, so a
  -- service caller cannot reuse a source after its Zalo account becomes local.
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
              AND COALESCE(account.is_active, true) = true
              AND account.status IN ('chờ xử lý', 'tạm dừng')
            )
          )
        )
      )
  ) THEN
    allowed := false;
    reason := 'data_group_campaign_account_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::bigint INTO canonical_count
  FROM public.auto_campaign_input_data AS input_row
  WHERE input_row.campaign_id = v_campaign.id
    AND input_row.canonical_target_key IS NOT NULL
    AND COALESCE(input_row.is_delete, false) = false;

  IF p_group_id IS NULL OR p_group_id <= 0 OR NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    allowed := false;
    reason := 'data_group_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.data_group_id IS NOT DISTINCT FROM p_group_id
  THEN
    allowed := true;
    reason := 'unchanged';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.status IN ('đang chạy', 'hoàn thành')
    OR (v_campaign.schedule_end_date IS NOT NULL
      AND v_campaign.schedule_end_date <= now())
  THEN
    allowed := false;
    reason := 'data_group_campaign_not_bindable';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_campaign.action_id NOT IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid',
    'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_comment_seeding', 'facebook_comment_seeding_post',
    'zalo_message_phone', 'zalo_join_group_link', 'email_send',
    'facebook_message_friend', 'facebook_group_invite', 'facebook_page_post',
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer', 'zalo_message_group',
    'zalo_add_group_member'
  ) THEN
    allowed := false;
    reason := 'data_group_campaign_action_incompatible';
    RETURN NEXT;
    RETURN;
  END IF;
  IF canonical_count > 0 THEN
    allowed := false;
    reason := 'campaign_data_group_source_immutable_after_intake';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT source.* INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF FOUND AND v_source.bundle_id IS NOT NULL THEN
    allowed := false;
    reason := 'campaign_data_group_source_immutable';
    RETURN NEXT;
    RETURN;
  END IF;

  allowed := true;
  reason := 'allowed';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_bind_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_bundle_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_bundle public.auto_campaign_creation_bundles%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_bundle_source record;
  v_request_hash text;
  v_rebinding boolean := false;
  v_source_found boolean := false;
  v_snapshot jsonb;
  v_campaign_count integer := 0;
  v_child_index_count integer := 0;
  v_min_child_index integer;
  v_max_child_index integer;
  v_invalid_campaign_count integer := 0;
  v_registered_count integer := 0;
  v_distinct_group_count integer := 0;
  v_invalid_source_count integer := 0;
  v_active_membership_count integer := 0;
  v_serialized_campaign_id bigint;
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_data_group_bind_request';
  END IF;

  -- Common lock root for bind, ingest, delete and stop.
  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  IF p_bundle_id IS NOT NULL THEN
    SELECT bundle.*
    INTO v_bundle
    FROM public.auto_campaign_creation_bundles AS bundle
    WHERE bundle.id = p_bundle_id
      AND bundle.staff_id = p_staff_id
      AND bundle.organization_id = p_organization_id
    FOR UPDATE;
    IF NOT FOUND OR v_bundle.status = 'failed' THEN
      RAISE EXCEPTION 'campaign_creation_bundle_not_found';
    END IF;

    IF v_bundle.data_group_id IS NULL THEN
      UPDATE public.auto_campaign_creation_bundles AS bundle
      SET data_group_id = v_group.id,
          updated_at = now()
      WHERE bundle.id = v_bundle.id
      RETURNING bundle.* INTO v_bundle;
    ELSIF v_bundle.data_group_id IS DISTINCT FROM v_group.id THEN
      RAISE EXCEPTION 'campaign_creation_bundle_group_mismatch';
    END IF;

    FOR v_serialized_campaign_id IN
      SELECT campaign.id
      FROM public.auto_campaigns AS campaign
      WHERE campaign.creation_bundle_id = p_bundle_id
      ORDER BY campaign.id
    LOOP
      PERFORM public.aka_agent_lock_campaign_input_serialization(
        v_serialized_campaign_id
      );
    END LOOP;

    -- The bundle lock prevents new FK references while every existing child
    -- and source is locked in one deterministic order.
    PERFORM campaign.id
    FROM public.auto_campaigns AS campaign
    WHERE campaign.creation_bundle_id = p_bundle_id
    ORDER BY campaign.creation_bundle_child_index NULLS LAST, campaign.id
    FOR UPDATE OF campaign;

    -- Binding the last child activates the whole bundle, so ownership of every
    -- child account is locked and revalidated rather than only the requested
    -- child. The bundle row above prevents a new child from joining this set.
    PERFORM account.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.creation_bundle_id = p_bundle_id
    ORDER BY account.id
    FOR UPDATE OF account;

    IF EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      LEFT JOIN public.auto_accounts AS account ON account.id = campaign.account_id
      WHERE campaign.creation_bundle_id = p_bundle_id
        AND (
          account.id IS NULL
          OR account.staff_id IS DISTINCT FROM p_staff_id
          OR NOT (
            account.organization_id IS NULL
            OR account.organization_id = p_organization_id
          )
          OR COALESCE(account.is_delete, false)
          OR NOT (
            COALESCE(account.flatform_type, '') <> 'zalo'
            OR (
              account.organization_id = p_organization_id
              AND (
                (
                  v_runtime_target = 'desktop'
                  AND COALESCE(account.is_zalo_server, false) = false
                )
                OR (
                  v_runtime_target = 'server'
                  AND COALESCE(account.is_zalo_show_web, false) = false
                  AND COALESCE(account.is_zalo_server, false) = true
                  AND COALESCE(account.is_active, true) = true
                  AND account.status IN ('chờ xử lý', 'tạm dừng')
                )
              )
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'data_group_campaign_account_not_found';
    END IF;

    SELECT campaign.*
    INTO v_campaign
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id;

    PERFORM source.id
    FROM public.auto_campaign_data_group_sources AS source
    WHERE source.bundle_id = p_bundle_id
    ORDER BY source.campaign_id, source.id
    FOR UPDATE OF source;
  ELSE
    PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

    SELECT campaign.*
    INTO v_campaign
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
    FOR UPDATE;
  END IF;

  IF p_bundle_id IS NULL AND v_campaign.id IS NOT NULL THEN
    PERFORM account.id
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
              AND COALESCE(account.is_active, true) = true
              AND account.status IN ('chờ xử lý', 'tạm dừng')
            )
          )
        )
      )
    FOR UPDATE OF account;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'data_group_campaign_account_not_found';
    END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'bind_source',
    'campaignId', p_campaign_id,
    'groupId', p_group_id,
    'bundleId', p_bundle_id
  )::text);

  -- A committed bundle response is authoritative even if the campaign has
  -- subsequently started. This keeps retries stable across lifecycle changes.
  IF p_bundle_id IS NOT NULL THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF FOUND THEN
      IF v_batch.operation <> 'bind_source'
        OR v_batch.group_id IS DISTINCT FROM p_group_id
        OR v_batch.request_hash <> v_request_hash
      THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN
        RETURN v_batch.result;
      END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  IF v_campaign.id IS NULL OR COALESCE(v_campaign.is_delete, false) THEN
    RAISE EXCEPTION 'data_group_campaign_not_found';
  END IF;
  IF v_campaign.status IN ('đang chạy', 'hoàn thành')
    OR (
      v_campaign.schedule_end_date IS NOT NULL
      AND v_campaign.schedule_end_date <= now()
    )
  THEN
    RAISE EXCEPTION 'data_group_campaign_not_bindable';
  END IF;
  IF v_campaign.action_id NOT IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid',
    'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_comment_seeding', 'facebook_comment_seeding_post',
    'zalo_message_phone', 'zalo_join_group_link', 'email_send',
    'facebook_message_friend', 'facebook_group_invite', 'facebook_page_post',
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer', 'zalo_message_group',
    'zalo_add_group_member'
  ) THEN
    RAISE EXCEPTION 'data_group_campaign_action_incompatible';
  END IF;
  IF p_bundle_id IS NOT NULL THEN
    IF v_campaign.creation_bundle_id IS DISTINCT FROM p_bundle_id
      OR v_campaign.creation_bundle_child_index IS NULL
      OR v_campaign.creation_bundle_child_index < 0
      OR v_campaign.creation_bundle_child_index >= v_bundle.expected_campaign_count
    THEN
      RAISE EXCEPTION 'campaign_creation_bundle_child_invalid';
    END IF;
  ELSIF v_campaign.creation_bundle_id IS NOT NULL THEN
    RAISE EXCEPTION 'campaign_creation_bundle_required';
  END IF;

  SELECT source.*
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id
  FOR UPDATE;
  v_source_found := FOUND;

  IF v_source_found THEN
    IF v_source.bundle_id IS DISTINCT FROM p_bundle_id THEN
      RAISE EXCEPTION 'campaign_data_group_source_immutable';
    END IF;
    IF v_source.group_id IS DISTINCT FROM v_group.id THEN
      IF p_bundle_id IS NOT NULL THEN
        RAISE EXCEPTION 'campaign_creation_bundle_group_mismatch';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND input_data.canonical_target_key IS NOT NULL
          AND COALESCE(input_data.is_delete, false) = false
      ) THEN
        RAISE EXCEPTION 'campaign_data_group_source_immutable_after_intake';
      END IF;
      v_rebinding := true;
    ELSIF v_source.status = 'stopped' THEN
      RAISE EXCEPTION 'campaign_data_group_source_stopped_use_reactivate';
    ELSIF p_bundle_id IS NULL AND v_source.status = 'active' THEN
      -- Preserve the established non-bundle idempotent response.
      RETURN to_jsonb(v_source);
    END IF;
  END IF;

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'bind_source', p_group_id, v_request_hash,
    'processing', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'bind_source'
      OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN
      RETURN v_batch.result;
    END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  -- A fresh request against an already committed ready bundle is harmless and
  -- gets its own completed idempotency row without replaying the snapshot.
  IF p_bundle_id IS NOT NULL AND v_bundle.status = 'ready' THEN
    IF NOT v_source_found
      OR v_source.status <> 'active'
      OR v_source.group_id IS DISTINCT FROM v_bundle.data_group_id
      OR v_source.baseline_revision IS DISTINCT FROM v_bundle.baseline_revision
    THEN
      RAISE EXCEPTION 'campaign_creation_bundle_ready_state_invalid';
    END IF;

    UPDATE public.auto_data_ingest_batches
    SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
    WHERE id = v_batch.id;
    RETURN to_jsonb(v_source);
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET data_target_source_mode = 'data_group',
      data_group_id = v_group.id,
      provisioning_state = 'staged',
      updated_at = now()
  WHERE campaign.id = v_campaign.id;

  IF NOT v_source_found THEN
    INSERT INTO public.auto_campaign_data_group_sources (
      campaign_id, group_id, bundle_id, baseline_revision, status,
      staff_id, organization_id
    ) VALUES (
      v_campaign.id, v_group.id, p_bundle_id,
      CASE WHEN p_bundle_id IS NULL THEN v_group.revision ELSE 0 END,
      'baselining',
      p_staff_id, p_organization_id
    )
    RETURNING * INTO v_source;
    v_source_found := true;
  ELSIF v_rebinding THEN
    -- The non-bundle path keeps v186's atomic empty-source rebind behavior.
    DELETE FROM public.auto_campaign_input_target_aliases AS alias
    WHERE alias.campaign_id = v_campaign.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.id = alias.input_data_id
          AND COALESCE(input_data.is_delete, false) = false
      );

    UPDATE public.auto_campaign_data_group_sources AS source
    SET group_id = v_group.id,
        baseline_revision = v_group.revision,
        status = 'baselining',
        started_at = NULL,
        stopped_at = NULL,
        stop_reason = NULL,
        last_ingest_at = NULL,
        updated_at = now()
    WHERE source.id = v_source.id
    RETURNING source.* INTO v_source;
  END IF;

  IF p_bundle_id IS NULL THEN
    -- Non-bundle behavior remains the established one-campaign transaction.
    v_snapshot := public.aka_agent_internal_route_group_snapshot(
      v_source.id, v_batch.id, v_group.revision
    );

    UPDATE public.auto_campaign_data_group_sources AS source
    SET status = 'active',
        baseline_revision = v_group.revision,
        started_at = COALESCE(source.started_at, now()),
        stopped_at = NULL,
        stop_reason = NULL,
        last_ingest_at = now(),
        updated_at = now()
    WHERE source.id = v_source.id
    RETURNING source.* INTO v_source;

    UPDATE public.auto_campaigns AS campaign
    SET provisioning_state = 'ready',
        note = CASE
          WHEN COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)
             + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0) = 0
            THEN 'Chờ data phù hợp'
          WHEN campaign.note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
          ELSE campaign.note
        END,
        updated_at = now()
    WHERE campaign.id = v_campaign.id;

    UPDATE public.auto_data_ingest_batches
    SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
    WHERE id = v_batch.id;
    RETURN to_jsonb(v_source);
  END IF;

  SELECT
    count(*)::integer,
    count(DISTINCT campaign.creation_bundle_child_index)::integer,
    min(campaign.creation_bundle_child_index),
    max(campaign.creation_bundle_child_index),
    count(*) FILTER (WHERE
      campaign.staff_id IS DISTINCT FROM p_staff_id
      OR campaign.organization_id IS DISTINCT FROM p_organization_id
      OR COALESCE(campaign.is_delete, false)
      OR campaign.creation_bundle_child_index IS NULL
      OR campaign.creation_bundle_child_index < 0
      OR campaign.creation_bundle_child_index >= v_bundle.expected_campaign_count
    )::integer
  INTO
    v_campaign_count,
    v_child_index_count,
    v_min_child_index,
    v_max_child_index,
    v_invalid_campaign_count
  FROM public.auto_campaigns AS campaign
  WHERE campaign.creation_bundle_id = p_bundle_id;

  SELECT
    count(*)::integer,
    count(DISTINCT source.group_id)::integer,
    count(*) FILTER (WHERE
      source.staff_id IS DISTINCT FROM p_staff_id
      OR source.organization_id IS DISTINCT FROM p_organization_id
      OR source.group_id IS DISTINCT FROM v_group.id
      OR source.status <> 'baselining'
      OR campaign.id IS NULL
      OR campaign.creation_bundle_id IS DISTINCT FROM p_bundle_id
      OR campaign.staff_id IS DISTINCT FROM p_staff_id
      OR campaign.organization_id IS DISTINCT FROM p_organization_id
      OR COALESCE(campaign.is_delete, false)
      OR campaign.data_target_source_mode <> 'data_group'
      OR campaign.data_group_id IS DISTINCT FROM v_group.id
      OR campaign.provisioning_state <> 'staged'
    )::integer
  INTO
    v_registered_count,
    v_distinct_group_count,
    v_invalid_source_count
  FROM public.auto_campaign_data_group_sources AS source
  LEFT JOIN public.auto_campaigns AS campaign ON campaign.id = source.campaign_id
  WHERE source.bundle_id = p_bundle_id;

  IF v_registered_count < v_bundle.expected_campaign_count THEN
    IF v_invalid_source_count <> 0 OR v_distinct_group_count > 1 THEN
      RAISE EXCEPTION 'campaign_creation_bundle_registration_invalid';
    END IF;

    UPDATE public.auto_campaign_creation_bundles AS bundle
    SET ready_campaign_count = 0,
        status = 'staged',
        baseline_revision = NULL,
        updated_at = now()
    WHERE bundle.id = p_bundle_id
    RETURNING bundle.* INTO v_bundle;

    UPDATE public.auto_data_ingest_batches
    SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
    WHERE id = v_batch.id;
    RETURN to_jsonb(v_source);
  END IF;

  IF v_campaign_count <> v_bundle.expected_campaign_count
    OR v_child_index_count <> v_bundle.expected_campaign_count
    OR v_min_child_index <> 0
    OR v_max_child_index <> v_bundle.expected_campaign_count - 1
    OR v_invalid_campaign_count <> 0
    OR v_registered_count <> v_bundle.expected_campaign_count
    OR v_distinct_group_count <> 1
    OR v_invalid_source_count <> 0
  THEN
    RAISE EXCEPTION 'campaign_creation_bundle_registration_invalid';
  END IF;

  -- This update is not externally visible until every snapshot succeeds. It
  -- is intentionally first so the router can distinguish this transaction's
  -- final baseline from ordinary ingest against a staged child.
  UPDATE public.auto_campaign_creation_bundles AS bundle
  SET data_group_id = v_group.id,
      baseline_revision = v_group.revision,
      ready_campaign_count = bundle.expected_campaign_count,
      status = 'ready',
      error = NULL,
      updated_at = now()
  WHERE bundle.id = p_bundle_id
  RETURNING bundle.* INTO v_bundle;

  UPDATE public.auto_campaign_data_group_sources AS source
  SET baseline_revision = v_group.revision,
      status = 'baselining',
      started_at = NULL,
      stopped_at = NULL,
      stop_reason = NULL,
      last_ingest_at = NULL,
      updated_at = now()
  WHERE source.bundle_id = p_bundle_id;

  SELECT count(*)::integer
  INTO v_active_membership_count
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_group.id
    AND member.is_delete = false;

  FOR v_bundle_source IN
    SELECT source.id, source.campaign_id
    FROM public.auto_campaign_data_group_sources AS source
    WHERE source.bundle_id = p_bundle_id
    ORDER BY source.campaign_id, source.id
  LOOP
    v_snapshot := public.aka_agent_internal_route_group_snapshot(
      v_bundle_source.id, v_batch.id, v_group.revision
    );

    IF COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)
         + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0)
         + COALESCE((v_snapshot ->> 'incompatible_count')::integer, 0)
         + COALESCE((v_snapshot ->> 'conflict_count')::integer, 0)
       <> v_active_membership_count
    THEN
      RAISE EXCEPTION 'campaign_creation_bundle_baseline_incomplete';
    END IF;

    UPDATE public.auto_campaigns AS campaign
    SET note = CASE
          WHEN COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)
             + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0) = 0
            THEN 'Chờ data phù hợp'
          WHEN campaign.note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
          ELSE campaign.note
        END,
        updated_at = now()
    WHERE campaign.id = v_bundle_source.campaign_id;
  END LOOP;

  UPDATE public.auto_campaign_data_group_sources AS source
  SET status = 'active',
      baseline_revision = v_group.revision,
      started_at = COALESCE(source.started_at, now()),
      stopped_at = NULL,
      stop_reason = NULL,
      last_ingest_at = now(),
      updated_at = now()
  WHERE source.bundle_id = p_bundle_id;

  UPDATE public.auto_campaigns AS campaign
  SET provisioning_state = 'ready',
      updated_at = now()
  WHERE campaign.creation_bundle_id = p_bundle_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false;

  SELECT source.*
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id;

  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;

  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  SELECT source.* INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  JOIN public.auto_campaigns AS campaign ON campaign.id = source.campaign_id
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE source.campaign_id = p_campaign_id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
            )
          )
        )
      );
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_stop_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_locked_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_hash text;
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
  THEN
    RAISE EXCEPTION 'invalid_data_group_source_request';
  END IF;

  -- Discover immutable lock keys without retaining a row lock.  All state is
  -- revalidated after acquiring the common group -> campaign -> source locks.
  SELECT source.*
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_data_group_source_not_found';
  END IF;

  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_source.group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
            )
          )
        )
      )
  FOR UPDATE OF campaign, account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_campaign_not_found';
  END IF;

  SELECT source.*
  INTO v_locked_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = v_source.id
    AND source.campaign_id = p_campaign_id
    AND source.group_id = v_source.group_id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_data_group_source_changed';
  END IF;
  v_source := v_locked_source;

  v_hash := md5(jsonb_build_object(
    'operation', 'stop_source',
    'campaignId', p_campaign_id,
    'reason', COALESCE(
      NULLIF(btrim(COALESCE(p_reason, '')), ''), 'manual_stop'
    )
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'stop_source', v_source.group_id, v_hash,
    'processing', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT batch.*
    INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'stop_source'
      OR v_batch.request_hash <> v_hash
    THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN
      RETURN v_batch.result;
    END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'stopped',
      stopped_at = COALESCE(stopped_at, now()),
      stop_reason = COALESCE(
        NULLIF(btrim(COALESCE(p_reason, '')), ''), 'manual_stop'
      ),
      updated_at = now()
  WHERE id = v_source.id
  RETURNING * INTO v_source;

  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;

  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_hash text;
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_data_group_source_request';
  END IF;

  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_not_found'; END IF;
  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_source.group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  -- Reactivation routes the existing group snapshot after locking campaign and
  -- source rows. Join the common campaign/input barrier before either of those
  -- row locks so the nested legacy router can re-enter it without inversion.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
              AND COALESCE(account.is_active, true) = true
              AND account.status IN ('chờ xử lý', 'tạm dừng')
            )
          )
        )
      )
  FOR UPDATE OF campaign, account;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.data_group_id IS DISTINCT FROM v_source.group_id
    OR v_campaign.data_target_source_mode <> 'data_group'
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now()) THEN
    RAISE EXCEPTION 'data_group_campaign_terminal';
  END IF;
  -- Re-lock in the shared group -> campaign -> source order used by bind and
  -- intake, then verify the optimistic source read did not change underneath.
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = v_source.id
    AND source.campaign_id = p_campaign_id
    AND source.group_id = v_group.id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_changed'; END IF;
  IF v_source.status <> 'stopped' THEN RETURN to_jsonb(v_source); END IF;

  v_hash := md5(jsonb_build_object(
    'operation', 'reactivate_source', 'campaignId', p_campaign_id,
    'groupId', v_source.group_id
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'reactivate_source', v_source.group_id, v_hash,
    'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'reactivate_source' OR v_batch.request_hash <> v_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'baselining', stopped_at = NULL, stop_reason = NULL, updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  PERFORM public.aka_agent_internal_route_group_snapshot(
    v_source.id, v_batch.id, v_group.revision
  );
  UPDATE public.auto_campaign_data_group_sources
  SET status = 'active', baseline_revision = v_group.revision,
      started_at = COALESCE(started_at, now()), last_ingest_at = now(), updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  UPDATE public.auto_campaigns
  SET status = CASE WHEN status = 'hoàn thành' THEN 'chờ xử lý' ELSE status END,
      completed_at = CASE WHEN status = 'hoàn thành' THEN NULL ELSE completed_at END,
      note = CASE WHEN status = 'hoàn thành' THEN 'Chờ data mới' ELSE note END,
      updated_at = now()
  WHERE id = v_campaign.id;
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;
  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  input_data jsonb,
  origins jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0
    OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_page';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  RETURN QUERY
  WITH filtered AS MATERIALIZED (
    SELECT input_row.*
    FROM public.auto_campaign_input_data AS input_row
    WHERE input_row.campaign_id = p_campaign_id
      AND COALESCE(input_row.is_delete, false) = false
      AND (v_status IS NULL OR input_row.status = v_status)
      AND (p_date_from IS NULL OR input_row.created_at >= p_date_from)
      AND (p_date_to IS NULL OR input_row.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR concat_ws(
          ' ', input_row.id::text, input_row.name, input_row.phone,
          input_row.phone_carrier, input_row.uid, input_row.email,
          input_row.status, input_row.note, input_row.content,
          input_row.info1, input_row.info2, input_row.info3,
          input_row.info4, input_row.info5,
          input_row.canonical_target_key
        ) ILIKE '%' || v_search || '%'
      )
  ), paged AS (
    SELECT filtered.*, count(*) OVER ()::bigint AS page_total_count
    FROM filtered
    ORDER BY filtered.created_at DESC, filtered.id DESC
    OFFSET COALESCE(p_offset, 0)
    LIMIT COALESCE(p_limit, 100)
  )
  SELECT
    to_jsonb(paged) - 'page_total_count' AS input_data,
    COALESCE(origin_page.items, '[]'::jsonb) AS origins,
    paged.page_total_count AS total_count
  FROM paged
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'origin_id', campaign_origin.id,
          'origin_kind', campaign_origin.origin_kind,
          'group_id', contact_group.id,
          'group_name', contact_group.name,
          'group_color', contact_group.color,
          'membership_id', campaign_origin.membership_id,
          'membership_is_delete', group_member.is_delete,
          'membership_change_revision', group_member.change_revision,
          'contact_id', contact.id,
          'contact_name', contact.name,
          'contact_uid', contact.uid,
          'contact_url', contact.url,
          'contact_phone', contact.phone,
          'contact_email', contact.email,
          'contact_type', contact.contact_type,
          'contact_platform', contact.flatform_type,
          'contact_account_id', contact.account_id,
          'source_id', campaign_source.id,
          'source_status', campaign_source.status,
          'source_started_at', campaign_source.started_at,
          'source_stopped_at', campaign_source.stopped_at,
          'source_stop_reason', campaign_source.stop_reason,
          'source_last_ingest_at', campaign_source.last_ingest_at,
          'batch_id', ingest_batch.id,
          'batch_request_id', ingest_batch.request_id,
          'batch_operation', ingest_batch.operation,
          'batch_kind', ingest_batch.kind,
          'batch_source_name', ingest_batch.source_name,
          'batch_source_account_id', ingest_batch.source_account_id,
          'batch_dataset_id', ingest_batch.dataset_id,
          'batch_status', ingest_batch.status,
          'batch_created_at', ingest_batch.created_at,
          'dataset_ids', COALESCE(dataset_page.ids, '[]'::jsonb),
          'dataset_names', COALESCE(dataset_page.names, '[]'::jsonb),
          'datasets', COALESCE(dataset_page.items, '[]'::jsonb),
          'automation_detail_id', automation_detail.id,
          'automation_detail_status', automation_detail.status,
          'automation_id', automation.id,
          'automation_name', automation.name,
          'automation_source_campaign_id', automation_detail.source_campaign_id,
          'automation_source_campaign_name', automation_source_campaign.name,
          'automation_target_campaign_id', automation_detail.target_campaign_id,
          'automation_target_campaign_name', automation_target_campaign.name,
          'member_origins', COALESCE(member_origin_page.items, '[]'::jsonb),
          'group_revision', campaign_origin.group_revision,
          'canonical_target_key', campaign_origin.canonical_target_key,
          'payload_snapshot', campaign_origin.payload_snapshot,
          'created_at', campaign_origin.created_at
        ))
        ORDER BY campaign_origin.created_at, campaign_origin.id
      ),
      '[]'::jsonb
    ) AS items
    FROM public.auto_campaign_input_origins AS campaign_origin
    LEFT JOIN public.auto_campaign_data_group_sources AS campaign_source
      ON campaign_source.id = campaign_origin.source_id
     AND campaign_source.campaign_id = p_campaign_id
     AND campaign_source.staff_id = p_staff_id
     AND campaign_source.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = COALESCE(campaign_origin.group_id, campaign_source.group_id)
     AND contact_group.staff_id = p_staff_id
     AND contact_group.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_group_members AS group_member
      ON group_member.id = campaign_origin.membership_id
     AND group_member.group_id = contact_group.id
    LEFT JOIN public.auto_account_contacts AS contact
      ON contact.id = group_member.contact_id
     AND contact.staff_id = p_staff_id
     AND contact.organization_id = p_organization_id
    LEFT JOIN public.auto_data_ingest_batches AS ingest_batch
      ON ingest_batch.id = campaign_origin.batch_id
     AND ingest_batch.staff_id = p_staff_id
     AND ingest_batch.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT member_origin.automation_detail_id
      FROM public.auto_account_contact_group_member_origins AS member_origin
      WHERE member_origin.membership_id = campaign_origin.membership_id
        AND member_origin.automation_detail_id IS NOT NULL
        AND member_origin.batch_id IS NOT DISTINCT FROM campaign_origin.batch_id
      ORDER BY
        member_origin.is_current DESC,
        member_origin.created_at DESC,
        member_origin.id DESC
      LIMIT 1
    ) AS preferred_automation_origin ON true
    LEFT JOIN public.auto_automation_detail AS automation_detail
      ON automation_detail.id = COALESCE(
        campaign_origin.automation_detail_id,
        preferred_automation_origin.automation_detail_id
      )
     AND automation_detail.staff_id = p_staff_id
     AND automation_detail.organization_id = p_organization_id
    LEFT JOIN public.auto_automation AS automation
      ON automation.id = automation_detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_source_campaign
      ON automation_source_campaign.id = automation_detail.source_campaign_id
     AND automation_source_campaign.staff_id = p_staff_id
     AND automation_source_campaign.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_target_campaign
      ON automation_target_campaign.id = automation_detail.target_campaign_id
     AND automation_target_campaign.staff_id = p_staff_id
     AND automation_target_campaign.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(jsonb_agg(dataset_row.id ORDER BY dataset_row.id), '[]'::jsonb) AS ids,
        COALESCE(jsonb_agg(dataset_row.name ORDER BY dataset_row.id), '[]'::jsonb) AS names,
        COALESCE(jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', dataset_row.id,
            'name', dataset_row.name,
            'source', dataset_row.source,
            'scan_type', dataset_row.scan_type,
            'source_key', dataset_row.source_key,
            'last_scan_status', dataset_row.last_scan_status,
            'is_delete', dataset_row.is_delete,
            'created_at', dataset_row.created_at
          )) ORDER BY dataset_row.id
        ), '[]'::jsonb) AS items
      FROM (
        SELECT
          dataset.id, dataset.name, dataset.source, dataset.scan_type,
          dataset.source_key, dataset.last_scan_status, dataset.is_delete,
          dataset.created_at
        FROM public.auto_account_contacts_dataset AS dataset
        WHERE dataset.id = ingest_batch.dataset_id
          AND dataset.staff_id = p_staff_id
          AND dataset.organization_id = p_organization_id
        UNION
        SELECT
          dataset.id, dataset.name, dataset.source, dataset.scan_type,
          dataset.source_key, dataset.last_scan_status, dataset.is_delete,
          dataset.created_at
        FROM public.auto_account_contact_group_member_origins AS member_origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = member_origin.dataset_id
         AND dataset.staff_id = p_staff_id
         AND dataset.organization_id = p_organization_id
        WHERE member_origin.membership_id = campaign_origin.membership_id
      ) AS dataset_row
    ) AS dataset_page ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', member_origin.id,
            'kind', member_origin.kind,
            'dataset_id', origin_dataset.id,
            'dataset_name', origin_dataset.name,
            'batch_id', origin_batch.id,
            'batch_request_id', origin_batch.request_id,
            'source_account_id', member_origin.source_account_id,
            'source_name', member_origin.source_name_snapshot,
            'is_current', member_origin.is_current,
            'automation_detail_id', member_automation_detail.id,
            'automation_detail_status', member_automation_detail.status,
            'automation_id', member_automation.id,
            'automation_name', member_automation.name,
            'source_campaign_id', member_automation_detail.source_campaign_id,
            'source_campaign_name', member_source_campaign.name,
            'target_campaign_id', member_automation_detail.target_campaign_id,
            'target_campaign_name', member_target_campaign.name,
            'created_at', member_origin.created_at,
            'updated_at', member_origin.updated_at
          ))
          ORDER BY member_origin.created_at, member_origin.id
        ),
        '[]'::jsonb
      ) AS items
      FROM public.auto_account_contact_group_member_origins AS member_origin
      LEFT JOIN public.auto_account_contacts_dataset AS origin_dataset
        ON origin_dataset.id = member_origin.dataset_id
       AND origin_dataset.staff_id = p_staff_id
       AND origin_dataset.organization_id = p_organization_id
      LEFT JOIN public.auto_data_ingest_batches AS origin_batch
        ON origin_batch.id = member_origin.batch_id
       AND origin_batch.staff_id = p_staff_id
       AND origin_batch.organization_id = p_organization_id
      LEFT JOIN public.auto_automation_detail AS member_automation_detail
        ON member_automation_detail.id = member_origin.automation_detail_id
       AND member_automation_detail.staff_id = p_staff_id
       AND member_automation_detail.organization_id = p_organization_id
      LEFT JOIN public.auto_automation AS member_automation
        ON member_automation.id = member_automation_detail.automation_id
       AND member_automation.staff_id = p_staff_id
       AND member_automation.organization_id = p_organization_id
      LEFT JOIN public.auto_campaigns AS member_source_campaign
        ON member_source_campaign.id = member_automation_detail.source_campaign_id
       AND member_source_campaign.staff_id = p_staff_id
       AND member_source_campaign.organization_id = p_organization_id
      LEFT JOIN public.auto_campaigns AS member_target_campaign
        ON member_target_campaign.id = member_automation_detail.target_campaign_id
       AND member_target_campaign.staff_id = p_staff_id
       AND member_target_campaign.organization_id = p_organization_id
      WHERE member_origin.membership_id = campaign_origin.membership_id
    ) AS member_origin_page ON true
    WHERE campaign_origin.input_data_id = paged.id
  ) AS origin_page ON true
  ORDER BY paged.created_at DESC, paged.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text,
  p_status text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_origin_filter text,
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  input_data jsonb,
  origins jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_origin_filter text := lower(NULLIF(btrim(COALESCE(p_origin_filter, '')), ''));
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  v_origin_filter := COALESCE(v_origin_filter, 'all');
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0
    OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_page';
  END IF;
  IF v_origin_filter NOT IN ('all', 'data_group', 'automation', 'manual_or_api', 'direct') THEN
    RAISE EXCEPTION 'invalid_campaign_input_origin_filter';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  RETURN QUERY
  WITH filtered AS MATERIALIZED (
    SELECT input_row.*
    FROM public.auto_campaign_input_data AS input_row
    WHERE input_row.campaign_id = p_campaign_id
      AND COALESCE(input_row.is_delete, false) = false
      AND (v_status IS NULL OR input_row.status = v_status)
      AND (p_date_from IS NULL OR input_row.created_at >= p_date_from)
      AND (p_date_to IS NULL OR input_row.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR concat_ws(
          ' ', input_row.id::text, input_row.name, input_row.phone,
          input_row.phone_carrier, input_row.uid, input_row.email,
          input_row.status, input_row.note, input_row.content,
          input_row.info1, input_row.info2, input_row.info3,
          input_row.info4, input_row.info5,
          input_row.canonical_target_key
        ) ILIKE '%' || v_search || '%'
      )
      AND (
        v_origin_filter = 'all'
        OR (
          v_origin_filter = 'data_group'
          AND EXISTS (
            SELECT 1
            FROM public.auto_campaign_input_origins AS origin
            WHERE origin.input_data_id = input_row.id
              AND origin.origin_kind = 'group'
          )
        )
        OR (
          v_origin_filter = 'automation'
          AND (
            input_row.auto_automation_detail_id IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind = 'automation'
            )
            OR EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              JOIN public.auto_account_contact_group_member_origins AS member_origin
                ON member_origin.membership_id = origin.membership_id
               AND member_origin.kind = 'automation'
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind = 'group'
            )
          )
        )
        OR (
          v_origin_filter = 'manual_or_api'
          AND (
            EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind IN ('manual', 'api')
            )
            OR EXISTS (
              SELECT 1
              FROM public.auto_campaign_input_origins AS origin
              JOIN public.auto_account_contact_group_member_origins AS member_origin
                ON member_origin.membership_id = origin.membership_id
               AND member_origin.kind IN ('manual', 'api')
              WHERE origin.input_data_id = input_row.id
                AND origin.origin_kind = 'group'
            )
          )
        )
        OR (
          v_origin_filter = 'direct'
          AND input_row.auto_automation_detail_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.auto_campaign_input_origins AS origin
            WHERE origin.input_data_id = input_row.id
          )
        )
      )
  ), paged AS (
    SELECT filtered.*, count(*) OVER ()::bigint AS page_total_count
    FROM filtered
    ORDER BY filtered.created_at DESC, filtered.id DESC
    OFFSET COALESCE(p_offset, 0)
    LIMIT COALESCE(p_limit, 100)
  )
  SELECT
    to_jsonb(paged) - 'page_total_count' AS input_data,
    COALESCE(origin_page.items, '[]'::jsonb) AS origins,
    paged.page_total_count AS total_count
  FROM paged
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'origin_id', campaign_origin.id,
          'origin_kind', campaign_origin.origin_kind,
          'group_id', contact_group.id,
          'group_name', contact_group.name,
          'group_color', contact_group.color,
          'membership_id', campaign_origin.membership_id,
          'membership_is_delete', group_member.is_delete,
          'contact_id', contact.id,
          'contact_name', contact.name,
          'source_id', campaign_source.id,
          'source_status', campaign_source.status,
          'batch_id', ingest_batch.id,
          'batch_kind', ingest_batch.kind,
          'batch_source_name', ingest_batch.source_name,
          'dataset_ids', COALESCE(dataset_page.ids, '[]'::jsonb),
          'dataset_names', COALESCE(dataset_page.names, '[]'::jsonb),
          'automation_detail_id', automation_detail.id,
          'automation_id', automation.id,
          'automation_name', automation.name,
          'automation_source_campaign_id', automation_detail.source_campaign_id,
          'automation_source_campaign_name', automation_source_campaign.name,
          'automation_target_campaign_id', automation_detail.target_campaign_id,
          'automation_target_campaign_name', automation_target_campaign.name,
          'canonical_target_key', campaign_origin.canonical_target_key,
          'created_at', campaign_origin.created_at
        ))
        ORDER BY campaign_origin.created_at, campaign_origin.id
      ),
      '[]'::jsonb
    ) AS items
    FROM public.auto_campaign_input_origins AS campaign_origin
    LEFT JOIN public.auto_campaign_data_group_sources AS campaign_source
      ON campaign_source.id = campaign_origin.source_id
     AND campaign_source.campaign_id = p_campaign_id
     AND campaign_source.staff_id = p_staff_id
     AND campaign_source.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = COALESCE(campaign_origin.group_id, campaign_source.group_id)
     AND contact_group.staff_id = p_staff_id
     AND contact_group.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_group_members AS group_member
      ON group_member.id = campaign_origin.membership_id
     AND group_member.group_id = contact_group.id
    LEFT JOIN public.auto_account_contacts AS contact
      ON contact.id = group_member.contact_id
     AND contact.staff_id = p_staff_id
     AND contact.organization_id = p_organization_id
    LEFT JOIN public.auto_data_ingest_batches AS ingest_batch
      ON ingest_batch.id = campaign_origin.batch_id
     AND ingest_batch.staff_id = p_staff_id
     AND ingest_batch.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT member_origin.automation_detail_id
      FROM public.auto_account_contact_group_member_origins AS member_origin
      WHERE member_origin.membership_id = campaign_origin.membership_id
        AND member_origin.automation_detail_id IS NOT NULL
      ORDER BY member_origin.is_current DESC, member_origin.created_at DESC, member_origin.id DESC
      LIMIT 1
    ) AS preferred_automation_origin ON true
    LEFT JOIN public.auto_automation_detail AS automation_detail
      ON automation_detail.id = COALESCE(
        campaign_origin.automation_detail_id,
        preferred_automation_origin.automation_detail_id
      )
     AND automation_detail.staff_id = p_staff_id
     AND automation_detail.organization_id = p_organization_id
    LEFT JOIN public.auto_automation AS automation
      ON automation.id = automation_detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_source_campaign
      ON automation_source_campaign.id = automation_detail.source_campaign_id
     AND automation_source_campaign.staff_id = p_staff_id
     AND automation_source_campaign.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_target_campaign
      ON automation_target_campaign.id = automation_detail.target_campaign_id
     AND automation_target_campaign.staff_id = p_staff_id
     AND automation_target_campaign.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(jsonb_agg(dataset_row.id ORDER BY dataset_row.id), '[]'::jsonb) AS ids,
        COALESCE(jsonb_agg(dataset_row.name ORDER BY dataset_row.id), '[]'::jsonb) AS names
      FROM (
        SELECT dataset.id, dataset.name
        FROM public.auto_account_contacts_dataset AS dataset
        WHERE dataset.id = ingest_batch.dataset_id
          AND dataset.staff_id = p_staff_id
          AND dataset.organization_id = p_organization_id
        UNION
        SELECT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS member_origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = member_origin.dataset_id
         AND dataset.staff_id = p_staff_id
         AND dataset.organization_id = p_organization_id
        WHERE member_origin.membership_id = campaign_origin.membership_id
      ) AS dataset_row
    ) AS dataset_page ON true
    WHERE campaign_origin.input_data_id = paged.id
  ) AS origin_page ON true
  ORDER BY paged.created_at DESC, paged.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_group_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (allowed boolean, reason text, canonical_count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM set_config('aka_agent.zalo_runtime_target', 'desktop', true);
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_preflight_campaign_data_group_change(
      p_staff_id, p_organization_id, p_campaign_id, p_group_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_bind_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_bundle_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM set_config('aka_agent.zalo_runtime_target', 'desktop', true);
  BEGIN
    v_result := public.aka_agent_bind_campaign_data_group_source(
      p_staff_id, p_organization_id, p_request_id, p_campaign_id,
      p_group_id, p_bundle_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM set_config('aka_agent.zalo_runtime_target', 'desktop', true);
  BEGIN
    v_result := public.aka_agent_get_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_stop_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM set_config('aka_agent.zalo_runtime_target', 'desktop', true);
  BEGIN
    v_result := public.aka_agent_stop_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id, p_request_id, p_reason
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM set_config('aka_agent.zalo_runtime_target', 'desktop', true);
  BEGIN
    v_result := public.aka_agent_reactivate_campaign_data_group_source(
      p_staff_id, p_organization_id, p_campaign_id, p_request_id, p_reason
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text,
  p_status text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (input_data jsonb, origins jsonb, total_count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM set_config('aka_agent.zalo_runtime_target', 'desktop', true);
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_list_campaign_input_data_page(
      p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_offset, p_limit
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text,
  p_status text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_origin_filter text,
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (input_data jsonb, origins jsonb, total_count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_previous_target text := current_setting(
    'aka_agent.zalo_runtime_target', true
  );
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  PERFORM set_config('aka_agent.zalo_runtime_target', 'desktop', true);
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.aka_agent_list_campaign_input_data_page(
      p_staff_id, p_organization_id, p_campaign_id, p_search, p_status,
      p_date_from, p_date_to, p_origin_filter, p_offset, p_limit
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'aka_agent.zalo_runtime_target', COALESCE(v_previous_target, ''), true
  );
  RETURN;
END;
$function$;

-- Service implementations default to the Server runtime; credentialed
-- overloads explicitly switch to the desktop-local runtime for one call.
REVOKE ALL ON FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  bigint, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  bigint, bigint, bigint, bigint
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  bigint, bigint, bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  bigint, bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_bind_campaign_data_group_source(
  bigint, bigint, text, bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_get_campaign_data_group_source(
  bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_campaign_data_group_source(
  bigint, bigint, bigint
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_get_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_stop_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  bigint, bigint, bigint, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  bigint, bigint, bigint, text, text, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz, integer, integer
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  integer, integer, text, text
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  text, integer, integer
) TO service_role;
REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  text, integer, integer, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  text, integer, integer, text, text
) TO anon, authenticated, service_role;

-- Atomic Web mutations for Zalo account groups and proxies. Account assignment
-- changes take the matching shared advisory lock through the trigger above.
CREATE OR REPLACE FUNCTION public.update_control_zalo_account_group_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_group public.auto_account_groups%ROWTYPE;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_group_id IS NULL OR p_group_id <= 0
    OR p_expected_updated_at IS NULL
    OR jsonb_typeof(v_patch) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_group_update';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(v_patch) AS patch_key(key_name)
    WHERE patch_key.key_name NOT IN ('name', 'settings', 'is_active', 'isActive')
  ) OR (v_patch ? 'is_active' AND v_patch ? 'isActive') THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_group_patch';
  END IF;
  IF v_patch ? 'name' AND (
    NULLIF(btrim(COALESCE(v_patch->>'name', '')), '') IS NULL
    OR length(btrim(v_patch->>'name')) > 250
  ) THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_group_name';
  END IF;
  IF v_patch ? 'settings'
    AND jsonb_typeof(v_patch->'settings') <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_group_settings';
  END IF;
  IF (v_patch ? 'is_active' AND jsonb_typeof(v_patch->'is_active') <> 'boolean')
    OR (v_patch ? 'isActive' AND jsonb_typeof(v_patch->'isActive') <> 'boolean')
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_group_active';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'control-zalo-account-group:' || p_group_id::text, 0
  ));

  SELECT account_group.*
  INTO v_group
  FROM public.auto_account_groups AS account_group
  WHERE account_group.id = p_group_id
    AND account_group.staff_id = p_staff_id
    AND account_group.organization_id = p_organization_id
    AND account_group.flatform_type = 'zalo'
    AND COALESCE(account_group.is_delete, false) = false
  FOR UPDATE OF account_group;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;
  IF v_group.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.account_group_id = p_group_id
      AND COALESCE(account.is_delete, false) = false
      AND lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
      AND NOT (
        COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
  ) THEN
    RETURN jsonb_build_object(
      'updated', false,
      'reason', 'account_group_used_by_local_zalo'
    );
  END IF;

  UPDATE public.auto_account_groups AS account_group
  SET
    name = CASE
      WHEN v_patch ? 'name' THEN btrim(v_patch->>'name')
      ELSE account_group.name
    END,
    settings = CASE
      WHEN v_patch ? 'settings' THEN v_patch->'settings'
      ELSE account_group.settings
    END,
    is_active = CASE
      WHEN v_patch ? 'is_active' THEN (v_patch->>'is_active')::boolean
      WHEN v_patch ? 'isActive' THEN (v_patch->>'isActive')::boolean
      ELSE account_group.is_active
    END,
    updated_at = now()
  WHERE account_group.id = p_group_id
    AND account_group.staff_id = p_staff_id
    AND account_group.organization_id = p_organization_id
    AND account_group.flatform_type = 'zalo'
    AND COALESCE(account_group.is_delete, false) = false
    AND account_group.updated_at IS NOT DISTINCT FROM p_expected_updated_at
  RETURNING account_group.* INTO v_group;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  RETURN jsonb_build_object(
    'updated', true,
    'row', jsonb_build_object(
      'id', v_group.id,
      'name', v_group.name,
      'flatform_type', v_group.flatform_type,
      'settings', v_group.settings,
      'is_active', v_group.is_active,
      'created_at', v_group.created_at,
      'updated_at', v_group.updated_at
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_control_zalo_account_group_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_group public.auto_account_groups%ROWTYPE;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_group_id IS NULL OR p_group_id <= 0
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_group_delete';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'control-zalo-account-group:' || p_group_id::text, 0
  ));
  SELECT account_group.*
  INTO v_group
  FROM public.auto_account_groups AS account_group
  WHERE account_group.id = p_group_id
    AND account_group.staff_id = p_staff_id
    AND account_group.organization_id = p_organization_id
    AND account_group.flatform_type = 'zalo'
    AND COALESCE(account_group.is_delete, false) = false
  FOR UPDATE OF account_group;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.account_group_id = p_group_id
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'reason', 'account_group_in_use'
    );
  END IF;

  UPDATE public.auto_account_groups AS account_group
  SET is_delete = true, updated_at = now()
  WHERE account_group.id = p_group_id
    AND account_group.staff_id = p_staff_id
    AND account_group.organization_id = p_organization_id
    AND account_group.flatform_type = 'zalo'
    AND COALESCE(account_group.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('deleted', true, 'group_id', p_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_control_zalo_proxy_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_proxy_id bigint,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_proxy public.auto_proxies%ROWTYPE;
  v_usage_count integer := 0;
  v_port integer;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_proxy_id IS NULL OR p_proxy_id <= 0
    OR p_expected_updated_at IS NULL
    OR jsonb_typeof(v_patch) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_proxy_update';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(v_patch) AS patch_key(key_name)
    WHERE patch_key.key_name NOT IN (
      'name', 'protocol', 'host', 'port', 'username', 'password',
      'is_active', 'isActive'
    )
  ) OR (v_patch ? 'is_active' AND v_patch ? 'isActive') THEN
    RAISE EXCEPTION 'invalid_control_zalo_proxy_patch';
  END IF;
  IF v_patch ? 'name' AND (
    NULLIF(btrim(COALESCE(v_patch->>'name', '')), '') IS NULL
    OR length(btrim(v_patch->>'name')) > 250
  ) THEN
    RAISE EXCEPTION 'invalid_control_zalo_proxy_name';
  END IF;
  IF v_patch ? 'host'
    AND NULLIF(btrim(COALESCE(v_patch->>'host', '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_proxy_host';
  END IF;
  IF v_patch ? 'protocol'
    AND COALESCE(v_patch->>'protocol', '') NOT IN ('http', 'https', 'socks5')
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_proxy_protocol';
  END IF;
  IF v_patch ? 'port' THEN
    IF jsonb_typeof(v_patch->'port') <> 'number'
      OR (v_patch->>'port') !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION 'invalid_control_zalo_proxy_port';
    END IF;
    BEGIN
      v_port := (v_patch->>'port')::integer;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_control_zalo_proxy_port';
    END;
    IF v_port NOT BETWEEN 1 AND 65535 THEN
      RAISE EXCEPTION 'invalid_control_zalo_proxy_port';
    END IF;
  END IF;
  IF (v_patch ? 'is_active' AND jsonb_typeof(v_patch->'is_active') <> 'boolean')
    OR (v_patch ? 'isActive' AND jsonb_typeof(v_patch->'isActive') <> 'boolean')
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_proxy_active';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'control-zalo-proxy:' || p_proxy_id::text, 0
  ));

  SELECT proxy.*
  INTO v_proxy
  FROM public.auto_proxies AS proxy
  WHERE proxy.id = p_proxy_id
    AND proxy.staff_id = p_staff_id
    AND proxy.organization_id = p_organization_id
    AND COALESCE(proxy.is_delete, false) = false
  FOR UPDATE OF proxy;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;
  IF v_proxy.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.proxy_id = p_proxy_id
      AND COALESCE(account.is_delete, false) = false
      AND NOT (
        lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
      )
  ) THEN
    RETURN jsonb_build_object(
      'updated', false,
      'reason', 'proxy_used_by_non_server_account'
    );
  END IF;

  UPDATE public.auto_proxies AS proxy
  SET
    name = CASE
      WHEN v_patch ? 'name' THEN btrim(v_patch->>'name')
      ELSE proxy.name
    END,
    protocol = CASE
      WHEN v_patch ? 'protocol' THEN v_patch->>'protocol'
      ELSE proxy.protocol
    END,
    host = CASE
      WHEN v_patch ? 'host' THEN btrim(v_patch->>'host')
      ELSE proxy.host
    END,
    port = CASE
      WHEN v_patch ? 'port' THEN v_port
      ELSE proxy.port
    END,
    username = CASE
      WHEN v_patch ? 'username' THEN v_patch->>'username'
      ELSE proxy.username
    END,
    password = CASE
      WHEN v_patch ? 'password' THEN v_patch->>'password'
      ELSE proxy.password
    END,
    is_active = CASE
      WHEN v_patch ? 'is_active' THEN (v_patch->>'is_active')::boolean
      WHEN v_patch ? 'isActive' THEN (v_patch->>'isActive')::boolean
      ELSE proxy.is_active
    END,
    updated_at = now()
  WHERE proxy.id = p_proxy_id
    AND proxy.staff_id = p_staff_id
    AND proxy.organization_id = p_organization_id
    AND COALESCE(proxy.is_delete, false) = false
    AND proxy.updated_at IS NOT DISTINCT FROM p_expected_updated_at
  RETURNING proxy.* INTO v_proxy;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  SELECT count(*)::integer
  INTO v_usage_count
  FROM public.auto_accounts AS account
  WHERE account.proxy_id = p_proxy_id
    AND COALESCE(account.is_delete, false) = false;

  RETURN jsonb_build_object(
    'updated', true,
    'row', jsonb_build_object(
      'id', v_proxy.id,
      'name', v_proxy.name,
      'protocol', v_proxy.protocol,
      'host', v_proxy.host,
      'port', v_proxy.port,
      'username', v_proxy.username,
      'password', v_proxy.password,
      'is_active', v_proxy.is_active,
      'usage_count', v_usage_count,
      'created_at', v_proxy.created_at,
      'updated_at', v_proxy.updated_at
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_control_zalo_proxy_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_proxy_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_proxy public.auto_proxies%ROWTYPE;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_proxy_id IS NULL OR p_proxy_id <= 0
  THEN
    RAISE EXCEPTION 'invalid_control_zalo_proxy_delete';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'control-zalo-proxy:' || p_proxy_id::text, 0
  ));
  SELECT proxy.*
  INTO v_proxy
  FROM public.auto_proxies AS proxy
  WHERE proxy.id = p_proxy_id
    AND proxy.staff_id = p_staff_id
    AND proxy.organization_id = p_organization_id
    AND COALESCE(proxy.is_delete, false) = false
  FOR UPDATE OF proxy;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.proxy_id = p_proxy_id
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'proxy_in_use');
  END IF;

  UPDATE public.auto_proxies AS proxy
  SET is_delete = true, updated_at = now()
  WHERE proxy.id = p_proxy_id
    AND proxy.staff_id = p_staff_id
    AND proxy.organization_id = p_organization_id
    AND COALESCE(proxy.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('deleted', true, 'proxy_id', p_proxy_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_control_zalo_account_group_atomic(
  bigint, bigint, bigint, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_control_zalo_account_group_atomic(
  bigint, bigint, bigint, timestamptz, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION public.delete_control_zalo_account_group_atomic(
  bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_control_zalo_account_group_atomic(
  bigint, bigint, bigint
) TO service_role;
REVOKE ALL ON FUNCTION public.update_control_zalo_proxy_atomic(
  bigint, bigint, bigint, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_control_zalo_proxy_atomic(
  bigint, bigint, bigint, timestamptz, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION public.delete_control_zalo_proxy_atomic(
  bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_control_zalo_proxy_atomic(
  bigint, bigint, bigint
) TO service_role;

COMMENT ON FUNCTION public.resolve_organization_zalo_account_capabilities(bigint) IS
  'Resolve one newest effective Product 16/18 row with additive QR/Web/Server account capabilities, shared quota and opaque revision.';
COMMENT ON FUNCTION public.get_staff_zalo_account_capabilities(bigint) IS
  'Return additive QR/Web/Server account capabilities for one active staff; legacy global-mode RPC remains unchanged.';
COMMENT ON FUNCTION public.discover_zalo_server_account_runtime_users(bigint, integer) IS
  'Keyset-discover active staff with additive Server capability, including organizations that simultaneously grant Web.';
COMMENT ON FUNCTION public.inspect_staff_zalo_running_state(bigint) IS
  'Inspect only durable Server-subtype Zalo running state; local QR/Web work does not block Server drain.';
COMMENT ON FUNCTION public.recover_server_zalo_running_state(bigint, text, boolean) IS
  'Recover only Server-subtype Zalo state. Startup validates additive capability/revision; cleanup remains available after entitlement loss.';
COMMENT ON FUNCTION public.reset_desktop_running_statuses(bigint, boolean, boolean) IS
  'Recover only non-Server accounts. Legacy exclude_zalo remains in the wire result but no longer overrides per-account ownership.';
COMMENT ON FUNCTION public.claim_campaign_runtime(bigint, bigint, bigint, text) IS
  'Atomically claim a campaign only when the runtime target owns the account subtype and the corresponding additive capability is live.';
COMMENT ON FUNCTION public.claim_zalo_account_runtime_operation(bigint, bigint, text, boolean) IS
  'Legacy account-operation claim with per-account ownership and running campaign/input/input-data guards.';
COMMENT ON FUNCTION public.release_zalo_account_runtime_operation(bigint, bigint, text, text) IS
  'Legacy account-operation release restricted to the runtime owning the current account subtype; capability loss does not block cleanup.';
COMMENT ON FUNCTION public.claim_zalo_account_runtime_operation(bigint, bigint, text, text, uuid, boolean) IS
  'Tokenized Zalo account-operation claim for safe subtype conversion; supports inactive accounts when login is not required and rejects related running work.';
COMMENT ON FUNCTION public.release_zalo_account_runtime_operation(bigint, bigint, text, text, uuid) IS
  'Release only the matching tokenized Zalo account claim, including after an atomic subtype update.';
COMMENT ON FUNCTION public.create_control_zalo_account_atomic(bigint, bigint, integer, jsonb) IS
  'Create Server-subtype Zalo accounts only; QR/Web/Server use one shared quota from the selected Product 16/18 row.';
COMMENT ON FUNCTION public.enqueue_campaign_zalo_realtime_group_event(
  bigint, bigint, bigint, text, text, text, text, text, text,
  timestamptz, timestamptz, jsonb
) IS
  'Enqueue realtime events only for the QR account subtype owned by the caller runtime.';
COMMENT ON FUNCTION public.aka_agent_internal_require_zalo_server_data_group_runtime(bigint, bigint, text) IS
  'Validate additive Server capability/revision for narrow Zalo Server Data Group finalizers.';
COMMENT ON FUNCTION public.aka_agent_internal_require_zalo_server_runtime(bigint, bigint, text) IS
  'Validate additive Server capability/revision for narrow Zalo Server maintenance finalizers.';
COMMENT ON FUNCTION public.aka_agent_internal_finalize_zalo_server_maintenance_guard(
  bigint, bigint, bigint, text, boolean, text
) IS
  'Finalize maintenance only for a direct campaign whose account is explicitly Server-owned.';
COMMENT ON FUNCTION public.aka_agent_finalize_zalo_server_maintenance_campaign(
  bigint, bigint, text, bigint, text, boolean
) IS
  'Finalize one stale direct campaign only when its account is explicitly Server-owned and the additive capability revision is live.';

REVOKE ALL ON FUNCTION public.normalize_legacy_zalo_account_server_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_legacy_zalo_account_server_owner()
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_organization_zalo_account_capabilities(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_organization_zalo_account_capabilities(bigint)
  TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_staff_zalo_account_capabilities(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_zalo_account_capabilities(bigint)
  TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.discover_zalo_server_account_runtime_users(bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discover_zalo_server_account_runtime_users(bigint, integer)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, boolean
) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_zalo_account_runtime_operation(
  bigint, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_zalo_account_runtime_operation(
  bigint, bigint, text, text
) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, text, uuid, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_zalo_account_runtime_operation(
  bigint, bigint, text, text, uuid, boolean
) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_zalo_account_runtime_operation(
  bigint, bigint, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_zalo_account_runtime_operation(
  bigint, bigint, text, text, uuid
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
