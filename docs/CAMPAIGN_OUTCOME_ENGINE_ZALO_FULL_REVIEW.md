# Bảng xử lý đầy đủ lỗi Zalo cho engine v2 — nghiên cứu và quyết định 11/11/2026

> **Anh đã duyệt từng câu tối 11/11** (mục "Quyết định đã chốt" ngay dưới). **V499 và V500 đã apply akachat 12/11 00:02:44 và
> 00:03:06 VN** (anh bảo "ok apply đi"; không apply lại; biên nhận `migrations/snapshots/target-memory-per-account-v499/`,
> `migrations/snapshots/zalo-error-policies-v500/`). Có hiệu lực ngay với tổ chức 526 trên Fly. Phân pha lỗi theo đọc/gửi (lõi + cổng Fly)
> **đã deploy ChatApi `worker` 12/11 00:31 VN** (anh bảo "Deploy ngay"; image `worker-dbb38b7-v2-errors-20261112`, dựng từ đúng mã nguồn
> đang chạy `dbb38b7` + v2, biên nhận `migrations/snapshots/engine-v2-chatapi-worker-errors-deploy-20261112/`); chưa có lượt chạy thật nào
> gặp lỗi sau deploy. Code chưa commit, Desktop chưa phát hành. **12/11 01:04–01:18 VN đã gỡ v2 khỏi production** (ChatApi, Web về `dev`;
> cờ 526 tắt): V499/V500 vẫn trong DB nhưng không tổ chức nào dùng, biên nhận `migrations/snapshots/engine-v2-revert-to-dev-20261112/`.
>
> Bảng này thay cho bảng 1b ([CAMPAIGN_OUTCOME_ENGINE_REVIEW_ZALO.md](CAMPAIGN_OUTCOME_ENGINE_REVIEW_ZALO.md)). Các mục
> 2–4 và 8 bên dưới là **bản đề xuất ban đầu**, giữ lại để đối chiếu; chỗ nào khác "Quyết định đã chốt" thì theo quyết định.

## Quyết định đã chốt (anh duyệt từng câu, 11/11/2026)

Nguyên tắc anh đặt: **phải tách lỗi do tài khoản (Zalo hạn chế, mất kết nối) và lỗi do data.** Lỗi không do data thì không
bao giờ đốt data, chỉ dừng tài khoản hoặc chiến dịch. Lỗi do data thì hoàn thành data ngay, vì chạy lại cũng lỗi lại.

| # | Chủ đề | Quyết định |
|---|---|---|
| Q1 | Nghỉ giữa 2 lần | Nghỉ của một data = mức nặng nhất trong các bước của data đó (đủ > ngắn > không). Không nghỉ khi mọi bước đều hỏng do người nhận/data: 122/119/126, 215/251, 216 khi kết bạn, 225, 161, 227, 178, DAT01, **và tra số không tồn tại (216/212/214/219/210)**. Nhắn tin thành công mà kết bạn ra 225/215 vẫn nghỉ đủ. |
| Q2 | Hạn mức | **Nhắn tin:** tin đã đi mà người nhận chặn (122, 119, 126) thì trừ lượt; gửi không đi (118, 114, 127, 221, 120/802, 600) thì không trừ; lỗi không mã (Z999) và chưa rõ kết quả vẫn trừ như hôm nay. **Kết bạn:** không thành công thì không trừ, mã nào cũng vậy. Tra số không tồn tại vẫn trừ (Zalo đếm lượt tra). |
| Q3 | Chuỗi lỗi liên tiếp | Chưa rõ kết quả (đứt mạng khi đang gửi, hết giờ chờ, -69) vẫn cộng như hôm nay. 311, 227, 114 do Zalo trả, 118 không cộng. |
| Q4 | Mã do tài khoản | 127, 221, 314, 120/802, 312/313/304 (tra số quá giới hạn), 126/127 khi nhắn nhóm, 299/301: data về "chờ xử lý" (không đặt lịch riêng, khoá thao tác có sẵn giãn nhịp), bỏ bước còn lại của lần đó, không trừ lượt; **3 lần liền vẫn lỗi thì tạm dừng chiến dịch**, data vẫn ở chờ xử lý (không ghi hoàn thành). |
| Q4b | Mã 123 | Giữ như hôm nay (data hoàn thành, khoá nhắn người lạ 30 phút): 7 lần trong 5 tháng, không đủ dữ liệu để biết do tài khoản hay do data. |
| Q5 | Lỗi mạng, máy gửi chưa sẵn sàng | Không do data: không ghi lịch sử, data luôn về "chờ xử lý", **khoá mọi thao tác Zalo của tài khoản 5 phút** (cùng cơ chế khoá 127/221, nên mọi chiến dịch của tài khoản đó cùng chờ, kể cả bộ chạy cũ; tài khoản khác không ảnh hưởng); **4 lần liền thì tạm dừng chiến dịch**. |
| Q6 | Nhớ mục tiêu | **Chỉ theo từng tài khoản Zalo, không theo tổ chức**, 30 ngày: không có Zalo (216/212/214/219/210), 122, 119 và 126 khi nhắn người lạ, nhóm đã bị xoá (161), link nhóm hỏng (227). Không nhớ: nhóm đầy (172, có thể hết đầy), 119/126 khi nhắn bạn bè, 215/251. |
| Q7 | Trạng thái V494 | Trước sau gì cũng bật; đợt này giữ chữ cũ ("thất bại"…, câu cho khách có mã ngắn), bật ở đợt sau cùng việc sửa các chỗ đếm theo chữ. |
| Q8 | Báo khách khi bị khoá thao tác | Làm sau (việc riêng ở trung tâm thông báo). Tạm dừng chiến dịch và đăng xuất đã có thông báo. |

