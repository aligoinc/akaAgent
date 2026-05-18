ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS daily_stop_time time without time zone;

COMMENT ON COLUMN public.auto_campaigns.daily_stop_time IS
  'Daily cutoff time in Asia/Ho_Chi_Minh; scheduler skips pending campaigns after this time';
