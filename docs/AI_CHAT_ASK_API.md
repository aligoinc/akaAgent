# API gửi câu hỏi "Hỏi đáp AI" (chèn tin nhắn)

Tài liệu này dành cho mọi nơi nội bộ cần đưa một câu hỏi vào "Hỏi đáp AI": app, script, công cụ vận hành, bot. Mỗi lời gọi lưu một câu hỏi vào database. Sau đó bộ trả lời nhận câu hỏi qua `/list` (xem [AI_CHAT_AGENT_API.md](AI_CHAT_AGENT_API.md)), và nhân viên thấy hội thoại trong mục Hỏi đáp AI trên Web, iOS, Desktop.

- **Địa chỉ**: `POST https://cgjbsmqtfhqvttudyjzq.supabase.co/functions/v1/ai-chat-agent/ask`
- **Xác thực**: không có. Không token, không khóa, không header riêng. Gọi thẳng bằng URL và body.
- **Định dạng**: gửi `Content-Type: application/json`, body là một JSON object. Mọi phản hồi là JSON có `ok: true` hoặc `ok: false` kèm `code` và `message` tiếng Việt.
- **Thời gian**: mọi mốc thời gian là ISO 8601 giờ UTC, do server ghi.

## Câu hỏi được lưu vào đâu

| Trường hợp | Dòng được ghi |
|---|---|
| Câu hỏi mới (không gửi `threadId`) | 1 dòng `ai_message_thread` (hội thoại) + 1 dòng `ai_message` (câu hỏi, `seq` = 1) |
| Hỏi tiếp (có `threadId`) | 1 dòng `ai_message` (`seq` kế tiếp), hội thoại tăng `revision` và số tin |

Câu hỏi vừa lưu có trạng thái `chờ câu trả lời`. Nơi gọi không ghi thẳng vào bảng: bảng khóa với mọi role, chỉ đi qua API này.

## Gửi một câu hỏi

**URL**: `POST /ask`

**Body**:

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `question` | Có | Nội dung câu hỏi, chuỗi 1–4.000 ký tự |
| `projectCode` | Có, khi không gửi `threadId` | Mã agent nhận câu hỏi. Hiện có `hoi-dap-chien-dich` (Web, iOS) và `hoi-dap-chien-dich-desktop` (app Desktop). Gửi `projectId` thay cho mã cũng được |
| `campaignId` | Có với hai agent hiện tại | Chiến dịch được hỏi. Hai agent hiện tại đều hỏi về một chiến dịch |
| `staffId` | Không, khi đã có `campaignId` | Nhân viên đứng tên câu hỏi. Bỏ trống thì lấy chủ của chiến dịch. Bắt buộc với agent không cần chiến dịch |
| `organizationId` | Không | Tổ chức của nhân viên. Bỏ trống thì server tự tra. Gửi lên thì phải khớp |
| `threadId` | Không | Hỏi tiếp trong hội thoại này. Khi có `threadId` thì không cần `projectCode`, `campaignId`, `staffId` |
| `source` | Không | Nơi gửi: `api` (mặc định), `web`, `ios`, `desktop`. Ghi vào hội thoại mới |
| `requestId` | Không | UUID do nơi gọi tự sinh. Gửi lại cùng `requestId` không tạo câu thứ hai. Bỏ trống thì server tự sinh |
| `intake` | Không | JSON object thông tin thêm cho agent (hai agent hiện tại không yêu cầu) |

Câu hỏi mới về một chiến dịch, chỉ cần ba trường:

```json
{ "projectCode": "hoi-dap-chien-dich-desktop", "campaignId": 12345, "question": "Tại sao chiến dịch không chạy?" }
```

Hỏi tiếp trong hội thoại đã có:

```json
{ "threadId": 45, "question": "Vậy khi nào chiến dịch chạy tiếp?" }
```

Đầy đủ các trường:

```json
{
  "projectCode": "hoi-dap-chien-dich",
  "campaignId": 12345,
  "staffId": 678,
  "organizationId": 90,
  "question": "Hôm nay chiến dịch đã gửi được bao nhiêu?",
  "source": "desktop",
  "requestId": "3f0e1c1e-6a53-4d0c-9a54-0d5c6f1e2a10"
}
```

