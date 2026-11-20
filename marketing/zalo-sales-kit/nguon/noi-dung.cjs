// NGUỒN NỘI DUNG DUY NHẤT cho mọi định dạng của Sales Kit akaAgent Zalo.
// Sửa chữ ở đây rồi chạy lại `node xay-dung.cjs tat-ca` để cập nhật ảnh, PDF, video.
// Quy ước: **đậm**, ==tô màu cam==. Không dùng từ gợi rủi ro (khóa, bay, lỗi, mất...).
// Giá chỉ nằm trong `pricing` (bảng giá nhân viên gửi riêng khi khách hỏi); ảnh chủ đề, video, landing page không ghi giá.
// Mọi tính năng nêu ở đây đã đối chiếu với mã nguồn akaAgent (xem README.md, mục "Căn cứ tính năng").

const brand = {
  product: 'akaAgent Zalo',
  company: 'akaBiz',
  tagline: 'Bạn lo tư vấn và chốt đơn. akaAgent lo phần nhắn tin.',
  website: 'akabiz.net',
};

const trial = {
  headline: 'Dùng thử miễn phí 3 ngày',
  note: 'Full tính năng · cấp tài khoản trong ngày',
  action: 'Nhắn tư vấn viên để nhận tài khoản',
};

const topics = [
  // ------------------------------------------------------------------ 1. Giới thiệu
  {
    id: 'gioi-thieu',
    tag: 'Giới thiệu',
    short: 'akaAgent Zalo',
    hook: 'Mỗi ngày bạn mất mấy tiếng để nhắn Zalo cho khách?',
    title: 'akaAgent Zalo: ==trợ lý nhắn tin & kết bạn tự động== cho người bán hàng',
    sub: 'Tìm khách từ số điện thoại và nhóm Zalo, kết bạn, gửi tin, chăm lại bạn bè. Mọi việc chạy tự động theo lịch, ở mức an toàn cho tài khoản.',
    square: {
      title: 'Trợ lý ==Zalo tự động== cho đội bán hàng',
      sub: 'Kết bạn, gửi tin, chăm khách mỗi ngày theo lịch bạn đặt. Bạn chỉ việc trả lời khách quan tâm.',
    },
    story: { title: 'Để ==akaAgent Zalo== nhắn tin & kết bạn thay bạn' },
    portrait: {
      title: 'akaAgent Zalo: ==trợ lý nhắn tin & kết bạn== tự động',
      sub: 'Tìm khách từ số điện thoại và nhóm Zalo, kết bạn, gửi tin, chăm lại bạn bè. Mọi việc chạy theo lịch, ở mức an toàn cho tài khoản.',
    },
    video: {
      kicker: 'Người bán hàng Zalo',
      hookLines: ['Mỗi ngày bạn mất', '==mấy tiếng== để nhắn', 'Zalo cho khách?'],
      title: 'akaAgent Zalo ==nhắn tin & kết bạn== thay bạn',
      sub: 'Danh sách số, thành viên nhóm, bạn bè, nhóm Zalo. Cài một lần, chạy đều mỗi ngày.',
      perks: ['4 kiểu chiến dịch Zalo', 'Nhiều tài khoản chạy cùng lúc', 'Giới hạn an toàn, tự tạm nghỉ'],
    },
    ticks: ['4 kiểu chiến dịch Zalo trong một app', 'Nhiều tài khoản Zalo chạy cùng lúc', 'Cài một lần, chạy đều mỗi ngày'],
    stepsLabel: 'Bắt đầu trong 4 bước',
    steps: [
      { title: 'Cài app, đăng nhập', desc: 'Chạy trên máy tính, hoặc chọn tài khoản chạy trên server để tắt máy vẫn chạy.' },
      { title: 'Thêm tài khoản Zalo', desc: 'Quét mã QR là xong. Thêm nhiều tài khoản theo gói, mỗi tài khoản gắn được proxy riêng.' },
      { title: 'Tạo chiến dịch', desc: 'Chọn đối tượng: danh sách số, thành viên nhóm, bạn bè hoặc nhóm Zalo. Soạn nội dung, đặt lịch.' },
      { title: 'Theo dõi kết quả', desc: 'Xem từng khách đã nhận tin, đã được mời kết bạn; xuất Excel, nhận email báo cáo.' },
    ],
    badges: ['Nhiều tài khoản cùng lúc', 'AI viết nội dung', 'Hỗ trợ cài đặt 1:1'],
    benefits: [
      { title: 'Tiết kiệm hàng giờ mỗi ngày', desc: 'Việc nhắn tin, kết bạn lặp đi lặp lại để app làm. Bạn dành thời gian tư vấn và chốt đơn.' },
      { title: 'Tiếp cận đúng khách', desc: 'Từ danh sách số của bạn, từ nhóm Zalo cùng ngành, từ chính danh sách bạn bè.' },
      { title: 'Tài khoản an toàn & bền', desc: 'Giới hạn theo giờ, theo ngày, khoảng nghỉ giữa các lần gửi, tự tạm nghỉ khi Zalo báo chạm giới hạn.' },
      { title: 'Nội dung tự nhiên', desc: 'Nhiều mẫu câu xoay vòng, gọi đúng tên, xưng anh/chị theo giới tính; kèm ảnh, video, file.' },
      { title: 'Trợ lý AI', desc: 'AI viết và viết lại nội dung, đặt lịch bằng câu nói thường, chẩn đoán vì sao chiến dịch chưa chạy.' },
      { title: 'Đồng hành 1:1', desc: 'Tư vấn viên akaBiz cài chiến dịch đầu tiên cùng bạn và hỗ trợ suốt quá trình dùng.' },
    ],
    fit: ['Bất động sản', 'Tài chính – bảo hiểm', 'Bán hàng online', 'Bán sỉ / CTV', 'Giáo dục – tuyển sinh', 'Spa – thẩm mỹ'],
    tip: 'Bắt đầu với tài khoản Zalo đã dùng lâu năm, chạy mức vừa phải rồi tăng dần. Tư vấn viên cài sẵn mức an toàn cho bạn.',
    chat: {
      name: 'Anh Tuấn', sub: 'Khách trả lời từ chiến dịch', avatarColor: 'linear-gradient(135deg,#FF7A3D,#FF4A1F)',
      items: [
        { t: 'sys', text: 'Tin nhắn tự động từ chiến dịch' },
        { t: 'me', img: true, text: 'Chào anh Tuấn, em là Hà bên BĐS Phú Mỹ. Em gửi anh thông tin dự án mới mở bán ạ.' },
        { t: 'them', text: 'Gửi anh bảng giá căn 2 phòng ngủ nhé.' },
        { t: 'me', text: 'Dạ em gửi anh ngay ạ!' },
      ],
    },
    cardDesc: 'Giới thiệu chung về akaAgent Zalo.',
  },

  // ------------------------------------------------------------------ 2. Danh sách SĐT
  {
    id: 'danh-sach-sdt',
    tag: 'Danh sách SĐT',
    short: 'Danh sách số điện thoại',
    cardDesc: 'Nhập danh sách số, app tự tìm Zalo từng số, gửi tin và lời mời kết bạn.',
    hook: 'Có cả nghìn số điện thoại khách mà chưa nhắn được ai?',
    title: 'Gửi tin & kết bạn tự động tới ==cả danh sách số điện thoại==',
    sub: 'Không cần lưu danh bạ, không gõ tay từng số. Bạn nhập danh sách, akaAgent tự tìm Zalo của từng số, gửi tin và lời mời kết bạn theo lịch.',
    square: {
      title: 'Có danh sách số? ==akaAgent nhắn tin & kết bạn== giúp bạn',
      sub: 'Nhập danh sách một lần, app tự tìm Zalo từng số, gửi tin kèm ảnh và kết bạn theo lịch.',
    },
    story: { title: 'Có danh sách số? ==akaAgent nhắn tin & kết bạn== thay bạn' },
    video: {
      kicker: 'Danh sách số điện thoại',
      hookLines: ['Có cả nghìn số', 'điện thoại khách', 'mà ==chưa nhắn được ai?=='],
      perks: ['Không cần lưu danh bạ', 'Vừa nhắn tin, vừa kết bạn', 'Tự bỏ qua số chưa có Zalo'],
    },
    ticks: ['Không cần lưu danh bạ', 'Vừa nhắn tin, vừa kết bạn', 'Kèm ảnh, video, file'],
    steps: [
      { title: 'Nhập danh sách số', desc: 'Dán số, nhập Excel/CSV, link Google Sheet, chụp ảnh danh sách hoặc chọn nhóm data có sẵn.' },
      { title: 'Soạn tin & lời mời kết bạn', desc: 'Kèm ảnh, video, file. Nhiều mẫu câu, gọi đúng tên, xưng anh/chị theo giới tính.' },
      { title: 'Đặt lịch & mức an toàn', desc: 'Chạy hằng ngày, theo tuần hoặc tháng; đặt số lượt mỗi giờ, mỗi ngày và khoảng nghỉ giữa hai lần gửi.' },
      { title: 'Xem kết quả từng số', desc: 'Số nào đã nhận tin, đã được mời kết bạn, số chưa có Zalo đều hiện rõ; xuất được Excel.' },
    ],
    badges: ['Bỏ qua số chưa có Zalo', 'Không gửi trùng khách', 'Chia data nhiều tài khoản'],
    benefits: [
      { title: 'Không cần lưu danh bạ', desc: 'App tra Zalo theo từng số và lưu luôn tên Zalo vào danh sách của bạn.' },
      { title: 'Vừa nhắn tin vừa kết bạn', desc: 'Gửi tin và lời mời kết bạn kèm lời chào ngay trong cùng một lượt.' },
      { title: 'Lọc số có Zalo trước', desc: 'Công cụ Kiểm tra SĐT có Zalo cho biết số nào có Zalo, tên Zalo là gì, rồi lưu thành nhóm data.' },
      { title: 'Tôn trọng khách', desc: 'Không gửi lại người vừa nhận trong số ngày bạn chọn, tự bỏ qua khách đã bấm từ chối nhận tin.' },
      { title: 'Chạy nhiều tài khoản', desc: 'Chọn nhiều tài khoản Zalo, app chia đều danh sách để các tài khoản chạy song song.' },
      { title: 'Ghi chú khách tự động', desc: 'Sau khi gửi, app gắn thẻ Zalo và đặt tên gợi nhớ dạng "Tên - SĐT" để dễ chăm tiếp.' },
    ],
    fit: ['Bất động sản', 'Tài chính – bảo hiểm', 'Giáo dục – tuyển sinh', 'Bán hàng online'],
    tip: 'Tài khoản Zalo đã dùng trên 1 năm chạy khoẻ 100–150 số mới mỗi ngày. Tài khoản mới nên bắt đầu khoảng 30 số rồi tăng dần.',
    chat: {
      name: 'Chị Lan', sub: 'Vừa đồng ý kết bạn', avatarColor: 'linear-gradient(135deg,#2563FF,#2BC8F2)',
      items: [
        { t: 'sys', text: 'Đã gửi lời mời kết bạn' },
        { t: 'me', img: true, text: 'Chào chị Lan, em là Minh bên Nội thất An Gia. Em gửi chị mẫu sofa mới về tuần này ạ!' },
        { t: 'them', text: 'Mẫu xám còn hàng không em?' },
        { t: 'me', text: 'Dạ còn ạ, em gửi chị bảng giá luôn nhé.' },
      ],
    },
  },

  // ------------------------------------------------------------------ 3. Thành viên nhóm
  {
    id: 'thanh-vien-nhom',
    tag: 'Thành viên nhóm',
    short: 'Thành viên nhóm Zalo',
    cardDesc: 'Lấy thành viên nhóm cùng ngành, kể cả nhóm ẩn thành viên, rồi nhắn tin & kết bạn.',
    hook: 'Khách hàng của bạn đang ở sẵn trong các nhóm Zalo cùng ngành',
    title: 'Nhắn tin & kết bạn với ==thành viên nhóm Zalo==, kể cả nhóm ẩn thành viên',
    sub: 'Lấy thành viên từ nhóm đã tham gia hoặc từ link nhóm. Nhóm ẩn danh sách thành viên thì bật theo dõi nhóm: ai vào nhóm, nhắn tin hay thả cảm xúc đều được ghi nhận để nhắn tin, kết bạn.',
    portrait: {
      title: 'Nhắn tin & kết bạn với ==thành viên nhóm Zalo==, kể cả nhóm ẩn thành viên',
      sub: 'Lấy thành viên từ nhóm hoặc link nhóm. Nhóm ẩn thành viên: app ghi nhận người vào nhóm, nhắn tin, thả cảm xúc.',
    },
    a4: {
      sub: 'Lấy thành viên từ nhóm đã tham gia hoặc link nhóm. Nhóm ẩn thành viên: app theo dõi nhóm, ghi nhận từng người vào nhóm, nhắn tin, thả cảm xúc.',
    },
    square: {
      title: 'Tiếp cận ==thành viên nhóm Zalo==, kể cả nhóm ẩn thành viên',
      sub: 'Lấy thành viên từ nhóm cùng ngành, rồi nhắn tin và kết bạn với từng người theo lịch.',
    },
    story: {
      title: 'Khách của bạn đang ở ==trong các nhóm Zalo==',
      sub: 'akaAgent lấy thành viên nhóm, kể cả nhóm ẩn thành viên, rồi nhắn tin và kết bạn với từng người.',
    },
    video: {
      kicker: 'Thành viên nhóm Zalo',
      hookLines: ['Khách của bạn', 'đang ở sẵn trong', '==các nhóm Zalo=='],
      title: 'Nhắn tin & kết bạn với ==thành viên nhóm==, kể cả nhóm ẩn thành viên',
      sub: 'Quét thành viên từ nhóm hoặc link nhóm. Nhóm ẩn thành viên: app ghi nhận người vào nhóm, nhắn tin, thả cảm xúc.',
      perks: ['Có cả nhóm ẩn thành viên', 'Nhắn tin không cần kết bạn trước', 'Bỏ qua trưởng, phó nhóm'],
    },
    ticks: ['Quét thành viên từ nhóm hoặc link nhóm', 'Có cả nhóm ẩn danh sách thành viên', 'Nhắn tin, kết bạn từng người'],
    steps: [
      { title: 'Chọn nhóm mục tiêu', desc: 'Nhóm tài khoản đã tham gia, hoặc dán link nhóm (đọc được cả mã QR), app tự tham gia giúp bạn.' },
      { title: 'Lấy danh sách thành viên', desc: 'Quét tên, Zalo ID, vai trò của từng người; tuỳ chọn bỏ qua trưởng, phó nhóm.' },
      { title: 'Nhóm ẩn thành viên? Bật theo dõi', desc: 'Mỗi ngày app ghi nhận người mới vào nhóm, người nhắn tin hoặc thả cảm xúc.' },
      { title: 'Nhắn tin & kết bạn theo lịch', desc: 'Gửi tin không cần kết bạn trước, kèm lời mời kết bạn, trong giới hạn an toàn.' },
    ],
    badges: ['Có cả nhóm ẩn thành viên', 'Bỏ qua trưởng, phó nhóm', 'Không gửi trùng người'],
    benefits: [
      { title: 'Đúng tệp khách quan tâm', desc: 'Thành viên nhóm cùng ngành là người đang tìm hiểu đúng sản phẩm bạn bán.' },
      { title: 'Nhóm ẩn thành viên vẫn tiếp cận được', desc: 'Theo dõi nhóm theo thời gian thực: ai vừa vào nhóm, nhắn tin hay thả cảm xúc đều được ghi nhận, hôm sau app nhắn đúng giờ bạn cài.' },
      { title: 'Nhắn tin không cần kết bạn trước', desc: 'Gửi tin tới từng thành viên theo Zalo ID, kèm lời mời kết bạn để chăm lâu dài.' },
      { title: 'Data dùng lại nhiều lần', desc: 'Danh sách thành viên đã quét được lưu lại, xuất Excel hoặc chọn lại cho các chiến dịch sau.' },
    ],
    fit: ['Bất động sản', 'Bán sỉ / CTV', 'Bán hàng online', 'Giáo dục – tuyển sinh'],
    tip: 'Chọn nhóm đúng ngành, nhiều người đang hoạt động. Lời chào nhắc tới nhóm chung giúp khách dễ nhận ra bạn.',
    chat: {
      name: 'Anh Khoa', sub: 'Thành viên nhóm "Nhà đất Thủ Đức"', avatarColor: 'linear-gradient(135deg,#7C5CFC,#2563FF)',
      items: [
        { t: 'sys', text: 'Đã lấy 1.284 thành viên từ nhóm' },
        { t: 'me', text: 'Chào anh Khoa, em thấy anh cũng trong nhóm Nhà đất Thủ Đức. Em có vài căn đúng khu anh đang tìm ạ.' },
        { t: 'them', text: 'Gửi anh xem thử căn dưới 3 tỷ nhé.' },
        { t: 'me', img: true, text: 'Dạ em gửi anh 3 căn phù hợp ạ.' },
      ],
    },
  },

  // ------------------------------------------------------------------ 4. Bạn bè
  {
    id: 'ban-be',
    tag: 'Bạn bè',
    short: 'Bạn bè Zalo',
    cardDesc: 'Gửi ưu đãi, nhắc mua lại, chúc sinh nhật tới bạn bè, lọc theo thẻ phân loại.',
    hook: 'Danh sách bạn bè Zalo là kho khách hàng bạn đang bỏ quên',
    title: 'Gửi tin tới ==toàn bộ bạn bè Zalo== chỉ với một lần cài',
    sub: 'Báo ưu đãi, ra mắt sản phẩm mới, nhắc khách cũ mua lại, chúc mừng sinh nhật. akaAgent gửi đều cho từng người, đúng lịch bạn chọn.',
    square: {
      title: 'Chăm ==toàn bộ bạn bè Zalo== chỉ với một lần cài',
      sub: 'Ưu đãi mới, nhắc mua lại, chúc mừng sinh nhật. App gửi đều cho từng người, đúng lịch.',
    },
    story: { title: 'Chăm lại ==cả danh sách bạn bè Zalo== chỉ một lần cài' },
    video: {
      kicker: 'Bạn bè Zalo',
      hookLines: ['Danh sách bạn bè Zalo', 'là ==kho khách hàng==', 'bạn đang bỏ quên'],
      perks: ['Gửi tất cả hoặc lọc theo thẻ', 'Tự chúc mừng sinh nhật', 'Gửi nhanh 50 người mỗi lượt'],
    },
    ticks: ['Gửi tất cả, chọn tay hoặc theo thẻ', 'Tự chúc mừng sinh nhật', 'Gửi nhanh 50 người mỗi lượt'],
    steps: [
      { title: 'Chọn bạn bè', desc: 'Gửi cho tất cả, tự chọn từng người, hoặc theo thẻ phân loại đã gắn trên Zalo.' },
      { title: 'Soạn nội dung', desc: 'Ưu đãi, sản phẩm mới, lời nhắc mua lại. Gọi đúng tên, kèm ảnh, video, file.' },
      { title: 'Đặt lịch gửi', desc: 'Hằng ngày, theo tuần hoặc theo tháng; nhiều khung giờ trong ngày, khoảng nghỉ giữa các tin.' },
      { title: 'Theo dõi & chăm tiếp', desc: 'Xem ai đã nhận tin; khách trả lời là bạn vào tư vấn ngay.' },
    ],
    badges: ['Chúc sinh nhật tự động', 'Lọc theo thẻ phân loại', 'Gửi nhanh 50 người/lượt'],
    benefits: [
      { title: 'Khách cũ quay lại', desc: 'Người đã là bạn bè đọc tin nhiều hơn, dễ mua lại và giới thiệu thêm khách.' },
      { title: 'Chúc mừng sinh nhật tự động', desc: 'Mỗi ngày app tìm bạn bè có sinh nhật hôm nay và gửi lời chúc kèm ưu đãi.' },
      { title: 'Gửi đúng nhóm khách', desc: 'Lọc theo thẻ phân loại trên Zalo: khách VIP, khách mới, CTV, mỗi nhóm một nội dung.' },
      { title: 'Mở rộng thêm bạn mới', desc: 'Nhắn tin, kết bạn với người Zalo gợi ý, hoặc chăm lại khách từng nhắn ở chiến dịch trước.' },
    ],
    fit: ['Bán hàng online', 'Bán sỉ / CTV', 'Spa – thẩm mỹ', 'Giáo dục – tuyển sinh'],
    tip: 'Chia bạn bè theo thẻ phân loại trên Zalo trước khi chạy để mỗi nhóm nhận đúng nội dung của mình.',
    chat: {
      name: 'Chị Mai', sub: 'Bạn bè · khách cũ', avatarColor: 'linear-gradient(135deg,#FF7A3D,#E5203F)',
      items: [
        { t: 'me', img: true, text: 'Chúc mừng sinh nhật chị Mai! Shop tặng chị voucher 20% dùng trong tuần này nha.' },
        { t: 'them', text: 'Cảm ơn shop nhiều! Còn mẫu váy xanh hôm trước không em?' },
        { t: 'me', text: 'Dạ còn chị ơi, em giữ size M cho chị nhé.' },
      ],
    },
  },

  // ------------------------------------------------------------------ 5. Nhóm Zalo
  {
    id: 'nhom-zalo',
    tag: 'Nhóm Zalo',
    short: 'Gửi tin vào nhóm Zalo',
    cardDesc: 'Soạn một lần, app gửi lần lượt vào hàng chục nhóm theo lịch mỗi ngày.',
    hook: 'Đăng tin vào hàng chục nhóm Zalo mỗi ngày mà không phải copy-paste',
    title: 'Gửi tin vào ==hàng loạt nhóm Zalo== đều đặn mỗi ngày',
    sub: 'Chọn các nhóm tài khoản đã tham gia, soạn nội dung một lần. akaAgent gửi lần lượt vào từng nhóm theo lịch và khoảng nghỉ bạn đặt.',
    square: {
      title: 'Đăng tin vào ==hàng loạt nhóm Zalo== mỗi ngày',
      sub: 'Soạn một lần, app gửi lần lượt vào từng nhóm theo lịch. Không còn copy-paste từng nhóm.',
    },
    story: { title: 'Đăng tin vào ==hàng chục nhóm Zalo== chỉ một lần cài' },
    video: {
      kicker: 'Nhóm Zalo',
      hookLines: ['Đăng tin vào', '==hàng chục nhóm Zalo==', 'mà không copy-paste'],
      perks: ['Gửi vào nhiều nhóm mỗi ngày', 'Nhiều khung giờ trong ngày', 'Tham gia nhóm mới bằng link'],
    },
    ticks: ['Gửi vào nhiều nhóm mỗi ngày', 'Kèm ảnh, video, file', 'Nhiều khung giờ trong ngày'],
    steps: [
      { title: 'Chọn nhóm', desc: 'Tải danh sách nhóm tài khoản đã tham gia; tham gia thêm nhóm mới bằng link hoặc mã QR.' },
      { title: 'Soạn nội dung', desc: 'Kèm ảnh, video, file. Nhiều mẫu câu xoay vòng để mỗi nhóm nhận bài khác nhau.' },
      { title: 'Đặt lịch & khoảng nghỉ', desc: 'Hằng ngày, theo tuần hoặc tháng; nhiều khung giờ trong ngày, nghỉ giữa hai nhóm.' },
      { title: 'Theo dõi từng nhóm', desc: 'Nhóm nào đã nhận tin, nhóm nào không cho gửi đều hiện rõ trong kết quả chạy.' },
    ],
    badges: ['Tham gia nhóm bằng link', 'Gửi nhanh 50 nhóm/lượt', 'Nhiều khung giờ/ngày'],
    benefits: [
      { title: 'Phủ sóng đều đặn', desc: 'Tin của bạn xuất hiện mỗi ngày trong các nhóm đúng tệp khách.' },
      { title: 'Không còn copy-paste', desc: 'Soạn một lần, app gửi vào hàng chục nhóm theo đúng lịch.' },
      { title: 'Gửi nhanh dạng chia sẻ', desc: 'Chia sẻ một tin chữ tới 50 nhóm mỗi lượt khi cần phủ nhanh.' },
      { title: 'Mở rộng nhóm mới', desc: 'Chiến dịch tham gia nhóm bằng link giúp bạn có thêm nơi giới thiệu sản phẩm.' },
    ],
    fit: ['Bất động sản', 'Bán sỉ / CTV', 'Bán hàng online', 'Tuyển dụng'],
    tip: 'Đọc nội quy từng nhóm, ưu tiên nhóm cho phép đăng bán. Giãn cách vài phút giữa hai nhóm để bài được đón nhận tốt hơn.',
    chat: {
      name: 'Mua Bán Nhà Quận 7', sub: 'Nhóm · 2.315 thành viên', avatar: 'Q7', avatarColor: 'linear-gradient(135deg,#2563FF,#1238B8)',
      items: [
        { t: 'sys', text: 'Đã gửi vào 24/30 nhóm hôm nay' },
        { t: 'me', img: true, text: 'Căn hộ 2PN view sông, nội thất đầy đủ, nhận nhà ngay. Inbox em để xem nhà cuối tuần ạ!' },
        { t: 'them', text: 'Còn căn tầng cao không bạn?' },
      ],
    },
  },
];

