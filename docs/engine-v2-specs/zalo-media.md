# Zalo campaign media: behavior spec (Desktop/VPS standard, Fly equivalent)

Research spec for the engine-v2 extraction, written 12/11/2026 from code only (no DB, no runtime checks).
Today every campaign that declares media runs the legacy runners on both hosts: `zaloMessagePhoneV2Support`
returns `no('media')` when `imageOption !== 'none'` and `images` has an entry
(`packages/campaign-engine/src/zalo/messagePhone.ts:90-93`, `:118`). Nothing below is implemented in the core yet.

## 0. Sources and aliases

Desktop paths are relative to the akaAgent worktree `.claude/worktrees/campaign-engine-v2` (HEAD `24ff928c`).
Fly paths are in `/Users/lequangnhut/Repos/akaAgentChatApi-deploy-dbb38b7` (HEAD `dbb38b7`).

| Alias | File |
|---|---|
| CS | `src/main/services/campaignScheduler.ts` |
| ZR | `src/main/services/zaloRuntimeService.ts` |
| CME | `src/main/services/campaignMediaExecution.ts` |
| BH | `src/main/v2/runtime/blockHelpers.ts` |
| ARR | `src/main/services/actionResultRuntime.ts` |
| ASP | `src/shared/actionStatusPolicy.ts` |
| ADV | `src/shared/advancedContent.ts` |
| TYP | `src/shared/types.ts` |
| MT | `src/shared/mediaTypes.ts` |
| LCM | `src/renderer/src/components/CampaignPanels/localCampaignMedia.ts` |
| CFM | `src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx` |
| ZCA | `node_modules/zca-js/dist/` (zca-js 2.1.2; ChatApi pins the same version, `packages/zalo-zca-adapter/package.json:19`) |
| ZE | ChatApi `apps/system-worker/src/zaloCampaignExecutor.ts` |
| ZS | ChatApi `apps/system-worker/src/zaloCampaignScheduler.ts` |
| CCC | ChatApi `apps/system-worker/src/campaignCommandClient.ts` |
| FZP | ChatApi `apps/system-worker/src/campaignEngine/flyZaloPort.ts` |
| CAD | ChatApi `apps/chat-api/src/campaignActionDispatcher.ts` |
| AS | ChatApi `apps/zalo-server-runtime/src/accountSupervisor.ts` |
| RB | ChatApi `apps/zalo-server-runtime/src/runtimeBridge.ts` |
| ZA | ChatApi `packages/zalo-zca-adapter/src/index.ts` |
| RP | ChatApi `packages/runtime-protocol/src/index.ts` |

Workflow and block code live in the DB (`auto_workflows`, `auto_blocks`). Block code below is quoted from
`migrations/snapshots/campaign-content-v350/source.json` (captured 06/10/2026). `migration_v351_campaign_content_blocks.sql`
changed only Facebook blocks plus the workflow flag of §2.2. Check the live rows before relying on them.

## 1. Campaign types that send media

| `action_id` | Workflow | Send block → helper | Action code / name written to history | Thread | Gate |
|---|---|---|---|---|---|
| `zalo_message_phone` | 260 | `zalo_send_phone_message` (2770) → `zaloSendPhoneMessage` | `zalo_message_stranger` / "Nhắn tin người lạ" | user | `extra.enableMessage === true` |
| `zalo_message_group_member` | 272 | `zalo_send_group_member_message` (2783) → `zaloSendPhoneMessage` | same | user | `enableMessage` |
| `zalo_message_group_realtime` | 276 | 2783 → `zaloSendPhoneMessage` | same | user | `enableMessage` |
| `zalo_message_remarketing_customer` | 274 | `zalo_send_remarketing_customer_message` (2786) → `zaloSendPhoneMessage` | same | user | `enableMessage` |
| `zalo_message_friend_recommendation` | 280 | `zalo_send_friend_recommendation_message` (2790) → `zaloSendPhoneMessage` | same | user | `enableMessage` |
| `zalo_message_friend` | 266 | `zalo_send_friend_message` (2780) → `zaloSendFriendMessage` | `zalo_message_friend` / "Nhắn tin bạn bè" | user | always |
| `zalo_message_birthday` | 270 | 2780 → `zaloSendFriendMessage` | same | user | always |
| `zalo_message_group` | 268 | `zalo_send_group_message` (2781) → `zaloSendGroupMessage` | `zalo_message_group` / "Nhắn tin group" | group | always |
| `zalo_message_friend` or `zalo_message_group` with `extra.zaloMessageSendMode === 'share'` | none (scheduler batch) | `executeZaloShareMessageBatchCampaign` | `zalo_message_friend` / `zalo_message_group` | user / group | CS:5766-5771 |

- Media-capable list: `campaignUsesMessageMedia` CS:17126-17139; action ids CS:639-646; helper registration CS:16517-16519;
  names `src/shared/campaignActionDescriptors.ts:64-66`; the action code and name are hard-coded in each helper
  (CS:15687-15688, 15740-15741, 15819-15820). Group members, remarketing and recommendations are recorded as "Nhắn tin người lạ".
- No other Zalo action sends campaign media (add member, join link, cancel friend request, friend request, tag, alias);
  `campaignUsesMainContent` excludes them (CS:17141-17169).
- Every send block passes the same arguments (snapshot). Friend and group blocks pass `targetUid`/`targetName` instead of
  `target`/`enabled`:

```js
return await helpers.zaloSendPhoneMessage({ target: input.zaloTarget, enabled: vars.enableMessage,
  message: vars.campaignContent, attachments: vars.images, inputData: vars.inputData });
```

## 2. Configuration

### 2.1 Keys and defaults

| Key | Type | Runtime default | Form default | Role |
|---|---|---|---|---|
| `auto_campaigns.images` | `CampaignMediaInput[]` (TYP:168, :799) | `[]` | `[]` | media pool, basic content |
| `extra_settings.imageOption` | `'none'`, `'all'`, `'random'` (TYP:634) | **`'all'`** when missing (`extra.imageOption \|\| 'all'`, CS:17423) | **`'none'`** (CFM:2001) | basic content |
| `extra_settings.randomImageCount` | number (TYP:635) | `3` (`\|\| 3`, CS:17424) | `3` (CFM:2002) | count for `random` |
| `extra_settings.advancedContentEnabled` | boolean | `false` | | switches to per-item media |
| `extra_settings.advancedContentItems[]` | `{ id, content, mediaOption, mediaItems, randomMediaCount, ... }` (TYP:170-182) | normalised by ADV:28-70: invalid or missing `mediaOption` → **`'none'`**, invalid `randomMediaCount` → `3`, non-array `mediaItems` → `[]` | | advanced content |
| `extra_settings.formattedContentEnabled` | boolean | `false` | | text becomes `{ msg, styles }`; changes the send order (§3.1) |
| `extra_settings.zaloMessageSendMode` | `'share'` | normal | | share mode (§3.4) |
| `extra_settings.enableMessage` | boolean | | | gate for the five "stranger" types |

`CampaignMediaInput = string | CampaignMediaSnapshot`, snapshot = `{ name, localPath?, cloudUrl?, mimeType?, sizeBytes?, provider? }`
(TYP:159-168). Strings are legacy entries: a local path, an `http(s)` URL or a `data:` URI.

Form labels for Zalo campaigns (CFM:9518, 9527, 9537): "Không gửi file" (`none`), "Gửi file (mọi định dạng)" (`all`),
"Gửi ngẫu nhiên số file trong file đã chọn" (`random`, count input `min={1}`, no max for Zalo, CFM:9541-9542).

### 2.2 Which media one send uses

There are two code paths.

**(a) Deferred preparation (live path).** Every Zalo message workflow (ids 260, 262, 266-277, 280, 281) has
`default_variables.campaignContentPreparationVersion = 1`, set by `migration_v351_campaign_content_blocks.sql`
(applied 06/10/2026, ledger `20261006101435`, `migrations/snapshots/campaign-content-v350/production-v351-apply.json`).
`executeCampaignV2` turns the flag on per run (CS:3936-3939). `buildVariablesV2` then passes `campaignContent: ''` and
`images: []` (CS:10543-10545, 10559-10560), and the helper chooses text and media at send time:
`prepareZaloOutgoingContent` (CS:15081-15096) → `prepareSelectedCampaignContent` (CS:17208-17262).

