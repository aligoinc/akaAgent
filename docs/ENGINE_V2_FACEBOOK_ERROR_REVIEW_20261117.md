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
| Đổi sang Page để đăng ("Không tìm thấy nút mở menu profile/page") | ~60 chiến dịch dừng, nhiều nhất 24–28/10, nay 1–7/ngày | XPath nút tài khoản vẫn khớp trên trang thật (tài khoản cá nhân); chưa rõ ca còn lại | Chưa sửa: tài khoản thử LD có Page "Flyby" (thấy 17/11), chưa chạy chiến dịch bật "Chạy bằng Page" bằng engine |
| Bài đăng không kèm ảnh / video (khách báo 31/10–06/11) | Không đếm được từ DB | Block chỉ kiểm số tệp đưa vào ô chọn, không kiểm ảnh đã lên. Thử thật 17/11 (xem bảng dưới): bài 10 ảnh + video và bài 3 ảnh + video 15 MB giữ đủ media | Không tái hiện được, không sửa |
| Gõ tiếng Việt trong app, đăng nhập / cập nhật app | Tin khách | Không thuộc phần chạy chiến dịch | Ngoài phạm vi |

Bài học đo: đếm comment nhầm bài phải ghép mỗi comment với **lần đăng ngay trước** của cùng data. Ghép theo `input_data_id` thì data đăng
lặp nhiều ngày bị nhân lên (lần đầu ra 849 / 3.686 lượt "nhầm" trong 7 ngày, thực tế 13). Và phải đếm cả lượt **không lấy được link bài**
(lần đầu em bỏ ra ngoài, đó lại là chỗ comment nhầm nhiều nhất: bài video).

## Các lỗi anh gửi thêm 17/11 (danh sách khách báo)