// Bìa brochure
const cover = {
  chip: 'Bộ giới thiệu sản phẩm',
  eyebrow: 'Giải pháp tự động hoá từ akaBiz',
  title: 'Tìm khách, kết bạn, nhắn tin Zalo ==tự động mỗi ngày==',
  sub: 'akaAgent Zalo thay bạn làm phần việc lặp lại trên Zalo: gửi tin, kết bạn, chăm khách theo lịch, ở mức an toàn cho tài khoản. Bạn lo tư vấn và chốt đơn.',
  pillars: [
    { title: 'Danh sách số điện thoại', desc: 'Tự tìm Zalo từng số, gửi tin & kết bạn.' },
    { title: 'Thành viên nhóm', desc: 'Kể cả nhóm ẩn danh sách thành viên.' },
    { title: 'Bạn bè Zalo', desc: 'Ưu đãi, nhắc mua lại, chúc sinh nhật.' },
    { title: 'Nhóm Zalo', desc: 'Gửi tin vào hàng loạt nhóm mỗi ngày.' },
  ],
};

// Trang an toàn & câu hỏi thường gặp
const safety = {
  tag: 'An toàn & bền',
  title: 'Tài khoản Zalo ==an toàn & bền== khi chạy tự động',
  sub: 'akaAgent chạy theo nhịp bạn đặt và tự nghỉ khi Zalo báo chạm giới hạn, để tài khoản dùng được lâu dài.',
  items: [
    { title: 'Giới hạn theo giờ, theo ngày', desc: 'Đặt số lượt tối đa cho từng việc như nhắn tin, kết bạn. Đủ lượt thì chờ, tới giờ tự chạy tiếp.' },
    { title: 'Khoảng nghỉ giữa hai lần gửi', desc: 'Tin được gửi giãn ra theo số giây bạn chọn, không dồn dập.' },
    { title: 'Khung giờ chạy', desc: 'Giờ bắt đầu, giờ dừng trong ngày; chạy hằng ngày, theo tuần hoặc theo tháng.' },
    { title: 'Tự nghỉ khi Zalo báo giới hạn', desc: 'Quy tắc an toàn do akaBiz cập nhật liên tục, áp dụng ngay không cần cập nhật app.' },
    { title: 'Không gửi trùng khách', desc: 'Bỏ qua người đã nhận tin trong số ngày bạn chọn, kể cả từ các tài khoản khác của bạn (chiến dịch SĐT).' },
    { title: 'Tôn trọng khách từ chối', desc: 'Thêm link từ chối nhận tin vào cuối tin; khách đã từ chối sẽ không nhận tin nữa.' },
  ],
  platforms: [
    { title: 'Trên máy tính', desc: 'Cài app akaAgent, thêm tài khoản Zalo bằng mã QR hoặc mở Zalo Web ngay trong app.' },
    { title: 'Chạy trên server', desc: 'Tài khoản Zalo chạy trên server của akaBiz: tắt máy tính vẫn chạy.' },
    { title: 'Theo dõi trên web', desc: 'Xem, tạm dừng, chạy tiếp chiến dịch từ trình duyệt, kể cả trên điện thoại.' },
  ],
};