**Sửa trong DB, không cần phát hành app:** số phút khoá (`lock_minutes`), số lần liền thì tạm dừng (`streak_threshold`),
số ngày nhớ (`remember_target_days`) là cột của `auto_outcome_policies`; DB đọc lại ở mỗi lần chốt kết quả, có lịch sử
(`auto_outcome_policy_history`), xem trước bằng `aka_agent_engine_simulate_v1`.

**Số liệu dùng để quyết định** (đọc production 11/11, chỉ đọc):

- Lỗi ngày 02–03/11, xem 9 ngày sau có tài khoản khác gửi lại cùng số và thành công không:

  | Mã | Tài khoản khác gửi lại | Thành công | Kết luận |
  |---|---|---|---|
  | 122 (chặn tin người lạ) | 679 | 16 (2%) | chặn mọi tài khoản lạ |
  | 119 khi nhắn người lạ | 92 | 79 (86%) | chỉ chặn đúng tài khoản đã gửi |
  | 119 khi nhắn bạn bè | 73 (chính tài khoản đó gửi lại) | 58 (79%) | lỗi tạm thời |
  | 215/251 | 46 | 9 (20%) | phần lớn chặn mọi tài khoản |
  | 126 | 9 | 0 | quá ít |

- 123 (7 lần): 2 lần gặp lại đúng lúc hết khoá 30 phút; sau đó cùng tài khoản gửi người khác thành công 14 và 11 lần.
- Bộ chạy cũ không có "hoãn N phút": cột `update_status_campaign = 'chờ xử lý'` chỉ đưa chiến dịch về chờ xử lý và chạy
  lại ngay ở lượt quét kế; lỗi mạng của Zalo còn bị tính như lỗi nghiệp vụ.

## Tình trạng (12/11 00:03 VN)

| Phần | Nơi | Trạng thái |
|---|---|---|
| Phân pha lỗi Zalo theo loại thao tác (`classifyZaloError`): tra số là đọc, gửi tin/kết bạn là gửi. Lỗi mạng, HTTP lỗi, hết giờ chờ của thao tác đọc là "chưa gửi"; của thao tác gửi thì lỗi mở kết nối (`connect`, DNS, `ECONNREFUSED`…) và HTTP 429 là "chưa gửi", còn lại là "không rõ". Câu trả lời của Zalo giữ nguyên | lõi `packages/campaign-engine/src/zalo/common.ts`; cổng Desktop `desktopZaloPort.ts`; cổng Fly `flyZaloPort.ts` (lỗi `zalo_command_failed` "fetch failed", "terminated", "Request failed with status code …" của runtime) | xong, có test |
| Lỗi trước khi gọi Zalo của Desktop ("Chưa có session Zalo"…) ở bước gửi là "chưa gửi". Từ 13/11 mọi lỗi của bước chuẩn bị (đọc tài khoản / phiên từ DB, kiểm gói, đăng nhập lại bằng phiên, listener tải tệp) đều xếp "chưa gửi", ở cả bước gửi lẫn bước tra số. Cách làm: dấu `zaloPreCallError` | cổng Desktop, `zaloRuntimeService` | xong; bản sửa 13/11 chưa phát hành |
| Nghỉ ngắn không bao giờ dài hơn "Nghỉ giữa 2 lần" của khách | lõi `pacing.ts` | xong, có test (chính sách hiện chưa dùng nghỉ ngắn) |
| **V499: nhớ mục tiêu theo tài khoản** (Q6): `auto_target_memory.account_id`, khoá duy nhất (tài khoản, mục tiêu, thao tác); claim và report đọc/ghi theo tài khoản. Không apply nếu bảng nhớ không trống (production 11/11: 0 dòng) | `migrations/migration_v499_target_memory_per_account.sql` (sinh bằng `scripts/build-v499-sql.cjs` từ thân hàm V495 đã kiểm khớp production), test `scripts/test-v499-target-memory-per-account.cjs` 4/4 | **đã apply 12/11 00:02:44 VN** (`20261111170237`, md5 sổ = file `58b12171…`) |
| **V500: chính sách theo quyết định Q1–Q8**: 109 dòng chính sách theo (mã, thao tác[, nơi chạy]), 14 luật phân loại, 7 mã mới chỉ cho engine. Gỡ = xoá dòng `v500_review` | `migrations/migration_v500_zalo_error_policies.sql` (sinh từ đặc tả `scripts/build-v500-sql.cjs`), test `scripts/test-v500-zalo-error-policies.cjs` 13/13 (chạy thật đủ Q1–Q6; gỡ xong 2.013 mô phỏng về đúng trước V500) | **đã apply 12/11 00:03:06 VN** (`20261111170305`, md5 sổ = file `e6ae5ac1…`); mô phỏng trên production ra đúng Q1–Q6 |
| Bộ kiểm lúc bắt đầu chạy của Desktop 8.2.0, 9.3.0 và chat-sync vẫn đạt trên danh mục sau V499/V500 | `scripts/legacy-catalog-validator-smoke.cjs` | đạt |

Đã bỏ sau khi đo hoặc theo quyết định của anh:
- **Kiểm định dạng SĐT trước khi tra:** 126 nghìn lượt tra số gần nhất đều là SĐT Việt Nam đúng định dạng.
- **Cơ chế "thử N lần rồi ghi thất bại"** (bản V499 đầu): lỗi mạng không do data nên không được đốt data; dùng khoá tài
  khoản + tạm dừng chiến dịch theo chuỗi lỗi có sẵn.
- **Hoãn chiến dịch N phút:** thay bằng khoá thao tác của tài khoản, để chiến dịch khác của tài khoản đó không chen vào.

