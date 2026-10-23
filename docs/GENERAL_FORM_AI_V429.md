# AI Cài đặt chung cho mọi loại tài khoản — V429

**Cập nhật 24/10/2026:** Web đã được gắn vào config 14, prompt/schema/model V429 giữ nguyên. Ghi chú Web NULL bên dưới mô tả mốc V429 ban đầu; trạng thái mới và thứ tự rollback Web trước V429 xem [AI Cài đặt chung Web](GENERAL_FORM_AI_WEB.md).

## Hành vi

Cài đặt chung trên Desktop dùng AI cho Facebook, Zalo (QR, trình duyệt, Server), Email và SMS; Gọi tự động dùng nền tảng SMS. AI đổi tên và chọn tài khoản chính theo yêu cầu. Chạy bằng Page chỉ có hiệu lực với các loại chiến dịch Facebook vốn hỗ trợ Page. Năm section AI chuyên biệt còn lại giữ phạm vi Facebook.

Giữ config 14, code `app_facebook_form_general`, slot `campaign.facebook.general` và IPC cũ để tương thích. Tên hiển thị cấu hình là **Cài đặt chung chiến dịch**, scope `all`, danh sách action rỗng. Model Sol 6.1 ID 21, JSON Schema, template, timeout, options và bindings không đổi; Web/Mobile vẫn NULL.

## Hợp đồng

- Main đọc action đang bật/chưa xóa, lấy `flatform_type` từ DB và kiểm tra quyền theo nền tảng đó. General nhận action ID có giới hạn độ dài rồi kiểm tra catalog DB; các kind khác vẫn có allowlist Facebook. Renderer không chọn platform/model/prompt hoặc nới scope.
- Catalog tài khoản giao danh sách có thể chọn của form với staff/tổ chức/nền tảng/chưa xóa trong DB. Thêm ba cột vào truy vấn account hiện có; không thêm lượt đọc, pool, RPC, polling hoặc snapshot ngày/trạng thái.
- Zalo dùng `accountType=zalo_qr|zalo_web|zalo_server` từ hai cờ DB; realtime không nhận tài khoản trình duyệt. Nếu có tài khoản phụ, danh mục chính chỉ còn tài khoản khác ID và cùng loại Zalo. Thiếu tài khoản phụ trong catalog thì không cho đổi chính; vẫn sửa được tên.
- Catalog có `platform` và `allowPageIdentity`. Chỉ tải Page cho Facebook/action hỗ trợ. Các field Page bị khóa ở nền tảng khác; parser từ chối toàn bộ patch sai, không áp dụng riêng tên/tài khoản. Parser giữ chặn trùng chính/phụ và bật Page khi còn phụ.
- Form tiếp tục khóa tài khoản khi nguồn nhóm data yêu cầu; giữ giới hạn một tài khoản khi sửa hoặc có phụ. Hủy/deadline/phiên/flight chung, bảo toàn nội dung/media, Save validation và không tự lưu/chạy giữ nguyên.
- Prompt hỗ trợ catalog Desktop cũ thiếu hai cờ mới: chỉ dùng Page khi action Facebook và field Page không khóa; UID vẫn lấy từ catalog. Desktop cũ tiếp tục chỉ hiện General trên Facebook, cần code mới để mở nền tảng khác.

## Migration đã apply

Akachat `cgjbsmqtfhqvttudyjzq`, **23/10/2026 lúc 23:54:22 VN**:
`20261023164417 / migration_v429_general_form_ai_all_platforms`.

Canonical: [migration_v429_general_form_ai_all_platforms.sql](../migrations/migration_v429_general_form_ai_all_platforms.sql), khởi tạo bằng Supabase CLI rồi lưu theo quy ước V429. Transaction chỉ cập nhật name/prompt_system/scope/action IDs của config 14 cùng migration history. Guard toàn bộ hàng nguồn V428 trước ghi; không schema/RLS/RPC/reload PostgREST. **Không apply lại.**

| Kiểm tra | Giá trị |
|---|---|
| Config 14 trước, bỏ updated_at | `0fb5656a4b28aaba3eb1afcc992a84da` |
| Config 14 sau, bỏ updated_at | `1e7c3783de9f65165548bf1bdc7e2ebe` |
| Phần cấu hình giữ nguyên, trước/sau | `47fa535b443370a2c92bb0bd18b712bc` |
| Prompt system mới | `09c2d19b3c2013fe67171c86460924e7` |
| Prompt user giữ nguyên | `e74dcd6c0a4a6dc635b1f82acf32ee4c` |
| JSON Schema giữ nguyên | `843499cdd0558a329aa315d9dd14085b` |

Chín config khác giữ checksum toàn bộ hàng, gồm Nội dung vẫn Haiku 24. Snapshot/receipt trong [general-form-ai-v429](../migrations/snapshots/general-form-ai-v429).

## Kiểm chứng

