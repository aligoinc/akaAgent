CREATE ROLE postgres SUPERUSER;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE auto_accounts(id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, is_delete boolean DEFAULT false,
  name text, flatform_type text DEFAULT 'zalo', is_zalo_server boolean DEFAULT true, is_zalo_show_web boolean DEFAULT false,
  is_active boolean DEFAULT true, status text DEFAULT 'chờ xử lý', login_status text DEFAULT 'đã đăng nhập',
  account_group_id bigint, rate_limit_minutes int, proxy_id bigint, username text,
  mobile_device_id text,mobile_device_info jsonb,mobile_device_registered_at timestamptz,mobile_device_last_seen_at timestamptz,
  zalo_account_id bigint,zalo_session jsonb,zalo_session_updated_at timestamptz,zalo_session_last_verified_at timestamptz,zalo_session_last_error text,
  created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE auto_account_groups(id bigint PRIMARY KEY,name text);
CREATE TABLE auto_proxies(id bigint PRIMARY KEY,name text);
CREATE TABLE zalo_accounts(id bigint PRIMARY KEY,zalo_uid text,display_name text,phone text,avatar_url text);
CREATE TABLE auto_account_action_status(account_id bigint,is_disable boolean,date_enable timestamptz);
CREATE TABLE org_organization_product(organization_id bigint,product_id bigint,is_deleted boolean,is_chat_sync boolean,expiration_date timestamptz);
CREATE TABLE auto_campaigns(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,is_delete boolean DEFAULT false,account_id bigint,status text,name text,created_at timestamptz DEFAULT now());

ALTER TABLE auto_accounts ADD facebook_uid text, ADD facebook_login_managed boolean DEFAULT false, ADD facebook_login_claim_generation bigint,
 ADD password text, ADD email_session jsonb, ADD email_session_updated_at timestamptz, ADD email_session_last_verified_at timestamptz, ADD email_session_last_error text;
ALTER TABLE auto_account_groups ADD settings jsonb;
ALTER TABLE auto_proxies ADD protocol text, ADD host text, ADD port integer;
ALTER TABLE auto_campaigns ADD action_id text, ADD secondary_account_id bigint, ADD schedule timestamptz, ADD last_run_at timestamptz, ADD content text, ADD log text, ADD extra_settings jsonb;
CREATE TABLE auto_campaign_actions(id text PRIMARY KEY,name text,flatform_type text,is_active boolean DEFAULT true,is_delete boolean DEFAULT false);
CREATE TABLE auto_system_settings(key text PRIMARY KEY,value text,description text,is_secret boolean,is_active boolean);
CREATE TABLE org_staff(id bigint PRIMARY KEY,organization_id bigint,is_active boolean,username text,password text);
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
INSERT INTO org_staff VALUES(7,9,true,'fixture','fixture'),(8,9,true,'other','other');
CREATE OR REPLACE FUNCTION public.auto_assert_automation_identity(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_claim_role text;
  v_claims jsonb;
BEGIN
  v_claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_claim_role IS NULL THEN
    BEGIN
      v_claims := NULLIF(
        current_setting('request.jwt.claims', true),
        ''
      )::jsonb;
      v_claim_role := NULLIF(v_claims ->> 'role', '');
    EXCEPTION
      WHEN OTHERS THEN
        v_claim_role := NULL;
    END;
  END IF;

  IF v_claim_role IS NULL THEN
    v_claim_role := NULLIF(auth.jwt() ->> 'role', '');
  END IF;

  IF v_claim_role = 'service_role' THEN
    RETURN;
  END IF;

  IF p_auth_username IS NULL OR p_auth_password IS NULL THEN
    RAISE EXCEPTION 'automation_auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
      AND staff.username = p_auth_username
      AND staff.password = p_auth_password
  ) THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END;
$function$
;

INSERT INTO auto_account_groups VALUES(1,'Group','{}');
INSERT INTO auto_proxies VALUES(1,'Proxy','http','localhost',8080);
INSERT INTO zalo_accounts VALUES(1,'uid','Profile','0900000000','avatar');
INSERT INTO auto_accounts(id,staff_id,organization_id,name,zalo_session,email_session,account_group_id,proxy_id,zalo_account_id,zalo_session_updated_at)
SELECT n,7,9,'Account '||n,jsonb_build_object('secret',repeat('PRIVATE_SESSION',5000)),jsonb_build_object('secret','EMAIL_PRIVATE'),1,1,1,now() FROM generate_series(1,1250) n;
INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_zalo_server,is_zalo_show_web,is_delete,username,password) VALUES
(1300,7,9,'SMS','sms',false,false,false,'sms-user','sms-password'),
(1301,7,9,'Facebook','facebook',false,false,false,'fb-user','NEVER_RETURN_FB_PASSWORD'),
(1302,7,9,'Email','email',false,false,false,'email-user','NEVER_RETURN_EMAIL_PASSWORD'),
(1303,7,9,'Local','zalo',false,false,false,NULL,NULL),
(1304,7,9,'Web','zalo',false,true,false,NULL,NULL),
(2000,8,9,'Other staff','zalo',true,false,false,NULL,NULL),
(2001,7,10,'Other org','zalo',true,false,false,NULL,NULL),
(2002,7,9,'Deleted','zalo',true,false,true,NULL,NULL);
INSERT INTO auto_campaign_actions(id,name,flatform_type,is_active) VALUES('zalo_message_phone','Nhắn tin','zalo',true),('sms_send','SMS','sms',true),('email_send','Email','email',true),('facebook_message_uid','Facebook','facebook',true),('old_action','Old', 'facebook',false);
INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,action_id,status,name,schedule,content,log)
SELECT n,7,9,1,'zalo_message_phone','chờ xử lý','Chiến dịch '||n,'2026-09-28 09:00+07'::timestamptz+n*interval '1 second',repeat('HEAVY_CONTENT',1000),repeat('HEAVY_LOG',1000) FROM generate_series(1,1501) n;
UPDATE auto_campaigns SET status='đang chạy',secondary_account_id=1300 WHERE id=1;
UPDATE auto_campaigns SET name='Trần Đặng 50%_',status='tạm dừng',last_run_at='2026-09-28 12:00+07' WHERE id=2;
UPDATE auto_campaigns SET schedule=NULL WHERE id=3;
INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,action_id,status,name,schedule) VALUES
(3000,7,9,1300,'sms_send','đang chạy','SMS','2026-09-28Z'),
(3001,7,9,1301,'facebook_message_uid','đang chạy','Facebook','2026-09-28Z'),
(3002,7,9,1302,'email_send','đang chạy','Email','2026-09-28Z'),
(3003,7,9,1303,'zalo_message_phone','đang chạy','QR','2026-09-28Z'),
(3004,7,9,1304,'zalo_message_phone','đang chạy','Web','2026-09-28Z'),
(3005,7,9,2000,'zalo_message_phone','đang chạy','Wrong account owner','2026-09-28Z'),
(3006,8,9,2000,'zalo_message_phone','đang chạy','Other staff','2026-09-28Z'),
(3007,7,10,2001,'zalo_message_phone','đang chạy','Other org','2026-09-28Z'),
(3008,7,9,2002,'zalo_message_phone','đang chạy','Deleted account','2026-09-28Z'),
(3009,7,9,1301,'old_action','hoàn thành','Old','2026-09-28Z'),
(3010,7,9,1,'zalo_message_phone','chờ xử lý','Microsecond','2030-01-01 23:59:59.999999+07'),
(3011,7,9,1,'zalo_message_phone','chờ xử lý','Next day','2030-01-02 00:00+07');
INSERT INTO auto_account_action_status VALUES(1,true,NULL),(2,true,now()-interval '1 day'),(3,true,now()+interval '1 hour');
CREATE INDEX ON auto_campaigns(staff_id,organization_id,id) WHERE is_delete=false;
CREATE INDEX ON auto_accounts(staff_id,organization_id,id) WHERE is_delete=false;
ANALYZE;

-- Columns read only by the v328 detail/version RPCs.
ALTER TABLE auto_campaigns ADD original_schedule timestamptz, ADD schedule_type text, ADD schedule_end_date date,
 ADD daily_stop_time text, ADD schedule_days text, ADD schedule_week_days text, ADD continue_next_day boolean,
 ADD refresh_data boolean, ADD images jsonb, ADD note text, ADD updated_at timestamptz DEFAULT now(),
 ADD completed_at timestamptz, ADD data_target_source_mode text, ADD data_group_id bigint,
 ADD provisioning_state text, ADD creation_bundle_id uuid, ADD creation_bundle_child_index integer;
