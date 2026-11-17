# Rà soát lỗi Facebook 30 ngày cho engine v2 (17/11/2026)

Anh yêu cầu 17/11: rà lỗi Facebook 30 ngày và tin khách báo lỗi, tìm lỗi thật sửa được, sửa cho engine v2, **không đụng bộ cũ**, và
**không sửa lại lỗi đã có người sửa**. Mọi số liệu đọc chỉ đọc trên production (akachat), không ghi DB.

## Nguồn và cách kiểm

- Lịch sử hành động (`auto_campaign_details`) của 16.420 chiến dịch Facebook chạy trong 17/10–17/11 (đăng nhóm 6.080, up tin 7.223…):
  khoảng 58 nghìn dòng "lỗi" / "thất bại", cộng dòng "bỏ qua" của đăng nhóm. Lý do tạm dừng (`auto_campaigns.note`) của chiến dịch đang dừng.
  Thẻ nhóm tìm bằng search (`auto_campaign_run_events`, sự kiện `extract_facebook_group_data`, 182 nghìn thẻ).
- Tin khách gửi akaBiz (`message_gom`, nguồn Pancake, account 1001; 30 ngày 33,7 nghìn hội thoại, 2.346 hội thoại nhắc Facebook): đọc các
  câu hỏi bot xếp loại báo lỗi / cần xử lý sự cố của sản phẩm Facebook. Dữ liệu khách chỉ để trong scratchpad, không chép vào repo.
- Trang Facebook thật bằng tài khoản thử của anh (chỉ đọc, không bấm): một nhóm chưa tham gia và hai nhóm đã tham gia, trang tìm nhóm.
- Kiểm "đã sửa chưa": git mọi nhánh (gồm nhánh chưa merge, worktree), sổ migration, block / XPath production sửa trong 10 ngày (không có), và
  số liệu theo ngày tới hôm nay.

## Kết luận từng lỗi

| Lỗi | Số liệu (30 ngày, trừ khi ghi khác) | Kết luận | Engine v2 |
|---|---|---|---|
| Tìm nhóm bằng search, Facebook giao diện tiếng Anh: số bài/ngày đọc ra 0 | 8.865 thẻ / 13 chiến dịch ghi "posts a day"; 27/10 1.656 thẻ và 09/11 4.540 thẻ (1 khách) bị điều kiện "Số bài tối thiểu/ngày" loại hết. Khớp tin khách 09/11 "kết quả trả về đều = 0" (hỗ trợ khuyên đổi từ khoá sang chữ hoa, không đúng nguyên nhân) | **Lỗi thật.** #630 (10/11) chỉ sửa phần hiển thị ở tab Data; block vẫn lọc sai | **Sửa ở V563** (bản "[engine]") |
| Tên nhóm tìm được dính "Profile photo of " | 10.950 tên; tên này đi sang data của chiến dịch khác | **Lỗi thật**, cùng block | **Sửa ở V563** |
| Đăng nhóm "Không tìm thấy ô đăng bài" (FB40, ghi "bỏ qua") | 7 ngày gần: 12.997 lượt / 290 tài khoản. 3 ngày gần: 923 nhóm có tài khoản đăng được, tài khoản khác không; 57 nhóm lỗi với mọi tài khoản (nhiều nhóm mua bán) | Không phải lỗi app: tài khoản chưa vào nhóm (trang thật: nhóm chưa tham gia không có ô đăng bài, có nút "Tham gia nhóm"); nhóm mua bán chỉ có "Bán gì đó" (anh chốt 17/11: chỉ bỏ qua, không đếm) | **V563: báo rõ hơn** bằng dấu hiệu FB11, xử lý giữ y FB40 |
| Comment "bài của mình" rơi vào bài người khác (khách báo 03/11, 05/11; anh nhắc thêm 17/11) | 7 ngày: không lấy được link bài vừa đăng mà vẫn comment 307 lượt ở bài có video (268 lượt đã comment lên một bài, gần như chắc là bài người khác vì bài mình chưa hiện) + 38 lượt bài không video; có link mà vẫn nhầm bài 17 lượt (~0,5%); "comment tất cả" comment lại chính bài mình ở lượt dành cho bài khác 18 lượt | **Lỗi thật**: block comment vào ô thứ N trên trang, không xem ô thuộc bài nào | **Sửa ở V563** (bản "[engine]" của block comment và block chỉnh comment; chưa có link thì bỏ qua kèm câu ⚠️) |
| Link bài đăng "mở không ra bài" (khách báo 06/11) | 7 ngày: 15.704 bài chờ duyệt lưu link `/posts/<id>`, 15.701 link khác nhau | Link là bài của chính tài khoản; bài chưa duyệt thì người khác chưa xem được | Không phải lỗi |
| Comment sau đăng nhóm / seeding không thấy ô bình luận | Tới 2.154 lượt/ngày (05–06/11), hết từ 07/11; nay 5–10% thất bại | Đã sửa (XPath element 13…, 01–07/11) | Không sửa |
| Giới hạn tần suất đăng nhóm (FB02), nút kết bạn ẩn (FB22), checkpoint (FB04) | ~4,6 nghìn; 8,5 nghìn; vài chục | Do Facebook / người nhận | Không phải lỗi |
| Up tin "Không thấy ô bình luận" (FB41) | ~850/tuần từ 06/11, 37 tài khoản | Chưa biết trang hiện gì (block đã nhận ra bài xoá / tắt bình luận / chờ duyệt / chưa vào nhóm) | Chưa sửa: cần ảnh lỗi |
| Inbox Page "Không tìm thấy ô để nhập tin nhắn" | 4.307 dòng / 31 tài khoản (~5% lượt nhắn) | Có thể hội thoại quá hạn trả lời (FB25 đã có câu), chưa thấy chữ thật | Chưa sửa: cần chữ thật / ảnh lỗi |
| Đăng nhóm "Form đăng bài chưa đóng sau 60 giây" | 1.610 dòng / 254 tài khoản, tăng dần | Chưa biết Facebook hiện gì sau cú bấm Đăng | Chưa sửa: cần ảnh lỗi |
| Đổi sang Page để đăng ("Không tìm thấy nút mở menu profile/page") | ~60 chiến dịch dừng, nhiều nhất 24–28/10, nay 1–7/ngày | XPath nút tài khoản vẫn khớp trên trang thật (tài khoản cá nhân); chưa rõ ca còn lại | Chưa sửa: cần tài khoản có Page |
| Bài đăng không kèm ảnh / video (khách báo 31/10–06/11) | Không đếm được từ DB | Block chỉ kiểm số tệp đưa vào ô chọn, không kiểm ảnh đã lên | Chưa sửa: cần thử với tệp thật |
| Gõ tiếng Việt trong app, đăng nhập / cập nhật app | Tin khách | Không thuộc phần chạy chiến dịch | Ngoài phạm vi |

