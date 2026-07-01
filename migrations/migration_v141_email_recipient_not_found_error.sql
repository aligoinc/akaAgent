-- Email recipient precheck: map hard recipient failures to the same
-- user-facing detail status used by Zalo missing targets.

BEGIN;

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
  count_consecutive_errors,
  zalo_error_codes,
  detail_status,
  counts_toward_limit,
  counts_toward_bad_target,
  update_login_status
)
VALUES (
  'external email',
  'Email không tồn tại',
  'Địa chỉ email người nhận không tồn tại hoặc domain không nhận mail',
  'err_email_recipient_not_found',
  NULL,
  'Email không tồn tại',
  'Email không tồn tại',
  NULL,
  NULL,
  ARRAY[]::text[],
  NULL,
  NULL,
  ARRAY[]::text[],
  'không tồn tại',
  false,
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
  count_consecutive_errors = EXCLUDED.count_consecutive_errors,
  zalo_error_codes = EXCLUDED.zalo_error_codes,
  detail_status = EXCLUDED.detail_status,
  counts_toward_limit = EXCLUDED.counts_toward_limit,
  counts_toward_bad_target = EXCLUDED.counts_toward_bad_target,
  update_login_status = EXCLUDED.update_login_status,
  is_active = true,
  is_delete = false,
  updated_at = now();

COMMIT;
