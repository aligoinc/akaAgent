# Điều kiện bỏ qua gắn tag và đổi tên Zalo

Các mục `Kiêm gắn tag Zalo` và `Kiêm đổi tên` dùng điều kiện riêng, mặc định tắt. Tag akaBiz và phạm vi hỗ trợ chế độ Share giữ nguyên.

## Cấu hình

Các trường tùy chọn trong `auto_campaigns.extra_settings`:

| Trường | Ý nghĩa |
| --- | --- |
| `zaloTagSkipIfFriend` | Bỏ qua gắn tag nếu API xác nhận đã là bạn bè |
| `zaloTagSkipIfHasSelectedTags` | Bật điều kiện có tag trong danh sách bỏ qua |
| `zaloTagSkipTagIds` | Danh sách nhiều ID tag Zalo; có một tag là đủ để bỏ qua |
| `zaloTagSkipTagNames` | Tên tag dùng để lưu/khôi phục cấu hình giao diện |
| `zaloAliasSkipIfFriend` | Bỏ qua đổi tên nếu API xác nhận đã là bạn bè |
| `zaloTagSettingsByAccountId` | Cấu hình tag theo ID tài khoản automation: mỗi phần tử chứa `zaloTagId`, `zaloTagName`, `zaloTagSkipTagIds`, `zaloTagSkipTagNames` |

Tag cần gắn vẫn là một tag trong `zaloTagId`. Hai điều kiện gắn tag kết hợp OR; chúng không bỏ qua gửi tin, kết bạn hoặc thao tác đổi tên. Khi API không trả trạng thái bạn bè thì vẫn thực hiện thao tác phụ. Gửi lời mời kết bạn không được coi là đã thành bạn bè.

Form có mục **Tài khoản cấu hình tag** gồm các tài khoản chính được chọn và tài khoản phụ (nếu có). Mỗi tài khoản chọn riêng tag cần gắn và danh sách loại trừ; hai checkbox điều kiện dùng chung. Chỉ tải danh sách của tài khoản đang mở, không tự ghép tag theo tên. Trước khi lưu, mọi tài khoản phải có tag cần gắn; nếu bật điều kiện danh sách tag, mỗi tài khoản phải chọn ít nhất một tag loại trừ.

Giao diện gom mỗi thao tác phụ vào một khối. Tài khoản và **Tag cần gắn** nằm trước điều kiện bỏ qua; một nút **Tải tag** cập nhật cả tag cần gắn và tag loại trừ. **Tag cần bỏ qua** hiển thị dạng các ô chọn gọn, có số lượng đã chọn; khung hẹp tự xuống dòng. Khối đổi tên đặt điều kiện bạn bè ngay dưới mẫu tên, giữ nút cá nhân hoá tại trường nhập. Hai tiêu đề điều kiện có chữ đậm, nền tím nhẹ và viền trái; mỗi checkbox điều kiện nằm trên một dòng riêng ở cả nền sáng/tối.

Khi tạo nhiều chiến dịch, mỗi payload chỉ giữ map của chính tài khoản đó và tài khoản phụ của nó. Các trường tag phẳng vẫn phản chiếu tài khoản chính để tương thích. Runtime chọn cấu hình bằng ID tài khoản thực hiện, không dùng ID tài khoản chính làm fallback khi đã có map; thiếu/malformed/chưa đủ cấu hình thì chỉ bỏ qua gắn tag, ghi tiến trình và tiếp tục thao tác khác. Campaign cũ hoàn toàn thiếu map vẫn dùng hành vi phẳng cũ.

Mở sửa/nhân bản/bản nháp cũ chỉ chuyển tag phẳng sang tài khoản chính gốc, không sao chép sang tài khoản mới hoặc phụ. Bản nháp mới lưu đầy đủ map, kể cả các chiến dịch tạm trong form tìm data. Chuyển giữa các tài khoản trong mục cấu hình giữ lựa chọn riêng; bỏ tài khoản khỏi chiến dịch xóa cấu hình của tài khoản đó. Lỗi tải tag hoặc kết quả của yêu cầu tải cũ không xóa/ghi đè lựa chọn đang lưu. Tên đã lưu vẫn hiển thị khi danh sách tạm thời trống hoặc offline.

## Runtime

