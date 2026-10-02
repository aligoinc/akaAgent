INSERT INTO org_staff(id,organization_id,username,password) VALUES(34001,340,'fixture-a','fixture-password'),(34002,341,'fixture-b','fixture-password');
INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_zalo_show_web,is_zalo_server)
SELECT n,34001,340,CASE WHEN n BETWEEN 11 AND 19 THEN 'zalo' WHEN n=20 THEN 'email' WHEN n=21 THEN 'sms' ELSE 'facebook' END,
 n BETWEEN 11 AND 14,n=16 FROM generate_series(1,21) n;
INSERT INTO auto_accounts(id,staff_id,organization_id) VALUES(30,34002,341);
INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,action_id,note)
SELECT id,id,staff_id,organization_id,CASE WHEN flatform_type='facebook' THEN 'facebook_group_post' ELSE 'zalo_message_friend' END,'old note' FROM auto_accounts;
