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

[src/main/playwright/webviewController.ts](src/main/playwright/webviewController.ts) — thin wrapper exposing `isConnected()` + `getURL()` cho `webContents` của Electron `<webview>` đã embed cho từng tài khoản FB. Visible webviews vẫn dùng cho login, status checks, contact loader và test thủ công trong editor.

`WebviewRegistry` maps `accountId -> webContentsId`. Scheduler uses `isRegistered()` to ensure the account has mounted a browser tab at least once; accountPoller uses `listRegistered()` to skip dead tabs. Runtime uses `accountId` and partition `persist:account_${accountId}`; browser profiles from the previous partition prefix are not reused.
ContactLoader là utility ngoài workflow, scrape friend/group từ visible webview vào `auto_account_contacts`; mỗi lần load là snapshot theo `(account_id, contact_type)`: contact còn thấy thì upsert `is_delete=false`, contact cũ không còn thấy thì set `is_delete=true`. Khi chọn vào campaign, picker lưu FB URL vào `auto_campaign_input_data.uid` để workflow nhận raw target chính xác. Group activity text lưu ở `auto_account_contacts.extra_data.lastActivityText`, không ghép vào `name`.

Campaign automation chạy qua [src/main/v2/runtime/backgroundPageManager.ts](src/main/v2/runtime/backgroundPageManager.ts) hidden/offscreen `BrowserWindow` theo từng account để minimized vẫn render ổn định. Renderer không tự chuyển page/focus; BrowserPage chọn sẵn account bằng `campaign:browser-select` và hiển thị preview stream bằng `campaign:browser-preview` để user tự vào quan sát. Test/editor vẫn dùng `PageControllerRegistry` của webview visible.

Convention quan trọng (xem memory `campaign_conventions.md`):
- **Atomic blocks**: tuyệt đối KHÔNG tạo "do-many-things" block. Compose existing primitives (`page.click`/`page.type`/`page.waitForSelector`/...).
- **KHÔNG dùng tọa độ viewport** — webview có thể không focus, `getBoundingClientRect()` clientX/clientY có thể sai. Dispatch synthetic event với `{bubbles, cancelable, view: window}` (no coords).
- **FB timestamp link** lazy-load qua `FocusEvent('focusin')`, không phải hover.

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
- `auto_accounts` — tài khoản/social profile để login và chạy automation (trước đây là `org_accounts`)
- `auto_account_contacts` — danh bạ friend/group theo account (trước đây là `org_account_contacts`)
- `auto_campaigns` — campaign config (action_id, account_id, schedule, content, extra_settings)
- `auto_campaign_actions` — template loại campaign (`facebook_group_post`/`facebook_timeline_post`/`facebook_message_friend`/`facebook_find_data_group`/`facebook_comment_seeding`/`facebook_comment_seeding_post`); column `workflow_id` (BIGINT, FK auto_workflows.id) là pointer duy nhất tới workflow.
  - `limit_check_action_codes text[]` controls which `auto_account_actions.code` values scheduler checks for rate limit/disable before running this campaign action.
- `auto_account_actions` — định nghĩa action theo account (`fb_post_group`/`fb_comment`/`fb_message_friend`/...). Limit/error policy dùng `code`, KHÔNG dùng `auto_campaign_actions.id`.
- `auto_account_action_status` — counter + trạng thái disable theo `(account_id, action_code)`: `count_action_in_day`, `is_disable`, `date_enable`; Supabase cron reset/ngày và enable action quá hạn.
- `auto_error` + `auto_account_error_state` — policy lỗi chuẩn hoá + bộ đếm lỗi liên tục. Lỗi chưa định nghĩa quy về `err_undefined`.
- Error policy DB mutations (update campaign/account/action status) chạy ở scheduler/service layer; workflow blocks chỉ nên phát hiện/chuẩn hoá lỗi, không tự update Supabase.
- `auto_campaign_inputs` — pool nguyên liệu thô (e.g. danh sách group để scrape members → sinh input_data). Status: `'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành' | 'lỗi'` (`'lỗi'` flag input không scrape được; admin re-trigger).
- `auto_campaign_input_data` — **việc-cần-làm thực thi** (mỗi target/profile/group = 1 row). Status: `'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành'` (KHÔNG có `'lỗi'` — lỗi action-level đã track ở campaign_details; khi run fail set `'hoàn thành' + note=errMsg`). Cột `input_id BIGINT NULL` FK → `auto_campaign_inputs.id` (nếu sinh từ scrape; NULL nếu user nhập tay).
- `auto_campaign_details` — **customer-visible "Lịch sử hành động"**: mỗi milestone (post, từng comment, friend request, message) ghi 1 row riêng. Status: `'thành công' | 'thất bại' | 'lỗi'` (thành công = OK; thất bại = nghiệp vụ FB từ chối; lỗi = exception/crash code). FK `input_data_id` (nullable cho simple campaign không có input_data).
  - `action_code` gắn tới `auto_account_actions.code`; khi detail status `thành công/thất bại`, repository tăng `auto_account_action_status.count_action_in_day`.
  - `error_code` gắn tới `auto_error.error_code` khi detail ghi lỗi chuẩn hoá.

