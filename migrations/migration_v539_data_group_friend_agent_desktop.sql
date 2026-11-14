-- Desktop dùng "Thêm nhóm data bằng Agent" và "Agent chọn bạn bè" (akaAgent V539). Nguồn: akaAgentWebApp
-- scripts/sql/data-group-friend-agent/migration_data_group_friend_agent_desktop.sql; akaAgent chép nguyên byte thành
-- migrations/migration_v539_data_group_friend_agent_desktop.sql. Hướng dẫn: akaAgent docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md.
--
-- Ba việc trong một giao dịch:
-- 1. Cấp EXECUTE cho token Desktop (aka_agent_desktop) trên bốn hàm của V533–V537 mà Desktop gọi: danh sách tài khoản, danh
--    mục cho Agent, lọc (count | page | ids) và tạo nhóm. Xác thực giữ nguyên: auto_assert_automation_identity gắn token
--    Desktop với đúng p_staff_id (private.aka_agent_assert_request_ownership) rồi đòi tên đăng nhập/mật khẩu tự động hóa của
--    nhân viên. Không cấp hàm đọc bộ lọc của nhóm (aka_agent_get_data_group_friend_filter_v1) vì Desktop không dùng.
-- 2. Thân hàm tạo nhóm: chuyển p_auth_username/p_auth_password vào aka_agent_create_data_group_v2. Bản V534 truyền NULL, và hàm
--    đó kiểm lại danh tính nên từ chối token Desktop (automation_auth_required). API Web gọi bằng service_role với NULL nên kết
--    quả với Web không đổi. Mọi phần khác của thân hàm giữ đúng V534.
-- 3. Dòng cấu hình AI app_data_group_friend_agent_web (V535, prompt V538): đặt desktop_section_id = 'data_group.friend_agent'
--    để proxy AI của API Web (/api/aka-agent/desktop/v1/ai chỉ nhận dòng có desktop_section_id) chuyển lượt chat của Desktop.
--    Web và Desktop dùng chung một prompt, model và schema. Không ghi cột id (GENERATED ALWAYS AS IDENTITY trên DB thật).
-- Không COMMENT/NOTIFY. CREATE OR REPLACE FUNCTION là DDL nên PostgREST tự nạp lại schema, như V534–V537.
-- Áp một lần; áp lại bị từ chối. Gỡ: rollback_data_group_friend_agent_desktop.sql (akaAgent rollback_v539_…).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_expected jsonb := jsonb_build_object(
    'public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text)',
      'b153694afaefa999ef96dd6b6cfe857f|search_path=pg_catalog, pg_temp;statement_timeout=15s',
    'public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)',
      'c5eda5aca396f0c36652691ae6b345f1|search_path=pg_catalog, pg_temp;statement_timeout=30s;jit=off',
    'public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb)',
      'c87245ec15ef7ae968cdeb44a6deddc3|search_path=pg_catalog, pg_temp;statement_timeout=55s;jit=off',
    'public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)',
      '0baacbe5ae46ea70b9e2c2fc399a205c|search_path=pg_catalog, pg_temp;statement_timeout=60s;jit=off');
  v_fn text; v_want text; v_got text; v_acl text[];
BEGIN
  IF to_regrole('aka_agent_desktop') IS NULL THEN RAISE EXCEPTION 'v539_desktop_role_missing'; END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc AS p
      WHERE p.oid = to_regprocedure('public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)'))
      = '67422adb36468e88428a332c49b45b0c' THEN
    RAISE EXCEPTION 'v539_already_applied_do_not_reapply';
  END IF;
  FOR v_fn, v_want IN SELECT key, value FROM jsonb_each_text(v_expected) LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION 'v539_function_missing: %', v_fn; END IF;
    SELECT md5(p.prosrc) || '|' || array_to_string(p.proconfig, ';'), (SELECT array_agg(x.g ORDER BY x.g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
      ELSE a.grantee::regrole::text END AS g FROM aclexplode(p.proacl) AS a) AS x)
    INTO v_got, v_acl FROM pg_proc AS p WHERE p.oid = to_regprocedure(v_fn)
      AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres';
    -- Chỉ cấp quyền cho đúng bản đã apply (V533–V537); bản lạ hoặc quyền lạ thì dừng.
    IF v_got IS DISTINCT FROM v_want THEN RAISE EXCEPTION 'v539_function_unexpected: % %', v_fn, v_got; END IF;
    IF v_acl IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN RAISE EXCEPTION 'v539_function_acl_unexpected: % %', v_fn, v_acl; END IF;
  END LOOP;
  IF to_regprocedure('public.aka_agent_create_data_group_v2(bigint,bigint,text,text,text,bigint,bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v539_create_group_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs WHERE code = 'app_data_group_friend_agent_web'
      AND web_section_id = 'data_group.friend_agent' AND desktop_section_id IS NULL AND campaign_scope = 'all') THEN
    RAISE EXCEPTION 'v539_config_unexpected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_form_configs WHERE desktop_section_id = 'data_group.friend_agent') THEN
    RAISE EXCEPTION 'v539_desktop_section_taken';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_create_data_group_from_friend_filter_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET statement_timeout = '60s' SET jit = off AS $fn$
