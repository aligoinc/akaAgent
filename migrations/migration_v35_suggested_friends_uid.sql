-- Add suggested-friends data source for facebook_message_uid campaigns.

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES (
  'fb_collect_suggested_friends',
  'Lấy danh sách profile từ trang đề xuất bạn bè Facebook.',
  'Users',
  'facebook',
  'js',
  NULL,
$block$
const rawCount = vars.suggestedFriendsCount ?? vars.count ?? input.suggestedFriendsCount ?? input.count ?? 10
const parsedCount = Math.floor(Number(rawCount))
const targetCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 10
const sourceUrl = 'https://www.facebook.com/friends/suggestions'
const linkXPath = "//*[@class='xu06os2 x1ok221b']//a[@role='link' and .//span]"

helpers.log('Mở trang đề xuất bạn bè Facebook')
helpers.log('Số lượng đề xuất cần lấy: ' + targetCount)
await page.navigate(sourceUrl)
await helpers.sleep(5000, signal)

function normalizeProfileUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    const url = new URL(value, 'https://www.facebook.com')
    if (!/(\.|^)facebook\.com$/i.test(url.hostname)) return ''
    if (/^(m|mbasic|mobile)\.facebook\.com$/i.test(url.hostname)) {
      url.hostname = 'www.facebook.com'
    }
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        key.startsWith('__') ||
        key === 'mibextid' ||
        key === 'ref' ||
        key === 'locale' ||
        key === 'sk'
      ) {
        url.searchParams.delete(key)
      }
    }
    const path = url.pathname.replace(/\/+$/g, '')
    if (!path || path === '/friends' || path.startsWith('/friends/')) return ''
    if (path.startsWith('/groups/') || path.startsWith('/pages/') || path.startsWith('/watch')) return ''
    return url.toString().replace(/\/+$/g, '')
  } catch {
    return ''
  }
}

const collected = []
const seen = new Set()
let stableScrolls = 0
let previousCount = 0

while (collected.length < targetCount && stableScrolls < 3) {
  if (signal.aborted) throw new Error('Đã dừng lấy đề xuất bạn bè')

  const batch = await page.evaluate(`
    const limit = Number(__args[0]) || 10;
    const xpath = __args[1];

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function collectLinks() {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const links = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        const a = result.snapshotItem(i);
        if (!a || !isVisible(a)) continue;
        const span = a.querySelector('span');
        const rawName = span ? (span.innerText || span.textContent || '') : '';
        const name = String(rawName || '').split('\\n')[0].trim();
        const href = a.href || a.getAttribute('href') || '';
        if (!href) continue;
        links.push({ name, uid: href });
      }
      return links.slice(0, limit * 3);
    }

    function getLastLink() {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = result.snapshotLength - 1; i >= 0; i--) {
        const node = result.snapshotItem(i);
        if (node && isVisible(node)) return node;
      }
      return result.snapshotItem(result.snapshotLength - 1);
    }

    function getScrollableAncestor(el) {
      let node = el ? el.parentElement : null;
      while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY || '';
        if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 40) {
          return node;
        }
        node = node.parentElement;
      }
      return document.scrollingElement || document.documentElement || document.body;
    }

    function scrollTarget(target, amount) {
      if (!target) return;
      if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
        window.scrollBy(0, amount);
        document.dispatchEvent(new Event('scroll', { bubbles: true }));
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
      target.scrollTop = Math.min(target.scrollHeight, target.scrollTop + amount);
      target.dispatchEvent(new Event('scroll', { bubbles: true }));
    }

    const links = collectLinks();
    const amount = Math.max(900, Math.floor((window.innerHeight || 800) * 0.95));
    const last = getLastLink();
    if (last && typeof last.scrollIntoView === 'function') {
      last.scrollIntoView({ block: 'end', inline: 'nearest' });
      const scroller = getScrollableAncestor(last);
      scrollTarget(scroller, amount);
    }
    scrollTarget(document.scrollingElement || document.documentElement || document.body, amount);
    try {
      window.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: amount,
        view: window
      }));
    } catch {
      window.dispatchEvent(new Event('wheel', { bubbles: true, cancelable: true }));
    }
    return links;
  `, targetCount, linkXPath)

  for (const item of Array.isArray(batch) ? batch : []) {
    const uid = normalizeProfileUrl(item && item.uid)
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    collected.push({
      name: String((item && item.name) || '').trim(),
      uid
    })
    if (collected.length >= targetCount) break
  }

  if (collected.length >= targetCount) break
  if (collected.length <= previousCount) stableScrolls += 1
  else stableScrolls = 0
  previousCount = collected.length

  helpers.log('Đã thấy ' + collected.length + '/' + targetCount + ' đề xuất')
  await helpers.sleep(3000, signal)
}

const suggestedProfiles = collected.slice(0, targetCount)
helpers.log('Đã lấy ' + suggestedProfiles.length + ' đề xuất bạn bè')
return {
  suggestedProfiles,
  requestedCount: targetCount
}
$block$,
  '[{"name":"count","type":"number","label":"Số lượng","required":false,"default":10}]'::jsonb,
  '[
    {"name":"suggestedProfiles","type":"array","label":"Danh sách profile"},
    {"name":"requestedCount","type":"number","label":"Số lượng yêu cầu"}
  ]'::jsonb,
  '{"count":10}'::jsonb,
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
  system_type = EXCLUDED.system_type,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
