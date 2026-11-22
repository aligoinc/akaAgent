# Phương án: bán akaAgent Zalo / Facebook theo từng loại chiến dịch

22/11/2026. **Mới là phương án: chưa viết mã, chưa chạy SQL nào, chưa sửa dữ liệu nào.** Nhận định về cách khách đang dùng
dựa trên truy vấn chỉ đọc production (`akachat`) ngày 22/11/2026; **số khách và số tiền cụ thể đã gửi người dùng trong
phiên làm việc, không lưu trong repo**. Mã liên quan nằm ở ba repo: cổng CRM (SqlServerDashboard), Web / iOS
(akaAgentWebApp), Desktop và các file migration (akaAgent).

Mục 8 liệt kê các điểm cần người dùng chốt trước khi làm. Điểm quan trọng nhất là **giá** (mục 2.5 và 8.1).

## 1. Yêu cầu

- Khách mua lẻ từng loại chiến dịch của Zalo và Facebook, không phải mua trọn sản phẩm.
- Mỗi sản phẩm hiện danh sách loại chiến dịch, khách chọn ít nhất một loại. Mặc định là tất cả.
- Giá mặc định 50.000đ một loại chiến dịch một tháng, nhân theo số tháng / số năm của gói khách đăng ký.
- Phải chạy đúng với việc khách tự gia hạn và nâng cấp ở cổng `/gia-han`.

## 2. Hiện trạng

### 2.1 Sản phẩm, gói và giá đang bán

Mỗi tổ chức có tối đa một dòng `org_organization_product` còn hiệu lực cho mỗi sản phẩm; riêng sản phẩm 16 có tối đa hai
dòng (bản Web và bản Desktop). Mỗi dòng có một ngày hết hạn.

| Sản phẩm (id) | Gói có giá | Tài khoản |
|---|---|---|
| akaAgent Zalo Web (16, `is_zalo_server`) | 2 tháng 700.000đ · 1 năm 3.000.000đ · 2 năm 5.000.000đ | 5 Zalo mỗi combo |
| akaAgent Zalo Desktop QR (16) | 2 tháng 500.000đ · 1 năm 2.000.000đ | 50 |
| akaAgent Zalo browser (18) | 2 tháng 500.000đ · 1 năm 2.000.000đ · 4 năm 4.000.000đ | 50 |
| akaAgent Facebook (3) | 2 tháng 500.000đ · 1 năm 2.000.000đ · Lifetime 10.000.000đ | 50 (Lifetime 100) |

Zalo Web là sản phẩm có nhiều khách trả phí nhất, sau đó là Zalo browser và Facebook; Zalo Desktop QR còn rất ít. Phần
lớn khách đang ở gói 2 tháng.

Quy ra một tháng, khách đang trả 83.000đ (Zalo browser 4 năm) tới 350.000đ (Zalo Web 2 tháng) cho **toàn bộ** loại chiến dịch.

### 2.2 Loại chiến dịch

Danh mục là bảng `auto_campaign_actions` (khoá chính là mã chữ, cột `flatform_type`).

- **Zalo: 11 loại**, dùng chung cho cả ba bản Zalo. Xếp theo số tổ chức có tạo chiến dịch trong 30 ngày gần nhất, từ
  nhiều tới ít: Nhắn tin, kết bạn đến SĐT (vượt xa các loại còn lại) · Thành viên group / người lạ · Bạn bè · Group · Huỷ
  lời mời kết bạn · Thêm thành viên vào group · Khách hàng cũ · Đề xuất Zalo · Tham gia group bằng link · Thời gian thực ·
  Sinh nhật.
- **Facebook: 13 loại**, cùng cách xếp: Đăng bài vào group (vượt xa các loại còn lại) · Comment seeding · Comment vào bài
  post (gồm chiến dịch "Up tin" do hệ thống tự tạo) · Tham gia group · Tìm data bằng search · Newsfeed · Nhắn tin UID ·
  Inbox Page · Đăng trang cá nhân · Tìm data trong group · Đăng fanpage · Nhắn bạn bè · Mời vào group.

