-- Configure which account action codes each campaign action should check
-- before running. Actual action counters are still incremented from
-- auto_campaign_details.action_code after a milestone is logged.

alter table public.auto_campaign_actions
  add column if not exists limit_check_action_codes text[] not null default '{}';

comment on column public.auto_campaign_actions.limit_check_action_codes is
  'auto_account_actions.code values to check for rate limit/disable before running this campaign action.';

update public.auto_campaign_actions
set limit_check_action_codes = array['fb_post_group']
where id = 'facebook_group_post';

update public.auto_campaign_actions
set limit_check_action_codes = array['fb_post_my_profile']
where id = 'facebook_timeline_post';

update public.auto_campaign_actions
set limit_check_action_codes = array['fb_comment']
where id = 'facebook_comment_seeding';

update public.auto_campaign_actions
set limit_check_action_codes = array['fb_message_friend', 'fb_add_friend']
where id = 'facebook_message_friend';

update public.auto_campaign_actions
set limit_check_action_codes = '{}'
where id = 'facebook_find_data_group';
