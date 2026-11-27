begin;
set local statement_timeout = '60s';
set local lock_timeout = '3s';

-- 1) Dấu giữ lượt cũ (đúng điều kiện V527 của aka_agent_engine_claim_target_v1) trên chiến dịch của tài khoản Zalo Server.
create temp table fix_camp on commit drop as
  select c.id, c.account_id, c.organization_id, c.staff_id, c.status, c.is_delete, c.runtime_claim_token,
         c.runtime_claim_target, c.runtime_claim_vietnam_date, c.runtime_claimed_at, c.updated_at
    from public.auto_campaigns c where false;
with t as (
  select c.id, c.account_id, c.organization_id, c.staff_id, c.status, c.is_delete, c.runtime_claim_token,
         c.runtime_claim_target, c.runtime_claim_vietnam_date, c.runtime_claimed_at, c.updated_at
    from public.auto_campaigns c
    join public.auto_accounts a on a.id = c.account_id
   where c.runtime_claim_token is not null
     and c.runtime_unit_token is null
     and c.runtime_claim_target = 'server'
     and (coalesce(c.is_delete, false) or c.status = 'tạm dừng')
     and coalesce(c.runtime_claimed_at, '-infinity'::timestamptz) < clock_timestamp() - interval '30 minutes'
     and coalesce(c.updated_at, '-infinity'::timestamptz) < clock_timestamp() - interval '30 minutes'
     and not exists (select 1 from public.auto_campaign_input_data d
                      where d.campaign_id = c.id and d.status = 'đang chạy' and coalesce(d.is_delete, false) = false)
     and coalesce(a.is_delete, false) = false
     and lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' and coalesce(a.is_zalo_server, false) and not coalesce(a.is_zalo_show_web, false)
   for update of c skip locked
), u as (
  update public.auto_campaigns c
     set runtime_claim_token = null, runtime_claim_target = null, runtime_claim_vietnam_date = null, runtime_claimed_at = null
    from t
   where c.id = t.id
     and c.runtime_claim_token = t.runtime_claim_token
     and c.runtime_unit_token is null
  returning c.id
)
insert into fix_camp select t.* from t join u on u.id = t.id;

-- 2) Khoá tài khoản Zalo Server "đang chạy" mà không có gì giữ (không lease, không lượt mở, không token thao tác).
create temp table fix_acc on commit drop as
  select a.id, a.organization_id, a.staff_id, a.name, a.status, a.login_status, a.updated_at from public.auto_accounts a where false;
do $do$
declare r record;
begin
  for r in
    select a.id, a.organization_id, a.staff_id, a.name, a.status, a.login_status, a.updated_at
      from public.auto_accounts a
     where a.status = 'đang chạy' and a.runtime_operation_claim_token is null and coalesce(a.is_delete, false) = false
       and lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' and coalesce(a.is_zalo_server, false) and not coalesce(a.is_zalo_show_web, false)
       and not exists (select 1 from public.auto_engine_leases l where l.account_id = a.id)
       and not exists (select 1 from public.auto_engine_target_runs tr where tr.account_id = a.id and tr.completed_at is null)
     for update of a skip locked
  loop
    insert into fix_acc values (r.id, r.organization_id, r.staff_id, r.name, r.status, r.login_status, r.updated_at);
  end loop;
end
$do$;

-- 3) Câu riêng (ảnh dữ liệu mới, như release_v1): trả về "chờ xử lý" khi không chiến dịch nào còn token, không chiến dịch sống nào
--    "đang chạy", không lease, không lượt mở.
create temp table fix_acc_done on commit drop as select a.id from public.auto_accounts a where false;
with u as (
  update public.auto_accounts a set status = 'chờ xử lý', updated_at = clock_timestamp()
    from fix_acc f
   where a.id = f.id and a.status = 'đang chạy' and a.runtime_operation_claim_token is null
     and not exists (select 1 from public.auto_campaigns x where x.account_id = a.id
                      and (x.runtime_claim_token is not null or x.runtime_unit_token is not null))
     and not exists (select 1 from public.auto_campaigns x where x.account_id = a.id and x.status = 'đang chạy'
                      and coalesce(x.is_delete, false) = false)
     and not exists (select 1 from public.auto_engine_leases l where l.account_id = a.id)
     and not exists (select 1 from public.auto_engine_target_runs tr where tr.account_id = a.id and tr.completed_at is null)
  returning a.id
)
insert into fix_acc_done select id from u;

select json_build_object(
  'mode', 'commit',
  'at_vn', to_char(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS'),
  'txid', pg_current_xact_id()::text,
  'campaigns_cleared', (select count(*) from fix_camp),
  'campaign_accounts', (select count(distinct account_id) from fix_camp),
  'campaign_orgs', (select count(distinct organization_id) from fix_camp),
  'campaigns_by_state', (select json_object_agg(k, n) from (select (case when coalesce(is_delete, false) then 'deleted' else 'not_deleted' end) || '/' || status as k, count(*) as n from fix_camp group by 1) q),
  'accounts_locked', (select count(*) from fix_acc),
  'accounts_reset', (select count(*) from fix_acc_done),
  'accounts_reset_orgs', (select count(distinct f.organization_id) from fix_acc f join fix_acc_done d on d.id = f.id),
  'accounts_locked_not_reset', (select json_agg(f.id order by f.id) from fix_acc f where f.id not in (select id from fix_acc_done)),
  'reset_with_due', (select count(*) from fix_acc_done d where exists (select 1 from public.auto_campaigns x where x.account_id = d.id
                       and coalesce(x.is_delete, false) = false and x.status = 'chờ xử lý' and (x.schedule is null or x.schedule <= now()))),
  'customer_8672_9854', (select json_agg(json_build_object('id', a.id, 'status', a.status) order by a.id) from public.auto_accounts a where a.id in (8672, 9854)),
  'campaigns', (select json_agg(row_to_json(f) order by f.id) from fix_camp f),
  'accounts', (select json_agg(row_to_json(f) order by f.id) from fix_acc f join fix_acc_done d on d.id = f.id)
);
commit;