[CampaignScheduler](src/main/services/campaignScheduler.ts) — `setInterval(tick, 30s)`:
1. Lấy accounts + campaigns đến giờ
2. Lookup action.workflow_id → `executeCampaignV2`
3. Mỗi input_data row lấy hidden/offscreen `PageController` từ `BackgroundPageManager`, run workflow, rồi log per-milestone vào `auto_campaign_details` qua `logMilestonesV2` (scan `result.steps` theo `block_name`: `fb_click_post_button` → "Đăng bài", `fb_comment_at_position`/`fb_comment_current_post` → "Comment", `fb_send_message` → "Nhắn tin", `fb_add_friend` → "Kết bạn"). Status mapping: `step.status==='error'` → `'lỗi'`; `output.ok===false` không exception → `'thất bại'`; còn lại → `'thành công'`.
4. Sleep `extra.actionLimits.sleepBetweenActions` giây giữa input_data rows

For `facebook_comment_seeding` (group/page/profile feed), `buildVariablesV2()` must provide `targetUrl`, `postsPerTarget`, `enablePostLike`, `keywordFilter`, and `commentVariants` from campaign `extra_settings`/input_data because the DB workflow depends on those vars. Keyword matching reads post text via find-data elements `fb_post_in_uid` + `fb_content_in_post_in_uid` ([migration_v14_comment_seeding_find_data_content.sql](migration_v14_comment_seeding_find_data_content.sql)). `facebook_comment_seeding_post` uses its own post-link workflow/blocks (`fb_prepare_post_link_comment_iteration`, `fb_click_like_current_post`, `fb_comment_current_post`) and does not reuse `fb_comment_at_position` ([migration_v23_comment_seeding_post_workflow.sql](migration_v23_comment_seeding_post_workflow.sql)).
Comment seeding rate-limit/action detail label is `"Comment"`; feed logs say `"bài đầu tiên"`/`"bài thứ N"`, post-link logs say `"bài post"`, while raw position/iteration stays in JSONB `data`.

For `facebook_find_data_group`, workflow/blocks/elements/action are seeded by [migration_v8_find_data_group.sql](migration_v8_find_data_group.sql); [migration_v9_find_data_extract_patterns.sql](migration_v9_find_data_extract_patterns.sql) tightens phone/Zalo regex in the extractor blocks. `logMilestonesV2()` writes one `"Tìm data"` detail row with phones/Zalo links/UIDs in JSONB `data`; `isFindByContentAI/contentAI` are UI-stored only until the AI block is implemented. `findUidTargetCampaignIds` fans found UIDs into selected `facebook_message_friend` campaigns, dedupes by `uid`, and flips completed target campaigns back to `'chờ xử lý'`.

**Recovery**: `resetRunningStatuses()` chạy lúc app start (accounts + campaigns + campaign_inputs + campaign_input_data) — flip rows kẹt `'đang chạy'` về `'chờ xử lý'` (đề phòng crash mid-flow). `recoverStuckCampaignInputData(campaignId, errMsg)` flip input_data stuck thành `'hoàn thành'` + `note=errMsg` khi outer catch (enum không có `'lỗi'`). `stop()` cũng đóng toàn bộ hidden background pages để không giữ tài nguyên nền.

**Schedule maintenance**: sau startup reset và sau login, `maintainCampaignSchedules()` ([campaignRepository.ts](src/main/data/repositories/campaignRepository.ts)) dọn campaign stale theo ngày `Asia/Ho_Chi_Minh`; day-change watcher trong [handlers.ts](src/main/ipc/handlers.ts) gọi lại khi app treo qua đêm. Weekly/monthly `refreshData=true` reset `auto_campaign_input_data` rồi bật lại `chờ xử lý`; completed no-refresh chỉ update `schedule`.

**Rate limit** ([campaignRepository.ts:getAccountRateLimitStatus](src/main/data/repositories/campaignRepository.ts)) dùng `action_code`:
- Daily limit so với `auto_account_action_status.count_action_in_day` (reset 00:00 Asia/Saigon).
- Hourly limit query `auto_campaign_details` theo `(account_id, action_code, created_at)` với `status IN ('thành công','thất bại')`.
- Campaign form stores enabled per-campaign limit checks in `extra_settings.actionLimits.enabledActionCodes` and thresholds in `extra_settings.actionLimits.byActionCode[action_code]`; scheduler also filters out checks for campaign actions disabled by toggles such as `enableAddFriend=false`.
- Limit notes/logs must include the exact action name; `auto_error` messages may use `[a]`/`[action]` and `[action_code]` placeholders.
- Khi hit limit/disable action: campaign về `'chờ xử lý'`, ghi `note`; KHÔNG đổi schedule.

