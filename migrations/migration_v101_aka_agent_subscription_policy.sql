-- Allow the desktop app anon client to read package subscriptions freely.
DROP POLICY IF EXISTS org_organization_product_anon_aka_agent_login_select
  ON public.org_organization_product;
DROP POLICY IF EXISTS org_organization_product_anon_akamap_login_select
  ON public.org_organization_product;
DROP POLICY IF EXISTS org_organization_product_read_all
  ON public.org_organization_product;

CREATE POLICY org_organization_product_read_all
  ON public.org_organization_product
  FOR SELECT
  TO anon, authenticated
  USING (true);
