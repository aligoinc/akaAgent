-- Raise the internal control-media library ceiling without exposing the
-- technical limit to clients. The advisory lock keeps the count and insert
-- atomic across concurrent upload completions for the same staff.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_control_media(
  p_staff_id bigint,
  p_organization_id bigint,
  p_provider text,
  p_original_name text,
  p_cloud_url text,
  p_object_key text,
  p_mime_type text,
  p_size_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_media public.auto_media_files%ROWTYPE;
  v_active_count integer;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR NULLIF(btrim(COALESCE(p_original_name, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_cloud_url, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_object_key, '')), '') IS NULL
    OR p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'invalid_control_media_payload';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff
    WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('control-media:' || p_staff_id::text, 0));

  SELECT * INTO v_media
  FROM public.auto_media_files
  WHERE staff_id = p_staff_id
    AND organization_id = p_organization_id
    AND object_key = p_object_key
    AND is_delete = false
  LIMIT 1;
  IF FOUND THEN
    RETURN to_jsonb(v_media);
  END IF;

  SELECT count(*)::integer INTO v_active_count
  FROM public.auto_media_files
  WHERE staff_id = p_staff_id
    AND organization_id = p_organization_id
    AND is_delete = false;
  IF v_active_count >= 5000 THEN
    RAISE EXCEPTION 'control_media_quota_exceeded';
  END IF;

  INSERT INTO public.auto_media_files (
    provider, original_name, local_path, cloud_url, object_key, mime_type,
    size_bytes, is_delete, staff_id, organization_id
  ) VALUES (
    COALESCE(NULLIF(btrim(p_provider), ''), 'r2'),
    btrim(p_original_name),
    NULL,
    btrim(p_cloud_url),
    btrim(p_object_key),
    NULLIF(btrim(COALESCE(p_mime_type, '')), ''),
    p_size_bytes,
    false,
    p_staff_id,
    p_organization_id
  ) RETURNING * INTO v_media;

  RETURN to_jsonb(v_media);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_control_media(bigint, bigint, text, text, text, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_control_media(bigint, bigint, text, text, text, text, text, bigint)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
