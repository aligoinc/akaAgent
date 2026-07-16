-- Zalo Web reuses the desktop browser profile.
-- Changing runtime mode is applied only after the desktop/server app restarts.

BEGIN;

ALTER TABLE public.org_organization_product
  ADD COLUMN IF NOT EXISTS is_zalo_show_web boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_organization_product.is_zalo_show_web IS
  'Open Zalo Web in the desktop browser profile. When enabled, Zalo Server is disabled.';

-- Clean up columns from the abandoned draft. Browser cookies stay in the
-- Electron partition persist:account_<id>, exactly like Facebook.
ALTER TABLE public.org_staff
  DROP COLUMN IF EXISTS zalo_web_session_cleanup_pending,
  DROP COLUMN IF EXISTS zalo_web_session_owner_device_hash,
  DROP COLUMN IF EXISTS zalo_web_session_owner_revision,
  DROP COLUMN IF EXISTS zalo_web_session_marked_at;

-- Keep the stored flags mutually exclusive so every existing runtime RPC that
-- already reads is_zalo_server continues to have one unambiguous owner.
UPDATE public.org_organization_product
SET is_zalo_server = false
WHERE is_zalo_show_web = true
  AND is_zalo_server = true;

CREATE OR REPLACE FUNCTION public.normalize_zalo_runtime_mode_flags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF COALESCE(NEW.is_zalo_show_web, false) THEN
    NEW.is_zalo_server := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_zalo_runtime_mode_flags
  ON public.org_organization_product;

CREATE TRIGGER trg_normalize_zalo_runtime_mode_flags
BEFORE INSERT OR UPDATE OF is_zalo_server, is_zalo_show_web
ON public.org_organization_product
FOR EACH ROW
EXECUTE FUNCTION public.normalize_zalo_runtime_mode_flags();

CREATE OR REPLACE FUNCTION public.get_staff_zalo_runtime_mode(
  p_staff_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
DECLARE
  v_organization_id bigint;
  v_entitlement_id bigint;
  v_entitlement_xmin text;
  v_is_zalo_server boolean := false;
  v_is_zalo_show_web boolean := false;
  v_revision text;
  v_vietnam_day_start timestamptz := (
    date_trunc('day', timezone('Asia/Ho_Chi_Minh', now()))
      AT TIME ZONE 'Asia/Ho_Chi_Minh'
  );
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

  SELECT
    entitlement.id,
    COALESCE(entitlement.is_zalo_server, false),
    COALESCE(entitlement.is_zalo_show_web, false),
    entitlement.xmin::text
  INTO
    v_entitlement_id,
    v_is_zalo_server,
    v_is_zalo_show_web,
    v_entitlement_xmin
  FROM public.org_organization_product AS entitlement
  WHERE entitlement.organization_id = v_organization_id
    AND entitlement.product_id IN (16, 18)
    AND entitlement.is_deleted = false
    AND entitlement.expiration_date IS NOT NULL
    AND entitlement.expiration_date >= v_vietnam_day_start
  ORDER BY entitlement.created_at DESC NULLS LAST, entitlement.id DESC
  LIMIT 1;

  v_is_zalo_show_web := COALESCE(v_is_zalo_show_web, false);
  v_is_zalo_server := COALESCE(v_is_zalo_server, false) AND NOT v_is_zalo_show_web;
  v_revision := CASE
    WHEN v_entitlement_id IS NULL THEN 'none:' || v_organization_id::text
    ELSE v_entitlement_id::text || ':' || v_entitlement_xmin
  END;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'is_zalo_server', v_is_zalo_server,
    'is_zalo_show_web', v_is_zalo_show_web,
    'revision', v_revision
  );
END;
$$;

COMMENT ON FUNCTION public.get_staff_zalo_runtime_mode(bigint) IS
  'Return the Zalo runtime selected for this app session. Mode changes require an app restart.';

COMMIT;
