// Trong trang kết quả tìm kiếm nhatot: đọc 20 tin từ dữ liệu nhúng (__NEXT_DATA__). __args: [số trang]. Chưa sẵn sàng thì { pending }.
const pageNo = Math.max(1, Number(__args[0]) || 1);
const title = norm(document.title).slice(0, 120);
if (isChallenge()) return { pending: true, challenge: true, items: [], total: 0, title };
let data = null;
const el = document.getElementById('__NEXT_DATA__');
if (el) { try { data = JSON.parse(el.textContent); } catch (error) { data = null; } }
if (!data) return { pending: true, items: [], total: 0, title };
const listing = data && data.props && data.props.initialState && data.props.initialState.adlisting;
const ads = listing && listing.data && Array.isArray(listing.data.ads) ? listing.data.ads : null;
if (!ads) return { layoutChanged: true, items: [], total: 0, title: norm(document.title).slice(0, 120) };
const total = Number(listing.data.total) || 0;
const anchors = Array.from(document.querySelectorAll('a[href*=".htm"]')).map(a => a.href);
const items = [];
for (const ad of ads) {
  if (!ad || !ad.list_id) continue;
  const id = String(ad.list_id);
  const link = anchors.find(href => href.indexOf('/' + id + '.htm') >= 0) || ('https://www.nhatot.com/mua-ban-bat-dong-san/' + id + '.htm');
  const params = Array.isArray(ad.params) ? ad.params : [];
  const param = key => { const p = params.find(x => x && x.id === key); return p ? norm(p.value) : ''; };
  const address = [ad.street_name, ad.ward_name, ad.area_name, ad.region_name].map(norm).filter(Boolean).join(', ');
  const rooms = [ad.rooms ? ad.rooms + ' PN' : '', param('toilets'), param('floors')].filter(Boolean).join(' · ');
  items.push({
    listingKey: id,
    link: link.split('#')[0].split('?')[0],
    name: norm(ad.account_name || ad.full_name),
    isBroker: !!ad.company_ad,
    fields: {
      title: norm(ad.subject),
      price: norm(ad.price_string),
      area: ad.size ? norm(ad.size + ' ' + (ad.size_unit_string || 'm²')) : '',
      propertyType: [norm(ad.category_name), param('house_type')].filter(Boolean).join(' · '),
      postedAt: formatDate(ad.list_time || ad.orig_list_time) || norm(ad.date),
      rooms,
      pricePerM2: ad.price_million_per_m2 ? (Math.round(Number(ad.price_million_per_m2) * 100) / 100).toString().replace('.', ',') + ' triệu/m²' : '',
      project: norm(ad.pty_project_name),
      coordinates: ad.latitude && ad.longitude ? ad.latitude + ', ' + ad.longitude : '',
      description: norm(ad.body).slice(0, 1000),
      address,
      posterType: ad.company_ad ? 'Môi giới' : 'Cá nhân'
    }
  });
}
return { items, total, hasMore: pageNo * 20 < total && items.length > 0, title: norm(document.title).slice(0, 120) };