**Phản hồi** khi đã lưu (HTTP 200):

```json
{
  "ok": true,
  "inserted": true,
  "threadId": 45,
  "messageId": 123,
  "seq": 1,
  "status": "chờ câu trả lời",
  "requestId": "350924bd-1266-4e43-8ce8-157b94e5a03e",
  "source": "api",
  "project": { "id": 2, "code": "hoi-dap-chien-dich-desktop", "name": "Hỏi đáp chiến dịch" },
  "staffId": 678,
  "organizationId": 90,
  "campaignId": 12345,
  "campaignName": "Chăm sóc khách tháng 11",
  "accountId": 100,
  "accountName": "Zalo Shop Hà",
  "question": "Tại sao chiến dịch không chạy?",
  "askedAt": "2026-11-10T15:28:57.606Z",
  "deadlineAt": "2026-11-10T15:48:57.606Z",
  "serverTime": "2026-11-10T15:28:57.611Z"
}
```

| Trường | Ý nghĩa |
|---|---|
| `inserted` | `true` = lời gọi này vừa tạo câu hỏi. `false` = `requestId` đã dùng, trả lại đúng câu đã lưu trước đó |
| `threadId` | Hội thoại chứa câu hỏi. Dùng để hỏi tiếp |
| `messageId` | Mã câu hỏi. Bộ trả lời dùng mã này ở `/start`, `/answer`, `/status` |
| `seq` | Thứ tự câu hỏi trong hội thoại, bắt đầu từ 1 |
| `status` | Trạng thái hiện tại của câu hỏi |
| `deadlineAt` | Hạn chót phải có câu trả lời (20 phút với hai agent hiện tại). Quá hạn thì câu hỏi tự chuyển `lỗi` |

**Phản hồi** khi đang có câu chờ trả lời (HTTP 409, không lưu gì):

```json
{
  "ok": false,
  "code": "ai_chat_message_pending",
  "message": "Đang có câu hỏi chờ trả lời cho đúng agent và chiến dịch (hoặc hội thoại) này. Chờ câu đó xong rồi gửi câu mới.",
  "threadId": 45,
  "messageId": 123,
  "status": "chờ câu trả lời"
}
```

**Ghi chú**:

- Câu hỏi thuộc về một nhân viên. Hội thoại hiện trong danh sách Hỏi đáp AI của đúng nhân viên đó trên app, kèm chấm báo đang chờ, giống như họ tự hỏi. Đừng gửi câu hỏi thử bằng chiến dịch của khách thật.
- Mỗi nhân viên chỉ có một câu đang chờ cho cùng agent và chiến dịch. Gửi câu mới khi câu cũ chưa xong thì nhận 409 kèm `threadId`, `messageId` của câu đang chờ. Hỏi tiếp bằng `threadId` khi câu trước chưa xong cũng nhận 409 (không kèm hai trường này).
- Không gửi `threadId` thì luôn mở hội thoại mới, kể cả khi chiến dịch đó đã có hội thoại cũ đã trả lời xong. Muốn nối vào hội thoại cũ thì gửi `threadId`.
- Nên gửi `requestId` khi nơi gọi có cơ chế thử lại: mất phản hồi rồi gửi lại cùng `requestId` sẽ nhận đúng câu cũ với `inserted: false`.
- Giới hạn theo nhân viên: tối đa 3 câu đang chờ cùng lúc và 50 câu mỗi ngày (giờ Việt Nam). Vượt thì nhận 429.
- Luật của app vẫn áp dụng: nhân viên phải còn hoạt động, agent phải đang mở cho nhân viên đó, chiến dịch phải thuộc đúng nhân viên và chưa bị xóa.
- API này chỉ lưu câu hỏi. Câu trả lời do bộ trả lời ghi qua `/answer`, nhân viên đọc trong app. Hiện chưa có đường đọc câu trả lời theo `messageId`.
- `source` chỉ được ghi khi tạo hội thoại mới. Hỏi tiếp không đổi nguồn của hội thoại.
- `question` được cắt khoảng trắng hai đầu trước khi lưu.
- Gọi được từ server, script, công cụ dòng lệnh và tiến trình chính của app Desktop. Trang web chạy trong trình duyệt chưa gọi thẳng được: API chưa bật CORS nên trình duyệt chặn ở bước kiểm tra trước (`OPTIONS` trả 405).

