# Chặn chiến dịch Zalo dùng danh sách quét bằng tài khoản khác (DAT04)

Tình trạng 27/11/2026: phương án, chưa code, chưa đổi gì trên production. Các quyết định ở mục 3 anh đã chốt
cùng ngày. Câu cho khách ở mục 4.3 chờ anh duyệt.

## 1. Chuyện đã xảy ra

Chiến dịch 61799 "LPP test group" (nhân viên 1226, tổ chức 1133, loại `zalo_message_group_member`) có 881 người
nhận do tài khoản "van khanh 1" (7349) quét từ group. Tối 26/11 khách đổi chiến dịch sang tài khoản "thế zus"
(9086) trên Web. Mã người dùng Zalo (UID) khác nhau theo từng tài khoản, nên "thế zus" không gửi được cho ai:

- 20:53–20:58 ngày 26/11 (bộ chạy cũ trên App Server): 4 người báo "Tham số không hợp lệ", chiến dịch dừng.
- 08:01 ngày 27/11 (engine v2): chạy đúng giờ, người đầu tiên báo DAT04, chuỗi lỗi lên 5 (ngưỡng 4), chiến dịch
  tạm dừng sau 4 giây. 11:21 bấm Tiếp tục thì lặp lại y hệt.
- Mỗi người gặp lỗi bị đánh "hoàn thành" và không được gửi lại (6 người).

Hệ thống có ghi lý do vào tiến trình, ghi chú data và ghi chú chiến dịch. Nhưng nút Tiếp tục / Tạm dừng của Zalo
Server (`aka_agent_set_zalo_server_campaign_status`) đặt ghi chú về trống, nên lúc khách chụp màn hình thì ghi chú
là "-". Nhân viên này chỉ có thông báo "Chào ngày mới", không có thông báo chiến dịch tạm dừng.

## 2. Số đo (production, chỉ đọc, 27/11)

- 25 chiến dịch đang chờ hoặc tạm dừng có danh sách gần như toàn bộ thuộc tài khoản khác: 13 do đổi tài khoản sau
  khi tạo, 12 sai từ lúc tạo (bản sao chọn tài khoản khác, hoặc nhiều tài khoản dùng chung một danh sách).
  Theo loại: thành viên group 18, bạn bè 3, khách hàng cũ 2, huỷ lời mời kết bạn 2.
- 7 ngày: 22 lượt DAT04 ở 7 chiến dịch / 6 tổ chức (mã có từ 20/11).
- Luật ở mục 4.1 không chặn nhầm: 3.818 lượt gửi thành công trong 24 giờ (thành viên group 1.085, bạn bè 2.703,
  khách hàng cũ 30) đều có UID thuộc chính tài khoản gửi, 0 lượt sẽ bị chặn.
- Thông báo: 2.306 nhân viên có cài đặt thông báo, chỉ 133 có dòng "Chiến dịch" (113 đã chọn Tạm dừng). 7 ngày ở
  nhóm này có 1.059 thông báo tạm dừng, 886 (84%) là do chính họ bấm Tạm dừng (không có ghi chú), 173 do hệ thống
  dừng (có ghi chú). Engine dừng chiến dịch 235 lần trong 7 ngày, lần nào cũng kèm ghi chú.

## 3. Quyết định anh đã chốt (27/11/2026)

1. Chặn hẳn khi lưu, câu báo rõ ràng, dễ hiểu. Không có nút "Vẫn lưu".
2. Lúc đang chạy mà gặp người nhận thuộc tài khoản khác: giữ người đó lại để gửi sau khi khách đổi về đúng tài
   khoản, không đánh "hoàn thành" như hiện nay.
3. Bật sẵn thông báo "chiến dịch tạm dừng" cho mọi nhân viên. Chỉ báo khi hệ thống tự dừng; khách tự bấm Tạm dừng
   thì không báo, áp dụng cả cho người đang tự bật thông báo chiến dịch.
4. Không làm: giữ ghi chú khi bấm Tiếp tục; xử lý 25 chiến dịch đang dính (khách tự gặp hộp chặn khi bấm Tiếp tục).

## 4. Thiết kế

### 4.1 Luật kiểm, viết một chỗ trong DB

Hàm chỉ đọc mới `aka_agent_campaign_uid_account_check_v1`. Đầu vào: tài khoản định dùng (một hoặc nhiều) và danh
sách UID, hoặc mã chiến dịch (hàm tự đọc data đang chờ). Tối đa 2.000 UID mỗi lượt, bên gọi chia lượt. Mỗi UID
thuộc một trong ba nhóm:

| Nhóm | Điều kiện | Xử lý |
|---|---|---|
| Gửi được | UID có trong `zalo_users` của tài khoản định dùng, hoặc của tài khoản cùng nick Zalo (`private.aka_agent_zalo_same_nick_accounts`, V657) | cho qua |
| Không gửi được | UID không thuộc nhóm trên và có trong `zalo_users` của tài khoản khác cùng tổ chức | chặn |
| Không rõ | UID không có ở tài khoản nào (nhập tay, file ngoài) | cho qua, không kiểm được |

