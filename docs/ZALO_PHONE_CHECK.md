# Kiểm tra SĐT có Zalo — 16/10/2026

Tính năng nằm trong **Quét data → Kiểm tra SĐT có Zalo**, modal riêng. Mã nguồn đã triển khai cho Desktop, akaAgent Zalo Server và akaAgentChatApi. Chat API/runtime đã deploy ngày 16/10/2026; bản sửa phân loại mã bên dưới chưa đóng gói/phát hành Desktop hoặc Server cũ. Không có migration/RPC/bảng/pool/connection hoặc nguồn polling mới.

## Hợp đồng giao diện

- Chọn một tài khoản QR, Web hoặc Zalo Server; số lượng mỗi lượt 1–300, mặc định 300. Chạy tuần tự trên các dòng **Chưa kiểm tra**, không tự chạy lượt tiếp theo.
- Dùng `CampaignDataUploadModal` với `zalo_message_phone` và external sink. Chỉ `rows[].phone` đi qua ranh giới nhập liệu; không giữ tên, UID, email, Info hay dữ liệu nguồn. Chuẩn hóa bằng helper SĐT hiện có, bỏ số sai và trùng. Trên 300 số hợp lệ không trùng báo chia file; main kiểm tra lại payload/giới hạn. Tải data mới thay danh sách trong modal.
- Bảng gồm checkbox, STT, SĐT, Tên Zalo, Zalo ID, Trạng thái, Ghi chú. Tên/ID chỉ từ API. Có bộ lọc và chọn toàn bộ dòng đang lọc; không tự bỏ chọn khi chạy, xuất hoặc lưu nhóm.
- Zustand store riêng cho mỗi modal, ID ổn định bằng SĐT đã chuẩn hóa. Table chỉ subscribe danh sách ID; từng hàng memo và subscribe đúng dữ liệu/chọn của chính nó. Bộ đếm/tiến độ subscribe riêng. Cập nhật dòng giữ nguyên object của các dòng khác.
- Khi chạy khóa tài khoản, số lượng và nhập file. Có Dừng; đóng lúc đang chạy cần **Dừng và đóng**. Chờ cleanup trước khi đóng; unmount/logout cũng yêu cầu hủy. Không tự lưu lịch sử kết quả.

## API và runtime

`zaloPhoneSearch.ts` là logic tìm kiếm dùng chung với chiến dịch: `/api/friend/profile/get`, `reqSrc=32` trước; fallback `40` theo policy `zalo_find_phone_user` hiện có, giữ ưu tiên lỗi giới hạn giờ so với ngày và hành vi fallback lỗi kỹ thuật. Không gọi SDK `findUser()` cố định 40. Abort được kiểm tra trước/sau request và trước fallback.

`ContactLoader.checkZaloPhones()` dùng claim/release của Quét data và active-load guard hiện có. Các số cách nhau 2–5 giây; session/request có deadline 30 giây. Không gọi helper chiến dịch, ghi detail/quota hoặc hành động phụ.

Theo yêu cầu sửa ngày 16/10/2026, phân loại kết quả theo đúng `akaBizAuto.CheckPhoneExist_ByApi` và `ZaloApiResponseConstant.SearchPhone.LIMITS` (source akaBizAuto commit `4919a07c`), sau khi đã chọn kết quả reqSrc 32→40:

- `error_code=0`, `312`, `313`, `304`, `221` → **Có Zalo**, tiếp tục số kế tiếp.
- Các mã phản hồi Zalo khác, gồm `212`, `214`, `216` → **Không tìm thấy Zalo**, tiếp tục số kế tiếp.
- Lỗi transport/runtime không có mã phản hồi Zalo, timeout hoặc phiên không sẵn sàng → **Chưa xác định**, dừng lượt và giữ phần còn lại **Chưa kiểm tra**. HTTP status không phải `error_code`: SDK không gắn HTTP status vào mã Zalo; Chat giữ mã lỗi transport riêng. Claim/session lỗi trước một số vẫn giữ các dòng chưa kiểm tra và thông báo ở tiến độ.

Quy tắc này thay thế yêu cầu cũ chỉ chấp nhận hồ sơ có UID và dừng khi giới hạn. Tên/UID chỉ lấy từ hồ sơ API; không tự tạo khi chỉ nhận mã giới hạn hoặc phản hồi thành công thiếu hồ sơ. UID không hợp lệ để trống. Nhóm Zalo UID vẫn từ chối dòng thiếu UID; nhóm SĐT và Excel vẫn nhận dòng được chọn. Helper `classifyZaloPhoneCheckApiCode` chỉ dành cho phân loại lượt quét, không đổi policy/quota của chiến dịch.

