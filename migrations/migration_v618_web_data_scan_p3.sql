-- V618 p3: dữ liệu quét data website (công tắc, mã thao tác, loại chiến dịch, block, element, mã lỗi, chính sách). SINH TỪ scripts/build-v618-sql.cjs, không sửa tay.
-- Chỉ dữ liệu, không DDL. Loại chiến dịch chèn is_active = false (Desktop đang phát hành coi nền tảng lạ là Facebook); Desktop mới đọc riêng
-- ba loại này khi tổ chức bật web_scan.campaigns. Câu cho khách của WB01–WB04 là bản nháp, anh duyệt lúc thử thật. Gỡ: rollback_v618_web_data_scan_p3.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v618_web_data_scan_p3') THEN
      RAISE EXCEPTION 'V618 p3 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_web_scan_org_enabled(bigint)') IS NULL THEN RAISE EXCEPTION 'V618 p3: chưa apply p2'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web_scan.campaigns')
     OR EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE id LIKE 'web\_find\_data\_%')
     OR EXISTS (SELECT 1 FROM public.auto_account_actions WHERE code LIKE 'web\_%')
     OR EXISTS (SELECT 1 FROM public.auto_blocks WHERE name LIKE '[engine] web\_%')
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name LIKE 'web\_%')
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code LIKE 'err\_web\_scan\_%' OR public_code LIKE 'WB%') THEN
    RAISE EXCEPTION 'V618 p3: đã có dữ liệu quét data website (lần chạy trước để lại?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE code = 'campaign_detail_failed' AND component_type = 'campaign_detail') THEN
    RAISE EXCEPTION 'V618 p3: không thấy trạng thái campaign_detail_failed';
  END IF;
END $pre$;

-- 1. Công tắc (anh chốt 21/11/2026: chỉ tổ chức 1 thấy lúc đầu; giới hạn chung 100 / ngày, trần 500, nghỉ 15 giây, thấp nhất 10).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('web_scan.campaigns', '{"organizationIds":[1],"limits":{"defaultDaily":100,"maxDaily":500,"defaultSleepSeconds":15,"minSleepSeconds":10},"batdongsanLoginCookies":[]}',
  'Quét data website (nhatot, batdongsan, Trang Vàng): organizationIds = tổ chức thấy tài khoản Website + 3 loại chiến dịch Tìm data (hoặc "mode": "all"); limits = mặc định / trần giới hạn ngày và thời gian nghỉ; batdongsanLoginCookies = tên cookie báo đã đăng nhập batdongsan (điền sau khi thử thật).',
  false, true);

-- 2. Mã thao tác (loại read: không phải gửi tin, không có dấu "sắp gửi").
INSERT INTO public.auto_account_actions (flatform_type, name, code, is_active, is_delete, operation_class) VALUES
  ('web', 'Hiện SĐT Nhà Tốt', 'web_nhatot_phone', true, false, 'read'),
  ('web', 'Hiện SĐT Batdongsan', 'web_batdongsan_phone', true, false, 'read'),
  ('web', 'Mở trang Trang Vàng', 'web_yellowpages_page', true, false, 'read');

-- 3. Loại chiến dịch (tắt sẵn, xem đầu file).
INSERT INTO public.auto_campaign_actions (id, name, flatform_type, is_active, is_delete, workflow_id, limit_check_action_codes, allow_multiple_accounts,
  allow_secondary_account, show_staff_delivery_cooldown) VALUES
  ('web_find_data_nhatot', 'Tìm data Nhà Tốt', 'web', false, false, NULL, ARRAY['web_nhatot_phone']::text[], true, false, false),
  ('web_find_data_batdongsan', 'Tìm data Batdongsan', 'web', false, false, NULL, ARRAY['web_batdongsan_phone']::text[], true, false, false),
  ('web_find_data_yellowpages', 'Tìm data Trang Vàng', 'web', false, false, NULL, ARRAY['web_yellowpages_page']::text[], true, false, false);

