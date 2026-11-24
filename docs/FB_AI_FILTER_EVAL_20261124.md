# Kiểm lời dặn AI lọc bài / comment Facebook bằng bộ mẫu (24/11/2026)

Bước 1.1 và 1.2 của [phương án](FB_AI_FILTER_PLAN.md). Tài liệu này chỉ ghi số liệu, không chép nội dung bài hay mô tả của khách.

## Bộ mẫu

- 393 bài / comment thật lấy từ `ai_log` của 4 mã lọc: lọc bài Comment seeding 273, lọc bài Tìm data trong group 94, lọc comment Tìm data bằng search 17, lọc bài Tìm data bằng search 9. Mỗi mẫu có nguyên văn mô tả của khách và nội dung bài AI đã đọc.
- Gán nhãn bằng cách đọc từng bài theo đúng ý khách: 116 đúng ý, 232 không, 45 khó gán (thiếu chữ, chỉ có ảnh, mô tả rỗng). 45 mẫu khó gán không tính vào điểm, còn 348 mẫu.
- Có đủ các kiểu đã nêu trong phương án: 38 mẫu của chiến dịch ghi dòng loại bỏ, 312 mẫu mô tả một dòng, 65 mẫu tiêu chí "thuê phòng / trọ" (13 đúng ý).
- Nội dung bộ mẫu và kết quả từng lượt nạp vào `private.ai_eval_cases` / `private.ai_eval_results` (V642), không nằm trong repo.

## Cách chạy

Gọi thẳng API của từng mô hình từ database bằng `pg_net`, khoá lấy trong `ai_model` (khoá không ra khỏi database, không qua máy chạy kiểm). Mỗi mẫu gửi đúng lời dặn và tham số như block gửi lúc chạy thật. Lời dặn mới: `scripts/fb-ai-filter/prompt-v2.system.txt` / `prompt-v2.user.txt` (nhận nguyên văn mô tả, tự tách phần cần tìm và phần loại bỏ, trả `matched` / `excluded` / `reason`).

## Kết quả

"Chính xác" = trong các bài AI chọn, bao nhiêu bài đúng ý khách. "Bắt đủ" = trong các bài đúng ý, AI chọn được bao nhiêu.

| Cách chạy | Phần | Mẫu | Chọn đúng | Chọn sai | Bỏ sót | Chính xác | Bắt đủ |
|---|---|---|---|---|---|---|---|
| Lời dặn cũ + deepseek-flash (trước 21/11) | Tất cả | 348 | 107 | 40 | 9 | 72,8% | 92,2% |
| | Comment seeding | 252 | 64 | 40 | 7 | 61,5% | 90,1% |
| | Tìm data | 96 | 43 | 0 | 2 | 100% | 95,6% |
| Lời dặn mới + deepseek-flash, lượt 1 | Tất cả | 348 | 103 | 10 | 13 | 91,2% | 88,8% |
| | Comment seeding | 252 | 59 | 10 | 12 | 85,5% | 83,1% |
| | Tìm data | 96 | 44 | 0 | 1 | 100% | 97,8% |
| Lời dặn mới + deepseek-flash, lượt 2 | Tất cả | 348 | 101 | 19 | 15 | 84,2% | 87,1% |
| | Comment seeding | 252 | 58 | 19 | 13 | 75,3% | 81,7% |
| | Tìm data | 96 | 43 | 0 | 2 | 100% | 95,6% |
| Lời dặn mới + gpt-6-luna | Tất cả | 348 | 104 | 20 | 12 | 83,9% | 89,7% |
| | Comment seeding | 252 | 62 | 18 | 9 | 77,5% | 87,3% |
| | Tìm data | 96 | 42 | 2 | 3 | 95,5% | 93,3% |
| Lời dặn mới + gpt-5-nano | Tất cả | 348 | 110 | 113 | 6 | 49,3% | 94,8% |
| | Comment seeding | 252 | 67 | 87 | 4 | 43,5% | 94,4% |
| | Tìm data | 96 | 43 | 26 | 2 | 62,3% | 95,6% |
| Lời dặn mới + gpt-5-nano, suy luận vừa | Tất cả | 348 | 109 | 102 | 7 | 51,7% | 94,0% |

Mốc đạt ghi trong phương án:

| Mốc | Lời dặn cũ + DeepSeek | Lời dặn mới + DeepSeek (lượt 1 / 2) | Lời dặn mới + gpt-6-luna | Lời dặn mới + gpt-5-nano |
|---|---|---|---|---|
| Chọn bài thuộc phần loại bỏ (38 mẫu) | 0 | 0 / 0 | 1 | 4 |
| Mô tả một dòng: chọn đúng / số bài chọn | 100/137 (73%) | 96/106 (91%) / 94/112 (84%) | 98/117 (84%) | 106/214 (50%) |
| Tiêu chí thuê phòng: chọn đúng / số bài chọn | 13/15 | 13/13 / 13/14 | 12/13 | 13/31 |

## Kết luận

- Lời dặn mới giảm số bài chọn sai từ 40 xuống 10–19 trên cùng mô hình, chủ yếu ở Comment seeding; bỏ sót tăng nhẹ (9 → 13–15 bài).
- Cùng mô hình, cùng lời dặn mà hai lượt ra 10 và 19 bài chọn sai: kết quả DeepSeek dao động giữa các lần hỏi, con số đúng nằm trong khoảng đó.
- gpt-5-nano (đang chạy lọc bài Comment seeding từ 21/11) chọn sai gần một nửa số bài, kể cả khi bật suy luận vừa: không dùng.
- Chọn: mô hình chính `deepseek-flash` (`ai_model` 2), dự phòng `gpt-6-luna` (`ai_model` 16), dùng chung một lời dặn (`ai_prompt` `find_data_meaning_check_v2`). Cấu hình ở [V640](../migrations/migration_v640_fb_ai_filter_config.sql), block dùng ở [V641](../migrations/migration_v641_fb_ai_filter_blocks.sql).
- Mẫu của chiến dịch ghi dòng loại bỏ: lời dặn cũ cũng không chọn sai bài nào trong 38 mẫu này, vì các bài lấy được đều không thuộc phần loại bỏ. Lỗi "dòng loại bỏ thành điều kiện tìm" nằm ở lời dặn cũ (danh sách dòng đã cắt, khớp một dòng là chọn); lời dặn mới đọc nguyên văn mô tả mà block vẫn gửi trong trường `prompt`, nên không cần sửa cách block cắt dòng.
