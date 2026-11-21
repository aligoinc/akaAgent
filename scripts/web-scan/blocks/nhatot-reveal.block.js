// Mở trang một tin nhatot, đọc thêm thông tin của tin rồi bấm "Hiện SĐT" (mỗi lần bấm tính một lượt "Hiện SĐT nhatot").
// input: link, waitMs. Trả: phone | hidden (người bán ẩn số) | noButton | noPhone | challenge | layoutChanged, kèm name, fields.
const link = String(input.link || '').trim();
if (!/^https:\/\/(www\.)?nhatot\.com\//i.test(link)) throw new Error('Link tin nhatot không hợp lệ');
const waitMs = Number(input.waitMs) || 30000;
await page.open(link, waitMs);
const button = await helpers.element('web_nhatot_phone_button');
const value = await helpers.element('web_nhatot_phone_value');
const result = await evaluateReady(__PAGE_SCRIPT__, waitMs, button, value);
if (result.timedOut && !result.challenge) result.layoutChanged = true;
return Object.assign({ link }, result);
