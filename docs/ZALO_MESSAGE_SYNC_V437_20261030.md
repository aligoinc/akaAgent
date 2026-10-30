# Đồng bộ lịch sử Zalo Server — V437, 30/10/2026

**Cập nhật 07:01 ngày 30/10/2026 (Việt Nam):** sáu bản sửa review nêu dưới đã
deploy riêng Chat API. Những câu “chưa deploy” là lịch sử tại thời điểm kiểm thử;
trạng thái hiện hành và receipt ở mục cuối tài liệu.

Đã apply trên **akachat / cgjbsmqtfhqvttudyjzq**:
`20261029180830 / migration_v437_chat_zalo_message_sync`. Không apply lại.
Canonical SQL ở repo **akaAgentChatApi**:
`migrations/migration_v437_chat_zalo_message_sync.sql`; không sao chép SQL sang
akaAgent hoặc `supabase/migrations`.

Ba bảng `chat_zalo_message_sync`, `chat_zalo_message_sync_log`,
`chat_zalo_message_sync_batch` lưu người yêu cầu, khoảng ngày, tiến trình và kết
quả batch. Ba cột nullable trên runtime inbox liên kết kết quả worker. RLS bật,
anon/authenticated không có quyền; backend dùng quyền và pool hiện có. Không sửa
RPC, timeout chung, giới hạn pool hoặc thêm replica.

Đã deploy Chat API/worker, Zalo Server runtime và ChatWeb. Runtime một máy
2 shared CPU/2 GB, volume riêng 20 GB mã hóa và tắt snapshot tự động. API/worker
vẫn 2 shared CPU/1 GB mỗi máy. Runtime cũ đã gỡ sau chuyển đổi; không bật hai máy
runtime cùng lúc. Không cập nhật Desktop/App Server installer, không thêm QR
local sync.

Hợp đồng và schema đầy đủ ở repo Chat API `docs/ZALO_MESSAGE_SYNC.md`; image,
receipt, kiểm chứng và hai sự cố rollout đã khôi phục ở
`docs/ZALO_MESSAGE_SYNC_ROLLOUT_20261030.md`. Web contract ở repo ChatWeb
`docs/ZALO_MESSAGE_SYNC.md`. Source API/Web chưa commit/push trong lần triển khai.
Root akaAgent chỉ cập nhật tài liệu, không sửa mã ứng dụng.

Giữ quyết định người dùng: lọc ngày ở điện thoại→tệp; 512 MiB tệp nén; admission
theo ổ đĩa, không giới hạn tổng số account hoặc kiểm CPU/RAM; chia batch và chờ
worker receipt. Lịch sử không tăng unread/thông báo/campaign realtime. Chủ tài
khoản/Quản trị Chat được dùng, quyền hỗ trợ hội thoại không đủ.

Live health đạt và worker có xử lý event. Chưa chạy pilot nhập thật production;
tài khoản `zl QN sv` cần đăng nhập lại trước khi người dùng tự bắt đầu/xác nhận.
Không cam kết không mất tin trong các khoảng gián đoạn rollout. Không dùng kết
quả test tệp lớn hoặc mock để thay bằng chứng pilot.

Sau review ngày 30/10/2026 đã sửa local ba lỗi Chat API: bỏ sót lượt kiểm tra khi
job mới chen vào, mở khóa account trước khi runtime dọn xong lúc listener mất
kết nối, và timestamp snapshot bị lùi do transaction settle. 167 tests cùng
PostgreSQL 17 regression, typecheck/build đạt. **Ba sửa này chưa deploy**, không
cần migration mới; không đổi runtime/Web hay tài nguyên Fly. Chi tiết ở mục
“Sửa sau review” trong biên bản rollout Chat API nêu trên.

Review tiếp theo cùng ngày bổ sung hai sửa coordinator: chặn start khi đã chấp
nhận dừng trong lúc đang chờ và đánh thức reconcile nếu transaction tạo job mất
phản hồi sau COMMIT. 76 test liên quan/typecheck/build đạt; lỗi COMMIT được mô
phỏng local. **Hai sửa bổ sung cũng chưa deploy**, không thay đổi migration,
runtime/Web, pool hoặc tài nguyên Fly; xem phần review tiếp theo trong biên bản.

