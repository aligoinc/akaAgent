-- Gỡ migration_data_group_friend_agent_desktop.sql (akaAgent V539): thu quyền Desktop trên bốn hàm, trả thân hàm tạo nhóm
-- về đúng bản V534 và bỏ desktop_section_id của dòng cấu hình AI. API Web (service_role) không bị ảnh hưởng. Bản Desktop có
-- tính năng sẽ báo "đang được cập nhật" và ẩn nút (docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md của akaAgent). Áp lại được.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)');
  -- Bản V539 hoặc (áp lại sau khi đã gỡ) bản V534; bản lạ thì dừng, không ghi đè.
  IF v_md5 IS NULL OR v_md5 NOT IN ('67422adb36468e88428a332c49b45b0c', '0baacbe5ae46ea70b9e2c2fc399a205c') THEN
    RAISE EXCEPTION 'v539_rollback_state_unexpected: %', v_md5;
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
  v_group := public.aka_agent_create_data_group_v2(p_staff_id, p_organization_id, v_name, v_color, v_request_id || ':group',
    v_type, NULL::bigint, NULL::text, NULL::text);
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

REVOKE EXECUTE ON FUNCTION public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb) FROM aka_agent_desktop;
REVOKE EXECUTE ON FUNCTION public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb) FROM aka_agent_desktop;

UPDATE public.ai_form_configs SET desktop_section_id = NULL
WHERE code = 'app_data_group_friend_agent_web' AND desktop_section_id = 'data_group.friend_agent';

DO $postflight$
DECLARE v_fn text; v_acl text[];
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc AS p
      WHERE p.oid = to_regprocedure('public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)'))
      IS DISTINCT FROM '0baacbe5ae46ea70b9e2c2fc399a205c' THEN
    RAISE EXCEPTION 'v539_rollback_create_function';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text)',
      'public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)',
      'public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb)',
      'public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)'] LOOP
    SELECT (SELECT array_agg(x.g ORDER BY x.g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
      ELSE a.grantee::regrole::text END AS g FROM aclexplode(p.proacl) AS a) AS x) INTO v_acl FROM pg_proc AS p WHERE p.oid = to_regprocedure(v_fn);
    IF v_acl IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN RAISE EXCEPTION 'v539_rollback_acl: % %', v_fn, v_acl; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.ai_form_configs WHERE desktop_section_id = 'data_group.friend_agent') THEN
    RAISE EXCEPTION 'v539_rollback_config';
  END IF;
END
$postflight$;
COMMIT;
