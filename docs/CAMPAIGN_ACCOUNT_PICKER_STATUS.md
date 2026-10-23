# Trạng thái hành động trong ô chọn tài khoản chiến dịch

Ngày 23/10/2026, Desktop dùng danh sách gọn: mỗi tài khoản một dòng, giữ nhóm,
checkbox/radio và trạng thái đăng nhập. Các cột lấy theo loại chiến dịch, luôn
hiện đủ hành động chính dù chưa tích chọn (ví dụ Nhắn tin và Kết bạn).
Đăng bài trang cá nhân chỉ hiện Đăng bài, không lấy Comment/Like từ bộ mô tả chung.
Đăng bài group hiện thêm Comment khi tích Kiêm comment; hai loại Comment seeding
hiện thêm Like khi tích Like bài post khi comment. Bỏ tích thì ẩn lại cột phụ.
Lướt newsfeed vẫn hiện cả Comment và Like, kể cả khi chưa tích chọn.
Không hiện Gắn tag/Đổi tên Zalo.
Quy tắc riêng của picker không đổi màn hình Hành động của tài khoản.

## Sửa trạng thái đăng nhập bị cắt — 23/10/2026

Theo yêu cầu mới, Desktop và Web tách trạng thái đăng nhập khỏi vùng rút gọn tên/loại tài khoản. Trạng thái giữ đủ chữ và màu trên cùng một hàng; tên/loại dài mới dùng dấu `…`, tooltip vẫn chứa nhãn đầy đủ. Cột thống kê và chiều cao hàng giữ gọn. SMS tiếp tục chỉ hiện tên tài khoản.

Đây là thay đổi render/CSS, không đổi snapshot, IPC/API hoặc truy vấn. Các kiểm tra hình học dùng form thật xác nhận chữ trạng thái nằm đủ trong nhãn và viewport của bộ chọn, với tên dài, trạng thái đã/chưa đăng nhập và cửa sổ hẹp. Bản sửa chưa đóng gói/phát hành.

Hồi quy `campaign-action-usage-smoke-test.cjs` bắt được lỗi trên bản cũ và đạt sau sửa, gồm Electron 1440px/1000px cùng các ca snapshot/form hiện có. Hai typecheck và production build đạt. Đã xem ảnh giao diện tên Zalo dài giữ đầy đủ trạng thái.

Mỗi ô là `128 - Bình thường`, `150 - Bị giới hạn - Còn 18 phút`, hoặc
`20 - Bị giới hạn` khi không có thời điểm mở lại. Số lượng là tổng lượt hành động
của tài khoản trong ngày Việt Nam, không cộng gộp các loại hành động. Dữ liệu đang
tải, lỗi hoặc không thuộc snapshot hiển thị dấu `—`, không giả làm số 0.

## Một snapshot khi mở form

Người dùng chọn tải một lần các bộ đếm ngày/trạng thái mà form có thể dùng.
Sau khi catalog tài khoản, hành động và lần tải cấu hình hiển thị của form sẵn sàng, hook gửi một IPC
`ACCOUNT_CAMPAIGN_ACTION_SNAPSHOT`. Phạm vi gồm tài khoản hiện có và các hành động
mà lựa chọn đang hiển thị trong form có thể dùng (gồm tùy chọn chưa bật và bộ đếm ngày của phần
Giới hạn). Form thêm/nhân bản/nháp chỉ lấy loại đang hiển thị và loại hiện tại;
loại đã ẩn, không thể chọn không góp mã vào query. Form sửa chiến dịch đã tạo
giữ catalog đầy đủ trong bộ chọn, nên snapshot ban đầu cũng lấy đủ các loại đó:
đổi sang một loại đã ẩn trong cài đặt vẫn có thống kê ngay, không query thêm.
Hook chờ lần tải cấu hình mới
của form hoàn tất ngay cả khi store đang giữ cache; lỗi cấu hình chưa query thống kê,
người dùng có thể bấm Thử lại ở cấu hình. Không có lựa chọn/hành động hiện tại thì
snapshot rỗng, không IPC/query thống kê. Dùng lần tải cấu hình hiện có, không thêm request.
Comment của Đăng bài group và Like của Comment seeding được tải sẵn ngay cả khi
chưa tích chọn hoặc không có trong catalog hạn mức, để bật tùy chọn là có số liệu
mà không query thêm. Không tải Gắn tag/Đổi tên hay Comment/Like của Đăng bài trang
cá nhân chỉ để phục vụ picker; các mã không phục vụ cột có thể hiện hoặc hạn mức
thì không góp vào query. Phần Giới hạn vẫn dùng chung snapshot.
Ẩn/hiện cột không thay đổi kiểm tra trạng thái khóa/hạn mức Like của runtime,
không đổi tùy chọn Like tối đa của Lướt newsfeed hoặc màn hình Hành động của tài khoản.
Form bị khóa loại hành động chỉ lấy loại đó; sửa chiến dịch `data_group`
khóa tài khoản thì chỉ lấy tài khoản chính đã chọn. Đổi lựa chọn, bật/tắt tùy
chọn, mở lại dropdown, focus, sửa hạn mức hoặc có cập nhật account store không
query lại. Đóng rồi mở form mới tạo snapshot mới. Không polling/realtime hoặc
timer đếm ngược. Số phút cũng là giá trị tại thời điểm lấy snapshot.

