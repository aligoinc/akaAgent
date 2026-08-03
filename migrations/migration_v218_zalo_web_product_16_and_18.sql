-- Product 16 and Product 18 may opt into Zalo Web. Runtime capability comes
-- from exactly one effective row: the newest row across both products.

BEGIN;

COMMENT ON COLUMN public.org_organization_product.is_zalo_show_web IS
  'Products 16 and 18 only. The newest effective row across both products always grants Zalo QR; true additionally grants Zalo Web. Web takes runtime precedence over Server without clearing is_zalo_server.';

-- Abort with a precise error instead of silently rewriting an entitlement
-- whose Web flag belongs to a non-Zalo product.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.org_organization_product
    WHERE COALESCE(is_zalo_show_web, false) = true
      AND product_id IS DISTINCT FROM 16
      AND product_id IS DISTINCT FROM 18
  ) THEN
    RAISE EXCEPTION 'invalid_zalo_web_product_row';
  END IF;
END;
$preflight$;

ALTER TABLE public.org_organization_product
  DROP CONSTRAINT IF EXISTS chk_org_product_zalo_show_web_product16_18;
ALTER TABLE public.org_organization_product
  DROP CONSTRAINT IF EXISTS chk_org_product_zalo_show_web_product18;
ALTER TABLE public.org_organization_product
  ADD CONSTRAINT chk_org_product_zalo_show_web_product16_18
  CHECK (
    NOT COALESCE(is_zalo_show_web, false)
    OR COALESCE(product_id IN (16, 18), false)
  ) NOT VALID;
ALTER TABLE public.org_organization_product
  VALIDATE CONSTRAINT chk_org_product_zalo_show_web_product16_18;

CREATE OR REPLACE FUNCTION public.resolve_organization_zalo_runtime_mode(
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
  is_zalo_server boolean,
  mode_revision text
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
      COALESCE(entitlement.is_zalo_server, false) AS requests_server,
      COALESCE(entitlement.is_zalo_show_web, false) AS grants_web
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
    selected.id IS NOT NULL
      AND NOT selected.grants_web
      AND selected.requests_server AS is_zalo_server,
    CASE
      WHEN selected.id IS NULL THEN 'none:' || p_organization_id::text
      ELSE selected.id::text || ':' || selected.entitlement_xmin
    END AS mode_revision
  FROM (VALUES (1)) AS singleton(seed)
  LEFT JOIN selected ON true;
$function$;

COMMENT ON FUNCTION public.resolve_organization_zalo_runtime_mode(bigint) IS
  'Resolve exactly one newest effective Product 16/18 row by created_at DESC NULLS LAST, id DESC. The selected row always grants QR and its is_zalo_show_web flag additionally grants Web.';

NOTIFY pgrst, 'reload schema';

COMMIT;
