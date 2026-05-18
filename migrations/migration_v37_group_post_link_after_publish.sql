-- Resolve the just-published group post link and derive pending state from that link.
-- The elements are intentionally separate from the find-data post-link elements.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('GroupPostSubmitButtonAfterClick', '//*[not(@aria-hidden)]/form//*[@role=''button'' and (contains(.,''Post'') or .=''Đăng'')]', 'Nút Post/Đăng trong form group sau khi click đăng; biến mất nghĩa là form đã đóng', 'facebook', true, NULL, NULL, now()),
  ('GroupPostRawPostLink', '//*[@role=''main'']//a[not(ancestor::*[@role=''feed'']) and @target=''_blank'' and contains(@href, ''?__cft__[0]='')]', 'Raw link đầu tiên của bài vừa đăng trong group trước khi Facebook render permalink thật', 'facebook', true, NULL, NULL, now()),
  ('GroupPostPostLink', '//*[@role=''main'']//a[not(ancestor::*[@role=''feed'']) and (contains(@href, ''/pending_posts/'') or contains(@href, ''/posts/'') or contains(@href, ''story_fbid=''))]', 'Permalink bài vừa đăng trong group sau khi focusin raw link', 'facebook', true, NULL, NULL, now()),
  ('GroupPostDismissDialogOrUsePageButton', '//*[@role=''dialog'']//*[@role=''button'' and @aria-label=''Đóng'']|//*[@role=''button'' and .=''Dùng Trang'']', 'Popup/CTA cần đóng hoặc chọn Dùng Trang trong luồng đăng bài group', 'facebook', true, NULL, NULL, now())
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

INSERT INTO public.auto_blocks (
  name,
  description,
  icon,
  category,
  kind,
  code,
  config_schema,
  output_schema,
  default_config,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES
  (
    'fb_verify_group_post_form_closed',
    'Xác nhận form đăng bài group đã đóng sau khi click Post/Đăng',
    'CheckCircle',
    'facebook',
    'js',
    $block$
const submitButton = await helpers.element('GroupPostSubmitButtonAfterClick');
let posted = false;
let message = '';

try {
  await page.waitForSelector(submitButton, { timeout: 60000, state: 'hidden' });
  posted = true;
  message = 'Form đăng bài đã đóng';
} catch {
  posted = false;
  message = 'Form đăng bài chưa đóng sau 60 giây';
}

vars.groupPostSubmitted = posted;
if (!posted) helpers.log(message);

return {
  ok: posted,
  posted,
  submitClosed: posted,
  message
};
$block$,
    '[]'::jsonb,
    '[
      {"name":"ok","type":"boolean","label":"Submit OK"},
      {"name":"posted","type":"boolean","label":"Đã đăng"},
      {"name":"submitClosed","type":"boolean","label":"Form đã đóng"},
      {"name":"message","type":"string","label":"Thông báo"}
    ]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_click_group_post_prompt_if_present',
    'Click popup Đóng/Dùng Trang trong group nếu xuất hiện',
    'MousePointerClick',
    'facebook',
    'js',
    $block$
const selector = await helpers.element('GroupPostDismissDialogOrUsePageButton');

const result = await page.evaluate(`
  const selector = __args[0];

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath) {
    const out = [];
    if (!xpath) return out;
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        const item = result.snapshotItem(i);
        if (item) out.push(item);
      }
    } catch {}
    return out;
  }

  function clickSynthetic(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    const pointerInit = Object.assign({}, init, { pointerId: 1, pointerType: 'mouse', isPrimary: true });
    try { el.dispatchEvent(new PointerEvent('pointerdown', pointerInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', pointerInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  const el = xpathAll(selector).find(isVisible) || null;
  if (!el) return { clicked: false, label: '' };

  const label = el.getAttribute('aria-label') || (el.innerText || el.textContent || '').trim();
  clickSynthetic(el);
  return { clicked: true, label };
`, selector);

const clicked = result && result.clicked === true;
if (clicked) {
  await helpers.sleep(500, signal);
  helpers.log('Đã xử lý popup group nếu có');
}

return {
  clicked,
  label: String(result && result.label ? result.label : '')
};
$block$,
    '[]'::jsonb,
    '[
      {"name":"clicked","type":"boolean","label":"Đã click"},
      {"name":"label","type":"string","label":"Nhãn"}
    ]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_get_first_group_post_link',
    'Lấy link bài group đầu tiên sau khi đăng bằng raw link + focusin',
    'Link',
    'facebook',
    'js',
    $block$
const rawSelector = await helpers.element('GroupPostRawPostLink');
const linkSelector = await helpers.element('GroupPostPostLink');

