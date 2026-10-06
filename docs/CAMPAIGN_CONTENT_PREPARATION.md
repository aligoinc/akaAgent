# Chuẩn bị nội dung và xoay mẫu theo data

Trạng thái: **đã chuẩn bị code và migration, chưa apply production/phát hành**. Hai repo dùng nhánh `codex/campaign-content-preparation`: akaAgent và akaAgentChatApi.

## Quy tắc

`auto_campaigns.content_rotation_indexes[actionCode]` phân mẫu lần đầu cho data mới; `auto_campaign_input_data.content_rotation_indexes[actionCode]` giữ mẫu kế tiếp của chính dòng data đó. Khóa data là PK `auto_campaign_input_data.id`, không phải `input_id` hoặc UID/SĐT. Data 1/2/3 với A/B/C bắt đầu A/B/C, rồi B/C/A. Đổi thứ tự, khung giờ, reset trạng thái và restart giữ vị trí. Một data bị chặn trước chuẩn bị không gọi RPC.

Mỗi lần chuẩn bị lấy/tăng vị trí ngay. Gửi lỗi vẫn tiêu thụ mẫu; lỗi/response mất khi gọi RPC dừng lần gửi, không retry RPC hoặc dùng mẫu đầu. Một mẫu (hoặc không có biến thể chữ) không gọi RPC. Khi sửa danh sách mẫu, dùng modulo số mẫu hiện tại. Xóa rồi tạo lại data ID mới được coi là data mới; materialize lại danh sách sinh nhật/gợi ý bạn bè cũng theo quy tắc này.

Hành động không có data dùng con trỏ chiến dịch. Zalo share lấy một mẫu cho cả batch, không tạo cursor riêng người nhận. Các hành động dùng action code nghiệp vụ riêng, ví dụ `fb_post_page`, `fb_comment`, `zalo_message_stranger`, `zalo_add_friend`, `email_send`. Profile/Page lần đầu kế thừa `extra_settings.contentRotationIndex` cho đúng action đăng bài. Cursor cũ chỉ còn phục vụ workflow/runtime legacy.

Clone hiện đã insert theo danh sách cột cấu hình, nên hai cột mới nhận `{}` mặc định; scalar legacy Profile/Page cũng đã reset khi clone. Mapper/form/update/reset không ánh xạ hay ghi hai cột mới. Không cần sửa form hoặc reset SQL. SMS/gọi SIM không chuyển sang pipeline mới.

## Runtime

`src/shared/campaignContentPreparation.ts` đảm bảo một lần allocation → chọn một bundle chữ/media/subject → render/rewrite → kiểm tra hủy. Desktop/Server dùng adapter trong `campaignScheduler.ts` và Supabase HTTP client hiện có. Chat dùng cùng mã nguồn core/template/spin ở `packages/runtime-protocol`, `CampaignRuntimeRepository.takeContentIndex` và pool nghiệp vụ hiện có. Smoke so sánh bản shared giữa hai repo để phát hiện lệch; sửa shared phải đồng bộ cả hai bản.

Nguồn nội dung luôn là snapshot trên campaign. Không truy vấn kho mẫu/nhóm mẫu khi gửi. Đọc nguồn Facebook, kiểm tra quota/opt-out/exclusion, tìm người nhận và gửi vẫn ở luồng cũ. RPC kết thúc trước media/AI. Spin/cá nhân hóa xử lý một lần; HTML/rich text giữ adapter theo kênh, Zalo opt-out footer và Email không rewrite HTML giữ nguyên. AI lỗi dùng nội dung đã render; hủy không gửi. Mỗi bình luận gọi chuẩn bị riêng; các bước nhập chữ/đính kèm media dùng cùng kết quả.

`helpers.prepareCampaignContent` là optional. V351 đánh dấu `default_variables.campaignContentPreparationVersion=1` trên 36 workflow chuẩn/test. Runtime mới đọc flag trước khi dựng biến để hoãn chọn mẫu/media và chỉ cung cấp helper cho workflow đã chuyển. Block mới có helper dùng nhánh mới; app cũ thiếu helper giữ trọn nhánh cũ. Runtime mới gặp workflow cũ cũng giữ nhánh cũ. Luồng Zalo share nằm trong scheduler, dùng pipeline mới khi nâng runtime.

Để thêm hành động: gọi chuẩn bị sau claim và các gate, truyền action code đúng (`actionCode` được helper nhận trực tiếp), chọn nguồn snapshot/kind phù hợp và chuyển kết quả sang các bước gửi. Không gọi lại cho bước đính kèm/chờ xác nhận của cùng lần gửi. Không tự thêm cursor vào extra settings, lấy theo số thứ tự vòng lặp hoặc xử lý spin/AI lần nữa. Với Chat, giữ DB ở repository, không import database vào runtime/ZCA.

## Migration và kiểm chứng

