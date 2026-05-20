-- Store the hourly rate-limit window per account.
-- Campaigns copy this value into extra_settings.actionLimits when saved.

alter table public.auto_accounts
  add column if not exists rate_limit_minutes integer default 65;

alter table public.auto_accounts
  alter column rate_limit_minutes set default 65;

update public.auto_accounts
set rate_limit_minutes = 65
where rate_limit_minutes is null
  or rate_limit_minutes = 60;

comment on column public.auto_accounts.rate_limit_minutes is
  'Số phút dùng làm khung check giới hạn giờ khi tạo/cập nhật campaign; fallback app = 65.';
