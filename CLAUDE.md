# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**Pre-existing TS errors** trong `src/main/playwright/controller.ts:158-159` (`Cannot find name 'window'`) — bỏ qua, KHÔNG phải lỗi do thay đổi mới. Bất kỳ error mới nào là do code vừa thêm.

Project KHÔNG có test framework / lint config. Verify bằng tsc + manual smoke test.

## Architecture

**Electron 33 + React 19 desktop app** cho automation Facebook (group post / timeline post / message friend / kết bạn). Build qua `electron-vite`. State Zustand. Canvas `@xyflow/react`. DB Supabase. Code editor Monaco.

### 3-layer Electron split (`src/`)

| Layer | Path | Trách nhiệm |
|---|---|---|
| Main process (Node) | [src/main](src/main) | IPC, DB (Supabase), browser controllers, scheduler, updater |
| Preload bridge | [src/preload/index.ts](src/preload/index.ts) | Expose `electronAPI.*` qua `contextBridge` (~50+ methods) |
| Renderer (React) | [src/renderer/src](src/renderer/src) | UI, Zustand stores, xyflow canvas, Monaco editor |
| Shared | [src/shared](src/shared) | Types + IPC channel constants (cả 2 phía import) |

### Hai chế độ điều khiển trình duyệt

Cả hai implement `IBrowserController.executeAction(actionType, input)`:

- **PlaywrightController** ([src/main/playwright/controller.ts](src/main/playwright/controller.ts)) — Chromium độc lập với persistent profile. Dùng cho Workflow Editor v1 (test flow trong dev).
- **WebviewController** ([src/main/playwright/webviewController.ts](src/main/playwright/webviewController.ts)) — inject JS vào `webContents` của Electron `<webview>` đã embed cho từng tài khoản FB. **Đây là controller chạy thật cho campaign** vì giữ session/cookies của user.

Convention quan trọng (xem `userInstructions` từ memory `campaign_conventions.md`):
- **Atomic actions**: tuyệt đối KHÔNG tạo "do-many-things" action. Compose existing primitives (`hover`/`click`/`type`/`waitForSelector`/...).
- **KHÔNG dùng tọa độ viewport** — webview có thể không focus, `getBoundingClientRect()` clientX/clientY có thể sai. Dispatch synthetic event với `{bubbles, cancelable, view: window}` (no coords).
- **FB timestamp link** lazy-load qua `FocusEvent('focusin')`, không phải hover. Action `hover` trong webviewController dispatch `focusin` trước, rồi pointer/mouse.

### Hai engine workflow (chạy song song)

**Engine v1** (legacy — vẫn chạy cho campaigns chưa migrate):
- [src/main/playwright/flowRunner.ts](src/main/playwright/flowRunner.ts) duyệt nodes tuần tự (topological sort)
- Action enum đóng trong [src/shared/actions.ts](src/shared/actions.ts) (~30 actions: navigate/click/type + FB compound như `fbScrapePost`/`fbSharePost`/`fbPostReels`/`fbSendMessage`/`fbAddFriend`/`fbDetectPostPending`)
- inputMapping qua `sourceNodeId`/`sourceField`
- Bảng: `auto_actions`, `auto_flows`, `auto_runs`, `auto_run_steps`, `auto_elements`

**Engine v2** ([src/main/v2/runtime/](src/main/v2/runtime/)) — kiến trúc mới, đã ship qua PR #39:
- `workflowEngine.ts` — DAG executor cohort-based: parallel split (multiple outgoing edges), AND/OR join (mode='all'/'any' merge node), `ifElse` skip propagation, loop body re-exec với `vars.loopItem`/`vars.loopIndex`, `AbortSignal` cancellation. `allSteps[]` track loop iterations để scheduler log đầy đủ (snapshot `nodeStates` chỉ giữ iteration cuối).
- `blockExecutor.ts` — `vm.createContext` sandbox. KHÔNG expose `process`/`require`/`Buffer`/`fs`. Block code = JS string, return object → output, throw → fail.
- `pageController.ts` — wrap `webContents.executeJavaScript` thành API `page.click/type/fill/scroll/evaluate/$$/waitForSelector/uploadFile/dropFile/apiCall/downloadUrl`. Hỗ trợ XPath union `|` và CSS.
- `blockHelpers.ts` — `sleep`/`log`/`randomBetween`/`normalizeFbUrl`/`extractUidFromInput`/`splitVariants`/`cycleVariant`/`element(name)`/`elementWith(name, vars)`. `element` query cached `auto_v2_elements`.
- Bảng: `auto_v2_blocks`, `auto_v2_workflows`, `auto_v2_elements`, `auto_v2_runs`, `auto_v2_run_steps` (BIGSERIAL id, UNIQUE name cho idempotent seed).

