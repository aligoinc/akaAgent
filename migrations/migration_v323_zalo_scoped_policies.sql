-- Production cgjbsmqtfhqvttudyjzq. Apply ONLY after runtime release.
-- Data only: no DDL, RPC replacement, schema reload, action lock or campaign writes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.auto_error IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE expected jsonb := $json$
{
  "1": "eb95b70d1456df26e9cc05902d067655",
  "2": "b5515e2fd99dc515e5d9fa7327c74c03",
  "3": "dccd0563fb8d5991e94e541a7e75daf4",
  "4": "a6a9d19cb9933d185c0cfbe7679899d4",
  "5": "92a44f4ae4723cc23a763937fdaec913",
  "6": "903c8de854a445a8c46601199b09c4ea",
  "7": "df9ebaaae05cd269b84d8b8408f39572",
  "8": "51b46f5bb6e36969e857c84c9e6cc564",
  "9": "7f01beb839af2b08420046c548842db6",
  "10": "c2ef976686a3caf3839f221eca3667ff",
  "11": "adf2d8ac415c55dc5bd207a9f38abc77",
  "12": "ac7fed95fefa546869f851bcb9723558",
  "13": "b8265d20dd6cee5450ecd09c23da2555",
  "14": "c8a37ce83c2cab9ec3f6d6b2295c05db",
  "15": "81020b22de85fd737f1475af2c66d0c7",
  "16": "eebb37948f318257b0b11347066acd47",
  "17": "91f6fd73356373f246c69b75dda92aa7",
  "18": "624d7557e78124963f450755d8a358a8",
  "31": "c6d1a219d468e9b74eeaf352f6ff02c4",
  "32": "68fc7d2c569b25d6d3009fd1cf85b1bd",
  "33": "d1513fe9089ef27173a433b67c17589a",
  "34": "9669698cf58461ce6bd1e1ca7d13bc2d",
  "35": "5b14a734b59fc31bcb7f089a1fecb8f9",
  "36": "8345ac02f25659a91b809d6f12b1e538",
  "41": "06196187289441575509954ab0387999"
}
$json$::jsonb;
BEGIN
  IF (SELECT count(*) FROM public.auto_error) <> 25 THEN
    RAISE EXCEPTION 'v323 preflight: policy row count changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error e WHERE
    expected->>e.id::text IS DISTINCT FROM md5((to_jsonb(e)-'disable_action_days'-'disable_action_time')::text)
    OR e.disable_action_days IS NOT NULL OR e.disable_action_time IS NOT NULL) THEN
    RAISE EXCEPTION 'v323 preflight: live policy checksum changed; recapture/review, do not overwrite';
  END IF;
END $preflight$;

