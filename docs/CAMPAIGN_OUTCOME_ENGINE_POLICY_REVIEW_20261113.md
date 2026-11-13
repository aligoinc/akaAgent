# Đánh giá chính sách kết quả của engine v2 (13/11/2026)

Nguồn: hồ sơ production đọc lúc 01:39–01:46 VN 13/11 (chỉ đọc, đã che dữ liệu khách), bảng duyệt Q1–Q8
([CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md](CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md)), các quyết định sau đó (V507 bỏ nhớ mục tiêu, V508 126/127
khi nhắn nhóm, V509 112 khi nhắn cá nhân) và bộ kịch bản toàn diện ([CAMPAIGN_OUTCOME_ENGINE_SCENARIO_TEST.md](CAMPAIGN_OUTCOME_ENGINE_SCENARIO_TEST.md)).
DB thử của bộ kịch bản khớp production hoàn toàn (102 luật, 274 chính sách, 136 mã), nên các kết luận là của chính sách đang chạy.

Chưa đổi gì trên production. Mục 2 (P1–P6) là **đề xuất, chưa áp dụng**: anh chưa quyết mục nào, nên chính sách đang chạy giữ nguyên
như bảng duyệt Q1–Q8.

## Tóm tắt

- Chính sách đang chạy khớp các quyết định đã duyệt. Chạy 150 cấu hình thật, 4.723 lần gửi, có lỗi tiêm và 18 kịch bản sự cố: không gửi trùng,
  không đốt data đã gửi, không kẹt data / lease, không vượt hạn mức.