const faq = [
  { q: 'Gửi nhiều có ảnh hưởng tài khoản Zalo không?', a: 'Để tài khoản luôn an toàn & bền, app có giới hạn theo giờ, theo ngày và tự nghỉ khi Zalo báo chạm giới hạn. Tư vấn viên cài sẵn mức phù hợp với tuổi tài khoản của bạn.' },
  { q: 'Có cần bật máy tính suốt không?', a: 'Bản trên máy tính chạy khi app đang mở. Muốn tắt máy vẫn chạy, chọn tài khoản Zalo chạy trên server.' },
  { q: 'Mỗi ngày nên gửi bao nhiêu?', a: 'Tài khoản dùng trên 1 năm: 100–150 người mới mỗi ngày. Tài khoản mới: bắt đầu khoảng 30 rồi tăng dần.' },
  { q: 'Dùng thử thế nào?', a: 'Nhắn tư vấn viên số điện thoại chưa đăng ký akaBiz để nhận tài khoản dùng thử 3 ngày, full tính năng.' },
  { q: 'Quét thành viên nhóm có lấy được số điện thoại không?', a: 'App lấy tên và Zalo ID của từng thành viên, đủ để nhắn tin và kết bạn trực tiếp mà không cần số điện thoại.' },
  { q: 'Có ai giúp cài chiến dịch không?', a: 'Có. Tư vấn viên cài chiến dịch đầu tiên cùng bạn và hỗ trợ 1:1 suốt quá trình dùng.' },
];

