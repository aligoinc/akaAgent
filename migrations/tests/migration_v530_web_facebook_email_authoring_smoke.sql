-- v530 KIỂM CHỈ ĐỌC TRÊN PRODUCTION SAU KHI APPLY. Chạy trong BEGIN ... ROLLBACK.
-- File sinh tự động bởi scripts/build-v530-sql.py; đừng sửa tay.
-- Không gọi hàm có ghi (xác thực, tạo/sửa/xoá, dừng/tiếp tục, liên kết, ghi khoá bộ chạy) và không in dữ liệu
-- khách: chỉ so phạm vi đọc cũ/mới trên vài nhân viên có tài khoản Email/Facebook, kết quả là một NOTICE.
SET LOCAL statement_timeout = '60s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  r record;
  legacy jsonb;
  mixed jsonb;
  em jsonb;
  fb jsonb;
  v_account bigint;
  n_email integer := 0;
  n_fb integer := 0;
  c_legacy constant text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook'];
  c_all constant text[] := ARRAY['zalo','sms','zalo_qr','zalo_web','facebook','email'];
BEGIN
  -- 11 hàm vá ở đúng md5 đích; 12 hàm mới đúng md5 và ACL.
  FOR r IN SELECT * FROM (VALUES
    ('private.aka_agent_web_facebook_campaigns_policy(bigint)', '592f487518ef14f3bef6f0c7177f2ab5', 'a49d994aa8f5847a0ccd35e4017504f1'),
    ('public.aka_agent_authenticate_control_session(text)', '692e2a068ce51377f6bd71fec20a8b0c', '8012506f60ad1f00aab2b60f7bbec48c'),
    ('public.aka_agent_authenticate_control_session_chat_v2(text)', '61e874b9b47b827d78e16c71bc9ef687', 'e481b2473aa9dda34f91092b98ffdfbe'),
    ('public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])', '367cf7ba9d72aff72c4907586cf1c3ba', '719fcf458eabe2b16fe536de07079c77'),
    ('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)', 'db8942b09904e535987b94745b159ca3', 'fac3ecfdf45dff239c319656a7365a7c'),
    ('public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer)', '6030f0d9c8429e36955a405920f751f9', 'ed7f9d447f72019feca71d717fd4e1bd'),
    ('public.aka_agent_control_set_desktop_campaign_status(bigint,bigint,bigint,text)', '87f7002ac924f647896a7635663562b5', '2d3fbc42cc31e57138cdc99554af9254'),
    ('public.delete_control_campaign_atomic(bigint,bigint,bigint)', '2af929cc5e02683e5e9dc16a48cc9bac', '2ede03119ec482102e1647c0b1bae220'),
    ('public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)', '61a6b5c855fbcf86cafaf3c3c7ce6f0a', '92859e8843ded3ae24547ab788b6b292'),
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', 'a86278195e18d1ef8d0091b41d1d0c5b', 'd69df6eb6a8ddd38ff8be452d1e26ea3'),
    ('public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)', 'd283261c5e77558d10f5df86cd4d1127', '5fa5bcfd31f69db8114b82f3ade9b4a5')
  ) AS x(signature, source_md5, target_md5) LOOP
    ASSERT md5(pg_get_functiondef(r.signature::regprocedure)) = r.target_md5, 'target ' || r.signature;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('private.aka_agent_web_email_campaigns_policy(bigint)', '2d131332e8d0fa54b4669f51a8fe92d8', '{postgres=X/postgres}'),
    ('public.aka_agent_control_web_email_campaigns_policy(bigint)', '70616ad6489372725cca33b09da41852', '{postgres=X/postgres,service_role=X/postgres}'),
    ('private.aka_agent_control_assert_campaign_inputs(text,jsonb)', '7d93bfa6922542a27d5e9784c8641697', '{postgres=X/postgres}'),
    ('private.aka_agent_control_resolve_secondary_account(bigint,bigint,text,text,bigint,jsonb)', '83a8d509fcb8b730d61dbad9a8c7da82', '{postgres=X/postgres}'),
    ('private.aka_agent_control_normalize_email_session(jsonb,text)', '58ddce1f4cfbc2b6c981c24e13560f0d', '{postgres=X/postgres}'),
    ('private.aka_agent_control_email_account_view(public.auto_accounts)', 'c6c2b3218cf5946c7d4fa3cc23d0f429', '{postgres=X/postgres}'),
    ('public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)', '325b6bf48ecb8dd201535fa6d5eedc75', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)', 'bc88995a45252ec3c2260646750d4a05', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.delete_control_email_account_atomic(bigint,bigint,bigint)', 'b912bdab82a4669569b184e46f166da0', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_email_account_session(bigint,bigint,bigint)', '2ee2b490a2f9224a9d8ac63a1683040f', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)', '84182eb3960fd1952037e80e183036fa', '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])', '2e3bf66477ad78cf90eba64e1626e8d2', '{postgres=X/postgres,aka_agent_desktop=X/postgres}')
  ) AS x(signature, target_md5, acl) LOOP
    ASSERT md5(pg_get_functiondef(r.signature::regprocedure)) = r.target_md5, 'new function ' || r.signature;
    ASSERT (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.signature::regprocedure) = r.acl, 'acl ' || r.signature;
  END LOOP;

  -- Email: token 'email' chỉ thêm dòng Email; caller không gửi token không thấy Email.
  FOR r IN
    SELECT a.staff_id, a.organization_id, max(a.id) AS account_id FROM public.auto_accounts a
    WHERE a.is_delete = false AND a.flatform_type = 'email'
      AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.id = a.staff_id AND s.organization_id = a.organization_id AND s.is_active IS TRUE)
    GROUP BY 1, 2 ORDER BY max(a.id) DESC LIMIT 5
  LOOP
    n_email := n_email + 1;
    legacy := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, c_legacy);
    mixed := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, c_all);
    em := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['email']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(legacy->'items') x WHERE x->>'platform' = 'email'), 'legacy page has no email';
    ASSERT (mixed->>'campaignTotal')::integer = (legacy->>'campaignTotal')::integer + (em->>'campaignTotal')::integer, 'page union';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(em->'items') x WHERE x->>'platform' <> 'email'
      OR (x->>'isZaloServer')::boolean OR (x->>'isZaloShowWeb')::boolean), 'email page only email, desktop runtime';
    legacy := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, c_legacy);
    em := public.aka_agent_control_account_snapshot(r.staff_id, r.organization_id, ARRAY['email']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(legacy->'items') x WHERE x->'metadata'->>'flatform_type' = 'email'),
      'legacy snapshot has no email';
    ASSERT jsonb_array_length(em->'items') > 0, 'email accounts listed';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(em->'items') x WHERE x->'metadata'->>'flatform_type' <> 'email'),
      'email snapshot only email';
    ASSERT jsonb_typeof(em->'desktopPresence') = 'object', 'email snapshot has presence';
    ASSERT position('email_session' in em::text) = 0, 'snapshot never returns smtp session';
    em := public.aka_agent_control_desktop_activity(r.staff_id, r.organization_id, ARRAY['email']);
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(em->'items') x WHERE x->>'accountType' <> 'email'), 'email activity only';
    -- Phiên SMTP chỉ đọc qua hàm riêng (không in ra): tài khoản của chính nhân viên thấy được, id lạ thì không.
    ASSERT (public.aka_agent_control_email_account_session(r.staff_id, r.organization_id, r.account_id)->>'found')::boolean,
      'email session readable';
    ASSERT public.aka_agent_control_email_account_session(r.staff_id, r.organization_id, 9000000000000) = '{"found": false}'::jsonb,
      'missing email account';
  END LOOP;
  ASSERT n_email > 0, 'requires staff with email accounts';

  -- Facebook: token 'facebook' của v476 giữ nguyên phạm vi.
  FOR r IN
    SELECT a.staff_id, a.organization_id FROM public.auto_accounts a
    WHERE a.is_delete = false AND a.flatform_type = 'facebook'
      AND EXISTS (SELECT 1 FROM public.org_staff s WHERE s.id = a.staff_id AND s.organization_id = a.organization_id AND s.is_active IS TRUE)
    GROUP BY 1, 2 ORDER BY max(a.id) DESC LIMIT 3
  LOOP
    n_fb := n_fb + 1;
    legacy := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['zalo','sms','zalo_qr','zalo_web']);
    mixed := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, c_legacy);
    fb := public.aka_agent_control_campaign_page(r.staff_id, r.organization_id, ARRAY['facebook']);
    ASSERT (mixed->>'campaignTotal')::integer = (legacy->>'campaignTotal')::integer + (fb->>'campaignTotal')::integer,
      'facebook page union';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(fb->'items') x WHERE x->>'platform' <> 'facebook'), 'facebook page only';
  END LOOP;
  ASSERT n_fb > 0, 'requires staff with facebook accounts';

  -- Chính sách: đọc được; Email có dòng cấu hình; Facebook có nhánh authoring.
  ASSERT public.aka_agent_control_web_email_campaigns_policy(1) ?& ARRAY['enabled','emailOnlyLogin','authoring'], 'email policy';
  ASSERT jsonb_typeof(public.aka_agent_control_web_facebook_campaigns_policy(1)->'authoring') = 'object', 'facebook authoring';
  ASSERT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.email_campaigns'), 'email policy row';

  -- Quyền: RPC Control chỉ service_role; RPC bộ chạy chỉ aka_agent_desktop (cần quyền cột + RLS của phiên).
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_control_web_email_campaigns_policy(bigint)'),
    ('public.create_control_email_account_atomic(bigint,bigint,text,jsonb,boolean,text,integer,bigint)'),
    ('public.update_control_email_account_atomic(bigint,bigint,bigint,timestamptz,text,jsonb,boolean,text,bigint)'),
    ('public.delete_control_email_account_atomic(bigint,bigint,bigint)'),
    ('public.aka_agent_control_email_account_session(bigint,bigint,bigint)'),
    ('public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)')
  ) AS x(signature) LOOP
    ASSERT has_function_privilege('service_role', r.signature, 'EXECUTE'), 'service_role ' || r.signature;
    ASSERT NOT has_function_privilege('anon', r.signature, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', r.signature, 'EXECUTE')
      AND NOT has_function_privilege('aka_agent_desktop', r.signature, 'EXECUTE')
      AND NOT has_function_privilege('aka_agent_chat_api', r.signature, 'EXECUTE'), 'only service_role ' || r.signature;
  END LOOP;
  ASSERT has_function_privilege('aka_agent_desktop', 'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])', 'EXECUTE');
  ASSERT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'extra_settings', 'UPDATE')
    AND has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'updated_at', 'UPDATE'), 'desktop column privileges';
  ASSERT NOT has_function_privilege('service_role', 'private.aka_agent_web_email_campaigns_policy(bigint)', 'EXECUTE');
  RAISE NOTICE 'v530 production smoke passed (email staff %, facebook staff %)', n_email, n_fb;
END
$smoke$;
