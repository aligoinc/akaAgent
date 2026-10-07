BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $guard$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])'))) IS DISTINCT FROM '8f78a6f048faf4581b93674e16632ecd' THEN RAISE EXCEPTION 'v352 rollback: target changed'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text)'))) IS DISTINCT FROM 'abafd33b61827378f82e5f47bc93db18' THEN RAISE EXCEPTION 'v352 rollback: target changed'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)'))) IS DISTINCT FROM '5c8e5a68ee2b52e240d01386e05b90b6' THEN RAISE EXCEPTION 'v352 rollback: target changed'; END IF;
END;
$guard$;
DROP FUNCTION public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[]);
CREATE OR REPLACE FUNCTION public.aka_agent_mutate_contact_tags(p_staff_id bigint, p_organization_id bigint, p_contact_ids bigint[], p_tag_ids bigint[], p_auth_username text, p_auth_password text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE v_contact public.auto_account_contacts%ROWTYPE; v_tags bigint[];
  v_previous_batch text; v_chat_account_id bigint; v_zalo_uid text; v_conversation_type text;
  v_conversation_id bigint; v_changed integer; v_count integer:=0;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_mode IS NULL OR p_mode NOT IN ('add','remove') THEN RAISE EXCEPTION 'contact_tag_mode_invalid'; END IF;
  IF COALESCE(cardinality(p_contact_ids),0)>100
    THEN RAISE EXCEPTION 'contact_tag_batch_limit_exceeded'; END IF;
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),'{}'::bigint[]) INTO v_tags
    FROM public.auto_contact_tags WHERE id=ANY(p_tag_ids) AND staff_id=p_staff_id
      AND organization_id=p_organization_id AND (p_mode='remove' OR NOT is_delete);
  IF cardinality(v_tags)=0 THEN RETURN jsonb_build_object('success',true,'count',0); END IF;
  FOR v_contact IN SELECT * FROM public.auto_account_contacts
    WHERE id=ANY(p_contact_ids) AND staff_id=p_staff_id AND organization_id=p_organization_id AND NOT is_delete
    ORDER BY id
  LOOP
    IF p_mode='add' AND EXISTS (SELECT 1 FROM public.auto_contact_tags t WHERE t.id=ANY(v_tags)
      AND t.auto_account_id IS NOT NULL AND t.auto_account_id IS DISTINCT FROM v_contact.account_id)
      THEN RAISE EXCEPTION 'contact_tag_scope_invalid'; END IF;
    SELECT conv.id,ac.chat_zalo_account_id,ac.zalo_id,ac.conversation_type
      INTO v_conversation_id,v_chat_account_id,v_zalo_uid,v_conversation_type
    FROM public.auto_account_contacts c
    JOIN public.chat_zalo_account_organization b ON b.auto_account_id=c.account_id
      AND b.organization_id=c.organization_id AND b.is_active AND c.flatform_type='zalo'
    JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id
      AND ac.zalo_id=c.uid AND ac.conversation_type=CASE WHEN c.contact_type='person' THEN 'user' WHEN c.contact_type='group' THEN 'group' END
    JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id
      AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
    WHERE c.id=v_contact.id;
    IF v_conversation_id IS NOT NULL THEN
      -- Suppress per-tag mirrors/queue writes only inside this batch. Restore
      -- before the single contact event and projection, including on errors.
      v_previous_batch:=current_setting('aka_agent.chat_tag_batch',true);
      PERFORM set_config('aka_agent.chat_tag_batch','on',true);
      BEGIN
        IF p_mode='add' THEN
          INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id,assigned_by_org_staff_id)
            SELECT p_organization_id,v_conversation_id,k,p_staff_id FROM unnest(v_tags) k
            ON CONFLICT(chat_zalo_conversation_id,auto_contact_tag_id) DO NOTHING;
        ELSE
          DELETE FROM public.chat_zalo_conversation_system_tag
            WHERE chat_zalo_conversation_id=v_conversation_id AND organization_id=p_organization_id AND auto_contact_tag_id=ANY(v_tags);
        END IF;
        GET DIAGNOSTICS v_changed=ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('aka_agent.chat_tag_batch',COALESCE(v_previous_batch,''),true);
        RAISE;
      END;
      PERFORM set_config('aka_agent.chat_tag_batch',COALESCE(v_previous_batch,''),true);
      IF v_changed>0 AND v_conversation_type='user' THEN
        PERFORM public.aka_agent_enqueue_data_group_chat_user(v_chat_account_id,v_zalo_uid,p_organization_id);
      END IF;
      PERFORM public.aka_agent_refresh_contact_chat_tags(v_contact.id);
    ELSE
      UPDATE public.auto_account_contacts SET akabiz_tag_ids=ARRAY(
        SELECT DISTINCT k FROM unnest(COALESCE(akabiz_tag_ids,'{}'::bigint[])||CASE WHEN p_mode='add' THEN v_tags ELSE '{}'::bigint[] END) k
        WHERE p_mode='add' OR NOT k=ANY(v_tags) ORDER BY k
      ),updated_at=clock_timestamp()
      WHERE id=v_contact.id AND NOT is_delete AND CASE WHEN p_mode='add'
        THEN NOT COALESCE(akabiz_tag_ids,'{}'::bigint[]) @> v_tags
        ELSE COALESCE(akabiz_tag_ids,'{}'::bigint[]) && v_tags END;
      GET DIAGNOSTICS v_changed=ROW_COUNT;
    END IF;
    IF v_changed>0 THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success',true,'count',v_count);
END;
$function$
;
DROP FUNCTION public.aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text);
COMMIT;
