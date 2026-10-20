# AI viết nội dung chiến dịch — V417

Ngày 20/10/2026. Phạm vi người dùng chọn: **viết/sửa nội dung chữ và tạo biến thể** trên Desktop/Web. Người dùng cho phép tạo model Haiku 5.5 riêng, sao chép key từ model 7.

## Trạng thái

- Migration đã apply trên **akachat**: `20261020113352 / migration_v417_campaign_content_ai`.
- Model mới **24**: `app_campaign_content_haiku_5_5`, `claude-haiku-5-5`, provider `claude`, global, active.
- Cấu hình mới **5**: `app_campaign_content`; Desktop/Web `campaign.content`, Mobile NULL, scope `all`, active.
- Typecheck, production build và kiểm thử code/UI đạt. Chưa deploy Web/API hoặc đóng gói/phát hành Desktop.
- **Chưa xác nhận tạo nội dung bằng Haiku thật thành công**: Models API nhận key và trả đúng `claude-haiku-5-5` (HTTP 200), nhưng Messages API trả HTTP 400 do tài khoản Anthropic không đủ credit. Log **841321** có `form_config_id=5`, trạng thái `error`. Form không bị thay đổi. Cần bổ sung credit cho tài khoản của key model 7 rồi chạy lại kiểm chứng thật; sau đó đã kiểm thử thành công bằng Sol 6.1 theo yêu cầu mới bên dưới và khôi phục Haiku; không tự retry Haiku.

## Hành vi

Icon “Viết nội dung bằng AI” nằm cạnh tiêu đề Nội dung, dùng chung popover và khóa form với Lịch chạy/Giới hạn. Enter gửi, Shift+Enter xuống dòng; cho hủy/đóng, bỏ kết quả cũ khi đổi nội dung, action, mode, định dạng hoặc phiên. Không tự lưu hay chạy chiến dịch.

- Cơ bản: sửa nội dung/biến thể bằng index, thêm biến thể vào cuối; dùng serializer hiện có để giữ token, spintax và escape dấu `|`.
- Nâng cao thủ công: chỉ sửa `content` và, với email, `emailSubject`. Biến thể mới kế thừa media/tùy chọn của item nguồn, có ID mới và không mang nhãn nguồn mẫu.
- Email: tiêu đề chung chỉ thuộc item 0 ở chế độ cơ bản; nâng cao có tiêu đề từng item.
- HTML: dùng sanitizer/serializer hiện có; không tự bật/tắt định dạng.
- Nhóm mẫu, copy nguồn và chế độ chia sẻ tin Zalo không hiện nút này vì không phải nội dung thủ công đang sửa.
- Giữ các công cụ AI viết lại/tạo biến thể cũ. Không chỉnh media, lựa chọn nguồn, cá nhân hóa tự động, tùy chọn gửi, lịch hay giới hạn.

## Hợp đồng

Request chỉ chứa `requestId`, `description`, `context` (`actionId`, `mode`, `format`) và `items` (`content`, `emailSubject`). Không gửi media, URL file, prompt hay model từ renderer/browser.

Output schema:

- `status`: `ok`, `unclear` hoặc `unsupported`; `reason`.
- `changes.edits`: `{ index, content, emailSubject }`; NULL giữ nguyên trường.
- `changes.additions`: `{ sourceIndex, content, emailSubject }`; nguồn là index trong snapshot gốc.

Parser kiểm tra field allowlist, index hợp lệ, index sửa không trùng, capability tiêu đề email và trạng thái. Tối đa 100 item trong snapshot, 20 biến thể thêm mỗi lần, 16.000 ký tự/content, 500 ký tự/tiêu đề, tổng snapshot JSON 60.000 ký tự và response 100.000 ký tự. Giới hạn này chỉ dành cho lượt gọi AI, không thay validation hoặc giới hạn lưu hiện có. Trường không nhắc đến và kết quả `ok` không có thay đổi được giữ nguyên.

Backend đọc config theo section cố định và action, kiểm tra active/scope, model global đang bật và schema tương thích. Web giữ auth/entitlement và giới hạn flight hiện có; Main giữ main-frame IPC/credential/deadline. Không thêm polling hoặc nguồn kết nối DB.

