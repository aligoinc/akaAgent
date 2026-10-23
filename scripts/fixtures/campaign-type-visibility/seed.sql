INSERT INTO org_organization VALUES(1,false),(2,false);
INSERT INTO org_staff(id,organization_id,name,username,password,is_admin,is_active) VALUES
  (11,1,'Admin A','admin-a','fixture',true,true),(12,1,'Staff','staff','fixture',false,true),
  (13,1,'Admin B','admin-b','fixture',true,true),(21,2,'Other','other','fixture',true,true),
  (14,1,'Inactive','inactive','fixture',true,false);
INSERT INTO auto_campaign_actions(id,name,flatform_type) VALUES
  ('facebook_group_post','Facebook - Đăng bài vào group','facebook'),
  ('facebook_page_post','Facebook - Đăng bài lên fanpage','facebook'),
  ('zalo_message_phone','Zalo - Nhắn tin, kết bạn đến SĐT','zalo'),
  ('zalo_message_friend','Zalo - Nhắn tin bạn bè','zalo'),
  ('sms_send','SMS - Gửi tin nhắn','sms'),('voice_call','SMS - Gọi tự động qua SIM','sms'),
  ('email_send','Email - Gửi email','email');
INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_zalo_server,is_delete) VALUES
  (1,11,1,'FB','facebook',false,false),(2,11,1,'Zalo Server','zalo',true,false),
  (3,11,1,'Zalo QR','zalo',false,false),(4,11,1,'SMS','sms',false,false),
  (5,12,1,'Staff Zalo','zalo',true,false),(6,21,2,'Other Zalo','zalo',true,false),
  (7,11,1,'Deleted Zalo','zalo',true,true);
INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,action_id,name,status,schedule) VALUES
  (1,11,1,1,'facebook_group_post','FB running','đang chạy','2026-01-01'),
  (2,11,1,2,'zalo_message_phone','Phone','chờ xử lý','2026-01-02'),
  (3,11,1,3,'zalo_message_phone','QR','tạm dừng','2026-01-03'),
  (4,11,1,4,'sms_send','SMS','hoàn thành','2026-01-04'),
  (5,12,1,5,'zalo_message_phone','Other staff','chờ xử lý','2026-01-05'),
  (6,21,2,6,'zalo_message_phone','Other org','chờ xử lý','2026-01-06'),
  (7,11,1,7,'zalo_message_phone','Orphan','tạm dừng','2026-01-07'),
  (8,11,1,2,'zalo_message_phone','Deleted','tạm dừng','2026-01-08');
UPDATE auto_campaigns SET is_delete=true WHERE id=8;
