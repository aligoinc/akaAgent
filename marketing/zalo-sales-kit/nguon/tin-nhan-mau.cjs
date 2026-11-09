// Tin nhắn mẫu cho nhân viên bán hàng / CSKH gửi khách qua Zalo, Facebook.
// Giọng akaBiz: nói ngắn, mỗi tin kết bằng 1 lời mời hành động có mục đích, không dùng từ gợi rủi ro,
// không "nhưng", không đáp cụt "không". [Tên] = tên nhân viên; anh/chị đổi theo khách.
const { pricing } = require('./noi-dung.cjs');
const { plansOf } = require('./mau/bang-gia.cjs');

const scripts = [
  {
    id: 'gioi-thieu',
    title: 'Giới thiệu akaAgent Zalo',
    when: 'Khách mới kết bạn, mới nhắn hỏi "phần mềm làm được gì", hoặc khi mở lời chăm khách.',
    attach: ['Ảnh vuông 01 (gửi cùng tin mở đầu)', 'Brochure PDF hoặc ảnh dọc 01 (khi khách muốn xem thêm)', 'Video 01 (đăng story / gửi khách thích xem video)'],
    messages: [
      { label: 'Mở đầu', text: 'Em chào anh/chị ạ, em là [Tên] bên akaBiz. akaAgent Zalo giúp mình tự động nhắn tin và kết bạn Zalo tới danh sách số, thành viên nhóm, bạn bè và các nhóm Zalo, chạy đều mỗi ngày theo lịch ạ. Mình đang cần tìm khách mới hay chăm lại khách cũ để em tư vấn đúng cách chạy nha?' },
      { label: 'Giải thích', text: 'Dạ mình chỉ cần thêm tài khoản Zalo bằng mã QR, chọn đối tượng, soạn nội dung một lần và đặt lịch ạ. App tự gửi tin, kết bạn trong giới hạn an toàn, mình tập trung trả lời khách quan tâm. Em gửi mình bộ giới thiệu ngắn để xem 4 kiểu chiến dịch, mình thấy kiểu nào hợp với việc kinh doanh của mình nhất ạ?' },
      { label: 'Mời dùng thử', text: 'Bản dùng thử bên em miễn phí và full tính năng 3 ngày ạ. Anh/chị gửi em số điện thoại chưa đăng ký akaBiz để em mở tài khoản ngay, mình chạy thử trên chính tệp khách của mình luôn hôm nay nha?' },
    ],
    faq: [
      { q: 'Có người hướng dẫn không?', a: 'Dạ có ạ, em cài chiến dịch đầu tiên cùng mình và hỗ trợ 1:1 suốt quá trình dùng. Mình rảnh khung giờ nào để em hẹn cài cùng mình ạ?' },
      { q: 'Tôi chưa biết nên chạy kiểu nào?', a: 'Dạ mình có sẵn danh sách số thì chạy chiến dịch SĐT, muốn tìm khách mới thì vào thành viên nhóm cùng ngành, có nhiều bạn bè thì chăm lại bạn bè ạ. Mình đang có sẵn data nào để em gợi ý cách chạy hiệu quả nhất nha?' },
    ],
  },
  {
    id: 'danh-sach-sdt',
    title: 'Gửi tin & kết bạn theo danh sách SĐT',
    when: 'Khách có sẵn danh sách số điện thoại (BĐS, tài chính, giáo dục...), hỏi "gửi tin hàng loạt theo số được không".',
    attach: ['Ảnh vuông 02 (cùng tin mở đầu)', 'Ảnh dọc 02 hoặc tờ PDF 02 (khi khách hỏi cách làm)', 'Video 02'],
    messages: [
      { label: 'Mở đầu', text: 'Dạ được ạ! Mình chỉ cần nhập danh sách số, akaAgent tự tìm Zalo của từng số, gửi tin kèm ảnh và gửi lời mời kết bạn theo lịch, không cần lưu danh bạ ạ. Danh sách của mình đang ở Excel hay Google Sheet để em hướng dẫn nhập đúng cách nha?' },
      { label: 'Giải thích', text: 'Dạ quy trình 4 bước ạ:\n1. Nhập số bằng Excel, Google Sheet, dán hoặc chụp ảnh danh sách.\n2. Soạn tin và lời chào kết bạn, gọi đúng tên khách.\n3. Đặt lịch, số lượt mỗi giờ, mỗi ngày.\n4. Xem kết quả từng số, xuất Excel.\nSố chưa có Zalo app tự bỏ qua, khách đã nhận rồi thì không gửi trùng ạ. Mình xem ảnh quy trình em gửi rồi chạy thử với 30 số đầu tiên nha?' },
      { label: 'Mời dùng thử', text: 'Mình gửi em số điện thoại chưa đăng ký akaBiz để em mở tài khoản test 3 ngày, mình thử gửi một tệp khách thật hôm nay và thấy phản hồi luôn nha ạ.' },
    ],
    faq: [
      { q: 'Mỗi ngày gửi được bao nhiêu số?', a: 'Dạ để tài khoản luôn an toàn & bền, Zalo dùng trên 1 năm mình chạy khoẻ 100–150 số mới mỗi ngày; Zalo mới thì bắt đầu khoảng 30 rồi tăng dần ạ. Cần nhiều hơn thì thêm tài khoản, app chia đều danh sách chạy song song. Mình đang có mấy tài khoản Zalo để em tính mức phù hợp nha?' },
      { q: 'Số không có Zalo thì sao?', a: 'Dạ app tra trước từng số, số chưa có Zalo được đánh dấu và bỏ qua ạ. Bên em còn công cụ Kiểm tra SĐT có Zalo để lọc cả danh sách trước khi chạy. Mình gửi em file, em lọc thử giúp mình nha?' },
      { q: 'Số không có Zalo có gửi SMS được không?', a: 'Dạ có ạ, mình bật thêm Gửi SMS để số chưa có Zalo vẫn nhận được tin, dùng kèm gói SMS bên em. Mình quan tâm thêm SMS để em gửi thông tin chi tiết nha?' },
    ],
  },
  {
    id: 'thanh-vien-nhom',
    title: 'Nhắn tin & kết bạn thành viên nhóm (kể cả nhóm ẩn thành viên)',
    when: 'Khách hỏi "lấy thành viên group được không", "kết bạn với người trong nhóm", "nhóm ẩn thành viên có được không".',
    attach: ['Ảnh vuông 03 (cùng tin mở đầu)', 'Ảnh dọc 03 hoặc tờ PDF 03 (khi khách hỏi cách làm)', 'Video 03'],
    messages: [
      { label: 'Mở đầu', text: 'Dạ được ạ! Mình chọn nhóm Zalo cùng ngành, akaAgent lấy danh sách thành viên rồi nhắn tin và kết bạn với từng người theo lịch ạ. Nhóm ẩn danh sách thành viên thì app theo dõi nhóm, ghi nhận ai vào nhóm, nhắn tin, thả cảm xúc để nhắn tiếp. Mình đang nhắm nhóm Zalo về lĩnh vực nào để em tư vấn cách chạy nha?' },
      { label: 'Giải thích', text: 'Dạ có 2 cách ạ:\n1. Quét thành viên: chọn nhóm đã tham gia hoặc dán link nhóm, app tự tham gia và lấy tên, Zalo ID từng người, tuỳ chọn bỏ qua trưởng, phó nhóm.\n2. Theo dõi nhóm (cho nhóm ẩn thành viên): mỗi ngày app ghi nhận người mới vào nhóm, người nhắn tin, thả cảm xúc; hôm sau tự nhắn tin, kết bạn đúng giờ mình cài.\nMình gửi em link một nhóm mình muốn, em quét thử cho mình xem nha?' },
      { label: 'Mời dùng thử', text: 'Bản test miễn phí 3 ngày, full tính năng ạ. Mình gửi em số điện thoại chưa đăng ký akaBiz để em mở tài khoản và quét thử nhóm của mình ngay hôm nay nha.' },
    ],
    faq: [
      { q: 'Có lấy được số điện thoại thành viên không?', a: 'Dạ app lấy tên và Zalo ID của từng thành viên, đủ để nhắn tin và kết bạn trực tiếp luôn ạ, mình không cần tới số điện thoại. Mình muốn nhắn tin hay kết bạn trước để em cài đúng nha?' },
      { q: 'Nhắn cho người chưa kết bạn được không?', a: 'Dạ được ạ, app gửi tin theo Zalo ID nên không cần kết bạn trước; mình bật thêm kết bạn kèm lời chào để chăm lâu dài. Lời chào nhắc tới nhóm chung giúp khách dễ nhận ra mình. Em soạn giúp mình một mẫu lời chào nha?' },
    ],
    note: 'Tính năng "theo dõi nhóm theo thời gian thực" dùng với tài khoản Zalo đăng nhập mã QR hoặc tài khoản chạy trên server (không dùng cho Zalo trình duyệt), app hoặc server phải đang chạy để ghi nhận; người được ghi nhận sẽ được nhắn vào hôm sau. Với nhóm cụ thể khách đưa, quét thử link nhóm trên tài khoản demo trước khi hứa số lượng thành viên.',
  },
  {
    id: 'ban-be',
    title: 'Gửi tin tới bạn bè Zalo',
    when: 'Khách có nhiều bạn bè Zalo (shop online, bán sỉ, spa...), muốn gửi khuyến mãi, chăm khách cũ, chúc sinh nhật.',
    attach: ['Ảnh vuông 04 (cùng tin mở đầu)', 'Ảnh dọc 04 hoặc tờ PDF 04', 'Video 04'],
    messages: [
      { label: 'Mở đầu', text: 'Dạ được ạ! akaAgent gửi tin tới toàn bộ bạn bè Zalo, hoặc chỉ nhóm khách theo thẻ phân loại mình đã gắn, kèm ảnh, video; có cả tự chúc mừng sinh nhật kèm ưu đãi ạ. Mình đang có khoảng bao nhiêu bạn bè Zalo để em tư vấn lịch gửi phù hợp nha?' },
      { label: 'Giải thích', text: 'Dạ mình chọn gửi tất cả, chọn tay từng người, hoặc theo thẻ như khách VIP, khách mới, CTV ạ. Soạn nội dung một lần, gọi đúng tên từng người, rồi đặt lịch hằng ngày, theo tuần hoặc tháng, nhiều khung giờ trong ngày. Cần gửi nhanh thì có chế độ chia sẻ 50 người mỗi lượt. Mình gửi em mẫu tin khuyến mãi sắp chạy, em cài thử cho mình nha?' },
      { label: 'Mời dùng thử', text: 'Bản dùng thử miễn phí 3 ngày, full tính năng ạ. Mình gửi em số điện thoại chưa đăng ký akaBiz để em mở tài khoản, mình gửi thử chương trình khuyến mãi tới bạn bè ngay hôm nay nha.' },
    ],
    faq: [
      { q: 'Chúc sinh nhật tự động hoạt động thế nào?', a: 'Dạ mỗi ngày app tìm bạn bè có sinh nhật hôm nay (theo ngày sinh hiển thị trên Zalo) và gửi lời chúc mình soạn sẵn, kèm voucher càng tốt ạ. Em soạn giúp mình mẫu chúc sinh nhật nha?' },
      { q: 'Gửi nhiều có làm phiền bạn bè không?', a: 'Dạ app có kiểm tra trùng: người đã nhận trong số ngày mình chọn sẽ không nhận lại, và có danh sách không gửi tin cho người thân, đối tác ạ. Mình muốn loại những ai để em cài sẵn nha?' },
    ],
  },
  {
    id: 'nhom-zalo',
    title: 'Gửi tin vào nhóm Zalo',
    when: 'Khách tham gia nhiều nhóm (BĐS, bán sỉ, tuyển dụng...), mỗi ngày phải copy-paste đăng tin.',
    attach: ['Ảnh vuông 05 (cùng tin mở đầu)', 'Ảnh dọc 05 hoặc tờ PDF 05', 'Video 05'],
    messages: [
      { label: 'Mở đầu', text: 'Dạ được ạ! Mình soạn tin một lần, akaAgent gửi lần lượt vào các nhóm Zalo tài khoản đã tham gia, mỗi ngày theo khung giờ mình chọn ạ. Mình đang tham gia khoảng bao nhiêu nhóm để em gợi ý lịch gửi nha?' },
      { label: 'Giải thích', text: 'Dạ mình tải danh sách nhóm đã tham gia, chọn nhóm cần gửi, soạn nội dung kèm ảnh, video, đặt lịch và khoảng nghỉ giữa hai nhóm ạ. Muốn có thêm nhóm thì dùng chiến dịch tham gia nhóm bằng link. Kết quả hiện rõ nhóm nào đã nhận tin. Mình gửi em vài link nhóm, em cài thử cho mình xem nha?' },
      { label: 'Mời dùng thử', text: 'Bản test miễn phí 3 ngày, full tính năng ạ. Mình gửi em số điện thoại chưa đăng ký akaBiz để em mở tài khoản, mình chạy thử đăng tin vào nhóm ngay hôm nay nha.' },
    ],
    faq: [
      { q: 'Có tag tên mọi người trong nhóm không?', a: 'Dạ tin vào nhóm bên em tập trung vào nội dung, ảnh, video để bài nổi bật ạ; muốn chăm từng người thì mình dùng thêm chiến dịch Thành viên nhóm để nhắn riêng, kết bạn từng người. Em demo cả hai cách cho mình xem nha?' },
      { q: 'Nhóm không cho đăng bán thì sao?', a: 'Dạ app ghi nhận nhóm nào không cho gửi để mình loại ra, các nhóm khác vẫn chạy bình thường ạ. Mình ưu tiên nhóm cho phép đăng bán để bài được đón nhận tốt nhất nha.' },
    ],
  },
];

