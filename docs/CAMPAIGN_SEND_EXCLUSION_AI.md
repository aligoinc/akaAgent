# AI tạo nhóm điều kiện loại trừ — 20/10/2026

Người dùng yêu cầu AI tự mở form **Thêm nhóm điều kiện**, tích các điều kiện theo mô tả, dùng **Sol 6.1**. Tính năng dành cho section Loại trừ gửi cho khách hàng trên Desktop; Web chưa có section này.

## Hành vi

- Icon **Tạo nhóm loại trừ bằng AI** xuất hiện theo metadata cấu hình và phạm vi chiến dịch. Chọn tài khoản Zalo và tải xong danh mục trước khi gửi yêu cầu.
- AI trả tên nhóm, cách kết hợp VÀ/HOẶC và điều kiện. Desktop mở form **Thêm nhóm loại trừ**, tạo request UUID mới, revision 0 và tích đúng các control. Tài khoản là tài khoản đang chọn.
- Chỉ khi người dùng bấm **Lưu nhóm** mới gọi RPC lưu nhóm hiện có, rồi chọn nhóm vừa lưu cho tài khoản đó. Nhóm/danh sách đã chọn trước đó được giữ nguyên trong khi xem hoặc hủy bản nháp AI. Không sửa nhóm đã tồn tại, tự tạo danh sách khách hàng, lưu hoặc chạy chiến dịch.
- Khách đã từ chối nhận tin vẫn luôn được loại trừ bởi quy tắc độc lập hiện có.
- Giữ popover Enter/Shift+Enter, khóa form trong lúc chờ, hủy/timeout, một flight giữa các section, kiểm tra Main-frame/phiên và bỏ phản hồi cũ khi đổi tài khoản/form/catalog.

## Cấu hình DB đã apply

Migration history trên **akachat**: `20261020152219 / campaign_send_exclusion_ai`.

Canonical SQL: `migrations/20261020151724_campaign_send_exclusion_ai.sql`, tạo bằng Supabase CLI. SHA256:

`1ce4ca985eeacc76e66c977a9ee0267703a2ef21969cb29c33f47f4b5b43d2d1`

Chỉ INSERT một dòng `ai_form_configs`: ID **7**, code `app_campaign_send_exclusions`, Desktop `campaign.send_exclusions`, Web/Mobile NULL, model ID **21** `gpt-6.1-sol`, active, scope `selected` gồm 7 action hiện hỗ trợ loại trừ. Giữ request options `{}`, timeout 120 giây và model defaults hiện có.

Không thay bảng/RPC/quyền/model hoặc ba cấu hình AI cũ. Checksum nguyên hàng trước–sau:

| Cấu hình | MD5 |
|---|---|
| Lịch chạy | `8d5756e1b68cf0ad5aad3c5c3a2fa7e6` |
| Giới hạn hành động | `243aa41a6f4111f6ffaa69392be2dbb4` |
| Nội dung — vẫn Haiku model 24 | `6dd75fc8e4cd95821602d3088397fb43` |
| Loại trừ mới | `9199c11460b7cfbd4d7840a7cdc92627` |

Prompt/schema/audit lưu trong `migrations/snapshots/campaign-send-exclusion-ai/`. Không apply lại migration.

## Hợp đồng và dữ liệu

IPC request chỉ có `requestId`, `description` và `context` (`actionId`, `accountId`, `enableMessage`). Renderer không cung cấp model, prompt, schema, danh mục hoặc mở rộng scope.

Main đọc cấu hình cố định từ DB rồi gọi **một lần** RPC `aka_agent_send_exclusion_groups` hiện có để xác minh account/staff/tổ chức/credential và đọc danh mục. Dùng lại Supabase HTTP client, không thêm nguồn kết nối, pool hay polling. RPC đọc nhận abort của lượt AI; deadline 20 giây của lần đọc được giữ nguyên.

