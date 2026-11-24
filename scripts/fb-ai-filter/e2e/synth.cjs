// Sinh data mẫu có sẵn đáp án: 12 lĩnh vực × nhiều kiểu mô tả (một dòng, có phần loại bỏ, loại theo khu vực, danh sách từ khoá,
// tìm phía người bán, có câu hướng dẫn chung, không dấu) × nội dung người cần / người bán / lạc đề, cộng biến đổi gây nhiễu
// (không dấu, chữ hoa, emoji, hashtag, "Xem thêm", xuống dòng, sai chính tả nhẹ, NFD). Đáp án suy ra từ cách dựng, không hỏi AI.
'use strict'
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const LOCS = ['Cầu Giấy', 'Hà Đông', 'Thanh Xuân', 'Gò Vấp', 'Bình Thạnh', 'Thủ Đức', 'Hải Châu', 'Long Biên', 'Quận 7', 'Biên Hoà']
const EXCL_LOC = 'Hà Đông'
const phone = r => '09' + String(Math.floor(r() * 1e8)).padStart(8, '0')
const pick = (r, xs) => xs[Math.floor(r() * xs.length)]
// Mỗi lĩnh vực: need = người cần (khách hàng), offer = người cung cấp; topic = từ khoá chủ đề; desc* = câu mô tả.
const D = [
  { k: 'tro', own: 'Cho thuê phòng trọ giá rẻ', topic: 'phòng trọ, thuê phòng, phòng giá rẻ', need: 'người đăng cần tìm phòng trọ', needLong: 'Khách đang cần thuê phòng trọ để ở', offerDesc: 'Người đang đăng tin cho thuê hoặc nhượng lại phòng trọ',
    needPosts: ['Mình cần tìm phòng trọ khu {loc}, giá tầm {p} triệu, ai có cho mình xin thông tin với ạ', 'Em sinh viên cần thuê phòng gần {loc}, có chỗ để xe, dưới {p}tr', 'Cần tìm phòng ở ghép hoặc phòng riêng quanh {loc}, vào ở luôn tuần này', 'Có ai biết phòng trọ nào ở {loc} còn trống không ạ, em cần gấp'],
    offerPosts: ['Cho thuê phòng full đồ tại {loc}, giá {p}tr/tháng, liên hệ {phone}', 'Còn 2 phòng trống khu {loc}, khép kín, giờ giấc tự do. Gọi {phone}', 'Nhượng lại phòng trọ {loc} giá {p} triệu, có ban công, ib em'] },
  { k: 'canho', own: 'Cần bán căn hộ chung cư', topic: 'căn hộ, chung cư, mua nhà', need: 'người cần mua căn hộ chung cư', needLong: 'Khách hàng đang có nhu cầu mua nhà hoặc căn hộ', offerDesc: 'Môi giới hoặc chủ nhà đang rao bán căn hộ',
    needPosts: ['Nhà mình cần mua căn hộ 2 phòng ngủ khu {loc}, tài chính khoảng {p} tỷ, nhờ mọi người tư vấn', 'Mình đang tìm mua chung cư cũ ở {loc}, chính chủ ib giúp', 'Vợ chồng em muốn mua căn hộ đầu tiên quanh {loc} tầm {p} tỷ thì nên chọn dự án nào ạ'],
    offerPosts: ['Bán căn hộ 2PN tại {loc}, sổ hồng, giá {p} tỷ. Lh {phone}', 'Chính chủ cần bán gấp chung cư {loc}, full nội thất, {p} tỷ', 'Mở bán căn hộ dự án mới {loc}, chiết khấu 5%, hotline {phone}'] },
  { k: 'viec', own: 'Cửa hàng cần tuyển nhân viên', topic: 'tuyển dụng, việc làm, xin việc', need: 'người đang tìm việc làm', needLong: 'Ứng viên đang cần tìm việc làm thêm hoặc toàn thời gian', offerDesc: 'Cửa hàng hoặc công ty đang đăng tin tuyển dụng',
    needPosts: ['Em 20 tuổi đang cần tìm việc làm thêm buổi tối ở {loc}, ai có việc cho em xin với', 'Mình đang tìm việc kế toán ở {loc}, có 2 năm kinh nghiệm', 'Có chỗ nào ở {loc} đang cần người làm ca sáng không ạ, em đang tìm việc'],
    offerPosts: ['Tuyển nhân viên phục vụ quán cà phê tại {loc}, lương {p} triệu, gọi {phone}', 'Công ty cần tuyển 3 bạn kho vận khu {loc}, đi làm ngay', 'Cửa hàng tuyển bán hàng part-time {loc}, ib để phỏng vấn'] },
  { k: 'vay', own: 'Bên mình nhận cho vay tiêu dùng', topic: 'vay tiền, vay vốn, khoản vay', need: 'người đang cần vay tiền', needLong: 'Người đang cần vay vốn hoặc vay tiền gấp', offerDesc: 'Bên đang quảng cáo dịch vụ cho vay',
    needPosts: ['Em đang cần vay {p}0 triệu gấp để xoay vốn, ai hỗ trợ được không ạ', 'Mình cần vay tiền mua xe, có lương {p} triệu, chỗ nào duyệt nhanh', 'Có ai biết chỗ vay vốn kinh doanh lãi thấp ở {loc} không, em cần gấp'],
    offerPosts: ['Hỗ trợ vay tín chấp lãi thấp, giải ngân trong ngày, gọi {phone}', 'Cho vay theo lương, không thẩm định, hồ sơ đơn giản. Ib ngay', 'Nhận cầm đồ, cho vay nhanh khu {loc}, lh {phone}'] },
  { k: 'xe', own: 'Cần bán xe máy cũ', topic: 'xe máy cũ, mua xe, bán xe', need: 'người cần mua xe máy cũ', needLong: 'Khách đang muốn mua xe máy cũ', offerDesc: 'Người hoặc cửa hàng đang rao bán xe máy cũ',
    needPosts: ['Cần mua xe Vision cũ tầm {p} triệu ở {loc}, ai bán ib mình', 'Mình đang tìm mua xe tay ga cũ cho con đi học, giá dưới {p}0 triệu', 'Cần mua gấp một con Wave cũ còn ngon, khu {loc}'],
    offerPosts: ['Bán Vision 2021 chính chủ, đi 1 vạn, giá {p}0 triệu, xem xe tại {loc}', 'Thanh lý xe Air Blade cũ, máy êm, {p}0tr, lh {phone}', 'Cửa hàng chuyên mua bán xe máy cũ {loc}, bao sang tên'] },
  { k: 'giasu', own: 'Nhận dạy kèm tại nhà các môn cấp 2', topic: 'gia sư, học thêm, dạy kèm', need: 'phụ huynh cần tìm gia sư cho con', needLong: 'Phụ huynh đang tìm gia sư dạy kèm', offerDesc: 'Gia sư hoặc trung tâm đang nhận dạy kèm',
    needPosts: ['Mình cần tìm gia sư toán lớp 9 cho con ở {loc}, tuần 3 buổi', 'Nhà mình đang tìm cô giáo dạy tiếng Việt cho bé lớp 1 khu {loc}', 'Cần gia sư luyện thi vào 10 môn văn, học tại nhà {loc}'],
    offerPosts: ['Nhận dạy kèm toán lý hoá cấp 2 tại nhà khu {loc}, lh {phone}', 'Sinh viên năm 3 sư phạm nhận gia sư tiếng Anh, học phí {p}00k/buổi', 'Trung tâm gia sư {loc} giới thiệu giáo viên giỏi, miễn phí học thử'] },
  { k: 'dien', own: 'Nhận sửa điện nước tại nhà', topic: 'sửa điện nước, thợ điện, sửa ống nước', need: 'người cần thuê thợ sửa điện nước', needLong: 'Hộ gia đình cần gọi thợ sửa điện nước', offerDesc: 'Thợ hoặc đội thợ quảng cáo nhận sửa điện nước',
    needPosts: ['Nhà mình ở {loc} bị mất điện một phòng, cần thợ qua sửa gấp', 'Ống nước nhà em bị rò, ai biết thợ uy tín khu {loc} không ạ', 'Cần tìm thợ lắp bình nóng lạnh ở {loc} trong hôm nay'],
    offerPosts: ['Nhận sửa điện nước 24/7 khu {loc}, có mặt sau 30 phút, gọi {phone}', 'Thợ điện nước giá rẻ, bảo hành 6 tháng, lh {phone}', 'Đội thợ chuyên thông tắc, sửa chữa điện nước toàn {loc}'] },
  { k: 'my', own: 'Shop chuyên bán mỹ phẩm trị mụn', topic: 'trị mụn, mỹ phẩm, chăm sóc da', need: 'người đang hỏi cách trị mụn', needLong: 'Người đang gặp vấn đề da mụn và cần tư vấn', offerDesc: 'Shop hoặc spa đang quảng cáo sản phẩm, dịch vụ trị mụn',
    needPosts: ['Da em bị mụn ẩn nhiều quá, mọi người dùng sản phẩm gì thì đỡ ạ', 'Mình 25 tuổi mà mụn nội tiết hoài, có ai từng trị khỏi chưa chỉ mình với', 'Mụn lưng thì nên đi spa hay tự trị ở nhà ạ, em đang rất tự ti'],
    offerPosts: ['Serum trị mụn chính hãng sale 30%, ship toàn quốc, ib {phone}', 'Spa {loc} nhận điều trị mụn chuẩn y khoa, đặt lịch ngay', 'Sữa rửa mặt cho da mụn giá chỉ {p}99k, mua 2 tặng 1'] },
  { k: 'tour', own: 'Chuyên bán tour du lịch trong nước', topic: 'du lịch, tour, đặt phòng khách sạn', need: 'người đang lên kế hoạch đi du lịch và cần tư vấn', needLong: 'Gia đình hoặc nhóm bạn đang lên kế hoạch đi du lịch', offerDesc: 'Công ty du lịch, khách sạn hoặc homestay đang quảng cáo dịch vụ',
    needPosts: ['Nhà mình 4 người muốn đi Đà Lạt cuối tháng, cần tư vấn lịch trình với ạ', 'Nhóm em {p} người định đi Phú Quốc, nên đi tour hay tự túc ạ', 'Cần tìm homestay ở Sa Pa cho 6 người dịp lễ, ai biết chỗ nào đẹp không'],
    offerPosts: ['Tour Đà Lạt 3N2Đ chỉ {p} triệu, khởi hành hàng ngày, gọi {phone}', 'Combo vé máy bay + khách sạn Phú Quốc giá tốt, ib ngay', 'Homestay Sa Pa view núi còn phòng dịp lễ, lh {phone}'] },
  { k: 'ck', own: 'Môi giới chứng khoán, hỗ trợ mở tài khoản', topic: 'chứng khoán, cổ phiếu, đầu tư', need: 'người đang hỏi hoặc cần tư vấn đầu tư chứng khoán', needLong: 'Nhà đầu tư cá nhân đang hỏi về chứng khoán', offerDesc: 'Môi giới hoặc nhóm tư vấn chứng khoán đang mời chào khách',
    needPosts: ['Em mới tập chơi chứng khoán, vốn {p}0 triệu thì nên bắt đầu thế nào ạ', 'Mọi người cho hỏi mã cổ phiếu ngân hàng nào nên giữ dài hạn', 'Mình đang lỗ nặng mã thép, có nên cắt lỗ không ạ, ai tư vấn giúp'],
    offerPosts: ['Mở tài khoản chứng khoán miễn phí, hỗ trợ margin lãi thấp, ib {phone}', 'Nhóm khuyến nghị cổ phiếu VIP, lãi 20%/tháng, tham gia ngay', 'Chuyên viên môi giới hỗ trợ khách mới, phí giao dịch 0đ'] },
  { k: 'oto', own: 'Chuyên cho thuê xe ô tô tự lái và có tài', topic: 'thuê xe, xe 7 chỗ, xe tự lái', need: 'người cần thuê xe ô tô', needLong: 'Khách đang cần thuê xe đi chơi hoặc đi tỉnh', offerDesc: 'Nhà xe đang cho thuê xe',
    needPosts: ['Cần thuê xe 7 chỗ có tài đi Vũng Tàu thứ 7 này, ai có báo giá giúp', 'Mình muốn thuê xe tự lái 4 chỗ ở {loc} 3 ngày, cần chỗ uy tín', 'Nhà em cần xe 16 chỗ đưa đón đám cưới ở {loc}'],
    offerPosts: ['Cho thuê xe tự lái 4-7 chỗ tại {loc}, giá {p}00k/ngày, gọi {phone}', 'Nhà xe cho thuê xe 16 chỗ đi tỉnh, xe đời mới, lh {phone}', 'Cho thuê xe 7 chỗ có tài xế khu {loc}, giá {p}00k/ngày'] },
  { k: 'ielts', own: 'Trung tâm luyện thi IELTS', topic: 'IELTS, học tiếng Anh, luyện thi', need: 'người cần tìm lớp học tiếng Anh', needLong: 'Học viên đang tìm khoá học IELTS hoặc tiếng Anh giao tiếp', offerDesc: 'Trung tâm hoặc giáo viên tiếng Anh đang quảng cáo khoá học',
    needPosts: ['Mình mất gốc tiếng Anh, muốn tìm lớp IELTS buổi tối ở {loc}', 'Em cần lớp giao tiếp tiếng Anh cho người đi làm, mọi người review giúp', 'Có ai biết chỗ luyện IELTS 6.5 cấp tốc ở {loc} không ạ'],
    offerPosts: ['Trung tâm khai giảng lớp IELTS cam kết 6.5, học phí {p} triệu, lh {phone}', 'Ưu đãi 40% khoá giao tiếp tiếng Anh tháng này, đăng ký ngay', 'Cô giáo 8.0 IELTS nhận lớp kèm 1-1, ib cô'] }
]
const OFF = ['Hôm nay trời đẹp quá mọi người ơi', 'Ai nhặt được ví màu đen ở {loc} thì cho mình xin lại giấy tờ với', 'Chúc mừng sinh nhật nhóm tròn 3 năm hoạt động 🎉', 'Quán phở này ngon thật sự, mọi người nên thử']
// Lĩnh vực gần nhau: không dùng bài của lĩnh vực này làm bài lạc đề cho lĩnh vực kia.
const RELATED = [['giasu', 'ielts'], ['xe', 'oto'], ['tro', 'canho'], ['vay', 'ck'], ['tro', 'tour'], ['viec', 'giasu'], ['viec', 'ielts'], ['oto', 'tour'], ['vay', 'xe'], ['vay', 'oto'], ['vay', 'canho']]
function strip(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D') }
function noise(r, s) {
  const ops = []
  if (r() < 0.15) { s = strip(s); ops.push('khong_dau') }
  if (r() < 0.08) { s = s.toUpperCase(); ops.push('hoa') }
  if (r() < 0.2) { s = s + ' ' + pick(r, ['🙏', '😭😭', '❤️', '🔥🔥', '👉']); ops.push('emoji') }
  if (r() < 0.15) { s = s + ' #' + pick(r, ['hanoi', 'saigon', 'review', 'hoidap']); ops.push('hashtag') }
  if (r() < 0.12) { s = s + ' ... Xem thêm'; ops.push('xem_them') }
  if (r() < 0.1) { s = s.replace(/, /g, '\n'); ops.push('xuong_dong') }
  if (r() < 0.05) { s = s.normalize('NFD'); ops.push('nfd') }
  return { s, ops }
}
function fill(r, t) { return t.replace(/\{loc\}/g, () => pick(r, LOCS)).replace(/\{p\}/g, () => String(2 + Math.floor(r() * 7))).replace(/\{phone\}/g, () => phone(r)) }
// Kiểu mô tả và đáp án theo vai của nội dung.
const DESC = {
  need: d => ({ text: d.need, want: { need: true, offer: false, off: false } }),
  need_long_excl: d => ({ text: `${d.needLong}\nLoại bỏ: ${d.offerDesc.charAt(0).toLowerCase() + d.offerDesc.slice(1)}`, want: { need: true, offer: false, off: false } }),
  need_excl_loc: d => ({ text: `${d.need}\nKhông lấy bài nói về khu vực ${EXCL_LOC}`, want: { need: true, offer: false, off: false }, exclLoc: true }),
  keywords: d => ({ text: d.topic, want: { need: true, offer: true, off: false } }),
  offer: d => ({ text: `Lấy bài của ${d.offerDesc.charAt(0).toLowerCase() + d.offerDesc.slice(1)}`, want: { need: false, offer: true, off: false } }),
  need_guidance: d => ({ text: `${d.need}\nƯu tiên khu ${LOCS[0]}\nPhân tích cả hình ảnh nếu có`, want: { need: true, offer: false, off: false } }),
  need_nodau: d => ({ text: strip(d.need), want: { need: true, offer: false, off: false } }),
  own_business: d => ({ text: d.own, want: { need: true, offer: false, off: false } }),
  interest: d => ({ text: `Bài viết đang hỏi hoặc quan tâm đến ${d.topic.split(',')[0]}`, want: { need: true, offer: false, off: false } })
}
function generate({ seed = 1, perCell = 3, domains = D } = {}) {
  const r = rng(seed)
  const out = []
  for (const d of domains) {
    for (const [dk, df] of Object.entries(DESC)) {
      const desc = df(d)
      for (const role of ['need', 'offer', 'off']) {
        for (let i = 0; i < perCell; i++) {
          let tmpl = role === 'need' ? pick(r, d.needPosts) : role === 'offer' ? pick(r, d.offerPosts) : (r() < 0.5 ? pick(r, OFF) : pick(r, pick(r, D.filter(x => x !== d && !RELATED.some(g => g.includes(x.k) && g.includes(d.k)))).needPosts))
          let loc = pick(r, LOCS)
          if (desc.exclLoc && role === 'need' && i === 0) loc = EXCL_LOC
          const base = tmpl.replace(/\{loc\}/g, loc)
          let label = desc.want[role]
          if (desc.exclLoc && role === 'need' && base.includes(EXCL_LOC)) label = false
          const hasLoc = tmpl.includes('{loc}')
          if (desc.exclLoc && role === 'need' && i === 0 && !hasLoc) continue
          const { s, ops } = noise(r, fill(r, base))
          out.push({ src: 'synth', domain: d.k, desc_kind: dk, role, entity: r() < 0.25 ? 'comment' : 'post', description: desc.text, content: s, label: label ? 'yes' : 'no', ops })
        }
      }
    }
  }
  return out
}
module.exports = { generate, DOMAINS: D, strip }
if (require.main === module) {
  const xs = generate({ seed: Number(process.argv[2] || 1), perCell: Number(process.argv[3] || 3) })
  console.log(xs.length, xs.filter(x => x.label === 'yes').length)
  console.log(JSON.stringify(xs.slice(0, 3), null, 1))
}