// Báo giá theo sản phẩm: giá và số tiền tiết kiệm lấy từ noi-dung.cjs (pricing), không gõ tay.
// `pitch` là câu tính năng trong tin "Báo giá", phải khớp pricing[].includes của cùng sản phẩm.
const perMonth = (p) => (p.perMonthText || '').replace(/^~/, 'khoảng ');
const priceLine = (p) => {
  if (p.discount) return `• ${p.name}: giảm ${p.discount}`;
  if (!p.months) return `• ${p.name}: ${p.priceText}${p.line ? ` (${p.line.toLowerCase()})` : ''}`;
  return `• ${p.name}: ${p.priceText}${p.months > 2 ? ` (${perMonth(p)})` : ''}`;
};

function adviceText(plans) {
  const base = plans.find((p) => p.vnd && p.months);
  const timed = plans.filter((p) => p.saveAmount);
  const year = timed.find((p) => p.months === 12) || timed[0];
  const longest = timed.reduce((a, b) => (b.months > a.months ? b : a), timed[0]);
  const special = plans.find((p) => p.discount || (p.vnd && !p.months));
  let t = `Dạ mình dùng lâu dài thì ${year.name.toLowerCase()} chỉ ${perMonth(year)}, tiết kiệm ${year.saveAmount} so với gia hạn ${base.name.toLowerCase()} liên tục ạ`;
  if (longest !== year) t += `; ${longest.name.toLowerCase()} tiết kiệm tới ${longest.saveAmount}`;
  t += '.';
  if (special && special.discount) t += ` ${special.name} bên em giảm ${special.discount}.`;
  else if (special) t += ` ${special.name} mình thanh toán một lần, không cần gia hạn.`;
  return `${t} Mình muốn bắt đầu với gói nào để em giữ ưu đãi cho mình nha?`;
}