**(b) Legacy path** (workflow without the flag, old builds). Media is resolved before the workflow in `buildVariablesV2`
with `detailIndex` = loop index (CS:10555-10567), passed in `vars.images`, and used as given (`options.attachments`, CS:15086-15088).

Deferred algorithm (CS:17208-17259):

1. `advanced = advancedContentEnabled === true && campaign uses main content` (CS:17098-17104).
2. `count` = number of advanced items (ADV:94-99), or the non-blank text variants: `splitFormattedContentVariants(raw)`
   when formatted, else `splitSharedContentVariants(raw, { trim: false }).filter(t => t.trim())`.
3. `index` = 0 when `count <= 1` (no RPC); otherwise `takeCampaignContentIndex(..., inputDataId, actionCode, variantCount)`
   → RPC `aka_agent_take_campaign_content_index` (migration v350). The cursor is stored per input and per send action code
   (`zalo_message_stranger`, `zalo_message_friend`, `zalo_message_group`); an input's first send takes the campaign cursor.
   `prepareCampaignContent` is identical in `src/shared/campaignContentPreparation.ts` and the core copy.
4. `media = resolveCampaignMediaForIndex(campaign, index, postWithBackground=false, mediaTempPaths)` (CS:17239-17240, 17400-17427):
   - advanced: `item = selectAdvancedContentItem(extra, index)` (index modulo item count, ADV:109-117), then
     `resolveMediaSelection(item.mediaItems || [], item.mediaOption || 'none', item.randomMediaCount || 3)`; no item → `[]`.
   - basic: `resolveMediaSelection(campaign.images || [], extra.imageOption || 'all', extra.randomImageCount || 3)`.
     **In basic mode the media does not depend on the text variant.**
5. `resolveMediaSelection` (CS:17693-17715):
   - `'none'` → `[]`.
   - Keep only declared sources (`hasDeclaredMediaSource`: non-blank string, or snapshot with non-blank `localPath` or `cloudUrl`, CS:17717-17726).
   - `'all'` → every declared item in stored order.
   - `'random'` → `[...declared].sort(() => 0.5 - Math.random()).slice(0, Math.max(1, randomCount || 1))`. It is drawn
     again on every send, so each target can get a different subset; nothing is persisted.
   - Each chosen item is resolved in turn (`await` inside the loop, §2.3).
6. The text is rendered afterwards (`buildZaloOutgoingMessage` CS:15098-15123); the media list is passed unchanged.

Share mode prepares once per batch with `inputDataId = null`, so it uses the campaign cursor (CS:6108-6116).

### 2.3 Turning an entry into a file (`resolveCampaignMediaSource`, CS:17733-17767)

| Entry | Result |
|---|---|
| string `data:...` | returned as is (CS:17739). zca-js then fails with `File not found` (ZCA `apis/uploadAttachment.js:56-57`) |
| string `http(s)://...` | downloaded |
| string, existing local path | the path |
| any other string | error `local path không tồn tại và không có cloud URL fallback` |
| snapshot whose `localPath` is `data:` or an existing file | `localPath` (local wins over cloud) |
| snapshot with `cloudUrl` | downloaded; failure → `local path không tồn tại và cloud URL không tải được (...)` or `không có local path và cloud URL không tải được (...)` |
| snapshot with a missing `localPath` only | `local path không tồn tại và không có cloud URL fallback` |
| nothing usable | `không có local path hoặc cloud URL hợp lệ` |

Download (CS:17769-17788): `fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(60000) })`;
non-2xx → `HTTP <status>`; the body is written to `join(tmpdir(), campaign-media-${Date.now()}-${random}${ext})`.
Extension (CS:17790-17800): extension of the URL path, else of the display name, else
`getRuntimeMediaDownloadExtensionForMimeType(content-type)` (MT:84-108), else `.bin`. Consequences:

- A document downloaded from cloud reaches the recipient under the temp name (`campaign-media-...pdf`), not its snapshot name.
- The extension decides how zca-js sends the file (§3.3); `.bin` is sent as a generic file.

Every failure is a `CampaignMediaResolveError` with message `Không dùng được media "${mediaName}": ${reason}` (CS:353-361);
`mediaName` = snapshot name, else basename of the path or URL, else `media` (CS:17802-17808).

Temp files are per target in the normal path (`mediaTempPaths` CS:4412, deleted in `finally` CS:5017 by
`cleanupCampaignMediaTempFiles` CS:17824-17832) and per campaign run in share mode (CS:5801, 6247-6249). The normal path
downloads a cloud file again for every target; share mode downloads once per batch.

## 3. Send sequence (Desktop)

### 3.1 `dispatchZaloMessage` (CS:15555-15616)

`send(outgoing, files)` = `zaloRuntime.sendMessageToGroup` or `sendMessageToUser(accountId, threadId, outgoing, files, campaignMedia = true)`
(CS:15566-15570). `hasContent` = text trimmed non-empty (`.msg` for styled text); `isFormatted` = message is `{ msg, styles }`.

| Files | Text | Formatted | Calls, in order | `sequence` |
|---|---|---|---|---|
| ≥ 2 | no | any | `send('', files)` | `media_only` |
| ≥ 2 | yes | any | `send('', files)` → `send(message, [])` | `media_then_content` |
| 1 | no | yes | `send('', files)` | `media_only` |
| 1 | yes | yes | `send(message, [])` → `send('', files)` | `content_then_media` |
| 1 | any | no | `send(message, files)`, one call | `combined` |
| 0 | any | any | `send(message, [])` | `content_only` |

- A failure of the **second** call throws `ZaloPartialSendError(stage, cause, response)` (CS:377-388):
  `content_after_media` (album then text) or `media_after_content` (text then file). A failure of the first or only call
  is thrown unchanged.
- The response is `{ sequence, response?, mediaResponse?, contentResponse?, contentSentAt? }` (CS:441-447).
- Empty text with no file reaches zca-js and fails with `Missing message content`.

### 3.2 `zaloRuntimeService.sendMessage` (ZR:1876-1952)

1. `ensureApi(accountId)`; trim attachments; build `{ msg, styles? }` plus `attachments` when there are any (ZR:1884-1896).
2. `needsUploadCallback` = some attachment whose extension is not jpg, jpeg, png, webp or gif and which is not a
   `data:image/` URI; no extension counts as "needs" (ZR:429, 3413-3420).
3. Read the account; missing or not Zalo → `Không tìm thấy tài khoản Zalo` (ZR:1898-1899).
4. **Zalo Web** (`is_zalo_show_web`): any attachment that is not JPG, JPEG, PNG, WEBP, GIF or a matching `data:image/` URI →
   `Zalo Web hiện chỉ hỗ trợ ảnh JPG, JPEG, PNG, WEBP hoặc GIF`, thrown before any request (ZR:1900-1903, 3422-3428).
   Otherwise `withTimeout(api.sendMessage(...), 90 s, 'Gửi tin nhắn Zalo quá thời gian chờ (90 giây)')`: no fence, no
   listener, the request is not aborted (ZR:1907-1913).
5. **QR and Server accounts**: `execution` = the account's `CampaignMediaExecution` when `campaignMedia && attachments > 0`,
   else `null` (ZR:1915-1917). `getCampaignMediaExecution` installs the fenced fetch on `ctx.options.polyfill` and wraps
   `ctx.uploadCallbacks` (ZR:1954-1964).
6. Listener: `ensureZaloListenerReady(..., { refreshIfOlderThanMs: needsUploadCallback ? 30 min : undefined })`
   (ZR:1918-1931, constants ZR:425-426, ready wait 20 s). It is awaited only when a callback is needed: video and file
   uploads finish with a WebSocket `file_done` event. Otherwise it runs in the background.
