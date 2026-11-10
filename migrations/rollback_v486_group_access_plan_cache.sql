-- Rollback V486: trả 3 hàm kiểm quyền nhóm chia sẻ về nguyên văn LANGUAGE sql trước V486 (quyền giữ nguyên vì
-- CREATE OR REPLACE). Hàm đã cũ thì bỏ qua; khác cả bản cũ lẫn bản V486 thì dừng. Sinh bằng scripts/build-v486-sql.py.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v486_rb_block_1$
DECLARE
  v_md5 text := md5(pg_get_functiondef(to_regprocedure('private.group_access(text,bigint,bigint,bigint)')));
BEGIN
  IF v_md5 = '4f7d34cd8bfa753d35a9ab9a0ec213b4' THEN
    EXECUTE $v486_rb_1$CREATE OR REPLACE FUNCTION private.group_access(p_kind text, p_group_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    'ownerStaffId',g.staff_id,'ownerName',CASE WHEN (SELECT private.aka_agent_staff_scope_for_request()) IS NOT NULL
      AND owner.id IS DISTINCT FROM (SELECT private.aka_agent_staff_scope_for_request())
      THEN 'Nhân viên #'||owner.id ELSE COALESCE(NULLIF(owner.name,''),'Nhân viên #'||owner.id) END,
    'role',CASE WHEN g.staff_id=p_staff_id THEN 'owner' ELSE 'shared' END,
    'canManage',g.staff_id=p_staff_id,'canUse',true,'canCopy',true,
    'scope',g.sharing_scope,'revision',g.sharing_revision::text)
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
$function$$v486_rb_1$;
  ELSIF v_md5 IS DISTINCT FROM 'd173eaf22b0b6b6958a6f8f40cdaa82d' THEN
    RAISE EXCEPTION 'v486 rollback: % changed outside V486 (md5 %)', 'private.group_access(text,bigint,bigint,bigint)', v_md5;
  END IF;
END
$v486_rb_block_1$;

DO $v486_rb_block_2$
DECLARE
  v_md5 text := md5(pg_get_functiondef(to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)')));
BEGIN
  IF v_md5 = '8d5f08ca86d4f5a90e24f7c45a02da15' THEN
    EXECUTE $v486_rb_2$CREATE OR REPLACE FUNCTION private.can_read_data_group(p_group_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT private.group_access('data',p_group_id,p_staff_id,p_organization_id) IS NOT NULL;
$function$$v486_rb_2$;
  ELSIF v_md5 IS DISTINCT FROM 'c47165554f49d3099d1f95e7d136eae5' THEN
    RAISE EXCEPTION 'v486 rollback: % changed outside V486 (md5 %)', 'private.can_read_data_group(bigint,bigint,bigint)', v_md5;
  END IF;
END
$v486_rb_block_2$;

DO $v486_rb_block_3$
DECLARE
  v_md5 text := md5(pg_get_functiondef(to_regprocedure('private.shared_data_member_owner(bigint,bigint,bigint,bigint)')));
BEGIN
  IF v_md5 = '0cf5471fa64437cf4e99528e0c2e31c7' THEN
    EXECUTE $v486_rb_3$CREATE OR REPLACE FUNCTION private.shared_data_member_owner(p_group_id bigint, p_contact_staff_id bigint, p_staff_id bigint, p_organization_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS(SELECT 1 FROM public.auto_account_contact_groups g
    WHERE g.id=p_group_id AND g.staff_id=p_contact_staff_id
      AND private.can_read_data_group(g.id,p_staff_id,p_organization_id));
$function$$v486_rb_3$;
  ELSIF v_md5 IS DISTINCT FROM '529e0060fe2e757a12e8674826137b65' THEN
    RAISE EXCEPTION 'v486 rollback: % changed outside V486 (md5 %)', 'private.shared_data_member_owner(bigint,bigint,bigint,bigint)', v_md5;
  END IF;
END
$v486_rb_block_3$;

DO $v486_rb_postflight$
DECLARE
  v_item record;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{"private.group_access(text,bigint,bigint,bigint)": "d173eaf22b0b6b6958a6f8f40cdaa82d", "private.can_read_data_group(bigint,bigint,bigint)": "c47165554f49d3099d1f95e7d136eae5", "private.shared_data_member_owner(bigint,bigint,bigint,bigint)": "529e0060fe2e757a12e8674826137b65"}'::jsonb) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(v_item.sig))) IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v486 rollback: % not restored', v_item.sig;
    END IF;
  END LOOP;
END
$v486_rb_postflight$;

COMMIT;
