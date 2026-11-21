// Trong trang kết quả tìm của batdongsan: đã sang trang kết quả chưa, tiêu đề trang (trang hiểu từ khoá thành gì) và số tin. __args: [link mục
// bán / cho thuê]. Còn ở trang cũ hoặc chưa tải xong thì { pending }.
const base = String(__args[0] || '');
const clean = value => String(value || '').split('#')[0].split('?')[0].replace(/\/+$/, '');
if (isChallenge()) return { pending: true, challenge: true, title: norm(document.title).slice(0, 160) };
if (clean(location.href) === clean(base)) return { pending: true, stayed: true };
if (document.readyState === 'loading' || !document.querySelector('h1')) return { pending: true };
const totalEl = Array.from(document.querySelectorAll('span, div, p')).find(el => el.children.length === 0 && /^Hiện có [\d.,]+ bất động sản/i.test(norm(el.textContent)));
const total = totalEl ? Number(norm(totalEl.textContent).replace(/^Hiện có ([\d.,]+).*$/i, '$1').replace(/[.,]/g, '')) || 0 : 0;
const heading = document.querySelector('h1');
return { url: clean(location.href), title: norm(heading ? heading.textContent : document.title).slice(0, 160), total };
