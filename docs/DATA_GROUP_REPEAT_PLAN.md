# Phương án: Nhóm data dùng cho chiến dịch lặp hằng ngày (11/11/2026)

**Trạng thái (11/11/2026):** mới nghiên cứu và đề xuất. Chưa code, chưa có migration, chưa đổi dữ liệu nào.
Số liệu production (akachat `cgjbsmqtfhqvttudyjzq`) đọc chỉ-đọc lúc 11:00–11:30 VN ngày 11/11/2026. Định nghĩa hàm DB
lấy từ production (`pg_proc`) và đối chiếu với migration trong repo; trước khi làm phải đối chiếu lại bằng
`pg_get_functiondef` và md5.

## Tóm tắt

- Chiến dịch "Chọn nhóm data để chạy" hiện là kiểu **đăng ký nhận data**: mỗi data chạy đúng một lần, hết thì chiến
  dịch đứng ở "Chờ data mới". Mọi kiểu chạy lặp (làm mới data theo tuần/tháng, nhiều khung giờ, lặp sau x phút, chạy
  lại sau x giờ) đều bị tắt cho loại này.
- Việc tắt chỉ nằm ở form (Desktop, Web, iOS) và một chỗ chặn trong bộ chạy Desktop. **DB và API không chặn.** Đọc
  code thì chiến dịch nhóm data lịch tuần/tháng mà có `refresh_data = true` sẽ được bước cập nhật lịch đầu ngày hiện
  tại làm mới như chiến dịch thường (chưa chạy thử).
- Nhu cầu có thật: khách đang lách bằng "Thêm bằng nhóm" (chép một lần rồi bật làm mới, mất phần tự nhận data mới)
  hoặc tạo lại chiến dịch mới cho cùng một nhóm.
- "Lặp hằng ngày" trong hệ thống hiện tại là **lịch Theo tuần chọn đủ 7 thứ + làm mới data**. Lịch "Hàng ngày" không
  lặp, và không được đổi nghĩa của nó (mục 1.2).
- Đề xuất ba giai đoạn:
  1. Mở "làm mới data" cho chiến dịch nhóm data trên lịch tuần/tháng, thêm lựa chọn "Mỗi ngày, lặp lại", sửa lỗi
     chiến dịch lặp tự dừng khi có data tạm dừng. Không cần migration cấu trúc.
  2. Đồng bộ theo nhóm ở đầu mỗi lượt: data đã gỡ khỏi nhóm thì lượt sau không chạy nữa, thêm lại thì chạy lại. Một
     hàm DB mới, bộ chạy gọi hàm này thay cho câu đặt lại trực tiếp.
  3. Lặp trong ngày (nhiều khung giờ, lặp sau x phút) cho nhắn bạn bè/nhóm Zalo và đăng Page dùng nhóm data.

## 1. Hiện trạng

### 1.1 Hai cách dùng nhóm data trong chiến dịch

| | Chọn nhóm data để chạy (nguồn sống) | Thêm bằng nhóm (chép một lần) |
|---|---|---|
| Lưu ở DB | `data_target_source_mode = 'data_group'`, một dòng `auto_campaign_data_group_sources` cho mỗi chiến dịch | `'direct'`, không có dòng nguồn |
| Data mới thêm vào nhóm | Tự vào chiến dịch khi công tắc "nhận data mới từ nhóm" bật | Không vào |
| Gỡ data khỏi nhóm | Không ảnh hưởng chiến dịch | Không ảnh hưởng chiến dịch |
| Chạy lặp | Không | Có, như chiến dịch thường |
| Nhiều tài khoản | Mỗi chiến dịch con nhận toàn bộ data hợp với tài khoản của nó | Như bên trái |

Cả hai cách đều tạo dòng `auto_campaign_input_data` có `canonical_target_key` (mỗi đích một dòng, unique theo
`(campaign_id, canonical_target_key)`).

### 1.2 Các kiểu chạy lặp đang có (chỉ cho data trực tiếp)

