# Phương án: sửa cơ chế AI lọc bài / comment và "aka Cài đặt"

Ngày lập: 24/11/2026. Anh duyệt 24/11 ("đồng ý theo phương án của bạn"), rồi "Hãy thực thi phương án này cho đến khi xong thì thôi".

**Tình trạng (24/11/2026, nhánh `claude/festive-fermi-pqkbuu`, chưa merge):**

- 1.1, 1.2 xong: bộ mẫu 393 bài / comment, kết quả ở [FB_AI_FILTER_EVAL_20261124.md](FB_AI_FILTER_EVAL_20261124.md). Anh từ chối cấp khoá qua form bảo mật, nên bộ mẫu chạy bằng `pg_net` từ database với khoá có sẵn trong `ai_model` (khoá không ra khỏi database). Chọn mô hình chính `deepseek-flash`, dự phòng `gpt-6-luna` (cổng "anh chọn mô hình" tôi quyết theo số liệu, anh đổi được bằng một UPDATE `ai_using.model_id`).
- 1.3: [V640](../migrations/migration_v640_fb_ai_filter_config.sql) (lời dặn mới, 6 mã `ai_using`, FB53) **đã apply akachat 13:29:59 VN 24/11** (sổ `20261124062959`, md5 sổ = file `6fac4b95…`; chưa block nào dùng tới khi có V641). [V642](../migrations/migration_v642_ai_config_history_eval.sql) (lịch sử cấu hình AI, bảng bộ mẫu) chưa apply: có DDL, để buổi tối.
- 1.4: [V641](../migrations/migration_v641_fb_ai_filter_blocks.sql) (10 block gọi mã mới, thử lại rồi dự phòng; bản engine báo FB53 khi cả hai lỗi; ghi sổ chép block) **đã apply akachat 15:55:56 VN 24/11** (anh hỏi "Tại sao không xử lý luôn mà phải đợi đến tối?"; chỉ dữ liệu nên không cần chờ tối; anh tự dán bản dán chịu CRLF vào SQL Editor, sổ `20261124085556`, md5 sổ = file `75f6c2ed…`, không apply lại; [biên nhận](../migrations/snapshots/fb-ai-filter-v641/apply-receipt.json)), viết bằng `replace()` có kiểm md5 trước / sau, đoạn lặp khai báo một lần trong khối `DO` (21 KB). Kiểm: `node scripts/fb-ai-filter/v641-blocks-smoke.cjs` (128), `python3 scripts/fb-ai-filter/test_v641.py` (10, PostgreSQL cục bộ với code block production 24/11).
- Kiểm thử đầu-cuối + V646 (lời dặn bản 3, apply 18:00:38 VN 24/11): [docs/FB_AI_FILTER_E2E_20261124.md](FB_AI_FILTER_E2E_20261124.md).
- Đợt 2 (app Desktop, chưa build): ô AI có chữ ví dụ, dòng dặn, báo đỏ và chặn lưu khi tích mà trống ([campaignAiFilterForm.ts](../src/shared/campaignAiFilterForm.ts), hai form); ô nổi "aka Cài đặt" có Thử nhanh, danh sách ô đã đổi (cũ → mới), Hoàn tác, nhãn "aka điền" ([CampaignFormAiPopover.tsx](../src/renderer/src/components/CampaignPanels/CampaignFormAiPopover.tsx), [akaSettingsChanges.ts](../src/renderer/src/components/CampaignPanels/akaSettingsChanges.ts)) cho 6 box Facebook, Lịch chạy, Giới hạn. Khác mục 2.2: không thêm 8 dòng `ai_form_configs` mới; danh sách ô đã đổi tính trên máy từ giá trị form và bản vá AI trả về, nên chưa có phần "câu thuộc box khác" (cần AI trả thêm trường, tức cấu hình mới). Box Nội dung và Loại trừ chỉ đổi tên ô nổi, vẫn đóng sau khi điền.
- Mô hình (anh yêu cầu 24/11 chiều: Haiku 5.5 vào bộ mẫu, thêm dòng `ai_model` tương ứng, đổi nano sang luna, aka Cài đặt của box này dùng Sonnet 5.5): [V643](../migrations/migration_v643_aka_settings_sonnet_filter_models.sql) **đã apply akachat 14:52:45 VN 24/11** (sổ `20261124075245`, md5 sổ = file `1e6b4f87…`, chỉ dữ liệu; [biên nhận](../migrations/snapshots/fb-ai-filter-v643/apply-receipt.json)): `ai_model` 39 `campaign_form_aka_settings_sonnet_5_5` và 40 `fb_ai_content_filter_haiku_5_5`; box "Điều kiện tìm kiếm bài post" (`ai_form_configs` 17) dùng Sonnet 5.5 effort medium (gọi thử đúng cấu hình đã lưu: dưới 6 giây, điền đúng); mã lọc bài cũ của Comment seeding gpt-5-nano → gpt-6-luna. Box "Cấu hình tìm kiếm / Điều kiện" của Tìm data (`ai_form_configs` 15) chưa đổi được: Claude từ chối khuôn có 38 ô kiểu "giá trị hoặc null" (giới hạn 16), cần app dựng khuôn riêng cho Claude. Haiku 5.5 trên bộ mẫu: chính xác 86,0%, bắt đủ 84,5%. Kiểm: `python3 scripts/fb-ai-filter/test_v643.py` (9), `node scripts/fb-ai-filter/v643-schema-check.cjs` (4).
- Mô hình cho bộ lọc bài / comment: **Haiku 5.5, lỗi thì sang gpt-6-luna** (anh chốt 24/11). 5 mã lọc `_v2` dùng `ai_model` 41 `anthropic_haiku_5_5_chat_compat` (Haiku 5.5 qua cổng tương thích OpenAI của Anthropic `/v1/chat/completions`, nên Desktop mọi bản gọi được qua API chuyển tiếp, không cần sửa app); lỗi thì block V641 gọi mã dự phòng `fb_ai_content_filter_fallback` (gpt-6-luna). Đường đi: [V644](../migrations/migration_v644_ai_haiku_luna_switch.sql) (apply 15:10:15 VN 24/11, sổ `20261124081015`; [biên nhận](../migrations/snapshots/ai-haiku-luna-v644/apply-receipt.json)) đổi nhầm cả 17 mã AI ngoài bộ lọc (tôi hiểu sai câu "Dùng hết bằng haiku"); [V645](../migrations/migration_v645_ai_revert_non_filter_models.sql) (apply 15:38:33 VN 24/11, anh dán SQL Editor, sổ `20261124083833`; [biên nhận](../migrations/snapshots/ai-revert-non-filter-v645/apply-receipt.json)) trả 15 mã về gpt-5-nano như cũ; anh chốt giữ gpt-6-luna cho hai nút trong form: "Viết lại" (`app_ai_rewrite_content`, lời dặn riêng `akabiz_rewrite_content_luna` có câu không dùng markdown; mã này cũng là viết lại email mỗi lần gửi) và tạo nhiều phiên bản (`app_ai_write_multi_other_content`). Trong 28 phút giữa hai bản, 12 mã viết lại chạy luna và 5 mã khác chạy Haiku, không có lượt lỗi. Nhánh akaAgentWebApp `claude/festive-fermi-pqkbuu` (code tự sang mô hình dự phòng cho mã AI thường) không cần nữa: không merge, không deploy. Kiểm: `python3 scripts/fb-ai-filter/test_v644.py` (11), `test_v645.py` (9).
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

