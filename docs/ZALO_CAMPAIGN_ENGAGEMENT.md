# Theo dõi tương tác Zalo sau campaign

Trạng thái ngày 02/10/2026: **v339 đã apply production**, Chat worker/runtime và WebApp/API đã deploy; **enabled=true từ 23:40:20 ngày 02/10/2026 (giờ Việt Nam), theo yêu cầu người dùng**. Desktop và legacy Electron Server chưa phát hành. Không apply lại v339. Xem [audit triển khai](ZALO_CAMPAIGN_ENGAGEMENT_DEPLOY_20261002.md). Xem [audit và kết quả kiểm chứng](ZALO_CAMPAIGN_ENGAGEMENT_V339_AUDIT.md).

## Ưu tiên: chiến dịch không phụ thuộc tương tác

Hotfix 03/10/2026: **v341 đã apply và Chat worker đã deploy**. Worker đọc bốn key qua HTTP public hiện có, vì SQL role không có quyền đọc settings; RPC đăng ký tự dọn pending Chat để không cần UPDATE detail trực tiếp. Không thay Desktop/App Server 7.9.0 hoặc tăng quyền/pool. Xem [audit sửa quyền cấu hình](ZALO_CAMPAIGN_ENGAGEMENT_CONFIG_FIX_20261003.md); không apply lại v341.

Theo yêu cầu chốt ngày 02/10/2026, tương tác là **best effort**: thiếu dấu được chấp nhận. Không chờ cấu hình, journal hoặc listener chỉ phục vụ tương tác trước khi gửi Zalo, lưu detail, cập nhật quota hoặc nhận owner Server. Lỗi tương tác không được làm gửi lại, đổi trạng thái hay dừng chiến dịch. Quy tắc này thay thế yêu cầu trước đó về lưu journal chắc chắn trước INSERT.

Khi cache cấu hình chưa có/hết hạn, thao tác gửi tiếp tục không có nguồn theo dõi mới và cấu hình được đọc nền. Metadata trong RAM được ghi journal nền; crash, lỗi đĩa, tràn hàng đợi, listener chưa sẵn sàng hoặc khóa tương tác bận có thể làm mất dấu. Dữ liệu nguồn đã commit cùng detail vẫn có thể được worker phục hồi. Không vì bảo toàn dấu mà thêm điểm chờ vào luồng nghiệp vụ. Công việc nền vẫn tiêu thụ CPU/DB; giữ giới hạn tài nguyên và công tắc tắt, không coi đây là tính năng có tải bằng không.

## Lọc trước DB để giảm tải Supabase

Sự kiện mới phải khớp metadata trong RAM theo account, UID phiên, người nhận, thời gian và loại tương tác trước khi vào journal/inbox engagement. Account/người nhận không được theo dõi, cache chưa nạp hoặc đã bị loại thì bỏ dấu ngay: không tra cứu Supabase theo sự kiện, không lưu metadata engagement và không đánh thức worker vì tin đó. Desktop giữ ngoại lệ cho đúng người nhận của một thao tác gửi đang có hold/recover đúng account trong RAM để đối chiếu sự kiện đến sớm. Khi detail commit thay hold/recover bằng mục đăng ký, giữ account ID cùng UID phiên/người nhận để tiếp tục nhận sự kiện trong lúc chờ lô đăng ký. Journal cũ không có account ID ở mục đăng ký không mở ngoại lệ này. Chat chỉ nhận sau khi metadata đăng ký đã vào cache; khoảng gửi–đăng ký có thể mất dấu.

Khi login/attach owner hoặc khởi động worker, RPC read hiện có nhận nhánh `catalog` để nạp lượt còn hạn theo trang tối đa 500 dòng; cập nhật cache thêm từ kết quả đăng ký. Cursor gồm deadline/ID và mốc bắt đầu cố định, lấy nguyên độ chính xác từ DB. Index `auto_campaign_engagement_catalog(organization_id,staff_id,tracking_until,campaign_detail_id)` tránh quét toàn bộ lịch sử hết hạn. Chat chỉ xét owner có binding Chat active, dùng credential bên trong query hiện có và không đưa ra JavaScript. Nạp nền dùng writer hiện tại, có giới hạn cache 100.000 dòng/64 MiB metadata ước lượng và nhịp gom hiện có; không được giữ luồng gửi để chờ nạp đủ.