## Mã lỗi

| HTTP | `code` | Ý nghĩa | Nơi gọi nên làm |
|---|---|---|---|
| 400 | `ai_chat_question_required` | Thiếu `question`, không phải chuỗi, hoặc chỉ có khoảng trắng | Sửa body rồi gọi lại |
| 400 | `ai_chat_question_too_long` | Câu hỏi dài quá 4.000 ký tự | Rút ngắn rồi gọi lại |
| 400 | `ai_chat_project_required` | Không có `projectCode`, `projectId` lẫn `threadId` | Thêm mã agent |
| 400 | `ai_chat_staff_required` | Không có `campaignId` lẫn `staffId` nên không biết câu hỏi của ai | Thêm `campaignId` hoặc `staffId` |
| 400 | `ai_chat_campaign_required` | Agent cần chiến dịch mà không gửi `campaignId` | Thêm `campaignId` |
| 400 | `ai_chat_invalid_source` | `source` không phải `api`, `web`, `ios`, `desktop` | Sửa rồi gọi lại |
| 400 | `ai_chat_invalid_request` | Sai kiểu dữ liệu: mã không phải số nguyên dương, `requestId` không phải UUID, `intake` không phải object, body không phải JSON object, hoặc `requestId` đã thuộc về một câu hỏi của hội thoại khác | Sửa body rồi gọi lại |
| 400 | `ai_chat_agent_not_applicable` | Agent không áp dụng cho loại chiến dịch này | Chọn agent khác |
| 400 | `ai_chat_intake_required` | Agent yêu cầu thông tin `intake` mà chưa gửi | Thêm `intake` |
| 403 | `ai_chat_access_denied` | Nhân viên không tồn tại, đã nghỉ, hoặc không thuộc tổ chức đã gửi | Kiểm tra `staffId`, `organizationId` |
| 403 | `ai_chat_agent_unavailable` | Agent đang tắt hoặc chưa mở cho nhân viên này | Báo người vận hành |
| 404 | `ai_chat_agent_not_found` | Không có agent theo `projectCode` hoặc `projectId` | Kiểm tra mã agent |
| 404 | `ai_chat_campaign_not_found` | Không có chiến dịch, chiến dịch đã xóa, hoặc không thuộc nhân viên, tổ chức đã gửi | Kiểm tra `campaignId` |
| 404 | `ai_chat_thread_not_found` | Không có hội thoại, hoặc hội thoại không thuộc nhân viên đã gửi | Kiểm tra `threadId` |
| 405 | `ai_chat_method_not_allowed` | Gọi `/ask` bằng phương thức khác POST | Dùng POST |
| 409 | `ai_chat_message_pending` | Đang có câu chờ trả lời | Chờ câu đó xong rồi gửi lại |
| 409 | `ai_chat_thread_closed` | Hội thoại đã đóng | Bỏ `threadId` để mở hội thoại mới |
| 409 | `ai_chat_disabled` | Tính năng đang tắt | Dừng, báo người vận hành |
| 429 | `ai_chat_too_many_pending` | Nhân viên đang có 3 câu chờ trả lời | Gửi lại khi đã có câu trả lời |
| 429 | `ai_chat_daily_limit` | Nhân viên đã hết 50 câu trong ngày | Gửi lại vào ngày hôm sau |
| 502 | `ai_chat_upstream_error` | Lỗi tạm thời khi gọi database | Chờ vài giây rồi gọi lại, giữ nguyên `requestId` |
| 503 | `ai_chat_not_ready` | Database chưa có migration V492 | Dừng, báo người vận hành |

Các mã 4xx không tự hết khi gọi lại y nguyên. Mã 502 gọi lại được.

## Ví dụ bằng curl