## 0. Tóm tắt

**Nguồn.** Chỉ đọc production, chạy tuần tự từng câu, ngoài giờ cao điểm (21:28–22:10 VN 11/11), cộng code hiện tại:

| Nguồn | Phạm vi | Quy mô |
|---|---|---|
| Lịch sử chạy Zalo (`auto_campaign_details`) | 12/10–11/11 | ~7,34 triệu dòng; tách theo thao tác × trạng thái × mã lỗi × mã Zalo |
| Lệnh Fly của chiến dịch (`chat_zalo_action`) | 07/10–11/11 | ~597 nghìn lệnh, trong đó ~118 nghìn thất bại hoặc chưa rõ kết quả |
| Lỗi API Zalo (`auto_zalo_api_error_logs`) | 11/06–11/11 | 2,1 triệu dòng; nhận mọi lỗi API Zalo của Desktop, VPS và bộ Fly cũ, kể cả lỗi không có dòng lịch sử. Có **43 mã Zalo** và 13 mã hệ thống |
| Ghi chú chiến dịch, khoá thao tác | 30 ngày | Lý do chiến dịch bị dừng và các khoá đang hiệu lực |
| Code Desktop/VPS (`campaignScheduler`, `zaloRuntimeService`, engine v2) | hiện tại | 201 tín hiệu ([kê chi tiết](#7-phụ-lục)) |
| Code Fly (bộ cũ, runtime, chat-api, engine v2) | hiện tại | 131 tín hiệu |

**Cách dùng hai nguồn.**

- Lỗi hệ thống: code hiện tại quyết định có những tín hiệu nào (mạng, quá giờ, DB, runtime, ngoại lệ). Bộ mới xếp các tín hiệu này
  theo *loại × pha* (chưa gửi / đang gửi / đã gửi); mỗi tổ hợp có luật bắt-tất-cả nên câu lỗi lạ vẫn có chỗ xử lý.
- Mã Zalo: lấy từ dữ liệu, vì Zalo tự trả mã và code không liệt kê hết được.
- Lỗi chỉ thấy ở bản cũ: ghi riêng ở mục 6, không dựng chính sách mới.

**Mười điểm lớn nhất.** Trong 30 ngày, các lỗi dưới đây xử lý sai so với ý nghĩa thật của nó.

1. Lỗi mạng và lỗi hạ tầng đang bị tính như lỗi nghiệp vụ Zalo: tính lượt, cộng chuỗi lỗi, đốt data. Gồm khoảng 6 nghìn
   lỗi `ECONNRESET`…, khoảng 8 nghìn lệnh Fly `fetch failed`, ~8,3 nghìn lượt quá giờ gửi media, 527 lượt `-69 Stop retry`
   và hàng trăm lượt "runtime chưa sẵn sàng / đổi runtime". Lỗi ghi kết quả vào DB của mình còn tạm dừng chiến dịch:
   30 chiến dịch dừng vì `output_invalid … fetch failed`.
2. Khoảng 19,8 nghìn dòng "thất bại" không mang mã Zalo, đều rơi vào Z999 (tính lượt, cộng chuỗi). Phải ghi mã gốc mới
   phân loại đúng được.
3. Mã 114 do Zalo trả (12 nghìn dòng) và 114 do app tự đặt khi data thiếu SĐT/UID đều cộng chuỗi lỗi. Kết quả là 53 chiến
   dịch dừng vì "Dừng sau 4 data… Tham số không hợp lệ".
4. Tên gợi nhớ dài quá 50 ký tự làm "đổi tên" lỗi 7,5 nghìn lần (mã 112). Cần cắt tên trong code.
5. Đường chia sẻ vào nhóm không ánh xạ được mã, nên ghi Z999 có tính lượt: 26 nghìn lượt mã 112 (phần lớn là file đã vào
   nhóm, chỉ phần chữ bị từ chối) và 1,3 nghìn lượt mã 161.
6. Các lỗi vì gửi nhanh hoặc hết lượt (127, 123, 221 nhắn nhóm, 314) hôm nay **đánh dấu data hoàn thành** dù tin chưa tới.
   Khoảng 59 nghìn lượt trong 30 ngày là cơ hội gửi bị mất. Đề xuất hẹn data lại tới lúc hết khoá.
7. Các mã mục tiêu hỏng hẳn (216/212/219/210/122/119/126/215/251) vẫn bị nghỉ đủ "Nghỉ giữa 2 lần" và vẫn được tra hoặc
   gửi lại ở lượt sau. Khoảng 1,25 triệu lượt.
8. Bộ Fly cũ luôn ghi "thêm thành viên nhóm" là thành công, kể cả khi lỗi.
9. Bộ cũ đổi "về hàng đợi" thành "tạm dừng" khi bước trước đã thành công, nên data kẹt vĩnh viễn (120/802). Engine v2 đã sửa.
10. Chưa có bộ đếm số lần thử lại cho lỗi tạm thời, và chưa có hiệu ứng "báo cho khách" khi tài khoản bị hạn chế, đăng xuất
    hay chiến dịch bị dừng.

## 1. Các điều khiển cho mỗi lỗi

Anh yêu cầu: nghỉ, đếm lượt, đếm lỗi, trạng thái data, trạng thái lịch sử. Em thêm các điều khiển còn thiếu, đánh dấu ➕.
Phần lớn đã có trong `auto_outcome_policies` (V495); những dòng ghi "cột mới" thì phải thêm.

| Điều khiển | Giá trị | Ký hiệu trong bảng |
|---|---|---|
| Lịch sử chạy | ghi / không ghi; trạng thái theo V494 | tên trạng thái; `—` = không ghi |
| Data | hoàn thành / về chờ xử lý ngay / hẹn lại sau N phút hoặc tới lúc hết khoá / tạm dừng; kèm ghi chú | HT, CXL, HL(…), TD |
| Bước còn lại của data | chạy tiếp / bỏ | tiếp, bỏ |
| Tính lượt (hạn mức) | có / không / chỉ khi đã gửi | có, không |
| Đếm lỗi liên tiếp | +1 / về 0 / giữ nguyên; ngưỡng (hôm nay 4) thì tạm dừng chiến dịch | +1, 0, = |
| Khoá thao tác | thao tác nào; N phút / hết ngày / N ngày tới giờ X / vô thời hạn | |
| Lượt chạy / chiến dịch / tài khoản | tiếp / kết thúc lượt / dừng tài khoản / tạm dừng chiến dịch; đổi trạng thái đăng nhập | lượt, TK, CD, ĐN |
| Nghỉ giữa 2 lần | đủ / ngắn (N giây) / không | đủ, ngắn, không |
| ➕ Nhớ mục tiêu hỏng | N ngày, phạm vi tổ chức | 30n |
| ➕ Số lần thử lại tối đa | lỗi tạm thời: tối đa 3 lần mỗi data trong 24 giờ, cách 5 → 15 → 60 phút; quá thì HT "lỗi kết nối" (**cột mới**) | |
| ➕ Tính "đã gửi" cho chống gửi lặp N ngày | có khi giao một phần hoặc chưa rõ kết quả, để không gửi trùng | |
| ➕ Nhóm báo cáo | theo trạng thái hệ thống V494: thành công / thất bại / bỏ qua / dừng / lỗi / chờ | |
| ➕ Báo cho khách (trung tâm thông báo V457) | có / không (**cột mới** + nối V457) | Báo |
| ➕ Đơn vị đếm lỗi liên tiếp | giữ như hôm nay: tài khoản × thao tác, về 0 khi thành công | |
| Mã và câu cho khách | `<câu> (<mã>)` | |

## 2. Bảng chính: mã Zalo

Cột "30 ngày" = lịch sử chạy của Desktop/VPS và bộ Fly cũ, cộng lệnh Fly (ghi "Fly"). Mã chỉ có số đếm toàn thời gian thì ghi
"(từ 06/2026)". Chỗ đề xuất khác hôm nay thì ghi hành vi hôm nay trong ngoặc.

### 2.1 Mục tiêu hỏng hẳn: không nhận được, không có Zalo

| Mã | Thao tác | 30 ngày | Lịch sử | Data | Bước sau | Lượt | Chuỗi | Khoá | Dừng | Nghỉ | Nhớ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 216/212/214 | tra số | 692 nghìn; Fly 52,8 nghìn | không tồn tại | HT | bỏ | có (Zalo đếm mọi lượt tra) | = | — | — | **ngắn 90 giây** (đủ) | **30n** |
| 219 | tra số | 1,5 nghìn; Fly 150 | không tồn tại | HT | bỏ | có | = | — | — | ngắn | 30n |
| 210 | tra số, kết bạn | 1,4 nghìn; Fly 105 | không tồn tại | HT | bỏ | có (không) | = | — | — | ngắn | 30n |
| 216 | kết bạn | 793; Fly 42 | không tồn tại | HT | — | **không** (có) | = | — | — | **không** | 30n |
| 122 | nhắn người lạ, thêm thành viên | 505 nghìn; Fly 40,7 nghìn | người nhận chặn tin* | HT | tiếp (kết bạn vẫn chạy) | không | = | — | — | **không** (đủ) | **30n** |
| 119 | nhắn bạn bè/người lạ, thêm thành viên | 11 nghìn; Fly 359 | người nhận chặn tin* | HT | tiếp | không | = | — | — | không | 30n |
| 126 | nhắn bạn bè/người lạ, thêm thành viên | 5,8 nghìn; Fly 201 | người nhận chặn tin* | HT | tiếp | **không** (có) | = | — | — | không | 30n |
| 215/251 | kết bạn | 6 nghìn; Fly 864 | người nhận chặn tin* | HT | — | **không** (có) | = | — | — | không | 30n |
| 311 | kết bạn | 1,3 nghìn | thất bại | HT | — | có | **=** (+1: 22 chiến dịch dừng vì "Yêu cầu kết bạn không thành công") | — | — | đủ | — |
| 161 | nhắn nhóm (cả chia sẻ) | 1,3 nghìn, trong đó 1,3 nghìn qua chia sẻ ghi Z999 | không tồn tại | TD (V471) | — | không | = | — | — | không | 30n |
| 227 | vào nhóm bằng link | 79 | thất bại | HT | — | không | **=** (+1) | — | — | không | 30n |
| 172 | vào nhóm bằng link | 2 (từ 06/2026) | thất bại "nhóm đã đủ thành viên" | HT | — | không | = | — | — | không | 30n |

Ghi chú:
- **Vì sao nghỉ ngắn sau 216/212/219/210 khi tra số.** Không tin nào được gửi nên không cần nghỉ để tránh 127. Nhưng Zalo
  chặn tra số (221) khi một tài khoản tra quá khoảng 40 lần trong 60 phút cuốn chiếu (đo 02/11). Nghỉ 90 giây giữ nhịp dưới
  40 lần/giờ. Bỏ hẳn nghỉ sẽ làm tăng 221.
- **122 và 126 không tính lượt, không nghỉ.** Đo 02/11: 127 chỉ xảy ra sau tin người lạ đã gửi được trong 5 phút trước đó
  (1.084/1.086 ca); 122 và số không tồn tại không góp vào nhịp này.

### 2.2 Đã xong hoặc đã có sẵn (không phải lỗi)

| Mã | Thao tác | 30 ngày | Lịch sử | Data | Lượt | Chuỗi | Nghỉ |
|---|---|---|---|---|---|---|---|
| 225 | kết bạn | 5,4 nghìn; Fly 1,3 nghìn | đã là bạn bè | HT | không | = | **không** (đủ) |
| 222 | kết bạn ("Tự động kết bạn") | 101; Fly 22 | thành công | HT | có | 0 | đủ |
| 178 | thêm thành viên / vào nhóm bằng link | 45 | đã là thành viên / đã tham gia | HT | không | = | không |
| 240 | thêm thành viên ("chờ duyệt") | 2 (từ 06/2026) | **đã gửi lời mời** (Z999) | HT | có | 0 | đủ |

### 2.3 Tài khoản bị hạn chế hoặc hết lượt: tin chưa tới, phải chờ

Tin không tới người nhận, nên đề xuất **không đốt data** mà hẹn lại tới lúc hết khoá, và **không tính lượt**.
Hôm nay nhiều mã trong nhóm này đánh dấu data hoàn thành.

| Mã | Thao tác | 30 ngày | Lịch sử | Data | Bước sau | Lượt | Chuỗi | Khoá | Dừng | Báo |
|---|---|---|---|---|---|---|---|---|---|---|
| 120 | nhắn người lạ | 921; Fly 324; 153 khoá đang hiệu lực | tài khoản bị hạn chế* (—) | **HL tới lúc hết khoá** (CXL) | **bỏ** (tiếp) | không | = | nhắn người lạ tới 09:45 hôm sau | lượt | **có** |
| 802 | nhắn người lạ | Fly 89; 35 khoá đang hiệu lực | tài khoản bị hạn chế* (—) | HL | bỏ | không | = | nhắn người lạ tới 09:45 ngày mốt | lượt | có |
| 120/802 | nhắn bạn bè | 130 (Z999) | tài khoản bị hạn chế* | HL | bỏ | không (có) | = (+1) | nhắn người lạ, như trên (người nhận không còn là bạn) | lượt | có |
| 120/802 | thêm thành viên | 4 khoá đang hiệu lực | tài khoản bị hạn chế* | HL | — | không | = | thêm thành viên 1 ngày / 2 ngày tới 09:45 | lượt | có |
| 127/123 | nhắn người lạ | 44,1 nghìn; Fly 7,7 nghìn | tài khoản bị hạn chế* (thất bại) | **HL 30 phút** (HT) | bỏ | **không** (có) | = | nhắn người lạ 30 phút | lượt | — |
| 127/126 | nhắn nhóm | 2,3 nghìn | tài khoản bị hạn chế* (thất bại) | **HL 30 phút** (HT) | — | **không** (có) | = | nhắn nhóm 30 phút | lượt | — |
| 127/123 | nhắn bạn bè | 72 | tài khoản bị hạn chế* (thất bại) | **HL 30 phút** (HT) | — | **không** (có) | = | nhắn bạn bè 30 phút | lượt | — |
| 221/312 | tra số | Fly 1,1 nghìn; 108 lượt 312 (từ 06/2026) | đạt giới hạn* (—) | CXL | bỏ | **không** (có) | = | tra số 60 phút | lượt | — |
| 221 | đọc hồ sơ (chiến dịch thành viên nhóm, Fly) | Fly 1,2 nghìn | — (Z999) | CXL | — | không | = | đọc hồ sơ / tra số 60 phút (**cần thao tác khoá riêng**) | lượt | — |
| 313/304 | tra số | 49 / 5 (từ 06/2026) | đạt giới hạn* (—) | CXL | bỏ | không | = | tra số tới hết ngày | lượt | 304 có |
| 221 | nhắn nhóm | 12,4 nghìn | đạt giới hạn* (thất bại) | **HL 60 phút** (HT) | — | **không** (có) | = | nhắn nhóm 60 phút | lượt | — |
| 221 | kết bạn, nhắn bạn bè, nhắn người lạ | 59 | đạt giới hạn* (thất bại hoặc Z999) | **HL 60 phút** (HT) | — | không | = | thao tác đó 60 phút | lượt | — |
| 314 | thêm thành viên | 576; Fly 132 | đạt giới hạn* (thất bại) | **HL 60 phút** (HT) | — | không | = | thêm thành viên 60 phút | lượt | — |
| 299 | vào nhóm bằng link | 3 | đạt giới hạn* (Z999) | CXL | — | không | = (+1) | vào nhóm bằng link tới hết ngày | lượt | — |
| 301 | huỷ lời mời kết bạn | 1 (từ 06/2026) | đạt giới hạn* (Z999) | CXL | — | không | = (+1) | huỷ lời mời tới hết ngày | lượt | — |
| 223 | kết bạn | Fly 55; 6,2 nghìn (từ 06/2026) | — | CXL | bỏ | không | = | — | **CD** (giữ) | **có** |
| 224 | kết bạn | Fly 2; 70 (từ 06/2026) | — | CXL | bỏ | không | = | kết bạn vô thời hạn | CD (giữ) | có |
| 264/269/183 | thêm thành viên | 4 / 29 / 5 (từ 06/2026) | — | CXL | — | không | = | — | CD (183 hôm nay Z999) | có |
| 164 | thêm thành viên ("Bạn không phải thành viên của nhóm này") | 3 | — (Z999) | CXL | — | không | = (+1) | — | **CD**: tài khoản không ở trong nhóm đích, mọi data sẽ lỗi giống nhau | có |

Ghi chú:
- **127 hôm nay đánh dấu data hoàn thành** (khoảng 44 nghìn lượt người lạ trong 30 ngày): người nhận không bao giờ nhận được tin.
  Hẹn lại 30 phút thì tin vẫn được gửi.
- **Khoá theo tài khoản × thao tác**, dùng chung cho mọi chiến dịch của tài khoản đó, như hôm nay.

### 2.4 Nội dung hoặc cấu hình sai

| Mã | Thao tác | 30 ngày | Lịch sử | Data | Lượt | Chuỗi | Dừng | Báo | Sửa code |
|---|---|---|---|---|---|---|---|---|---|
| 118 "Nội dung quá dài" | nhắn tin | 144 (+9) | — (thất bại) | **CXL** (HT) | không (có) | = (+1) | **CD một lần**, ghi chú chỉ đúng nội dung | có | kiểm độ dài lúc lưu form (luật CFG) |
| 112 | đổi tên gợi nhớ | 7,5 nghìn (Z999); Fly 155 | thất bại | HT | không | = | — | — | **cắt tên ≤ 50 ký tự trước khi gửi** |
| 230 "Outdated input" | gắn tag | 15 | — | CXL, làm mới danh sách nhãn rồi thử lại một lần | không | = | — | — | làm mới nhãn |
| 114 (Zalo trả) | gắn tag, nhắn tin, kết bạn, thêm thành viên, đổi tên | ~12 nghìn; Fly 1,6 nghìn | tham số không hợp lệ | HT | **không** (có với nhắn tin) | **=** (+1: 53 chiến dịch bị dừng) | — | — | — |
| 112 | nhắn nhóm (gửi chữ) | 2,9 nghìn (V471) | thất bại | HT | không | +1 (V471, giữ) | — | — | — |
| 112 qua chia sẻ | nhắn nhóm dạng chia sẻ | 26 nghìn (Z999 có tính lượt) | **thành công, giao một phần**: file đã vào nhóm, chữ bị từ chối | HT | có | = | — | — | đường chia sẻ phải ánh xạ mã |
| Tệp không đọc được (EPERM), media tải lỗi (`campaign_media_download_failed`) | nhắn có tệp | 6 + 2 | — (Z999) | CXL | không | = | **CD một lần** (CFG01) | có | — |

### 2.5 Phiên đăng nhập

| Mã | Thao tác | Số lần | Lịch sử | Data | Bước sau | Lượt | Chuỗi | Dừng | Báo |
|---|---|---|---|---|---|---|---|---|---|
| 600 "zpw_sek bị thiếu" | mọi thao tác | 747 (từ 06/2026) | — (V494 có "hết phiên đăng nhập"*) | CXL | **bỏ** (tiếp) | không | = | dừng tài khoản, đổi "chưa đăng nhập" (giữ) | **có** |

### 2.6 Mã Zalo lạ chưa có luật

Ghi "thất bại", tính lượt, +1 chuỗi, nghỉ đủ, như hôm nay. Ghi vào `auto_outcome_unmatched` để thêm luật sau.
Bản cũ cũng xếp chung như vậy (Z999). Mã -69 "Stop retry" (527 lượt) không phải mã nghiệp vụ, xem 3.1.

## 3. Tín hiệu hệ thống (theo code hiện tại)

### 3.1 Mạng và hạ tầng

| Tín hiệu | Pha | 30 ngày | Lịch sử | Data | Lượt | Chuỗi | Dừng | Nghỉ | Hôm nay |
|---|---|---|---|---|---|---|---|---|---|
| Lỗi mạng trước khi gửi: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`, `ECONNABORTED`, `EPROTO`, `fetch failed`, HTTP 5xx/429, mã 20/23 "aborted", lỗi ở **bước tải tệp lên** | trước khi gửi (tra số, đọc hồ sơ, kiểm lời mời, tải tệp) | ~6 nghìn Desktop/VPS (ECONNRESET khi tải ảnh 5,6 nghìn); Fly 3,7 nghìn (tra số 3,4 nghìn, đọc hồ sơ 248, kiểm lời mời 52) | — (cuối cùng là "lỗi kết nối"*) | **HL 5 → 15 → 60 phút, tối đa 3 lần** rồi HT "lỗi kết nối" | không | = | lượt | không | Z999: tính lượt, +1, HT |
| Lỗi mạng khi đang gửi: `fetch failed`, socket đứt sau khi lệnh gửi đã đi, -69 ở bước gửi | đang gửi (chữ, tệp, kết bạn, đổi tên, gắn tag) | Fly: đổi tên 1,9 nghìn, gắn tag 1,2 nghìn, gửi tệp 1 nghìn, kết bạn 256, gửi chữ 140; -69: 527 | chưa rõ kết quả* | HT, không gửi lại (UNK01) | có (có thể đã tới) | = | — | đủ | Z999 |
| Quá giờ gửi media `campaign_media_timeout`; `command_result_unknown`; `command_dispatch_failed` | đang gửi | 8,3 nghìn + ~50 | chưa rõ kết quả* | HT, không gửi lại; **tính là "đã gửi" cho chống gửi lặp** | có | = (+1: 9 chiến dịch dừng) | — | đủ | Z999 |
| Runtime chưa sẵn sàng, đổi runtime, chưa gửi lệnh: `campaign_runtime_unavailable(_before_dispatch)`, `campaign_runtime_binding_changed`, `campaign_failed/cancelled_before_dispatch`, `zalo_command_timeout` ở thao tác đọc, `command_handler_unavailable` | trước khi gửi | ~520 Fly | — | CXL, thử lại sau 1 phút (NET03) | không | = | lượt | — | Z999 hoặc kẹt |
| Proxy lỗi lặp lại (lỗi mạng liên tiếp trên tài khoản dùng proxy) | trước khi gửi | 4 chiến dịch dừng một lúc (06/11) | — | CXL | không | = | **dừng tài khoản sau 3 lần, báo khách** (NET02) | — | 4 data lỗi thì dừng chiến dịch |

Phải sửa code để phân pha cho đúng:

- **Desktop:** tách bước tải tệp khỏi bước gửi tin. Lỗi ở máy chủ tải tệp (`tt-files-wpa…`) là *trước khi gửi*.
- **Fly:** runtime không còn gộp mọi lỗi mạng, HTTP và payload sai vào `zalo_command_failed`. Thao tác đọc (tra số, đọc hồ sơ)
  luôn là *trước khi gửi*.

### 3.2 Lỗi của chính mình

| Tín hiệu | Số lần | Đề xuất | Hôm nay |
|---|---|---|---|
| DB lỗi khi ghi kết quả: `fetch failed` tới Supabase, timeout kết nối, P0001… | 30 chiến dịch bị tạm dừng trong 30 ngày (`Lượt chạy gặp lỗi: output_invalid … fetch failed`); 8 chiến dịch "Tạo data chiến dịch chưa hoàn tất" | Giữ kết quả trong nhật ký và gửi bù đúng một lần; tiến trình báo "Mất kết nối máy chủ, đang chờ để chạy tiếp (DB01)"; **không tạm dừng chiến dịch, không đổi kết quả Zalo** (đã có ở engine v2) | tạm dừng chiến dịch |
| Lưu danh bạ lỗi sau khi tra số đã thành công | (code) | Tra số vẫn tính thành công (F1, đã có ở engine v2) | ghi "Tìm SĐT thất bại" |
| Ngoại lệ trong code của mình (`err_undefined`) | 38 chiến dịch "Có lỗi xảy ra", 6 chiến dịch "Lỗi không xác định" | Lịch sử "lỗi", HT, +1, ngưỡng 4 thì tạm dừng chiến dịch (SYS99, giữ) | như vậy; Fly tạm dừng ngay lần đầu |
| Lượt không ra kết quả nào | (code) | "lỗi" (SYS07) | "thành công" giả |
| Bộ Fly cũ: "thêm thành viên nhóm" luôn thành công | (code) | Sửa đọc kết quả; v2 sẽ phủ thao tác này ở giai đoạn 3 | ghi sai |

### 3.3 App tự phát hiện (trước khi gửi)

| Tín hiệu | Đề xuất |
|---|---|
| Data thiếu SĐT/UID/ID nhóm/link; chia sẻ tới chính mình (app tự đặt 114) | DAT01: thất bại, HT, không tính lượt, không cộng chuỗi, không nghỉ (đề xuất #6 cũ) |
| SĐT sai định dạng | Không cần: 100% SĐT của 126 nghìn lượt tra gần nhất đã đúng định dạng (bước tải data chuẩn hoá) |
| Nội dung rỗng vì data thiếu cột dùng trong mẫu | CFG13 theo data: HT, không tính lượt |
| Zalo trình duyệt gửi tệp không phải ảnh; quá số tệp; đuôi tệp bị chặn | CFG10–CFG12: kiểm một lần đầu lượt, tạm dừng chiến dịch một lần, không đốt data, báo khách |
| Người nhận từ chối nhận tin | OPT01: bỏ qua, không tính lượt, không nghỉ |
| Trong danh sách loại trừ / đã gửi trong N ngày (chống gửi lặp) | bỏ qua, không tính lượt, không nghỉ |

### 3.4 Điều phối và vòng đời

| Tín hiệu | Đề xuất (đã chốt ở cấu trúc mới) |
|---|---|
| Khách tạm dừng, dừng, đăng xuất; app tắt | RUN01: data chưa gửi về hàng đợi, không tính lỗi |
| App, Fly hoặc máy chết giữa chừng; lease hết hạn | Chưa có dấu "sắp gửi": SYS01 (HT, hoặc về hàng đợi nếu đặt `requeue`). Có dấu: SYS02, HT, không gửi lại |
| Album hoặc chữ + tệp gửi được một phần; thành công mà không có `msgId` | Thành công, giao một phần; tính lượt; tính "đã gửi" cho chống gửi lặp; không gửi lại |

## 4. Phần đổi so với seed hôm nay (đề xuất ban đầu; đã thay bằng "Quyết định đã chốt")

Áp bằng V500 (bản nháp đã viết, chưa apply): chỉ dữ liệu trong `auto_outcome_policies` và `auto_outcome_signal_rules`, có
lịch sử, xem trước được bằng `aka_agent_engine_simulate_v1`. Chỉ ảnh hưởng bộ mới (tổ chức bật cờ, Desktop bản mới); bản cũ
vẫn đọc `auto_error` như hôm nay. Mỗi dòng của V500 ghi mã đề xuất trong cột `description` (`[P1]`…); bỏ mục nào thì xoá
các dòng của mục đó trong đặc tả `scripts/build-v500-sql.cjs` rồi sinh lại.

1. **P1** Nghỉ: không nghỉ sau 122/119/126/215/251/216 (kết bạn)/225/161/227/178/DAT01; nghỉ ngắn 90 giây sau 216/212/214/219/210 khi
   tra số (không bao giờ dài hơn "Nghỉ giữa 2 lần" của khách).
2. **P2** Không tính lượt: 126, 215/251, 216 (kết bạn), 127/123/221/314 (tin chưa tới), 118, 114 (Zalo trả), 802 thêm thành viên.
3. **P3** Không cộng chuỗi lỗi: 311, 227, 114 (Zalo trả), 118, lỗi mạng, chưa rõ kết quả.
4. **P4** Hẹn data lại thay vì đốt: 127/123 (tới lúc hết khoá 30 phút), 221 nhắn nhóm/bạn bè/kết bạn (60 phút), 314 (60 phút),
   120/802 (tới lúc hết khoá); tối đa 3 lần trong 24 giờ rồi hoàn thành. 120/802 khi nhắn bạn bè: hẹn lại một lần.
5. **P5** Bỏ bước còn lại khi hẹn data lại (để lần sau chạy trọn): 127/123/221/314/120/802, 600, 118, NET01.
6. **P6** Nhớ mục tiêu 30 ngày trong tổ chức: 216/212/214/219/210/122/119/126/215/251/161/227/172.
7. **P7** Luật phân loại mới: lỗi chưa gửi chưa có luật → NET01, lỗi khi đang gửi chưa có luật → UNK01, -69 → UNK01,
   "Chưa có session Zalo" → Z600, data thiếu thông tin → DAT01 (thôi mượn 114), 120/802 khi nhắn bạn bè, mã hiếm
   164/172/183/230/240/299/301 theo thao tác.
8. **P8** 8 mã mới chỉ cho engine (`error_type = 'engine v2'`, không có mã Zalo nên bản cũ không thấy): NET04 hết lượt thử,
   Z164, Z183, Z172, Z299, Z301, Z230, Z240, kèm câu cho khách.
9. **P9** Thử lại có giới hạn (cần V499): NET01 hẹn data 5/15/60 phút và hoãn chiến dịch 5 phút; NET03 hẹn 1/5/15/30/60 phút và
   hoãn chiến dịch 1 phút; tra số không rõ kết quả như NET01. Quá số lần thì NET04: ghi lịch sử "thất bại", hoàn thành data.

## 5. Phải sửa code (không chỉ dữ liệu)

| Việc | Nơi | Trạng thái |
|---|---|---|
| Phân pha lỗi mạng theo loại thao tác (đọc / gửi); lỗi trước khi gọi Zalo là chưa gửi | lõi, cổng Desktop, cổng Fly | **xong ở local** |
| Fly: lỗi `zalo_command_failed` của runtime ("fetch failed", HTTP…) xếp theo loại lệnh | cổng Fly đọc câu lỗi, **không cần sửa/deploy `zalo_runtime`** | **xong ở local** |
| Nhớ mục tiêu theo tài khoản (Q6) | V499 | **xong ở local, chưa apply** |
| Hiệu ứng "báo cho khách" | tạm dừng chiến dịch, đăng xuất: đã có (V457); khoá thao tác: cần loại sự kiện mới ở trung tâm thông báo | làm sau (Q8) |
| Tách tải tệp khỏi gửi (lỗi ở máy chủ tải tệp là chưa gửi) | lõi + cổng, khi phủ tin có tệp | giai đoạn 3 (engine chưa chạy tin có tệp) |
| Đường chia sẻ ánh xạ đúng mã 112/161/122…; 112 sau khi file đã vào nhóm là giao một phần | lõi + cổng, khi phủ chế độ chia sẻ | giai đoạn 3 |
| Cắt tên gợi nhớ ≤ 50 ký tự; làm mới nhãn khi 230 | lõi (thao tác phụ) | giai đoạn 3 (engine chưa chạy thao tác phụ) |
| Thao tác khoá riêng cho "đọc hồ sơ" (221 khi đọc hồ sơ) | `auto_account_actions` + lõi, khi phủ chiến dịch thành viên nhóm | giai đoạn 3 |
| Bật trạng thái V494. Trước đó sửa những nơi đếm theo chữ "thất bại": báo cáo, Automation, scheduler, bộ chạy chat | theo [V494, mục "Bước tiếp theo"](https://github.com/aligoinc/akaAgent/blob/dev_3/docs/ACTION_SYSTEM_STATUSES_V494.md) | đợt sau (Q7) |
| Dừng khi mạng/proxy hỏng lặp lại | khoá tài khoản 5 phút mỗi lần + 4 lần liền tạm dừng chiến dịch (Q5, chỉ dữ liệu V500) | **xong ở local** |
| Fly bộ cũ: sửa "thêm thành viên luôn thành công" | ChatApi bộ cũ | chỉ cần nếu còn giữ bộ cũ lâu |

## 6. Chỉ thấy ở bản cũ (không dựng chính sách mới)

| Tín hiệu | Lần cuối | Lý do |
|---|---|---|
| P0001 `canonical_campaign_input_payload_immutable` | 11/09 | Bản ≤ 7.2.0; đã sửa ở 7.3.0 |
| `err_undefined` "timeout exceeded when trying to connect" | 08/09 | Lỗi kết nối DB của bản cũ |
| 23 "The operation was aborted due to timeout" | 15/09 | Bản cũ chưa có xử lý quá giờ |
| 264, 178 khi thêm thành viên | 09/07 | Policy 264/269 đã có từ 10/2026 |
| 224 ghi Z999 | 25/09 | Đã có policy 224 |
| 301, 313 | 23/09, 01/10 | Hiếm; vẫn đưa vào bảng chính vì mã còn có thể xuất hiện |

## 7. Phụ lục

- Danh sách tín hiệu trong code nằm ở hai file tạm của phiên nghiên cứu (chưa đưa vào repo):
  - Desktop/VPS: 201 dòng, file:line;
  - Fly: 131 dòng.

  Có thể chép vào `docs/` nếu anh muốn giữ.
- Số liệu thô (gom theo thao tác × trạng thái × mã) cũng ở file tạm. Mọi câu truy vấn đều chỉ đọc, chạy tuần tự từng câu.

## 8. Cần anh quyết

Đã trả lời hết tối 11/11: xem "Quyết định đã chốt" ở đầu file.