Metadata được phục hồi ở đầu phiên và khi writer nhận revision mới; không quét catalog định kỳ do tin không liên quan hoặc cache miss. Vì vậy cache lạnh/eviction, lượt do process khác vừa đăng ký chưa có trong RAM, hoặc bật lại từ một phiên khởi động khi tính năng đang tắt có thể mất dấu cho đến lần nạp nền/hoạt động campaign tiếp theo. Đây là đánh đổi best effort để tránh biến lượng tin nhận vào thành lượng query Supabase. Những dòng có trong RAM vẫn dùng deadline DB riêng, kể cả timestamp nguồn đến muộn; campaign hoàn thành không làm xóa cache theo dõi.

Chat vẫn lưu/projection tin và UPDATE acknowledgement bình thường. Nhánh bị loại dùng nguyên UPDATE cơ bản, không thêm cột/khóa engagement, không phát sinh claim/read/record/done cho tracking. Lần nạp cache ban đầu, đăng ký mới và xử lý mục engagement cũ vẫn dùng DB; không tuyên bố toàn bộ Chat hoặc Supabase không còn tải.

## Hành vi

Cột **Tương tác Zalo** có bốn dấu độc lập và thời điểm tương ứng:

| Dấu | Điều kiện |
| --- | --- |
| Đã xem | Có receipt cho **ít nhất một ID tin** text/media/Share mà lượt campaign đã gửi thành công. Không yêu cầu đã xem tất cả media. |
| Đã phản hồi | Người nhận nhắn riêng sau lúc bắt đầu thao tác gửi; không cần quote/reply đúng tin. Đánh dấu mọi lượt gửi cùng account, UID phiên, người nhận và còn hạn tại timestamp sự kiện. |
| Đã thả cảm xúc | Sự kiện thêm cảm xúc khớp ID tin của lượt gửi. Gỡ cảm xúc không xóa dấu. |
| Đã kết bạn | Sự kiện trở thành bạn sau lời mời campaign. Không suy đoán ai bấm chấp nhận; hủy kết bạn không xóa dấu. |

“Đã xem” dùng `seen_messages`, hoặc `delivered_messages` có `seenUids` xác nhận đúng người nhận. **Delivered đơn thuần không phải đã xem**. SDK hiện không cung cấp timestamp cho receipt seen riêng tư; trường hợp này lưu thời điểm nhận đầu tiên và giữ nguyên qua retry/restart. Không suy luận “đã xem” từ tin nhắn trả lời hoặc cảm xúc.

Chỉ áp dụng Zalo API ở Desktop, legacy Server và tenant Chat. Loại trừ `is_zalo_show_web=true`, tin nhóm/tự gửi, gửi lỗi/một phần, lời mời có kết quả “đã là bạn bè”. Lượt thành công có thể được theo dõi phản hồi dù SDK không trả ID; riêng seen/cảm xúc bắt buộc có ID khớp. Share chỉ nhận metadata khi response ánh xạ rõ người nhận qua ID, không ghép theo thứ tự mảng.

`sent_at` là lúc bắt đầu thao tác gửi của người nhận, chụp trước request đầu tiên. Chỉ khi **toàn bộ thao tác thành công** mới lưu nguồn và đăng ký theo dõi. Đây không phải timestamp xác nhận giao tin từ Zalo. Trường hợp người nhận tương tác trong khi gửi media, hold/inbox bảo vệ sự kiện đến trước lúc ghi detail.

Mỗi dấu giữ timestamp hợp lệ sớm nhất trong `[sent_at, tracking_until]`, kể cả khi xử lý muộn. Campaign hoàn thành vẫn nhận tương tác khi runtime/phiên đang hoạt động. Không có API Zalo kiểm tra bổ sung, quét lịch sử/bạn bè, listener theo từng campaign hoặc cron ban đêm. Không cam kết khôi phục sự kiện chưa được listener nhận trong khoảng offline.

## Cấu hình động

Chỉnh trong **Admin akaBiz → Cài đặt hệ thống**, bảng `auto_system_settings`:

| Key | Mặc định | Hợp lệ |
| --- | --- | --- |
| `zalo.campaign_engagement.enabled` | `false` | `true` / `false` |
| `zalo.campaign_engagement.flush_interval_seconds` | `5` | Số nguyên 1–60 |
| `zalo.campaign_engagement.batch_size` | `100` | Số nguyên 1–500 |
| `zalo.campaign_engagement.tracking_window_hours` | `48` | Số nguyên 1–720 |

