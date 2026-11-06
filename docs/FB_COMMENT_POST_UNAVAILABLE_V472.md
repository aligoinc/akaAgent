# Up tin / comment vào bài post: phân loại khi không thấy ô bình luận — V472

**Đã apply** trên **akachat** `cgjbsmqtfhqvttudyjzq` lúc **12:12:35 VN ngày 06/11/2026**, lịch sử
`20261106051235 / migration_v472_fb_comment_post_unavailable`. **Không apply lại.** Chỉ sửa dữ liệu
(DML), không DDL nên PostgREST không nạp lại schema. App đọc block từ DB mỗi lượt chạy
(`workflowEngine.loadBlocks` → `getBlock`), nên bản mới có hiệu lực từ lượt up tin kế tiếp; lượt đang
chạy lúc apply vẫn dùng bản cũ. [Biên nhận](../migrations/snapshots/fb-comment-post-unavailable-v472/apply.json).

## Vì sao

Đo 23/10–06/11/2026 trên các chiến dịch "Up tin cho chiến dịch…" (`facebook_comment_seeding_post`, workflow 207):

- 4.881 lượt up tin đã chạy, 616 lượt (12,6%) lỗi
  `waitForSelector timeout: //*[@role='dialog']//*[@role='textbox' …]`; 10–20% mỗi tuần từ đầu tháng 9.
- Lỗi bám theo bài: 92% lượt lỗi thuộc các bài mà lần up nào cũng hỏng; cùng nhóm vẫn có bài
  up được; trang vẫn mở đúng link bài (604/613 lượt), checkpoint chỉ 7 lượt.
- Block `fb_comment_current_post` (id 2616) ném lỗi ⇒ `err_undefined`: không có dòng nào trong
  Lịch sử hành động, ghi chú/log lộ XPath, 4 lỗi liên tiếp thì dừng cả chiến dịch up tin.
  69 chiến dịch đang dừng vì lỗi này giữ 8.884 lượt; tính cả lượt kẹt, ~44% lượt đến hạn
  trong 14 ngày không up được.

## Thay đổi

1. **Block 2616** — hết 8 giây không thấy ô bình luận trong hộp thoại bài thì đọc trang (URL,
   tiêu đề, các đoạn chữ hệ thống ngắn, bỏ qua phần nội dung bài) và **trả `actionResult`**
   thay vì ném lỗi. Code chỉ thêm đúng đoạn này; khi có ô bình luận, thao tác giữ nguyên.

   | Trang hiện ra | Lịch sử hành động | Mã lỗi | Hạn mức | Chuỗi lỗi / dừng |
   |---|---|---|---|---|
   | Bài không còn / không xem được | Không tồn tại | `err_fb_comment_unavailable_post_not_found` (76) | Không | Không |
   | Bài đã tắt bình luận | Thất bại | `err_fb_comment_unavailable_comment_disabled` (75) | Không | Không |
   | Bài đang chờ duyệt | Thất bại | `err_fb_comment_unavailable_post_pending` (74) | Không | Không |
   | Chưa đủ quyền thành viên | Thất bại | `err_fb_comment_unavailable_not_member` (77) | Không | Không |
   | Checkpoint / bị đăng xuất (theo URL) | Lỗi | `err_fb_comment_box_not_found` (mới) | Không | Có (ngưỡng chung 4) |
   | Không nhận ra | Lỗi | `err_fb_comment_box_not_found` (mới) | Không | Có (ngưỡng chung 4) |

   Câu "tham gia nhóm để xem" chỉ được tính khi trang không hiển thị bài, để chữ trong bài quảng
   cáo không kích hoạt nhầm. `data` lưu `reason`, `matched`, `url`, `title`, `headings`,
   `rawError` và với trường hợp không nhận ra thêm `sample` (≤12 đoạn chữ) để bổ sung nhận diện.
   Không dùng khóa `error` vì runtime lấy khóa đó làm lý do trong ghi chú dừng.