### 2.3 Quyền dùng đang được quyết định ở đâu

Hôm nay không lớp nào biết "tổ chức này được dùng loại chiến dịch nào". Quyền chỉ tính theo sản phẩm:

| Nơi | Kiểm gì |
|---|---|
| Desktop (`entitlementRepository.ts`) | Đọc `org_organization_product` mỗi 30 giây, suy ra quyền theo nhóm (Facebook, Zalo, Email, SMS). Mã loại chiến dịch → nhóm viết cứng trong app |
| Web / API (`aka-agent-control.repository.ts`) | `loadEntitlements` đọc bảng gói; danh mục loại là `GET /actions`, chỉ so loại với danh mục đang bật |
| DB, hàm nhận việc của engine v2 (`aka_agent_engine_claim_target_v1`) | Trả `entitlement_denied` khi tổ chức không còn gói Zalo / Facebook còn hạn |
| DB, hàm nhận việc bộ cũ (`aka_agent_claim_campaign_runtime_checked`) | Chỉ kiểm loại tài khoản Zalo |
| DB, lúc tạo chiến dịch | Không kiểm quyền theo loại. Desktop ghi thẳng `auto_campaigns`; Web qua `create_control_campaign_v2` |
| Cài đặt "Hiển thị loại chiến dịch" (V423, V552) | Chỉ ẩn / hiện trên giao diện, không chặn |

Hệ quả cho thiết kế: chặn chỉ ở app thì bản Desktop cũ, App Server và Fly lách được. **Chốt chặn phải nằm ở database.**

### 2.4 Cổng mua, gia hạn, nâng cấp

Mọi lối mua (Web, Desktop, lời nhắc gia hạn) đều mở một trang của cổng CRM `crm.akabiz.net/gia-han/nang-cap`. Cổng đã có:
số kỳ, số combo, dòng "chỉ thêm" giữa kỳ, tiền bù theo ngày còn lại, quy tắc "gói còn hạn chỉ tăng không giảm" (người
dùng chốt 19/11/2026), khuyến mại, tự kích hoạt sau khi nhận tiền.

akaBiz Chat là tiền lệ gần nhất: giá tính từ cấu hình (số user, số Zalo, số tháng) theo chính sách lưu ở
`org_product.akachat_chinh_sach_gia`, lựa chọn của khách ghi vào `aka_sale_order_item.custom_config`, khi nhận tiền
`portalDestinationOverride` đưa cấu hình đó vào dòng sản phẩm. Bán theo loại chiến dịch đi đúng đường này.

Hai điểm cần biết:

- Đơn khách tự đặt ở cổng mới chiếm một phần nhỏ số lượt gia hạn. Phần lớn gia hạn vẫn đi qua đơn nhân viên lên trong CRM,
  mà form đơn của nhân viên chưa có chỗ chọn cấu hình (cũng chưa có số combo).
- App iOS không được có giá hay nút mua (quy tắc App Store, đã chốt 13/11 và 18/11).

### 2.5 Khách đang dùng mấy loại, và giá 50.000đ ảnh hưởng thế nào

Xét các tổ chức có gói trả phí còn hạn, theo loại chiến dịch có chạy trong 60 ngày gần nhất (không tính "Up tin" tự tạo):

- Phần lớn khách Zalo và gần một nửa khách Facebook chỉ chạy **một** loại chiến dịch. Với Zalo, loại đó hầu hết là "Nhắn
  tin, kết bạn đến SĐT"; với Facebook là "Đăng bài vào group".
- Khách chạy từ 4 loại trở lên rất ít.

Với giá 50.000đ một loại một tháng, nhóm chỉ dùng một loại trả 50.000đ thay vì 83.000–350.000đ một tháng (phần lớn đang
ở gói 2 tháng, tức 250.000–350.000đ).

