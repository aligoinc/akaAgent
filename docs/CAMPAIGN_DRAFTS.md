# Nháp chiến dịch Desktop

## Hành vi và phạm vi

Form tạo mới/nhân bản có **Lưu nháp**, chỉ bắt buộc tên, hành động, tài khoản và ngày giờ gửi hợp lệ. Nội dung, data và tùy chọn được phép chưa hoàn thiện. Nháp hiển thị trong cùng bảng chiến dịch, có nhãn **Nháp** và thao tác mở sửa/xóa. Dùng chung tìm kiếm và bộ lọc tên, lịch, tài khoản, nền tảng, hành động; trạng thái **Nháp** chỉ thuộc UI. Chiến dịch đã tạo không có chức năng chuyển về nháp.

Danh sách đọc đủ các trang tóm tắt (50 bản/trang), chỉ mở một bản mới tải payload. Tải lại khi vào màn hình, bấm làm mới hoặc đóng form sau lưu/tạo nháp; không có polling riêng. Chiến dịch đang chạy vẫn trên cùng; nháp xen với chiến dịch chờ xử lý theo ngày gửi giảm dần. Ngày cập nhật không quyết định vị trí nháp.

Nháp thuộc riêng staff và organization. Lưu/xóa nháp không tạo campaign/input, không materialize nhóm data, không xóa media và không đăng ký scheduler. Xóa mềm dùng `is_delete`, `deleted_at`, `deletion_reason='user_deleted'`; chưa có thùng rác, tự động lưu hoặc dọn tự động. File local giữ cách tham chiếu hiện tại. Không thêm nháp vào campaign store, `CampaignStatus`, query hoặc polling chiến dịch thật.

## Cấu hình và mở rộng

- `src/shared/campaignDrafts.ts`: payload v1, kiểu API, kiểm tra tối thiểu và hàm bổ sung mặc định khi khôi phục.
- `useCampaignDraftField.ts`: đăng ký giá trị cấu hình và khôi phục bằng initializer của form. Snapshot gồm `formData`, data đang nhập, lựa chọn nội dung, nhóm data, liên kết, chiến dịch con và hai bộ nhớ nội dung thủ công.
- `cloneSourceCampaignId` giữ ngữ nghĩa nhân bản sau khi mở lại; reset chỉ số xoay nội dung/nguồn và giữ trạng thái tạm dừng theo luồng nhân bản hiện tại.
- Bảng `auto_campaign_drafts` chứa JSON payload, revision, owner, timestamps, metadata xóa mềm và `campaign_ids` ghi kết quả sau khi tạo xong. Không thêm cột theo từng cài đặt campaign.

Khi thêm field trong `formData`, khai báo mặc định tại form như hiện tại. Cấu hình ở state riêng dùng `useCampaignDraftField` để đăng ký lưu/khôi phục. Không lưu loading, tiến trình, modal đang mở, DOM/File object hay cache preview.

Field thiếu dùng mặc định mới; object được bổ sung đệ quy, array được giữ nguyên. Giá trị `false`, `0`, `''`, `[]`, `null` không bị ghi đè. Khi đổi tên/ý nghĩa field phải thêm bước chuyển phiên bản trước restore. App từ chối phiên bản không hiểu để tránh ghi mất dữ liệu.

Nháp tạo mới chưa chỉnh giới hạn gửi vẫn lấy mặc định của từng tài khoản. Nháp nhân bản giữ giới hạn của cấu hình gốc; tùy chỉnh theo hành động đã sửa được lưu trong snapshot.

## Tạo chiến dịch từ nháp

**Tạo chiến dịch** gọi `CampaignFormModal.handleSave`, cùng luồng tạo mới hiện tại:

1. Chạy đầy đủ validation và lưu snapshot mới nhất bằng revision hiện tại.
2. Tạo campaign/input, xử lý nhiều tài khoản, chiến dịch con, liên kết nguồn/đích và Data Group bằng các API chiến dịch hiện có. Giữ cơ chế chuẩn bị/kích hoạt của luồng này, bao gồm bundle Data Group hiện hữu.
3. Khi toàn bộ luồng tạo thành công, gọi `completeCampaignDraft` để ghi ID campaign chính/con và xóa mềm nháp với lý do `converted`. API này chỉ cập nhật metadata nháp, không tạo hoặc đổi trạng thái campaign.

Trong lúc xử lý, form dùng trạng thái bận và disable nút như tạo mới. Không có service chuyển đổi riêng, frozen plan, bảng outputs, batch receipts, conversion token, lease hoặc heartbeat 30 giây. Không còn nút “Tiếp tục tạo chiến dịch”. Lỗi tạo campaign/data giữ nháp để sửa; các campaign đã tạo xử lý như luồng tạo bình thường, không có phục hồi tiến độ riêng sau khi đóng app.

Nếu chiến dịch đã tạo xong nhưng ghi metadata nháp thất bại, UI báo rõ chiến dịch đã tạo thành công và đóng form; người dùng có thể xóa nháp còn lại. Revision guard giữ lại snapshot nếu nháp đã được sửa ở nơi khác. Kiểm tra credential/owner ở main và DB vẫn giữ; khóa transaction ngắn của thao tác lưu không phải lease suốt quá trình tạo.

