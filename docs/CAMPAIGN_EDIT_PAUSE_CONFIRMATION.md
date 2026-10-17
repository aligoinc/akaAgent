# Xác nhận tạm dừng trước khi sửa chiến dịch — 16/10/2026

Desktop và Web dùng một cổng mở sửa trong mỗi ứng dụng. Áp dụng sửa đầy đủ/lịch, nội dung/media, giới hạn, Nhóm data, Chẩn đoán và chiến dịch liên quan; URL `/campaigns/:id/edit` trên Web cũng đi qua cổng này. Nhân bản chỉ đọc nguồn, không yêu cầu dừng nguồn. Không đổi native mobile.

## Hợp đồng — cập nhật 17/10/2026

- Đọc cấu hình mới; Chờ xử lý/Đang chạy yêu cầu Có/Không. Có dùng lệnh pause hiện có, chờ xác nhận backend rồi mới giao snapshot mới cho form. Không/đóng không gửi pause; hủy chờ không undo pause.
- Chỉ mở sau khi cấu hình đọc mới từ API/IPC có `status='tạm dừng'`; `editReady` giữ tương thích nhưng nay phản ánh đúng điều kiện trạng thái này. Không dùng trạng thái optimistic hoặc chỉ dựa vào việc lệnh pause trả về thành công. Claim/unit không còn là điều kiện mở/lưu sửa; không đọc hay trả token trong cấu hình.
- Theo dõi bằng sự kiện/refresh hiện có. Cổng không có timer. Web URL độc lập dùng hàng đợi `usePolledResource` ở chế độ event-only (`pollIntervalMs=null`), nhận status/reconnect; có nút Kiểm tra lại. Khi danh sách đang mount, dùng lần đọc danh sách hiện có. Không thêm vòng polling định kỳ.
- Một lần mở sửa đang chờ; hủy/đóng/đổi scope đăng nhập làm kết quả cũ vô hiệu. Promise pause đã gửi vẫn được giữ.
- Lưu sửa/nhân bản: validate rồi hỏi Tạm dừng/Chờ xử lý, focus Tạm dừng. Đóng hộp hỏi chưa ghi cấu hình. Tạo thường/lưu nháp không hỏi.
- Ghi cấu hình/data/liên kết/provisioning xong mới tiếp tục nếu đã chọn Chờ xử lý. Không đổi lịch để ép chạy ngay. Giữ bản mới tạm dừng trong provisioning, kể cả bundle Nhóm data.
- Sau khi ghi đủ dữ liệu, giữ checkpoint trong form cho bước hoàn tất. Lỗi chuyển trạng thái hiển thị “Chiến dịch đã lưu…” và nút “Thử lại hoàn tất”; thử lại không PATCH cấu hình/tạo lại clone. Trạng thái đã pending/running/completed sau một phản hồi tiếp tục bị mất không được khởi động lại.

## Ranh giới ghi

Desktop UI gửi `requireEditReady`, `expectedEditVersion` và `expectedUpdatedAt` qua IPC hiện có. Main dùng lần đọc trạng thái hiện có để so phiên bản cấu hình; chỉ khi cấu hình vẫn khớp mới dùng timestamp chính xác của hàng vừa đọc cho UPDATE. UPDATE lọc staff, id, chưa xóa, tạm dừng và timestamp, chống resume/ghi từ phiên khác xen vào. Không lọc claim/unit và không xóa chúng. Caller chưa có phiên bản cấu hình giữ kiểm tra timestamp cũ. Runtime/internal writers không bật guard dành cho UI.

Web PATCH mới opt-in `requireEditReady`. API kiểm tra tenant/quyền/phiên bản như cũ, đọc lại readiness rồi gọi **RPC atomic hiện có** với timestamp chính xác từ snapshot mới. Với đường sửa này, không dùng wrapper retry timestamp theo runtime vì wrapper đó có thể chấp nhận một lần resume xen giữa. Caller native cũ không opt-in vẫn giữ hợp đồng cũ. Không sửa định nghĩa RPC.

## Gỡ phụ thuộc claim khi sửa — 17/10/2026

Tính năng tự động thực hiện thao tác Tạm dừng → chờ trạng thái → Sửa. Chờ xử lý cũng phải gửi pause và chờ, kể cả khi scheduler vừa nhận chạy trong lúc gửi lệnh. Chiến dịch đã tạm dừng mở ngay bằng snapshot mới; claim còn sót không làm chờ vô hạn. Giữ xác nhận Có/Không, Kiểm tra lại/Hủy chờ, lựa chọn trạng thái sau lưu, checkpoint và retry chỉ bước hoàn tất.

