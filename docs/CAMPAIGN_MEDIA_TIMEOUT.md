# Campaign media bị kẹt — Desktop và App Zalo Server

Bản sửa ngày 05/10/2026 áp dụng cho Zalo Local/QR trên Desktop và ứng dụng
Zalo Server Windows trong repo akaAgent. Hai sản phẩm dùng chung runtime và
scheduler. Chat Sync có bản sửa riêng trong akaAgentChatApi; cập nhật repo này
không thay bản đang chạy của Chat Sync.

## Xử lý

`CampaignMediaExecution` bao chuỗi SDK gửi attachment bằng AsyncLocalStorage.
Khi hết hạn, hủy HTTP đang chạy, gỡ callback upload và chặn request tiếp theo của
chính lệnh cũ trước khi trả lỗi `campaign_media_timeout`. Callback `file_done`
đến muộn không được gửi tin. Giữ listener khỏe để người tiếp theo dùng lại.

Runtime giữ deadline hiện có: 90 giây với ảnh, 180 giây với video/tệp phải chờ
callback. Chuẩn bị listener vẫn có hạn riêng hiện có. Media nguồn cloud được tải
qua resolver trước bước gửi với hạn 60 giây hiện có; lỗi nguồn giữ policy pause.
Wrapper dùng fetch đang có trên API context, bảo toàn node-fetch/proxy và signal.
Không thay global fetch. Gửi thủ công, text-only và Zalo Web không bật scope mới.

Kết quả timeout không xác nhận Zalo chưa nhận tin. Scheduler kết thúc input,
không gửi lại kể cả policy có detail_status NULL, bỏ các helper Zalo còn lại của
input qua `stopRemainingActions`. Lỗi vẫn đi qua policy theo action/raw code rồi
`err_zalo_api_business_failed`; khi được tính lỗi thì dùng bộ đếm và ngưỡng
`err_undefined` hiện có. Không hardcode bốn lần hay thêm bộ đếm. Timeout sau phần
chữ đã gửi được ghi partial failure, giữ chẩn đoán và quyền tính lỗi của policy.

Share ghi detail/input và đếm timeout ngay sau mỗi lệnh media. Đủ ngưỡng hoặc
policy yêu cầu dừng thì không gửi cho người tiếp theo; các input chưa bắt đầu
được giữ pending và vẫn nằm trong bằng chứng cleanup. Thành công ngắt chuỗi lỗi
theo thứ tự gửi; tổng kết không đếm lại timeout hoặc reset bằng thành công cũ.
Reset trước lần đếm tiếp theo phải thành công; lỗi DB thoát sang cleanup hiện có,
không gọi lại policy/gửi lại. Batch chỉ có timeout dưới ngưỡng tiếp tục được;
lỗi share khác giữ quy tắc batch cũ. Nếu đã dừng, không forward phần chữ; người
đã nhận media có kết quả partial và không retry.

Quyết định dừng trong vòng media được giữ riêng với quyết định dừng ở tổng kết.
Khi media đã làm dừng, các lỗi trước đó vẫn được ghi detail/input nhưng không áp
thêm policy hay tăng bộ đếm làm ghi đè trạng thái và lý do đã dừng. Nếu vòng media
chưa dừng, tổng kết batch thường vẫn đếm các lỗi đủ điều kiện như trước, kể cả
khi policy của một lỗi thường đã yêu cầu dừng; timeout đã ghi không được đếm lại.

Hủy/thay phiên khi đang gửi đóng scope với `command_result_unknown`; scheduler
không retry input đó và dừng campaign. Lifecycle shutdown/handoff vẫn ưu tiên
đường dừng hiện có. Không tạo connection, SQL pool, worker, timer polling hoặc
migration; giữ nguyên RPC claim/settle/cleanup và policy đang cấu hình.

## Kiểm chứng và phát hành

`node scripts/campaign-media-timeout-smoke-test.cjs` dùng SDK zca-js đang cài
thật cho upload, chờ file_done, checksum, encryption và gửi, với toàn bộ HTTP
được thay bằng fixture đóng. Bao phủ Local/Server, friend/group, callback muộn,
hủy HTTP, người gửi kế tiếp, invalidation, proxy; share ngưỡng 4/2, streak có sẵn,
thành công xen kẽ, policy không detail/không đếm, lỗi DB và downstream của normal.
Các ca hồi quy giữ trạng thái/lý do dừng khi có lỗi media thường trước timeout,
giữ bộ đếm cho batch chữ/media thường có policy dừng, và timeout dưới ngưỡng
kèm lỗi thường đều chạy cho Local/Server, friend/group.
Không đăng nhập, gọi DB hoặc gửi Zalo thật.

Chạy hai typecheck, build Desktop/Server và smoke hồi quy share, cleanup, policy,
auxiliary, opt-out, engagement và khôi phục session. Sửa fixture smoke empty-share
để có `sendExclusionLabels` như scheduler hiện tại; không đổi logic empty-share.

Chưa đóng gói hoặc phát hành installer; cần cập nhật riêng Desktop và app Server
để nhận bản sửa. Không giải phóng tùy tiện lease/lệnh đã treo của phiên cũ.
