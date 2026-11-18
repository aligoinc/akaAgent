-- Đợt 0 của phương án docs/FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md: câu phát hiện "ca lỗi" của engine v2 Facebook, CHỈ ĐỌC.
-- Chạy: supabase db query --linked -f scripts/engine-v2-facebook/error-watch-dryrun.sql -o json
-- Đây là bản thử để xem bộ tạo việc sẽ sinh những việc nào; hàm thật (migration) viết sau khi anh duyệt.
-- Chỉ đọc auto_engine_outcomes / auto_engine_target_runs theo created_at / started_at (có chỉ mục) và auto_outcome_unmatched.
begin read only;
set local statement_timeout = '45s';
with params as (
  select now() - interval '7 days' as since,
         -- Mã đã có kết luận (bản rà 17/11, bảng duyệt mã FB): chỉ thành việc khi tăng bất thường.
         array['err_fb_group_composer_editor_not_found',   -- FB40 không thấy ô đăng bài (giữ như bộ cũ)
               'err_group_post_frequency_limit',           -- FB02 Facebook giới hạn tần suất
               'err_fb_group_cannot_post_not_member',      -- FB11 chưa vào nhóm
               'err_fb_group_cannot_post_unavailable',     -- FB14 nhóm không còn
               'err_fb_add_friend_unavailable',            -- FB22 nút kết bạn ẩn
               'err_fb_page_inbox_customer_not_found',     -- FB23
               'err_fb_page_inbox_wrong_conversation',     -- FB24
               'err_engine_fb_no_history',                 -- FB45 bước không ghi lịch sử, theo thiết kế
               'err_engine_cancelled'                      -- RUN01 khách dừng
         ]::text[] as known
), fbo as materialized (
  select o.result_key, o.target_run_id, o.campaign_id, o.account_id, o.action_code, o.phase, o.error_code, o.created_at,
         c.organization_id,
         o.decision->'result'->>'publicCode' as public_code,
         (r.final_response->'campaign'->>'effect' = 'pause') as campaign_paused,
         r.staff_id,
         o.signal->>'kind' as signal_kind,
         (o.signal ? 'screenshotId') as has_screenshot,
         regexp_replace(split_part(o.result_key, ':', 3), '#[0-9]+$', '') as step,
         left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(o.signal->>'message', ''),
           -- "Đăng bài thất bại vào <tên nhóm>: …", "Lỗi nhắn tin … đến <tên người>: …" → bỏ tên riêng
           '^((?:Đăng bài thất bại|Lỗi [^:]{1,60}?) (?:vào|đến)) [^:]{1,200}: ', '\1 *: '),
           'facebook\.com/(groups|profile\.php\?id=|permalink|posts)/?[^ ''"|)]*', 'facebook.com/\1/*', 'g'),
           '"[^"]{1,250}"', '"…"', 'g'),
           '[0-9a-f]{16,}', '#', 'g'),
           '[0-9]+', '#', 'g'),
           '\s+', ' ', 'g'), 160) as norm_message
    from public.auto_engine_outcomes o
    left join public.auto_engine_target_runs r on r.id = o.target_run_id
    join public.auto_campaigns c on c.id = o.campaign_id
    join public.auto_campaign_actions a on a.id = c.action_id
   where o.created_at > (select since from params) and a.flatform_type = 'facebook' and not o.ok
), cases as (
  -- Mã chưa có kết luận: mỗi (mã, thao tác, bước, câu lỗi đã chuẩn hoá) là một ca.
  select 'ca_chua_ket_luan' as loai,
         f.error_code || '|' || f.action_code || '|' || f.step || '|' || f.norm_message as khoa,
         min(f.public_code) ma, f.action_code thao_tac, f.step buoc, f.norm_message cau_loi,
         count(*) so_luot, count(distinct f.campaign_id) so_chien_dich, count(distinct f.account_id) so_tai_khoan,
         count(distinct f.organization_id) so_to_chuc,
         count(distinct f.target_run_id) filter (where f.campaign_paused) so_lan_dung_chien_dich,
         count(distinct f.staff_id) so_nhan_vien,
         count(*) filter (where f.has_screenshot) so_luot_co_anh,
         min(f.created_at) lan_dau, max(f.created_at) lan_cuoi,
         (array_agg(f.target_run_id order by f.created_at desc))[1:5] luot_mau
    from fbo f
   where not exists (select 1 from params p where f.error_code = any (p.known))
   group by f.error_code, f.action_code, f.step, f.norm_message
), known_hourly as (
  -- Mã đã có kết luận: đếm theo giờ để xét tăng bất thường (cần ≥ 7 ngày dữ liệu mới có mức nền).
  select h.error_code, min(h.ma) ma, h.action_code, sum(h.n) tong, max(h.n) gio_cao_nhat, round(avg(h.n), 1) tb_moi_gio_co_loi,
         count(*) so_gio_co_loi
    from (select f.error_code, f.action_code, min(f.public_code) ma, date_trunc('hour', f.created_at) g, count(*) n
            from fbo f where exists (select 1 from params p where f.error_code = any (p.known)) group by 1, 2, 4) h
   group by h.error_code, h.action_code
), stale as (
  select coalesce(r.close_reason, 'con_mo') ly_do, a.id as loai_chien_dich, r.final_error_code,
         count(*) so_luot, count(distinct r.staff_id) so_nhan_vien,
         count(*) filter (where p.last_seen_at > r.started_at + interval '15 minutes') may_van_mo_sau_15_phut,
         (array_agg(r.id order by r.started_at desc))[1:5] luot_mau
    from public.auto_engine_target_runs r
    join public.auto_campaigns c on c.id = r.campaign_id
    join public.auto_campaign_actions a on a.id = c.action_id
    left join lateral (select max(d.last_seen_at) last_seen_at from public.auto_staff_device_presence d where d.staff_id = r.staff_id) p on true
   where r.started_at > (select since from params) and a.flatform_type = 'facebook'
     and (r.close_reason = 'stale' or (r.completed_at is null and r.started_at < now() - interval '30 minutes'))
   group by 1, 2, 3
), unmatched as (
  select u.action_code, u.phase, u.signal_kind, u.fallback_error_code, u.hit_count, u.first_seen_at, u.last_seen_at, left(u.pattern_key, 140) mau
    from public.auto_outcome_unmatched u where u.platform = 'facebook' and u.last_seen_at > (select since from params)
)
select json_build_object(
  'khoang', (select json_build_object('tu', min(created_at), 'den', max(created_at), 'so_ket_qua_loi', count(*)) from fbo),
  'ca_chua_ket_luan', (select json_agg(c order by c.so_luot desc) from cases c),
  'ma_da_biet', (select json_agg(k order by k.tong desc) from known_hourly k),
  'luot_bo_do', (select json_agg(s) from stale s),
  'mau_la', (select json_agg(u order by u.hit_count desc) from unmatched u)
)::text as out;
rollback;
