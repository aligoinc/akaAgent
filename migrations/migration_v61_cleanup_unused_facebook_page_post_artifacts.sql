-- Cleanup unused Facebook page posting artifacts after the main campaign workflow
-- was unified into facebook_page_post.

DELETE FROM public.auto_workflows w
WHERE w.name IN (
  '[Test] Facebook - Đăng bài fanpage qua Graph API',
  'facebook_page_post_api'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.auto_campaign_actions ca
  WHERE ca.workflow_id = w.id
);

DELETE FROM public.auto_blocks b
WHERE b.name IN (
  'fb_test_page_post_graph',
  'fb_page_post_ui'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.auto_workflows w
  WHERE w.nodes::text LIKE '%' || b.name || '%'
);
