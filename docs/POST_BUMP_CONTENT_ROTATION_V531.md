# Kiêm up tin Facebook: mỗi lượt up một câu khác nhau (V531)

## Lỗi

"Kiêm up tin" ở chế độ tạo mới sinh một chiến dịch up tin (`facebook_comment_seeding_post`, tên "Up tin cho chiến dịch … - <tài khoản>") cho mỗi tài khoản. Đăng bài xong, chiến dịch đăng nhóm chia N lượt up của bài lần lượt cho các tài khoản, mỗi lượt là một dòng data của chiến dịch up tin của tài khoản đó.

Từ 20/10/2026 workflow 207 lấy câu comment qua RPC `aka_agent_take_campaign_content_index` (V350). Mỗi chiến dịch có một con trỏ riêng (`auto_campaigns.content_rotation_indexes.fb_comment`) và mọi con trỏ đều bắt đầu từ 0. Mỗi bài thường giao cho mỗi tài khoản một lượt, nên các con trỏ tăng cùng nhịp và mọi tài khoản comment cùng một câu trên cùng một bài.

Số đo trên production (14/11/2026, chỉ đọc; 209 chiến dịch up tin chạy trong 3 ngày, 1.131 comment thành công):

| | Số bài | Mọi comment giống nhau |
|---|---|---|
| Lượt up chia cho ≥ 2 tài khoản | 213 | 127 (60%) |
| Mọi lượt up do 1 tài khoản | 95 | 2 |

Trong 99 chiến dịch up tin có nhiều câu, không chiến dịch nào chỉ dùng 1 câu: xoay vòng trong từng chiến dịch vẫn đúng. Ví dụ ngày 13/11: bài `…/posts/1630882828520555` được 3 tài khoản (chiến dịch 55155, 55154, 55156) cùng comment "Nhà đẹp quá em nhỉ", dù mỗi chiến dịch có 3 câu.

## Sửa

1. **Giao câu khi thêm lượt up** ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts) `enqueuePostBumpAfterGroupPost`, [postBumpContent.ts](../src/shared/postBumpContent.ts) `planPostBumpContentIndexes`). Lượt thứ i của một bài được giao câu số (con trỏ + i). Con trỏ nằm ở `extraSettings.postBumpContentRotationIndex` của chiến dịch đăng nhóm và tăng N sau mỗi bài. Câu đã giao ghi vào `auto_campaign_input_data.content_rotation_indexes.fb_comment` của dòng data. RPC V350 vốn đã dùng chỉ số ghi sẵn trên dòng data (mod số câu của chiến dịch up tin) và không đụng con trỏ của chiến dịch, nên RPC không phải sửa. Không mod ở Desktop vì các chiến dịch up tin có thể có số câu khác nhau.
2. **Quyền ghi cột** ([V531](../migrations/migration_v531_post_bump_content_rotation_desktop.sql)): chỉ `GRANT INSERT (content_rotation_indexes) ON auto_campaign_input_data TO aka_agent_desktop`. Desktop vẫn không có quyền UPDATE cột này. Preflight kiểm thân RPC đúng bản đang chạy (md5 `prosrc` = `df449a2b2eb195ddb3110edc4633ddfa`). GRANT không làm PostgREST nạp lại schema.
3. **Chưa apply V531 thì không hỏng** ([campaignInputContentRotation.ts](../src/main/data/campaignInputContentRotation.ts)): bị từ chối 42501 "permission denied" thì Desktop chèn lại dòng data không kèm cột này (hành vi cũ), và không thử lại cột này trong 10 phút. Lỗi RLS (cũng là 42501, nhưng câu báo là "row-level security") không được chèn lại.
4. **Đồng bộ "Nội dung up tin"** ([postBumpContentSync.ts](../src/main/services/postBumpContentSync.ts), gọi trong IPC `DB_UPDATE_CAMPAIGN`). Trước đây nội dung chỉ được chép sang chiến dịch up tin lúc tạo. Nay khi khách lưu chiến dịch đăng nhóm mà "Nội dung up tin" khác bản trong DB (bỏ qua khác biệt khoảng trắng ở hai đầu), nội dung mới được chép vào `content` và `extraSettings.commentContent` của các chiến dịch up tin đã tạo. Lịch sử chạy của cả hai bên ghi lại việc này.
   - Không đổi nội dung thì không ghi gì. Nội dung khách sửa thẳng trong chiến dịch up tin được giữ (production 14/11 có 4 chiến dịch như vậy, một chiến dịch có 3 câu trong khi nguồn chỉ có 1 câu).
   - Bỏ qua chiến dịch up tin đã xoá, khác loại, của nhân viên khác, hoặc đang dùng nội dung nâng cao.
   - Không đọc được bản cũ thì cũng không ghi gì.

Form tạo/sửa chiến dịch và form Agent giữ `postBumpContentRotationIndex` khi lưu; khi nhân bản thì con trỏ về 0. Sửa nhanh giữ nguyên `extraSettings` cũ nên không cần sửa.

## Giới hạn

- Số lượt up mỗi bài lớn hơn số câu thì chắc chắn có câu lặp; khi đó các câu được dùng đều nhau.
- Lượt up lỗi rồi chạy lại trên cùng dòng data thì lấy câu kế tiếp (hành vi V350), có thể trùng câu của lượt khác trên cùng bài.
- Lượt up đã xếp hàng trước khi khách cập nhật app vẫn theo con trỏ của từng chiến dịch.
- Mở form khi bộ lập lịch vừa tăng con trỏ thì lúc lưu con trỏ có thể bị ghi lùi (giống `postBumpRotationIndex`). Câu trong cùng một bài vẫn khác nhau.
- Chế độ "chọn chiến dịch có sẵn" cũng được giao câu, nhưng không đồng bộ nội dung (chiến dịch do khách tự quản lý).
- Web (V530, đang làm ở nhánh khác: soạn chiến dịch Facebook/Email từ Web) nếu dựng lại `extraSettings` khi lưu thì phải giữ `postBumpContentRotationIndex`. Muốn đồng bộ nội dung từ Web thì gọi cùng quy tắc trong `planPostBumpContentSync`.

## Thứ tự đưa vào dùng

1. Apply V531, kiểm sổ migration (md5 `statements[1]` = md5 file) và `has_column_privilege('aka_agent_desktop','public.auto_campaign_input_data','content_rotation_indexes','INSERT')` = true.
2. Phát hành Desktop. Nếu làm ngược thứ tự thì Desktop dùng cách chèn dự phòng ở mục 3.

Gỡ: [rollback_v531](../migrations/rollback_v531_post_bump_content_rotation_desktop.sql). Desktop có bản sửa sẽ quay về cách chọn câu cũ qua đường chèn dự phòng.

## Kiểm

`node scripts/post-bump-content-rotation-smoke.cjs` (10 nhóm; PGlite lấy từ `../akaAgentChatApi` hoặc `AKA_CHAT_REPO`). Bài kiểm:
- chạy đúng thân RPC đang chạy trên production (chụp ở `migrations/snapshots/post-bump-content-rotation-v531/source.json`);
- apply V531, apply lại thì bị từ chối, thân RPC lạ thì bị từ chối, rollback;
- chạy hàm thật `enqueuePostBumpAfterGroupPost` của bộ lập lịch;
- kiểm cách chèn dự phòng và dịch vụ đồng bộ.

Bỏ phần giao câu ở bộ lập lịch thì 2 nhóm kiểm bộ lập lịch FAIL. Chưa chạy trên Electron thật với Facebook thật.
