# AI điền Lịch chạy — V399

Tiếp theo [V403](CAMPAIGN_FORM_AI_REPEAT_V403.md): Enter gửi, **Shift+Enter xuống dòng**; yêu cầu đã khớp form vẫn thành công. Quy tắc này thay thế mô tả Enter cũ bên dưới.

Đã apply trên **akachat** ngày **14/10/2026, 23:01:07 giờ Việt Nam**, history `20261014160107 / migration_v399_campaign_schedule_ai`. Desktop đã typecheck và build local; chưa đóng gói/phát hành. **Không apply lại khi phát hành Desktop.**

Prompt được tinh chỉnh tiếp ở [V400](CAMPAIGN_SCHEDULE_NATURAL_LANGUAGE_V400.md): hiểu mô tả theo ngữ nghĩa, phân biệt đặt lịch khác với sửa riêng một phần, trả lý do cần làm rõ. Quy tắc giữ trường vẫn áp dụng; loại lịch được suy ra khi người dùng yêu cầu lịch khác. Phần prompt và các snapshot V399 bên dưới là lịch sử; không dùng verify/rollback prompt V399 để ghi đè cấu hình V400.

## Hợp đồng giao diện

Icon Sparkles cạnh Lịch chạy mở popover bằng hover, click hoặc bàn phím. Hover/focus chỉ mở giao diện; nút **Điền lịch** hoặc **Enter trong ô mô tả** gọi AI. Enter không xuống dòng, không gửi khi đang xác nhận chữ bằng bộ gõ hoặc giữ phím; mô tả trống không gửi. Mô tả tối đa 2.000 ký tự. Khi chờ, nội dung form là `inert`, các nút lưu/lưu nháp và ô mô tả bị khóa; vẫn có thể hủy yêu cầu hoặc đóng form.

AI chỉ điền các trường lịch mà loại chiến dịch/nguồn data hỗ trợ. Trường không nhắc đến giữ nguyên, bao gồm ngày bắt đầu/kết thúc đang có. Yêu cầu giờ dừng/nhiều khung giờ/chạy lại sau khi hoàn thành cập nhật công tắc phụ thuộc. Không suy diễn “hằng tuần” thành làm mới data. Theo yêu cầu cập nhật giao diện, điền thành công tự đóng popover AI, không hiện preview/tóm tắt; trả focus về icon mà không mở lại popover. Form chiến dịch vẫn mở để người dùng kiểm tra và Lưu. Lỗi giữ popover và mô tả để sửa hoặc gửi lại.

Kiểm tra trước khi điền chỉ gồm JSON/type, định dạng đưa được vào control và capability của form. **Không so sánh ngày bắt đầu/kết thúc, giờ dừng/giờ chạy, chặn 23:59, kiểm tra số khung giờ hay số giờ chạy lại ở luồng AI.** Các kiểm tra nghiệp vụ đã có vẫn chạy tại nút Lưu; không thêm kiểm tra nghiệp vụ mới. AI không tự lưu/chạy chiến dịch. Dữ liệu AI điền cũng được lưu nháp qua nút lưu nháp hiện có, không tự lưu.

Lịch trong form dùng giờ Việt Nam khi đọc, nhập và chuyển về ISO, kể cả máy chạy múi giờ khác. Ngày kết thúc mới được lưu cuối ngày Việt Nam; các mốc ISO cũ được giữ theo quy tắc tương thích dưới đây. Không sửa scheduler hoặc quy tắc cutoff.

Sau review, bước mở nháp chuẩn hóa lịch cũ theo đúng cách app trước V399 lưu: giờ bắt đầu lấy từ `formData.schedule`, hoặc khung giờ đầu tiên nếu đang bật nhiều khung giờ; ngày kết thúc lấy cuối ngày theo múi giờ máy. Sau đó hiển thị cùng thời điểm ở Việt Nam. Ví dụ máy UTC đọc `08:00` thành `15:00` Việt Nam; khi tạo chiến dịch vẫn lưu `08:00Z`. Nháp được lưu bằng form mới có `scheduleTimeZone: "Asia/Ho_Chi_Minh"` ở cấp payload; mở lại không chuyển lần hai.

Hai trường hợp không thể khôi phục chính xác chỉ bằng giá trị control được giữ thêm trong `preservedSchedule` của JSON nháp: mốc bắt đầu khác khung giờ đầu tiên và mốc kết thúc khác cuối ngày Việt Nam. Chỉ áp dụng lại ISO cũ nếu các control tương ứng còn khớp snapshot. Đổi ngày/giờ chạy, danh sách khung giờ, tắt nhiều khung giờ hoặc đổi action/nguồn sẽ bỏ mốc bắt đầu cũ; đổi/xóa ngày kết thúc sẽ bỏ mốc kết thúc cũ. Lưu nháp không mang theo các mốc đã hết khớp. Giữ danh sách giờ lặp hiện có vì scheduler đã hiểu chúng theo giờ Việt Nam, không dịch cả danh sách hoặc đổi runtime. Parser khung giờ của form được chuyển nguyên sang `shared/campaignTimeSlots.ts` để bước khôi phục dùng đúng cùng quy tắc.

