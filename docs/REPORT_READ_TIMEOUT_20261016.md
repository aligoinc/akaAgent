# Sửa timeout đọc báo cáo — 16/10/2026

Đã apply trên akachat (`cgjbsmqtfhqvttudyjzq`) với history `20261015230729 / report_read_timeout`. Không apply lại khi merge/phát hành. Migration: `supabase/migrations/20261015230729_report_read_timeout.sql`.

## Nguyên nhân và thay đổi

Desktop dùng Supabase HTTP role `anon`, có `statement_timeout=3s`; hạn AbortSignal 20 giây trước đây không thay timeout của PostgreSQL. Query đọc data chờ bị DB hủy trước hạn ứng dụng. Web service-role cũng phụ thuộc timeout của Data API khi đọc trực tiếp.

Thêm RPC chỉ đọc `public.aka_agent_read_report_page(bigint,bigint,text,text,jsonb)`, `STABLE SECURITY DEFINER`, search_path cố định `pg_catalog, public`, timeout riêng **60 giây**. Desktop/Web chuyển đọc kết quả và input chờ của hai tab, chi tiết và Excel sang RPC này. Báo cáo ngày Web dùng reader chung nên giữ kết quả/cách tính; không đổi endpoint/contract giao diện. Catalog, account và campaign scope nhỏ vẫn đọc bằng client hiện có.

Hạn toàn lượt tải ứng dụng là **65 giây**, gồm các trang và phần chờ mạng; không có nghĩa mỗi trang được cộng thêm 65 giây. Giữ hai lượt tải/process, cache Web 15 giây, cache key/phân quyền/tenant và cơ chế bỏ phản hồi cũ. Không tăng timeout global/role, không thêm pool, connection, polling, worker, bảng hoặc index. Một lần `NOTIFY pgrst, 'reload schema'` trong migration để công bố RPC mới.

Trang tối đa 1.000 dòng; account scope tối đa 10.000 ID, campaign scope tối đa 200 ID. Kết quả tổng hợp dùng cursor `(created_at,id)` tăng dần, chi tiết/xuất kết quả dùng giảm dần; data chờ dùng `(campaign_id,id)`. Giữ timestamp microsecond. Cách tính pending hai nguồn/chống trùng, trạng thái chính/phụ, lịch hiệu lực, dữ liệu legacy và zero columns không đổi. Bộ chọn trạng thái truyền dưới dạng JSON giá trị; SQL chỉ ghép fragment cố định, mọi giá trị dùng bind parameter, giữ nguyên LF/CR/tab/nháy/backslash.

RPC dùng helper identity hiện có, không sửa helper. Desktop gửi credential RAM theo cơ chế hiện có; Web dùng service-role của backend. RPC kiểm tra staff còn active/đúng org; mọi account yêu cầu phải thuộc staff/tenant và chưa xóa; mọi campaign phải đúng staff/tenant. Join data chờ kiểm tra lại account/campaign đang hợp lệ; metadata campaign/input kết quả chỉ hiện trong đúng tenant. `PUBLIC` không được EXECUTE; anon/authenticated cần credential hợp lệ, service-role chỉ nhận scope từ backend đã xác thực.

Security Advisor báo hai cảnh báo khả năng gọi SECURITY DEFINER qua anon/authenticated, đúng mô hình xác thực credential của Desktop. Đã giữ guard và kiểm thử sai credential/account/campaign, không cấp quyền SELECT mới hoặc dùng SECURITY INVOKER kèm mở quyền helper. [Giải thích cảnh báo Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). Bản lọc cảnh báo và đánh giá lưu trong snapshot.

## Snapshot và kiểm chứng

- Hàm mới trước apply: không tồn tại, kể cả overload; preflight từ chối ghi đè.
- Helper `auto_assert_automation_identity(bigint,bigint,text,text)` checksum trước/sau: `5a9a503db72b965eb644739f5f60905d`; definition/owner/security/config/ACL giữ nguyên.
- RPC mới checksum: `16822ed5a6af165668d9d3ed2d5283c2`; owner postgres, STABLE/SECURITY DEFINER, config timeout 60s, ACL postgres/anon/authenticated/service_role.
- Role timeout sau apply vẫn anon 3s, authenticated/authenticator 8s, service_role không đặt riêng.
- Snapshot, receipt, HTTP và rollback ở `migrations/snapshots/report-read-timeout/`.

