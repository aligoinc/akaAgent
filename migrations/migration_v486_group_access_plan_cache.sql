-- V486: tăng tốc kiểm quyền đọc nhóm chia sẻ (đường đẩy data nhóm vào chiến dịch và mọi RPC đọc nhóm).
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v486-sql.py, đừng sửa tay. Độc lập V484.
--
-- private.group_access / private.can_read_data_group / private.shared_data_member_owner: LANGUAGE sql -> plpgsql, câu
-- truy vấn giữ nguyên từng chữ, giữ STABLE + SECURITY DEFINER + search_path + quyền. group_access thêm
-- SET plan_cache_mode = force_generic_plan. Hàm SQL có SET không được inline nên lập kế hoạch lại mỗi lần gọi
-- (~0,48 ms); mỗi cặp (thành viên, chiến dịch) khi đẩy data gọi 2 lần = 52% thời gian đẩy (đo cục bộ, hàm live thật).
-- Sau V486: 0,05 ms/lần, đẩy nhanh ~2,4 lần (1,86 -> 0,77 ms/cặp cục bộ).
--
-- Tự đối chiếu trên dữ liệu thật trong cùng giao dịch: trước khi thay, tính kết quả của 3 hàm cho tối đa 500 nhóm
-- (400 nhóm data mới nhất + 100 nhóm nội dung) x (chủ nhóm, 2 nhân viên khác cùng tổ chức, tối đa 2 người được chia sẻ,
-- 1 nhân viên tổ chức khác); sau khi thay tính lại, lệch một dòng là huỷ cả giao dịch.
-- Preflight kiểm md5 pg_get_functiondef (chụp live 27/10/2026; V409 tạo, V435 chỉ đổi quyền).
-- Rollback: migrations/rollback_v486_group_access_plan_cache.sql. Kiểm thử: python3 scripts/data-group-routing/test_v486.py
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v486_preflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{"private.group_access(text,bigint,bigint,bigint)": "251162422553d81d432151554b5ea16a", "private.can_read_data_group(bigint,bigint,bigint)": "c47165554f49d3099d1f95e7d136eae5", "private.shared_data_member_owner(bigint,bigint,bigint,bigint)": "529e0060fe2e757a12e8674826137b65"}'::jsonb) LOOP
    IF to_regprocedure(v_item.sig) IS NULL THEN
      RAISE EXCEPTION 'v486: % missing', v_item.sig;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 = ('{"private.group_access(text,bigint,bigint,bigint)": "7355d59e2b1a80dd601e30e68bb35eda", "private.can_read_data_group(bigint,bigint,bigint)": "8d5f08ca86d4f5a90e24f7c45a02da15", "private.shared_data_member_owner(bigint,bigint,bigint,bigint)": "0cf5471fa64437cf4e99528e0c2e31c7"}'::jsonb ->> v_item.sig) THEN
      RAISE EXCEPTION 'v486: already applied (%)', v_item.sig;
    END IF;
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v486: % drifted (md5 %, expected %); re-read live definition', v_item.sig, v_md5, v_item.expected;
    END IF;
  END LOOP;
END
$v486_preflight$;

CREATE TEMP TABLE v486_acl ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
       p.provolatile
FROM pg_proc AS p
WHERE p.oid IN (to_regprocedure('private.group_access(text,bigint,bigint,bigint)'), to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)'), to_regprocedure('private.shared_data_member_owner(bigint,bigint,bigint,bigint)'));

CREATE TEMP TABLE v486_probe ON COMMIT DROP AS
WITH data_groups AS (
  SELECT g.id, g.staff_id, g.organization_id
  FROM public.auto_account_contact_groups AS g
  WHERE g.purpose = 'data_group'
  ORDER BY g.updated_at DESC NULLS LAST, g.id DESC
  LIMIT 400
), content_groups AS (
  SELECT g.id, g.staff_id, g.organization_id
  FROM public.auto_content_groups AS g
  ORDER BY g.id DESC
  LIMIT 100
), groups AS (
  SELECT 'data'::text AS kind, * FROM data_groups
  UNION ALL
  SELECT 'content'::text AS kind, * FROM content_groups
), viewers AS (
  -- Chủ nhóm, 2 nhân viên khác cùng tổ chức, tối đa 2 người được chia sẻ riêng, 1 nhân viên tổ chức khác.
  SELECT g.kind, g.id AS group_id, g.staff_id AS owner_id, g.organization_id, g.staff_id AS viewer_id FROM groups AS g
  UNION
  SELECT g.kind, g.id, g.staff_id, g.organization_id, other.id
  FROM groups AS g
  CROSS JOIN LATERAL (
    SELECT staff.id FROM public.org_staff AS staff
    WHERE staff.organization_id = g.organization_id AND staff.id <> g.staff_id
    ORDER BY staff.id LIMIT 2
  ) AS other
  UNION
  SELECT g.kind, g.id, g.staff_id, g.organization_id, recipient.staff_id
  FROM groups AS g
  CROSS JOIN LATERAL (
    SELECT r.staff_id FROM public.auto_data_group_recipients AS r WHERE g.kind = 'data' AND r.group_id = g.id
    UNION ALL
    SELECT r.staff_id FROM public.auto_content_group_recipients AS r WHERE g.kind = 'content' AND r.group_id = g.id
    LIMIT 2
  ) AS recipient
  UNION
  SELECT g.kind, g.id, g.staff_id, g.organization_id, stranger.id
  FROM groups AS g
  CROSS JOIN LATERAL (
    SELECT staff.id FROM public.org_staff AS staff
    WHERE staff.organization_id IS DISTINCT FROM g.organization_id
    ORDER BY staff.id LIMIT 1
  ) AS stranger
)
SELECT v.*,
       private.group_access(v.kind, v.group_id, v.viewer_id, v.organization_id) AS access_before,
       CASE WHEN v.kind = 'data' THEN private.can_read_data_group(v.group_id, v.viewer_id, v.organization_id) END AS read_before,
       CASE WHEN v.kind = 'data'
         THEN private.shared_data_member_owner(v.group_id, v.owner_id, v.viewer_id, v.organization_id) END AS owner_before
