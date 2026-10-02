-- Linked production: cgjbsmqtfhqvttudyjzq. Live snapshot captured 2026-10-02.
-- Only the auxiliary browse block changes. No RPC/DDL/schema reload.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  PERFORM 1 FROM public.auto_blocks WHERE name IN ('fb_rest_browse_feed','fb_rest_browse_rest') FOR UPDATE;
  PERFORM 1 FROM public.auto_workflows WHERE name='fb_campaign_rest_browse' FOR SHARE;
  IF (SELECT md5(to_jsonb(b)::text) FROM public.auto_blocks b WHERE id=2830 AND name='fb_rest_browse_feed') IS DISTINCT FROM '79c94bb5bcfd452405d5b159f6cdfa6e'
    OR (SELECT md5(to_jsonb(b)::text) FROM public.auto_blocks b WHERE id=2831 AND name='fb_rest_browse_rest') IS DISTINCT FROM 'bba6a863421285ba260484df54aa9f0d'
    OR (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=314 AND name='fb_campaign_rest_browse') IS DISTINCT FROM 'bd8d1fbe0a450e1549fe5e74c62c7c80' THEN
    RAISE EXCEPTION 'v338 preflight: live auxiliary definitions changed; capture and review again';
  END IF;
END $preflight$;

UPDATE public.auto_blocks SET code=$browse$
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
const between = (min, max) => helpers.randomBetween(min, max);
// Keep the exact DOM post across reading pauses. If it disappeared, skip it;
// never re-resolve a numeric index and act on a different post after the delay.
const currentPostScript = `
  const post = window.__akaRestBrowsePost;
  if (!post || !post.isConnected || !post.getClientRects().length) return null;
  function first(xpath) {
    if (!xpath) return null;
    try { return document.evaluate(xpath, post, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch { return null; }
  }
`;
for (const segment of segments) {
  const until = Math.min(Number(segment.until), Number(vars.restBrowseUntil));
  const remaining = () => Math.max(0, until - Date.now());
  const active = () => !signal.aborted && Number.isFinite(until) && remaining() > 0;
  const pause = async ms => {
    if (!active()) return false;
    await helpers.sleep(Math.min(ms, remaining()), signal);
    return active();
  };
  if (!active()) continue;
  try {
    helpers.log(segment.home ? 'Lướt trang chủ Facebook.' : 'Lướt group/profile/page vừa xử lý.');
    await page.navigate(segment.url);
    if (!await pause(between(2000, 4000))) continue;
    // Only the home phase opens notifications, once, with time to view and return.
    if (segment.home && selectors.notifications && remaining() > 15000) {
      const opened = await page.evaluate(`
        try {
          const button = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!button || !button.getClientRects().length) return false;
          button.click(); return true;
        } catch { return false; }
      `, selectors.notifications);
      if (opened) {
        if (!await pause(between(3000, 5000))) continue;
        await page.navigate('https://www.facebook.com/');
        if (!await pause(between(2000, 4000))) continue;
      }
    }
    let cursor = 0;
    while (active()) {
      // Do not rush another interaction into the final seconds of a segment.
      if (remaining() < 6000) { await pause(remaining()); break; }
      const item = await page.evaluate(`
        const selector = __args[0], cursor = Number(__args[1]);
        let posts = [];
        if (selector) {
          try {
            const found = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < found.snapshotLength; i++) {
              const post = found.snapshotItem(i);
              if (post && post.getClientRects().length) posts.push(post);
            }
          } catch {}
        }
        const post = posts[cursor];
        window.__akaRestBrowsePost = post || null;
        if (!post) {
          window.scrollBy({ top: Math.max(240, window.innerHeight * Number(__args[2])), behavior: 'smooth' });
          return { next: cursor, found: false };
        }
        post.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { next: cursor + 1, found: true };
      `, segment.home ? selectors.home_post : selectors.target_post, cursor, between(35, 65) / 100);
      cursor = Number(item.next || cursor);
      if (!await pause(between(800, 1500))) break;
      if (!item.found) { await pause(between(4000, 8000)); continue; }

      const readMs = between(4000, 8000);
      const beforeMoreMs = between(2000, 4000);
      if (!await pause(beforeMoreMs)) break;
      let expanded = false;
      if (selectors.see_more && remaining() > 8000 && Math.random() < 0.4) {
        expanded = await page.evaluate(currentPostScript + `
          const more = first(__args[0]);
          if (!more || !more.getClientRects().length) return false;
          more.click(); return true;
        `, selectors.see_more);
      }
      if (!await pause(expanded ? between(3000, 6000) : readMs - beforeMoreMs)) break;

      // Most posts are read without opening their photo. Viewing is optional.
      if (selectors.photo && remaining() > 15000 && Math.random() < 0.25) {
        const itemPhoto = await page.evaluate(currentPostScript + `
          const photo = first(__args[0]);
          return { photo: photo ? photo.href : '', scrollY: window.scrollY };
        `, selectors.photo);
        let photoUrl = null;
        try {
          const candidate = new URL(itemPhoto && itemPhoto.photo);
          if (candidate.protocol === 'https:' && /(^|\.)facebook\.com$/i.test(candidate.hostname) &&
            !candidate.username && !candidate.password && /^\/(photo\/|photo\.php|photos\/)/.test(candidate.pathname)) photoUrl = candidate.href;
        } catch {}
        if (photoUrl && !viewedPhotos.has(photoUrl) && active()) {
          viewedPhotos.add(photoUrl);
          try {
            await page.navigate(photoUrl);
            if (!await pause(between(3000, 6000))) break;
          } catch {}
          if (!active()) break;
          await page.navigate(segment.url);
          if (!await pause(between(2000, 4000))) break;
          await page.evaluate('window.scrollTo({ top: Number(__args[0]) || 0, behavior: "smooth" })', itemPhoto.scrollY);
          if (!await pause(between(800, 1500))) break;
        }
      }
    }
  } catch {
    if (!signal.aborted) helpers.log('Bỏ qua thao tác lướt Facebook không thực hiện được.');
  }
}
return { ok: true };
$browse$, updated_at=now()
WHERE id=2830 AND name='fb_rest_browse_feed';

COMMIT;
