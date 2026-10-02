INSERT INTO org_staff VALUES(1,1,true,'owner','password');
INSERT INTO auto_campaigns VALUES(1,1,1);
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
INSERT INTO zalo_accounts SELECT i,'sender-'||i FROM generate_series(1,5000) i;
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id) SELECT i,1,1,i FROM generate_series(1,5000) i;
