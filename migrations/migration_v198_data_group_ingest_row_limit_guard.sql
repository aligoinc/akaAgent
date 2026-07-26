-- Reject malformed or oversized Data Group ingest payloads in the public
-- service wrapper before it expands or transforms any JSON rows. The v186
-- implementation already enforces the same 10,000-row contract, but v193's
-- relationship projection runs before that implementation-level guard.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_data_group_ingest_wrapper';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_group_id bigint,
  p_kind text,
  p_rows jsonb,
  p_dataset_id bigint DEFAULT NULL,
  p_dataset_name text DEFAULT NULL,
  p_import_source text DEFAULT NULL,
  p_source_account_id bigint DEFAULT NULL,
  p_source_name text DEFAULT NULL,
  p_payload_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  -- Keep these checks sequential: jsonb_array_length must never receive a
  -- scalar, object, JSON null or SQL NULL payload.
  IF p_rows IS NULL THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;
  IF jsonb_array_length(p_rows) > 10000 THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(row_value.value) = 'object'
        AND row_value.value ->> 'relationship_kind' IN (
          'zalo_group_members', 'zalo_remarketing_customers'
        )
      THEN jsonb_set(
        row_value.value - 'relationship_kind',
        '{extra_data}',
        CASE
          WHEN jsonb_typeof(row_value.value -> 'extra_data') = 'object'
            THEN row_value.value -> 'extra_data'
          ELSE '{}'::jsonb
        END || jsonb_build_object(
          'relationshipKind', row_value.value ->> 'relationship_kind'
        ),
        true
      )
      ELSE row_value.value
    END
    ORDER BY row_value.ordinality
  ), '[]'::jsonb)
  INTO v_rows
  FROM jsonb_array_elements(p_rows)
    WITH ORDINALITY AS row_value(value, ordinality);

  RETURN public.aka_agent_ingest_data_group_v186_internal(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_group_id,
    p_kind,
    v_rows,
    p_dataset_id,
    p_dataset_name,
    p_import_source,
    p_source_account_id,
    p_source_name,
    p_payload_hash
  );
END;
$$;

COMMENT ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) IS
  'Service-role Data Group ingest entrypoint; rejects non-array or over-10,000-row payloads before relationship transformation.';

-- Preserve the v193 service-only implementation ACL. The same-name desktop
-- overload with mandatory credentials continues to authenticate first and
-- delegate to this signature.
REVOKE ALL ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