Bài học đo: đếm comment nhầm bài phải ghép mỗi comment với **lần đăng ngay trước** của cùng data. Ghép theo `input_data_id` thì data đăng
lặp nhiều ngày bị nhân lên (lần đầu ra 849 / 3.686 lượt "nhầm" trong 7 ngày, thực tế 13). Và phải đếm cả lượt **không lấy được link bài**
(lần đầu em bỏ ra ngoài, đó lại là chỗ comment nhầm nhiều nhất: bài video).

## Các lỗi anh gửi thêm 17/11 (danh sách khách báo)

| Khách báo | Điều tra | Kết luận | Engine v2 |
|---|---|---|---|
| Bài đăng mất ảnh / video (03–08/11) | Lượt đăng nhóm của các khách này: bước tải ảnh đưa đủ 1 / 5 / 9 / 13 tệp vào ô chọn, bài báo đăng thành công. "Form đăng bài chưa đóng" không tăng theo số ảnh (bài không ảnh 5,4%, có ảnh 1,3–1,8%) | Chưa xác định được: block chỉ kiểm số tệp đưa vào ô chọn, không kiểm ảnh đã lên. Chiến dịch chọn "Ngẫu nhiên N ảnh" thì mỗi bài chỉ N ảnh (theo thiết kế). Khách 08/11 "cắt mất ảnh với nội dung": nội dung có dấu "\|" (dòng dưới) | Chưa sửa: cần đăng thử bài nhiều ảnh / video ở nhóm thử để xem Facebook giữ được mấy ảnh |
| Dấu "\|" thành "/", một bài thành 2 nội dung; bài bị chia đôi, mỗi nhóm một nửa (28/10, 05/11, 08/11) | Nội dung đăng nhóm của cả 4 tổ chức khách báo đều có 1–2 dấu "\|". Ở nội dung cơ bản "\|" là dấu tách nhiều nội dung (mỗi bài lấy một phần); code không có chỗ đổi "\|" thành "/" | Theo thiết kế, khách hiểu nhầm (hỗ trợ đã nhiều lần giải thích; muốn giữ dấu thì gõ `\|` hoặc dùng nội dung nâng cao) | Không thuộc engine; đề xuất form báo trước "nội dung sẽ tách thành N bài" khi có "\|" (sửa chung cả bộ cũ, cần anh duyệt) |
| Comment nhầm bài người khác, nhất là bài video | Như bảng trên | Lỗi thật | Sửa ở V563 |
| "Không dùng Page mà vẫn đăng bằng Page" (24/10) | Mọi bước kiểm / chuyển danh tính trong workflow chỉ chạy khi chiến dịch bật "dùng Page"; hôm đó hỗ trợ chuyển Page bằng tay trong trình duyệt nên chiến dịch không dùng Page đăng bằng Page | Lỗi thật (thiếu bước đưa về trang cá nhân) | Chưa sửa: cần thử với tài khoản có Page (tài khoản thử LD có 1 Page) |
| Chuyển Page hay lỗi, phải vào trình duyệt bật Page (24–26/10) | Lỗi tăng 24–28/10, XPath nút tài khoản sửa 27/10, nay 1–7 chiến dịch/ngày; XPath vẫn khớp trang thật | Đã sửa phần lớn 27/10 | Phần còn lại cần thử như dòng trên |
| Không thêm được Page, tải Page không ra | Hỗ trợ: tài khoản đang bị Facebook đòi xác minh 2 bước ở Business Suite | Không thuộc phần chạy chiến dịch | Ngoài phạm vi |
| "Lỗi vài comment mà dừng cả chiến dịch", "treo máy quay lại thì đã dừng mấy tiếng" (03/11) | Bộ cũ vẫn dừng chiến dịch đăng nhóm vì comment lỗi (02/11: 4, 10/11: 3 chiến dịch) | Bộ cũ cộng chuỗi lỗi cả khi bài đã đăng | Engine đã khác: comment lỗi sau khi đăng thành công không cộng chuỗi (luật chặn theo thao tác `fb_comment`), đăng nhóm không dừng vì comment. Comment seeding vẫn dừng sau 4 data lỗi liên tiếp như bộ cũ (đổi là quyết định chính sách) |
| Nhóm "chỉ có nút Mua bán" làm dừng chiến dịch; khách 09/11 "gần 2 tuần không đăng được" | Tổ chức của khách: lỗi tính chuỗi 28/10–04/11, từ 04/11 ghi "bỏ qua" không tính; sau đó đăng đều 400–1.500 bài/ngày tới 17/11 | Đã sửa 04/11 (anh chốt 17/11 giữ "bỏ qua") | Không sửa lại |

