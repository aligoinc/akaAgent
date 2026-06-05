-- Structured run-event logs for campaign workflow execution.
-- The find-data group instrumentation is applied to test_workflow_id only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_campaign_run_events (
  id bigserial PRIMARY KEY,
  campaign_id bigint NULL,
  campaign_action_id text NULL,
  campaign_input_id bigint NULL,
  campaign_input_data_id bigint NULL,
  account_id bigint NULL,
  run_id bigint NULL,
  run_step_id bigint NULL,
  node_id text NULL,
  block_id bigint NULL,
  block_name text NULL,
  sequence_no integer NULL,
  event_type text NOT NULL DEFAULT 'info',
  event_name text NULL,
  target_type text NULL,
  status text NULL DEFAULT 'info',
  is_user_visible boolean NOT NULL DEFAULT false,
  xpath text NULL,
  css_selector text NULL,
  element_count integer NULL,
  item_index integer NULL,
  target_url text NULL,
  message text NULL,
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  debug_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auto_campaign_run_events IS
  'Structured per-run event log emitted by workflow block helpers. Designed for user-visible timeline and debug traces.';

COMMENT ON COLUMN public.auto_campaign_run_events.is_user_visible IS
  'true = event is useful for customer-facing progress; false = technical/debug trace.';

COMMENT ON COLUMN public.auto_campaign_run_events.status IS
  'Result status for the event, usually success/skipped/failed. Info is not used as a status.';

ALTER TABLE public.auto_campaign_run_events
  ALTER COLUMN status DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_run_events_campaign_id_fkey') THEN
    ALTER TABLE public.auto_campaign_run_events
      ADD CONSTRAINT auto_campaign_run_events_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.auto_campaigns(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_run_events_campaign_action_id_fkey') THEN
    ALTER TABLE public.auto_campaign_run_events
      ADD CONSTRAINT auto_campaign_run_events_campaign_action_id_fkey
      FOREIGN KEY (campaign_action_id) REFERENCES public.auto_campaign_actions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_run_events_campaign_input_id_fkey') THEN
    ALTER TABLE public.auto_campaign_run_events
      ADD CONSTRAINT auto_campaign_run_events_campaign_input_id_fkey
      FOREIGN KEY (campaign_input_id) REFERENCES public.auto_campaign_inputs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_run_events_campaign_input_data_id_fkey') THEN
    ALTER TABLE public.auto_campaign_run_events
      ADD CONSTRAINT auto_campaign_run_events_campaign_input_data_id_fkey
      FOREIGN KEY (campaign_input_data_id) REFERENCES public.auto_campaign_input_data(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_run_events_account_id_fkey') THEN
    ALTER TABLE public.auto_campaign_run_events
      ADD CONSTRAINT auto_campaign_run_events_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.auto_accounts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_run_events_run_id_fkey') THEN
    ALTER TABLE public.auto_campaign_run_events
      ADD CONSTRAINT auto_campaign_run_events_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES public.auto_runs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_run_events_run_step_id_fkey') THEN
    ALTER TABLE public.auto_campaign_run_events
      ADD CONSTRAINT auto_campaign_run_events_run_step_id_fkey
      FOREIGN KEY (run_step_id) REFERENCES public.auto_run_steps(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_run_events_campaign_time
  ON public.auto_campaign_run_events(campaign_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_campaign_run_events_input_data_time
  ON public.auto_campaign_run_events(campaign_input_data_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_campaign_run_events_run_sequence
  ON public.auto_campaign_run_events(run_id, sequence_no, id);

CREATE INDEX IF NOT EXISTS idx_campaign_run_events_user_visible
  ON public.auto_campaign_run_events(campaign_id, created_at, id)
  WHERE is_user_visible = true;

CREATE INDEX IF NOT EXISTS idx_campaign_run_events_event_type
  ON public.auto_campaign_run_events(event_type);

CREATE INDEX IF NOT EXISTS idx_campaign_run_events_target_type
  ON public.auto_campaign_run_events(target_type);

UPDATE public.auto_elements
SET
  xpath = './/*[@dir=''auto'' and .//*[@dir=''auto'']]',
  description = 'Nội dung comment',
  category = 'facebook',
  is_builtin = true,
  staff_id = NULL,
  organization_id = NULL,
  updated_at = now()
WHERE name = 'fb_content_in_cmt_element';

INSERT INTO public.auto_elements (
  name,
  xpath,
  description,
  category,
  is_builtin,
  staff_id,
  organization_id,
  created_at,
  updated_at
)
SELECT
  'fb_content_in_cmt_element',
  './/*[@dir=''auto'' and .//*[@dir=''auto'']]',
  'Nội dung comment',
  'facebook',
  true,
  NULL,
  NULL,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.auto_elements
  WHERE name = 'fb_content_in_cmt_element'
);

WITH source_action AS (
  SELECT
    ca.id AS action_id,
    wf.name || '__test__' || ca.id AS test_workflow_name,
    wf.description,
    wf.nodes,
    wf.edges,
    wf.variables_schema,
    wf.default_variables,
    wf.staff_id,
    wf.organization_id
  FROM public.auto_campaign_actions ca
  JOIN public.auto_workflows wf ON wf.id = ca.workflow_id
  WHERE ca.id = 'facebook_find_data_group'
    AND ca.workflow_id IS NOT NULL
    AND ca.test_workflow_id IS NULL
    AND ca.is_delete = false
)
INSERT INTO public.auto_workflows (
  name,
  description,
  nodes,
  edges,
  variables_schema,
  default_variables,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
SELECT
  source_action.test_workflow_name,
  source_action.description,
  source_action.nodes,
  source_action.edges,
  source_action.variables_schema,
  source_action.default_variables,
  false,
  source_action.staff_id,
  source_action.organization_id,
  now()
FROM source_action
WHERE NOT EXISTS (
  SELECT 1
  FROM public.auto_workflows existing
  WHERE existing.name = source_action.test_workflow_name
);

WITH source_action AS (
  SELECT
    ca.id AS action_id,
    wf.name || '__test__' || ca.id AS test_workflow_name
  FROM public.auto_campaign_actions ca
  JOIN public.auto_workflows wf ON wf.id = ca.workflow_id
  WHERE ca.id = 'facebook_find_data_group'
    AND ca.workflow_id IS NOT NULL
    AND ca.test_workflow_id IS NULL
    AND ca.is_delete = false
)
UPDATE public.auto_campaign_actions ca
SET test_workflow_id = test_wf.id
FROM source_action
JOIN public.auto_workflows test_wf
  ON test_wf.name = source_action.test_workflow_name
WHERE ca.id = source_action.action_id
  AND ca.test_workflow_id IS NULL;

CREATE TEMP TABLE _find_data_run_event_overrides (
  name text PRIMARY KEY,
  code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _find_data_run_event_overrides(name, code)
SELECT name, replace(code, E'\r\n', E'\n')
FROM public.auto_blocks
WHERE name IN (
  'fb_open_group_discussion',
  'fb_sort_group_posts',
  'fb_collect_group_posts',
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_group_comments',
  'fb_open_group_members',
  'fb_collect_group_members',
  'fb_find_group_data_summary'
);

UPDATE _find_data_run_event_overrides
SET code = replace(
  code,
$old$function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}
function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = String(text || '').toLowerCase();
  return words.some(word => haystack.includes(word));
}
$old$,
$new$function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}
function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}
$new$
)
WHERE name IN ('fb_extract_data_from_group_posts', 'fb_collect_group_comments');

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      code,
$old$function keywordList() {$old$,
$new$function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
function keywordList() {$new$
    ),
$old$.map(x => x.trim().toLowerCase())$old$,
$new$.map(x => normalizeKeywordText(x.trim()))$new$
  ),
$old$const haystack = String(text || '').toLowerCase();$old$,
$new$const haystack = normalizeKeywordText(text);$new$
)
WHERE name IN ('fb_extract_data_from_group_posts', 'fb_collect_group_comments')
  AND position('normalizeKeywordText' in code) = 0;

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      code,
$old$if (!needsFeed) {
  return { groupUrl, skippedFeed: true };
}
$old$,
$new$if (!needsFeed) {
  return { groupUrl, skippedFeed: true };
}
$new$
    ),
$old$await page.navigate(groupUrl);
await helpers.sleep(5000, signal);
$old$,
$new$await page.navigate(groupUrl);
await helpers.sleep(5000, signal);
await helpers.logRunEvent({
  eventType: 'open_group',
  eventName: 'Mở group',
  targetType: 'group',
  status: 'success',
  isUserVisible: false,
  targetUrl: groupUrl,
  message: 'Đã mở group ' + (String(vars.inputDataName || '').trim() || groupUrl)
});
$new$
  ),