Hàm trả số lượng từng nhóm cho từng tài khoản, kèm tên các tài khoản đã quét (để câu báo nói đúng tên). Dùng chỉ mục
đang có `idx_zalo_users_account_uid` và `idx_kgt_zalo_users_uid_v3`, so cả dạng UID có đuôi `_0`. Quyền: Desktop theo
phiên (chỉ tài khoản của chính nhân viên), `service_role` cho API Web. Không sửa bảng nào.

Loại chiến dịch áp dụng: `zalo_message_group_member`, `zalo_message_friend`, `zalo_message_remarketing_customer`,
`zalo_cancel_sent_friend_request`. Chiến dịch chạy bằng Nhóm data không kiểm (đã gắn tài khoản theo nhóm).

Công tắc khẩn cấp `auto_system_settings` `campaign.uid_account_guard` = `block` / `off` (thiếu dòng = `block`).
Hàm lỗi, hết giờ hoặc DB chưa có hàm thì cho lưu như cũ; lưới ở mục 4.4 vẫn bắt lúc chạy.

### 4.2 Các điểm chặn

| Nơi | Điểm chặn | Ghi chú |
|---|---|---|
| API Web (Web + iOS mọi bản, có hiệu lực khi deploy) | Tạo chiến dịch, kể cả tạo cho nhiều tài khoản và nhân bản | `aka-agent-control.service.ts` |
| | Sửa chiến dịch có đổi tài khoản | đúng đường của ca 61799 |
| | Thêm data | |
| | Tiếp tục (tạm dừng → chờ xử lý) | chặn 25 chiến dịch đang dính đốt thêm data |
| Desktop, form thường và form Agent | Kiểm trước khi lưu: tạo, đổi tài khoản, thêm data; chọn nhiều tài khoản thì kiểm từng tài khoản | IPC mới `campaign:uid-account-check` |
| Desktop, tiến trình chính | Kiểm lại ở `DB_UPDATE_CAMPAIGN` (đổi tài khoản), chèn data, Tiếp tục | đặt ở handler như `contentSyntaxGuard`, không đặt trong repository vì bộ lập lịch gọi thẳng repository |

API trả 400 `campaign_uid_account_mismatch` kèm tên tài khoản, số người chặn / tổng, tên tài khoản đã quét. Web và
Desktop hiện hộp thoại ở mục 4.3; iOS bản đang phát hành hiện nguyên câu của API. Desktop bản cũ không có điểm chặn
khi lưu, dựa vào mục 4.4 và 4.5.

### 4.3 Câu cho khách (chờ anh duyệt)

Ví dụ lấy theo ca 61799. Không dùng chữ "UID".

| Tình huống | Câu |
|---|---|
| Lưu, cả danh sách sai | **Tài khoản "thế zus" không gửi được cho danh sách này.** Danh sách 881 người nhận được quét bằng tài khoản Zalo "van khanh 1". Zalo cấp cho mỗi tài khoản một mã riêng của từng người, nên chỉ tài khoản đã quét danh sách mới gửi được. Nút: [Dùng tài khoản "van khanh 1"] [Quét lại danh sách bằng "thế zus"] [Đóng] |
| Lưu, danh sách lẫn | **Có 12 người tài khoản "thế zus" không gửi được.** 12 trong 881 người nhận được quét bằng tài khoản Zalo "van khanh 1". Bỏ 12 người này ra thì lưu được. Nút: [Bỏ 12 người này] [Đóng] |
| Lưu, nhiều tài khoản chung một danh sách | **Danh sách này chỉ gửi được bằng tài khoản "van khanh 1".** Các tài khoản "thế zus", "Minh Anh 3.10" không gửi được vì danh sách được quét bằng "van khanh 1". Mỗi tài khoản cần danh sách do chính nó quét. |
| Bấm Tiếp tục | Chưa chạy tiếp được: danh sách người nhận được quét bằng tài khoản Zalo "van khanh 1" nên "thế zus" không gửi được. Mở Sửa chiến dịch để chọn lại tài khoản "van khanh 1", hoặc quét lại danh sách bằng "thế zus". |
| Lúc chạy, từng người (thay câu DAT04 hiện nay "UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được") | Người này nằm trong danh sách quét bằng tài khoản Zalo khác nên tài khoản này không gửi được |
| Lúc chạy, ghi chú khi chiến dịch dừng (cũng là nội dung thông báo) | Danh sách người nhận được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được. Hãy sửa chiến dịch: chọn lại tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này |

Hai câu lúc chạy là dữ liệu trong DB (`auto_error` id 172, `auto_outcome_policies` id 426), đổi là có hiệu lực ngay
ở Desktop, App Server, Fly, không cần build. Lúc chạy chưa nêu được tên tài khoản đã quét; muốn nêu phải sửa lõi
engine, để sau.

### 4.4 Lúc chạy: giữ người nhận lại