Runtime đọc cả bốn key trong một request, dùng cache 60 giây/process, gộp request đang chờ. Cache hết hạn chỉ đọc lại khi có hoạt động; đọc lỗi thì tạm dừng engagement, chờ tối thiểu 60 giây trước khi thử đọc config lại. Không dùng config cũ quá hạn để ghi khi đọc lỗi. Desktop/legacy Server giữ sự kiện đã khớp metadata RAM trong hàng đợi `waiting_config` hiện có khi cache hết hạn và revision gần nhất đang bật; nếu chưa từng có cấu hình bật thì bỏ. Giới hạn queue/journal, gộp trùng và retry giữ nguyên; callback không đợi refresh. Chat dùng cùng quy tắc, ghi `waiting_config` vào inbox ngay trong UPDATE hoàn tất projection hiện có, với try-lock và guard ownership; không thêm request cho từng sự kiện. Các mục `waiting_config` mới/cũ giữ timestamp đầu tiên và revision đã biết (nếu có). Khi cấu hình phục hồi, chỉ xử lý nếu vẫn thuộc revision đang bật và lần nhận đầu tiên không nằm trước revision hiện tại. Desktop mới lưu riêng giờ DB lúc nhận (`receivedAt`) để kiểm tra revision, không dùng giờ local xếp hàng; journal cũ vẫn dùng trường `at`. Chat giữ `occurred_at` gốc của envelope. Tắt/bật trong lúc lỗi không làm sống lại backlog cũ. Thiếu/sai/tắt/secret `enabled` thì tắt; số không hợp lệ dùng mặc định. Không cần release Desktop hay migration mới để chỉnh bốn giá trị sau rollout đầu tiên.

RPC đăng ký đọc thời hạn tại DB một lần/lô và chốt `tracking_until = sent_at + tracking_window_hours`. Runtime dùng deadline DB trả về, không tính lại bằng cache. Đổi 48 → 72 → 24 giờ chỉ ảnh hưởng **lượt đăng ký mới**. Retry cùng detail không gia hạn; lượt cũ không bị kéo dài/cắt ngắn/mở lại.

Gom mặc định **100 mục hoặc 5 giây**, điều kiện đến trước. Thêm mục mới không dời thời hạn chờ của mục đầu. Mỗi process tối đa một bộ điều phối đang ghi; luân phiên staff/tenant/account, không tăng concurrency để bù backlog. Cấu hình mới áp dụng cho lô sau, lô đang ghi được hoàn tất. Tăng thời gian gom/kích thước có thể giảm số request nhưng tăng độ trễ/kích thước mỗi request; cần xem metrics thay vì giả định luôn giảm tải DB.

### Tắt khẩn cấp

Đặt `enabled=false`. Trigger thay revision trên **mọi UPDATE** của dòng công tắc, kể cả ghi lại cùng giá trị. RPC kiểm tra live enabled/revision trước công việc nặng ngay trong request hiện có. Request đã bắt đầu trước lúc tắt có thể hoàn tất.

Runtime khi biết tắt sẽ ngừng gom/gửi, bỏ mục chưa ghi. Revision cũ trong inbox không được xử lý lại; dọn theo lô/retention hiện có, không UPDATE toàn bộ backlog khi tắt. Bật lại không xả backlog của revision cũ; lượt đã đăng ký còn hạn vẫn nhận **sự kiện mới**. So sánh journal giữ đủ microsecond của revision DB, tránh nhầm hai lần đổi công tắc trong cùng millisecond.

Dữ liệu đã ghi giữ nguyên. Công tắc không dừng campaign, Chat hay listener dùng chung; nó chỉ giảm phần tải engagement. Việc sửa mô tả của riêng dòng `enabled` cũng đổi revision, nên thực hiện có chủ đích.

## Dữ liệu và luồng ghi

`public.auto_campaign_detail_zalo_engagement` có PK/FK `campaign_detail_id` (cascade khi detail bị xóa thật); ownership `organization_id/staff_id/account_id`; UID hai bên dạng text; `action_type`; `sent_at/tracking_until/updated_at`; `message_ids text[]`; `seen_at/responded_at/reacted_at/friended_at timestamptz NULL`.

