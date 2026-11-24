# Phương án: sửa cơ chế AI lọc bài / comment và "aka Cài đặt"

Ngày lập: 24/11/2026. Trạng thái: **chờ anh duyệt để bắt đầu, chưa code, chưa đổi database.**
Bản thiết kế: https://claude.ai/artifact/LFm55ymyAoGwhetKtc7Gqi

## 1. Làm gì, không làm gì

Ba loại chiến dịch Facebook dùng AI để chọn bài và comment: Comment seeding vào group/page/profile, Tìm data trong group, Tìm data bằng search.

Làm:

- Đợt 1, chỉ sửa trong database: cách AI đọc mô tả của khách, xử lý khi AI lỗi, mô hình dự phòng, lịch sử thay đổi cấu hình AI, bộ mẫu kiểm.
- Đợt 2, sửa app Desktop: hai việc nhỏ trên form và "aka Cài đặt" (giữ ngôi sao + ô nổi).

Không làm trong phương án này: ô "Không lấy bài" và "Cách chọn bài" trên form, mức "độ chặt", thử điều kiện trên bài thật trước khi chạy, AI đọc comment kèm bài gốc, khớp từ khoá nguyên từ, comment đúng bài theo link, lưu câu mô tả aka vào chiến dịch, chuyển lời dặn sang hệ bảng `ai_project`, chiến dịch Lướt newsfeed.

## 2. Hiện trạng (đo 24/11/2026, chỉ đọc)

- Trong 3 loại chiến dịch chưa xoá có 168 chiến dịch bật lọc bằng AI.
- Code chạy cắt ô "Ý nghĩa … (dùng AI)" thành từng dòng, mỗi dòng là một kiểu bài cần tìm, khớp một dòng là chọn. 8 chiến dịch có dòng "Loại bỏ…" / "KHÔNG…" nên AI chọn đúng loại bài khách muốn bỏ.
- 20 chiến dịch bật AI nhưng để trống ô: khi chạy không lọc gì, không báo.
- AI lỗi: Comment seeding bỏ bài mà không báo; Tìm data ném lỗi, mất kết quả của group đang quét.
- Lời dặn và mô hình nằm ở `ai_using` → `ai_prompt` + `ai_model`. Đường này không có mô hình dự phòng, không có lịch sử thay đổi, không có bộ mẫu kiểm.
- Mô hình: 4 mã lọc của Tìm data chạy `deepseek-flash`; mã lọc bài Comment seeding chạy `gpt-5-nano` từ 21/11. Đọc tay bài AI chọn cho tiêu chí "người cần thuê phòng": DeepSeek đúng 55/56, gpt-5-nano đúng 10–11/70.
- Lượng dùng thật 3 ngày gần nhất: lọc bài Comment seeding 21.051 lượt, 99,8% của một tổ chức (812), lượt cuối 07:25 ngày 23/11; lọc bài Tìm data trong group 98 lượt.
- Khoảng 114 trên 520 nhân viên hoạt động 3 ngày qua dùng app Desktop dưới 9.9.0 (mọi nền tảng, chưa lọc riêng Facebook); các máy này chạy bộ block cũ, máy từ 9.9.0 chạy bộ block "[engine]".

Đính chính so với trao đổi trước: OpenAI lỗi hết tiền từ tối 23/11 đã **chạy lại từ 11:10 ngày 24/11**. Trong lúc OpenAI lỗi không có lượt lọc bài Comment seeding nào (lượt cuối 07:25 ngày 23/11), nên đợt này chưa làm chiến dịch nào bị bỏ bài. Việc chọn mô hình vì vậy không còn gấp, sẽ quyết theo kết quả bộ mẫu ở bước 1.2.

## 3. Các điểm đã chốt

| Điểm | Chốt |
|---|---|
| Cách mở aka Cài đặt | Giữ ngôi sao cạnh tiêu đề box, rê chuột hoặc bấm mở ô nổi; chỉ đổi tên và phần bên trong (anh: "giữ theo cách cũ") |
| Sửa form hay sửa cơ chế | Sửa cơ chế trước, form chỉ thêm hai việc nhỏ ở đợt 2 |
| Nơi lưu lời dặn | Giữ `ai_using` → `ai_prompt` + `ai_model`, bổ sung dự phòng, lịch sử, bộ mẫu; không chuyển sang `ai_project` |
| Khi AI lỗi | Thử lại, gọi mô hình dự phòng, vẫn lỗi thì tạm dừng chiến dịch với lý do rõ (theo đề xuất; anh đổi thì báo trước bước 1.4) |

