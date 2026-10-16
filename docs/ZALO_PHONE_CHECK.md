# Kiểm tra SĐT có Zalo — 16/10/2026

Tính năng nằm trong **Quét data → Kiểm tra SĐT có Zalo**, modal riêng. Mã nguồn đã triển khai cho Desktop, akaAgent Zalo Server và akaAgentChatApi. Chat API/runtime đã deploy ngày 16/10/2026; bản sửa phân loại mã bên dưới chưa đóng gói/phát hành Desktop hoặc Server cũ. Bản đầu không thêm migration/RPC/bảng/pool/connection/polling. **V407 bên dưới bổ sung hạn mức ngày riêng theo yêu cầu mới: một cột JSONB, setting, RPC và cron; vẫn không thêm bảng, connection hoặc polling và không đổi quota/policy chiến dịch.**

## Hợp đồng giao diện

- Chọn một tài khoản QR, Web hoặc Zalo Server; số lượng mỗi lượt 1–300, mặc định 300. Chạy tuần tự trên các dòng **Chưa kiểm tra** hoặc **Chưa xác định**, theo thứ tự danh sách, không tự chạy lượt tiếp theo. Bấm **Tiếp tục kiểm tra** sẽ kiểm tra lại số đang dở trước khi đi tiếp; bộ lọc và checkbox không thay phạm vi chạy.
- Tiến độ **Đã có kết quả N/M** tính trên toàn bộ danh sách, chỉ đếm **Có Zalo / Không tìm thấy Zalo**. Giữ tổng qua nhiều lượt, không cộng trùng số được thử lại; dòng đang chạy hiện STT gốc (ví dụ **Đang kiểm tra số 50/300**). Hoàn tất một lượt theo giới hạn vẫn báo số còn lại; khi tất cả đã có kết quả thì khóa nút chạy tiếp. Tải data mới đặt lại tiến độ; đóng modal không lưu phiên.
- Dùng `CampaignDataUploadModal` với `zalo_message_phone` và external sink. Chỉ `rows[].phone` đi qua ranh giới nhập liệu; không giữ tên, UID, email, Info hay dữ liệu nguồn. Chuẩn hóa bằng helper SĐT hiện có, bỏ số sai và trùng. Trên 300 số hợp lệ không trùng báo chia file; main kiểm tra lại payload/giới hạn. Tải data mới thay danh sách trong modal.
- Bảng gồm checkbox, STT, SĐT, Tên Zalo, Zalo ID, Trạng thái, Ghi chú. Tên/ID chỉ từ API. Có bộ lọc và chọn toàn bộ dòng đang lọc; không tự bỏ chọn khi chạy, xuất hoặc lưu nhóm.
- Zustand store riêng cho mỗi modal, ID ổn định bằng SĐT đã chuẩn hóa. Table chỉ subscribe danh sách ID; từng hàng memo và subscribe đúng dữ liệu/chọn của chính nó. Bộ đếm/tiến độ subscribe riêng. Cập nhật dòng giữ nguyên object của các dòng khác.
- Khi chạy khóa tài khoản, số lượng và nhập file. Có Dừng; đóng lúc đang chạy cần **Dừng và đóng**. Chờ cleanup trước khi đóng; unmount/logout cũng yêu cầu hủy. Không tự lưu lịch sử kết quả.

## API và runtime

`zaloPhoneSearch.ts` là logic tìm kiếm dùng chung với chiến dịch: `/api/friend/profile/get`, `reqSrc=32` trước; fallback `40` theo policy `zalo_find_phone_user` hiện có, giữ ưu tiên lỗi giới hạn giờ so với ngày và hành vi fallback lỗi kỹ thuật. Không gọi SDK `findUser()` cố định 40. Abort được kiểm tra trước/sau request và trước fallback.

`ContactLoader.checkZaloPhones()` dùng claim/release của Quét data và active-load guard hiện có. Các số cách nhau 2–5 giây; session/request có deadline 30 giây. Không gọi helper chiến dịch, ghi detail/quota hoặc hành động phụ.

Theo yêu cầu mới nhất ngày 16/10/2026, xử lý sau khi đã chọn kết quả reqSrc 32→40. Riêng bốn mã giới hạn thay thế quy tắc akaBizAuto cũ:

