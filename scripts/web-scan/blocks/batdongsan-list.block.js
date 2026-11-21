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
const result = await evaluateReady(__PAGE_SCRIPT__, waitMs, card, phone);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ url, page: pageNo }, result);
