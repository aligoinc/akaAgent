# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # Lần đầu — auto chạy electron-builder install-app-deps
npm run dev              # Dev mode (HMR cho renderer, watch cho main)
npm run build            # Build production (out/main + out/preload + out/renderer)
npm run build:win        # Build → đóng gói NSIS installer (Windows)
npm run build:mac        # Build → đóng gói DMG (macOS)
npm run preview          # Preview production build

# Typecheck — KHÔNG có lint/test commands
npx tsc --noEmit -p tsconfig.node.json   # Main + preload + shared
npx tsc --noEmit -p tsconfig.web.json    # Renderer
```

Project KHÔNG có test framework / lint config. Verify bằng tsc + manual smoke test. Sau migration_v4 (drop engine v1) typecheck phải sạch 0 errors — bất kỳ error nào là regression.

## Architecture

**Electron 33 + React 19 desktop app** cho automation Facebook (group post / timeline post / message friend / kết bạn). Build qua `electron-vite`. State Zustand. Canvas `@xyflow/react`. DB Supabase. Code editor Monaco.

### 3-layer Electron split (`src/`)

| Layer | Path | Trách nhiệm |
|---|---|---|
| Main process (Node) | [src/main](src/main) | IPC, DB (Supabase), webview controller, scheduler, updater |
| Preload bridge | [src/preload/index.ts](src/preload/index.ts) | Expose `electronAPI.*` qua `contextBridge` |
| Renderer (React) | [src/renderer/src](src/renderer/src) | UI, Zustand stores, xyflow canvas, Monaco editor |
| Shared | [src/shared](src/shared) | Types + IPC event constants (cả 2 phía import) |

### Webview controller

[src/main/playwright/webviewController.ts](src/main/playwright/webviewController.ts) — thin wrapper exposing `isConnected()` + `getURL()` cho `webContents` của Electron `<webview>` đã embed cho từng tài khoản FB. Visible webviews vẫn dùng cho login, status checks và test thủ công trong editor.

`WebviewRegistry` maps `accountId -> webContentsId`. Scheduler uses `isRegistered()` to ensure the account has mounted a browser tab at least once; accountPoller uses `listRegistered()` to skip dead tabs. Runtime uses `accountId` and partition `persist:account_${accountId}`; browser profiles from the previous partition prefix are not reused.
ContactLoader là utility ngoài campaign nhưng chạy bằng workflow v2 built-in trên hidden/offscreen `BackgroundPageManager`, output lưu vào `auto_account_contacts`; chỉ load khi account `isActive=true`, `loginStatus='đã đăng nhập'`, `status IN ('chờ xử lý','tạm dừng')`. Khi quét, account được set `status='đang chạy'` để scheduler không chạy campaign đè cùng session; account đang `'đang chạy'` thì không cho quét. Facebook user lưu `contact_type='person'` + `is_friend=true` khi quét danh sách bạn bè; nếu lần quét sau không còn thấy thì set `is_friend=false` và giữ `is_delete=false`. Group còn thấy thì `is_joined=true`; group mất khỏi snapshot thì `is_joined=false` và giữ `is_delete=false`; page mất khỏi snapshot thì set `is_delete=true`. Friend/group scroll không dùng max cap; dừng sau 3 vòng liên tiếp không tăng số contact hợp lệ đã parse. Page loader chỉ dùng Graph API `me/accounts` sau khi lấy token từ `business.facebook.com/content_management` bằng pattern akaBizAuto `EAAG(.*?)"` và gửi kèm cookies session FB; nếu API/token fail thì báo lỗi, không fallback quét giao diện. `contacts:cancel-load` kết thúc lần quét ở data hiện có và vẫn cleanup snapshot như một lần load hoàn tất; completion dùng event `contacts:completed` với payload chuẩn, không parse text progress. Khi chọn vào campaign, picker lưu FB URL vào `auto_campaign_input_data.uid` để workflow nhận raw target chính xác. Group activity text lưu ở `auto_account_contacts.extra_data.lastActivityText`, không ghép vào `name`; `DataScanModal` mặc định lọc bạn bè/group đã tham gia nhưng user có thể đổi `Hiển thị` sang `Tất cả`, và campaign picker có thể chọn cả person/group không còn active nếu user cố tình chọn.

Campaign automation chạy qua [src/main/v2/runtime/backgroundPageManager.ts](src/main/v2/runtime/backgroundPageManager.ts) hidden/offscreen `BrowserWindow` theo từng account để minimized vẫn render ổn định. Renderer không tự chuyển page/focus; BrowserPage chọn sẵn account bằng `campaign:browser-select` và hiển thị preview stream bằng `campaign:browser-preview` để user tự vào quan sát. Test/editor vẫn dùng `PageControllerRegistry` của webview visible.