V350 thêm hai cột JSONB (constant default `{}`, CHECK object `NOT VALID` để không quét toàn bảng cũ) và RPC mới:

`public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)`

Source: signature/tên chưa tồn tại trên linked **akachat `cgjbsmqtfhqvttudyjzq`**, đã lưu trong `migrations/snapshots/campaign-content-v350/source.json`. Không replace RPC cũ. Preflight kiểm tra absence và checksum dependency serializer `74c082aacb1de27a8cedff2e824f219f`, canonical input guard `6c656e83c8b38ccea75bcc8f7d81ffed`. Target `pg_get_functiondef` MD5: `006a6da075ede4e9c6b07194422f65c9`; owner `postgres`, SECURITY DEFINER, VOLATILE, search path `pg_catalog, public`. PUBLIC không có EXECUTE; cấp riêng anon/authenticated/service_role/aka_agent_chat_api. Receipt cô lập lưu đủ attrs/ACL.

RPC xác minh staff active/tenant, campaign/account, trạng thái active/login, parent claim target/token và unit token; Desktop cần trạng thái running, Server giữ cơ chế hoàn tất unit đã claim khi soft-pause; input phải đang chạy, cùng campaign, nằm trong unit. Thứ tự khóa theo claim hiện có: staff → entitlement barrier → campaign-input serializer → input → campaign/account. Không thay lifecycle/quota/entitlement RPC, không tăng pool/connection và không giữ transaction khi render/gửi. Các trigger live được lưu trong `triggers.json`: cập nhật cursor không kích hoạt trigger `UPDATE OF` lifecycle; canonical input guard cho phép thay trường này. Không ghi `updated_at`, không đổi hash cấu hình.

V351 kiểm tra đúng target RPC V350 trước khi chỉ sửa dữ liệu 14 block và 36 workflow từ snapshot live. Mỗi row có checksum fail-closed; generator `scripts/build-campaign-content-block-migration.py` kiểm tra đúng đoạn source trước khi thay. `targets.json` lưu checksum code đích. V351 không DDL/reload schema. V350 có thay metadata API nên cần reload.

Lệnh kiểm chứng (không gửi khách thật):

```bash
AKA_CHAT_REPO=/path/to/akaAgentChatApi node scripts/campaign-content-rpc-smoke-test.cjs
AKA_CHAT_REPO=/path/to/akaAgentChatApi node scripts/campaign-content-preparation-smoke-test.cjs
node scripts/facebook-page-content-rotation-smoke-test.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
npm run build:server
# akaAgentChatApi
npm test
npm run typecheck
npm run build
```

RPC smoke dùng PGlite trong RAM, dựng dependency/row live và apply V350/V351 trong transaction kết thúc ROLLBACK. Bao phủ 3×3, reorder/skip, action/batch isolation, seed/modulo/reset, ownership, quyền Chat, canonical guard, hash cấu hình và checksum. PGlite không thay thế kiểm thử cạnh tranh nhiều session trên PostgreSQL production. Service/VM smoke và test Chat dùng adapter giả lập; không kiểm chứng DOM Facebook hoặc giao tin Zalo/Email thật.

## Thứ tự triển khai riêng

1. Trước apply, xác minh lại project ref và checksum live; dừng nếu row/function khác snapshot. Apply riêng V350, xác minh signature/owner/ACL/target hash và HTTP RPC sau schema reload. Không bulk push migration khác.
2. Apply V351 bằng đường data-only không tạo DDL phụ để ghi history; xác minh block hashes/default flag. Không yêu cầu reload schema lần nữa.
3. Phát hành Desktop/Server và deploy Chat worker đã cập nhật. App cũ tiếp tục hành vi cũ; chỉ runtime mới bảo đảm xoay theo data.
4. Nếu cần quay về runtime cũ, giữ hai cột mới/cursor. Muốn khôi phục block phải guard target hash rồi dùng source snapshot; không drop cột chứa lịch sử xoay trong rollback thông thường.

Không apply/deploy/release trong task này.

## Kết quả local 06/10/2026

- RPC/blocks trên PGlite: PASS, kết thúc ROLLBACK; checksum, quyền Chat, Server soft-pause và các trường hợp xoay mẫu đều qua.
- Service/VM/shared parity, legacy Fanpage/Page Inbox, Zalo rich share/opt-out/engagement không chặn và campaign failure cleanup: PASS.
- akaAgent: hai typecheck PASS, build Desktop và build Server PASS. Build hai sản phẩm tuần tự vì electron-vite dùng chung tên file config tạm theo millisecond.
- akaAgentChatApi: typecheck/build PASS; toàn bộ 96 file / 1.485 test PASS. Lần đầu một test DB cũ timeout 5s khi chạy chung build; test đó và lần chạy lại toàn bộ đã qua.
- Không chạy gửi thật, không apply production và không phát hành bộ cài.