### Data layer

[src/main/data/repositories/](src/main/data/repositories/) — mỗi entity 1 file. Pattern:
- `client = () => getSupabaseClient()` ([supabaseClient.ts](src/main/data/supabaseClient.ts))
- `requireCurrentUser()` ([currentUser.ts](src/main/data/currentUser.ts)) ném lỗi nếu chưa login → block IPC handler
- `mapXxxFromDB(row)` trong [mappers.ts](src/main/data/mappers.ts) chuyển snake_case → camelCase
- Built-in records live in Supabase DB (`auto_blocks`, `auto_workflows`, `auto_elements`) and DB is the source of truth. There is no `seedV2` runtime/source fallback; update built-ins via admin UI/IPC or explicit SQL migration.

Migration pattern: write SQL files at repo root (`migration.sql` for base schema, `migration_v2_workflow.sql` for v2, `migration_v3_campaign_data.sql` for data refactor, `migration_v4_drop_engine_v1.sql` for v1 cleanup, `migration_v5_*` for account schema rename, `migration_v6_rename_campaign_workflow_tables.sql` for final table/key names, `migration_v7_*` for package account-limit names, `migration_v11_*`/`migration_v12_*` for contact upsert key repair, `migration_v13_*` for comment seeding keyword matching, `migration_v15_account_action_limits_errors.sql` for account action/error policy, `migration_v16_campaign_action_limit_codes.sql` for campaign-action limit check config, `migration_v17_clean_account_contact_group_names.sql` for cached group-name cleanup, `migration_v18_comment_images.sql` + `migration_v21_comment_single_image_per_comment.sql` for `fb_comment_at_position` image comments, `migration_v22_comment_seeding_post_links.sql` for the post-link comment seeding action, `migration_v23_comment_seeding_post_workflow.sql` for the dedicated post-link workflow). Apply via `mcp__supabase__apply_migration`. Use idempotent UPSERT by UNIQUE name for engine v2 or explicit IDs where appropriate.

### Vietnamese UI conventions

Status values trong DB lưu **tiếng Việt có dấu**:
- Campaign / campaign_inputs: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'lỗi'`, `'tạm dừng'`
- campaign_input_data: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'tạm dừng'` (KHÔNG có `'lỗi'`)
- campaign_details: `'thành công'`, `'thất bại'`, `'lỗi'`
- Login status: `'đã đăng nhập'`, `'chưa đăng nhập'`, `'checkpoint'`

**Customer-facing log language** (rất quan trọng — log từ `sendLog()` và `auto_campaign_details.log` đều khách hàng đọc):
- Viết tiếng Việt tự nhiên: `"Đã comment vào bài thứ 3: ..."`, `"Đăng bài thành công vào ..."`, `"Bài đang chờ duyệt"`
- TRÁNH: `"Đã log X"`, `"lần X/Y"`, `"vị trí #N"`, ID strings, stacktraces, `"position"`, `"iteration"`, `"campaign_detail"` lộ ra UI
- Technical metadata (`commentPosition`, `iteration`, `commentType`) → JSONB `data` column, KHÔNG vào `log` string
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
- `v2Handlers` ([handlers/v2Handlers.ts](src/main/ipc/handlers/v2Handlers.ts)) — engine v2: BLOCK_LIST/SAVE/DELETE, WORKFLOW_LIST/GET/SAVE/DELETE, ELEMENT_LIST/SAVE/DELETE, WORKFLOW_TEST_RUN, BLOCK_TEST_RUN, RUN_STOP, RUN_PROGRESS broadcast, RUN_LOG broadcast

Mỗi handler `ipcMain.handle(eventName, fn)` → method tương ứng repository/service. Renderer gọi qua `electronAPI.xxx()` ([preload/index.ts](src/preload/index.ts), typed trong [electron.d.ts](src/renderer/src/types/electron.d.ts)).

### Auto-update

[src/main/services/updater.ts](src/main/services/updater.ts) đọc local version từ `resources/version.txt` (dev fallback `version.txt`/`app.getVersion()`) và remote từ `version_win.txt`. Version phải dùng format `x.x.x`; compare numeric theo major/minor/patch.

### Renderer state (Zustand stores)

[src/renderer/src/stores/](src/renderer/src/stores/):
- `authStore` — current user, login/logout
- `campaignStore` — accounts (runtime `accounts` alias), campaigns, action templates, log realtime broadcast
- `blockLibraryStore` / `elementLibraryStore` / `workflowV2Store` — engine v2 editor state
- `themeStore` / `uiStore` — UI prefs

