-- Read-only role probes over existing Auth mappings. No credentials or row data
-- leave the transaction. Existing session issuer/token data are not extracted.
DO $roles$
DECLARE mapping record; actual_staff bigint; actual_org bigint; tables text[]:=ARRAY[
 'auto_account_contacts','auto_account_contact_groups','auto_contact_tags','auto_media_files','auto_media_groups',
 'auto_account_contact_group_members','auto_content_groups','auto_content_templates','auto_elements','auto_system_settings'];
 table_name text; mappings integer:=0; shared_ids bigint[]; shared_id bigint; claims jsonb; forbidden boolean;
BEGIN
 FOR mapping IN SELECT u.auth_user_id,s.id,s.organization_id FROM private.aka_agent_desktop_users u JOIN public.org_staff s ON s.id=u.staff_id WHERE s.is_active AND s.deleted_at IS NULL ORDER BY s.id LOOP
  claims:=jsonb_build_object('role','aka_agent_desktop','sub',mapping.auth_user_id);
  PERFORM set_config('request.jwt.claims',claims::text,true);
  SET LOCAL ROLE aka_agent_desktop;
  SELECT staff_id,organization_id INTO actual_staff,actual_org FROM private.aka_agent_desktop_data_context();
  IF actual_staff IS DISTINCT FROM mapping.id OR actual_org IS DISTINCT FROM mapping.organization_id THEN RAISE EXCEPTION 'V436 mapping mismatch'; END IF;
  FOREACH table_name IN ARRAY tables LOOP
   EXECUTE format('SELECT id FROM public.%I LIMIT 1',table_name) INTO actual_staff;
  END LOOP;
  -- Membership without an id column uses the existing composite primary key.
  PERFORM group_id,media_file_id FROM public.auto_media_group_items LIMIT 1;
  PERFORM id,name FROM public.org_organization WHERE id=mapping.organization_id;
  PERFORM id,staff_admin_id FROM public.org_organization WHERE is_admin_akabiz=true LIMIT 1;
  PERFORM id FROM public.org_organization_product WHERE organization_id=mapping.organization_id LIMIT 1;
  SELECT private.aka_agent_desktop_shared_content_groups() INTO shared_ids;
  IF EXISTS(SELECT 1 FROM org_organization WHERE id<>mapping.organization_id AND NOT is_admin_akabiz) THEN RAISE EXCEPTION 'V436 foreign organization visible'; END IF;
  SELECT EXISTS(SELECT 1 FROM auto_system_settings WHERE key='ai.deepseek.api_key') INTO forbidden;
  IF forbidden THEN RAISE EXCEPTION 'V436 DeepSeek regression'; END IF;
  RESET ROLE;
  FOREACH shared_id IN ARRAY shared_ids LOOP
   IF private.group_access('content',shared_id,mapping.id,mapping.organization_id) IS NULL THEN RAISE EXCEPTION 'V436 invalid shared group'; END IF;
  END LOOP;
  mappings:=mappings+1;
 END LOOP;
 IF mappings=0 THEN RAISE EXCEPTION 'V436 no active mappings verified'; END IF;
 PERFORM set_config('aka_agent.v436_verified_mappings',mappings::text,true);
END $roles$;
SELECT jsonb_build_object('status','passed','activeMappings',current_setting('aka_agent.v436_verified_mappings')::integer) AS role_smoke;