$old$    await page.click(discussionTab);
    await helpers.sleep(2000, signal);
$old$,
$new$    await page.click(discussionTab);
    await helpers.logRunEvent({
      eventType: 'open_discussion_tab',
      eventName: 'Mở tab thảo luận',
      targetType: 'group',
      status: 'success',
      isUserVisible: false,
      xpath: discussionTab,
      targetUrl: groupUrl
    });
    await helpers.sleep(2000, signal);
$new$
)
WHERE name = 'fb_open_group_discussion';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      replace(
        code,
$old$if (!needsFeed) return { postSort: String(vars.sortTypePost || input.sortTypePost || 'most_relevant'), skippedFeed: true };
$old$,
$new$if (!needsFeed) {
  const skippedSort = String(vars.sortTypePost || input.sortTypePost || 'most_relevant');
  return { postSort: skippedSort, skippedFeed: true };
}
$new$
      ),
$old$if (sortType === 'most_relevant') return { postSort: sortType };
$old$,
$new$if (sortType === 'most_relevant') {
  await helpers.logRunEvent({
    eventType: 'sort_posts',
    eventName: 'Sắp xếp bài viết',
    targetType: 'feed',
    status: 'success',
    isUserVisible: false,
    message: 'Giữ sắp xếp phù hợp nhất',
    debugData: { sortType }
  });
  return { postSort: sortType };
}
$new$
    ),
$old$      await page.click(option);
      await helpers.sleep(2500, signal);
$old$,
$new$      await page.click(option);
      await helpers.sleep(2500, signal);
      await helpers.logRunEvent({
        eventType: 'sort_posts',
        eventName: 'Sắp xếp bài viết',
        targetType: 'feed',
        status: 'success',
        isUserVisible: false,
        xpath: option,
        message: 'Đã đổi sắp xếp bài viết',
        debugData: { sortType, optionName }
      });
$new$
  ),
