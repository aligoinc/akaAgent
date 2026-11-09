-- V486: 3 hàm kiểm quyền đọc nhóm chia sẻ chuyển LANGUAGE sql -> plpgsql, giữ nguyên từng câu truy vấn và thuộc tính
-- (STABLE, SECURITY DEFINER, search_path). Hàm SQL có SET không được inline nên mỗi lần gọi lập kế hoạch lại; plpgsql
-- giữ plan trong phiên. Kết quả: SELECT INTO lấy dòng đầu như hàm SQL trả dòng đầu.
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