Native Claude Messages chỉ dùng cho `formConfig`: HTTPS `/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, system riêng, user message và `output_config.format` JSON Schema. Chỉ lấy block `text`; `max_tokens`, refusal và stop reason chưa hoàn tất bị từ chối. Các caller AI legacy giữ đường gọi cũ. Log liên kết `form_config_id`, `using_id`/`prompt_id` NULL.

Tài liệu provider đã kiểm tra:

- [Claude Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Migration và bảo toàn

Canonical: `migrations/migration_v417_campaign_content_ai.sql`, tạo từ CLI `20261020112729_campaign_content_ai.sql`. SHA256:

`92d7a415144a4d5efb3a68217d24cad4de936a09752859a3ddeccd7bbea7d595`

Chỉ INSERT model/config. Không schema/RPC/RLS/grant mới. Copy key trong SQL bằng row model 7 đã khóa share; không xuất key vào repository/audit. Model mới có `default_body={"max_tokens":16384}`; không sao chép file đính kèm/default body riêng của tổ chức 1. Model 7 và các cấu hình cũ giữ nguyên.

Migration dừng khi nguồn model/endpoint/org/active/key không đúng, config đích đã tồn tại hoặc checksum hai config cũ đã đổi. Đã thử transaction/rollback trước apply, xác nhận row contract, key bằng nhau, đọc bằng role anon và không có quyền UPDATE. Sau apply kiểm tra lại các điều kiện; RLS vẫn bật.

Checksum nguyên hàng trước–sau:

| Bản ghi | MD5 |
|---|---|
| `app_campaign_schedule` | `8d5756e1b68cf0ad5aad3c5c3a2fa7e6` |
| `app_campaign_action_limits` | `243aa41a6f4111f6ffaa69392be2dbb4` |
| Prompt 49 | `f9f9f06dd018e6cad280a2a8727d7f69` |
| Prompt 52 | `920d73f8af472921dfc1ff5ec6a2ffe8` |
| Binding 47 | `2d0dc8f6601970cbd4127c792e85172b` |
| Binding 50 | `4fe325577ea8bbc97ccc15dd09911c02` |

Snapshot prompt/schema mới, SQL assertion và audit không có key ở `migrations/snapshots/campaign-content-ai-v417/`.

## Kiểm chứng

- Desktop `campaign-content-ai-smoke.cjs`: request Claude, DB schema, log, scope/model/abort, response chưa hoàn tất, allowlist/index, email, token/spintax, giữ media và no-op.
- Desktop `campaign-schedule-ai-smoke.cjs`: parser/IPC, một flight giữa các section, hủy đúng kênh, auth/deadline.
- Desktop `ai-form-configs-smoke.cjs`: hai prompt/schema cũ và request trước/sau vẫn tương đương.
- Electron `run-campaign-schedule-ai-ui-smoke.cjs --content-only`: cơ bản/nâng cao, khóa Lưu, hủy/timeout, response cũ, thêm biến thể và giữ media trong nháp được người kiểm thử bấm lưu; không ghi campaign tự động.
- Web API: 29 tests form config/service/HTTP auth và native Claude, không gọi provider khi scope/model/schema/quyền không hợp lệ.
- Web: 105 tests CampaignFormPage và 8 tests popover/session/metadata. Một assertion đếm render bị lệch trong lượt chạy cùng build; chạy riêng assertion và chạy lại toàn bộ 105 tests đều đạt, không sửa logic hoặc nới assertion.
- Playwright: Desktop Chromium, Android Chromium và iPhone WebKit; cả ba section, nội dung cơ bản/nâng cao, ẩn nút khi chọn Nhóm mẫu, hủy, không tự lưu.
- Hai typecheck Desktop; typecheck Web monorepo; build Desktop và Web/API đạt. Các warning chunk/import hiện có vẫn còn.
- Live Haiku Messages bị chặn bởi credit như phần Trạng thái. Lượt kiểm thử bổ sung bằng Sol 6.1 bên dưới đạt 6/6 ca gọi thật.


## Sửa hai finding review — 20/10/2026

- Snapshot email nâng cao Desktop dùng cùng `resolveLegacyManualEmailSubject` với editor: item cũ thiếu/null tiêu đề kế thừa tiêu đề chung; tiêu đề riêng, kể cả chuỗi rỗng, giữ nguyên. Item trống tạm thời cũng dùng tiêu đề chung. Kết quả AI vẫn chỉ điền các trường trong patch.
- Native Claude trên Desktop/Web hợp nhất các thuộc tính `output_config` theo thứ tự model defaults → request options → Structured Outputs của runtime. `effort` từ DB được giữ, request options được ưu tiên hơn defaults; riêng `format` luôn lấy JSON Schema đã kiểm tra. Không làm thay đổi object cấu hình nguồn.
- Hồi quy Electron kiểm tra bốn trạng thái tiêu đề (thiếu, null, riêng, rỗng), request khớp UI, điền tiêu đề mà giữ body; các ca cơ bản/nâng cao, media, hủy/timeout và không tự lưu vẫn đạt.
- Smoke service Desktop và 32 test API Web đạt; kiểm tra effort ở defaults, request options và cả hai, schema runtime luôn được giữ, cùng parity request Lịch chạy/Giới hạn trước–sau.
- Hai typecheck Desktop, typecheck 7 workspace Web và production build hai repo đạt. Lượt sửa này dùng fixture, không gọi provider thật, không đổi DB/model/prompt/schema hoặc apply migration. Chưa deploy/phát hành.

## Kiểm thử thật bằng Sol 6.1 — 20/10/2026

Theo yêu cầu tiếp theo của người dùng, tạm đổi riêng `ai_form_configs.id=5.model_id` từ 24 sang 21 (`gpt-6.1-sol`) lúc 18:45:35 Việt Nam; sau khi kiểm tra xong đã khôi phục model 24 lúc 18:47:52. Dùng UPDATE dữ liệu có guard model/timestamp/checksum, không thêm migration hoặc đổi runtime.

**6/6 ca gọi provider thật đạt**, đều HTTP 200 và log `form_config_id=5`, model 21:

| Runtime | Tình huống | Log ID |
|---|---|---|
| Desktop service | Viết mới và thêm đúng hai biến thể | 841641 |
| Desktop service | Chỉ sửa item thứ hai, giữ giá và token | 841644 |
| Desktop service | Từ chối yêu cầu đổi media/lịch bằng `unsupported` | 841651 |
| Desktop service | Sửa tiêu đề và body HTML email | 841659 |
| Web/API service | Thêm hai biến thể, giữ nội dung gốc/token | 841691 |
| Web/API service | Yêu cầu giữ nguyên trả patch rỗng thành công | 841692 |

Dùng dữ liệu giả và auth context của fixture; gọi code service/repository/provider/parser thực, không tạo/sửa/chạy campaign. Kiểm chứng này bổ sung phần provider thật cho các smoke UI/auth đã chạy trước đó, không được hiểu là đã deploy Web hoặc thử session production.

Checksum cấu hình Nội dung bỏ qua `model_id` và `updated_at` luôn là `bd5fdc1b83f319e40f0e09adceaf43f5`; hai cấu hình Lịch chạy/Giới hạn vẫn giữ nguyên checksum nguyên hàng. Prompt, JSON Schema, scope, tùy chọn gọi và model records không đổi. Chỉ `model_id` được đổi tạm rồi trả lại, trigger cập nhật `updated_at`.

Receipt: `migrations/snapshots/campaign-content-ai-v417/live-sol-smoke.json`, `live-sol-web-smoke.json`, `sol-switch-test-audit.json` trong repo Desktop. Haiku vẫn chưa được xác nhận sinh nội dung thành công vì thiếu credit; thành công bằng Sol không chứng minh lượt gọi Haiku thành công. Hiện DB đã dùng lại Haiku 5.5, chưa deploy/phát hành.

## Rollout và rollback

DB đã sẵn sàng. Bổ sung credit và kiểm thử Messages thành công trước khi coi tính năng có thể sử dụng thật; sau đó deploy Web/API rồi cập nhật Desktop. Phiên bản cũ bỏ qua section chưa biết. Không cần Chat API hoặc native Mobile.

Rollback nhanh bằng tắt đúng cấu hình, giữ model/log và bản ghi phục vụ audit:

```sql
UPDATE public.ai_form_configs SET is_active = false WHERE code = 'app_campaign_content';
```

Nút biến mất khi mở lại form; backend từ chối lần gọi tiếp theo. Request đã bắt đầu giữ quy tắc snapshot/hủy hiện có. Không apply lại V416/V417 và không xóa model 24 khi còn log tham chiếu.