- `error_code=0` → **Có Zalo**, tiếp tục số kế tiếp.
- `312`, `221` → báo **đạt giới hạn giờ**, giữ **Đang kiểm tra**, nghỉ theo setting rồi kiểm tra lại **đúng số đó**. Không tính là kết quả. Nếu vẫn giới hạn giờ thì tiếp tục chờ, không giới hạn số chu kỳ chờ.
- `313`, `304` → báo **đạt giới hạn ngày**, chuyển số hiện tại thành **Chưa xác định**, dừng và giữ số sau **Chưa kiểm tra**. Không tự chạy vào ngày sau; bấm Tiếp tục sẽ kiểm tra lại số chưa có kết quả.
- Các mã phản hồi Zalo khác, gồm `212`, `214`, `216` → **Không tìm thấy Zalo**, tiếp tục số kế tiếp.
- Lỗi transport/runtime không có mã phản hồi Zalo, timeout hoặc phiên không sẵn sàng → **Chưa xác định**, dừng lượt và giữ phần còn lại **Chưa kiểm tra**, riêng `fetch failed` được thử lại theo quy tắc bên dưới. HTTP status không phải `error_code`: SDK không gắn HTTP status vào mã Zalo; Chat giữ mã lỗi transport riêng. Claim/session lỗi trước một số vẫn giữ các dòng chưa kiểm tra và thông báo ở tiến độ.

Thử lại `fetch failed` theo yêu cầu ngày 16/10/2026: khi lỗi tra cứu có đúng message `fetch failed` (không phân biệt hoa/thường, bỏ khoảng trắng hai đầu), mã rỗng hoặc `data_scan_failed`, nghỉ ngẫu nhiên **2–5 giây** bằng helper nghỉ giữa hai số hiện có rồi tra cứu lại **đúng SĐT đó**. Tối đa **3 lần kiểm tra, tính cả lần đầu** (hai lần thử lại); bộ đếm đặt lại cho mỗi số. Mỗi lần kiểm tra vẫn giữ logic reqSrc 32→40 hiện có, nên có thể chứa request fallback. Trong lúc nghỉ/thử lại, dòng giữ **Đang kiểm tra**, ghi chú hiện lần thử và thời gian nghỉ; không tăng tiến độ hoặc chuyển số. Thành công hoặc nhận mã Zalo không giới hạn thì xóa ghi chú chờ, phân loại và đi tiếp; mã giới hạn áp dụng quy tắc giờ/ngày ở trên; lỗi `fetch failed` cả ba lần mới chuyển **Chưa xác định** và dừng, giữ số sau pending. Không thử lại AbortError/TimeoutError, lỗi phiên/capability, HTTP status hoặc lỗi kỹ thuật khác. Giữ claim suốt các lần thử, nhả một lần khi kết thúc; Dừng/đóng/logout/đổi runtime trong lúc nghỉ chặn request tiếp theo qua cơ chế hủy hiện có. Không đổi helper chiến dịch hoặc thêm retry trong Chat API.

Ngoài bốn mã giới hạn được thay đổi theo yêu cầu mới, giữ phân loại akaBizAuto hiện có. Tên/UID chỉ lấy từ hồ sơ API; không tự tạo khi chỉ nhận mã giới hạn hoặc phản hồi thành công thiếu hồ sơ. UID không hợp lệ để trống. Nhóm Zalo UID vẫn từ chối dòng thiếu UID; nhóm SĐT và Excel vẫn nhận dòng được chọn. Helper `classifyZaloPhoneCheckApiCode` chỉ dành cho phân loại lượt quét, không đổi policy/quota của chiến dịch.

Sửa review P2: `AbortError`/`TimeoutError` được nhận diện trước khi đọc mã phản hồi. DOMException có `code=20/23` nhưng đây là mã hủy/timeout của request, không phải phản hồi Zalo. Khi phiên Web đổi generation giữa request, dòng hiện tại là **Chưa xác định**, dừng lượt, số kế tiếp giữ **Chưa kiểm tra**, nhả claim một lần. Không loại cứng số 20/23 khỏi bảng mã: nếu đó là phản hồi API Zalo thật thì vẫn áp quy tắc akaBizAuto.

Thông báo lỗi kỹ thuật ngày 16/10/2026: dòng **Chưa xác định** và thông báo dừng lượt giữ thêm `message` của lỗi, gồm `errorMessage` được Chat API/runtime chuyển về. Ví dụ `data_scan_failed` kèm `Request failed with status code 429` vẫn là lỗi transport, không được coi HTTP 429 là mã phản hồi Zalo. Chi tiết dùng bộ che credential hiện có, bỏ URL HTTP/proxy, chuẩn hóa khoảng trắng và giới hạn 500 ký tự trước IPC/Excel; không đưa stack/cause/payload vào kết quả. Thiếu nội dung lỗi giữ câu dự phòng; runtime cũ giữ hướng dẫn cập nhật riêng. Phần chi tiết lỗi không thay fallback 32→40, hủy/timeout hoặc claim/release.