Đã ước tính doanh thu gia hạn niêm yết theo bốn mức giá của loại chính (50.000đ, 100.000đ, 150.000đ, 200.000đ; loại
khác 50.000đ), với giả định xấu nhất: mọi khách khi gia hạn chỉ mua đúng các loại họ đã chạy, khách không chạy gì mua một
loại chính, giá lẻ không vượt giá gói, chưa tính khách mới có thêm nhờ giá vào thấp. Kết quả: giá đồng hạng 50.000đ làm
doanh thu gia hạn của khách cũ giảm mạnh nếu áp cho mọi khách; đặt giá riêng cho loại chính thì mức giảm thu hẹp đáng kể.
Bảng số đã gửi người dùng.

Vì vậy phương án dưới đây để **đơn giá chỉnh được theo từng loại và từng sản phẩm** (mặc định 50.000đ), có thể đặt mức
tối thiểu, và bật theo từng nhóm khách.

## 3. Đề xuất quy tắc bán

### 3.1 Bán gì

- Áp cho 4 dòng sản phẩm ở mục 2.1. SMS, Email, aka Map, akaBiz Chat giữ như hiện nay.
- Danh sách loại lấy từ `auto_campaign_actions` đang bật: Zalo 11 loại, Facebook 13 loại. Thêm loại mới vào danh mục thì
  cổng tự có.
- Khách chọn ít nhất một loại. Ô "Tất cả loại chiến dịch" được chọn sẵn.
- Số tài khoản, giới hạn gửi mỗi ngày, số nhân viên của gói không đổi theo số loại.

### 3.2 Giá

> giá một kỳ = tổng đơn giá tháng của các loại đã chọn × số tháng của gói × số combo (chỉ Zalo Web), **không vượt giá gói**

- Đơn giá tháng mặc định 50.000đ, có thể đặt riêng cho từng loại của từng sản phẩm.
- Số tháng của gói: 2 tháng = 2, 1 năm = 12, 2 năm = 24, 4 năm = 48. Mua nhiều kỳ thì nhân số kỳ như hiện nay.
- "Tất cả" = đúng giá gói hiện nay. Khi tổng giá các loại đã chọn chạm giá gói, khách trả giá gói và được dùng tất cả loại
  (trang ghi rõ "Từ N loại trở lên tính giá trọn gói").
- Zalo Web bán theo combo 5 Zalo nên giá loại nhân theo số combo, nếu không khách 20 combo sẽ trả 50.000đ một tháng cho
  100 Zalo.
- Gói vĩnh viễn (Facebook Lifetime) không bán lẻ theo loại.

### 3.3 Ví dụ với đơn giá 50.000đ

| Gói | 1 loại | 2 loại | 3 loại | 4 loại | Trọn gói từ |
|---|---|---|---|---|---|
| Zalo Web 2 tháng (700.000đ / combo) | 100.000đ | 200.000đ | 300.000đ | 400.000đ | 7 loại |
| Zalo Web 1 năm (3.000.000đ / combo) | 600.000đ | 1.200.000đ | 1.800.000đ | 2.400.000đ | 5 loại |
| Zalo Web 2 năm (5.000.000đ / combo) | 1.200.000đ | 2.400.000đ | 3.600.000đ | 4.800.000đ | 5 loại |
| Zalo browser, Zalo Desktop, Facebook 2 tháng (500.000đ) | 100.000đ | 200.000đ | 300.000đ | 400.000đ | 5 loại |
| Zalo browser, Zalo Desktop, Facebook 1 năm (2.000.000đ) | 600.000đ | 1.200.000đ | 1.800.000đ | trọn gói | 4 loại |
| Zalo browser 4 năm (4.000.000đ) | 2.400.000đ | trọn gói | | | 2 loại |

### 3.4 Gia hạn

- Bộ loại chọn sẵn khi gia hạn = bộ loại khách đang có (giống số combo hiện nay). Khách cũ đang dùng trọn gói thấy "Tất cả"
  được chọn sẵn với giá gói như cũ; muốn mua lẻ phải tự bỏ chọn.