Prompt chỉ nhận mô tả, action và metadata field/operator/option của tài khoản; không gửi nhóm đã lưu, danh sách UID/người nhận hoặc credential. Trường/toán tử không được runtime hỗ trợ bị bỏ khỏi danh mục AI. Danh mục quá 100 field hoặc 200.000 ký tự bị từ chối, không cắt một phần.

Output `{status, reason, changes:{name, matchMode, rules:[{fieldId, operatorId, values}]}}`. Main kiểm tra schema, ID/option đang bật, cặp field/operator, kiểu/cardinality/range, field/giá trị không trùng. Chuyển scalar/mảng theo metadata rồi renderer kiểm tra lại với snapshot tài khoản trước khi mở draft. Không có control cho opt-out trong schema.

Điều kiện phụ thuộc danh mục DB, không hardcode bốn field ban đầu. Tag không có/không rõ trả `unclear`; yêu cầu không thể biểu diễn bằng nhóm phẳng hoặc vượt phạm vi trả `unsupported`, không điền một phần. Prompt mới tham khảo [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-update-api-and-model-parameters); transport Structured Outputs dùng runtime hiện có.

## Kiểm chứng

- SQL transaction/rollback trước apply: seed contract, scope 7 action, quyền đọc anon, client không có UPDATE. Postflight: RLS bật, model/config cũ không đổi; log mới liên kết config 7.
- `node scripts/campaign-exclusion-ai-smoke.cjs`: request/field allowlist, metadata mở rộng, option/ID/type/range, sai account/phiên, hủy lúc đọc RPC, scope/model/schema, log, chỉ tạo draft.
- `node scripts/campaign-schedule-ai-smoke.cjs`: Main-frame, mutex chung, hủy đúng kênh, timeout và đổi credential cho section mới; hồi quy Lịch chạy/Giới hạn.
- `node scripts/run-campaign-schedule-ai-ui-smoke.cjs --exclusions-only`: form chiến dịch thật, mở editor/tích điều kiện, giữ lựa chọn trước Save, chỉ ghi lúc bấm Lưu nhóm, đổi tài khoản/form/phiên, hủy/timeout, ID sai và metadata ngoài scope. Ảnh light/dark đã kiểm tra.
- Hồi quy `campaign-content-ai-smoke.cjs`, `ai-form-configs-smoke.cjs`, `send-exclusion-smoke-test.cjs`, `run-send-exclusion-ui-smoke.cjs`.
- Hai typecheck Desktop và production build.

**6/6 ca gọi Sol thật đạt** qua service/parser/config/model/log thật, danh mục tài khoản dùng fixture và không ghi nhóm/campaign:

| Ca | AI log |
|---|---|
| Tag VIP HOẶC đã gửi trong 7 ngày | 850592 |
| Bạn bè VÀ không có tag VIP | 850594 |
| Tag không tồn tại → unclear | 850600 |
| Bỏ quy tắc opt-out → unsupported | 850605 |
| Logic ngoặc lồng nhau → unsupported | 850610 |
| Giới tính chưa có trong danh mục → unsupported | 850613 |

Tất cả log HTTP 200, model 21, `form_config_id=7`. Kiểm chứng này không phải phiên production của một tài khoản khách hàng. Lệnh có phí: `node scripts/campaign-exclusion-ai-live-smoke.cjs --live`; receipt `live-smoke.json` giữ kết quả đã chạy, script không ghi đè receipt.

## Rollout / rollback

DB đã apply; Main/preload mới cần restart khi dùng dev. Desktop chưa đóng gói/phát hành. Không thay Web/API, Chat runtime hoặc Mobile.

Rollback nhanh: tắt đúng row bằng `UPDATE public.ai_form_configs SET is_active=false WHERE code='app_campaign_send_exclusions';`. Mở lại form sẽ ẩn icon; Main từ chối lượt tiếp theo. Giữ nhóm đã được người dùng lưu, model và log; không apply lại SQL hoặc xóa cấu hình có log tham chiếu.

## Hiểu ngôn ngữ tự nhiên theo form — 20/10/2026