// Bìa sau
const back = {
  eyebrow: 'Bắt đầu ngay hôm nay',
  title: 'Để akaAgent nhắn tin, bạn ==tập trung chốt đơn==',
  sub: 'Dùng thử miễn phí 3 ngày, full tính năng, chạy ngay trên tệp khách của bạn.',
  steps: [
    { title: 'Nhắn tư vấn viên', desc: 'Gửi số điện thoại chưa đăng ký akaBiz.' },
    { title: 'Nhận tài khoản dùng thử', desc: 'Cài app, thêm tài khoản Zalo bằng mã QR.' },
    { title: 'Chạy chiến dịch đầu tiên', desc: 'Tư vấn viên cài cùng bạn, thấy kết quả trong ngày.' },
  ],
  contact: [
    { label: 'Website', value: 'akabiz.net' },
    { label: 'YouTube', value: '@akabizai' },
  ],
};

// BẢNG GIÁ theo sản phẩm (nhân viên gửi riêng khi khách hỏi giá; không in lên video, landing page công khai).
// Giá do quản lý akaBiz chốt ngày 09/11/2026. Giá tháng và số tiền tiết kiệm do mau/bang-gia.cjs tự tính
// từ `vnd` + `months`, không gõ tay; tiết kiệm = so với gia hạn gói ngắn nhất liên tục trong cùng thời gian.
// Gói không có `months` (vĩnh viễn, giảm %) không tính giá tháng. `premium` = thẻ nền xanh, `badge` = nhãn cam.
// Tính năng trong `includes` đã đối chiếu mã nguồn (xem README, mục Bảng giá); riêng bản Web lấy theo kịch bản bán hàng 06/2026.
// Đổi giá: sửa ở đây rồi chạy `node xay-dung.cjs bang-gia` và `node xuat-tin-nhan.cjs`.
const priceCommon = {
  kicker: 'Bảng giá',
  saveNote: 'Tiết kiệm so với gia hạn gói 2 tháng liên tục.',
  more: 'Ngoài ra còn ==nhiều ưu đãi khác==',
  contact: 'Liên hệ nhân viên tư vấn để được hỗ trợ chương trình tốt nhất.',
  cta: 'Nhắn tư vấn viên',
  trial: 'Chưa chắc chọn gói nào? Dùng thử miễn phí 3 ngày, full tính năng.',
  steps: [
    { title: 'Nhắn tư vấn viên', desc: 'Chọn gói, nhận ưu đãi đang áp dụng.' },
    { title: 'Chuyển khoản', desc: 'Gửi ảnh xác nhận cho tư vấn viên.' },
    { title: 'Kích hoạt & cài đặt', desc: 'Tư vấn viên nâng cấp tài khoản và cài chiến dịch đầu tiên cùng bạn.' },
  ],
  updated: '11/2026',
};

