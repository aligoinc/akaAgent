# Báo cáo trạng thái hành động

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 1040–1050. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
## Báo cáo theo trạng thái hành động

Báo cáo ngày 16/10/2026: một trang với hai tab **Trạng thái chung** (mặc định, giữ cách tính cũ) và **Trạng thái hành động**. Tab mới đọc catalog cấu hình chính, giữ cột 0/lịch sử và Chờ xử lý hợp kết quả pending + input theo lịch, chống trùng input–hành động; không đếm sub_status_id. Dùng IPC/contract riêng, reader pending/export và Supabase HTTP hiện có, max hai report; vô hiệu hóa phản hồi muộn theo tab/filter/phiên. Web cùng hợp đồng Zalo/SMS, không đổi native mobile. Không migration/RPC/polling/connection mới; chưa deploy/phát hành. Xem [hợp đồng và kiểm chứng](../../../docs/ACTION_STATUS_REPORTS.md).

Review báo cáo 16/10/2026: wildcard phải nhận cả hành động thực thi tùy chọn/không tính hạn mức; không suy phạm vi chỉ từ `limit_check_action_codes`. Catalog dùng chung bộ mô tả thực thi theo loại chiến dịch, giữ phạm vi wildcard và hành vi runtime/quota hiện có. Selector legacy và route Web giữ nguyên chuỗi trạng thái dài hơn 200 ký tự để chi tiết/Excel khớp tổng hợp; không cắt hay sửa lịch sử. Xem [hồi quy](../../../docs/ACTION_STATUS_REPORTS.md#sửa-sau-review--16102026).

Báo cáo legacy 16/10/2026: literal trong `.or()` PostgREST chỉ escape dấu nháy kép và backslash; không dùng JSON.stringify vì LF/CR/tab sẽ đổi giá trị. Giữ JSON.stringify cho khóa cột/cache JSON. Áp dụng cho selector legacy và fallback status_value, đồng bộ Desktop/Web; fixture phải dùng grammar PostgREST, không JSON.parse. Xem [hồi quy ký tự điều khiển](../../../docs/ACTION_STATUS_REPORTS.md#ký-tự-điều-khiển-trong-trạng-thái-legacy--16102026).

PR báo cáo 16/10/2026 giữ query/index hiện có theo quyết định người dùng; hoãn tối ưu phạm vi lớn. Hai lượt tải là giới hạn mỗi process, không phải toàn hệ thống; test chức năng không thay benchmark. Xem [giới hạn hiệu năng](../../../docs/ACTION_STATUS_REPORTS.md#phạm-vi-pr-và-hiệu-năng--16102026).

Sửa timeout báo cáo 16/10/2026 đã apply trên akachat (`20261015230729 / report_read_timeout`): `aka_agent_read_report_page(bigint,bigint,text,text,jsonb)` đọc kết quả/pending bằng RPC riêng 60s; app có hạn toàn lượt 65s. Giữ credential/tenant/account guards, tối đa 1.000 dòng/trang, hai report/process, cache và cách tính; cursor kết quả `(created_at,id)`, pending `(campaign_id,id)`. Không tăng role timeout/pool/connection/index/polling. HTTP anon >13 giây đã thành công. Không apply lại; Desktop cần restart main, chưa phát hành/deploy Web. [Audit và rollback](../../../docs/REPORT_READ_TIMEOUT_20261016.md).

<!-- END PRESERVED SOURCE -->