7. Timeout: 180 s when `needsUploadCallback`, else 90 s (ZR:427-428, 1933-1935).
8. With `execution`: if the cached API changed meanwhile, `execution.stop()` (ZR:1940), then
   `execution.run(() => api.sendMessage(payload, threadId, type), timeoutMs)` (ZR:1941). Without (text only):
   ``withTimeout(..., `Gửi tin nhắn Zalo đến ${targetLabel} quá thời gian chờ (${Math.round(timeoutMs / 1000)} giây)`)`` with
   `targetLabel` = `group` or `người dùng`; the timer rejects but does not cancel the HTTP request (ZR:1943-1951, 2832-2862).

`CampaignMediaExecution` (CME:37-129) gives each call an AbortController and an AsyncLocalStorage scope. Every SDK request of
the call (upload chunks, send requests, redirects) goes through its fetch with the scope signal (CME:57-67). Upload callbacks
registered in the scope are guarded and removed when it closes (CME:69-91). `run` races the call against the timeout; in
`finally` it aborts the scope so late continuations cannot send (CME:93-118). Errors:

| Code | Message (verbatim) | Meaning |
|---|---|---|
| `campaign_media_timeout` | `Gửi media quá thời gian chờ (${Math.round(timeoutMs / 1_000)} giây). Đã đóng tác vụ; kết quả gửi chưa xác định, không tự gửi lại người nhận này.` (CME:14-22) | deadline hit; result unknown |
| `campaign_runtime_unavailable` | `Tác vụ media đã đóng; không thực hiện thêm yêu cầu Zalo.` (CME:24-28, 94) | execution already stopped; nothing sent |
| `command_result_unknown` | `Phiên Zalo đã dừng khi đang gửi media; không tự gửi lại để tránh trùng.` (CME:120-128) | session stopped mid-send (ZR:885, 898, 2430) |

Any other error is rethrown unchanged and the sibling requests are aborted. Nothing in this chain retries.

### 3.3 What zca-js 2.1.2 does in one `sendMessage({ msg, styles?, attachments }, threadId, type)`

- Checks before any request (ZCA `apis/sendMessage.js:410-425`): `Missing message content` (no text and no file),
  `Missing threadId`, `Exceed maximum file of ${sharefile.max_file}`. `sharefile` is the per-session server setting
  `ctx.settings.features.sharefile`.
- Caption rule (`sendMessage.js:430-441`): `canBeDesc` = exactly one file with extension jpg, jpeg, png or webp. If the
  text is non-empty and `canBeDesc` is false, **the text is sent first as its own request**, then the files. If
  `canBeDesc` is true, the text becomes the photo caption (`desc`) in one send request.
- Type by extension (`uploadAttachment.js:72-130`, `sendMessage.js:242-344`):
  - jpg, jpeg, png, webp → photo: `photo_original/upload`, then `photo_original/send`. Dimensions come from
    `imageMetadataGetter` (ZR:177-186, 3028-3033); unreadable → `Failed to get image metadata` (`utils.js:302-317`).
  - gif → separate path: thumbnail upload and `gif?` send, no WebSocket wait (`sendMessage.js:345-387`).
  - mp4 → `video`; any other extension (mov, avi, heic, pdf, bin...) → `others`. Both use `asyncfile/upload`, wait for
    the WebSocket `file_done` callback, then `asyncfile/msg`.
  - Per-file checks: `File not found`, `File extension "${ext}" is not allowed` (`restricted_ext_file`),
    `File ${fileName} size exceed maximum size of ${max_size_share_file_v3}MB`.
- Album: when more than one non-GIF file is sent, photos share one `groupLayoutId` (shown as an album); videos, files and
  GIFs arrive as separate messages (`sendMessage.js:248-283`).
- Concurrency: upload chunks run in parallel (`uploadAttachment.js:143-194`) and so do the send requests (`send()` with
  `Promise.all`, `sendMessage.js:82-97`). One failure rejects the whole call; items Zalo already accepted stay delivered.
  An upload that returns `fileId`/`photoId` `"-1"` leaves a hole that later throws a `TypeError`.
- Errors (`utils.js:575-620`): HTTP non-2xx → `ZaloApiError('Request failed with status code N')` without a code; Zalo
  `error_code != 0` → `ZaloApiError(error_message, error_code)`; network errors are plain errors with a string `code`
  (`ECONNRESET`, `ETIMEDOUT`...). Upload and send errors look the same to the caller.
- Return value: `{ message: { msgId } or null, attachment: [...] }`. Neither host checks that a `msgId` exists.

Consequences for §3.1:

- `combined` with one photo and text: a single captioned message.
- `combined` with one gif, mp4 or other file and plain text: zca-js sends the text, then the file, in the same call. If the
  file fails the call rejects although the text was delivered, and Desktop records an ordinary failure (no partial flag).
- `media_then_content`: if the album fails part-way the call rejects, some photos may be delivered, and the text is not sent.

### 3.4 Share mode (`zaloMessageSendMode === 'share'`, friend and group only)

`executeZaloShareMessageBatchCampaign` (CS:5790-6250):

1. Before the first batch: advanced items are checked by `getAdvancedContentConfigError(campaign, true)` (CS:5810-5817).
   Basic content: if variant 0 renders empty and there is no declared media with `imageOption !== 'none'`, the campaign
   goes `chờ xử lý` with note `Vui lòng nhập nội dung hoặc chọn media để gửi Zalo` and progress `⚠️ ${note}` (CS:5818-5829).
2. Batches of `min(50, daily remaining, window remaining)` targets (CS:669, 6252-6306), after opt-out and cooldown
   filtering, under one run unit (`beginCampaignRunUnit`, requeue-on-settle `false`).
3. Text and media are prepared once per batch (CS:6108-6116, `getZaloShareMessageForBatch` CS:6308-6356). Empty text and
   no media → stop note `Vui lòng nhập nội dung hoặc chọn media để gửi Zalo` (CS:6117-6121).
4. `processZaloShareMessageBatch` (CS:6397-6839):
   - **Media phase** (only with files): for each target in order,
     `sendMessageToGroup` or `sendMessageToUser(account.id, threadId, '', attachments, true)`, media without caption
     (CS:6431-6505). Timeout and unknown results are written immediately, in send order, including the bad-target count
     (CS:6462-6493). Other errors are kept in `mediaFailures`.
   - **Text phase**: one `forwardMessageToUsers` or `forwardMessageToGroups(account.id, threadIds, message)` (custom
     `mforward` API, ZR:1966-2041, 90 s) to every processed target whose media did not fail (CS:6523-6551). If the media
     phase stopped the batch there is no forward; targets that already received media get the failure
     `Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung.` (CS:6526-6527).
   - Per-target result (CS:6648-6785) and batch summary (CS:6814-6826), see §4.2.

## 4. Outcomes (Desktop)

### 4.1 Normal path (one target per workflow run)

**Writers.** The helper returns `ZaloActionDetailOutput` (BH:136-159). `logZaloMessagePhoneMilestones` (CS:11481-11546;
used for every browserless Zalo campaign, CS:11704-11707) calls `supabase.createCampaignDetail` with
`status: detail.status || 'lỗi'`, `errorCode`, `log`, `data`, `shouldCountAction: countsTowardLimit === true` and
`resultGuards = getHelperResultGuards(detail)` (CS:11032-11043). The action-result runtime is active for every run
(`beginActionResultRun` CS:3822; `managesActionResult` ARR:21), so the row goes through RPC
`aka_agent_write_action_result_v1` (ARR:139-185), and the target through `aka_agent_settle_action_results_v1` (ARR:187+).
Guards (ASP:157-199):

- `operationState`: `committed` when `deliveryCommitted`; `unknown` when only `preventInputRetry`.
- `legacySuppress`: no status → no history row.
- `legacyInputEffect: 'requeue'` when `resetInputToPending`.
- `partialDelivery`: `deliveryCommitted && status !== 'thành công'` → row always written, quota always counted.
- `targetOnlyFailure`: `countsTowardBadTarget === false && status !== 'thành công'` → no bad-target increment.
- A requeue after a committed or unknown operation becomes a pause (`tạm dừng`) (ASP:198, ARR:193).