- **QR/Web:** runtime hiện có, truyền AbortSignal vào custom API/request.
- **Server cũ:** `contacts.checkZaloPhones` và `contacts.cancelPhoneCheck`. Kết quả từng dòng qua event transport hiện có, chỉ live, không thêm reconnect/activity history. Lượt gắn với socket Desktop, socket đóng hủy đúng runId. Tombstone RAM có giới hạn/TTL chặn lệnh bắt đầu đến sau hủy; không có timer dọn riêng. Giữ guard thế hệ runtime cho cleanup.
- **Chat-backed Server:** thêm `find_user_by_phone` vào Data Scan protocol, payload chỉ `phoneNumber`, `reqSrc:32|40`. Adapter gọi low-level custom API, không gọi wrapper campaign có publish metadata. Dùng session, adapter, transport, hàng đợi theo account và start/poll/cancel hiện có; không thêm vòng polling. Query này không vào danh sách tự retry 429. Hủy/deadline dừng transport và bỏ phản hồi muộn.
- Runtime Chat quảng bá `data_scan_phone_lookup` qua hello hiện có. API kiểm tra capability trước dispatch; runtime cũ báo `phone_check_update_required`. Backend cũ từ chối query mới cũng được Desktop chuyển thành hướng dẫn cập nhật. Không fallback về API cũ.

IPC mới có start/cancel/row/completed; start/cancel kiểm tra main-frame, user/credential, quyền Zalo, tài khoản và payload. Một lượt/window. Event có `runId`, `accountId`, `sequence`, `row.id`; store bỏ event trùng, cũ hoặc sau hoàn tất. Logout/đổi Chat runtime dừng flight; stop/restart của ContactLoader giữ các guard hiện có.

## Giới hạn giờ/ngày và setting V406 — 16/10/2026

`auto_system_settings.key = zalo.phone_check.hour_limit_wait_minutes`, mặc định `value = 60`, active, không secret. Đơn vị phút, số nguyên 1–35791 (giới hạn timer Node); thiếu/sai/không đọc được trong 5 giây dùng 60. Đọc một lần khi gặp giới hạn giờ đầu tiên trong mỗi lượt, bằng Supabase client hiện có; không đọc lại mỗi chu kỳ ngủ. Có thể sửa giá trị qua **Admin akaBiz → Cài đặt hệ thống**; lượt đã đọc giữ snapshot đến khi kết thúc.

Thông báo xuất hiện ngay ở **Ghi chú** và phần thông báo trên form, kể cả bộ lọc đang ẩn dòng đó. Hiển thị số phút và mốc tự tiếp tục theo giờ Việt Nam. Tiến độ chỉ đếm kết quả đã xác nhận, giữ STT và kết quả cũ. Sau thời gian chờ, bắt đầu lại ngân sách 3 lần `fetch failed` cho đúng số. Giữ claim suốt thời gian chờ; tài khoản chưa nhận chiến dịch khác. **Dừng / Dừng và đóng / logout / đổi runtime** hủy timer và nhả claim qua cleanup hiện có, không phát request tiếp theo. Không có timer đếm ngược UI hoặc polling mới.

Chỉ sửa điều phối Desktop/Server cũ; Chat API/runtime đã chuyển nguyên mã nên **không cần deploy lại**. Phải cập nhật Server cũ trước Desktop nếu dùng đường command Server cũ. Không đổi `auto_error`, fallback 32→40, quota/detail/lịch sử hoặc giao thức IPC/Chat. Các bộ cài 8.5.0 đã tạo trước đó chưa có sửa này.

