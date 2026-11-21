// Mở trang một tin batdongsan để lấy thêm địa chỉ đầy đủ và đặc điểm (khi chiến dịch bật "Mở trang tin"). Chỉ đọc. input: link, waitMs.
const link = String(input.link || '').trim();
if (!/^https:\/\/batdongsan\.com\.vn\//i.test(link)) throw new Error('Link tin batdongsan không hợp lệ');
const waitMs = Number(input.waitMs) || 30000;
await page.open(link, waitMs);
const result = await evaluateReady(__PAGE_SCRIPT__, waitMs);
return Object.assign({ link }, result);