**Error builder** `createZaloErrorDetail` (CS:14862-14944):

- Code = `getZaloErrorCode(err)`: the `ZaloApiError` code or `err.code` (CS:14608-14616).
- Policy = active `auto_error` row whose `zalo_error_codes` contains the code, action-scoped first
  (`errorPolicyRepository.ts:52-80`); else `err_zalo_api_business_failed` (CS:14634-14643).
- Log: for the fallback policy `${actionName} thất bại: ${message}` plus ` (mã Zalo: ${code})` when there is a code
  (CS:14618-14622, 14655-14657); otherwise the policy `noti_running_process || noti_campaign` rendered with
  `message`, `x`, `actionName`, `action`, `actionCode`; otherwise the raw message.
- `status` = policy `detail_status`; `countsTowardLimit: policy?.countsTowardLimit ?? true`; bad target per policy;
  `resetInputToPending: !detailStatus && !mediaTimeout && !unknownDelivery`;
  `preventInputRetry` and `stopRemainingActions: mediaTimeout || unknownDelivery`;
  `stopAfterTarget`: policy side effects or `unknownDelivery`.
- Policy side effects (login status, account status, action locks, campaign status) are applied immediately (CS:14688-14731).
- Also writes `auto_zalo_api_error_logs` with `apiName: 'sendMessage'` (CS:14791-14830).

`stopRemainingActions` makes every later helper of the same target return `{ ok: true, skipped: true }` (CS:16417-16423),
so the friend request, tag and alias are skipped.

**Partial builder** `finalizeZaloPartialSendDetail` (CS:15644-15672) wraps the error detail of the failed second call:
`createDetail: true`, `status: 'thất bại'`, `log: '${prefix}. ${detail.log || error}'`, `countsTowardLimit: true`,
`countsTowardBadTarget: mediaTimeout ? <policy value> : false`, `resetInputToPending: false`, `preventInputRetry: true`,
`deliveryCommitted: true`, `pendingNote: undefined`, `data.partialSend = { stage, sequence, mediaResponse, contentResponse, error, mediaTimeout }`.
Policy side effects of the underlying error have already run.

**Target settlement** after the workflow: summary controls (CS:11045-11084), then CS:4707-4780.

| Case | History row (status / log) | Quota | Bad-target streak | Target (`auto_campaign_input_data`) | Other |
|---|---|---|---|---|---|
| Success, any sequence | `thành công` / `Đã gửi tin nhắn đến ${label}`, group `Đã gửi tin nhắn vào group ${label}` (CS:15701-15716, 15780-15795, 15847-15852); `label` = first non-empty of displayName, originalName, phone, uid, else `target` (CS:15034-15036) | yes (default `true`, CS:15028) | reset when nothing failed | `hoàn thành`, note empty; progress `✅ Hoàn thành "${name}"` (CS:4754-4765) | `deliveryCommitted: true` (CS:15016-15031); `data = { target, message, attachments, response, zaloEngagementSource, messageOptOutSource }` |
| Media sent, text failed (`media_then_content`) | `thất bại` / `Đã gửi file nhưng gửi nội dung thất bại. ${log}` | always | ignored, unless the cause is `campaign_media_timeout` (then per policy) | `hoàn thành`, note = same log, never retried; no `✅` line (CS:4732-4741, 11056-11062) | `stage: 'content_after_media'`; later actions still run unless the cause was timeout or unknown |
| Text sent, file failed (`content_then_media`, formatted text + 1 file) | `thất bại` / `Đã gửi nội dung nhưng gửi file thất bại. ${log}` | always | ignored, unless media timeout | `hoàn thành`, note = log, never retried | `stage: 'media_after_content'` |
| Plain text + 1 gif/mp4/file in one `combined` call; text delivered, file failed | per policy of the file error; no partial flag | per policy | per policy | per policy; requeue possible, which sends the text again on retry | hidden partial (inventory ZL-E11) |
| Album fails part-way (first call) | per policy of the first rejected request; text not sent | per policy | per policy | per policy; requeue possible, which resends delivered photos | inventory ZL-E12 |
| Zalo error code during upload or send (not distinguished) | policy `detail_status`, else fallback `thất bại` / `${actionName} thất bại: ${message} (mã Zalo: ${code})` | policy; fallback yes | policy; fallback +1 | with status: `hoàn thành`, note empty, `✅ Hoàn thành` printed; without status (lock policies such as 120/802 for strangers): `chờ xử lý` + campaign note (CS:4747-4753) and progress `⚠️ ${actionName}: ${log}` | policy side effects immediately |
| Network error (`ECONNRESET`, `socket hang up`, `ETIMEDOUT`, `Request failed with status code N`) | no policy has these codes → fallback, e.g. `Nhắn tin người lạ thất bại: socket hang up (mã Zalo: ECONNRESET)` | yes | +1 (`err_undefined` threshold, 4 in a row pauses) | `hoàn thành` (not retried) | no retry at any layer |
| Media timeout `campaign_media_timeout` (90 s photos and GIF only, 180 s otherwise) | policy for that code if one exists, else fallback, e.g. `Nhắn tin người lạ thất bại: Gửi media quá thời gian chờ (180 giây). Đã đóng tác vụ; kết quả gửi chưa xác định, không tự gửi lại người nhận này. (mã Zalo: campaign_media_timeout)` | fallback yes | fallback +1 | `hoàn thành`, note = log, never retried, no `✅` line | remaining actions skipped; on the second call it becomes the partial row above with streak per policy |
| Session stopped mid-send `command_result_unknown` | same rendering | | | `hoàn thành`, note = log | `stopAfterTarget`: campaign `chờ xử lý` with the note, progress `⏸ Dừng chiến dịch: ${note}` (CS:4861-4876) |
| Execution already closed `campaign_runtime_unavailable` (nothing sent) | fallback `thất bại` | yes | +1 | `hoàn thành` | treated as an ordinary failure (inventory ZL-E8) |
| Zalo Web account + non-image | fallback `thất bại` / `${actionName} thất bại: Zalo Web hiện chỉ hỗ trợ ảnh JPG, JPEG, PNG, WEBP hoặc GIF` | yes | +1, so 4 targets in a row pause the campaign | `hoàn thành` | repeats on every target; with `content_then_media` it becomes a partial row because the text already left |
| zca-js checks: `Missing message content`, `Exceed maximum file of N`, `File extension "x" is not allowed`, `File ... size exceed maximum size of NMB`, `File not found`, `Failed to get image metadata` | fallback `thất bại` (fs errors carry codes such as `ENOENT`) | yes | +1 | `hoàn thành` | every target fails the same way |
| Empty `msgId`, `message: null` or `""` | treated as success | yes | reset | `hoàn thành` | no check on either host |
| Media cannot be resolved, deferred path (live) | none: the helper throws before its `try` (CS:15684, 15765, 15836), the block fails and the error class is lost (`src/main/v2/runtime/blockExecutor.ts:91-99` keeps only the message) | no | `err_undefined` +1 (`normalizeRuntimeError` CS:9986-10030, CS:4795-4821) | `hoàn thành`, note `Không dùng được media "${name}": ${reason}`; progress `❌ Lỗi "${name}": ${message}` (CS:4771-4779) | no Zalo call; campaign not paused |
| Media cannot be resolved, legacy path and share mode | none | no | no | legacy: `chờ xử lý` + note; share: batch targets are not updated here (final unit settle with requeue `false`) | campaign `tạm dừng` + note, progress `❌ Tạm dừng chiến dịch "${campaign.name}": ${note}` (CS:17814-17822; catch sites CS:5009-5016, 6240-6245) |
| Runtime handoff or shutdown during the send | none | | | `hoàn thành`, note `Dừng do thay đổi chế độ runtime, không xác định kết quả; không tự thực hiện lại` or `Dừng do runtime Zalo đang tắt, không xác định kết quả; không tự thực hiện lại` (CS:695-701, 4723-4731) | campaign `chờ xử lý` |

