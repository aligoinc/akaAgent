# Kiểm thử đầu-cuối bộ lọc AI bài / comment Facebook (24/11/2026)

Anh yêu cầu 24/11/2026: lấy data nội bộ + data mẫu + hàng nghìn ca mô phỏng + data cố tình sai lệch, lặp "lấy mẫu ngẫu nhiên → kiểm → sửa / cập nhật lời dặn → lấy mẫu lại" tới khi ít nhất 3 vòng liên tiếp không còn vấn đề.

## Cách kiểm (`scripts/fb-ai-filter/e2e/`)

- **Code thật**: 10 block lọc (bộ cũ + bản "[engine]") đọc thẳng từ `auto_blocks` production, chạy trong Node vm với trang giả; mỗi ca là một bài / comment có UID tác giả riêng để đọc lại block đã chọn bài nào.
- **AI thật như Desktop**: cấu hình đọc từ `ai_using` / `ai_prompt` / `ai_model` production, dựng yêu cầu bằng bản chép `renderTemplate` + `buildChatCompletionsBody` / `buildOpenAiResponsesBody` của `aiRuntimeService.ts`, gọi thẳng Anthropic / OpenAI (khoá chỉ trong bộ nhớ). Câu trả lời nhớ theo md5 thân yêu cầu để chạy lại không tốn tiền.
- **Mỗi vòng ~1.500 ca, mẫu mới theo số vòng**: ~960 ca mẫu có đáp án (12 lĩnh vực × 10 kiểu mô tả × người cần / người bán / lạc đề, biến đổi không dấu, chữ hoa, emoji, hashtag, "Xem thêm", xuống dòng, NFD), 47 ca cố tình sai lệch (trống, chỉ SĐT / link / emoji, chèn lệnh vào nội dung, phá thẻ `</noi_dung>`, JSON giả, NFD, teencode, tiếng Anh, nội dung 6.000 ký tự, mô tả chứa `[content]` / `{{content}}`, mô tả ra lệnh...), ~130 bài thật lấy ngẫu nhiên từ `ai_log` (68 chiến dịch, chia đều theo mã lọc) do Claude Opus 5.5 gắn nhãn, và 340 bài thật chấm tay (bộ mẫu 24/11).
- **Tiêm lỗi**: chạy lại ~300 ca với 30% lượt gọi AI bị thay bằng 529 / 500 / 402 / 401 / mất mạng / hết giờ / rỗng / trả lời không phải JSON / `"matched": "true"` / JSON cụt. Kiểm: tối đa 3 lượt mã chính + 2 lượt dự phòng, 400–404 / hết tiền thì sang dự phòng ngay, bản engine báo FB53 chỉ khi cả hai mô hình lỗi, bộ cũ không chọn bài khi AI lỗi, có câu trả lời dùng được thì block chọn đúng theo câu trả lời.
- **Đạt một vòng**: 0 lỗi hệ thống, 0 lỗi ở dữ liệu cố tình sai lệch, tối đa 1 lỗi ở dữ liệu mẫu rõ nghĩa (xem tay), bài thật chấm tay đúng từ 89%. Ba kiểu mô tả nhiều cách hiểu (danh sách từ khoá, "Cần bán…", "Bài viết đang hỏi hoặc quan tâm đến…") chỉ theo dõi.

Chạy: `NODE_USE_ENV_PROXY=1 E2E_DATA=<thư mục ngoài repo> node scripts/fb-ai-filter/e2e/round.cjs <số vòng> --gold <bộ mẫu chấm tay>`; thử lời dặn chưa đưa lên: `E2E_PROMPT_DIR=<thư mục có system.txt / user.txt>`, thử tuỳ chọn: `E2E_REQUEST_OPTIONS='<json>'`.

## Kết quả

| Vòng | Lời dặn | Ca | Lỗi hệ thống | Sai lệch cố ý | Mẫu rõ nghĩa sai | Bài thật chấm tay đúng | Đạt |
|---|---|---|---|---|---|---|---|
| 1–6 | so sánh bản 2 (V640) với 7 bản thử | 943–1.499 mỗi bản | 0 | 0–8 | 0–93 | 77,8–89,8% | (dò) |
| 7 | bản 3 (V646) | 1.493 | 0 | 0 | 3 | 89,7% | không |
| 8 | bản 3 | 1.506 | 0 | 0 | 0 | 89,9% | có |
| 9 | bản 3 | 1.504 | 0 | 0 | 0 | 89,9% | có |
| 10 | bản 3 | 1.502 | 0 | 0 | 1 | 89,8% | có |

Vòng 8–10: 4.512 ca, 376 lần tiêm lỗi, 0 lỗi hệ thống. Bài thật chấm tay: chọn đúng 89,9–90,0%, bắt đủ 78,1–78,3% (bản 2: 83,6–83,9% / 82,1–82,5%).

## Đã sửa / quyết định

- **V646 (apply 18:00:38 VN 24/11)**: giữ quy tắc V640, AI ghi `khach_can_tim`, `nguoi_viet`, `reason` rồi mới `excluded` / `matched`. Bản 2 hay quyết định trước rồi viết lý do ngược với quyết định (lý do nói "thuộc điều loại trừ" mà vẫn chọn) và đọc nhầm mô tả "người đăng cần tìm phòng trọ" là khách muốn tìm chủ nhà.
- **Không đổi quy tắc về danh sách từ khoá**: bản thử "danh sách từ khoá thì lấy cả bài người bán" đúng hơn trên dữ liệu mẫu nhưng sai nhiều hơn trên bài thật chấm tay (chọn đúng 83,6% → 76,3–78,9%): khách ghi "Tìm hàng quần áo", "Cần bán điện thoại", "bài viết đang hỏi hoặc quan tâm đến bđs" mà vẫn muốn người mua.
- **Giữ "suy nghĩ" của Haiku**: qua cổng chat của Anthropic, Haiku 5.5 tự suy nghĩ (~450 token ẩn mỗi lượt). Tắt đi (`thinking: {type: "disabled"}`) nhanh hơn (1,1 giây) nhưng bài thật chấm tay còn 78% (bắt đủ 47–51%).
- Bỏ: câu "ai bán ib mình / chính chủ ib giúp là lời người mua" (bài thật chấm tay xuống 87%), liệt kê vai người viết trong `nguoi_viet` (88,7–88,8%).

## Còn lại

- **Bài người mua có câu "ai bán ib mình", "chính chủ ib giúp"** đôi khi bị coi là bài người bán (vòng 7: 3 lần, vòng 10: 1 lần, trên ~650 ca rõ nghĩa mỗi vòng). Hai cách sửa bằng lời dặn đều làm xấu phần khác.
- **Mô tả nhiều cách hiểu** (danh sách từ khoá, việc kinh doanh của chính khách) là nguồn sai chính trên bài thật; nên xử lý ở form (đợt 2: ví dụ cách viết, báo khi để trống).
- **Chi phí, độ trễ**: Haiku trung vị ~1,9 giây mỗi bài trên lượt thật 24/11 (3,2 giây khi đo riêng), ~700 token trả lời.
- **Chạy thật**: từ 17:44 VN 24/11 có 394 lượt lọc Comment seeding của 3 chiến dịch, 0 lỗi, 0 lượt sang dự phòng, trung vị 1,9 giây (183 lượt sau V646).