Control ngày kết thúc hiển thị ngày Việt Nam của mốc đang giữ, kèm đầy đủ thời điểm. Mở lại chiến dịch đã tạo lấy snapshot từ ISO hiện có, nên Lưu tiếp mà không sửa lịch vẫn giữ mốc bắt đầu/kết thúc. Nhân bản không tái dùng mốc bắt đầu của nguồn. Giữ payload version 1 và dữ liệu ngoài lịch; chỉ ghi JSON khi người dùng bấm lưu, không thêm migration/schema/RPC.

Review tiếp theo phát hiện bản giữ lịch đã gán lượt hiện tại vào cả `originalSchedule`: chiến dịch có khung `08:00,14:00`, đã chuyển sang lượt 14:00, Lưu lại làm mất mốc lặp 08:00. Bản sửa tách hai giá trị trong payload Lưu: khi giữ nguyên lượt của chiến dịch đã lưu, `schedule` giữ lượt hiện tại và `originalSchedule` giữ mốc gốc đã có (thiếu mốc gốc thì dùng `schedule` như runtime hiện có). Đổi ngày/giờ, danh sách khung giờ, tắt nhiều khung giờ hoặc đổi action/nguồn làm hết khớp snapshot thì cả hai được tính lại theo form. Chỉ sửa payload Desktop; không đổi JSON nháp, scheduler, DB hay prompt AI.

Nháp cũ không ghi múi giờ nơi tạo; bước chuyển giữ cách diễn giải theo máy đang mở như app cũ, không suy đoán múi giờ của một máy khác từng tạo nháp.

Thông báo:

- Không hiểu: “Chưa hiểu yêu cầu của bạn. Vui lòng mô tả rõ hơn lịch muốn chạy.”
- Không hỗ trợ: “Lịch bạn yêu cầu chưa được hỗ trợ cho loại chiến dịch này.” Có thể kèm một lý do ngắn.
- JSON không hợp lệ: “AI chưa xử lý được yêu cầu. Vui lòng thử lại.”
- Dịch vụ lỗi/timeout: “AI tạm thời chưa phản hồi. Vui lòng thử lại sau.”
- Hủy chủ động không hiện lỗi. Các lỗi giữ nguyên lịch và mô tả, mở lại form.

## JSON, IPC và tài nguyên

`src/shared/campaignScheduleAi.ts` định nghĩa request, schema strict, capability, parser và adapter form. Response AI là `{status, reason, changes}`; tất cả khóa changes phải có, `null` nghĩa giữ nguyên, `scheduleEndDate: ""` nghĩa xóa ngày kết thúc. Main chỉ trả patch đã kiểm tra hoặc lỗi đã phân loại. Unknown keys, JSON cắt dở, kiểu dữ liệu sai bị từ chối toàn bộ.

IPC `campaign-schedule-ai:generate` và `campaign-schedule-ai:cancel` kiểm tra đúng BrowserWindow/main frame, credential hiện hành, request UUID, kích thước mô tả và snapshot. Request được chiếu lại theo allowlist, không nhận prompt/model override từ renderer. Chỉ gửi mô tả, lịch, action ID, nguồn data, capabilities và thời gian Việt Nam; không gửi tên chiến dịch, nội dung, người nhận, account hoặc credential.

Tối đa một flight mỗi Desktop window; renderer cũng chặn gửi trùng. Deadline 120 giây ở main và renderer. Hủy, đóng form, đăng xuất, đổi phiên, session hết hạn hoặc app thoát hủy flight; kết quả muộn không được điền. Đổi phiên cùng staff cũng bị main chặn bằng credential identity. Không tự retry/fallback model. Không thêm polling, SQL client/pool hoặc connection budget; dùng HTTP/Supabase singleton và AI runtime hiện có. Đồng hồ dùng cache DB có sẵn, khi cache lạnh dùng thời gian hiện tại, không gọi thêm clock RPC cho tính năng này.

## DB và rollback

Migration chỉ thêm:

| Bảng | ID | Code |
|---|---:|---|
| `ai_prompt` | 49 | `app_campaign_schedule` |
| `ai_using` | 47 | `app_campaign_schedule` |

Binding dùng model **21**, `openai_campaign_diagnostics_sol61` / **gpt-6.1-sol**, Responses API, reasoning medium kế thừa model, timeout 120 giây. Prompt hướng dẫn nằm trong DB; schema nằm trong shared code. Log dùng `ai_log` hiện có. Sáu ca live smoke dùng dữ liệu giả lập, không có account/campaign/customer ID; đã ghi sáu AI log thành công.

Preflight fail-closed kiểm tra chưa có code trùng và checksum model đang chạy. Đường apply dùng linked Management API và transaction chứa hai INSERT cấu hình + INSERT migration history; không có DDL chuẩn bị history, sửa function/schema/ACL hay `NOTIFY` reload. Checksum toàn bộ model và prompt/binding khác giữ nguyên trước/sau.