$old$} catch (err) {
  helpers.log('Không đổi được sắp xếp bài viết: ' + (err && err.message ? err.message : String(err)));
}
$old$,
$new$} catch (err) {
  const message = err && err.message ? err.message : String(err);
  helpers.log('Không đổi được sắp xếp bài viết: ' + message);
  await helpers.logRunEvent({
    eventType: 'sort_posts',
    eventName: 'Sắp xếp bài viết',
    targetType: 'feed',
    status: 'failed',
    isUserVisible: false,
    message,
    debugData: { sortType }
  });
}
$new$
)
WHERE name = 'fb_sort_group_posts';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      replace(
        code,
$old$const posts = await page.evaluate(`$old$,
$new$const posts = await page.evaluate(`$new$
      ),
$old$  vars.findDataPosts = Array.isArray(posts) ? posts : [];
  helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
  return { posts: vars.findDataPosts };
$old$,
$new$  vars.findDataPosts = Array.isArray(posts) ? posts : [];
  helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
  await helpers.logRunEvent({
    eventType: 'scroll_feed',
    eventName: 'Cuộn feed',
    targetType: 'feed',
    status: 'success',
    isUserVisible: false,
    xpath: selectors.posts,
    message: 'Đã cuộn feed để tải bài viết',
    debugData: { limit, useUidOnlyPostScan: !!useUidOnlyPostScan }
  });
  await helpers.logRunEvent({
    eventType: 'collect_posts',
    eventName: 'Lấy danh sách bài post',
    targetType: 'post',
    status: 'success',
    isUserVisible: true,
    xpath: selectors.posts,
    elementCount: vars.findDataPosts.length,
    message: 'Lấy được ' + vars.findDataPosts.length + ' bài viết trong group',
    debugData: { limit, uidOnlyPostScan: true }
  });
  return { posts: vars.findDataPosts };
$new$
    ),
$old$vars.findDataPosts = Array.isArray(posts) ? posts : [];
helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
return { posts: vars.findDataPosts };
$old$,
$new$vars.findDataPosts = Array.isArray(posts) ? posts : [];
helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
await helpers.logRunEvent({
  eventType: 'scroll_feed',
  eventName: 'Cuộn feed',
  targetType: 'feed',
  status: 'success',
  isUserVisible: false,
  xpath: selectors.posts,
  message: 'Đã cuộn feed để tải bài viết',
  debugData: { limit, collectPostLinks }
});
await helpers.logRunEvent({
  eventType: 'collect_posts',
  eventName: 'Lấy danh sách bài post',
  targetType: 'post',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.posts,
  elementCount: vars.findDataPosts.length,
  message: 'Lấy được ' + vars.findDataPosts.length + ' bài viết trong group',
  debugData: { limit, collectPostLinks }
});
return { posts: vars.findDataPosts };
$new$
  ),
$old$if (!needsFeed) {
  vars.findDataPosts = [];
  return { posts: [], skippedFeed: true };
}
$old$,
$new$if (!needsFeed) {
  vars.findDataPosts = [];
  return { posts: [], skippedFeed: true };
}
$new$
)
WHERE name = 'fb_collect_group_posts';

-- UID-only still needs full post data so run-event logs can show author, content,
-- phones, Zalo links, and the parent post link.
UPDATE _find_data_run_event_overrides
SET code =
  substring(code FROM 1 FOR position($start$const collectPostDetails = vars.isFindInPost === true || vars.isFindPostLink === true;
const useUidOnlyPostScan = vars.isFindNewInteractors === true && collectPostDetails !== true;

$start$ IN code) - 1)
  || $new$const collectPostDetails = vars.isFindInPost === true || vars.isFindPostLink === true;
const useUidOnlyPostScan = vars.isFindNewInteractors === true && collectPostDetails !== true;

$new$
  || substring(code FROM position($marker$const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),$marker$ IN code))
WHERE name = 'fb_collect_group_posts'
  AND position($start$const collectPostDetails = vars.isFindInPost === true || vars.isFindPostLink === true;
const useUidOnlyPostScan = vars.isFindNewInteractors === true && collectPostDetails !== true;

$start$ IN code) > 0
  AND position($marker$const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),$marker$ IN code) > 0;

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    code,
$old$const collectPostLinks = vars.isFindPostLink === true || input.isFindPostLink === true;
$old$,
$new$const collectPostLinks = true;
$new$
  ),
$old$debugData: { limit, collectPostLinks }
$old$,
$new$debugData: { limit, collectPostLinks, useUidOnlyPostScan }
$new$
)
WHERE name = 'fb_collect_group_posts';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      replace(
        code,
$old$  function hrefOf(el) {
    return el ? (el.href || el.getAttribute('href') || '') : '';
  }
$old$,
$new$  function hrefOf(el) {
    return el ? (el.href || el.getAttribute('href') || '') : '';
  }
$new$
      ),
$old$      const authorUrl = hrefOf(authorLink);
      return {
$old$,
$new$      const authorUrl = hrefOf(authorLink);
      const authorName = authorLink ? (authorLink.innerText || authorLink.textContent || '').trim() : '';
      return {
$new$
    ),
$old$    const authorUrl = authorLink ? (authorLink.href || authorLink.getAttribute('href') || '') : '';
    const linkInfo = collectPostLinks ? await resolvePostLink(post) : { rawPostLink: '', postLink: '' };
$old$,
$new$    const authorUrl = authorLink ? (authorLink.href || authorLink.getAttribute('href') || '') : '';
    const authorName = authorLink ? (authorLink.innerText || authorLink.textContent || '').trim() : '';
    const linkInfo = collectPostLinks ? await resolvePostLink(post) : { rawPostLink: '', postLink: '' };
$new$
  ),
