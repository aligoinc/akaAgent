# Workflow engine v2

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 513–530. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
### Workflow engine v2

Facebook kết bạn v359 đã apply `20261009022202 / migration_v359_facebook_friend_statuses` trên akachat ngày 09/10/2026; không apply lại. Desktop mới dùng `facebookFriendOutcomeVersion=1` để phân biệt đã gửi/chấp nhận/đã là bạn/gửi mới/thiếu nút, giữ snapshot `auto_error` cho status/quota/bad-target/side effects và đếm một bad-target cho lỗi nhắn tin+kết bạn cùng input; app cũ giữ body legacy, Desktop mới chưa phát hành. Xem [audit và rollout](../../../docs/FACEBOOK_FRIEND_STATUSES_V359.md).

V360 đã apply `20261009025028 / migration_v360_facebook_friend_cancel_commit`: giữ kết quả/quota của click đã hoàn tất khi hủy sleep, không requeue input đã thực hiện; quyết định pause đầu tiên không bị policy sau ghi đè, các khóa account/action vẫn áp dụng. Desktop đã build local, chưa phát hành; không apply lại. Xem [audit và kiểm chứng](../../../docs/FACEBOOK_FRIEND_CANCEL_POLICY_V360.md).

[src/main/v2/runtime/](../../../src/main/v2/runtime/) — engine duy nhất chạy campaign:
- `workflowEngine.ts` — DAG executor cohort-based: parallel split (multiple outgoing edges), AND/OR join (mode='all'/'any' merge node), `ifElse` skip propagation, loop body re-exec với `vars.loopItem`/`vars.loopIndex`, `AbortSignal` cancellation. `allSteps[]` track loop iterations để scheduler log đầy đủ (snapshot `nodeStates` chỉ giữ iteration cuối).
- `blockExecutor.ts` — `vm.createContext` sandbox. KHÔNG expose `process`/`require`/`Buffer`/`fs`. Block code = JS string, return object → output, throw → fail.
- `pageController.ts` — wrap `webContents.executeJavaScript` thành API `page.click/type/fill/focus/paste/insertText/scroll/evaluate/$$/waitForSelector/uploadFile/dropFile/dropFileDeep/apiCall/downloadUrl`. Hỗ trợ XPath union `|` và CSS. Có fallback scroll cho FB comment box lazy-render; `dropFileDeep` tìm drop target cả trong iframe cùng origin.
- `backgroundPageManager.ts` — hidden/offscreen browser pages cho scheduler, shared persistent partition với visible webview theo account.
- `blockHelpers.ts` — `sleep`/`log`/`randomBetween`/`normalizeFbUrl`/`extractUidFromInput`/`splitVariants`/`cycleVariant`/`element(name)`/`elementWith(name, vars)`/`checkGroupPendingContent(opts)`. `element` query cached `auto_elements`; migration/SQL cập nhật element trực tiếp không invalidate cache của process đang chạy, nên phải thoát hẳn app rồi mở lại hoặc lưu qua `elementV2Repository` để runtime nhận XPath mới. `checkGroupPendingContent` do scheduler inject runtime helper, mở temporary background page cùng partition account và stream preview page phụ. Helper mở rộng để block DB ghi log cấu trúc phải dùng optional names như `logRunEvent`/`logRunEvents`; nếu runtime chưa implement thì helper trả unsupported/no-op, còn helper sai tên ngoài whitelist vẫn lỗi để bắt typo. Khi helper được implement, engine tự bơm metadata `run_id`/`run_step_id`/`node_id`/`block_name`/campaign/input/account vào `auto_campaign_run_events`; block chỉ truyền event payload.
- Node config runtime `screenshotCaptureTiming` + `screenshotCaptureOn` là metadata universal của workflow engine, không truyền vào `input` block và không ghi vào step output. Phase hiện tại chỉ capture sau block; PNG lưu local dưới `app.getPath('userData')/local-data/block-screenshots`, metadata user-facing ghi vào `auto_campaign_run_events.event_type='browser_screenshot'` với `debug_data.screenshotPath`. Screenshot event metadata lưu kết quả chiến dịch/action dễ hiểu (`Đăng bài thất bại...`, `Lỗi đăng bài...`, policy `auto_error` nếu có); `block_name/node_id` chỉ là metadata debug, không làm text chính cho user. Ba action Facebook message chỉ bật capture `after/failure` tại node gửi; riêng `fb_send_page_inbox_message`, outcome `not_found`/`wrong_conversation` phải giữ `reason` nhưng không trả explicit `ok:false`, để scheduler ghi `không tồn tại` mà screenshot engine không coi là failure. `upload_timeout`/`send_failed` và exception vẫn là failure/error cần chụp.
- Built-in `fb_resolve_url` resolves URL input in this order: `input.raw`, `vars.inputDataUid`, `vars.targetUrl`. DB rows are the source of truth for built-in blocks/workflows/elements.
- Bảng: `auto_blocks`, `auto_workflows`, `auto_elements`, `auto_runs`, `auto_run_steps` (BIGSERIAL id, UNIQUE name).

[campaignScheduler.ts](../../../src/main/services/campaignScheduler.ts) chọn workflow theo current staff: `org_staff.use_test_workflow=false` dùng `auto_campaign_actions.workflow_id`, `true` dùng `test_workflow_id`; khi bật test mà action thiếu `test_workflow_id` thì giữ campaign `'chờ xử lý'` với note, không fallback sang workflow thật.


<!-- END PRESERVED SOURCE -->
