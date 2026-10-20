-- V409: additive sharing metadata. Legacy table ACLs intentionally remain unchanged.
ALTER TABLE public.auto_account_contact_groups
  ADD COLUMN sharing_scope text NOT NULL DEFAULT 'private'
    CHECK (sharing_scope IN ('private','organization','selected')),
  ADD COLUMN sharing_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.auto_content_groups
  ADD COLUMN sharing_scope text NOT NULL DEFAULT 'private'
    CHECK (sharing_scope IN ('private','organization','selected')),
  ADD COLUMN sharing_revision bigint NOT NULL DEFAULT 0;

CREATE TABLE public.auto_data_group_recipients (
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, staff_id)
);
CREATE INDEX auto_data_group_recipients_staff ON public.auto_data_group_recipients(staff_id,group_id);
CREATE TABLE public.auto_content_group_recipients (
  group_id bigint NOT NULL REFERENCES public.auto_content_groups(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, staff_id)
);
CREATE INDEX auto_content_group_recipients_staff ON public.auto_content_group_recipients(staff_id,group_id);
ALTER TABLE public.auto_data_group_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_content_group_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_data_group_recipients,public.auto_content_group_recipients FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.group_copy_requests (
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 500),
  request_hash text NOT NULL,
  result jsonb,
  PRIMARY KEY (staff_id,organization_id,request_id)
);
ALTER TABLE private.group_copy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.group_copy_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.group_access(p_kind text,p_group_id bigint,p_staff_id bigint,p_organization_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
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
$fn$;
REVOKE ALL ON FUNCTION private.group_access(text,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.can_read_data_group(p_group_id bigint,p_staff_id bigint,p_organization_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT private.group_access('data',p_group_id,p_staff_id,p_organization_id) IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION private.can_read_data_group(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;

-- Group row is the established lock root for intake, bind, snapshot and revoke.
CREATE FUNCTION private.lock_read_data_group(p_group_id bigint,p_staff_id bigint,p_organization_id bigint)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  PERFORM id FROM public.auto_account_contact_groups WHERE id=p_group_id FOR SHARE;
  RETURN private.can_read_data_group(p_group_id,p_staff_id,p_organization_id);
END;
$fn$;
REVOKE ALL ON FUNCTION private.lock_read_data_group(bigint,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.shared_data_member_owner(p_group_id bigint,p_contact_staff_id bigint,p_staff_id bigint,p_organization_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS(SELECT 1 FROM public.auto_account_contact_groups g
    WHERE g.id=p_group_id AND g.staff_id=p_contact_staff_id
      AND private.can_read_data_group(g.id,p_staff_id,p_organization_id));
$fn$;
REVOKE ALL ON FUNCTION private.shared_data_member_owner(bigint,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;

-- Membership changes revoke active cross-staff subscriptions immediately. Rejoining
-- never reactivates a source; the recipient must explicitly bind/reactivate again.
CREATE FUNCTION private.stop_invalid_staff_group_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_group bigint; v_source record;
BEGIN
  IF NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
    AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
    AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
  FOR v_group IN SELECT DISTINCT g.id FROM public.auto_account_contact_groups g
    JOIN public.auto_campaign_data_group_sources s ON s.group_id=g.id
    WHERE s.staff_id<>g.staff_id AND (g.staff_id=NEW.id OR s.staff_id=NEW.id)
      AND s.status IN ('active','baselining') ORDER BY g.id
  LOOP
    PERFORM id FROM public.auto_account_contact_groups WHERE id=v_group FOR UPDATE;
    FOR v_source IN SELECT s.id,s.campaign_id FROM public.auto_campaign_data_group_sources s
      JOIN public.auto_account_contact_groups g ON g.id=s.group_id
      WHERE s.group_id=v_group AND s.staff_id<>g.staff_id AND s.status IN ('active','baselining')
        AND NOT private.can_read_data_group(g.id,s.staff_id,s.organization_id)
      ORDER BY s.campaign_id,s.id
    LOOP
      PERFORM public.aka_agent_lock_campaign_input_serialization(v_source.campaign_id);
      UPDATE public.auto_campaign_data_group_sources SET status='stopped',stop_reason='sharing_revoked',stopped_at=now(),updated_at=now()
        WHERE id=v_source.id AND status IN ('active','baselining');
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.stop_invalid_staff_group_sources() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER group_sharing_staff_scope_changed
AFTER UPDATE OF organization_id,deleted_at,is_active ON public.org_staff
FOR EACH ROW EXECUTE FUNCTION private.stop_invalid_staff_group_sources();
