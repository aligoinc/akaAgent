# Tab "Hành động" trong chi tiết chiến dịch (Desktop, 10/11/2026)

Port từ WebApp ([aligoinc/akaAgentWebApp#179](https://github.com/aligoinc/akaAgentWebApp/pull/179), tài liệu WebApp `docs/CAMPAIGN_DETAIL_ACTIONS_TAB.md`). Khung **Chi tiết** của trang Chiến dịch có tab **Hành động** ngay sau tab **Tài khoản**, chỉ hiện khi đang chọn một chiến dịch. Tab liệt kê các hành động tài khoản mà chiến dịch dùng — đúng danh sách của menu **Hành động của tài khoản** (`getCampaignAccountOverviewActionDescriptors`: hành động chạy theo cài đặt đã lưu, kèm gắn tag/đổi tên Zalo khi bật).

Trạng thái: **code trên nhánh `claude/intelligent-galileo-mepsup`, chưa build/phát hành Desktop**. Không migration/RPC/quyền DB mới; App Server không cần build lại vì không đổi scheduler.

## Hiển thị

| Cột | Nội dung |
| --- | --- |
| Hành động | Tên theo `getAccountActionName` |
| Trạng thái | `Bị giới hạn` (còn N phút + nguyên nhân đã lưu), `Đạt giới hạn ngày`, `Đạt giới hạn trong giờ`, `Bình thường`. Khóa đã tới giờ mở lại coi là bình thường (bộ chạy tự mở). |
| Giới hạn trong ngày | Giới hạn **hiệu lực** + nguồn: theo chiến dịch, theo nhóm (tên nhóm lấy từ danh sách tài khoản ở renderer), mặc định hệ thống hoặc `Theo gói (tối đa N)`; khi nhóm/gói thay số của chiến dịch ghi thêm "chiến dịch cài X". Hành động không bị kiểm tra giới hạn lượt ghi "Không giới hạn lượt". |
| Giới hạn trong giờ | Số lượt / số phút của khung, kèm nguồn |
| Đã chạy trong ngày / trong giờ | `đã chạy/giới hạn` + thanh tiến độ; bộ đếm ghi ngày sau hôm nay hiện "—" (không coi là 0) |
| Giờ mở lại | Giờ mở khóa; khóa không có giờ ghi "Chưa có giờ mở lại"; đạt giới hạn ngày → 00:00 ngày Việt Nam kế tiếp ("Sang ngày mới") |
| Thao tác | `Chạy lại ngay` qua IPC `enableAccountActionNow` sẵn có (cả Facebook, như modal Desktop); cột chỉ hiện khi có hành động bị khóa |

Phía trên bảng: giờ DB lúc đọc ("Cập nhật lúc"), ghi chú khi giới hạn lấy từ nhóm, khi gói cắt giới hạn ngày, và cài đặt "khi 1 hành động đạt giới hạn" (chỉ khi có từ 2 hành động bị giới hạn). Nhãn tab hiện số hành động sau lần tải đầu (`Hành động (3)`), gắn với đúng chiến dịch đã tải.

## Đọc dữ liệu (chỉ đọc)

IPC `campaign:account-actions` ([handler](../src/main/ipc/handlers/campaignAccountActionsHandlers.ts)) → [service](../src/main/services/campaignAccountActionsService.ts) → `readCampaignAccountActionRows` ([campaignDiagnosticsRepository.ts](../src/main/data/repositories/campaignDiagnosticsRepository.ts)). Preload `getCampaignAccountActions(campaignId)`; hợp đồng ở [src/shared/campaignAccountActions.ts](../src/shared/campaignAccountActions.ts).

- Dùng client Supabase hiện có và token Desktop theo staff; không thêm nguồn connection/pool/polling. Câu đọc: chiến dịch (câu đọc hẹp `readPendingReasonCampaign`, không lấy nội dung/ảnh), tài khoản + nhóm (`readPendingReasonAccount`, giữ luật akaChat chỉ áp nhóm đang hoạt động cùng tổ chức), loại chiến dịch (`readPendingReasonAction`), giờ DB (`getDatabaseRuntimeClock`, đã cache), trạng thái theo đúng mã, rồi mỗi hành động bị giới hạn 1–2 câu đếm `auto_campaign_details`.
- **Không ghi DB**: không tạo/reset `auto_account_action_status`, không gọi `enable_due_auto_account_actions` (khác `ACCOUNT_ACTION_OVERVIEW` của modal).
- Handler: chỉ main frame, ID nguyên dương, gộp lượt trùng cùng chiến dịch/phiên, tối đa 4 lượt đang chạy, hạn 20 giây (`withRequestDeadline`), đổi phiên trong lúc đọc thì bỏ kết quả; chỉ lỗi nghiệp vụ (`CampaignAccountActionsError`: không thấy chiến dịch/tài khoản, tài khoản đã xóa) hiện nguyên văn, lỗi khác thành thông báo chung.

### Công thức dùng chung với Chẩn đoán và bộ chạy

`resolveCampaignActionQuotaLimit` (cùng file repository) là công thức duy nhất cho tab và `readDiagnosticsQuotas`: `getActionLimitConfig` của bộ chạy (Tìm SĐT cố định 1.000; cài theo mã, thiếu thì khối chung) → `resolveAccountActionLimitConfig` (nhóm → chiến dịch → trần `getAccountActionDailySendLimit`) → mặc định 30/ngày, 9 lượt/65 phút của `resolveAccountRateLimitStatus`. Mã bị kiểm tra giới hạn: akaChat theo `limit_check_action_codes` đã chọn; bộ chạy akaAgent theo `getCampaignActionDescriptors`. Đếm khung giờ (`countCampaignActionWindow`): akaChat chỉ `counts_toward_limit = true`; bộ chạy akaAgent cộng dòng NULL `thành công`/`thất bại`, SMS/gọi cộng mọi dòng NULL — giống `countLimitDetailsInWindow`. Sửa công thức ở một chỗ cho cả hai màn.

## Khi nào tải

Tab chỉ dựng khi được chọn (cách của khung chi tiết Desktop), nên mỗi lần mở tab đọc một lượt. Tải lại khi bấm **Làm mới**, sau **Chạy lại ngay** thành công (kèm `onDiagnosticsChanged`), và khi modal **Hành động của tài khoản** đóng. Bấm dòng chiến dịch khác đưa khung về tab Thông tin như cũ. Renderer bỏ phản hồi cũ theo phiên bản request và người dùng đăng nhập; lỗi giữ bảng cũ kèm **Thử lại**; không tự thử lại.

## Kiểm chứng (10/11/2026, sandbox Linux)

- `npx tsc --noEmit -p tsconfig.node.json` và `-p tsconfig.web.json` sạch; `npm run build` đạt với `NODE_OPTIONS=--max-old-space-size=8192` (heap mặc định ~2 GB của sandbox hết bộ nhớ khi build renderer; `dev_3` sạch cũng hết bộ nhớ y hệt, không do thay đổi này).
- `node scripts/campaign-account-actions-smoke.cjs`: công thức (60 tổ hợp đối chiếu đúng giá trị bộ chạy), dòng của bộ chạy akaAgent/akaChat/SMS, khóa theo giờ DB, bộ đếm/giờ mở lại không xác minh, chỉ select, service và ranh giới IPC.
- `node scripts/run-campaign-account-actions-ui-smoke.cjs`: `CampaignPanel` thật với IPC giả lập — vị trí tab, chỉ đọc khi mở tab, nội dung cột/nguồn/giờ mở lại, ghi chú, mở khóa rồi tải lại, Làm mới/lỗi/Thử lại, đổi chiến dịch, không tràn khung ở 850/1600 px, theme sáng/tối. Lượt này chạy bằng Chromium (`AKA_UI_SMOKE_CHROMIUM`) vì sandbox không có Electron; chưa chạy trên Windows/macOS thật.
- Hồi quy: `campaign-diagnostics-smoke.cjs` và `account-action-overview-scope-smoke.cjs` đạt sau khi tách công thức. `campaign-pending-reason-smoke.cjs`/`campaign-pending-reason-chat-smoke.cjs` lỗi "Unexpected dependency" y hệt trên `dev_3` sạch (bản đồ module cũ), không do thay đổi này.

## Phát hành và gỡ bỏ

Cần build/phát hành bộ cài Desktop mới để người dùng thấy tab; không đổi DB, Edge, App Server hoặc WebApp. Gỡ bỏ: phát hành bản Desktop trước; không có dữ liệu cần dọn.