Giữ nguyên hợp đồng trạng thái của luồng pause cũ: với Server, trạng thái DB có thể đã là Tạm dừng trước khi thao tác đang thực hiện kết thúc. Bản sửa này không tạo thêm bảo đảm runtime đã rảnh; việc sửa cleanup/claim là công việc riêng. Không sửa scheduler, Chat API, RPC hay dữ liệu production; không thêm polling/connection/pool. Sự kiện/refresh hiện có vẫn kích hoạt đọc cấu hình trong lúc chờ, có single-flight và một lượt đọc tiếp; không coi những lần đọc HTTP này là miễn phí tài nguyên DB.

Kiểm chứng bản 17/10: smoke `campaign-edit-flow`, `campaign-edit-version`, `campaign-edit-save-retry`, `campaign-sms-save-retry` đạt; menu/form Electron với IPC giả đạt, gồm mở khi cờ readiness cũ false, sửa đầy đủ/sửa nhanh và lưu dở SMS/voice. Web/API: 25 ca readiness + 227 service/routes đạt; sáu suite Web có 206 ca, lượt đầu 205/206 do ca đếm render tiến độ lệch 4 lượt, chạy lại riêng toàn bộ bộ form đạt 105/105 mà không sửa test hay logic tiến độ. Playwright 6/6 trên Desktop Chromium, Android Chromium và iPhone WebKit dùng API/WebSocket giả. Hai typecheck Desktop, bảy workspace Web, build Desktop/Web/API và `git diff --check` đạt. Bản sửa Desktop chưa đóng gói/phát hành. Web/API đã deploy image `campaign-edit-status-20261017` lúc 22:48 ngày 17/10/2026 (giờ Việt Nam), health 1/1 và 6/6 ca browser trên bundle production với API/WebSocket giả lập đạt; không deploy Chat API hoặc sửa DB.

## Kiểm chứng local bản 16/10/2026

- `node scripts/campaign-edit-flow-smoke.cjs`: dùng chung state machine Desktop/Web, pending/running/paused/completed, Có/Không, single-flight, pause lỗi, hủy/auth/late response, hai lựa chọn lưu, retry sau phản hồi resume mất; 16 tổ hợp readiness/redaction và production repository CAS đối với claim/unit/status/version/staff xen vào.
- `node scripts/run-campaign-edit-ui-smoke.cjs`: menu/form thật Electron với IPC giả; chờ runtime nhả, focus, đóng hộp lưu, sửa nhanh và đầy đủ, chỉ retry chuyển trạng thái. Chặn HTTP bên ngoài.
- Hồi quy local: `campaign-pause-note-smoke-test.cjs`, `campaign-content-preparation-smoke-test.cjs`, `campaign-schedule-ai-smoke.cjs`.
- Web: `campaign-edit-ready.test.ts` (20 ca backend); Playwright `campaign-edit-flow.spec.ts` trên Desktop Chromium và Android Chromium, API/WebSocket giả: URL trực tiếp, sửa đầy đủ, cả hai trạng thái clone, lỗi tiếp tục clone không tạo trùng, sửa giới hạn và retry. Screenshot đã xem trên Desktop/Web hẹp.
- 135 kiểm thử form/quick edit/Nhóm data Web; 347 kiểm thử API liên quan; 51 control-client tests đạt. Suite native 229 ca đạt, không sửa native.
- Hai typecheck Desktop, typecheck monorepo Web/API (kể cả native) và production build hai repo đạt. `git diff --check` sạch.
- Web tổng: 696/698 ca đạt (`--maxWorkers=1 --testTimeout=20000`). Ca danh sách 1.001 chiến dịch vượt timeout riêng 15 giây khi chạy cùng build; ca AI session khác user có lỗi mở popover ở lượt đó. Chạy lại đúng hai ca riêng: 2/2 đạt (danh sách 7,7 giây). Không coi lượt tổng là hoàn toàn xanh; không sửa timeout hoặc logic AI ngoài phạm vi để che lỗi.
- Toàn bộ `CampaignsPage.test.tsx` chạy riêng: 44/44 đạt. Playwright Chẩn đoán Desktop Chromium đạt ở lượt cuối; các lượt trước gặp dev server đóng khi chạy trùng và fixture đang cập nhật.
- Playwright mới còn kiểm tra Hủy chờ giữ trạng thái pause và sự kiện `campaign:status-updated` tự mở form sau release. Gate URL dùng hàng đợi event-only, không timer polling. Desktop Chromium/Android Chromium đều đạt với API/WebSocket giả lập.

Không migration/apply SQL, không connection/pool mới, không chạy chiến dịch thật, không deploy/đóng gói/phát hành. Các thay đổi khác trong hai working tree được giữ nguyên.