- 179 contract/parser checks; Main service với catalog giả kiểm tra bốn nền tảng, voice/SMS, QR/browser/server, tenant/quyền/scope/model, tài khoản phụ, realtime, Page sai nền tảng, unknown action và giữ giới hạn DB. Các yêu cầu gửi kèm platform/model/prompt giả bị loại.
- Electron form thật: AI hiển thị/điền/lưu nháp trên sáu trường hợp nền tảng/loại Zalo, Page lỗi không thay đổi form, giữ phụ cả ba loại Zalo, bỏ phản hồi phiên cũ, metadata all/selected/tắt. Hồi quy sáu section Facebook và AI Nội dung đạt; không ghi chiến dịch tự động.
- **11/11 ca Sol 6.1 thật**: tám ca General đa nền tảng và ba ca Page với catalog kiểu Desktop cũ (hai từ chối vì có phụ, một chọn Page hợp lệ). Dữ liệu nhân tạo, không đọc tài khoản khách hàng hoặc ghi campaign/log production.
- SQL diễn tập forward/rollback, cố ý đổi dữ liệu để xác nhận guard cả hai chiều; rollback sau apply trong transaction rồi hoàn tác đạt. HTTP anon xác nhận prompt mới nguyên văn, model/schema/template/options/bindings giữ nguyên, metadata scope all và quyền các cột catalog (query ID -1, không đọc dữ liệu tài khoản thật).
- IPC flight/cancel/deadline/auth và general bốn nền tảng; hai typecheck và production build đạt. Build giữ cảnh báo dynamic/static import hiện có.

Commands chính:

```sh
node scripts/campaign-facebook-ai-smoke.cjs
node scripts/campaign-facebook-ai-service-smoke.cjs
node scripts/campaign-general-ai-http-smoke.cjs
node scripts/campaign-schedule-ai-smoke.cjs
node scripts/run-campaign-schedule-ai-ui-smoke.cjs --general-only
node scripts/run-campaign-schedule-ai-ui-smoke.cjs --facebook-only
node scripts/run-campaign-schedule-ai-ui-smoke.cjs --content-only
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

## Rollout và rollback

DB đã cập nhật; Desktop cần code mới và restart Main/preload khi chạy dev. Chưa đóng gói/phát hành. Không có thay đổi Web/API.

[rollback.sql](../migrations/snapshots/general-form-ai-v429/rollback.sql) khôi phục đúng bốn trường config 14 về V428, có guard prompt/scope/name và checksum phần giữ nguyên; không xóa history/log hoặc đụng config khác. Đã diễn tập, chưa rollback production. Muốn tắt cả sáu config cũ, chạy rollback V429 trước rồi dùng `facebook-form-ai-v428/disable-ai.sql`; không chạy guard V428 trực tiếp trên trạng thái V429.

`verify-before-apply.sql` chỉ dành snapshot trước apply. `verify-after-apply.sql` diễn tập rollback trên trạng thái V429 rồi ROLLBACK, xác nhận production vẫn áp dụng V429 và history còn nguyên.

## Sửa finding quyền loại tài khoản Zalo — 24/10/2026

Review tái hiện user chỉ có quyền QR gửi ID Server/trình duyệt trong `eligibleAccountIds`: Main trước đây chỉ kiểm tra entitlement Zalo chung, nên hai ID vẫn vào catalog và parser chấp nhận. `loadFacebookAiCatalog` nay dùng `loadCurrentUserZaloAccountCapabilities` và `canUseZaloAccountWithCapabilities` hiện có để lọc trước khi tạo cả `accounts` và `secondaryAccount`. Không tin danh sách ID từ renderer là bằng chứng quyền. Giữ quy tắc sản phẩm hiện có: quyền trình duyệt bao gồm QR; bản ghi đồng thời có cờ trình duyệt và Server bị từ chối.

Tài khoản phụ không có quyền không được đưa tên vào prompt; `hasSecondaryAccount` vẫn true, danh mục chính rỗng để giữ phụ và chặn đổi chính. Sửa tên vẫn được phép; patch chọn tài khoản bị chặn không áp dụng riêng tên. Bộ lọc chạy trên dữ liệu từ truy vấn hiện có và snapshot quyền trong phiên, không thêm lượt DB/RPC/polling/connection.

Service smoke bỏ mock `entitlementRepository`, chỉ mock current user và I/O. Đạt 8 tổ hợp capability, 32 ca chọn chính, 24 ca phụ; kiểm tra tên/ID ngoài quyền bị loại, subtype sai, patch atomic, đổi tên khi phụ bị hạn chế và số truy vấn giữ nguyên. Hồi quy 179 contract, IPC, hai typecheck và production build đạt. Không đổi DB/prompt/schema/model/options; không cần migration mới hoặc apply lại V429. Desktop cần restart Main khi chạy dev, chưa đóng gói/phát hành.