-- 4. Block (code ở scripts/web-scan/blocks; sửa khi trang đổi giao diện thì sửa ở đó rồi viết migration mới).
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_nhatot_list', 'Mở một trang kết quả tìm kiếm của nhatot theo từ khoá (mua bán / cho thuê) và đọc 20 tin từ dữ liệu nhúng của trang.', 'List', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/nhatot-list.block.js (+ block-common.js, nhatot-list.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Mở một trang kết quả tìm kiếm của nhatot (mua bán hoặc cho thuê) theo từ khoá và đọc 20 tin. Chỉ đọc, không bấm gì.
// input: keyword, section ('sale' | 'rent'), page (1…), waitMs. Trả: items[{ listingKey, link, name, isBroker, fields }], total, hasMore,
// challenge (trang đòi xác minh), layoutChanged (không còn dữ liệu nhúng như trước).
const keyword = String(input.keyword || '').trim();
if (!keyword) throw new Error('Thiếu từ khoá');
const section = input.section === 'rent' ? 'rent' : 'sale';
const pageNo = Math.max(1, Math.floor(Number(input.page) || 1));
const waitMs = Number(input.waitMs) || 30000;
const base = section === 'rent' ? 'https://www.nhatot.com/thue-bat-dong-san' : 'https://www.nhatot.com/mua-ban-bat-dong-san';
const url = base + '?q=' + encodeURIComponent(keyword) + (pageNo > 1 ? '&page=' + pageNo : '');
await page.open(url, waitMs);
const result = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst pageNo = Math.max(1, Number(__args[0]) || 1);\nconst title = norm(document.title).slice(0, 120);\nif (isChallenge()) return { pending: true, challenge: true, items: [], total: 0, title };\nlet data = null;\nconst el = document.getElementById('__NEXT_DATA__');\nif (el) { try { data = JSON.parse(el.textContent); } catch (error) { data = null; } }\nif (!data) return { pending: true, items: [], total: 0, title };\nconst listing = data && data.props && data.props.initialState && data.props.initialState.adlisting;\nconst ads = listing && listing.data && Array.isArray(listing.data.ads) ? listing.data.ads : null;\nif (!ads) return { layoutChanged: true, items: [], total: 0, title: norm(document.title).slice(0, 120) };\nconst total = Number(listing.data.total) || 0;\nconst anchors = Array.from(document.querySelectorAll('a[href*=\".htm\"]')).map(a => a.href);\nconst items = [];\nfor (const ad of ads) {\n  if (!ad || !ad.list_id) continue;\n  const id = String(ad.list_id);\n  const link = anchors.find(href => href.indexOf('/' + id + '.htm') >= 0) || ('https://www.nhatot.com/mua-ban-bat-dong-san/' + id + '.htm');\n  const params = Array.isArray(ad.params) ? ad.params : [];\n  const param = key => { const p = params.find(x => x && x.id === key); return p ? norm(p.value) : ''; };\n  const address = [ad.street_name, ad.ward_name, ad.area_name, ad.region_name].map(norm).filter(Boolean).join(', ');\n  const rooms = [ad.rooms ? ad.rooms + ' PN' : '', param('toilets'), param('floors')].filter(Boolean).join(' · ');\n  items.push({\n    listingKey: id,\n    link: link.split('#')[0].split('?')[0],\n    name: norm(ad.account_name || ad.full_name),\n    isBroker: !!ad.company_ad,\n    fields: {\n      title: norm(ad.subject),\n      price: norm(ad.price_string),\n      area: ad.size ? norm(ad.size + ' ' + (ad.size_unit_string || 'm²')) : '',\n      propertyType: [norm(ad.category_name), param('house_type')].filter(Boolean).join(' · '),\n      postedAt: formatDate(ad.list_time || ad.orig_list_time) || norm(ad.date),\n      rooms,\n      pricePerM2: ad.price_million_per_m2 ? (Math.round(Number(ad.price_million_per_m2) * 100) / 100).toString().replace('.', ',') + ' triệu/m²' : '',\n      project: norm(ad.pty_project_name),\n      coordinates: ad.latitude && ad.longitude ? ad.latitude + ', ' + ad.longitude : '',\n      description: norm(ad.body).slice(0, 1000),\n      address,\n      posterType: ad.company_ad ? 'Môi giới' : 'Cá nhân'\n    }\n  });\n}\nreturn { items, total, hasMore: pageNo * 20 < total && items.length > 0, title: norm(document.title).slice(0, 120) };\n", waitMs, pageNo);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ url, section, page: pageNo }, result);
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_nhatot_reveal', 'Mở trang một tin nhatot, đọc thêm thông tin và bấm "Hiện SĐT" (một lượt "Hiện SĐT Nhà Tốt").', 'Phone', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/nhatot-reveal.block.js (+ block-common.js, nhatot-reveal.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Mở trang một tin nhatot, đọc thêm thông tin của tin rồi bấm "Hiện SĐT" (mỗi lần bấm tính một lượt "Hiện SĐT nhatot").
// input: link, waitMs. Trả: phone | hidden (người bán ẩn số) | noButton | noPhone | challenge | layoutChanged, kèm name, fields.
const link = String(input.link || '').trim();
if (!/^https:\/\/(www\.)?nhatot\.com\//i.test(link)) throw new Error('Link tin nhatot không hợp lệ');
const waitMs = Number(input.waitMs) || 30000;
await page.open(link, waitMs);
const button = await helpers.element('web_nhatot_phone_button');
const value = await helpers.element('web_nhatot_phone_value');
const result = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst buttonSelector = String(__args[0] || '');\nconst valueSelector = String(__args[1] || '');\nif (isChallenge()) return { pending: true, challenge: true, title: norm(document.title).slice(0, 120) };\nlet data = null;\nconst dataEl = document.getElementById('__NEXT_DATA__');\nif (dataEl) { try { data = JSON.parse(dataEl.textContent); } catch (error) { data = null; } }\nif (!data) return { pending: true, title: norm(document.title).slice(0, 120) };\nconst info = data.props && data.props.initialState && data.props.initialState.adView && data.props.initialState.adView.adInfo;\nconst ad = info && info.ad;\nif (!ad) return { layoutChanged: true, title: norm(document.title).slice(0, 120) };\nconst parameters = Array.isArray(info.parameters) ? info.parameters : [];\nconst byId = id => { const p = parameters.find(x => x && x.id === id); return p ? norm(p.value) : ''; };\nconst byLabel = re => { const p = parameters.find(x => x && re.test(String(x.label || ''))); return p ? norm(p.value) : ''; };\nconst address = byId('address') || [ad.street_name, ad.ward_name, ad.area_name, ad.region_name].map(norm).filter(Boolean).join(', ');\nconst width = byLabel(/ngang/i);\nconst length = byLabel(/dài/i);\nconst fields = {\n  address,\n  dimensions: width || length ? [width, length].filter(Boolean).join(' × ') : '',\n  direction: byLabel(/hướng/i),\n  legal: byLabel(/pháp lý|giấy tờ/i),\n  furniture: byLabel(/nội thất/i),\n  rooms: [byLabel(/phòng ngủ/i), byLabel(/vệ sinh|toilet/i), byLabel(/số tầng|tổng số tầng/i)].filter(Boolean).join(' · '),\n  area: byLabel(/diện tích/i),\n  propertyType: [norm(ad.category_name), byLabel(/loại hình/i)].filter(Boolean).join(' · '),\n  description: norm(ad.body).slice(0, 1000)\n};\nconst name = norm(ad.account_name || ad.full_name);\nconst pageText = () => norm(document.body ? document.body.innerText : '');\nconst fullPhone = text => {\n  const compact = String(text || '').replace(/[\\s.\\-]/g, '');\n  if (/\\*/.test(compact)) return '';\n  const match = compact.match(/(?:\\+?84|0)\\d{8,10}/);\n  return match ? normalizeAnyPhone(match[0]) : '';\n};\nconst hydrated = el => Object.keys(el).some(key => key.indexOf('__reactProps') === 0 || key.indexOf('__reactFiber') === 0);\nlet button = null;\nfor (let i = 0; i < 30; i++) {\n  const found = findAll(buttonSelector).find(visible) || null;\n  if (found && hydrated(found)) { button = found; break; }\n  if (found && i >= 24) { button = found; break; }\n  await delay(500);\n}\nif (!button) return /ẩn số điện thoại/i.test(pageText()) ? { hidden: true, name, fields } : { noButton: true, name, fields };\nbutton.click();\nfor (let i = 0; i < 20; i++) {\n  await delay(500);\n  for (const el of findAll(valueSelector).concat(findAll(buttonSelector))) {\n    const phone = fullPhone(el.innerText || el.textContent);\n    if (phone) return { phone, clicked: true, name, fields };\n  }\n  if (isChallenge()) return { challenge: true, clicked: true, name, fields };\n}\nreturn { noPhone: true, clicked: true, name, fields };\n", waitMs, button, value);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ link }, result);
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_batdongsan_search', 'Gõ từ khoá vào ô tìm của batdongsan (mục bán hoặc cho thuê), bấm Tìm kiếm, ghi trang kết quả trang chọn.', 'Search', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/batdongsan-search.block.js (+ block-common.js, batdongsan-search.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Tìm trên batdongsan bằng ô tìm của chính trang (trang chỉ hiểu địa điểm / dự án): mở mục bán hoặc cho thuê, gõ từ khoá, bấm "Tìm kiếm",
// ghi lại trang kết quả trang chọn. input: keyword, section ('sale' | 'rent'), waitMs. Trả: url, title, total, resolved, suggestions, challenge.
const keyword = String(input.keyword || '').trim();
if (!keyword) throw new Error('Thiếu từ khoá');
const section = input.section === 'rent' ? 'rent' : 'sale';
const base = section === 'rent' ? 'https://batdongsan.com.vn/nha-dat-cho-thue' : 'https://batdongsan.com.vn/nha-dat-ban';
const waitMs = Number(input.waitMs) || 30000;
const inputSelector = await helpers.element('web_bds_search_input');
const buttonSelector = await helpers.element('web_bds_search_button');
await page.open(base, waitMs);
const ready = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst inputSelector = String(__args[0] || '');\nconst title = norm(document.title).slice(0, 120);\nif (isChallenge()) return { pending: true, challenge: true, title };\nif (document.readyState === 'loading' || !document.body) return { pending: true, title };\nif (!findOne(inputSelector)) return { pending: true, title };\nreturn { ok: true, title };\n", waitMs, inputSelector);
if (ready.challenge) return { challenge: true, url: base, title: ready.title };
if (!ready.ok) return { layoutChanged: true, url: base, title: ready.title };
const typed = await page.evaluate("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst el = findOne(String(__args[0] || ''));\nconst text = String(__args[1] || '');\nif (!el) return { noInput: true };\nel.scrollIntoView({ block: 'center' });\nel.focus();\nel.click();\nconst setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;\nsetter.call(el, '');\nel.dispatchEvent(new Event('input', { bubbles: true }));\nfor (let i = 1; i <= text.length; i++) {\n  setter.call(el, text.slice(0, i));\n  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text[i - 1], inputType: 'insertText' }));\n  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text[i - 1] }));\n  await delay(110);\n}\nawait delay(2500);\nconst suggestions = Array.from(document.querySelectorAll('[class*=\"suggest\"] li, [class*=\"Suggest\"] li')).map(li => norm(li.innerText)).filter(Boolean).slice(0, 5);\nreturn { value: el.value, suggestions };\n", inputSelector, keyword);
if (typed && typed.noInput) return { layoutChanged: true, url: base };
helpers.log('gợi ý: ' + ((typed && typed.suggestions) || []).join(' | '));
await page.click(buttonSelector);
// Chờ trang chuyển sang trang kết quả trang chọn (script kiểm ngắn từng lần, không chờ bằng sự kiện tải xong của trang cũ).
const result = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst base = String(__args[0] || '');\nconst clean = value => String(value || '').split('#')[0].split('?')[0].replace(/\\/+$/, '');\nif (isChallenge()) return { pending: true, challenge: true, title: norm(document.title).slice(0, 160) };\nif (clean(location.href) === clean(base)) return { pending: true, stayed: true };\nif (document.readyState === 'loading' || !document.querySelector('h1')) return { pending: true };\nconst totalEl = Array.from(document.querySelectorAll('span, div, p')).find(el => el.children.length === 0 && /^Hiện có [\\d.,]+ bất động sản/i.test(norm(el.textContent)));\nconst total = totalEl ? Number(norm(totalEl.textContent).replace(/^Hiện có ([\\d.,]+).*$/i, '$1').replace(/[.,]/g, '')) || 0 : 0;\nconst heading = document.querySelector('h1');\nreturn { url: clean(location.href), title: norm(heading ? heading.textContent : document.title).slice(0, 160), total };\n", Math.min(waitMs, 20000), base);
if (result.challenge) return { challenge: true, url: base, title: result.title };
if (!result.url) return { section, keyword, url: base, resolved: false, suggestions: (typed && typed.suggestions) || [] };
return Object.assign({ section, keyword, resolved: true, suggestions: (typed && typed.suggestions) || [] }, result);
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_batdongsan_list', 'Mở một trang danh sách batdongsan và đọc các thẻ tin.', 'List', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/batdongsan-list.block.js (+ block-common.js, batdongsan-list.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Mở một trang danh sách batdongsan (trang kết quả tìm, thêm /pN cho trang sau) và đọc các thẻ tin. Chỉ đọc, không bấm gì.
// input: url (trang kết quả tìm), page, waitMs. Trả: items[{ listingKey, link, name, hasPhoneButton, fields }], hasMore, challenge, empty,
// layoutChanged.
const baseUrl = String(input.url || '').replace(/\/+$/, '').replace(/\/p\d+$/, '');
if (!/^https:\/\/batdongsan\.com\.vn\//i.test(baseUrl)) throw new Error('Link trang batdongsan không hợp lệ');
const pageNo = Math.max(1, Math.floor(Number(input.page) || 1));
const waitMs = Number(input.waitMs) || 30000;
const url = pageNo > 1 ? baseUrl + '/p' + pageNo : baseUrl;
await page.open(url, waitMs);
const card = await helpers.element('web_bds_card');
const phone = await helpers.element('web_bds_phone_button');
const result = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst cardSelector = String(__args[0] || '');\nconst phoneSelector = String(__args[1] || '');\nconst title = norm(document.title).slice(0, 120);\nif (isChallenge()) return { pending: true, challenge: true, items: [], title };\nif (document.readyState === 'loading') return { pending: true, items: [], title };\nconst cards = findAll(cardSelector);\nconst emptyText = /không tìm thấy|chưa có tin|0 bất động sản/i.test(norm(document.body ? document.body.innerText : '').slice(0, 20000));\nif (cards.length === 0) return emptyText ? { items: [], empty: true, title } : { pending: true, items: [], title };\nconst text = (card, selector) => { const el = card.querySelector(selector); return el ? norm(el.textContent) : ''; };\nconst items = [];\nfor (const card of cards) {\n  const id = norm(card.getAttribute('prid'));\n  if (!id) continue;\n  const anchor = card.querySelector('a[href]');\n  const button = findOne(phoneSelector, card);\n  const agent = card.querySelector('.agent-name');\n  items.push({\n    listingKey: id,\n    link: anchor ? anchor.href.split('#')[0].split('?')[0] : '',\n    name: norm((button && button.getAttribute('data-kyc-name')) || (agent && agent.textContent)),\n    hasPhoneButton: !!button,\n    fields: {\n      title: text(card, '.js__card-title, .pr-title'),\n      price: text(card, '.re__card-config-price'),\n      area: text(card, '.re__card-config-area'),\n      pricePerM2: text(card, '.re__card-config-price_per_m2'),\n      rooms: [text(card, '.re__card-config-bedroom') ? text(card, '.re__card-config-bedroom') + ' PN' : '',\n        text(card, '.re__card-config-toilet') ? text(card, '.re__card-config-toilet') + ' WC' : ''].filter(Boolean).join(' · '),\n      province: text(card, '.re__card-location'),\n      postedAt: text(card, '.re__card-published-info-published-at').replace(/^Đăng\\s*/i, ''),\n      listingTier: norm(card.getAttribute('vtp')),\n      description: text(card, '.re__card-description').slice(0, 1000)\n    }\n  });\n}\nconst next = Array.from(document.querySelectorAll('[class*=pagination] a[href]')).some(a => /\\/p\\d+/.test(a.getAttribute('href') || '') && /next|icon/i.test(a.className + ' ' + (a.getAttribute('aria-label') || '')));\nreturn { items, hasMore: next || items.length >= 20, title: norm(document.title).slice(0, 120) };\n", waitMs, card, phone);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ url, page: pageNo }, result);
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_batdongsan_reveal', 'Bấm "Hiện số" trên một thẻ tin batdongsan (cần đăng nhập batdongsan; một lượt "Hiện SĐT Batdongsan").', 'Phone', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/batdongsan-reveal.block.js (+ block-common.js, batdongsan-reveal.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Bấm "Hiện số" trên một thẻ tin của trang danh sách batdongsan đang mở (cần tài khoản batdongsan đã đăng nhập trong trình duyệt của tài khoản
// Website; mỗi lần bấm tính một lượt "Hiện SĐT Batdongsan"). input: listingKey. Trả: phone | loginRequired | noButton | noPhone | notFound | challenge.
const listingKey = String(input.listingKey || '').trim();
if (!listingKey) throw new Error('Thiếu mã tin');
const card = await helpers.element('web_bds_card');
const phone = await helpers.element('web_bds_phone_button');
const login = await helpers.element('web_bds_login_gate');
const result = await page.evaluate("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst listingKey = String(__args[0] || '');\nconst cardSelector = String(__args[1] || '');\nconst phoneSelector = String(__args[2] || '');\nconst loginSelector = String(__args[3] || '');\nif (isChallenge()) return { challenge: true };\nconst card = findAll(cardSelector).find(el => norm(el.getAttribute('prid')) === listingKey);\nif (!card) return { notFound: true };\nconst button = findOne(phoneSelector, card);\nif (!button) return { noButton: true };\nconst fullPhone = value => {\n  const compact = String(value || '').replace(/[\\s.\\-·]/g, '');\n  if (/\\*/.test(compact)) return '';\n  const match = compact.match(/(?:\\+?84|0)\\d{8,10}/);\n  return match ? normalizeAnyPhone(match[0]) : '';\n};\nbutton.scrollIntoView({ block: 'center' });\nbutton.click();\nfor (let i = 0; i < 20; i++) {\n  await delay(500);\n  if (findAll(loginSelector).some(visible)) return { loginRequired: true, clicked: true };\n  const phone = fullPhone(button.innerText || button.textContent) || fullPhone(button.getAttribute('mobile') || button.getAttribute('data-phone'));\n  if (phone) return { phone, clicked: true };\n  if (isChallenge()) return { challenge: true, clicked: true };\n}\nreturn { noPhone: true, clicked: true };\n", listingKey, card, phone, login);
return Object.assign({ listingKey }, result || {});
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_batdongsan_detail', 'Mở trang một tin batdongsan để lấy địa chỉ đầy đủ và đặc điểm.', 'FileText', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/batdongsan-detail.block.js (+ block-common.js, batdongsan-detail.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Mở trang một tin batdongsan để lấy thêm địa chỉ đầy đủ và đặc điểm (khi chiến dịch bật "Mở trang tin"). Chỉ đọc. input: link, waitMs.
const link = String(input.link || '').trim();
if (!/^https:\/\/batdongsan\.com\.vn\//i.test(link)) throw new Error('Link tin batdongsan không hợp lệ');
const waitMs = Number(input.waitMs) || 30000;
await page.open(link, waitMs);
const result = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nif (isChallenge()) return { pending: true, challenge: true };\nif (document.readyState === 'loading') return { pending: true };\nconst pairs = [];\nfor (const el of document.querySelectorAll('[class*=\"specs-content-item\"], [class*=\"short-info-item\"], [class*=\"pr-short-info\"] > *')) {\n  const children = Array.from(el.children).map(c => norm(c.textContent)).filter(Boolean);\n  if (children.length >= 2) pairs.push([children[0], children.slice(1).join(' ')]);\n}\nconst pick = re => { const p = pairs.find(x => re.test(x[0])); return p ? p[1] : ''; };\nconst addressEl = document.querySelector('.re__pr-short-description, .js__pr-address, [class*=\"address-line\"]');\nconst lines = Array.from(document.querySelectorAll('[class*=\"address-line\"]')).map(el => norm(el.textContent)).filter(Boolean);\nconst project = document.querySelector('.re__project-title, [class*=\"project-name\"]');\nreturn { fields: {\n  address: lines.join(', ') || (addressEl ? norm(addressEl.textContent) : ''),\n  frontage: [pick(/mặt tiền/i), pick(/đường vào/i)].filter(Boolean).join(' · '),\n  floors: pick(/số tầng/i),\n  direction: [pick(/hướng nhà/i), pick(/hướng ban công/i)].filter(Boolean).join(' · '),\n  legal: pick(/pháp lý/i),\n  furniture: pick(/nội thất/i),\n  expiresAt: pick(/ngày hết hạn/i),\n  project: project ? norm(project.textContent) : pick(/dự án/i)\n} };\n", waitMs);
return Object.assign({ link }, result);
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_yellowpages_list', 'Mở một trang danh sách Trang Vàng và đọc các thẻ doanh nghiệp (một lượt "Mở trang Trang Vàng").', 'List', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/yellowpages-list.block.js (+ block-common.js, yellowpages-list.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Mở một trang danh sách Trang Vàng (trang tìm theo từ khoá / tỉnh, hoặc link ngành khách dán) và đọc các thẻ doanh nghiệp (mỗi lần mở tính một
// lượt "Mở trang Trang Vàng"). Chỉ đọc. input: url (trang 1), page, waitMs. Trả: items[{ listingKey, link, name, phones, mobiles, fields }],
// hasMore, challenge, empty, layoutChanged.
const raw = String(input.url || '').trim();
let target;
try { target = new URL(raw); } catch (error) { throw new Error('Link Trang Vàng không hợp lệ'); }
if (!/(^|\.)yellowpages\.vn$/i.test(target.hostname)) throw new Error('Link Trang Vàng không hợp lệ');
const pageNo = Math.max(1, Math.floor(Number(input.page) || 1));
const waitMs = Number(input.waitMs) || 30000;
if (pageNo > 1) target.searchParams.set('page', String(pageNo)); else target.searchParams.delete('page');
const url = target.toString();
await page.open(url, waitMs);
const card = await helpers.element('web_yp_card');
const result = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nconst cardSelector = String(__args[0] || '');\nconst pageNo = Math.max(1, Number(__args[1]) || 1);\nif (isChallenge()) return { pending: true, challenge: true, items: [], title: norm(document.title).slice(0, 120) };\nif (document.readyState === 'loading') return { pending: true, items: [], title: norm(document.title).slice(0, 120) };\nconst cards = findAll(cardSelector);\nif (cards.length === 0) {\n  const body = norm(document.body ? document.body.innerText : '').slice(0, 20000);\n  const empty = /không tìm thấy|không có kết quả|0 kết quả/i.test(body) || /Top 0 /i.test(document.title);\n  return empty ? { items: [], empty: true, title: norm(document.title).slice(0, 120) } : { pending: true, items: [], title: norm(document.title).slice(0, 120) };\n}\nconst SKIP_HOST = /(^|\\.)(yellowpages\\.vn|trangvangvietnam\\.com|zalo\\.me|facebook\\.com|google\\.[a-z.]+)$/i;\nconst items = [];\nfor (const card of cards) {\n  const nameLink = Array.from(card.querySelectorAll('a[href*=\"/lgs/\"]')).find(a => norm(a.textContent).length > 2);\n  if (!nameLink) continue;\n  const link = nameLink.href.split('#')[0].split('?')[0];\n  const id = (link.match(/\\/lgs\\/(\\d+)/) || [])[1] || link;\n  const phones = [];\n  for (const a of card.querySelectorAll('a[href^=\"tel:\"]')) {\n    const phone = normalizeAnyPhone(a.getAttribute('href').slice(4));\n    if (phone && !phones.includes(phone)) phones.push(phone);\n  }\n  const mail = card.querySelector('a[href^=\"mailto:\"]');\n  let website = '';\n  for (const a of card.querySelectorAll('a[href^=\"http\"]')) {\n    let host = '';\n    try { host = new URL(a.href).hostname; } catch (error) { continue; }\n    if (!SKIP_HOST.test(host)) { website = a.href; break; }\n  }\n  const province = card.querySelector('small .fw-semibold');\n  const addressEl = province ? province.closest('small') : null;\n  const clone = card.cloneNode(true);\n  clone.querySelectorAll('details, script, style').forEach(el => el.remove());\n  const lines = String(clone.innerText || '').split('\\n').map(norm).filter(Boolean);\n  const anchorLine = Math.max(\n    lines.findIndex(line => mail && line === norm(mail.textContent)),\n    lines.findIndex(line => website && line.toLowerCase().indexOf(website.replace(/^https?:\\/\\//i, '').replace(/\\/$/, '').toLowerCase()) >= 0));\n  const description = anchorLine >= 0 ? lines.slice(anchorLine + 1, anchorLine + 4).join(' ').slice(0, 1000) : '';\n  items.push({\n    listingKey: String(id),\n    link,\n    name: norm(nameLink.textContent),\n    phones,\n    mobiles: phones.filter(phone => normalizeMobile(phone)),\n    fields: {\n      address: addressEl ? norm(addressEl.textContent) : '',\n      email: mail ? norm(mail.getAttribute('href').slice(7).split('#')[0].split('?')[0]).toLowerCase() : '',\n      website,\n      verified: /Xác thực/.test(lines.join(' ')) ? 'Xác thực' : '',\n      description\n    }\n  });\n}\nconst hasMore = Array.from(document.querySelectorAll('a[href*=\"page=\"]')).some(a => {\n  const m = String(a.getAttribute('href') || '').match(/[?&]page=(\\d+)/);\n  return m && Number(m[1]) > pageNo;\n});\nreturn { items, hasMore, title: norm(document.title).slice(0, 120) };\n", waitMs, card, pageNo);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ url, page: pageNo }, result);
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] web_yellowpages_detail', 'Mở trang hồ sơ một doanh nghiệp Trang Vàng để lấy mã số thuế, loại hình… (một lượt "Mở trang Trang Vàng").', 'FileText', 'web', 'js', $wsblock$// Sinh từ scripts/web-scan/blocks/yellowpages-detail.block.js (+ block-common.js, yellowpages-detail.page.js), không sửa tay trong DB.
async function evaluateReady(script, waitMs, ...args) {
  const started = Date.now();
  for (;;) {
    const result = await page.evaluate(script, ...args);
    if (!result || !result.pending) return result || {};
    if (Date.now() - started >= waitMs) {
      const out = Object.assign({}, result, { timedOut: true });
      delete out.pending;
      return out;
    }
    await helpers.sleep(800, signal);
  }
}

// Mở trang hồ sơ một doanh nghiệp Trang Vàng để lấy thêm mã số thuế, loại hình… (khi chiến dịch bật "Mở trang chi tiết"; mỗi lần mở tính một
// lượt "Mở trang Trang Vàng"). Chỉ đọc. input: link, waitMs.
const link = String(input.link || '').trim();
if (!/^https:\/\/(www\.)?yellowpages\.vn\/lgs\//i.test(link)) throw new Error('Link hồ sơ Trang Vàng không hợp lệ');
const waitMs = Number(input.waitMs) || 30000;
await page.open(link, waitMs);
const result = await evaluateReady("function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }\nfunction norm(value) { return value == null ? '' : String(value).replace(/\\s+/g, ' ').trim(); }\nfunction isXpath(selector) { return /^\\s*(\\/|\\(|\\.\\/)/.test(String(selector || '')); }\nfunction findAll(selector, context) {\n  const root = context || document;\n  if (!selector) return [];\n  if (isXpath(selector)) {\n    const out = [];\n    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));\n    return out;\n  }\n  return Array.from(root.querySelectorAll(selector));\n}\nfunction findOne(selector, context) { return findAll(selector, context)[0] || null; }\nfunction visible(el) {\n  if (!el) return false;\n  const style = window.getComputedStyle(el);\n  if (style.display === 'none' || style.visibility === 'hidden') return false;\n  const rect = el.getBoundingClientRect();\n  return rect.width > 0 && rect.height > 0;\n}\nfunction isChallenge() {\n  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')\n    || !!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], [name=\"cf-turnstile-response\"], #challenge-form');\n}\nfunction normalizeMobile(value) {\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);\n  digits = digits.replace(/\\D/g, '');\n  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;\n  return /^0[35789]\\d{8}$/.test(digits) ? digits : '';\n}\nfunction normalizeAnyPhone(value) {\n  const mobile = normalizeMobile(value);\n  if (mobile) return mobile;\n  let digits = String(value || '').replace(/[^\\d+]/g, '');\n  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);\n  digits = digits.replace(/\\D/g, '');\n  return /^0\\d{9,10}$/.test(digits) ? digits : '';\n}\nfunction formatDate(ms) {\n  const n = Number(ms);\n  if (!Number.isFinite(n) || n <= 0) return '';\n  const d = new Date(n);\n  const pad = x => String(x).padStart(2, '0');\n  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();\n}\n\nif (isChallenge()) return { pending: true, challenge: true };\nif (document.readyState === 'loading' || !document.body) return { pending: true };\nconst lines = String(document.body ? document.body.innerText : '').split('\\n').map(norm).filter(Boolean);\nconst after = re => { const i = lines.findIndex(line => re.test(line)); return i >= 0 && i + 1 < lines.length ? lines[i + 1] : ''; };\nconst listAfter = (re, max) => {\n  const i = lines.findIndex(line => re.test(line));\n  if (i < 0) return '';\n  let j = i + 1;\n  if (j < lines.length && /^·\\s*\\d+/.test(lines[j])) j++;\n  return lines.slice(j, j + max).filter(line => !/^(Xem|Hình ảnh|Giới thiệu|Ngành nghề|Sản phẩm)/i.test(line)).join(', ').slice(0, 1000);\n};\nconst hotline = (lines.join(' ').match(/Hotline[:\\s]*([+\\d][\\d\\s.]{8,})/i) || [])[1] || '';\nreturn { fields: {\n  taxCode: after(/^MÃ SỐ THUẾ$/i),\n  taxAddress: after(/^ĐỊA CHỈ THEO MST$|^ĐỊA CHỈ THEO MÃ SỐ THUẾ$/i),\n  hotline: normalizeAnyPhone(hotline) || norm(hotline),\n  businessType: after(/^LOẠI HÌNH$/i),\n  market: after(/^THỊ TRƯỜNG$/i),\n  mainCustomers: after(/^KHÁCH HÀNG CHÍNH$/i),\n  businessLines: listAfter(/^Ngành nghề kinh doanh$/i, 1),\n  products: listAfter(/^Sản phẩm dịch vụ$/i, 20)\n} };\n", waitMs);
return Object.assign({ link }, result);
$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);

-- 5. Element (chỗ tìm phần tử; sửa ở màn Element khi trang đổi giao diện).
INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin) VALUES
  ('web_nhatot_phone_button', '//a[normalize-space(.)=''Hiện SĐT''] | //button[starts-with(normalize-space(.),''Hiện số'')]', 'nhatot: nút hiện số điện thoại trên trang tin', 'web', true),
  ('web_nhatot_phone_value', '//*[contains(@class,''InlineShowPhoneButton_wrapper'')]', 'nhatot: chỗ hiện số điện thoại sau khi bấm nút', 'web', true),
  ('web_bds_card', '//div[contains(concat('' '',normalize-space(@class),'' ''),'' js__card-listing '')]', 'batdongsan: thẻ tin ở trang danh sách', 'web', true),
  ('web_bds_phone_button', './/*[contains(concat('' '',normalize-space(@class),'' ''),'' js__card-phone-btn '')]', 'batdongsan: nút "Hiện số" trong thẻ tin (tìm trong thẻ)', 'web', true),
  ('web_bds_login_gate', '//*[contains(@class,''kyc-ui--login-gate'') or contains(@class,''re__login-gate-kyc'')]', 'batdongsan: hộp đăng nhập hiện ra khi chưa đăng nhập mà bấm hiện số', 'web', true),
  ('web_bds_search_input', '//input[@id=''SuggestionSearch'']', 'batdongsan: ô tìm kiếm', 'web', true),
  ('web_bds_search_button', '//form[contains(@class,''re__listing-search-box'')]//button[contains(normalize-space(.),''Tìm kiếm'')]', 'batdongsan: nút Tìm kiếm', 'web', true),
  ('web_yp_card', '//div[contains(concat('' '',normalize-space(@class),'' ''),'' ypx-card '')]', 'Trang Vàng: thẻ doanh nghiệp ở trang danh sách', 'web', true);

-- 6. Mã lỗi (câu cho khách: bản nháp).
INSERT INTO public.auto_error (error_type, error_name, error_desc, error_code, noti_running_process, noti_campaign, public_code, customer_title, customer_help,
  detail_status, counts_toward_limit, counts_toward_bad_target) VALUES
  ('engine', 'Trang web yêu cầu xác minh truy cập', 'V618: Trang (Cloudflare) đòi xác minh: tạm dừng chiến dịch, từ khoá về hàng đợi, không tính lượt.', 'err_web_scan_challenge', 'Trang web đang yêu cầu xác minh truy cập', 'Trang web đang yêu cầu xác minh truy cập', 'WB01', 'Trang web đang yêu cầu xác minh truy cập', 'Mở tab Website ở trang Trình duyệt, xác minh trên trang rồi bấm Tiếp tục chiến dịch', NULL, false, false),
  ('engine', 'Chưa đăng nhập batdongsan', 'V618: Bấm hiện số mà batdongsan hiện hộp đăng nhập: khoá riêng "Hiện SĐT Batdongsan" của tài khoản 30 phút rồi thử lại (anh chốt 21/11/2026: chiến dịch chờ, tự chạy khi đăng nhập; app chưa biết cookie nào báo đã đăng nhập nên thử lại theo giờ).', 'err_web_scan_batdongsan_login', 'Chưa đăng nhập trang batdongsan.com.vn', 'Chưa đăng nhập trang batdongsan.com.vn', 'WB02', 'Chưa đăng nhập trang batdongsan.com.vn', NULL, NULL, false, false),
  ('engine', 'Hết lượt trong hạn mức giữa một từ khoá', 'V618: Hết lượt hiện số / mở trang giữa một từ khoá: từ khoá về hàng đợi (lượt sau bỏ tin đã quét), lần nhận sau chờ theo hạn mức.', 'err_web_scan_quota_reached', 'Đã đủ số lượt trong hạn mức, từ khoá này quét tiếp ở lượt sau', 'Đã đủ số lượt trong hạn mức, từ khoá này quét tiếp ở lượt sau', 'WB03', 'Đã đủ số lượt trong hạn mức, từ khoá này quét tiếp ở lượt sau', NULL, NULL, false, false),
  ('engine', 'Không đọc được danh sách trên trang', 'V618: Trang danh sách không còn thẻ tin / dữ liệu như trước (thường là trang đổi giao diện): ghi lỗi, 3 từ khoá liền thì tạm dừng chiến dịch.', 'err_web_scan_layout_changed', 'Không đọc được danh sách trên trang', 'Không đọc được danh sách trên trang', 'WB04', 'Không đọc được danh sách trên trang', NULL, 'thất bại', false, false);

-- 7. Chính sách theo mã lỗi (mọi nơi chạy; mã chỉ do bộ quét web phát).
INSERT INTO public.auto_outcome_policies (error_code, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect,
  streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, lock_minutes, run_effect, pace_mode, campaign_effect, account_effect, login_effect,
  description, source) VALUES
  ('err_web_scan_challenge', NULL, 'suppress', 'Trang web đang yêu cầu xác minh truy cập', 'Trang web đang yêu cầu xác minh truy cập (WB01). Mở tab Website ở trang Trình duyệt, xác minh trên trang rồi bấm Tiếp tục chiến dịch', 'no_count', 'ignore', NULL, 'requeue', 'skip', '{}'::text[], 'fixed_minutes', NULL, 'end_unit', 'none', 'pause', 'none', 'none', '[V618] Trang (Cloudflare) đòi xác minh: tạm dừng chiến dịch, từ khoá về hàng đợi, không tính lượt.', 'v618'),
  ('err_web_scan_batdongsan_login', NULL, 'suppress', 'Chưa đăng nhập trang batdongsan.com.vn', 'Chưa đăng nhập trang batdongsan.com.vn (WB02).', 'no_count', 'ignore', NULL, 'requeue', 'skip', ARRAY['web_batdongsan_phone']::text[], 'fixed_minutes', 30, 'end_unit', 'none', 'none', 'none', 'none', '[V618] Bấm hiện số mà batdongsan hiện hộp đăng nhập: khoá riêng "Hiện SĐT Batdongsan" của tài khoản 30 phút rồi thử lại (anh chốt 21/11/2026: chiến dịch chờ, tự chạy khi đăng nhập; app chưa biết cookie nào báo đã đăng nhập nên thử lại theo giờ).', 'v618'),
  ('err_web_scan_quota_reached', NULL, 'suppress', 'Đã đủ số lượt trong hạn mức, từ khoá này quét tiếp ở lượt sau', 'Đã đủ số lượt trong hạn mức, từ khoá này quét tiếp ở lượt sau (WB03).', 'no_count', 'ignore', NULL, 'requeue', 'skip', '{}'::text[], 'fixed_minutes', NULL, 'end_unit', 'none', 'none', 'none', 'none', '[V618] Hết lượt hiện số / mở trang giữa một từ khoá: từ khoá về hàng đợi (lượt sau bỏ tin đã quét), lần nhận sau chờ theo hạn mức.', 'v618'),
  ('err_web_scan_layout_changed', (SELECT id FROM public.auto_status WHERE code = 'campaign_detail_failed' AND component_type = 'campaign_detail' ORDER BY id LIMIT 1), 'write', 'Không đọc được danh sách trên trang', 'Không đọc được danh sách trên trang (WB04).', 'no_count', 'increment', 3, 'complete', 'skip', '{}'::text[], 'fixed_minutes', NULL, 'continue', 'full', 'pause', 'none', 'none', '[V618] Trang danh sách không còn thẻ tin / dữ liệu như trước (thường là trang đổi giao diện): ghi lỗi, 3 từ khoá liền thì tạm dừng chiến dịch.', 'v618');

-- 8. Chặn theo thao tác: mỗi lần hiện SĐT / mở trang thành công tính một lượt, không đổi chuỗi data lỗi, không nghỉ sau từng lần.
INSERT INTO public.auto_outcome_policies (action_code, quota_effect, target_streak_effect, remaining_steps, run_effect, pace_mode, description, source) VALUES
  ('web_nhatot_phone', 'count', 'ignore', 'continue', 'continue', 'none', '[V618] Mỗi lần hiện sđt nhà tốt thành công tính một lượt hạn mức; không đổi chuỗi data lỗi, không nghỉ giữa các lần (nghỉ do block).', 'v618'),
  ('web_batdongsan_phone', 'count', 'ignore', 'continue', 'continue', 'none', '[V618] Mỗi lần hiện sđt batdongsan thành công tính một lượt hạn mức; không đổi chuỗi data lỗi, không nghỉ giữa các lần (nghỉ do block).', 'v618'),
  ('web_yellowpages_page', 'count', 'ignore', 'continue', 'continue', 'none', '[V618] Mỗi lần mở trang trang vàng thành công tính một lượt hạn mức; không đổi chuỗi data lỗi, không nghỉ giữa các lần (nghỉ do block).', 'v618');

-- 9. Đẩy SĐT tìm được sang chiến dịch "Nhắn tin theo SĐT" (đường đẩy V608 aka_agent_find_data_push_v1, như Tìm data Facebook): bật bằng
--    extra_settings.isFindPhone, chiến dịch đích ở extra_settings.findPhoneZaloMessagePhoneTargetCampaignIds. DB chưa có V608 thì bỏ qua.
DO $rules$
BEGIN
  IF to_regclass('public.auto_campaign_data_link_rules') IS NOT NULL THEN
    INSERT INTO public.auto_campaign_data_link_rules
      (source_action_id, output_kind, source_flag, link_field, target_action_id, data_type_category_item_id, value_column, label)
    SELECT r.source_action_id, 'phone', 'isFindPhone', 'findPhoneZaloMessagePhoneTargetCampaignIds', 'zalo_message_phone', ci.id, 'phone', 'SĐT'
      FROM (VALUES ('web_find_data_nhatot'), ('web_find_data_batdongsan'), ('web_find_data_yellowpages')) AS r(source_action_id)
      JOIN public.category_type AS ct ON ct.code = 'data_type'
      JOIN public.category_item AS ci ON ci.category_type_id = ct.id AND ci.code = 'phone';
    IF (SELECT count(*) FROM public.auto_campaign_data_link_rules WHERE source_action_id LIKE 'web\_find\_data\_%') <> 3 THEN
      RAISE EXCEPTION 'V618 p3: quy tắc đẩy SĐT';
    END IF;
  END IF;
END $rules$;

DO $post$
BEGIN
  IF (SELECT count(*) FROM public.auto_blocks WHERE name LIKE '[engine] web\_%') <> 8 THEN RAISE EXCEPTION 'V618 p3 postflight: block'; END IF;
  IF (SELECT count(*) FROM public.auto_elements WHERE name LIKE 'web\_%') <> 8 THEN RAISE EXCEPTION 'V618 p3 postflight: element'; END IF;
  IF (SELECT count(*) FROM public.auto_outcome_policies WHERE source = 'v618') <> 7 THEN RAISE EXCEPTION 'V618 p3 postflight: chính sách'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_nhatot_list') IS DISTINCT FROM '2e32887c2c4fb936592a453a75c5d6dd' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_nhatot_list'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_nhatot_reveal') IS DISTINCT FROM 'e62881a879a2b46810c7c9c172811953' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_nhatot_reveal'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_batdongsan_search') IS DISTINCT FROM 'ab82312ac85b7ffc78d41370dc774894' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_batdongsan_search'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_batdongsan_list') IS DISTINCT FROM '5240724d215298b7666b070ddc02e2c3' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_batdongsan_list'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_batdongsan_reveal') IS DISTINCT FROM '5b034b3448608a0fc8fae8bebc066e3e' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_batdongsan_reveal'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_batdongsan_detail') IS DISTINCT FROM '491cf245b97546fdd41a330c7ce67063' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_batdongsan_detail'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_yellowpages_list') IS DISTINCT FROM '740c12a5380adbe0edf93e4d14f5c86b' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_yellowpages_list'; END IF;
  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = '[engine] web_yellowpages_detail') IS DISTINCT FROM 'dfda4b6f0d227937ee325f825a71d884' THEN RAISE EXCEPTION 'V618 p3 postflight: code [engine] web_yellowpages_detail'; END IF;
END $post$;

COMMIT;