## V563 (chưa apply)

Ban đầu đặt số V562; tối 17/11 sổ production đã có `migration_v562_campaign_agent_prompt_ios` (apply 18:46 VN từ phiên khác) nên đổi
thành V563 (lúc 19:00 VN không nhánh nào trong 4 repo giữ số này). Số chỉ được giữ khi đẩy nhánh: kiểm lại sổ và `git log --all` ngay trước khi apply.

`migrations/migration_v563_engine_facebook_signs_search.sql`, sinh từ `scripts/build-v563-sql.cjs` (nguồn guard:
`scripts/fixtures/engine-v2-facebook/v563-live-20261117.json`, đọc chỉ đọc production 17/11). Chỉ dữ liệu, không DDL. Bộ cũ không đổi: bộ cũ
không nạp block "[engine] …" và không đọc dòng `facebook.error_signs`; block nguồn 2723 giữ nguyên.

1. Bản "[engine] fb_collect_search_groups" (block 2909, md5 `91e809e6…` → `499445e4…`): đọc thêm "N posts a day" / "N post a day" /
   "N posts per day" và bỏ tiền tố "Profile photo of " của tên, đúng như `src/shared/facebookSearchGroupCard.ts`. Chỉ đổi 2 chỗ (bài kiểm trả
   2 chỗ lại thì ra đúng md5 bản đang chạy). Block không có dòng danh mục bước nên không đổi mức cam kết.
