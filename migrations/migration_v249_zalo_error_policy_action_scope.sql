-- A single Zalo business code can mean different things depending on the API
-- that returned it. Scope policy matching by the action that raised the error
-- so code 221 from sendFriendRequest cannot disable phone lookup.

BEGIN;

ALTER TABLE public.auto_error
  ADD COLUMN IF NOT EXISTS zalo_action_codes text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.auto_error.zalo_action_codes IS
  'Optional action scope used when matching zalo_error_codes. Empty means the policy applies to every Zalo action.';

UPDATE public.auto_error
SET
  zalo_error_codes = ARRAY['312']::text[],
  zalo_action_codes = ARRAY['zalo_find_phone_user']::text[],
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
  zalo_action_codes,
  detail_status,
  counts_toward_limit,
  counts_toward_bad_target,
  update_login_status
)
VALUES (
  'external zalo',
  'Đạt giới hạn kết bạn trong giờ',
  'Zalo giới hạn số request gửi lời mời kết bạn trong giờ',
  'err_zalo_add_friend_limit',
  NULL,
  'Đạt giới hạn kết bạn trong giờ',
  'Đạt giới hạn kết bạn trong giờ; tạm nghỉ 60 phút',
  NULL,
  NULL,
  ARRAY['zalo_add_friend']::text[],
  60,
  'fixed_minutes',
  NULL,
  ARRAY['221']::text[],
  ARRAY['zalo_add_friend']::text[],
  'thất bại',
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
  zalo_action_codes = EXCLUDED.zalo_action_codes,
  detail_status = EXCLUDED.detail_status,
  counts_toward_limit = EXCLUDED.counts_toward_limit,
  counts_toward_bad_target = EXCLUDED.counts_toward_bad_target,
  update_login_status = EXCLUDED.update_login_status,
  is_active = true,
  is_delete = false,
  updated_at = now();

COMMIT;
