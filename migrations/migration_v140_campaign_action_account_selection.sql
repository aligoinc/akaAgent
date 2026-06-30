-- Configure whether each campaign action can create campaigns for multiple accounts.

BEGIN;

ALTER TABLE public.auto_campaign_actions
  ADD COLUMN IF NOT EXISTS allow_multiple_accounts boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.auto_campaign_actions.allow_multiple_accounts IS
  'Whether this campaign action allows selecting multiple accounts when creating a campaign.';

UPDATE public.auto_campaign_actions
SET allow_multiple_accounts = true
WHERE id IN (
  'facebook_group_post',
  'facebook_timeline_post',
  'facebook_page_post',
  'facebook_message_friend',
  'facebook_message_uid',
  'facebook_find_data_group',
  'facebook_find_data_search',
  'facebook_comment_seeding',
  'facebook_comment_seeding_post',
  'facebook_newsfeed_interaction',
  'facebook_join_group',
  'email_send',
  'zalo_message_phone',
  'zalo_message_friend_recommendation'
);

NOTIFY pgrst, 'reload schema';

COMMIT;