| Kiểu | Điều kiện | Nơi xử lý |
|---|---|---|
| Làm mới data khi chạy hết | Lịch Theo tuần / Theo tháng + `refresh_data` | Bước cập nhật lịch đầu ngày: [maintainCampaignSchedules](../src/main/data/repositories/campaignRepository.ts#L3814-L3892) |
| Nhiều khung giờ trong ngày | `facebook_timeline_post`, `facebook_page_post`, `zalo_message_friend`, `zalo_message_group` | [handleMultiDailyTimeSlotAfterCompletion](../src/main/services/campaignScheduler.ts#L2389-L2445) |
| Gửi lặp lại sau mỗi x phút | Nhắn bạn bè/nhóm Zalo dạng chia sẻ (đang ẩn) | [handleZaloShareRepeatAfterCompletion](../src/main/services/campaignScheduler.ts#L2575-L2622) |
| Chạy lại sau mỗi x giờ | Tìm data, comment dạo, lướt newsfeed | `handleRerunAfterCompletion` |

Lịch **"Hàng ngày" không lặp**: chạy hết danh sách (có thể qua nhiều ngày) rồi `hoàn thành`; bước cập nhật lịch bỏ qua
chiến dịch hằng ngày đã hoàn thành ([campaignRepository.ts:3795](../src/main/data/repositories/campaignRepository.ts#L3795)).
Khách muốn "lặp hằng ngày" phải chọn Theo tuần, tick đủ 7 thứ và bật làm mới data.

Không được cho lịch "Hàng ngày" đọc `refresh_data`: form Web mặc định `refreshData: true` (akaAgentWebApp
`packages/campaign-core/src/schedule.ts:51-65`) nên hiện có **18.423 chiến dịch hằng ngày** (data trực tiếp, 1.409 nhân
viên) mang `refresh_data = true`, trong đó 13.949 đã hoàn thành. Đổi nghĩa là gửi lại hàng loạt cho khách cũ.

### 1.3 Chỗ đang chặn nhóm data

- **Form Desktop** ([CampaignFormModal.tsx](../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx)): chọn
  "Chọn nhóm data để chạy" thì tắt làm mới, nhiều khung giờ, chạy lại sau x giờ (L16251–L16260); ẩn ô làm mới (L17281),
  ô chạy lại (L17320), khung nhiều khung giờ (L13461), lặp x phút (L3474); lúc lưu ép `refreshData = false` (L6445).
  `CampaignAgentFormModal` theo cùng luật.
- **Bộ chạy Desktop / App Server**: `handleCampaignCompletion` trả về ngay sau finalizer với chiến dịch nhóm data, không
  tới nhánh nhiều khung giờ/lặp x phút/chạy lại ([campaignScheduler.ts:2290](../src/main/services/campaignScheduler.ts#L2290-L2298));
  `resetCampaignInputDataForRerun` ném lỗi với nhóm data ([campaignRepository.ts:6015](../src/main/data/repositories/campaignRepository.ts#L6015-L6019)).
- **Web / iOS** (akaAgentWebApp, code dùng chung): `packages/campaign-core/src/submission.ts:179-181` (ép
  `refreshData = false`), `schedule.ts:94-95` (`scheduleSupportsMultiSlots`), `packages/control-api/src/zaloShareRepeat.ts:35-43`,
  `campaignScheduleAi.ts:52-63` (bản chép ở Desktop: `src/shared/campaignScheduleAi.ts`),
  `apps/web/src/features/CampaignScheduleForm.tsx:29`, `campaignForm2/CampaignWhenSection.tsx:27`,
  `apps/mobile/src/features/campaign/Options.tsx:385,453`.
- Không tìm thấy tài liệu nào ghi lý do sản phẩm; akaAgentWebApp `docs/WEB_DESKTOP_PARITY_REVIEW_20260919.md:70` ghi
  "Chưa kết luận hành vi gửi lặp của runtime". Web chỉ cho chọn nhóm data với 7 hành động Zalo
  (`campaignFormLogic.ts:21-29`); các hành động Facebook dùng nhóm data chỉ tạo được trên Desktop.

### 1.4 Những gì DB đã cho phép

- Trigger `aka_agent_guard_canonical_campaign_input_payload` (v275) chỉ cấm đổi đích gửi, `campaign_id`,
  `canonical_target_key` và `is_delete`. **Đổi `status`, `note`, `date_action` được phép**, nên đặt lại dòng canonical
  về `chờ xử lý` không bị DB chặn. Hệ quả: dòng canonical không xoá mềm được, muốn loại khỏi lượt lặp chỉ có `tạm dừng`
  (mọi chỗ đặt lại đều bỏ qua `tạm dừng`).
- API Web không có luật nào theo nguồn data cho `refreshData` hay nhiều khung giờ
  (`aka-agent-control.service.ts:2071,2237`). Không có constraint/trigger/RPC nào trong DB đọc các cờ lặp theo
  `data_target_source_mode`.
- `aka_agent_advance_zalo_server_multi_daily_slot` (v219, đổi khung giờ trên Zalo Server) đặt lại mọi dòng khác
  `tạm dừng`, không kiểm nguồn data.
- Finalizer `aka_agent_internal_finalize_data_group_campaign_v219`: hết data mà nguồn còn `baselining`/`active` và chưa
  tới ngày kết thúc thì giữ `chờ xử lý` + ghi chú "Chờ data mới", không đụng `schedule`; nguồn đã dừng thì `hoàn thành`.
  Hàm claim từ chối chiến dịch nhóm data không còn data đến hạn (v397 L194–L205), nên chiến dịch đang chờ không bị
  chạy rỗng.
- Trigger `aka_agent_close_terminal_campaign_data_group_source`: chiến dịch thành `hoàn thành` thì nguồn bị dừng
  (`campaign_completed`); hàm đẩy data từ chối chiến dịch đã `hoàn thành` (`campaign_terminal`).
- Bước làm mới data đầu ngày ([campaignRepository.ts:3869](../src/main/data/repositories/campaignRepository.ts#L3869-L3892))
  không kiểm nguồn data. Ghép với các điểm trên: chiến dịch nhóm data lịch tuần/tháng có `refresh_data = true` sẽ được
  đặt lại và chạy lượt mới trên Desktop và App Server hiện tại. Đây là kết luận đọc code, chưa chạy thử.

### 1.5 Hai giới hạn phải xử lý

1. **Gỡ khỏi nhóm không ảnh hưởng chiến dịch; thêm lại không xếp lại.** `aka_agent_remove_data_group_members` chỉ
   đánh dấu thành viên (v186 L3097–L3104), không đụng `auto_campaign_input_data`. Hàm đẩy data dùng
   `ON CONFLICT (campaign_id, canonical_target_key) ... DO NOTHING` và trả `existing` (v409 L2617–L2631, L2661). Với
   chiến dịch chạy một lần thì ít ai để ý; với chiến dịch lặp, data đã gỡ khỏi nhóm sẽ bị gửi lại mỗi lượt.
2. **Chiến dịch lặp tự dừng khi có data tạm dừng (lỗi đang có ở data trực tiếp).** Điều kiện làm mới là
   `details.every(status === 'hoàn thành')` ([campaignRepository.ts:3815](../src/main/data/repositories/campaignRepository.ts#L3815)).
   Chỉ cần một dòng `tạm dừng` (khách tự tạm dừng, hoặc policy lỗi có `input_effect = 'pause'` như mã Zalo 161 của
   V471) là không bao giờ làm mới: mỗi đêm lịch vẫn dời sang ngày kế, trạng thái giữ `hoàn thành`. Đo 11/11: 19 chiến
   dịch của 9 nhân viên đang kẹt; ví dụ 31676/31680/31682 (staff 347, comment dạo, lịch tuần đủ 7 thứ, 62 dòng xong + 1
   dòng tạm dừng) ngừng chạy từ 05/11, 02/11, 09/11. Nếu dùng `tạm dừng` để loại data đã gỡ khỏi nhóm mà không sửa lỗi
   này thì lần gỡ đầu tiên sẽ làm chiến dịch ngừng lặp.

### 1.6 Số liệu (11/11/2026)

| Chỉ số | Giá trị |
|---|---|
| Chiến dịch nhóm data (nguồn sống) chưa xoá | 1.097 chiến dịch, 185 nhân viên |
| Trong đó đăng bài vào nhóm Facebook | 679 chiến dịch, 83 nhân viên, 343 tạo trong 30 ngày |
| Chiến dịch nhóm data đang đặt lịch tuần/tháng (không lặp được) | 158 (137 tuần, 21 tháng) |
| Chiến dịch data trực tiếp đang lặp (tuần/tháng + làm mới) | khoảng 1.760; riêng đăng nhóm Facebook 738 (89 nhân viên), 344 trong đó tick đủ 7 thứ |
| Chiến dịch lặp có data chép từ nhóm ("Thêm bằng nhóm") | 319; đăng nhóm Facebook 182 (18 nhân viên), nhắn nhóm Zalo 101 (4 nhân viên) |
| Cặp (nhóm, hành động) bị tạo lại ≥ 5 chiến dịch trong ≥ 3 ngày khác nhau | 82 cặp, 41 nhân viên, 2.204 trên 3.714 chiến dịch nhóm data từng tạo |
| Chiến dịch nhóm data đang bật chống gửi lặp N ngày | 177 |
| Chiến dịch nhóm data mang `refresh_data = true` từ bản Web cũ | 14 (tạo 24/08–18/09, đều Zalo Server; 12 lịch hằng ngày nên không có tác dụng, 2 lịch tuần đã hết ngày kết thúc) |

Ghi chú cách đo: dòng "chép từ nhóm" dò 5 dòng data đầu của mỗi chiến dịch nên là ước lượng. Dòng "tạo lại" gồm cả
trường hợp mỗi bài đăng một chiến dịch (staff 724: 630 chiến dịch cùng nhóm 1770), nên là dấu hiệu, không phải bằng
chứng trực tiếp. Staff 604 từng đặt đúng tổ hợp này (nhóm data + lịch tuần đủ 7 thứ + làm mới, chiến dịch 10293 và
10524): không data nào được gửi lại ở ngày khác vì chưa chạy hết danh sách trước ngày kết thúc.

## 2. Định nghĩa tính năng đề xuất

Chiến dịch dùng nhóm data (nguồn sống) có thêm lựa chọn **lặp lại theo lịch**:

- Một **lượt** là một lần chạy hết danh sách. Chạy hết thì tới ngày chạy kế tiếp của lịch, toàn bộ data đang có trong
  nhóm được chạy lại từ đầu. Chưa chạy hết trong ngày thì ngày chạy kế tiếp chạy nốt phần còn lại (giống chiến dịch
  thường).
- Data mới thêm vào nhóm vào chiến dịch ngay và chạy trong lượt hiện tại, kể cả khi chiến dịch đã chạy hết lượt hôm
  nay (đang "chờ").
- Data đã gỡ khỏi nhóm thì từ lượt sau không chạy nữa; thêm lại thì chạy lại (giai đoạn 2).
- Data đang `tạm dừng` (khách tạm dừng hoặc policy lỗi) không được chạy lại, các data khác vẫn lặp.
- Công tắc "nhận data mới từ nhóm" chỉ điều khiển việc nhận data. Tắt công tắc thì chiến dịch vẫn lặp trên danh sách
  đang có.
- Ngày kết thúc vẫn là điểm dừng cứng như hiện nay: tới ngày đó dừng nhận data và hoàn thành.
- Mặc định tắt. Chiến dịch nhóm data đã có giữ nguyên hành vi (158 chiến dịch lịch tuần/tháng hiện không lặp).

## 3. Các hướng đã cân nhắc

| Hướng | Được | Không được |
|---|---|---|
| A. Chỉ mở khoá form, dùng nguyên cơ chế làm mới data sẵn có | Không đổi DB, chạy được trên bộ chạy đã phát hành | Data gỡ khỏi nhóm vẫn bị gửi; dính lỗi 1.5(2); khách phải tự hiểu "lịch tuần đủ 7 thứ" |
| B. A + đồng bộ theo nhóm ở đầu mỗi lượt bằng một hàm DB | Đúng nghĩa "chiến dịch đi theo nhóm"; đặt lại và dời lịch trong một giao dịch | Cần migration và bản bộ chạy mới; máy chưa cập nhật chạy theo kiểu A |
| C. Giữ data trực tiếp, mỗi lượt tự chép lại từ nhóm | Tái dùng mọi kiểu lặp đang có | Data mới chỉ vào ở đầu lượt; vẫn không xử lý được gỡ khỏi nhóm; hàm chép chạy 4–5 ms mỗi thành viên trong một giao dịch 60 giây; khách vẫn phải hiểu hai khái niệm |
| D. Mỗi lượt tự tạo một chiến dịch mới | Giống cách khách đang lách | Danh sách chiến dịch phình; mỗi chiến dịch gắn nhóm làm chậm việc thêm data vào nhóm (sự cố nhóm 1770 ngày 08–09/11) |

**Đề xuất:** làm A trước (giai đoạn 1), rồi B (giai đoạn 2). Không làm C và D.

## 4. Giai đoạn 1 — Mở làm mới data cho nhóm data trên lịch tuần/tháng

Không cần migration cấu trúc. Cờ dùng lại `refresh_data` vì bộ chạy đã phát hành đọc đúng cờ này.

1. **Sửa lỗi 1.5(2)** trong `maintainCampaignSchedules`: xét "đã chạy hết" trên các dòng khác `tạm dừng`; mọi dòng đều
   tạm dừng thì không mở lại. Áp dụng cho cả data trực tiếp. Cần bản Desktop và App Server mới.
2. **Form** (Desktop `CampaignFormModal` + `CampaignAgentFormModal`; Web hai form; iOS): hiện ô làm mới khi nguồn là
   nhóm data và lịch là tuần/tháng, mặc định tắt, chữ riêng cho nhóm data, ví dụ "Chạy hết danh sách thì lần chạy sau
   gửi lại từ đầu cho cả nhóm, kể cả data mới thêm". Bỏ các chỗ ép `refreshData = false` (mục 1.3). Sửa chiến dịch cũ
   không được tự bật.
3. **Lựa chọn "Mỗi ngày, lặp lại"** ở phần lịch: lưu thành Theo tuần + đủ 7 thứ + `refresh_data = true`, đọc lại tổ
   hợp đó thì hiện đúng lựa chọn này. Không thêm kiểu lịch mới, không đổi bộ chạy. Phải đặt lại mặc định ngày kết thúc
   cho lựa chọn này (form Web đang mặc định là hôm nay; với nhóm data đó là điểm dừng cứng).
4. **Chữ trạng thái**: chiến dịch nhóm data bật lặp đã chạy hết lượt thì hiện "Đã chạy hết lượt này, lượt kế tiếp
   <ngày giờ>; data mới thêm vào nhóm vẫn chạy ngay" thay cho "Đang chờ data mới từ Nhóm data"
   ([campaignPendingReasonService.ts:74](../src/main/services/campaignPendingReasonService.ts#L74), akaAgentWebApp
   `aka-agent-control.pendingReason.ts:149`). Ghi chú "Chờ data mới" do hàm DB ghi; đổi ở tầng hiển thị để khỏi sửa hàm.
5. **AI điền form**: `campaignScheduleAi.ts` ở hai repo (`refreshData: !group && ...`), và prompt trong
   `ai_form_configs` nếu có nhắc luật này (migration chỉ dữ liệu; guard md5 theo ghi chú V478 trong CLAUDE.md).
6. **Ghi rõ trên form** giới hạn của giai đoạn này: gỡ data khỏi nhóm chưa tự bỏ khỏi chiến dịch; muốn bỏ thì tạm dừng
   dòng đó trong tab Data của chiến dịch.
7. **Mở dần** bằng một dòng `auto_system_settings` (cùng kiểu `web.zalo_share_repeat.enabled`): admin akaBiz, rồi vài
   khách đang lặp bằng "Thêm bằng nhóm", rồi tất cả.
8. Dọn 14 chiến dịch mang `refresh_data = true` từ bản Web cũ về `false` (UPDATE dữ liệu có điều kiện), để không có
   chiến dịch nào lặp mà khách không chủ động bật.

Phạm vi hành động: đề xuất giống data trực tiếp (mọi hành động dùng được nhóm data và có lịch tuần/tháng), kèm cảnh
báo trên form với các hành động nhắn người lạ (`zalo_message_phone`, `zalo_message_group_member`,
`facebook_message_uid`) vì gửi lặp hằng ngày dễ dính 127/802/221. Đây là điểm cần chốt (mục 9).

## 5. Giai đoạn 2 — Đồng bộ theo nhóm ở đầu mỗi lượt

Một hàm DB mới làm trọn việc "bắt đầu lượt mới" cho chiến dịch nhóm data, thay cho hai lệnh ghi rời hiện nay (đặt lại
dòng rồi cập nhật chiến dịch).

- **Việc hàm làm, trong một giao dịch:**
  1. Lấy khoá `aka_agent_lock_campaign_input_serialization`, rồi khoá các dòng data theo id, rồi khoá chiến dịch (đúng
     thứ tự của v219/v409, cùng khoá với hàm đẩy data, claim và settle).
  2. Kiểm điều kiện: chiến dịch nhóm data, bật lặp, lịch tuần/tháng, không còn dòng `chờ xử lý`/`đang chạy`, chưa tới
     ngày kết thúc.
  3. Dòng mà mọi thành viên nguồn (`auto_campaign_input_origins.membership_id` →
     `auto_account_contact_group_members`) đều đã bị gỡ: chuyển `tạm dừng`, ghi chú "Đã gỡ khỏi nhóm data", ghi id vào
     một bảng phụ nhỏ để phân biệt với dòng do khách hoặc policy tạm dừng.
  4. Dòng đang nằm trong bảng phụ mà thành viên đã có lại trong nhóm: xoá khỏi bảng phụ, cho vào diện đặt lại.
  5. Đặt lại mọi dòng khác `tạm dừng` về `chờ xử lý`; đặt lịch chiến dịch sang lần chạy kế tiếp, trạng thái `chờ xử lý`.
- **Vì sao làm ở đầu lượt, không làm ngay lúc gỡ:** gỡ thành viên có nhiều đường (gỡ tay, nhập file thay ảnh chụp, bộ
  lọc động, xoá nhóm), mỗi đường là một hàm lớn có guard md5; làm ngay lúc gỡ còn nhân theo số chiến dịch gắn nhóm
  (đúng kiểu chi phí của sự cố nhóm 1770). Ở đầu lượt chỉ một hàm, mỗi lượt một lần, chi phí theo số dòng của chiến
  dịch, dùng index sẵn có `idx_auto_campaign_input_origins_input_kind`.
- **Không thêm cột vào `auto_campaign_input_data`** (bảng nóng, hơn 4 triệu dòng); bảng phụ nằm trong schema `private`.
- **Bộ chạy:** bước cập nhật lịch đầu ngày của Desktop, App Server và chat-sync gọi hàm này khi chiến dịch là nhóm data
  bật lặp. Hàm chưa có (`PGRST202`) thì chạy như giai đoạn 1.
- **Máy chưa cập nhật** vẫn đặt lại bằng câu UPDATE cũ: vẫn lặp, nhưng chưa bỏ data đã gỡ khỏi nhóm. Nếu cần chặt hơn
  thì dùng một cờ riêng thay cho `refresh_data` để máy cũ không lặp; cái giá là giai đoạn 1 cũng phải chờ bản bộ chạy
  mới. Đề xuất giữ `refresh_data`.
- **Migration:** thêm hàm (bản Desktop, bản Zalo Server có kiểm `mode_revision`, quyền EXECUTE theo khuôn các hàm
  finalize hiện có) và bảng phụ. Là DDL nên PostgREST nạp lại schema: apply ngoài giờ cao điểm. Lấy số migration theo
  sổ lúc làm (kiểm cả hai repo và các nhánh chưa merge). Hàm phải tự giới hạn thời gian; đo trên chiến dịch nhóm data
  lớn nhất trước khi chốt trần.

## 6. Giai đoạn 3 — Lặp trong ngày cho nhóm data

- Hành động: `zalo_message_friend`, `zalo_message_group` (nhiều khung giờ và lặp sau x phút), `facebook_page_post`
  (nhiều khung giờ, Desktop).
- Bộ chạy Desktop / App Server: nhánh nhóm data trong `handleCampaignCompletion` phải xét nhiều khung giờ và lặp x phút
  trước khi gọi finalizer; `rescheduleCompletedCampaignPass` dùng hàm của giai đoạn 2 thay cho
  `resetCampaignInputDataForRerun`. Zalo Server đã có `aka_agent_advance_zalo_server_multi_daily_slot` đặt lại được dòng
  canonical; cần thêm bước đồng bộ theo nhóm vào đó hoặc gọi hàm giai đoạn 2.
- Hợp đồng dùng chung: `supportsZaloShareRepeat` (file chép nguyên văn, sửa ở WebApp trước), `scheduleSupportsMultiSlots`,
  ba form.
- Chat-sync (`akaAgentChatApi`) hiện chưa có nhánh lặp sau x phút, nên tổ chức `is_chat_sync` chỉ chạy một lượt.
- Làm sau khi giai đoạn 1–2 chạy ổn; nhu cầu đo được nhỏ hơn (nhắn nhóm Zalo: 101 chiến dịch của 4 nhân viên).

## 7. Rủi ro

- **Gửi lặp cho người lạ làm khoá tài khoản.** Data trực tiếp đã cho phép; tính năng này làm việc đó dễ hơn. Cần cảnh
  báo trên form và giữ nguyên giới hạn ngày/khung giờ (mỗi lượt vẫn tính vào giới hạn).
- **Chống gửi lặp N ngày** (177 chiến dịch nhóm data đang bật): N lớn hơn chu kỳ lặp thì phần lớn data bị bỏ qua mỗi
  lượt. Chưa kiểm cách tính năng này ghi kết quả ở mỗi lượt lặp; phải kiểm trước khi mở.
- **Lệch phiên bản bộ chạy:** chiến dịch tạo trên Web chạy bằng Desktop cũ của khách sẽ dính lỗi 1.5(2) và chưa có
  đồng bộ gỡ thành viên.
- **Chat-sync** có bước cập nhật lịch riêng ở repo khác; chưa đọc được trong lượt này.
- **Khách hiểu nhầm lịch:** danh sách dài hơn giới hạn ngày thì một lượt kéo nhiều ngày, không phải "mỗi ngày gửi hết".
  Nên hiện ước tính độ dài một lượt ở phần "Lịch gửi dự kiến" của Web.
- **Lợi ích phụ:** khách bớt phải tạo lại chiến dịch cho cùng một nhóm, nên số chiến dịch gắn mỗi nhóm giảm và việc
  thêm data vào nhóm nhẹ hơn.

## 8. Kiểm thử và mở dần

- SQL cục bộ (Postgres 17, theo khuôn `scripts/data-group-routing/test_v48*.py`): lượt mới khi còn data mới thêm giữa
  lượt, gỡ rồi thêm lại, dòng khách tạm dừng, nguồn đã dừng, quá ngày kết thúc, đẩy data chạy đồng thời với hàm bắt
  đầu lượt (không khoá chéo), gọi lặp hai lần.
- Smoke bộ chạy: bước cập nhật lịch với bốn ca của lỗi 1.5(2); chiến dịch nhóm data lịch tuần/tháng có và không bật
  lặp; hàm DB chưa có.
- Form: Electron smoke theo `scripts/zalo-share-repeat-ui-smoke.tsx`; test `submission`/`schedule` của campaign-core.
- Kiểm bằng dữ liệu thật chỉ đọc: so danh sách hàm sẽ đặt lại với thành viên hiện tại của vài nhóm lớn.
- Mở dần theo công tắc (mục 4.7); theo dõi số chiến dịch nhóm data bật lặp, số dòng tạm dừng do gỡ khỏi nhóm, lỗi
  127/802/221 của các tài khoản dùng tính năng.

## 9. Việc cần chốt

1. "Lặp hằng ngày" đúng là mỗi lượt gửi lại toàn bộ data trong nhóm (kể cả người đã nhận lượt trước)?
2. Data gỡ khỏi nhóm thì lượt sau ngừng gửi (giai đoạn 2). Trong giai đoạn 1 chấp nhận khách tự tạm dừng dòng?
3. Phạm vi hành động giai đoạn 1: giống data trực tiếp kèm cảnh báo, hay chỉ nhóm ít rủi ro (đăng nhóm Facebook,
   comment, đăng Page, nhắn bạn bè/nhóm Zalo)?
4. Dùng lại `refresh_data` (máy cũ vẫn lặp, thiếu đồng bộ gỡ) hay cờ riêng (máy cũ không lặp)?
5. Có làm lựa chọn "Mỗi ngày, lặp lại" cho cả chiến dịch data trực tiếp không (344 chiến dịch đăng nhóm đang tick đủ 7
   thứ)?

## 10. Chưa kiểm được

- Bước cập nhật lịch và làm mới data của chat-sync (`akaAgentChatApi`, repo ngoài phạm vi lượt này).
- Quyền theo cột của role `aka_agent_desktop` trên `auto_campaign_input_data` (chiến dịch thường đã dùng đúng câu
  UPDATE đó nên nhiều khả năng đủ).
- Chưa chạy thử lượt lặp nào của chiến dịch nhóm data trên production hay cục bộ; mục 1.4 là đọc code và định nghĩa hàm.
- Theo code, bật lại công tắc nhận data cho chiến dịch nhóm data đã `hoàn thành` ở chế độ đẩy `sync` có vẻ không nạp
  được data mới: hàm đẩy chạy trước khi trạng thái được mở lại (v484 p3 L166–L183) và từ chối chiến dịch đã hoàn thành
  (`campaign_terminal`, v409 L2327–L2337). Chưa chạy thử; nếu đúng thì là lỗi riêng, không thuộc phương án này.