Log `851010` nhận đủ danh mục và nhận diện tag Đồng nghiệp, nhưng hỏi lại “trong 3 ngày gần nhất hay đúng 3 ngày trước” với câu “loại trừ bạn bè đã gửi tin trước đó 3 ngày và có tag dong nghiẹp”. Theo yêu cầu người dùng, AI cần suy luận theo điều kiện của form thay vì đòi câu chữ chính xác.

Đã apply `20261020154058 / campaign_send_exclusion_ai_natural_language` trên akachat. SQL canonical: `migrations/20261020153804_campaign_send_exclusion_ai_natural_language.sql`, SHA256 `fb40b11a6a299e104d81f0ea4971d30478dc64d4fc50a3f04a065ec2039c102f`.

- Chỉ sửa `prompt_system` của `app_campaign_send_exclusions`, chấp nhận cách nói rút gọn, thiếu dấu/lỗi gõ khi ý định hoặc tag vẫn nhận diện được duy nhất.
- Dùng ngữ cảnh tránh gửi lặp và control `recent_delivery`: khách đã được gửi tin trước đó kèm N ngày mặc định là N ngày gần nhất, nếu người dùng không nêu rõ mốc chính xác hoặc chiều thời gian khác.
- Giữ yêu cầu rõ ràng về một ngày chính xác/logic khác; vẫn hỏi khi thiếu số ngày, tag không có hoặc không phân biệt được tag. Không thêm parser câu mẫu trong code.
- Không đổi schema/template/model Sol 21/scope/options; ba cấu hình Lịch chạy/Giới hạn/Nội dung giữ nguyên checksum. Mỗi lần gọi đọc DB nên có hiệu lực ngay, không cần restart.

Snapshot/receipt/rollback ở `migrations/snapshots/campaign-send-exclusion-ai/natural-language/`. Các checksum của config 7 ở phần khởi tạo bên trên là lịch sử; sau lần cập nhật này:

| Thành phần | MD5 |
|---|---|
| System prompt trước | `95bfe8e2fe216b5b13ab23418211862d` |
| System prompt sau | `8864fd5e394f3801c46c39627f4b20aa` |
| Các cột ngoài prompt_system/updated_at, trước và sau | `80613a231077b5ede2e3206c826574ed` |
| Toàn hàng sau apply | `a912cd1a0d1be0458ce97d75632255d1` |

Kiểm chứng:

- Migration thử trong transaction rồi rollback; kiểm tra toàn hàng nguồn trước khi sửa để từ chối nếu cấu hình đã thay đổi. Rehearsal `rollback.sql` trả đúng prompt cũ rồi rollback transaction; live vẫn giữ prompt mới.
- **9/9 ca candidate gọi Sol thật đạt**: câu gốc lặp hai lần, diễn đạt khác với 5 ngày, HOẶC, mốc đúng 3 ngày, thiếu số ngày, tag không tồn tại, trùng tên tag khác nguồn, nhóm lồng nhau.
- **Câu gốc sau apply đạt**, log `851166`, HTTP 200, model 21, config 7 và checksum prompt mới. Trả `and` với Bạn bè, tag Zalo `"6"` và số ngày `3`.
- Danh mục tài khoản là fixture; config/model/provider/parser/log thật. Không ghi nhóm hoặc chiến dịch. Smoke service/parser và syntax/diff kiểm tra đạt; không sửa runtime/UI nên không chạy lại build trong lượt đổi prompt này.

Lệnh kiểm chứng: `node scripts/campaign-exclusion-ai-live-smoke.cjs --live --natural-language`. Script giữ receipt cũ; dùng `--receipt=<đường-dẫn-mới>` nếu cần chạy lại. `--candidate=<file-json>` chỉ thay prompt trong lần thử, không ghi cấu hình DB; `--case=<tên-ca>` chạy riêng một ca.

Rollback riêng prompt bằng file `natural-language/rollback.sql` sau khi review; file kiểm tra checksum prompt và các cột còn lại trước khi khôi phục. Không apply lại migration khởi tạo hoặc migration này.