- **Gói còn hạn: chỉ thêm loại, không bớt.** Ngày hết hạn cộng nối tiếp nên bộ loại áp ngay khi kích hoạt; cho bớt là cắt
  thứ khách đã trả tiền. Đây là quy tắc "chỉ tăng không giảm" đã chốt 19/11 cho số tài khoản và số user.
- **Gói đã hết hạn, bản dùng thử, sản phẩm mua mới: chọn tự do**, hạn tính từ lúc thanh toán.
- Thẻ thanh toán nhanh ở hai trang hết hạn giữ một lần bấm ra QR với bộ loại đang có; có link "Chọn loại chiến dịch" sang
  giỏ hàng.
- Lời nhắc gia hạn (Desktop, Web, chuông) không đổi: mỗi dòng sản phẩm vẫn một ngày hết hạn.

### 3.5 Nâng cấp: thêm loại khi gói còn hạn

Dùng lại dòng "chỉ thêm" và công thức tiền bù đang có (`topUpAmount`):

> tiền bù = (giá một kỳ của bộ loại mới − giá một kỳ của bộ loại đang có) × số ngày còn lại ÷ số ngày của kỳ
>
> Tính theo gói khách đang dùng, ngày làm tròn lên, tiền làm tròn tới 1.000đ. Cả hai giá đều không vượt giá gói.

- Ví dụ: Zalo Web 1 năm đang có 1 loại, còn 200 ngày. Thêm 2 loại: (1.800.000 − 600.000) × 200 ÷ 366 = 656.000đ. Lên trọn
  gói: (3.000.000 − 600.000) × 200 ÷ 366 = 1.311.000đ. Hạn giữ nguyên, loại mới dùng được ngay.
- Vừa gia hạn vừa thêm loại: giá kỳ mới theo bộ loại mới, cộng tiền bù của phần thêm cho số ngày còn lại (quy tắc 19/11).
- Dòng "chỉ thêm" không áp khuyến mại, không tính là gia hạn (như hiện nay).

### 3.6 Các trường hợp khác

| Trường hợp | Đề xuất |
|---|---|
| Dùng thử | Tất cả loại, để khách thử trước khi chọn |
| Khách đang dùng gói hiện nay | Không đổi gì: dòng chưa có bộ loại = tất cả. Chỉ đổi khi chính họ mua lẻ ở lần gia hạn sau khi hết hạn |
| Khuyến mại | Các chương trình đang bật đều là tặng ngày. Cần chốt có áp cho dòng mua lẻ không (mục 8.9) |
| Hoa hồng đối tác, hoá đơn, CRM Mua hàng | Không đổi cách tính; tên gói ghi thêm "· N loại chiến dịch" để mọi nơi hiện tên gói đều thấy |
| Đơn nhân viên lên trong CRM | Đợt đầu giữ nguyên (giá do nhân viên nhập), có thêm công cụ xem / sửa bộ loại của khách (mục 4.7) |

## 4. Đề xuất kỹ thuật

### 4.1 Lưu ở đâu

Hai cột mới, chưa chạy, **chờ người dùng duyệt SQL** (file migration thật sẽ viết theo quy ước của akaAgent: kiểm md5,
biên nhận, bản gỡ):

```sql
-- Bộ loại chiến dịch đã mua của dòng sản phẩm. NULL = tất cả loại (mọi dòng hiện có).
ALTER TABLE public.org_organization_product
  ADD COLUMN campaign_action_ids text[] NULL,
  ADD CONSTRAINT org_organization_product_campaign_action_ids_chk
    CHECK (campaign_action_ids IS NULL OR cardinality(campaign_action_ids) >= 1);

-- Chỉ mục nhỏ để lối tắt "tổ chức này không có dòng nào bị giới hạn" tốn một lần tra.
CREATE INDEX idx_org_product_campaign_types_org
  ON public.org_organization_product (organization_id)
  WHERE campaign_action_ids IS NOT NULL AND is_deleted = false;

-- Chính sách giá bán lẻ của sản phẩm. NULL = sản phẩm không bán theo loại.
ALTER TABLE public.org_product ADD COLUMN gia_loai_chien_dich jsonb NULL;
-- {"gia_thang": 50000, "gia_thang_theo_loai": {"zalo_message_phone": 50000}, "toi_thieu_thang": 0}
```

