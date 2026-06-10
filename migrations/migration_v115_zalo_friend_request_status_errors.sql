-- Map Zalo friend-request status codes through auto_error so campaign runtime
-- does not hard-code these business outcomes.

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
VALUES
  (
    'external zalo',
    'Đã gửi lời mời kết bạn',
    'Zalo báo lời mời kết bạn đã được gửi hoặc đang tồn tại',
    'err_zalo_friend_request_sent',
    NULL,
    'Đã gửi lời mời',
    'Đã gửi lời mời',
    NULL,
    NULL,
    '{}'::text[],
    NULL,
    NULL,
    ARRAY['222']::text[],
    'đã gửi lời mời',
    false,
    false,
    NULL
  ),
  (
    'external zalo',
    'Đã là bạn bè',
    'Zalo báo user đã là bạn bè với tài khoản hiện tại',
    'err_zalo_already_friend',
    NULL,
    'Đã là bạn bè',
    'Đã là bạn bè',
    NULL,
    NULL,
    '{}'::text[],
    NULL,
    NULL,
    ARRAY['225']::text[],
    'đã là bạn bè',
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
