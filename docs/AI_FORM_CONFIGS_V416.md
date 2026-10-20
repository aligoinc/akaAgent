# Cấu hình AI điền form tập trung — V416

Ngày 20/10/2026 đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`):
`20261020103243 / migration_v416_ai_form_configs`.
Không apply lại. Code Desktop và Web/API đã hoàn tất, typecheck/build đạt; **chưa deploy Web/API hoặc đóng gói/phát hành Desktop** trong lượt này.

## Hợp đồng

`public.ai_form_configs` là nguồn cấu hình cho hai section. Mỗi dòng có `id`, `code`, `name`, ba mã vị trí Desktop/Web/Mobile, `prompt_system`, `prompt_user`, `output_schema`, FK `model_id`, `campaign_scope`, `campaign_action_ids`, `is_active`, `created_at`, `updated_at`.

Các cột `is_reasoning`, `timeout_ms`, `response_parser`, `response_path`, `request_options` giữ tùy chọn của cấu hình đang chạy. Không có cột JSON mẫu.

| ID mới | Code | Mã section Desktop/Web | Prompt/binding cũ |
|---|---|---|---|
| 2 | `app_campaign_schedule` | `campaign.schedule` | 49 / 47 |
| 1 | `app_campaign_action_limits` | `campaign.action_limits` | 52 / 50 |

Hai dòng khởi tạo dùng model **21**, bật, phạm vi `all`, danh sách action rỗng, Mobile `NULL`. Mã section unique riêng từng nền tảng; `NULL` không áp dụng nền tảng đó. `selected` yêu cầu mảng một chiều, không rỗng, không trùng/NULL, gồm ID có thật và chưa soft-delete trong `auto_campaign_actions`.

Desktop/Main và Web/API chọn dòng bằng mã section cố định. Renderer/browser chỉ nhận `{sectionId,campaignScope,campaignActionIds}` qua IPC `campaign-form-ai:availability` hoặc GET `/api/aka-agent/control/v1/utilities/ai-campaign-form-configs`, có xác thực hiện hành. Không nhận prompt, schema, model hay credential từ client.

Metadata đọc lúc mở form/đổi phiên; đổi loại chiến dịch lọc trên snapshot sẵn có, không polling. Nút AI ẩn khi thiếu metadata, cấu hình tắt, không có vị trí hoặc ngoài phạm vi. Thay đổi DB về phạm vi hiển thị có hiệu lực ở lần mở form tiếp theo; backend luôn đọc lại cấu hình và kiểm tra phạm vi trước mỗi yêu cầu AI, kể cả form đã mở.

Model lấy theo `model_id`, phải bật và global. Bỏ khóa tên `gpt-6.1-sol` riêng hai section; runtime hiện hỗ trợ provider `openai`, HTTPS Responses hoặc Chat Completions với Structured Outputs. Không tự fallback model. Model không hỗ trợ hoặc provider từ chối request thì trả lỗi, không điền form.

Schema lấy từ DB, biên dịch/kiểm tra bằng Ajv, không tải `$ref` từ mạng hoặc biến đổi dữ liệu. Hợp đồng field/type/required vẫn phải khớp section hiện có; constraint và mô tả có thể chỉnh trong DB. Kết quả qua kiểm tra schema rồi parser/allowlist/capability cũ. Sửa schema không tự sinh trường UI.

Giữ dữ liệu ngữ cảnh, đồng hồ/lịch Việt Nam, request/result công khai, timeout, hủy/đóng/đổi phiên, bỏ phản hồi muộn và nghiệp vụ tại Lưu. AI chỉ điền form, không tự lưu/chạy. Các chức năng AI khác tiếp tục dùng `ai_using`/`ai_prompt` và guard model cũ.

## Dữ liệu, quyền và log

Migration khóa chia sẻ hai binding và hai prompt, so checksum toàn dòng nguồn trước khi chép bằng `INSERT … SELECT`. Prompt được sao chép trực tiếp nguyên văn; schema lấy nguyên giá trị/cấu trúc từ hằng số code tại thời điểm chuyển đổi. Không UPDATE hoặc xóa nguồn cũ, không đồng bộ hai chiều.

`ai_log.form_config_id` là FK nullable có index riêng. Log của hai section mới đặt FK này và `model_id`, để `using_id`/`prompt_id` NULL. Luồng AI khác giữ payload log cũ. Quyền log hiện hành không đổi: client được INSERT và SELECT riêng `id` theo policy hiện có, không được đọc nội dung log. Kiểm thử đã xác nhận cả INSERT RETURNING id bằng role `anon` với FK mới và ghi log bằng `service_role`.

Bảng cấu hình bật RLS, `anon`/`authenticated` chỉ SELECT dòng đang bật, không INSERT/UPDATE/DELETE; đây là cấu hình global dùng được qua cơ chế custom-auth Desktop hiện hành. Web trả metadata qua API có xác thực. `service_role` quản trị dữ liệu. Không đưa API key vào bảng mới.

Chỉ thêm trigger private `private.validate_ai_form_config()` để kiểm tra action/model và cập nhật `updated_at`. Signature này chưa tồn tại khi snapshot; không thay thế RPC/function đang có. Owner `postgres`, SECURITY INVOKER, volatility `v`, `search_path=''`, EXECUTE chỉ `postgres`/`service_role`. Giữ nguyên hai trigger bảo vệ namespace log sinh nhật/referral.

Dùng Supabase HTTP singleton hiện có; không thêm SQL pool, kết nối Realtime hoặc timer polling. Mỗi lần điền đọc config rồi model; metadata thêm một lần đọc khi mở form. Schema reload cần thiết vì có bảng/cột/FK mới.

## Bảo toàn và checksum

Snapshot/audit ở [`migrations/snapshots/ai-form-configs-v416`](../migrations/snapshots/ai-form-configs-v416).

| Nguồn | MD5 toàn dòng PostgreSQL trước và sau |
|---|---|
| Prompt 49 | `f9f9f06dd018e6cad280a2a8727d7f69` |
| Binding 47 | `2d0dc8f6601970cbd4127c792e85172b` |
| Prompt 52 | `920d73f8af472921dfc1ff5ec6a2ffe8` |
| Binding 50 | `4fe325577ea8bbc97ccc15dd09911c02` |

Prompt mới và cũ bằng nhau nguyên văn ở SQL và HTTP. Schema mới deep-equal hai hằng số Desktop/Web, gồm toàn bộ cấu trúc và giá trị.

- Migration SHA-256: `9741422ab3f6ba7a6eccfa4497fd6b456949e8c2d728d0603232362b035722c6`.
- File `schemas.json` SHA-256: `163bfbd56bc2d03cecf02625932e245b25d9f7aa5c362a0979bb69f0eeaf09b4`.
- Guard mới: source không tồn tại; target `md5(pg_get_functiondef(...)) = 5053f2afcc83656f238a2cfdd2c0d3d8`. Definition/owner/security/config/ACL sau apply khớp transaction thử.

`scripts/build-ai-form-configs-migration.cjs` lưu cách sinh migration từ snapshot và code gốc. Migration đã apply là lịch sử bất biến; thay đổi tiếp theo cần migration mới, không sinh đè V416.

## Kiểm chứng

- SQL transaction rollback trước/sau: chép dữ liệu, scope/list/section/schema/FK constraints, bật/tắt, role read/write, log FK. Bổ sung sau apply: đổi `model_id` sang model global khác rồi phục hồi trong transaction, INSERT RETURNING id bằng anon. Không để lại fixture.
- Drift smoke: sửa prompt nguồn trong transaction làm preflight từ chối; ROLLBACK phục hồi nguồn.
- HTTP live: cấu hình/prompt/schema/model relation đọc thành công; nội dung log vẫn bị từ chối, đọc riêng ID giữ nguyên.
- `node scripts/ai-form-configs-smoke.cjs`: gọi code repository/service/runtime thật với DB/provider giả lập; so nguyên request body cũ–mới cho cả hai section; scope, đổi ID/model tương thích, endpoint, schema lỗi, output lỗi, log và abort.
- `node scripts/campaign-schedule-ai-smoke.cjs`: parser/allowlist, giữ trường, timezone, capability, business checks tại Save; main-frame IPC, cross-section single flight, cancel/deadline/đổi credential.
- Electron: luồng lịch, nháp/khôi phục/clone/lưu, nhiều khung giờ, Enter/IME, cancel/timeout/đổi phiên; giới hạn hành động, scope, metadata một lần/form và bỏ kết quả form cũ đều đạt. Fixture cập nhật hộp chọn trạng thái lưu và việc AI popover unmount khi metadata phiên cũ bị hủy.
- Web/API: **52** ca API (gồm hồi quy chẩn đoán), **111** ca form/popover/metadata. Fixture snapshot nằm trong chính repo Web để chạy độc lập.
- Browser: **3** ca trên Desktop Chromium, Android Chromium và iPhone WebKit, gồm cả hai section, đổi action ngoài/trong scope không đọc lại metadata, hủy/timeout và màn hình hẹp.
- Hai typecheck Desktop, typecheck bảy workspace Web và production build hai repo đạt. Không đóng gói installer.

Request parity dùng provider giả lập để so sánh dữ liệu gửi đi một cách xác định; không coi output ngẫu nhiên của model là bằng chứng tương đương. Lượt này không đổi prompt/schema hoặc đánh giá lại chất lượng prompt.

Log/ảnh ở [`docs/audits/ai-form-configs-v416`](audits/ai-form-configs-v416). Chạy UI:

```sh
node scripts/run-campaign-schedule-ai-ui-smoke.cjs
node scripts/run-campaign-schedule-ai-ui-smoke.cjs --limits-only
node scripts/run-campaign-schedule-ai-ui-smoke.cjs --config-only
node scripts/ai-form-configs-http-smoke.cjs
```

## Rollout và rollback

1. DB V416 đã hoàn tất; không apply lại.
2. Deploy API có metadata/new reader rồi Web tương ứng.
3. Đóng gói/phát hành Desktop sau đó. Mobile chưa tích hợp.

Ứng dụng cũ tiếp tục đọc prompt/binding cũ. Khi rollback ứng dụng, giữ bảng/cột và các log mới để không mất dữ liệu; dùng lại bản ứng dụng trước thay đổi. Nếu cần tạm tắt riêng chức năng trên ứng dụng mới, đặt `is_active=false` hai dòng mới; backend từ chối ngay, nút ẩn khi mở lại form. Thao tác này không tắt AI của phiên bản cũ.

Không DROP bảng/cột hoặc khôi phục prompt cũ tự động. Sau khi bắt đầu chỉnh cấu hình mới, phiên bản cũ vẫn dùng snapshot cũ vì không dual-write. Màn hình quản trị, native Mobile và cấu hình theo tổ chức nằm ngoài đợt này.