Sửa review P2: `AbortError`/`TimeoutError` được nhận diện trước khi đọc mã phản hồi. DOMException có `code=20/23` nhưng đây là mã hủy/timeout của request, không phải phản hồi Zalo. Khi phiên Web đổi generation giữa request, dòng hiện tại là **Chưa xác định**, dừng lượt, số kế tiếp giữ **Chưa kiểm tra**, nhả claim một lần. Không loại cứng số 20/23 khỏi bảng mã: nếu đó là phản hồi API Zalo thật thì vẫn áp quy tắc akaBizAuto.

- **QR/Web:** runtime hiện có, truyền AbortSignal vào custom API/request.
- **Server cũ:** `contacts.checkZaloPhones` và `contacts.cancelPhoneCheck`. Kết quả từng dòng qua event transport hiện có, chỉ live, không thêm reconnect/activity history. Lượt gắn với socket Desktop, socket đóng hủy đúng runId. Tombstone RAM có giới hạn/TTL chặn lệnh bắt đầu đến sau hủy; không có timer dọn riêng. Giữ guard thế hệ runtime cho cleanup.
- **Chat-backed Server:** thêm `find_user_by_phone` vào Data Scan protocol, payload chỉ `phoneNumber`, `reqSrc:32|40`. Adapter gọi low-level custom API, không gọi wrapper campaign có publish metadata. Dùng session, adapter, transport, hàng đợi theo account và start/poll/cancel hiện có; không thêm vòng polling. Query này không vào danh sách tự retry 429. Hủy/deadline dừng transport và bỏ phản hồi muộn.
- Runtime Chat quảng bá `data_scan_phone_lookup` qua hello hiện có. API kiểm tra capability trước dispatch; runtime cũ báo `phone_check_update_required`. Backend cũ từ chối query mới cũng được Desktop chuyển thành hướng dẫn cập nhật. Không fallback về API cũ.

IPC mới có start/cancel/row/completed; start/cancel kiểm tra main-frame, user/credential, quyền Zalo, tài khoản và payload. Một lượt/window. Event có `runId`, `accountId`, `sequence`, `row.id`; store bỏ event trùng, cũ hoặc sau hoàn tất. Logout/đổi Chat runtime dừng flight; stop/restart của ContactLoader giữ các guard hiện có.

## Sử dụng kết quả

Cả ba nút chỉ dùng các dòng được tích chọn:

1. **Lưu vào nhóm data:** dùng picker/tạo nhóm và ingest hiện có. Nhóm SĐT dùng `contactType=phone`, `phone`, UID rỗng để định danh bằng SĐT. Nhóm Zalo UID yêu cầu tất cả dòng Có Zalo, UID từ API, cùng tài khoản đã kiểm tra và khớp tài khoản nhóm nếu đã liên kết; gửi `sourceAccountId` của kết quả. Lựa chọn không phù hợp báo rõ; kết quả ingest báo số thêm/đã có/lỗi, giữ chọn.
2. **Tải về Excel:** STT, SĐT, Tên Zalo, Zalo ID, Trạng thái, Ghi chú. SĐT/UID là cell kiểu chuỗi.
3. **Tải về Excel mẫu akaBiz:** đúng 9 cột `Fullname,Uid,Mobile,Email,Info1,Info2,Info3,Info4,Info5`. Fullname từ API, Mobile là số chuẩn hóa. Uid/Email/Info luôn rỗng, kể cả đã tìm thấy Zalo, để dùng lại cho chiến dịch SĐT.

## Kiểm chứng

Không dùng credential thật hoặc gọi Zalo thật; DB/transport được thay bằng fixture tại biên. Kiểm thử thực thi code runtime, IPC, adapter và giao diện Electron thật.

