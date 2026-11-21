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
const ready = await evaluateReady(__PAGE_READY__, waitMs, inputSelector);
if (ready.challenge) return { challenge: true, url: base, title: ready.title };
if (!ready.ok) return { layoutChanged: true, url: base, title: ready.title };
const typed = await page.evaluate(__PAGE_TYPE__, inputSelector, keyword);
if (typed && typed.noInput) return { layoutChanged: true, url: base };
helpers.log('gợi ý: ' + ((typed && typed.suggestions) || []).join(' | '));
await page.click(buttonSelector);
// Chờ trang chuyển sang trang kết quả trang chọn (script kiểm ngắn từng lần, không chờ bằng sự kiện tải xong của trang cũ).
const result = await evaluateReady(__PAGE_SCRIPT__, Math.min(waitMs, 20000), base);
if (result.challenge) return { challenge: true, url: base, title: result.title };
if (!result.url) return { section, keyword, url: base, resolved: false, suggestions: (typed && typed.suggestions) || [] };
return Object.assign({ section, keyword, resolved: true, suggestions: (typed && typed.suggestions) || [] }, result);
