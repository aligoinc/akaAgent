CREATE OR REPLACE FUNCTION private.aka_agent_notification_seed_defaults(p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_cfg jsonb; v_audience text; v_orgs bigint[] := '{}'; v_batch integer; r record;
  v_email_max integer := 0; v_sources text[] := array['profile', 'crm']; v_room integer := 0;
  v_full integer := 0; v_morning integer := 0; v_email integer := 0;
  v_days constant smallint[] := array[1, 2, 3, 4, 5, 6, 7]::smallint[];
  v_time constant time[] := array['07:00'::time];
  v_tz constant text := 'Asia/Ho_Chi_Minh';
begin
  begin
    v_cfg := private.aka_agent_notification_setting('notifications.default_reports', '{"audience":"off"}')::jsonb;
    if jsonb_typeof(v_cfg) <> 'object' then return jsonb_build_object('audience', 'off', 'error', 'invalid_setting'); end if;
    v_audience := coalesce(v_cfg ->> 'audience', 'off');
    if jsonb_typeof(v_cfg -> 'organizationIds') = 'array' then
      v_orgs := array(select (x #>> '{}')::bigint from jsonb_array_elements(v_cfg -> 'organizationIds') x where (x #>> '{}') ~ '^[0-9]{1,18}$');
    end if;
    v_batch := least(greatest(coalesce((v_cfg ->> 'batch')::integer, 200), 1), 1000);
    if (v_cfg ->> 'emailMax') ~ '^[0-9]{1,6}$' then v_email_max := (v_cfg ->> 'emailMax')::integer; end if;
    if jsonb_typeof(v_cfg -> 'emailSources') = 'array' then
      v_sources := array(select x #>> '{}' from jsonb_array_elements(v_cfg -> 'emailSources') x where (x #>> '{}') in ('profile', 'crm'));
    end if;
  exception when others then
    return jsonb_build_object('audience', 'off', 'error', 'invalid_setting');
  end;
  if v_audience not in ('admin_akabiz', 'orgs', 'all') then return jsonb_build_object('audience', 'off'); end if;

  perform set_config('aka.notification_center_write', 'on', true);

  for r in
    select st.id, st.organization_id
      from public.org_staff st
     where st.is_active is true and st.deleted_at is null and st.organization_id is not null
       and (v_audience = 'all' or (v_audience = 'admin_akabiz' and st.is_admin_akabiz is true)
            or (v_audience = 'orgs' and st.organization_id = any (v_orgs)))
       and not exists (select 1 from public.auto_email_notification_settings e where e.staff_id = st.id)
       and public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
     order by st.id
     limit v_batch
  loop
    insert into public.auto_email_notification_settings (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed,
           daily_report_enabled, is_delete, push_enabled, revision, settings_version, timezone, verified_emails, updated_by_client, updated_at)
    values (r.id, r.organization_id, false, '{}'::text[], false, false, false, true, 1, 2, v_tz, '{}'::text[], 'default_seed', p_now)
    on conflict (staff_id) do nothing;
    if not found then continue; end if;
    insert into public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
           filters, schedule_week_days, schedule_times, next_run_at)
    values (r.id, r.organization_id, 'report.morning', true, false, true, '{"skipWhenIdle":false}'::jsonb, v_days, v_time,
            private.aka_agent_notification_next_run(v_days, v_time, v_tz, p_now))
    on conflict (staff_id, event_type, scope) do nothing;
    v_full := v_full + 1;
  end loop;

  for r in
    select e.staff_id, st.organization_id, e.is_enabled and cardinality(e.recipient_emails) > 0 as has_email, e.timezone
      from public.auto_email_notification_settings e
      join public.org_staff st on st.id = e.staff_id
     where e.is_delete is not true and st.is_active is true and st.deleted_at is null and st.organization_id is not null
       and (v_audience = 'all' or (v_audience = 'admin_akabiz' and st.is_admin_akabiz is true)
            or (v_audience = 'orgs' and st.organization_id = any (v_orgs)))
       and not exists (select 1 from public.auto_notification_subscriptions s
                        where s.staff_id = e.staff_id and s.event_type = 'report.morning' and s.scope = 'own')
       and public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
     order by e.staff_id
     limit v_batch
  loop
    insert into public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
           filters, schedule_week_days, schedule_times, next_run_at)
    values (r.staff_id, r.organization_id, 'report.morning', true, r.has_email, true, '{"skipWhenIdle":false}'::jsonb, v_days, v_time,
            private.aka_agent_notification_next_run(v_days, v_time,
              coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = btrim(r.timezone)), v_tz), p_now))
    on conflict (staff_id, event_type, scope) do nothing;
    if found then v_morning := v_morning + 1; end if;
  end loop;

  if v_email_max > 0 and cardinality(v_sources) > 0 then
    select v_email_max - count(*) into v_room
      from public.auto_email_notification_settings e
     where e.auto_email_filled_at is not null and e.is_delete is not true and cardinality(e.recipient_emails) > 0;
    if v_room > 0 then
      for r in
        select e.staff_id, c.email
          from public.auto_email_notification_settings e
          join public.org_staff st on st.id = e.staff_id
          join private.aka_agent_notification_email_candidates() c on c.staff_id = e.staff_id
         where e.is_delete is not true and e.auto_email_filled_at is null and cardinality(e.recipient_emails) = 0
           and st.is_active is true and st.deleted_at is null and st.organization_id is not null
           and (v_audience = 'all' or (v_audience = 'admin_akabiz' and st.is_admin_akabiz is true)
                or (v_audience = 'orgs' and st.organization_id = any (v_orgs)))
           and c.source = any (v_sources)
           and (c.source = 'profile' or not exists (
                 select 1 from public.auto_email_notification_settings o
                  where o.staff_id <> e.staff_id and o.is_delete is not true and c.email = any (o.recipient_emails)))
           and public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
         order by (c.source <> 'profile'), e.staff_id
         limit least(v_batch, v_room)
      loop
        update public.auto_email_notification_settings
           set is_enabled = true, recipient_emails = array[r.email], verified_emails = array[r.email],
               auto_email_filled_at = p_now, revision = revision + 1, updated_at = p_now
         where staff_id = r.staff_id and auto_email_filled_at is null and cardinality(recipient_emails) = 0 and is_delete is not true;
        if not found then continue; end if;
        update public.auto_notification_subscriptions set email_enabled = true, updated_at = p_now
         where staff_id = r.staff_id and scope = 'own' and event_type = 'report.morning' and is_enabled;
        v_email := v_email + 1;
      end loop;
    end if;
  end if;

  perform set_config('aka.notification_center_write', '', true);
  return jsonb_build_object('audience', v_audience, 'seeded', v_full, 'morningAdded', v_morning, 'emailAdded', v_email,
                            'emailRoom', greatest(v_room - v_email, 0));
end
$function$;
