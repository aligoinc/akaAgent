# Kiểm lỗi chiến dịch Facebook bằng Claude Code: kết quả đợt 0 (18/11/2026)

Đợt 0 của [phương án](FB_ERROR_WATCH_CLAUDE_CODE_PLAN.md). Mọi số liệu đọc chỉ đọc trên production (akachat) chiều 18/11, không ghi gì. Dữ liệu engine Facebook mới có từ 16:45 VN 17/11 (tổ chức 1) và 10:44 VN 18/11 (mọi tổ chức), nên "7 ngày" ở đây thực tế là khoảng 23 giờ.

Cập nhật 17:20 VN 18/11: sau khi viết tài liệu này, phiên khác đã apply `migration_v575_engine_specific_codes_wait_note` (17:08 VN). Theo [tài liệu của bản đó](ENGINE_V2_FACEBOOK_PROGRESS_PARITY.md) (merge `dev_3` qua #709), nó cho ca 1 (lỗi mạng khi mở trang) mã NET01 và ca 2 (tệp media không còn trên máy) mã CFG20. Ca 3 (lỗi đọc block thành "Block không tìm thấy") chưa có bản sửa. Em chưa kiểm lại hai ca đầu trên dữ liệu sau V575.

## 1. Câu phát hiện ca lỗi

Tệp [error-watch-dryrun.sql](../scripts/engine-v2-facebook/error-watch-dryrun.sql), chạy:

```bash
supabase db query --linked -f scripts/engine-v2-facebook/error-watch-dryrun.sql -o json
```

Cách gom:

- Mã chưa có kết luận: một ca = mã lỗi + thao tác + bước lỗi + câu lỗi đã chuẩn hoá (bỏ số, tên tệp, tên nhóm, tên người, đường dẫn nhóm).
- Mã đã có kết luận (FB40, FB02, FB11, FB14, FB22, FB23, FB24, FB45, RUN01): chỉ đếm theo giờ, để sau này xét tăng bất thường. Chưa xét được vì chưa đủ 7 ngày làm mức nền.
- Lượt bị bỏ dở: lượt đóng `stale` hoặc còn mở quá 30 phút, kèm máy khách có còn mở không.
- Việc chiến dịch bị engine tạm dừng lấy từ `auto_engine_target_runs.final_response.campaign.effect = 'pause'`. Trường `decision.contrib.campaignEffect` của từng kết quả chỉ là hiệu ứng của chính sách, chưa qua ngưỡng, không dùng để đếm.

Kết quả: 814 kết quả lỗi, trong đó 16 ca chưa có kết luận. Ngày đầu ca nào cũng là "mới", nên nếu bộ tạo việc chạy từ đầu thì sinh 16 việc, cộng 10 việc báo lại khi số lượt tăng gấp 3: **26 việc trong ngày đầu**, dưới trần 30. Các ngày sau chỉ ca mới hoặc ca tăng mới thành việc.

| Mã | Thao tác | Bước | Lượt | Chiến dịch | Tổ chức | Lần dừng chiến dịch | Lượt có ảnh | Câu lỗi (đã chuẩn hoá) |
|---|---|---|---|---|---|---|---|---|
| FB44 | Đăng nhóm | `nav` | 18 | 4 | 1 | 4 | 18 | ERR_NETWORK_IO_SUSPENDED khi mở trang nhóm |
| FB42 | Đăng nhóm | `click_post` | 12 | 8 | 3 | 3 | 11 | Đăng bài thất bại vào *: Form đăng bài chưa đóng sau # giây |
| SYS99 | Đăng nhóm | `type_content` | 10 | 2 | 2 | 3 | 9 | Không dùng được media "…": local path không tồn tại… |
| FB42 | Comment | `comment_at_pos` | 6 | 2 | 2 | 0 | 0 | Không comment được bài thứ #: hết giờ chờ ô bình luận |
| SYS99 | Nhắn khách inbox Page | `send_message` | 6 | 2 | 1 | 1 | 6 | Không tìm thấy ô để nhập tin nhắn |
| SYS01 | Đăng nhóm | `share_post` | 4 | 1 | 1 | 0 | 0 | Bài đăng chính chưa đăng được, nhóm chia sẻ kèm chạy lại ở lượt sau |
| UNK01 | Đăng nhóm | `share_post` | 3 | 1 | 1 | 0 | 0 | Không xác nhận được bài đã đăng vào nhóm chia sẻ kèm |
| FB42 | Comment | `comment` | 2 | 1 | 1 | 0 | 0 | Không comment được bài của mình: hết giờ chờ ô nhập trong hộp thoại |
| FB42 | Comment | `comment_at_pos` | 2 | 1 | 1 | 0 | 0 | Không comment được bài đầu tiên |
| FB06 | Đăng nhóm | `__identity` | 1 | 1 | 1 | 1 | 0 | Không lấy được tên Facebook identity hiện tại |
| SYS99 | Mời vào nhóm | `group_invite` | 1 | 1 | 1 | 0 | 1 | Link group nhận lời mời không hợp lệ |
| FB35 | Đăng trang cá nhân | `open_composer` | 1 | 1 | 1 | 0 | 0 | Không tìm thấy ô đăng bài |
| SYS99 | Đăng nhóm | `click_post` | 1 | 1 | 1 | 0 | 1 | Block bị huỷ trong khi sleep |
| SYS99 | Đăng nhóm | `nav` | 1 | 1 | 1 | 0 | 0 | Block không tìm thấy: blockId=# blockName="…" |
| SYS99 | Đăng nhóm | `type_content` | 1 | 1 | 1 | 0 | 1 | aka_agent_engine_take_content_index_v1: fetch failed |
| FB42 | Comment | `comment` | 1 | 1 | 1 | 0 | 0 | Không comment được bài thứ # |

Mã đã có kết luận trong cùng khoảng: FB40 393 lượt, FB45 124, FB11 75, FB02 61, FB23 34, FB24 26, FB14 20, FB22 6, RUN01 5.

Lượt bị bỏ dở: 5 lượt đóng `stale` (3 lượt máy vẫn mở sau đó 15 phút), 1 lượt còn mở.

Hai điều rút ra cho hàm thật:

- Chuẩn hoá câu lỗi quyết định số ca. Bản đầu chưa bỏ tên nhóm và tên người ra 30 ca; bỏ đi còn 16.
- Hai ca "cần ảnh" từ bản rà 17/11 (form đăng bài không đóng; không tìm thấy ô nhập tin nhắn inbox Page) nay phần lớn lượt đã có ảnh trên máy khách: 11/12 và 6/6. Đây là hai ca nên xin ảnh trước.

## 2. Ba ca kiểm tay (báo cáo mẫu theo khuôn của phương án)

### Ca 1: mở trang nhóm bị `ERR_NETWORK_IO_SUSPENDED`, ghi thành FB44

```json
{
  "tom_tat": "Máy khách mất mạng tạm thời (mã của trình duyệt cho biết hệ điều hành đang ngưng mạng) nhưng engine ghi thành \"Không thấy nút hoặc ô cần bấm trên Facebook\", đóng 18 data và tạm dừng 4 chiến dịch trong chưa đầy 3 phút. Nên sửa cách phân loại.",
  "khoa": "err_engine_fb_ui_not_ready|fb_post_group|nav|ERR_NETWORK_IO_SUSPENDED",
  "ma": "FB44",
  "so_lieu": { "so_luot": 18, "so_chien_dich": 4, "so_tai_khoan": 4, "so_to_chuc": 1, "khoang": "18/11 12:12:32–12:14:54 (13 lượt) và 14:23:04–14:25:07 (5 lượt), giờ VN" },
  "ket_luan": "loi_app",
  "nen_sua_app": true,
  "bang_chung": [
    "Tổ chức 124, nhân viên 143, một máy Windows chạy 9.9.0, app mở liên tục từ 10:53.",
    "Lượt 180993: bước nav (block nav_to_url) lỗi sau 36 ms với ERR_NETWORK_IO_SUSPENDED (-331), chưa bấm gì (sendAttempted = false). 18 lượt đều lỗi ở bước này sau 35–172 ms.",
    "Bốn lượt 172084, 172088, 172120, 180993 làm chiến dịch 56586, 57433, 57418, 57428 tạm dừng với ghi chú \"Dừng sau 4 data lỗi/thất bại liên tiếp…: Không thấy nút hoặc ô cần bấm trên Facebook (FB44)\".",
    "Lượt 180993 đóng data ở trạng thái hoàn thành: nhóm đó không được đăng và không chạy lại.",
    "Bảng auto_outcome_signal_rules không có luật nào cho lỗi mạng của trình duyệt ở nền tảng Facebook; lỗi rơi vào luật 113 (mọi lỗi thao tác trên trang trước mốc gửi → FB44).",
    "15:08–15:37 cùng máy chạy lại bình thường với tài khoản 418, 419, 420; chưa thấy lượt mới của tài khoản 4730."
  ],
  "nguyen_nhan": "Trình duyệt trả ERR_NETWORK_IO_SUSPENDED khi hệ điều hành ngưng mạng, thường là lúc máy vào hoặc ra chế độ ngủ. App vẫn nhận data mới mỗi 35 giây trong lúc đó, mỗi data lỗi ngay ở bước mở trang, đủ 4 lần thì chính sách của FB44 tạm dừng chiến dịch. Chưa xác nhận được máy khách có ngủ lúc đó hay không (presence không ghi sự kiện ngủ).",
  "de_xuat": [
    "Thêm luật tín hiệu cho nhóm lỗi mạng của trình duyệt (ERR_NETWORK_IO_SUSPENDED, ERR_INTERNET_DISCONNECTED, ERR_NETWORK_CHANGED, ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_*) ở pha trước mốc gửi: ra mã mạng, data về hàng đợi, không cộng chuỗi lỗi. Chỉ đổi dữ liệu DB.",
    "Bộ giữ khi máy ngủ (#707) đang mặc định tắt trên Windows; ca này là Windows. Xét bật cho Windows sau khi có bản Desktop chứa #707.",
    "Chiến dịch 56586 (tài khoản 4730) chưa thấy chạy lại: kiểm xem khách đã bấm tiếp tục chưa."
  ],
  "do_chac": "cao",
  "da_tung_ket_luan": "CLAUDE.md, pitfall \"Mac đang ngủ vẫn nhận data engine v2\" (cùng họ, khác biểu hiện: ở đó là bỏ dở giữa lệnh gửi)",
  "can_anh_quyet": "Lỗi mạng của trình duyệt trước mốc gửi nên ra mã nào và câu nào cho khách?"
}
```

### Ca 2: tệp ảnh của chiến dịch không còn trên máy, ghi thành SYS99

```json
{
  "tom_tat": "Tệp ảnh / video khách chọn cho bài đăng không còn ở đường dẫn trên máy và chiến dịch không có bản lưu trên cloud. Engine ghi \"Có lỗi xảy ra (SYS99)\", đóng data, dừng chiến dịch sau 4 lần; câu lý do khách thấy có chữ kỹ thuật tiếng Anh. Nên có mã và câu riêng.",
  "khoa": "err_undefined|fb_post_group|type_content|Không dùng được media: local path không tồn tại",
  "ma": "SYS99",
  "so_lieu": { "so_luot": 10, "so_chien_dich": 2, "so_tai_khoan": 2, "so_to_chuc": 2, "khoang": "18/11 10:00–15:34, giờ VN" },
  "ket_luan": "do_cau_hinh_cua_khach",
  "nen_sua_app": true,
  "bang_chung": [
    "Chiến dịch 58228 (tổ chức 2074, tạo 15:06): 6 lượt lỗi liền 15:10–15:34, chiến dịch tạm dừng 3 lần (15:13, 15:18, 15:34), tức khách đã bấm chạy lại hai lần và bị dừng lại ngay.",
    "Chiến dịch 55399 (tổ chức 638): 4 lượt lỗi rải rác (10:00, 10:42, 11:59, 14:55) xen giữa các lượt thành công.",
    "Lượt 188127: mở được ô đăng bài, lỗi ở bước type_content trước khi bấm Đăng.",
    "Cấu hình media của cả hai chiến dịch chỉ có đường dẫn trên máy (8 và 78 tệp), không tệp nào có bản cloud.",
    "Code: src/main/services/campaignMediaSource.ts ném lỗi này khi tệp không tồn tại ở đường dẫn và mục media không có cloudUrl.",
    "Ghi chú dừng khách thấy ở 58228: \"…Phương tiện đính kèm bị thiếu (local path không tồn tại và không có cloud URL fallback), khiến bài viết không…\" (câu do AI đọc ảnh viết lại, chép nguyên chữ của lỗi).",
    "Cùng câu lỗi cũng gặp ở engine Zalo: 18 lượt của 4 tổ chức trong 15–18/11."
  ],
  "nguyen_nhan": "Tệp không còn ở đường dẫn đã chọn (bị xoá, đổi tên, dời thư mục, hoặc chạy trên máy khác). Không có mã riêng cho trường hợp này nên rơi vào lỗi chưa phân loại: mỗi data bị đóng, đủ 4 lần thì dừng chiến dịch. Chưa rõ vì sao chiến dịch 58228 thiếu tệp chỉ 4 phút sau khi tạo.",
  "de_xuat": [
    "Thêm mã riêng \"thiếu tệp đính kèm\" cho cả Facebook và Zalo: dừng chiến dịch ngay ở data đầu, không đóng data, câu cho khách nêu tên tệp và việc cần làm (chọn lại tệp). Câu cho khách cần anh duyệt.",
    "Câu lý do do AI viết lại (Q11) không được chép chữ của lỗi gốc: thêm điều này vào prompt hoặc lọc trước khi ghi.",
    "Hỏi khách của chiến dịch 58228 (hoặc xem máy) để biết tệp bị dời hay đường dẫn có ký tự đặc biệt."
  ],
  "do_chac": "cao",
  "da_tung_ket_luan": "",
  "can_anh_quyet": "Có làm mã riêng cho thiếu tệp đính kèm không, và câu cho khách là gì?"
}
```

### Ca 3: "Block không tìm thấy" dù block vẫn có

```json
{
  "tom_tat": "Một lượt báo thiếu block nav_to_url, nhưng block đó có trong database và các lượt ngay trước, ngay sau chạy bình thường. Nhiều khả năng app đọc block lỗi do mạng chập chờn rồi coi như không có block. Nên sửa code Desktop.",
  "khoa": "err_undefined|fb_post_group|nav|Block không tìm thấy",
  "ma": "SYS99",
  "so_lieu": { "so_luot": 1, "so_chien_dich": 1, "so_tai_khoan": 1, "so_to_chuc": 1, "khoang": "18/11 12:10:41, giờ VN" },
  "ket_luan": "loi_app",
  "nen_sua_app": true,
  "bang_chung": [
    "Lượt 171816 (tổ chức 638, nhân viên 661, chiến dịch 57849): bước nav lỗi sau 0 ms với \"Block không tìm thấy: blockId=2841 blockName=nav_to_url\".",
    "Block 2841 \"[engine] nav_to_url\" có từ 16:32 VN 17/11, không sửa từ đó.",
    "Cùng chiến dịch: lượt 12:04 và 12:13 chạy bình thường; 12:32:39 có lỗi \"aka_agent_engine_take_content_index_v1: TypeError: fetch failed\", tức máy này có lúc không gọi được database.",
    "Code: workflowEngine.loadBlocks gọi getBlock cho từng block; getBlock (blockRepository.ts) trả null cả khi yêu cầu đọc bị lỗi, nên lỗi đọc tạm thời biến thành \"không có block\".",
    "Lượt này đóng data ở trạng thái hoàn thành và cộng 1 vào chuỗi lỗi."
  ],
  "nguyen_nhan": "Suy từ code và lỗi mạng của cùng máy 22 phút sau: yêu cầu đọc block 2841 bị lỗi, getBlock nuốt lỗi và trả null. Không có log của đúng yêu cầu đó nên chưa chứng minh trực tiếp.",
  "de_xuat": [
    "getBlock phân biệt \"đọc lỗi\" với \"không có block\"; lỗi nạp block trước mốc gửi coi là lỗi tạm: data về hàng đợi, không cộng chuỗi lỗi. Sửa code Desktop, cần build.",
    "Ca \"take_content_index: fetch failed\" (1 lượt) cùng loại: lỗi gọi database trước mốc gửi đang ra SYS99 và đóng data."
  ],
  "do_chac": "trung_binh",
  "da_tung_ket_luan": "CLAUDE.md, pitfall engine FB: \"block thiếu bị bỏ lặng lẽ khi nạp rồi mọi data lỗi Block không tìm thấy\"",
  "can_anh_quyet": ""
}
```

## 3. Điều chỉnh rút ra cho phương án

- Khuôn báo cáo thêm trường `nen_sua_app` (có / không). Ca 2 cho thấy kết luận "do khách" vẫn có thể kèm việc nên sửa ở app, một trường `ket_luan` không nói hết.
- Một ca kiểm tay mất khoảng 5–10 lượt đọc database và vài tệp code. Ước 5–15 phút mỗi ca trong phương án là hợp lý.
- Mọi bằng chứng ở trên đọc được bằng SQL chỉ đọc và repo, đúng những gì phiên cloud có. Riêng ca 2 và ca 3 muốn chắc hơn thì cần thông tin từ máy khách mà ảnh không cho được.
