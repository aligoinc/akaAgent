// Trong trang batdongsan: gõ từ khoá vào ô tìm như người dùng (đặt từng chữ qua setter gốc của ô + sự kiện input / keyup để trang gợi ý),
// chờ gợi ý rồi trả các gợi ý đầu. Không dùng insertText của Electron: gọi khi ô chưa được chọn thì treo cả trang (thử 21/11/2026).
// __args: [ô tìm, từ khoá].
const el = findOne(String(__args[0] || ''));
const text = String(__args[1] || '');
if (!el) return { noInput: true };
el.scrollIntoView({ block: 'center' });
el.focus();
el.click();
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(el, '');
el.dispatchEvent(new Event('input', { bubbles: true }));
for (let i = 1; i <= text.length; i++) {
  setter.call(el, text.slice(0, i));
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text[i - 1], inputType: 'insertText' }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text[i - 1] }));
  await delay(110);
}
await delay(2500);
const suggestions = Array.from(document.querySelectorAll('[class*="suggest"] li, [class*="Suggest"] li')).map(li => norm(li.innerText)).filter(Boolean).slice(0, 5);
return { value: el.value, suggestions };