Vì sao là cột trên dòng sản phẩm chứ không phải bảng con:

- Engine kích hoạt của cổng ghi dòng sản phẩm bằng một lệnh UPDATE có so sánh trạng thái trước (`applyOrgPackageRenewalPlan`).
  Thêm cột thì bộ loại đi cùng hạn và gói trong một lần ghi; bảng con là lần ghi thứ hai, có thể lệch khi lỗi giữa chừng.
- Trigger lịch sử của bảng chụp cả dòng (`to_jsonb(new)`), nên thay đổi bộ loại tự có lịch sử.
- Bảng nhỏ (vài nghìn dòng); thêm cột cho phép NULL không ghi lại bảng. Vẫn apply buổi tối với `lock_timeout` vì hàm nhận
  việc đọc bảng này.

Quy tắc gộp khi tổ chức có nhiều dòng, giống cách đang gộp loại tài khoản Zalo: tài khoản Facebook lấy các dòng sản phẩm
3 / 10; Zalo Server lấy các dòng `is_zalo_server`; Zalo trình duyệt lấy các dòng `is_zalo_show_web`; Zalo QR lấy mọi dòng
16 / 18. Chỉ tính dòng còn hạn. Một dòng NULL là được tất cả; còn lại là hợp các bộ loại.

### 4.2 Chặn ở đâu

Một hàm dùng chung `private.aka_agent_campaign_type_allowed(tổ chức, tài khoản, mã loại)`, gọi ở:

| Lớp | Việc | Phủ được |
|---|---|---|
| **Bắt buộc, trong DB** | Hai hàm nhận việc (`aka_agent_engine_claim_target_v1` và `aka_agent_claim_campaign_runtime_checked`): loại chưa mua thì chuyển chiến dịch sang "tạm dừng" kèm ghi chú và trả mã từ chối sẵn có | Desktop mọi bản, App Server, Fly, chiến dịch lặp lại, quy trình tự động, chiến dịch nhập từ nơi khác |
| Thân thiện, ở API Web | Tạo, sửa, nhân bản, bấm Tiếp tục: trả lỗi `campaign_type_not_purchased` kèm sản phẩm và loại | Web, iOS |
| Thân thiện, ở app | Loại chưa mua hiện có khoá và nút mua; không cho chọn | Web, Desktop bản mới |

- Tổ chức không có dòng nào bị giới hạn (hôm nay là mọi tổ chức) đi lối tắt: một lần tra chỉ mục nhỏ, không đổi hành vi.
- Trả mã từ chối sẵn có (`entitlement_denied`, `claim_rejected`) để lõi đang chạy trên Desktop 9.6–10.3 và Fly hiểu; bản mới
  đọc thêm trường lý do để hiện đúng câu.
- Tạm dừng ngay trong hàm nhận việc để chiến dịch bị chặn không bị hỏi lại mỗi lượt quét.
- Chiến dịch đang chạy dở lúc bộ loại bị thu hẹp: chạy xong data đang xử lý, lượt nhận việc kế tiếp dừng.
- Không xoá, không ẩn chiến dịch của loại chưa mua. Khách mua thêm loại rồi bấm Tiếp tục.
- Có công tắc khẩn cấp trong `auto_system_settings` để hàm kiểm luôn trả "được phép".
- Không thêm trigger vào `auto_campaigns` ở đợt đầu (bảng nóng nhất). Bản Desktop cũ vẫn tạo được chiến dịch loại chưa
  mua, chiến dịch đó bị tạm dừng kèm ghi chú ở lượt nhận việc đầu tiên.
- Hai hàm nhận việc có thân được kiểm md5; migration sinh từ thân production lúc viết, như các bản vá engine trước.

### 4.3 Loại chiến dịch do tính năng khác tự tạo