$old$      authorUrl,
      authorUid: extractUid(authorUrl),
$old$,
$new$      authorUrl,
      authorName,
      authorUid: extractUid(authorUrl),
$new$
)
WHERE name = 'fb_collect_group_posts';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    code,
$old$    const contentMatches = matchesContent(content);
$old$,
$new$    const contentMatches = matchesContent(content);
    const postAuthorUidForLog = authorUidFromItem(post);
    const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
    const postPhonesForLog = findPhones(content);
    const postZaloLinksForLog = findZaloLinks(content);
    const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];

    if ((vars.isFindInPost || vars.isFindPostLink) && !contentMatches) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: {
            keyword: String(vars.keywords || ''),
            matchedKeyword: false,
            aiPrompt: String(vars.contentAI || '') || null,
            aiResult: null
          },
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }
$new$
  ),
$old$    const newInteractorUid = authorUidFromItem(post);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
$old$,
$new$    const newInteractorUid = authorUidFromItem(post);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
    const shouldLogPostExtract = ((vars.isFindInPost || vars.isFindPostLink) && contentMatches) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    if (shouldLogPostExtract) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'success',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Đã duyệt bài viết' + (post && post.index ? ' #' + post.index : ''),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: {
            keyword: String(vars.keywords || ''),
            matchedKeyword: contentMatches,
            aiPrompt: String(vars.contentAI || '') || null,
            aiResult: null
          },
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''),
          source: vars.isFindNewInteractors ? 'new_interactors_or_post' : 'post'
        }
      });
    }
$new$
)
WHERE name = 'fb_extract_data_from_group_posts';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      code,
$old$const commentItems = await page.evaluate(`$old$,
$new$const commentItems = await page.evaluate(`$new$
    ),
$old$vars.findDataComments = Array.isArray(commentItems) ? commentItems : [];
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');
return { commentItems: vars.findDataComments };$old$,
$new$vars.findDataComments = Array.isArray(commentItems) ? commentItems : [];
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');
await helpers.logRunEvent({
  eventType: 'open_comments',
  eventName: 'Mở comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: false,
  xpath: selectors.commentButton,
  message: 'Đã mở comment để lấy dữ liệu',
  debugData: { postLimit, commentLimit, sortType }
});
if (sortType !== 'most_relevant') {
  await helpers.logRunEvent({
    eventType: 'sort_comments',
    eventName: 'Sắp xếp comment',
    targetType: 'comment',
    status: 'success',
    isUserVisible: false,
    message: 'Đã đổi sắp xếp comment',
    debugData: { sortType }
  });
}
await helpers.logRunEvent({
  eventType: 'collect_comments',
  eventName: 'Lấy danh sách comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.commentElement,
  elementCount: vars.findDataComments.length,
  message: 'Lấy được ' + vars.findDataComments.length + ' comment trong group',
  debugData: { postLimit, commentLimit, sortType }
});
return { commentItems: vars.findDataComments };$new$
  ),
$old$if (vars.isFindInComment !== true && vars.isFindNewInteractors !== true) {
  vars.findDataComments = [];
  return { commentItems: [] };
}
$old$,
$new$if (vars.isFindInComment !== true && vars.isFindNewInteractors !== true) {
  vars.findDataComments = [];
  return { commentItems: [] };
}
$new$
)
WHERE name = 'fb_collect_group_comments';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      replace(
        code,
$old$  uidInComment: await helpers.element('fb_uid_in_cmt_element'),
  closeDialog: await helpers.element('fb_close_dialog_btn')
$old$,
$new$  uidInComment: await helpers.element('fb_uid_in_cmt_element'),
  contentInComment: await helpers.element('fb_content_in_cmt_element'),
  closeDialog: await helpers.element('fb_close_dialog_btn')
$new$
      ),
$old$const commentItems = await page.evaluate(`$old$,
$new$const commentResult = await page.evaluate(`$new$
    ),
$old$  const rows = [];
  const posts = xpathAll(selectors.posts).slice(0, postLimit);
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];
    try {
      post.scrollIntoView(true);
      await delay(700);
      const button = first(selectors.commentButton, post);
      if (!button) continue;
      clickSynthetic(button);
      await delay(2000);

      let root = await waitFor(() => first(selectors.dialog, document), 5000);
      if (!root) root = document.documentElement;

      if (sortType !== 'most_relevant') {
        const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
        if (sortButton) {
          clickSynthetic(sortButton);
          await delay(800);
          const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
          const option = first(optionXpath, document);
          if (option) {
            clickSynthetic(option);
            await delay(2000);
          }
        }
      }

      let comments = xpathAll(selectors.commentElement, root);
      const startedAt = Date.now();
      let stableCount = 0;
      while (comments.length < commentLimit && Date.now() - startedAt < 90 * 1000 && stableCount < 3) {
        const oldCount = comments.length;
        if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
        await delay(1500);
        comments = xpathAll(selectors.commentElement, root);
        stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
      }

      comments.slice(0, commentLimit).forEach((comment, i) => {
        const link = first(selectors.uidInComment, comment);
        const href = link ? (link.href || link.getAttribute('href') || '') : '';
        rows.push({
          postIndex: p + 1,
          commentIndex: i + 1,
          content: (comment.innerText || comment.textContent || '').trim(),
          authorUrl: href,
          authorUid: extractUid(href)
        });
      });

      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(1000);
      }
    } catch {
      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(500);
      }
    }
  }

  return rows;