FROM viewers AS v;

CREATE OR REPLACE FUNCTION private.group_access(p_kind text, p_group_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
DECLARE
  v_access jsonb;
BEGIN
  WITH resource AS (
    SELECT id,staff_id,organization_id,sharing_scope,sharing_revision
    FROM public.auto_account_contact_groups
    WHERE p_kind='data' AND id=p_group_id AND purpose='data_group' AND NOT is_delete
    UNION ALL
    SELECT id,staff_id,organization_id,sharing_scope,sharing_revision
    FROM public.auto_content_groups
    WHERE p_kind='content' AND id=p_group_id AND NOT is_delete
  )
  SELECT jsonb_build_object(
    'ownerStaffId',g.staff_id,'ownerName',COALESCE(NULLIF(owner.name,''),'Nhân viên #'||owner.id),
    'role',CASE WHEN g.staff_id=p_staff_id THEN 'owner' ELSE 'shared' END,
    'canManage',g.staff_id=p_staff_id,'canUse',true,'canCopy',true,
    'scope',g.sharing_scope,'revision',g.sharing_revision::text)
  INTO v_access
  FROM resource g
  JOIN public.org_staff owner ON owner.id=g.staff_id AND owner.organization_id=g.organization_id
    AND owner.deleted_at IS NULL AND owner.is_active
  JOIN public.org_staff viewer ON viewer.id=p_staff_id AND viewer.organization_id=g.organization_id
    AND viewer.deleted_at IS NULL AND viewer.is_active
  WHERE g.organization_id=p_organization_id AND (
    g.staff_id=p_staff_id OR g.sharing_scope='organization' OR
    (g.sharing_scope='selected' AND (
      (p_kind='data' AND EXISTS(SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id=g.id AND r.staff_id=p_staff_id))
      OR (p_kind='content' AND EXISTS(SELECT 1 FROM public.auto_content_group_recipients r WHERE r.group_id=g.id AND r.staff_id=p_staff_id))
    ))
  );
  RETURN v_access;
END;
$function$;

CREATE OR REPLACE FUNCTION private.can_read_data_group(p_group_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN private.group_access('data',p_group_id,p_staff_id,p_organization_id) IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION private.shared_data_member_owner(p_group_id bigint, p_contact_staff_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN EXISTS(SELECT 1 FROM public.auto_account_contact_groups g
    WHERE g.id=p_group_id AND g.staff_id=p_contact_staff_id
      AND private.can_read_data_group(g.id,p_staff_id,p_organization_id));
END;
$function$;

DO $v486_postflight$
DECLARE
  v_item record;
  v_md5 text;
  v_bad bigint;
  v_total bigint;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{"private.group_access(text,bigint,bigint,bigint)": "7355d59e2b1a80dd601e30e68bb35eda", "private.can_read_data_group(bigint,bigint,bigint)": "8d5f08ca86d4f5a90e24f7c45a02da15", "private.shared_data_member_owner(bigint,bigint,bigint,bigint)": "0cf5471fa64437cf4e99528e0c2e31c7"}'::jsonb) LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v486: % not as expected after apply (md5 %)', v_item.sig, v_md5;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM v486_acl AS before JOIN pg_proc AS p ON p.oid = to_regprocedure(before.sig)
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner
       OR p.prosecdef IS DISTINCT FROM before.prosecdef OR p.provolatile IS DISTINCT FROM before.provolatile
  ) THEN
    RAISE EXCEPTION 'v486: privileges/owner/volatility changed';
  END IF;
  SELECT count(*) FILTER (WHERE
           private.group_access(probe.kind, probe.group_id, probe.viewer_id, probe.organization_id)
             IS DISTINCT FROM probe.access_before
           OR (probe.kind = 'data' AND (
             private.can_read_data_group(probe.group_id, probe.viewer_id, probe.organization_id)
               IS DISTINCT FROM probe.read_before
             OR private.shared_data_member_owner(probe.group_id, probe.owner_id, probe.viewer_id, probe.organization_id)
               IS DISTINCT FROM probe.owner_before))),
         count(*)
  INTO v_bad, v_total
  FROM v486_probe AS probe;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'v486: % of % probe(s) changed result; rolled back', v_bad, v_total;
  END IF;
  RAISE NOTICE 'v486: % probe(s) identical before/after', v_total;
END
$v486_postflight$;

COMMIT;