2. **`auto_error` 74–77: `detail_mode='inherit'`.** Với `fb_comment`, cờ
   `counts_toward_limit`/`counts_toward_bad_target` của mã lỗi chỉ có hiệu lực khi
   `detail_mode` khác NULL ([actionResultRuntime.ts:151](../src/main/services/actionResultRuntime.ts)).
   Thiếu bước này thì "Thất bại" theo policy trạng thái mặc định: tính hạn mức và tính chuỗi lỗi
   (smoke đối chứng xác nhận). Giữ mọi cột khác. Bốn mã này chưa block nào phát trước V472.
3. **Thêm `err_fb_comment_box_not_found`** "Không tìm thấy ô bình luận": `external facebook`,
   `detail_mode='inherit'`, không tính hạn mức, tính chuỗi target lỗi chung; không ngưỡng riêng,
   không đổi trạng thái chiến dịch/tài khoản. Giữ đường tự dừng khi Facebook đổi giao diện hàng loạt.

Không đổi workflow 207, element `fb_comment_dialog_textbox`, code app, schema, RPC, quyền.
Ngoài bản test 244, workflow 207 là nơi duy nhất dùng block 2616, nên thay đổi áp cho mọi chiến
dịch "comment vào bài post", kể cả chiến dịch tạo tay.

## Giới hạn

- Câu chữ Facebook trong danh sách nhận diện **chưa đối chiếu với trang thật**. Trang không khớp
  đi nhánh "không nhận ra": vẫn dừng sau 4 lần như hiện nay nhưng có lý do dễ đọc và mẫu chữ để
  bổ sung. Bổ sung câu mới = sửa block 2616 lần nữa.
- Chưa dùng mã checkpoint 63: policy đó tạm dừng tài khoản và khóa mọi hành động Facebook vô
  thời hạn, chưa từng có producer.
- Theo yêu cầu: không tự chạy lại các chiến dịch đang dừng; khách tự bấm. Chưa chặn việc đổ lượt
  up tin vào chiến dịch đang dừng và chưa bỏ các lượt còn lại của bài đã chết (cần sửa code app,
  `enqueuePostBumpAfterGroupPost`). Bài đã chết vẫn bị thử đủ số lượt, mỗi lượt ~15 giây, nhưng
  không còn làm dừng chiến dịch.
- Cần app có runtime kết quả (từ 8.2.0). 19 khách chạy up tin trong 7 ngày đến 06/11 đều dùng
  9.1.0–9.3.0. Lượt bắt đầu trước khi apply chạy theo bản cũ; catalog lỗi làm mới sau 60 giây.

## Kiểm chứng (offline, 06/11/2026)

- `node scripts/fb-comment-post-unavailable-v472-sql-smoke.cjs` — **27 kiểm tra**: dựng lại
  `auto_blocks`/`auto_workflows`/`auto_error` đúng kiểu cột và dữ liệu live (checksum khớp
  production), apply chỉ đổi 74–77 và thêm 1 dòng, chạy lại bị từ chối không ghi dở, rollback
  khôi phục từng dòng và tắt mã mới, rollback lần hai bị từ chối; dữ liệu lệch (policy, workflow,
  mã đã có, sequence tụt) đều bị chặn trước khi ghi.
- `node scripts/fb-comment-post-unavailable-v472-smoke.cjs` — **30 tình huống** trên workflow 207
  live, engine/executor thật, scheduler và bộ ghi kết quả PostgreSQL WASM: đủ 11 loại trang (gồm
  tiếng Anh dấu nháy cong, chữ NFD, chặn chữ quảng cáo), có ô bình luận giữ nguyên thao tác,
  lỗi khác/hủy vẫn ném như cũ, không like sau comment lỗi, không gõ/gửi gì; với bộ đếm sẵn 3:
  bốn loại phân loại không dừng và không tính hạn mức, ba loại "Lỗi" dừng đúng lần 4 với ghi chú
  không có XPath; chạy lại không ghi/đếm trùng; đối chứng thiếu bước 2 thì tính hạn mức và dừng.