[campaignScheduler.ts](src/main/services/campaignScheduler.ts) branch theo `auto_campaign_actions.workflow_v2_id`: nếu set → `executeCampaignV2` (engine v2), ngược lại fallback engine v1.

### Campaign system

Domain (kể từ migration_v3 — 2 bảng cũ `auto_campaign_details` + `auto_campaign_detail_actions` còn để client cũ ngoài prod chạy được, code mới KHÔNG đụng):
- `auto_campaigns` — campaign config (action_id, channel_id, schedule, content, extra_settings)
- `auto_campaign_actions` — template loại campaign (`facebook_group_post`/`facebook_timeline_post`/`facebook_message_friend`); column `workflow_id` (UUID, engine v1) + `workflow_v2_id` (BIGINT, engine v2)
- `auto_campaign_data_inputs` — pool nguyên liệu thô (e.g. danh sách group để scrape members → sinh data_actions). Status: `'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành' | 'lỗi'` (`'lỗi'` flag input không scrape được; admin re-trigger).
- `auto_campaign_data_actions` — **việc-cần-làm thực thi** (mỗi target/profile/group = 1 row). Status: `'chờ xử lý' | 'tạm dừng' | 'đang chạy' | 'hoàn thành'` (KHÔNG có `'lỗi'` — lỗi action-level đã track ở result_actions; khi run fail set `'hoàn thành' + note=errMsg`). Cột `data_input_id BIGINT NULL` FK → data_inputs (nếu sinh từ scrape; NULL nếu user nhập tay).
- `auto_campaign_result_actions` — **customer-visible "Lịch sử hành động"**: mỗi milestone (post, từng comment, friend request, message) ghi 1 row riêng. Status: `'thành công' | 'thất bại' | 'lỗi'` (thành công = OK; thất bại = nghiệp vụ FB từ chối; lỗi = exception/crash code). FK `data_action_id` (nullable cho simple campaign không có data_action).

[CampaignScheduler](src/main/services/campaignScheduler.ts) — `setInterval(tick, 30s)`:
1. Lấy channels + campaigns đến giờ
2. Engine v2 hoặc v1 tuỳ flag
3. Mỗi data_action run workflow → log per-milestone vào `auto_campaign_result_actions` qua `logMilestonesV2` (scan `result.steps` theo `block_name`: `fb_click_post_button` → "Đăng bài", `fb_comment_at_position` → "Comment", `fb_send_message` → "Nhắn tin", `fb_add_friend` → "Kết bạn"). Status mapping: `step.status==='error'` → `'lỗi'`; `output.ok===false` không exception → `'thất bại'`; còn lại → `'thành công'`.
4. Sleep `extra.actionLimits.sleepBetweenActions` giây giữa data_actions

**Recovery**: `resetRunningCampaignStatuses()` + `resetRunningDataInputStatuses()` + `resetRunningDataActionStatuses()` chạy lúc app start — flip rows kẹt `'đang chạy'` về `'chờ xử lý'` (đề phòng crash mid-flow). `recoverStuckDataActions(campaignId, errMsg)` flip data_actions stuck thành `'hoàn thành'` + `note=errMsg` khi outer catch (enum không có `'lỗi'`).

**Rate limit** ([campaignRepository.ts:getChannelRateLimitStatus](src/main/data/repositories/campaignRepository.ts)) đếm rows `auto_campaign_result_actions` theo `(channel_id, action_name)` filter `status IN ('thành công','thất bại')` (loại `'lỗi'` vì exception code chưa chạm tới FB → không tốn rate), trả `{ok, isDailyLimit, retryAfterMs, reason}`:
- Hourly hit (e.g. `9 lần / 60 phút`) → reschedule `now + retryAfterMs` (oldest row + windowMs)
- Daily hit + `continueNextDay=true` → reschedule tomorrow cùng giờ user set; ngược lại giữ schedule, status `'chờ xử lý'`

### Data layer