DECLARE
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_request_id text; v_name text; v_color text; v_filter jsonb; v_summary text[]; v_hash text; v_account bigint; v_type bigint;
  v_existing public.auto_data_group_friend_filters%ROWTYPE;
  v_ids bigint[]; v_group jsonb; v_group_id bigint; v_ingest jsonb; v_inserted integer; v_filter_id bigint; v_note text;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF NOT private.zalo_friend_json_keys_v1(p_request, ARRAY['requestId', 'name', 'color', 'filter', 'summary'])
    OR jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string' OR p_request->>'requestId' !~ '^[A-Za-z0-9:_-]{8,80}$'
    OR jsonb_typeof(p_request->'name') IS DISTINCT FROM 'string' OR char_length(btrim(p_request->>'name')) NOT BETWEEN 1 AND 255
    OR NOT (p_request->'color' = 'null'::jsonb OR (jsonb_typeof(p_request->'color') = 'string' AND p_request->>'color' ~ '^#[0-9A-Fa-f]{6}$'))
    OR jsonb_typeof(p_request->'summary') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'summary') > 40
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_request->'summary') AS s WHERE jsonb_typeof(s) <> 'string' OR char_length(s #>> '{}') > 300) THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'request', HINT = 'request';
  END IF;
  v_request_id := p_request->>'requestId';
  v_name := btrim(p_request->>'name');
  v_color := coalesce(upper(p_request->>'color'), '#2563EB');
  v_filter := p_request->'filter';
  v_summary := ARRAY(SELECT s FROM jsonb_array_elements_text(p_request->'summary') AS s);
  v_hash := md5(jsonb_build_object('name', v_name, 'color', v_color, 'filter', v_filter)::text);

  -- Cùng requestId: trả lại kết quả cũ (bấm lại sau lỗi mạng không tạo nhóm thứ hai).
  PERFORM pg_advisory_xact_lock(hashtextextended('aka_friend_filter:' || p_organization_id || ':' || p_staff_id || ':' || v_request_id, 0));
  SELECT * INTO v_existing FROM public.auto_data_group_friend_filters AS f
  WHERE f.staff_id = p_staff_id AND f.organization_id = p_organization_id AND f.request_id = v_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> v_hash THEN RAISE EXCEPTION 'friend_filter_request_conflict'; END IF;
    RETURN jsonb_build_object('groupId', v_existing.group_id, 'filterId', v_existing.id, 'matched', v_existing.matched_count,
      'inserted', v_existing.inserted_count, 'replayed', true);
  END IF;

  PERFORM private.zalo_friend_filter_check_v1(v_filter, v_today);
  PERFORM private.zalo_friend_filter_scope_v1(p_staff_id, p_organization_id, v_filter);
  v_account := (v_filter->>'accountId')::bigint;
  SELECT i.id INTO v_type FROM public.category_type AS t JOIN public.category_item AS i ON i.category_type_id = t.id
  WHERE t.namespace = 'common' AND t.code = 'data_type' AND i.code = 'zalo_person' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  IF v_type IS NULL THEN RAISE EXCEPTION 'friend_filter_zalo_person_type_missing'; END IF;

  -- Cùng hàm đánh giá với lượt đếm thử.
  SELECT array_agg(r.contact_id ORDER BY r.sel_rank) INTO v_ids
  FROM private.zalo_friend_filter_rows_v1(p_staff_id, p_organization_id, v_filter, v_now, false) AS r WHERE r.selected;
  IF coalesce(cardinality(v_ids), 0) = 0 THEN RAISE EXCEPTION 'friend_filter_empty'; END IF;

  -- Nhóm tạo ra CHƯA gắn tài khoản; nạp xong mới gắn (câu UPDATE ở cuối). Với nhóm đã gắn tài khoản, hàm nạp sẵn có kiểm
  -- nguồn bằng phép nối auto_account_contacts theo c.id::text nên không dùng được khoá chính và quét cả bảng danh bạ
  -- (production 14/11/2026, 5 dòng: 416.611 khối, 2,8 giây khi ấm, 26 đến hơn 60 giây khi nguội). Mọi thành viên là liên
  -- hệ của v_account (hàm đánh giá chỉ trả bạn bè của tài khoản này), và trigger aka_agent_guard_data_group_bound_account
  -- kiểm lại điều đó khi gắn.
  -- Chuyển nguyên tên đăng nhập/mật khẩu tự động hóa: hàm tạo nhóm kiểm lại danh tính, và với token Desktop (không phải
  -- service_role) thì đòi hai giá trị này. API Web gửi NULL bằng service_role nên không đổi gì với Web.
  v_group := public.aka_agent_create_data_group_v2(p_staff_id, p_organization_id, v_name, v_color, v_request_id || ':group',
    v_type, NULL::bigint, p_auth_username, p_auth_password);
  v_group_id := (v_group->>'id')::bigint;
  IF v_group_id IS NULL THEN RAISE EXCEPTION 'friend_filter_group_create_failed'; END IF;

  v_ingest := public.aka_agent_ingest_data_group(p_staff_id, p_organization_id, v_request_id || ':ingest', v_group_id, 'scan',
    (SELECT jsonb_agg(jsonb_build_object('contact_id', id, 'source_account_id', v_account, 'contact_type', 'person', 'flatform_type', 'zalo') ORDER BY ord)
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, ord)),
    NULL::bigint, NULL::text, NULL::text, v_account, 'Agent lọc bạn bè'::text, NULL::text, v_type);
  v_inserted := coalesce((v_ingest->>'inserted_membership_count')::integer, 0) + coalesce((v_ingest->>'reactivated_membership_count')::integer, 0)
    + coalesce((v_ingest->>'already_member_count')::integer, 0);

  INSERT INTO public.auto_data_group_friend_filters (group_id, staff_id, organization_id, account_id, request_id, request_hash, filter,
    summary, matched_count, inserted_count, created_at, last_run_at, run_count, last_batch_id)
  VALUES (v_group_id, p_staff_id, p_organization_id, v_account, v_request_id, v_hash, v_filter, v_summary, cardinality(v_ids), v_inserted,
    v_now, v_now, 1, nullif(v_ingest->>'batch_id', '')::bigint)
  RETURNING id INTO v_filter_id;

  -- Ghi chú nhóm tối đa 2.000 ký tự (data_group_note_too_long).
  v_note := left('Tạo bằng Agent ngày ' || to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || ':'
    || coalesce(E'\n' || (SELECT string_agg(CASE WHEN s LIKE '  - %' THEN s ELSE '- ' || s END, E'\n') FROM unnest(v_summary) AS s), ''), 2000);
  UPDATE public.auto_account_contact_groups SET bound_zalo_account_id = v_account, note = v_note WHERE id = v_group_id;

  RETURN jsonb_build_object('groupId', v_group_id, 'filterId', v_filter_id, 'matched', cardinality(v_ids), 'inserted', v_inserted, 'replayed', false);
