-- V573: tag Zalo đã xoá trong nhóm điều kiện loại trừ không còn chặn chiến dịch.
-- Sinh bằng scripts/build-v573-sql.cjs từ thân hàm production đọc 18/11/2026; không sửa tay.
--
-- Lỗi (18/11/2026, chiến dịch 48267): khách xoá tag Zalo trong app Zalo, app đọc lại danh sách tag và đánh dòng
-- auto_account_contacts (contact_type 'zalo_tag') is_delete = true. Nhóm loại trừ còn chọn tag đó thì
-- aka_agent_internal_validate_send_exclusion_rules báo send_exclusion_option_unavailable ở đầu mỗi lượt chạy
-- (aka_agent_campaign_send_exclusion_runtime 'snapshot', aka_agent_engine_send_exclusion_v1), khi lưu chiến dịch
-- (trigger auto_validate_campaign_send_exclusion) và khi lưu nhóm (aka_agent_send_exclusion_groups 'save').
-- Bộ chạy cũ tạm dừng chiến dịch "Không thể tải cấu hình loại trừ…", engine v2 CFG18, Web báo mã tham chiếu ngẫu nhiên.
-- Bản sửa 04/11 (#594) chỉ bỏ tag đã xoá khi so tag lúc gửi (src/shared/campaignSendExclusion.ts, lõi engine).
--
-- Đổi: chỉ một điều kiện trong aka_agent_internal_validate_send_exclusion_rules. Giá trị của trường nguồn 'zalo_labels' không còn trong
-- danh sách lựa chọn nhưng là chuỗi khớp uid của một dòng zalo_tag (kể cả đã xoá) của chính tài khoản/nhân viên/tổ chức
-- thì hợp lệ. Giá trị chưa từng có, sai kiểu, tag akaBiz và các nguồn khác giữ như cũ. Không đổi dữ liệu, bảng, quyền.
-- Tra cứu đi qua uq_auto_account_contacts_account_type_uid (account_id, contact_type, uid) và chỉ chạy khi giá trị
-- không có trong danh sách.
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
-- md5 pg_get_functiondef: 6a3fdb6d9c0fdb7b8b510fd91623f2d0 -> 481ee1d14f27a88464cd8bd445a98e41. Gỡ: rollback_v573_send_exclusion_deleted_zalo_tags.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
DO $ledger$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v573_%') THEN
    RAISE EXCEPTION 'V573: sổ migration đã có một bản v573, không chạy lại / số đã bị dùng';
  END IF;
END $ledger$;
DO $guard$
DECLARE v_md5 text; v_owner text; v_acl text; v_secdef boolean; v_cfg text[]; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'aka_agent_internal_validate_send_exclusion_rules';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V573 preflight: có % bản aka_agent_internal_validate_send_exclusion_rules, cần đúng 1', v_n; END IF;
  SELECT md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.proconfig
    INTO v_md5, v_owner, v_acl, v_secdef, v_cfg FROM pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_internal_validate_send_exclusion_rules(jsonb,bigint,bigint,bigint)');
  IF v_md5 IS DISTINCT FROM '6a3fdb6d9c0fdb7b8b510fd91623f2d0' THEN RAISE EXCEPTION 'V573 preflight: thân aka_agent_internal_validate_send_exclusion_rules là %, cần 6a3fdb6d9c0fdb7b8b510fd91623f2d0', v_md5; END IF;
  IF v_owner <> 'postgres' OR v_acl IS DISTINCT FROM '{postgres=X/postgres}' OR NOT v_secdef OR v_cfg IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'V573 preflight: owner/quyền/thiết lập của aka_agent_internal_validate_send_exclusion_rules khác dự kiến (% % % %)', v_owner, v_acl, v_secdef, v_cfg;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_validate_send_exclusion_rules(p_rules jsonb, p_staff bigint, p_org bigint, p_account bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r jsonb; f public.auto_filter_fields%ROWTYPE; m public.auto_filter_field_operators%ROWTYPE; vals jsonb; v jsonb; opts jsonb;
BEGIN
 IF jsonb_typeof(p_rules) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rules)=0 OR jsonb_array_length(p_rules)>100
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x WHERE x->>'isEnabled'='true') THEN RAISE EXCEPTION 'send_exclusion_rules_required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x GROUP BY x->>'fieldId' HAVING count(*)>1) THEN RAISE EXCEPTION 'send_exclusion_duplicate_field'; END IF;
 opts:=public.aka_agent_internal_send_exclusion_options(p_staff,p_org,p_account);
 FOR r IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
  SELECT * INTO f FROM public.auto_filter_fields WHERE id=(r->>'fieldId')::bigint AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_field_unavailable'; END IF;
  SELECT m0.* INTO m FROM public.auto_filter_field_operators m0 JOIN public.auto_filter_operators o ON o.id=m0.operator_id AND o.is_active
   WHERE m0.field_id=f.id AND m0.operator_id=(r->>'operatorId')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_operator_unavailable'; END IF;
  IF NOT COALESCE((r->>'isEnabled')::boolean,false) THEN CONTINUE; END IF;
  vals:=CASE WHEN jsonb_typeof(r->'value')='array' THEN r->'value' WHEN r->'value' IS NOT NULL AND r->'value'<>'null' THEN jsonb_build_array(r->'value') ELSE '[]' END;
  IF jsonb_array_length(vals)<m.min_values OR jsonb_array_length(vals)>m.max_values THEN RAISE EXCEPTION 'send_exclusion_value_count'; END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(vals) LOOP
   IF m.value_type='number' THEN
    IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'send_exclusion_number_required'; END IF;
    IF (m.validation_config ? 'min' AND (v#>>'{}')::numeric<(m.validation_config->>'min')::numeric)
    OR (m.validation_config ? 'max' AND (v#>>'{}')::numeric>(m.validation_config->>'max')::numeric)
    OR (COALESCE((m.validation_config->>'integer')::boolean,false) AND trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) THEN RAISE EXCEPTION 'send_exclusion_number_range'; END IF;
   ELSIF m.value_type='date' THEN
    IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'send_exclusion_date_required'; END IF;
    PERFORM (v#>>'{}')::date;
   ELSIF m.value_type='text' AND (jsonb_typeof(v)<>'string' OR length(btrim(v#>>'{}'))=0) THEN RAISE EXCEPTION 'send_exclusion_text_required';
   ELSIF m.value_type='boolean' AND jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'send_exclusion_boolean_required'; END IF;
   IF f.options_source<>'none' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(opts) o WHERE (o->>'fieldId')::bigint=f.id AND o->'value'=v)
    -- V573: tag Zalo từng có của tài khoản rồi bị xoá trong Zalo vẫn hợp lệ; lúc chạy bộ lọc bỏ qua tag không còn (bản sửa 04/11/2026).
    AND NOT (f.options_source='zalo_labels' AND jsonb_typeof(v)='string' AND EXISTS(SELECT 1 FROM public.auto_account_contacts c
     WHERE c.account_id=p_account AND c.contact_type='zalo_tag' AND c.uid=(v#>>'{}') AND c.staff_id=p_staff AND c.organization_id=p_org))
   THEN RAISE EXCEPTION 'send_exclusion_option_unavailable'; END IF;
  END LOOP;
 END LOOP;
END;
$function$;

DO $guard$
DECLARE v_md5 text; v_owner text; v_acl text; v_secdef boolean; v_cfg text[]; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'aka_agent_internal_validate_send_exclusion_rules';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V573 postflight: có % bản aka_agent_internal_validate_send_exclusion_rules, cần đúng 1', v_n; END IF;
  SELECT md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), p.proacl::text, p.prosecdef, p.proconfig
    INTO v_md5, v_owner, v_acl, v_secdef, v_cfg FROM pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_internal_validate_send_exclusion_rules(jsonb,bigint,bigint,bigint)');
  IF v_md5 IS DISTINCT FROM '481ee1d14f27a88464cd8bd445a98e41' THEN RAISE EXCEPTION 'V573 postflight: thân aka_agent_internal_validate_send_exclusion_rules là %, cần 481ee1d14f27a88464cd8bd445a98e41', v_md5; END IF;
  IF v_owner <> 'postgres' OR v_acl IS DISTINCT FROM '{postgres=X/postgres}' OR NOT v_secdef OR v_cfg IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    RAISE EXCEPTION 'V573 postflight: owner/quyền/thiết lập của aka_agent_internal_validate_send_exclusion_rules khác dự kiến (% % % %)', v_owner, v_acl, v_secdef, v_cfg;
  END IF;
END $guard$;
COMMIT;
