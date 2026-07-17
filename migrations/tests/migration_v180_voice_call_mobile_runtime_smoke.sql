-- Rollback smoke test for migration_v180_voice_call_mobile_runtime.sql.
--
-- Run this after v180 and before the final v181 activation migration. The test
-- verifies the hidden rollout gate, schema/RPC contract and the event ledger's
-- duplicate/terminal/download-retry behavior. Behavioral checks use an idle
-- existing SMS account when one is available and always roll back.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $preflight$
DECLARE
  v_table text;
  v_signature text;
  v_active_predicate text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'auto_voice_call_jobs',
    'auto_voice_call_events',
    'auto_voice_tts_assets',
    'auto_voice_device_profiles'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'v180_smoke: missing table %', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = to_regclass('public.' || v_table)
        AND relation.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'v180_smoke: RLS is not enabled on %', v_table;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_claim_voice_call(bigint,text,bigint,integer)',
    'public.aka_agent_get_current_voice_call(bigint,text)',
    'public.aka_agent_begin_voice_call_audio(bigint,bigint,text,uuid)',
    'public.aka_agent_set_voice_call_audio(bigint,bigint,text,uuid,text,bigint,integer,text)',
    'public.aka_agent_fail_voice_call_audio(bigint,bigint,text,uuid,text,text)',
    'public.aka_agent_authorize_voice_call(bigint,bigint,text,uuid,integer,integer)',
    'public.aka_agent_apply_voice_call_event(bigint,bigint,text,uuid,uuid,integer,text,timestamptz,jsonb)',
    'public.aka_agent_take_expired_voice_tts_assets(timestamptz,integer)',
    'public.aka_agent_merge_sms_voice_device_info(bigint,jsonb,boolean)'
  ]
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v180_smoke: missing RPC %', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_account_actions
    WHERE code = 'voice_call' AND flatform_type = 'sms'
      AND is_active = false AND is_delete = false
  ) OR NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_actions
    WHERE id = 'voice_call' AND flatform_type = 'sms'
      AND is_active = false AND is_delete = false
      AND workflow_id IS NULL AND test_workflow_id IS NULL
  ) THEN
    RAISE EXCEPTION 'v180_smoke: voice_call must remain hidden until v181';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_action_data_types
    WHERE campaign_action_id = 'voice_call'
      AND data_type_code = 'phone'
      AND can_source = true AND can_target = true
      AND target_contact_type = 'phone'
      AND is_active = true AND is_delete = false
  ) THEN
    RAISE EXCEPTION 'v180_smoke: voice_call phone input mapping is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_voice_call_jobs'
      AND column_name = 'audio_download_attempts'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_voice_call_jobs'
      AND column_name = 'fallback_delay_seconds'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_voice_call_jobs'
      AND column_name = 'max_audio_seconds'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_voice_call_jobs'
      AND column_name = 'content_materialized_at'
  ) THEN
    RAISE EXCEPTION 'v180_smoke: required immutable job snapshots are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.auto_voice_device_profiles'::regclass
      AND constraint_row.contype = 'u'
      AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (profile_key, profile_version)'
  ) THEN
    RAISE EXCEPTION 'v180_smoke: device profile history is not versioned';
  END IF;

  SELECT pg_get_expr(index_row.indpred, index_row.indrelid)
  INTO v_active_predicate
  FROM pg_catalog.pg_index AS index_row
  WHERE index_row.indexrelid = 'public.uq_auto_voice_call_jobs_active_account'::regclass;

  IF v_active_predicate IS NULL OR v_active_predicate ILIKE '%uncertain%' THEN
    RAISE EXCEPTION 'v180_smoke: terminal uncertain jobs must not lock the account (%).', v_active_predicate;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.auto_voice_call_jobs'::regclass
      AND constraint_row.contype = 'u'
      AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (input_data_id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.auto_voice_call_events'::regclass
      AND constraint_row.contype = 'u'
      AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (event_id)'
  ) THEN
    RAISE EXCEPTION 'v180_smoke: one-job/input or idempotent-event constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'aka_agent_authorize_voice_call'
      AND proc.proargnames @> ARRAY['authorized','newly_committed','job','reason']::text[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'aka_agent_apply_voice_call_event'
      AND proc.proargnames @> ARRAY['accepted','duplicate','job','message']::text[]
  ) THEN
    RAISE EXCEPTION 'v180_smoke: authorize/event ACK envelope mismatch';
  END IF;
END;
$preflight$;

DO $behavior$
DECLARE
  v_account record;
  v_campaign_id bigint;
  v_input_id bigint;
  v_asset_id bigint;
  v_job_id bigint;
  v_claim_token uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_response record;
  v_job public.auto_voice_call_jobs%ROWTYPE;
  v_count integer;
  v_device_info jsonb;
