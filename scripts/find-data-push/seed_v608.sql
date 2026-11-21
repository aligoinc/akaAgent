-- Dữ liệu trước khi apply V608 (để kiểm phần điền sẵn liên kết).
INSERT INTO public.auto_campaigns (id, name, action_id, staff_id, organization_id, status, is_delete, data_target_source_mode, extra_settings) VALUES
  (10, 'Nguồn A', 'facebook_find_data_group', 1, 100, 'chờ xử lý', false, 'direct',
   '{"isFindUid":true,"findUidTargetCampaignIds":[11,12,13,14,15,10,"11"],"isFindPostLink":true,"findPostLinkTargetCampaignIds":[16],"isFindPhone":true,"findPhoneZaloMessagePhoneTargetCampaignIds":[17]}'),
  (11, 'Đích UID', 'facebook_message_uid', 1, 100, 'hoàn thành', false, 'direct', '{}'),
  (12, 'Đích đã xoá', 'facebook_message_uid', 1, 100, 'tạm dừng', true, 'direct', '{}'),
  (13, 'Đích Nhóm data', 'facebook_message_uid', 1, 100, 'chờ xử lý', false, 'data_group', '{}'),
  (14, 'Đích người khác', 'facebook_message_uid', 2, 200, 'chờ xử lý', false, 'direct', '{}'),
  (15, 'Đích sai loại', 'facebook_message_friend', 1, 100, 'chờ xử lý', false, 'direct', '{}'),
  (16, 'Đích comment bài', 'facebook_comment_seeding_post', 1, 100, 'tạm dừng', false, 'direct', '{}'),
  (17, 'Đích Zalo SĐT', 'zalo_message_phone', 1, 100, 'chờ xử lý', false, 'direct', '{}'),
  (20, 'Nguồn B', 'facebook_find_data_search', 1, 100, 'chờ xử lý', false, 'direct',
   '{"isFindFacebookGroup":true,"findFacebookGroupJoinTargetCampaignIds":[21],"isFindUid":false,"findUidTargetCampaignIds":[11]}'),
  (21, 'Đích tham gia group', 'facebook_join_group', 1, 100, 'chờ xử lý', false, 'direct', '{}'),
  (22, 'Nguồn C', 'facebook_find_data_search', 1, 100, 'chờ xử lý', false, 'direct',
   '{"isFindFacebookGroup":true,"findFacebookGroupJoinTargetCampaignIds":[21]}'),
  (30, 'Nguồn đã xoá', 'facebook_find_data_group', 1, 100, 'tạm dừng', true, 'direct', '{"isFindUid":true,"findUidTargetCampaignIds":[11]}'),
  (40, 'Nguồn nhân viên 2', 'facebook_find_data_group', 2, 200, 'chờ xử lý', false, 'direct', '{"isFindUid":true,"findUidTargetCampaignIds":[14]}');
INSERT INTO public.auto_campaign_input_data (campaign_id, uid, is_delete) VALUES (11, 'u3', false), (11, 'u4', true);
INSERT INTO public.auto_campaign_input_data (campaign_id, phone) VALUES (17, '0912345678');
