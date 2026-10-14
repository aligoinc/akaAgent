CREATE OR REPLACE FUNCTION public.auto_assert_automation_identity(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_claim_role text;
  v_claims jsonb;
BEGIN
  v_claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_claim_role IS NULL THEN
    BEGIN
      v_claims := NULLIF(
        current_setting('request.jwt.claims', true),
        ''
      )::jsonb;
      v_claim_role := NULLIF(v_claims ->> 'role', '');
    EXCEPTION
      WHEN OTHERS THEN
        v_claim_role := NULL;
    END;
  END IF;

  IF v_claim_role IS NULL THEN
    v_claim_role := NULLIF(auth.jwt() ->> 'role', '');
  END IF;

  IF v_claim_role = 'service_role' THEN
    RETURN;
  END IF;

  IF p_auth_username IS NULL OR p_auth_password IS NULL THEN
    RAISE EXCEPTION 'automation_auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
      AND staff.username = p_auth_username
      AND staff.password = p_auth_password
  ) THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END;
$function$
