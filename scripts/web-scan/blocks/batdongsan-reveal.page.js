// Trong trang danh sách batdongsan: bấm "Hiện số" trên thẻ tin rồi đọc số; hiện hộp đăng nhập thì báo. __args: [mã tin, thẻ tin, nút hiện số, hộp đăng nhập].
const listingKey = String(__args[0] || '');
const cardSelector = String(__args[1] || '');
const phoneSelector = String(__args[2] || '');
const loginSelector = String(__args[3] || '');
if (isChallenge()) return { challenge: true };
const card = findAll(cardSelector).find(el => norm(el.getAttribute('prid')) === listingKey);
if (!card) return { notFound: true };
const button = findOne(phoneSelector, card);
if (!button) return { noButton: true };
const fullPhone = value => {
  const compact = String(value || '').replace(/[\s.\-·]/g, '');
  if (/\*/.test(compact)) return '';
  const match = compact.match(/(?:\+?84|0)\d{8,10}/);
  return match ? normalizeAnyPhone(match[0]) : '';
};
button.scrollIntoView({ block: 'center' });
button.click();
for (let i = 0; i < 20; i++) {
  await delay(500);
  if (findAll(loginSelector).some(visible)) return { loginRequired: true, clicked: true };
  const phone = fullPhone(button.innerText || button.textContent) || fullPhone(button.getAttribute('mobile') || button.getAttribute('data-phone'));
  if (phone) return { phone, clicked: true };
  if (isChallenge()) return { challenge: true, clicked: true };
}
return { noPhone: true, clicked: true };