const result = await page.evaluate(`
  const rawSelector = __args[0];
  const linkSelector = __args[1];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function xpathAll(xpath) {
    const out = [];
    if (!xpath) return out;
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        const item = result.snapshotItem(i);
        if (item) out.push(item);
      }
    } catch {}
    return out;
  }

  function hrefOf(el) {
    return el ? (el.href || el.getAttribute('href') || '') : '';
  }

  function cleanPostHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      if (/^(m|mbasic|mobile)\\.facebook\\.com$/i.test(url.hostname)) {
        url.hostname = 'www.facebook.com';
      }
      url.hash = '';
      Array.from(url.searchParams.keys()).forEach(key => {
        if (
          key.startsWith('__') ||
          key === 'mibextid' ||
          key === 'ref' ||
          key === 'locale' ||
          key === 'comment_id' ||
          key === 'reply_comment_id'
        ) {
          url.searchParams.delete(key);
        }
      });
      return url.href;
    } catch {
      return String(href || '').trim();
    }
  }

  function isCommentPermalink(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.href);
      if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return true;
      const rawQuery = String(url.search || '').toLowerCase();
      return rawQuery.includes('comment_id=') || rawQuery.includes('reply_comment_id=');
    } catch {
      const raw = String(href || '').toLowerCase();
      return raw.includes('comment_id=') || raw.includes('reply_comment_id=');
    }
  }

  function isPostPermalink(href) {
    if (!href || isCommentPermalink(href)) return false;
    return href.includes('/pending_posts/') || href.includes('/posts/') || href.includes('story_fbid=');
  }

  function simulateFocusin(element) {
    if (!element) return;
    try {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {}
    try {
      element.dispatchEvent(new FocusEvent('focusin', {
        view: window,
        bubbles: true,
        cancelable: true
      }));
    } catch {
      try { element.dispatchEvent(new Event('focusin', { bubbles: true, cancelable: true })); } catch {}
    }
  }

  const rawEl = xpathAll(rawSelector)[0] || null;
  const rawPostLink = rawEl ? cleanPostHref(hrefOf(rawEl)) : '';
  if (rawEl) {
    simulateFocusin(rawEl);
    await delay(700);
  }

  const postUrl = xpathAll(linkSelector)
    .map(el => cleanPostHref(hrefOf(el)))
    .filter(Boolean)
    .filter(isPostPermalink)[0] || '';

  return { rawPostLink, postUrl };
`, rawSelector, linkSelector);

const rawPostLink = String(result && result.rawPostLink ? result.rawPostLink : '').trim();
const postUrl = String(result && result.postUrl ? result.postUrl : '').trim();
vars.groupPostRawPostLink = rawPostLink;
vars.groupPostPostUrl = postUrl;
helpers.log(postUrl ? 'Đã lấy được link bài post' : 'Chưa lấy được link bài post sau khi đăng');

return {
  ok: postUrl.length > 0,
  rawPostLink,
  postUrl,
  link: postUrl
};
$block$,
    '[]'::jsonb,
    '[
      {"name":"ok","type":"boolean","label":"Có link"},
      {"name":"rawPostLink","type":"string","label":"Raw post link"},
      {"name":"postUrl","type":"string","label":"Post URL"},
      {"name":"link","type":"string","label":"Link"}
    ]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  )
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  kind = EXCLUDED.kind,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

UPDATE public.auto_blocks
SET
  code = $block$
const groupPostUrl = String(vars.groupPostPostUrl || input.postUrl || input.link || '').trim();
if ('groupPostSubmitted' in vars || groupPostUrl) {
  const isPending = groupPostUrl.includes('/pending_posts/');
  vars.groupPostIsPending = isPending;
  return { isPending, postUrl: groupPostUrl };
}