### 2.1 Form (form thường và form Agent) — phương án chốt 24/11/2026

Thay mọi bản thiết kế trước (bản đầu có ô "Không lấy bài", "Cách chọn bài", nút thử trên bài thật: đã bỏ). Không thêm, không bỏ ô nào; tên trường và dữ liệu lưu giữ nguyên (`isFindPostByContentAI` / `postContentAI`, `isFindCommentByContentAI` / `commentContentAI`, từ khoá). Ba loại dùng chung `renderFindDataPostContentConditions` / `renderFindDataCommentContentConditions` nên chữ giống nhau.

Bốn chỗ đổi, giống nhau ở cả ba loại:

1. Chữ mờ ví dụ trong ô AI. Bài viết: "Ví dụ: Người đăng đang cần thuê phòng trọ ở Hà Nội cho chính mình. Loại bỏ: bài cho thuê của chủ nhà hoặc môi giới." Comment: "Ví dụ: Người comment đang hỏi giá hoặc xin tư vấn. Loại bỏ: comment quảng cáo, comment chỉ gắn tên bạn bè."
2. Dòng dặn dưới ô AI: "Viết như đang dặn nhân viên. Muốn bỏ loại bài (comment) nào thì ghi “Loại bỏ: …”."
3. Tích ô AI mà để trống: chữ đỏ "Nhập mô tả cho AI hoặc bỏ tích ô này.", không cho lưu.
4. aka Cài đặt ở ngôi sao cạnh tiêu đề box (mục 2.2).

| Loại chiến dịch | Ô AI trên form | Box có aka Cài đặt | Block chạy AI |
|---|---|---|---|
| Comment seeding (`facebook_comment_seeding`) | "Ý nghĩa bài viết là (dùng AI)" trong box "Điều kiện tìm kiếm bài post" | Điều kiện tìm kiếm bài post | 2554 / 2859 |
| Tìm data trong group (`facebook_find_data_group`) | Box "Điều kiện chạy": "Ý nghĩa bài viết là (dùng AI)" (mục Bài viết, hiện khi tìm ở bài / comment / link bài) và "Ý nghĩa comment là (dùng AI)" (mục Comment, hiện khi tìm trong comment) | Cấu hình tìm kiếm (điền cả Điều kiện chạy) | 2602 / 2863, 2603 / 2864 |
| Tìm data bằng search (`facebook_find_data_search`) | Như Tìm data trong group; bộ lọc search (Bài viết bạn đã xem, Ngày đăng, Bài viết của, Vị trí) giữ nguyên | Danh sách từ khóa; Cấu hình tìm kiếm | 2718 / 2904, 2719 / 2905 |

Lướt newsfeed, Comment vào link bài, Đăng bài kèm Kiêm comment: không có ô AI lọc bài, không đổi. Chiến dịch đang có không phải sửa; 20 chiến dịch tích AI mà để trống vẫn chạy như hiện nay (không lọc AI) cho tới khi khách mở sửa và lưu.

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
