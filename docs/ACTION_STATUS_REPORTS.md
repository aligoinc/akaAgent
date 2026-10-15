# Báo cáo theo trạng thái hành động — 16/10/2026

## Phạm vi

Một trang **Báo cáo**, hai tab **Trạng thái chung** (mặc định) và **Trạng thái hành động**. Desktop dùng các kênh/quyền hiện có; Web dùng Zalo/SMS. Không thêm màn hình native mobile. Tab chung giữ bốn nhóm, API và cách tính cũ; báo cáo ngày Web giữ nguyên.

Bộ lọc kênh, tài khoản, hành động, thời gian dùng chung. Chỉ tải tab đang xem. Đổi tab/bộ lọc/phiên hoặc ẩn trang Desktop vô hiệu hóa phản hồi tổng hợp, chi tiết và xuất file đang chờ. Excel tổng hợp lấy chính snapshot đã tải; chi tiết/export dùng thời gian, tài khoản, hành động và selector của snapshot đó.

## Cột và cách đếm

- Mỗi hành động có Chờ xử lý, tiếp theo là trạng thái chính từ `auto_campaign_action_detail_statuses` và `auto_status`, sắp theo sort_order/id của cấu hình, gộp trùng khóa trạng thái. Cột đang bật/chưa xóa vẫn hiện khi bằng 0.
- Wildcard chỉ áp dụng trong loại chiến dịch chứa hành động: xác định bằng danh sách hành động thực thi của loại chiến dịch (gồm tùy chọn và hành động không kiểm tra hạn mức), kết hợp `limit_check_action_codes` và mapping hành động cụ thể. Danh sách này dùng chung bộ mô tả hành động hiện có, không phụ thuộc chiến dịch đã tạo. Không đưa wildcard từ chiến dịch không liên quan sang.
- Trạng thái đã tắt/xóa cấu hình nhưng có kết quả trong phạm vi lọc được bổ sung sau các cột cấu hình. Không đọc policy để phân nhóm lại lịch sử.
- Kết quả có `report_group=pending` chỉ vào Chờ xử lý. Cộng thêm input đang chờ theo lịch hiệu lực của báo cáo cũ; bỏ cặp input–hành động đã được kết quả pending đại diện trong khoảng thời gian đó. Một input nhiều hành động vẫn được xét riêng từng hành động có bật.
- Các kết quả còn lại đếm một lần theo tài khoản/action_code/status_id. Legacy thiếu status_id chỉ ghép theo status_value chính xác khi duy nhất trong cùng kênh hoặc all; chuỗi mơ hồ/không khớp giữ khóa legacy riêng, không chuẩn hóa mất nghĩa.
- Không đọc sub_status_id để thống kê. Cùng một trạng thái có thể được cấu hình làm chính trong lịch sử và dùng làm phụ ở kết quả mới; chỉ trường chính quyết định số đếm. Trạng thái phụ vẫn có trong bảng chi tiết và Excel chi tiết.
- Kết quả lọc created_at trong [startIso, endIso). Input dùng schedule của input, chỉ fallback schedule chiến dịch khi NULL; giữ các điều kiện nghiệp vụ cũ.

## Đường đọc và tài nguyên

Desktop có contract riêng tại `src/shared/actionStatusReport.ts`, hai IPC `report:account-action-status-summary` và `report:account-action-status-details`, qua service/repository hiện có. Selector phân biệt pending / status(statusId) / legacy(status).

Web có hai GET đã xác thực dưới control API prefix:

- `/reports/account-action-statuses`
- `/reports/account-action-statuses/details` với statusKind=pending|status|legacy; statusId hoặc legacyStatus tương ứng.

Tái sử dụng reader pending gộp hai nguồn, phân trang và keyset export giữ microsecond. Giữ metadata tenant/account, left embed lịch sử Desktop và guard tenant/Server Web. Chi tiết pending có tổng bằng hợp hai nguồn sau chống trùng.

Catalog tải tuần tự bằng HTTP client hiện có, từng trang 500; aggregate kết quả dùng trang ID 1.000 hiện có. Giữ max hai report đồng thời/process, in-flight dedupe, deadline đọc 20 giây/export 60 giây. Web giữ cache tổng hợp 15 giây, tối đa 32 entry/4 MiB, mỗi entry tối đa 512 KiB; chi tiết không cache. Khóa phân biệt loại báo cáo, scope quyền và bộ lọc. Không polling/retry tự động, connection/pool mới hay thay hạn mức.