Notes when retry and delivery meet in one target (CS:11045-11084): a later action that asks for a requeue after a
committed send gives `${downstreamFailure}. Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.`
(CS:11063-11070); a send that commits after an earlier action asked for a requeue gives
`${summary.pendingNote || actionDetail.log || 'Tin nhắn đã gửi'}. Không tự chạy lại data để tránh gửi trùng.` (CS:11048-11055).
The fallback note of a committed target is `Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.` (CS:4735-4739).

### 4.2 Share mode

| Case | History row | Target |
|---|---|---|
| Media sent and forward OK | `thành công` / `Đã chia sẻ tin nhắn đến ${label}`, group `Đã chia sẻ tin nhắn vào group ${label}`; `data.sendMode: 'share'` (CS:6909-6936); no per-target progress line | `hoàn thành`, note `''` (CS:7029-7035) |
| Media sent, no text | the same success row with `message: ''` | `hoàn thành` |
| Media sent, forward failed (whole call, or that target's row) | `thất bại` / `Đã gửi file nhưng gửi nội dung thất bại. ${log}` (CS:6706-6737); a row without a code uses `Chia sẻ tin nhắn Zalo thất bại` (CS:6938-6971) | `hoàn thành`, note = log |
| Media failed (not timeout) | `createZaloErrorDetail` with `policyHandling`: `target-only` if any target of the batch succeeded (status forced `thất bại`, no side effects, no streak), `full` for the one target whose policy has the strongest side effect, `batch-followup` for the others (CS:6572-6594, 6656-6684, 6874-6907) | `updateZaloShareInputStatus` (CS:7013-7036): no status and retry allowed → `chờ xử lý` + note; else `hoàn thành` + note = log |
| Media timeout or unknown | written immediately in send order (CS:6462-6493) | `hoàn thành` |
| Batch stopped during the media phase | targets not started yet → `chờ xử lý` (CS:6516-6522) | |
| Every target failed | campaign `tạm dừng`, note `Toàn bộ ${claimedDetails.length} target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra` (CS:6814-6820) | |

Progress: one `⚠️ ${this.formatZaloProgressLog(actionDetail)}` (= `⚠️ ${actionName}: ${log}`) per distinct failure text
(CS:6983-6989), then `📨 Kết quả chia sẻ tin nhắn Zalo: tổng ${claimedDetails.length}, thành công ${shareSuccessCount}, thất bại ${shareFailCount}`
and, when stopping, `⏸ Kết thúc batch: ${stopNote}` (CS:6822-6826). The campaign then goes `tạm dừng` or `chờ xử lý` with the stop note, default
`Chiến dịch đã dừng sau batch để chờ kiểm tra lại` (CS:6157-6189).

## 5. Customer-facing strings (verbatim)

Shorthands used below: `${label}` = `this.getZaloTargetLabel(target)` (CS:15034-15036); `${name}` =
`this.getInputDataDisplayName(campaign, detail)`; `${actionName}` = the row's action name ("Nhắn tin người lạ",
"Nhắn tin bạn bè", "Nhắn tin group"); `${note}` = the note variable at the cited line. Everything else is copied as written.

History logs (`auto_campaign_details.log`) and input notes:

- `Đã gửi tin nhắn đến ${label}` / `Đã gửi tin nhắn vào group ${label}` (CS:15704, 15783, 15850)
- `Đã chia sẻ tin nhắn đến ${label}` / `Đã chia sẻ tin nhắn vào group ${label}` (CS:6922-6924)
- `Đã gửi file nhưng gửi nội dung thất bại` / `Đã gửi nội dung nhưng gửi file thất bại`, followed by `. ${failureLog}` (CS:15649-15659)
- `${actionName || 'Thao tác Zalo'} thất bại: ${message || 'Lỗi Zalo chưa xác định'}` + ` (mã Zalo: ${code})` (CS:14618-14622)
- `Chia sẻ tin nhắn Zalo thất bại` (CS:6712, 6949)
- `Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung.` (CS:6527)
- `Không dùng được media "${mediaName}": ${reason}` (CS:358) with reasons `không có local path hoặc cloud URL hợp lệ`,
  `local path không tồn tại và không có cloud URL fallback`, `không có local path và không có cloud URL fallback`,
  `local path không tồn tại và cloud URL không tải được (${message})`, `không có local path và cloud URL không tải được (${message})`,
  where `${message}` is `HTTP ${status}` or the fetch error (CS:17738-17786)
- `Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.` and the two composed notes of §4.1 (CS:4737-4738, 11053, 11069)

Errors that appear inside those logs:

- `Gửi media quá thời gian chờ (${s} giây). Đã đóng tác vụ; kết quả gửi chưa xác định, không tự gửi lại người nhận này.` (CME:18-19)
- `Tác vụ media đã đóng; không thực hiện thêm yêu cầu Zalo.` (CME:25)
- `Phiên Zalo đã dừng khi đang gửi media; không tự gửi lại để tránh trùng.` (CME:125)
- `Zalo Web hiện chỉ hỗ trợ ảnh JPG, JPEG, PNG, WEBP hoặc GIF` (ZR:1902)
- `Gửi tin nhắn Zalo đến group quá thời gian chờ (90 giây)`, `Gửi tin nhắn Zalo đến người dùng quá thời gian chờ (90 giây)` (ZR:1947), `Gửi tin nhắn Zalo quá thời gian chờ (90 giây)` (ZR:1911)
- zca-js English messages of §3.3, passed through unchanged

Progress lines (campaign log, `logCampaignProgress` CS:14468-14503):

- `${actionName}: ${log}` (no emoji) for a written row; `⚠️ ${actionName}: ${log}` when no row is written (CS:11327-11351)
- `✅ Hoàn thành "${name}"` (CS:4764), `❌ Lỗi "${name}": ${message}` (CS:4779), `⏸ Dừng chiến dịch: ${note}` (CS:4872)
- `❌ Tạm dừng chiến dịch "${campaign.name}": ${note}` (CS:17821)
- `⚠️ Vui lòng nhập nội dung hoặc chọn media để gửi Zalo` (CS:5823-5825, 6120-6121)
- `⚠️ Vui lòng thêm ít nhất 1 nội dung nâng cao hoặc chuyển về chế độ Cơ bản.` and
  `⚠️ Nội dung nâng cao số ${invalidIndex + 1} đang rỗng. Vui lòng nhập nội dung hoặc chọn media.` (CS:17178, 17204, logged at CS:4150, 5814)
- `📨 Kết quả chia sẻ tin nhắn Zalo: tổng ${claimedDetails.length}, thành công ${shareSuccessCount}, thất bại ${shareFailCount}` (CS:6824),
  `⏸ Kết thúc batch: ${stopNote}` (CS:6826)
- Campaign notes: `Toàn bộ ${claimedDetails.length} target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra` (CS:6819),
  `Chiến dịch đã dừng sau batch để chờ kiểm tra lại` (CS:6181), `Tài khoản Zalo cần kiểm tra lại trước khi chạy tiếp` (CS:4864)

Form alerts (Desktop renderer):

- `${file.name || 'File'}: Vượt quá dung lượng tối đa ${formatBytes(sizeLimit)}.` (LCM:189-191),
  `${file.name || 'File'}: Không xác định được đường dẫn local.` (LCM:171), `${file.name || 'File'}: File local không còn tồn tại.` (LCM:175)
- `${label} có file chỉ nằm trên máy local: ${names}${suffix}. Zalo Server chỉ dùng được media đã upload lên cloud.` (CFM:5810)
- `${label} có file không còn tồn tại và không có cloud URL fallback: ${names}${suffix}. Vui lòng xoá file lỗi hoặc chọn lại.` (CFM:5819)
- `Vui lòng nhập nội dung tin nhắn hoặc chọn ít nhất một file.` (CFM:7146-7156)
- Media library upload: `${label} vượt quá dung lượng tối đa ${formatMediaLimitSize(limit)}.` with `label` = `Ảnh` or `File`
  (`src/main/data/repositories/mediaFileRepository.ts:153-161`)

