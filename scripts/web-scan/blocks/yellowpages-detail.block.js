// Mở trang hồ sơ một doanh nghiệp Trang Vàng để lấy thêm mã số thuế, loại hình… (khi chiến dịch bật "Mở trang chi tiết"; mỗi lần mở tính một
// lượt "Mở trang Trang Vàng"). Chỉ đọc. input: link, waitMs.
const link = String(input.link || '').trim();
if (!/^https:\/\/(www\.)?yellowpages\.vn\/lgs\//i.test(link)) throw new Error('Link hồ sơ Trang Vàng không hợp lệ');
const waitMs = Number(input.waitMs) || 30000;
await page.open(link, waitMs);
const result = await evaluateReady(__PAGE_SCRIPT__, waitMs);
return Object.assign({ link }, result);
