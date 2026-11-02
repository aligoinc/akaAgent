-- Business rows and credentials stay in server memory. No business writes.
DO $smoke$
DECLARE a record; credentials record; q jsonb; page jsonb; legacy_rows jsonb; history_day date;
BEGIN
 SELECT account.id,account.staff_id,account.organization_id INTO STRICT a
 FROM public.auto_accounts account JOIN public.org_staff s ON s.id=account.staff_id
 WHERE account.id=1174 AND NOT account.is_delete AND s.is_active AND s.deleted_at IS NULL;
 SELECT username,password INTO STRICT credentials FROM public.org_staff WHERE id=a.staff_id;
 SELECT jsonb_build_object('accountId',a.id,'contactType','person','ids',jsonb_agg(id),'limit',5,'columnFilters',jsonb_build_object('version',1,'filters','[]'::jsonb)) INTO q
 FROM (SELECT id FROM public.auto_account_contacts WHERE account_id=a.id AND staff_id=a.staff_id AND NOT is_delete AND contact_type='person' ORDER BY id LIMIT 5) sample;
 PERFORM set_config('zalo_names.scope',to_jsonb(a)::text,true);
 PERFORM set_config('zalo_names.contacts_query',q::text,true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SET LOCAL ROLE service_role;
 page:=public.aka_agent_read_filtered_contacts_v1(a.staff_id,a.organization_id,credentials.username,credentials.password,'contacts',q);
 IF (page->>'total')::int<>5 THEN RAISE EXCEPTION 'Expected five contact samples'; END IF;
 SELECT COALESCE(jsonb_agg(value-'zalo_original_name' ORDER BY n),'[]') INTO legacy_rows FROM jsonb_array_elements(page->'rows') WITH ORDINALITY t(value,n);
 PERFORM set_config('zalo_names.contacts_before',jsonb_set(page,'{rows}',legacy_rows)::text,true);
 RESET ROLE;
 SELECT (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date INTO history_day FROM public.auto_campaign_details
 WHERE account_id=a.id AND NOT is_delete AND action_code IN ('zalo_message_stranger','zalo_message_friend') ORDER BY created_at DESC LIMIT 1;
 q:=jsonb_build_object('accountId',a.id,'limit',5,'dateFrom',COALESCE(history_day,CURRENT_DATE),'dateTo',COALESCE(history_day,CURRENT_DATE),'columnFilters',jsonb_build_object('version',1,'filters','[]'::jsonb));
 PERFORM set_config('zalo_names.remarketing_query',q::text,true);
 SET LOCAL ROLE service_role;
 page:=public.aka_agent_read_filtered_remarketing_v1(a.staff_id,a.organization_id,credentials.username,credentials.password,q);
 SELECT COALESCE(jsonb_agg(value-'zalo_original_name' ORDER BY n),'[]') INTO legacy_rows FROM jsonb_array_elements(page->'rows') WITH ORDINALITY t(value,n);
 PERFORM set_config('zalo_names.remarketing_before',jsonb_set(page,'{rows}',legacy_rows)::text,true);
 RESET ROLE;
END $smoke$;