[src/main/data/repositories/](src/main/data/repositories/) — mỗi entity 1 file. Pattern:
- `client = () => getSupabaseClient()` ([supabaseClient.ts](src/main/data/supabaseClient.ts))
- `requireCurrentUser()` ([currentUser.ts](src/main/data/currentUser.ts)) ném lỗi nếu chưa login → block IPC handler
- `mapXxxFromDB(row)` trong [mappers.ts](src/main/data/mappers.ts) chuyển snake_case → camelCase
- Built-in records gán về **admin tenant** (org có `is_admin_akabiz=true`) qua `resolveAdminTenant()`. Mọi staff thấy được khi list (filter `staff_id IN (currentStaff, NULL, adminStaff)`)
- Seed dùng `*System()` variant không cần auth — gọi từ [main/index.ts](src/main/index.ts) lúc khởi động qua `seedBuiltinCampaignActions()` (v1) + `seedV2()` (v2)

Migration pattern: viết SQL file ở root (`migration.sql` cho schema gốc, `migration_v2_workflow.sql` cho v2). Apply qua `mcp__supabase__apply_migration`. Idempotent UPSERT theo UNIQUE name (engine v2) hoặc explicit ID (engine v1).

### Vietnamese UI conventions

Status values trong DB lưu **tiếng Việt có dấu**:
- Campaign / data_inputs: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'lỗi'`, `'tạm dừng'`
- data_actions: `'chờ xử lý'`, `'đang chạy'`, `'hoàn thành'`, `'tạm dừng'` (KHÔNG có `'lỗi'`)
- result_actions: `'thành công'`, `'thất bại'`, `'lỗi'`
- Login status: `'đã đăng nhập'`, `'chưa đăng nhập'`, `'checkpoint'`

**Customer-facing log language** (rất quan trọng — log từ `sendLog()` và `auto_campaign_result_actions.log` đều khách hàng đọc):
- Viết tiếng Việt tự nhiên: `"Đã comment vào bài thứ 3: ..."`, `"Đăng bài thành công vào ..."`, `"Bài đang chờ duyệt"`
- TRÁNH: `"Đã log X"`, `"lần X/Y"`, `"vị trí #N"`, ID strings, stacktraces, `"position"`, `"iteration"`, `"result_action"` lộ ra UI
- Technical metadata (`commentPosition`, `iteration`, `commentType`) → JSONB `data` column, KHÔNG vào `log` string
- **Log order**: action milestone trước (📝 Đăng bài), rồi metadata (⏳ Chờ duyệt), rồi link/artifact (🔗), milestones tiếp theo (💬), cuối cùng summary (✅/❌)
- Emoji vocab thống nhất: 📝 Đăng bài • 💬 Comment/Nhắn tin • 🔗 Link • ⏳ Chờ duyệt • ✅ Hoàn thành • ❌ Lỗi • 👋 Rời nhóm • 🤝 Kết bạn/Tham gia • 🔀 Shuffle/Share • ⚠️ Cảnh báo • ℹ️ Info • 🎬 Reels

**Per-milestone logging**: post xong ghi 1 row, mỗi comment ghi 1 row, friend request ghi 1 row — KHÔNG đợi cuối flow. Lý do: nếu comment failed sau khi post OK, vẫn phải có row "Đăng bài thành công" để khách hàng thấy.

### IPC pattern

[src/main/ipc/handlers.ts](src/main/ipc/handlers.ts) gom các nhóm trong `handlers/` directory:
- `authHandlers` (login/logout/me)
- `campaignHandlers` (CRUD campaign + scheduler control)
- `browserHandlers` (Playwright launch/close + webview register/unregister, register cả `WebviewRegistry` cũ lẫn `PageControllerRegistry` v2)
- `flowHandlers` (engine v1 run/stop)
- `channelHandlers` / `channelContactHandlers` / `elementHandlers` / `runHandlers` / `updateHandlers`
- `v2Handlers` ([handlers/v2Handlers.ts](src/main/ipc/handlers/v2Handlers.ts)) — engine v2: BLOCK_LIST/SAVE/DELETE, WORKFLOW_LIST/GET/SAVE/DELETE, ELEMENT_LIST/SAVE/DELETE, WORKFLOW_TEST_RUN, BLOCK_TEST_RUN, RUN_STOP, RUN_PROGRESS broadcast, RUN_LOG broadcast

Mỗi handler `ipcMain.handle(channel, fn)` → method tương ứng repository/service. Renderer gọi qua `electronAPI.xxx()` ([preload/index.ts](src/preload/index.ts), typed trong [electron.d.ts](src/renderer/src/types/electron.d.ts)).

### Renderer state (Zustand stores)

[src/renderer/src/stores/](src/renderer/src/stores/):
- `authStore` — current user, login/logout
- `campaignStore` — channels, campaigns, action templates, log realtime broadcast
- `flowStore` — engine v1 editor state (nodes/edges/selectedNode)
- `executionStore` — engine v1 step progress
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
- `TestPanelV2.tsx` — chọn channel webview → Test workflow / Test block → realtime log + per-step status
- `BlockCrudModal.tsx` + `ElementCrudModal.tsx` — quản lý block library / XPath elements

App.tsx **conditional render** workflow editor (KHÔNG `display: none`) để ReactFlow đo container đúng — nếu hidden khi mount, ReactFlow render 0×0 và nodes invisible.

## Default branch

PR target branch là `dev_3` (replaces `dev_2` như memory `default_branch.md`). Repo URL: `https://github.com/aligoinc/akaAgent.git` (đã chuyển từ `lequangnhut27/akaBizAutoNew`).