END
$fn$;

GRANT EXECUTE ON FUNCTION public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb) TO aka_agent_desktop;

UPDATE public.ai_form_configs SET desktop_section_id = 'data_group.friend_agent'
WHERE code = 'app_data_group_friend_agent_web' AND desktop_section_id IS NULL;

DO $postflight$
DECLARE
  v_expected jsonb := jsonb_build_object(
    'public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text)',
      'b153694afaefa999ef96dd6b6cfe857f|search_path=pg_catalog, pg_temp;statement_timeout=15s',
    'public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)',
      'c5eda5aca396f0c36652691ae6b345f1|search_path=pg_catalog, pg_temp;statement_timeout=30s;jit=off',
    'public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb)',
      'c87245ec15ef7ae968cdeb44a6deddc3|search_path=pg_catalog, pg_temp;statement_timeout=55s;jit=off',
    'public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)',
      '67422adb36468e88428a332c49b45b0c|search_path=pg_catalog, pg_temp;statement_timeout=60s;jit=off');
  v_fn text; v_want text; v_got text; v_acl text[];
BEGIN
  FOR v_fn, v_want IN SELECT key, value FROM jsonb_each_text(v_expected) LOOP
    SELECT md5(p.prosrc) || '|' || array_to_string(p.proconfig, ';'), (SELECT array_agg(x.g ORDER BY x.g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
      ELSE a.grantee::regrole::text END AS g FROM aclexplode(p.proacl) AS a) AS x)
    INTO v_got, v_acl FROM pg_proc AS p WHERE p.oid = to_regprocedure(v_fn)
      AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres';
    IF v_got IS DISTINCT FROM v_want THEN RAISE EXCEPTION 'v539_postflight_function: % %', v_fn, v_got; END IF;
    IF v_acl IS DISTINCT FROM ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
      RAISE EXCEPTION 'v539_postflight_acl: % %', v_fn, v_acl;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
      OR NOT has_function_privilege('aka_agent_desktop', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'v539_postflight_privilege: %', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('aka_agent_desktop', 'public.aka_agent_get_data_group_friend_filter_v1(bigint,bigint,text,text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v539_postflight_group_reader_granted';
  END IF;
  IF (SELECT count(*) FROM public.ai_form_configs WHERE code = 'app_data_group_friend_agent_web'
      AND web_section_id = 'data_group.friend_agent' AND desktop_section_id = 'data_group.friend_agent' AND is_active) <> 1 THEN
    RAISE EXCEPTION 'v539_postflight_config';
  END IF;
END
$postflight$;
COMMIT;