Convention quan trọng (xem memory `campaign_conventions.md`):
- **C# Facebook DOM workflow reference**: khi user cung cấp code C# Facebook automation đã chạy đúng, xem code C# là source-of-truth cho mọi tương tác DOM trong workflow. Trigger nhanh rule này khi user nói các cụm như `C# DOM mode`, `trust C#`, `bám C#`, `làm giống C#`, hoặc `đối chiếu DOM theo C#`. Bắt buộc bám sát C# nếu user không yêu cầu khác: XPath selector giữ nguyên; parent/root dùng để find element giữ nguyên; thứ tự thao tác DOM giữ nguyên; click/scroll/sleep/poll phải mô phỏng đúng hành vi C# nhất có thể trong Electron workflow; không tự thêm fallback selector, selector tiếng Anh, contains-class thay exact-class, visible filter, scroll container fallback, hoặc DOM heuristic khác. Được phép khác C# ở logic ngoài DOM nếu phù hợp hệ thống: lưu DB/upsert/dedupe, logging/progress/cancel, workflow variables, stop policy như `maxNoChangeCycles` nếu user chấp nhận. Trước khi implement workflow từ C#, agent phải trình bày bảng đối chiếu `C# step | Workflow step dự kiến | Khác C# không | Lý do`; nếu cần khác C# ở phần DOM, phải hỏi user trước.
- **Atomic blocks**: tuyệt đối KHÔNG tạo "do-many-things" block. Compose existing primitives (`page.click`/`page.type`/`page.waitForSelector`/...).
- **KHÔNG dùng tọa độ viewport** — webview có thể không focus, `getBoundingClientRect()` clientX/clientY có thể sai. Dispatch synthetic event với `{bubbles, cancelable, view: window}` (no coords).
- **FB timestamp link** lazy-load qua `FocusEvent('focusin')`, không phải hover.
- **Fanpage UI post link**: `fb_post_current_identity_ui` lấy link sau khi composer đóng bằng `FbComposerRawPostLink` → render wait → `FocusEvent('focusin')` → `FbComposerPostLink`; nếu `postUrl=''` nhưng `posted=true` thì vẫn log đăng thành công, chỉ thiếu link.
- Group post click popup optional `GroupPostDismissDialogOrUsePageButton` sau khi vào group và sau verify submit; sau `fb_click_post_button` phải chạy `fb_verify_group_post_form_closed`, link lấy qua `GroupPostRawPostLink` → `FocusEvent('focusin')` → `GroupPostPostLink`, pending tính từ `/pending_posts/` ([migration_v37_group_post_link_after_publish.sql](migrations/migration_v37_group_post_link_after_publish.sql)).
- Sau group post verify thành công, scheduler upsert group contact theo account: link `/pending_posts/` → `requires_post_approval=true`, link thường → `false`, không lấy được link thì giữ `null`; group do campaign insert mặc định `is_joined=false` ([migration_v39_account_contact_group_status.sql](migrations/migration_v39_account_contact_group_status.sql)).
- Group post comment: `commentGroupMode` filter sau khi biết pending; pending `own` bỏ qua, pending `others` shift về bài đầu tiên, pending `all` giữ `[1..N]` bài đang thấy ([migration_v40_group_post_comment_options.sql](migrations/migration_v40_group_post_comment_options.sql)).
- Group post skip known approval: `skipPostIfGroupRequiresApproval` tra `auto_account_contacts.requires_post_approval`; nếu `true` thì workflow bỏ composer/post nhưng vẫn đi nhánh comment với pending từ account contact ([migration_v41_skip_group_post_known_approval.sql](migrations/migration_v41_skip_group_post_known_approval.sql)).

### Workflow engine v2

[src/main/v2/runtime/](src/main/v2/runtime/) — engine duy nhất chạy campaign:
- `workflowEngine.ts` — DAG executor cohort-based: parallel split (multiple outgoing edges), AND/OR join (mode='all'/'any' merge node), `ifElse` skip propagation, loop body re-exec với `vars.loopItem`/`vars.loopIndex`, `AbortSignal` cancellation. `allSteps[]` track loop iterations để scheduler log đầy đủ (snapshot `nodeStates` chỉ giữ iteration cuối).
- `blockExecutor.ts` — `vm.createContext` sandbox. KHÔNG expose `process`/`require`/`Buffer`/`fs`. Block code = JS string, return object → output, throw → fail.
- `pageController.ts` — wrap `webContents.executeJavaScript` thành API `page.click/type/fill/scroll/evaluate/$$/waitForSelector/uploadFile/dropFile/apiCall/downloadUrl`. Hỗ trợ XPath union `|` và CSS. Có fallback scroll cho FB comment box lazy-render.
- `backgroundPageManager.ts` — hidden/offscreen browser pages cho scheduler, shared persistent partition với visible webview theo account.
- `blockHelpers.ts` — `sleep`/`log`/`randomBetween`/`normalizeFbUrl`/`extractUidFromInput`/`splitVariants`/`cycleVariant`/`element(name)`/`elementWith(name, vars)`. `element` query cached `auto_elements`.
- Built-in `fb_resolve_url` resolves URL input in this order: `input.raw`, `vars.inputDataUid`, `vars.targetUrl`. DB rows are the source of truth for built-in blocks/workflows/elements.
- Bảng: `auto_blocks`, `auto_workflows`, `auto_elements`, `auto_runs`, `auto_run_steps` (BIGSERIAL id, UNIQUE name).

[campaignScheduler.ts](src/main/services/campaignScheduler.ts) lookup `auto_campaign_actions.workflow_id` rồi gọi `executeCampaignV2`. Action không có `workflow_id` → log lỗi + mark complete (không có fallback).

### Campaign system