## Common pitfalls

- **inputMapping vs DAG data flow**: engine v1 dùng `inputMapping.sourceNodeId/sourceField`. Engine v2 KHÔNG có inputMapping — output của parent merge vào input của child theo edges, last-write-wins. Output `scrapedText` của block ở xa KHÔNG cascade qua chain — nếu cần dùng ở downstream chain dài, **mutate `vars`** thay vì rely on input merging.
- **Loop iterations**: scheduler `logMilestonesV2` đọc `result.steps` từ engine. Engine v2 maintain `allSteps[]` (mỗi loop iteration 1 row riêng) thay vì snapshot `nodeStates`. Khi đọc per-iteration data, đọc `s.output` (block return value), KHÔNG `s.input` (chỉ là config + parents trực tiếp).
- **XPath union `|`**: timeline page và group page dùng selector khác nhau. Element store XPath với `|` để match cả hai. `document.evaluate` (XPath 1.0) hỗ trợ union, trả node đầu tiên match.
- **timeSleepBetween2** vs **actionLimits.sleepBetweenActions**: scheduler ưu tiên `actionLimits.sleepBetweenActions`, fallback `campaign.timeSleepBetween2`. Cả 2 tính bằng giây.
- **Schedule edit** (`scheduleEndDate`): cột nullable, type `string | null | undefined`. Pass `null` (không phải `undefined`) để clear — `updateCampaign`'s `!== undefined` check sẽ skip undefined. Cho `scheduleType='daily'`, luôn gửi `null` (form date input disabled nhưng formData vẫn giữ default 7-day-ahead, sẽ silently stop campaign sau 1 tuần).
- **Hidden vs disabled toggle** (`sharePost` pattern): feature có DB flag nhưng chưa implement → ẨN khỏi UI (don't render checkbox), giữ flag trong `formData` + `handleSave` payload (preserve roundtrip), backend log warning per run. KHÔNG `<input disabled>` (leak feature name).
- **Emojis trong source files**: KHÔNG viết emoji vào TS/TSX trừ khi user yêu cầu. Emoji trong **log strings** (`📝`/`✅`/`❌`/...) là customer-facing vocabulary đã agreed, được expected trong `sendLog`/`appendCampaignLog`/block code.

## Maintenance — keep this file fresh

Khi xong 1 task **non-trivial** mà có 1 trong các thay đổi sau, update CLAUDE.md trước khi end turn:

- Thêm/sửa table Supabase, IPC channel, action type, system block, status enum value
- Thêm/sửa repository, service, runtime module (engine v1/v2)
- Đổi convention log/UI tiếng Việt, emoji vocab, status string
- Đổi command build/dev (npm scripts, tsconfig)
- Phát hiện common pitfall mới (xếp vào "Common pitfalls")
- Đổi default branch hoặc repo URL

KHÔNG update khi:
- Bug fix nhỏ không introduce pattern mới
- UI tweak, CSS, copy text changes
- Refactor đơn thuần không đổi public interface

Pattern: chỉnh tại đúng section, giữ entry **terse** (1-2 dòng), link `file:line` thay vì paraphrase code. Nếu plan-mode tạo file lớn → reference plan file thay vì duplicate.