| Nguồn | Tạo ra | Đề xuất |
|---|---|---|
| "Kiêm up tin" của Đăng bài vào group | Chiến dịch "Up tin cho chiến dịch …", thuộc loại Comment vào bài post (số lượng rất lớn) | Đi kèm loại "Đăng bài vào group", không bán riêng |
| "Kiêm SMS" | Chiến dịch SMS con | Thuộc sản phẩm SMS, không đổi |
| Tìm data đẩy sang chiến dịch đích | Thêm data vào chiến dịch loại khác | Đích thuộc loại chưa mua thì liên kết ghi "bị chặn" kèm lý do (cơ chế V608 sẵn có) |
| Quy trình tự động, Trợ lý tạo chiến dịch, Thêm bằng Agent | Tạo chiến dịch theo loại | Danh mục đưa cho các tính năng này chỉ gồm loại đã mua; bước của quy trình dùng loại chưa mua bị báo lúc lưu |
| Nhân bản, đồng bộ akaBiz Auto | Chép chiến dịch | Chép được; chiến dịch loại chưa mua tạm dừng ở lượt nhận việc đầu |

### 4.4 Cổng CRM (SqlServerDashboard)

- Danh mục của cổng trả thêm danh sách loại và đơn giá của từng sản phẩm (`renewal-portal-data.ts`).
- Giỏ hàng nhận thêm `campaign_types` cho dòng gia hạn, mua mới và "chỉ thêm" (`parsePortalCart`, `draftLines`,
  `addonDraft` trong `renewal-portal-pricing.ts`); công thức giá và tiền bù đặt ở `shared/renewal-portal.ts`, trang và
  server dùng chung.
- Lựa chọn ghi vào `custom_config` của dòng đơn (không thêm cột cho đơn). Khi nhận tiền, kế hoạch nâng cấp mang thêm bộ
  loại và ghi vào cột mới trong cùng lệnh UPDATE. Dòng "chỉ thêm" ghi phần hợp của bộ đang có và bộ mới, nên hai đơn trả
  nối nhau không đè nhau.
- Chốt an toàn như số tài khoản hiện nay: đơn đặt lúc bộ loại là A, tới lúc kích hoạt bộ loại của khách đã khác thì dừng
  cho nhân viên xử lý.
- Giao diện: khối chọn loại trong thẻ sản phẩm (làm theo `akachat-configurator.tsx`), lựa chọn "Thêm loại chiến dịch" cho
  gói còn hạn (`addon-options.tsx`), thẻ thanh toán nhanh, bản xem trước cho nhân viên (`mock.ts` tự tính giá ở trình
  duyệt nên phải sửa cùng).
- Link vào thẳng: `/gia-han/nang-cap?product=<id dòng sản phẩm>&types=<mã loại,…>` để app mở đúng sản phẩm và chọn sẵn loại
  khách vừa bấm.
- Nhãn dòng đơn ở *Khách tự gia hạn*, bản ghi CRM Mua hàng, email: ghi tên các loại đã mua.
- Bộ mô phỏng vòng đời gia hạn thêm các ca mua lẻ.

### 4.5 Web và API (akaAgentWebApp)

- `/me` trả thêm quyền theo loại cho từng nhóm tài khoản (Zalo Server, Zalo QR, Zalo trình duyệt, Facebook): "tất cả" hoặc
  danh sách mã loại. Đọc cùng lượt đọc gói sẵn có, không thêm request.
- Ô chọn loại ở form tạo chiến dịch (`CampaignFormPage`, `CampaignTypePicker`): loại chưa mua hiện kèm khoá và nút "Mua
  thêm" mở cổng. Không gộp vào cài đặt "Hiển thị loại chiến dịch": cài đặt đó là ẩn theo ý quản trị viên, còn đây là khoá
  theo gói; gộp lại thì chiến dịch đang có sẽ biến mất khỏi danh sách.
- API kiểm lúc tạo / sửa / nhân bản / Tiếp tục. Lỗi phải được đổi thành `ControlError` có mã riêng, vì bộ đổi câu lỗi hiện
  nay che mọi lỗi kỹ thuật thành "báo hỗ trợ kèm mã".