Domain (sau migration_v4 drop engine v1):
- `auto_accounts` — tài khoản/social profile để login và chạy automation (trước đây là `org_accounts`); `rate_limit_minutes` là số phút khung check giới hạn giờ copy vào campaign khi lưu, default/fallback `65`, hiện không chỉnh ở UI account.
- `auto_account_contacts` — danh bạ person/group/page theo account (trước đây là `org_account_contacts`); person dùng `is_friend` để lưu trạng thái bạn bè, group dùng `is_joined` và `requires_post_approval` nullable để lưu trạng thái tham gia/duyệt bài. Dữ liệu legacy `contact_type='friend'` chỉ đổi sang `person` qua script manual `migrations/manual_update_friend_contacts_to_person.sql`, không chạy tự động trong migration feature.
- `auto_account_contact_groups` / `auto_account_contact_group_members` — nhóm data theo `account_id + contact_type`; một contact có thể nằm nhiều nhóm. Membership unique `(group_id, contact_id)` nên thêm trùng phải dùng upsert/ignore duplicate, không nhân đôi. `DataScanModal` có modal xem/quản lý nhóm data và modal chọn nhóm data; khi chọn nhiều nhóm vào campaign phải union contacts rồi lọc trùng trước khi insert snapshot vào `auto_campaign_input_data`.
- `auto_campaigns` — campaign config (action_id, account_id, schedule, daily_stop_time, content, extra_settings). Status runtime hợp lệ: `'chờ xử lý' | 'đang chạy' | 'tạm dừng' | 'hoàn thành'` (`'lỗi'` không còn là campaign status hợp lệ; lỗi action-level nằm ở `auto_campaign_details`). `daily_stop_time` là giờ dừng trong ngày (`time`, Asia/Ho_Chi_Minh); `getPendingCampaigns()` bỏ qua campaign sau giờ này.
- `auto_campaign_actions` — template loại campaign (`facebook_group_post`/`facebook_timeline_post`/`facebook_page_post`/`facebook_message_friend`/`facebook_message_uid`/`facebook_find_data_group`/`facebook_comment_seeding`/`facebook_comment_seeding_post`); column `workflow_id` (BIGINT, FK auto_workflows.id) là pointer duy nhất tới workflow.
  - `limit_check_action_codes text[]` controls which `auto_account_actions.code` values scheduler checks for rate limit/disable before running this campaign action.
- `auto_account_actions` — định nghĩa action theo account (`fb_post_group`/`fb_post_page`/`fb_comment`/`fb_message_friend`/`fb_message_stranger`/...). Limit/error policy dùng `code`, KHÔNG dùng `auto_campaign_actions.id`.
- `auto_account_action_status` — counter + trạng thái disable theo `(account_id, action_code)`: `count_action_in_day`, `is_disable`, `date_enable`; Supabase cron reset/ngày và enable action quá hạn.
- `auto_error` + `auto_account_error_state` — policy lỗi chuẩn hoá + bộ đếm lỗi liên tục. Lỗi chưa định nghĩa quy về `err_undefined`.
- Error policy DB mutations (update campaign/account/action status) chạy ở scheduler/service layer; workflow blocks chỉ nên phát hiện/chuẩn hoá lỗi, không tự update Supabase.
- `auto_campaign_inputs` — pool nguyên liệu thô (e.g. danh sách group để scrape members → sinh input_data). Status: `'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành' | 'lỗi'` (`'lỗi'` flag input không scrape được; admin re-trigger).
- `auto_campaign_input_data` — **việc-cần-làm thực thi** (mỗi target/profile/group = 1 row). Status: `'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành'` (KHÔNG có `'lỗi'` — lỗi action-level đã track ở campaign_details; khi run fail set `'hoàn thành' + note=errMsg`). Cột `input_id BIGINT NULL` FK → `auto_campaign_inputs.id` (nếu sinh từ scrape; NULL nếu user nhập tay).
  - `schedule` là lịch chạy theo từng row: scheduler chỉ chạy row `chờ xử lý` khi `schedule IS NULL` hoặc đã tới giờ; row tương lai bị skip tạm và campaign được hẹn lại theo schedule sớm nhất ([campaignScheduler.ts](src/main/services/campaignScheduler.ts)).
- `auto_campaign_details` — **customer-visible "Lịch sử hành động"**: mỗi milestone (post, từng comment, friend request, message) ghi 1 row riêng. Status: `'thành công' | 'thất bại' | 'lỗi'` (thành công = OK; thất bại = nghiệp vụ FB từ chối; lỗi = exception/crash code). FK `input_data_id` (nullable cho simple campaign không có input_data).
  - `action_code` gắn tới `auto_account_actions.code`; khi detail status `thành công/thất bại`, repository tăng `auto_account_action_status.count_action_in_day`.
  - `error_code` gắn tới `auto_error.error_code` khi detail ghi lỗi chuẩn hoá.

[CampaignScheduler](src/main/services/campaignScheduler.ts) — `setInterval(tick, 30s)`:
1. Lấy accounts + campaigns đến giờ
2. Lookup action.workflow_id → `executeCampaignV2`
3. Mỗi input_data row lấy hidden/offscreen `PageController` từ `BackgroundPageManager`, run workflow, rồi log per-milestone vào `auto_campaign_details` qua `logMilestonesV2` (scan `result.steps` theo `block_name`: `fb_click_post_button` → "Đăng bài", `fb_comment_at_position`/`fb_comment_current_post` → "Comment", `fb_send_message` → "Nhắn tin", `fb_add_friend` → "Kết bạn"). Status mapping: `step.status==='error'` → `'lỗi'`; `output.ok===false` không exception → `'thất bại'`; còn lại → `'thành công'`.
4. Sleep `extra.actionLimits.sleepBetweenActions` giây giữa input_data rows; nếu user yêu cầu tạm dừng khi campaign đang chạy, scheduler giữ status `'đang chạy'` + note `"Đang chờ tạm dừng"`, cho target hiện tại chạy xong rồi mới chuyển campaign sang `'tạm dừng'` tại điểm nghỉ/trước target kế tiếp (không abort workflow chỉ vì pause).
Scheduler tự start sau `AUTH_LOGIN` và stop nội bộ khi `AUTH_LOGOUT`; UI không có nút bật/tắt scheduler, muốn dừng thì pause campaign/account.
Các cập nhật `auto_accounts.status` do scheduler thực hiện phải đi qua `updateAccountAndBroadcast()`/`releaseRunningAccount()` để UI tài khoản refresh realtime và không ghi đè trạng thái do user/policy đổi.