### Workflow Editor v2 UI

[src/renderer/src/components/v2/](src/renderer/src/components/v2/) — admin-only (button "Cài đặt Workflow" trong TopBar khi `user.isAdminAkabiz`):
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

## Common pitfalls

- **Loop iterations**: scheduler `logMilestonesV2` đọc `result.steps` từ engine. Engine v2 maintain `allSteps[]` (mỗi loop iteration 1 row riêng) thay vì snapshot `nodeStates`. Khi đọc per-iteration data, đọc `s.output` (block return value), KHÔNG `s.input` (chỉ là config + parents trực tiếp).
- **Skipped action steps**: `logMilestonesV2` must ignore `status='skipped'` action blocks. Optional workflow branches (e.g. `enableAddFriend=false`) still return snapshot steps, but they are not real user actions.
- **Comment seeding keyword miss**: `fb_prepare_seeding_iterations` có thể trả `commentIterations=[]`; loop body chỉ chạy bên trong loop executor, keyword/text phải normalize bỏ dấu + whitespace, và text bài phải lấy bằng `fb_post_in_uid` + `fb_content_in_post_in_uid` thay vì raw `[role=article]` ([migration_v14_comment_seeding_find_data_content.sql](migration_v14_comment_seeding_find_data_content.sql)).
- **Comment image-only logs**: `fb_comment_at_position` có thể return `text=''` nhưng `imageCount>0`; `logMilestonesV2()` vẫn phải tạo row Comment, không skip theo text rỗng ([campaignScheduler.ts](src/main/services/campaignScheduler.ts), [migration_v18_comment_images.sql](migration_v18_comment_images.sql)).
- **Output cascade**: engine v2 KHÔNG có inputMapping — output của parent merge vào input của child theo edges, last-write-wins. Output `scrapedText` của block ở xa KHÔNG cascade qua chain — nếu cần dùng ở downstream chain dài, **mutate `vars`** thay vì rely on input merging.
- **XPath union `|`**: timeline page và group page dùng selector khác nhau. Element store XPath với `|` để match cả hai. `document.evaluate` (XPath 1.0) hỗ trợ union, trả node đầu tiên match.
- **`auto_runs.workflow_id` column**: tên cột là `workflow_id` nhưng FK → `auto_workflows.id` (BIGINT). Đừng nhầm với cột `workflow_id` (UUID) đã drop ở migration_v4 thuộc `auto_campaign_actions`.
- **timeSleepBetween2** vs **actionLimits.sleepBetweenActions**: scheduler ưu tiên `actionLimits.sleepBetweenActions`, fallback `campaign.timeSleepBetween2`. Cả 2 tính bằng giây.
- **Schedule edit** (`scheduleEndDate`): cột nullable, type `string | null | undefined`. Pass `null` (không phải `undefined`) để clear — `updateCampaign`'s `!== undefined` check sẽ skip undefined. Cho `scheduleType='daily'`, luôn gửi `null` (form date input disabled nhưng formData vẫn giữ default 7-day-ahead, sẽ silently stop campaign sau 1 tuần).
- **Hidden vs disabled toggle** (`sharePost` pattern): feature có DB flag nhưng chưa implement → ẨN khỏi UI (don't render checkbox), giữ flag trong `formData` + `handleSave` payload (preserve roundtrip), backend log warning per run. KHÔNG `<input disabled>` (leak feature name).
- **Minimized campaign runs**: scheduler chạy campaign bằng hidden/offscreen `BackgroundPageManager`; visible webview có thể không paint khi minimized/hidden nên chỉ dùng cho login/test/manual. BrowserPage quan sát qua preview stream.
- **FB image upload**: `page.dropFile()` must avoid viewport coordinates in hidden/offscreen pages; `fileCount` only means files were injected, not that FB rendered an attachment preview ([pageController.ts](src/main/v2/runtime/pageController.ts)). Comment-image workflows support exactly 1 image/comment and call `page.dropFile(box, [image])` once ([migration_v21_comment_single_image_per_comment.sql](migration_v21_comment_single_image_per_comment.sql)).
- **Direct post comment seeding**: `fb_comment_current_post` must use the already-open permalink composer, scoped to the visible post dialog and lowest visible comment box; it must not click the main “Bình luận/Comment” action button or scroll to find a different composer before typing, because that can open/focus the wrong post ([migration_v23_comment_seeding_post_workflow.sql](migration_v23_comment_seeding_post_workflow.sql)).
- **Electron `ERR_ABORTED` navigation**: hidden page preload can be superseded by workflow `page.navigate()`; `src/main/v2/runtime/pageController.ts` treats `ERR_ABORTED`/`-3` as non-fatal and later selectors validate page state.
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
