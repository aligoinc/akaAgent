# Kiểm tra SĐT có Zalo — 16/10/2026

Tính năng nằm trong **Quét data → Kiểm tra SĐT có Zalo**, modal riêng. Mã nguồn đã triển khai cho Desktop, akaAgent Zalo Server và akaAgentChatApi. Chat API/runtime đã deploy ngày 16/10/2026; bản sửa phân loại mã bên dưới chưa đóng gói/phát hành Desktop hoặc Server cũ. Không có migration/RPC/bảng/pool/connection hoặc nguồn polling mới.

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