V406 đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`), history `20261016075914 / migration_v406_zalo_phone_check_hour_wait`, setting ID **65**, value **60**, active/non-secret. Không apply lại. MD5 SQL lưu trong history và file local: `328bae342f55fda7fc3f397c50615562`. Checksum trước/sau của toàn bộ `auto_error`: `618ce90a68e3472205e027858a89fce9`; các setting khác: `44ce2299368694344c2ac6bd1e912b29` (không đổi). Đã chạy seed + SQL smoke trong transaction ROLLBACK trước khi apply; sau COMMIT đọc lại độc lập để kiểm tra setting/history/checksum.

Hai typecheck, build mã nguồn Desktop/Server, smoke phone-check Node/Electron native, UI Electron 300 dòng, Chat Data Scan, 11 ca Server contact dataset và phone input identity đã đạt. Chưa đóng gói/phát hành hoặc deploy Chat API/runtime trong lượt này.

Setting được seed bằng [migration V406](../migrations/migration_v406_zalo_phone_check_hour_wait.sql), fail-closed nếu key đã tồn tại; dùng data-only SQL và ghi migration history trong cùng transaction, không reload schema. [SQL smoke](../migrations/tests/migration_v406_zalo_phone_check_hour_wait_smoke.sql) xác nhận giá trị/flags và đọc được bằng role `anon`/`authenticated` hiện có. Rollback: dừng các lượt đang chờ, rollback ứng dụng trước; xóa riêng key này nếu vẫn đúng giá trị mặc định/flags của migration. Không xóa history; nếu setting đã được admin đổi thì giữ lại để tránh ghi đè thay đổi mới.

Kiểm chứng mới: smoke Node/Electron trên QR/Web/legacy/Chat, Chat source/client thật với HTTP fixture, setting hợp lệ/thiếu/sai/lỗi/timeout, đọc một lần, lặp giới hạn giờ, giới hạn ngày sau giờ, reset ngân sách fetch, Dừng/parent/runtime hủy timer thật và phản hồi setting muộn. UI 300 dòng xác nhận notice khi lọc ẩn dòng, mỗi cập nhật chỉ render một hàng, Dừng khi đang chờ và Tiếp tục đúng số 50. Không gọi Zalo thật.

## Giới hạn lượt kiểm tra mỗi ngày — V407, 16/10/2026

Đã triển khai trên repo chính. Giới hạn **theo từng tài khoản Zalo**, riêng tính năng Kiểm tra SĐT có Zalo, không dùng `auto_account_action_status`, không ghi detail và không sửa `auto_error` hoặc lịch/cron/quota chiến dịch.

- Setting `zalo.phone_check.daily_limit`, mặc định **600**, số nguyên 1–2147483647. Đọc trong RPC ở mỗi lần cấp lượt; thay đổi có hiệu lực từ lần gọi tiếp theo. Thiếu, tắt, secret hoặc giá trị không hợp lệ dùng 600; lỗi database/transport phải dừng, không bỏ qua hạn mức.
- Cột `auto_accounts.zalo_phone_check_usage` chứa đúng `{ "date": "2026-10-16", "count": 125 }`; tài khoản chưa dùng để NULL. Có CHECK cấu trúc/ngày/số nguyên không âm; không lưu SĐT hoặc lịch sử. Ngày lấy từ database theo `Asia/Ho_Chi_Minh` sau khi giữ khóa hàng.
- Một lần tra cứu bắt đầu được cấp một lượt trước khi gọi Zalo. Fallback 32→40 trong cùng lần không cộng thêm; retry `fetch failed` và kiểm tra lại sau chờ giờ tính lượt mới. Không hoàn lượt khi lỗi, hủy sau cấp lượt hoặc mất phản hồi database vì chưa xác nhận được request đã bắt đầu hay chưa. Không tự retry RPC tăng bộ đếm.
- Mốc 599 cho phép thêm một lần lên 600 rồi chặn lần tiếp theo. Có thể hoàn tất lần đã cấp lượt; nếu lần cuối gặp giới hạn giờ hoặc `fetch failed` thì dừng ngay, không ngủ để thử lại. Giới hạn 300 số/lượt chạy và phân loại API hiện có giữ nguyên.
- Cron riêng `zalo_phone_check_usage_reset_daily`: `0 17 * * *` với timezone cron GMT, tương ứng 00:00 Việt Nam. Chỉ UPDATE hàng có ngày cũ và count > 0; bỏ NULL, count=0 và ngày hiện tại. Predicate được kiểm tra lại dưới khóa hàng, nên cron chạy trễ không xóa lượt hôm nay. Nếu cron chưa chạy, RPC tự tính ngày cũ bằng 0 và ghi count=1 khi cấp lượt đầu ngày mới. Ngày tương lai bị từ chối.

RPC mới: `public.aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text)`. `p_consume=false` đọc mà không reset/ghi; `true` kiểm tra và tăng trong cùng transaction. Quyền theo staff/tenant, credentials Desktop hoặc claim Server, trạng thái/login, token claim và capability QR/Web/Server. Giữ thứ tự khóa staff → entitlement → account như Quét data. Chỉ cập nhật cột mới, không cập nhật `updated_at` hoặc status trong RPC này. Claim/release vẫn do cơ chế Quét data hiện có quản lý.

RPC là SECURITY DEFINER để gọi validator credentials vốn không cấp quyền trực tiếp cho anon/authenticated; giữ search_path cố định, statement timeout 5s, thu hồi EXECUTE PUBLIC, chỉ cấp anon/authenticated/service_role với kiểm tra trong body. Không sửa validator, resolver capability hoặc bất kỳ RPC cũ nào. Quyền bảng `auto_accounts` rộng là cấu hình có sẵn; V407 không thay RLS/ACL toàn bảng hoặc thiết kế lại quyền client. Supabase advisors đã chạy sau DDL: có cảnh báo tổng quát [anon gọi SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) và [authenticated gọi SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) cho RPC mới. Đây là quyền gọi có chủ đích để dùng xác thực ứng dụng/claim như các RPC Quét data hiện có; kiểm thử credential/tenant/claim sai đều bị từ chối. Không coi toàn bộ security advisors của dự án là sạch.

Desktop/Server dùng Supabase client HTTP hiện có, thêm một RPC trước mỗi lần tra cứu. Deadline 6s, hủy/đổi phiên chặn gửi Zalo và bỏ kết quả muộn; RPC có kết quả không chắc chắn không được gọi lại tự động. Nếu DB đã commit trước khi mất phản hồi/hủy thì lượt có thể đã được tính dù chưa gửi Zalo. Đây là lựa chọn bảo thủ đã nêu trong phương án.

UI đọc snapshot một lần khi chọn tài khoản, sau đó nhận count/limit/remaining/date/resetAt cùng row/completed event hiện có. Giữ guard runId/accountId/sequence; phản hồi đọc trước khi Start không ghi đè bộ đếm của lượt mới. Hiển thị **Hôm nay: N/600 lượt · Còn M lượt**, kèm ngày của snapshot; không thêm timer/polling. Tải file khác không xóa bộ đếm. Ngày/hạn mức được xác nhận lại khi bắt đầu/tiếp tục hoặc đổi tài khoản. Hết lượt báo trên form, giữ kết quả và số còn lại, nhả claim; không tự chạy vào ngày sau.

Sửa review V407 ngày 16/10/2026: request đọc hạn mức dùng generation riêng trong modal, tăng khi chọn tài khoản/đổi staff và ngay trước khi bắt đầu lượt hợp lệ. Tải data mới vẫn reset tiến độ/runId nhưng không làm request cũ có hiệu lực trở lại; bỏ cả kết quả và lỗi đến muộn, giữ cleanup khi đóng/đổi tài khoản. Hồi quy Electron chạy qua form thật: hoàn tất ở 600/600 → tải data mới → phản hồi cũ 599/600 vẫn giữ 600/600; dừng trước kết quả → tải data mới → lỗi đọc cũ không hiện lên. Không phát sinh request mới; kiểm thử 300 hàng, smoke phone-check và hai typecheck đạt. Chỉ sửa renderer, không đổi DB/RPC/runtime hoặc quota/policy chiến dịch.

Server cũ quảng bá `phone_check_daily_limit_v1` qua hello WebSocket hiện có. Desktop mới chặn command kiểm tra SĐT nếu thiếu capability và hướng dẫn cập nhật, trước khi gửi command. Reset capability khi đổi socket. Client cũ vẫn tương thích Server mới; Desktop/Server binary cũ chưa có cơ chế này phải được cập nhật để áp dụng đầy đủ. Chat-backed tiếp tục điều phối ở Desktop, **không sửa/deploy Chat API hoặc Chat runtime**.

### Apply và hiệu năng

V407 đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`), history **20261016090818 / migration_v407_zalo_phone_check_daily_limit**. Setting ID 70, value `600`, active/non-secret. Không apply lại khi merge hoặc phát hành.

