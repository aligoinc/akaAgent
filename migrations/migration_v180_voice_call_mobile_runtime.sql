-- Voice-call campaigns run on the already-bound akaBizSms Android device.
-- They deliberately reuse flatform_type='sms' accounts and never create a
-- second account/session for voice calling.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code, is_active, is_delete)
VALUES ('sms', 'Gọi tự động qua SIM', 'voice_call', false, false)
ON CONFLICT (code) DO UPDATE SET
  flatform_type = 'sms',
  name = EXCLUDED.name,
  is_active = false,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_campaign_actions (
  id, name, flatform_type, is_active, workflow_id, test_workflow_id,
  allow_multiple_accounts, limit_check_action_codes, is_delete, created_at
)
VALUES (
  'voice_call', 'SMS - Gọi tự động qua SIM', 'sms', false, NULL, NULL,
  true, ARRAY['voice_call']::text[], false, now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = 'sms',
  is_active = false,
  workflow_id = NULL,
  test_workflow_id = NULL,
  allow_multiple_accounts = true,
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

INSERT INTO public.auto_campaign_action_data_types (
  campaign_action_id, data_type_code, can_source, can_target,
  target_contact_type, is_active, is_delete, sort_order
)
VALUES ('voice_call', 'phone', true, true, 'phone', true, false, 10)
ON CONFLICT (campaign_action_id, data_type_code) DO UPDATE SET
  can_source = true,
  can_target = true,
  target_contact_type = 'phone',
  is_active = true,
  is_delete = false,
  sort_order = 10,
  updated_at = now();

INSERT INTO public.ai_model (
  code, provider, model, endpoint, api_key, default_body, is_system, is_active
)
VALUES (
  'openai_voice_call_tts',
  'openai',
  'gpt-4o-mini-tts',
  'https://api.openai.com/v1/audio/speech',
  '',
  '{"voice":"marin","instructions":"Nói tiếng Việt rõ ràng, tự nhiên, tốc độ vừa phải.","speed":1,"response_format":"mp3"}'::jsonb,
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  provider = EXCLUDED.provider,
  model = CASE WHEN btrim(COALESCE(public.ai_model.model, '')) = '' THEN EXCLUDED.model ELSE public.ai_model.model END,
  endpoint = EXCLUDED.endpoint,
  api_key = CASE WHEN btrim(COALESCE(public.ai_model.api_key, '')) = '' THEN EXCLUDED.api_key ELSE public.ai_model.api_key END,
  default_body = CASE WHEN public.ai_model.default_body = '{}'::jsonb THEN EXCLUDED.default_body ELSE public.ai_model.default_body END,
  is_system = true,
  is_active = true,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.auto_voice_tts_assets (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  model text NOT NULL DEFAULT 'gpt-4o-mini-tts',
  voice text NOT NULL DEFAULT 'marin',
  instructions text NOT NULL DEFAULT 'Nói tiếng Việt rõ ràng, tự nhiên, tốc độ vừa phải.',
  speed numeric(4,2) NOT NULL DEFAULT 1,
  object_key text NOT NULL,
  mime_type text NOT NULL DEFAULT 'audio/mpeg',
  size_bytes bigint NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL,
  audio_sha256 text NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_voice_tts_assets_org_hash_unique UNIQUE (organization_id, content_hash),
  CONSTRAINT auto_voice_tts_assets_duration_check CHECK (duration_ms > 0 AND duration_ms <= 90000),
  CONSTRAINT auto_voice_tts_assets_size_check CHECK (size_bytes >= 0),
  CONSTRAINT auto_voice_tts_assets_speed_check CHECK (speed > 0 AND speed <= 4)
);

CREATE INDEX IF NOT EXISTS idx_auto_voice_tts_assets_cleanup
  ON public.auto_voice_tts_assets(last_used_at, id);

CREATE TABLE IF NOT EXISTS public.auto_voice_device_profiles (
  id bigserial PRIMARY KEY,
  profile_key text NOT NULL,
  profile_version integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  manufacturer text,
  model text,
  sdk_min integer,
  sdk_max integer,
  dialer_package text NOT NULL,
  dialer_version text,
  selectors jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_voice_device_profiles_key_version_unique UNIQUE (profile_key, profile_version),
  CONSTRAINT auto_voice_device_profiles_version_check CHECK (profile_version > 0),
  CONSTRAINT auto_voice_device_profiles_status_check CHECK (status IN ('draft','certified','blocked')),
  CONSTRAINT auto_voice_device_profiles_sdk_check CHECK (sdk_min IS NULL OR sdk_max IS NULL OR sdk_min <= sdk_max)
);

CREATE INDEX IF NOT EXISTS idx_auto_voice_device_profiles_match
  ON public.auto_voice_device_profiles(dialer_package, is_active, status, profile_version DESC);

CREATE TABLE IF NOT EXISTS public.auto_voice_call_jobs (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  input_data_id bigint NOT NULL REFERENCES public.auto_campaign_input_data(id) ON DELETE CASCADE,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  campaign_name text NOT NULL,
  device_id text NOT NULL,
  phone text NOT NULL,
  content text NOT NULL,
  content_materialized_at timestamptz,
  fallback_delay_seconds integer NOT NULL DEFAULT 15,
  max_audio_seconds integer NOT NULL DEFAULT 90,
  status text NOT NULL DEFAULT 'claimed',
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_expires_at timestamptz NOT NULL,
  tts_asset_id bigint REFERENCES public.auto_voice_tts_assets(id) ON DELETE SET NULL,
  tts_prepare_attempts integer NOT NULL DEFAULT 0,
  tts_prepare_started_at timestamptz,
  audio_download_attempts integer NOT NULL DEFAULT 0,
  content_hash text,
  audio_duration_ms integer,
  audio_sha256 text,
  sim_slot integer,
  subscription_id integer,
  answer_detection_mode text,
  profile_key text,
  profile_version integer,
  answer_verified boolean NOT NULL DEFAULT false,
  hangup_outcome text,
  result text,
  error_code text,
  error_message text,
  last_event_sequence integer NOT NULL DEFAULT 0,
  detail_id bigint REFERENCES public.auto_campaign_details(id) ON DELETE SET NULL,
  dial_committed_at timestamptz,
  placed_at timestamptz,
  answered_at timestamptz,
  playback_started_at timestamptz,
  playback_completed_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_voice_call_jobs_input_unique UNIQUE (input_data_id),
  CONSTRAINT auto_voice_call_jobs_status_check CHECK (status IN (
    'claimed', 'preparing_audio', 'audio_ready', 'dial_committed', 'placing',
    'waiting_answer', 'playing', 'ending', 'succeeded', 'failed',
    'no_connection', 'uncertain', 'cancelled'
  )),
  CONSTRAINT auto_voice_call_jobs_tts_attempt_check CHECK (tts_prepare_attempts BETWEEN 0 AND 3),
  CONSTRAINT auto_voice_call_jobs_download_attempt_check CHECK (audio_download_attempts BETWEEN 0 AND 3),
  CONSTRAINT auto_voice_call_jobs_fallback_delay_check CHECK (fallback_delay_seconds BETWEEN 1 AND 120),
  CONSTRAINT auto_voice_call_jobs_max_audio_check CHECK (max_audio_seconds BETWEEN 1 AND 90),
  CONSTRAINT auto_voice_call_jobs_audio_duration_check CHECK (audio_duration_ms IS NULL OR (audio_duration_ms > 0 AND audio_duration_ms <= 90000)),
  CONSTRAINT auto_voice_call_jobs_sim_slot_check CHECK (sim_slot IS NULL OR sim_slot > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_voice_call_jobs_active_account
  ON public.auto_voice_call_jobs(account_id)
  WHERE status IN (
    'claimed', 'preparing_audio', 'audio_ready', 'dial_committed',
    'placing', 'waiting_answer', 'playing', 'ending'
  );

CREATE INDEX IF NOT EXISTS idx_auto_voice_call_jobs_device_status
  ON public.auto_voice_call_jobs(account_id, device_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_voice_call_jobs_campaign
  ON public.auto_voice_call_jobs(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.auto_voice_call_events (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES public.auto_voice_call_jobs(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_voice_call_events_event_unique UNIQUE (event_id),
  CONSTRAINT auto_voice_call_events_job_sequence_unique UNIQUE (job_id, sequence),
  CONSTRAINT auto_voice_call_events_sequence_check CHECK (sequence > 0)
);

CREATE INDEX IF NOT EXISTS idx_auto_voice_call_events_job_time
  ON public.auto_voice_call_events(job_id, sequence, occurred_at);

ALTER TABLE public.auto_voice_tts_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_voice_device_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_voice_call_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_voice_call_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_voice_call_job_internal(
  p_job_id bigint,
  p_detail_status text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.auto_voice_call_jobs%ROWTYPE;
  v_detail_id bigint;
  v_counts boolean;
  v_detail_data jsonb;
BEGIN
  SELECT * INTO v_job
  FROM public.auto_voice_call_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  v_counts := v_job.dial_committed_at IS NOT NULL;
  v_detail_data := jsonb_strip_nulls(jsonb_build_object(
    'voiceCallJobId', v_job.id,
    'phone', v_job.phone,
    'content', v_job.content,
    'deviceId', v_job.device_id,
    'simSlot', v_job.sim_slot,
    'subscriptionId', v_job.subscription_id,
    'answerDetectionMode', v_job.answer_detection_mode,
    'profileKey', v_job.profile_key,
    'profileVersion', v_job.profile_version,
    'answerVerified', v_job.answer_verified,
    'fallbackDelaySeconds', v_job.fallback_delay_seconds,
    'maxAudioSeconds', v_job.max_audio_seconds,
    'audioDurationMs', v_job.audio_duration_ms,
    'audioSha256', v_job.audio_sha256,
    'hangupOutcome', v_job.hangup_outcome,
    'result', v_job.result,
    'errorCode', v_job.error_code,
    'errorMessage', v_job.error_message,
    'dialCommittedAt', v_job.dial_committed_at,
    'placedAt', v_job.placed_at,
    'answeredAt', v_job.answered_at,
    'playbackStartedAt', v_job.playback_started_at,
    'playbackCompletedAt', v_job.playback_completed_at,
    'endedAt', v_job.ended_at
  ));

  IF v_job.detail_id IS NULL THEN
    INSERT INTO public.auto_campaign_details (
      input_data_id, campaign_id, account_id, action_code, action_name,
      status, log, data, counts_toward_limit
    ) VALUES (
      v_job.input_data_id, v_job.campaign_id, v_job.account_id,
      'voice_call', 'Gọi tự động qua SIM', p_detail_status,
      COALESCE(p_note, CASE WHEN p_detail_status = 'thành công' THEN 'Đã phát xong nội dung cuộc gọi' ELSE 'Cuộc gọi tự động thất bại' END),
      v_detail_data, v_counts
    ) RETURNING id INTO v_detail_id;

    UPDATE public.auto_voice_call_jobs SET detail_id = v_detail_id WHERE id = v_job.id;
  ELSE
    UPDATE public.auto_campaign_details
    SET
      status = p_detail_status,
      log = COALESCE(p_note, log),
      data = COALESCE(data, '{}'::jsonb) || v_detail_data,
      counts_toward_limit = v_counts
    WHERE id = v_job.detail_id;
  END IF;

  UPDATE public.auto_campaign_input_data
  SET
    status = 'hoàn thành',
    note = CASE WHEN p_detail_status = 'thành công' THEN NULL ELSE COALESCE(p_note, v_job.error_message, 'Cuộc gọi tự động thất bại') END,
    date_action = COALESCE(v_job.ended_at, v_job.playback_completed_at, now())
  WHERE id = v_job.input_data_id
    AND campaign_id = v_job.campaign_id
    AND status <> 'hoàn thành';

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS remaining
    WHERE remaining.campaign_id = v_job.campaign_id
      AND COALESCE(remaining.is_delete, false) = false
      AND remaining.status IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
  ) THEN
    UPDATE public.auto_campaigns
    SET status = 'hoàn thành', note = NULL, updated_at = now()
    WHERE id = v_job.campaign_id
      AND action_id = 'voice_call'
      AND status IN ('chờ xử lý', 'đang chạy')
      AND COALESCE(is_delete, false) = false;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_claim_voice_call(
  p_account_id bigint,
  p_device_id text,
  p_campaign_id bigint DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.auto_voice_call_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.auto_voice_call_jobs%ROWTYPE;
  v_candidate record;
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 60), 900);
BEGIN
  IF p_account_id IS NULL OR NULLIF(btrim(COALESCE(p_device_id, '')), '') IS NULL THEN RETURN; END IF;

  PERFORM 1 FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.flatform_type = 'sms'
    AND account.is_active = true
    AND account.status = 'chờ xử lý'
    AND COALESCE(account.is_delete, false) = false
    AND account.mobile_device_id = p_device_id
    AND COALESCE(account.mobile_device_info #>> '{voiceCall,capabilityStatus}', '') <> 'blocked'
    AND COALESCE(account.mobile_device_info #>> '{voiceCall,status}', '') <> 'blocked'
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_account_action_status AS action_status
      WHERE action_status.account_id = account.id
        AND action_status.action_code = 'voice_call'
        AND action_status.is_disable = true
        AND (action_status.date_enable IS NULL OR action_status.date_enable > now())
    );
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('voice-call-account:' || p_account_id::text, 0));

  SELECT * INTO v_job
  FROM public.auto_voice_call_jobs
  WHERE account_id = p_account_id
    AND status IN ('claimed','preparing_audio','audio_ready','dial_committed','placing','waiting_answer','playing','ending')
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_job.device_id = p_device_id THEN
      UPDATE public.auto_voice_call_jobs
      SET lease_expires_at = now() + make_interval(secs => v_lease_seconds), updated_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
      RETURN NEXT v_job;
    ELSIF v_job.lease_expires_at <= now() AND v_job.status IN ('claimed','preparing_audio','audio_ready') THEN
      UPDATE public.auto_voice_call_jobs
      SET
        device_id = p_device_id,
        claim_token = gen_random_uuid(),
        status = CASE WHEN tts_asset_id IS NULL THEN 'claimed' ELSE 'audio_ready' END,
        tts_prepare_started_at = NULL,
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
      RETURN NEXT v_job;
    ELSIF v_job.lease_expires_at <= now() AND v_job.dial_committed_at IS NOT NULL THEN
      UPDATE public.auto_voice_call_jobs
      SET
        status = CASE WHEN result = 'success' OR playback_completed_at IS NOT NULL THEN 'succeeded' ELSE 'uncertain' END,
        result = CASE WHEN result = 'success' OR playback_completed_at IS NOT NULL THEN 'success' ELSE 'uncertain' END,
        hangup_outcome = CASE WHEN result = 'success' OR playback_completed_at IS NOT NULL THEN COALESCE(hangup_outcome, 'unknown') ELSE hangup_outcome END,
        error_code = COALESCE(error_code, 'lease_expired_after_dial'),
        error_message = COALESCE(error_message, 'Thiết bị cũ mất kết nối sau khi đã được cấp quyền gọi; không gọi lại tác vụ này'),
        ended_at = COALESCE(ended_at, now()),
        updated_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;

      PERFORM public.aka_agent_finalize_voice_call_job_internal(
        v_job.id,
        CASE WHEN v_job.result = 'success' THEN 'thành công' ELSE 'thất bại' END,
        CASE
          WHEN v_job.result = 'success' THEN 'Đã phát xong nội dung; thiết bị cũ mất kết nối trước khi xác nhận cleanup'
          ELSE v_job.error_message
        END
      );
      RETURN;
    END IF;
    RETURN;
  END IF;

  SELECT
    input_data.id AS input_data_id,
    input_data.campaign_id,
    input_data.phone,
    input_data.content,
    campaign.name AS campaign_name,
    campaign.staff_id,
    campaign.organization_id,
    campaign.extra_settings #>> '{voiceCall,fallbackDelaySeconds}' AS fallback_delay_seconds_raw,
    campaign.extra_settings #>> '{voiceCall,maxAudioSeconds}' AS max_audio_seconds_raw
  INTO v_candidate
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign ON campaign.id = input_data.campaign_id
  WHERE campaign.account_id = p_account_id
    AND campaign.action_id = 'voice_call'
    AND campaign.status = 'chờ xử lý'
    AND COALESCE(campaign.is_delete, false) = false
    AND (p_campaign_id IS NULL OR campaign.id = p_campaign_id)
    AND (campaign.schedule IS NULL OR campaign.schedule <= now())
    AND input_data.status = 'chờ xử lý'
    AND COALESCE(input_data.is_delete, false) = false
    AND (input_data.schedule IS NULL OR input_data.schedule <= now())
    AND NULLIF(btrim(COALESCE(input_data.phone, '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(input_data.content, '')), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.auto_voice_call_jobs existing
      WHERE existing.input_data_id = input_data.id
    )
  ORDER BY COALESCE(input_data.schedule, campaign.schedule) ASC NULLS FIRST, input_data.created_at, input_data.id
  LIMIT 1
  FOR UPDATE OF input_data SKIP LOCKED;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy', note = NULL
  WHERE id = v_candidate.input_data_id AND status = 'chờ xử lý';

  INSERT INTO public.auto_voice_call_jobs (
    organization_id, staff_id, account_id, input_data_id, campaign_id,
    campaign_name, device_id, phone, content, fallback_delay_seconds,
    max_audio_seconds, lease_expires_at
  ) VALUES (
    v_candidate.organization_id, v_candidate.staff_id, p_account_id,
    v_candidate.input_data_id, v_candidate.campaign_id, v_candidate.campaign_name,
    p_device_id, v_candidate.phone, v_candidate.content,
    LEAST(GREATEST(CASE
      WHEN COALESCE(v_candidate.fallback_delay_seconds_raw, '') ~ '^[0-9]{1,9}$'
        THEN v_candidate.fallback_delay_seconds_raw::integer
      ELSE 15
    END, 1), 120),
    LEAST(GREATEST(CASE
      WHEN COALESCE(v_candidate.max_audio_seconds_raw, '') ~ '^[0-9]{1,9}$'
        THEN v_candidate.max_audio_seconds_raw::integer
      ELSE 90
    END, 1), 90),
    now() + make_interval(secs => v_lease_seconds)
  ) RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_current_voice_call(
  p_account_id bigint,
  p_device_id text
)
RETURNS SETOF public.auto_voice_call_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT job.*
  FROM public.auto_voice_call_jobs AS job
  JOIN public.auto_accounts AS account ON account.id = job.account_id
  WHERE job.account_id = p_account_id
    AND job.device_id = p_device_id
    AND account.flatform_type = 'sms'
    AND account.mobile_device_id = p_device_id
    AND job.status IN ('claimed','preparing_audio','audio_ready','dial_committed','placing','waiting_answer','playing','ending')
  ORDER BY job.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_begin_voice_call_audio(
  p_job_id bigint,
  p_account_id bigint,
  p_device_id text,
  p_claim_token uuid
)
RETURNS TABLE (allowed boolean, attempt integer, job jsonb, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.auto_voice_call_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.auto_voice_call_jobs
  WHERE id = p_job_id AND account_id = p_account_id AND device_id = p_device_id AND claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, NULL::jsonb, 'not_found'::text;
    RETURN;
  END IF;
  IF v_job.status = 'audio_ready' AND v_job.tts_asset_id IS NOT NULL THEN
    RETURN QUERY SELECT false, v_job.tts_prepare_attempts, to_jsonb(v_job), 'audio_ready'::text;
    RETURN;
  END IF;
  IF v_job.status NOT IN ('claimed','preparing_audio') OR v_job.dial_committed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, v_job.tts_prepare_attempts, to_jsonb(v_job), 'invalid_status'::text;
    RETURN;
  END IF;
  IF v_job.status = 'preparing_audio' AND v_job.tts_prepare_started_at > now() - interval '2 minutes' THEN
    RETURN QUERY SELECT false, v_job.tts_prepare_attempts, to_jsonb(v_job), 'generation_in_progress'::text;
    RETURN;
  END IF;
  IF v_job.tts_prepare_attempts >= 3 THEN
    UPDATE public.auto_voice_call_jobs
    SET status = 'failed', result = 'failed', ended_at = now(),
        error_code = COALESCE(error_code, 'tts_attempt_limit'),
        error_message = COALESCE(error_message, 'Không thể tạo audio cuộc gọi sau 3 lần thử'),
        tts_prepare_started_at = NULL, updated_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;
    PERFORM public.aka_agent_finalize_voice_call_job_internal(
      v_job.id, 'thất bại', v_job.error_message
    );
    SELECT * INTO v_job FROM public.auto_voice_call_jobs WHERE id = v_job.id;
    RETURN QUERY SELECT false, v_job.tts_prepare_attempts, to_jsonb(v_job), 'attempt_limit'::text;
    RETURN;
  END IF;

  UPDATE public.auto_voice_call_jobs
  SET
    status = 'preparing_audio',
    tts_prepare_attempts = tts_prepare_attempts + 1,
    tts_prepare_started_at = now(),
    lease_expires_at = GREATEST(lease_expires_at, now() + interval '5 minutes'),
    error_code = NULL,
    error_message = NULL,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN QUERY SELECT true, v_job.tts_prepare_attempts, to_jsonb(v_job), NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_voice_call_audio(
  p_job_id bigint,
  p_account_id bigint,
  p_device_id text,
  p_claim_token uuid,
  p_content_hash text,
  p_asset_id bigint,
  p_audio_duration_ms integer,
  p_audio_sha256 text
)
RETURNS SETOF public.auto_voice_call_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.auto_voice_call_jobs%ROWTYPE;
BEGIN
  SELECT job.* INTO v_job
  FROM public.auto_voice_call_jobs AS job
  JOIN public.auto_voice_tts_assets AS asset
    ON asset.id = p_asset_id
    AND asset.organization_id = job.organization_id
    AND asset.content_hash = p_content_hash
    AND asset.duration_ms = p_audio_duration_ms
    AND asset.audio_sha256 = p_audio_sha256
  WHERE job.id = p_job_id
    AND job.account_id = p_account_id
    AND job.device_id = p_device_id
    AND job.claim_token = p_claim_token
    AND job.status IN ('claimed','preparing_audio','audio_ready')
    AND job.dial_committed_at IS NULL
    AND p_audio_duration_ms > 0
    AND p_audio_duration_ms <= job.max_audio_seconds * 1000
  FOR UPDATE OF job;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.auto_voice_call_jobs
  SET
    status = 'audio_ready',
    tts_asset_id = p_asset_id,
    content_hash = p_content_hash,
    audio_duration_ms = p_audio_duration_ms,
    audio_sha256 = p_audio_sha256,
    tts_prepare_started_at = NULL,
    lease_expires_at = now() + interval '5 minutes',
    error_code = NULL,
    error_message = NULL,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE public.auto_voice_tts_assets
  SET last_used_at = now()
  WHERE id = p_asset_id;

  RETURN NEXT v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_fail_voice_call_audio(
  p_job_id bigint,
  p_account_id bigint,
  p_device_id text,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
RETURNS SETOF public.auto_voice_call_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.auto_voice_call_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.auto_voice_call_jobs
  WHERE id = p_job_id AND account_id = p_account_id AND device_id = p_device_id AND claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND OR v_job.dial_committed_at IS NOT NULL OR v_job.status NOT IN ('claimed','preparing_audio') THEN RETURN; END IF;

  UPDATE public.auto_voice_call_jobs
  SET
    status = CASE WHEN tts_prepare_attempts >= 3 THEN 'failed' ELSE 'claimed' END,
    tts_prepare_started_at = NULL,
    error_code = NULLIF(btrim(COALESCE(p_error_code, '')), ''),
    error_message = NULLIF(btrim(COALESCE(p_error_message, '')), ''),
    result = CASE WHEN tts_prepare_attempts >= 3 THEN 'failed' ELSE NULL END,
    ended_at = CASE WHEN tts_prepare_attempts >= 3 THEN now() ELSE NULL END,
    lease_expires_at = now() + interval '5 minutes',
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  IF v_job.status = 'failed' THEN
    PERFORM public.aka_agent_finalize_voice_call_job_internal(
      v_job.id, 'thất bại', COALESCE(v_job.error_message, 'Không thể tạo audio cuộc gọi sau 3 lần thử')
    );
    SELECT * INTO v_job FROM public.auto_voice_call_jobs WHERE id = v_job.id;
  END IF;

  RETURN NEXT v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_authorize_voice_call(
  p_job_id bigint,
  p_account_id bigint,
  p_device_id text,
  p_claim_token uuid,
  p_sim_slot integer,
  p_subscription_id integer
)
RETURNS TABLE (authorized boolean, newly_committed boolean, job jsonb, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.auto_voice_call_jobs%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_status public.auto_account_action_status%ROWTYPE;
  v_today date := timezone('Asia/Ho_Chi_Minh', now())::date;
  v_daily_limit integer;
  v_window_limit integer;
  v_window_minutes integer;
  v_window_count integer;
  v_detail_id bigint;
  v_voice_capability jsonb := '{}'::jsonb;
  v_profile_key text;
  v_profile_version integer;
  v_detection_mode text;
  v_daily_limit_raw text;
  v_window_limit_raw text;
  v_window_minutes_raw text;
BEGIN
  IF COALESCE(p_sim_slot, 0) <= 0 THEN
    RETURN QUERY SELECT false, false, NULL::jsonb, 'invalid_sim'::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('voice-call-quota:' || p_account_id::text, 0));

  SELECT * INTO v_job FROM public.auto_voice_call_jobs
  WHERE id = p_job_id AND account_id = p_account_id AND device_id = p_device_id AND claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::jsonb, 'not_found'::text;
    RETURN;
  END IF;
  IF v_job.dial_committed_at IS NOT NULL THEN
    RETURN QUERY SELECT true, false, to_jsonb(v_job), 'already_committed'::text;
    RETURN;
  END IF;
  IF v_job.status <> 'audio_ready' OR v_job.tts_asset_id IS NULL OR v_job.audio_duration_ms IS NULL THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'invalid_status'::text;
    RETURN;
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = v_job.campaign_id
    AND campaign.account_id = p_account_id
    AND campaign.action_id = 'voice_call'
    AND campaign.status = 'chờ xử lý'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.flatform_type = 'sms'
    AND account.mobile_device_id = p_device_id
    AND account.is_active = true
    AND account.status = 'chờ xử lý'
    AND COALESCE(account.is_delete, false) = false
    AND COALESCE(account.mobile_device_info #>> '{voiceCall,capabilityStatus}', '') <> 'blocked'
    AND COALESCE(account.mobile_device_info #>> '{voiceCall,status}', '') <> 'blocked'
  FOR UPDATE OF campaign, account;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'campaign_or_account_paused'::text;
    RETURN;
  END IF;

  SELECT COALESCE(account.mobile_device_info -> 'voiceCall', '{}'::jsonb)
  INTO v_voice_capability
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.flatform_type = 'sms'
    AND account.mobile_device_id = p_device_id;

  v_profile_key := COALESCE(
    NULLIF(v_voice_capability->>'profileKey', ''),
    NULLIF(v_voice_capability->>'profileCode', '')
  );
  v_profile_version := CASE
    WHEN COALESCE(v_voice_capability->>'profileVersion', '') ~ '^[1-9][0-9]{0,8}$'
      THEN (v_voice_capability->>'profileVersion')::integer
    ELSE NULL
  END;
  v_detection_mode := COALESCE(
    NULLIF(v_voice_capability->>'answerDetectionMode', ''),
    NULLIF(v_voice_capability->>'detectionMode', ''),
    CASE
      WHEN v_profile_key IS NOT NULL
        AND lower(COALESCE(v_voice_capability->>'accessibilityEnabled', 'false')) = 'true'
        AND COALESCE(
          NULLIF(v_voice_capability->>'capabilityStatus', ''),
          NULLIF(v_voice_capability->>'status', '')
        ) IN ('exact_profile', 'exact')
        THEN 'profile'
      ELSE 'fallback_delay'
    END
  );

  v_daily_limit_raw := COALESCE(
    NULLIF(v_campaign.extra_settings #>> '{actionLimits,byActionCode,voice_call,dailyLimit}', ''),
    NULLIF(v_campaign.extra_settings #>> '{actionLimits,dailyLimit}', '')
  );
  v_window_limit_raw := COALESCE(
    NULLIF(v_campaign.extra_settings #>> '{actionLimits,byActionCode,voice_call,rateLimitCount}', ''),
    NULLIF(v_campaign.extra_settings #>> '{actionLimits,rateLimitCount}', '')
  );
  v_window_minutes_raw := COALESCE(
    NULLIF(v_campaign.extra_settings #>> '{actionLimits,byActionCode,voice_call,rateLimitMinutes}', ''),
    NULLIF(v_campaign.extra_settings #>> '{actionLimits,rateLimitMinutes}', '')
  );
  v_daily_limit := GREATEST(CASE
    WHEN COALESCE(v_daily_limit_raw, '') ~ '^[0-9]{1,9}$' THEN v_daily_limit_raw::integer
    ELSE 30
  END, 0);
  v_window_limit := GREATEST(CASE
    WHEN COALESCE(v_window_limit_raw, '') ~ '^[0-9]{1,9}$' THEN v_window_limit_raw::integer
    ELSE 9
  END, 0);
  v_window_minutes := LEAST(GREATEST(CASE
    WHEN COALESCE(v_window_minutes_raw, '') ~ '^[0-9]{1,9}$' THEN v_window_minutes_raw::integer
    ELSE 60
  END, 1), 1440);

  INSERT INTO public.auto_account_action_status (account_id, action_code, count_action_in_day, count_date, updated_at)
  VALUES (p_account_id, 'voice_call', 0, v_today, now())
  ON CONFLICT (account_id, action_code) DO UPDATE SET
    count_action_in_day = CASE WHEN public.auto_account_action_status.count_date = v_today THEN public.auto_account_action_status.count_action_in_day ELSE 0 END,
    count_date = v_today,
    updated_at = now()
  RETURNING * INTO v_status;

  IF v_status.is_disable AND (v_status.date_enable IS NULL OR v_status.date_enable > now()) THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'action_disabled'::text;
    RETURN;
  END IF;
  IF v_daily_limit > 0 AND v_status.count_action_in_day >= v_daily_limit THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'daily_quota_exceeded'::text;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_window_count
  FROM public.auto_campaign_details
  WHERE account_id = p_account_id
    AND action_code = 'voice_call'
    AND counts_toward_limit = true
    AND created_at >= now() - make_interval(mins => v_window_minutes);
  IF v_window_limit > 0 AND v_window_count >= v_window_limit THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'window_quota_exceeded'::text;
    RETURN;
  END IF;

  INSERT INTO public.auto_campaign_details (
    input_data_id, campaign_id, account_id, action_code, action_name,
    status, log, data, counts_toward_limit
  ) VALUES (
    v_job.input_data_id, v_job.campaign_id, p_account_id, 'voice_call',
    'Gọi tự động qua SIM', 'đang gọi', 'Mobile đã được cấp quyền thực hiện cuộc gọi',
    jsonb_strip_nulls(jsonb_build_object(
      'voiceCallJobId', v_job.id, 'phone', v_job.phone, 'content', v_job.content,
      'deviceId', p_device_id, 'simSlot', p_sim_slot, 'subscriptionId', p_subscription_id,
      'audioDurationMs', v_job.audio_duration_ms, 'audioSha256', v_job.audio_sha256,
      'answerDetectionMode', v_detection_mode,
      'profileKey', v_profile_key, 'profileVersion', v_profile_version,
      'answerVerified', false,
      'fallbackDelaySeconds', v_job.fallback_delay_seconds,
      'maxAudioSeconds', v_job.max_audio_seconds
    )),
    true
  ) RETURNING id INTO v_detail_id;

  PERFORM public.increment_auto_account_action_count(p_account_id, 'voice_call', 1);

  UPDATE public.auto_voice_call_jobs
  SET
    status = 'dial_committed',
    sim_slot = p_sim_slot,
    subscription_id = p_subscription_id,
    answer_detection_mode = v_detection_mode,
    profile_key = v_profile_key,
    profile_version = v_profile_version,
    detail_id = v_detail_id,
    dial_committed_at = now(),
    lease_expires_at = now() + interval '5 minutes',
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN QUERY SELECT true, true, to_jsonb(v_job), NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_apply_voice_call_event(
  p_job_id bigint,
  p_account_id bigint,
  p_device_id text,
  p_claim_token uuid,
  p_event_id uuid,
  p_sequence integer,
  p_event_type text,
  p_occurred_at timestamptz,
  p_payload jsonb
)
RETURNS TABLE (accepted boolean, duplicate boolean, job jsonb, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_job public.auto_voice_call_jobs%ROWTYPE;
  v_event_type text := lower(btrim(COALESCE(p_event_type, '')));
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_next_status text;
  v_terminal boolean := false;
  v_detail_status text := 'thất bại';
  v_note text;
  v_existing_event_job_id bigint;
  v_existing_sequence_event_id uuid;
  v_inserted_event_id bigint;
  v_playback_succeeded boolean := false;
  v_audio_download_attempts integer;
BEGIN
  IF p_event_id IS NULL OR COALESCE(p_sequence, 0) <= 0 OR v_event_type = '' THEN
    RETURN QUERY SELECT false, false, NULL::jsonb, 'invalid_event'::text;
    RETURN;
  END IF;

  SELECT * INTO v_job FROM public.auto_voice_call_jobs
  WHERE id = p_job_id AND account_id = p_account_id AND device_id = p_device_id AND claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::jsonb, 'not_found'::text;
    RETURN;
  END IF;

  SELECT event.job_id INTO v_existing_event_job_id
  FROM public.auto_voice_call_events AS event
  WHERE event.event_id = p_event_id;
  IF FOUND THEN
    IF v_existing_event_job_id = v_job.id THEN
      RETURN QUERY SELECT true, true, to_jsonb(v_job), 'duplicate'::text;
    ELSE
      RETURN QUERY SELECT false, false, to_jsonb(v_job), 'event_id_conflict'::text;
    END IF;
    RETURN;
  END IF;

  SELECT event.event_id INTO v_existing_sequence_event_id
  FROM public.auto_voice_call_events AS event
  WHERE event.job_id = v_job.id AND event.sequence = p_sequence;
  IF FOUND THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'sequence_conflict'::text;
    RETURN;
  END IF;

  IF p_sequence <= v_job.last_event_sequence THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'out_of_order'::text;
    RETURN;
  END IF;

  IF NOT (v_event_type = ANY (ARRAY[
    'dial_committed','heartbeat','placing','call_placing','offhook','waiting_answer',
    'answered','answer_detected','answer_verified','playback_started','playback_completed',
    'ending','call_ended','call_idle','no_connection','idle_before_playback',
    'audio_download_failed','uncertain','recovered_uncertain','process_recovered_uncertain',
    'completed','failed','call_failed','playback_failed','profile_mismatch','speaker_failed',
    'hangup_succeeded','hangup_failed'
  ]::text[])) THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'unsupported_event'::text;
    RETURN;
  END IF;

  IF v_job.status IN ('succeeded','failed','no_connection','uncertain','cancelled') THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'terminal_status'::text;
    RETURN;
  END IF;

  IF v_job.status = 'ending' AND NOT (v_event_type = ANY (ARRAY[
    'heartbeat','ending','call_ended','call_idle','completed',
    'uncertain','recovered_uncertain','process_recovered_uncertain',
    'failed','call_failed','playback_failed','profile_mismatch','speaker_failed',
    'hangup_succeeded','hangup_failed'
  ]::text[])) THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'invalid_transition'::text;
    RETURN;
  END IF;

  IF v_job.dial_committed_at IS NULL
    AND NOT (v_event_type = ANY (ARRAY['audio_download_failed','failed','profile_mismatch']::text[]))
  THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'dial_not_committed'::text;
    RETURN;
  END IF;

  IF v_job.dial_committed_at IS NULL
    AND v_event_type IN ('failed','profile_mismatch')
    AND v_job.status NOT IN ('claimed','preparing_audio','audio_ready')
  THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'invalid_status'::text;
    RETURN;
  END IF;

  IF v_event_type = 'audio_download_failed'
    AND (
      v_job.dial_committed_at IS NOT NULL
      OR v_job.status <> 'audio_ready'
      OR v_job.tts_asset_id IS NULL
    ) THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'invalid_status'::text;
    RETURN;
  END IF;

  IF v_event_type = 'completed'
    AND NOT (
      v_job.result = 'success'
      OR v_job.playback_completed_at IS NOT NULL
      OR lower(COALESCE(v_payload->>'result', '')) IN ('success', 'succeeded')
      OR lower(COALESCE(v_payload->>'playbackCompleted', 'false')) = 'true'
    ) THEN
    RETURN QUERY SELECT false, false, to_jsonb(v_job), 'playback_not_completed'::text;
    RETURN;
  END IF;

  INSERT INTO public.auto_voice_call_events (job_id, event_id, sequence, event_type, occurred_at, payload)
  VALUES (v_job.id, p_event_id, p_sequence, v_event_type, COALESCE(p_occurred_at, now()), v_payload)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_inserted_event_id;
  IF v_inserted_event_id IS NULL THEN
    SELECT event.job_id INTO v_existing_event_job_id
    FROM public.auto_voice_call_events AS event
    WHERE event.event_id = p_event_id;
    RETURN QUERY SELECT
      false,
      false,
      to_jsonb(v_job),
      CASE WHEN v_existing_event_job_id IS NOT NULL THEN 'event_id_conflict' ELSE 'sequence_conflict' END::text;
    RETURN;
  END IF;

  v_playback_succeeded := v_job.result = 'success'
    OR v_job.playback_completed_at IS NOT NULL
    OR lower(COALESCE(v_payload->>'result', '')) IN ('success', 'succeeded')
    OR lower(COALESCE(v_payload->>'playbackCompleted', 'false')) = 'true';
  v_audio_download_attempts := v_job.audio_download_attempts;
  v_next_status := v_job.status;
  CASE v_event_type
    WHEN 'dial_committed', 'heartbeat' THEN v_next_status := v_job.status;
    WHEN 'placing', 'call_placing' THEN v_next_status := 'placing';
    WHEN 'offhook', 'waiting_answer' THEN v_next_status := 'waiting_answer';
    WHEN 'answered', 'answer_detected', 'answer_verified' THEN v_next_status := 'waiting_answer';
    WHEN 'playback_started' THEN v_next_status := 'playing';
    WHEN 'playback_completed' THEN
      v_next_status := 'ending'; v_terminal := true; v_detail_status := 'thành công'; v_note := 'Đã phát xong nội dung cuộc gọi';
    WHEN 'ending' THEN v_next_status := 'ending';
    WHEN 'call_ended', 'call_idle' THEN
      IF v_playback_succeeded THEN
        v_next_status := 'succeeded'; v_terminal := true; v_detail_status := 'thành công'; v_note := 'Đã phát xong nội dung và kết thúc cuộc gọi';
      ELSE
        v_next_status := 'no_connection'; v_terminal := true; v_note := 'Cuộc gọi kết thúc trước khi phát xong nội dung';
      END IF;
    WHEN 'no_connection', 'idle_before_playback' THEN
      v_next_status := 'no_connection'; v_terminal := true; v_note := COALESCE(v_payload->>'errorMessage', 'Không kết nối được cuộc gọi');
    WHEN 'audio_download_failed' THEN
      v_audio_download_attempts := LEAST(v_job.audio_download_attempts + 1, 3);
      IF v_audio_download_attempts < 3 THEN
        v_next_status := 'audio_ready';
        v_note := COALESCE(v_payload->>'errorMessage', 'Tải audio thất bại; sẽ cấp lại URL tải trên cùng tác vụ');
      ELSE
        v_next_status := 'failed';
        v_terminal := true;
        v_note := COALESCE(v_payload->>'errorMessage', 'Không thể tải audio cuộc gọi sau 3 lần thử');
      END IF;
    WHEN 'uncertain', 'recovered_uncertain', 'process_recovered_uncertain' THEN
      v_terminal := true;
      IF v_playback_succeeded THEN
        v_next_status := 'succeeded';
        v_detail_status := 'thành công';
        v_note := COALESCE(v_payload->>'errorMessage', 'Đã phát xong nội dung; kết quả tự ngắt cuộc gọi sau khôi phục không chắc chắn');
      ELSE
        v_next_status := 'uncertain';
        v_note := COALESCE(v_payload->>'errorMessage', 'Không xác định được kết quả cuộc gọi sau khi khôi phục');
      END IF;
    WHEN 'completed' THEN
      v_terminal := true;
      v_next_status := 'succeeded';
      v_detail_status := 'thành công';
      v_note := COALESCE(v_payload->>'message', 'Đã hoàn tất cuộc gọi tự động');
    WHEN 'failed', 'call_failed', 'playback_failed', 'profile_mismatch', 'speaker_failed' THEN
      v_next_status := 'failed'; v_terminal := true; v_note := COALESCE(v_payload->>'errorMessage', 'Cuộc gọi tự động thất bại');
    WHEN 'hangup_succeeded' THEN
      v_next_status := CASE WHEN v_playback_succeeded THEN 'succeeded' ELSE 'failed' END;
      v_terminal := true;
      v_detail_status := CASE WHEN v_next_status = 'succeeded' THEN 'thành công' ELSE 'thất bại' END;
      v_note := CASE WHEN v_next_status = 'succeeded' THEN 'Đã phát xong nội dung và tự ngắt cuộc gọi' ELSE 'Cuộc gọi đã ngắt trước khi phát xong nội dung' END;
    WHEN 'hangup_failed' THEN
      v_next_status := CASE WHEN v_playback_succeeded THEN 'succeeded' ELSE 'failed' END;
      v_terminal := true;
      v_detail_status := CASE WHEN v_next_status = 'succeeded' THEN 'thành công' ELSE 'thất bại' END;
      v_note := CASE WHEN v_next_status = 'succeeded' THEN 'Đã phát xong nội dung nhưng không tự ngắt được cuộc gọi' ELSE 'Không tự ngắt được cuộc gọi' END;
    ELSE
      v_next_status := v_job.status;
  END CASE;

  UPDATE public.auto_voice_call_jobs
  SET
    status = v_next_status,
    last_event_sequence = p_sequence,
    audio_download_attempts = v_audio_download_attempts,
    answer_detection_mode = COALESCE(
      NULLIF(v_payload->>'answerDetectionMode', ''),
      NULLIF(v_payload->>'detectionMode', ''),
      answer_detection_mode
    ),
    answer_verified = CASE
      WHEN v_event_type = 'answer_verified' THEN true
      WHEN v_payload ? 'answerVerified' THEN lower(v_payload->>'answerVerified') = 'true'
      ELSE answer_verified
    END,
    hangup_outcome = COALESCE(NULLIF(v_payload->>'hangupOutcome', ''),
      CASE
        WHEN v_event_type = 'hangup_failed' THEN 'failed'
        WHEN v_event_type IN ('uncertain','recovered_uncertain','process_recovered_uncertain') AND v_playback_succeeded THEN 'unknown'
        WHEN v_event_type IN ('call_ended','call_idle','hangup_succeeded') THEN 'success'
        ELSE hangup_outcome
      END),
    result = CASE
      WHEN v_event_type = 'playback_completed' THEN 'success'
      WHEN v_event_type = 'completed' THEN 'success'
      WHEN v_event_type IN ('call_ended','call_idle','hangup_succeeded','uncertain','recovered_uncertain','process_recovered_uncertain') AND v_playback_succeeded THEN 'success'
      WHEN v_event_type IN ('no_connection','idle_before_playback') THEN 'no_connection'
      WHEN v_event_type = 'audio_download_failed'
        AND (dial_committed_at IS NOT NULL OR v_audio_download_attempts >= 3) THEN 'failed'
      WHEN v_event_type = 'hangup_failed' AND v_playback_succeeded THEN 'success'
      WHEN v_event_type IN ('failed','call_failed','playback_failed','profile_mismatch','speaker_failed','hangup_succeeded','hangup_failed') THEN 'failed'
      WHEN v_event_type IN ('uncertain','recovered_uncertain','process_recovered_uncertain') THEN 'uncertain'
      ELSE result
    END,
    error_code = COALESCE(NULLIF(v_payload->>'errorCode', ''), error_code),
    error_message = COALESCE(NULLIF(v_payload->>'errorMessage', ''), error_message),
    placed_at = CASE WHEN v_event_type IN ('placing','call_placing') THEN COALESCE(p_occurred_at, now()) ELSE placed_at END,
    answered_at = CASE WHEN v_event_type IN ('answered','answer_detected','answer_verified') THEN COALESCE(p_occurred_at, now()) ELSE answered_at END,
    playback_started_at = CASE WHEN v_event_type = 'playback_started' THEN COALESCE(p_occurred_at, now()) ELSE playback_started_at END,
    playback_completed_at = CASE WHEN v_event_type = 'playback_completed' THEN COALESCE(p_occurred_at, now()) ELSE playback_completed_at END,
    ended_at = CASE WHEN v_terminal AND v_event_type <> 'playback_completed' THEN COALESCE(p_occurred_at, now()) ELSE ended_at END,
    lease_expires_at = now() + interval '5 minutes',
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  IF v_job.detail_id IS NOT NULL THEN
    UPDATE public.auto_campaign_details
    SET data = COALESCE(data, '{}'::jsonb) || v_payload || jsonb_strip_nulls(jsonb_build_object(
      'answerDetectionMode', v_job.answer_detection_mode,
      'answerVerified', v_job.answer_verified,
      'hangupOutcome', v_job.hangup_outcome,
      'audioDurationMs', v_job.audio_duration_ms,
      'errorCode', v_job.error_code,
      'errorMessage', v_job.error_message
    ))
    WHERE id = v_job.detail_id;
  END IF;

  IF v_terminal THEN
    PERFORM public.aka_agent_finalize_voice_call_job_internal(v_job.id, v_detail_status, v_note);
    SELECT * INTO v_job FROM public.auto_voice_call_jobs WHERE id = v_job.id;
  END IF;

  RETURN QUERY SELECT true, false, to_jsonb(v_job), NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_take_expired_voice_tts_assets(
  p_before timestamptz,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (id bigint, object_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF p_before IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT asset.id
    FROM public.auto_voice_tts_assets AS asset
    WHERE asset.last_used_at < p_before
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_voice_call_jobs AS job
        WHERE job.tts_asset_id = asset.id
          AND job.status IN (
            'claimed','preparing_audio','audio_ready','dial_committed',
            'placing','waiting_answer','playing','ending'
          )
      )
    ORDER BY asset.last_used_at, asset.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.auto_voice_tts_assets AS asset
    USING candidates
    WHERE asset.id = candidates.id
    RETURNING asset.id, asset.object_key
  )
  SELECT deleted.id, deleted.object_key FROM deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_merge_sms_voice_device_info(
  p_account_id bigint,
  p_device_info jsonb,
  p_preserve_server_voice_state boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_current jsonb;
  v_current_voice jsonb;
  v_incoming jsonb := COALESCE(p_device_info, '{}'::jsonb);
  v_incoming_voice jsonb;
  v_merged jsonb;
BEGIN
  IF p_account_id IS NULL OR jsonb_typeof(v_incoming) <> 'object' THEN
    RAISE EXCEPTION 'invalid_device_info';
  END IF;

  SELECT COALESCE(account.mobile_device_info, '{}'::jsonb)
  INTO v_current
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.flatform_type = 'sms'
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sms_account_not_found';
  END IF;

  IF jsonb_typeof(v_current) <> 'object' THEN v_current := '{}'::jsonb; END IF;
  v_current_voice := CASE
    WHEN jsonb_typeof(v_current->'voiceCall') = 'object' THEN v_current->'voiceCall'
    ELSE '{}'::jsonb
  END;
  v_incoming_voice := CASE
    WHEN jsonb_typeof(v_incoming->'voiceCall') = 'object' THEN v_incoming->'voiceCall'
    ELSE '{}'::jsonb
  END;

  -- Once claim has evaluated the installed dialer/profile, generic app
  -- heartbeats must not replace that authoritative decision with their local
  -- fallback guess. A later claim passes preserve=false and can atomically
  -- replace these fields after re-evaluating the current device facts.
  IF COALESCE(p_preserve_server_voice_state, true)
    AND v_current_voice ? 'capabilityCheckedAt'
  THEN
    v_incoming_voice := v_incoming_voice
      - 'capabilityStatus'
      - 'status'
      - 'blockedReason'
      - 'profileKey'
      - 'profileVersion'
      - 'answerDetectionMode'
      - 'fallbackDelaySeconds'
      - 'capabilityCheckedAt';
  END IF;

  v_merged := (v_current || (v_incoming - 'voiceCall'))
    || jsonb_build_object('voiceCall', v_current_voice || v_incoming_voice);

  UPDATE public.auto_accounts
  SET
    mobile_device_info = v_merged,
    mobile_device_last_seen_at = now()
  WHERE id = p_account_id;

  RETURN v_merged;
END;
$$;

COMMENT ON TABLE public.auto_voice_call_jobs IS
  'One-attempt voice-call ledger for SMS accounts. A job is never re-created after dial_committed.';
COMMENT ON TABLE public.auto_voice_call_events IS
  'Idempotent ordered event outbox received from the bound akaBizSms Android device.';
COMMENT ON TABLE public.auto_voice_tts_assets IS
  'Organization-scoped cache metadata for OpenAI TTS objects under the media R2 voice-calls prefix; object_key is never stored as a public URL.';
COMMENT ON TABLE public.auto_voice_device_profiles IS
  'Versioned static Accessibility selectors certified per Android/dialer profile; no executable code. manufacturer, model and dialer_version use case-insensitive exact/glob matching where * is the only wildcard.';

REVOKE ALL ON TABLE public.auto_voice_call_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.auto_voice_call_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.auto_voice_tts_assets FROM anon, authenticated;
REVOKE ALL ON TABLE public.auto_voice_device_profiles FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_finalize_voice_call_job_internal(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_claim_voice_call(bigint, text, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_get_current_voice_call(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_begin_voice_call_audio(bigint, bigint, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_set_voice_call_audio(bigint, bigint, text, uuid, text, bigint, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_fail_voice_call_audio(bigint, bigint, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_authorize_voice_call(bigint, bigint, text, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_apply_voice_call_event(bigint, bigint, text, uuid, uuid, integer, text, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_take_expired_voice_tts_assets(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aka_agent_merge_sms_voice_device_info(bigint, jsonb, boolean) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_voice_call_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_voice_call_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_voice_tts_assets TO service_role;
GRANT SELECT ON public.auto_voice_device_profiles TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_voice_call_jobs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_voice_call_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_voice_tts_assets_id_seq TO service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_claim_voice_call(bigint, text, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_current_voice_call(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_begin_voice_call_audio(bigint, bigint, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_set_voice_call_audio(bigint, bigint, text, uuid, text, bigint, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_fail_voice_call_audio(bigint, bigint, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_authorize_voice_call(bigint, bigint, text, uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_apply_voice_call_event(bigint, bigint, text, uuid, uuid, integer, text, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_take_expired_voice_tts_assets(timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_merge_sms_voice_device_info(bigint, jsonb, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