Không migration/RPC/backfill, không sửa policy/lịch sử/producer.

## Kiểm chứng

- `node scripts/run-report-loading-smoke-test.cjs`: Supabase query builder thật với HTTP fixture; >1.000 input/kết quả, mốc đầu/cuối, lịch fallback, đa hành động, pending có/không input, chống trùng, phân trang, export keyset/microsecond, tenant, zero/duplicate/wildcard/disabled/legacy/main-only, đối chiếu mọi cột với tổng export.
- `node scripts/run-report-ui-smoke.cjs`: Electron thật ở 1440 và 850 px, mặc định chung/tải tab khi cần, bộ lọc hẹp, màu nền tối, chi tiết/trạng thái phụ, Excel thật được đọc lại, ẩn/hiện và phản hồi tổng hợp muộn. Ảnh kiểm tra: `/tmp/aka-report-ui-review`.
- Hai typecheck `tsconfig.node.json`, `tsconfig.web.json` và production build Desktop.
- Web: repository/route/client/UI/cache tests; bộ typecheck/test/build theo repo; Playwright `report-statuses.spec.ts` trên Desktop Chromium, Android Chromium và iPhone WebKit (chỉ trình duyệt Web). Tải và đọc lại hai file Excel thật, kiểm tra hồi quy tab chung.
- Đối chiếu read-only catalog akachat và chạy PostgREST thật với account_id=-1: catalog phân trang, ba selector, legacy có dấu phẩy/dấu nháy, relation chính/phụ và cursor microsecond đều đạt; không đọc dòng khách hàng hay gửi tin/chạy chiến dịch thật.

## Bàn giao và hoàn nguyên

Kết quả local: hai typecheck và build Desktop đạt; Web toàn bộ typecheck/build đạt, tests theo workspace: control-api 20, campaign-core 66, control-client 51, API 891, Web 685, mobile hồi quy 229. Lượt đầy đủ đầu tiên có một timeout 5 giây ở test danh sách chặn Zalo; chạy lại toàn bộ Web sau build đạt 73/73 file, 685/685 test, không đổi timeout hay mã danh sách chặn. Electron và cả ba profile browser đều đạt; cập nhật test cache/late-export cũng đã kiểm chứng.

Mã nguồn local; chưa deploy Web, chưa đóng gói/phát hành Desktop. Giữ các thay đổi có sẵn ở hai checkout. Hoàn nguyên riêng các file/hunk của báo cáo mới; không dùng reset/restore toàn checkout và không sửa DB. Các bản đã phát hành tiếp tục dùng API báo cáo chung hiện có.


## Sửa sau review — 16/10/2026

- Khắc phục thiếu cột wildcard bằng 0 khi danh sách hạn mức rỗng hoặc không có hành động tùy chọn. Danh sách khả năng của loại chiến dịch dùng chung bộ mô tả thực thi hiện có; không đổi hành động được bật khi chạy hay quy tắc hạn mức, không đọc thêm query.
- Bỏ giới hạn 200 ký tự ở selector legacy và schema GET Web. Giữ nguyên chuỗi trạng thái khi lọc chi tiết/xuất, kể cả dấu nháy, dấu phẩy, gạch chéo và khoảng trắng; không cắt hoặc chuẩn hóa lịch sử.
- Hồi quy mới qua repository/catalog loader: Facebook timeline, group post, cả hai comment seeding và newsfeed với hạn mức rỗng/khuyết; Web Zalo hủy kết bạn, tìm số điện thoại/nhắn tin/kết bạn và SMS. Kiểm tra cột 0 đúng thứ tự và loại wildcard không liên quan. Trạng thái legacy dài được đối chiếu tổng hợp/chi tiết/export; route xác thực kiểm tra cả đọc trang và export.
- Không migration, RPC, connection, polling, phát hành hoặc deploy trong lượt sửa.
- Kiểm chứng sau sửa: smoke báo cáo Desktop, hai typecheck và production build đạt; Web typecheck/build đạt, toàn bộ test chạy một lượt đạt: control-api 20, campaign-core 66, control-client 51, API 894, Web 685, mobile 229. `git diff --check` sạch ở cả hai repo. Lượt sửa không đổi giao diện; các kiểm chứng browser/Excel thật trước đó vẫn là kết quả của lần triển khai ban đầu.