UPDATE public.auto_error
SET zalo_error_codes = ARRAY[]::text[], is_active = false, updated_at = transaction_timestamp()
WHERE id IN (12,13);
INSERT INTO public.auto_error (error_code, error_type, error_name, error_desc, zalo_error_codes, zalo_action_codes, disable_action_codes, disable_action_mode, time_disable_actions, disable_action_days, disable_action_time, detail_status, counts_toward_limit, counts_toward_bad_target, update_status_campaign, update_status_account, update_login_status, count_consecutive_errors, noti_running_process, noti_campaign, is_active, is_delete, error_element)
SELECT error_code, error_type, error_name, error_desc, zalo_error_codes, zalo_action_codes, disable_action_codes, disable_action_mode, time_disable_actions, disable_action_days, disable_action_time, detail_status, counts_toward_limit, counts_toward_bad_target, update_status_campaign, update_status_account, update_login_status, count_consecutive_errors, noti_running_process, noti_campaign, is_active, is_delete, error_element FROM jsonb_to_recordset($json$
[
  {
    "error_code": "err_zalo_120_message_stranger",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn người lạ (mã 120)",
    "error_desc": "Zalo hạn chế nhắn người lạ (mã 120)",
    "zalo_error_codes": [
      "120"
    ],
    "zalo_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 1440,
    "disable_action_days": 1,
    "disable_action_time": "09:45:00",
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn người lạ (mã 120)",
    "noti_campaign": "Zalo hạn chế nhắn người lạ (mã 120). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_120_add_group_member",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế thêm thành viên nhóm (mã 120)",
    "error_desc": "Zalo hạn chế thêm thành viên nhóm (mã 120)",
    "zalo_error_codes": [
      "120"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 1440,
    "disable_action_days": 1,
    "disable_action_time": "09:45:00",
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế thêm thành viên nhóm (mã 120)",
    "noti_campaign": "Zalo hạn chế thêm thành viên nhóm (mã 120). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_802_message_stranger",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn người lạ (mã 802)",
    "error_desc": "Zalo hạn chế nhắn người lạ (mã 802)",
    "zalo_error_codes": [
      "802"
    ],
    "zalo_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 2880,
    "disable_action_days": 2,
    "disable_action_time": "09:45:00",
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn người lạ (mã 802)",
    "noti_campaign": "Zalo hạn chế nhắn người lạ (mã 802). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_802_add_group_member",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế thêm thành viên nhóm (mã 802)",
    "error_desc": "Zalo hạn chế thêm thành viên nhóm (mã 802)",
    "zalo_error_codes": [
      "802"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 2880,
    "disable_action_days": 2,
    "disable_action_time": "09:45:00",
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế thêm thành viên nhóm (mã 802)",
    "noti_campaign": "Zalo hạn chế thêm thành viên nhóm (mã 802). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_123_message_friend",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123)",
    "error_desc": "Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123)",
    "zalo_error_codes": [
      "123"
    ],
    "zalo_action_codes": [
      "zalo_message_friend"
    ],
    "disable_action_codes": [
      "zalo_message_friend"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123)",
    "noti_campaign": "Tạm khóa nhắn bạn bè 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_123_message_stranger",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123)",
    "error_desc": "Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123)",
    "zalo_error_codes": [
      "123"
    ],
    "zalo_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123)",
    "noti_campaign": "Tạm khóa nhắn người lạ 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_123_message_group",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123)",
    "error_desc": "Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123)",
    "zalo_error_codes": [
      "123"
    ],
    "zalo_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123)",
    "noti_campaign": "Tạm khóa nhắn nhóm 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_126_127_message_personal",
    "error_type": "external zalo",
    "error_name": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "error_desc": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "zalo_error_codes": [
      "126",
      "127"
    ],
    "zalo_action_codes": [
      "zalo_message_friend",
      "zalo_message_stranger"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "noti_campaign": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_126_127_message_group",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn nhóm (mã 126/127)",
    "error_desc": "Zalo hạn chế nhắn nhóm (mã 126/127)",
    "zalo_error_codes": [
      "126",
      "127"
    ],
    "zalo_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn nhóm (mã 126/127)",
    "noti_campaign": "Tạm khóa nhắn nhóm 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_126_add_group_member",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế thêm thành viên nhóm (mã 126)",
    "error_desc": "Zalo hạn chế thêm thành viên nhóm (mã 126)",
    "zalo_error_codes": [
      "126"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế thêm thành viên nhóm (mã 126)",
    "noti_campaign": "Tạm khóa thêm thành viên nhóm 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_221_message_group",
    "error_type": "external zalo",
    "error_name": "Đạt giới hạn nhắn nhóm (mã 221)",
    "error_desc": "Đạt giới hạn nhắn nhóm (mã 221)",
    "zalo_error_codes": [
      "221"
    ],
    "zalo_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 60,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Đạt giới hạn nhắn nhóm (mã 221)",
    "noti_campaign": "Tạm khóa nhắn nhóm 60 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_223_add_friend_pause",
    "error_type": "external zalo",
    "error_name": "Zalo từ chối kết bạn (mã 223)",
    "error_desc": "Zalo từ chối kết bạn (mã 223)",
    "zalo_error_codes": [
      "223"
    ],
    "zalo_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": "tạm dừng",
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo từ chối kết bạn (mã 223)",
    "noti_campaign": "Chiến dịch tạm dừng do lỗi Zalo 223; kiểm tra và chạy lại thủ công.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_224_add_friend_full",
    "error_type": "external zalo",
    "error_name": "Danh bạ Zalo đã đầy (mã 224)",
    "error_desc": "Danh bạ Zalo đã đầy (mã 224)",
    "zalo_error_codes": [
      "224"
    ],
    "zalo_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_mode": "indefinite",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": "tạm dừng",
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Danh bạ Zalo đã đầy (mã 224)",
    "noti_campaign": "Danh bạ Zalo đã đầy; xử lý danh bạ, mở khóa kết bạn và chạy lại chiến dịch thủ công.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_215_251_add_friend_rejected",
    "error_type": "external zalo",
    "error_name": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "error_desc": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "zalo_error_codes": [
      "215",
      "251"
    ],
    "zalo_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "noti_campaign": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_219_find_phone_invalid",
    "error_type": "external zalo",
    "error_name": "Số điện thoại không hợp lệ (mã 219)",
    "error_desc": "Số điện thoại không hợp lệ (mã 219)",
    "zalo_error_codes": [
      "219"
    ],
    "zalo_action_codes": [
      "zalo_find_phone_user"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": false,
    "counts_toward_bad_target": true,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Số điện thoại không hợp lệ (mã 219)",
    "noti_campaign": "Số điện thoại không hợp lệ (mã 219)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_227_join_group_link_invalid",
    "error_type": "external zalo",
    "error_name": "Link nhóm Zalo không hợp lệ (mã 227)",
    "error_desc": "Link nhóm Zalo không hợp lệ (mã 227)",
    "zalo_error_codes": [
      "227"
    ],
    "zalo_action_codes": [
      "zalo_join_group_link"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": false,
    "counts_toward_bad_target": true,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Link nhóm Zalo không hợp lệ (mã 227)",
    "noti_campaign": "Link nhóm Zalo không hợp lệ (mã 227)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_210_target_unavailable",
    "error_type": "external zalo",
    "error_name": "Người nhận bị Zalo chặn (mã 210)",
    "error_desc": "Người nhận bị Zalo chặn (mã 210)",
    "zalo_error_codes": [
      "210"
    ],
    "zalo_action_codes": [
      "zalo_find_phone_user",
      "zalo_add_friend"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "không tồn tại",
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Người nhận bị Zalo chặn (mã 210)",
    "noti_campaign": "Người nhận bị Zalo chặn (mã 210)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_264_269_add_group_member_pause",
    "error_type": "external zalo",
    "error_name": "Zalo không cho thêm trực tiếp thành viên (mã 264/269)",
    "error_desc": "Zalo không cho thêm trực tiếp thành viên (mã 264/269)",
    "zalo_error_codes": [
      "264",
      "269"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": "tạm dừng",
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo không cho thêm trực tiếp thành viên (mã 264/269)",
    "noti_campaign": "Chiến dịch tạm dừng; kiểm tra nhóm và cách mời thành viên rồi chạy lại thủ công.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  }
]
$json$::jsonb) AS p(error_code text, error_type text, error_name text, error_desc text, zalo_error_codes text[], zalo_action_codes text[], disable_action_codes text[], disable_action_mode text, time_disable_actions integer, disable_action_days integer, disable_action_time time without time zone, detail_status text, counts_toward_limit boolean, counts_toward_bad_target boolean, update_status_campaign text, update_status_account text, update_login_status text, count_consecutive_errors integer, noti_running_process text, noti_campaign text, is_active boolean, is_delete boolean, error_element text);

DO $verify$
DECLARE expected jsonb := $json$
[
  {
    "error_code": "err_zalo_120_message_stranger",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn người lạ (mã 120)",
    "error_desc": "Zalo hạn chế nhắn người lạ (mã 120)",
    "zalo_error_codes": [
      "120"
    ],
    "zalo_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 1440,
    "disable_action_days": 1,
    "disable_action_time": "09:45:00",
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn người lạ (mã 120)",
    "noti_campaign": "Zalo hạn chế nhắn người lạ (mã 120). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_120_add_group_member",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế thêm thành viên nhóm (mã 120)",
    "error_desc": "Zalo hạn chế thêm thành viên nhóm (mã 120)",
    "zalo_error_codes": [
      "120"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 1440,
    "disable_action_days": 1,
    "disable_action_time": "09:45:00",
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế thêm thành viên nhóm (mã 120)",
    "noti_campaign": "Zalo hạn chế thêm thành viên nhóm (mã 120). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_802_message_stranger",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn người lạ (mã 802)",
    "error_desc": "Zalo hạn chế nhắn người lạ (mã 802)",
    "zalo_error_codes": [
      "802"
    ],
    "zalo_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 2880,
    "disable_action_days": 2,
    "disable_action_time": "09:45:00",
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn người lạ (mã 802)",
    "noti_campaign": "Zalo hạn chế nhắn người lạ (mã 802). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_802_add_group_member",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế thêm thành viên nhóm (mã 802)",
    "error_desc": "Zalo hạn chế thêm thành viên nhóm (mã 802)",
    "zalo_error_codes": [
      "802"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_mode": "days_at_time",
    "time_disable_actions": 2880,
    "disable_action_days": 2,
    "disable_action_time": "09:45:00",
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế thêm thành viên nhóm (mã 802)",
    "noti_campaign": "Zalo hạn chế thêm thành viên nhóm (mã 802). Hành động tạm khóa; xem thời điểm mở trong thông tin tài khoản.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_123_message_friend",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123)",
    "error_desc": "Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123)",
    "zalo_error_codes": [
      "123"
    ],
    "zalo_action_codes": [
      "zalo_message_friend"
    ],
    "disable_action_codes": [
      "zalo_message_friend"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123)",
    "noti_campaign": "Tạm khóa nhắn bạn bè 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_123_message_stranger",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123)",
    "error_desc": "Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123)",
    "zalo_error_codes": [
      "123"
    ],
    "zalo_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_codes": [
      "zalo_message_stranger"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123)",
    "noti_campaign": "Tạm khóa nhắn người lạ 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_123_message_group",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123)",
    "error_desc": "Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123)",
    "zalo_error_codes": [
      "123"
    ],
    "zalo_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123)",
    "noti_campaign": "Tạm khóa nhắn nhóm 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_126_127_message_personal",
    "error_type": "external zalo",
    "error_name": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "error_desc": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "zalo_error_codes": [
      "126",
      "127"
    ],
    "zalo_action_codes": [
      "zalo_message_friend",
      "zalo_message_stranger"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "noti_campaign": "Zalo từ chối tin nhắn cá nhân (mã 126/127)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_126_127_message_group",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế nhắn nhóm (mã 126/127)",
    "error_desc": "Zalo hạn chế nhắn nhóm (mã 126/127)",
    "zalo_error_codes": [
      "126",
      "127"
    ],
    "zalo_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế nhắn nhóm (mã 126/127)",
    "noti_campaign": "Tạm khóa nhắn nhóm 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_126_add_group_member",
    "error_type": "external zalo",
    "error_name": "Zalo hạn chế thêm thành viên nhóm (mã 126)",
    "error_desc": "Zalo hạn chế thêm thành viên nhóm (mã 126)",
    "zalo_error_codes": [
      "126"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 30,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo hạn chế thêm thành viên nhóm (mã 126)",
    "noti_campaign": "Tạm khóa thêm thành viên nhóm 30 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_221_message_group",
    "error_type": "external zalo",
    "error_name": "Đạt giới hạn nhắn nhóm (mã 221)",
    "error_desc": "Đạt giới hạn nhắn nhóm (mã 221)",
    "zalo_error_codes": [
      "221"
    ],
    "zalo_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_codes": [
      "zalo_message_group"
    ],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": 60,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Đạt giới hạn nhắn nhóm (mã 221)",
    "noti_campaign": "Tạm khóa nhắn nhóm 60 phút.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_223_add_friend_pause",
    "error_type": "external zalo",
    "error_name": "Zalo từ chối kết bạn (mã 223)",
    "error_desc": "Zalo từ chối kết bạn (mã 223)",
    "zalo_error_codes": [
      "223"
    ],
    "zalo_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": "tạm dừng",
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo từ chối kết bạn (mã 223)",
    "noti_campaign": "Chiến dịch tạm dừng do lỗi Zalo 223; kiểm tra và chạy lại thủ công.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_224_add_friend_full",
    "error_type": "external zalo",
    "error_name": "Danh bạ Zalo đã đầy (mã 224)",
    "error_desc": "Danh bạ Zalo đã đầy (mã 224)",
    "zalo_error_codes": [
      "224"
    ],
    "zalo_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_mode": "indefinite",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": "tạm dừng",
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Danh bạ Zalo đã đầy (mã 224)",
    "noti_campaign": "Danh bạ Zalo đã đầy; xử lý danh bạ, mở khóa kết bạn và chạy lại chiến dịch thủ công.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_215_251_add_friend_rejected",
    "error_type": "external zalo",
    "error_name": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "error_desc": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "zalo_error_codes": [
      "215",
      "251"
    ],
    "zalo_action_codes": [
      "zalo_add_friend"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": true,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "noti_campaign": "Người nhận không nhận lời mời kết bạn (mã 215/251)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_219_find_phone_invalid",
    "error_type": "external zalo",
    "error_name": "Số điện thoại không hợp lệ (mã 219)",
    "error_desc": "Số điện thoại không hợp lệ (mã 219)",
    "zalo_error_codes": [
      "219"
    ],
    "zalo_action_codes": [
      "zalo_find_phone_user"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": false,
    "counts_toward_bad_target": true,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Số điện thoại không hợp lệ (mã 219)",
    "noti_campaign": "Số điện thoại không hợp lệ (mã 219)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_227_join_group_link_invalid",
    "error_type": "external zalo",
    "error_name": "Link nhóm Zalo không hợp lệ (mã 227)",
    "error_desc": "Link nhóm Zalo không hợp lệ (mã 227)",
    "zalo_error_codes": [
      "227"
    ],
    "zalo_action_codes": [
      "zalo_join_group_link"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "thất bại",
    "counts_toward_limit": false,
    "counts_toward_bad_target": true,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Link nhóm Zalo không hợp lệ (mã 227)",
    "noti_campaign": "Link nhóm Zalo không hợp lệ (mã 227)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_210_target_unavailable",
    "error_type": "external zalo",
    "error_name": "Người nhận bị Zalo chặn (mã 210)",
    "error_desc": "Người nhận bị Zalo chặn (mã 210)",
    "zalo_error_codes": [
      "210"
    ],
    "zalo_action_codes": [
      "zalo_find_phone_user",
      "zalo_add_friend"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": "không tồn tại",
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": null,
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Người nhận bị Zalo chặn (mã 210)",
    "noti_campaign": "Người nhận bị Zalo chặn (mã 210)",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  },
  {
    "error_code": "err_zalo_264_269_add_group_member_pause",
    "error_type": "external zalo",
    "error_name": "Zalo không cho thêm trực tiếp thành viên (mã 264/269)",
    "error_desc": "Zalo không cho thêm trực tiếp thành viên (mã 264/269)",
    "zalo_error_codes": [
      "264",
      "269"
    ],
    "zalo_action_codes": [
      "zalo_add_group_member"
    ],
    "disable_action_codes": [],
    "disable_action_mode": "fixed_minutes",
    "time_disable_actions": null,
    "disable_action_days": null,
    "disable_action_time": null,
    "detail_status": null,
    "counts_toward_limit": false,
    "counts_toward_bad_target": false,
    "update_status_campaign": "tạm dừng",
    "update_status_account": null,
    "update_login_status": null,
    "count_consecutive_errors": null,
    "noti_running_process": "Zalo không cho thêm trực tiếp thành viên (mã 264/269)",
    "noti_campaign": "Chiến dịch tạm dừng; kiểm tra nhóm và cách mời thành viên rồi chạy lại thủ công.",
    "is_active": true,
    "is_delete": false,
    "error_element": null
  }
]
$json$::jsonb; before_hashes jsonb := $json$
{
  "1": "eb95b70d1456df26e9cc05902d067655",
  "2": "b5515e2fd99dc515e5d9fa7327c74c03",
  "3": "dccd0563fb8d5991e94e541a7e75daf4",
  "4": "a6a9d19cb9933d185c0cfbe7679899d4",
  "5": "92a44f4ae4723cc23a763937fdaec913",
  "6": "903c8de854a445a8c46601199b09c4ea",
  "7": "df9ebaaae05cd269b84d8b8408f39572",
  "8": "51b46f5bb6e36969e857c84c9e6cc564",
  "9": "7f01beb839af2b08420046c548842db6",
  "10": "c2ef976686a3caf3839f221eca3667ff",
  "11": "adf2d8ac415c55dc5bd207a9f38abc77",
  "12": "ac7fed95fefa546869f851bcb9723558",
  "13": "b8265d20dd6cee5450ecd09c23da2555",
  "14": "c8a37ce83c2cab9ec3f6d6b2295c05db",
  "15": "81020b22de85fd737f1475af2c66d0c7",
  "16": "eebb37948f318257b0b11347066acd47",
  "17": "91f6fd73356373f246c69b75dda92aa7",
  "18": "624d7557e78124963f450755d8a358a8",
  "31": "c6d1a219d468e9b74eeaf352f6ff02c4",
  "32": "68fc7d2c569b25d6d3009fd1cf85b1bd",
  "33": "d1513fe9089ef27173a433b67c17589a",
  "34": "9669698cf58461ce6bd1e1ca7d13bc2d",
  "35": "5b14a734b59fc31bcb7f089a1fecb8f9",
  "36": "8345ac02f25659a91b809d6f12b1e538",
  "41": "06196187289441575509954ab0387999"
}
$json$::jsonb;
BEGIN
  IF (SELECT jsonb_agg(jsonb_build_object('error_code',e.error_code,'error_type',e.error_type,'error_name',e.error_name,'error_desc',e.error_desc,'zalo_error_codes',e.zalo_error_codes,'zalo_action_codes',e.zalo_action_codes,'disable_action_codes',e.disable_action_codes,'disable_action_mode',e.disable_action_mode,'time_disable_actions',e.time_disable_actions,'disable_action_days',e.disable_action_days,'disable_action_time',e.disable_action_time,'detail_status',e.detail_status,'counts_toward_limit',e.counts_toward_limit,'counts_toward_bad_target',e.counts_toward_bad_target,'update_status_campaign',e.update_status_campaign,'update_status_account',e.update_status_account,'update_login_status',e.update_login_status,'count_consecutive_errors',e.count_consecutive_errors,'noti_running_process',e.noti_running_process,'noti_campaign',e.noti_campaign,'is_active',e.is_active,'is_delete',e.is_delete,'error_element',e.error_element) ORDER BY e.error_code) FROM public.auto_error e
      WHERE e.error_code IN (SELECT x->>'error_code' FROM jsonb_array_elements(expected) x))
     IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x->>'error_code') FROM jsonb_array_elements(expected) x) THEN
    RAISE EXCEPTION 'v323: scoped policies do not match approved configuration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE id IN (12,13) AND
      (is_active OR is_delete OR cardinality(zalo_error_codes)<>0)) THEN
    RAISE EXCEPTION 'v323: legacy globals still active or retain Zalo codes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error e
      JOIN jsonb_populate_recordset(NULL::public.auto_error, $json$
[
  {
    "id": 12,
    "is_active": true,
    "is_delete": false,
    "created_at": "2026-06-10T16:06:00.85814+00:00",
    "error_code": "err_zalo_message_stranger_limited",
    "error_desc": "Zalo hạn chế tài khoản gửi tin nhắn đến người lạ",
    "error_name": "Hạn chế nhắn tin người lạ",
    "error_type": "external zalo",
    "updated_at": "2026-09-19T09:50:00+00:00",
    "detail_status": "thất bại",
    "error_element": null,
    "noti_campaign": "Zalo hạn chế gửi tin nhắn đến người lạ, tạm nghỉ [x] phút",
    "zalo_error_codes": [
      "120",
      "802"
    ],
    "zalo_action_codes": [],
    "counts_toward_limit": true,
    "disable_action_mode": "fixed_minutes",
    "update_login_status": null,
    "disable_action_codes": [
      "zalo_message_stranger",
      "zalo_add_group_member"
    ],
    "noti_running_process": "Zalo hạn chế gửi tin nhắn đến người lạ",
    "time_disable_actions": 60,
    "update_status_account": null,
    "update_status_campaign": null,
    "count_consecutive_errors": null,
    "counts_toward_bad_target": false
  },
  {
    "id": 13,
    "is_active": true,
    "is_delete": false,
    "created_at": "2026-06-10T16:06:00.85814+00:00",
    "error_code": "err_zalo_duplicate_or_fast_message",
    "error_desc": "Zalo hạn chế do nội dung trùng lặp hoặc gửi quá nhanh",
    "error_name": "Tin nhắn trùng lặp hoặc gửi quá nhanh",
    "error_type": "external zalo",
    "updated_at": "2026-06-22T09:44:32.288436+00:00",
    "detail_status": "thất bại",
    "error_element": null,
    "noti_campaign": "Nội dung bị trùng lặp hoặc gửi quá nhanh, tạm nghỉ gửi tin [x] phút",
    "zalo_error_codes": [
      "123",
      "126",
      "127"
    ],
    "zalo_action_codes": [],
    "counts_toward_limit": true,
    "disable_action_mode": "fixed_minutes",
    "update_login_status": null,
    "disable_action_codes": [
      "zalo_message_friend",
      "zalo_message_stranger",
      "zalo_message_group"
    ],
    "noti_running_process": "Tin nhắn bị trùng lặp hoặc gửi quá nhanh",
    "time_disable_actions": 30,
    "update_status_account": null,
    "update_status_campaign": null,
    "count_consecutive_errors": null,
    "counts_toward_bad_target": false
  }
]
$json$::jsonb) b USING(id)
      WHERE (to_jsonb(e)-'updated_at'-'zalo_error_codes'-'is_active'-'disable_action_days'-'disable_action_time')
        IS DISTINCT FROM (to_jsonb(b)-'updated_at'-'zalo_error_codes'-'is_active'-'disable_action_days'-'disable_action_time')
        OR e.disable_action_days IS NOT NULL OR e.disable_action_time IS NOT NULL) THEN
    RAISE EXCEPTION 'v323: legacy global fields changed outside scope';
  END IF;
  IF EXISTS (SELECT c,a FROM public.auto_error e CROSS JOIN LATERAL unnest(e.zalo_error_codes) c
      CROSS JOIN LATERAL unnest(e.zalo_action_codes) a WHERE e.is_active AND NOT e.is_delete
      AND e.error_type='external zalo' AND c = ANY(ARRAY['120', '123', '126', '127', '210', '215', '219', '221', '223', '224', '227', '251', '264', '269', '802']::text[])
      GROUP BY c,a HAVING count(*)>1) THEN
    RAISE EXCEPTION 'v323: duplicate active Zalo code + action';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error e WHERE before_hashes ? e.id::text AND e.id NOT IN (12,13)
      AND (before_hashes->>e.id::text IS DISTINCT FROM md5((to_jsonb(e)-'disable_action_days'-'disable_action_time')::text)
        OR e.disable_action_days IS NOT NULL OR e.disable_action_time IS NOT NULL)) THEN
    RAISE EXCEPTION 'v323: policy outside scope changed';
  END IF;
  IF (SELECT count(*) FROM public.auto_error) <> 43 THEN
    RAISE EXCEPTION 'v323: unexpected policy row count';
  END IF;
END $verify$;
COMMIT;
