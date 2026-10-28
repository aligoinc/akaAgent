# UI, trạng thái và log

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 709–735. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
### Vietnamese UI conventions

Status values trong DB lưu **tiếng Việt có dấu**:
- Campaign: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'tạm dừng'` (KHÔNG có `'lỗi'` trong runtime hiện tại)
- campaign_inputs: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'lỗi'`, `'tạm dừng'`
- campaign_input_data: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'tạm dừng'` (KHÔNG có `'lỗi'`)
- campaign_details: `'thành công'`, `'thất bại'`, `'lỗi'`
- automation_detail: `'chờ xử lý'`, `'đang xử lý'`, `'đã thêm'`, `'bỏ qua'`, `'lỗi'`
- Login status: `'đã đăng nhập'`, `'chưa đăng nhập'`, `'checkpoint'`

**Customer-facing log language** (rất quan trọng — log từ `sendLog()` và `auto_campaign_details.log` đều khách hàng đọc):
- Viết tiếng Việt tự nhiên: `"Đã comment vào bài thứ 3: ..."`, `"Đăng bài thành công vào ..."`, `"Group cần duyệt bài"`
- TRÁNH: `"Đã log X"`, `"lần X/Y"`, `"vị trí #N"`, ID strings, stacktraces, `"position"`, `"iteration"`, `"campaign_detail"` lộ ra UI
- Technical metadata (`commentPosition`, `iteration`, `commentType`) → JSONB `data` column, KHÔNG vào `log` string
- Progress log theo campaign dùng `CampaignScheduler.logCampaignProgress()` để vừa append vào `auto_campaigns.log`, vừa bắn panel phải "Tiến trình", vừa broadcast campaign updated; UI đọc `auto_campaigns.log` ở tab "Lịch sử chạy".
- `auto_campaigns.log` phải format qua [campaignLogFormat.ts](../../../src/shared/campaignLogFormat.ts): stored line `HH:mm:ss dd/MM/yyyy - account - campaign - message`, giữ emoji/marker screenshot, reader dùng `parseCampaignLogLine()` để hỗ trợ cả log cũ dạng `[timestamp] message`.
- Screenshot progress log là artifact-only (`📸 Ảnh chụp màn hình trạng thái trình duyệt`), ghi sau log kết quả action khi match được step, có thể kèm action realtime `block_screenshot_preview` để nút `Xem` mở ảnh trong app; raw `auto_campaigns.log` được thêm marker ẩn `<!-- screenshotEventId:N -->` để match event, UI phải strip marker và không được lưu local file path vào log text.
- Khi campaign chạm ngưỡng lỗi liên tiếp, log `⚠️ Chiến dịch đã lỗi/thất bại liên tiếp...` dùng root cause từ `auto_campaign_details.data.error`; riêng `err_undefined` có screenshot thì AI diagnosis có thể thay root cause, nhưng không được đổi policy/counter/status.
- Log gửi Zalo thành công một phần phải giữ `detail.log` đã render theo policy/fallback trong [campaignScheduler.ts](../../../src/main/services/campaignScheduler.ts), áp dụng hai chiều media/chữ và share; không tự thêm lỗi gốc/mã lỗi hoặc đổi quy tắc log chung. Smoke offline: `node scripts/zalo-partial-send-log-smoke-test.cjs`.
- Với workflow Zalo, `zalo_tag_contact` và `zalo_change_alias` là action phụ: kết quả vẫn ghi `auto_campaign_details` theo `detail_status` nhưng thành công/thất bại đều không tăng hoặc reset bộ đếm bad-target liên tiếp. Action chính/tiên quyết như tìm SĐT, nhắn tin, kết bạn, thao tác group vẫn bám `auto_error.counts_toward_bad_target`; mọi side effect explicit của policy (`update_status_*`, `disable_action_codes`, `update_login_status`) vẫn phải thực thi kể cả khi lỗi phát sinh ở action phụ.
- Email recipient precheck chỉ ghi log khách hàng ngắn như `Email không tồn tại user@example.com`; không đưa raw SMTP reason (`550-5.1.1...`), DNS/debug text, stacktrace hoặc URL support vào `auto_campaign_details.log`. Metadata kỹ thuật nếu cần thì để trong JSONB `data.recipientCheck`.
- Scheduler/global `sendLog()` lỗi mất mạng phải dùng câu thân thiện, không lộ `TypeError: fetch failed`; chỉ log một lần cho mỗi đợt mất kết nối, giữ lỗi kỹ thuật trong `console.error`, và chỉ log kết nối lại sau khi toàn bộ tick scheduler chạy xong không lỗi.
- **Log order**: action milestone trước (📝 Đăng bài), rồi metadata (⏳ Chờ duyệt), rồi link/artifact (🔗), milestones tiếp theo (💬), cuối cùng summary (✅/❌)
- Emoji vocab thống nhất: 📝 Đăng bài • 💬 Comment/Nhắn tin • 🔗 Link • ⏳ Chờ duyệt • ✅ Hoàn thành • ❌ Lỗi • 👋 Rời nhóm • 🤝 Kết bạn/Tham gia • 🔀 Shuffle/Share • ⚠️ Cảnh báo • ℹ️ Info • 🎬 Reels

**Per-milestone logging**: post xong ghi 1 row, mỗi comment ghi 1 row, friend request ghi 1 row — KHÔNG đợi cuối flow. Lý do: nếu comment failed sau khi post OK, vẫn phải có row "Đăng bài thành công" để khách hàng thấy. Với `fb_comment_at_position`, lỗi ở một bài trả `commentFailed=true`/detail `thất bại` và loop vẫn tiếp tục bài sau; chỉ khi không có milestone thành công nào thì target comment seeding mới bị tính bad.


<!-- END PRESERVED SOURCE -->