Signature mới chưa tồn tại trước migration (source checksum: không áp dụng); target checksum **91fb0001b629cb058a41454068b439d2**. Owner postgres, volatile, security definer, search_path `pg_catalog, public`, timeout 5s; ACL sau apply khớp dry run. Dependencies giữ nguyên body/ACL/config và được kiểm tra checksum trước DDL. [Snapshot live và metadata](../migrations/snapshots/zalo-phone-check-daily-v407/live-dependencies.json), [receipt sau apply](../migrations/snapshots/zalo-phone-check-daily-v407/receipt.json).

Đã kiểm tra trước/sau: `auto_error` checksum `de5ce939e25e69700b637963e54c4502`; ba RPC quota/reset chiến dịch, tất cả cron và setting cũ đều giữ nguyên. SQL smoke trước/sau apply chạy trong ROLLBACK; không để lại số lượt thử nghiệm. Data API đọc được setting 600 và RPC mới từ chối identity không hợp lệ.

Không thêm index JSONB: đường cấp lượt tìm theo PK `id`. EXPLAIN ANALYZE local trên 7.143 hàng: đọc một account dùng index, khoảng 0,073ms; cron quét không có hàng cần reset khoảng 0,62ms, reset 500 hàng khoảng 4,65ms. Trên akachat, trong transaction rollback: cron quét 7.155 hàng NULL khoảng 3,48ms, không ghi hàng nào. Đây là số đo riêng các fixture/snapshot đó, không phải bảo đảm thời gian khi có nhiều writer đồng thời. Cron vẫn có thể quét bảng; chỉ UPDATE các hàng cần thiết. Transaction cấp lượt kết thúc trước request Zalo/sleep.

