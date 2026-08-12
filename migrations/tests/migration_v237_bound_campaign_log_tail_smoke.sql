-- Run only after migration_v237_bound_campaign_log_tail.sql has been applied.
-- The dedicated fixture and every test mutation are restored by ROLLBACK.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $preflight$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure(
    'public.append_auto_campaign_log(bigint,bigint,text)'
  );
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_parallel "char";
  v_config text[];
  v_acl_valid boolean;
BEGIN
  IF v_oid IS NULL OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_oid))
    IS DISTINCT FROM 'f94520920cec83d91829b7f542435eeb'
  THEN
    RAISE EXCEPTION 'v237 smoke: target RPC definition is not installed';
  END IF;

  SELECT
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
  INTO v_owner, v_security_definer, v_volatility, v_parallel, v_config, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_oid;

  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM false
    OR v_volatility IS DISTINCT FROM 'v'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v237 smoke: target RPC metadata or privileges changed';
  END IF;
END;
$preflight$;

DO $smoke$
DECLARE
  c_history_marker constant text :=
    '--- Chỉ lưu lịch sử chạy gần nhất; các mục cũ hơn đã được lược bỏ ---';
  c_entry_marker constant text := ' … [nội dung quá dài đã được rút gọn]';
  v_campaign_id constant bigint := 8800237000000002;
  v_account_id constant bigint := 8800237000000001;
  v_staff_id bigint;
  v_organization_id bigint;
  v_action_id text;
  v_log text;
  v_before_log text;
  v_before_updated_at timestamptz;
  v_after_updated_at timestamptz;
  v_entry_count integer;
  v_expected_error boolean;
