# Up tin Facebook: rà 18/11/2026 và đợt sửa

Rà chỉ đọc trên production (akachat, theo `campaign_id` / `id`), 11/11 00:00 → 18/11 16:04 VN. Các quyết định dưới đây anh chốt qua hộp chọn ngày 18/11/2026.

## Bức tranh 8 ngày

Chiến dịch đăng nhóm đang bật "Kiêm up tin" có 4.183 bài đăng thành công (không tính dòng "đăng dạng chia sẻ"):

| | Số bài | Tỉ lệ | Up tin? |
|---|---|---|---|
| Link `/posts/`, không chờ duyệt | 1.829 | 43,7% | Có. Dòng "✅ Đã thêm N lượt up tin" khớp ~99% |
| Link `/posts/` nhưng bị coi là chờ duyệt | 1.224 | 29,3% | Không |
| Chờ duyệt thật (`/pending_posts/`) | 1.002 | 24,0% | Không (duyệt sau cũng không up) |
| Không lấy được link | 128 | 3,1% | Không |

- Trong 1.224 bài bị coi là chờ duyệt, 1.208 bài chỉ vì trang `…/my_pending_content` trả về một link trỏ về chính trang đó. Đây là link xem trước trong các bài chờ duyệt cũ: `href` tương đối `?__cft__…`, làm sạch thì thành địa chỉ trang. **Anh chốt giữ nguyên** block dò chờ duyệt (31 / engine 2848).
- Bài có video: 92/105 bài không có link, nên không bài video nào được up tin. Bài ảnh 1%, bài chữ 0,4%.
- Lượt up tin đã chạy: 3.526, thành công 2.942. 431 lượt "Không tìm thấy bài": 146 bài không lần nào thấy (bài bị gỡ sau khi đăng; lúc đăng bộ dò đều ghi trang chờ duyệt trống).
- Lượt kẹt lúc 16:04 18/11: 116 chiến dịch up tin "tạm dừng" giữ 9.377 lượt. 58 chiến dịch của tài khoản đã xoá giữ 4.895 lượt.

## Thử thật bài video (16:22–16:27 VN 18/11, Cốc Cốc, tài khoản thử Lee Danh, Nhóm private 1)

- Hai bài thử còn trong nhóm: 1422119009991519, 1422120999991320 (video tự tạo 6 giây).
- Trang nhóm sau khi bấm Đăng chỉ có thẻ "Đang xử lý video – Video trong bài viết đang được xử lý…" (trong `role=main`, ngoài feed), không có link. XPath `GroupPostRawPostLink` / `GroupPostPostLink` trống suốt 145 giây, và trang không tự cập nhật.
- Trang "Nội dung của bạn → Đã đăng" (`/groups/<id>/my_posted_content`, mới nhất trước) hiện bài mới sau 6–14 giây, có nút "Xem trong nhóm" `?multi_permalinks=<mã>`. `/groups/<id>/posts/<mã>/` mở đúng bài. Lúc 5,5 giây, đầu danh sách vẫn là bài cũ.
- **Anh chốt:** bài video không lấy link để up tin. Form cảnh báo khách thay vào đó.

## Đợt sửa ([#711](https://github.com/aligoinc/akaAgent/pull/711), đã merge dev_3 ngày 18/11 theo yêu cầu "Merge PR #711"; nhánh `claude/fb-post-bump-fixes`; thay #680 đã đóng)

Cả bộ cũ lẫn engine đều đi qua các chỗ này: engine tạo lượt up tin bằng đúng `enqueuePostBumpAfterGroupPost` (qua `reportFacebookEngineRows`), và cả hai ghi kết quả comment qua `logExplicitActionResultStep`.

1. **Câu up tin khác nhau trong một bài**: PR #680 / V531 ([POST_BUMP_CONTENT_ROTATION_V531.md](POST_BUMP_CONTENT_ROTATION_V531.md)). Đổi thêm: mỗi bài bắt đầu từ câu ngẫu nhiên (`planPostBumpContentIndexes`), không còn con trỏ câu `postBumpContentRotationIndex`.
2. **Bỏ qua tài khoản đã xoá khi chia lượt** (`resolvePostBumpTargets` / `resolveCreatedPostBumpTargets`).
   - `getAccount` trả null (tài khoản đã xoá, khác nhân viên, hết quyền gói) thì tài khoản đó không nhận lượt và không được tạo chiến dịch up tin mới. Ánh xạ cũ giữ nguyên. Đọc lỗi (mạng) thì giữ như cũ.
   - Chế độ "chọn chiến dịch có sẵn" cũng bỏ chiến dịch của tài khoản đã xoá.
   - Không còn đích nào thì in câu cũ "⚠️ Chưa có chiến dịch up tin để nhận link bài post".
3. **Chiến dịch up tin mới** (`createPostBumpTargetCampaign`):
   - `refreshData: false`.
   - `sleepBetweenActions: 30` giây (trước là 0). Nhóm tài khoản có cài thời gian nghỉ thì vẫn ưu tiên giá trị đó.
