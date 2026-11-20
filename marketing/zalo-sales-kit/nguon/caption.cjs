// Caption + hashtag đăng kèm video (TikTok / Reels / Zalo / Facebook).
// Công thức: câu mở lặp lại hook → 1–2 ý chính → CTA "Comment ZALO" → 5–8 hashtag.
const strip = (s) => String(s || '').replace(/\*\*|==/g, '');

const TAGS = {
  'gioi-thieu': ['#akabiz', '#akaagent', '#phanmemzalo', '#zalomarketing', '#tudonghoa', '#banhangonline', '#chotdon'],
  'danh-sach-sdt': ['#akabiz', '#guitinhangloat', '#ketbanzalotudong', '#zalomarketing', '#batdongsan', '#chamsockhachhang'],
  'thanh-vien-nhom': ['#akabiz', '#nhomzalo', '#ketbanzalotudong', '#zalomarketing', '#timkhachhang', '#banhangonline'],
  'ban-be': ['#akabiz', '#chamsockhachhang', '#zalomarketing', '#khachcu', '#chucmungsinhnhat', '#banhangonline'],
  'nhom-zalo': ['#akabiz', '#nhomzalo', '#dangtinzalo', '#zalomarketing', '#batdongsan', '#bansi'],
};

function captionFor(t) {
  const perks = (t.video?.perks || t.ticks).map((x) => `✅ ${strip(x)}`).join('\n');
  return [
    strip(t.hook),
    '',
    strip(t.sub),
    '',
    perks,
    '',
    '👉 Comment "ZALO" hoặc nhắn tin để nhận tài khoản dùng thử miễn phí 3 ngày, full tính năng.',
    '',
    (TAGS[t.id] || TAGS['gioi-thieu']).join(' '),
    '',
  ].join('\n');
}

module.exports = { captionFor };
