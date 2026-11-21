// Bấm "Hiện số" trên một thẻ tin của trang danh sách batdongsan đang mở (cần tài khoản batdongsan đã đăng nhập trong trình duyệt của tài khoản
// Website; mỗi lần bấm tính một lượt "Hiện SĐT Batdongsan"). input: listingKey. Trả: phone | loginRequired | noButton | noPhone | notFound | challenge.
const listingKey = String(input.listingKey || '').trim();
if (!listingKey) throw new Error('Thiếu mã tin');
const card = await helpers.element('web_bds_card');
const phone = await helpers.element('web_bds_phone_button');
const login = await helpers.element('web_bds_login_gate');
const result = await page.evaluate(__PAGE_SCRIPT__, listingKey, card, phone, login);
return Object.assign({ listingKey }, result || {});