### Kiểm chứng và rollout

- `node scripts/zalo-phone-check-daily-sql-smoke.cjs`: PostgreSQL local tách biệt, chạy RPC thật với identity validator live; 8 caller ở 599 chỉ một caller được cấp lượt 600. Bao phủ QR/Web/Server, credentials/tenant/claim/capability, thiếu/sai setting, ngày cũ/ngày tương lai, cron trước/sau/đồng thời với cấp lượt, reset chọn lọc, CHECK/ACL và rollback; dependency mismatch bị chặn.
- [SQL smoke live](../migrations/tests/migration_v407_zalo_phone_check_daily_limit_smoke.sql): trước/sau apply bằng transaction rollback; cấp 599→600/chặn tiếp, read không ghi, lazy/cron reset, credential/token sai, account fields khác và policy/reset chiến dịch giữ nguyên.
- Smoke phone-check Node và Electron native: cả bốn runtime, last-slot/hour/fetch, một reservation cho fallback, retry tính lượt mới, lỗi DB/hủy chặn tra cứu và release một lần, repository không retry/không lộ lỗi credential, Server cũ bị chặn trước command. Các hồi quy nhập/xuất/lưu nhóm/progress vẫn đạt.
- UI Electron 300 hàng: một row event chỉ render một hàng, cập nhật riêng daily usage render **0 hàng**; nhập lại file không ghi metadata vào bảng, giữ stop/resume và các luồng xuất/lưu.
- Hai typecheck và build mã nguồn Desktop/Server đạt; Chat Data Scan, 11 Server contact dataset checks và phone input identity đạt. Không gọi Zalo thật, không tạo bộ cài hoặc phát hành.

Thứ tự cập nhật: **V407 (đã apply) → Server cũ → Desktop**. Không cần deploy lại Chat API/runtime. Các bộ cài 8.5.0 đã đóng gói trước đó chưa chứa thay đổi này.

Rollback: dừng scan, rollback Desktop/Server trước. Có thể giữ schema/setting/counter để không mất số lượt đã dùng; các bản cũ không gọi RPC mới. Nếu cần gỡ DB, dùng migration riêng đã review để unschedule đúng cron mới, revoke/drop đúng RPC mới và xử lý cột/setting có backup; không chạy lại V407, không xóa history hoặc đụng cron/quota chiến dịch.

## Sử dụng kết quả

Cả ba nút chỉ dùng các dòng được tích chọn:

1. **Lưu vào nhóm data:** dùng picker/tạo nhóm và ingest hiện có. Nhóm SĐT dùng `contactType=phone`, `phone`, UID rỗng để định danh bằng SĐT. Nhóm Zalo UID yêu cầu tất cả dòng Có Zalo, UID từ API, cùng tài khoản đã kiểm tra và khớp tài khoản nhóm nếu đã liên kết; gửi `sourceAccountId` của kết quả. Lựa chọn không phù hợp báo rõ; kết quả ingest báo số thêm/đã có/lỗi, giữ chọn.
2. **Tải về Excel:** STT, SĐT, Tên Zalo, Zalo ID, Trạng thái, Ghi chú. SĐT/UID là cell kiểu chuỗi.
3. **Tải về Excel mẫu akaBiz:** đúng 9 cột `Fullname,Uid,Mobile,Email,Info1,Info2,Info3,Info4,Info5`. Fullname từ API, Mobile là số chuẩn hóa. Uid/Email/Info luôn rỗng, kể cả đã tìm thấy Zalo, để dùng lại cho chiến dịch SĐT.

## Kiểm chứng

