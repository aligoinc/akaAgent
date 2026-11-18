# V572: comment theo mã bài của hộp thoại (engine v2 Facebook, đăng nhóm kèm comment)

18/11/2026. Anh: "Làm bản sửa" (sau khi gỡ V568 lúc 12:31 VN), rồi "Apply rồi tạo PR". **Đã apply akachat lúc 13:53:56 VN 18/11** (sổ `20261118065344`, md5 sổ = file `dd09d472…`, 0 lỗi 5xx; không apply lại). [Biên nhận](../migrations/snapshots/engine-facebook-v572/apply-receipt.json). Code ở PR [#701](https://github.com/aligoinc/akaAgent/pull/701) (nhánh `claude/fb-engine-comment-dialog-post`, chưa merge).

## Tóm tắt

- **Chỉ sửa bản engine** `[engine] fb_comment_at_position` (block 2851) bằng dữ liệu DB.
  - Bộ cũ (block 34) không đổi.
  - Desktop không cần phát hành vì đọc code block mỗi lượt.
- **Vòng comment của workflow đăng nhóm** (kể cả lượt bỏ qua đăng vì nhóm đã biết cần duyệt) chạy như sau:
  1. Bấm ô bình luận của bài.
  2. Đọc mã bài của hộp thoại vừa mở: bấm thì link trang đổi ngay sang `/groups/<nhóm>/permalink/<mã bài>/`.
  3. Quyết định comment hay bỏ qua theo mã đó.
- **Comment seeding và các workflow khác** giữ y V563.
- **Sinh code:**
  - Bộ sinh: `scripts/build-v572-sql.cjs`.
  - Phần code mới: `scripts/engine-v2-facebook/v572-comment-target.fragment.js`.
  - Mốc kiểm: `scripts/fixtures/engine-v2-facebook/v572-live-20261118.json`, đọc production 06:01 UTC 18/11 sau khi gỡ V568.
  - md5 block: `06889369…` (V563) → `16e51c5de52e79d246e87058a65e63eb`.
  - md5 migration `dd09d472…`, bản gỡ `a8a9bb21…`.
  - Code block không ghi số migration trong chú thích, nên đổi số không làm đổi md5 code.
- **Số migration: V572.** Lúc làm lấy V570, nhưng 13:50 VN 18/11 sổ production đã có:
  - V569 `aka_assistant_core_guard` (apply 13:07 VN) và V570 `aka_assistant_data_prompt` (13:10 VN);
  - V571 `engine_target_check` (13:42 VN).
  - Phiên `aka_assistant` còn lấy số liên tục, nên phải kiểm lại sổ ngay trước khi apply.

## Facebook thật làm gì

Thử ngày 18/11 trên trình duyệt thử, tài khoản "Quang", nhóm "Nhóm private 1". Các bước dò không gửi gì, trừ phần thử comment thật ghi ở dưới.

- **Link bài trong feed chưa nạp.**
  - Link mốc thời gian là `?__cft__[0]=…`; phải có focusin mới nạp link thật. Block lấy link 2873 làm vậy với bài vừa đăng.
  - Chỉ bài đã có comment mới có link chứa mã bài, là link của comment.
  - Vì vậy hàm `postIdOf` (V563/V568) gán một mã cho nhiều bài. Đây là lý do gỡ V568.
- **Bấm ô bình luận của một bài**, khi trang đã mở đủ lâu:
  - Link trang đổi ngay trong cú bấm (`pushState`) sang `/groups/164469482423151/permalink/<mã>/`.
  - Hộp thoại mở với ô nhập "Bình luận dưới tên …".
  - Bấm lại ô của chính bài đang mở thì không đổi gì.
- **Hộp thoại đang mở mà bấm ô của bài khác:** link đổi ngay, còn nội dung hộp thoại đổi sau 0,08–0,5 giây.
  - Hai bài khác người đăng: ô nhập được tạo mới.
  - Hai bài cùng người đăng: ô nhập giữ nguyên phần tử.
  - Mã theo dõi `__cft__` trong link của hộp thoại luôn đổi theo bài.
  - Gõ trước khi nội dung đổi xong là comment vào bài cũ.
- **Trong hộp thoại có nút "Bình luận về bài viết của …"**, khớp phần tử `fb_comment_box_at_n`. Bấm theo vị trí là có thể trúng nút này và comment lại bài đang mở.
- **Hộp thoại mở thì trang nền bị khoá cuộn**, `window.scrollBy` không có tác dụng. Escape (phát trên ô nhập hoặc tiêu đề hộp thoại) đóng hộp thoại, link về trang nhóm.
- **Feed nạp dần:** lúc mở chỉ 1–3 bài, cuộn mới nạp thêm, bài trôi xa phía trên bị gỡ khỏi trang.
- **Thứ tự feed ("Phù hợp nhất") đổi:** bài vừa được comment có thể lên đầu ở lần mở trang sau.
- **Bấm ô khi trang nhóm vừa tải** (6–11 giây sau khi tải; 17–29 giây thì bình thường):
  - Facebook không mở hộp thoại mà chuyển hẳn sang trang riêng của bài.
  - Phía sau trang đó là trang chủ, có ô bình luận của **bài ngoài nhóm** (ví dụ "Bình Dương 24H").
  - Bộ cũ và V563 chọn ô theo vị trí nên ở trạng thái này có thể comment vào bài ngoài nhóm, hoặc comment lại bài đang mở.
  - Rê chuột lên ô trước khi bấm không giúp gì.

## Cách chọn bài của V572

### Comment bài khác

Chế độ "Không comment vào post của mình", và các vị trí 2..N của "Comment tất cả".

1. **Ghi nhóm của trang.** Lượt comment đầu ghi nhóm trong link vào `vars.__akaCommentGroupKey`.
   - Trang không có feed của nhóm này (đang ở trang riêng của bài) thì mở lại `https://www.facebook.com/groups/<nhóm>/`.
   - Trang mở chưa đủ 25 giây thì chờ đủ.
2. **Chọn ô kế tiếp** theo thứ tự trên trang: ô chưa thử, đang hiện, không nằm trong hộp thoại.
3. **Bấm ô đó và đọc link trang.**
   - Link không đổi (cùng bài đang mở, bấm không ăn) hoặc bài thuộc nhóm khác: bỏ ô đó.
   - Bài là bài vừa đăng: bỏ. Bài vừa đăng nhận theo link lấy sau khi đăng; chưa có link mà bài không chờ duyệt thì bài đầu tiên trên trang là bài vừa đăng, giống vị trí 2..N+1 của bộ cũ (nhớ mã, không comment).
   - Bài đã comment hoặc đã thử comment trong lượt (`vars.__akaCommentedPostIds`): bỏ.
   - Mỗi ô đã bấm được gắn dấu để lượt sau khỏi bấm lại.
4. **Bài mới thì chờ hộp thoại đổi xong:** ô nhập cũ bị thay, hoặc mã `__cft__` của hộp thoại đã đổi. Xong mới gõ, theo đúng cách của V563: nghỉ 2 giây, dán, Enter.
5. **Hết ô chưa thử** thì đóng hộp thoại (Escape, rồi nút "Đóng") và cuộn cho feed nạp thêm.
   - Mỗi lượt comment tối đa 6 lần cuộn và 12 cú bấm.
   - Vẫn không có bài mới thì bỏ qua lượt: không comment, không dòng lịch sử, như khi bỏ qua comment bài của mình.

### Comment bài của mình

1. Chọn ô như V563 (mã bài trong khung chứa ô).
2. Bấm rồi đọc link. Link là bài khác thì không comment, đúng luật V563: "thấy đúng bài mới comment".
3. Không đọc được link thì làm như V563.

### Kết quả bước

- Kết quả bước có thêm `commentPostId`, là mã bài block đã comment, dùng khi tra lỗi.
- Bỏ qua lượt bài khác trả `otherPostSkipped`, bộ dựng lịch sử không ghi dòng.
- Câu bỏ qua chỉ hiện ở bảng thử workflow của admin (`helpers.log`), không tới khách.

Mọi lệnh đọc trang sau cú bấm đều chịu lỗi, vì trang có thể đang chuyển. Bước sau tự quay về trang nhóm.

## Kiểm

### Bài kiểm trên trang giả

- **Lệnh chạy:** `CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/v572-smoke.cjs`. Lần chạy 18/11 đạt 17/17 nhóm, cả trước và sau khi đổi số.
- **Trang giả** `scripts/engine-v2-facebook/fb-group-fake.cjs` làm theo đúng các hành vi ở trên và ghi lại comment thật rơi vào bài nào.
- **Đồng hồ ảo:** thời gian nghỉ của block được cộng vào `performance.now()` của trang.
- **Tình huống** (so V563 và V572):

| Tình huống | V563 (đang chạy) | V572 |
|---|---|---|
| "Không comment vào post của mình" 3, bài mình trên cùng | P1, P1, P2 | P1, P2, P3 |
| "Comment tất cả" 3, không chờ duyệt | mình, mình, P1 | mình, P1, P2 |
| App ghi chờ duyệt mà bài mình vẫn hiện (vị trí 1–3) | P1, P1, P1 | P1, P2, P3 |
| Chưa lấy được link bài mình | P1, P1, P2 | P1, P2, P3 (bài đầu là bài mình) |
| Bỏ qua đăng vì nhóm đã biết cần duyệt | P1, P1 | P1, P2 |
| 5 comment, feed nạp dần (phải đóng hộp thoại, cuộn) | P1, P1, P2 | P1, P2, P3, P4, P5 |
| Hết bài (2 bài, 4 lượt) | P1, P1, P2 | P1, P2, rồi bỏ qua 2 lượt |
| Trang vừa tải (bấm sớm thì chuyển hẳn trang) | mình, mình | mình, P1, P2 (quay về trang nhóm) |
| Chỉ một mã bài đọc được, có bài nổi bật nằm trên | comment nhầm bài nổi bật | không comment (bỏ qua bài mình) |
| Hộp thoại không đổi sang bài vừa chọn | P1, P1 | P1, rồi bỏ qua lượt |
| Hai bài liền nhau cùng người đăng (ô nhập giữ nguyên) | P1, P1, P1 | P1, P2, P4 |
| Comment seeding (không phải vòng comment đăng nhóm) | giống nhau | giống nhau |

- **Thêm:** mã bài block ghi lại khớp với bài trang giả ghi nhận comment, ở mọi tình huống.
- **SQL trên PG17**, dùng DB thử sau V563:
  - preflight từ chối khi block, danh mục bước hoặc block bộ cũ lệch;
  - apply chỉ đổi block 2851 và md5 đã duyệt của dòng danh mục bước 6;
  - apply lại bị từ chối;
  - gỡ về đúng V563, gỡ lại bị từ chối, sau đó apply lại được.

### Thử comment thật trên Facebook

Ngày 18/11, trình duyệt thử, tài khoản "Quang", "Nhóm private 1". Anh đồng ý comment thật ở nhóm thử.

- **Cách chạy:** chạy đúng code block trên trang Facebook thật. `page.*` được chép từ `pageController.ts`; Enter là phím giả lập như engine.
- **Lượt chạy bằng bản trước khi bọc lỗi** (`7d1afd3e`):
  - R1, "Không comment vào post của mình" 3, bài Flyby đóng vai bài vừa đăng: bỏ Flyby, comment …083421, …400840, …067827.
  - R2b, "Comment tất cả" 2, Flyby là bài vừa đăng (link nạp như 2873): comment Flyby, rồi bỏ Flyby không cần bấm lại, comment …083421.
  - R3, chưa có link bài vừa đăng: bấm Flyby, nhận là bài mình, không comment; comment …083421.
  - R2, cố ý đặt sai mã bài mình: không comment bài mình, đúng như V563; comment Flyby.
- **Lượt R5 bằng bản cuối** (`2a884e5e`), "Comment tất cả" 3, bài …083421 đứng đầu feed làm bài vừa đăng, feed chỉ nạp 1 bài lúc mở: comment …083421, …067827, …400840.
- **Bản apply (`16e51c5d`) chỉ khác bản `2a884e5e` ở dòng chú thích** (bỏ số migration khi đổi V570 → V572). Bỏ các dòng `//` thì hai bản giống hệt nhau (md5 `efc71678…`).
- **Thử khô** (không gõ, không gửi):
  - 8 comment liền: 8 bài khác nhau, một lần đóng hộp thoại và cuộn.
  - Lượt bỏ qua đăng vì nhóm đã biết cần duyệt: 2 bài khác nhau.
- **Soát trên từng bài:** mỗi lượt để lại đúng 1 comment trên mỗi bài, không bài nào bị comment 2 lần trong cùng một lượt; bài nhận comment khớp `commentPostId`.
  - Trang riêng của bài vẽ comment hai lần (một bản ẩn), nên phải đếm trong hộp thoại.
  - Tổng cộng 10 comment thử, đều ghi "[Thử engine V570] … vui lòng bỏ qua".

## Chưa kiểm

- **Chưa chạy qua Desktop thật** (Electron, cửa sổ chạy ngầm). Thử thật chạy code block trên trình duyệt thường. Phía engine chỉ ghi `navigate` vào vết thao tác, không có xử lý riêng.
- **Chưa thử trên Facebook thật** các trường hợp:
  - comment bằng Page;
  - giao diện tiếng Anh;
  - bài vừa đăng nằm trong khung "bài vừa đăng" phía trên feed. Thử thật đóng vai bằng bài cũ có sẵn trong feed.
- **Mốc 25 giây đo trên một máy, một mạng.** Mạng chậm thì có thể vẫn chuyển hẳn trang. Khi đó block bỏ qua bài ngoài nhóm và quay về trang nhóm; trang giả đã thử đường này, Facebook thật thì chưa.

## Apply và gỡ

- **Apply** (đã làm 13:53:56 VN 18/11; cách làm, để tham khảo):
  1. Kiểm sổ migration và `git log --all`. Số đã bị lấy thì đổi tên trong bộ sinh rồi chạy lại; code block không đổi.
  2. Sinh file bọc: `node scripts/make-migration-ledger-apply.cjs migrations/migration_v572_engine_facebook_comment_dialog_post.sql migration_v572_engine_facebook_comment_dialog_post <file ra>`.
  3. Chạy: `supabase db query --linked --workdir /Users/lequangnhut/Repos/akaAgent -f <file ra>`.
  4. Đối chiếu md5 sổ với md5 file.
- **Gỡ:** `migrations/rollback_v572_engine_facebook_comment_dialog_post.sql`. Chỉ chạy khi block đang đúng bản V572; trả code và md5 đã duyệt về V563.
