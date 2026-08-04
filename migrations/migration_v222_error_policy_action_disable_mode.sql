-- Make action-disable timing data-driven so new errors can opt into an
-- end-of-day restriction without another runtime code change.
--
-- Backward compatibility:
-- - Older binaries ignore disable_action_mode.
-- - The new daily Zalo policy keeps time_disable_actions = 720, so older
--   binaries preserve the temporary 12-hour restriction behavior.

BEGIN;

ALTER TABLE public.auto_error
  ADD COLUMN IF NOT EXISTS disable_action_mode text NOT NULL DEFAULT 'fixed_minutes';

UPDATE public.auto_error
SET disable_action_mode = 'fixed_minutes'
WHERE disable_action_mode IS NULL
   OR disable_action_mode NOT IN ('fixed_minutes', 'end_of_day', 'indefinite');

ALTER TABLE public.auto_error
  ALTER COLUMN disable_action_mode SET DEFAULT 'fixed_minutes',
  ALTER COLUMN disable_action_mode SET NOT NULL;

ALTER TABLE public.auto_error
  DROP CONSTRAINT IF EXISTS auto_error_disable_action_mode_check;

ALTER TABLE public.auto_error
  ADD CONSTRAINT auto_error_disable_action_mode_check
  CHECK (disable_action_mode IN ('fixed_minutes', 'end_of_day', 'indefinite'));

COMMENT ON COLUMN public.auto_error.disable_action_mode IS
  'Action disable timing: fixed_minutes uses time_disable_actions; end_of_day resumes at 00:00 Asia/Ho_Chi_Minh; indefinite requires manual enable.';

UPDATE public.auto_error
SET
  error_name = 'Đạt giới hạn tìm SĐT trong giờ',
  error_desc = 'Zalo trả lỗi đạt giới hạn tìm kiếm số điện thoại trong giờ',
  noti_running_process = 'Đạt giới hạn tìm kiếm SĐT trong giờ',
  noti_campaign = 'Đạt giới hạn tìm kiếm SĐT trong giờ, tạm nghỉ [x] phút',
  zalo_error_codes = ARRAY['312', '221']::text[],
  disable_action_codes = ARRAY['zalo_find_phone_user']::text[],
  time_disable_actions = 60,
  disable_action_mode = 'fixed_minutes',
  updated_at = now()
WHERE error_code = 'err_zalo_find_phone_limit';

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
  disable_action_mode,
  count_consecutive_errors,
  zalo_error_codes,
  detail_status,
  counts_toward_limit,
  counts_toward_bad_target,
  update_login_status
)
VALUES (
  'external zalo',
  'Đạt giới hạn tìm SĐT trong ngày',
  'Zalo trả lỗi đạt giới hạn tìm kiếm số điện thoại trong ngày',
  'err_zalo_find_phone_day_limit',
  NULL,
  'Đạt giới hạn tìm kiếm SĐT trong ngày',
  'Đạt giới hạn tìm kiếm SĐT trong ngày, tạm nghỉ đến hết ngày',
  NULL,
  NULL,
  ARRAY['zalo_find_phone_user']::text[],
  720,
  'end_of_day',
  NULL,
  ARRAY['313', '304']::text[],
  NULL,
  true,
  false,
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
  disable_action_mode = EXCLUDED.disable_action_mode,
  count_consecutive_errors = EXCLUDED.count_consecutive_errors,
  zalo_error_codes = EXCLUDED.zalo_error_codes,
  detail_status = EXCLUDED.detail_status,
  counts_toward_limit = EXCLUDED.counts_toward_limit,
  counts_toward_bad_target = EXCLUDED.counts_toward_bad_target,
  update_login_status = EXCLUDED.update_login_status,
  is_active = true,
  is_delete = false,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

COMMIT;
