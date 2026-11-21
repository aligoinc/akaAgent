// Trong trang hồ sơ doanh nghiệp Trang Vàng: đọc các mục theo nhãn (dòng nhãn rồi dòng giá trị). Chưa sẵn sàng thì { pending }.
if (isChallenge()) return { pending: true, challenge: true };
if (document.readyState === 'loading' || !document.body) return { pending: true };
const lines = String(document.body ? document.body.innerText : '').split('\n').map(norm).filter(Boolean);
const after = re => { const i = lines.findIndex(line => re.test(line)); return i >= 0 && i + 1 < lines.length ? lines[i + 1] : ''; };
const listAfter = (re, max) => {
  const i = lines.findIndex(line => re.test(line));
  if (i < 0) return '';
  let j = i + 1;
  if (j < lines.length && /^·\s*\d+/.test(lines[j])) j++;
  return lines.slice(j, j + max).filter(line => !/^(Xem|Hình ảnh|Giới thiệu|Ngành nghề|Sản phẩm)/i.test(line)).join(', ').slice(0, 1000);
};
const hotline = (lines.join(' ').match(/Hotline[:\s]*([+\d][\d\s.]{8,})/i) || [])[1] || '';
return { fields: {
  taxCode: after(/^MÃ SỐ THUẾ$/i),
  taxAddress: after(/^ĐỊA CHỈ THEO MST$|^ĐỊA CHỈ THEO MÃ SỐ THUẾ$/i),
  hotline: normalizeAnyPhone(hotline) || norm(hotline),
  businessType: after(/^LOẠI HÌNH$/i),
  market: after(/^THỊ TRƯỜNG$/i),
  mainCustomers: after(/^KHÁCH HÀNG CHÍNH$/i),
  businessLines: listAfter(/^Ngành nghề kinh doanh$/i, 1),
  products: listAfter(/^Sản phẩm dịch vụ$/i, 20)
} };
