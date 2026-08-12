-- Keep campaign progress history useful without allowing auto_campaigns.log to
-- grow forever. Detailed action outcomes remain in their dedicated tables;
-- this field is a recent, human-readable runtime history.

BEGIN;

-- Fail closed against the exact production definition captured from akachat
-- (project ref cgjbsmqtfhqvttudyjzq) before this migration was authored. The
-- second checksum makes a verified reapply idempotent.
DO $preflight$
DECLARE
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.append_auto_campaign_log(bigint,bigint,text)'
  );
  v_definition_md5 text;
  v_owner oid;
  v_security_definer boolean;
  v_volatility "char";
  v_parallel "char";
  v_config text[];
  v_acl_valid boolean;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION
      'v237: append_auto_campaign_log(bigint,bigint,text) is missing';
  END IF;

  v_definition_md5 := pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function_oid));
  IF v_definition_md5 NOT IN (
    'f928966012e6a18d06b8c1e7137b8b57', -- production v163 definition
    'f94520920cec83d91829b7f542435eeb'  -- v237 definition
  ) THEN
    RAISE EXCEPTION
      'v237: refusing to overwrite unexpected live function definition (md5=%)',
      v_definition_md5;
  END IF;

  SELECT
    proc.proowner,
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 5
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          0::oid,
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO
    v_owner,
    v_security_definer,
    v_volatility,
    v_parallel,
    v_config,
    v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_function_oid;

  IF v_owner IS DISTINCT FROM pg_catalog.to_regrole('postgres')::oid
    OR v_security_definer IS DISTINCT FROM false
    OR v_volatility IS DISTINCT FROM 'v'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION
      'v237: refusing to replace function with unexpected live metadata';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.append_auto_campaign_log(
  p_campaign_id bigint,
  p_staff_id bigint,
  p_log_line text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  c_max_log_bytes constant integer := 262144;
  c_max_log_entries constant integer := 2000;
  c_max_entry_chars constant integer := 16000;
  c_history_marker constant text :=
    '--- Chỉ lưu lịch sử chạy gần nhất; các mục cũ hơn đã được lược bỏ ---';
  c_entry_marker constant text := ' … [nội dung quá dài đã được rút gọn]';
  v_existing_log text;
  v_existing_updated_at timestamptz;
  v_log_line text := p_log_line;
  v_combined_log text;
  v_lines text[];
  v_entries text[] := ARRAY[]::text[];
  v_retained_entries text[] := ARRAY[]::text[];
  v_line text;
  v_line_index integer := 0;
  v_current_entry text;
  v_entry text;
  v_entry_count integer;
  v_first_candidate integer;
  v_index integer;
  v_used_bytes integer := 0;
  v_entry_bytes integer;
  v_was_already_truncated boolean := false;
  v_needs_truncation_marker boolean;
  v_retained_log text;
  v_next_updated_at timestamptz;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'Campaign ID must be a positive integer';
  END IF;

  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  IF NULLIF(btrim(COALESCE(p_log_line, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Campaign log line must not be empty';
  END IF;

  -- Keep the timestamp/prefix of an abnormal single entry. Character-based
  -- slicing is UTF-8 safe; 16,000 characters are at most about 64 KiB.
  IF char_length(v_log_line) > c_max_entry_chars THEN
    v_log_line := left(
      v_log_line,
      c_max_entry_chars - char_length(c_entry_marker)
    ) || c_entry_marker;
  END IF;

  -- The row lock preserves the no-lost-update guarantee when Desktop and
  -- Server append concurrently. All trimming happens before releasing it.
  SELECT COALESCE(campaign.log, ''), campaign.updated_at
  INTO v_existing_log, v_existing_updated_at
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active campaign % was not found', p_campaign_id;
  END IF;

  -- A stored entry starts at either the legacy "[timestamp]" form or the
  -- current "HH:mm:ss dd/MM/yyyy -" form. Continuation lines stay attached to
  -- their entry, so stack traces and screenshot markers are never cut midway.
  -- Parse only existing history; the new RPC argument is appended below as one
  -- indivisible logical entry even when it contains embedded newlines.
  v_lines := string_to_array(v_existing_log, E'\n');
  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_index := v_line_index + 1;
    IF v_line_index = 1 AND v_line = c_history_marker THEN
      v_was_already_truncated := true;
      CONTINUE;
    END IF;

    IF v_line ~ '^\[[^]]+\][[:space:]]*'
      OR v_line ~ '^[0-9]{1,2}:[0-9]{2}:[0-9]{2}[[:space:]]+[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}[[:space:]]+-[[:space:]]*'
    THEN
      IF v_current_entry IS NOT NULL AND char_length(v_current_entry) > 0 THEN
        v_entries := array_append(v_entries, v_current_entry);
      END IF;
      v_current_entry := v_line;
    ELSIF v_current_entry IS NULL THEN
      v_current_entry := v_line;
    ELSE
      v_current_entry := v_current_entry || E'\n' || v_line;
    END IF;
  END LOOP;

  IF v_current_entry IS NOT NULL AND char_length(v_current_entry) > 0 THEN
    v_entries := array_append(v_entries, v_current_entry);
  END IF;

  v_entries := array_append(v_entries, v_log_line);
  v_combined_log := array_to_string(v_entries, E'\n');

  v_entry_count := COALESCE(array_length(v_entries, 1), 0);
  v_needs_truncation_marker := v_was_already_truncated
    OR v_entry_count > c_max_log_entries
    OR octet_length(v_combined_log) > c_max_log_bytes;

  IF v_needs_truncation_marker THEN
    v_used_bytes := octet_length(c_history_marker) + 1;
  END IF;

  v_first_candidate := GREATEST(1, v_entry_count - c_max_log_entries + 1);
  IF v_entry_count > 0 THEN
    FOR v_index IN REVERSE v_entry_count..v_first_candidate LOOP
      v_entry := v_entries[v_index];
      v_entry_bytes := octet_length(v_entry)
        + CASE WHEN array_length(v_retained_entries, 1) IS NULL THEN 0 ELSE 1 END;

      IF v_used_bytes + v_entry_bytes > c_max_log_bytes THEN
        v_needs_truncation_marker := true;
        EXIT;
      END IF;

      v_retained_entries := array_prepend(v_entry, v_retained_entries);
      v_used_bytes := v_used_bytes + v_entry_bytes;
    END LOOP;
  END IF;

  v_retained_log := array_to_string(v_retained_entries, E'\n');
  IF v_needs_truncation_marker THEN
    v_retained_log := c_history_marker || CASE
      WHEN NULLIF(v_retained_log, '') IS NULL THEN ''
      ELSE E'\n' || v_retained_log
    END;
  END IF;

  -- clock_timestamp() is evaluated after the row lock. Advancing from the
  -- locked revision also prevents concurrent appends from moving updated_at
  -- backwards and hiding a renderer cache invalidation.
  v_next_updated_at := GREATEST(
    clock_timestamp(),
    COALESCE(
      v_existing_updated_at + interval '1 microsecond',
      '-infinity'::timestamptz
    )
  );

  UPDATE public.auto_campaigns AS campaign
  SET log = v_retained_log,
    updated_at = v_next_updated_at
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active campaign % was not found', p_campaign_id;
  END IF;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.append_auto_campaign_log(bigint, bigint, text) IS
  'Atomically append one formatted campaign-log entry while retaining at most 2,000 recent entries and 256 KiB of UTF-8 text.';

DO $postflight$
DECLARE
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.append_auto_campaign_log(bigint,bigint,text)'
  );
  v_definition_md5 text;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_parallel "char";
  v_config text[];
  v_acl_valid boolean;
BEGIN
  SELECT
    pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)),
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 5
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          0::oid,
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO
    v_definition_md5,
    v_owner,
    v_security_definer,
    v_volatility,
    v_parallel,
    v_config,
    v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_function_oid;

  IF v_definition_md5 IS DISTINCT FROM 'f94520920cec83d91829b7f542435eeb' THEN
    RAISE EXCEPTION 'v237: target definition checksum mismatch (md5=%)', v_definition_md5;
  END IF;
  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM false
    OR v_volatility IS DISTINCT FROM 'v'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION
      'v237: function metadata changed unexpectedly (owner=%, prosecdef=%, volatility=%, parallel=%, config=%, acl_valid=%)',
      v_owner, v_security_definer, v_volatility, v_parallel, v_config, v_acl_valid;
  END IF;
END;
$postflight$;

COMMIT;
