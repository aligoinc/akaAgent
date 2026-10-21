DO $$ BEGIN IF inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55421 OR current_database()<>'column_filters' THEN RAISE EXCEPTION 'local fixture only'; END IF; END $$;
INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_delete) VALUES (3,10,1,'Synthetic Zalo','zalo',false);
INSERT INTO auto_campaign_actions(id,name) VALUES('zalo_message_friend','Nhắn tin bạn bè'),('zalo_message_phone','Nhắn tin số điện thoại');
INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id,is_delete) VALUES(1,3,10,1,'A','zalo_message_friend',false),(2,3,10,1,'B','zalo_message_phone',false);
INSERT INTO auto_campaign_input_data(id,campaign_id,uid,name,phone) SELECT n,1,'z'||n,'Khách Zalo '||n,'090'||lpad(n::text,7,'0') FROM generate_series(1,10000) n;
INSERT INTO auto_campaign_details(id,account_id,campaign_id,input_data_id,action_code,created_at,status,log,data,is_delete)
SELECT n,3,CASE WHEN n>90000 THEN 2 ELSE 1 END,1+(n-1)%10000,'zalo_message_friend','2026-10-01T00:00:00Z'::timestamptz+((n-1)/10000)*interval '1 day','thành công',CASE WHEN n%10=0 THEN 'Ghi chú' ELSE '' END,'{}',false FROM generate_series(1,100000) n;
INSERT INTO zalo_groups(id,account_id,staff_id,organization_id,zalo_group_id,name,total_member,group_type) VALUES(1,3,10,1,'g1','Nhóm lớn',10000,2);
INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,flatform_type,name,uid,extra_data,akabiz_tag_ids,is_delete,is_friend,created_at,updated_at)
SELECT 300000+n,3,10,1,'person','zalo','Liên hệ '||n,'z'||n,jsonb_build_object('phone','+8490'||lpad(n::text,7,'0'),'zaloTagIds',jsonb_build_array(CASE WHEN n%2=0 THEN 'vip' ELSE 'regular' END),'avatarUrl',CASE WHEN n%2=0 THEN 'https://avatar.test/a' END,'gender',n%2),ARRAY[(1+n%2)::bigint],false,n%2=0,'2026-10-01','2026-10-10' FROM generate_series(1,10000) n;
INSERT INTO zalo_group_members(id,account_id,staff_id,organization_id,zalo_group_id,zalo_uid,role,role_rank,is_creator,is_admin,is_current,last_seen_at,updated_at)
SELECT n,3,10,1,'g1','z'||n,CASE WHEN n=1 THEN 'owner' WHEN n<4 THEN 'admin' ELSE 'member' END,CASE WHEN n=1 THEN 1 WHEN n<4 THEN 2 ELSE 3 END,n=1,n<4,true,'2026-10-10','2026-10-10' FROM generate_series(1,10000) n;
INSERT INTO auto_account_contacts_dataset(id,account_id,staff_id,organization_id,name,source,contact_type,is_delete) VALUES(1,1,10,1,'Upload','upload','person',false);
INSERT INTO auto_account_contacts_dataset_members(dataset_id,contact_id,sort_order,is_current) SELECT 1,n,100001-n,true FROM generate_series(1,100000) n;
ANALYZE;