```bash
BASE=https://cgjbsmqtfhqvttudyjzq.supabase.co/functions/v1/ai-chat-agent

# Câu hỏi mới về chiến dịch 12345, gửi cho agent của Desktop
curl -s -X POST "$BASE/ask" -H 'Content-Type: application/json' \
  -d '{"projectCode":"hoi-dap-chien-dich-desktop","campaignId":12345,"question":"Tại sao chiến dịch không chạy?"}'

# Hỏi tiếp trong hội thoại 45, có requestId để thử lại an toàn
curl -s -X POST "$BASE/ask" -H 'Content-Type: application/json' \
  -d '{"threadId":45,"question":"Vậy khi nào chạy tiếp?","requestId":"3f0e1c1e-6a53-4d0c-9a54-0d5c6f1e2a10"}'
```

Bằng JavaScript:

```js
const res = await fetch('https://cgjbsmqtfhqvttudyjzq.supabase.co/functions/v1/ai-chat-agent/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectCode: 'hoi-dap-chien-dich', campaignId: 12345, question: 'Tại sao chiến dịch không chạy?' }),
})
const data = await res.json() // data.ok, data.threadId, data.messageId
```

## Dành cho người vận hành

Nơi gọi không cần đọc phần này.

- Mã nguồn: đường `/ask` nằm trong Edge Function `ai-chat-agent` (`supabase/functions/ai-chat-agent/handler.ts`, `index.ts`), gọi hàm `public.aka_agent_ai_chat_insert(jsonb)` của [migration V492](../migrations/migration_v492_ai_chat_insert.sql) bằng `service_role`. Hàm này tự tra nhân viên, tổ chức, agent rồi gọi lõi `private.aka_agent_ai_chat` của V488 (`open` cho câu hỏi mới, `ask` cho hỏi tiếp), nên mọi luật của app giữ nguyên. Hàm không sửa đối tượng nào của V488.
- Trạng thái: V492 đã apply lên akachat lúc 22:26:38 VN ngày 10/11/2026 (`20261110152638 / migration_v492_ai_chat_insert`, không apply lại). Edge Function bản 2 deploy lúc 22:28 VN cùng ngày. Đã gọi thử qua địa chỉ thật 10 ca không ghi dữ liệu, và chạy thử chèn thật trong một giao dịch tự hủy. Chưa có câu hỏi nào được lưu qua `/ask` trên production. [Biên nhận](../migrations/snapshots/ai-chat-insert-v492/apply-receipt.json).
- API mở hoàn toàn theo yêu cầu (chỉ dùng nội bộ): ai biết địa chỉ đều gửi được câu hỏi đứng tên bất kỳ nhân viên nào, và câu hỏi đó hiện trong app của nhân viên ấy. Chặn duy nhất là giới hạn 3 câu chờ và 50 câu mỗi ngày cho từng nhân viên. Muốn khóa lại thì đặt secret `AI_CHAT_AGENT_KEY` trên Supabase: khi đó cả năm đường `/list`, `/start`, `/answer`, `/status`, `/ask` đều phải kèm header `x-agent-key`.
- Tắt nhanh: `auto_system_settings` khóa `ai_chat.enabled = 'false'` (`/ask` trả 409 `ai_chat_disabled`). Gỡ riêng `/ask`: chạy [rollback V492](../migrations/rollback_v492_ai_chat_insert.sql), `/ask` trả 503, bốn đường còn lại và app không đổi, câu hỏi đã lưu được giữ nguyên.
- Giới hạn theo nhân viên là hai khóa `ai_chat.max_pending_per_staff` và `ai_chat.max_questions_per_staff_per_day` trong `auto_system_settings`, dùng chung với app.
- Theo dõi: ba mã 404 của `/ask` hiện trong `edge_logs` của `/rest/v1/rpc/aka_agent_ai_chat_insert` dưới dạng HTTP 500, vì PostgREST đổi SQLSTATE `P0002` thành 500. Nơi gọi vẫn nhận 404. Khi đếm lỗi 5xx của hệ thống cần trừ các dòng này.
- Hội thoại tạo qua `/ask` không gửi `source` có `ai_message_thread.source = 'api'`. Đếm nhanh: `SELECT source, count(*) FROM ai_message_thread GROUP BY 1`.
- Kiểm thử cục bộ: `bash scripts/ai-chat/smoke_v492.sh` (54 khẳng định SQL, kèm từ chối apply lại và rollback), `bash scripts/ai-chat/edge_agent_smoke.sh` (56 khẳng định, trong đó 25 cho `/ask`, handler chạy với hàm SQL thật).
