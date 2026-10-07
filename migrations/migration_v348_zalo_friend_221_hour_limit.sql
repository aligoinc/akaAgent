-- v348: data-only; live source captured 2026-10-06 02:02:39.98248+00 on cgjbsmqtfhqvttudyjzq.
-- Scope is the existing friend-message action (direct send and share).
-- Preserve the existing partial-success batch rule, quota and terminal detail behavior.
-- No RPC, connection, DDL setup or PostgREST schema reload.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.auto_error IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e) IS DISTINCT FROM '159646ca3dafb959177c1379c63e573a' THEN
    RAISE EXCEPTION 'v348 preflight: live policy checksum changed'; END IF;
  IF md5((jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.auto_error'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.auto_error'::regclass),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgrelid,tgname) FROM pg_trigger WHERE tgrelid IN ('public.auto_error'::regclass,'supabase_migrations.schema_migrations'::regclass) AND NOT tgisinternal)))::text) IS DISTINCT FROM 'dfcf3e836e62d21dc647bfe74c896344' THEN
    RAISE EXCEPTION 'v348 preflight: policy metadata or triggers changed'; END IF;
  IF (SELECT md5(to_jsonb(a)::text) FROM public.auto_account_actions a WHERE code='zalo_message_friend') IS DISTINCT FROM 'cd06b29750f198c5a0cf93d7b6461101' THEN
    RAISE EXCEPTION 'v348 preflight: friend action changed'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name ~ '^migration_v348(_|$)') THEN
    RAISE EXCEPTION 'v348 preflight: version already applied'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code='err_zalo_221_message_friend' OR
    (is_active AND NOT is_delete AND '221'=ANY(zalo_error_codes) AND
      (cardinality(zalo_action_codes)=0 OR 'zalo_message_friend'=ANY(zalo_action_codes)))) THEN
    RAISE EXCEPTION 'v348 preflight: conflicting code or 221 friend/global scope'; END IF;
END $preflight$;

INSERT INTO public.auto_error (count_consecutive_errors, counts_toward_bad_target, counts_toward_limit, detail_status, disable_action_codes, disable_action_days, disable_action_mode, disable_action_time, error_code, error_desc, error_element, error_name, error_type, is_active, is_delete, noti_campaign, noti_running_process, time_disable_actions, update_login_status, update_status_account, update_status_campaign, zalo_action_codes, zalo_error_codes)
SELECT count_consecutive_errors, counts_toward_bad_target, counts_toward_limit, detail_status, disable_action_codes, disable_action_days, disable_action_mode, disable_action_time, error_code, error_desc, error_element, error_name, error_type, is_active, is_delete, noti_campaign, noti_running_process, time_disable_actions, update_login_status, update_status_account, update_status_campaign, zalo_action_codes, zalo_error_codes
FROM jsonb_populate_record(NULL::public.auto_error, $policy${
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
}$policy$::jsonb);

DO $postflight$
BEGIN
  IF (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e WHERE error_code<>'err_zalo_221_message_friend') IS DISTINCT FROM '159646ca3dafb959177c1379c63e573a' THEN
    RAISE EXCEPTION 'v348 postflight: existing policies changed'; END IF;
  IF (SELECT count(*) FROM public.auto_error) <> 46 THEN
    RAISE EXCEPTION 'v348 postflight: unexpected policy count'; END IF;
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
    RAISE EXCEPTION 'v348 postflight: inserted policy differs'; END IF;
END $postflight$;
COMMIT;