const trialFaq = (name) => ({ q: 'Chưa chắc nên mua gói nào?', a: `Dạ mình dùng thử miễn phí 3 ngày, full tính năng trước ạ, chạy thử thật rồi chọn gói cũng chưa muộn. Mình gửi em số điện thoại chưa đăng ký akaBiz để em mở tài khoản ${name} dùng thử ngay nha?` });
const macFaq = { q: 'Máy Mac dùng được không?', a: 'Dạ được ạ, bản Desktop có bộ cài cho cả Windows và Mac (chip Apple và Intel). Mình đang dùng máy nào để em gửi đúng bộ cài nha?' };
const lifetimeFaq = { q: 'Gói vĩnh viễn khác gì gói năm?', a: 'Dạ gói vĩnh viễn mình thanh toán một lần, dùng lâu dài không cần gia hạn ạ; gói năm thì gia hạn theo năm. Mình dự định dùng bao lâu để em tư vấn gói phù hợp nhất nha?' };
const moreFaq = (what) => ({ q: 'Có giảm thêm được không?', a: `Dạ bên em còn nhiều chương trình ưu đãi khác theo từng thời điểm ạ. Mình cho em biết dự định dùng bao lâu, ${what} để em áp chương trình tốt nhất cho mình nha?` });

const pricingText = {
  'zalo-web': {
    when: 'Khách hỏi giá bản Zalo Web (chạy trên trình duyệt, tắt máy vẫn chạy, dùng được Mac, iPad, điện thoại), hoặc đã dùng thử và muốn mua.',
    pitch: 'Gói nào cũng chạy song song đến 5 tài khoản Zalo, tắt máy vẫn chạy, dùng được cả Mac, iPad, điện thoại ạ.',
    faq: [
      { q: 'Gói 3 năm trở lên giá bao nhiêu?', a: 'Dạ gói từ 3 năm trở lên bên em giảm 25% ạ. Mình muốn dùng 3 năm hay lâu hơn để em báo giá chính xác, kèm ưu đãi đang áp dụng cho mình nha?' },
      { q: 'Có giảm thêm được không?', a: 'Dạ ngoài gói từ 3 năm giảm 25%, bên em còn nhiều chương trình ưu đãi khác theo từng thời điểm ạ. Mình cho em biết dự định dùng bao lâu, mấy tài khoản Zalo để em áp chương trình tốt nhất cho mình nha?' },
      { q: 'Có gói vĩnh viễn không?', a: 'Dạ bản Zalo Web có gói 2 tháng, 1 năm, 2 năm và gói từ 3 năm trở lên giảm 25% ạ, dùng càng lâu càng tiết kiệm. Mình cần gói vĩnh viễn thì bản Zalo Desktop có gói vĩnh viễn, em gửi bảng giá để mình so sánh nha?' },
      trialFaq('Zalo'),
    ],
    note: 'Gói từ 3 năm chỉ ghi "giảm 25%", chưa in số tiền: báo khách theo chính sách hiện hành. Tính năng đi kèm (5 tài khoản Zalo song song, tắt máy vẫn chạy, dùng được Mac/iPad/điện thoại) lấy theo kịch bản bán hàng bản Web 06/2026.',
  },
  'zalo-desktop': {
    when: 'Khách hỏi giá bản Zalo cài trên máy tính Windows hoặc Mac, hoặc đã dùng thử và muốn mua.',
    pitch: 'Gói nào cũng đủ 4 kiểu chiến dịch Zalo, cài được cả Windows và Mac, có tư vấn viên cài đặt cùng mình ạ.',
    faq: [
      macFaq,
      { q: 'Tắt máy tính có chạy không?', a: 'Dạ bản Desktop chạy khi app đang mở trên máy ạ. Mình muốn tắt máy vẫn chạy, dùng được cả trên điện thoại thì tham khảo thêm bản Zalo Web, em gửi bảng giá để mình so sánh nha?' },
      lifetimeFaq,
      moreFaq('mấy tài khoản Zalo'),
      trialFaq('Zalo'),
    ],
    note: 'Bản Desktop chạy khi app đang mở trên máy; khách cần tắt máy vẫn chạy thì giới thiệu bản Zalo Web. Bảng giá không ghi số tài khoản Zalo mỗi gói: hỏi nhu cầu rồi tư vấn.',
  },
  'facebook-desktop': {
    when: 'Khách hỏi giá phần mềm Facebook cài trên máy tính (đăng bài nhóm, nhắn tin, kết bạn), hoặc đã dùng thử và muốn mua.',
    pitch: 'Gói nào cũng đủ đăng bài nhóm, trang cá nhân, fanpage, nhắn tin và kết bạn tự động, cài được cả Windows và Mac ạ.',
    faq: [
      { q: 'Phần mềm làm được những gì?', a: 'Dạ app đăng bài vào nhóm, trang cá nhân, fanpage; nhắn tin bạn bè, người lạ, khách đã inbox page; kết bạn, tham gia nhóm, mời bạn vào nhóm, chạy tự động theo lịch ạ. Mình đang cần đăng bài hay tìm khách để em tư vấn cách chạy nha?' },
      macFaq,
      lifetimeFaq,
      moreFaq('mấy tài khoản Facebook'),
      trialFaq('Facebook'),
    ],
    note: 'Bảng giá không ghi số tài khoản Facebook mỗi gói: hỏi nhu cầu rồi tư vấn. Khách dùng cả Zalo thì giới thiệu thêm bảng giá Zalo Desktop.',
  },
  'sms-mobile': {
    when: 'Khách hỏi giá gửi SMS hàng loạt bằng điện thoại Android, hoặc cần gửi tin cho cả số chưa có Zalo.',
    pitch: 'Mình cài app trên điện thoại Android và gửi SMS bằng chính SIM của mình ạ; cước tin nhắn tính theo gói cước nhà mạng.',
    faq: [
      { q: 'Cước tin nhắn tính thế nào?', a: 'Dạ giá gói là phí phần mềm ạ, còn cước SMS do nhà mạng tính theo SIM của mình. Mình đăng ký gói cước SMS của nhà mạng sẽ gửi tiết kiệm hơn, em hướng dẫn mình chọn gói cước nha?' },
      { q: 'Cần điện thoại gì?', a: 'Dạ mình dùng điện thoại Android có lắp SIM ạ, cài app SMS bên em rồi đăng nhập tài khoản là gửi được. Mình đang có sẵn máy Android chưa để em hướng dẫn cài nha?' },
      { q: 'Gửi tiếng Việt có dấu được không?', a: 'Dạ được ạ, mình chọn gửi có dấu hoặc không dấu tuỳ nhu cầu. Em soạn giúp mình mẫu tin ngắn gọn, dễ đọc nha?' },
      moreFaq('mấy điện thoại gửi'),
      trialFaq('SMS'),
    ],
    note: 'Cước SMS do nhà mạng tính theo SIM của khách, không nằm trong giá gói. Bản SMS Mobile không có gói vĩnh viễn.',
  },
};