| Khách báo | Điều tra | Kết luận | Engine v2 |
|---|---|---|---|
| Bài đăng mất ảnh / video (03–08/11) | Lượt đăng nhóm của các khách này: bước tải ảnh đưa đủ 1 / 5 / 9 / 13 tệp vào ô chọn, bài báo đăng thành công. "Form đăng bài chưa đóng" không tăng theo số ảnh (bài không ảnh 5,4%, có ảnh 1,3–1,8%). Video khách dùng 30 ngày: trung vị 6,5 MB, p90 10,4 MB. **Thử thật 17/11** (engine, fb LD, "Nhóm private 1"): 10 ảnh + 1 video 0,5 MB (chiến dịch 57671) → bài có đủ 11 mục; 3 ảnh + 1 video 15 MB (57673) → đủ 4 mục | Không tái hiện được khi mạng ổn. Chiến dịch chọn "Ngẫu nhiên N ảnh" thì mỗi bài chỉ N ảnh (theo thiết kế). Khách 08/11 "cắt mất ảnh với nội dung": nội dung có dấu "\|" (dòng dưới). Block chỉ kiểm số tệp đưa vào ô chọn, không kiểm ảnh đã lên | Không sửa (chưa có lỗi để sửa); có ca mới thì lấy ảnh lỗi engine (Q12) xem đúng chữ Facebook hiện |
| Dấu "\|" thành "/", một bài thành 2 nội dung; bài bị chia đôi, mỗi nhóm một nửa (28/10, 05/11, 08/11) | Nội dung đăng nhóm của cả 4 tổ chức khách báo đều có 1–2 dấu "\|". Ở nội dung cơ bản "\|" là dấu tách nhiều nội dung (mỗi bài lấy một phần); code không có chỗ đổi "\|" thành "/" | Theo thiết kế, khách hiểu nhầm (hỗ trợ đã nhiều lần giải thích; muốn giữ dấu thì gõ `\|` hoặc dùng nội dung nâng cao) | Không thuộc engine; đề xuất form báo trước "nội dung sẽ tách thành N bài" khi có "\|" (sửa chung cả bộ cũ, cần anh duyệt) |
| Comment nhầm bài người khác, nhất là bài video | Như bảng trên. **Tái hiện thật 17/11** (engine chưa có V563, chiến dịch 57671): bài 10 ảnh + video không lấy được link, comment rơi vào bài cũ khác trong nhóm (`permalink/1421215170081903`, bài thử lúc 17:05), lịch sử ghi "Đã comment vào bài của mình" | Lỗi thật | Sửa ở V563 |
| "Không dùng Page mà vẫn đăng bằng Page" (24/10) | Mọi bước kiểm / chuyển danh tính trong workflow chỉ chạy khi chiến dịch bật "dùng Page" (13 node `page_identity_*` của 6 workflow đều có điều kiện `vars.runAsPage === true`; đăng trang cá nhân, nhắn tin, newsfeed không có bước danh tính nào); hôm đó hỗ trợ chuyển Page bằng tay trong trình duyệt. **Tái hiện thật 17/11**: chuyển fb LD sang Page "Flyby" trong tab trình duyệt của app, chạy chiến dịch đăng nhóm không bật "Chạy bằng Page" (57675) → bài `posts/1421335610069859` hiện "Bài viết của Flyby - Thuốc giải độc rượu bia"; đã chuyển LD về trang cá nhân ngay sau đó | Theo thiết kế (anh chốt 17/11: "ko bật page thì ko cần check gì đâu, vì có trường hợp khách cố tình chuyển qua page để chạy page"): chiến dịch không bật "Chạy bằng Page" thì chạy theo danh tính đang có của phiên trình duyệt, không kiểm, không đổi | Không sửa (bộ cũ lẫn engine) |
| Chuyển Page hay lỗi, phải vào trình duyệt bật Page (24–26/10) | Lỗi tăng 24–28/10, XPath nút tài khoản sửa 27/10, nay 1–7 chiến dịch/ngày; XPath vẫn khớp trang thật | Đã sửa phần lớn 27/10 | Phần còn lại cần thử như dòng trên |
| Không thêm được Page, tải Page không ra | Hỗ trợ: tài khoản đang bị Facebook đòi xác minh 2 bước ở Business Suite | Không thuộc phần chạy chiến dịch | Ngoài phạm vi |
| "Lỗi vài comment mà dừng cả chiến dịch", "treo máy quay lại thì đã dừng mấy tiếng" (03/11); anh báo lại 17/11 "đăng bài kiêm comment nhưng comment thất bại lại đi dừng chiến dịch" | 30 ngày: 14 chiến dịch đăng nhóm tạm dừng với ghi chú về comment, 3 đường khác nhau. (1) Tổ chức 518 (5 chiến dịch, "comment tất cả"): chiến dịch bật "bỏ qua nhóm cần duyệt", nhóm đã biết cần duyệt thì không bấm Đăng (`fb_skip_group_post_for_known_approval`, không có dòng "Đăng bài") nhưng vòng comment vẫn chạy; comment hỏng (XPath ô bình luận 30/10–01/11) bị cộng chuỗi vì data không có kết quả gửi nào, dừng sau 4 data (đọc lượt 4900757 chiến dịch 46878). Bộ cũ chỉ bỏ qua comment lỗi khi data đã đăng thành công (`targetOnlyFailure`, actionResultRuntime.ts), engine tới V562 cũng vậy (`streak_after_delivery`). (2) Tổ chức 701: ghi dòng comment lỗi mạng "fetch failed" → bộ cũ coi là lỗi ghi kết quả, tạm dừng. (3) Tổ chức 1231 (17/11): FB03 "Facebook báo giới hạn tần suất comment" → chính sách bộ cũ tạm dừng chiến dịch ngay | Lỗi thật | (1) và (3) sửa ở V563, chỉ chiến dịch đăng nhóm: comment không cộng / không đặt lại chuỗi data lỗi (chuỗi chỉ theo đăng bài); FB03 khi comment không tạm dừng, chạy tiếp (anh chọn "Chạy tiếp ngay"). (2) engine đã khác: DB từ chối / lỗi khi báo kết quả chỉ dừng lượt, lượt sau chạy tiếp, không tạm dừng chiến dịch. Comment seeding (comment là thao tác chính) vẫn dừng sau 4 data lỗi liên tiếp như bộ cũ |
| Nhóm "chỉ có nút Mua bán" làm dừng chiến dịch; khách 09/11 "gần 2 tuần không đăng được" | Tổ chức của khách: lỗi tính chuỗi 28/10–04/11, từ 04/11 ghi "bỏ qua" không tính; sau đó đăng đều 400–1.500 bài/ngày tới 17/11 | Đã sửa 04/11 (anh chốt 17/11 giữ "bỏ qua") | Không sửa lại |

## V563 (đã apply akachat 17/11 20:03:02 VN, `20261117130301`, không apply lại)

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
5. Đăng nhóm kiêm comment (anh báo 17/11 "comment thất bại lại đi dừng chiến dịch, fix lỗi này luôn"): 2 dòng `auto_outcome_policies` chỉ cho
   chiến dịch `facebook_group_post`, thao tác `fb_comment`:
   - dòng chặn theo thao tác (áp sau cùng): `target_streak_effect = ignore`. Kết quả comment (thành công lẫn lỗi) không cộng / không đặt lại
     chuỗi data lỗi, chuỗi chỉ theo kết quả đăng bài. Mã chung có ngưỡng (SYS99, SYS04, ngưỡng chung theo `err_undefined`) vì thế không dừng
     chiến dịch vì comment. Khác trước: data bị bỏ qua đăng (nhóm cần duyệt) mà comment thành công không còn đặt lại chuỗi.
   - FB03 (Facebook báo bình luận quá nhanh): `campaign_effect = none`, `run_effect = continue` (bộ cũ / engine tới V562: tạm dừng chiến dịch,
     không khoá thao tác). Data sau vẫn đăng bài và vẫn thử comment (anh chọn "Chạy tiếp ngay").
   - Khoá thao tác, trạng thái đăng nhập, tạm dừng tài khoản, ghi lịch sử, tính lượt của comment giữ như cũ; comment seeding không đổi
     (postflight và bài kiểm so chính sách hiệu lực trước / sau ở mọi mã, pha, loại chiến dịch có comment).

