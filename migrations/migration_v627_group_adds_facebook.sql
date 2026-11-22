-- V627: "Sau khi chạy: đưa vào nhóm" cho chiến dịch Facebook (người dùng chốt mở rộng 22/11/2026).
--
-- Bước đưa vào nhóm của bộ máy Quy trình (`group_adds`, V609 + V613) chỉ nạp nhóm SĐT và nhóm Zalo theo UID; khách là
-- group / page / bài viết bị báo "không phải một người". Bản này thêm nhánh cho Nhóm data loại Facebook:
--   facebook_person              → dòng contact_type 'person'
--   facebook_group               → 'group'
--   facebook_page                → 'page'
--   facebook_post_url            → 'campaign_input' (như Desktop đẩy link bài tìm được sang Nhóm data)
--   facebook_page_inbox_customer → 'page_inbox_customer'
-- Mọi dòng mang flatform_type 'facebook', UID / link đọc từ khách hoặc từ dòng người nhận của kết quả, tài khoản đã chạy
-- chiến dịch (nếu là tài khoản của chính nhân viên). Chỉ nhận khách vào từ kết quả của chiến dịch Facebook; dòng người nhận
-- có loại dữ liệu khác loại nhóm (comment seeding trộn group / page / trang cá nhân) thì bỏ, lý do 'group_type'.
-- Nhóm SĐT, Zalo theo UID, chưa đặt loại: giữ nguyên như V613.
--
-- Đổi: thêm hàm private.aka_agent_journey_facebook_group_row; thay hai chỗ trong thân group_adds (khai báo biến, nhánh Facebook
-- trước bước "không phải một người"), kiểm md5 thân trước (V613) và sau; giữ chủ sở hữu, quyền, search_path, SECURITY DEFINER.
-- Gỡ: rollback_v627_group_adds_facebook.sql (trả thân V613, xóa hàm mới).
DO $migration$
DECLARE
  v_fn regprocedure := to_regprocedure('private.aka_agent_journey_engine_group_adds(jsonb)');
  v_src text;
  v_def text;
  v_old_decl constant text := E'  v_reason text;\n';
  v_new_decl constant text := E'  v_reason text;\n  v_fb jsonb;\n';
  v_old_branch constant text := E'      v_reason := ''group_missing'';\n    ELSIF e.contact ->> ''targetKind'' = ''group'' THEN';
  v_new_branch constant text := E'      v_reason := ''group_missing'';\n'
    || E'    ELSIF g.type_code IN (''facebook_person'', ''facebook_group'', ''facebook_page'', ''facebook_post_url'', ''facebook_page_inbox_customer'') THEN\n'
    || E'      -- Nhóm data loại Facebook: khách vào từ kết quả chiến dịch Facebook, kể cả group / page / bài viết.\n'
    || E'      v_fb := private.aka_agent_journey_facebook_group_row(e.id, g.type_code, g.type_id);\n'
    || E'      v_reason := v_fb ->> ''reason'';\n'
    || E'      v_row := v_fb -> ''row'';\n'
    || E'    ELSIF e.contact ->> ''targetKind'' = ''group'' THEN';
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v627_requires_v609';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_input_data'
      AND column_name = 'data_type_category_item_id') THEN
    RAISE EXCEPTION 'v627_requires_input_data_type';
  END IF;
  IF to_regprocedure('private.aka_agent_journey_facebook_group_row(bigint,text,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'v627_already_applied';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
  IF md5(v_src) <> 'f063f517ca87e00d4d24b7c2b3d36c2c' THEN
    RAISE EXCEPTION 'v627_unexpected_group_adds_body %', md5(v_src);
  END IF;
  IF (length(v_src) - length(replace(v_src, v_old_decl, ''))) / length(v_old_decl) <> 1
    OR (length(v_src) - length(replace(v_src, v_old_branch, ''))) / length(v_old_branch) <> 1 THEN
    RAISE EXCEPTION 'v627_pattern_count';
  END IF;

  CREATE FUNCTION private.aka_agent_journey_facebook_group_row(p_enrollment_id bigint, p_type_code text, p_type_id bigint)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  DECLARE
    e public.auto_journey_enrollments%ROWTYPE;
    v_action text;
    v_uid text;
    v_account bigint;
    v_name text;
    v_input_type bigint;
    v_contact_type text;
  BEGIN
    SELECT * INTO e FROM public.auto_journey_enrollments WHERE id = p_enrollment_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('reason', 'invalid');
    END IF;
    v_contact_type := CASE p_type_code
      WHEN 'facebook_person' THEN 'person'
      WHEN 'facebook_group' THEN 'group'
      WHEN 'facebook_page' THEN 'page'
      WHEN 'facebook_post_url' THEN 'campaign_input'
      WHEN 'facebook_page_inbox_customer' THEN 'page_inbox_customer'
    END;
    IF v_contact_type IS NULL THEN
      RETURN jsonb_build_object('reason', 'group_type');
    END IF;
    -- Chỉ khách vào từ kết quả của chiến dịch Facebook (nhóm data Facebook không nhận khách Zalo / SMS).
    IF e.source_kind IS DISTINCT FROM 'campaign_result' OR e.source_campaign_id IS NULL THEN
      RETURN jsonb_build_object('reason', 'group_type');
    END IF;
    SELECT c.action_id INTO v_action FROM public.auto_campaigns c
    WHERE c.id = e.source_campaign_id AND c.staff_id = e.staff_id AND c.organization_id = e.organization_id;
    IF v_action IS NULL OR v_action NOT LIKE 'facebook\_%' THEN
      RETURN jsonb_build_object('reason', 'group_type');
    END IF;
    v_uid := nullif(btrim(coalesce(e.contact ->> 'uid', '')), '');
    v_account := private.aka_agent_journey_bigint(e.contact -> 'accountId');
    v_name := nullif(btrim(coalesce(e.contact ->> 'name', '')), '');
    IF e.source_ref IS NOT NULL THEN
      SELECT coalesce(v_uid, nullif(btrim(coalesce(i.uid, '')), '')), coalesce(v_account, d.account_id),
        i.data_type_category_item_id, coalesce(v_name, nullif(btrim(coalesce(i.name, '')), ''))
      INTO v_uid, v_account, v_input_type, v_name
      FROM public.auto_campaign_details d LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
      WHERE d.id = e.source_ref AND d.campaign_id = e.source_campaign_id;
    END IF;
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('reason', 'no_target');
    END IF;
    -- Comment seeding trộn group / page / trang cá nhân: dòng người nhận đã có loại khác loại nhóm thì không nạp.
    IF v_input_type IS NOT NULL AND p_type_id IS NOT NULL AND v_input_type <> p_type_id THEN
      RETURN jsonb_build_object('reason', 'group_type');
    END IF;
    -- Tài khoản không còn của nhân viên: nạp không kèm tài khoản (hàm nạp sẽ coi dòng có tài khoản lạ là không hợp lệ).
    IF v_account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.auto_accounts a
        WHERE a.id = v_account AND a.staff_id = e.staff_id AND (a.organization_id IS NULL OR a.organization_id = e.organization_id)) THEN
      v_account := NULL;
    END IF;
    RETURN jsonb_build_object('row', jsonb_strip_nulls(jsonb_build_object(
      'contact_type', v_contact_type, 'flatform_type', 'facebook', 'uid', v_uid,
      'url', CASE WHEN v_uid ~* '^https?://' THEN v_uid END,
      'name', coalesce(v_name, v_uid), 'source_account_id', v_account,
      'phone', e.contact ->> 'phone', 'email', e.contact ->> 'email',
      'info1', e.contact ->> 'info1', 'info2', e.contact ->> 'info2', 'info3', e.contact ->> 'info3',
      'info4', e.contact ->> 'info4', 'info5', e.contact ->> 'info5')));
  END
  $function$;
  REVOKE ALL ON FUNCTION private.aka_agent_journey_facebook_group_row(bigint, text, bigint) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION private.aka_agent_journey_facebook_group_row(bigint, text, bigint) FROM anon, authenticated, service_role;
  END IF;

  v_def := pg_get_functiondef(v_fn);
  v_def := replace(replace(v_def, v_old_decl, v_new_decl), v_old_branch, v_new_branch);
  EXECUTE v_def;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
  IF md5(v_src) <> '297717e6918e2c5282ddaadb3d57ec3f' THEN
    RAISE EXCEPTION 'v627_result_md5 %', md5(v_src);
  END IF;
END
$migration$;