## Apply (06/11/2026)

1. Kiểm chỉ đọc lúc 12:06:32: md5 block 2616 `fd83066b95a5a2c3c0932bd6009dd2be`, checksum 74–77 và
   workflow 207 khớp snapshot; sequence `auto_error_id_seq` 126 = `max(id)`; không block nào khác phát
   các mã này.
2. Chạy thử nguyên file và lệnh ghi lịch sử trên production rồi `ROLLBACK`: kiểm tra trước/sau đều đạt;
   sau đó block vẫn bản cũ, 74–77 `NULL`, không có mã mới hay lịch sử. Lần thử tiêu số 127 nên id thật
   của mã mới là **128**.
3. Apply 12:12:35, cùng transaction ghi `supabase_migrations.schema_migrations` (statements = nguyên
   file, md5 `4e4c516060eed77603b85a0fd25cd451`). Kết quả: md5 block `83bcdb4081685f2c858f4e0937348767`,
   74–77 `inherit`, dòng 128 đúng cấu hình.
4. Hậu kiểm: `auto_error` 108 dòng; so toàn dòng (trừ `updated_at`) với `before.json`, chỉ 74–77 đổi
   `detail_mode` và thêm 128, 103 dòng còn lại giữ nguyên.
5. Quan sát thật 12:12–13:14: 50 lượt comment thành công bằng block mới, 0 lượt lỗi kiểu cũ (XPath).
   Hai lượt đầu vào nhánh mới lúc 13:11:36 và 13:12:07 đều là **checkpoint** (tài khoản 6796, staff 1482):
   `lỗi` + `err_fb_comment_box_not_found`, không trừ hạn mức, cộng chuỗi lỗi; chiến dịch 50134/50150
   tạm dừng với ghi chú "Dừng sau 4/5 data lỗi/thất bại liên tiếp (ngưỡng 4): Facebook yêu cầu xác minh
   tài khoản (checkpoint)". Tài khoản vẫn hiện "đã đăng nhập" trong app. Chưa có lượt bài không còn/tắt
   bình luận/chờ duyệt/chưa vào nhóm nên câu chữ nhận diện chưa được kiểm trên trang thật.
6. Theo dõi tiếp; đếm theo mã/lý do:

```sql
with c as materialized (
  select id from auto_campaigns where action_id = 'facebook_comment_seeding_post' and is_delete = false
)
select d.error_code, d.data->>'reason' reason, d.status, count(*)
from c join auto_campaign_details d on d.campaign_id = c.id and d.is_delete = false
where d.created_at >= '<thời điểm apply>' and d.action_code = 'fb_comment'
group by 1, 2, 3 order by 4 desc;
```

Mẫu trang chưa nhận ra: thêm `and d.error_code = 'err_fb_comment_box_not_found'` và đọc
`d.data->'headings'`, `d.data->'sample'`.

**Rollback:** [rollback_v472_fb_comment_post_unavailable.sql](../migrations/rollback_v472_fb_comment_post_unavailable.sql)
— chỉ chạy khi block đúng bản V472; trả block về bản cũ, bỏ `detail_mode` của 74–77, tắt mã mới
(giữ dòng vì lịch sử có thể đã tham chiếu).

Tệp: [migration](../migrations/migration_v472_fb_comment_post_unavailable.sql),
[snapshot trước](../migrations/snapshots/fb-comment-post-unavailable-v472/before.json),
[block trước](../migrations/snapshots/fb-comment-post-unavailable-v472/block-2616.before.js) /
[sau](../migrations/snapshots/fb-comment-post-unavailable-v472/block-2616.after.js),
[đoạn thêm](../migrations/snapshots/fb-comment-post-unavailable-v472/comment-unavailable.snippet.js).