Không dùng credential thật hoặc gọi Zalo thật; DB/transport được thay bằng fixture tại biên. Kiểm thử thực thi code runtime, IPC, adapter và giao diện Electron thật.

- `node scripts/zalo-phone-check-smoke.cjs`: chuẩn hóa/trùng/sai/300–301, main validation, Excel text/template, hai kiểu nhóm, 32→40/policy/abort; QR/Web/Server/Chat orchestration, claim bận, mất phiên, giới hạn giờ 312/221, giới hạn ngày 313/304 và parity akaBizAuto cho các mã còn lại, tiếp tục số sau lỗi API, UID rỗng, timeout, hủy trước/sau bắt đầu, late result, release; Chat client/source thực với 212/214/216/giới hạn và HTTP 401/429/503 riêng, legacy socket disconnect, main-frame/account/session/IPC và store sequence.
- `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/zalo-phone-check-smoke.cjs`: chạy cùng bộ smoke và thêm Electron `session.fetch` thật tới HTTP fixture localhost; đổi generation bằng Web runtime thật, xác nhận `AbortError(20)` dừng và không phân loại SĐT. Bộ Node cũng kiểm tra `AbortError`/`TimeoutError` ở reqSrc 32 và fallback 40, phân biệt với mã Zalo 20/23.
- `node scripts/run-zalo-phone-check-ui-smoke.cjs`: 300 dòng, **một cập nhật chỉ render đúng một hàng**; importer TXT/Excel thật bỏ metadata; workbook template nhập lại bằng importer chiến dịch SĐT; hai loại nhóm qua picker/ingest mock, giữ selection; live result, khóa form và xác nhận dừng/đóng. Writer workbook được capture trong fixture, không ghi file vào thư mục tải về của người dùng.
- Hồi quy: `node scripts/run-zalo-chat-data-scan-smoke-test.cjs`, `node scripts/run-zalo-server-contact-dataset-smoke-test.cjs`, `node scripts/zalo-phone-input-identity-smoke-test.cjs`. Fixture identity cũ được bổ sung no-op `settleManagedActionInput` cho trường hợp ngoài managed context; không đổi logic campaign.
- Đã đạt các smoke nêu trên, hai typecheck và hai build Desktop/Server. Chat API: **103 test files / 1.583 tests đạt**, typecheck và build đạt.
- Desktop: `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npm run build`, `npm run build:server`.
- akaAgentChatApi: `npm run typecheck`, `npm run build`, `npm test`; các test mới bao phủ protocol strict, endpoint/reqSrc/signal, không gọi campaign helper, runtime cancellation, không retry 429 và runtime cũ cần cập nhật.

Giới hạn kiểm chứng: chưa thực hiện kiểm tra bằng tài khoản Zalo thật trên môi trường đã triển khai. Build là build mã nguồn, không tạo bộ cài hoặc phát hành.

Bản sửa phân loại ngày 16/10/2026: đã chạy lại smoke phone-check, Electron UI 300 dòng, Chat Data Scan, Server contact dataset và phone input identity; cả hai typecheck và build Desktop/Server đạt. Chat client/source chạy thật với HTTP fixture, không gửi request Zalo thật và không sửa/deploy lại Chat API/runtime trong lượt sửa này.

Sửa review P2 cùng ngày: smoke phone-check Node/Electron native, Web session recovery và Chat Data Scan đạt; hai typecheck và build Desktop/Server đạt. Fixture scheduler của smoke Web được bổ sung stub lịch đến hạn đang thiếu để tiếp tục kiểm tra gate phiên Web; không đổi scheduler sản phẩm.

Hồi quy thông báo lỗi chi tiết: smoke phone-check chạy Chat client/source/ContactLoader thật với transport fixture để kiểm tra `data_scan_failed` kèm lỗi HTTP/parse, HTTP request thất bại, lỗi thiếu message, che credential/URL và giới hạn độ dài. Kiểm tra chi tiết đi qua row event, kết quả cuối và Excel; vẫn dừng tại một số, giữ các số sau pending và nhả claim đúng một lần. Không gọi Zalo thật.

Đã đạt smoke phone-check Node/Electron (gồm Web abort thật), UI Electron 300 dòng (cập nhật lỗi chỉ render một hàng), Chat Data Scan và 11 ca Server contact dataset; hai typecheck và build mã nguồn Desktop/Server đạt. Chưa xác nhận nguyên nhân lỗi của lượt production trước bản sửa vì thông báo chi tiết chưa được lưu lại.