- Cài đặt → Các gói sản phẩm: mỗi gói ghi "Tất cả loại chiến dịch" hoặc "N loại" kèm nút "Mua thêm loại chiến dịch".
- Hợp đồng dùng chung (`packages/control-api`) sửa ở WebApp trước rồi chép sang Desktop như các tính năng khác.

### 4.6 Desktop (akaAgent)

- Lượt đọc gói mỗi 30 giây lấy thêm cột mới (không thêm request); quyền theo loại vào `AuthUser`.
- Form tạo chiến dịch (thường và Agent), menu, "Lý do đang chờ", tab Hành động: loại chưa mua hiện khoá, nút mở form
  "Nâng cấp và mua gói" với sản phẩm và loại chọn sẵn.
- Có hiệu lực từ bản Desktop phát hành sau; bản cũ vẫn bị DB chặn lúc chạy.

### 4.7 CRM cho nhân viên

- Trang khách hàng → Sản phẩm mua → menu thêm mục "Loại chiến dịch": xem và sửa bộ loại của dòng sản phẩm, quyền như "Thêm,
  bớt ngày", có lịch sử.
- Form *Đơn bán hàng*: đợt đầu chưa có ô chọn loại; đơn nhân viên giữ nguyên bộ loại đang có của khách.

### 4.8 iOS

Loại chưa mua hiện mờ kèm chữ trung tính (ví dụ "Chưa có trong gói"), không giá, không nút mua, không nhắc tới việc mua.
Bản iOS đang lưu hành không biết tính năng này: API trả câu lỗi tiếng Việt đọc được.

## 5. Chia đợt và thứ tự đưa vào dùng

| Đợt | Nội dung | Repo | Cỡ việc |
|---|---|---|---|
| 0 | Chốt các điểm ở mục 8, duyệt SQL | | |
| 1 | Hai cột, hàm kiểm, vá hai hàm nhận việc, công tắc. Mọi dòng vẫn NULL nên chưa đổi gì cho khách | akaAgent (migration) | Vừa; rủi ro ở hai hàm nhận việc |
| 2 | Cổng: giá, giỏ hàng, đơn, kích hoạt, "thêm loại", giao diện; công cụ CRM cho nhân viên | SqlServerDashboard | Lớn |
| 3 | `/me`, khoá ở form, lỗi có mã, trang Cài đặt | akaAgentWebApp | Vừa |
| 4 | Quyền theo loại, khoá ở form, lối mở cổng | akaAgent (Desktop) | Vừa, theo bản build kế tiếp |
| 5 | Hiển thị khoá trên iOS | akaAgentWebApp (mobile) | Nhỏ |

Thứ tự bật: đợt 1 (DB) → deploy Web / API và cổng với phần bán lẻ còn tắt → phát hành Desktop → bật bán lẻ cho tổ chức thử
và nhân viên akaBiz → mở dần theo nhóm khách.

- Công tắc bán: cột `gia_loai_chien_dich` của sản phẩm còn NULL thì cổng không hiện phần chọn loại; thêm một khoá
  `auto_system_settings` chọn nhóm khách được thấy (tắt / nhân viên akaBiz / danh sách tổ chức / tất cả).
- Gỡ: tắt công tắc bán; đặt lại `campaign_action_ids = NULL` cho các dòng đã mua lẻ là khách dùng lại được tất cả loại
  ngay; chiến dịch đã bị tạm dừng theo loại thì lọc theo ghi chú để mở lại.
- Worker Fly (akaAgentChatApi, không nằm trong phạm vi phiên này) dùng hàm nhận việc của engine nên không cần sửa mã; chỉ
  cần kiểm lại câu tiến trình khi bị từ chối.

## 6. Kiểm thử

- SQL: Postgres cục bộ nạp thân hàm production; ma trận tổ chức 1 dòng / nhiều dòng, NULL / bộ loại, còn hạn / hết hạn, từng
  loại tài khoản; so hành vi trước và sau trên mọi tổ chức chưa mua lẻ (phải giống hệt); đo thời gian hàm nhận việc.