const pricingScripts = pricing.map((P) => {
  const plans = plansOf(P);
  const x = pricingText[P.id];
  return {
    id: `bang-gia-${P.id}`,
    productId: P.id,
    title: `Báo giá ${P.product}`,
    when: x.when,
    attach: ['Ảnh bảng giá vuông hoặc dọc 4:5 (cùng tin báo giá)', 'PDF bảng giá A4 (khách cần file để in, gửi kế toán)', 'Story 9:16 (đăng story ưu đãi)'],
    messages: [
      { label: 'Báo giá', text: `Dạ em gửi anh/chị bảng giá ${P.product} ạ:\n${plans.map(priceLine).join('\n')}\n${x.pitch} Ngoài ra bên em còn nhiều ưu đãi khác, mình dự định dùng khoảng bao lâu để em áp chương trình tốt nhất cho mình nha?` },
      { label: 'Tư vấn chọn gói', text: adviceText(plans) },
      { label: 'Chốt gói', text: 'Dạ mình chọn gói nào em gửi thông tin thanh toán ngay ạ. Chuyển khoản xong mình chụp ảnh gửi em, em kích hoạt tài khoản và cài chiến dịch đầu tiên cùng mình luôn nha.' },
    ],
    faq: x.faq,
    note: `${x.note} Bảng giá chỉ gửi riêng khi khách hỏi, không đăng lên video hay trang giới thiệu công khai.`,
  };
});