`src/shared/zaloAuxiliaryActions.ts` ưu tiên `isFr`/`is_fr` từ raw profile/tìm SĐT trong lượt xử lý. Nếu một thao tác phụ đang bật điều kiện bạn bè và chưa có trạng thái rõ ràng, gọi `getFriendRequestStatus(uid)` bổ sung và đọc `is_friend` (không suy ra từ lời mời đang gửi/đã nhận). Desktop/App Server giữ promise theo tài khoản + UID trong helper của một input; Chat worker kiểm tra một lần trước hai thao tác phụ. Kết quả true/false/thiếu dữ liệu/lỗi đều dùng chung trong lượt đó, không cache sang input hay lượt chạy sau. Không dùng cờ `target.isFriend` mặc định hoặc trạng thái DB cũ. Nếu API lỗi/thiếu trạng thái, ghi một cảnh báo rồi tiếp tục theo cấu hình; dừng runtime, hủy lệnh và lỗi cần recovery vẫn phải chặn mutation.

`applyLabelToUser` dùng chính snapshot `getLabels()` hiện có để kiểm tra `label.conversations` trước khi cập nhật. Nếu khớp, trả `{ skipped: true, reason: 'excluded_tag', matchedLabelIds, matchedLabelNames }`; nếu không khớp, giữ kết quả label cũ. Không phát sinh thêm lần `getLabels()` để kiểm tra. Bỏ qua theo bạn bè diễn ra trước cả bước đọc tag.

Scheduler chỉ ghi tiến trình nêu lý do khi bỏ qua; không tạo detail thành công, không mirror tag contact, không tính quota/bad target. Lỗi đọc/gắn tag và đổi tên vẫn dùng error policy hiện tại. Không thêm migration, schema reload, pool hoặc timer.

Repo `akaAgentChatApi` giữ cùng contract thuần trong `packages/runtime-protocol/src/zaloAuxiliaryActions.ts`. Lệnh nội bộ chỉ đọc `get_friend_request_status` nhận `{ userId }`, trả nguyên trạng thái từ API qua adapter/supervisor, không đồng bộ metadata hay thay đổi quan hệ bạn bè. Payload nội bộ `apply_label` nhận thêm `skipLabelIds?: string[]`; system-worker nhận kết quả bỏ qua và không ghi detail/mirror. Adapter kiểm tra trong lần đọc tag hiện có, không gọi đồng bộ metadata khi bỏ qua.

## Kiểm chứng và thứ tự phát hành

- akaAgent: `node scripts/zalo-auxiliary-skip-smoke-test.cjs`, `node scripts/run-zalo-auxiliary-skip-ui-smoke.cjs`, hai typecheck, `npm run build`, `npm run build:server`.
- Chat API: test executor, supervisor, runtime-protocol và adapter; `npm run typecheck`, `npm test`, `npm run build`.
- Smoke chỉ dùng mock IPC/API, không thực hiện thay đổi Zalo thật.
- Khi phát hành: cập nhật các process Chat dùng runtime-protocol trước hoặc cùng runtime/adapter, rồi system-worker; cập nhật App Server, sau đó mới cung cấp Desktop có checkbox mới. Không tăng số replica hoặc chạy runtime thứ hai để rollout.
- Client/runtime cũ bỏ qua các trường mới và không hiểu map theo tài khoản. Cập nhật scheduler Desktop/App Server và worker Chat có resolver theo tài khoản trước khi phát hành form mới. Chỉ bật điều kiện trên chiến dịch sau khi runtime thực thi đã được cập nhật. Tài liệu này mô tả thay đổi và thứ tự phát hành, không xác nhận production đã deploy.

## Kiểm tra bổ sung khi API tìm SĐT thiếu trạng thái

Đã xác nhận từ log chiến dịch QR #17543 ngày 23/09/2026: response tìm SĐT có identity/gender nhưng không có `isFr`/`is_fr`; đây là lý do điều kiện bạn bè không bỏ qua. Người dùng đã cho phép thêm lượt kiểm tra dự phòng cho mọi loại chiến dịch hỗ trợ hai thao tác phụ. Không gọi thêm nếu API đã trả true hoặc false, checkbox tắt hay thao tác tương ứng tắt. Kiểm thử mock bao phủ sáu loại chiến dịch, lời mời đang chờ, lỗi API, cache trong cùng input, input mới và dừng giữa lúc đọc; không gửi hay thay đổi Zalo thật. Phải cập nhật Chat runtime/protocol có lệnh mới trước worker; bản Desktop/App Server phải có scheduler mới.