Không lưu nội dung tin, credential hay session trong bảng/journal. RLS bật, không cấp truy cập bảng trực tiếp cho anon/authenticated/service_role; RPC security-definer dùng guard danh tính live, tenant, chủ sở hữu account/campaign, UID hiện tại và phạm vi runtime. Renderer/Web chỉ đọc trạng thái, không có thao tác tự đánh dấu. Chat dùng UID binding hiện tại; fallback legacy chỉ khi không có active Chat binding.

1. Executor giữ kết quả text/media/Share từ những request gửi đã có. Trước gửi, Desktop tạo hold riêng theo `operationId` để giữ sự kiện đến sớm. Hai thao tác cùng người nhận vẫn là hai operation độc lập.
2. Khi SDK trả thành công, Desktop/Server giữ metadata nguồn tối thiểu trong RAM và yêu cầu ghi journal nền trước INSERT detail (Share ở biên INSERT), không chờ file lưu xong. Detail thành công commit kèm `data.zaloEngagementSource` và pending marker. Nguồn gồm version, revision, UID hai bên, actionType, sentAt, messageIds; Desktop có operationId. Không hồi tố detail cũ không có nguồn.
3. Đăng ký idempotent theo lô qua `aka_agent_register_campaign_engagement`. Lỗi đăng ký không làm gửi lại tin/lời mời. Pending source hỗ trợ phục hồi đăng ký.
4. Listener dùng chung/Chat inbox chuẩn hóa metadata, loại nhóm/tự gửi/sự kiện không hỗ trợ. Cache chỉ chứa kết quả dương; sự kiện mới không khớp thì bị loại trước queue/DB theo cơ chế best effort ở trên.
5. `aka_agent_read_campaign_engagement` nạp catalog theo lô và tra metadata cho mục đã được nhận/khôi phục từ queue, thu hẹp theo tenant/account/UID/người nhận/timestamp. Giới hạn đọc 1.001 dòng chỉ báo cache chưa đầy đủ; không được coi phần bị cắt là không liên quan.
6. `aka_agent_record_campaign_engagement` đối chiếu lại quyền, UID, deadline và ID tin; gom timestamp sớm nhất theo detail/loại dấu, chỉ UPDATE dòng thay đổi. Không thay status thực thi, quota hay automation.

Index target thu hẹp ứng viên trước khi xét ID tin; index deadline hỗ trợ lượt theo dõi. Không tạo GIN toàn lịch sử tin nhắn. Detail/campaign bị xóa mềm hoặc chuyển ownership không nhận ghi từ quyền cũ.

### Desktop / Server

Coordinator nằm trong `src/main/services/zaloCampaignEngagement.ts`, dùng Supabase HTTP client hiện có. Một journal atomic snapshot tại `userData/campaign-engagement/<organizationId>-<staffId>.json`, tách owner. Ghi file tạm rồi rename; chỉ writer/cleanup nền chờ version. Producer không giữ waiter cho mỗi lượt gửi/sự kiện khi đĩa bị kẹt. Journal là metadata tối thiểu, không có nội dung hoặc credential.

Desktop/legacy Server chụp `sent_at` và thời điểm nhận dự phòng bằng `peekDatabaseRuntimeClock()`: chỉ đọc cache giờ DB dùng chung với scheduler, tiến bằng đồng hồ monotonic. Không dùng giờ máy/VPS để đối chiếu timestamp nguồn Zalo, không phát sinh request lấy giờ riêng. Cache chưa có/hết hạn/đã invalidate thì bỏ metadata tương tác mới và để nghiệp vụ tiếp tục. Timer gom/retry vẫn dùng miền thời gian local hiện có; không lấy epoch DB làm deadline timer. Dòng/sự kiện cũ đã lưu giữ nguyên, không tự sửa giờ hay dựng lại phản hồi mất. Xem [bản sửa lệch giờ và hàng đợi 03/10/2026](ZALO_CAMPAIGN_ENGAGEMENT_CLOCK_QUEUE_FIX_20261003.md).