## Sửa hai finding review — 16/10/2026

- Desktop giữ continuation ngay sau lần ghi cấu hình thành công. Lỗi bind Nhóm data hoặc lưu liên kết chuyển sang **Thử lại hoàn tất**; thử lại giữ request ID, bỏ qua cấu hình đã ghi và các campaign/nhánh liên kết đã hoàn tất. Không lấy phiên bản mới từ một lần đọc để bỏ qua xung đột; lần ghi đầu vẫn giữ CAS/readiness. Lỗi trước khi ghi cấu hình vẫn cho chỉnh form.
- Các campaign con đã tạo thành công trong một nháp liên kết được giữ theo từng item, để lỗi item sau không tạo lại item trước. Chỉ resume sau khi hoàn tất toàn bộ liên kết.
- Web đăng ký lại listener hủy checkpoint theo user/tenant/sessionRevision. Hủy phiên xóa busy/progress và timer điều hướng của form; kết quả muộn không xóa trạng thái lưu của phiên mới hoặc cài lại checkpoint cũ.
- Hồi quy riêng: `node scripts/campaign-edit-save-retry-smoke.cjs` thực thi continuation thật với IPC giả (CAS lỗi ban đầu, bind lỗi, liên kết lỗi, cả hai lựa chọn trạng thái, hủy phiên và chống tạo lại nháp con); Web `CampaignEditSession.test.tsx` kiểm tra nhiều lần thay phiên, đổi chiến dịch/tenant, render thường và kết quả muộn. `CampaignFormPage.test.tsx` thêm ca form chiến dịch đã có được mở khóa khi đổi phiên trong lúc retry.

Chỉ sửa mã ứng dụng và kiểm thử local; không đổi RPC/migration, không deploy hoặc chạy chiến dịch thật.

Kiểm chứng bản sửa: smoke continuation + state machine/CAS và giao diện Electron đạt; 125/125 kiểm thử Web form/quick edit/session đạt, lượt cuối sáu ca tập trung đạt. Hai typecheck Desktop, typecheck Web và production build Desktop + Web/API đều đạt; `git diff --check` sạch.

## Sửa finding 2 SMS/voice — 16/10/2026

Phạm vi theo yêu cầu: chỉ sửa lỗi mới khiến form không lưu lại được sau khi UPDATE cấu hình đã commit nhưng materialize data SMS/voice thất bại. Giữ nguyên hai finding cũ về ghi liên kết và tạo campaign liên quan dở dang.

- Với lần ghi có `requireEditReady`, backend trả lỗi từng phần bằng object IPC chứa đúng `updatedAt` của lần ghi vừa thành công; không đọc một phiên bản mới để vượt xung đột. Lần ghi đã yêu cầu tạm dừng/không có runtime nên không thực hiện lại pause để thay đổi timestamp hoặc đè thao tác từ phiên khác.
- Form đầy đủ và hai form sửa nhanh dùng chung helper lưu. Phiên bản thử lại chỉ thuộc campaign và phiên form đó; form khác, đóng/đổi phiên và phản hồi muộn không nhận lại phiên bản này. Form giữ dữ liệu để chỉnh và bấm Lưu lại; chỉ tiếp tục sau khi data đã lưu thành công và người dùng chọn Chờ xử lý.
- Lần thử lại vẫn kiểm tra quyền, trạng thái, runtime và phiên bản tại UPDATE. Giữ yêu cầu materialize data kể cả khi cấu hình SMS đã giống lần ghi dở, đồng thời giữ yêu cầu cập nhật lịch từ lần thất bại trước. Caller cũ không bật guard giữ hợp đồng lỗi/pause hiện tại.
- Hồi quy: `node scripts/campaign-sms-save-retry-smoke.cjs` thực thi repository → IPC → store → helper thật với HTTP giả; bao phủ SMS/voice, lỗi lặp, cấu hình giống nhau, lịch, xung đột phiên bản/runtime/quyền, form riêng, đóng/phiên cũ và caller legacy. `node scripts/run-campaign-edit-ui-smoke.cjs` thêm thử lưu dở SMS ở sửa nhanh và voice ở form đầy đủ; xác nhận không resume trước khi data hoàn tất.

Không sửa Web/native, RPC/migration hoặc connection; không chạy chiến dịch thật hay phát hành.

Kiểm chứng bản sửa SMS/voice: hai typecheck `tsconfig.node.json`/`tsconfig.web.json`, production build Desktop, smoke SMS/voice mới, smoke edit flow/save retry, hồi quy content preparation và giao diện Electron đều đạt; `git diff --check` sạch.

## Kiểm chứng nhánh PR riêng — 16/10/2026

