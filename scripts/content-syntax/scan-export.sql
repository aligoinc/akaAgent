-- Xuất CHỈ ĐỌC các ô nội dung có khả năng lỗi cú pháp, để chạy qua scripts/content-syntax/scan-prod.cjs.
-- Lọc thô trong SQL (bỏ biến hợp lệ và nhóm ngoặc cân rồi xem còn dấu ngoặc / "#{" không), bộ kiểm thật quyết định sau.
--   supabase db query --linked -f scripts/content-syntax/scan-export.sql -o json > <tệp ngoài repo>.json
--   node scripts/content-syntax/scan-prod.cjs <tệp>.json
begin read only;
set local statement_timeout = '60s';
with fields as (
  select c.id, c.organization_id, c.action_id, c.status, 'content' as field, c.content as txt
  from auto_campaigns c where c.is_delete = false and c.content ~ '[{}]'
  union all
  select c.id, c.organization_id, c.action_id, c.status, k.key, c.extra_settings->>k.key
  from auto_campaigns c
  cross join (values ('friendRequestMessage'),('emailSubject'),('internalSmsContent'),('externalSmsContent'),('commentContent'),('postBumpContent'),('newsfeedCommentContent'),('zaloAliasTemplate')) k(key)
  where c.is_delete = false and c.extra_settings->>k.key ~ '[{}]'
  union all
  select c.id, c.organization_id, c.action_id, c.status, 'advancedContentItems[' || (i.ord - 1) || '].content', i.item->>'content'
  from auto_campaigns c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.extra_settings->'advancedContentItems') = 'array' then c.extra_settings->'advancedContentItems' else '[]'::jsonb end) with ordinality i(item, ord)
  where c.is_delete = false and i.item->>'content' ~ '[{}]'
  union all
  select -t.id, t.organization_id, 'template', '', 'template.content', t.content
  from auto_content_templates t where coalesce(t.is_delete, false) = false and t.content ~ '[{}]'
), stripped as (
  select f.*,
    regexp_replace(f.txt, '#\{(FULL_NAME|ORIGINAL_NAME|INPUT_FULLNAME|UID|PHONE|MOBILE|EMAIL|INFO[1-5]|STOP_MESSAGES_LINK)\}|#\{(TODAY|TOMORROW|YESTERDAY)\([^{}\n]*\)\}|#\{SEX\{[^{}|\n]*\}\}', '', 'g') as no_tokens
  from fields f
)
select json_agg(json_build_object('id', id, 'org', organization_id, 'action', action_id, 'status', status, 'field', field, 'txt', txt)) as rows
from stripped
where no_tokens like '%#{%'
   or regexp_replace(regexp_replace(regexp_replace(no_tokens, '\{[^{}]*\}', '', 'g'), '\{[^{}]*\}', '', 'g'), '\{[^{}]*\}', '', 'g') ~ '[{}]';
rollback;