Kiểm: `CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/engine-v2-facebook/v563-smoke.cjs` (16 nhóm:
3 block, block chỉnh comment so với code bộ cũ ở 11 ca, chạy code block comment mới trong Chromium với trang mô phỏng tường nhóm (bài vừa đăng ở trên / chưa hiện / có bài ghim đứng trước /
có chia sẻ bài khác / chưa lấy được link / link chờ duyệt, bài khác rơi vào bài mình, comment seeding như bộ cũ), dấu hiệu, preflight chặn khi
lệch, apply, chính sách hiệu lực FB11 = FB40 ở mọi pha và trạng thái, chính sách comment trước / sau chỉ đổi ở chiến dịch đăng nhóm, thao tác
khác không đổi, apply lại bị từ chối, gỡ rồi apply lại),
`node scripts/engine-v2-facebook/desktop-fb-smoke.cjs` (28 nhóm; thêm ca FB11, ca block chỉnh comment V563 thật chạy qua bộ lập lịch +
bộ dựng lịch sử của engine: chưa có link thì có câu ⚠️, không dòng comment, không bấm ô bình luận; "comment tất cả" còn lượt bài khác; có link
thì comment như cũ; và hai ca comment hỏng chạy hai lần (tắt rồi bật 2 dòng chính sách comment): bài bị bỏ qua mà comment hỏng 5 data liền thì
trước V563 dừng sau 4 data, sau V563 không dừng, 5 data hoàn thành; FB03 khi comment sau khi đăng thì trước V563 dừng ngay, sau V563 cả 3 data
đều đăng). Gỡ:
`migrations/rollback_v563_engine_facebook_signs_search.sql` (chỉ chạy khi đang đúng bản V563).

## Thử thật sau khi apply V563 (17/11 20:04–20:15 VN)

Tài khoản fb LD (id 135, tổ chức 1), "Nhóm private 1", app chạy từ nhánh `claude/fb-engine-v2-error-fixes`, engine bật cho tổ chức 1.

| Chiến dịch | Cài đặt | Kết quả |
|---|---|---|
| 57682 | 10 ảnh + 1 video, comment "bài của mình" | Đăng thành công; bài video chưa lấy được link (`fb_get_first_group_post_link` `ok: false`). Block chỉnh comment trả `skippedByGroupMode: true`, khách thấy "⚠️ Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình tại "Nhóm private 1""; không có bước comment, không dòng lịch sử comment, chỉ một kết quả `fb_post_group`; chiến dịch hoàn thành. Trước V563 (57671) comment rơi vào bài cũ khác |
| 57686 | 10 ảnh, "comment tất cả", tối đa 2 | Đăng thành công, lấy được link `posts/1421359133400840`. Comment 1 nằm đúng bài vừa đăng (`permalink/1421359133400840`), comment 2 nằm ở bài thử cũ khác (`permalink/1421199990083421`); mở cả hai trên Facebook thấy đúng chữ comment |
| 57688 | Chạy bằng Page "Flyby", không comment | Lượt chạy đọc danh tính ban đầu "Lee Danh", chuyển sang "Flyby - Thuốc giải độc rượu bia", đăng thành công (`posts/1421362446733842`, Facebook hiện "Bài viết của Flyby - Thuốc giải độc rượu bia"); lượt trả danh tính chuyển về "Lee Danh". Lần đầu engine đăng bằng Page trên Facebook thật (V563 không đổi phần Page) |

Không thử thật được, đã kiểm bằng bộ kiểm: FB11 (4 nhóm thử của LD đều đã tham gia), tìm nhóm bằng search giao diện tiếng Anh (phải đổi ngôn
ngữ tài khoản), comment hỏng nhiều data liền và FB03 (không tạo được thật).

## Việc cần ảnh lỗi / chữ thật (để sau)

Engine đã có ảnh lỗi theo yêu cầu (Q12) khi chạy cho tổ chức khách. Khi bật engine cho tổ chức có các ca FB41 (up tin), inbox Page, "Form đăng
bài chưa đóng", đổi sang Page thì lấy ảnh các ca này, xem đúng chữ Facebook hiện ra, rồi mới thêm dấu hiệu / sửa block (theo nguyên tắc anh
chốt 17/11: chỉ phát mã cụ thể khi thấy dấu hiệu có mặt).