Phạm vi thống kê dùng chung quy tắc tương thích tài khoản với ô chọn tài khoản,
rồi hợp nhất mã theo từng tài khoản. `zalo_message_group_realtime` không góp mã
cho Zalo trình duyệt; tài khoản QR/Server vẫn được giữ. Nếu form còn loại chiến
dịch khác hỗ trợ Zalo trình duyệt, chỉ lấy mã của loại đó cho tài khoản này,
kể cả mã dùng chung với realtime. Những tài khoản có cùng tập mã được gom thành
một phạm vi; không có cặp tương thích thì không gửi IPC thống kê.

Phần Giới hạn dùng lại bộ đếm ngày của tài khoản đang chọn; nhiều tài khoản vẫn
không hiển thị thống kê của một tài khoản bất kỳ. Bỏ thống kê lượt trong giờ khỏi
form. Các ô cấu hình hạn mức ngày/giờ/số phút và cách scheduler áp hạn mức giữ
nguyên. API thống kê cũ và màn hình Hành động của tài khoản riêng giữ hành vi cũ.

## Truy vấn và quyền

Reader mới dùng Supabase HTTP client hiện có, không schema/RPC/migration hoặc
nguồn connection mới. Không truy vấn `auto_campaign_details`, không count HEAD,
không gọi overview cũ và không tạo/reset/unlock trạng thái.

- Catalog chỉ `code,flatform_type`, lọc mã yêu cầu + active/not deleted + gói.
- Tài khoản chỉ `id,flatform_type,is_zalo_show_web,is_zalo_server`, lọc ID,
  staff/organization/not deleted và quyền nền tảng/loại Zalo trước khi đọc trạng thái.
- Trạng thái chỉ `account_id,action_code,count_action_in_day,count_date,is_disable,date_enable`,
  lọc đúng cặp nhóm tài khoản/mã hành động hợp lệ theo nền tảng.
- Đọc tài khoản từng lô tối đa 100. Mỗi lô trạng thái có tối đa 500 cặp
  `(account_id,action_code)` dựa trên unique key, tránh bị cắt tại row cap 1.000.
  Các lô chạy tuần tự; không fan-out theo từng account/action.
- Dùng DB clock/cache monotonic hiện có. Ngày cũ hoặc thiếu dòng cho cặp hợp lệ
  trả số 0 mà không ghi DB; ngày tương lai báo lỗi. Giới hạn đã đến thời điểm mở
  lại được diễn giải là bình thường, không gọi RPC unlock từ form. Ngày mở lại
  thiếu/không đọc được giữ trạng thái giới hạn và không hiện số phút giả.