Chỉ đổi dữ liệu chính sách DAT04 (`err_engine_zalo_uid_other_account`), theo đúng mẫu EXC06 của V677:

- Người nhận gặp DAT04 được để riêng (data sang "tạm dừng", `target_effect` `complete` thành `hold`), không tính
  lượt, cộng chuỗi lỗi. Chiến dịch chạy tiếp người kế; 4 người liền thì tạm dừng chiến dịch như hiện nay.
- Danh sách lẫn vài người sai: các người sai được để riêng, phần còn lại gửi bình thường.
- Trigger mới trên `auto_campaigns`, chỉ chạy khi `account_id` đổi: người đang để riêng vì DAT04 mà UID thuộc tài
  khoản mới (theo luật 4.1) được trả về "chờ xử lý"; chiến dịch đã "hoàn thành" thì mở lại như khi Thêm data.
  Có hiệu lực với mọi bản app vì nằm ở DB.
- Không xử lý lại data đã bị đóng trước đây. Bộ chạy cũ không đổi (vẫn "Tham số không hợp lệ", đóng data).

### 4.5 Thông báo "chiến dịch tạm dừng" bật sẵn

Sửa hai hàm của trung tâm thông báo (có kiểm md5 thân production: `aka_agent_notification_capture_campaign`
`28c58b14…`, `aka_agent_notification_seed_defaults` `1af8d8da…`):

- Hàm ghi thông báo: chuyển sang "tạm dừng" mà ghi chú trống (khách tự bấm) thì không ghi thông báo. Áp dụng cho
  mọi người, gồm 113 người đang tự bật.
- Hàm bật sẵn (chạy mỗi giờ, 1.000 người mỗi lượt): nhân viên đủ điều kiện chưa có dòng "Chiến dịch" được thêm dòng
  `campaign.status_changed` với `toStatuses` = `["tạm dừng"]`, bật đẩy iPhone, bật email khi đã có email nhận
  (cùng luật với Chào ngày mới). Khoảng 2.200 người, xong trong khoảng 3 giờ.
- Người đã có dòng "Chiến dịch" thì giữ nguyên lựa chọn (17 người đang bật mà chỉ chọn Hoàn thành, 2 người đã tắt).
- Nơi nhận: chuông trên Web và Desktop, hộp Trợ lý aka, iPhone, email nếu có. Nội dung: "Chiến dịch đã tạm dừng"
  kèm ghi chú lý do (bộ dựng nội dung của API Web đã làm sẵn). Khách tắt được ở Cài đặt, mục Nhận thông báo.
- Trần sẵn có giữ nguyên: gom 10 phút, 60 lượt đẩy và 20 email mỗi giờ mỗi người.
- Ước lượng: khoảng 3.000 thông báo mỗi tuần toàn hệ thống (0,2 thông báo mỗi người mỗi ngày).

Không đổi giao diện cài đặt, không đổi API, không cần build Desktop cho phần này.

## 5. Kiểm thử

- DB (PG cục bộ): hàm kiểm với đủ ca gửi được / tài khoản khác / cùng nick / không rõ / đuôi `_0` / quá 2.000 /
  tài khoản không thuộc nhân viên; trigger trả data; chính sách DAT04 qua `aka_agent_engine_simulate_v1`.
- Dữ liệu thật, chỉ đọc: hàm phải bắt đủ 25 chiến dịch ở mục 2 và không chặn lượt nào trong mẫu gửi thành công
  24 giờ.
- Engine (bộ kịch bản): cả danh sách sai thì dừng sau 4 người và không mất data; danh sách lẫn thì chạy hết phần
  đúng; đổi về đúng tài khoản thì người để riêng được gửi, không gửi trùng.
- API Web: test từng điểm chặn và câu trả về. Desktop: smoke tiến trình chính + smoke giao diện hộp thoại ở hai form.
- Thông báo: tự bấm Tạm dừng không báo; hệ thống dừng có báo kèm lý do; bật sẵn không đè dòng đã có; bản gỡ.

## 6. Thứ tự đưa lên và cách gỡ

1. Migration 1 (hàm kiểm, trigger trả data, chính sách và câu DAT04). Có tạo hàm và trigger nên apply buổi tối.
2. Migration 2 (hai hàm thông báo), apply buổi tối. Từ lượt chạy hằng giờ kế tiếp hệ thống tự bật sẵn.
3. Deploy API + Web (điểm chặn và hộp thoại).
4. Build Desktop (hai form + tiến trình chính). iOS có hộp thoại đủ nút ở bản phát hành sau.

Số migration lấy lúc làm, kiểm sổ production ngay trước khi apply.

Gỡ: chặn khi lưu tắt bằng `campaign.uid_account_guard` = `off`; chính sách DAT04 trả `target_effect` về `complete`
và gỡ trigger; thông báo trả hai hàm về thân cũ và tắt các dòng do lượt bật sẵn tạo mà khách chưa sửa.

## 7. Còn mở

- Anh duyệt các câu ở mục 4.3.