Mỗi lượt writer ưu tiên scope có mục đăng ký/sự kiện/lookup operation đã đến lượt trước các scope chỉ cần nạp metadata lúc khởi động. Chỉ khi không có mục sẵn sàng mới đọc tối đa một trang recovery hoặc catalog; nguồn phục hồi được phép đăng ký ngay trong lượt đó. Request đã chạy được hoàn tất, vẫn một writer/process và luân phiên owner/account. Nếu luôn có việc mới, nạp catalog có thể bị hoãn; đây là đánh đổi best effort để hàng trăm owner khởi động không chặn dấu vừa nhận. Năm giây là nhịp gom mặc định, không phải cam kết thời gian hiển thị: còn request đang chạy, retry và refresh UI hiện có.

Đăng nhập Desktop thành công (kể cả auto-login), đổi mật khẩu hoặc attach owner của legacy Server tự đánh thức phục hồi journal, không cần tin nhắn hay campaign mới. File IO/DB chạy nền, không kéo dài bước đăng nhập; Server chỉ đọc credential khi cần RPC và tự retry qua bộ điều phối hiện có. Lỗi config/auth ban đầu không làm mất lượt phục hồi. Logout/detach/thay owner chặn callback cũ và callback RPC cũ bị chặn bằng generation. Thay owner cùng tenant/staff tái sử dụng scope và file writer hiện có để tránh hai writer chồng nhau. Khi hết việc hoặc nhận enabled=false thì dừng timer, không polling rỗng.

Khởi động listener bổ sung cho lời mời/Share cá nhân chạy nền, gộp theo SDK instance; lỗi thì chờ tối thiểu 60 giây trước lần thử mới. Không chờ 20 giây trước mỗi lượt gửi. Giữ nguyên những lần chờ listener vốn cần cho upload/media.

Sau restart, đọc nguồn pending theo trang tối đa 500 detail với cursor ID và mốc ID cuối cố định cho lượt phục hồi. Chỉ tiến cursor khi đã giữ cả trang; lỗi/overflow giữ nguyên trang và mốc cuối. Hold được đổi thành mục đăng ký theo đúng operationId; chỉ dọn hold không còn nguồn khi đã đọc hết lượt. Vì vậy nguồn ngoài trang đầu không bị mất sự kiện đến sớm. Việc chuyển hold tái sử dụng chỗ cũ trong queue. Hold chỉ có trước gửi khác với mục `recover` đã có kết quả gửi thành công: kết thúc lượt quét pending không xóa recover chưa rõ kết quả INSERT khi còn trong hạn phục hồi.

Nguồn phân biệt đã bắt đầu INSERT hay chưa ngay tại repository. Nếu dừng sau gửi nhưng trước INSERT thì bỏ nguồn và sự kiện chỉ phụ thuộc nguồn đó ngay; không biến nó thành lookup `missing` vô hạn. Nếu INSERT trả lỗi SQL xác nhận bị từ chối/rollback thì giải phóng operation tương ứng. Nếu mất response, timeout, SQLSTATE `40003` hoặc chưa rõ commit, giữ source trong journal và tra theo lô qua nhánh operation của RPC read hiện có, **tối đa 5 phút kể từ lần đầu chuyển sang recover**. Mốc `recoveryExpiresAt` được lưu trong journal; staging lại, retry và restart không gia hạn. Journal cũ chưa có mốc dùng `at + 5 phút`.

Hết 5 phút, nguồn không còn được dùng để nhận tin mới vào queue, dù writer chưa kịp dọn. Writer/restore bỏ nguồn và replay chỉ phụ thuộc nguồn đó trước khi đọc cấu hình/tra RPC, kể cả đang lỗi cấu hình. Giữ sự kiện còn phụ thuộc một operation khác hoặc chưa xử lý cho watch đã có trong cache; kết quả lookup về muộn không khôi phục recover đã hết hạn. Hết việc thì dừng timer. Đây là giới hạn phục hồi best effort cố định trong Desktop/Server, **không phải** setting theo dõi 48 giờ và không thay `tracking_until` của lượt đã đăng ký; không thêm migration, setting, connection hay API Zalo.

Lookup ghép chính xác operationId/campaign/account, kiểm tra tenant/owner/UID/revision/người nhận; dùng expression index `auto_campaign_engagement_operation`. `missing` không chứng minh rollback nhưng chỉ retry trong hạn 5 phút. `found` trong hạn chuyển sang đăng ký; `invalid` do mất ownership/đổi UID/detail bị xóa thì dừng operation. Không gửi lại Zalo, INSERT lại detail hay tăng quota khi phục hồi engagement. Nguồn đã thực sự commit cùng detail vẫn giữ pending marker DB để lần phục hồi nguồn sau có thể đăng ký.