- HTTP có AbortSignal dùng chung với deadline 15 giây và đổi phiên đăng nhập;
  không tự retry ở reader. Bỏ phản hồi phiên cũ ở cả main và renderer. Lỗi bất kỳ
  lô nào không trả một snapshot thiếu rồi biến dữ liệu chưa đọc thành số 0.
  Bước chờ DB clock cũng chịu deadline/abort của caller qua `withRequestDeadline`;
  không hủy request clock dùng chung với runtime. Clock hoàn tất hoặc lỗi muộn
  được xử lý, không tiếp tục query trạng thái của snapshot đã hủy.

## Kiểm chứng

- `node scripts/campaign-account-picker-repository-smoke.cjs`: PostgREST client
  thật với transport local; kiểm tra projection/filter/quyền, rollover, thiếu
  dòng/ngày tương lai, giới hạn có/không/đã đến hạn, phiên cũ, lỗi không retry,
  không history/count/write và 3.232 trạng thái không bị cắt. Hồi quy review dùng
  deadline thực 15 giây khi clock treo, đổi phiên trong lúc chờ, kết quả/lỗi muộn,
  cleanup listener và bảo toàn caller khác dùng cùng clock.
- `node scripts/campaign-action-usage-smoke-test.cjs`: hồi quy reader cũ; hook
  snapshot và form React thật trong Electron, StrictMode, create/edit/clone/draft,
  đổi action/account/toggle/focus/dropdown không query, không thống kê giờ, lỗi và
  phản hồi phiên cũ, bố cục một dòng. Form Zalo có sáu tài khoản, ba hành động,
  tên Server dài và cửa sổ 1.000px giữ một dòng, không query khi đổi kích thước.
  Bỏ tích Nhắn tin/Kết bạn vẫn giữ đủ cột và số liệu; bật Gắn tag/Đổi tên không
  thêm cột hoặc query. Hai loại Comment seeding bật/tắt Like thì hiện/ẩn cột và
  giữ số liệu đã tải kể cả khi catalog hạn mức không có Like; Lướt newsfeed vẫn
  có cả Comment/Like dù chưa bật. Đăng bài group bật/tắt kiêm comment thì hiện/ẩn
  cột Comment, không lấy lượt like không dùng. Các thao tác này không query lại.
  Đăng bài trang cá nhân chỉ có cột Đăng bài và không góp Comment/Like vào query picker.
  Form sửa `data_group` bị khóa chỉ gửi ID tài khoản chính; tạo/sửa thường/nhân
  bản/nháp vẫn tải một lần toàn bộ tài khoản có thể chọn.
  Hồi quy ẩn loại chiến dịch xác nhận chờ cấu hình mới với/không cache, loại mã
  không thể chọn khỏi request, giữ hành động hiện tại khi nhân bản/nháp, không query
  khi tất cả bị ẩn và chưa chọn, không dùng cache sau lỗi tải và chỉ query một
  lần sau Thử lại thành công. Form sửa tải đủ các loại trong bộ chọn; chuyển từ
  nhắn tin sang đăng bài đã ẩn vẫn hiện số lượt/trạng thái và số ngày ở Giới hạn,
  đổi loại/focus/mở lại picker giữ đúng một request. Form sửa `data_group` khóa
  loại/tài khoản vẫn chỉ lấy cặp cố định dù catalog sửa đầy đủ.
  Hồi quy tương thích xác nhận realtime với loại khác bị ẩn/form khóa không lấy
  Zalo trình duyệt, form nhiều loại tách đúng tập mã QR/Server và trình duyệt,
  mã dùng chung vẫn được giữ và gom lô, đổi loại dùng số liệu đã tải, không có
  tài khoản tương thích thì không query.
- `node scripts/account-action-overview-scope-smoke.cjs`: overview riêng vẫn giữ
  phạm vi, RPC unlock, bộ đếm giờ explicit/legacy và hành động phụ.
- Cả ba smoke trên, hai typecheck (`tsconfig.node.json`, `tsconfig.web.json`)
  và production build đều đạt. Query kiểm chứng bằng fixture local, không đọc
  hoặc ghi dữ liệu production trong lượt kiểm thử này.

Cần restart main/preload khi chạy dev để nhận IPC mới. Chưa đóng gói/phát hành.
