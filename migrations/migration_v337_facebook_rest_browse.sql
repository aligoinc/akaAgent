-- Linked production: cgjbsmqtfhqvttudyjzq. Additive data only; no RPC/DDL/schema reload.
-- Source selectors read live on 2026-10-02. Never replace the existing campaign/newsfeed workflows.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  PERFORM 1 FROM public.auto_elements WHERE name IN ('fb_newsfeed_post', 'fb_post_in_uid', 'fb_newsfeed_see_more') FOR SHARE;
  IF (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE name='fb_newsfeed_post') IS DISTINCT FROM '486f00c63f3020fa96fb00fc6f8ad50f'
    OR (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE name='fb_post_in_uid') IS DISTINCT FROM '1a5f8c745d7fdd4bd4c76f67aad5c185'
    OR (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE name='fb_newsfeed_see_more') IS DISTINCT FROM '64de5a6801fc4cdeacd8e90d1b68be04' THEN
    RAISE EXCEPTION 'v337 preflight: live source selectors changed; capture and review again';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_workflows WHERE name='fb_campaign_rest_browse')
    OR EXISTS (SELECT 1 FROM public.auto_blocks WHERE name LIKE 'fb_rest_browse%')
    OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name LIKE 'fb_rest_browse%') THEN
    RAISE EXCEPTION 'v337 preflight: names already exist; refusing to overwrite';
  END IF;
END $preflight$;

INSERT INTO public.auto_elements (name, xpath, category, description, is_builtin)
SELECT CASE name WHEN 'fb_newsfeed_post' THEN 'fb_rest_browse_home_post'
  WHEN 'fb_post_in_uid' THEN 'fb_rest_browse_target_post' ELSE 'fb_rest_browse_see_more' END,
  xpath, 'facebook', 'Lướt phụ: bản chụp selector live v337, độc lập workflow chính.', true
FROM public.auto_elements WHERE name IN ('fb_newsfeed_post', 'fb_post_in_uid', 'fb_newsfeed_see_more');

INSERT INTO public.auto_elements (name, xpath, category, description, is_builtin) VALUES
('fb_rest_browse_photo', $xpath$.//a[(contains(@href,'/photo/') or contains(@href,'/photo.php') or contains(@href,'/photos/')) and .//img]$xpath$,
 'facebook', 'Link ảnh trong đúng bài đang xem; thiếu thì bỏ qua.', true),
('fb_rest_browse_notifications', $xpath$//*[@role='banner']//*[@role='button' and (contains(@aria-label,'Thông báo') or contains(@aria-label,'Notifications'))]$xpath$,
 'facebook', 'Mở bảng thông báo tại trang chủ; không click thông báo hoặc đánh dấu tất cả đã đọc.', true);

INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, is_builtin)
VALUES ('fb_rest_browse_feed', 'Lướt phụ tại đích/trang chủ, xem ảnh và mở rộng bài; không like/comment/gửi tin.', 'Eye', 'facebook', 'js', $browse$
const segments = Array.isArray(vars.restBrowseSegments) ? vars.restBrowseSegments : [];
// Selector reads are optional and bounded too; a late result cannot touch the page.
async function element(name) {
  let timer;
  try {
    return await Promise.race([
      helpers.element(name),
      new Promise(resolve => { timer = setTimeout(() => resolve(''), 10000); })
    ]);
  } catch { return ''; } finally { clearTimeout(timer); }
}
const names = ['home_post', 'target_post', 'see_more', 'photo', 'notifications'];
const values = await Promise.all(names.map(name => element('fb_rest_browse_' + name)));
const selectors = Object.fromEntries(names.map((name, index) => [name, values[index]]));
const viewedPhotos = new Set();
for (const segment of segments) {
  const until = Math.min(Number(segment.until), Number(vars.restBrowseUntil));
  const remaining = () => Math.max(0, until - Date.now());
  const pause = ms => helpers.sleep(Math.min(ms, remaining()), signal);
  if (signal.aborted || !Number.isFinite(until) || remaining() <= 0) continue;
  try {
    helpers.log(segment.home ? 'Lướt trang chủ Facebook.' : 'Lướt group/profile/page vừa xử lý.');
    await page.navigate(segment.url);
    if (signal.aborted || remaining() <= 0) continue;
    // Only the home phase opens the notifications panel, once, then returns home.
    if (segment.home && selectors.notifications && remaining() > 5000) {
      const opened = await page.evaluate(`
        try {
          const button = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!button || !button.getClientRects().length) return false;
          button.click(); return true;
        } catch { return false; }
      `, selectors.notifications);
      if (opened) {
        await pause(1500);
        if (signal.aborted || remaining() <= 0) continue;
        await page.navigate('https://www.facebook.com/');
      }
    }
    let cursor = 0;
    while (!signal.aborted && remaining() > 0) {
      const item = await page.evaluate(`
        const selectors = __args[0], cursor = Number(__args[1]);
        function first(xpath, root) {
          if (!xpath) return null;
          try { return document.evaluate(xpath, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch { return null; }
        }
        let posts = [];
        if (selectors.post) {
          try {
            const found = document.evaluate(selectors.post, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < found.snapshotLength; i++) {
              const post = found.snapshotItem(i);
              if (post && post.getClientRects().length) posts.push(post);
            }
          } catch {}
        }
        const post = posts[cursor];
        if (!post) { window.scrollBy(0, Math.max(400, window.innerHeight * 0.7)); return { next: cursor }; }
        post.scrollIntoView({ block: 'center' });
        // Both lookups are scoped to this post. Never search the whole document for an action.
        const more = first(selectors.seeMore, post);
        if (more && more.getClientRects().length) more.click();
        const photo = first(selectors.photo, post);
        return { next: cursor + 1, photo: photo ? photo.href : '', scrollY: window.scrollY };
      `, { post: segment.home ? selectors.home_post : selectors.target_post, seeMore: selectors.see_more, photo: selectors.photo }, cursor);
      cursor = Number(item.next || cursor);
      if (signal.aborted || remaining() <= 0) break;
      let photoUrl = null;
      try {
        const candidate = new URL(item.photo);
        if (candidate.protocol === 'https:' && /(^|\.)facebook\.com$/i.test(candidate.hostname) &&
          !candidate.username && !candidate.password && /^\/(photo\/|photo\.php|photos\/)/.test(candidate.pathname)) photoUrl = candidate.href;
      } catch {}
      if (photoUrl && !viewedPhotos.has(photoUrl) && remaining() > 7000) {
        viewedPhotos.add(photoUrl);
        try {
          await page.navigate(photoUrl);
          await pause(2000);
        } catch {}
        if (signal.aborted || remaining() <= 0) break;
        await page.navigate(segment.url);
        await page.evaluate('window.scrollTo(0, Number(__args[0]) || 0)', item.scrollY);
      }
      await pause(3000);
    }
  } catch {
    if (!signal.aborted) helpers.log('Bỏ qua thao tác lướt Facebook không thực hiện được.');
  }
}
return { ok: true };
$browse$, true),
('fb_rest_browse_rest', 'Nghỉ sau phần lướt, vẫn thuộc đợt chạy campaign hiện tại.', 'Clock', 'facebook', 'js', $rest$
const remaining = Math.max(0, Number(vars.restBrowseUntil) - Date.now());
const ms = Math.min(Math.max(0, Number(vars.restBrowseSeconds) * 1000), remaining);
if (!signal.aborted && Number.isFinite(ms) && ms > 0) {
  helpers.log('Nghỉ ' + Math.ceil(ms / 1000) + ' giây sau khi lướt Facebook.');
  await helpers.sleep(ms, signal);
}
return { ok: true };
$rest$, true);

INSERT INTO public.auto_workflows (name, description, is_builtin, nodes, edges, default_variables)
SELECT 'fb_campaign_rest_browse', 'Phần phụ cùng đợt chạy: đạt giới hạn giờ → lướt → nghỉ → chờ xử lý. Scheduler giữ claim; không có action/campaign riêng.', true,
  jsonb_build_array(
    jsonb_build_object('id','browse','blockId',browse.id,'blockName',browse.name,'position',jsonb_build_object('x',80,'y',100),'config','{}'::jsonb,'label','Lướt Facebook'),
    jsonb_build_object('id','rest','blockId',rest.id,'blockName',rest.name,'position',jsonb_build_object('x',420,'y',100),'config','{}'::jsonb,'label','Nghỉ sau khi lướt')
  ),
  '[{"id":"browse-rest","source":"browse","target":"rest"}]'::jsonb,
  '{"restBrowseSegments":[],"restBrowseSeconds":0,"restBrowseUntil":0}'::jsonb
FROM public.auto_blocks browse CROSS JOIN public.auto_blocks rest
WHERE browse.name='fb_rest_browse_feed' AND rest.name='fb_rest_browse_rest';

COMMIT;
