-- Web/PWA control sessions and atomic campaign creation for akaAgent control API.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_control_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  client_type text NOT NULL DEFAULT 'web',
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT auto_control_sessions_client_type_check
    CHECK (client_type IN ('web', 'pwa', 'native')),
  CONSTRAINT auto_control_sessions_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auto_control_sessions_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_auto_control_sessions_staff_active
  ON public.auto_control_sessions (staff_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auto_control_sessions_expiry
  ON public.auto_control_sessions (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.auto_control_sessions IS
  'Opaque 30-day sessions for akaAgent Web/PWA/native control clients. Only SHA-256 token hashes are stored.';

REVOKE ALL ON TABLE public.auto_control_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auto_control_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.validate_control_session(
  p_session_id uuid,
  p_staff_id bigint,
  p_organization_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.auto_control_sessions AS session
    WHERE session.id = p_session_id
      AND session.staff_id = p_staff_id
      AND session.organization_id = p_organization_id
      AND session.revoked_at IS NULL
      AND session.expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION public.validate_control_session(uuid, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_control_session(uuid, bigint, bigint)
  TO anon, authenticated, service_role;

ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS control_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaigns_control_idempotency
  ON public.auto_campaigns (staff_id, control_idempotency_key)
  WHERE control_idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.auto_campaigns.control_idempotency_key IS
  'Client-generated idempotency key used by the control API when creating a campaign and its input rows atomically.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_media_files_staff_object_key
  ON public.auto_media_files (staff_id, object_key)
  WHERE object_key IS NOT NULL AND is_delete = false;

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
  IF v_active_count >= 100 THEN
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
    AND account.flatform_type IN ('zalo', 'sms')
    AND COALESCE(account.is_delete, false) = false;
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

REVOKE ALL ON FUNCTION public.create_control_campaign(bigint, bigint, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_control_campaign(bigint, bigint, text, jsonb, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