`facebook_group_post` có `enablePostBump`: sau post thành công và link không pending, scheduler thêm tổng `postBumpCount` input rows vào các campaign `facebook_comment_seeding_post` theo round-robin; mode tạo mới lazy-create 1 campaign/comment account ([campaignScheduler.ts](src/main/services/campaignScheduler.ts), [CampaignFormModal.tsx](src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx)).

`facebook_page_post` đăng lên data `contact_type='page'` và count `fb_post_page`. Mode API dùng Graph API trong block `fb_page_post_api`; mode UI dùng các block nhỏ lấy identity gốc → switch page → `fb_post_current_identity_ui` → restore profile, không dùng lại block wrapper tổng.

`extraSettings.rewriteContentEachRun` được scheduler truyền vào `vars`; các block DB nhập nội dung chính (`fb_type_post_content`/`fb_send_message`/`fb_share_post`/`fb_post_reels`) tự cá nhân hoá token rồi gọi akaApp AI bằng `page.apiCall`, nếu AI lỗi thì dùng nội dung gốc đã cá nhân hoá.
`extraSettings.rewriteCommentContentEachRun` áp dụng riêng cho 2 campaign comment seeding; `fb_comment_at_position` và `fb_comment_current_post` rewrite nội dung comment ngay trước khi nhập, lỗi AI thì fallback comment gốc.

`facebook_message_friend` là message-only tới bạn bè/contact, luôn chạy `enableMessage=true` + `enableAddFriend=false` và count `fb_message_friend`. `facebook_message_uid` ([migration_v34_message_uid_campaign.sql](migrations/migration_v34_message_uid_campaign.sql)) dùng workflow riêng cho UID, count nhắn tin là `fb_message_stranger`, kết bạn là `fb_add_friend`. `useSuggestedFriends=true` chạy nhánh preflight `collectSuggestedFriendsOnly` trong chính workflow UID bằng block `fb_collect_suggested_friends` ([migration_v35_suggested_friends_uid.sql](migrations/migration_v35_suggested_friends_uid.sql), [migration_v36_message_uid_suggested_friends_preflight.sql](migrations/migration_v36_message_uid_suggested_friends_preflight.sql)) chỉ khi campaign chưa có `auto_campaign_input_data`, scheduler insert profile đề xuất rồi mới chạy UID workflow theo từng row; source/số lượng chỉ cấu hình lúc tạo campaign.

For `facebook_comment_seeding` (group/page/profile feed), `buildVariablesV2()` must provide `targetUrl`, `postsPerTarget`, `enablePostLike`, `keywordFilter`, and `commentVariants` from campaign `extra_settings`/input_data because the DB workflow depends on those vars. Keyword matching reads post text via find-data elements `fb_post_in_uid` + `fb_content_in_post_in_uid` ([migration_v14_comment_seeding_find_data_content.sql](migrations/migration_v14_comment_seeding_find_data_content.sql)). `facebook_comment_seeding_post` uses its own post-link workflow/blocks (`fb_prepare_post_link_comment_iteration`, `fb_click_like_current_post`, `fb_comment_current_post`) and does not reuse `fb_comment_at_position` ([migration_v23_comment_seeding_post_workflow.sql](migrations/migration_v23_comment_seeding_post_workflow.sql)).
Comment seeding rate-limit/action detail label is `"Comment"`; feed logs say `"bài đầu tiên"`/`"bài thứ N"`, post-link logs say `"bài post"`, while raw position/iteration stays in JSONB `data`.