$old$,
$new$  function commentContentOf(comment, authorLink, messageXpath) {
    const candidates = xpathAll(messageXpath, comment)
      .filter(isVisible)
      .filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink)))
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    return candidates[0] || (comment.innerText || comment.textContent || '').trim();
  }

  const rows = [];
  const postCommentStats = [];
  const posts = xpathAll(selectors.posts).slice(0, postLimit);
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];
    const postStat = {
      postIndex: p + 1,
      opened: false,
      sorted: sortType === 'most_relevant',
      commentsCount: 0,
      error: ''
    };
    try {
      post.scrollIntoView(true);
      await delay(700);
      const button = first(selectors.commentButton, post);
      if (!button) {
        postStat.error = 'Không tìm thấy nút comment';
        continue;
      }
      clickSynthetic(button);
      postStat.opened = true;
      await delay(2000);

      let root = await waitFor(() => first(selectors.dialog, document), 5000);
      if (!root) root = document.documentElement;

      if (sortType !== 'most_relevant') {
        postStat.sorted = false;
        const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
        if (sortButton) {
          clickSynthetic(sortButton);
          await delay(800);
          const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
          const option = first(optionXpath, document);
          if (option) {
            clickSynthetic(option);
            postStat.sorted = true;
            await delay(2000);
          } else {
            postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment';
          }
        } else {
          postStat.error = 'Không tìm thấy nút sắp xếp comment';
        }
      }

      let comments = xpathAll(selectors.commentElement, root);
      const startedAt = Date.now();
      let stableCount = 0;
      while (comments.length < commentLimit && Date.now() - startedAt < 90 * 1000 && stableCount < 3) {
        const oldCount = comments.length;
        if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
        await delay(1500);
        comments = xpathAll(selectors.commentElement, root);
        stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
      }

      const selectedComments = comments.slice(0, commentLimit);
      postStat.commentsCount = selectedComments.length;
      selectedComments.forEach((comment, i) => {
        const link = first(selectors.uidInComment, comment);
        const href = link ? (link.href || link.getAttribute('href') || '') : '';
        const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
        const content = commentContentOf(comment, link, selectors.contentInComment);
        rows.push({
          postIndex: p + 1,
          commentIndex: i + 1,
          content,
          authorName,
          authorUrl: href,
          authorUid: extractUid(href)
        });
      });
    } catch (err) {
      postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment');
    } finally {
      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(1000);
      }
      postCommentStats.push(postStat);
    }
  }

  return { rows, postCommentStats };
$new$
    ),
$old$vars.findDataComments = Array.isArray(commentItems) ? commentItems : [];
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');
await helpers.logRunEvent({
  eventType: 'open_comments',
  eventName: 'Mở comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: false,
  xpath: selectors.commentButton,
  message: 'Đã mở comment để lấy dữ liệu',
  debugData: { postLimit, commentLimit, sortType }
});
if (sortType !== 'most_relevant') {
  await helpers.logRunEvent({
    eventType: 'sort_comments',
    eventName: 'Sắp xếp comment',
    targetType: 'comment',
    status: 'success',
    isUserVisible: false,
    message: 'Đã đổi sắp xếp comment',
    debugData: { sortType }
  });
}
await helpers.logRunEvent({
  eventType: 'collect_comments',
  eventName: 'Lấy danh sách comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.commentElement,
  elementCount: vars.findDataComments.length,
  message: 'Lấy được ' + vars.findDataComments.length + ' comment trong group',
  debugData: { postLimit, commentLimit, sortType }
});
return { commentItems: vars.findDataComments };$old$,
$new$const commentItems = Array.isArray(commentResult)
  ? commentResult
  : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats)
  ? commentResult.postCommentStats
  : [];
vars.findDataComments = commentItems;
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const uid = String(item && item.authorUid ? item.authorUid : '').trim();
  if (!/^\d{5,}$/.test(uid)) return '';
  const href = String(item && item.authorUrl ? item.authorUrl : '').toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=')
  ) {
    return '';
  }
  return uid;
}

const results = ensureResults();
const sourceComment = results.sourceData.comment;
const sourceNewInteractors = results.sourceData.newInteractors;
const commentSourcePosts = Array.isArray(vars.findDataPosts) ? vars.findDataPosts : [];
const commentsByPost = new Map();
for (const comment of vars.findDataComments) {
  const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0));
  if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []);
  commentsByPost.get(postIndex).push(comment);
}

const commentLogEvents = [];
let matchedComments = 0;
let globalCommentIndex = 0;