4. **Bảo trì ngày mới** (`maintainCampaignSchedules`):
   - Chiến dịch up tin "chờ xử lý" còn lượt chờ: lịch = lượt chờ sớm nhất; lượt đã quá hạn thì lịch = đầu ngày hôm nay, để chạy ngay. Trước đây lịch bị dời về giờ:phút lúc tạo chiến dịch; ví dụ 57420 có 126 lượt quá hạn từ 14:37 17/11 bị dời sang 14:07 18/11.
   - Quy tắc này đứng sau kiểm ngày kết thúc, trước nhánh 23:59 và nhánh hằng ngày. Không còn lượt chờ, hoặc đọc lỗi, thì giữ cách cũ.
   - Không làm mới data của chiến dịch up tin ở mọi loại lịch. Trước đây chiến dịch up tin khách đổi sang lịch tuần bị đặt lại mọi bài cũ về "chờ xử lý" và comment lại 3–4 lần (19362, 53818).
5. **Bài bị gỡ** (`closePostBumpRowsOfMissingPost`, `closePendingPostBumpRowsForPost`): lượt up tin ra `err_fb_comment_unavailable_post_not_found` thì đóng các lượt còn "chờ xử lý" khác cùng `uid` trong cùng chiến dịch up tin. Lượt bị đóng chuyển "hoàn thành", ghi chú bằng câu đã có "Không tìm thấy bài Facebook để bình luận", không ghi dòng lịch sử. Lượt đang chạy và chiến dịch của tài khoản khác không đụng tới, vì tài khoản chưa vào nhóm kín cũng có thể không thấy bài.
6. **Cảnh báo bài video** trong form tạo / sửa chiến dịch đăng nhóm (form thường và form AI):
   - Câu anh viết: "Bài có video sẽ không được up tin vì Facebook chưa duyệt bài video ngay sau khi đăng."
   - Chỉ hiện khi bật Kiêm up tin và media của bài (nội dung chính hoặc nội dung nâng cao) có video.
   - Lúc chạy không đổi gì: bài video thường không có link nên không có lượt up tin.

Nhận chiến dịch up tin bằng `isPostBumpTargetCampaign`: loại `facebook_comment_seeding_post` và tên bắt đầu "Up tin cho chiến dịch ". Không dùng cờ riêng, vì form sửa chiến dịch dựng lại extraSettings nên cờ không giữ được. Chiến dịch khách đổi tên thì không được nhận là up tin, và chạy như chiến dịch comment thường.

**Giữ nguyên theo anh chốt:** chiến dịch up tin đang tạm dừng vẫn nhận lượt mới và không in câu nào. Dò chờ duyệt cũng giữ nguyên.

**V531 đã apply akachat 17:32:15 VN 18/11/2026** (anh: "Apply V531"; sổ `20261118103215`, md5 sổ = file `aea07ae7…`; [biên nhận](../migrations/snapshots/post-bump-content-rotation-v531/apply-receipt.json)). Desktop chỉ ghi chỉ số câu khi phát hành bản có đợt sửa này.

**Đã đổi nghỉ 30 giây cho chiến dịch up tin cũ** lúc 17:45:09 VN 18/11/2026 (anh: "Đổi luôn"). 1.260 chiến dịch đang 0 giây được đổi: 1.088 hoàn thành, 120 tạm dừng, 52 chờ xử lý. Giữ 5 chiến dịch khách tự đặt số khác; không chiến dịch nào đang chạy. [Biên nhận](../migrations/snapshots/post-bump-sleep-30-20261118/receipt.json) có danh sách id và lệnh gỡ. Chiến dịch up tin tạo trước khi phát hành bản Desktop có #711 vẫn 0 giây, nên chạy lại đúng lệnh sau khi phát hành.

## Chưa làm

- Build Desktop: chỉ build, anh tự phát hành.
- Chạy lại lệnh nghỉ 30 giây (trong biên nhận) khi cần, để bắt chiến dịch up tin mới do app cũ tạo. Anh chốt 18/11 chạy tay, không tạo job pg_cron hay trigger. Lần chạy lại lúc 17:55 VN 18/11 đổi 0 chiến dịch.

**Không làm (anh chốt 18/11):** dọn 4.895 lượt kẹt ở chiến dịch up tin của tài khoản đã xoá. Các lượt này không bao giờ chạy, và từ #711 không còn lượt mới nào được thêm cho tài khoản đã xoá.

## Kiểm

```bash
node scripts/post-bump-fixes-smoke.cjs
AKA_CHAT_REPO=../akaAgentChatApi node scripts/post-bump-content-rotation-smoke.cjs
```

Phát lại 21 ngày dữ liệu thật tới 18/11 bằng bản bắt đầu ngẫu nhiên (chỉ đọc; chi tiết ở [POST_BUMP_CONTENT_ROTATION_V531.md](POST_BUMP_CONTENT_ROTATION_V531.md)):

- Bài up tin bị trùng câu giảm từ 56,0% xuống 13,1%.
- Bài up bằng nhiều tài khoản giảm từ 83,0% xuống 7,1%.
- Mọi ca còn trùng đều do số lượt nhiều hơn số câu.

`post-bump-fixes-smoke.cjs` chạy hàm thật của bộ lập lịch (chia lượt, tạo chiến dịch up tin, đóng lượt bài bị gỡ) với kho giả. Bài kiểm cũng kiểm phép tính lịch bảo trì, và soi mã nguồn của bảo trì cùng câu cảnh báo trong hai form. Chưa chạy trên Electron thật với Facebook thật.
