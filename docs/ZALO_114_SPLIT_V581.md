# Tách Z114 "Tham số không hợp lệ" thành 4 mã (V581)

Ngày 19/11/2026. Anh chốt: chỉ tách những trường hợp đã rõ nguyên nhân; câu hiển thị anh duyệt từng câu qua hộp chọn.
Chỉ áp dụng cho engine v2 (bộ chạy cũ không đổi).

## Trạng thái

- Migration `migrations/migration_v581_zalo_114_split.sql`: **đã apply akachat 11:17:13 VN 19/11/2026** theo yêu cầu ("ok chốt vậy đi,
  apply đi"; sổ `20261119041713`, không apply lại, md5 sổ = file `30524695…`; chỉ dữ liệu, không nạp lại schema;
  [biên nhận](../migrations/snapshots/zalo-114-split-v581/apply-receipt.json)). Hậu kiểm: 4 mã (id 169–172), 30 chính sách (id 400–429),
  4 luật, 0 dòng lint, engine chạy bình thường (478 lượt trong 3 phút, 0 lượt bị cắt ngang). Dòng TAG01 thật đầu tiên lúc 11:19:00 VN
  ("thất bại", không tính lượt, đúng câu đã duyệt).
- Lõi `packages/campaign-engine`, cổng Desktop: PR [aligoinc/akaAgent#720](https://github.com/aligoinc/akaAgent/pull/720) (chưa merge). Cổng Fly
  và lõi chép sang ChatApi: PR [aligoinc/akaAgentChatApi#174](https://github.com/aligoinc/akaAgentChatApi/pull/174) (chưa merge). Chưa deploy
  worker Fly, chưa build Desktop.
- TAG01 có hiệu lực từ lúc apply cho tài khoản chạy engine v2. DAT02, DAT03, DAT04 cần lõi mới: deploy `worker` Fly và build Desktop.
- **Bộ chạy cũ không đổi**: tổ chức chưa bật cờ engine v2 (còn chạy trên App Server) vẫn hiện "Tham số không hợp lệ" khi tag đầy. Ngày
  19/11 tới 11:18 VN: 4 tài khoản như vậy (6869, 12133, 10254, 11713; tổ chức 1300, 1914, 1090) có 70 lượt, 3 tài khoản engine (5474,
  4551, 4474) có 76 lượt. Muốn bộ cũ có câu mới thì thêm một dòng `auto_error` (mã Zalo 114 × `zalo_tag_contact`), chưa làm.

## Số đo (production, chỉ đọc, 19/11/2026)

Mã 114 của Zalo đang ra một câu duy nhất "Tham số không hợp lệ (Z114)" cho năm trường hợp khác nhau.

| Trường hợp | Bước | Căn cứ |
|---|---|---|
| Tag của tài khoản đã đầy | Gắn tag | Từ 01/09: 20.159 / 22.572 lượt mã 114 nằm ở `updateLabels`, thuộc 13 tài khoản (10 tổ chức). Cả 13 bắt đầu lỗi khi tổng số hội thoại đã gắn tag chạm khoảng 5.820–5.890 và sau đó không gắn thêm được lần nào; tài khoản đang ở 5.728 vẫn gắn bình thường. Engine 6 ngày: 599 lượt ở 3 tài khoản Fly, 22.753 lượt gắn tag còn lại không lần nào 114. |
| UID quét bằng tài khoản Zalo khác | Nhắn tin, kết bạn, đổi tên | Chiến dịch 58417: 257/257 UID nằm trong `zalo_users` của tài khoản khác cùng nhân viên, không có ở tài khoản gửi; chiến dịch 55934: 47/48. Data nhập qua Web. |
| Số điện thoại nằm ở cột UID | Nhắn tin, kết bạn | UID chỉ 9–10 chữ số ở 3 chiến dịch (78 lượt); UID Zalo thật dài 14–19 chữ số. |
| Data là chính tài khoản gửi | Nhắn tin | 8 chiến dịch thành viên nhóm, mỗi cái đúng 1 lượt, UID trùng UID của tài khoản gửi. |
| ID nhóm không thuộc tài khoản | Nhắn nhóm | 1 chiến dịch, 27 lượt. Chưa rõ nguyên nhân, **không tách**, giữ Z114. |

Đối chiếu điều kiện nhận biết với kết quả gửi thật 17–19/11 của chiến dịch theo UID (bước nhắn tin và kết bạn, chỉ đọc):

| Kết quả thật | Số bước | Sẽ ra DAT04 | Sẽ ra DAT02 | Sẽ ra DAT03 | Giữ Z114 |
|---|---|---|---|---|---|
| Zalo trả 114 | 626 | 514 | 104 | 5 | 3 |
| Gửi thành công | 21.557 | 0 | 0 | 0 | |

Mọi UID gửi thành công đều có trong `zalo_users` của chính tài khoản gửi (lõi lưu hồ sơ trước khi gửi), nên điều kiện "có ở tài khoản
khác và không có ở tài khoản gửi" không khớp lượt gửi thành công nào.

Sau lần báo đầy đầu tiên, có còn gắn tag được không (14 tài khoản, `auto_campaign_details` bước "Gắn tag Zalo", đo 19/11):

- Không tài khoản nào hồi phục: tới lần chạy gần nhất cả 14 vẫn lỗi, sau lần lỗi cuối không còn lượt "thành công" nào (trừ 4474, xem dưới).
- Vẫn có dòng "thành công" xen giữa, nhưng ít và rời rạc: 12/14 tài khoản có 0–64 lượt (chuỗi dài nhất 1–11 lượt) so với 9–7.735 lượt
  lỗi; 1844 có 322 lượt so với 4.674 lượt lỗi.
- Ba tài khoản có bảng tag của Chat cho thấy các lượt "thành công" đó gần như đều là người đã nằm trong tag sẵn (app không ghi lên Zalo):
  4474 có 2.594 lượt "thành công" sau lần lỗi đầu nhưng chỉ 5 người mới thật sự vào tag (cả 5 trong 4 ngày đầu); 4551: 18 lượt, 2 người
  mới; 5474: 1 lượt, 1 người mới (8 phút sau lần lỗi đầu, rồi lỗi hết).
- Vài người mới vẫn lọt vào ngay sau lần lỗi đầu chưa giải thích được (có thể trần tính theo dung lượng, hoặc khách vừa gỡ vài người).

Zalo không công bố trần gắn tag; con số 5.820–5.890 là đo được, có thể là giới hạn theo dung lượng dữ liệu tag.

Cách đếm số hội thoại đã gắn tag: tổ chức có Chat ở `chat_zalo_account_conversation_tag` (gom theo `chat_zalo_account_id`);
`auto_account_contacts` loại `zalo_tag` (`extra_data.conversations`) của tài khoản đã sang Fly là bản cũ.

## Bốn mã mới

Câu anh duyệt 19/11/2026. "Câu" hiện ở dòng tiến trình, lịch sử, ghi chú data; "bước tiếp theo" hiện ở trang tra mã.

| Mã | Mã nội bộ | Câu | Bước tiếp theo |
|---|---|---|---|
| TAG01 | `err_engine_zalo_tag_full` | Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm | Gỡ bớt người khỏi các tag trong Zalo rồi chạy tiếp chiến dịch. |
| DAT02 | `err_engine_zalo_uid_is_phone` | Data là số điện thoại, không phải UID Zalo | Dùng loại chiến dịch Nhắn tin theo SĐT cho danh sách này. |
| DAT03 | `err_engine_zalo_target_is_self` | Không gửi cho chính tài khoản đang gửi | (không có) |
| DAT04 | `err_engine_zalo_uid_other_account` | UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được | Dùng tài khoản đã quét danh sách để chạy, hoặc quét lại bằng tài khoản này. |

### Cách nhận biết

- **TAG01**: luật DB `zalo_code` 114 × `zalo_tag_contact`. 114 ở mọi bước khác vẫn là Z114.
- Hai phép kiểm trước khi gửi (DAT02, DAT03) chạy cho mọi data của chiến dịch theo UID nhưng chỉ là so chuỗi trong bộ nhớ: đo 0,16 micro
  giây mỗi data cho cả hai, không đọc DB, không gọi Zalo.
- **DAT02**: lõi kiểm ở bước xác định người nhận của chiến dịch theo UID (`zaloUidLooksLikePhone`): 9–11 chữ số, đầu số di động
  3/5/7/8/9, có thể kèm 0, 84, +84. Không gọi Zalo. Tín hiệu engine `uid_is_phone`.
- **DAT03**: lõi so UID của data với UID của tài khoản gửi (cổng `ownZaloUid`, bỏ hậu tố `_0`). Không gọi Zalo. Tín hiệu engine
  `target_is_self`. Cổng không biết UID của mình thì giữ cách cũ (gọi Zalo).
- **DAT04**: chỉ khi Zalo đã trả 114 ở bước nhắn tin hoặc kết bạn, lõi gọi cổng `uidBelongsToOtherAccount`: UID có trong `zalo_users`
  của tài khoản khác cùng tổ chức và không có ở tài khoản đang gửi. Đúng thì tín hiệu engine `uid_other_account`; không thấy, tra lỗi
  hoặc cổng chưa có hàm thì giữ Z114. Tra một lần cho mỗi data.

### Hành vi

- TAG01: như 114 ở bước gắn tag hôm nay (dòng lịch sử "thất bại", không tính lượt, không cộng chuỗi, chạy tiếp). Tin nhắn vẫn gửi.
- DAT03: như "Dữ liệu đầu vào không hợp lệ" (DAT01): data "thất bại", không tính lượt, không cộng chuỗi, chạy tiếp.
- DAT02 (anh chốt 19/11: "lỡ user đưa nhầm danh sách SĐT thì sao?"): data "thất bại", không tính lượt, cộng chuỗi data lỗi; 4 data liền
  thì tạm dừng chiến dịch với ghi chú
  `Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): Data là số điện thoại, không phải UID Zalo (DAT02)`, data chưa chạy giữ
  "chờ xử lý". Lý do: DAT02 không gọi Zalo và không nghỉ giữa hai data, không dừng thì cả danh sách bị đánh "thất bại" trong vài giây.
  Danh sách lẫn vài SĐT vẫn chạy hết (UID gửi được đưa chuỗi về 0).
- DAT04 (anh chọn "Dừng sau 4 data liền"): data "thất bại", không tính lượt, bỏ các bước còn lại của data, cộng chuỗi data lỗi;
  4 data liền thì tạm dừng chiến dịch với ghi chú
  `Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)`.
  Data chưa chạy giữ "chờ xử lý". Danh sách lẫn UID đúng và sai vẫn chạy tiếp (data gửi được đưa chuỗi về 0).
  Bộ đếm chuỗi chỉ về 0 khi có data gửi thành công (`report_v1`; bấm Tiếp tục không đặt lại), nên khách bấm Tiếp tục mà chưa đổi tài
  khoản / quét lại thì chiến dịch chạy thêm 1 data rồi dừng lại (đọc code, chưa chạy thử ca này).
- DAT02, DAT03 không nghỉ giữa hai data (`pace_mode none` như DAT01, vì chưa gửi gì); TAG01, DAT04 nghỉ như thường.

Ghi chú dừng chưa kèm câu "bước tiếp theo": `report_v1` chỉ nối câu đó cho mã `FB%` (V558). Muốn có thì phải sửa hàm (DDL), chưa làm.

## Thứ tự triển khai

1. Apply V581 (chỉ dữ liệu, không nạp lại schema): **đã làm 19/11**. TAG01 có hiệu lực ngay ở cả Fly lẫn Desktop (engine v2).
2. ChatApi: merge nhánh `feat/zalo-z114-split` (lõi chép từ akaAgent + cổng Fly), deploy `worker`.
3. Build và phát hành Desktop.

Phải apply V581 **trước** khi lõi mới chạy: chưa có luật thì ba tín hiệu engine mới rơi vào luật chung (trước khi gửi: NET01, data về
hàng đợi; sau khi gửi: lỗi chung).

## Gỡ

`migrations/rollback_v581_zalo_114_split.sql`: xoá chính sách và luật `source = 'v581'`, tắt 4 mã. Gỡ thì cũng phải đưa lõi về bản trước
(lý do như trên).

## Kiểm

- `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/campaign-outcome-engine-v581-smoke.cjs` (12 nhóm; lõi thật + cổng Zalo giả trên
  PostgreSQL 17 cục bộ, chuỗi V495 → V532; trước / sau / gỡ / apply lại).
- Sinh lại migration: `node scripts/build-v581-sql.cjs` (không sửa tay file sinh ra).
- Bộ kịch bản sự cố trên DB đã có V581: `SCENARIO_V581=1 CHAT_REPO=… node scripts/engine-v2-scenarios/run.cjs …`.
- ChatApi (nhánh `feat/zalo-z114-split`): `npx vitest run apps/system-worker/src/campaignEngine/flyZaloPort.test.ts`.

## Chưa kiểm

- Chưa chạy trên Zalo thật.
- Đã chạy thử migration trên production trong một giao dịch rồi `ROLLBACK` lúc 10:34 VN 19/11/2026 theo yêu cầu ("Chạy thử đi"; md5 file
  `a9c68b72…`, bản trước khi đổi DAT02 sang "4 data liền thì tạm dừng"; bản hiện tại `30524695…` chưa chạy thử trên production): bước kiểm trước và sau đều qua trên danh mục thật (122 luật, 369 chính sách, 144 mã; sau V575 / V576), 4 mã, 30 chính
  sách, 4 luật mới, 0 dòng lint, 114 × gắn tag ra TAG01, 114 × nhắn tin giữ Z114; mất 2,5 giây. Hậu kiểm: không còn dòng nào của V581,
  sổ migration không đổi, 0 lỗi 5xx, engine vẫn chạy (488 lượt trong 3 phút, 0 lượt bị cắt ngang).
- Phép tra `zalo_users` đã chạy đúng câu SQL trên production (chỉ đọc, 19/11): dưới quyền `aka_agent_desktop` trả "thuộc tài khoản khác"
  cho 6/6 UID của chiến dịch 58417 và "không" cho 6/6 UID gửi thành công; đi chỉ mục `idx_kgt_zalo_users_uid_v3`, 4 buffer, 0,09 ms
  (trần của Desktop 3 giây). `aka_agent_chat_api` có quyền đọc ba cột dùng tới và bỏ qua RLS (kiểm qua danh mục quyền, không đổi được
  sang vai trò này để chạy thử). Chưa gọi qua chính code cổng (supabase-js / kysely) với DB thật.
