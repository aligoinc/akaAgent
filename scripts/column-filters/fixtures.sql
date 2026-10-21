-- Synthetic only. Never execute against a remote database.
DO $$ BEGIN IF inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55421 OR current_database()<>'column_filters' THEN RAISE EXCEPTION 'local fixture only'; END IF; END $$;
INSERT INTO org_staff(id,organization_id,name,is_active,username,password) VALUES (10,1,'Owner',true,'owner','fixture'),(11,1,'Reader',true,'reader','fixture'),(12,2,'Outsider',true,'outsider','fixture');
INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_delete) VALUES (1,10,1,'Tài khoản A','facebook',false),(2,11,1,'Tài khoản B','zalo',false);
INSERT INTO category_type(id,namespace,code,managed_by,is_active) VALUES(1,'common','data_source','system',true),(2,'common','data_type','system',true);
INSERT INTO category_item(id,category_type_id,code,name,managed_by,is_active) VALUES(1,1,'upload','Upload data','system',true),(2,1,'scan','Quét data','system',true),(3,1,'automation','Tự động hóa','system',true),(20,2,'phone','SĐT','system',true);
INSERT INTO auto_account_contact_groups(id,staff_id,organization_id,name,purpose,is_delete,sharing_scope,sharing_revision) VALUES(1,10,1,'Synthetic 100k','data_group',false,'selected',1),(2,11,1,'Private','data_group',false,'private',1);
INSERT INTO auto_data_group_recipients(group_id,staff_id) VALUES(1,11);
INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,flatform_type,name,uid,url,phone,email,extra_data,is_delete,is_friend,is_joined,created_at,updated_at)
SELECT n,1,10,1,'person','facebook',CASE WHEN n%100=0 THEN 'Nguyễn ÁNH '||n ELSE 'Khách '||n END,'000'||n,'https://example.test/'||n,'090'||lpad(n::text,7,'0'),NULL,jsonb_build_object('info1',CASE WHEN n%17=0 THEN '  ' ELSE 'Khu vực '||n%5 END,'info2',CASE WHEN n%7=0 THEN '100%_literal' ELSE 'normal' END),false,n%2=0,NULL,'2026-01-01'::timestamptz+(n%1000)*interval '1 sec','2026-01-01'::timestamptz+(n%1000)*interval '1 sec' FROM generate_series(1,100000) n;
INSERT INTO auto_account_contact_group_members(id,group_id,contact_id,primary_origin_id,is_delete,change_revision,created_at,updated_at)
SELECT n+1000000,1,n,n+2000000,false,1,'2026-01-01'::timestamptz+(n%1000)*interval '1 sec','2026-01-01'::timestamptz+(n%1000)*interval '1 sec' FROM generate_series(1,100000) n;
INSERT INTO auto_account_contact_group_member_origins(id,membership_id,kind,source_category_item_id,data_type_category_item_id,is_current,created_at,updated_at,source_name_snapshot)
SELECT n+2000000,n+1000000,CASE WHEN n%100=0 THEN 'automation' ELSE 'upload' END,CASE WHEN n%100=0 THEN 3 ELSE 1 END,20,true,'2026-01-01','2026-01-01',CASE WHEN n%100=0 THEN 'Secret automation' END FROM generate_series(1,100000) n;
-- Another current source tests primary-source vs legacy any-source semantics.
INSERT INTO auto_account_contact_group_member_origins(id,membership_id,kind,source_category_item_id,is_current) VALUES(5000001,1000001,'scan',2,true);
INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,flatform_type,name,uid,phone,extra_data,is_delete,is_friend,created_at,updated_at) VALUES(200001,2,11,1,'person','zalo','Private person','private','private','{}',false,false,now(),now());
INSERT INTO auto_account_contact_group_members(id,group_id,contact_id,is_delete,created_at,updated_at) VALUES(1200001,2,200001,false,now(),now());
ANALYZE;