## 4. Đợt 1: chỉ database

Mỗi bước có một cổng kiểm; không qua thì dừng và báo anh.

### 1.1 Bộ mẫu kiểm

- Lấy khoảng 300 bài và comment thật từ `ai_log` (mỗi dòng có sẵn mô tả của khách, nội dung bài, câu trả lời của AI). Phải có: 8 chiến dịch ghi dòng loại bỏ, chiến dịch mô tả nhiều dòng, chiến dịch mô tả một dòng, comment của Tìm data.
- Tôi đọc tay và gán nhãn "đúng ý khách / không"; bài khó gán thì đánh dấu để anh xem.
- Lưu ở bảng riêng trong database (`private.ai_eval_cases`), không đưa nội dung bài của khách vào repo.
- Cổng: anh xem 20 bài mẫu bất kỳ và đồng ý cách gán nhãn.

### 1.2 Lời dặn mới và chọn mô hình

- Lời dặn mới nhận nguyên văn mô tả. AI tự tách phần cần tìm và phần loại bỏ; bài được chọn khi thuộc phần cần tìm và không dính phần loại bỏ; câu trả lời theo khuôn cố định, kèm lý do ngắn.
- Chạy bộ mẫu qua lời dặn cũ (làm mốc nền) và lời dặn mới, trên `deepseek-flash`, `gpt-5-nano` và một mô hình mạnh hơn nếu hai mô hình này không đạt.
- Mốc đạt đề xuất, chốt lại khi có số nền: không bài nào thuộc phần loại bỏ được chọn; tỷ lệ chọn đúng không thấp hơn lời dặn cũ trên các chiến dịch mô tả một dòng; với tiêu chí "người cần thuê phòng" đạt mức DeepSeek cũ (55/56).
- Nếu lời dặn một bước không đạt với mô tả dài (có chiến dịch 37 dòng): thêm một bước "hiểu mô tả" chạy một lần mỗi lượt, rồi lọc từng bài theo kết quả đó.
- Cần anh cấp khoá AI cho phiên làm việc qua form bảo mật (tôi không thấy được khoá) để gọi DeepSeek và OpenAI khi chạy bộ mẫu.
- Cổng: bảng kết quả từng mô hình, anh chọn mô hình chính và mô hình dự phòng.

### 1.3 Migration 1 (thêm mới, chưa ai dùng)

- `ai_prompt` mới và `ai_using` mới: 5 mã `<mã cũ>_v2` cho 5 chỗ lọc, 1 mã dự phòng dùng chung. Không sửa dòng cũ.
- Bảng lịch sử `private.ai_config_history`, tự ghi mỗi lần sửa `ai_using`, `ai_prompt`, `ai_model` (không chép khoá API).
- Bảng bộ mẫu `private.ai_eval_cases`, `private.ai_eval_results`.
- Mã lỗi mới "AI lọc bài tạm thời không dùng được" trong `auto_error`, chính sách engine (tạm dừng chiến dịch, bài hoặc group đang xét về hàng đợi, không tính lượt, không cộng chuỗi lỗi) và luật nhận câu lỗi. Câu cho khách anh duyệt trước.
- Có lệnh tạo bảng nên apply buổi tối. Cổng: chạy thử trong giao dịch rồi huỷ, bài kiểm trên PostgreSQL cục bộ, bản gỡ.

### 1.4 Migration 2 (đổi cách chạy, chỉ dữ liệu)

Sửa code 10 block, có kiểm md5 bản đang chạy trước khi ghi:

| Loại | Block bộ cũ | Block engine |
|---|---|---|
| Comment seeding, lọc bài | 2554 | 2859 |
| Tìm data trong group, lọc bài | 2602 | 2863 |
| Tìm data trong group, lọc comment | 2603 | 2864 |
| Tìm data bằng search, lọc bài | 2718 | 2904 |
| Tìm data bằng search, lọc comment | 2719 | 2905 |