for (const rawStat of commentPostStats) {
  const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
  const postIndex = Math.max(1, Number(stat.postIndex || 0));
  const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
  const opened = stat.opened === true;
  const sorted = stat.sorted === true;
  const error = String(stat.error || '').trim();
  const sourcePost = commentSourcePosts[postIndex - 1] || {};
  const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
  const commentsForPost = commentsByPost.get(postIndex) || [];

  commentLogEvents.push({
    eventType: 'open_comments',
    eventName: 'Mở comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: false,
    xpath: selectors.commentButton,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex,
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  if (sortType !== 'most_relevant' && opened) {
    commentLogEvents.push({
      eventType: 'sort_comments',
      eventName: 'Sắp xếp comment',
      targetType: 'comment',
      status: sorted ? 'success' : 'failed',
      isUserVisible: false,
      itemIndex: postIndex,
      targetUrl: postUrl,
      message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex),
      debugData: {
        sortType,
        postIndex,
        postUrl,
        error,
        selectors: {
          sortButton: selectors.mostRelevant,
          allComments: selectors.allComments,
          newestComments: selectors.newestComments
        }
      }
    });
  }

  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: commentsCount,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment',
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  for (const comment of commentsForPost) {
    globalCommentIndex++;
    const content = String(comment && comment.content ? comment.content : '');
    const contentMatches = matchesContent(content);
    const commentAuthorUidForLog = authorUidFromItem(comment);
    const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
    const commentPhonesForLog = findPhones(content);
    const commentZaloLinksForLog = findZaloLinks(content);
    const commentPostLinksForLog = postUrl ? [postUrl] : [];

    if (vars.isFindInComment && contentMatches) {
      matchedComments++;
      if (vars.isFindPhone) {
        results.phones.push(...commentPhonesForLog);
        sourceComment.phones.push(...commentPhonesForLog);
      }
      if (vars.isFindLinkGroupZalo) {
        results.linkGroupZalos.push(...commentZaloLinksForLog);
        sourceComment.linkGroupZalos.push(...commentZaloLinksForLog);
      }
      if (vars.isFindUid && commentAuthorUidForLog) {
        results.uids.push(commentAuthorUidForLog);
        sourceComment.uids.push(commentAuthorUidForLog);
      }
    }

    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }

    const shouldLogCommentSuccess = (vars.isFindInComment && contentMatches) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
    const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

    if (shouldLogCommentSuccess) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'success',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Đã duyệt comment #' + commentIndexInPost,
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: {
            keyword: String(vars.keywords || ''),
            matchedKeyword: contentMatches,
            aiPrompt: String(vars.contentAI || '') || null,
            aiResult: null
          },
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost,
          globalCommentIndex,
          postUrl,
          authorName: commentAuthorNameForLog,
          authorUrl,
          source: vars.isFindNewInteractors ? 'new_interactors_or_comment' : 'comment'
        }
      });
    } else if (vars.isFindInComment && !contentMatches) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || null,
            contentText: content
          },
          filters: {
            keyword: String(vars.keywords || ''),
            matchedKeyword: false,
            aiPrompt: String(vars.contentAI || '') || null,
            aiResult: null
          },
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl }
      });
    }
  }
}

if (commentLogEvents.length === 0) {
  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: 0,
    message: 'Không thấy bài post để lấy comment',
    debugData: { postLimit, commentLimit, sortType }
  });
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
sourceComment.phones = unique(sourceComment.phones);
sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos);
sourceComment.uids = unique(sourceComment.uids);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

commentLogEvents.push({
  eventType: 'collect_comments_summary',
  eventName: 'Tổng kết comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.commentElement,
  elementCount: vars.findDataComments.length,
  message: 'Tổng cộng lấy được ' + vars.findDataComments.length + ' comment từ ' + commentPostStats.length + ' bài post',
  debugData: { postLimit, commentLimit, sortType, postCount: commentPostStats.length }
});

await helpers.logRunEvents(commentLogEvents);
return {
  commentItems: vars.findDataComments,
  commentPostStats,
  matchedComments,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  sourceCounts: {
    comment: {
      phones: sourceComment.phones.length,
      linkGroupZalos: sourceComment.linkGroupZalos.length,
      uids: sourceComment.uids.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};$new$
  )
WHERE name = 'fb_collect_group_comments';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    code,
$old$    const contentMatches = matchesContent(content);
$old$,
$new$    const contentMatches = matchesContent(content);
    const commentAuthorUidForLog = authorUidFromItem(comment);
    const commentPhonesForLog = findPhones(content);
    const commentZaloLinksForLog = findZaloLinks(content);
    const commentPostLinksForLog = comment && comment.postUrl ? [String(comment.postUrl)] : [];

    if (vars.isFindInComment && !contentMatches) {
      await helpers.logRunEvent({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: comment && comment.commentIndex ? comment.commentIndex : null,
        targetUrl: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'comment',
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            name: null,
            uid: commentAuthorUidForLog || null,
            contentText: content
          },
          filters: {
            keyword: String(vars.keywords || ''),
            matchedKeyword: false,
            aiPrompt: String(vars.contentAI || '') || null,
            aiResult: null
          },
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: comment && comment.postIndex ? comment.postIndex : null,
          commentIndex: comment && comment.commentIndex ? comment.commentIndex : null,
          authorUrl: String(comment && comment.authorUrl ? comment.authorUrl : '')
        }
      });
    }
$new$
  ),
$old$    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
$old$,
$new$    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
    const shouldLogCommentExtract = (vars.isFindInComment && contentMatches) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    if (shouldLogCommentExtract) {
      await helpers.logRunEvent({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'success',
        isUserVisible: true,
        itemIndex: comment && comment.commentIndex ? comment.commentIndex : null,
        targetUrl: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        message: 'Đã duyệt comment' + (comment && comment.commentIndex ? ' #' + comment.commentIndex : ''),
        extractedData: {
          entity: {
            type: 'comment',
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            name: null,
            uid: commentAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: {
            keyword: String(vars.keywords || ''),
            matchedKeyword: contentMatches,
            aiPrompt: String(vars.contentAI || '') || null,
            aiResult: null
          },
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex: comment && comment.postIndex ? comment.postIndex : null,
          commentIndex: comment && comment.commentIndex ? comment.commentIndex : null,
          authorUrl: String(comment && comment.authorUrl ? comment.authorUrl : ''),
          source: vars.isFindNewInteractors ? 'new_interactors_or_comment' : 'comment'
        }
      });
    }
$new$
)
WHERE name = 'fb_extract_data_from_group_comments';

