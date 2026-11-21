// Trong trang một tin batdongsan: đọc địa chỉ và bảng đặc điểm theo nhãn. Chưa sẵn sàng thì { pending }.
if (isChallenge()) return { pending: true, challenge: true };
if (document.readyState === 'loading') return { pending: true };
const pairs = [];
for (const el of document.querySelectorAll('[class*="specs-content-item"], [class*="short-info-item"], [class*="pr-short-info"] > *')) {
  const children = Array.from(el.children).map(c => norm(c.textContent)).filter(Boolean);
  if (children.length >= 2) pairs.push([children[0], children.slice(1).join(' ')]);
}
const pick = re => { const p = pairs.find(x => re.test(x[0])); return p ? p[1] : ''; };
const addressEl = document.querySelector('.re__pr-short-description, .js__pr-address, [class*="address-line"]');
const lines = Array.from(document.querySelectorAll('[class*="address-line"]')).map(el => norm(el.textContent)).filter(Boolean);
const project = document.querySelector('.re__project-title, [class*="project-name"]');
return { fields: {
  address: lines.join(', ') || (addressEl ? norm(addressEl.textContent) : ''),
  frontage: [pick(/mặt tiền/i), pick(/đường vào/i)].filter(Boolean).join(' · '),
  floors: pick(/số tầng/i),
  direction: [pick(/hướng nhà/i), pick(/hướng ban công/i)].filter(Boolean).join(' · '),
  legal: pick(/pháp lý/i),
  furniture: pick(/nội thất/i),
  expiresAt: pick(/ngày hết hạn/i),
  project: project ? norm(project.textContent) : pick(/dự án/i)
} };