Hồi quy chạy tiếp ngày 16/10/2026: store giữ 49/300 khi dừng tại số 50, retry lỗi không tăng tổng, thành công tăng lên 50/300 và bỏ event/completion của lượt cũ. UI Electron bấm Dừng/Tiếp tục thật trên danh sách 300 số, gửi lại số 50 cả sau hủy lẫn lỗi, giữ STT 50/300 và kết quả/checkbox cũ; giới hạn một số/lượt, số 50 xong mới chuyển số 51. Cập nhật dòng retry vẫn chỉ render một hàng; tải danh sách mới reset tiến độ. Smoke Node/UI Electron, hai typecheck và build Desktop đã đạt. Chỉ sửa renderer, không cần cập nhật Chat API/runtime hoặc Server cũ cho hành vi chạy tiếp này; chưa đóng gói lại bộ cài.

Hồi quy tự thử lại `fetch failed`: smoke phone-check bao phủ thành công ở lần 2/3, mã Zalo sau thử lại, đủ ba lỗi thì dừng đúng số, ngân sách riêng từng số, dùng cùng delay 2–5 giây, giữ tiến độ/claim/sequence, hủy bằng Dừng/parent signal/đổi runtime trong sleep thật. Chat client/source chạy thật với HTTP fixture kiểm tra request mới cho cùng số và cleanup mỗi query; không gọi Zalo thật. UI 300 dòng kiểm tra ghi chú chờ chỉ render một hàng, tiến độ giữ nguyên.

Đã đạt smoke phone-check Node/Electron native, UI Electron, Chat Data Scan, 11 ca Server contact dataset và phone input identity; cả hai typecheck và build mã nguồn Desktop/Server đạt. Chưa đóng gói/phát hành hoặc deploy trong lượt sửa retry này.

## Rủi ro đã chấp nhận sau review — 16/10/2026

Với Chat-backed Server, nếu bấm Dừng lúc POST bắt đầu còn chờ kiểm tra quyền tài khoản, lệnh cancel có thể nhận 404 trước khi query được ghi nhận. Desktop đã kết thúc lượt/nhả claim nhưng backend vẫn có thể gửi thêm một request tra cứu xuống runtime. Kết quả muộn bị bỏ; request không gửi tin, kết bạn hoặc ghi detail/quota chiến dịch. Có thể tiêu tốn thêm một lượt tra cứu Zalo hoặc khiến lượt quét mới báo bận tạm thời. Đã tái hiện bằng client/router thật với transport và binding fixture; người dùng chấp nhận tác động nhỏ và yêu cầu giữ nguyên, không chặn PR vì finding này.

## Thứ tự cập nhật và rollback

Bản sửa phân loại mã ngày 16/10/2026 nằm trong `ContactLoader` dùng chung: cập nhật/restart Desktop cho QR/Web/Chat-backed; cập nhật Server cũ nếu chạy qua command Server cũ. Chat API/runtime đã chuyển nguyên mã lỗi về Desktop nên không cần deploy lại backend cho bản sửa này.

Bản sửa hiển thị lỗi chi tiết cũng chỉ nằm trong `ContactLoader`: cập nhật/restart Desktop và Server cũ tương ứng. Chat API/runtime đã trả `errorMessage`, không cần deploy lại. Bản sửa này chưa nằm trong bộ cài 8.5.0 đã đóng gói trước đó; chưa đóng gói/phát hành lại.

Bản sửa tự thử lại `fetch failed` cũng nằm trong `ContactLoader`: cập nhật Desktop cho QR/Web/Chat-backed; cập nhật Server cũ nếu chạy qua command Server cũ. Không cần deploy lại Chat API/runtime; bộ cài 8.5.0 đã đóng gói trước đó chưa có thay đổi này.

1. Chat-backed: cập nhật **Chat API + runtime-protocol trước**, sau đó **Zalo Server runtime/adapter** để quảng bá capability mới. Backend mới vẫn nhận runtime/client cũ cho các query đang có.
2. Nếu dùng Server cũ, cập nhật akaAgent Zalo Server có command/event mới trước Desktop.
3. Cập nhật Desktop sau khi backend/runtime đã sẵn sàng. QR/Web dùng runtime được build cùng Desktop. V406 chỉ seed setting thời gian chờ giờ, không có schema/RPC mới; không apply lại nếu history đã có.
4. Rollback Desktop trước để ngừng tạo query mới, dừng các lượt đang chạy; sau đó rollback runtime rồi backend. Kết quả trong modal chỉ ở RAM, dữ liệu đã được người dùng lưu vào nhóm giữ nguyên theo ingest hiện có.