- Cả 10 block: gửi nguyên văn mô tả (không cắt dòng), gọi mã mới; AI lỗi thì thử lại 2 lần rồi gọi mã dự phòng.
- 5 block engine, khi cả hai mô hình đều lỗi: dừng với câu lỗi cố định để engine tạm dừng chiến dịch theo mã lỗi mới. Group đang quét về hàng đợi, chạy tiếp thì quét lại.
- 5 block bộ cũ, khi cả hai mô hình đều lỗi: giữ như hiện nay (máy dưới 9.9.0 không có cơ chế tạm dừng theo mã lỗi này).
- Block engine cập nhật kèm md5 đã duyệt của danh mục bước và sổ chép block, như các lần sửa block engine trước.
- Cổng trước khi apply: chạy code block thật trên trang Facebook giả bằng Chromium (mô tả có phần loại bỏ, AI chính lỗi → dự phòng, cả hai lỗi, ô AI trống, app cũ); chạy thử migration trên production trong giao dịch rồi huỷ.
- Apply ngoài giờ cao điểm. Có hiệu lực cho mọi bản app ngay, không cần phát hành.

### 1.5 Theo dõi sau khi apply và cách gỡ

- 24 giờ đầu xem theo từng mã mới trong `ai_log`: tỷ lệ lỗi, số lượt phải gọi dự phòng, tỷ lệ bài được chọn của từng chiến dịch so với trước; số chiến dịch bị tạm dừng theo mã lỗi mới. Xem riêng tổ chức 812 vì chiếm gần hết lượt lọc.
- Đọc tay 50 bài AI chọn sau khi đổi.
- Gỡ: migration gỡ trả 10 block về code cũ (kiểm md5). Lời dặn cũ và mã cũ vẫn còn nguyên nên gỡ là chạy lại như trước.

## 5. Đợt 2: app Desktop

### 2.1 Form (form thường và form Agent)

- Bật lọc AI mà ô mô tả trống: báo lỗi dưới ô, không cho lưu.
- Ô AI có ví dụ và một dòng dặn cách viết: viết tự do, muốn bỏ loại bài nào thì ghi rõ "Loại bỏ: …".
- Các ô, tên trường và dữ liệu lưu giữ nguyên.

### 2.2 aka Cài đặt (9 box đang có AI điền)

- Giữ ngôi sao và ô nổi. Tiêu đề ô nổi "aka Cài đặt", có câu mẫu "Thử nhanh".
- Điền xong ô nổi không tự đóng: hiện danh sách ô đã đổi (cũ → mới), nút Hoàn tác; ô được điền có nhãn "aka điền".
- Câu có phần thuộc box khác: điền phần của box này, chỉ ra box kia kèm nút mở.
- Database: thêm 8 dòng `ai_form_configs` mới (chép các dòng 14–19, 1, 2) với lời dặn và khuôn câu trả lời mới; không sửa dòng cũ vì bản app đang cài kiểm khuôn câu trả lời rất chặt. Apply trước khi phát hành app.

### 2.3 Kiểm thử và phát hành

- Form thật trong Electron, phát lại khoảng 160 câu khách đã gõ cho nút AI điền qua lời dặn cũ và mới, các bài kiểm AI form đang có, hai typecheck, bản dựng.
- Build và phát hành theo quy trình build của repo khi anh yêu cầu.

## 6. Cần anh làm hoặc quyết trước khi bắt đầu

1. Duyệt phương án này.
2. Cấp khoá AI qua form bảo mật khi tôi gửi yêu cầu (bước 1.2).
3. Duyệt câu cho khách của mã lỗi mới. Đề xuất: "AI lọc bài tạm thời không dùng được", bước tiếp theo "Bấm Tiếp tục sau ít phút".
4. Mỗi lần ghi database production tôi báo trước nội dung và giờ apply; anh bấm cho phép.

## 7. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Lời dặn mới làm đổi kết quả của mọi chiến dịch đang bật AI cùng lúc | Bộ mẫu là cổng bắt buộc; theo dõi tỷ lệ chọn từng chiến dịch; gỡ được bằng một migration |
| Tạm dừng chiến dịch khi AI lỗi làm khách phải bấm Tiếp tục | Có mô hình dự phòng nên chỉ dừng khi cả hai cùng lỗi; ghi chú nêu rõ lý do |
| Sửa block ảnh hưởng mọi bản app ngay | Thử code block trên trang giả cho cả bộ cũ và engine; kiểm md5; apply ngoài giờ cao điểm |
| Số migration dùng chung nhiều phiên | Lấy số ngay trước khi apply, kiểm lại sổ (sổ đang tới V630) |
