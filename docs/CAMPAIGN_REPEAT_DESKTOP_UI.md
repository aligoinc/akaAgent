# Lặp lại chiến dịch sau khi chạy xong — phần cài đặt trên Desktop

Trạng thái 17/11/2026: đã merge `dev_3` qua [#689](https://github.com/aligoinc/akaAgent/pull/689) theo yêu cầu (nhánh `claude/campaign-repeat-after-completion`; akaAgentWebApp `dev_1` qua #249), chưa build/phát hành.

**Phần chạy (17/11/2026 tối, nhánh `claude/campaign-repeat-runner`)**: DB V561 (bộ đếm hai cột, hàm quyết định, engine v2, bộ quét), bộ chạy cũ Desktop gọi `aka_agent_campaign_repeat_decide_v1` khi chạy hết danh sách (`handleCampaignRepeatAfterCompletion`), lưu chiến dịch gọi `aka_agent_campaign_repeat_sync_v1`. Xem [CAMPAIGN_REPEAT_V561.md](CAMPAIGN_REPEAT_V561.md). Phần dưới đây mô tả phần cài đặt; các câu "chưa có phần chạy" ở dưới là trạng thái trước V561.

## Lưu ở đâu

`auto_campaigns.extra_settings` (form ghi thẳng như mọi cài đặt khác của chiến dịch):

| Khoá | Giá trị |
|---|---|
| `repeatAfterCompletionEnabled` | `true` khi bật; tắt thì ghi `false` |
| `repeatAfterCompletionEvery` | số nguyên: phút 5–1439, giờ 1–168, ngày 1–90 |
| `repeatAfterCompletionUnit` | `minute` \| `hour` \| `day` |
| `repeatAfterCompletionMaxRuns` | số nguyên 2–100, tính cả lượt đầu |

Ngày kết thúc dùng ô "Ngày kết thúc" và cột `schedule_end_date` sẵn có của lịch (cuối ngày, giờ Việt Nam). Với lịch Hàng ngày ô này chỉ hiện khi đang bật lặp; tắt lặp thì lưu `null`. Xoá chiến dịch không cần dọn gì thêm vì cài đặt nằm ngay trên dòng chiến dịch.

## Giao diện

- `CampaignFormModal` và `CampaignAgentFormModal`: khung "Lặp lại sau khi chạy xong" trong phần Lịch chạy (`renderCampaignRepeatSection`), chỉ với lịch Hàng ngày, data nhập trực tiếp, loại chiến dịch có trong `campaignRepeatUnits`. Chọn một trong hai với "Chạy nhiều khung giờ trong 1 ngày".
- `CampaignInfoView`: hai dòng "Lặp lại sau khi chạy xong", "Số lượt tối đa".
- Luật hiển thị, đơn vị theo loại chiến dịch và câu báo lỗi nằm ở `src/shared/campaignRepeat.ts`, **chép nguyên văn** WebApp `packages/control-api/src/campaignRepeat.ts` (sửa ở WebApp trước rồi chép lại). Phần riêng Desktop ở `src/shared/campaignRepeatDesktop.ts`.

## Công tắc hiển thị

`auto_system_settings` key `campaign.repeat_after_completion`, value JSON `{"audience":"off"|"admin_akabiz"|"all"}`. **Chưa có dòng này trên production nên khung đang ẩn với mọi tài khoản.** Desktop đọc chung câu `getDesktopPollingSettings` (một lần khi đăng nhập, không thêm request); đổi công tắc có hiệu lực khi đăng nhập lại.

**Không thêm dòng công tắc khi chưa có phần chạy**:

- Khách sẽ thấy và bật một cài đặt không có tác dụng: chiến dịch vẫn hoàn thành sau lượt đầu.
- Bốn loại Facebook (tìm data theo group, tìm data theo search, comment seeding, lướt newsfeed): khi khung mới hiện, form ẩn ô cũ "Chạy lại sau mỗi x giờ", đổi cài đặt cũ sang cài đặt mới (`campaignRepeatFromLegacyRerun`) và lưu `findDataRerunEnabled: false`. Bộ chạy cũ `handleRerunAfterCompletion` chỉ đọc `findDataRerun*`, nên chiến dịch vừa sửa sẽ **mất tính năng chạy lại đang hoạt động**. Chiến dịch chưa mở ra sửa và lịch tuần / tháng không bị ảnh hưởng.

## Kiểm thử

- `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-repeat-ui-smoke.cjs` (8 ca, form thật trên Electron với IPC giả lập).
- Hai typecheck 0 lỗi.

Chưa chạy trong app đã đóng gói và chưa lưu thử lên DB thật.

Web / API: akaAgentWebApp `docs/CAMPAIGN_REPEAT.md`. Phương án đầy đủ (gồm phần chạy chưa làm): akaAgentWebApp `docs/CAMPAIGN_REPEAT_PLAN.md`.