UPDATE _find_data_run_event_overrides
SET code = $code$const comments = Array.isArray(input.commentItems)
  ? input.commentItems
  : (Array.isArray(vars.findDataComments) ? vars.findDataComments : []);
const results = vars.findDataResults && typeof vars.findDataResults === 'object'
  ? vars.findDataResults
  : {};
const sourceData = results.sourceData && typeof results.sourceData === 'object'
  ? results.sourceData
  : {};
const sourceComment = sourceData.comment && typeof sourceData.comment === 'object'
  ? sourceData.comment
  : {};
const sourceNewInteractors = sourceData.newInteractors && typeof sourceData.newInteractors === 'object'
  ? sourceData.newInteractors
  : {};

return {
  skippedExtractComments: true,
  commentItems: comments,
  matchedComments: null,
  phones: Array.isArray(results.phones) ? results.phones : [],
  linkGroupZalos: Array.isArray(results.linkGroupZalos) ? results.linkGroupZalos : [],
  uids: Array.isArray(results.uids) ? results.uids : [],
  sourceCounts: {
    comment: {
      phones: Array.isArray(sourceComment.phones) ? sourceComment.phones.length : 0,
      linkGroupZalos: Array.isArray(sourceComment.linkGroupZalos) ? sourceComment.linkGroupZalos.length : 0,
      uids: Array.isArray(sourceComment.uids) ? sourceComment.uids.length : 0
    },
    newInteractors: {
      uids: Array.isArray(sourceNewInteractors.uids) ? sourceNewInteractors.uids.length : 0
    }
  }
};$code$
WHERE name = 'fb_extract_data_from_group_comments';

UPDATE _find_data_run_event_overrides
SET code = replace(
  code,
$old$function authorUidFromItem(item) {
  const uid = String(item && item.authorUid ? item.authorUid : '').trim();
  if (!/^\d{5,}$/.test(uid)) return '';
  const href = String(item && item.authorUrl ? item.authorUrl : '').toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=')
  ) {
    return '';
  }
  return uid;
}$old$,
$new$function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
  const href = rawHref.toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=') ||
    (href.includes('/groups/') && !href.includes('/user/'))
  ) {
    return '';
  }

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const id = url.searchParams.get('id');
    if (id) return id.trim();
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const userIndex = parts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
    const last = parts[parts.length - 1] || '';
    const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']);
    if (last && !blockedLastParts.has(last.toLowerCase())) return last;
  } catch {}

  return fallbackUid;
}$new$
)
WHERE name IN ('fb_extract_data_from_group_posts', 'fb_collect_group_comments');

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    code,
$old$if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { memberPageUrl: '', skippedMembers: true };
}
$old$,
$new$if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { memberPageUrl: '', skippedMembers: true };
}
$new$
  ),
$old$helpers.log('Mở danh sách thành viên group ' + (String(vars.inputDataName || '').trim() || groupUrl));
await page.navigate(memberPageUrl);
await helpers.sleep(5000, signal);
$old$,
$new$helpers.log('Mở danh sách thành viên group ' + (String(vars.inputDataName || '').trim() || groupUrl));
await page.navigate(memberPageUrl);
await helpers.sleep(5000, signal);
await helpers.logRunEvent({
  eventType: 'open_group_members',
  eventName: 'Mở danh sách thành viên',
  targetType: 'member',
  status: 'success',
  isUserVisible: false,
  targetUrl: memberPageUrl,
  message: 'Đã mở danh sách thành viên group'
});
$new$
)
WHERE name = 'fb_open_group_members';