// Câu hỏi chung, dùng cho mọi chủ đề
const common = [
  { q: 'Gửi nhiều có bị khoá Zalo không?', a: 'Dạ để tài khoản luôn an toàn & bền, app có giới hạn theo giờ, theo ngày, khoảng nghỉ giữa các lần gửi và tự tạm nghỉ khi Zalo báo chạm giới hạn ạ. Zalo dùng trên 1 năm chạy khoẻ 100–150 người mới mỗi ngày, em cài sẵn mức an toàn cho mình luôn. Mình gửi em SĐT để em mở tài khoản test chạy thử nha?' },
  { q: 'Tắt máy tính có chạy không?', a: 'Dạ bản trên máy tính chạy khi app đang mở ạ; muốn tắt máy vẫn chạy thì mình chọn tài khoản Zalo chạy trên server. Mình muốn chạy trên máy tính hay trên server để em tư vấn đúng gói nha?' },
  { q: 'Dùng thử được những gì?', a: 'Dạ test 3 ngày, mỗi ngày 30 lượt, full tính năng ạ, đủ để mình chạy thử một tệp khách thật và thấy phản hồi. Mình gửi em SĐT chưa đăng ký akaBiz để em mở tài khoản ngay nha?' },
  { q: 'Giá bao nhiêu?', a: 'Dạ bên em có gói tháng, gói năm và vĩnh viễn, tuỳ số tài khoản Zalo mình cần ạ. Mình dùng thử miễn phí 3 ngày trước, thấy hợp em báo gói tiết kiệm nhất cho mình nha. Mình gửi em SĐT để em mở tài khoản luôn ạ?' },
  { q: 'Tôi dùng máy Mac được không?', a: 'Dạ được ạ, có bản cho macOS, hoặc mình chọn tài khoản chạy trên server thì tắt máy vẫn chạy. Mình muốn dùng trên máy hay trên server để em cấp đúng bản nha?' },
  { q: 'Có giúp viết nội dung không?', a: 'Dạ có ạ, app có AI viết và viết lại nội dung, tạo nhiều mẫu câu khác nhau, em duyệt cùng mình trước khi chạy. Mình gửi em sản phẩm, ưu đãi đang muốn gửi để em soạn giúp nha?' },
];

module.exports = { scripts, common, pricing: pricingScripts };
