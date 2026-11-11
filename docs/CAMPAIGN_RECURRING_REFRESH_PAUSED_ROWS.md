# Lịch tuần/tháng "làm mới data" khi có dòng tạm dừng

**Trạng thái (11/11/2026):** sửa source trên nhánh `claude/bold-franklin-68fwou`. Chưa build/phát hành
Desktop hay App Server. Không migration, RPC, bảng hay kết nối mới; không sửa dữ liệu production.

## Lỗi

`maintainCampaignSchedules` ([campaignRepository.ts](../src/main/data/repositories/campaignRepository.ts)) là
bước cập nhật lịch đầu ngày, dùng chung cho Desktop và App Server. Với chiến dịch lịch `weekly`/`monthly`
bật `refresh_data`, hàm chỉ đặt lại data và mở lại chiến dịch khi **mọi** dòng `auto_campaign_input_data`
đều `hoàn thành`. Dòng `tạm dừng` (khách tự dừng dòng đó, hoặc policy lỗi có `input_effect='pause'`, ví dụ
mã Zalo 161 của [V471](ZALO_GROUP_112_161_POLICY_V471.md)) bị coi là "chưa xong", nên chiến dịch chỉ được dời
`schedule` sang kỳ kế mỗi đêm, trạng thái vẫn `hoàn thành` và không bao giờ chạy lại.

## Quy tắc hiện hành

Xét trên các dòng chưa xoá của chiến dịch (lịch tuần/tháng, không thuộc ba loại đặc thù bên dưới):

| Data của chiến dịch | `refresh_data = true` | `refresh_data = false` |
| --- | --- | --- |
| Không có dòng nào | Mở lại `chờ xử lý` ở kỳ mới | Chỉ dời lịch |
| Mọi dòng khác `tạm dừng` đều `hoàn thành` (có hoặc không có dòng `tạm dừng`) | Đặt lại các dòng khác `tạm dừng` về `chờ xử lý`, mở lại chiến dịch ở kỳ mới | Chỉ dời lịch |
| Mọi dòng đều `tạm dừng` | Chỉ dời lịch, không mở lại | Chỉ dời lịch |
| Còn dòng `chờ xử lý` hoặc `đang chạy` | Chỉ dời lịch | Chỉ dời lịch |

- Dòng `tạm dừng` không bao giờ bị đặt lại: giữ nguyên trạng thái, ghi chú và `date_action`. Đây là cùng quy
  tắc với câu UPDATE đặt lại (`.neq('status', 'tạm dừng')`) và với `rescheduleCompletedCampaignPass` trong
  [campaignScheduler.ts](../src/main/services/campaignScheduler.ts) (nhiều khung giờ, gửi lặp sau x phút).
- "Chỉ dời lịch" giữ nguyên trạng thái chiến dịch và xoá `note` cũ như trước.
- Dòng `đang chạy` vẫn chặn làm mới (không đổi so với trước). Đó là dòng một lượt chạy còn giữ; bước cập
  nhật lịch không sở hữu lượt đó nên không đặt lại. Dòng kẹt sau khi app tắt đột ngột thuộc bước recovery,
  chạy trước bước cập nhật lịch ([hợp đồng recovery](agents/reference/campaigns-03.md)).
- Ba loại đặc thù (`zalo_message_friend_recommendation`, `zalo_cancel_sent_friend_request`,
  `zalo_message_birthday`) không đi qua quy tắc này: luôn xoá mềm data đã dựng và mở lại ở kỳ mới. Lịch
  `daily` cũng không đi qua nhánh làm mới. Cả hai không đổi.
- SMS/gọi thoại (`sms_send`, `voice_call`) không thuộc hàm này.

## Số liệu production lúc sửa (akachat, chỉ đọc, 11/11/2026 khoảng 11:20 VN)

- 624 chiến dịch lịch tuần/tháng bật `refresh_data`, chưa hết hạn, đang `hoàn thành`/`chờ xử lý`.
- 18 chiến dịch đang kẹt đúng kiểu này (`hoàn thành`, có dòng `tạm dừng`, các dòng còn lại đã `hoàn thành`):
  3 Facebook chạy Desktop, 1 Zalo Web chạy Desktop, 14 Zalo Server (6 nhân viên). Không chiến dịch nào thuộc
  tổ chức đang có gói `is_chat_sync` còn hạn (ước lượng theo `org_organization_product`).
- 1 chiến dịch mọi dòng đều `tạm dừng`: vẫn không mở lại theo quy tắc trên.
- 0 chiến dịch trong nhóm 624 có dòng `đang chạy`. Toàn hệ thống, dòng `đang chạy` gần như chỉ nằm trong
  chiến dịch đang chạy và còn giữ lượt (366 dòng); ngoài ra chỉ có 16 dòng ở 6 chiến dịch lịch hằng ngày.
- 0 chiến dịch trong nhóm 624 đang `hoàn thành` mà còn dòng `chờ xử lý`.

## Sau khi phát hành

Không cần sửa dữ liệu. Chiến dịch đang kẹt tự lặp lại ở lượt cập nhật lịch đầu ngày kế tiếp trên máy đã
chạy bản có sửa (Desktop cho Facebook/Zalo QR-Web, App Server cho Zalo Server): lượt đó thấy `schedule` nhỏ
hơn đầu ngày, đặt lại các dòng khác `tạm dừng` và đưa chiến dịch về `chờ xử lý` ở kỳ mới.

## Kiểm thử

```bash
node scripts/campaign-schedule-refresh-paused-smoke-test.cjs
```

Chạy hàm thật `maintainCampaignSchedules`, các hàm tính lịch và mapper thật với Supabase giả trong bộ nhớ:
123 ca cho Desktop và App Server, lịch tuần (đủ 7 thứ, một thứ) và tháng. Gồm mọi dòng xong, có dòng tạm
dừng (kể cả ca 62 xong + 1 tạm dừng như production), mọi dòng tạm dừng, còn dòng chờ xử lý, còn dòng đang
chạy, tắt làm mới, không có data, dòng đã xoá, hơn một trang đọc (2.001 dòng), chạy lại trong ngày, quá ngày
kết thúc, ba loại đặc thù và lịch hằng ngày. Trên mã trước khi sửa, 26 ca có dòng tạm dừng lẫn dòng đã xong
không đạt; 97 ca còn lại cho kết quả giống hệt trước và sau.

Smoke không thay cho chạy thật trên Desktop/App Server đã build.

## Chưa làm

- Runtime chat-sync (`akaAgentChatApi`, `apps/system-worker`, repo khác) có bước cập nhật lịch riêng, chưa
  được kiểm cùng lỗi này.
- Chiến dịch `hoàn thành` mà còn dòng `chờ xử lý` vẫn chỉ được dời lịch (hành vi cũ, production đang có 0).