## 6. Validation rules and where they are enforced

| Rule | Where | When | Effect |
|---|---|---|---|
| Any file type for Zalo messages (selection mode `file`) | CFM:2554-2560, LCM:107, 178 | pick and save | no type check |
| Size: image ≤ 5 MB, other files ≤ 25 MB (`MEDIA_IMAGE_MAX_SIZE_BYTES`, `MEDIA_FILE_MAX_SIZE_BYTES`, TYP:184-185) | LCM:184-191; `mediaFileRepository.ts:153-161` | pick; library upload | file rejected; not re-checked at send |
| Text or at least one file | CFM:7146-7156 | save | blocked |
| Zalo Server account: no local-only media | CFM:5805-5813 | save | blocked |
| Local file missing and no cloud URL | CFM:5814-5820 | save | blocked |
| Advanced item without text and without media | CFM:5829-5870 at save; CS:17172-17206 at run start | save; run start | blocked; campaign `chờ xử lý` + note |
| No file-count limit | form has none for Zalo main media (`maxSelect` only for comments, CFM:8884) | | |
| Zalo Web: only JPG, JPEG, PNG, WEBP, GIF | ZR:1900-1903 only (no form check) | each send | fallback failure per target |
| `max_file`, `restricted_ext_file`, `max_size_share_file_v3` (server values per session) | zca-js | each send | fallback failure per target |
| Image dimensions must be readable | ZR:177-186 → zca-js | each send | `Failed to get image metadata` |
| Media source resolvable (local file, or cloud URL within 60 s) | CS:17733-17788 | each send | §4.1 |

## 7. Fly equivalent

### 7.1 Commands

**`send_campaign_media`** payload (RP:335-345, strict):

```ts
{ threadId: string(1..255), threadType: 'user' | 'group',
  files: Array<{ sourceUrl: url(≤10000), fileName: string(1..500) }> (1..10),
  message?: string(1..20000) | { msg, styles... },   // ZaloOutgoingTextSchema, RP:228-231
  mediaCacheKey?: string(1..255), releaseMediaCache?: boolean }
```

- Result: the zca-js `sendMessage` return `{ message, attachment }`, stored in `chat_zalo_action.result` (`markCompleted`,
  CAD:160) and returned by `CampaignCommandClient.execute` (CCC:138-139).
- Failure: the runtime reports `{ status: 'failed', errorCode: commandErrorCode(error), errorMessage }` (RB:260-270, 1277-1284).
  `commandErrorCode` takes `error.code` or `error_code` (Zalo number, errno string, `campaign_media_timeout`,
  `campaign_media_download_failed`, `command_result_unknown`), else `zalo_command_failed`. The dispatcher marks the row
  failed with `deliveryUncertain = code === 'command_result_unknown'` (CAD:150-158). The client throws
  `CampaignCommandError(code, message, deliveryUncertain)` (CCC:138-155) and adds its own codes:
  `campaign_command_cancelled`, `campaign_runtime_unavailable`, or `command_result_unknown` when nothing came back in time (CCC:111-135).
- The text half uses `send_text` (`{ threadId, threadType, message }`, RP:233+); share text uses `forward_message`.

### 7.2 Implementation chain

1. Executor `command()` marks the target started and calls the client (ZE:1657-1678).
2. `CampaignCommandClient.execute` inserts `chat_zalo_action` with idempotency key
   `campaign:${campaignId}:${inputDataId or none}:${unitToken}:${stepKey}`, polls every 100 ms for up to 210 s (CCC:53-136).
3. The chat-api dispatcher sends it to the runtime with a 190 s timeout for `send_media`/`send_campaign_media`, 100 s
   otherwise (CAD:139-160).
4. `AccountSupervisor` queues per account, checks binding, generation and socket (AS:401-426), applies 180 s for media
   and 90 s otherwise (AS:57-60, 868-912), parses the payload and calls `connection.sendCampaignMedia` (AS:464-477) inside
   `runCampaignMediaCommand`, the same fence class as Desktop installed on the Zalo instance before login
   (AS:876-896; ZA:2471-2482, 2531).
5. Adapter `sendCampaignMedia` (ZA:2605-2623): `campaignMediaCache.resolve(files, mediaCacheKey)` →
   `downloadCampaignMediaAttachments` (ZA:911-942: 60 s per file, files in parallel, through the fenced fetch, so the
   download counts toward the 180 s), then `api.sendMessage({ msg: message or '', styles?, attachments: Buffer sources }, ...)`,
   i.e. the same zca-js logic as §3.3.
   - File name (ZA:785-798): snapshot `fileName` if it has an extension, else the URL basename, else `campaign-media`
     plus an extension from a small MIME map (jpg, png, webp, gif, mp4, pdf, zip, txt), else `.bin`.
   - Images (jpg, jpeg, png, webp, gif) must have readable dimensions.
   - Cache (ZA:950-998): per connection, key → download promise, TTL 5 min, at most 4 entries, failed downloads evicted.
   - Errors, all with code `campaign_media_download_failed` (ZA:893-900): `Không tải được media chiến dịch ${fileName}: ${message}`,
     `Không tải được media chiến dịch ${fileName}: HTTP ${status}`, `Không đọc được kích thước ảnh chiến dịch ${filename}.`,
     `Media cache key được dùng với danh sách tệp khác.`
   - Fence timeout → `campaign_media_timeout` with the Desktop message; when the recovery registry refuses it →
     `command_result_unknown`, `Zalo không trả kết quả lệnh đúng hạn (180 giây); không tự thực hiện lại.` (AS:96-109, 884-895).

### 7.3 Old Fly runner

**Per target** (`sendMessage`, ZE:1919-2017):

- Selection (ZE:1882-1905) has the same shape as Desktop; the index comes from the same RPC (ZE:1875-1880, 1934-1948).
- `loadMediaFiles` (ZE:2318-2332): more than 10 files → `Mỗi lượt gửi Zalo Server chỉ hỗ trợ tối đa 10 tệp.`; an entry
  without an `http(s)` source → `Media ${fileName} chỉ có local path; Zalo Server cần cloud URL.`; no source →
  `Media chiến dịch không có nguồn hợp lệ.` (all `CampaignMediaError`).
- No text and no file → `CampaignCommandError("114", "Nội dung và media Zalo đều rỗng.")` before any command (ZE:1952).

| Files | Condition | Commands, in order | `stepKey` | `sequence` |
|---|---|---|---|---|
| ≥ 2 | | `send_campaign_media { threadId, threadType, files }`, then `send_text` when there is text | `send_media`, `send_content` | `media_only` / `media_then_content` |
| 1 | formatted and text | `send_text`, then `send_campaign_media` | `send_content`, `send_media` | `content_then_media` |
| 1 | otherwise | `send_campaign_media { ..., message }` (`message` only with text) | `send_combined` | `combined` / `media_only` |
| 0 | | `send_text` | `send_content` | `content_only` |

- Success: `thành công` / `Đã gửi tin nhắn đến ${target.displayName || target.uid}.` (group `Đã gửi tin nhắn vào group ...`),
  `data = { target, sequence, mediaCount, zaloEngagementSource, messageOptOutSource }` (ZE:1993-2003).
- `campaign_media_download_failed` before anything was delivered → `CampaignMediaError` → target `chờ xử lý` + note,
  campaign paused (`pauseCampaign`), progress `⏸ Dừng chiến dịch: ${note}` (ZE:2005-2007, 1362-1369; ZS:961, 977-981, 1289-1303).
- Other errors → `recordFailure` (ZE:2342-2495). With `partialSend` (second command failed): status `thất bại`,
  log `Đã gửi file nhưng gửi nội dung thất bại. ${rawMessage}` or `Đã gửi nội dung nhưng gửi file thất bại. ${rawMessage}`
  (ZE:2398-2406), quota always counted (ZE:2430-2432), bad target only for media timeout (ZE:2488-2491).
