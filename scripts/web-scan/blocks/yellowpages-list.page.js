// Trong trang danh sách Trang Vàng (ngành / tìm kiếm): đọc các thẻ doanh nghiệp. __args: [thẻ doanh nghiệp, số trang]. Chưa sẵn sàng thì { pending }.
const cardSelector = String(__args[0] || '');
const pageNo = Math.max(1, Number(__args[1]) || 1);
if (isChallenge()) return { pending: true, challenge: true, items: [], title: norm(document.title).slice(0, 120) };
if (document.readyState === 'loading') return { pending: true, items: [], title: norm(document.title).slice(0, 120) };
const cards = findAll(cardSelector);
if (cards.length === 0) {
  const body = norm(document.body ? document.body.innerText : '').slice(0, 20000);
  const empty = /không tìm thấy|không có kết quả|0 kết quả/i.test(body) || /Top 0 /i.test(document.title);
  return empty ? { items: [], empty: true, title: norm(document.title).slice(0, 120) } : { pending: true, items: [], title: norm(document.title).slice(0, 120) };
}
const SKIP_HOST = /(^|\.)(yellowpages\.vn|trangvangvietnam\.com|zalo\.me|facebook\.com|google\.[a-z.]+)$/i;
const items = [];
for (const card of cards) {
  const nameLink = Array.from(card.querySelectorAll('a[href*="/lgs/"]')).find(a => norm(a.textContent).length > 2);
  if (!nameLink) continue;
  const link = nameLink.href.split('#')[0].split('?')[0];
  const id = (link.match(/\/lgs\/(\d+)/) || [])[1] || link;
  const phones = [];
  for (const a of card.querySelectorAll('a[href^="tel:"]')) {
    const phone = normalizeAnyPhone(a.getAttribute('href').slice(4));
    if (phone && !phones.includes(phone)) phones.push(phone);
  }
  const mail = card.querySelector('a[href^="mailto:"]');
  let website = '';
  for (const a of card.querySelectorAll('a[href^="http"]')) {
    let host = '';
    try { host = new URL(a.href).hostname; } catch (error) { continue; }
    if (!SKIP_HOST.test(host)) { website = a.href; break; }
  }
  const province = card.querySelector('small .fw-semibold');
  const addressEl = province ? province.closest('small') : null;
  const clone = card.cloneNode(true);
  clone.querySelectorAll('details, script, style').forEach(el => el.remove());
  const lines = String(clone.innerText || '').split('\n').map(norm).filter(Boolean);
  const anchorLine = Math.max(
    lines.findIndex(line => mail && line === norm(mail.textContent)),
    lines.findIndex(line => website && line.toLowerCase().indexOf(website.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase()) >= 0));
  const description = anchorLine >= 0 ? lines.slice(anchorLine + 1, anchorLine + 4).join(' ').slice(0, 1000) : '';
  items.push({
    listingKey: String(id),
    link,
    name: norm(nameLink.textContent),
    phones,
    mobiles: phones.filter(phone => normalizeMobile(phone)),
    fields: {
      address: addressEl ? norm(addressEl.textContent) : '',
      email: mail ? norm(mail.getAttribute('href').slice(7).split('#')[0].split('?')[0]).toLowerCase() : '',
      website,
      verified: /Xác thực/.test(lines.join(' ')) ? 'Xác thực' : '',
      description
    }
  });
}
const hasMore = Array.from(document.querySelectorAll('a[href*="page="]')).some(a => {
  const m = String(a.getAttribute('href') || '').match(/[?&]page=(\d+)/);
  return m && Number(m[1]) > pageNo;
});
return { items, hasMore, title: norm(document.title).slice(0, 120) };