Review receipt cùng ngày đã sửa local việc mất xác nhận lô khi settlement commit
nhưng API mất phản hồi: đọc lại receipt từ journal trong nhịp/transaction hiện
có, không cộng trùng; ngừng replay khi có lô mới hoặc producer đã dừng. 82 test,
typecheck/build và PG17 regression đạt; query dùng index có sẵn để đọc một lô
mới nhất trên fixture 10.002 batch/job. **Sửa này cũng chưa deploy**, chỉ cần cập
nhật Chat API, không migration hay thay đổi runtime/protocol/Web/pool. Chi tiết
ở mục “Review receipt” trong biên bản Chat API.

## Triển khai các bản sửa sau review

Đã deploy riêng Chat API lúc 07:01 ngày 30/10/2026, image
`phone-history-fixes-20261030`, digest
`4d27c5f33c30c269bb246d86a767b6a5858236b6b07f57013e361c2c36f1e24b`.
Chỉ image máy API thay đổi; worker/runtime giữ nguyên image/config/thời điểm cập
nhật, ChatWeb không deploy. Không apply migration, tăng pool/replica hoặc đổi
tài nguyên Fly. Trước triển khai không có job đồng bộ đang chạy.

184 tests/4 files, typecheck/build và ba PG17 regression đạt. API health/ready
HTTP 200, bốn module live khớp checksum, Server/local reconnect và heartbeat mới;
runtime quản lý 213 account. Chưa pilot nhập lịch sử production, không gửi tin
Zalo tự động. Receipt và source checksums canonical trong repo Chat API:
`docs/audits/phone-history-fixes-20261030/`; biên bản chi tiết ở mục cuối
`docs/ZALO_MESSAGE_SYNC_ROLLOUT_20261030.md`. Source vẫn chưa commit/push.

## Pilot và bản sửa sau 07:04

Pilot đầu tiên của `zl QN sv` / 1159 lúc 07:04:57 ngày 30/10/2026 kết thúc
`sync_invalid_response` ngay sau yêu cầu; 0 tin được nhập. Đã tái hiện lỗi source
parse lại chuỗi ACK rỗng từ capture lab thành công và sửa local transport pull/
cancel. Đồng thời form đổi thành sáu bước dễ hiểu, ẩn kiểm tra dung lượng và
thông số nội bộ; không đổi disk admission, giới hạn 512 MiB hay cách lưu tin.
88 test API, typecheck/build; Web lint/build/180 test và Chromium fixture đạt.

Sửa ACK và giao diện đã deploy API, runtime và ChatWeb lúc 07:18–07:21 ngày
30/10/2026 (Việt Nam). Chỉ image ba machine thay đổi; worker giữ nguyên cả config
và thời điểm cập nhật. Không apply migration/tăng pool/replica hoặc tài nguyên.
API/runtime image `phone-history-ack-ui-20261030`, digest
`589db63cc62202f7d41feb2f3bb197e023a7e3c04679de21ab158822ea4e13ae`;
Web cùng tag, digest `3d124282c232f214f9dfa083ebca88c86a0f0f5cd267e87eb9209d1bc3f80111`.

API/Web health HTTP 200, runtime reconnect/heartbeat mới; account 1159 đã
logged_in/connected lúc hậu kiểm. Bốn module live API/runtime khớp checksum;
runtime smoke ACK bằng dữ liệu tổng hợp và kiểm chunk JS công khai Web đạt.
Runtime được stop bằng SIGTERM rồi cập nhật cùng machine; không thu được event
drain trong cửa sổ log, nên không khẳng định không mất tin lúc restart. Không tự
gửi pull/tin Zalo. Chưa có pilot nhập thành công sau sửa. Nguồn canonical ở repo
API: `docs/ZALO_MESSAGE_SYNC_ACK_UI_20261030.md`, receipt và source manifests
trong `docs/audits/phone-history-ack-ui-20261030/`. Source vẫn chưa commit/push.

## Tối ưu nhập và gate giao diện — source local, chưa deploy

