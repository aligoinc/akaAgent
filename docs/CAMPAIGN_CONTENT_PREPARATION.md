# Chuẩn bị nội dung và xoay mẫu theo data

Trạng thái: **V350/V351 đã apply production akachat ngày 06/10/2026; không apply lại**. PR akaAgent #465 và Chat #87 đã merge. Chat worker đã deploy ngày 06/10/2026 lúc 17:24 Việt Nam từ commit `785ba56`. Bốn bộ cài 8.1.0 đã build local; đã đối chiếu log Desktop 8.1.0 và Server cập nhật ngày 06–07/10/2026.

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

## Thứ tự triển khai

1. Trước apply, xác minh lại project ref và checksum live; dừng nếu row/function khác snapshot. Apply riêng V350, xác minh signature/owner/ACL/target hash và HTTP RPC sau schema reload. Không bulk push migration khác.
2. Apply V351 bằng đường data-only không tạo DDL phụ để ghi history; xác minh block hashes/default flag. Không yêu cầu reload schema lần nữa.
3. Phát hành Desktop/Server và deploy Chat worker đã cập nhật. App cũ tiếp tục hành vi cũ; chỉ runtime mới bảo đảm xoay theo data.
4. Nếu cần quay về runtime cũ, giữ hai cột mới/cursor. Muốn khôi phục block phải guard target hash rồi dùng source snapshot; không drop cột chứa lịch sử xoay trong rollback thông thường.

Các bước DB/worker đã hoàn tất; xem audit bên dưới và [audit worker](https://github.com/aligoinc/akaAgentChatApi/blob/dev/docs/DEPLOY_CAMPAIGN_CONTENT_ROTATION_20261006.md) để đối chiếu image và rollback.

## Kết quả local 06/10/2026

- RPC/blocks trên PGlite: PASS, kết thúc ROLLBACK; checksum, quyền Chat, Server soft-pause và các trường hợp xoay mẫu đều qua.
- Service/VM/shared parity, legacy Fanpage/Page Inbox, Zalo rich share/opt-out/engagement không chặn và campaign failure cleanup: PASS.
- akaAgent: hai typecheck PASS, build Desktop và build Server PASS. Build hai sản phẩm tuần tự vì electron-vite dùng chung tên file config tạm theo millisecond.
- akaAgentChatApi: typecheck/build PASS; toàn bộ 96 file / 1.485 test PASS. Lần đầu một test DB cũ timeout 5s khi chạy chung build; test đó và lần chạy lại toàn bộ đã qua.
- Các kết quả local trên được ghi trước apply; không chạy gửi thật hoặc phát hành bộ cài.

## Audit production 06–07/10/2026

Đích: **akachat `cgjbsmqtfhqvttudyjzq`**. Hai migration dưới đây đã apply; **không apply lại khi merge PR hoặc phát hành app**.

| Migration | History UTC | Thời gian Việt Nam |
|---|---|---|
| V350 — hai cột JSONB và RPC | `20261006101341 / migration_v350_campaign_content_rotation` | 17:13:41, 06/10 |
| V351 — 14 block, 36 workflow | `20261006101435 / migration_v351_campaign_content_blocks` | 17:14:35, 06/10 |

- RPC: `public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)`. Function chưa tồn tại trước V350; MD5 `pg_get_functiondef` sau apply và lần đọc lại 07/10: **`006a6da075ede4e9c6b07194422f65c9`**. Owner `postgres`, SECURITY DEFINER, VOLATILE, `search_path=pg_catalog, public`; EXECUTE cho owner/anon/authenticated/service_role/aka_agent_chat_api, không cấp PUBLIC. Không đổi body/ACL của các RPC có sẵn.
- Lần apply V350 đầu bị deadlock và đã rollback toàn bộ. Bản SQL trong repo bổ sung lấy cả hai khóa DDL theo thứ tự input → campaign bằng NOWAIT, nhả khóa khi bận rồi thử lại tối đa 20 lần, nghỉ 50 ms/lần. Đây là giới hạn retry **khi triển khai**, không thay quy tắc không retry RPC cấp mẫu của runtime. Không tăng connection/pool.
- SHA-256 V350 đã dùng: `eccc9e80763f53dfe088a378b897badd667b7d5e4a37cfdcc8e0cd51eeb9d1ef`. V351 giữ nguyên SQL đã merge, MD5 file/history `3d712a04a5ee21cb500b2439cd5be505`. V351 chỉ ghi dữ liệu và history trong transaction, không DDL/reload schema.
- [Smoke rollback production](../migrations/tests/migration_v350_campaign_content_rotation_rollback.sql) đã PASS trước/sau apply: fixture tổng hợp, ID tường minh, không gọi sequence, luôn ROLLBACK. Bao phủ 3×3, reorder/skip, action/batch riêng, singleton, ownership, reset, seed/modulo và Server soft-pause. Management API không cho SET ROLE worker; thực thi role `aka_agent_chat_api` được kiểm chứng trên PGlite, production chỉ xác minh ACL/quyền EXECUTE.
- Data API sau apply: đọc hai cột trả HTTP 200; gọi RPC với tham số âm trả đúng HTTP 400 / `campaign_content_invalid_arguments`. Checksum 14 block và flag của 36 workflow đúng target; dependency serializer/canonical guard không thay đổi. Snapshot nguồn/target phục vụ smoke đã có trong [campaign-content-v350](../migrations/snapshots/campaign-content-v350/).
- Chat worker deploy 17:24 ngày 06/10, commit `785ba56`; [image, kiểm chứng và rollback](https://github.com/aligoinc/akaAgentChatApi/blob/dev/docs/DEPLOY_CAMPAIGN_CONTENT_ROTATION_20261006.md). Bốn bộ cài 8.1.0 đã build local. App cũ giữ nhánh legacy.
- Kiểm tra chỉ đọc sáng 07/10, dữ liệu đến 09:15 Việt Nam: 1.979 nội dung Zalo Desktop/Server/Chat và 153 lần chuẩn bị Facebook khớp mẫu; 1.988 con trỏ khớp ở các dòng đủ điều kiện đối chiếu. Campaign 12850 có 9 data chạy 11–12 lần, 94 chuyển mẫu liên tiếp đúng. Không phát hiện rỗng/gộp mẫu trong phần đối chiếu, hoặc lỗi allocator trong log DB 07:00–09:15. 102 bản AI có nội dung nhưng không so nguyên văn; 6 lần Chat bị chặn ở bước media nên chưa có lệnh gửi chữ. Lỗi gửi do người nhận chặn/selector Facebook vẫn được phân biệt với chọn mẫu. Đây là mẫu quan sát, không phải benchmark hay xác nhận mọi loại chiến dịch.

Nếu rollback runtime, giữ schema và cursor; không replay lệnh gửi hoặc xóa claim. Khôi phục block phải kiểm tra target checksum và dùng snapshot nguồn. Không gửi thử tới khách, apply migration hoặc deploy trong lần chốt hồ sơ này.