- `node scripts/zalo-phone-check-smoke.cjs`: chuẩn hóa/trùng/sai/300–301, main validation, Excel text/template, hai kiểu nhóm, 32→40/policy/abort; QR/Web/Server/Chat orchestration, claim bận, mất phiên, parity akaBizAuto cho 0/312/313/304/221 và các mã còn lại, tiếp tục số sau lỗi API, UID rỗng, timeout, hủy trước/sau bắt đầu, late result, release; Chat client/source thực với 212/214/216/giới hạn và HTTP 401/429/503 riêng, legacy socket disconnect, main-frame/account/session/IPC và store sequence.
- `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/zalo-phone-check-smoke.cjs`: chạy cùng bộ smoke và thêm Electron `session.fetch` thật tới HTTP fixture localhost; đổi generation bằng Web runtime thật, xác nhận `AbortError(20)` dừng và không phân loại SĐT. Bộ Node cũng kiểm tra `AbortError`/`TimeoutError` ở reqSrc 32 và fallback 40, phân biệt với mã Zalo 20/23.
- `node scripts/run-zalo-phone-check-ui-smoke.cjs`: 300 dòng, **một cập nhật chỉ render đúng một hàng**; importer TXT/Excel thật bỏ metadata; workbook template nhập lại bằng importer chiến dịch SĐT; hai loại nhóm qua picker/ingest mock, giữ selection; live result, khóa form và xác nhận dừng/đóng. Writer workbook được capture trong fixture, không ghi file vào thư mục tải về của người dùng.
- Hồi quy: `node scripts/run-zalo-chat-data-scan-smoke-test.cjs`, `node scripts/run-zalo-server-contact-dataset-smoke-test.cjs`, `node scripts/zalo-phone-input-identity-smoke-test.cjs`. Fixture identity cũ được bổ sung no-op `settleManagedActionInput` cho trường hợp ngoài managed context; không đổi logic campaign.
- Đã đạt các smoke nêu trên, hai typecheck và hai build Desktop/Server. Chat API: **103 test files / 1.583 tests đạt**, typecheck và build đạt.
- Desktop: `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npm run build`, `npm run build:server`.
- akaAgentChatApi: `npm run typecheck`, `npm run build`, `npm test`; các test mới bao phủ protocol strict, endpoint/reqSrc/signal, không gọi campaign helper, runtime cancellation, không retry 429 và runtime cũ cần cập nhật.

Giới hạn kiểm chứng: chưa thực hiện kiểm tra bằng tài khoản Zalo thật trên môi trường đã triển khai. Build là build mã nguồn, không tạo bộ cài hoặc phát hành.

Bản sửa phân loại ngày 16/10/2026: đã chạy lại smoke phone-check, Electron UI 300 dòng, Chat Data Scan, Server contact dataset và phone input identity; cả hai typecheck và build Desktop/Server đạt. Chat client/source chạy thật với HTTP fixture, không gửi request Zalo thật và không sửa/deploy lại Chat API/runtime trong lượt sửa này.

Sửa review P2 cùng ngày: smoke phone-check Node/Electron native, Web session recovery và Chat Data Scan đạt; hai typecheck và build Desktop/Server đạt. Fixture scheduler của smoke Web được bổ sung stub lịch đến hạn đang thiếu để tiếp tục kiểm tra gate phiên Web; không đổi scheduler sản phẩm.

## Rủi ro đã chấp nhận sau review — 16/10/2026

Với Chat-backed Server, nếu bấm Dừng lúc POST bắt đầu còn chờ kiểm tra quyền tài khoản, lệnh cancel có thể nhận 404 trước khi query được ghi nhận. Desktop đã kết thúc lượt/nhả claim nhưng backend vẫn có thể gửi thêm một request tra cứu xuống runtime. Kết quả muộn bị bỏ; request không gửi tin, kết bạn hoặc ghi detail/quota chiến dịch. Có thể tiêu tốn thêm một lượt tra cứu Zalo hoặc khiến lượt quét mới báo bận tạm thời. Đã tái hiện bằng client/router thật với transport và binding fixture; người dùng chấp nhận tác động nhỏ và yêu cầu giữ nguyên, không chặn PR vì finding này.

## Thứ tự cập nhật và rollback

Bản sửa phân loại mã ngày 16/10/2026 nằm trong `ContactLoader` dùng chung: cập nhật/restart Desktop cho QR/Web/Chat-backed; cập nhật Server cũ nếu chạy qua command Server cũ. Chat API/runtime đã chuyển nguyên mã lỗi về Desktop nên không cần deploy lại backend cho bản sửa này.

1. Chat-backed: cập nhật **Chat API + runtime-protocol trước**, sau đó **Zalo Server runtime/adapter** để quảng bá capability mới. Backend mới vẫn nhận runtime/client cũ cho các query đang có.
2. Nếu dùng Server cũ, cập nhật akaAgent Zalo Server có command/event mới trước Desktop.
3. Cập nhật Desktop sau khi backend/runtime đã sẵn sàng. QR/Web dùng runtime được build cùng Desktop. Không có migration cần apply.
4. Rollback Desktop trước để ngừng tạo query mới, dừng các lượt đang chạy; sau đó rollback runtime rồi backend. Kết quả trong modal chỉ ở RAM, dữ liệu đã được người dùng lưu vào nhóm giữ nguyên theo ingest hiện có.
