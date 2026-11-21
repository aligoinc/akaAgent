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
const result = await evaluateReady(__PAGE_SCRIPT__, waitMs, pageNo);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ url, section, page: pageNo }, result);
