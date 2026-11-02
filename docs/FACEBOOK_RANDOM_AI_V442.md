# Facebook — Chạy ngẫu nhiên nâng cao bằng AI (V444)

## Trạng thái

**V444 đã apply lên production akachat lúc 22:27:21 Việt Nam ngày 02/11/2026**, ledger `20261102152721 / migration_v444_facebook_random_ai`. Trial transaction `ROLLBACK`, hậu kiểm 11 hàm và metadata/quyền đạt. App dev đã mở từ worktree để người dùng test. **Chưa đóng gói/phát hành; chưa kiểm canary AI/Facebook thật của tính năng.** Xem [audit](audits/facebook-random-ai-v442/README.md) và [receipt apply](audits/facebook-random-ai-v442/apply-receipt.json). Không apply lại.

Candidate trước đây mang số V442; trước apply đổi sang V444 vì ledger đã có V442 của tính năng campaign agent form và V443 của export Facebook group. Giữ tên tài liệu/thư mục audit V442 để không làm mất liên kết và receipt lịch sử.

Chế độ thủ công giữ hợp đồng [V387](FACEBOOK_RANDOM_RUN_V387.md), lifecycle [V392](FACEBOOK_RANDOM_RUN_RESTORE_V392.md), [V393](FACEBOOK_RANDOM_RUN_BOUNDARIES_V393.md) và lịch dùng chung [V397](CAMPAIGN_SHARED_SCHEDULE_V397.md). V444 được dựng từ định nghĩa live đã có patch quyền/ownership mới; không dùng body migration lịch sử làm nguồn triển khai.

## Sử dụng

Trong cài đặt chạy ngẫu nhiên tài khoản Facebook, chọn **Chạy ngẫu nhiên nâng cao (dùng AI)**. Bảng thủ công và nút **Tải lại** được ẩn ngay khi tích checkbox, hiện lại khi bỏ tích; các dòng cũ vẫn giữ nguyên để khôi phục khi bỏ chọn. Thay đổi checkbox chỉ được áp dụng sau khi lưu cấu hình. AI có thể chạy với danh sách thủ công rỗng.

AI lập một chuỗi hành động cho ngày Việt Nam, tối đa 100 dòng. Hành động được lặp với chỉ tiêu khác nhau, không gộp, không sắp xếp lại sau khi lưu. Ví dụ: nhắn tin 5 → đăng nhóm 3 → newsfeed 10 phút → đăng nhóm 5 → nhắn tin 7 → đăng nhóm 2. Đăng trang cá nhân luôn 1 lượt; data theo đơn vị hiện có; phút là thời lượng newsfeed, không đổi lịch/nghỉ/giờ dừng.

Loại có chiến dịch chờ trong phần còn lại của ngày tạo chuỗi chính; chiến dịch hẹn muộn trong ngày được tính. Loại không có chiến dịch chờ có đúng một dòng dự phòng ở cuối. Tạm dừng được đếm riêng, không làm tăng ưu tiên hay dành trước quota. Mỗi loại được phép tại lúc lập kế hoạch phải có mặt; kết quả thiếu loại, ID lạ, sai đơn vị/chỉ tiêu hoặc dự phòng sai vị trí đều bị từ chối.

Không có chiến dịch phù hợp thì bỏ qua dòng ngay, kể cả dòng newsfeed 10 phút. Một loại dự phòng có chiến dịch mới sẽ dùng dòng đã lưu. Loại hoàn toàn mới/quyền mới sau khi lưu chờ ngày sau; quyền bị thu hồi vẫn bị runtime chặn.

Tiến trình hiển thị kế hoạch, dòng đang chạy/dòng xét tiếp, vòng kế hoạch, vòng phân lượt, số chiến dịch đã được phân lượt, dòng dự phòng/nhóm đã đủ lượt và lịch sử thực thi. Khả dụng của nhóm là snapshot ở lần phân lượt gần nhất, không thay thế kiểm tra runtime. **Làm mới** chỉ đọc dữ liệu. Khi hết các lượt thử tự động, **Thử lại AI** mở một chu kỳ thử mới.

Hộp cấu hình kiểm tra phiên hiển thị cả sau khi tải lại tài khoản: phản hồi lưu cũ không đóng hộp vừa mở lại hoặc làm mất nháp mới. Tải thêm ngày lịch sử bỏ phản hồi của bộ lọc cũ và giải phóng trạng thái chờ khi đổi ngày/phạm vi.

## Vòng kế hoạch và vòng phân lượt

Hai bộ đếm độc lập:

- Vòng kế hoạch duyệt chuỗi AI từ đầu đến cuối rồi quay đầu.
- Vòng phân lượt cho mỗi chiến dịch đang đủ điều kiện một lượt trước khi chọn lại.