Sự kiện có một lượt xử lý ngay cho các watch đã đăng ký. Nếu đang chờ operation cùng người nhận, journal giữ thêm danh sách operation cần đối chiếu; mỗi operation đăng ký xong cho phép phát lại cùng timestamp cho watch mới. Operation còn mơ hồ chỉ giữ phần đối chiếu của chính nó, không khóa cả người nhận và không lặp RPC liên tục cho sự kiện đã xử lý. Source recovery dùng cùng backoff/cap journal như queue hiện tại.

RAM queue tối đa 10.000 mục hoặc 16 MiB/process (kể cả staging); tổng journal tối đa 128 MiB; cache metadata LRU tối đa 100.000 lượt hoặc khoảng 64 MiB metadata ước lượng. Các giới hạn này không phải trần RSS của toàn Electron/SDK. Vượt giới hạn hoặc lỗi đĩa tăng counter/cảnh báo suy giảm, không tăng bộ nhớ vô hạn; có thể mất sự kiện chưa lưu được.

Retry cùng dữ liệu theo 1, 5, 15, tối đa 60 giây; không đổi timestamp fallback. Logout/đổi owner ngừng ghi của scope cũ, callback trước đó không được chuyển sang login mới. Chỉ scope đang hoạt động được tính vào ngưỡng đủ lô và lịch retry; backlog của owner đã đăng xuất giữ trong journal để phục hồi khi đăng nhập lại, không kéo timer xuống 1 ms hoặc duy trì timer lúc hết việc. Legacy Server tải credential owner bằng client HTTP hiện có vào RAM process sau admission; refresh khi RPC báo auth invalid, xóa khi runtime stop. Không đưa credential xuống UI, socket hoặc journal.

### Tenant Chat

Dùng `chat_zalo_runtime_event` hiện có, thêm engagement state/revision/payload tối thiểu/lease/next-attempt/attempts. Projection xong mới stage engagement **cùng UPDATE acknowledgement**, kiểm tra binding generation/UID/owner còn khớp. Sau UPDATE thành công mới đánh thức worker; nếu worker đang chạy thì giữ số phiên bản thông báo để không mất lượt đánh thức. Không lấy dispatcher realtime có thể bỏ sự kiện khi bận làm đường ghi duy nhất.

Kiểm tra revision dùng `chat_zalo_runtime_event.occurred_at`: thời điểm runtime nhận envelope lần đầu, giữ nguyên qua retry và chép từ raw parent sang child. Không dùng `created_at` của child vì đó là lúc chuẩn hóa, có thể sau lần tắt/bật. Cả acknowledgement lẫn giải quyết `waiting_config` so sánh trực tiếp `timestamptz` trong DB, giữ microsecond. Timestamp nguồn Zalo được lưu riêng ở `engagement_occurred_at` để đối chiếu cửa sổ watch: tin lịch sử mới nhận sau lần bật vẫn được xét theo thời gian nguồn, còn backlog nhận trước lần bật bị loại. Dùng cột sẵn có, không thêm schema/query/connection.

Registration và bước giải quyết `waiting_config` chạy nền với advisory transaction lock theo tenant/account/UID/người nhận. Acknowledgement chỉ gọi `pg_try_advisory_xact_lock` trong UPDATE hiện có: nếu khóa bận thì vẫn hoàn tất projection, bỏ metadata engagement của event đó. Nếu lấy được khóa, hai thứ tự commit vẫn được đối chiếu như trước. Không chờ khóa tương tác để bảo toàn dấu; không thêm request, connection hoặc pool. `revision()` và stage chỉ đọc cache đồng bộ, đọc cấu hình chậm không giữ ACK hay lệnh gửi.