## Ký tự điều khiển trong trạng thái legacy — 16/10/2026

Review phát hiện JSON.stringify không phải cú pháp quoted literal của PostgREST: LF/CR/tab thành chữ n/r/t, có thể lấy nhầm trạng thái gần giống. Helper mới chỉ escape dấu nháy kép và backslash, giữ nguyên ký tự điều khiển ở cả selector legacy và nhánh đối chiếu status_value của trạng thái chính. Không thay cách đếm, API, policy hoặc lịch sử.

Fixture PostgREST ở hai repo bỏ JSON.parse và mô phỏng đúng pQuotedValue; biểu thức lọc nhận cả xuống dòng thật. Test tái hiện trước sửa: tổng hợp 1.001 nhưng chi tiết trả nhầm 1 dòng. Hồi quy sau sửa kiểm tra LF, CRLF, tab, backslash-n dạng chữ, dấu nháy/backslash/dấu phân cách và khoảng trắng, raw/canonical legacy, phân trang và export hơn 1.000 dòng; client và route GET giữ nguyên chuỗi.

Bốn probe PostgREST chỉ đọc, giới hạn id=-1 và kiểm tra lỗi ép kiểu, xác nhận literal giữ nguyên trên server; không đọc dữ liệu khách hàng hay ghi DB. Không migration/RPC/connection/polling hoặc deploy/phát hành.

Kiểm chứng lượt sửa này: smoke Desktop, hai typecheck và production build Desktop đạt; 94 test báo cáo/API và 10 test báo cáo/client Web đạt. Web typecheck và build đạt sau khi chạy lại (lượt đầu gặp fixture CampaignsPage thiếu trường updated đang được sửa song song; lượt này không chỉnh file đó). Bộ npm test toàn repo: control-api 20, campaign-core 66, control-client 51, API 895, mobile 229 đạt; Web 680/691 đạt, còn 11 lỗi ngoài báo cáo: 10 AppShell thiếu RealtimeProvider qua CampaignEditDialogs và 1 DataGroupsPage không khớp thông báo. Chạy lại riêng hai file lỗi cùng ReportsPage/reportApi vẫn xác nhận 11 lỗi đó; cả 10 test báo cáo đạt. Giữ nguyên các thay đổi ngoài phạm vi, không tuyên bố toàn bộ test Web đã sạch. git diff --check sạch ở hai repo.

## Phạm vi PR và hiệu năng — 16/10/2026

Theo quyết định của người dùng, PR giữ cách đọc/phân trang và index hiện có; hoãn tối ưu hiệu năng báo cáo. Không thêm pool, connection, polling, RPC hoặc migration. Giới hạn hai lượt tải áp dụng mỗi process, không phải toàn hệ thống. Tổng hợp vẫn đọc toàn bộ dòng khớp bộ lọc theo từng trang 1.000 dòng rồi cộng trong ứng dụng; khoảng thời gian rộng hoặc nhiều lịch sử có thể tải chậm.

Kiểm tra read-only bằng EXPLAIN/EXPLAIN ANALYZE trên akachat: các truy vấn mẫu dùng index hiện có. Trên một tài khoản nhiều lịch sử, query kết quả hôm nay khoảng 2 ms; trang đầu data chờ có lịch trong 30 ngày khoảng 113 ms; trang đầu kết quả 30 ngày ở dạng Desktop và Web đều chạm timeout thử nghiệm 3 giây. Đây là từng query DB, không phải thời gian toàn bộ báo cáo hoặc kết quả tải đồng thời; timeout thử nghiệm không thay deadline ứng dụng. Không tạo/sửa index và không coi các test chức năng là kiểm chứng tải lớn.

## Kiểm chứng nhánh PR — 16/10/2026

Nhánh PR được tách từ origin/dev_3, chỉ chứa 18 file báo cáo và tài liệu; giữ nguyên các thay đổi đang làm song song ở checkout gốc. Hai typecheck tsconfig.node.json/tsconfig.web.json, production build, smoke repository và Electron UI đều đạt trên chính nhánh này. UI kiểm tra 1440/850 px, hai tab, cột 0, pending drilldown, Excel tổng hợp/chi tiết tải thật và phản hồi muộn. Chưa phát hành Desktop.