- Engine: bộ kịch bản engine v2 Zalo và Facebook thêm ca "loại chưa mua", "bộ loại đổi giữa lượt", "Up tin đi kèm".
- Cổng: kiểm thử đơn vị cho bảng giá mục 3.3, tiền bù mục 3.5, chặn bớt khi còn hạn, hai đơn cùng sản phẩm trả cùng lúc;
  bộ mô phỏng vòng đời; đơn nhân viên không đổi.
- Chạy thử trên production trong giao dịch huỷ trước khi apply, như các migration engine gần đây.
- Web, Desktop, iOS: kiểm giao diện với danh mục có loại bị khoá; bản app cũ nhận câu lỗi đọc được.

## 7. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Doanh thu gia hạn giảm (mục 2.5) | Đơn giá theo loại, mức tối thiểu, mặc định "Tất cả", gói còn hạn không bớt được, bật theo nhóm khách và đo sau từng đợt |
| Vá hai hàm nhận việc làm đứng chiến dịch | Lối tắt cho tổ chức chưa mua lẻ, công tắc khẩn cấp, sinh từ thân production, chạy thử giao dịch huỷ, apply buổi tối |
| Khách mua lẻ rồi thấy chiến dịch cũ dừng | Trang mua liệt kê chiến dịch đang có thuộc loại không chọn trước khi tạo mã QR; ghi chú tạm dừng nói rõ lý do |
| Bản Desktop cũ không hiện khoá | DB vẫn chặn lúc chạy, ghi chú tiếng Việt; khoá hiện đủ từ bản Desktop mới |
| Nhân viên gia hạn tay làm lệch bộ loại | Đơn nhân viên giữ bộ loại đang có; công cụ sửa có lịch sử |
| Khách né quy tắc bằng tên chiến dịch "Up tin …" | Chấp nhận ở đợt đầu, hoặc đánh dấu chiến dịch Up tin bằng dữ liệu thay vì tên |

## 8. Cần người dùng chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| 1 | Giá: đồng hạng 50.000đ cho mọi loại, hay đặt giá riêng cho loại chính (Nhắn tin SĐT, Đăng bài vào group)? Có mức tối thiểu mỗi tháng không? | Làm đơn giá chỉnh được theo loại; người dùng chọn con số sau khi xem bảng ước tính đã gửi (mục 2.5) |
| 2 | "Tất cả" tính thế nào? | Bằng giá gói hiện nay; giá lẻ không bao giờ vượt giá gói |
| 3 | Zalo Web: giá loại có nhân theo số combo không? | Có |
| 4 | Gói còn hạn có được bớt loại khi gia hạn sớm không? | Không, chỉ thêm (theo quy tắc 19/11). Phương án khác: cho đặt trước bộ loại nhỏ hơn, áp từ kỳ sau; phức tạp hơn, làm sau nếu cần |
| 5 | Bán lẻ cho ai trước: mọi khách, hay khách mới và khách đã hết hạn? | Bật theo nhóm, bắt đầu bằng tổ chức thử |
| 6 | "Up tin" đi kèm "Đăng bài vào group"? | Có |
| 7 | Gói vĩnh viễn và bản dùng thử | Vĩnh viễn không bán lẻ; dùng thử được tất cả loại |
| 8 | Loại chưa mua trên app: hiện kèm khoá và nút mua, hay ẩn hẳn? | Hiện kèm khoá (iOS không có nút mua) |
| 9 | Ba chương trình tặng ngày đang chạy có áp cho dòng mua lẻ không? | Có cho dòng gia hạn / mua mới, không cho dòng "thêm loại" |
| 10 | Form đơn của nhân viên có cần chọn loại ngay đợt đầu không? | Chưa; đợt đầu chỉ có công cụ xem / sửa bộ loại |
| 11 | Duyệt hai cột mới ở mục 4.1 | Cần duyệt trước khi làm đợt 1 |