Tách đúng thay đổi sửa chiến dịch khỏi các thay đổi local khác. Trên checkout riêng: hai typecheck Desktop, production build, state machine/CAS, continuation, SMS/voice retry và giao diện Electron đều đạt. Web/API được kiểm chứng trên nhánh riêng của akaAgentWebApp; hai cấu hình trình duyệt Desktop/Android Chromium đạt với API/WebSocket giả lập. Không chạy chiến dịch thật hoặc phát hành.

## Sửa lỗi lưu sau khi log thay đổi — 16/10/2026

Người dùng báo Desktop: `Failed to update campaign: Cannot coerce the result to a single JSON object`. Đã tái hiện đúng thông báo bằng repository và Supabase HTTP client thật trên dữ liệu giả: mở form khi đã dừng → append log làm đổi `updated_at` → Lưu. Điều kiện timestamp của tính năng mới khớp 0 hàng; `.single()` trả PGRST116. Đây là hồi quy mới. Các ca review trước giữ timestamp cố định hoặc coi mọi thay đổi timestamp là xung đột, nên bỏ sót log phát sinh bình thường trong lúc form đang mở.

- `editVersion` chỉ đọc, tính trong main từ cấu hình đã lưu trên cùng hàng DB; bỏ log, note, trạng thái và tiến độ runtime. Chuẩn hóa thứ tự key JSON, giữ thứ tự mảng; bao gồm lịch hiện tại/gốc, tài khoản, nội dung/media, extra settings, nguồn data và provisioning. Không dùng `readVersion` của cache UI thay cho phiên bản sửa.
- Main so phiên bản cấu hình trong lần đọc readiness sẵn có. Log thay đổi không chặn nhầm; cấu hình thực sự thay đổi vẫn yêu cầu mở lại form. UPDATE cuối vẫn dùng timestamp nguyên vẹn đến microsecond và các điều kiện paused/unowned. Không đọc thêm, tự retry, thêm polling hay connection.
- UPDATE khớp 0 hàng có thông báo tiếng Việt; giữ form. SMS/voice lưu dở trả thêm đúng phiên bản cấu hình vừa commit, helper giữ theo phiên form để retry qua log mới mà không nhận cấu hình của người sửa khác.
- Form đầy đủ/lịch, nội dung/media và giới hạn cùng truyền phiên bản này. Nhân bản và tạo mới giữ nguyên luồng tạo.
- Web đã so `configVersion` trước khi lấy timestamp mới cho RPC atomic, nên ca log đổi trong lúc mở form đã hoạt động. Chỉ bổ sung kiểm thử API Zalo/SMS và browser gửi đúng phiên bản cho sửa đầy đủ/sửa nhanh; không đổi mã nghiệp vụ Web/native.

Đối chiếu chỉ đọc trên `akachat`: `public.append_auto_campaign_log(bigint,bigint,text)` cập nhật `updated_at` cùng log (checksum định nghĩa `f94520920cec83d91829b7f542435eeb`). `public.aka_agent_campaign_config_version(public.auto_campaigns)` giữ phiên bản khi chỉ đổi log/timestamp và đổi phiên bản khi nội dung đổi, kiểm tra bằng `SELECT` trên hàng tổng hợp, không ghi chiến dịch. Không thay định nghĩa/ACL/RPC; checksum đích không đổi.

Hồi quy mới: `node scripts/campaign-edit-version-smoke.cjs` đi qua reader → IPC → writer → Supabase HTTP giả; kiểm tra log-only, cấu hình thực sự đổi, JSON đổi thứ tự key, timestamp microsecond, quyền/trạng thái/runtime đổi trước ghi và số lần đọc không tăng. Smoke SMS/voice và giao diện Electron bổ sung log xen giữa mở form/lưu dở/thử lại.

Kiểm chứng hoàn tất: hai typecheck Desktop, typecheck monorepo Web/API và production build cả hai repo đạt. Smoke phiên bản mới, edit flow, continuation, SMS/voice, pause note, lịch AI và content preparation đạt; giao diện Electron đạt. Web: 22/22 ca API readiness, 125/125 ca form/quick edit/session và Playwright Desktop/Android Chromium 2/2 đạt. `git diff --check` sạch ở cả hai repo. Bản sửa ứng dụng nằm trong working tree, chưa đóng gói/phát hành/deploy; main/preload đang mở cần nạp lại bản mới.

Kiểm chứng PR sửa lỗi trên checkout riêng từ `origin/dev_3`: hai typecheck, production build, HTTP regression, edit flow, continuation, SMS/voice retry và giao diện Electron đều đạt. Nhánh chỉ chứa bản sửa này; giữ nguyên các thay đổi local khác ở repo chính.