2. Bản "[engine] fb_comment_at_position" (block 2851, md5 `30126bae…` → `06889369…`, danh mục bước ghi md5 đã duyệt mới, mức cam kết 2 gửi
   bằng Enter như cũ). Chỉ trong workflow đăng nhóm (`vars.groupPostSubmitted`); comment seeding dùng chung block, giữ y bộ cũ.
   - "Bài của mình" (comment bài của mình, hoặc vị trí 1 của "comment tất cả" khi bài không chờ duyệt): chỉ bấm ô bình luận nằm trong khung bài
     có mã bài trùng link vừa lấy (cách tìm khung bài đã xem trên trang thật 17/11: mỗi nút bình luận ứng với đúng một mã bài). Có link mà không
     thấy (bài chưa hiện trên trang, khung bài có hai mã) thì bỏ qua: không bấm gửi, không ghi dòng lịch sử, không tính lượt, không lấy lượt nội
     dung / gọi AI; ca này khách không thấy câu nào (`helpers.log` của block chỉ hiện ở bảng thử workflow của admin, cả bộ cũ lẫn engine).
   - "Bài khác": ô ở đúng vị trí lại thuộc bài vừa đăng thì lấy ô của bài kế tiếp; còn lại bấm đúng ô thứ N như bộ cũ.
3. Bản "[engine] fb_adjust_group_post_comments_after_pending" (block 2874, md5 `ffeb17c8…` → `f7c07500…`; chạy sau bước lấy link, trước vòng
   comment). Anh chốt 17/11 ("Câu ⚠️, chỉ sửa DB"): chưa lấy được link bài vừa đăng (bài video chưa hiện, Facebook chưa hiện bài; 7 ngày:
   307 lượt bài video + 38 lượt bài không video đã comment khi không có link) thì bỏ lượt "bài của mình", comment bài khác vẫn chạy. Khách thấy
   câu tiến trình "⚠️ Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình tại "<nhóm>"": bộ dựng lịch sử của bộ cũ đã in
   câu ⚠️ khi block này trả `skippedByGroupMode` (chỗ đang in "Bỏ qua comment vì chỉ chọn comment group …"); không ghi dòng lịch sử, không
   tính lượt. Mọi ca khác (có link, chờ duyệt, comment bài khác, chưa đăng xong, không bật comment, chế độ chỉ nhóm chờ duyệt / đăng ngay)
   ra đúng như code bộ cũ. Đo 17/11 (150 nghìn dòng lịch sử gần nhất, 5.454 lượt đăng nhóm thành công): link có dạng `/posts/<số>` 3.003,
   `/pending_posts/` 1.061, trống 1.390, không có dạng `pfbid`, nên đọc mã bài bằng số không bỏ sót bài có link.
4. Dấu hiệu FB11 (thêm vào `facebook.error_signs`, md5 `9eae00aa…` → `7e25dd65…`): đăng nhóm ra FB40 mà trang có nút "Tham gia nhóm" /
   "Join group" thì ra FB11 "Tài khoản chưa vào nhóm này nên chưa đăng bài được" (câu anh duyệt 17/11). Chính sách FB11 khi đăng nhóm là bản
   chép dòng FB40 (ghi "bỏ qua", không tính lượt, không cộng chuỗi, data hoàn thành), như FB14 ở V559. FB11 ở thao tác khác giữ như V559.

Kiểm: `CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/engine-v2-facebook/v563-smoke.cjs` (15 nhóm:
3 block, block chỉnh comment so với code bộ cũ ở 11 ca, chạy code block comment mới trong Chromium với trang mô phỏng tường nhóm (bài vừa đăng ở trên / chưa hiện / có bài ghim đứng trước /
có chia sẻ bài khác / chưa lấy được link / link chờ duyệt, bài khác rơi vào bài mình, comment seeding như bộ cũ), dấu hiệu, preflight chặn khi
lệch, apply, chính sách hiệu lực FB11 = FB40 ở mọi pha và trạng thái, thao tác khác không đổi, apply lại bị từ chối, gỡ rồi apply lại),
`node scripts/engine-v2-facebook/desktop-fb-smoke.cjs` (26 nhóm; thêm ca FB11 và ca block chỉnh comment V563 thật chạy qua bộ lập lịch +
bộ dựng lịch sử của engine: chưa có link thì có câu ⚠️, không dòng comment, không bấm ô bình luận; "comment tất cả" còn lượt bài khác; có link
thì comment như cũ). Gỡ:
`migrations/rollback_v563_engine_facebook_signs_search.sql` (chỉ chạy khi đang đúng bản V563).

## Việc cần ảnh lỗi / chữ thật (để sau)

Engine đã có ảnh lỗi theo yêu cầu (Q12) khi chạy cho tổ chức khách. Khi bật engine cho tổ chức có các ca FB41 (up tin), inbox Page, "Form đăng
bài chưa đóng", đổi sang Page thì lấy ảnh các ca này, xem đúng chữ Facebook hiện ra, rồi mới thêm dấu hiệu / sửa block (theo nguyên tắc anh
chốt 17/11: chỉ phát mã cụ thể khi thấy dấu hiệu có mặt).
