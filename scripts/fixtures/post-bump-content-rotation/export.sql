-- CHỈ ĐỌC. Xuất dữ liệu up tin Facebook 21 ngày cho scripts/post-bump-content-rotation-replay.cjs.
-- supabase db query --linked --workdir <checkout có link akachat> -f <file này> -o json > <ngoài repo>/post-bump.json
-- Kết quả có nội dung comment của khách: không đưa vào repo.
begin read only;
set local statement_timeout = '110s';
with src as materialized (
  select c.id, c.staff_id, c.is_delete, c.created_at,
    jsonb_build_object(
      'postBumpMode', c.extra_settings->'postBumpMode', 'postBumpCount', c.extra_settings->'postBumpCount',
      'postBumpAccountIds', c.extra_settings->'postBumpAccountIds', 'postBumpTargetCampaignIds', c.extra_settings->'postBumpTargetCampaignIds',
      'postBumpCreatedCampaignIdsByAccount', c.extra_settings->'postBumpCreatedCampaignIdsByAccount',
      'postBumpRotationIndex', c.extra_settings->'postBumpRotationIndex', 'postBumpContent', c.extra_settings->'postBumpContent',
      'enablePostBump', c.extra_settings->'enablePostBump') ex
  from auto_campaigns c where c.action_id='facebook_group_post' and (c.extra_settings->>'enablePostBump')='true'
), tid as materialized (
  select distinct x::bigint id from (
    select (m.value)::text x from src cross join lateral jsonb_each(case when jsonb_typeof(src.ex->'postBumpCreatedCampaignIdsByAccount')='object' then src.ex->'postBumpCreatedCampaignIdsByAccount' else '{}'::jsonb end) m
    union all
    select v::text from src cross join lateral jsonb_array_elements_text(case when jsonb_typeof(src.ex->'postBumpTargetCampaignIds')='array' then src.ex->'postBumpTargetCampaignIds' else '[]'::jsonb end) v
  ) z where x ~ '^[0-9]+$'
), tgt as materialized (
  select t.id, t.account_id, t.staff_id, t.is_delete, t.status, t.action_id, t.created_at, t.last_run_at,
    t.extra_settings->>'commentContent' comment_content, (t.extra_settings->>'advancedContentEnabled')='true' advanced,
    case when jsonb_typeof(t.extra_settings->'advancedContentItems')='array' then jsonb_array_length(t.extra_settings->'advancedContentItems') end advanced_items,
    t.content_rotation_indexes rot
  from tid join auto_campaigns t on t.id=tid.id
), act as materialized (select id from tgt where last_run_at > now() - interval '21 days' or created_at > now() - interval '21 days'),
inp as materialized (
  select i.id, i.campaign_id, i.uid, i.created_at, i.schedule, i.status, i.is_delete, i.note, i.content_rotation_indexes rot,
    i.canonical_target_key is not null has_canonical
  from act cross join lateral (select * from auto_campaign_input_data i where i.campaign_id=act.id and i.created_at > now()-interval '21 days') i
), det as materialized (
  select d.id, d.campaign_id, d.input_data_id, d.status, d.created_at, d.data->>'commentContent' cc, (d.data->>'commentFailed')='true' failed
  from act cross join lateral (
    select * from auto_campaign_details d where d.campaign_id=act.id and d.is_delete=false and d.action_code='fb_comment'
      and d.created_at > now()-interval '21 days') d
)
select json_build_object(
  'exported_at', clock_timestamp(),
  'sources', (select json_agg(src) from src),
  'targets', (select json_agg(tgt) from tgt),
  'inputs', (select json_agg(inp) from inp),
  'details', (select json_agg(det) from det)
);
rollback;
