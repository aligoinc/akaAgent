# Trợ lý aka: hỏi đáp chiến dịch — phần Desktop

> **Trạng thái:** phương án ngày 09/11/2026, **đã duyệt toàn bộ cùng ngày** (quyết định ở mục 17 của tài liệu chính).
> **Sửa lần 2 (09/11/2026):** không dùng chung bảng hay code với akaAgentChatApi; thêm bảng `ai_prompt_group` (nhóm **Trợ lý aka chiến dịch**); hai mục campaign-support (agent aka10000) chạy song song.
> **Chưa code, chưa migration, chưa áp gì lên production.**
> Tài liệu chính (kiến trúc, 15 API ngữ cảnh, prompt 2 lớp, danh mục nguyên nhân, cổng 95%, câu hỏi cần chốt):
> akaAgentWebApp [`docs/CAMPAIGN_ASSISTANT_QA_PLAN.md`](https://github.com/aligoinc/akaAgentWebApp/blob/claude/wonderful-shannon-dyxnwf/docs/CAMPAIGN_ASSISTANT_QA_PLAN.md).
> File này chỉ ghi phần việc của Desktop và các phát hiện khi khảo sát mã Desktop/App Server.

## 1. Desktop dùng bộ máy chung ở API Web

- Menu **Trợ lý** thêm "Tại sao chiến dịch không chạy?" và "Chiến dịch đang bị lỗi gì?"; câu trả lời và ô hỏi tiếp nằm trong panel Trợ lý hiện có (`LogPanel.tsx`, chế độ `assistantMode`). Hai mục campaign-support (agent aka10000) giữ nguyên, chạy song song.
- Desktop **không** tự dựng ngữ cảnh hay prompt. Main process gọi route Desktop mới của API Web, `…/api/aka-agent/desktop/v1/campaign-assistant/turns`, xác thực bằng JWT Desktop như proxy AI V434 (`desktop-ai.routes.ts`). Lý do: fleet chậm cập nhật (đo 09/11: 215 máy online, 4 bản 9.1.0–9.4.0); để logic ở server thì sửa prompt/API/luật có hiệu lực ngay, không cần phát hành.
- Khi hỏi, Desktop gửi kèm ảnh chụp RAM mới nhất của bộ chạy (cùng cấu trúc `desktopRuntimeSnapshot.ts`); server ghi là dữ kiện "do app báo", không thay dữ liệu DB.

## 2. Việc cần làm ở Desktop

| Việc | Chỗ sửa | Ghi chú |
|---|---|---|
| Menu 2 câu hỏi mới | `src/renderer/src/components/CampaignPanels/CampaignAssistantMenu.tsx` (đang cài cứng 4 mục, dòng 56–59), `src/shared/campaignSupport.ts` (`CampaignAssistantMode`) | Menu vẽ theo bảng câu hỏi `auto_campaign_assistant_question` qua route config (đọc một lần khi mở trang); đọc lỗi thì dùng các mục cài sẵn. `campaign_support` / `campaign_support_dsh` (agent `aka10000.fly.dev`) **không thay**: thành 2 dòng `kind = external_agent` mà admin akaBiz ẩn và đổi nhãn được; nhãn mặc định đổi khỏi "Tại sao chiến dịch không chạy?" để không trùng câu hỏi mới. Mặc định đưa phần menu đọc cấu hình vào bản phát hành gần nhất (chờ chốt) |
| Tab trả lời | Component mới cạnh `CampaignAssistantTab.tsx` | 5 phần, nhãn Chắc chắn/Gợi ý, nút, Kiểm tra lại, 👍/👎, ô hỏi tiếp có ảnh |
| IPC + service main | `src/main/ipc/handlers/` + `src/main/services/` mới | `ai:campaign-assistant:{send,cancel,conversation,feedback}`; huỷ khi đổi chiến dịch/đăng xuất; không lưu nội dung hội thoại ra file |
| Kiểm ảnh | Dùng lại `src/main/services/campaignSupportImageValidation.ts` | ≤ 5 ảnh, 5 MB/ảnh, 15 MB tổng; WebP giữ nguyên byte |
| Hợp đồng dùng chung | `src/shared/campaignAssistant.ts` | Chép nguyên văn từ akaAgentWebApp `packages/control-api/src/campaignAssistant.ts`: khoá nút, mã nguyên nhân, kiểu dữ liệu |
| Nối nút mở form | `CampaignPanel.tsx` (`handleDiagnosticAction`), `CampaignFormModal.tsx` | Nới kiểu `initialSection` (form đã nhận mọi id trong `STEPS`); thêm `accountActionsCampaign` (modal `AccountInfoModal` có `campaign`), `resumeAccount` (đang chỉ ở menu chuột phải AccountPanel), `blocklists` (`onOpenGeneralSettings('zaloBlocklists')`), `dataGroup` (prop đã có ở `App.tsx`), `exclusions` (thêm ref cho `CampaignSendExclusions`) |
| Heartbeat v2 | `src/main/services/desktopRuntimeSnapshot.ts` | Tăng `v` lên 2, giữ trường v1. Thêm: `scheduler.maintenance` (chờ từ lúc nào, lỗi bảo trì), `scheduler.zalo_mode_restart_required`, `accounts[].zalo_web_session`, `held_after_failure`, `operation`, `run` (chiến dịch, bước, từ lúc nào), và dòng cho tài khoản bị loại kèm `reason`. Không thêm request (mục 18.4 tài liệu chính) |
| Ảnh chụp cho App Server | `src/server/main/zaloServerRuntimeManager.ts` + bảng mới `auto_server_runtime_state` | Hiện App Server không ghi `runtime_state`; trạng thái và lỗi khởi động chỉ ở RAM. Ghi khi trạng thái đổi, tối đa 5 phút/lần cho nhân viên đang có chiến dịch chạy/đến giờ (đo 09/11: 672 nhân viên, 1.770 tài khoản Zalo Server) |
| Nút "Tại sao CD không chạy?" | `src/main/services/campaignPendingReasonService.ts` | Bản GĐ3 gọi route Desktop của Lớp 0 ở server (không AI); bản cũ giữ luật cục bộ |

Toàn bộ SQL đặt ở `migrations/` của repo này như mọi migration khác: bảng `ai_prompt_group` + cột `ai_prompt.group_id` (nhóm **Trợ lý aka chiến dịch**, phân nhóm cả prompt đang có), 15 hàm `public.aka_agent_campaign_ctx_*` + hàm gom 8 API gọi sẵn, bảng lượt hỏi/kiến thức/sự cố/câu hỏi/ca chấm, dòng `ai_prompt`/`ai_using`, công tắc. Số `vN` chỉ đặt lúc code, sau khi kiểm sổ migration và các nhánh chưa merge. **Không sửa gì ở akaAgentChatApi.**

Desktop đọc `ai_prompt` bằng `select('*')` (`src/main/data/repositories/aiRepository.ts:113-117`) và có SELECT cấp bảng, nên thêm cột `group_id` không làm hỏng bản đang chạy. Thêm cột đổi md5 cả dòng `ai_prompt` mà các script rollback cũ trong `migrations/tests/` (V394, V395, V400, V403, V405) đang kiểm; quy ước mới: tính md5 dòng `ai_prompt` thì bỏ `group_id`.

## 3. Phát hiện khi khảo sát mã Desktop/App Server (09/11/2026)

Thứ tự kiểm của bộ chạy (điều kiện đầu tiên gặp phải thắng):

1. `tick()` (`campaignScheduler.ts:1612-1728`): cổng bảo trì ngày (chặn mọi tài khoản) → mở khoá hành động đến hạn → tài khoản đủ điều kiện → theo từng tài khoản: đúng bộ chạy → truy vấn chiến dịch chờ (lịch, giờ dừng, 23:59) → tài khoản bận → trạng thái/đăng nhập → phiên Zalo Web → tab trình duyệt → chạy hàng đợi.
2. `executeCampaign` (`:3324-3605`): đọc lại → **khoá/hạn mức trước khi lấy quyền** → RPC lấy quyền (nhân viên, quyền Zalo, khung giờ, trạng thái, data nhóm, giới hạn chạy đồng thời) → sau khi lấy quyền: loại trừ, tính năng gói, workflow, phiên Zalo, cấu hình kết quả.
3. Từng data (`:3949-4855`): chặn theo trạng thái, giờ dừng, tài khoản, chống gửi trùng/từ chối nhận tin, khoá/hạn mức, chạy, chính sách lỗi, nghỉ.

Trạng thái chỉ có trong RAM (DB không thấy): phiên Zalo Web chưa xác minh, tài khoản bị giữ sau lượt lỗi chưa dọn xong, thao tác tài khoản (đăng nhập/quét data), chặn vì đổi chế độ Zalo, bảo trì ngày lỗi, vòng thử lại khi mất kết nối, dòng log "chưa mở tab trình duyệt". Heartbeat 9.4.0 đã có `scheduler.state` (`stopped`/`idle`/`running`/`blocked_daily_maintenance`) và lý do tài khoản (`inactive`/`paused`/`checkpoint`/`not_logged_in`/`browser_tab_closed`), nhưng chỉ cho tài khoản đủ điều kiện ở lượt quét trước (tối đa 200) và phiên Zalo Web chưa xác minh vẫn báo `ready = true`.

Lấy quyền chạy thành công luôn đặt `auto_campaigns.note = NULL` (`migration_v397`), nên ghi chú chỉ còn khi chiến dịch vẫn đang bị chặn hoặc bộ chạy không chạy. Trợ lý phải kiểm lại điều ghi chú nói bằng dữ liệu hiện tại.

Các điểm CLAUDE.md từng ghi khác code — **đã sửa ngày 09/11/2026** bằng ghi chú "[ĐÍNH CHÍNH 09/11/2026]" ngay tại chỗ:

- Hạn mức: giới hạn ngày đọc `auto_account_action_status.count_action_in_day`; khung phút đếm `auto_campaign_details` theo `(account_id, action_code)` với `counts_toward_limit = true`, hoặc NULL có trạng thái `thành công`/`thất bại` (`campaignRepository.ts:876-907, 6424-6487`).
- Không có `resetRunningStatuses` / `recoverStuckCampaignInputData` lúc mở app; phục hồi chạy lúc đăng nhập/đăng xuất/thoát (`handlers.ts:691-739`) và qua RPC dọn lượt (V392).
- Thiếu workflow: ghi chú "Loại chiến dịch chưa được liên kết workflow", giữ `chờ xử lý`, không đánh hoàn thành (`campaignScheduler.ts:3526-3530`).
- Cổng bảo trì nay hiện trong heartbeat; `daily_maintenance_required` áp cả chiến dịch tuần/tháng có lịch cũ (V340).
- Zalo Web: có một lần tự tải lại tab khi còn cookie; kiểm thất bại khi còn cookie không hạ `login_status` (`accountPoller.ts:122-179`, `zaloRuntimeService.ts:990-996`).
- `auto_account_error_state` không còn là nguồn tạm dừng (phần tăng đếm không còn nơi gọi).
- Ngưỡng lỗi liên tiếp của `err_undefined` nằm trong DB (seed V15 là 5); production 09/11/2026 là **4** (`tạm dừng`), đúng như CLAUDE.md đang ghi nên không sửa.
