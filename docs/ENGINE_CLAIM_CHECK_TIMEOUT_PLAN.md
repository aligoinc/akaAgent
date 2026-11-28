# Claim engine v2 quá giờ: phương án theo từng trường hợp (28/11/2026)

Trạng thái: không làm. Anh chốt 28/11 giữ nguyên cách thử lại hôm nay ("cứ thử đi thử lại nếu hệ thống chập chờn thì sẽ thử đến lúc
được"; lỗi cố định thì cách nào cũng phải sửa nguyên nhân, nên anh tự kiểm), rồi bảo "Thêm câu dò": nhóm (D) của
`scripts/engine-v2-stuck-accounts.cjs` liệt kê chiến dịch tới giờ còn data mà đứng yên (xem
[ENGINE_V2_ACCOUNT_HOLD_RULE_V681.md](ENGINE_V2_ACCOUNT_HOLD_RULE_V681.md), mục "Câu dò cho lần kiểm sức khoẻ"). Phần dưới giữ lại để
tham khảo nếu sau này cần làm.

Bối cảnh: anh yêu cầu 28/11 ("Lên phương án") sau ca chiến dịch 53573 (nguyên nhân chậm đã sửa ở
[V682](DELIVERY_COOLDOWN_V682.md)), rồi yêu cầu đưa ra các trường hợp có thể xảy ra ("lỗi bất ngờ khó kiểm soát, không biết chỉ bị ở
1 data hay một ngày nào đó bị ở toàn bộ data").

## Chuyện gì xảy ra hôm nay khi claim quá giờ (đọc code 28/11)

- Claim `aka_agent_engine_claim_target_v1` (bản V670 đang chạy, md5 `8d45e070…`) làm nhiều bước trong một lần gọi: chọn data đầu hàng
  đợi, kiểm loại trừ gửi, kiểm chống gửi lặp, kiểm người nhận (V571), tính hạn mức, ghi lượt. Mỗi lần gọi có trần thời gian theo nơi
  chạy: Desktop 3 giây, VPS 8 giây, Fly 120 giây (mặc định nền tảng).
- Các bước có khối bắt lỗi (`WHEN OTHERS`), nhưng khối đó không bắt lỗi quá giờ. Quá giờ ở bất kỳ bước nào là cả lần gọi bị huỷ,
  không ghi chú, không lưu gì.
- Lõi engine coi lỗi đó là lỗi tạm thời: thử lại ngay trong lượt (chờ 1, 2, 5, 10, 30 rồi 60 giây một lần, không bao giờ dừng), in một
  dòng "⚠️ Mất kết nối máy chủ, đang chờ để chạy tiếp (DB01)". Lỗi lẻ thì lần thử sau qua; lỗi cố định thì thử mãi, lượt không đóng,
  trên máy đó tài khoản không chạy được chiến dịch khác.

## Các trường hợp (có số liệu từ log production)

| # | Trường hợp | Đã gặp | Hôm nay |
|---|---|---|---|
| T1 | Chập chờn, bước nào cũng có thể | 27/11: 19 lần lẻ ở 10 chỗ khác nhau trong claim (chọn data, hạn mức khung giờ, kiểm người nhận, ghi lượt…), tối đa 5 lần một giờ; 26/11: 28 lần, có lúc 8 lần trong 5 phút ở cùng một chỗ | Thử lại sau 1 giây thường là qua; chỉ thêm dòng DB01 |
| T2 | Một data chậm cố định | 27/11: chiến dịch 53573, 372 lần trong 20 giờ, đều ở bước chống gửi lặp của đúng data đầu hàng đợi | Chiến dịch đứng, không ghi chú |
| T3 | Cả chiến dịch chậm cố định (mọi data, hoặc bước không gắn data) | 14/11: chiến dịch 34061, 814 lần trong 11 giờ ở câu chọn data (sửa ở V532) | Chiến dịch đứng, không ghi chú |
| T4 | Cả hệ thống chậm (DB quá tải, migration giữ khoá, PostgREST treo) | 25/09 (trước khi có engine v2): migration giữ khoá bảng tài khoản 61 giây, khoảng 1.200 câu lệnh quá giờ trong 10 phút; sáng nay 09:21 VN PostgREST treo, claim ở mọi máy chậm 5–7 giây cùng lúc (chưa tới mức quá giờ) | Mọi chiến dịch gặp lỗi đều thử lại liên tục, dồn thêm tải lúc DB đang chậm |
| T5 | Chỉ chậm ở một nơi chạy | Câu kiểm của 53573 mất 3,8–4,3 giây: quá trần 3 giây của Desktop, chạy được ở VPS (8 giây) | Như T2 / T3, chỉ trên Desktop |

Lúc quá giờ, chỗ báo lỗi là chỗ đồng hồ vừa hết, chưa chắc là chỗ chậm (bước trước có thể đã ăn gần hết 3 giây). Vì vậy không phân
loại theo bước, mà theo việc lỗi có lặp lại hay không và lặp ở phạm vi nào.

## Nguyên tắc

1. Lần quá giờ đầu tiên coi là chập chờn: thử lại ngay như hôm nay (T1 vẫn y như cũ).
2. Lặp lại ở cùng chiến dịch mới xử lý, và xử lý theo phạm vi: riêng một data thì hẹn lại data đó; nhiều data hoặc bước không gắn data
   thì cho chiến dịch chờ; nhiều chiến dịch cùng lúc thì mọi chiến dịch gặp lỗi đều chờ và không hẹn lại data nào.
3. Không gửi khi chưa kiểm xong (giữ nguyên chống gửi lặp, loại trừ gửi).
4. Chờ thì có giãn cách, để không dồn tải lúc DB đang chậm; hết chậm thì tự chạy lại, không cần ai bấm.
5. Lần quá giờ nào cũng được ghi lại để mình đếm và kiểm sức khoẻ.

## Cách làm (chỉ sửa DB)

- Bắt lỗi quá giờ ở hai chỗ của claim: vòng kiểm từng data (loại trừ gửi, chống gửi lặp: biết data nào đang kiểm) và khối ngoài cùng
  (mọi bước còn lại). Chỉ lỗi quá giờ câu lệnh; huỷ tay (`pg_cancel_backend`) vẫn ném ra như hôm nay. Phần việc của bước bị quá giờ tự
  huỷ (không tạm dừng data nửa chừng).
- Ghi mỗi lần quá giờ vào một bảng nhỏ mới `private.auto_engine_claim_timeouts` (lúc, chiến dịch, data nếu có, tài khoản, nhân viên,
  nơi chạy, chỗ hết giờ, đã chờ bao lâu), giữ 30 ngày. Không thêm cột vào bảng đang chạy nóng.
- Đếm các lần gần đây để quyết định (số mặc định, sửa được bằng thiết lập `engine.claim_timeout`, không cần migration):

| Lần thứ (cùng chiến dịch, trong 10 phút) | Điều kiện | Xử lý |
|---|---|---|
| 1–2 | | Thử lại ngay: trả `cooldown_scan`, lõi gọi lại liền. Không đụng data, chiến dịch |
| từ 3 | Từ 5 chiến dịch khác cũng quá giờ trong 10 phút (T4) | Chiến dịch chờ 5, rồi 10, rồi 30 phút; ghi chú chiến dịch; không hẹn lại data |
| từ 3 | Các lần đều ở cùng một data, và 30 phút qua chiến dịch chưa hẹn lại data nào khác (T2) | Hẹn lại riêng data đó 5, rồi 30, rồi 120 phút (lặp 120); ghi chú data; chiến dịch chạy tiếp |
| từ 3 | Còn lại: nhiều data khác nhau, hoặc bước không gắn data (T3) | Chiến dịch chờ 5, rồi 10, rồi 30 phút (lặp 30); ghi chú chiến dịch |

- "Chờ" = chiến dịch về "chờ xử lý", lịch dời tới giờ chạy tiếp, trả `gate_unavailable`: lõi kết thúc lượt, nhả tài khoản (chiến dịch
  khác của tài khoản chạy được). "Hẹn lại data" = `schedule` của data dời tới giờ thử lại, như engine đang hẹn data khi tài khoản bị khoá.
- Một chiến dịch hẹn lại tối đa một data trước khi chuyển sang chờ cả chiến dịch, nên T3 không bị nhận nhầm thành T2 rồi hẹn lại lần
  lượt cả danh sách.
- Công tắc `engine.claim_timeout.enabled = false` trả về đúng hành vi hôm nay (không bắt lỗi), không cần migration.
- Lõi engine, Desktop, App Server, Fly không đổi: bản nào đang chạy cũng đã hiểu `cooldown_scan`, `gate_unavailable`, `cooldownPaused`
  và lịch của data; cổng Desktop / Fly không kiểm khuôn phản hồi claim.

## Sau khi sửa, từng trường hợp

| # | Khách thấy | Chiến dịch | Mình thấy |
|---|---|---|---|
| T1 | Không gì (bớt cả dòng DB01) | Chạy như cũ | Một dòng trong bảng sự kiện |
| T2 | Dòng "⏸️ Bỏ qua "<SĐT - tên>": <câu data>" và ghi chú trên data | Chạy tiếp các data khác ngay; data đó tự thử lại sau 5, 30, 120 phút | Sự kiện lặp ở cùng một data |
| T3 | Dòng "⚠️ <câu chiến dịch>" và ghi chú chiến dịch | Chờ rồi tự thử lại, giãn dần tới 30 phút; hết chậm thì tự chạy | Sự kiện lặp ở một chiến dịch |
| T4 | Như T3, ở mọi chiến dịch gặp lỗi | Như T3; chiến dịch không gặp lỗi chạy bình thường | Sự kiện ở nhiều chiến dịch cùng lúc |
| T5 | Như T2 / T3 | Như T2 / T3 | Sự kiện ghi nơi chạy |

Ví dụ ca 53573 (T2): sau 3 lần thử (khoảng 9 giây) data 14274941 được hẹn lại 5 phút, chiến dịch gửi tiếp các data khác (data ít SĐT
trùng thì kiểm nhanh). Data đó quay lại sau 5 phút, lại quá giờ 3 lần thì hẹn 30 phút, rồi 120 phút một lần cho tới khi có V682.
Ca 34061 (T3): lần nào cũng quá giờ ở câu chọn data, nên chiến dịch chờ 5, 10, rồi 30 phút một lần, có ghi chú, tài khoản được nhả.

## Câu cho khách (chờ anh duyệt)

- Trên data (T2), lõi tự thêm phần đầu ở dòng Tiến trình: "Chưa kiểm tra xong giới hạn gửi/đăng lặp, sẽ thử lại lúc 10:30."
- Trên chiến dịch (T3, T4): "Hệ thống đang xử lý chậm, chiến dịch sẽ tự chạy tiếp lúc 10:30."
- Khác ngày thì thêm ngày ("lúc 00:15 29/11"), như câu chờ của engine hiện nay.

## Giá và rủi ro

- Thêm một subtransaction cho mỗi lần claim (khối ngoài cùng). Dưới trần 64 của một giao dịch: vòng kiểm tối đa 50 data, mỗi data một
  khối đã có sẵn. Đo lại khi code.
- Sau khi đã quá giờ, phần còn lại của lần gọi không còn trần thời gian, nên đường xử lý chỉ chạy vài câu theo khoá chính rồi trả về.
- Nhận cả lô (gửi dạng chia sẻ): lần nhận sau trong lô trả khác "claimed" thì lô hoàn tác lần nhận đó (kể cả dòng sự kiện); lô kế gặp
  lại data đó ở lần nhận đầu và xử lý ở đó. Đếm vì thế có thể chậm hơn một nhịp.
- T4 dài (DB chậm cả giờ): mỗi chiến dịch thử 3 lần rồi chờ giãn dần, tải thêm ít hơn hôm nay (hôm nay thử lại mãi mỗi 60 giây).

## Kiểm

- PG17 cục bộ, dựng DB tới V670 như `scripts/campaign-parallel-run-v670-smoke.cjs`, trần câu lệnh 1 giây, thay hàm kiểm bằng bản ngủ:
  T1 (chậm một lần), T2 (một data), T3 (mọi data; câu chọn data chậm), T4 (nhiều chiến dịch), huỷ tay, nhận cả lô, xáo trộn danh sách,
  nhận theo danh sách (đăng nhóm kèm chia sẻ), cổng `open`, công tắc tắt. Kiểm data không bị tạm dừng nửa chừng, không gửi khi chưa
  kiểm, tài khoản được nhả.
- Bộ kịch bản engine v2 trên thân claim mới: không có quá giờ thì kết quả giống hệt.
- Production: chạy migration trong giao dịch tự huỷ để thử kiểm md5, rồi apply ngoài giờ cao điểm (`CREATE OR REPLACE FUNCTION` làm
  PostgREST nạp lại schema). Số migration chọn lúc code (sổ đang tới V682, chưa nhánh nào có V683–V689).
- Kiểm sức khoẻ: thêm vào `scripts/engine-v2-stuck-accounts.cjs` phần đếm sự kiện theo phạm vi trong 24 giờ.

## Không làm

- Không đổi hàm chống gửi lặp và loại trừ gửi; không gửi khi chưa kiểm xong (trừ khi cổng `open`, như hôm nay).
- Không nâng trần 3 giây của Desktop cho claim (nâng thì T2 / T3 nhẹ hơn nhưng lúc T4 sẽ có nhiều lần gọi dài cùng giữ kết nối).
- Bộ chạy cũ Desktop: đã tự ghi chú và thử lại ở nhịp sau khi quá giờ (câu có chữ tiếng Anh), sửa phải build app.

## Cần anh chốt

1. Cách xử lý theo từng trường hợp ở bảng trên (thử lại 2 lần, rồi hẹn data / chờ chiến dịch theo phạm vi).
2. Hai câu cho khách.
3. Data chậm cố định (T2): cứ 120 phút thử lại một lần như đề xuất, hay sau 3 lần thì tạm dừng hẳn data (khách phải tự chạy lại).