// Zalo Desktop và Facebook Desktop dùng chung mức giá.
const desktopPlans = [
  { id: '2-thang', name: 'Gói 2 tháng', months: 2, vnd: 500000, note: 'Gia hạn linh hoạt' },
  { id: '1-nam', name: 'Gói 1 năm', months: 12, vnd: 2000000, badge: 'Khuyên dùng' },
  { id: '4-nam', name: 'Gói 4 năm', months: 48, vnd: 4000000 },
  { id: 'vinh-vien', name: 'Gói vĩnh viễn', vnd: 10000000, line: 'Thanh toán một lần', note: 'Không cần gia hạn', premium: true },
];

const pricing = [
  {
    ...priceCommon,
    id: 'zalo-web',
    brand: 'Zalo',
    product: 'akaAgent Zalo Web',
    short: 'Zalo Web',
    platform: 'Bản Web',
    title: 'akaAgent ==Zalo Web==',
    sub: 'Nhắn tin & kết bạn Zalo tự động, dùng ngay trên trình duyệt.',
    plans: [
      { id: '2-thang', name: 'Gói 2 tháng', months: 2, vnd: 700000, note: 'Gia hạn linh hoạt' },
      { id: '1-nam', name: 'Gói 1 năm', months: 12, vnd: 3000000, badge: 'Khuyên dùng' },
      { id: '2-nam', name: 'Gói 2 năm', months: 24, vnd: 5000000 },
      { id: '3-nam', name: 'Gói 3 năm trở lên', discount: '15%', line: 'Dành cho khách đồng hành lâu dài', ask: 'Nhắn tư vấn viên để nhận báo giá', askShort: 'Nhắn để nhận báo giá', premium: true },
    ],
    includes: [
      'Chạy song song đến **5 tài khoản Zalo**',
      '**Tắt máy vẫn chạy**, không cần treo máy',
      'Dùng được cả **Mac, iPad, điện thoại**',
      '**4 kiểu chiến dịch** Zalo trong một app',
      '**Tự tạm nghỉ** khi Zalo báo giới hạn',
      '**Hỗ trợ cài đặt 1:1** cùng tư vấn viên',
    ],
    includesShort: ['5 tài khoản Zalo song song', 'Tắt máy vẫn chạy', 'Dùng trên Mac, iPad, điện thoại', 'Hỗ trợ cài đặt 1:1'],
  },
  {
    ...priceCommon,
    id: 'zalo-desktop',
    brand: 'Zalo',
    product: 'akaAgent Zalo Desktop',
    short: 'Zalo Desktop',
    platform: 'Windows · Mac',
    title: 'akaAgent ==Zalo Desktop==',
    sub: 'Nhắn tin & kết bạn Zalo tự động ngay trên máy tính.',
    plans: desktopPlans,
    includes: [
      'Cài trên **Windows và Mac**',
      '**4 kiểu chiến dịch** Zalo trong một app',
      '**Proxy riêng** cho từng tài khoản',
      '**AI viết nội dung**, mẫu câu xoay vòng',
      '**Tự tạm nghỉ** khi Zalo báo giới hạn',
      '**Hỗ trợ cài đặt 1:1** cùng tư vấn viên',
    ],
    includesShort: ['Windows và Mac', '4 kiểu chiến dịch Zalo', 'AI viết nội dung', 'Hỗ trợ cài đặt 1:1'],
  },
  {
    ...priceCommon,
    id: 'facebook-desktop',
    brand: 'Facebook',
    product: 'akaAgent Facebook Desktop',
    short: 'Facebook Desktop',
    platform: 'Windows · Mac',
    title: 'akaAgent ==Facebook Desktop==',
    sub: 'Đăng bài, nhắn tin, kết bạn Facebook tự động trên máy tính.',
    plans: desktopPlans,
    includes: [
      'Cài trên **Windows và Mac**',
      '**Đăng bài** nhóm, cá nhân, fanpage',
      '**Nhắn tin** bạn bè, người lạ, inbox page',
      '**Kết bạn**, tham gia, mời vào nhóm',
      '**AI viết nội dung**, chạy theo lịch',
      '**Hỗ trợ cài đặt 1:1** cùng tư vấn viên',
    ],
    includesShort: ['Đăng bài nhóm, fanpage', 'Windows và Mac', 'Nhắn tin, kết bạn tự động', 'Hỗ trợ cài đặt 1:1'],
  },
  {
    ...priceCommon,
    id: 'sms-mobile',
    brand: 'SMS',
    product: 'akaAgent SMS Mobile',
    short: 'SMS Mobile',
    platform: 'Android',
    title: 'akaAgent ==SMS Mobile==',
    sub: 'Gửi SMS hàng loạt từ SIM trên điện thoại Android.',
    extraNote: 'Cước SMS tính theo gói cước nhà mạng trên SIM của bạn.',
    plans: [
      { id: '2-thang', name: 'Gói 2 tháng', months: 2, vnd: 500000, note: 'Gia hạn linh hoạt' },
      { id: '1-nam', name: 'Gói 1 năm', months: 12, vnd: 2000000, badge: 'Khuyên dùng' },
      { id: '4-nam', name: 'Gói 4 năm', months: 48, vnd: 4000000, premium: true },
    ],
    includes: [
      'Gửi từ **SIM điện thoại Android** của bạn',
      'Gửi **tiếng Việt có dấu** hoặc không dấu',
      '**Không gửi trùng** số đã nhận gần đây',
      '**Đặt lịch** gửi tự động theo khung giờ',
      'Nhập số từ **Excel, Google Sheet**',
      '**Hỗ trợ cài đặt 1:1** cùng tư vấn viên',
    ],
    includesShort: ['Gửi từ SIM Android', 'Tiếng Việt có dấu', 'Không gửi trùng số', 'Hỗ trợ cài đặt 1:1'],
  },
];