SQL smoke chạy trước và sau apply trong transaction rollback, 14 nhóm kiểm tra: >1.000 dòng, cursor timestamp microsecond và pending composite, ranh giới thời gian, legacy ký tự điều khiển, trạng thái phụ không thành cột chính, pending loại trùng, exact count/page, credential và account/campaign scope. Fixture dùng ID âm, không sửa dữ liệu khách hàng. SQL đọc thử 30 ngày trên một account nhiều lịch sử mất 10,8 giây cho trang đầu.

HTTP live **role anon** trả 200 cho trang kết quả 30 ngày: một probe 640 ms, probe khác **13.622 ms**; trang tiếp theo không trùng ID. Chứng minh request thật vượt 3 giây vẫn thành công. Data chờ fallback trả 1.000 dòng ở trang đầu và 1.000 dòng tiếp theo không trùng; probe trang đầu 160 ms. Credential sai bị từ chối. Chỉ lưu thời gian/số dòng/trạng thái HTTP, không lưu credential hay nội dung khách hàng. Đây là probe từng trang, không phải bảo đảm mọi khoảng thời gian lớn hoàn tất trong hạn tổng 65 giây.

Kiểm tra ứng dụng: smoke repository Desktop, RPC transport/cancellation, hai typecheck, production build và Electron UI 1440/850 với Excel thật đạt. Web typecheck toàn workspace, production build, 915 test API (chạy lại sau đổi fixture SMS), 15 test repository báo cáo và Playwright Desktop Chromium/Android Chromium/iPhone WebKit đạt. Root test đã chạy; control-api 20, campaign-core 66, control-client 51, mobile 229 đạt. Kết quả Web toàn bộ và lần chạy lại các test ngoài phạm vi ghi bổ sung cuối tài liệu; không sửa các thay đổi chiến dịch đang làm song song.

## Tự tải và triển khai

Giữ hành vi hiện tại: mở trang tự tải tab chung, đổi tab tự tải tab đang xem, đổi kênh tự tải; sửa chọn account/hành động/thời gian cần bấm Tải báo cáo. Không thêm polling hoặc tự tải cả hai tab.

DB đã sẵn sàng. Desktop dev đang chạy cần restart **main process**; reload renderer không đủ. Desktop chưa đóng gói/phát hành và Web chưa deploy. Khi deploy Web phải đi cùng reader API mới; app cũ vẫn đọc đường cũ và vẫn có giới hạn cũ.

## Hoàn nguyên

Hoàn nguyên riêng reader/method/test/doc của lần sửa trên app trước, giữ các thay đổi local khác. RPC additive có thể để lại trong DB để giữ tương thích. Nếu cần gỡ, dùng `migrations/tests/report_read_timeout_rollback.sql` với checksum guard; không cascade, không xóa migration history, không sửa role timeout/helper. Đã diễn tập DROP trong transaction và ROLLBACK thành công, production vẫn giữ RPC mới. Hoàn nguyên về reader cũ đồng nghĩa khôi phục vấn đề timeout 3 giây.

Kết quả chốt: Web root suite có 711/713 test đạt ở lượt đầu; hai test CampaignFormPage/DataGroupsPage ngoài báo cáo đã chạy lại cùng ReportsPage/reportApi, đạt 129/129 ở cả bốn file. Không sửa các file tính năng đó trong lượt báo cáo. API chạy lại toàn bộ đạt 50 file/915 test; typecheck cuối hai phần Desktop và API đều sạch. Diff phần báo cáo sạch; cảnh báo whitespace của CampaignFormModal thuộc thay đổi local khác được giữ nguyên.

## Kiểm chứng nhánh PR sửa timeout — 16/10/2026

Nhánh `codex/fix-report-read-timeout` tách từ `origin/dev_3`, chỉ mang phần báo cáo; giữ nguyên checkout gốc và các thay đổi đang làm khác. Hai typecheck, production build, smoke repository và RPC transport đều đạt trên chính nhánh PR. Migration và SQL smoke/rollback khớp checksum trong manifest đã apply; lượt tạo PR không thay đổi DB, không deploy Web hoặc phát hành Desktop. Giới hạn kiểm chứng hiệu năng vẫn như phần HTTP: chưa bảo đảm báo cáo nhiều trang lớn hoàn tất trong hạn tổng 65 giây.
