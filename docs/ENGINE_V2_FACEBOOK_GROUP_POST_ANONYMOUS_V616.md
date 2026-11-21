# Đăng bài nhóm Facebook ẩn danh (V616)

Anh yêu cầu 21/11/2026: chiến dịch "Đăng bài vào nhóm" Facebook có ô **Đăng bài ẩn danh**; bật thì ẩn các tuỳ chọn comment; nhóm không cho đăng ẩn
danh thì data chuyển "tạm dừng", ghi rõ nguyên nhân; XPath mới phải duyệt trước và lưu ở `auto_elements`.

## Anh chốt (hộp chọn 21/11/2026)

| Điểm | Chốt |
|---|---|
| XPath | Duyệt cả 2 (giữ chữ tiếng Anh `Post anonymously` chưa thử được) |
| Câu cho khách | `Nhóm này không cho đăng bài ẩn danh` (ghi chú data + dòng Lịch sử hành động) |
| Ẩn thêm khi bật | Kiêm comment (yêu cầu gốc), **Kiêm up tin**, **Đăng bài dạng chia sẻ**. Không đụng "Chạy bằng Page" |
| Facebook đổi giao diện (không thấy công tắc ở mọi nhóm) | Chỉ tạm dừng data, không dừng chiến dịch |

## Facebook thật (đọc 21/11, trình duyệt app, tài khoản thử Lee Danh, chỉ mở hộp soạn bài)

- Nhóm cho đăng ẩn danh (Nhóm private 1 / 2, Nhóm loại việc làm): trang nhóm có nút "Bài viết ẩn danh"; hộp "Tạo bài viết" có công tắc
  `<input role="switch" aria-labelledby="_r_ab_">` cạnh `<span id="_r_ab_">Đăng ẩn danh</span>` (mặc định tắt).
- Bấm công tắc thì trong cùng hộp thoại hiện bảng giới thiệu "Bài viết ẩn danh" với nút `<div aria-label="OK" role="button">`; lần nào mở trang mới cũng
  hiện. Bấm OK thì công tắc `aria-checked="true"`, tên người đăng thành "Thành viên ẩn danh", ô nhập ghi "Gửi bài viết ẩn danh...", nút "Đăng" vẫn
  khớp `fb_post_button`. Bật ẩn danh thì Facebook bỏ nút "Thêm nhóm".
- Nhóm không cho (BẤT ĐỘNG SẢN CHÍNH CHỦ TP.HCM): không có nút "Bài viết ẩn danh", hộp Tạo bài viết không có công tắc, Facebook không ghi chữ nào.
  Vì vậy "nhóm không cho ẩn danh" chỉ nhận ra bằng việc **không thấy công tắc** trong hộp đã mở (anh chấp nhận đánh đổi ở trên).
- Khung trình duyệt app bị ẩn thì Facebook không vẽ khung hình nên bảng OK chỉ hiện khi chụp màn hình; đo thời gian trong khung ẩn không đúng.

## V617: mã riêng khi không bật được công tắc

**V617 đã apply akachat 18:49:08 VN 21/11/2026** theo yêu cầu ("Apply V617"; sổ `20261121114908`, md5 sổ = file `f5b7214a…`, không apply lại;
[biên nhận](../migrations/snapshots/engine-facebook-v617/apply-receipt.json)).

Anh yêu cầu 21/11/2026 ("nếu fb đổi cách bật công tắc thì phải trả mã lỗi rõ ràng"), duyệt qua hộp chọn: câu **"Không bật được chế độ đăng bài
ẩn danh"**; data về hàng đợi, không tính lượt, cộng chuỗi lỗi, 4 data liền thì tạm dừng chiến dịch.

- Block 2923 (bản V616 đóng băng ở `scripts/engine-v2-facebook/v616/`): thấy công tắc, đã bấm (và bấm OK) mà 15 giây vẫn tắt thì trả `ok: false` +
  `actionResult` mã **FB52** `err_fb_group_anonymous_switch_not_enabled` (lớp `ui_changed`) thay vì ném lỗi. `ok: false` để engine chụp ảnh + DOM lỗi.
- Chính sách = FB49 ở đăng nhóm: dòng "thất bại" kèm câu, `requeue`, `increment` (ngưỡng chung 4), `no_count`. Dòng chung của lớp `ui_changed` có
  `requeue_after_minutes` 60 nhưng `report_v1` chỉ dùng trường này với `requeue_after`.