For `facebook_find_data_group`, workflow/blocks/elements/action are seeded by [migration_v8_find_data_group.sql](migrations/migration_v8_find_data_group.sql); [migration_v9_find_data_extract_patterns.sql](migrations/migration_v9_find_data_extract_patterns.sql) tightens phone/Zalo regex in the extractor blocks; [migration_v24_find_data_post_links.sql](migrations/migration_v24_find_data_post_links.sql) adds `RawPostLinkInUid`/`PostLinkInUid` extraction via `FocusEvent('focusin')`; [migration_v25_find_data_post_links_ignore_comments.sql](migrations/migration_v25_find_data_post_links_ignore_comments.sql) rejects `comment_id`/`reply_comment_id` permalinks; [migration_v26_find_data_clean_post_links.sql](migrations/migration_v26_find_data_clean_post_links.sql) strips FB tracking params before returning postLinks; [migration_v47_find_data_group_members.sql](migrations/migration_v47_find_data_group_members.sql) adds the group-members source and only stores members with both UID and name; [migration_v48_find_data_source_counts.sql](migrations/migration_v48_find_data_source_counts.sql) adds per-source counts for post/comment/member data; [migration_v51_find_data_new_interactors.sql](migrations/migration_v51_find_data_new_interactors.sql) adds the UID-only `isFindNewInteractors` source; [migration_v52_normalize_new_interactors_sort.sql](migrations/migration_v52_normalize_new_interactors_sort.sql) normalizes saved sort data to `recent_activity/newest`; [migration_v53_find_data_new_interactors_uid_only_collect.sql](migrations/migration_v53_find_data_new_interactors_uid_only_collect.sql) keeps new-interactors-only post scan UID-only; [migration_v54_find_data_filter_new_interactor_user_uids.sql](migrations/migration_v54_find_data_filter_new_interactor_user_uids.sql) filters permalink/post IDs from post/comment UID extraction; [migration_v55_remove_new_interactors_debug_marker.sql](migrations/migration_v55_remove_new_interactors_debug_marker.sql) removes the temporary UID-only scan marker. `logMilestonesV2()` writes one `"Tìm data"` detail row with phones/Zalo links/UIDs/postLinks plus `groupMembers` and `sourceCounts` in JSONB `data`; `isFindByContentAI/contentAI` are UI-stored only until the AI block is implemented. `findUidTargetCampaignIds` fans UIDs into `facebook_message_uid`, `findPostLinkTargetCampaignIds` fans post links into `facebook_comment_seeding_post`, akaBiz API targets (`findPhoneSmsTargetCampaignIds`/`findPhoneZaloWebTargetCampaignIds`/`findZaloGroupLinkWebTargetCampaignIds`) push through [akaBizApiClient.ts](src/main/services/akaBizApiClient.ts), and akaBiz Desktop targets (`findPhoneAkaBizDesktopTargetCampaignIds`/`findZaloGroupLinkAkaBizDesktopTargetCampaignIds`) write SQLite via [akaBizDesktopSqliteClient.ts](src/main/services/akaBizDesktopSqliteClient.ts). All find-data fan-out dedupes against prior `"Tìm data"` JSONB in the source campaign (not target campaigns); completed internal/Zalo Web/Desktop target campaigns flip back to `'chờ xử lý'`, while SMS does not status-check.
Relations between find-data source campaigns and internal target campaigns are editable from both forms, but the DB source of truth stays on the source campaign `extra_settings` arrays (`findUidTargetCampaignIds` / `findPostLinkTargetCampaignIds`). Target campaigns with at least one selected find-data source may have no manual `auto_campaign_input_data`; scheduler leaves them in `chờ xử lý` with note `"Đang chờ data từ chiến dịch tìm data"` and does not write a campaign log for that wait state.

**Recovery**: `resetRunningStatuses(staffId)` staff-scoped chạy sau login, trước logout và trước app quit (accounts + campaigns + campaign_inputs + campaign_input_data) — flip rows kẹt `'đang chạy'` về `'chờ xử lý'` (đề phòng crash mid-flow), không chạy global trước login. `recoverStuckCampaignInputData(campaignId, errMsg)` flip input_data stuck thành `'hoàn thành'` + `note=errMsg` khi outer catch (enum không có `'lỗi'`). `stop()` cũng đóng toàn bộ hidden background pages để không giữ tài nguyên nền.

**Schedule maintenance**: sau scoped recovery lúc login, `maintainCampaignSchedules()` ([campaignRepository.ts](src/main/data/repositories/campaignRepository.ts)) dọn campaign stale theo ngày `Asia/Ho_Chi_Minh`; day-change watcher trong [handlers.ts](src/main/ipc/handlers.ts) gọi lại khi app treo qua đêm. Weekly/monthly `refreshData=true` reset `auto_campaign_input_data` rồi bật lại `chờ xử lý`; completed no-refresh chỉ update `schedule`.

**Rate limit** ([campaignRepository.ts:getAccountRateLimitStatus](src/main/data/repositories/campaignRepository.ts)) dùng `action_code`:
- Daily limit so với `auto_account_action_status.count_action_in_day` (reset 00:00 Asia/Saigon).
- Hourly limit query `auto_campaign_details` theo `(account_id, action_code, created_at)` với `status IN ('thành công','thất bại')`.
- ActionManagerModal stores candidate checks in `auto_campaign_actions.limit_check_action_codes`; Campaign form does not expose per-campaign "Check giới hạn" toggles, but auto-saves visible checks to `extra_settings.actionLimits.enabledActionCodes` for scheduler compatibility.
- Campaign form stores thresholds in `extra_settings.actionLimits.byActionCode[action_code]`; `rateLimitMinutes` is copied from `auto_accounts.rate_limit_minutes` per account when saving, fallback `65`; scheduler also filters out checks for campaign actions disabled by toggles such as `enableAddFriend=false`.
- Limit notes/logs must include the exact action name; `auto_error` messages may use `[a]`/`[action]` and `[action_code]` placeholders.
- Khi hit limit/disable action: campaign về `'chờ xử lý'`, ghi `note`; KHÔNG đổi schedule.

### Data layer

[src/main/data/repositories/](src/main/data/repositories/) — mỗi entity 1 file. Pattern:
- `client = () => getSupabaseClient()` ([supabaseClient.ts](src/main/data/supabaseClient.ts))
- `requireCurrentUser()` ([currentUser.ts](src/main/data/currentUser.ts)) ném lỗi nếu chưa login → block IPC handler
- `mapXxxFromDB(row)` trong [mappers.ts](src/main/data/mappers.ts) chuyển snake_case → camelCase
- Built-in records live in Supabase DB (`auto_blocks`, `auto_workflows`, `auto_elements`) and DB is the source of truth. There is no `seedV2` runtime/source fallback; update built-ins via admin UI/IPC or explicit SQL migration.
- `org_staff.akabiz_integrations` stores current-staff external akaBiz connections (`sms`/`zaloWeb` plus `akaBizDesktop` with `installPath`/`dbPath`); use [staffIntegrationRepository.ts](src/main/data/repositories/staffIntegrationRepository.ts), not renderer local storage.
- Auth login khóa `org_staff` theo 1 máy qua `device_fingerprint_hash` (SHA-256 platform + OS machine ID) trong [authRepository.ts](src/main/data/repositories/authRepository.ts) + [deviceIdentity.ts](src/main/services/deviceIdentity.ts). Login options local: `Ghi nhớ` chỉ prefill, `Tự động` mới auto-login, `AUTH_RESET_DEVICE_LOCK` xoá local auto-login; startup dùng Electron login item IPC trong [handlers.ts](src/main/ipc/handlers.ts).

