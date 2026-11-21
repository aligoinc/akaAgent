// Trong trang danh sách batdongsan: đọc các thẻ tin. __args: [thẻ tin, nút hiện số]. Chưa sẵn sàng thì { pending }.
const cardSelector = String(__args[0] || '');
const phoneSelector = String(__args[1] || '');
const title = norm(document.title).slice(0, 120);
if (isChallenge()) return { pending: true, challenge: true, items: [], title };
if (document.readyState === 'loading') return { pending: true, items: [], title };
const cards = findAll(cardSelector);
const emptyText = /không tìm thấy|chưa có tin|0 bất động sản/i.test(norm(document.body ? document.body.innerText : '').slice(0, 20000));
if (cards.length === 0) return emptyText ? { items: [], empty: true, title } : { pending: true, items: [], title };
const text = (card, selector) => { const el = card.querySelector(selector); return el ? norm(el.textContent) : ''; };
const items = [];
for (const card of cards) {
  const id = norm(card.getAttribute('prid'));
  if (!id) continue;
  const anchor = card.querySelector('a[href]');
  const button = findOne(phoneSelector, card);
  const agent = card.querySelector('.agent-name');
  items.push({
    listingKey: id,
    link: anchor ? anchor.href.split('#')[0].split('?')[0] : '',
    name: norm((button && button.getAttribute('data-kyc-name')) || (agent && agent.textContent)),
    hasPhoneButton: !!button,
    fields: {
      title: text(card, '.js__card-title, .pr-title'),
      price: text(card, '.re__card-config-price'),
      area: text(card, '.re__card-config-area'),
      pricePerM2: text(card, '.re__card-config-price_per_m2'),
      rooms: [text(card, '.re__card-config-bedroom') ? text(card, '.re__card-config-bedroom') + ' PN' : '',
        text(card, '.re__card-config-toilet') ? text(card, '.re__card-config-toilet') + ' WC' : ''].filter(Boolean).join(' · '),
      province: text(card, '.re__card-location'),
      postedAt: text(card, '.re__card-published-info-published-at').replace(/^Đăng\s*/i, ''),
      listingTier: norm(card.getAttribute('vtp')),
      description: text(card, '.re__card-description').slice(0, 1000)
    }
  });
}
const next = Array.from(document.querySelectorAll('[class*=pagination] a[href]')).some(a => /\/p\d+/.test(a.getAttribute('href') || '') && /next|icon/i.test(a.className + ' ' + (a.getAttribute('aria-label') || '')));
return { items, hasMore: next || items.length >= 20, title: norm(document.title).slice(0, 120) };