- Phân biệt với FB51: FB51 = không có công tắc (nhóm không cho ẩn danh, hoặc Facebook đổi chính công tắc), FB52 = có công tắc mà không bật được.
- Kiểm: `CHROMIUM_PATH=<Chrome> LC_ALL=C node scripts/engine-v2-facebook/v617-smoke.cjs` 15/15 (PG17: chỉ FB52 đổi quyết định, block đúng code, gỡ trả
  về V616; Chromium: các ca bật được / không có công tắc giữ như V616, không bật được ra FB52); `desktop-fb-smoke.cjs` 62/62, ca V617: 4 data liền ra
  FB52 trước khi gửi, dòng `Không bật được chế độ đăng bài ẩn danh (FB52)` trạng thái thất bại, data "chờ xử lý", không tính lượt, chiến dịch tạm dừng,
  mọi kết quả có mã ảnh lỗi. Không tạo được tình huống Facebook không cho bật trên trang thật nên chưa thử thật.

## Element (`auto_elements`)

| Tên | XPath |
|---|---|
| `fb_group_post_anonymous_switch` | `//*[@role='dialog']//input[@role='switch' and @aria-labelledby=//*[normalize-space(.)='Đăng ẩn danh' or normalize-space(.)='Post anonymously']/@id]` |
| `fb_group_post_anonymous_intro_ok` | `//*[@role='dialog'][.//input[@role='switch']]//*[@role='button' and @aria-label='OK']` |

## Chạy

- Workflow engine 321: `if_composer_opened` (đúng) → **`enable_anonymous`** (block mới `[engine] fb_enable_group_anonymous_post`, chụp ảnh khi lỗi) →
  **`if_anonymous_ready`** (`input.anonymousReady !== false`) → `sleep1` + `select_group_share_targets` như cũ; nhánh sai → `merge_join` như khi không
  thấy ô đăng bài. Biến mới `groupPostAnonymous` (mặc định false).
- Block: không bật ẩn danh thì trả `{ anonymousReady: true }` (không có khoá `actionResult`). Chờ công tắc tối đa 5 giây; không thấy thì trả
  `actionResult` mã **FB51** `err_fb_group_anonymous_post_not_allowed`. Thấy thì bấm, bấm OK khi bảng giới thiệu hiện, chờ tối đa 15 giây tới khi bật;
  không bật được thì ném lỗi "Không bật được chế độ đăng bài ẩn danh" (SYS99 như lỗi block khác) và **không bao giờ bấm Đăng bằng tên thật**.
- FB51: `target_effect = hold` (data "tạm dừng", ghi chú = câu), dòng lịch sử trạng thái 51 "Bỏ qua" với câu, không tính lượt, không cộng chuỗi, chạy
  tiếp nhóm sau, nghỉ như FB40 (`pace_mode full`). Chính sách = FB40 trừ data tạm dừng / bỏ bước còn lại / câu.
- Desktop (`buildVariablesV2`): `groupPostAnonymous = isGroupPostAnonymous(...)` (`src/shared/facebookGroupPostShare.ts`; không áp dụng cho chế độ
  chia sẻ bài nguồn); bật thì `enableComment` = false (không có lượt comment), không chọn nhóm chia sẻ kèm (bộ cũ + engine), không thêm lượt up tin.
- Form (thường + Agent): ô "Đăng bài ẩn danh" đầu mục "Cài đặt thêm" (ẩn ở chế độ chia sẻ bài nguồn). Bật thì ẩn mục Kiêm comment, Kiêm up tin, ô
  Đăng bài dạng chia sẻ; lúc lưu ghi `groupPostAnonymous` và tắt `enableComment` / `enablePostBump` / `enableGroupPostShareToJoinedGroups`. Bỏ ô
  thì các mục hiện lại với giá trị cũ trên form.

## Kiểm

- `CHROMIUM_PATH=<Chrome> LC_ALL=C node scripts/engine-v2-facebook/v616-smoke.cjs` — 18 nhóm: PG17 chạy nguyên văn migration (chỉ FB51 đổi quyết
  định, workflow đi đúng đường, bộ cũ không đổi, không apply lại được, bản gỡ trả về như cũ) + Chromium chạy code block thật trên hộp soạn bài giả
  dựng theo DOM trên (bật được, bảng OK chậm 3 giây, đã bật sẵn, không có công tắc → FB51, Facebook không phản hồi → ném lỗi).