BEGIN
  SELECT staff.id, staff.organization_id
  INTO v_staff_id, v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_organization_id IS NULL OR v_action_id IS NULL THEN
    RAISE EXCEPTION 'v237 smoke: fixture dependencies are unavailable';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v237-campaign-log-smoke', 0)
  );
  IF EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = v_account_id)
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = v_campaign_id)
  THEN
    RAISE EXCEPTION 'v237 smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v237_campaign_log_account__', 'facebook', false, false,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content, schedule,
    data_target_source_mode, staff_id, organization_id, is_delete, log
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v237_campaign_log_campaign__', v_action_id,
    v_account_id, 'tạm dừng', '', clock_timestamp(),
    'direct', v_staff_id, v_organization_id, false, NULL
  );

  IF public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:00 01/01/2026 - dòng một ✅'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v237 smoke: RPC return contract changed';
  END IF;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:01 01/01/2026 - dòng hai 👋'
  );
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF v_log IS DISTINCT FROM
    '09:00:00 01/01/2026 - dòng một ✅' || E'\n' ||
    '09:00:01 01/01/2026 - dòng hai 👋'
  THEN
    RAISE EXCEPTION 'v237 smoke: append order or Unicode preservation failed';
  END IF;

  v_before_log := v_log;
  v_expected_error := false;
  BEGIN
    PERFORM public.append_auto_campaign_log(
      v_campaign_id,
      9223372036854775807,
      '09:00:02 01/01/2026 - wrong staff'
    );
  EXCEPTION WHEN OTHERS THEN
    v_expected_error := SQLERRM LIKE 'Active campaign % was not found';
  END;
  IF NOT v_expected_error THEN
    RAISE EXCEPTION 'v237 smoke: wrong-staff append was not rejected';
  END IF;
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF v_log IS DISTINCT FROM v_before_log THEN
    RAISE EXCEPTION 'v237 smoke: rejected append changed the log';
  END IF;

  v_expected_error := false;
  BEGIN
    PERFORM public.append_auto_campaign_log(v_campaign_id, v_staff_id, '   ');
  EXCEPTION WHEN OTHERS THEN
    v_expected_error := SQLERRM = 'Campaign log line must not be empty';
  END;
  IF NOT v_expected_error THEN
    RAISE EXCEPTION 'v237 smoke: blank append was not rejected';
  END IF;

  UPDATE public.auto_campaigns
  SET is_delete = true
  WHERE id = v_campaign_id;
  v_expected_error := false;
  BEGIN
    PERFORM public.append_auto_campaign_log(
      v_campaign_id,
      v_staff_id,
      '09:00:02 01/01/2026 - deleted'
    );
  EXCEPTION WHEN OTHERS THEN
    v_expected_error := SQLERRM LIKE 'Active campaign % was not found';
  END;
  IF NOT v_expected_error THEN
    RAISE EXCEPTION 'v237 smoke: soft-deleted campaign append was not rejected';
  END IF;
  UPDATE public.auto_campaigns
  SET is_delete = false
  WHERE id = v_campaign_id;

  UPDATE public.auto_campaigns
  SET log = '09:00:00 01/01/2026 - multiline' ||
    E'\ncontinuation\nwith UTF-8: Tiếng Việt'
  WHERE id = v_campaign_id;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:01 01/01/2026 - screenshot <!-- screenshotEventId:123 -->'
  );
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF position(E'continuation\nwith UTF-8: Tiếng Việt' IN v_log) = 0
    OR position('<!-- screenshotEventId:123 -->' IN v_log) = 0
  THEN
    RAISE EXCEPTION 'v237 smoke: multiline entry or screenshot marker was damaged';
  END IF;

  UPDATE public.auto_campaigns
  SET log = c_history_marker || E'\n' ||
    '09:00:00 01/01/2026 - marker-as-content' || E'\n' ||
    c_history_marker
  WHERE id = v_campaign_id;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:01 01/01/2026 - multiline input' || E'\n' || c_history_marker
  );
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF (length(v_log) - length(replace(v_log, c_history_marker, '')))
      / length(c_history_marker) <> 3
    OR v_log NOT LIKE c_history_marker || E'\n%'
    OR position('09:00:01 01/01/2026 - multiline input' || E'\n' || c_history_marker IN v_log) = 0
  THEN
    RAISE EXCEPTION 'v237 smoke: marker positioning or multiline entry failed';
  END IF;

  UPDATE public.auto_campaigns
  SET log = (
    SELECT string_agg(
      format('09:00:00 01/01/2026 - entry-%s', lpad(series.i::text, 4, '0')),
      E'\n' ORDER BY series.i
    )
    FROM generate_series(1, 2001) AS series(i)
  )
  WHERE id = v_campaign_id;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:01 01/01/2026 - newest-entry'
  );
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  SELECT count(*) INTO v_entry_count
  FROM unnest(string_to_array(v_log, E'\n')) AS line(value)
  WHERE line.value ~ '^[0-9]{1,2}:[0-9]{2}:[0-9]{2}[[:space:]]+[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}[[:space:]]+-';
  IF v_entry_count <> 2000
    OR v_log NOT LIKE c_history_marker || E'\n%'
    OR position('entry-0001' IN v_log) > 0
    OR position('newest-entry' IN v_log) = 0
  THEN
    RAISE EXCEPTION 'v237 smoke: logical-entry cap failed (entries=%)', v_entry_count;
  END IF;

  UPDATE public.auto_campaigns
  SET log = (
    SELECT string_agg(
      format('09:00:00 01/01/2026 - bytes-%s %s', series.i, repeat('ắ', 1000)),
      E'\n' ORDER BY series.i
    )
    FROM generate_series(1, 400) AS series(i)
  )
  WHERE id = v_campaign_id;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:01 01/01/2026 - newest-byte-entry'
  );
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF octet_length(v_log) > 262144
    OR v_log NOT LIKE c_history_marker || E'\n%'
    OR position('newest-byte-entry' IN v_log) = 0
  THEN
    RAISE EXCEPTION 'v237 smoke: byte cap failed (bytes=%)', octet_length(v_log);
  END IF;

  UPDATE public.auto_campaigns
  SET log = '09:00:00 01/01/2026 - ' || repeat('🙂', 70000)
  WHERE id = v_campaign_id;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:01 01/01/2026 - survives-oversized-legacy-entry'
  );
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF octet_length(v_log) > 262144
    OR position('survives-oversized-legacy-entry' IN v_log) = 0
  THEN
    RAISE EXCEPTION 'v237 smoke: oversized legacy entry evicted the newest entry';
  END IF;

  UPDATE public.auto_campaigns
  SET log = ''
  WHERE id = v_campaign_id;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:00 01/01/2026 - ' || repeat('🙂', 17000)
  );
  SELECT campaign.log INTO v_log
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF char_length(v_log) > 16000
    OR position(c_entry_marker IN v_log) = 0
    OR octet_length(v_log) > 262144
  THEN
    RAISE EXCEPTION 'v237 smoke: oversized-entry cap failed';
  END IF;

  v_before_updated_at := clock_timestamp() + interval '5 minutes';
  UPDATE public.auto_campaigns
  SET log = '', updated_at = v_before_updated_at
  WHERE id = v_campaign_id;
  PERFORM public.append_auto_campaign_log(
    v_campaign_id,
    v_staff_id,
    '09:00:00 01/01/2026 - monotonic revision'
  );
  SELECT campaign.updated_at INTO v_after_updated_at
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF v_after_updated_at <= v_before_updated_at THEN
    RAISE EXCEPTION 'v237 smoke: updated_at did not advance monotonically';
  END IF;
END;
$smoke$;

ROLLBACK;