## Migration và audit

Project: `cgjbsmqtfhqvttudyjzq` (akachat).

- v270 tạo hai bảng và hai function ban đầu; đã apply ngày 09/09/2026, history `20260909152941` / `v270_campaign_drafts`. Giữ migration này làm lịch sử.
- v271 `migrations/migration_v271_simplify_campaign_drafts.sql` đã apply ngày 10/09/2026 (giờ Việt Nam), history `20260909173127` / `v271_simplify_campaign_drafts`.
- v271 chuyển ID từ outputs vào `auto_campaign_drafts.campaign_ids`, bỏ bảng `auto_campaign_draft_outputs`, cột `conversion_plan`/`conversion_token`/`lease_until`, trigger và function guard riêng trên campaign. Không sửa campaign thật, unique index idempotency chung hoặc RPC Data Group.

Đã capture definition live trước khi dựng v271. Body live khớp v270, không có bản vá DB riêng; auth, owner/revision guards, signature, attributes và ACL không liên quan đều giữ nguyên. Preflight fail-closed theo checksum, đồng thời từ chối dọn nếu còn chuyển đổi chưa hoàn tất. Tại thời điểm apply có 3 nháp lịch sử, không có nháp đang chuyển đổi. Checksum payload/metadata nháp và toàn bộ campaign ID cũ khớp trước/sau apply.

| Exact signature | Source checksum | Target checksum (`md5(pg_get_functiondef)`) |
| --- | --- | --- |
| `public.aka_agent_campaign_drafts(bigint,bigint,text,text,text,uuid,jsonb)` | `d72679d619b36e8d075d3119fc6203fd` | `a943ffce5b3bb36020a3cf5c7f548b85` |
| `public.aka_agent_guard_unpublished_draft_campaign()` | `6747aabe1a6134387b48945870db8029` | Đã bỏ function và trigger |
| `public.auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` | Không đổi |

RPC vẫn owner `postgres`, SECURITY DEFINER, VOLATILE, `search_path=pg_catalog, public`, timeout 60s, ACL postgres/anon/authenticated/service_role. Bảng nháp giữ RLS và không cấp quyền table trực tiếp cho anon/authenticated. Chỉ apply một migration cùng history trong transaction, không tạo/alter bảng lịch sử. Metadata thay đổi dùng DDL event trigger reload sẵn có, không thêm NOTIFY.

Pre-apply và post-apply rollback smoke PASS. API campaign HTTP 200 trước/sau apply; đọc bảng nháp bị từ chối `42501`, RPC credential sai trả lỗi xác thực. Không gặp `PGRST002`/HTTP 503 trong kiểm chứng.

## Kiểm tra

```bash
node scripts/run-campaign-drafts-smoke-test.cjs
node scripts/campaign-failure-cleanup-smoke-test.cjs
node scripts/page-inbox-campaign-run-smoke-test.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

SQL: chạy `migrations/tests/migration_v271_campaign_drafts_smoke.sql` trong **BEGIN/ROLLBACK**. Kiểm tra CRUD/snapshot, credential, ownership, summary không có payload, revision conflict, completion metadata, thao tác campaign bình thường và xóa mềm. Smoke v270 chỉ dùng với schema lịch sử v270.

UI: `node scripts/serve-campaign-drafts-ui-smoke.cjs` mở form/store thật với API giả lập. Không gọi DB, scheduler hoặc gửi tin thật. Đã kiểm tra lưu mới tối thiểu không có nội dung/data; lưu/khôi phục sparse payload, media, false/0, data chưa hoàn thiện và chiến dịch con; tạo nháp nhiều tài khoản và chiến dịch con có liên kết; Data Group nhiều tài khoản qua bundle/bind hiện có; snapshot nhóm trộn data nhập tay; lỗi ghi data giữ nháp; lỗi metadata sau thành công được báo đúng; lưu/sửa/xóa từ danh sách; tạo/nhân bản/chỉnh sửa thường không gọi API nháp.

`window.draftSmokeUI.prepareRateLimitCase(scenario)` hỗ trợ `default`, `multiple`, `manual`, `clone`. Bấm **Lưu nháp**, gọi `window.draftSmokeUI.open('saved')`, bấm **Tạo chiến dịch**, rồi gọi `window.draftSmokeUI.assertRateLimits()`. Assertion kiểm tra payload gửi đến API `createCampaign` thật của form: mặc định 120 phút, nhiều tài khoản 120/180, ghi đè hành động 45, nháp nhân bản giữ 95/45.

`window.draftSmokeUI.prepareList()` mở danh sách có campaign thật và nháp; chọn thời gian **Tất cả** vì fixture nằm năm 2035. `prepareList(51)` dùng cho phân trang summary. Smoke scheduler dùng mã thật với adapter local. Hai typecheck, production build và các smoke script trên đã PASS sau đơn giản hóa.