const banner = await helpers.element('fb_pending_banner');
try {
  const found = await page.waitForSelector(banner, { timeout: 3000 });
  return { isPending: !!found };
} catch {
  return { isPending: false };
}
$block$,
  output_schema = '[
    {"name":"isPending","type":"boolean","label":"Bài có đang chờ duyệt không"},
    {"name":"postUrl","type":"string","label":"Post URL"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_detect_pending_post';

WITH ids AS (
  SELECT
    (SELECT id FROM public.auto_blocks WHERE name = 'fb_verify_group_post_form_closed') AS verify_block_id,
    (SELECT id FROM public.auto_blocks WHERE name = 'fb_click_group_post_prompt_if_present') AS prompt_block_id,
    (SELECT id FROM public.auto_blocks WHERE name = 'fb_get_first_group_post_link') AS link_block_id,
    (SELECT id FROM public.auto_blocks WHERE name = 'if_else') AS if_block_id
)
UPDATE public.auto_workflows AS wf
SET
  nodes = (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN node->>'id' = 'sleep3' THEN jsonb_set(node, '{config}', '{"ms":3000}'::jsonb, true)
        WHEN node->>'id' = 'if_leave' THEN jsonb_set(
          node,
          '{config,condition}',
          to_jsonb('vars.groupPostSubmitted === true && vars.leaveGroupOnPendingApproval === true && vars.groupPostIsPending === true'::text),
          true
        )
        WHEN node->>'id' = 'if_join' THEN jsonb_set(
          node,
          '{config,condition}',
          to_jsonb('vars.groupPostSubmitted === true && vars.autoJoinGroupAfterPost === true && vars.groupPostIsPending !== true'::text),
          true
        )
        ELSE node
      END
      ORDER BY ord
    ), '[]'::jsonb)
    FROM jsonb_array_elements(wf.nodes) WITH ORDINALITY AS t(node, ord)
    WHERE node->>'id' NOT IN ('dismiss_after_nav', 'verify_submit', 'dismiss_after_submit', 'if_submitted', 'get_post_link')
  ) || jsonb_build_array(
    jsonb_build_object(
      'id', 'dismiss_after_nav',
      'label', 'Click popup group nếu có',
      'config', '{}'::jsonb,
      'blockId', ids.prompt_block_id,
      'position', jsonb_build_object('x', 100, 'y', 50),
      'blockName', 'fb_click_group_post_prompt_if_present'
    ),
    jsonb_build_object(
      'id', 'verify_submit',
      'label', 'Xác nhận form đăng bài đã đóng',
      'config', '{}'::jsonb,
      'blockId', ids.verify_block_id,
      'position', jsonb_build_object('x', 100, 'y', 760),
      'blockName', 'fb_verify_group_post_form_closed'
    ),
    jsonb_build_object(
      'id', 'dismiss_after_submit',
      'label', 'Click popup sau đăng nếu có',
      'config', '{}'::jsonb,
      'blockId', ids.prompt_block_id,
      'position', jsonb_build_object('x', 100, 'y', 800),
      'blockName', 'fb_click_group_post_prompt_if_present'
    ),
    jsonb_build_object(
      'id', 'if_submitted',
      'label', 'Đăng bài thành công?',
      'config', jsonb_build_object('condition', 'vars.groupPostSubmitted === true'),
      'blockId', ids.if_block_id,
      'position', jsonb_build_object('x', 100, 'y', 840),
      'blockName', 'if_else',
      'systemType', 'ifElse'
    ),
    jsonb_build_object(
      'id', 'get_post_link',
      'label', 'Lấy link bài vừa đăng',
      'config', '{}'::jsonb,
      'blockId', ids.link_block_id,
      'position', jsonb_build_object('x', 100, 'y', 880),
      'blockName', 'fb_get_first_group_post_link'
    )
  ),
  edges = (
    SELECT COALESCE(jsonb_agg(edge ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(wf.edges) WITH ORDINALITY AS t(edge, ord)
    WHERE edge->>'id' NOT IN (
      'e-nav-dismiss_after_nav',
      'e-dismiss_after_nav-wait_main',
      'e-click_post-verify_submit',
      'e-verify_submit-if_submitted',
      'e-verify_submit-dismiss_after_submit',
      'e-dismiss_after_submit-if_submitted',
      'e-if_submitted-sleep3-true',
      'e-if_submitted-merge_comment-false',
      'e-sleep3-get_post_link',
      'e-get_post_link-detect_pending'
    )
      AND NOT (edge->>'source' = 'nav' AND edge->>'target' = 'wait_main')
      AND NOT (edge->>'source' = 'click_post' AND edge->>'target' = 'sleep3')
      AND NOT (edge->>'source' = 'verify_submit' AND edge->>'target' = 'if_submitted')
      AND NOT (edge->>'source' = 'sleep3' AND edge->>'target' = 'detect_pending')
  ) || jsonb_build_array(
    jsonb_build_object('id', 'e-nav-dismiss_after_nav', 'source', 'nav', 'target', 'dismiss_after_nav'),
    jsonb_build_object('id', 'e-dismiss_after_nav-wait_main', 'source', 'dismiss_after_nav', 'target', 'wait_main'),
    jsonb_build_object('id', 'e-click_post-verify_submit', 'source', 'click_post', 'target', 'verify_submit'),
    jsonb_build_object('id', 'e-verify_submit-dismiss_after_submit', 'source', 'verify_submit', 'target', 'dismiss_after_submit'),
    jsonb_build_object('id', 'e-dismiss_after_submit-if_submitted', 'source', 'dismiss_after_submit', 'target', 'if_submitted'),
    jsonb_build_object('id', 'e-if_submitted-sleep3-true', 'source', 'if_submitted', 'target', 'sleep3', 'sourceHandle', 'true'),
    jsonb_build_object('id', 'e-if_submitted-merge_comment-false', 'source', 'if_submitted', 'target', 'merge_comment', 'sourceHandle', 'false'),
    jsonb_build_object('id', 'e-sleep3-get_post_link', 'source', 'sleep3', 'target', 'get_post_link'),
    jsonb_build_object('id', 'e-get_post_link-detect_pending', 'source', 'get_post_link', 'target', 'detect_pending')
  ),
  updated_at = now()
FROM ids
WHERE wf.name = 'facebook_group_post';

COMMIT;