Migration pattern: write SQL files under `migrations/` (`migrations/migration.sql` for base schema, keep versioned files as `migrations/migration_vN_*.sql`, e.g. `migrations/migration_v2_workflow.sql`, `migrations/migration_v3_campaign_data.sql`, `migrations/migration_v6_rename_campaign_workflow_tables.sql`, `migrations/migration_v34_message_uid_campaign.sql`). Apply via `mcp__supabase__apply_migration`. Use idempotent UPSERT by UNIQUE name for engine v2 or explicit IDs where appropriate.

### Vietnamese UI conventions

Status values trong DB lưu **tiếng Việt có dấu**:
- Campaign: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'tạm dừng'` (KHÔNG có `'lỗi'` trong runtime hiện tại)
- campaign_inputs: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'lỗi'`, `'tạm dừng'`
- campaign_input_data: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'tạm dừng'` (KHÔNG có `'lỗi'`)
- campaign_details: `'thành công'`, `'thất bại'`, `'lỗi'`
- Login status: `'đã đăng nhập'`, `'chưa đăng nhập'`, `'checkpoint'`

**Customer-facing log language** (rất quan trọng — log từ `sendLog()` và `auto_campaign_details.log` đều khách hàng đọc):
- Viết tiếng Việt tự nhiên: `"Đã comment vào bài thứ 3: ..."`, `"Đăng bài thành công vào ..."`, `"Bài đang chờ duyệt"`
- TRÁNH: `"Đã log X"`, `"lần X/Y"`, `"vị trí #N"`, ID strings, stacktraces, `"position"`, `"iteration"`, `"campaign_detail"` lộ ra UI
- Technical metadata (`commentPosition`, `iteration`, `commentType`) → JSONB `data` column, KHÔNG vào `log` string
- Progress log theo campaign dùng `CampaignScheduler.logCampaignProgress()` để vừa append vào `auto_campaigns.log`, vừa bắn panel phải "Tiến trình", vừa broadcast campaign updated; UI đọc `auto_campaigns.log` ở tab "Lịch sử chạy".
- **Log order**: action milestone trước (📝 Đăng bài), rồi metadata (⏳ Chờ duyệt), rồi link/artifact (🔗), milestones tiếp theo (💬), cuối cùng summary (✅/❌)
- Emoji vocab thống nhất: 📝 Đăng bài • 💬 Comment/Nhắn tin • 🔗 Link • ⏳ Chờ duyệt • ✅ Hoàn thành • ❌ Lỗi • 👋 Rời nhóm • 🤝 Kết bạn/Tham gia • 🔀 Shuffle/Share • ⚠️ Cảnh báo • ℹ️ Info • 🎬 Reels

**Per-milestone logging**: post xong ghi 1 row, mỗi comment ghi 1 row, friend request ghi 1 row — KHÔNG đợi cuối flow. Lý do: nếu comment failed sau khi post OK, vẫn phải có row "Đăng bài thành công" để khách hàng thấy.

### IPC pattern

[src/main/ipc/handlers.ts](src/main/ipc/handlers.ts) gom các nhóm trong `handlers/` directory:
- `authHandlers` (login/logout/me)
- `campaignHandlers` (CRUD campaign + scheduler control)
- `browserHandlers` ([handlers/browserHandlers.ts](src/main/ipc/handlers/browserHandlers.ts)) — webview register/unregister/status. Khi register cũng register vào cả `WebviewRegistry` (cho contactLoader / scheduler `isRegistered` check) lẫn `PageControllerRegistry` (editor/test runs dùng visible webview)
- `accountHandlers` / `accountContactHandlers` / `updateHandlers`
  - `DB_LIST_ACCOUNT_ACTIONS` returns active `auto_account_actions`; `ACCOUNT_ACTION_OVERVIEW` returns `auto_account_actions` + `auto_account_action_status` for account modals ([accountActionRepository.ts](src/main/data/repositories/accountActionRepository.ts)).
- `aiHandlers` ([handlers/aiHandlers.ts](src/main/ipc/handlers/aiHandlers.ts)) — gọi akaApp AI để viết lại/tạo nhiều biến thể nội dung form; payload không truyền `shopId`.
- `akaBizIntegrationHandlers` ([handlers/akaBizIntegrationHandlers.ts](src/main/ipc/handlers/akaBizIntegrationHandlers.ts)) — Cài đặt chung: lookup/save tích hợp SMS/Zalo Web/Desktop, chọn folder Desktop, list external campaigns; API list item phải enrich `status`, Desktop list đọc SQLite local.
- `v2Handlers` ([handlers/v2Handlers.ts](src/main/ipc/handlers/v2Handlers.ts)) — engine v2: BLOCK_LIST/SAVE/DELETE, WORKFLOW_LIST/GET/SAVE/DELETE, ELEMENT_LIST/SAVE/DELETE, WORKFLOW_TEST_RUN, BLOCK_TEST_RUN, RUN_STOP, RUN_PROGRESS broadcast, RUN_LOG broadcast

Mỗi handler `ipcMain.handle(eventName, fn)` → method tương ứng repository/service. Renderer gọi qua `electronAPI.xxx()` ([preload/index.ts](src/preload/index.ts), typed trong [electron.d.ts](src/renderer/src/types/electron.d.ts)).

### Auto-update

[src/main/services/updater.ts](src/main/services/updater.ts) đọc local version từ `resources/version.txt` (dev fallback `version.txt`/`app.getVersion()`) và chọn remote theo platform: Windows `version_win.txt`/`akaAgent.exe`, macOS `version_mac.txt`/`akaAgent.dmg`. Version phải dùng format `x.x.x`; compare numeric theo major/minor/patch.

### Renderer state (Zustand stores)

[src/renderer/src/stores/](src/renderer/src/stores/):
- `authStore` — current user, login/logout
- `campaignStore` — accounts (runtime `accounts` alias), campaigns, action templates, log realtime broadcast
- `blockLibraryStore` / `elementLibraryStore` / `workflowV2Store` — engine v2 editor state
- `themeStore` / `uiStore` — UI prefs

### Workflow Editor v2 UI

[src/renderer/src/components/v2/](src/renderer/src/components/v2/) — staff-root only (button "Cài đặt Workflow" trong TopBar khi `user.staffId === 1`):
- Campaign action manager ("Quản lý Hành động") cũng chỉ render khi `user.staffId === 1`.
- `WorkflowEditorV2.tsx` — container layout 4 vùng (BlockLibrary | Canvas+Test | ConfigPanel)
- `BlockLibraryPanel.tsx` — sidebar trái, drag block vào canvas, tabs Built-in/Custom/System
- `WorkflowCanvasV2.tsx` — `useNodesState`/`useEdgesState` (LOCAL state, sync ngược store chỉ ở user actions để tránh infinite render từ dimension changes)
- `BlockInstanceNode.tsx` — custom xyflow node, ifElse có 2 outputs (true/false), loop có `body`/`done`
- `ConfigPanelV2.tsx` — form theo `block.configSchema` + nút "Sửa code (Monaco)"
- `CodeEditorDrawer.tsx` — Monaco với TS extra-lib từ [lib/blockApiTypes.ts](src/renderer/src/lib/blockApiTypes.ts) cho intellisense `page.*`/`helpers.*`/`vars`
- `TestPanelV2.tsx` — chọn account webview → Test workflow / Test block → realtime log + per-step status
- `BlockCrudModal.tsx` + `ElementCrudModal.tsx` — quản lý block library / XPath elements

App.tsx **conditional render** workflow editor (KHÔNG `display: none`) để ReactFlow đo container đúng — nếu hidden khi mount, ReactFlow render 0×0 và nodes invisible.

## Default branch

PR target branch là `dev_3` (replaces `dev_2` như memory `default_branch.md`). Repo URL: `https://github.com/aligoinc/akaAgent.git` (đã chuyển từ `lequangnhut27/akaBizAutoNew`).
Trước khi bắt đầu task mới trong repo này, sync code từ remote về `dev_3` (`git fetch origin` rồi fast-forward/rebase phù hợp) để làm trên nền mới nhất.

