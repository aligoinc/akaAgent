# Chẩn đoán AI chỉ hiển thị vấn đề liên quan — V395

Đã áp dụng trên **akachat / `cgjbsmqtfhqvttudyjzq`** ngày **14/10/2026 lúc 20:31:37 giờ Việt Nam**, history **`20261014133137 / migration_v395_campaign_diagnostics_focus`**. Không apply lại V390/V394/V395.

## Thay đổi

Prompt V394 từng cho phép dùng `info` để giải thích ngày kết thúc không chặn data trực tiếp. AI vì vậy vẫn tạo box dài cho điều đã bị loại trừ khỏi nguyên nhân. V395 sửa chính **`ai_prompt.id=47`, code `app_campaign_diagnostics`** để chỉ chọn vấn đề cần xử lý, điều kiện đang chờ/chặn hoặc thiếu bằng chứng liên quan đến hiện tượng cần chẩn đoán.

- Không tạo box cho nguyên nhân đã loại trừ, điều kiện bình thường hoặc việc chưa cần sửa; không lặp lại toàn bộ checklist tự động.
- Giữ `info` cho tạm dừng/chờ lịch; thiếu bằng chứng có liên quan vẫn có thể là `unknown`. Không lọc cứng các mức này trong renderer.
- Gộp tạm dừng và chưa rõ nguyên nhân vào một mục, không tách thành nhiều vấn đề trùng nhau.
- Không có bất thường hoặc điều kiện chờ cần giải thích thì trả `issues=[]`. Mỗi vấn đề thực sự vẫn đủ năm phần và nút xử lý liên quan.
- Giữ quy tắc ngày kết thúc direct/data_group, hỗ trợ snapshot cũ thiếu `facts.schedule` và giới hạn khung phút thực tế.

`ai_using.id=45`, `ai_model.id=21 / gpt-6.1-sol`, request options và credential giữ nguyên. Chỉ `prompt_system` và timestamp của prompt 47 thay đổi. Các hướng dẫn AI tiếp tục nằm trên DB, không ghép chỉ dẫn từ code. Mỗi lần bấm AI đọc lại cấu hình; kết quả đã hiển thị không tự đổi, cần bấm **Chuẩn đoán AI** lại.

Desktop chỉ đổi câu mô tả mẫu kết quả rỗng thành **“Chưa có kết quả chạy để đối chiếu”**, tránh câu “0 lỗi trong 0 kết quả”. Icon thông tin của mục lịch sử và nội dung vẫn giữ: mẫu rỗng không chứng minh thực thi bình thường, thu thập metadata không xác minh toàn bộ nội dung/media. Bản Desktop đã build local, chưa đóng gói/phát hành.

## Áp dụng và kiểm chứng

[Migration](../migrations/migration_v395_campaign_diagnostics_focus.sql) dựng từ row live vừa đọc; khóa dòng và preflight checksum fail-closed cho prompt, model, binding, phạm vi sử dụng. Apply qua Management API linked hiện có, ghi history cùng transaction, không dùng DDL phụ để chuẩn bị history. Không sửa RPC/schema/scheduler, không reload schema, thêm connection/pool hoặc polling.

- Smoke UPDATE rồi ROLLBACK trước apply đạt; checksum tất cả prompt/model/binding khác giữ nguyên.
- Sau apply, kiểm tra row/history và Data API **HTTP 200**, trả đúng prompt V395.
- Diễn tập rollback có guard đạt rồi rollback transaction, production vẫn giữ V395.
- `campaign-diagnostics-smoke.cjs`, hai typecheck và production build đạt. Smoke giữ kiểm tra lịch thật ba kênh, quota 65 phút, IPC/vòng đời và prompt DB qua Responses/Chat; không có prefix từ code.
- **7 request Sol 6.1 với dữ liệu giả đạt**, không dùng dữ liệu khách hàng hoặc ghi log AI production. System prompt của từng request khớp chính xác prompt DB sau nội suy.

| Ca | Kết quả đã ghi nhận |
|---|---|
| Direct tạm dừng | Một mục tạm dừng/chưa rõ nguyên nhân, `info`; không box ngày kết thúc hoặc nút sửa lịch |
| Direct tạm dừng, snapshot cũ | Một mục tạm dừng/chưa rõ nguyên nhân, `unknown`; không box ngày kết thúc hoặc nút sửa lịch |
| Direct chờ xử lý, chưa có bằng chứng chặn | Không tạo box; summary nêu giới hạn bằng chứng |
| Nhóm data hết hạn | Một mục `blocking`, mở lịch |
| Chưa đến lịch 22:00 | Một mục `info`, giải thích chờ đúng giờ Việt Nam |
| Đang chạy, có kết quả thành công mới | Không tạo box |
| Hết 9/9 lượt trong 65 phút | Một mục `blocking`, mở giới hạn và giữ đúng 65 phút |

Harness ban đầu chỉ chấp nhận `info` cho tạm dừng; đã sửa để cũng chấp nhận `unknown` khi nguyên nhân chưa xác minh, đúng hợp đồng hiện có. Giữ nguyên hai response đầu, đối chiếu cùng checksum prompt rồi chạy tiếp năm ca còn lại; không gọi lại để chọn câu trả lời thuận lợi. Biên nhận có đầy đủ bảy câu trả lời. Đây là kiểm chứng hồi quy với mẫu hữu hạn, không phải bảo đảm mọi đầu ra AI đều giống nhau.

Snapshot và biên nhận: [before](../migrations/snapshots/campaign-diagnostics-prompt-v395/before.json), [target](../migrations/snapshots/campaign-diagnostics-prompt-v395/target.json), [manifest](../migrations/snapshots/campaign-diagnostics-prompt-v395/manifest.json), [apply](../migrations/snapshots/campaign-diagnostics-prompt-v395/apply.json), [API](../migrations/snapshots/campaign-diagnostics-prompt-v395/api.json), [rollback smoke](../migrations/snapshots/campaign-diagnostics-prompt-v395/rollback-smoke.json), [bảy câu trả lời AI](../migrations/snapshots/campaign-diagnostics-prompt-v395/ai-focused-smoke.json).

SHA-256 nội dung prompt sau apply: `06144a956f4bf78778308b23b24e20b4359b000f2440e816cc962d53d296f60e`.

## Kiểm tra lại và rollback

`node scripts/campaign-diagnostics-prompt-v395.cjs verify` kiểm tra live row/history. `node scripts/campaign-diagnostics-ai-live-smoke.cjs --live --schedule` chạy bảy request có tính phí với dữ liệu giả; `--verify-schedule-receipt` chỉ kiểm tra receipt đã lưu ở `/tmp/akaagent-diagnostics-focused-ai-smoke.json`, không gọi mạng.

[Rollback có guard](../migrations/tests/migration_v395_campaign_diagnostics_focus_rollback.sql) khôi phục prompt V394 đã chụp live nếu row/binding/model chưa drift; giữ history. Không sửa migration đã apply, scheduler hay các cấu hình AI khác để rollback. `rollback-smoke` chỉ diễn tập rồi rollback transaction.