Worker hiện tại dùng lease 60 giây, retry/backoff, nguồn pending và inbox durable. Sau restart, nếu claim rỗng nhưng vẫn còn pending đang đợi lease/next-attempt, chính query claim trả thời điểm có thể xử lý tiếp. Worker hẹn lại một timer (1–60 giây; sàn 1 giây tránh vòng lặp dày khi hàng đang bị khóa), không cần event mới. Hàng đợi thực sự rỗng thì dừng timer. Event mới có thể kéo lịch sớm hơn theo deadline/batch của nó, nhưng không đẩy deadline cũ về sau. Khi cache config hết hạn/lỗi, metadata đã khớp RAM và revision gần nhất đang bật được giữ `waiting_config`; cold config chưa từng bật vẫn bỏ metadata mới. Cả hai trường hợp đều cho Chat hoàn tất projection ngay. Khi đọc được config, một truy vấn giới hạn theo batch vừa giải quyết mục chờ cấu hình vừa loại revision cũ; kiểm tra lại binding generation/UID/owner trước khi chuyển sang `pending`. RPC đăng ký không đối chiếu các mục còn `waiting_config`. Không thêm roundtrip cho đường xử lý lô bình thường. Giữ metadata inbox qua retention hiện có (`WORKER_EVENT_PROCESSED_RETENTION_HOURS`, mặc định 168 giờ/7 ngày) để đối chiếu đăng ký đến sau; không mở rộng thành kho lịch sử riêng. Cleanup không xóa mục pending/waiting_config còn trong retention; quá retention hoặc offline chưa nhận event không có đảm bảo bù đầy đủ. Direct SQL worker không có JWT PostgREST: truy vấn RPC lấy credential owner trong SQL hiện có, không đưa password ra JavaScript/log. Tái sử dụng Kysely pool; không tạo pool/process/replica mới.

## Giao diện và xuất dữ liệu

Desktop/Web dùng `aka_agent_list_campaign_details_page_v2`; v1 giữ nguyên tương thích. RPC lọc/count trước phân trang, chỉ lấy payload đầy đủ cho trang cần hiển thị. Bộ lọc: tất cả, đã xem, đã phản hồi, đã thả cảm xúc, đã kết bạn, chưa ghi nhận. “Chưa ghi nhận” chỉ gồm dòng đã đăng ký mà **cả bốn dấu đều NULL**, bao gồm cả dòng đã hết hạn chưa có dấu.

Cột Tương tác Zalo để trống khi không có dấu: không hiển thị “Không áp dụng”, “Không theo dõi”, “Chưa ghi nhận” hoặc “Hết thời gian theo dõi”. Chỉ hiện Đã xem/Đã phản hồi/Đã thả cảm xúc/Đã kết bạn cùng thời điểm; có dấu thì giữ dấu lịch sử dù hết hạn. Bộ lọc “Chưa ghi nhận” vẫn hoạt động; tooltip cho biết deadline. Excel xuất toàn bộ kết quả theo bộ lọc, thêm bốn timestamp và “Theo dõi đến”. Dùng refresh/polling UI hiện có, không thêm timer riêng.

## Vận hành và rollout

Metrics Desktop gồm received/filtered/coalesced/updated, backlog/oldestAgeMs, retry/overflow/journalErrors/rpcMs và `recoveryExpired` (số nguồn bỏ vì hết hạn phục hồi). Chat gồm received/filtered/updated/retry/rpcMs và backlog/oldestAgeMs (lấy mẫu tối đa mỗi 60 giây khi có hoạt động). Không log nội dung hội thoại. Theo dõi đồng thời CPU DB, lock/pool wait, RSS process, tuổi backlog và tốc độ Chat.

Trình tự khi được yêu cầu triển khai: **DB v339 → Chat worker/runtime và Server → Desktop/Web**. Giữ `enabled=false` cho đến khi consumer và kiểm chứng tải staging phù hợp hoàn tất. Không bulk-push migration khác; v340 là công việc riêng. Bản DB thay bảng/cột/RPC nên cần schema cache reload và kiểm tra HTTP API sau apply. Trước apply đọc lại checksum live; drift thì dừng để audit, không ghi đè.

Rollback vận hành trước tiên là tắt setting; không xóa dữ liệu tương tác. Có thể quay runtime/UI về bản cũ trong khi giữ schema thêm mới/v1. Nếu cần gỡ DDL phải tạo kế hoạch riêng sau khi mọi consumer đã quay về bản tương thích.

Benchmark local là phép đo cô lập, không phải bảo đảm capacity production. Cần đo staging lâu hơn với phân bố account/người nhận, HTTP latency, pool contention và projection Chat thực tế trước khi bật. Chi tiết số đo và trường hợp nóng không đạt trong [audit](ZALO_CAMPAIGN_ENGAGEMENT_V339_AUDIT.md).