- Chạy đúng code block trên Facebook thật 21/11 (chỉ bật công tắc, không gõ, không đăng): Nhóm private 1 bật được sau 2,1 giây ("Thành viên ẩn
  danh"); nhóm BĐS trả FB51 sau 5 giây, không bấm gì.
- Giả lập bằng bộ lập lịch Desktop thật (`LC_ALL=C node scripts/engine-v2-facebook/desktop-fb-smoke.cjs`, 61/61; riêng ca V616:
  `FB_DESKTOP_ONLY=V616`): DB thử nạp đúng câu mã + chính sách của V616, workflow như production sau V616 với code block thật, trang giả.
  - Nhóm không cho ẩn danh, 5 data liền: cả 5 ra FB51 trước khi gửi, data "tạm dừng", ghi chú và dòng lịch sử "bỏ qua" là
    `Nhóm này không cho đăng bài ẩn danh (FB51)`, tiến trình `❌ Đăng bài group "Nhóm 1": Nhóm này không cho đăng bài ẩn danh (FB51)`; không bấm
    công tắc / Đăng; không tính lượt; chuỗi lỗi 0; chiến dịch không tạm dừng.
  - Nhóm cho ẩn danh: thứ tự bấm công tắc → OK → Đăng; chiến dịch còn lưu bật comment + chia sẻ kèm vẫn không comment, không chia sẻ (biến
    `groupPostAnonymous` true, `enableComment` false, `commentIterations` rỗng, `enableGroupPostShareToJoinedGroups` false); tính 1 lượt.
  - Chiến dịch không bật ẩn danh chạy workflow mới như trước (không bấm công tắc, vẫn 2 comment).
  - Facebook không bật công tắc: không bấm Đăng; ra SYS99 như mọi block lỗi khác (dòng lịch sử `Có lỗi xảy ra (SYS99)`, data đóng, chuỗi lỗi +1).
- Đăng thật 21/11 (trình duyệt app, tài khoản thử Lee Danh, Nhóm private 1, anh cho phép): chạy nguyên code production của mở ô đăng bài (2844),
  block mới, bấm Đăng (2847), xác nhận (2871), đóng popup (2872), lấy link (2873); bước gõ dùng thao tác gõ thật của trình duyệt (block 2845 cần API
  riêng của app). Hàm block dựng bằng thẻ `<script>` mang nonce của trang để không bị CSP chặn. Kết quả: bật ẩn danh 1,9 giây, form đóng 1,5 giây
  sau khi bấm Đăng, bài lên ngay (tài khoản là quản trị viên), link lấy được
  `https://www.facebook.com/groups/164469482423151/posts/1425127723023981/` đúng bài vừa đăng; trang bài ghi "Bài viết của Thành viên ẩn danh",
  không có tên Lee Danh. Trang `my_pending_content` của quản trị viên báo "Bạn hiện không xem được nội dung này" nên bước dò chờ duyệt coi là đăng
  thành công.
- `post-bump-fixes-smoke.cjs` 8/9 (nhóm "bài bị gỡ (mã nguồn)" hỏng sẵn trên `origin/dev_3`); hai typecheck, build.

## Chưa làm / còn hở

- Mới đăng thật bằng tài khoản quản trị viên (bài lên ngay). Chưa biết với thành viên thường bài ẩn danh có vào chờ duyệt không; nếu có mà chiến dịch
  bật "Rời group chờ duyệt" thì tài khoản có thể rời nhóm sau mỗi bài. 4 nhóm thử của anh không có nhóm nào tài khoản thử chỉ là thành viên mà có ô
  đăng bài thường (nhóm mua bán dùng "Bán gì đó").
- Công tắc không bật được thì khách chỉ thấy câu chung "Có lỗi xảy ra (SYS99)" (câu của block nằm trong tín hiệu, không hiện cho khách).
- Tài khoản "chạy ngẫu nhiên" chạy bộ cũ (workflow 1, không đổi) nên chiến dịch ẩn danh trên tài khoản đó đăng bằng tên thật (21/11: 1 tài khoản,
  0 chiến dịch đăng nhóm). Desktop < 9.9.0 cũng chạy bộ cũ nhưng không có ô chọn.
- Chữ tiếng Anh `Post anonymously` chưa thử; nhóm có hộp đăng bài dạng form trong trang (không phải hộp thoại) sẽ không thấy công tắc → FB51.

## Triển khai

**V616 đã apply akachat 17:50:51 VN 21/11/2026** theo yêu cầu ("Apply V616"; sổ `20261121105051`, md5 sổ = file `6a42a2ee…`, không apply lại;
[biên nhận](../migrations/snapshots/engine-facebook-v616/apply-receipt.json)). Desktop nạp workflow một lần khi mở unit nên chỉ unit mở sau lúc apply
mới có node mới; lượt thật đầu qua node mới 17:51 VN (chiến dịch 60044 / 60195: `anonymousReady: true` trong 1–2 ms, đăng như cũ). Desktop có ô chọn
chưa build / phát hành.


Apply V616 (chỉ dữ liệu, không DDL) trước rồi phát hành Desktop có ô chọn; ngược lại thì chiến dịch bật ô chạy workflow chưa có node ẩn danh và đăng
bằng tên thật. Sinh lại: `node scripts/build-v616-sql.cjs`; kiểm lại sổ migration ngay trước khi apply (V615 đã bị lấy trong lúc làm).