Snapshot/checksum: `migrations/snapshots/campaign-schedule-ai-v399/`. Script apply chặn chạy lại, verify đối chiếu exact SQL trong history. Rollback vận hành dùng `migrations/tests/migration_v399_campaign_schedule_ai_disable.sql`: guard cấu hình/prompt rồi tắt riêng binding. Giữ prompt và log lịch sử; không xóa dữ liệu khách hàng, không reload schema. Disable đã được diễn tập trong transaction và rollback; production vẫn bật.

## Kiểm chứng

- `node scripts/campaign-schedule-ai-smoke.cjs`: JSON boundaries, giữ trường, capability, Chủ nhật/tháng/multiple slots, timezone độc lập máy, nghiệp vụ chỉ ở Save; IPC main-frame/duplicate/cancel/auth/stop/deadline và nhận yêu cầu mới sau mở khóa.
- `node scripts/run-campaign-drafts-smoke-test.cjs`: nháp legacy ở UTC/Việt Nam/Los Angeles/Kiritimati, qua ngày/năm và ranh giới DST; cùng thời điểm ISO, không mutate snapshot, chỉ chuyển một lần và mở lại trên máy múi giờ khác. Có nhiều khung giờ, cutoff, sửa lịch/action/nguồn, clone không giữ mốc bắt đầu nguồn; giữ kiểm thử CRUD/quyền/metadata hoàn tất cũ.
- Hồi quy nháp bằng form thật trong `run-campaign-schedule-ai-ui-smoke.cjs`: mở legacy → Lưu nháp → mở nháp đã đánh dấu ở múi giờ khác → Tạo chiến dịch; đối chiếu `schedule`/`originalSchedule` với ISO theo cách lưu cũ ở cả UTC/Việt Nam/Los Angeles. Nháp mới có dấu múi giờ; các bước này không gọi AI. Smoke, hai typecheck và production build đã chạy lại sau bản sửa và đạt.
- Review tiếp theo bổ sung **15 tổ hợp trên form thật**: nhiều khung giờ (gồm đổi ngày), tuần, tháng và tuần kết hợp nhiều giờ ở UTC/Việt Nam/Los Angeles. Đối chiếu cả `schedule`, `originalSchedule`, `scheduleEndDate` và danh sách giờ lặp sau lưu/mở nháp ở múi giờ khác. Tạo trực tiếp từ nháp, sửa ngày/slot/cutoff rồi lưu nháp, xóa cutoff/tắt nhiều giờ, mở lại chiến dịch đã tạo và AI giữ cutoff không nhắc đến đều đạt. Hai typecheck, build và hồi quy AI/IPC đã chạy lại; không gọi AI live hoặc apply DB lại.
- Hồi quy mốc lặp sau khi scheduler chuyển khung giờ: form thật mở chiến dịch đang ở 14:00 với mốc gốc 08:00, Lưu rồi chạy hàm `resolveNextSchedule` thật của repository cho lịch ngày/tuần/tháng; kỳ tiếp theo vẫn bắt đầu 08:00. Sửa ngày/slot và chuyển về một giờ cập nhật lại mốc gốc; AI chỉ bỏ giờ dừng giữ cả hai mốc. Tất cả đạt, cùng hồi quy nháp/JSON/IPC, hai typecheck và production build. Chạy hàm lịch thuần từ source trong sandbox test, không tạo kết nối DB.
- `node scripts/run-campaign-schedule-ai-ui-smoke.cjs`: form Desktop thật với IPC fixture; Enter gửi đúng một yêu cầu, không xuống dòng; trống/IME/giữ phím không gửi. Thành công tự đóng popover, trả focus mà không mở lại, không preview hoặc tự lưu; lỗi giữ mô tả. Hover không gọi AI, khóa toàn form, giữ ngày, điền giờ 20:00/dừng 18:00 và 23:59 rồi xác nhận chỉ nút Lưu báo lỗi. Hủy/lỗi/timeout/đóng form/đổi phiên mở khóa và bỏ kết quả muộn. Luồng Lưu thật qua repository mock xác nhận 08:00 Việt Nam thành `01:00Z`, giữ originalSchedule và ngày kết thúc cuối ngày Việt Nam. Kiểm tra UI mới, hồi quy lịch, hai typecheck và production build đều đạt. Ảnh dark/light trong `docs/audits/campaign-schedule-ai-v399/`.
- `node scripts/campaign-schedule-ai-live-smoke.cjs --live`: sáu ca gọi AI thật qua service/runtime/repository hiện có: tuần 2/4/6 lúc 8h, giờ mâu thuẫn vẫn điền, lịch tháng, loại không hỗ trợ, mô tả chưa rõ, ngày mai. Dùng `--live` vì phát sinh gọi model và log như runtime.
- `node scripts/campaign-schedule-ai-v399.cjs smoke`: đã chạy trước apply, hai INSERT trong transaction rollback, cấu hình khác không đổi.
- `node scripts/campaign-schedule-ai-v399.cjs verify`, `rollback-smoke`, `api`: đạt; Data API đọc binding mới HTTP 200, không reload schema.
- `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`: sạch.
- `npm run build`: đạt. Chưa chạy packaging hoặc phát hành Desktop.

Không sửa các thay đổi V398 hoặc công việc khác đang có trong workspace.