- **Nên làm trước khi mở cho mọi tổ chức** (không cần anh quyết lại nguyên tắc). Cập nhật 13/11 chiều:

  | | Việc | Loại | Vì sao | Trạng thái |
  |---|---|---|---|---|
  | 1 | Desktop: lỗi đọc DB của app trước khi gọi Zalo xếp "chưa gửi" thay vì "không rõ" | code Desktop | tới ~990 data/tuần (số của bộ cũ trên Desktop 05–12/11) bị đóng UNK01 dù chưa gửi | đã sửa (#659), chưa phát hành Desktop |
  | 2 | `report_v1` gọi lại sau khi mất câu trả lời: trả chỉ thị cũ, không "mất quyền" | SQL | tài khoản đứng ~3 phút mỗi lần, chiến dịch treo "đang chạy" | V515 (#659), chưa apply |
  | 3 | Data chốt thành công thì xoá ghi chú lỗi của lần trước | SQL | khách thấy data "hoàn thành" kèm câu lỗi cũ | V515 (#659), chưa apply |
  | 4 | Đăng ký theo dõi tương tác cả khi report trả "replay" (kiểm đăng ký theo dòng lịch sử là idempotent trước) | code lõi | mất "đã xem / tương tác" của tin đó | chưa làm |

- **Cần anh quyết** (đổi quyết định đã chốt hoặc chọn hướng):
  1. **P1** — 122 / 119 / 126 khi nhắn tin: thôi trừ lượt (bộ cũ không trừ; trừ làm khách mất ~24% công suất mỗi ngày).
  2. **P2** — data dở chưa có dấu "sắp gửi": trả về hàng đợi thay vì đóng SYS01 (đổi quyết định 06/11; nay có bằng chứng an toàn).
  3. **P3** — NET03 (máy gửi Zalo phía Fly chưa sẵn sàng): có tạm dừng chiến dịch sau 4 lần liền không.
  4. **P4** — lỗi tải tệp media tạm thời: thôi coi là "cấu hình sai" (CFG01, tạm dừng chiến dịch).

## 1. Chính sách hiệu lực theo mã Zalo thật

Mô phỏng `aka_agent_engine_simulate_v1` (pha after_send, Fly; Desktop giống hệt trừ chỗ ghi riêng) cho mọi (thao tác, mã) có trong 7 ngày
05–12/11. "Lượt" là số dòng `auto_zalo_api_error_logs` của bộ cũ trong 7 ngày (Desktop + VPS + Fly).

| Thao tác | Mã | Lượt 7 ngày | Mã (công khai) | Data | Trừ lượt | Chuỗi lỗi | Chiến dịch | Khoá | Nghỉ |
|---|---|---:|---|---|---|---|---|---|---|
| Nhắn người lạ | 122 | 148.038 | Z122 | hoàn thành | **có** | — | — | — | không |
| Tra số | 216 / 212 | 206.870 | Z216 | hoàn thành | có | — | — | — | không |
| Nhắn người lạ | 127 | 12.838 | Z127 | về hàng đợi | không | 3 → dừng | — | nhắn người lạ 30 phút | đủ |
| Gắn tag | 114 | 4.321 | Z114 | hoàn thành | không | — | — | — | đủ |
| Nhắn nhóm | 112 | 3.844 | Z112 | hoàn thành | không | cộng | — | — | đủ |
| Đổi tên | 112 | 2.517 | **Z999** | hoàn thành | không | — | — | — | đủ |
| Nhắn bạn bè | 119 | 1.705 | Z119 | hoàn thành | **có** | — | — | — | không |
| Kết bạn | 225 | 1.699 | Z225 | hoàn thành | không | — | — | — | không |
| Nhắn người lạ | 119 | 1.625 | Z119 | hoàn thành | **có** | — | — | — | không |
| Nhắn nhóm | 126 / 127 | 1.568 | Z126 | hoàn thành | không | — | — | — | đủ |
| Kết bạn | 251 / 215 | 1.713 | Z215 | hoàn thành | không | — | — | — | không |
| Nhắn người lạ | 120 | 1.246 | Z120 | về hàng đợi | không | 3 → dừng | — | nhắn người lạ tới 09:45 hôm sau | đủ |
| Nhắn bạn bè | 126 | 1.109 | Z126 | hoàn thành | **có** | — | — | — | không |
| Thêm thành viên | 122 | 794 | Z122 | hoàn thành | không | — | — | — | không |
| Kết bạn | 223 | 771 | Z223 | về hàng đợi | không | — | **dừng ngay** | — | đủ |
| Nhắn người lạ | 126 | 606 | Z126 | hoàn thành | **có** | — | — | — | không |
| Nhắn nhóm | 221 | 494 | Z221 | về hàng đợi | không | 3 → dừng | — | nhắn nhóm 60 phút | đủ |
| Tra số | 210 / 219 | 774 | Z210 / Z219 | hoàn thành | có | — | — | — | không |
| Nhắn nhóm | 161 | 321 | Z161 | tạm dừng data | không | — | — | — | không |
| Nhắn người lạ | -69 | 196 | UNK01 | hoàn thành, không gửi lại | nếu đã ghi dấu | cộng | — | — | đủ |
| Nhắn người lạ | 802 | 142 | Z802 | về hàng đợi | không | 3 → dừng | — | nhắn người lạ 2 ngày tới 09:45 | đủ |
| Tra số | 600 | 93 | Z600 | về hàng đợi | không | — | đăng xuất | — | đủ |
| Nhắn người lạ | 112 | 86 | Z112 | về hàng đợi | không | — | **dừng ngay** | — | đủ |
| Thêm thành viên | 314 | 79 | Z314 | về hàng đợi | không | 3 → dừng | — | thêm thành viên 60 phút | đủ |
| Tra số | 312 | 39 | Z221 | về hàng đợi | không | 3 → dừng | — | tra số 60 phút | đủ |

Tín hiệu hệ thống (bản đầy đủ ở bảng duyệt): lỗi mạng tới Zalo trước khi gửi NET01 và máy gửi Fly chưa sẵn sàng NET03 = về hàng đợi, khoá
mọi thao tác Zalo của tài khoản 5 phút, 4 lần liền → tạm dừng chiến dịch; không rõ đã tới UNK01 = hoàn thành, không gửi lại, cộng chuỗi;
tệp media không dùng được CFG01 = tạm dừng chiến dịch, data về hàng đợi.

## 2. Đề xuất

### P1. 122 / 119 / 126 khi nhắn tin: thôi trừ lượt — cần anh quyết

- **Hiện tại:** V500 (Q2) trừ lượt cho 122, 119, 126 khi nhắn người lạ và 119, 126 khi nhắn bạn bè, với lý do "tin đã đi mà người nhận chặn".
- **Bằng chứng tin không đi:** câu Zalo trả là từ chối ("Bạn chưa thể gửi tin nhắn đến người này vì người này chặn không nhận tin nhắn từ người
  lạ", "Xin lỗi! Hiện tại tôi không muốn nhận tin nhắn", "Không thể nhận tin nhắn từ bạn"). Bộ cũ không trừ lượt 122: 11–12/11 có
  37.474/37.521 dòng 122 không tính lượt (47 dòng có tính lượt, nhiều khả năng của các tổ chức chạy thử bộ mới).
- **Trừ lượt không bảo vệ tài khoản:** Zalo hãm tốc 127 chỉ xảy ra sau tin người lạ gửi thành công dưới 5 phút; 122 và số không tồn tại không
  tính (02/11: 1.084/1.086 lần). 802 (cấm nhắn người lạ) không tăng theo số tin mỗi ngày (điều tra 01–02/11).
- **Ảnh hưởng:** 122 là 23,9% lượt nhắn người lạ (37.521/157.213 trong 1,6 ngày). Chiến dịch chạm hạn mức ngày (ví dụ 35) nhắn tới được
  khoảng 27 người thay vì 35: chậm khoảng 24% so với bộ cũ, khách chuyển sang bộ mới sẽ thấy ngay.
- **Đề xuất:** `quota_effect = no_count` cho các dòng `v500_review` của 122 / 119 / 126 khi nhắn người lạ và 119 / 126 khi nhắn bạn bè. Vẫn
  ghi lịch sử "thất bại", vẫn không nghỉ (Q1). Chỉ dữ liệu (5 dòng `auto_outcome_policies`), mô phỏng trước bằng `simulate`.
- **Rủi ro:** tài khoản thử nhiều người lạ hơn mỗi ngày (chủ yếu người chặn người lạ, họ không thấy tin). Chưa có số liệu ngược lại.

### P2. Data dở chưa có dấu "sắp gửi": trả về hàng đợi — cần anh quyết (đổi quyết định 06/11)

- **Hiện tại:** `engine.stale_unsent_target_action = complete`: pg_cron đóng data dở chưa có dấu "sắp gửi" thành "hoàn thành" SYS01 "Bị ngắt
  trước khi gửi". Lý do 06/11: không chứng minh được là chưa từng gọi Zalo.
- **Nay chứng minh được:** bất biến của bộ mới là bước gửi chỉ gọi nền tảng sau khi DB xác nhận dấu "sắp gửi"; bước không ghi dấu chỉ là
  đọc (tra số, hồ sơ) hoặc làm lại vô hại (tag, đổi tên, vào group, huỷ lời mời; V495 `operation_class`). Lượt data chưa có dấu chắc chắn
  chưa gửi gì.
- **Khi nào xảy ra:** app tắt / Fly khởi động lại khi đang tra số hoặc giữa hai bước; **mất câu trả lời của claim** (kịch bản S4, S4b: claim
  không idempotent nên data đã nhận bị bỏ lại, sau 10 phút thành SYS01 dù chưa gửi; Desktop mạng chập chờn hoặc claim chậm quá 20 giây khi
  DB quá tải).
- **Đề xuất:** `UPDATE auto_system_settings SET value = 'requeue' WHERE key = 'engine.stale_unsent_target_action'`. Kịch bản S16: data mất câu
  trả lời claim và data chết khi đang tra số đều về hàng đợi rồi gửi đúng một lần. Chỉ ảnh hưởng bộ mới.
- **Làm thêm (code, không gấp):** claim idempotent (cùng lease gọi lại thì trả lượt data còn mở chưa có dấu / kết quả; claim đầu lượt cùng
  `runner_id` thì trả lại lease đang giữ) để khỏi phải chờ 10 phút.

### P3. NET03 (máy gửi Zalo phía Fly chưa sẵn sàng): không tạm dừng chiến dịch — cần anh quyết

- **Hiện tại (Q5):** về hàng đợi, khoá mọi thao tác Zalo của tài khoản 5 phút, 4 lần liền → tạm dừng chiến dịch. NET01 (lỗi mạng tới Zalo)
  cũng vậy.
- **Vấn đề:** NET03 là lỗi phía mình (runtime Fly khởi động lại, deploy, sự cố). Runtime hỏng khoảng 15–20 phút (4 chu kỳ khoá) thì mọi chiến
  dịch đang chạy của mọi tài khoản Server bị tạm dừng; sau sự cố khách (hoặc mình) phải bấm Tiếp tục từng chiến dịch. 12/11: `worker` và
  `zalo_runtime` Fly dừng hẳn sau 10 lần khởi động lại khi DB chỉ đọc (cần `flyctl machine start` tay). Bộ thử: 1 chiến dịch "Thêm thành
  viên" tạm dừng "Dừng sau 4 data lỗi/thất bại liên tiếp: Máy gửi Zalo chưa sẵn sàng…".
- **Đề xuất:** với `err_engine_runtime_unavailable` (11 dòng `v500_review`, mỗi thao tác Zalo một dòng): bỏ ngưỡng tạm dừng (chỉ khoá 5 phút + ghi chú "sẽ tự chạy lại"),
  hoặc nâng ngưỡng (ví dụ 12 ≈ 1 giờ). Giữ NET01 như cũ: trên Desktop, NET01 lặp lại thường là proxy chết, khách phải sửa.

### P4. Lỗi tải tệp media tạm thời: thôi coi là "cấu hình sai" — cần anh quyết hướng

- **Hiện tại:** Desktop gom mọi lỗi tải URL (mạng, HTTP 5xx, hết 60 giây) vào `CampaignMediaResolveError`
  ([campaignMediaSource.ts:75](../src/main/services/campaignMediaSource.ts:75)) → CFG01 → **tạm dừng chiến dịch**, khách phải bấm Tiếp
  tục. Bộ cũ cũng tạm dừng (`pauseCampaignForMediaError`). Fly: `campaign_media_download_failed` → CFG01.
- **Đề xuất:** lỗi tạm thời (mạng, 5xx, 429, hết giờ) → NET01 (về hàng đợi, khoá 5 phút, 4 lần liền mới dừng); giữ CFG01 cho lỗi cố định
  (không có đường dẫn / URL, 403 / 404, Zalo Server chỉ có tệp trên máy). Sửa nhỏ ở hai cổng (gắn loại lỗi) + một luật.
- **Trước khi làm:** đếm trên production số lần chiến dịch bị tạm dừng với ghi chú "cloud URL không tải được" (hồ sơ này không có vì bộ cũ
  không ghi dòng lỗi Zalo cho trường hợp đó).

### P5. 314 (thêm thành viên: hết lượt mời người lạ): kiểm thời gian khoá — đo trước

- **Hiện tại:** về hàng đợi, khoá thêm thành viên 60 phút, 3 lần liền → tạm dừng chiến dịch. 79 lượt / 7 ngày, chỉ Server.
- **Nghi vấn:** tên mã `MAX_QUOTA_INVITE_STRANGER_PHONEID` gợi ý hạn mức theo ngày. Nếu đúng, sau 60 phút thử lại vẫn 314, sau 3 lần (khoảng
  3 giờ) chiến dịch bị tạm dừng dù chỉ cần chờ qua ngày.
- **Đề xuất:** đo trên production (tài khoản bị 314 mời lại được sau bao lâu); nếu theo ngày thì khoá tới đầu ngày hôm sau như 120.

### P6. Câu chữ cho khách — chỉ dữ liệu, thấp

- Bỏ "(mã N)" trong câu đã có mã công khai ZN: "Zalo từ chối gửi nội dung vào nhóm này (mã 112) (Z112)", "Nhóm Zalo này không còn tồn tại
  (mã 161) (Z161)", "… (mã 127), chạy tiếp lúc … (Z127)", 120, 802 (đã ghi ở mục "để bàn sau" của kế hoạch).
- 223: thêm hướng dẫn vào câu tạm dừng ("Huỷ bớt lời mời đã gửi, ví dụ bằng chiến dịch Huỷ lời mời kết bạn, rồi bấm Tiếp tục").
- Đổi tên 112 đang ra Z999 "Lỗi không xác định": bộ mới đã cắt tên còn 50 ký tự nên gần như hết; nếu muốn, thêm luật 112 × đổi tên với câu
  rõ ("Zalo không cho đổi tên gợi nhớ người này"). Bộ cũ (VPS, Desktop ≤ 9.5) vẫn gửi tên dài: ~2.500 lỗi / tuần.
- Câu cảnh báo khi không kiểm được danh sách từ chối nhận tin đang gắn nguyên câu lỗi kỹ thuật ("…: fetch failed"); tag nguồn hỏng tạm dừng
  chiến dịch với ghi chú không có mã công khai.

## 3. Giữ nguyên (đã kiểm hợp lý)

- **Tra số không tồn tại (216 / 212 / 219 / 210):** hoàn thành, trừ lượt (Zalo đếm lượt tra), không nghỉ (Q1, Q2). Nếu sau này làm danh sách
  "không tồn tại" toàn hệ thống thì cần hạn: đo 12/11, số Z216 tra lại có Zalo 1,4% (dưới 2 tuần) tới 8% (trên 2 tháng).
- **127 nhắn người lạ / bạn bè:** về hàng đợi, khoá 30 phút, 3 lần liền tạm dừng (Q4). Đo 02/11: nghỉ giữa 2 lần ≥ 300 giây thì 0 lỗi 127.
- **120 / 802:** khoá tới 09:45 hôm sau / 2 ngày, về hàng đợi (Q4); 802 mỗi đợt ~1 tuần.
- **600:** đăng xuất tài khoản, về hàng đợi.
- **112 nhắn người lạ / bạn bè** như 118 (V509: tạm dừng chiến dịch, đúng vì gần như luôn là chữ quá dài); **112 nhắn nhóm** hoàn thành, cộng
  chuỗi (anh chốt 12/11); **126 / 127 nhắn nhóm** hoàn thành, không khoá (V508); **161** tạm dừng data.
- **UNK01** (-69, đứt mạng khi đang gửi, hết giờ hàng rào media): hoàn thành, không gửi lại, cộng chuỗi (Q3). Đo 05/10: tin có video "không
  rõ" gấp ~10 lần tin không video (0,39% so với 0,04%).
- **223 / 224:** tạm dừng chiến dịch (như bộ cũ); chỉ đổi câu (P6).
- **Gắn tag 114** (5,8% lượt gắn tag): chính sách đúng (không trừ lượt, không đốt data), nhưng tỉ lệ trên Server 7,5% so với Desktop 1,1% cho
  thấy nguyên nhân gốc ở phía Server (VPS / runtime Fly), nên điều tra nguyên nhân chứ không đổi chính sách.
- DAT01, OPT01, EXC01 / EXC02, CFG16 / CFG18 / CFG19, LIM01 / LIM02, SYS02, DB01, RUN01: đúng như thiết kế.

## 4. Thứ tự đề xuất

1. Sửa Desktop (phát hiện A) trước khi phát hành 9.6.0: bản 9.6.0 đã build nhưng chưa phát hành, không sửa thì Desktop bật cờ sẽ đóng UNK01
   các data gặp lỗi đọc DB.
2. Anh quyết P1, P2, P3 (chỉ dữ liệu, làm được trong vài phút, mô phỏng trước, chỉ ảnh hưởng tổ chức bật cờ và Desktop bản mới).
3. SQL cho B và D, code lõi cho đăng ký tương tác khi replay: một migration nhỏ trước khi mở rộng cờ.
4. P4, P5, P6 sau khi có số đo.