BEGIN
  SELECT account.id, account.staff_id, account.organization_id
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.flatform_type = 'sms'
    AND account.staff_id IS NOT NULL
    AND account.organization_id IS NOT NULL
    AND COALESCE(account.is_delete, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM public.auto_voice_call_jobs AS active_job
      WHERE active_job.account_id = account.id
        AND active_job.status IN (
          'claimed','preparing_audio','audio_ready','dial_committed',
          'placing','waiting_answer','playing','ending'
        )
    )
  ORDER BY account.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'v180_smoke: no idle SMS account; behavioral fixture skipped';
    RETURN;
  END IF;

  UPDATE public.auto_accounts
  SET is_active = true,
      status = 'chờ xử lý',
      mobile_device_id = '__v180_smoke_device__',
      mobile_device_info = jsonb_build_object(
        'voiceCall', jsonb_build_object(
          'capabilityVersion', 1,
          'capabilityStatus', 'fallback_ready',
          'answerDetectionMode', 'fallback_delay',
          'heartbeatAt', now()
        )
      )
  WHERE id = v_account.id;

  PERFORM public.aka_agent_merge_sms_voice_device_info(
    v_account.id,
    '{"voiceCall":{"capabilityStatus":"blocked","status":"blocked","blockedReason":"profile blocked","capabilityCheckedAt":"2026-07-17T00:00:00Z"}}'::jsonb,
    false
  );
  SELECT public.aka_agent_merge_sms_voice_device_info(
    v_account.id,
    '{"voiceCall":{"capabilityStatus":"fallback_ready","status":"fallback","blockedReason":null,"model":"heartbeat-model"}}'::jsonb,
    true
  ) INTO v_device_info;
  IF v_device_info #>> '{voiceCall,capabilityStatus}' <> 'blocked'
    OR v_device_info #>> '{voiceCall,blockedReason}' <> 'profile blocked'
    OR v_device_info #>> '{voiceCall,model}' <> 'heartbeat-model'
  THEN
    RAISE EXCEPTION 'v180_smoke: heartbeat overwrote server capability state (%)', v_device_info;
  END IF;
  PERFORM public.aka_agent_merge_sms_voice_device_info(
    v_account.id,
    '{"voiceCall":{"capabilityStatus":"fallback_ready","status":"fallback","blockedReason":null,"profileKey":null,"profileVersion":null,"answerDetectionMode":"fallback_delay","fallbackDelaySeconds":15,"capabilityCheckedAt":"2026-07-17T00:00:01Z"}}'::jsonb,
    false
  );

  INSERT INTO public.auto_account_action_status (
    account_id, action_code, count_action_in_day, count_date,
    is_disable, date_enable, updated_at
  ) VALUES (
    v_account.id, 'voice_call', 0,
    timezone('Asia/Ho_Chi_Minh', now())::date,
    false, NULL, now()
  ) ON CONFLICT (account_id, action_code) DO UPDATE SET
    count_action_in_day = 0,
    count_date = timezone('Asia/Ho_Chi_Minh', now())::date,
    is_disable = false,
    date_enable = NULL,
    updated_at = now();

  INSERT INTO public.auto_voice_tts_assets (
    organization_id, content_hash, object_key, duration_ms, audio_sha256
  ) VALUES (
    v_account.organization_id,
    '__v180_smoke_hash__' || v_account.id::text,
    '__v180_smoke__/audio.mp3',
    1000,
    repeat('a', 64)
  ) RETURNING id INTO v_asset_id;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, content, extra_settings,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v180_smoke_event__', 'voice_call', v_account.id, 'chờ xử lý',
    'Nội dung kiểm thử',
    '{"voiceCall":{"schemaVersion":1,"fallbackDelaySeconds":15,"maxAudioSeconds":90,"noRetry":true},"actionLimits":{"dailyLimit":100000,"rateLimitCount":100000,"rateLimitMinutes":60}}'::jsonb,
    v_account.staff_id, v_account.organization_id, false
  ) RETURNING id INTO v_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, phone, content, status, is_delete
  ) VALUES (
    v_campaign_id, '0900000000', 'Nội dung kiểm thử', 'đang chạy', false
  ) RETURNING id INTO v_input_id;

  INSERT INTO public.auto_voice_call_jobs (
    organization_id, staff_id, account_id, input_data_id, campaign_id,
    campaign_name, device_id, phone, content, status, claim_token,
    lease_expires_at, tts_asset_id, content_hash, audio_duration_ms,
    audio_sha256
  ) VALUES (
    v_account.organization_id, v_account.staff_id, v_account.id, v_input_id,
    v_campaign_id, '__v180_smoke_event__', '__v180_smoke_device__',
    '0900000000', 'Nội dung kiểm thử', 'audio_ready', v_claim_token,
    now() + interval '5 minutes', v_asset_id,
    '__v180_smoke_hash__' || v_account.id::text, 1000, repeat('a', 64)
  ) RETURNING id INTO v_job_id;

  SELECT * INTO STRICT v_response
  FROM public.aka_agent_authorize_voice_call(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token, 1, 1001
  );
  IF v_response.authorized IS DISTINCT FROM true
    OR v_response.newly_committed IS DISTINCT FROM true
    OR v_response.job->>'status' <> 'dial_committed'
  THEN
    RAISE EXCEPTION 'v180_smoke: first dial authorization failed (%)', row_to_json(v_response);
  END IF;

  SELECT * INTO STRICT v_response
  FROM public.aka_agent_authorize_voice_call(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token, 1, 1001
  );
  IF v_response.authorized IS DISTINCT FROM true
    OR v_response.newly_committed IS DISTINCT FROM false
    OR v_response.reason <> 'already_committed'
  THEN
    RAISE EXCEPTION 'v180_smoke: authorize replay could place a second call (%)', row_to_json(v_response);
  END IF;

  SELECT count_action_in_day INTO STRICT v_count
  FROM public.auto_account_action_status
  WHERE account_id = v_account.id AND action_code = 'voice_call';
  IF v_count <> 1 OR (
    SELECT count(*) FROM public.auto_campaign_details
    WHERE input_data_id = v_input_id AND action_code = 'voice_call'
  ) <> 1 THEN
    RAISE EXCEPTION 'v180_smoke: authorize replay double-counted quota/detail';
  END IF;

  SELECT * INTO STRICT v_response
  FROM public.aka_agent_apply_voice_call_event(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token,
    v_event_id, 1, 'playback_completed', now(), '{"answerVerified":false}'::jsonb
  );
  IF v_response.accepted IS DISTINCT FROM true
    OR v_response.duplicate IS DISTINCT FROM false
    OR v_response.job->>'status' <> 'ending'
    OR v_response.job->>'result' <> 'success'
  THEN
    RAISE EXCEPTION 'v180_smoke: playback_completed CAS failed (%)', row_to_json(v_response);
  END IF;

  SELECT * INTO STRICT v_response
  FROM public.aka_agent_apply_voice_call_event(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token,
    v_event_id, 1, 'playback_completed', now(), '{}'::jsonb
  );
  IF v_response.accepted IS DISTINCT FROM true OR v_response.duplicate IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v180_smoke: duplicate event was not ACKed idempotently (%)', row_to_json(v_response);
  END IF;

  SELECT * INTO STRICT v_response
  FROM public.aka_agent_apply_voice_call_event(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token,
    gen_random_uuid(), 2, 'completed', now(), '{"hangupOutcome":"failed"}'::jsonb
  );
  IF v_response.accepted IS DISTINCT FROM true
    OR v_response.job->>'status' <> 'succeeded'
    OR v_response.job->>'result' <> 'success'
    OR v_response.job->>'hangup_outcome' <> 'failed'
  THEN
    RAISE EXCEPTION 'v180_smoke: completed success/hangup metadata mismatch (%)', row_to_json(v_response);
  END IF;

  SELECT * INTO STRICT v_response
  FROM public.aka_agent_apply_voice_call_event(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token,
    gen_random_uuid(), 3, 'placing', now(), '{}'::jsonb
  );
  IF v_response.accepted IS DISTINCT FROM false OR v_response.message <> 'terminal_status' THEN
    RAISE EXCEPTION 'v180_smoke: terminal job was resurrected (%)', row_to_json(v_response);
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, content, extra_settings,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v180_smoke_download__', 'voice_call', v_account.id, 'chờ xử lý',
    'Nội dung kiểm thử tải',
    '{"voiceCall":{"schemaVersion":1,"fallbackDelaySeconds":15,"maxAudioSeconds":90,"noRetry":true}}'::jsonb,
    v_account.staff_id, v_account.organization_id, false
  ) RETURNING id INTO v_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, phone, content, status, is_delete
  ) VALUES (
    v_campaign_id, '0900000001', 'Nội dung kiểm thử tải', 'đang chạy', false
  ) RETURNING id INTO v_input_id;

  v_claim_token := gen_random_uuid();
  INSERT INTO public.auto_voice_call_jobs (
    organization_id, staff_id, account_id, input_data_id, campaign_id,
    campaign_name, device_id, phone, content, status, claim_token,
    lease_expires_at, tts_asset_id, content_hash, audio_duration_ms, audio_sha256
  ) VALUES (
    v_account.organization_id, v_account.staff_id, v_account.id, v_input_id,
    v_campaign_id, '__v180_smoke_download__', '__v180_smoke_device__',
    '0900000001', 'Nội dung kiểm thử tải', 'audio_ready', v_claim_token,
    now() + interval '5 minutes', v_asset_id,
    '__v180_smoke_hash__' || v_account.id::text, 1000, repeat('a', 64)
  ) RETURNING id INTO v_job_id;

  UPDATE public.auto_campaigns SET status = 'tạm dừng' WHERE id = v_campaign_id;
  SELECT * INTO STRICT v_response
  FROM public.aka_agent_authorize_voice_call(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token, 1, 1001
  );
  IF v_response.authorized IS DISTINCT FROM false
    OR v_response.reason <> 'campaign_or_account_paused'
  THEN
    RAISE EXCEPTION 'v180_smoke: paused campaign authorized a dial (%)', row_to_json(v_response);
  END IF;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý' WHERE id = v_campaign_id;

  FOR v_input_id IN 1..3 LOOP
    SELECT * INTO STRICT v_response
    FROM public.aka_agent_apply_voice_call_event(
      v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token,
      gen_random_uuid(), v_input_id::integer, 'audio_download_failed', now(),
      '{"errorCode":"download_failed"}'::jsonb
    );
    IF v_response.accepted IS DISTINCT FROM true OR v_response.duplicate IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'v180_smoke: audio download event % was not accepted (%)', v_input_id, row_to_json(v_response);
    END IF;
  END LOOP;

  SELECT * INTO STRICT v_job FROM public.auto_voice_call_jobs WHERE id = v_job_id;
  IF v_job.status <> 'failed' OR v_job.result <> 'failed' OR v_job.audio_download_attempts <> 3 THEN
    RAISE EXCEPTION 'v180_smoke: audio download retries are not terminal after three attempts (%)', row_to_json(v_job);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_campaign_details
    WHERE input_data_id = v_job.input_data_id AND counts_toward_limit = true
  ) THEN
    RAISE EXCEPTION 'v180_smoke: pre-dial download failure consumed quota';
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, content, extra_settings,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v180_smoke_profile__', 'voice_call', v_account.id, 'đang chạy',
    'Nội dung kiểm thử profile',
    '{"voiceCall":{"schemaVersion":1,"fallbackDelaySeconds":15,"maxAudioSeconds":90,"noRetry":true}}'::jsonb,
    v_account.staff_id, v_account.organization_id, false
  ) RETURNING id INTO v_campaign_id;
  INSERT INTO public.auto_campaign_input_data (
    campaign_id, phone, content, status, is_delete
  ) VALUES (
    v_campaign_id, '0900000002', 'Nội dung kiểm thử profile', 'đang chạy', false
  ) RETURNING id INTO v_input_id;

  v_claim_token := gen_random_uuid();
  INSERT INTO public.auto_voice_call_jobs (
    organization_id, staff_id, account_id, input_data_id, campaign_id,
    campaign_name, device_id, phone, content, status, claim_token,
    lease_expires_at, tts_asset_id, content_hash, audio_duration_ms, audio_sha256
  ) VALUES (
    v_account.organization_id, v_account.staff_id, v_account.id, v_input_id,
    v_campaign_id, '__v180_smoke_profile__', '__v180_smoke_device__',
    '0900000002', 'Nội dung kiểm thử profile', 'audio_ready', v_claim_token,
    now() + interval '5 minutes', v_asset_id,
    '__v180_smoke_hash__' || v_account.id::text, 1000, repeat('a', 64)
  ) RETURNING id INTO v_job_id;

  SELECT * INTO STRICT v_response
  FROM public.aka_agent_apply_voice_call_event(
    v_job_id, v_account.id, '__v180_smoke_device__', v_claim_token,
    gen_random_uuid(), 1, 'failed', now(),
    '{"errorCode":"accessibility_profile_mismatch","errorMessage":"Profile không còn khớp","countsTowardLimit":false}'::jsonb
  );
  IF v_response.accepted IS DISTINCT FROM true
    OR v_response.job->>'status' <> 'failed'
    OR v_response.job->>'result' <> 'failed'
  THEN
    RAISE EXCEPTION 'v180_smoke: pre-dial profile failure was not terminal (%)', row_to_json(v_response);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auto_campaign_details
    WHERE input_data_id = v_input_id AND counts_toward_limit = true
  ) THEN
    RAISE EXCEPTION 'v180_smoke: pre-dial profile failure consumed quota';
  END IF;
END;
$behavior$;

SELECT jsonb_build_object(
  'test', 'migration_v180_voice_call_mobile_runtime_smoke',
  'passed', true,
  'activation', 'run migration_v181_activate_voice_call_mobile_runtime.sql last',
  'persistent_marker_rows', 0
) AS result;

ROLLBACK;