- In `runStep` a recorded failure with a status and no campaign stop lets the target continue (ZE:1190-1209); timeouts and
  uncertain results end the target without retry (ZE:1378-1407).

**Share batch** (ZE:761-1152):

- Text and media once per batch; download failure or invalid media before sending → every input `chờ xử lý`, campaign
  paused (ZE:805-813). Empty → `Vui lòng nhập nội dung hoặc chọn media để gửi Zalo` (ZE:816-820).
- `send_campaign_media` per target in order, `stepKey: share-media-${i}`, `mediaCacheKey: campaign-share-${unitToken}`,
  `releaseMediaCache` on the last target (ZE:858-919).
- Download failure mid-batch → targets from that index requeued and the campaign paused (ZE:878-884, 1029-1037);
  timeouts written inline (ZE:889-916).
- One `forward_message`, `stepKey: share-forward` (ZE:930-956); per-target rows (ZE:1003-1136): success
  `Đã chia sẻ tin nhắn đến ${item.target.displayName || item.target.uid}.` / `Đã chia sẻ tin nhắn vào group ${item.target.displayName || item.target.uid}.`;
  partial as above.
- Summary `📨 Kết quả chia sẻ: ${completedTargets}/${inputs.length} target thành công; ${stopCampaign ? "chiến dịch dừng" : "đã xử lý xong batch"}.`
  and all-failed note `Toàn bộ ${inputs.length} target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra.` (ZE:1137-1145).

### 7.4 Differences from Desktop

1. **Source**: Fly reads `cloudUrl` before `localPath` and rejects anything that is not `http(s)` (ZE:367-381, 2318-2325);
   Desktop prefers an existing local file, then cloud, and passes `data:` through.
2. **File count**: Fly rejects more than 10 files and pauses the campaign; Desktop has no count check and relies on zca-js
   `max_file`, failing every target.
3. **Download**: Fly downloads inside the runtime, in parallel, inside the 180 s fence; Desktop downloads before the send,
   one file after another, 60 s each, outside the fence.
4. **File name and extension**: Fly sends the snapshot name; Desktop sends the temp name for cloud files. Extension
   priority differs (Fly: snapshot name, URL, small MIME map; Desktop: URL, name, larger MIME map), so the same entry
   can be a photo on one host and a file on the other.
5. **Unreadable image dimensions**: Fly → `campaign_media_download_failed` → campaign paused; Desktop → zca-js
   `Failed to get image metadata` → fallback failure per target.
6. **Media resolution failure**: Fly pauses the campaign and requeues the target; Desktop (live deferred path) fails the
   target with `err_undefined` and does not pause. Desktop's legacy path and share mode pause like Fly.
7. **`content_then_media` download failure**: on Fly the text is already sent when the download fails in the second
   command, so it is a partial row; on Desktop media is resolved first, so nothing is sent.
8. **Advanced item without `mediaOption`**: Fly uses `'all'` (`text(optionValue) || "all"`, ZE:1898-1905, 1882-1888);
   Desktop normalises it to `'none'` (ADV:12-17).
9. **Logs**: Fly appends a final period and labels with `displayName || uid`; Desktop has no period and uses
   displayName, originalName, phone, uid. The Fly detail log of a failure is the raw error message, the Desktop log is
   the rendered policy text; the partial prefix is followed by the raw message on Fly and the policy text on Desktop.
10. **`command_result_unknown`**: Fly throws it to failure cleanup before writing any row (`requiresFailureCleanup`,
    ZE:126-132, 2357); Desktop writes a row and stops after the target.
11. **Empty text and no file**: Fly → code `114` (policy of 114 with the campaign action id, ZE:1952, 1409-1420);
    Desktop → zca-js `Missing message content` → fallback.
12. **Pause progress line** for unusable media: Fly prints `⏸ Dừng chiến dịch: ${note}` (ZS:1302); Desktop prints
    `❌ Tạm dừng chiến dịch "${campaign.name}": ${note}` (CS:17821).
13. **Share download**: Fly downloads once per batch through the runtime cache; Desktop resolves once per batch too, but
    reads local files when present.
14. **Zalo Web** does not exist on Fly (Server accounts only).
15. **Batch summary** text differs (§4.2 vs §7.3).

### 7.5 New-engine Fly port (today)

`createFlyZaloPort` implements only `sendText` (`send_text`, `stepKey: send_content`, user thread, plain string) and the
friend request (FZP:141-155). Commands use `unitToken: v2-${targetRunId}` (FZP:101-105). `BEFORE_DISPATCH_CODES` already
lists `campaign_media_download_failed` as "nothing sent" (FZP:26-35); `campaign_media_timeout` falls to
`{ kind: 'fly_command' }` with phase `after_send` (FZP:56-64). Fly's step timeout is `commandTimeoutMs * 2 + 30_000`
(`flyEngineRunner.ts:162`).

## 8. What the core needs

### 8.1 Pure helpers (no I/O)

```ts
export type CampaignMediaItem = string | {
  name?: string; localPath?: string | null; cloudUrl?: string | null
  mimeType?: string | null; sizeBytes?: number | null; provider?: string | null
}

/** hasDeclaredMediaSource (CS:17717-17726). */
export function hasDeclaredMediaSource(item: CampaignMediaItem): boolean

/**
 * resolveCampaignMediaForIndex + resolveMediaSelection without I/O (CS:17400-17427, 17693-17715):
 * advanced → selectAdvancedContentItem(extra, index) with normalised mediaOption ('none' default) and randomMediaCount (3);
 * basic → campaign.images with imageOption ('all' default) and randomImageCount (3);
 * random → [...declared].sort(() => 0.5 - random()).slice(0, Math.max(1, count || 1)).
 */
export function selectZaloCampaignMedia(campaign: ZaloCampaign, variantIndex: number, random: () => number): CampaignMediaItem[]

export type ZaloSendSequence = 'content_only' | 'combined' | 'media_only' | 'media_then_content' | 'content_then_media'
export interface ZaloSendCall { kind: 'media' | 'text' | 'combined'; stepKey: 'send_media' | 'send_content' | 'send_combined' }
/** dispatchZaloMessage table of §3.1; stepKeys match the old Fly runner so runtime idempotency keys stay the same. */
export function planZaloSend(input: { fileCount: number; hasText: boolean; formatted: boolean }): { sequence: ZaloSendSequence; calls: ZaloSendCall[] }
```

`ZaloCampaign.images` already exists; `ZaloCampaign.extraSettings` carries `imageOption`, `randomImageCount`,
`advancedContentEnabled`, `advancedContentItems`, `formattedContentEnabled`. Port `normalizeAdvancedContentItems` and
`selectAdvancedContentItem` from ADV verbatim (core `content/`), and `MT` extension lists (already mirrored in `validation.ts`).

### 8.2 Port additions (`ZaloCampaignPort`, `zalo/registry.ts:17`)

```ts
export interface ZaloMediaFile { name: string; kind: 'image' | 'gif' | 'video' | 'file'; ref: unknown /* host-owned */ }
export interface ZaloSendReceipt { response: unknown; msgIds: string[] }   // msgIds = engagementMessageIds(response)

/** Make the selected entries sendable. Throws ZaloPortError (phase before_send) when one cannot be used. */
prepareMedia(ctx: StepContext, items: readonly CampaignMediaItem[]): Promise<ZaloMediaFile[]>
/** One send with files; `message` only for the 'combined' call. */
sendMedia(ctx: StepContext, input: { threadId: string; threadType: 'user' | 'group'; files: readonly ZaloMediaFile[];
  message?: ZaloOutgoingText; stepKey: string }): Promise<ZaloSendReceipt>
/** Text (plain or styled) to a user or a group; generalises today's sendText(ctx, uid, string). */
sendMessage(ctx: StepContext, input: { threadId: string; threadType: 'user' | 'group'; message: ZaloOutgoingText;
  stepKey: string }): Promise<ZaloSendReceipt>
/** Called once when the target ends (success, failure or cancel). Desktop deletes temp downloads. */
releaseMedia?(ctx: StepContext): Promise<void>
/** For CFG10-CFG12 checks; null when the host cannot tell. */
mediaAccountInfo?(): Promise<{ zaloWeb: boolean; limits: ZaloShareFileLimits | null } | null>
```

