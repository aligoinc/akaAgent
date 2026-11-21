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
const result = await evaluateReady(__PAGE_SCRIPT__, waitMs, card, pageNo);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ url, page: pageNo }, result);