Mỗi nhóm hành động được xáo một lần khi mở vòng phân lượt. Dòng AI chọn chiến dịch đầu hàng đợi cùng loại chưa có lượt. Nếu nhóm trống hoặc đã đủ lượt thì bỏ qua dòng. Còn chiến dịch chưa có lượt sau khi hết chuỗi thì tiếp tục chuỗi, giữ dấu đã chạy. Khi tất cả chiến dịch hiện đủ điều kiện đã có lượt, mở vòng phân lượt mới **không reset con trỏ AI**.

Chiến dịch mới/tiếp tục/vừa đến giờ được thêm cuối hàng đợi. Mục không còn đủ điều kiện được rút khỏi hàng đợi; khi trở lại thì thêm cuối, dấu đã có lượt trong vòng vẫn giữ. Thay đổi được đối chiếu ở mỗi lần scheduler phân lượt.

Chỉ `private.facebook_random_unit_started` đánh dấu đã có lượt sau khi nhận unit thực sự. Lượt planned/skipped không được tính. Claim/unit/receipt/cleanup/recovery giữ nguyên. Trước thực thi vẫn kiểm tra lịch, data, quota, quyền và ownership. Không tiến triển thì trả về tick hiện tại, không quay vòng vô hạn.

Helper nhận unit vẫn được dùng chung với Facebook chạy thường. Nếu không cập nhật được turn ngẫu nhiên đang chạy tương ứng với claim, helper thoát ngay sau phần xử lý cũ; không đọc hoặc khóa thêm lịch sử ngày cho allocation AI. Điều kiện dựa trên turn đã nhận, không dựa riêng vào checkbox hiện tại, để giữ ghi nhận lượt khi thay đổi chế độ giữa chừng.

Lỗi cấu hình nội dung nâng cao và chiến dịch mời bạn vào nhóm chưa chọn nhóm nhận được loại trước phân lượt; sửa cấu hình thì được xét lại ở lần đọc tiếp theo. Nếu runtime vẫn phải dừng trước admission, lần phân lượt kế tiếp đưa chiến dịch đó xuống cuối hàng đợi, đúng một lần cho mỗi turn đã kết thúc. Áp dụng cả turn bị bỏ qua và turn đã được release helper kết thúc. Không đánh dấu `served`, không reset cursor/vòng, không thay status chiến dịch để nhường lượt. Dấu `deferredTurnId` lưu trong allocation chống xáo lại khi retry, restart hoặc Desktop khác tiếp quản.

Bảo đảm tránh bỏ sót do chọn ngẫu nhiên; thời gian, lịch, data và quota vẫn quyết định khả năng chạy hết trong ngày.

## Lưu trữ và luồng main

- `FacebookRandomConfig`: đọc v1; v2 thêm `mode: manual | ai`, giữ `revision`/CAS và `rules` thủ công.
- `auto_account_random_run_days.state.ai`: trạng thái, request ID, số lần xin thực hiện, lease có hạn, snapshot danh mục/thống kê, kết quả/lỗi, lịch thử lại.
- `state.allocation`: cursor, cycle, coverageRound, queues, served và availability. Lưu từng turn cùng `aiPlanId`, `ruleIndex`, `planCycle`, `coverageRound`.
- Mọi cập nhật ngày/turn hợp nhất state, giữ kế hoạch khi chuyển sang thủ công rồi bật lại AI trong ngày.
- Public RPC cũ giữ nguyên signature và timeout 30 giây; thêm `ai_status/acquire/commit/fail/retry` và `plan` protocol 2. Client v1 không nhận AI turn từ planner; phản hồi planner trả `enabled=false` để dừng cả luồng dự phòng của client cũ, không đổi cờ tài khoản trong DB.
- RPC khóa tài khoản/ngày để xin lease 180 giây; không giữ transaction trong lúc chờ AI. Request ID + lease token + revision/date quyết định kết quả được chấp nhận.
- Dữ liệu chiến dịch đọc keyset 500 dòng/trang qua client hiện có. Catalog được lọc quyền Core/Fanpage trong main. Context chỉ có tên loại, số lượng tổng hợp và giới hạn số; không có ID chiến dịch, nội dung, người nhận hay credential.
- Giới hạn chiến dịch tổng hợp theo cùng quy tắc chọn cấu hình của runtime: ưu tiên cả entry `actionLimits.byActionCode[code]`; nếu chưa có entry mới dùng `dailyLimit/rateLimitCount/rateLimitMinutes` cấp gốc. Entry riêng rỗng hoặc chỉ có một phần không được tự điền từ cấp gốc. Chỉ lấy giá trị số hợp lệ; chiến dịch tạm dừng không góp giới hạn vào chuỗi chính.
- Inventory thực thi chỉ đọc trường cần cho điều kiện chạy và hai left embed input-data, mỗi embed tối đa một ID: có data bất kỳ và có data chờ đến giờ. Lọc status/lịch trước giới hạn embed, nên không bỏ sót data chờ ở sau nhiều trang đã hoàn tất. Không tải toàn bộ input-data của mọi ứng viên. Left embed giữ đúng newsfeed, timeline và cơ chế bạn bè gợi ý khi chưa có data.
- Trong một lần đọc inventory, action được đọc một lần theo loại; các phép peek disable/quota trùng tài khoản, action và cấu hình giới hạn dùng chung kết quả. Cache chỉ tồn tại trong lần đọc đó. Trước thực thi chiến dịch được chọn vẫn đọc mới action/quota/data; claim và unit không dùng cache inventory. Chế độ thủ công giữ đường đọc cũ.
- `app_facebook_random_run_plan` dùng model 21 hiện có, timeout 120 giây, runtime/proxy AI hiện có, JSON schema và validator TS/SQL. Không thêm đường gọi provider trực tiếp từ Desktop.
- Toàn bộ `callAiUsing`, gồm tải cấu hình, chờ provider và ghi log, được bọc bằng `withRequestDeadline` hiện có trong 120 giây. Timeout hoặc hủy làm kết thúc chờ dù I/O bên trong chưa trả; kết quả/lỗi đến muộn không được commit kế hoạch. Ghi lỗi qua RPC vẫn giữ timeout riêng hiện có, lịch retry và recovery theo DB; không bọc commit chưa rõ kết quả bằng deadline AI hoặc xóa pending commit.
- IPC chỉ có get/save/toggle/day/dates/retryAi; không lộ lease, claim, unit, key hay RPC thực thi cho renderer.
- Không thêm SQL pool/connection, worker, replica hoặc polling. UI dùng coordinator đọc campaign hiện có; retry dùng tick scheduler hiện có.