| Method | Desktop implementation | Fly implementation |
|---|---|---|
| `prepareMedia` | `resolveCampaignMediaSource` + `downloadCampaignMediaUrl` (CS:17733-17800), temp paths kept per target; `CampaignMediaResolveError` → `ZaloPortError` with `{ kind: 'engine', code: 'media_unavailable', errorCode: 'err_media_file_missing' }`, phase `before_send`, message verbatim | `loadMediaFiles` rules (ZE:2318-2332): `{ sourceUrl, fileName }`; same error mapping; >10 files → CFG11 issue (or the same `media_unavailable` signal) |
| `sendMedia` | `zaloRuntime.sendMessageTo{User,Group}(accountId, threadId, message ?? '', files, true)`; map with the send classifier, plus the special codes below | `send_campaign_media` with `{ threadId, threadType, files, ...(message ? { message } : {}) }`, `contentText` = text when combined, `stepKey` as planned |
| `sendMessage` | `sendMessageTo{User,Group}(accountId, threadId, message, [], false)` | `send_text`, `stepKey: send_content`, `contentText` = text |
| `releaseMedia` | `cleanupCampaignMediaTempFiles` (CS:17824-17832) | no-op (runtime cache) |

Error mapping the ports must add for the fence codes (both hosts produce the same three codes):

| Code | Must become | Why |
|---|---|---|
| `campaign_runtime_unavailable` (Desktop fence closed) | phase `before_send` | nothing was sent; today `zaloPortErrorFrom(..., { operation: 'send' })` would classify it `in_flight` (errno kind, not transport) |
| `campaign_media_timeout` | phase `in_flight`, `deliveryState: 'unknown'`, the same signal kind on both hosts | V495 has a rule only for `{ kind: 'fly_command', code: 'campaign_media_timeout' }` (migration_v495:2009); on Desktop it reaches UNK01 only through the V500 `in_flight` catch-all |
| `command_result_unknown` | phase `in_flight`, `deliveryState: 'unknown'` | as above (migration_v495:2002) |
| `campaign_media_download_failed` (Fly) | phase `before_send` (already in FZP:26-35) | V495 maps it to CFG01 (migration_v495:2013) |

### 8.3 Step logic (one delivery step, e.g. `message`, inside `buildZalo...Steps`)

```text
1. prepared = prepare text exactly as today (variant via takeContentIndex, render, opt-out footer, AI rewrite as Desktop)
   media    = selectZaloCampaignMedia(campaign, prepared.variantIndex, random)   // only after the index is known
2. files    = media.length ? await port.prepareMedia(ctx, media) : []           // failure → RawOutcome below
3. plan     = planZaloSend({ fileCount: files.length, hasText, formatted })
   empty text and no file → { ok:false, phase:'before_send', signal:{ kind:'engine', code:'empty_content' } }
4. run plan.calls in order; remember receipts of finished calls
5. map to RawOutcome (table below); always data = { target, message, attachments: file names, sequence, responses }
6. port.releaseMedia?(ctx) when the target ends
```

| Situation | RawOutcome |
|---|---|
| all calls OK | `ok: true`; customerLog `Đã gửi tin nhắn đến ${label}` (group: `Đã gửi tin nhắn vào group ${label}`); evidence `{ msgId: msgIds[0] ?? null }` (an empty msgId stays a success, as today) |
| first or only call fails | `zaloFailure(err, 'after_send', data)`; timeout and unknown carry `in_flight` + `deliveryState: 'unknown'` from the port |
| second call fails | `{ ok: false, phase: err.phase ?? 'after_send', signal: err.signal, evidence: { partialDelivery: true, partialStage: 'content_after_media' or 'media_after_content', sequence, msgId: first-call msgId }, data }` |
| `prepareMedia` fails | `{ ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'media_unavailable', errorCode: 'err_media_file_missing', message: 'Không dùng được media "..." ...' } }` |

### 8.4 Contract and DB gaps to close before media runs on the core

1. **Partial prefix in the log.** A failed `RawOutcome` has no `customerLog`, and `report_v1` renders only policy templates
   for failures (migration_v495:1202-1215). Either add an optional failure `customerLogPrefix` to `RawOutcome`/`ReportOutcome`
   that `report_v1` prepends, or let `report_v1` add `Đã gửi file nhưng gửi nội dung thất bại. ` /
   `Đã gửi nội dung nhưng gửi file thất bại. ` from `evidence.partialStage`.
2. **Partial row semantics** (Desktop, CS:15644-15672): row always written with status `thất bại`, quota counted, streak
   ignored unless the cause is `campaign_media_timeout`, target never requeued. V495 already counts quota for `partial`
   (migration_v495:1179-1182) and blocks requeue after a delivery (`no_requeue_after_delivery`, :1372-1381); it does not
   force the row (a `suppress` policy such as Z802 for strangers would write nothing) and takes the streak from the policy.
3. **Step deadline.** A media step can take: downloads (Desktop up to 60 s per file, sequential) + 180 s (any file that
   needs the WebSocket callback; 90 s photos only) + 90 s for the text half + up to 20 s listener refresh. Desktop's
   `STEP_TIMEOUT_MS = 150_000` (`src/main/engineAdapters/desktopEngineRunner.ts:23`) is too short. Fly's
   `commandTimeoutMs * 2 + 30_000` covers two 210 s commands. A deadline hit after `markSending` is reported `in_flight`
   (`boundary.ts:82-87`), so a slow download would be booked as "maybe sent": give `prepareMedia` its own deadline and
   report its failure `before_send`, or move preparation into a non-delivery step.
4. **No per-target cleanup hook** in `runUnit`; `releaseMedia` needs one (or the step must clean up in its own `finally`).
5. **`✅ Hoàn thành` after partial/timeout.** `runUnit` prints it for every target that ends `hoàn thành`
   (`runUnit.ts:249-251`); Desktop does not print it when the target was closed because a delivery cannot be retried
   (CS:4732-4741). Decide whether to keep Desktop's silence.
6. **Hidden partials (ZL-E11, ZL-E12)** are invisible to the core when one zca-js call sends text and file, or several
   album items. To reproduce Desktop exactly, keep them ordinary failures; the approved structure
   (`docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md` §3, "Album hoặc chữ + tệp gửi được một phần") would need the
   port to report `partialDelivery` from the zca-js response, which zca-js does not expose on rejection.
7. **Approved deviations to decide explicitly** (same review, and `docs/CAMPAIGN_OUTCOME_ENGINE.md` §7):
   CFG10 (Zalo Web image only), CFG11 (file count), CFG12 (blocked extension) checked once in `validateCampaign`
   (`validation.ts:67-93`, policies migration_v495:2095-2097: pause once, no row, data requeued) instead of Desktop's
   per-target fallback failure; CFG01 for unusable media on both hosts (Desktop today: `err_undefined` per target);
   "split upload from send" (an upload-server error is `before_send`) is listed for phase 3 and is not possible with one
   zca-js call.
8. **Share mode** sends to up to 50 targets with one forward call; it needs a batch unit (claim many targets, one
   `markSending`, per-target outcomes). It cannot be expressed with the current one-target `runUnit` and should stay on
   the legacy runners until that exists. `zaloMessagePhoneV2Support` already refuses `share_mode`.
9. **History data.** Desktop stores machine-local temp paths in `data.attachments`; Fly stores `mediaCount`. Store file
   names (or names and count) in the core to keep rows comparable across hosts.
10. **Lift the gate per type.** Remove `no('media')` from the type's `support` only when 1-9 are settled; engagement tracking
    (`zalo.campaign_engagement.enabled`) still forces the legacy runner.
