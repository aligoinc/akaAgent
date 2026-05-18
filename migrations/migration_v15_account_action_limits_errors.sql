-- ============================================================
-- Migration v15: Account action limits and error policies
-- - auto_account_actions: action definitions used by account-level limits
-- - auto_error: normalized error policies
-- - auto_account_action_status: per-account action counters/disable state
-- - auto_account_error_state: consecutive error tracking
-- - auto_campaign_details.action_code/error_code: source of truth for action history
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_account_actions (
  id BIGSERIAL PRIMARY KEY,
  flatform_type text NOT NULL DEFAULT 'facebook',
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_account_actions_platform
  ON public.auto_account_actions(flatform_type)
  WHERE is_delete = false;

CREATE TABLE IF NOT EXISTS public.auto_error (
  id BIGSERIAL PRIMARY KEY,
  error_type text NOT NULL,
  error_name text NOT NULL,
  error_desc text,
  error_code text NOT NULL UNIQUE,
  error_element text,
  noti_running_process text,
  noti_campaign text,
  update_status_account text,
  update_status_campaign text,
  disable_action_codes text[] NOT NULL DEFAULT '{}',
  time_disable_actions integer,
  count_consecutive_errors integer,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_error_code
  ON public.auto_error(error_code)
  WHERE is_delete = false;

CREATE TABLE IF NOT EXISTS public.auto_account_action_status (
  id BIGSERIAL PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  action_code text NOT NULL REFERENCES public.auto_account_actions(code),
  count_action_in_day integer NOT NULL DEFAULT 0,
  count_date date NOT NULL DEFAULT (timezone('Asia/Ho_Chi_Minh', now())::date),
  is_disable boolean NOT NULL DEFAULT false,
  date_enable timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_account_action_status_unique UNIQUE (account_id, action_code)
);

CREATE INDEX IF NOT EXISTS idx_auto_account_action_status_account
  ON public.auto_account_action_status(account_id);
CREATE INDEX IF NOT EXISTS idx_auto_account_action_status_disable
  ON public.auto_account_action_status(is_disable, date_enable)
  WHERE is_disable = true;

CREATE TABLE IF NOT EXISTS public.auto_account_error_state (
  id BIGSERIAL PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  action_code text NOT NULL DEFAULT '',
  error_code text NOT NULL REFERENCES public.auto_error(error_code),
  count_consecutive_errors integer NOT NULL DEFAULT 0,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_account_error_state_unique UNIQUE (account_id, action_code, error_code)
);

CREATE INDEX IF NOT EXISTS idx_auto_account_error_state_account
  ON public.auto_account_error_state(account_id);

ALTER TABLE public.auto_campaign_details
  ADD COLUMN IF NOT EXISTS action_code text,
  ADD COLUMN IF NOT EXISTS error_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_details_action_code_fkey'
  ) THEN
    ALTER TABLE public.auto_campaign_details
      ADD CONSTRAINT auto_campaign_details_action_code_fkey
      FOREIGN KEY (action_code) REFERENCES public.auto_account_actions(code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_details_error_code_fkey'
  ) THEN
    ALTER TABLE public.auto_campaign_details
      ADD CONSTRAINT auto_campaign_details_error_code_fkey
      FOREIGN KEY (error_code) REFERENCES public.auto_error(error_code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_campaign_details_action_rate
  ON public.auto_campaign_details(account_id, action_code, created_at)
  WHERE is_delete = false AND action_code IS NOT NULL;

ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS note text;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('facebook', 'Đăng bài group', 'fb_post_group'),
  ('facebook', 'Đăng bài trang cá nhân', 'fb_post_my_profile'),
  ('facebook', 'Comment', 'fb_comment'),
  ('facebook', 'Nhắn tin người lạ', 'fb_message_stranger'),
  ('facebook', 'Nhắn tin bạn bè', 'fb_message_friend'),
  ('facebook', 'Kết bạn', 'fb_add_friend'),
  ('facebook', 'Like post', 'fb_like_post')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_error (
  error_type,
  error_name,
  error_desc,
  error_code,
  error_element,
  noti_running_process,
  noti_campaign,
  update_status_account,
  update_status_campaign,
  disable_action_codes,
  time_disable_actions,
  count_consecutive_errors
)
VALUES
  (
    'auth',
    'Tài khoản bị đăng xuất',
    'Tài khoản bị đăng xuất',
    'err_logout',
    NULL,
    'Tài khoản bị đăng xuất',
    NULL,
    NULL,
    NULL,
    '{}',
    NULL,
    NULL
  ),
  (
    'business rule',
    'Đạt giới hạn trong ngày',
    'Đạt giới hạn trong ngày',
    'error_limit_in_day',
    NULL,
    'Đạt giới hạn trong ngày là [x]',
    'Đạt giới hạn trong ngày là [x]',
    NULL,
    NULL,
    '{}',
    NULL,
    NULL
  ),
  (
    'business rule',
    'Đạt giới hạn trong giờ',
    'Đạt giới hạn trong giờ',
    'error_limit_in_hour',
    NULL,
    'Đạt giới hạn trong giờ là [x] tạm nghỉ [t] phút',
    'Đạt giới hạn trong giờ là [x]',
    NULL,
    NULL,
    '{}',
    NULL,
    NULL
  ),
  (
    'system',
    'Lỗi không xác định',
    'Lỗi không xác định',
    'err_undefined',
    NULL,
    'Có lỗi xảy ra',
    'Có lỗi xảy ra',
    NULL,
    'tạm dừng',
    '{}',
    NULL,
    5
  ),
  (
    'external facebook',
    'Nhắn tin',
    'Bạn đã đạt giới hạn về số tin nhắn đang chờ',
    'err_limit_waiting_message',
    '//span//span[contains(.,"Bạn đã đạt giới hạn về số tin nhắn đang chờ")]',
    'Bạn đã đạt giới hạn về số tin nhắn đang chờ',
    'Bạn đã đạt giới hạn về số tin nhắn đang chờ',
    NULL,
    NULL,
    ARRAY['fb_message_stranger'],
    60,
    NULL
  )
ON CONFLICT (error_code) DO UPDATE SET
  error_type = EXCLUDED.error_type,
  error_name = EXCLUDED.error_name,
  error_desc = EXCLUDED.error_desc,
  error_element = EXCLUDED.error_element,
  noti_running_process = EXCLUDED.noti_running_process,
  noti_campaign = EXCLUDED.noti_campaign,
  update_status_account = EXCLUDED.update_status_account,
  update_status_campaign = EXCLUDED.update_status_campaign,
  disable_action_codes = EXCLUDED.disable_action_codes,
  time_disable_actions = EXCLUDED.time_disable_actions,
  count_consecutive_errors = EXCLUDED.count_consecutive_errors,
  is_active = true,
  is_delete = false,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.increment_auto_account_action_count(
  p_account_id bigint,
  p_action_code text,
  p_amount integer DEFAULT 1
)
RETURNS public.auto_account_action_status
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := timezone('Asia/Ho_Chi_Minh', now())::date;
  v_row public.auto_account_action_status;
BEGIN
  IF p_account_id IS NULL OR p_action_code IS NULL OR btrim(p_action_code) = '' THEN
    RAISE EXCEPTION 'account_id and action_code are required';
  END IF;

  INSERT INTO public.auto_account_action_status (
    account_id,
    action_code,
    count_action_in_day,
    count_date,
    updated_at
  )
  VALUES (
    p_account_id,
    p_action_code,
    GREATEST(COALESCE(p_amount, 1), 0),
    v_today,
    now()
  )
  ON CONFLICT (account_id, action_code) DO UPDATE SET
    count_action_in_day = CASE
      WHEN public.auto_account_action_status.count_date = v_today
        THEN public.auto_account_action_status.count_action_in_day + GREATEST(COALESCE(p_amount, 1), 0)
      ELSE GREATEST(COALESCE(p_amount, 1), 0)
    END,
    count_date = v_today,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_auto_account_action_status_daily()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.auto_account_action_status
  SET count_action_in_day = 0,
      count_date = timezone('Asia/Ho_Chi_Minh', now())::date,
      updated_at = now()
  WHERE count_date <> timezone('Asia/Ho_Chi_Minh', now())::date;
$$;

CREATE OR REPLACE FUNCTION public.enable_due_auto_account_actions()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.auto_account_action_status
  SET is_disable = false,
      date_enable = NULL,
      updated_at = now()
  WHERE is_disable = true
    AND date_enable IS NOT NULL
    AND date_enable <= now();
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN (
      'auto_account_action_status_reset_daily',
      'auto_account_action_status_enable_due'
    );

    PERFORM cron.schedule(
      'auto_account_action_status_reset_daily',
      '0 17 * * *',
      'select public.reset_auto_account_action_status_daily();'
    );

    PERFORM cron.schedule(
      'auto_account_action_status_enable_due',
      '* * * * *',
      'select public.enable_due_auto_account_actions();'
    );
  END IF;
END $$;

COMMENT ON TABLE public.auto_account_actions IS 'Account-level action definitions used for limits and disabled action policy.';
COMMENT ON TABLE public.auto_error IS 'Normalized campaign/account runtime errors and their handling policy.';
COMMENT ON TABLE public.auto_account_action_status IS 'Per-account action count and temporary disabled status.';
COMMENT ON COLUMN public.auto_campaign_details.action_code IS 'Action code from auto_account_actions; used for rate limits and account action status.';
COMMENT ON COLUMN public.auto_campaign_details.error_code IS 'Normalized error code from auto_error when the detail row records an error.';
COMMENT ON COLUMN public.auto_campaigns.note IS 'Transient customer-visible campaign note; reset on app start and before each run.';

NOTIFY pgrst, 'reload schema';

COMMIT;
