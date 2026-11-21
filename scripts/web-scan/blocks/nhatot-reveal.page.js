// Trong trang tin nhatot: đọc thông tin tin từ dữ liệu nhúng, bấm "Hiện SĐT" rồi đọc số. __args: [nút hiện số, chỗ hiện số]. Chưa sẵn sàng
// thì { pending } (block gọi lại); đã sẵn sàng thì trang không tự chuyển nữa nên chờ nút / số ngay trong script.
const buttonSelector = String(__args[0] || '');
const valueSelector = String(__args[1] || '');
if (isChallenge()) return { pending: true, challenge: true, title: norm(document.title).slice(0, 120) };
let data = null;
const dataEl = document.getElementById('__NEXT_DATA__');
if (dataEl) { try { data = JSON.parse(dataEl.textContent); } catch (error) { data = null; } }
if (!data) return { pending: true, title: norm(document.title).slice(0, 120) };
const info = data.props && data.props.initialState && data.props.initialState.adView && data.props.initialState.adView.adInfo;
const ad = info && info.ad;
if (!ad) return { layoutChanged: true, title: norm(document.title).slice(0, 120) };
const parameters = Array.isArray(info.parameters) ? info.parameters : [];
const byId = id => { const p = parameters.find(x => x && x.id === id); return p ? norm(p.value) : ''; };
const byLabel = re => { const p = parameters.find(x => x && re.test(String(x.label || ''))); return p ? norm(p.value) : ''; };
const address = byId('address') || [ad.street_name, ad.ward_name, ad.area_name, ad.region_name].map(norm).filter(Boolean).join(', ');
const width = byLabel(/ngang/i);
const length = byLabel(/dài/i);
const fields = {
  address,
  dimensions: width || length ? [width, length].filter(Boolean).join(' × ') : '',
  direction: byLabel(/hướng/i),
  legal: byLabel(/pháp lý|giấy tờ/i),
  furniture: byLabel(/nội thất/i),
  rooms: [byLabel(/phòng ngủ/i), byLabel(/vệ sinh|toilet/i), byLabel(/số tầng|tổng số tầng/i)].filter(Boolean).join(' · '),
  area: byLabel(/diện tích/i),
  propertyType: [norm(ad.category_name), byLabel(/loại hình/i)].filter(Boolean).join(' · '),
  description: norm(ad.body).slice(0, 1000)
};
const name = norm(ad.account_name || ad.full_name);
const pageText = () => norm(document.body ? document.body.innerText : '');
const fullPhone = text => {
  const compact = String(text || '').replace(/[\s.\-]/g, '');
  if (/\*/.test(compact)) return '';
  const match = compact.match(/(?:\+?84|0)\d{8,10}/);
  return match ? normalizeAnyPhone(match[0]) : '';
};
// Chờ nút hiện số đã được React gắn sự kiện (trang vừa dựng DOM thì nút có sẵn nhưng bấm chưa ăn, và chữ trang còn câu "ẩn số điện thoại" của
// khung mẫu: thử 21/11/2026 báo nhầm 2/4 tin là ẩn số). Hết hạn mà vẫn không có nút thì mới xét người bán ẩn số.
const hydrated = el => Object.keys(el).some(key => key.indexOf('__reactProps') === 0 || key.indexOf('__reactFiber') === 0);
let button = null;
for (let i = 0; i < 30; i++) {
  const found = findAll(buttonSelector).find(visible) || null;
  if (found && hydrated(found)) { button = found; break; }
  if (found && i >= 24) { button = found; break; }
  await delay(500);
}
if (!button) return /ẩn số điện thoại/i.test(pageText()) ? { hidden: true, name, fields } : { noButton: true, name, fields };
button.click();
for (let i = 0; i < 20; i++) {
  await delay(500);
  for (const el of findAll(valueSelector).concat(findAll(buttonSelector))) {
    const phone = fullPhone(el.innerText || el.textContent);
    if (phone) return { phone, clicked: true, name, fields };
  }
  if (isChallenge()) return { challenge: true, clicked: true, name, fields };
}
return { noPhone: true, clicked: true, name, fields };