Theo yêu cầu tiếp theo 30/10/2026, Chat API/worker bổ sung ghi tối đa 20 tin lịch
sử liên tiếp trong một transaction, giữ unique indexes, outcome/ACK, FIFO và
budget event/pool. Không vượt qua tin realtime; metadata và mốc hội thoại cập
nhật theo lô. Web chỉ hiện nút/form sync cho org ID 1 trong giai đoạn test; nút
Dừng có spinner và disable ngay khi gửi, giữ khi đóng/mở lại form. Không thay
quyền backend, runtime/protocol, V437 hoặc tài nguyên Fly.

**Chưa deploy hoặc apply DB.** Biên bản và đo PostgreSQL local canonical trong
repo Chat API: `docs/ZALO_MESSAGE_SYNC_BULK_20261030.md`; Web contract:
`docs/ZALO_MESSAGE_SYNC.md`. Benchmark 1.000 tin tổng hợp: 19.999→2.799 truy vấn,
7.113→1.035 ms local; không coi là cam kết tốc độ production. Chỉ source/docs
API/Web thay đổi; root akaAgent không thay mã ứng dụng.

## Triển khai tối ưu worker và UI org 1 — 07:59–08:00 VN, 30/10/2026

Theo yêu cầu người dùng, các thay đổi source ở mục trước đã deploy riêng
system-worker `784574da214578` và ChatWeb `7847d95cd4ddd8`, image tag
`phone-history-bulk-20261030`. Worker digest
`57eb325758bdd395d2e697ff1757d2112cafc468946747b15488644a2b9e7987`;
Web digest `b8f607517a08c681336762e638c1c4a29dd5ff5fae42c38d3bde379176766c14`.

Worker cũ đã xác nhận stopped sau SIGTERM trước cập nhật/start sole worker.
Fly ghi requested SIGTERM/exit 143; không có milestone app drain-completion
riêng. API và Zalo runtime giữ image, instance, config/updated_at; control
connection Server vẫn từ 07:20:20.442 VN và heartbeat tiếp tục. Không restart
Zalo runtime, apply DB hoặc tăng CPU/RAM/volume/pool/replica.

Worker project 697/697 sự kiện trong phút đầu, 0 lỗi ghi/claim/reject/hạ tầng.
API health/ready và Web health HTTP 200; accounts chưa login trả 307. Module
worker khớp build; public JS Web khớp image và có org 1 gate/spinner/aria-busy.
Chuẩn hóa payload vẫn có lỗi transport/upload như ghi trong audit riêng;
không coi đó là nhập thành công. Nhánh nhập lô thật production chờ user test.

Pilot trước tối ưu đã nhập 2.436 tin, nhận diện 464 tin trùng, 0 lỗi nhập và
kết thúc cancelled lúc 07:35:22 VN; dữ liệu đã nhập được giữ nguyên. Trước đợt
deploy này có 0 job đồng bộ active. Không tự gửi tin hoặc yêu cầu sync Zalo.
Biên bản/rollback canonical ở repo API `docs/ZALO_MESSAGE_SYNC_BULK_20261030.md`,
receipt `docs/audits/phone-history-bulk-20261030/deployment-receipt.json`.

## Bản sửa review tiếp theo — chỉ source local

Đã sửa thứ tự khóa của nhập lô nhóm (nhóm trước người dùng) và Web bị giữ trạng
thái “Đang yêu cầu…” khi nhiều tab/mất phản hồi. Không migration, RPC hoặc thay
đổi runtime/pool. Kiểm chứng và nguồn canonical ở repo API
`docs/ZALO_MESSAGE_SYNC_REVIEW_FIXES_20261030.md`; Web có regression mất phản hồi
và giữ UUID/range khi retry. **Chưa deploy**, trạng thái production phía trên
không thay đổi.

## Trạng thái khi tạo draft PR

Review tiếp theo còn hai lỗi P2 đã tái hiện local: nhập lô và snapshot của hai
nhóm khác nhau có chung người gửi vẫn có thể deadlock; Web có thể nhận nhầm
lượt mới hơn ở tab khác là phản hồi cho Start chưa được backend tiếp nhận.
Chi tiết canonical: repo API `docs/ZALO_MESSAGE_SYNC_REVIEW_FIXES_20261030.md`.
PR giữ dạng draft chờ xử lý các lỗi này; tạo PR không deploy hoặc apply lại V437.