UPDATE _find_data_run_event_overrides
SET code = replace(
  replace(
    replace(
      code,
$old$if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { members: [], uids: [], skippedMembers: true };
}
$old$,
$new$if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { members: [], uids: [], skippedMembers: true };
}
$new$
	    ),
	$old$const members = await page.evaluate(`$old$,
$new$const members = await page.evaluate(`$new$
	  ),
	$old$return {
  members: memberRows,
  uids: memberUids,
	$old$,
	$new$await helpers.logRunEvent({
  eventType: 'scroll_members',
  eventName: 'Cuộn danh sách thành viên',
  targetType: 'member',
  status: 'success',
  isUserVisible: false,
  xpath: selector,
  message: 'Đã cuộn danh sách thành viên group',
  debugData: { limit }
});
await helpers.logRunEvent({
  eventType: 'collect_members',
  eventName: 'Lấy danh sách thành viên group',
  targetType: 'member',
  status: 'success',
  isUserVisible: true,
  xpath: selector,
  elementCount: memberRows.length,
  message: 'Lấy được ' + memberRows.length + ' thành viên group',
  debugData: { limit }
});
await helpers.logRunEvents(memberRows.map((member, index) => ({
  eventType: 'extract_member_data',
  eventName: 'Lấy thông tin thành viên group',
  targetType: 'member',
  status: 'success',
  isUserVisible: true,
  itemIndex: index + 1,
  targetUrl: String(member && member.url ? member.url : ''),
  message: 'Đã duyệt thành viên ' + String(member && member.name ? member.name : ''),
  extractedData: {
    entity: {
      type: 'member',
      url: String(member && member.url ? member.url : ''),
      name: String(member && member.name ? member.name : ''),
      uid: String(member && member.uid ? member.uid : ''),
      contentText: ''
    },
    filters: {
      keyword: null,
      matchedKeyword: true,
      aiPrompt: null,
      aiResult: null
    },
    values: {
      phones: [],
      zaloGroupLinks: [],
      postLinks: [],
      uids: member && member.uid ? [String(member.uid)] : []
    }
  },
  debugData: { memberIndex: index + 1 }
})));

return {
  members: memberRows,
  uids: memberUids,
$new$
)
WHERE name = 'fb_collect_group_members';

UPDATE _find_data_run_event_overrides
SET code = replace(
  code,
$old$return {
  members: memberRows,
  uids: memberUids,
$old$,
$new$await helpers.logRunEvent({
  eventType: 'scroll_members',
  eventName: 'Cuộn danh sách thành viên',
  targetType: 'member',
  status: 'success',
  isUserVisible: false,
  xpath: selector,
  message: 'Đã cuộn danh sách thành viên group',
  debugData: { limit }
});
await helpers.logRunEvent({
  eventType: 'collect_members',
  eventName: 'Lấy danh sách thành viên group',
  targetType: 'member',
  status: 'success',
  isUserVisible: true,
  xpath: selector,
  elementCount: memberRows.length,
  message: 'Lấy được ' + memberRows.length + ' thành viên group',
  debugData: { limit }
});
await helpers.logRunEvents(memberRows.map((member, index) => ({
  eventType: 'extract_member_data',
  eventName: 'Lấy thông tin thành viên group',
  targetType: 'member',
  status: 'success',
  isUserVisible: true,
  itemIndex: index + 1,
  targetUrl: String(member && member.url ? member.url : ''),
  message: 'Đã duyệt thành viên ' + String(member && member.name ? member.name : ''),
  extractedData: {
    entity: {
      type: 'member',
      url: String(member && member.url ? member.url : ''),
      name: String(member && member.name ? member.name : ''),
      uid: String(member && member.uid ? member.uid : ''),
      contentText: ''
    },
    filters: {
      keyword: null,
      matchedKeyword: true,
      aiPrompt: null,
      aiResult: null
    },
    values: {
      phones: [],
      zaloGroupLinks: [],
      postLinks: [],
      uids: member && member.uid ? [String(member.uid)] : []
    }
  },
  debugData: { memberIndex: index + 1 }
})));

return {
  members: memberRows,
  uids: memberUids,
$new$
)
WHERE name = 'fb_collect_group_members'
  AND position('extract_member_data' in code) = 0;

UPDATE _find_data_run_event_overrides
SET code = replace(
  code,
$old$vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers, sourceData, sourceCounts };
helpers.log(message);

return {
$old$,
$new$vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers, sourceData, sourceCounts };
helpers.log(message);
await helpers.logRunEvent({
  eventType: 'find_data_source_summary',
  eventName: 'Tổng kết tìm data',
  targetType: 'group',
  status: 'success',
  isUserVisible: true,
  targetUrl: String(vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || ''),
  elementCount: total,
  message,
  extractedData: {
    entity: {
      type: 'group',
      url: String(vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || ''),
      name: String(vars.inputDataName || ''),
      uid: String(vars.inputDataUid || ''),
      contentText: ''
    },
    filters: {
      keyword: String(vars.keywords || ''),
      matchedKeyword: true,
      aiPrompt: String(vars.contentAI || '') || null,
      aiResult: null
    },
    values: {
      phones,
      zaloGroupLinks: linkGroupZalos,
      postLinks,
      uids,
      groupMembers
    }
  },
  debugData: { sourceCounts }
});

return {
$new$
)
WHERE name = 'fb_find_group_data_summary';

WITH rebuilt AS (
  SELECT
    wf.id,
    jsonb_agg(
      CASE
        WHEN overrides.code IS NULL THEN node.value
        ELSE jsonb_set(node.value, '{codeOverride}', to_jsonb(overrides.code), true)
      END
      ORDER BY node.ordinality
    ) AS nodes
  FROM public.auto_campaign_actions ca
  JOIN public.auto_workflows wf ON wf.id = ca.test_workflow_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(wf.nodes, '[]'::jsonb)) WITH ORDINALITY AS node(value, ordinality)
  LEFT JOIN _find_data_run_event_overrides overrides
    ON overrides.name = node.value->>'blockName'
  WHERE ca.id = 'facebook_find_data_group'
    AND ca.test_workflow_id IS NOT NULL
    AND ca.is_delete = false
  GROUP BY wf.id
)
UPDATE public.auto_workflows wf
SET
  nodes = rebuilt.nodes,
  updated_at = now()
FROM rebuilt
WHERE wf.id = rebuilt.id
  AND wf.nodes IS DISTINCT FROM rebuilt.nodes;

DELETE FROM public.auto_campaign_run_events
WHERE status = 'info'
  AND event_type IN ('open_group', 'open_group_members');

UPDATE public.auto_campaign_run_events
SET status = 'success'
WHERE status = 'info'
  AND event_type IN ('scroll_feed', 'scroll_members', 'open_comments', 'sort_comments');

UPDATE public.auto_campaign_run_events
SET
  event_type = 'collect_comments_summary',
  event_name = 'Tổng kết comment',
  message = COALESCE(NULLIF(message, ''), 'Tổng cộng lấy được ' || COALESCE(element_count, 0)::text || ' comment')
WHERE campaign_action_id = 'facebook_find_data_group'
  AND event_type = 'collect_comments'
  AND status = 'success'
  AND item_index IS NULL
  AND element_count IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