// ẢNH TỪNG TÍNH NĂNG: mỗi ảnh một ý, chữ lớn, nhân viên gửi khách từng ảnh (mau/tinh-nang.cjs, 1080×1350).
// Chỉ dùng tính năng có trong bảng "Căn cứ tính năng" của README; giữ đúng mục "Không nói với khách".
// cat: gioi-thieu | chien-dich | tinh-nang | an-toan | ho-tro. points: 3–4 ý, mỗi ý một dòng. example: bong bóng chat minh hoạ.
// Tiêu đề ngắt dòng bằng \n để không tách đôi từ ghép ("hàng / loạt"); mỗi dòng tối đa ~25 ký tự.
const features = [
  // Giới thiệu
  { id: 'akaagent-zalo', cat: 'gioi-thieu', icon: 'sparkles',
    title: 'akaAgent Zalo: ==trợ lý==\n==nhắn tin & kết bạn== tự động',
    lead: 'Tìm khách từ số điện thoại và nhóm Zalo, kết bạn, gửi tin, chăm lại bạn bè. Mọi việc chạy theo lịch, ở mức an toàn cho tài khoản.',
    points: ['11 loại chiến dịch Zalo trong một app', 'Nhiều tài khoản Zalo chạy cùng lúc', 'Cài một lần, chạy đều mỗi ngày'] },
  { id: 'muoi-mot-chien-dich', cat: 'gioi-thieu', icon: 'grid',
    title: '==11 loại chiến dịch==\nZalo trong một app',
    lead: 'Mỗi nguồn khách có một loại chiến dịch riêng. Soạn nội dung một lần, app chạy đều mỗi ngày.',
    points: ['Khách mới: số điện thoại, thành viên nhóm, gợi ý kết bạn', 'Khách cũ: bạn bè, sinh nhật, khách từng nhắn', 'Nhóm Zalo: gửi tin, tham gia, thêm thành viên', 'Theo dõi nhóm, huỷ lời mời kết bạn đã gửi'] },

  // Chiến dịch
  { id: 'danh-sach-sdt', cat: 'chien-dich', icon: 'phone',
    title: 'Gửi tin & kết bạn tới\n==danh sách số điện thoại==',
    lead: 'Nhập danh sách một lần, app tự tìm Zalo từng số, gửi tin kèm ảnh và lời mời kết bạn theo lịch.',
    points: ['Không cần lưu danh bạ', 'Vừa nhắn tin, vừa kết bạn', 'Tự bỏ qua số chưa có Zalo'],
    example: [{ t: 'me', text: 'Chào chị Lan, em là Minh bên Nội thất An Gia. Em gửi chị mẫu sofa mới về tuần này ạ!' }] },
  { id: 'thanh-vien-nhom', cat: 'chien-dich', icon: 'users',
    title: 'Nhắn tin & kết bạn\n==thành viên nhóm Zalo==',
    lead: 'Chọn nhóm đã tham gia hoặc dán link nhóm, app lấy danh sách thành viên rồi nhắn tin, kết bạn từng người.',
    points: ['Lấy tên, Zalo ID từng thành viên', 'Tuỳ chọn bỏ qua trưởng, phó nhóm', 'Nhắn tin không cần kết bạn trước'],
    example: [{ t: 'me', text: 'Chào anh Khoa, em thấy anh cũng trong nhóm Nhà đất Thủ Đức. Em có vài căn đúng khu anh đang tìm ạ.' }] },
  { id: 'nhom-an-thanh-vien', cat: 'chien-dich', icon: 'eye-off',
    title: 'Nhóm ==ẩn thành viên==\nvẫn tiếp cận được',
    lead: 'Bật theo dõi nhóm: app ghi nhận người mới vào nhóm, người nhắn tin hoặc thả cảm xúc, hôm sau tự nhắn tin, kết bạn đúng giờ bạn cài.',
    points: ['Ghi nhận người vừa vào nhóm', 'Ghi nhận người nhắn tin, thả cảm xúc', 'Hôm sau nhắn tin, kết bạn theo lịch'],
    note: 'Dùng với tài khoản Zalo đăng nhập mã QR hoặc chạy trên server.' },
  { id: 'ban-be', cat: 'chien-dich', icon: 'user-check',
    title: 'Gửi tin tới ==toàn bộ==\n==bạn bè Zalo==',
    lead: 'Báo ưu đãi, ra mắt sản phẩm mới, nhắc khách cũ mua lại. App gửi đều cho từng người, đúng lịch bạn chọn.',
    points: ['Gửi tất cả, chọn tay hoặc theo thẻ', 'Gọi đúng tên từng người', 'Gửi nhanh 50 người mỗi lượt'] },
  { id: 'sinh-nhat', cat: 'chien-dich', icon: 'cake',
    title: 'Tự động ==chúc mừng==\n==sinh nhật== khách',
    lead: 'Mỗi ngày app tìm bạn bè có sinh nhật hôm nay theo ngày sinh hiển thị trên Zalo và gửi lời chúc bạn soạn sẵn.',
    points: ['Kèm voucher, ưu đãi riêng', 'Gọi đúng tên người nhận', 'Chạy tự động mỗi ngày'],
    example: [{ t: 'me', text: 'Chúc mừng sinh nhật chị Mai! Shop tặng chị voucher 20% dùng trong tuần này nha.' }, { t: 'them', text: 'Cảm ơn shop nhiều!' }] },
  { id: 'ban-goi-y', cat: 'chien-dich', icon: 'user-plus',
    title: 'Kết bạn với\n==người Zalo gợi ý==',
    lead: 'App lấy danh sách người Zalo gợi ý cho tài khoản của bạn, rồi gửi lời mời kết bạn kèm lời chào hoặc nhắn tin.',
    points: ['Tự lấy danh sách gợi ý của Zalo', 'Kết bạn kèm lời chào, nhắn tin', 'Chọn số người mỗi lượt'] },
  { id: 'khach-cu', cat: 'chien-dich', icon: 'history',
    title: 'Chăm lại ==khách cũ==\ntừng nhận tin',
    lead: 'Chọn khách mà tài khoản đã gửi tin ở các chiến dịch trước, rồi nhắn ưu đãi mới hoặc gửi lời mời kết bạn.',
    points: ['Chọn khách từ lịch sử đã gửi', 'Nhắn tin, kết bạn hoặc cả hai', 'Không cần nhập lại danh sách'],
    example: [{ t: 'me', text: 'Chào anh Tuấn, tuần trước em gửi anh mẫu bàn ăn. Tuần này bên em giảm 10% cho khách cũ ạ!' }] },
  { id: 'nhom-zalo', cat: 'chien-dich', icon: 'messages',
    title: 'Gửi tin vào ==hàng loạt==\n==nhóm Zalo==',
    lead: 'Soạn một lần, app gửi lần lượt vào từng nhóm tài khoản đã tham gia, theo lịch và khoảng nghỉ bạn đặt.',
    points: ['Nhiều khung giờ trong ngày', 'Kèm ảnh, video, file', 'Chia sẻ nhanh 50 nhóm mỗi lượt'] },
  { id: 'tham-gia-nhom', cat: 'chien-dich', icon: 'link',
    title: 'Tham gia ==nhóm Zalo mới==\nbằng link',
    lead: 'Dán link nhóm hoặc dùng mã QR, app tự tham gia giúp bạn để có thêm nơi giới thiệu sản phẩm.',
    points: ['Đọc được cả mã QR nhóm', 'Chạy theo lịch, có khoảng nghỉ', 'Nhóm mới dùng ngay để gửi tin'] },
  { id: 'them-vao-nhom', cat: 'chien-dich', icon: 'users-plus',
    title: 'Thêm khách vào\n==nhóm Zalo của bạn==',
    lead: 'Nhập danh sách số điện thoại, chọn nhóm, app tìm Zalo từng số rồi thêm vào nhóm hoặc gửi lời mời tham gia.',
    points: ['Chọn nhóm ngay trong app', 'Nhận biết người đã ở trong nhóm', 'Hoặc gửi link nhóm cho từng người'] },
  { id: 'huy-loi-moi', cat: 'chien-dich', icon: 'user-x',
    title: 'Huỷ bớt ==lời mời kết bạn==\nđã gửi',
    lead: 'App lấy danh sách lời mời kết bạn tài khoản đã gửi trên Zalo và huỷ đúng số lượng bạn chọn mỗi lượt.',
    points: ['Tự lấy danh sách lời mời đã gửi', 'Đặt số lời mời cần huỷ', 'Chạy theo lịch như chiến dịch khác'] },

  // Tính năng
  { id: 'nhap-danh-sach', cat: 'tinh-nang', icon: 'sheet',
    title: 'Nhập danh sách số\n==theo cách bạn quen==',
    lead: 'Đưa danh sách khách vào app trong vài giây.',
    points: ['Dán số hoặc nhập Excel, CSV', 'Link Google Sheet, tự đồng bộ', 'Chụp ảnh danh sách, app đọc số', 'Dùng lại nhóm data đã lưu'] },
  { id: 'kiem-tra-sdt', cat: 'tinh-nang', icon: 'phone-check',
    title: 'Kiểm tra ==số nào có Zalo==\ntrước khi chạy',
    lead: 'Công cụ Kiểm tra SĐT có Zalo cho biết số nào có Zalo, tên Zalo là gì, rồi lưu thành nhóm data để chạy chiến dịch.',
    points: ['Lọc cả danh sách một lần', 'Biết tên Zalo của từng số', 'Lưu thành nhóm data dùng lại'] },
  { id: 'sms-so-chua-co-zalo', cat: 'tinh-nang', icon: 'sms',
    title: 'Số chưa có Zalo\nvẫn ==nhận được tin==',
    lead: 'Trong chiến dịch số điện thoại, bật thêm Gửi SMS: số chưa có Zalo nhận tin nhắn SMS từ điện thoại Android của bạn.',
    points: ['Không bỏ sót khách trong danh sách', 'Cài cùng lúc với chiến dịch Zalo', 'Dùng kèm gói akaAgent SMS Mobile'] },
  { id: 'noi-dung-tu-nhien', cat: 'tinh-nang', icon: 'message-text',
    title: 'Nội dung ==tự nhiên,==\n==gọi đúng tên== khách',
    lead: 'Soạn nhiều mẫu câu, app xoay vòng cho từng người nhận, tự điền tên và xưng hô phù hợp.',
    points: ['Nhiều mẫu câu xoay vòng', 'Gọi đúng tên từng khách', 'Xưng anh/chị theo giới tính'],
    example: [{ t: 'me', text: 'Chào anh Tuấn, em là Hà bên BĐS Phú Mỹ. Em gửi anh thông tin dự án mới mở bán ạ.' }] },
  { id: 'tep-dinh-kem', cat: 'tinh-nang', icon: 'paperclip',
    title: 'Gửi kèm ==ảnh, video, file==\ntrong tin nhắn',
    lead: 'Hình sản phẩm, video giới thiệu hay file báo giá giúp khách hiểu nhanh và hỏi mua nhanh hơn.',
    points: ['Ảnh sản phẩm, bảng giá', 'Video giới thiệu ngắn', 'File tài liệu, báo giá'] },
  { id: 'ai-viet-noi-dung', cat: 'tinh-nang', icon: 'sparkles',
    title: 'Trợ lý ==AI viết nội dung==\ncho bạn',
    lead: 'Mô tả sản phẩm, ưu đãi muốn gửi, AI viết và viết lại thành nhiều mẫu câu để bạn chọn.',
    points: ['Viết mới, viết lại theo ý bạn', 'Tạo nhiều mẫu câu khác nhau', 'Đặt lịch chạy bằng câu nói thường'] },
  { id: 'gan-the', cat: 'tinh-nang', icon: 'tag',
    title: 'Tự ==gắn thẻ, ghi chú==\nkhách sau khi gửi',
    lead: 'Sau khi gửi, app gắn thẻ Zalo và đặt tên gợi nhớ dạng "Tên - SĐT" để bạn dễ tìm và chăm tiếp.',
    points: ['Gắn thẻ phân loại trên Zalo', 'Đổi tên gợi nhớ tự động', 'Lọc đúng khách khi chăm lại'] },
  { id: 'nhieu-tai-khoan', cat: 'tinh-nang', icon: 'layers',
    title: 'Chạy ==nhiều tài khoản==\n==Zalo== cùng lúc',
    lead: 'Chọn nhiều tài khoản cho một chiến dịch, app chia đều danh sách để các tài khoản chạy song song.',
    points: ['Chia đều data tự động', 'Mỗi tài khoản gắn proxy riêng', 'Theo dõi kết quả từng tài khoản'] },
  { id: 'lich-chay', cat: 'tinh-nang', icon: 'calendar',
    title: 'Lịch chạy ==linh hoạt==\ntheo ý bạn',
    lead: 'Đặt lịch một lần, app tự chạy đúng giờ mỗi ngày, mỗi tuần hoặc mỗi tháng.',
    points: ['Hằng ngày, theo tuần, theo tháng', 'Nhiều khung giờ trong ngày', 'Đặt giờ bắt đầu, giờ dừng'] },
  { id: 'may-tinh-server', cat: 'tinh-nang', icon: 'server',
    title: 'Chạy trên ==máy tính==\n==hoặc server==',
    lead: 'Chọn cách chạy phù hợp: ngay trên máy tính của bạn, hoặc tài khoản chạy trên server để tắt máy vẫn chạy.',
    points: ['Thêm Zalo bằng mã QR', 'Mở Zalo Web ngay trong app', 'Chạy trên server: tắt máy vẫn chạy'] },
  { id: 'theo-doi-dien-thoai', cat: 'tinh-nang', icon: 'smartphone',
    title: 'Theo dõi chiến dịch\n==ngay trên điện thoại==',
    lead: 'Xem tiến độ, tạm dừng hoặc chạy tiếp chiến dịch từ trình duyệt, ở đâu cũng được.',
    points: ['Xem tiến độ từng chiến dịch', 'Tạm dừng, chạy tiếp từ xa', 'Dùng trên máy tính, điện thoại'] },
  { id: 'ket-qua', cat: 'tinh-nang', icon: 'chart',
    title: 'Biết rõ ==kết quả từng khách==',
    lead: 'Khách nào đã nhận tin, đã được mời kết bạn, số nào chưa có Zalo đều hiện rõ trong kết quả chạy.',
    points: ['Kết quả chi tiết từng khách', 'Xuất Excel danh sách kết quả', 'Nhận email báo cáo hằng ngày'] },

  // An toàn & bền
  { id: 'gioi-han-an-toan', cat: 'an-toan', icon: 'shield',
    title: 'Giới hạn ==an toàn==\ncho tài khoản Zalo',
    lead: 'Đặt số lượt tối đa mỗi giờ, mỗi ngày cho từng việc như nhắn tin, kết bạn. Đủ lượt thì chờ, tới giờ tự chạy tiếp.',
    points: ['Giới hạn theo giờ, theo ngày', 'Khoảng nghỉ giữa hai lần gửi', 'Tư vấn viên cài sẵn mức phù hợp'] },
  { id: 'tu-tam-nghi', cat: 'an-toan', icon: 'pause',
    title: 'Tự ==tạm nghỉ== khi\nZalo báo giới hạn',
    lead: 'Khi Zalo báo chạm giới hạn, app tự tạm nghỉ để tài khoản luôn an toàn & bền.',
    points: ['Nhận biết các mức giới hạn của Zalo', 'Quy tắc an toàn cập nhật liên tục', 'Áp dụng ngay, không cần cập nhật app'] },
  { id: 'khong-gui-trung', cat: 'an-toan', icon: 'filter',
    title: '==Không gửi trùng==\nkhách đã nhận tin',
    lead: 'Người đã nhận tin trong số ngày bạn chọn sẽ được bỏ qua. Chiến dịch số điện thoại còn kiểm trên mọi tài khoản của bạn.',
    points: ['Tự đặt số ngày không gửi lại', 'Kiểm trên nhiều tài khoản', 'Khách không bị làm phiền'] },
  { id: 'khach-tu-choi', cat: 'an-toan', icon: 'hand',
    title: 'Tôn trọng ==khách==\n==từ chối== nhận tin',
    lead: 'Thêm link từ chối nhận tin vào cuối tin. Khách đã từ chối sẽ không nhận tin nữa.',
    points: ['Link từ chối ở cuối tin nhắn', 'Danh sách khách loại trừ', 'Loại trừ người thân, đối tác'] },

  // Hỗ trợ
  { id: 'dong-hanh-1-1', cat: 'ho-tro', icon: 'headset',
    title: 'Tư vấn viên ==đồng hành 1:1==',
    lead: 'Tư vấn viên akaBiz cài chiến dịch đầu tiên cùng bạn và hỗ trợ suốt quá trình dùng.',
    points: ['Cài chiến dịch đầu tiên cùng bạn', 'Tư vấn mức gửi an toàn', 'Hỗ trợ suốt quá trình dùng'] },
  { id: 'dung-thu', cat: 'ho-tro', icon: 'gift',
    title: 'Dùng thử ==miễn phí 3 ngày==',
    lead: 'Full tính năng, chạy thử ngay trên tệp khách thật của bạn.',
    points: ['Gửi tư vấn viên SĐT chưa đăng ký akaBiz', 'Nhận tài khoản dùng thử trong ngày', 'Chạy chiến dịch đầu tiên cùng tư vấn viên'] },
];

module.exports = { brand, trial, topics, cover, safety, faq, back, pricing, features };
