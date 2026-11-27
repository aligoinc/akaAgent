-- Kiểm luật V679 trên dữ liệu thật (CHỈ ĐỌC). Thay :start bằng mốc id của auto_campaign_details (cửa sổ 40.000 id ≈ 3 giờ).
-- Biểu thức chuẩn hoá UID và điều kiện "gửi được / tài khoản khác" chép đúng từ private.aka_agent_uid_guard_norm và
-- private.aka_agent_campaign_uid_account_classify; danh sách tài khoản cùng nick gọi thẳng hàm production V657.
-- R1: lượt gửi THÀNH CÔNG thật ⇒ luật phải nói "gửi được" hoặc "không rõ", không bao giờ "chặn".
-- R2: lượt DAT04 / Zalo 114 thật ở chiến dịch theo UID ⇒ đếm bao nhiêu luật bắt được (DAT04 phải gần 100%).
begin read only;
set local statement_timeout = '50s';
with w as materialized (
  select d.id, d.account_id, d.input_data_id, d.campaign_id, d.status, d.action_code,
         coalesce(d.data->'zalo'->>'code', d.data->>'zaloCode', '') zcode, coalesce(d.policy_snapshot->'v2'->>'errorCode', '') ecode
    from public.auto_campaign_details d
   where d.id between :start and :start + 40000
     and d.action_code in ('zalo_message_stranger', 'zalo_add_friend', 'zalo_message_friend')
     and d.input_data_id is not null
), j as materialized (
  select w.*, c.action_id, a.organization_id org, i.uid
    from w
    join public.auto_campaigns c on c.id = w.campaign_id
    join public.auto_accounts a on a.id = w.account_id
    join public.auto_campaign_input_data i on i.id = w.input_data_id
   where c.action_id in ('zalo_message_group_member', 'zalo_message_friend', 'zalo_message_remarketing_customer', 'zalo_cancel_sent_friend_request')
     and coalesce(c.data_target_source_mode, 'direct') = 'direct'
), n as materialized (
  select j.*, x.u, private.aka_agent_zalo_same_nick_accounts(j.account_id) nick
    from j cross join lateral (
      select nullif(regexp_replace(regexp_replace(coalesce(j.uid, ''), E'[\\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g'), '_0$', ''), '') u) x
), k as (
  select n.*,
         exists (select 1 from public.zalo_users z where z.account_id = any (n.nick) and z.zalo_uid in (n.u, n.u || '_0')) own,
         exists (select 1 from public.zalo_users z join public.auto_accounts oa on oa.id = z.account_id and oa.organization_id = n.org
                  where z.zalo_uid in (n.u, n.u || '_0') and not (z.account_id = any (n.nick))) other
    from n where n.u is not null
)
select case when status = 'thành công' then 'R1_success'
            when ecode = 'err_engine_zalo_uid_other_account' then 'R2_dat04'
            when zcode = '114' or ecode = 'err_zalo_invalid_param' then 'R2_z114'
            else 'other_fail' end kind,
       action_id, count(*) n,
       count(*) filter (where own) own, count(*) filter (where not own and other) blocked, count(*) filter (where not own and not other) unknown,
       (array_agg(id) filter (where not own and other))[1:5] sample_blocked_ids,
       (array_agg(id) filter (where not own and not other))[1:3] sample_unknown_ids
  from k group by 1, 2 order by 1, 2;
rollback;