## Lỗi và các lần thử

Khi có chiến dịch đủ điều kiện lần đầu trong ngày, scheduler xin quyền lập kế hoạch. Tối đa ba lần xin thực hiện trong một chu kỳ: lần đầu, thử lại sau 1 phút, thử tiếp sau 5 phút tính từ lỗi trước. Mất process/lease hết hạn được xử lý bằng DB clock; restart không reset số lần. Nếu không có kế hoạch hợp lệ thì chờ, không dùng thủ công hay kế hoạch ngày trước.

RPC đọc `day` đối chiếu hạn lease bằng DB clock ngay cả khi không còn chiến dịch đủ điều kiện để scheduler xử lý `ai_status`. Lease hết hạn hiển thị chờ thử lại hoặc hết lượt theo số lần đã lưu; lịch thử vẫn tính từ thời điểm hết lease. Ngày cũ chưa có kế hoạch báo đã kết thúc và không mời thử lại. Đây chỉ là phản hồi đọc: không ghi state, không reset bộ đếm, không gọi AI; chỉ nút **Thử lại AI** khi khả dụng mới yêu cầu chu kỳ thử mới.

Kế hoạch hợp lệ giữ nguyên cả ngày khi tạo/xóa, pause/resume, đổi lịch/data/quota, restart hoặc tắt/bật. Chuyển cài đặt lúc AI đang chờ thu hồi lease; kết quả cũ không được lưu. Logout hủy request và bỏ phản hồi muộn theo generation phiên.

Mất phản hồi commit: giữ request/result trong main để đối chiếu bằng commit idempotent trước; sau restart đọc trạng thái DB trước khi xin lượt mới. Không gọi provider lại chỉ vì chưa biết commit đã thành công. Qua ngày, kết quả request ngày cũ không thể trở thành kế hoạch ngày mới.

## Triển khai và rollback

[Migration V444 đã apply](../migrations/migration_v444_facebook_random_ai.sql). Captures: [nguồn trước apply](../migrations/snapshots/facebook-random-ai/source.json), [đích đã đối chiếu live](../migrations/snapshots/facebook-random-ai/target.json). Apply theo yêu cầu người dùng, đúng `akachat/cgjbsmqtfhqvttudyjzq`; đã đọc lại exact definitions và metadata trước apply, không drift. Không tăng checksum để vượt preflight.

[Postcheck](../migrations/tests/migration_v444_facebook_random_ai_postcheck.sql) đã đạt trong transaction apply trước COMMIT; đọc lại live sau apply xác nhận 11 hàm và toàn bộ metadata/quyền khớp. Chưa kiểm HTTP RPC bằng role Desktop thật hoặc canary AI/Facebook; cần thực hiện trước phát hành. Không chủ động reload PostgREST; giữ event trigger reload hiện có, không thêm DDL phụ.

[Rollback có guard](../migrations/tests/migration_v444_facebook_random_ai_rollback.sql) chỉ chấp nhận đúng target checksum/owner/ACL/config và prompt/using chưa sửa. Phải dừng/drain turn AI, chuyển cấu hình v2 về v1 một cách chủ động trước khi rollback. Rollback không tự bật thủ công, không xóa lịch sử ngày, không mở lại quyền anon. Tài liệu này không cấp quyền apply hay rollback production.
