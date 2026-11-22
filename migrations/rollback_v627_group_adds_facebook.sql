-- Gỡ V627: trả `private.aka_agent_journey_engine_group_adds` về đúng thân V613 (md5 kiểm trước và sau) và xóa hàm nhánh Facebook.
-- Khách đã nạp vào Nhóm data Facebook giữ nguyên. Sau khi gỡ, bước đưa vào nhóm của các đồng bộ Facebook báo "loại nhóm không
-- nhận được khách này" và khách đi tiếp.
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
    RAISE EXCEPTION 'v627_rollback_missing_function';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
  IF md5(v_src) <> '297717e6918e2c5282ddaadb3d57ec3f' THEN
    RAISE EXCEPTION 'v627_rollback_unexpected_body %', md5(v_src);
  END IF;
  v_def := pg_get_functiondef(v_fn);
  v_def := replace(replace(v_def, v_new_branch, v_old_branch), v_new_decl, v_old_decl);
  EXECUTE v_def;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
  IF md5(v_src) <> 'f063f517ca87e00d4d24b7c2b3d36c2c' THEN
    RAISE EXCEPTION 'v627_rollback_result_md5 %', md5(v_src);
  END IF;
  DROP FUNCTION private.aka_agent_journey_facebook_group_row(bigint, text, bigint);
END
$migration$;