## Common pitfalls

- **Loop iterations**: scheduler `logMilestonesV2` đọc `result.steps` từ engine. Engine v2 maintain `allSteps[]` (mỗi loop iteration 1 row riêng) thay vì snapshot `nodeStates`. Khi đọc per-iteration data, đọc `s.output` (block return value), KHÔNG `s.input` (chỉ là config + parents trực tiếp).
- **Skipped action steps**: `logMilestonesV2` must ignore `status='skipped'` action blocks. Optional workflow branches (e.g. `enableAddFriend=false`) still return snapshot steps, but they are not real user actions.
- **Comment seeding keyword miss**: `fb_prepare_seeding_iterations` có thể trả `commentIterations=[]`; loop body chỉ chạy bên trong loop executor, keyword/text phải normalize bỏ dấu + whitespace, và text bài phải lấy bằng `fb_post_in_uid` + `fb_content_in_post_in_uid` thay vì raw `[role=article]` ([migration_v14_comment_seeding_find_data_content.sql](migrations/migration_v14_comment_seeding_find_data_content.sql)).
- **Comment image-only logs**: `fb_comment_at_position` có thể return `text=''` nhưng `imageCount>0`; `logMilestonesV2()` vẫn phải tạo row Comment, không skip theo text rỗng ([campaignScheduler.ts](src/main/services/campaignScheduler.ts), [migration_v18_comment_images.sql](migrations/migration_v18_comment_images.sql)).
- **Output cascade**: engine v2 KHÔNG có inputMapping — output của parent merge vào input của child theo edges, last-write-wins. Output `scrapedText` của block ở xa KHÔNG cascade qua chain — nếu cần dùng ở downstream chain dài, **mutate `vars`** thay vì rely on input merging.
- **XPath union `|`**: timeline page và group page dùng selector khác nhau. Element store XPath với `|` để match cả hai. `document.evaluate` (XPath 1.0) hỗ trợ union, trả node đầu tiên match.
- **`auto_runs.workflow_id` column**: tên cột là `workflow_id` nhưng FK → `auto_workflows.id` (BIGINT). Đừng nhầm với cột `workflow_id` (UUID) đã drop ở migration_v4 thuộc `auto_campaign_actions`.
- **timeSleepBetween2** vs **actionLimits.sleepBetweenActions**: scheduler ưu tiên `actionLimits.sleepBetweenActions`, fallback `campaign.timeSleepBetween2`. Cả 2 tính bằng giây; `0` là giá trị hợp lệ cho campaign up tin nên scheduler/repository phải dùng `??`, không dùng `||`.
- **Schedule edit** (`scheduleEndDate`): cột nullable, type `string | null | undefined`. Pass `null` (không phải `undefined`) để clear — `updateCampaign`'s `!== undefined` check sẽ skip undefined. Cho `scheduleType='daily'`, luôn gửi `null` (form date input disabled nhưng formData vẫn giữ default 7-day-ahead, sẽ silently stop campaign sau 1 tuần).
- **Hidden vs disabled toggle** (`sharePost` pattern): feature có DB flag nhưng chưa implement → ẨN khỏi UI (don't render checkbox), giữ flag trong `formData` + `handleSave` payload (preserve roundtrip), backend log warning per run. KHÔNG `<input disabled>` (leak feature name).
- **Minimized campaign runs**: scheduler chạy campaign bằng hidden/offscreen `BackgroundPageManager`; visible webview có thể không paint khi minimized/hidden nên chỉ dùng cho login/test/manual. BrowserPage quan sát qua preview stream.
- **Minimized data scans**: `ContactLoader` cũng chạy bằng hidden/offscreen `BackgroundPageManager` + workflow v2 built-in. Không đưa logic scrape mới về visible webview; nếu cần đổi selector/logic quét thì seed/update `auto_blocks`/`auto_workflows` bằng migration.
- **FB image upload**: `page.dropFile()` must avoid viewport coordinates in hidden/offscreen pages; `fileCount` only means files were injected, not that FB rendered an attachment preview ([pageController.ts](src/main/v2/runtime/pageController.ts)). Comment-image workflows support exactly 1 image/comment; `fb_comment_at_position` drops into the dialog textbox after clicking the indexed comment box.
- **Comment dialog textbox**: `fb_comment_at_position` clicks `fb_comment_box_at_n` to open/focus the target post composer, then types/drops into `fb_comment_dialog_textbox` from `auto_elements` ([migration_v32_comment_dialog_textbox_element.sql](migrations/migration_v32_comment_dialog_textbox_element.sql)).
- **Direct post comment seeding**: `fb_comment_current_post` uses `fb_comment_dialog_textbox` from `auto_elements` for type/drop/focus; do not tag DOM nodes with `data-akabiz-current-post-comment-box` or click the main “Bình luận/Comment” action button ([migration_v33_comment_current_post_use_dialog_element.sql](migrations/migration_v33_comment_current_post_use_dialog_element.sql)).
- **Find-data post links**: `PostLinkInUid` can also see comment permalinks under a post. Reject `comment_id`/`reply_comment_id` before pushing links into `facebook_comment_seeding_post` ([migration_v25_find_data_post_links_ignore_comments.sql](migrations/migration_v25_find_data_post_links_ignore_comments.sql)).
- **Find-data fan-out dedupe**: UID/post link/phone/Zalo group link dedupe against the source campaign's `"Tìm data"` detail JSONB before push; do not query target campaign/external detail for dedupe unless product changes this rule.
- **akaBiz Desktop SQLite**: user selects install folder, DB path is `<installPath>/Resources2/akabiz_auto_local.db`; phone campaign actions are `zalo_addfriend`/`zalo_send_to_phone`, group-link action is `zalo_join_group_link`, inserts write `Phone` or `Uid` only with `Status=1` and `IsAutomate=1` (no `SortOrder`, no `GroupUserId`).
- **Message template tokens**: `#{FULL_NAME}` is resolved inside `fb_send_message` after Messenger opens via `//*[contains(@class,'xxymvpz x1dyh7pn')]`; if missing, replace with `''`. Date tokens use `#{TODAY|TOMORROW|YESTERDAY(DD/MM/YYYY|MM/DD/YYYY)}` ([migration_v28_message_template_tokens.sql](migrations/migration_v28_message_template_tokens.sql)).
- **Electron navigation errors**: hidden page preload can be superseded by workflow `page.navigate()`; `src/main/v2/runtime/pageController.ts` treats `ERR_ABORTED`/`-3` as non-fatal. Facebook `ERR_FAILED (-2)` is only retried when `will-prevent-unload` fires, because that means a draft/form beforeunload prompt blocked automation navigation.
- **Emojis trong source files**: KHÔNG viết emoji vào TS/TSX trừ khi user yêu cầu. Emoji trong **log strings** (`📝`/`✅`/`❌`/...) là customer-facing vocabulary đã agreed, được expected trong `sendLog`/`appendCampaignLog`/block code.

## Maintenance — keep this file fresh

Khi xong 1 task **non-trivial** mà có 1 trong các thay đổi sau, update AGENTS.md trước khi end turn:

- Thêm/sửa table Supabase, IPC account, system block, status enum value
- Thêm/sửa repository, service, runtime module
- Đổi convention log/UI tiếng Việt, emoji vocab, status string
- Đổi command build/dev (npm scripts, tsconfig)
- Phát hiện common pitfall mới (xếp vào "Common pitfalls")
- Đổi default branch hoặc repo URL

KHÔNG update khi:
- Bug fix nhỏ không introduce pattern mới
- UI tweak, CSS, copy text changes
- Refactor đơn thuần không đổi public interface

Pattern: chỉnh tại đúng section, giữ entry **terse** (1-2 dòng), link `file:line` thay vì paraphrase code. Nếu plan-mode tạo file lớn → reference plan file thay vì duplicate.
