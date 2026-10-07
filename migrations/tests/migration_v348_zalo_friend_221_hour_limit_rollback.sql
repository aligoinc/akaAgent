-- Disable only the unchanged v348 policy; preserve runtime/log references.
-- Existing 60-minute action restrictions expire normally; this does not clear them.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.auto_error IN SHARE ROW EXCLUSIVE MODE;
DO $rollback$
BEGIN
  IF (SELECT to_jsonb(e)-'id'-'created_at'-'updated_at' FROM public.auto_error e WHERE error_code='err_zalo_221_message_friend') IS DISTINCT FROM $policy${
  "count_consecutive_errors": null,
  "counts_toward_bad_target": false,
  "counts_toward_limit": true,
  "detail_status": "thất bại",
  "disable_action_codes": [
    "zalo_message_friend"
  ],
  "disable_action_days": null,
  "disable_action_mode": "fixed_minutes",
  "disable_action_time": null,
  "error_code": "err_zalo_221_message_friend",
  "error_desc": "Zalo trả lỗi 221 khi gửi hoặc chia sẻ tin nhắn đến bạn bè; tạm khóa hành động nhắn bạn bè 60 phút.",
  "error_element": null,
  "error_name": "Đạt giới hạn nhắn bạn bè (mã 221)",
  "error_type": "external zalo",
  "is_active": true,
  "is_delete": false,
  "noti_campaign": "Tạm khóa nhắn bạn bè 60 phút.",
  "noti_running_process": "Đạt giới hạn nhắn bạn bè (mã 221)",
  "time_disable_actions": 60,
  "update_login_status": null,
  "update_status_account": null,
  "update_status_campaign": null,
  "zalo_action_codes": [
    "zalo_message_friend"
  ],
  "zalo_error_codes": [
    "221"
  ]
}$policy$::jsonb THEN
    RAISE EXCEPTION 'v348 rollback: policy changed or missing'; END IF;
  UPDATE public.auto_error SET is_active=false,updated_at=clock_timestamp() WHERE error_code='err_zalo_221_message_friend';
END $rollback$;
COMMIT;
