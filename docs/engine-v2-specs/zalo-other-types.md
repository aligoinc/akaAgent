# Zalo campaign types other than `zalo_message_phone`: behavior spec for the engine v2 core

Read-only research, 12/11/2026. This spec describes what the Desktop/VPS runner does today for the ten other Zalo
campaign types (Desktop/VPS is the standard), what the old Fly path does, and what the shared core needs to run them.
Vietnamese strings are verbatim, including emoji and `${...}` placeholders.

Sibling specs cover the shared features in depth. This file only states, per type, whether a feature applies and how:

| Spec | Covers |
|---|---|
| `zalo-gates-content.md` | Delivery cooldown, send exclusions, the legacy friend blocklist, the opt-out check and link, advanced and formatted content, AI rewrite |
| `zalo-media.md` | Media selection, send sequences (album, caption, partial send), share-mode media |
| `zalo-aux-actions.md` | Zalo tag, alias, akaBiz tag |
| `zalo-scheduling-completion.md` | Dispatch, maintenance, completion chain, multi-slot, share repeat, data groups, pause |

## Sources and abbreviations

Desktop paths are relative to the akaAgent worktree `.claude/worktrees/campaign-engine-v2`; Desktop line numbers follow
commit `24ff928c` (HEAD). Fly paths are relative to `/Users/lequangnhut/Repos/akaAgentChatApi-deploy-dbb38b7`; Fly line
numbers follow commit `dbb38b7`. Files that are not committed (DER, FER, the core, FX) follow the working copy.

| Short | Path |
|---|---|
| CS | `src/main/services/campaignScheduler.ts` |
| ZR | `src/main/services/zaloRuntimeService.ts` |
| RG | `src/main/services/zaloRealtimeGroupCampaignManager.ts` |
| CR | `src/main/data/repositories/campaignRepository.ts` |
| AD | `src/shared/campaignActionDescriptors.ts` |
| BH | `src/main/v2/runtime/blockHelpers.ts` |
| AR | `src/main/services/actionResultRuntime.ts` |
| DER | `src/main/engineAdapters/desktopEngineRunner.ts` (not committed) |
| CFM | `src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx` |
| SNAP | `migrations/snapshots/campaign-content-v350/source.json` (production rows captured 06/10/2026 08:16 UTC) |
| MP, RU, CT, AUX, REG, PG | core `packages/campaign-engine/src/zalo/messagePhone.ts`, `runUnit.ts`, `contracts.ts`, `zalo/auxiliary.ts`, `zalo/registry.ts`, `progress.ts` |
| ZE | Fly `apps/system-worker/src/zaloCampaignExecutor.ts` |
| ZS | Fly `apps/system-worker/src/zaloCampaignScheduler.ts` |
| IM | Fly `apps/system-worker/src/campaignInputMaterializer.ts` |
| RE | Fly `apps/system-worker/src/campaignRealtimeEventEnqueuer.ts` |
| RR | Fly `packages/database/src/campaignRealtimeRepository.ts` |
| CRR | Fly `packages/database/src/campaignRuntimeRepository.ts` |
| AS | Fly `apps/zalo-server-runtime/src/accountSupervisor.ts` (command dispatch switch) |
| ZA | Fly `packages/zalo-zca-adapter/src/index.ts` |
| FER | Fly `apps/system-worker/src/campaignEngine/flyEngineRunner.ts` (not committed) |
| FX | `packages/campaign-engine/fixtures/akachat-catalog-20261106.json` (read-only catalog snapshot, 06/11/2026, before V495–V500) |

Notes on the sources:

- **Line numbers follow the commits, not the working copies.** Another session edits several cited files in parallel
  (the scheduler changed several times during this research), so every reference also names the function or quotes the
  text. To read the cited version: `git show 24ff928c:<path>` (Desktop) and `git show dbb38b7:<path>` (Fly). To map to
  the working copies as of 12/11 02:30:
  - CS (17,834 lines, saved 02:27): add 5 to HEAD lines 95-351, subtract 5 from 362-877 (HEAD 352-361 are deleted),
    subtract 3 from 878-899, add 17 to 900-1064, add 18 to 1065-2038, add 43 to 2039-3491 and add 86 to 3492-17682.
    The 25 lines after HEAD line 2038 are the uncommitted engine-runner routing hook (§1.1).
  - ZR: the working copy adds `findUserByPhoneOnce` (15 lines) after HEAD line 1568; add 15 from line 1569.
  - ZS (1,601 lines, saved 02:23): add 19 to `dbb38b7` lines 416-1003 and 48 from line 1004.
  - RR and CRR: the working copies add one import line at the top; add 1.
  - ZE, IM, RE, AS, ZA and CC are unchanged from `dbb38b7`. RG, CR, AD, BH, AR and CFM are unchanged from HEAD.
- **The core is being edited in parallel.** During this research `zalo/registry.ts`, `zalo/auxiliary.ts` and the
  `noOutcome` field of `RawOutcome` (CT) appeared, and `runUnit.ts` grew from 434 to 510 lines. These files kept
  changing (last seen 12/11 02:41), so references to the core, DER and FER give the symbol only, without line numbers.
- **Workflows and blocks live in the DB.** The block code below comes from the seeding migrations and SNAP (blocks
  2769–2791, workflows 260–281). SNAP does not contain the join, cancel and add-member workflows; for those, only the
  seeding migrations were read (`migration_v133`, `v135`, `v160`). `migration_v351_campaign_content_blocks.sql` only
  set `default_variables.campaignContentPreparationVersion = 1` on the Zalo workflows; it did not change Zalo block code.
- **`auto_error` and status policies are DB data.** The tables below quote FX. The old runners read these rows; engine v2
  reads `auto_outcome_signal_rules` / `auto_outcome_policies` (V495, V500).

---

## 0. Summary

| Type (`auto_campaign_actions.id`) | Campaigns (30 days) | Desktop workflow nodes (in order) | Quota codes (`limit_check_action_codes`, FX) | Codes checked for lock/quota (AD:93-153) | Targets come from | Share mode | Core today |
|---|---|---|---|---|---|---|---|
| `zalo_message_group_member` | 843 | resolve → stranger message → friend request → tag → alias (wf 272) | `zalo_message_stranger`, `zalo_add_friend` | stranger if `enableMessage`, add friend if `enableAddFriend` | Form picker of scanned group members, UID upload, data group | no | legacy |
| `zalo_message_friend` | 289 | friend message → tag → alias (wf 266) | `zalo_message_friend` | `zalo_message_friend` | Picker of friends (`selected`), or all friends / tagged friends read live once | yes | legacy |
| `zalo_message_group` | 226 | group message (wf 268) | `zalo_message_group` | `zalo_message_group` | Picker of groups, data group | yes | legacy |
| `zalo_cancel_sent_friend_request` | 41 | cancel (wf from v135) | `[]` (no quota) | `zalo_cancel_sent_friend_request` (lock only) | Sent requests read live each pass | no | legacy |
| `zalo_add_group_member` | 37 | resolve (UID or phone lookup) → add (wf from v160) | `zalo_add_group_member` | `zalo_add_group_member`, plus `zalo_find_phone_user` at run time for phone rows | Picker of group members or friends, phone upload, data group | no | legacy |
| `zalo_message_remarketing_customer` | 9 | resolve → stranger message → friend request → tag → alias (wf 274) | `zalo_message_stranger`, `zalo_add_friend` | as group member | Picker of "old customers" (past message details) | no | legacy |
| `zalo_join_group_link` | 7 | join (wf from v133) | `zalo_join_group_link` | `zalo_join_group_link` | Links entered by hand or pushed by a Facebook find-data campaign | no | legacy |
| `zalo_message_birthday` | 3 | friend message (wf 270) | `zalo_message_friend` | `zalo_message_friend` | Friends whose `sdob` is today, read live once per VN day | no (ignored) | legacy |
| `zalo_message_friend_recommendation` ("Nhắn tin, kết bạn theo đề xuất Zalo", CS:644) | 3 | resolve → stranger message → friend request → tag → alias (wf 280) | `zalo_message_stranger`, `zalo_add_friend` | as group member | Zalo recommendations read live once per pass | no | legacy |
| `zalo_message_group_realtime` | 1 | same blocks as group member (wf 276) | `zalo_message_stranger`, `zalo_add_friend` | as group member | Live group events (join/leave/interact) | no | legacy |

"Core today" = the type is not in `ZALO_CAMPAIGN_TYPES` (REG), so `zaloCampaignV2Support` returns
`action_not_supported` and both DER (`DesktopEngineRunner.support`) and FER
(`FlyEngineRunner.accepts`) send the campaign to the old runner.

---

## 1. Shared Desktop machinery

### 1.1 How a Zalo campaign runs on Desktop/VPS

- `runAccountCampaignQueue` (CS:2006) asks the engine runner first, through a routing hook that is not committed (in
  the working copy it is the block after HEAD line 2038). Only `zalo_message_phone` without unsupported features is
  accepted; every type in this spec goes to `executeCampaign` (CS:3516) → `executeCampaignWithResultContext`
  (CS:3520-3883) → `executeCampaignV2` (CS:3894-5067).
- Before `executeCampaignV2` (in order): campaign re-read, preclaim limit note (CS:3539-3555), runtime claim RPC
  (CS:3558-3616), send-exclusion snapshot when supported (CS:3657-3667), find-data wait note (CS:3705-3709, only
  join-link campaigns among these types), entitlement (CS:3711-3720), workflow id (CS:3728-3732), realtime pre-check
  (CS:3734-3737), Zalo session check (CS:3742-3745), result-status declarations and `beginActionResultRun`
  (CS:3764-3788), then `🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"` (CS:3790).
- **The `🚀` line is written before any target work**, including materialization; a realtime campaign that has nothing
  to run returns at CS:3734-3736 before the `🚀` line.
- All eleven Zalo types are "browserless" (CS:7564-7576): no browser page, `page = null` (CS:4352-4355).
- Desktop QR accounts (`is_zalo_server = false`) run here. The App Server (VPS) runs the same file with
  `runtimeTarget = 'server'` for Zalo Server accounts (§1.10). Zalo Web accounts (`is_zalo_show_web`) also run here.

### 1.2 Workflows and block code (DB)

Every helper is called through a DB workflow; edges form a straight chain. A block that returns `ok: false` does not stop
the chain (the engine only treats it as a screenshot "failure", `src/main/v2/runtime/workflowEngine.ts:869-873`); only a
thrown error fails the run. The next block receives the previous block's output (`input.zaloTarget`).

| Workflow (id in SNAP) | Node → block (block id) | Block code (helper call) |
|---|---|---|
| `zalo_message_friend` (266) | `send_message` → `zalo_send_friend_message` (2780) | `helpers.zaloSendFriendMessage({ targetUid: vars.targetUid \|\| vars.inputDataUid, targetName: vars.targetName \|\| vars.inputDataName, message: vars.campaignContent, attachments: vars.images, inputData: vars.inputData })` |
| | `apply_tag` → `zalo_apply_contact_tag` (2772) | `helpers.zaloApplyContactTag({ target: input.zaloTarget, enabled: vars.enableZaloTag, labelId: vars.zaloTagId, labelName: vars.zaloTagName })` |
| | `change_alias` → `zalo_change_contact_alias` (2773) | `helpers.zaloChangeContactAlias({ target: input.zaloTarget, enabled: vars.enableZaloAlias, alias: vars.zaloAlias, inputData: vars.inputData })` |
| `zalo_message_birthday` (270) | `send_message` → `zalo_send_friend_message` (2780) | as above (no tag/alias nodes) |
| `zalo_message_group` (268) | `send_group_message` → `zalo_send_group_message` (2781) | `helpers.zaloSendGroupMessage({ targetUid: …, targetName: …, message: vars.campaignContent, attachments: vars.images, inputData: vars.inputData })` |
| `zalo_message_group_member` (272), `zalo_message_group_realtime` (276) | `resolve_member` → `zalo_resolve_group_member_target` (2782) | `helpers.zaloResolveGroupMemberTarget({ targetUid: vars.targetUid \|\| vars.inputDataUid, targetName: vars.targetName \|\| vars.inputDataName, inputData: vars.inputData })` |
| | `send_message` → `zalo_send_group_member_message` (2783) | `helpers.zaloSendPhoneMessage({ target: input.zaloTarget, enabled: vars.enableMessage, message: vars.campaignContent, attachments: vars.images, inputData: vars.inputData })` |
| | `send_friend_request` → `zalo_send_group_member_friend_request` (2784) | `helpers.zaloSendPhoneFriendRequest({ target: input.zaloTarget, enabled: vars.enableAddFriend, message: vars.friendRequestMessage, inputData: vars.inputData })` |
| | `apply_tag` (2772), `change_alias` (2773) | as above |
| `zalo_message_remarketing_customer` (274) | `resolve_customer` → `zalo_resolve_remarketing_customer_target` (2785), then 2786 / 2787 (same code as 2783 / 2784), 2772, 2773 | `helpers.zaloResolveRemarketingCustomerTarget({…same as 2782…})` |
| `zalo_message_friend_recommendation` (280) | `resolve_recommendation` → `zalo_resolve_friend_recommendation_target` (2789), then 2790 / 2791 (same code as 2783 / 2784), 2772, 2773 | `helpers.zaloResolveFriendRecommendationTarget({…same as 2782…})` |
| `zalo_add_group_member` (`migration_v160…:119-123`) | `resolve_target` → `zalo_resolve_add_group_member_target` | `helpers.zaloResolveAddGroupMemberTarget({ targetUid: vars.targetUid \|\| vars.inputDataUid, phone: vars.targetPhone \|\| vars.inputDataPhone, targetName: vars.targetName \|\| vars.inputDataName, inputData: vars.inputData })` (`v160:38-45`) |
| | `add_member` → `zalo_add_group_member` | `helpers.zaloAddGroupMember({ target: input.zaloTarget, targetGroupId: vars.zaloAddGroupMemberTargetGroupId, targetGroupName: vars.zaloAddGroupMemberTargetGroupName, useShareMethod: vars.zaloAddGroupMemberUseShareMethod, inputData: vars.inputData })` (`v160:60-68`) |
| `zalo_join_group_link` (`migration_v133…:92`) | `join_group` → `zalo_join_group_link` | `helpers.zaloJoinGroupLink({ targetLink: vars.targetUid \|\| vars.inputDataUid, targetName: vars.targetName \|\| vars.inputDataName, inputData: vars.inputData })` (`v133:37-43`) |
| `zalo_cancel_sent_friend_request` (`migration_v135…:97`) | `cancel_friend_request` → `zalo_cancel_sent_friend_request` | `helpers.zaloCancelSentFriendRequest({ targetUid: vars.targetUid \|\| vars.inputDataUid, targetName: vars.targetName \|\| vars.inputDataName, sentAt: vars.sentAt \|\| vars.inputData?.info1, requestMessage: vars.requestMessage \|\| vars.inputData?.info2, inputData: vars.inputData })` (`v135:38-46`) |

Helpers are wired in `createBlockRuntimeHelpers` (CS:16373-16493). Each Zalo helper runs through `runZaloAction`
(CS:16382-16388): once a helper returns a detail with `stopRemainingActions` (media timeout or `command_result_unknown`),
every later helper of the same input returns `{ ok: true, skipped: true, zaloTarget }` without calling Zalo.

### 1.3 Variables the blocks read (`buildVariablesV2`, CS:10448-10794)

- `targetUid = detail.uid`, `targetName = detail.name`, `targetPhone = detail.phone` (CS:10752-10754).
- `inputData = { id, name, phone, uid, email, info1..info5 }` (CS:10769-10780) plus `inputDataUid/Name/Phone/…`
  (CS:10781-10792). **Only `info1..info5` reach the templates.**
- `enableMessage`: always `!skipMessageByLimit` for friend, birthday and group; `extra.enableMessage && !skipMessageByLimit`
  for the stranger types (CS:10700-10706). `enableAddFriend`: `false` for friend, birthday, group;
  `extra.enableAddFriend && !skipAddFriendByLimit` otherwise (CS:10707-10713). The "skip by limit" flags come from
  `continueWhenActionLimitReached` (§1.7).
- `friendRequestMessage = extra.friendRequestMessage`, `enableZaloTag`, `zaloTagId`, `zaloTagName`, `enableZaloAlias`,
  `zaloAlias = extra.zaloAliasTemplate`, `zaloAddGroupMemberTargetGroupId/Name/UseShareMethod` (CS:10760-10768).
- `campaignContent` and `images`: with the deferred content preparation flag set on every Zalo workflow, the helpers
  choose text and media at send time; see `zalo-media.md` §2.2 and `zalo-gates-content.md` §5–7.

### 1.4 Per-target loop (`executeCampaignV2`, CS:4151-5057)

For each input row (`targets = details`, or `[null]` when the campaign has no row at all, CS:4137-4138):

1. Skip rows that are not `chờ xử lý` (CS:4162). Run-boundary, runtime-stop, pause and hard-end checks
   (CS:4168-4217).
2. Future `schedule` → remember the earliest and skip (CS:4219-4229).
3. Legacy friend blocklist (friend only): `markZaloFriendBlocklistSkipped` (CS:4231-4236).
4. Opt-out preflight for `ZALO_MESSAGE_OPT_OUT_ACTION_IDS` (CS:646-654: phone, friend, birthday, group member, realtime,
   remarketing, recommendation; **not** group, add member, join, cancel) (CS:4238-4241). For non-phone types it reads the
   profile (`getUserProfile`), checks input phone, profile phone and global ID, then the send-exclusion gate
   (CS:7226-7309). Blocked rows are paused before any claim.
5. Delivery cooldown when enabled for the type (CS:4243-4259).
6. Opt-out link preparation (CS:4261-4269).
7. Lock check on executable codes, then quota on quota codes (CS:4320-4349).
8. Variables (CS:4425-4434), atomic unit claim `beginCampaignRunUnit` (CS:4470-4475), then
   `▶️ Xử lý "${inputDataName}" trong chiến dịch "${campaign.name}"` (CS:4485).
9. Account guard every 5 s during the run (CS:4503-4535), workflow run (CS:4548-4582).
10. History rows and progress lines from the helper results (§1.5), input status (CS:4688-4745), bad-target counter
    (CS:4750-4823), "stop after target" (CS:4826-4841).
11. Unit settlement (CS:5020), then `⏳ Nghỉ ${sleepTime}s trước khi xử lý mục tiếp theo...` and the sleep, except after
    the last row (CS:5036-5056). The sleep length is `getEffectiveSleepBetweenActions` (CS:9233-9240): account group →
    `actionLimits.sleepBetweenActions` → 0 s.
12. After the loop: `deferCampaignUntilFutureInput` (CS:3320-3328) or `handleCampaignCompletion` (CS:2286-2331).

**Edge case.** When a direct-mode campaign has **no rows at all**, the workflow runs once with `detail = null`
(CS:4137-4138). The resolve or send helper then reports its "invalid UID / ID / link" policy detail (§1.6) without an
input id, and the campaign completes. Fly completes such a campaign without any detail (§4).

### 1.5 From helper result to history row and progress line

All eleven types use `logZaloMessagePhoneMilestones` (CS:11669-11672 → 11446-11511):

- A step output with `detail` (`ZaloActionDetailOutput`, BH:136-159) creates one `auto_campaign_details` row:
  `actionCode`, `actionName`, `status` (default `lỗi`), `errorCode`, `log`, `data`, `shouldCountAction =
  countsTowardLimit === true`, `resultSourceKey`, result guards (CS:11472-11485, guards CS:10997-11008).
- When the run is managed by the action-result layer, `createCampaignDetail` goes to `writeManagedActionResult`
  (CR:6410 → AR:139-185, RPC `aka_agent_write_action_result_v1`), and input updates go to
  `aka_agent_settle_action_results_v1` (CR:5461 → AR:211-217 → `settle`, AR:187-209). **The final quota count and input status are then decided
  by `auto_account_action_status_policies` in the DB**, with `auto_error` overrides; tag and alias are always "auxiliary"
  (AR:160).
- `detail.createDetail === false` or no `status` → no row; the line is `⚠️ ${formatZaloProgressLog(detail)}`
  (CS:11304-11308). Otherwise the line is `formatZaloProgressLog({ actionName, log })` (CS:11309-11315):
  `${actionName}: ${log}`, or just `log` when it already starts with the action name (CS:11292-11302). **Detail lines carry
  no emoji.**
- Lines are written after the workflow returns, in node order. Lines a helper writes itself during the run (akaBiz,
  tag skip, AI fallback, friend-status warning) therefore come **before** the detail lines of the same input.
- `pushZaloMilestoneToSms` runs for every created row (CS:11506-11508); it only acts for `zalo_message_phone` and
  `zalo_message_group_member` (CS:662-665, §2.1).
- `applyHelperMilestoneControls` (CS:11010-11049) folds each detail into the target summary:
  - a successful `zalo_message_stranger` / `zalo_message_friend` / `zalo_message_group` sets `deliveryCommitted`
    (CS:14981-14985);
  - `resetInputToPending` after a committed delivery becomes "do not retry" with note
    `${downstreamFailure}. Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.` (CS:11034);
  - `stopAfterTarget` keeps the policy notice as `pendingNote`.
- Input status after the target (CS:4688-4745):

  | Case | Input status | Note | Line |
  |---|---|---|---|
  | Workflow completed, summary asks requeue (policy without a detail status) | `chờ xử lý` | `pendingNote` + opt-out warnings | none |
  | Workflow completed, otherwise (**also when a send failed**) | `hoàn thành` | `null` + opt-out warnings | `✅ Hoàn thành "${name}"` (CS:4729) |
  | Delivery committed and the run was cancelled / account stopped | `hoàn thành` | `${reason}. Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.` or `Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.` (CS:4700-4704) | none |
  | Workflow failed (a helper threw) | `hoàn thành` | `result.error` or `Lỗi không xác định` | `❌ Lỗi "${name}": ${errMsg}` (CS:4744) |
  | Exception around the run | `hoàn thành` (or `chờ xử lý` when the account stopped or the run was paused) | error text | `❌ Lỗi engine v2 "${campaign.name}": ${errMsg}` (CS:4948) |

- Bad-target counter (CS:4750-4823): a failed run uses its runtime error policy; otherwise, if the summary has a hard
  failure or error, or a failure without any success, `handleCampaignBadTarget(…, 'err_undefined', …)` counts one bad
  target; a success resets the counter. Policy rows with `counts_toward_bad_target = false` and tag/alias never count
  (CS:14728-14737). The threshold comes from `err_undefined` (FX: 4 in a row → campaign `tạm dừng`).
- `stopAfterTarget` (set by a policy side effect) → campaign `chờ xử lý` with the policy notice, line
  `⏸ Dừng chiến dịch: ${note}`, fallback note `Tài khoản Zalo cần kiểm tra lại trước khi chạy tiếp` (CS:4826-4841).

### 1.6 Errors → policy → history row

`createZaloErrorDetail` (CS:14827-14909) for thrown Zalo/runtime errors, `createZaloPolicyDetailFromCode`
(CS:14911-14970) for validation failures the app detects itself (always called with code `114`):

1. Raw code: `ZaloApiError.code`, else `err.code` (CS:14573-14581). Message: `err.message` (CS:14566-14571).
2. Policy: `getZaloErrorPolicyByCode(code, actionCode)` (rows whose `zalo_error_codes` contain the code and whose
   `zalo_action_codes` is empty or contains the action), else `err_zalo_api_business_failed` (CS:14599-14608).
   **The `114` validation lookups pass no action code** (e.g. CS:15350), so action-specific `114` rows are ignored there.
3. History `log` (`renderZaloPolicyLog`, CS:14614-14632):
   - `err_zalo_api_business_failed` → `${actionName || 'Thao tác Zalo'} thất bại: ${message}${suffix}` with
     suffix ` (mã Zalo: ${zaloCode})` when there is a code (CS:14583-14587);
   - otherwise `noti_running_process || noti_campaign` with `[x]`/`message` = raw message, then raw message, then
     `error_name`.
   - **So a missing UID logs the 114 policy text** (FX: `Tham số không hợp lệ`), not the helper's sentence; the
     helper's sentence goes to `data.error`.
4. Campaign/lock note (`renderZaloPolicyCampaignNote`, CS:14634-14651): `noti_campaign || noti_running_process` with
   `[x]`/`[t]` = lock minutes unless `days_at_time`.
5. Side effects (`applyZaloPolicySideEffects`, CS:14653-14696), only when `policyHandling = 'full'` (CS:14854-14863):
   `update_login_status` (and runtime invalidation), `update_status_account`, `disable_action_codes` (lock with the
   campaign note as reason), `update_status_campaign`. Each sets `stopAfterTarget`.
6. Detail: `createDetail = Boolean(detail_status)`, `status = detail_status` (or `thất bại` for `target-only` in share
   batches), `errorCode = policy.error_code`, `countsTowardLimit = policy.counts_toward_limit ?? true`,
   `countsTowardBadTarget` (false for tag/alias and `target-only`), `resetInputToPending = !detail_status` (except media
   timeout / unknown delivery), `preventInputRetry` and `stopRemainingActions` for `campaign_media_timeout` and
   `command_result_unknown`, `data = { ...context, error: rawMessage, zalo: { code, message, policyErrorCode } }`.
7. `createZaloErrorDetail` also writes `auto_zalo_api_error_logs` with `api_name` from `getZaloApiName` (CS:14698-14725:
   `sendMessage`, `sendFriendRequest`, `undoFriendRequest`, `addUserToGroup`, `joinGroupLink`, `updateLabels`,
   `changeFriendAlias`, `findUser`).

### 1.7 Quota and locks

- Codes (AD:193-296, 305-355): executable codes are always checked for locks; quota codes come from
  `limit_check_action_codes` filtered by `extra.actionLimits.enabledActionCodes` and by the switches (AD:93-153).
  Tag and alias are never checked (AD:147-149).
- Before each target: `checkActionDisabled` → `handleLimitStatus` stops the campaign at the first locked code
  (CS:4321-4327); `checkActionLimitsForContinuation` → stop on the first blocked quota (CS:4329-4342); a DB error
  releases the campaign with `⚠️ Không thể kiểm tra giới hạn hành động từ DB; chiến dịch sẽ tự thử lại: ${getErrorMessage(err) || 'Lỗi không xác định'}`
  (CS:4343-4349).
- `continueWhenActionLimitReached` (CS:8957-9122): `zalo_message_stranger` and `zalo_add_friend` may be skipped on
  day/hour quota for the stranger types (CS:8988-8996). Each skipped code is logged once per run:
  `⚠️ Bỏ qua ${this.getLimitActionName(status)} vì đã đạt giới hạn: ${note}` (CS:9041-9053). If every code is skipped
  the campaign stops (CS:9103-9114). Locks are never skipped.
- Stop lines (CS:9802-9831): `⚠️ Tạm dừng "${campaign.name}": ${note}` with the campaign `chờ xử lý`; limit errors with
  an error code go through `handleRuntimeError`.
- Preclaim (before the claim): a blocked campaign gets the note and `⚠️ Chưa thể chạy chiến dịch: ${note}`
  (CS:9843-9859).

### 1.8 Completion, pacing and per-type completions

See `zalo-scheduling-completion.md` §5 for the chain. Type-specific parts are in each section below. Lines used by
several types:

- `✅ Hoàn thành chiến dịch "${campaign.name}"` (CS:2330-2332), with suffixes `(hết ngày kết thúc)` (CS:2311),
  `(hết ngày nhận data theo thời gian thực)` (CS:2384, 3401), `(không còn khung giờ chạy trong hôm nay)` (CS:2425),
  `(khung giờ ${nextSlot} vượt quá giờ dừng trong ngày)` (CS:2435), `(không có data cần chạy lại ${labels.emptyDataSuffix})`
  (CS:2496, 2513), `(lượt gửi lặp kế tiếp đã sang ngày mới)` (CS:2601), `(lượt gửi lặp kế tiếp vượt quá giờ dừng trong ngày)`
  (CS:2612).
- `⏳ Hẹn chạy tiếp chiến dịch lúc ${this.formatVietnamDateTime(scheduledAt)}` (CS:3326-3327). `formatVietnamDateTime`
  is `date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, year: 'numeric', month, day, hour and
  minute '2-digit' })` (CS:2739-2749); the core must make the same call to produce the same text.
- `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "${campaign.name}" ở khung giờ ${nextSlot} (${…})` (multi-slot,
  friend and group only, CS:2443); `⏳ Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch "${campaign.name}" lúc ${…}`
  (share repeat, friend and group in share mode only, CS:2620).

### 1.9 `auto_error` rows these types hit (FX, 06/11)

These rows decide the Desktop history log (`noti_running_process`), status, quota and side effects. "codes" =
`zalo_error_codes`, "acts" = `zalo_action_codes` (empty = all).

| Policy | codes / acts | detail status | Desktop history log | quota | bad target | side effect |
|---|---|---|---|---|---|---|
| `err_zalo_invalid_param` | 114 / all | `thất bại` | `Tham số không hợp lệ` | yes | yes | — |
| `err_zalo_user_not_found` | 216, 214, 212 / all | `không tồn tại` | `Không tồn tại` | yes | no | — |
| `err_zalo_api_business_failed` | — (fallback) | `thất bại` | `${actionName} thất bại: ${message} (mã Zalo: X)` | yes | yes | — |
| `err_zalo_receiver_blocks_stranger_message` | 122 / all | `thất bại` | `Người nhận chặn tin nhắn từ người lạ` | no | no | — |
| `err_zalo_receiver_blocks_message` | 119 / all | `thất bại` | `Người nhận chặn tin nhắn từ bạn` | no | no | — |
| `err_zalo_message_too_long` | 118 / all | `thất bại` | `Nội dung quá dài` | yes | yes | campaign `tạm dừng`, note `Nội dung quá dài, vui lòng sửa nội dung chiến dịch` |
| `err_zalo_session_invalid` | 600 / all | — | `Zalo đã bị đăng xuất, vui lòng đăng nhập lại` | no | no | login `chưa đăng nhập` |
| `err_zalo_120_message_stranger` | 120 / stranger | — | `Zalo hạn chế nhắn người lạ (mã 120). Tạm khóa nhắn người lạ đến 09:45 ngày mai.` | no | no | lock stranger, day +1 09:45 |
| `err_zalo_802_message_stranger` | 802 / stranger | — | `Zalo hạn chế nhắn người lạ (mã 802). Tạm khóa nhắn người lạ đến 09:45 ngày mốt.` | no | no | lock stranger, day +2 09:45 |
| `err_zalo_123_message_friend` / `_stranger` / `_group` | 123 / per action | `thất bại` | `Tin nhắn bị trùng lặp hoặc gửi quá nhanh` | yes | no | lock that message code 30 min |
| `err_zalo_126_127_message_personal` | 126 / friend, stranger | `thất bại` | `Zalo từ chối tin nhắn cá nhân (mã 126)` | yes | no | — |
| `err_zalo_126_127_message_group` | 126, 127 / group | `thất bại` | `Tin nhắn bị trùng lặp hoặc gửi quá nhanh` | yes | no | lock group 30 min |
| `err_zalo_127_message_friend` / `_stranger` | 127 / per action | `thất bại` | `Tin nhắn bị trùng lặp hoặc gửi quá nhanh` | yes | no | lock 30 min |
| `err_zalo_221_message_friend` / `_group` | 221 / per action | `thất bại` | `Đạt giới hạn nhắn bạn bè (mã 221)` / `Đạt giới hạn nhắn nhóm (mã 221)` | yes | no | lock 60 min |
| `err_zalo_112_message_group` | 112 / group | `thất bại` | `Zalo từ chối gửi nội dung vào nhóm này (mã 112)` | no | yes | — |
| `err_zalo_161_group_not_found` | 161 / group | `không tồn tại` | `Nhóm Zalo này không còn tồn tại (mã 161)` | no | no | input `tạm dừng` |
| `err_zalo_friend_request_sent` | 222 / add friend | `thành công` | `Đã chấp nhận lời mời kết bạn` | yes | no | — |
| `err_zalo_already_friend` | 225 / all | `đã là bạn bè` | `Đã là bạn bè` | no | no | — |
| `err_zalo_add_friend_failed` | 311 / all | `thất bại` | `Yêu cầu kết bạn không thành công` | yes | yes | — |
| `err_zalo_add_friend_limit` | 221 / add friend | `thất bại` | `Zalo hạn chế kết bạn trong giờ. Tạm nghỉ 60 phút` | yes | no | lock add friend 60 min |
| `err_zalo_223_add_friend_pause` | 223 / add friend | — | `Danh sách yêu cầu kết bạn đã đầy (mã 223)` | no | no | campaign `tạm dừng` |
| `err_zalo_224_add_friend_full` | 224 / add friend | — | `Danh bạ Zalo đã đầy (mã 224)` | no | no | lock add friend (no end), campaign `tạm dừng` |
| `err_zalo_215_251_add_friend_rejected` | 215, 251 / add friend | `thất bại` | `Người nhận không nhận lời mời kết bạn (mã 215/251)` | yes | no | — |
| `err_zalo_210_target_unavailable` | 210 / find phone, add friend | `không tồn tại` | `Người nhận bị Zalo chặn (mã 210)` | no | no | — |
| `err_zalo_group_member_already_exists` | 178 / all | `đã là thành viên` | `Đã là thành viên của group` | no | no | — |
| `err_zalo_group_invite_stranger_limit` | 314 / all | `thất bại` | `Đạt giới hạn mời người lạ vào group` | yes | no | lock add member 60 min |
| `err_zalo_120_add_group_member` | 120 / add member | — | `Zalo hạn chế thêm thành viên nhóm (mã 120). Tạm khóa thêm thành viên nhóm đến 09:45 ngày mai.` | no | no | lock add member, day +1 |
| `err_zalo_802_add_group_member` | 802 / add member | `thất bại` | `Zalo hạn chế thêm thành viên nhóm (mã 802). Tạm khóa thêm thành viên nhóm đến 09:45 ngày mốt.` | yes | no | lock add member, day +2 |
| `err_zalo_126_add_group_member` | 126 / add member | `thất bại` | `Zalo từ chối lời mời vào nhóm (mã 126)` | yes | no | — |
| `err_zalo_264_269_add_group_member_pause` | 264, 269 / add member | — | `Zalo không cho thêm trực tiếp thành viên (mã 264/269)` | no | no | campaign `tạm dừng` |
| `err_zalo_227_join_group_link_invalid` | 227 / join | `thất bại` | `Link nhóm Zalo không hợp lệ (mã 227)` | no | yes | — |

V500 (engine v2 only) adds rules for the other types, among them: `164` → `err_engine_zalo_not_group_member` (Z164),
`183` → `err_engine_zalo_group_member_limit` (Z183) and `240` → `err_engine_zalo_group_invite_pending` (Z240) for add
member; `172` → `err_engine_zalo_group_full` (Z172) and `299` → `err_engine_zalo_join_group_day_limit` (Z299) for join;
`301` → `err_engine_zalo_cancel_friend_day_limit` (Z301) for cancel; `120`/`802` on `zalo_message_friend`; and
`target_missing_identity` → `err_input_invalid` (DAT01) (`migrations/migration_v500_zalo_error_policies.sql:36-69`).

### 1.10 App Server (VPS)

Same code with `runtimeTarget = 'server'`. Differences for these types: run control is read from the DB
(`getZaloServerRunControlState`, CS:4510-4520, 4650-4661); akaBiz tags go through `applyZaloServerCampaignTags`
(CS:8140-8151); multi-slot uses `advanceZaloServerMultiDailySlot` (CS:2524-2555); completion uses
`finalizeClaimedServerZaloCampaign` (CS:2186-2194); realtime intake runs in RG with `runtimeTarget = 'server'`.
Organizations whose Zalo Server runs on Fly (`is_chat_sync`, separate app access, or the V497 flag route) are not run by
the VPS.

---

## 2. Per type

### 2.1 `zalo_message_group_member` (843 campaigns)

**1. Where.** Workflow 272 (§1.2). Helpers: `zaloResolveGroupMemberTarget` (CS:15342-15380), `zaloSendPhoneMessage`
(CS:15639-15695), `zaloSendPhoneFriendRequest` (CS:16037-16087), `zaloApplyContactTag` (CS:16194-16307),
`zaloChangeContactAlias` (CS:16309-16371). Loop: §1.4. SMS push: CS:13707-13827.

**2. Targets.** Rows with `uid` (required), `name`, optionally `phone` and `info1..info5`.
- Form picker of scanned group members (`DataScanPicker` action `zalo_group_members`, CFM:16600-16618), or a UID upload
  (5–30 digits, `src/shared/zaloUidImport.ts:2-11`), or a data group of type `zalo_person` keyed by `zalo_uid`
  (`migrations/migration_v206_semantic_data_types.sql:577`).
- "Strangers" are simply UIDs that are not friends; the runner never checks friendship.
- Label in progress lines: name → uid → phone (CS:7578-7601).

**3. Steps (one input).**
1. Opt-out preflight before the claim (§1.4 step 4). `getUserProfile(accountId, uid)` (ZR:1626-1649 →
   `api.getUserInfo(uid)`, UID suffix `_0` stripped) is called here and cached in the opt-out context.
2. Cooldown (if `recentDeliveryCooldownEnabled` and `enableMessage`), opt-out link (if enabled), lock/quota on
   `zalo_message_stranger` (if `enableMessage`) and `zalo_add_friend` (if `enableAddFriend`).
3. `zaloResolveGroupMemberTarget`:
   - no UID → 114 policy detail, action `zalo_message_stranger` / `Nhắn tin người lạ`, raw text
     `UID thành viên group Zalo không hợp lệ` (CS:15348-15361); the next blocks skip (no target);
   - target = cached opt-out target, or `normalizeZaloTargetFromInputData(uid, name, input, { source: 'zalo_group_members' }, false)`
     merged with `getUserProfile` (lookup failure tolerated, CS:14550-14564);
   - upsert the profile into the contacts (CS:8066-8085) and apply akaBiz tags (`person`), **before any send**
     (CS:15375-15377). No history row on success.
4. `zaloSendPhoneMessage` (if `vars.enableMessage`): content prepared with rotation key `zalo_message_stranger`, then
   `dispatchZaloMessage(account, uid, isGroup=false, message, attachments)` (CS:15520-15581) →
   `sendMessageToUser` → `api.sendMessage({ msg, styles?, attachments? }, uid, ThreadType.User)` (ZR:1664-1672,
   1861-1937; 90 s, 180 s with files).
5. `zaloSendPhoneFriendRequest` (if `vars.enableAddFriend`): text from `friendRequestMessage` (variants, spin, template, no
   opt-out link), **cut to 150 characters** (CS:16048-16054) → `api.sendFriendRequest(message, uid)` (ZR:2175-2179).
   **Runs even when the message failed** (the chain does not stop on `ok: false`).
6. Tag, then alias (`zalo-aux-actions.md`).

**4. Share mode.** Not applicable (`shouldUseZaloShareMessageBatch` is friend/group only, CS:5731-5736).

**5. Outcomes.**
- Message success: `thành công`, log `Đã gửi tin nhắn đến ${this.getZaloTargetLabel(target)}` (CS:15669), label =
  display name → original name → phone → uid (CS:14999-15001); data `{ target, message, attachments, response,
  zaloEngagementSource, messageOptOutSource }`; counts; delivery committed.
- Friend request success: `thành công`, `Đã gửi lời mời kết bạn đến ${…}` (CS:16071); data
  `{ target, message, response, zaloEngagementSource }`.
- Friend request failure: policy row (§1.9). The step result is `ok: true` when the policy status is not
  `thất bại`/`lỗi` (e.g. 222 → `thành công`, 225 → `đã là bạn bè`, 210 → `không tồn tại`) (CS:16079-16085).
- Message failure: policy row; e.g. 122 → `thất bại`, no quota, not a bad target. 120/802 → no row, a `⚠️` line, a lock
  and a stop after the target. Only a successful message sets `deliveryCommitted` (§1.5), so the summary requeues the
  input even when its friend request succeeded: without the managed layer the row goes back to `chờ xử lý` and the
  friend request is sent again on the next run; with it, settle turns the requeue into `tạm dừng`, because a result is
  already recorded and the input effect is `none` (AR:193).
- Partial send (album sent, text failed): `thất bại`, `Đã gửi file nhưng gửi nội dung thất bại. ${log}` (CS:15609-15637).

**6. Lines (besides §1).** `Nhắn tin người lạ: …`, `Kết bạn: …` detail lines; `🏷️ Đã gắn tag akaBiz cho ${label}` /
`⚠️ Không thể gắn tag akaBiz cho ${…}: ${message}` (CS:8160, 8180); opt-out lines (`zalo-gates-content.md` §4);
SMS warnings `Không thể kiêm gửi SMS vì thiếu SĐT cho ${…}` (CS:13725, 13789) and `Không thể xử lý kiêm gửi SMS`
(CS:11342).

**7. Features.** Media yes (message only); formatted and advanced content yes (message only, `src/shared/formattedContent.ts:12-24`);
AI rewrite yes (plain text); content rotation per input and action; tag/alias yes; akaBiz yes (before send); cooldown if
`enableMessage`; send exclusions if `enableMessage` (`src/shared/campaignSendExclusion.ts:25-28`); opt-out check
always (also for friend-request-only campaigns); opt-out link (message only); engagement tracking yes; **SMS push yes
(only this type and `zalo_message_phone`)**: rows `zalo_message_stranger` / `zalo_add_friend` whose status is in the
configured list are pushed to an internal SMS child campaign or the external SMS API (CS:13540-13545, 13707-13827).

**8. Fly.** Supported by the old executor only (ZE:1238-1245 target, 1247-1255 akaBiz, 1278-1292 sends, 1313-1322
aux). Opt-out preflight `get_user_profile` (stepKey `resolve_user`), `send_text` / `send_campaign_media`
(`threadType 'user'`), `send_friend_request {userId, message}` (stepKey `friend_request`). Differences from Desktop:
- no SMS push (no reference to `internalSmsEnabled` / `externalSmsEnabled` in the worker);
- empty UID → `114` `UID người dùng Zalo không hợp lệ.` thrown before any step, recorded under
  `actionCode = campaign.actionId` and `actionName = campaign.actionName` (ZE:1409-1438, 1840) instead of
  `zalo_message_stranger` / `Nhắn tin người lạ`;
- a policy that only locks or requeues does not end the target: the locked codes are skipped and the error is re-thrown
  after tag/alias (ZE:1190-1209, 1324); Desktop also runs the remaining blocks, so the effect is similar, but Fly settles
  the input from the strongest deferred failure;
- detail texts differ (§4.2): `Đã gửi tin nhắn đến ${displayName || uid}.`, `Đã gửi lời mời kết bạn đến ${…}.`
  (trailing period, no original name / phone fallback) (ZE:1995-1997, 2044);
- quota skip line per target `⚠️ Bỏ qua ${name}: ${reason}` (ZE:1624-1627) instead of once per run with
  `vì đã đạt giới hạn`.

### 2.2 `zalo_message_friend` (289 campaigns)

**1. Where.** Normal mode: workflow 266, helper `zaloSendFriendMessage` (CS:15697-15774), then tag/alias. Materialization:
CS:3936-3951, `materializeZaloFriendInputData` (CS:8363-8471), CS:4002-4008. Legacy blocklist: CS:7017-7076,
7502-7518, 4058-4065, 4231-4236. Share mode: §3. Multi-slot and share repeat: `zalo-scheduling-completion.md` §5.5–5.6.

**2. Targets.** Rows with `uid` (required) and `name` (`phone` optional). `zaloFriendTargetMode` (CS:7007-7015):
- `selected` (default): rows picked from the friend list (`zalo_friends`, CFM:16540-16578) or a data group
  (`zalo_person`).
- `all_friends` / `tagged_friends`: materialized **once**, only when there is no row and no
  `zaloFriendDataMaterializedAt` (CS:7532-7536). The marker is never cleared by maintenance (only stripped when a
  campaign is cloned, CR:571-588), so new friends are never added later.

Materialization (CS:8363-8471):
1. Tagged mode: no tag → `⚠️ Chưa chọn tag nguồn Zalo để lấy danh sách bạn bè`, return empty (CS:8371-8374).
   Otherwise `🔄 Đang lấy danh sách hội thoại trong ${n} tag Zalo: ${names}` (CS:8375), pace, one `listLabels`
   (`api.getLabels()`, ZR:1139-1156); an unknown or invalid tag id throws `Tag Zalo không tồn tại` /
   `Tag Zalo không hợp lệ` (CS:8388-8391, the run fails). No conversation → marker set with count 0 and
   `⚠️ Các tag Zalo đã chọn chưa có bạn bè nào` (CS:8393-8403).
2. `🔄 Đang quét danh sách bạn bè Zalo live để lọc theo tag` or `🔄 Đang quét toàn bộ danh sách bạn bè Zalo live`
   (CS:8406-8408).
3. Pages of 500: `api.getAllFriends(500, page)` (ZR:1173-1177), each read preceded by
   `⏳ Chờ ${(delayMs / 1000).toFixed(1)} giây trước khi ${operationLabel}...` (2–5 s random, CS:8315-8326) with label
   `đọc trang ${page} danh sách bạn bè Zalo`; HTTP 429 retried after 15/30/60 s with
   `⚠️ Zalo đang giới hạn request khi ${operationLabel}. Tự thử lại sau ${s} giây (${i}/3)...` (CS:8328-8361). Other
   read errors become `ZaloCampaignReadError` (the run fails; the 429 user text is
   `Zalo đang giới hạn tần suất request (HTTP 429). Vui lòng chờ một lúc rồi tiếp tục chiến dịch.`, CS:8254-8257).
4. Dedupe by normalized UID, filter by the tag set, upsert contacts, insert rows `{ name, uid, phone, status: 'chờ xử lý',
   note: '' }` (name = displayName → zaloName → username → name → uid, CS:8184-8194), set the marker, and log
   `✅ Đã thêm ${profiles.length} bạn bè Zalo vào chiến dịch "${campaign.name}"` (**also when the count is 0**,
   CS:8469).
5. Zero rows after materialization → campaign `chờ xử lý`, note `Không lấy được bạn bè Zalo nào để gửi tin`, line
   `⚠️ Không lấy được bạn bè Zalo nào để gửi tin`, release (CS:3944-3950). Marker set and still zero rows on a later run →
   `⚠️ Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy` (CS:4002-4008).

**3. Steps (normal mode).**
1. Legacy blocklist (only when `zaloSendExclusionsByAccountId` is absent and `zaloFriendBlocklistEnabled`): matching UID
   → input `hoàn thành`, note `Bỏ qua vì nằm trong danh sách không gửi tin: ${groupName}`, line
   `🚫 Bỏ qua "${targetName}" vì nằm trong danh sách không gửi tin: ${groupName}` (CS:7502-7518). An invalid list stops the
   run: note and line `⚠️ Danh sách không gửi tin Zalo không hợp lệ: ${reason}` (CS:4058-4065), reasons include
   `Chưa chọn danh sách không gửi tin Zalo` (CS:7040).
2. Opt-out preflight + send exclusions (friend: always supported), cooldown, opt-out link, lock/quota on
   `zalo_message_friend`.
3. `zaloSendFriendMessage`:
   - no UID → 114 detail, action `zalo_message_friend` / `Nhắn tin bạn bè`, raw text `UID bạn bè Zalo không hợp lệ`
     (CS:15707-15718);
   - target = cached opt-out target or `normalizeZaloTargetFromInputData(uid, name, input)` (`isFriend = true`) merged with
     the profile; upsert contact; akaBiz (`person`) **before the send** (CS:15721-15729);
   - content with rotation key `zalo_message_friend`; `sendMessageToUser` (ZR:1664-1672). **No friendship check**: a
     former friend gets the same action code and usually a 120/802-type answer (V500 maps `120`/`802` on
     `zalo_message_friend` to the stranger-limit policies).
4. Tag, alias (normal mode only; the form disables them in share mode, CFM:6593-6607).

**4. Share mode.** Yes, see §3. Thread id = `uid`; per target the profile is read for the contact upsert
(CS:5978-5992); no tag/alias, no akaBiz (CS:8087-8093), no opt-out link, text not personalized.

**5. Outcomes.** Success `thành công`, `Đã gửi tin nhắn đến ${label}` (CS:15748); share `Đã chia sẻ tin nhắn đến ${label}`
(CS:6889). Failures per §1.9 (123/127 lock 30 min, 221 lock 60 min, 126 `thất bại`, 119/122 `thất bại` without quota).

**6. Lines.** Materialization lines above; `Nhắn tin bạn bè: …`; share lines (§3.6); multi-slot / share repeat lines (§1.8).

**7. Features.** Media yes; formatted/advanced yes; AI yes (plain); rotation yes; tag/alias normal mode only; akaBiz
normal mode only; cooldown yes; exclusions yes; legacy blocklist yes; opt-out check yes; link normal mode only;
engagement yes; multi-slot yes; share repeat yes (share mode, direct data, not with multi-slot or cooldown).

**8. Fly.** ZE:1270-1277 (normal), §3.8 (share), IM:312-389 (materialization), ZS:1318-1356 (blocklist). Differences:
- tagged mode reads each tag with `get_label_conversation_uids {labelId}` and pacing label `đọc tag Zalo ${i}/${n}`
  (IM:336-346); no `🔄 Đang lấy danh sách hội thoại…` line; unknown tag → `Tag Zalo không tồn tại.` (ZA:2747-2756);
- no tag selected → note `Chưa chọn tag nguồn Zalo để lấy danh sách bạn bè.` and release (IM:328-334) instead of the
  `Không lấy được bạn bè…` note;
- `✅ Đã thêm …` only when the count is > 0 (IM:383); zero rows → note `Không lấy được bạn bè Zalo nào để gửi tin.`
  (trailing period) and **no `⚠️` line** (IM:384-388, ZS:811-820);
- the `🚀` line is written only when due rows exist (ZS:811-832);
- legacy blocklist writes one summary `🚫 Đã bỏ qua ${skipped} bạn bè Zalo trong danh sách không gửi tin "${groupName}"`
  (ZS:1343-1347) instead of one line per target;
- multi-slot log prints a UTC ISO time (`⏳ Đã hoàn thành lượt chạy và hẹn khung giờ tiếp theo lúc ${nextSlot.toISOString()}`,
  ZS:1212) and finalizes without the Desktop suffixes; share repeat is not implemented;
- detail texts with trailing period (§4.2).

### 2.3 `zalo_message_group` (226 campaigns)

**1. Where.** Workflow 268, helper `zaloSendGroupMessage` (CS:15776-15830). Share mode: §3.

**2. Targets.** Rows with `uid` = group id (with or without the `g` prefix) and `name`; picked from the group list
(`zalo_groups`, CFM:16699) or a data group of type `zalo_group` (`migration_v206…:587`). Label: name → uid.

**3. Steps (normal mode).**
1. No opt-out preflight and no send exclusions (not in the opt-out set). Cooldown if enabled (always supported for
   group, `src/shared/campaignDeliveryCooldown.ts:7-14`). Lock/quota on `zalo_message_group`.
2. `zaloSendGroupMessage`:
   - no group id → 114 detail, action `zalo_message_group` / `Nhắn tin group`, raw `ID group Zalo không hợp lệ`
     (CS:15785-15797);
   - target = `normalizeZaloTargetFromInputData(groupId, name, input, { type: 'group' }, false)` (no profile read);
   - content with rotation key `zalo_message_group`; `#{STOP_MESSAGES_LINK}` is removed (group is not an opt-out type);
   - `dispatchZaloMessage(account, groupId, isGroup=true, …)` → `sendMessageToGroup` →
     `api.sendMessage(payload, groupId, ThreadType.Group)` (ZR:1674-1682). **The `g` prefix is not stripped in normal
     mode** (share mode strips it, CS:6340-6345);
   - on success, akaBiz tags with contact type `group` (UIDs with and without `g`, CS:8110-8117), then the detail.
3. No tag/alias (the workflow has no such nodes; the form never enables them for groups).

**4. Share mode.** Yes, §3 (thread id without `g`, `mforward` to `/api/group/mforward` with `grids`).

**5. Outcomes.** Success `thành công`, `Đã gửi tin nhắn vào group ${label}` (CS:15815), data
`{ target, groupId, message, attachments, response }`; share `Đã chia sẻ tin nhắn vào group ${label}` (CS:6888).
Special rows: 112 → `thất bại`, no quota, bad target; 161 → `không tồn tại`, input `tạm dừng` (V471); 123/126/127 lock
30 min; 221 lock 60 min.

**6. Lines.** `Nhắn tin group: …`; `🏷️ Đã gắn tag akaBiz cho group ${label}` (CS:8157-8160, written **before** the
detail line).

**7. Features.** Media, formatted, advanced, AI (plain), rotation, cooldown, akaBiz (after a successful send),
multi-slot, share repeat (share mode). Not: opt-out check/link, exclusions, tag/alias, engagement, SMS.

**8. Fly.** ZE:1257-1269. Differences: the group id is always stripped of `g` (ZE:1258); empty → `114`
`ID group Zalo không hợp lệ.` thrown before the step (recorded under the campaign's action id/name); akaBiz runs after the
detail (Desktop: before); **tag/alias run if the flags are set in `extra_settings`** (ZE:1313-1322; Desktop has no
nodes); detail text `Đã gửi tin nhắn vào group ${displayName || uid}.` (ZE:1996).

### 2.4 `zalo_cancel_sent_friend_request` (41 campaigns)

**1. Where.** Workflow from `migration_v135`, helper `zaloCancelSentFriendRequest` (CS:16089-16158). Materialization:
CS:3988-4000, `materializeZaloCancelSentFriendRequestInputData` (CS:8700-8774), CS:4022-4026, 8681-8687.

**2. Targets.** Re-read from Zalo **on every pass** when there is no row or every row is `hoàn thành`
(CS:7554-7557): existing rows are cleared (`clearCampaignInputData`, CS:8711-8714), then
`🔄 Đang lấy danh sách lời mời kết bạn đã gửi từ Zalo để huỷ ${limit} lời mời cũ nhất` (CS:8716), pace (label
`đọc danh sách lời mời kết bạn đã gửi`), `api.getSentFriendRequest()` (ZR:1229-1278; **Zalo 112 → empty list**,
ZR:1234-1241). Sorted oldest `sentAt` first, `zaloCancelFriendRequestLimit` (default 10). Rows:
`{ name: name || displayName || zaloName || uid, uid, info1: sentAt, info2: requestMessage, info3: globalId }`
(CS:8756-8768). The marker `zaloCancelFriendRequestDataMaterializedAt` is informational; maintenance clears rows and
marker for the next schedule (CR:3833-3846).

**3. Steps.** Lock check on `zalo_cancel_sent_friend_request` (no quota: `limit_check_action_codes = []` in FX). Helper:
no UID → 114 detail, raw `UID lời mời kết bạn Zalo không hợp lệ` (CS:16096-16110); else
`api.undoFriendRequest(uid)` (ZR:2181-2184). No opt-out, cooldown, content, tag or alias.

**4. Share mode.** No.

**5. Outcomes.** `thành công`, `Đã huỷ lời mời kết bạn đã gửi đến ${label}` (CS:16136), data
`{ target, sentAt, requestMessage, response }`, counted (for reports; no quota is enforced). Failures: no specific FX
row → fallback `Huỷ lời mời kết bạn thất bại: ${message} (mã Zalo: X)`, `thất bại`, bad target.

**6. Lines.** `⚠️ Bỏ qua ${n} lời mời Zalo thiếu UID` (CS:8741); `⚠️ Chỉ lấy được ${n}/${limit} lời mời kết bạn đã gửi`
(CS:8752); `✅ Đã thêm ${n} lời mời kết bạn đã gửi vào chiến dịch "${campaign.name}"` (CS:8772); read error → note and
`⚠️ Không lấy được danh sách lời mời kết bạn đã gửi từ Zalo: ${message}` then the normal completion chain
(CS:8731-8738, 8681-8687); empty → `⚠️ Zalo không có lời mời kết bạn đã gửi để huỷ` then completion (CS:8745-8749,
4022-4026). HTTP 429 is re-thrown (run fails) after the 3 retries.

**7. Features.** None of the content or gate features.

**8. Fly.** IM:522-598, ZE:2299-2316 (`undo_friend_request {userId}`, stepKey `cancel_friend_request`). Differences:
completion note shown as a suffix `✅ Hoàn thành chiến dịch "…" (${note})` instead of a separate `⚠️` line for the empty
case (IM:594-597, ZS:1226-1237); detail `Đã huỷ lời mời kết bạn đã gửi đến ${input.name || uid}.` (uses the row name, not
the target label); failures under §4.

### 2.5 `zalo_add_group_member` (37 campaigns)

**1. Where.** Workflow from `migration_v160`; helpers `zaloResolveAddGroupMemberTarget` (CS:15382-15434),
`zaloFindPhoneUser` (CS:15243-15340, phone rows only), `zaloAddGroupMember` (CS:15832-15922).

**2. Targets.** Rows with `uid` (friend or scanned member, pickers `zalo_group_members` and `zalo_friends`,
CFM:2596-2597, 16579-16619) or `phone` (upload requires a phone, `migration_v206…:403, 1122-1129`), data groups `phone` or
`zalo_person`. The destination group is campaign config: `extra.zaloAddGroupMemberTargetGroupId` (`g` stripped) and
`…GroupName`; `zaloAddGroupMemberUseShareMethod`.

**3. Steps.**
1. Lock/quota on `zalo_add_group_member` before each row. No opt-out, cooldown, content, tag/alias.
2. Resolve:
   - UID present → profile read and contact upsert, **no akaBiz** (CS:15389-15404);
   - else phone present → runtime lock/quota check of `zalo_find_phone_user` (CS:8939-8955): blocked → no row,
     `⚠️ ${note}`, input back to `chờ xử lý`, campaign stops after the row; else `zaloFindPhoneUser` (§2.5 lookup below);
   - neither → 114 detail, action `zalo_add_group_member` / `Thêm thành viên vào group`, raw
     `Data cần có SĐT hoặc UID Zalo`, **not counted** (CS:15422-15433).
   Phone lookup (`zaloFindPhoneUser`): `findUserByPhone` (reqSrc 32 then 40, ZR:1560), not found → `err_zalo_user_not_found`
   detail `không tồn tại` / `Không tồn tại` (action `zalo_find_phone_user`, `Tìm SĐT`), add skipped; found → contact
   upsert, input `name`/`uid` updated, success row `Đã tìm thấy SĐT ${phone}: ${label}`, **akaBiz applied** (CS:15326).
3. `zaloAddGroupMember`:
   - no group configured → 114 detail, raw `Chưa chọn group Zalo cần thêm thành viên`, not counted (CS:15852-15865).
     **Every row fails this way**; the bad-target threshold then pauses the campaign;
   - `addMemberToGroup(accountId, { groupId, memberId, useShareMethod })` (ZR:1684-1803): `api.getGroupInfo(groupId)`;
     share method → `api.getGroupLinkDetail` (`Không lấy được link group Zalo` / `Link group Zalo chưa được bật`) and
     `api.sendLink({ link }, memberId, ThreadType.User)` → mode `share_group_link`, outcome `link_sent`; community
     (`type === 2`) → `api.inviteUserToGroups(memberId, groupId)`: 178 → `already_member`, 0/262/263/empty → `added` or
     `invited`, other codes throw `ZaloApiError(error_message || 'Không thêm được thành viên vào group Zalo', code)`;
     otherwise `api.addUserToGroup(memberId, groupId)`: 178 → `already_member`, member in `errorMembers` → `invited`
     (`Đã gửi lời mời vào group`), else `added` (`Đã thêm thành viên vào group`).

**4. Share mode.** No (the "share method" is a link message, not share mode).

**5. Outcomes.** (CS:15876-15909)
- `already_member` → status `đã là thành viên`, log `${targetLabel} đã là thành viên của group ${groupLabel}`, not counted.
- `share_group_link` → `thành công`, `Gửi lời mời thành công đến ${targetLabel} qua link group ${groupLabel}`.
- otherwise `thành công`, `${result.message} cho ${targetLabel} vào group ${groupLabel}` (e.g.
  `Đã thêm thành viên vào group cho … vào group …`).
- Data `{ target, targetGroup: { id, name, type }, mode, outcome, useShareMethod, groupLink, response }`.
- Errors: policy row, **always `countsTowardLimit = false`** (CS:15908-15920): 178 → `đã là thành viên`; 314 lock 60 min;
  120/802 lock; 126 `thất bại`; 264/269 pause the campaign; runtime messages without code → fallback
  `Thêm thành viên vào group thất bại: ${message}`.

**6. Lines.** `Tìm SĐT: …`, `Thêm thành viên vào group: …`, akaBiz lines for phone rows.

**7. Features.** akaBiz on the phone path only; nothing else.

**8. Fly.** ZE:1293-1305, 2234-2255; AS:672-678 → ZA:2863-2942. **Main difference: the adapter never returns `outcome`**
(it returns `addedMembers` / `invitedMembers` / `alreadyMembers` / `errorMembers` / `linkSentMembers`), so the executor
always writes `thành công`, `Đã thêm ${displayName || uid} vào group.`, counted — also for already-members, invitations,
community errors (collected in `errorMembers`, not thrown) and share-link failures (caught per member). Also: no-group
check throws `114` `Chưa chọn group Zalo cần thêm thành viên.` inside the step; phone regex `^\+?[0-9]{9,15}$` before the
lookup (ZE:1688-1694); lookup success line `Đã tìm thấy SĐT ${phone}: ${displayName || uid}.`; not found → note
`Không tìm thấy tài khoản Zalo cần thêm.` (ZE:1300-1303); a row with neither UID nor phone fails the phone lookup with
`114` `SĐT Zalo không hợp lệ.` (Desktop: `Data cần có SĐT hoặc UID Zalo`, not counted); tag/alias run if the flags are set.

### 2.6 `zalo_message_remarketing_customer` (9 campaigns)

**1. Where.** Workflow 274; helper `zaloResolveRemarketingCustomerTarget` (CS:15436-15474); the rest as §2.1.

**2. Targets.** Rows `{ uid, name }` picked in the form from "old customers": customers this account already messaged
in its own Zalo campaigns, rebuilt from past `auto_campaign_details` rows (CR:4992-5003, derivation in
`buildZaloRemarketingCustomers` at CR:4803). One account must be selected (CFM:16621-16641). Data group `zalo_person`.
Nothing is produced at run time.

**3. Steps.** Identical to §2.1 except the resolve helper: no UID → 114 detail (action `zalo_message_stranger`), raw
`UID khách hàng cũ Zalo không hợp lệ` (CS:15443-15455); source tag `zalo_remarketing_customers`.

**4–7.** As §2.1, **without SMS push** (not in `EXTERNAL_SMS_ZALO_ACTION_IDS`).

**8. Fly.** Same branch as §2.1 (ZE:1238-1256, 1278-1292); no remarketing-specific code; same differences.

### 2.7 `zalo_join_group_link` (7 campaigns)

**1. Where.** Workflow from `migration_v133`; helper `zaloJoinGroupLink` (CS:15924-16035). Find-data wait note:
CS:3406-3423, 3705-3709. Data push from find-data: `pushFoundZaloGroupLinksToJoinCampaigns` (CS:13953-13991).

**2. Targets.** The link is stored in **`uid`**. Rows are entered by hand, or pushed by a Facebook find-data campaign
with `isFindLinkGroupZalo` and `findZaloGroupLinkJoinTargetCampaignIds`: rows `{ uid: link, status: 'chờ xử lý', note:
'Đã thêm từ chiến dịch "${source}"' }`, the target campaign is reopened if completed, and both campaigns log
`✅ Đã đẩy ${n} link group Zalo sang chiến dịch "${target}"` / `✅ Đã nhận ${n} link group Zalo từ chiến dịch "${source}"`.
A join campaign without any row whose find-data source exists waits with note `Đang chờ data từ chiến dịch tìm data`
(CS:726, 3406-3423), without a line.

**3. Steps.** Lock/quota on `zalo_join_group_link`. Helper:
1. Normalize (`normalizeZaloGroupInviteLink`, CS:7880-7902): `zalo.me/g/<code>` or `zaloapp.com/qr/g/<code>` (with or
   without protocol/`www.`) → `https://zalo.me/g/<code>`; otherwise 114 detail, raw `Link group Zalo không hợp lệ`.
2. `joinGroupByLink(accountId, link)` (ZR:1805-1840): `api.getGroupLinkInfo({ link, memberPage: 1 })`, then
   `api.joinGroupLink(link)`; Zalo 178 → `already_joined`, 240 → `pending_approval`, other errors throw.
3. Upsert the group contact with `is_joined` = joined or already joined (CS:8050-8064), not for pending.

**4. Share mode.** No.

**5. Outcomes.** (CS:15989-16028) data `{ target, link, groupId, groupName, group, response, zalo: { code, message } }`:
- `already_joined` → `đã tham gia`, `Tài khoản đã tham gia group ${groupLabel} từ trước`, not counted;
- `pending_approval` → `thành công`, `Đã gửi yêu cầu tham gia group ${groupLabel}, đang chờ duyệt`, counted;
- `joined` → `thành công`, `Đã tham gia group ${groupLabel}`, counted.
- Errors: 227 → `thất bại`, no quota, bad target; others fallback `Tham gia group thất bại: …`.

**6. Lines.** `Tham gia group: …`.

**7. Features.** None.

**8. Fly.** ZE:1306-1307, 2257-2297; AS:679-685 → ZA:2943-2965; wait note ZS:782-786. Differences: fixed texts without the
group name and with a period: `Đã tham gia group.`, `Tài khoản đã tham gia group từ trước.`,
`Đã gửi yêu cầu tham gia group, đang chờ duyệt.`; group contact upserted only when a group id is known.

### 2.8 `zalo_message_birthday` (3 campaigns)

**1. Where.** Workflow 270 (`zalo_send_friend_message`, CS:15697-15774). Materialization: CS:3953-3972,
`materializeZaloBirthdayInputData` (CS:8478-8555), completion `completeZaloBirthdayWithoutTargets` (CS:2714-2721,
4010-4014). Maintenance: CR:3690-3697, 3743-3769, 3848-3867.

**2. Targets.** Friends whose `sdob` starts with today's `DD/MM` (VN date from the DB clock, CS:3953-3955, 8473-8476),
read live when there is no row and the marker `zaloBirthdayDataMaterializedDate` is not today (CS:7538-7546).
`🔄 Đang quét danh sách bạn bè Zalo live để lọc sinh nhật ${DD/MM}` (CS:8488), pages as in §2.2, contacts upserted, rows
`{ name, uid, phone }`, marker = today, `✅ Đã thêm ${n} bạn bè sinh nhật hôm nay vào chiến dịch "${campaign.name}"`
(CS:8553, only when n > 0).

**3. Steps.** As friend normal mode: opt-out, exclusions, cooldown, opt-out link, `zalo_message_friend` lock/quota,
`zaloSendFriendMessage` (action `zalo_message_friend`, `Nhắn tin bạn bè`). **No akaBiz** (CS:8087-8093) and no tag/alias.

**4. Share mode.** Ignored (normal path); a stored `zaloMessageSendMode: 'share'` still disables the opt-out link
(CS:15077-15079).

**5. Outcomes.** As friend.

**6. Lines.** No birthday → campaign completed with note `Không có bạn bè sinh nhật hôm nay`, lines
`🎂 Không có bạn bè sinh nhật hôm nay` and `✅ Hoàn thành chiến dịch "${campaign.name}"` (CS:2714-2721).

**7. Features.** As friend normal mode without akaBiz, tag/alias, multi-slot, share repeat. The form forces
`continueNextDay = false` and `refreshData = true` (CFM:6456-6459).

**Schedule.** A `daily` birthday campaign is "no catch-up": maintenance finalizes a stale pending one with
`Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày` and skips completed ones (CR:3690-3697, 3743-3769). Weekly and
monthly ones are re-armed: rows soft-deleted, marker cleared, `chờ xử lý` at the next schedule (CR:3848-3867).

**8. Fly.** IM:391-432; same send branch as friend (ZE:1270-1277). Differences: empty day → note
`Hôm nay không có bạn bè Zalo nào sinh nhật.` and `✅ Hoàn thành chiến dịch "…" (Hôm nay không có bạn bè Zalo nào sinh nhật.)`,
no `🎂` line, no `🚀` line; birthday date from the claim's VN date.

### 2.9 `zalo_message_friend_recommendation` (3 campaigns)

**1. Where.** Workflow 280; helper `zaloResolveFriendRecommendationTarget` (CS:15476-15514). Materialization:
CS:3974-3986, `materializeZaloFriendRecommendationInputData` (CS:8586-8663), completion
`completeZaloFriendRecommendationWithoutTargets` (CS:2723-2730, 4016-4020). Maintenance: CR:3818-3831.

**2. Targets.** When there is no row and no marker `zaloFriendRecommendationDataMaterializedAt` (CS:7548-7552):
`🔄 Đang lấy ${requestedCount} đề xuất Zalo` (CS:8595), pace (label `đọc danh sách đề xuất Zalo`),
`api.getFriendRecommendations()` keeping only `recommType === RecommendedFriend` (ZR:1179-1227). First
`zaloFriendRecommendationCount` (default 10) distinct UIDs; rows `{ name, uid, phone }` (name = displayName → zaloName);
**no contact upsert**. Marker set with the count. Maintenance clears rows and marker for the next schedule (non-daily),
so each recurrence fetches fresh recommendations.

**3. Steps.** As §2.1; resolve 114 raw text `UID đề xuất Zalo không hợp lệ` (CS:15483-15495), source tag
`zalo_friend_recommendations`.

**4–5, 7.** As §2.1 without SMS push.

**6. Lines.** `⚠️ Bỏ qua ${n} đề xuất Zalo thiếu UID` (CS:8630); `⚠️ Chỉ lấy được ${n}/${requested} đề xuất Zalo`
(CS:8643); `✅ Đã thêm ${n} đề xuất Zalo vào chiến dịch "${campaign.name}"` (CS:8661). Empty: campaign completed with the
reason as note, lines `⚠️ ${note}` then `✅ Hoàn thành chiến dịch "${campaign.name}"`; reasons
`Zalo không trả danh sách đề xuất để chạy`, `Zalo không có danh sách đề xuất để chạy`,
`Danh sách đề xuất Zalo không có UID hợp lệ để chạy`, `Không lấy được đề xuất Zalo để chạy` (CS:8573-8584); read error
(not 429) → `Không lấy được đề xuất Zalo: ${message}` (CS:8614-8616).

**8. Fly.** IM:434-520; send branch as §2.1. Differences: reasons with a trailing period, shown only as the completion
suffix (`✅ Hoàn thành chiến dịch "…" (…)`), no `⚠️` line on the empty path; the read-error path logs `⚠️ ${note}` and
completes with the suffix.

### 2.10 `zalo_message_group_realtime` (1 campaign)

**1. Where.** Workflow 276 (same blocks as §2.1). Intake: RG (whole file). Run gate: `prepareZaloRealtimeGroupCampaignRun`
(CS:3359-3404). Completion: `handleZaloRealtimeGroupCompletion` (CS:2335-2387). Runtime gate: Zalo Web accounts on
Desktop cannot run it (CS:2096-2101; readiness text `Chiến dịch này không hỗ trợ tài khoản Zalo chạy bằng trình duyệt.`,
CS:990).

**2. Targets (intake).** RG refreshes every 30 s (RG:10, 127-162) the campaigns of this staff with action
`zalo_message_group_realtime`, status `chờ xử lý`/`đang chạy`, not Zalo Web (CR:1946), matching runtime target (CR:1926-1954), whose
account is logged in, `chờ xử lý`/`đang chạy`, active, and whose `zaloRealtimeEndDate` (VN date) is today or later.
Config: `zaloRealtimeTriggers` ⊆ {`join`, `leave`, `interact`}, `zaloRealtimeGroupIds` (`g` stripped),
`zaloRealtimeGroupNames`, `zaloRealtimeEndDate` (RG:164-196). For each account it subscribes to the zca-js listener
(`subscribeRealtimeListener`, ZR:678; `ensureRealtimeListenerReady` under an account runtime-operation claim
`zalo.listener.start`, RG:211-263).
- Group event `JOIN` → `join`; `LEAVE` / `REMOVE_MEMBER` → `leave`, one target per `updateMembers[]` (RG:354-389).
- Incoming non-self group message → `interact` (sender `uidFrom`, name `dName`) (RG:391-401).
- Non-self group reaction → `interact` (RG:403-413).
- Member ids lose a trailing `_0`; `0` is ignored (RG:631-633).
- Enqueue (RG:446-506): DB clock; if past the end date, refresh and drop. RPC
  `enqueue_campaign_zalo_realtime_group_event(campaign, account, staff, runtime_target, group_id, group_name, trigger,
  target_uid, target_name, event_time, schedule_at, raw_payload)` (CR:1957-1983). The function inserts one row per
  `(campaign_id, target_uid)` (unique) with `{ name, uid, status: 'chờ xử lý', schedule: schedule_at }` and pulls the
  campaign `schedule` forward (`migration_v132…:28-140`, later overloads add the staff and runtime checks).
- `schedule_at` = **next VN day** at the time of `original_schedule` (or `schedule`, else the event time)
  (RG:575-587). Realtime targets therefore run the day after the event, at the campaign's original time.
- History line on the campaign (no emoji): `Đã nhận data theo thời gian thực (${triggerLabel}) từ group "${groupName}": ${targetLabel}`
  or `… nhưng data "${targetLabel}" đã tồn tại trong chiến dịch, không thêm lại data` (RG:540-573, texts RG:554-556); trigger labels
  `tham gia group` / `rời group` / `tương tác trong group` (RG:635-639); group name from the campaign config, else the id.
- Listener closed or errored → session check; logged out → pending campaigns get note
  `Tài khoản Zalo bị đăng xuất, tạm dừng nhận data theo thời gian thực` (RG:265-352). A paused campaign rejects with
  `runtime_control_paused` (ignored, RG:493-497).

**3. Steps.** Before the claim of the run (CS:3734-3737): a due pending row → run; only future rows → defer
(`⏳ Hẹn chạy tiếp chiến dịch lúc …`); no pending row and inside the window → `chờ xử lý` at today's or tomorrow's
original time and `⏳ Chiến dịch "${campaign.name}" đang chờ data theo thời gian thực từ group Zalo` (CS:3385-3393); past
the window → completed with note `Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy` and
`✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày nhận data theo thời gian thực)` (CS:3396-3402). Per row: exactly
§2.1 (source tag `zalo_group_members`). Form: `continueNextDay = false`, `refreshData = false` (CFM:6456-6462).

**4–7.** As §2.1 without SMS push.

**Completion** (CS:2335-2387): due rows → `chờ xử lý`, schedule now; future → defer; inside the window →
`chờ xử lý` at the wait time and `⏳ Chiến dịch "${campaign.name}" tiếp tục chờ data theo thời gian thực từ group Zalo`;
else completed as above.

**8. Fly.** Intake from the chat runtime's event inbox, server runtime and live sync only (RE:50-104), matching and
insert in SQL (RR:47-195) with the same RPC and the same history texts (RR:165-167); `schedule_at` computed in SQL with
`00:00` as the last fallback. Group name: campaign config, else the event's name. Run: send branch as §2.1. Completion
(ZS:1186-1194): inside the window → release with note `Đang chờ data theo thời gian thực từ group Zalo.` and **no
line**; past the window → plain `✅ Hoàn thành chiến dịch "…"` without note or suffix. No logout note.

---

## 3. Share mode (friend and group)

Desktop: `executeZaloShareMessageBatchCampaign` (CS:5755-6215), `processZaloShareMessageBatch` (CS:6362-6804). Media
handling is in `zalo-media.md` §3.4 / §4.2; this section covers the flow and the texts.

### 3.1 Entry and checks

- Condition: `extra.zaloMessageSendMode === 'share'` and friend or group (CS:5731-5736); birthday ignores it.
- Content check before the first batch: advanced items valid (CS:5775-5782); basic content: text of variant 0 empty and
  no declared media with `imageOption !== 'none'` → note `Vui lòng nhập nội dung hoặc chọn media để gửi Zalo`, line
  `⚠️ ${note}`, release (CS:5783-5794).
- Legacy blocklist pre-filter (friend), without per-row lines (CS:5796-5817).

### 3.2 Batch building (per batch)

1. Boundary, hard end, runtime stop, pause, account checks (CS:5823-5869).
2. Capacity `getZaloShareMessageBatchCapacity` (CS:6217-6271): lock check, then
   `min(50, daily remaining, window remaining)`; zero → `handleLimitStatus` with reason
   `Hành động "${name}" không còn quota để gửi batch` → `⚠️ Tạm dừng "${campaign.name}": …` (CS:5871-5882).
3. Up to `capacity` due `chờ xử lý` candidates (future rows remembered, blocklisted rows marked) (CS:5890-5938).
4. Opt-out preflight per candidate (friend; group is a no-op), then cooldown on the allowed ones (CS:5943-5968).
5. Per allowed candidate: thread id = `uid` (group: `g` stripped, CS:6340-6345); empty → "invalid" target; friend → the
   cached opt-out target or a profile read, then a contact upsert (CS:5970-5994).
6. One unit claim for the batch (CS:6014-6021).

### 3.3 Content (once per batch)

`prepareSelectedCampaignContent(…, actionCode, inputDataId = null, …)` (CS:6073-6081): rotation once per batch;
`getZaloShareMessageForBatch` (CS:6273-6321) only applies spin (and formatted conversion); **template tokens such as
`#{FULL_NAME}` stay literal**, there is no opt-out link; AI rewrite applies to plain text, once, falling back silently.
Empty text and no media → stop note `Vui lòng nhập nội dung hoặc chọn media để gửi Zalo` and `⚠️ ${note}`
(CS:6082-6086), the batch is requeued.

### 3.4 Sending

- Media phase (only with files): per target `sendMessageToGroup` / `sendMessageToUser(account, threadId, '', files, true)`
  (CS:6396-6470). Media timeout / unknown result is recorded at once, in send order.
- Text phase: one `forwardMessageToUsers` / `forwardMessageToGroups(account, threadIds, message)` (ZR:1842-1859,
  1951-2026): custom `akaForwardMessageBatch`, POST `${zpwServiceMap.file[0]}/api/{message|group}/mforward` with
  `toIds` / `grids` `{ clientId, toUid|grid, ttl: 0 }`, `msgType: '1'`, `msgInfo` (ZR:2028-2075), 90 s. The own UID is
  answered locally with `114` `Không thể chia sẻ tin nhắn Zalo cho chính tài khoản đang gửi`; unmapped targets get
  `Không xác định được kết quả chia sẻ tin nhắn Zalo cho target này` (ZR:1966-2025, 2077-2173).
- If the media phase stopped the batch, no forward: `Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung.`
  (CS:6491-6492).

### 3.5 Per-target results and policies (CS:6518-6791)

- Policy scope: a batch with at least one success → failures are `target-only` (detail `thất bại` at least, no side
  effects, not bad targets); a batch with no success → the target whose policy has the strongest side effect (login 8 >
  account 4 > campaign 2 > locks 1, CS:6839-6845) gets `full`, others `batch-followup` (CS:6847-6872).
- Invalid targets → 114 policy with raw `ID group Zalo không hợp lệ` / `UID bạn bè Zalo không hợp lệ` (CS:6562-6602).
- Success → `thành công`, log `Đã chia sẻ tin nhắn vào group ${label}` or `Đã chia sẻ tin nhắn đến ${label}`, data
  `{ target, threadId, message, attachments, sendMode: 'share', zaloEngagementSource (friend only), mediaResponse,
  forwardResponse }`, counted (CS:6874-6901).
- Forward failure per target → `createZaloErrorDetail` with `{ message: errorMessage || 'Chia sẻ tin nhắn Zalo thất bại',
  code: errorCode }` (CS:6903-6936).
- Media delivered but text failed → partial send `thất bại`, always counted (CS:6671-6702).
- Input: `chờ xử lý` when the policy requeues (no detail status), else `hoàn thành` with the failure log as note
  (CS:6978-7001).
- No success in the batch and nothing stopped yet → stop and **pause**, note
  `Toàn bộ ${claimedDetails.length} target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra` (CS:6780-6785).

### 3.6 Lines

- No `▶️` / `✅` per target and **no line per success**. Each distinct failure is logged once per batch as
  `⚠️ ${actionName}: ${log}` (CS:6945-6952).
- `📨 Kết quả chia sẻ tin nhắn Zalo: tổng ${n}, thành công ${ok}, thất bại ${failed}` (CS:6787-6790), then
  `⏸ Kết thúc batch: ${stopNote}` when stopping (CS:6791).
- Stop after the batch: campaign `tạm dừng` (pause case) or `chờ xử lý` with the note, fallback
  `Chiến dịch đã dừng sau batch để chờ kiểm tra lại` (CS:6143-6147).
- After all batches (friend): `🚫 Đã bỏ qua ${n} bạn bè Zalo trong danh sách không gửi tin` (CS:6191-6193, no list name).
- The sleep between batches has no `⏳ Nghỉ` line (CS:6178-6188).

### 3.7 Not done in share mode

Tag, alias, akaBiz (CS:8087-8093), opt-out link, template personalization, per-target AI rewrite.

### 3.8 Fly

ZS:1004-1144 (`runShareCampaign`), ZE:743-1152 (`executeShareBatch`). Same structure (batch ≤ 50, opt-out for friend,
cooldown, one claim, media per target with `mediaCacheKey: campaign-share-${unitToken}`, one `forward_message
{ threadIds (1–50), threadType, message }` → ZA `forwardMessageBatch` → `mforward`). Differences:
- one success line per target `${actionName}: Đã chia sẻ tin nhắn đến ${name}.` / `… vào group ${name}.` (ZE:1111-1126);
- summary `📨 Kết quả chia sẻ: ${completed}/${n} target thành công; ${stop ? "chiến dịch dừng" : "đã xử lý xong batch"}.`
  (ZE:1143-1145); no `⏸ Kết thúc batch` line;
- pause note `Toàn bộ ${inputs.length} target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra.` (period);
- capacity `min(50, max(1, capacity ?? 50))` (ZE:524-540); a quota stop logs `⏸ Dừng chiến dịch: ${note}` (ZS:1023-1034);
- forward failure without code → `err_zalo_api_business_failed`, text `Chia sẻ tin nhắn Zalo thất bại.` (ZE:965-977);
- interrupted text phase uses code `campaign_share_interrupted`;
- share repeat is not implemented anywhere in the repo.

---

## 4. Fly: shared differences

### 4.1 Routing and support

- All ten types are in `ZALO_CAMPAIGN_ACTION_IDS` (CRR:15-27) and run in the old executor (`ZaloCampaignScheduler.runCampaign`
  ZS:706-1002 → `ZaloCampaignExecutor.executeTarget` ZE:1172-1440). `FlyEngineRunner.accepts` (FER) only takes
  `zalo_message_phone` for orgs in `aka_agent_engine_enabled_orgs_v1()`.
- Commands (CC:70-136, AS:428-699): `get_user_profile`, `get_friend_request_status`, `campaign_find_user`, `send_text`,
  `send_campaign_media`, `forward_message`, `send_friend_request`, `undo_friend_request`, `add_group_member`,
  `join_group_link`, `get_all_friends_page`, `get_label_conversation_uids`, `get_friend_recommendations`,
  `get_sent_friend_requests`, `apply_label`, `change_friend_display_name`. Command timeouts 90 s / 180 s (media);
  a mutating command that times out → `command_result_unknown` → failure cleanup, never a detail.

### 4.2 Texts

| Item | Desktop | Fly |
|---|---|---|
| Failure detail `log` | rendered policy text (`noti_running_process`), e.g. `Người nhận chặn tin nhắn từ người lạ` | raw Zalo / error message (ZE:2417-2419) |
| Failure line without a detail | `⚠️ ${actionName}: ${log}` | `${actionName}: ${notice}` (no `⚠️`, ZE:2433, 2436) |
| Missing UID / group / link | 114 policy text, action of the step (`Nhắn tin người lạ`, …) | `UID người dùng Zalo không hợp lệ.` etc., often under the campaign's action id and name |
| Success texts | no trailing period; label = display name → original name → phone → uid | trailing period; `displayName || uid` |
| Quota skip | once per run, `⚠️ Bỏ qua ${name} vì đã đạt giới hạn: ${note}` | every target, `⚠️ Bỏ qua ${name}: ${reason}` |
| `🚀` line | always after the claim | only when due rows exist |
| Date tokens | DB time when the template uses them | worker clock |
| Multi-slot line | `ở khung giờ ${nextSlot} (${formatVietnamDateTime(nextSchedule)})`, Desktop suffixes | UTC ISO, no suffixes |

### 4.3 Behavior

- Zero rows in a direct campaign: Fly completes (or releases with `Chưa có data Zalo để chạy.` for `wait`
  dispositions); Desktop runs the workflow once with no row (§1.4).
- A `campaign_runtime_unavailable` error outside a step pauses the campaign through the generic catch (ZE:1409-1411).
- Group: `g` stripped in normal mode; tag/alias executed for any type when the flags are set.
- Add member always `thành công` (§2.5).
- No SMS push, no share repeat.

---

## 5. What the core needs

### 5.1 Cross-cutting changes to the core

1. **UID resolution as a gate step.** On Desktop a resolve helper writes no history row on success. The core needs a
   step with `gate: true` (no outcome when it passes; RU `step.gate && raw.ok`) or `RawOutcome.noOutcome`
   (CT; RU `raw.noOutcome`) that fails with `{ kind: 'engine', code: 'target_missing_identity', message }` (V500 → DAT01) and
   stores `state.zaloTarget`.
2. **Non-success "ok" outcomes need a status code.** `RawOutcome.statusCode` already exists (CT); new statuses used:
   `campaign_detail_already_member` (`đã là thành viên`), `campaign_detail_joined` (`đã tham gia`); 222/225 stay
   DB-policy driven.
3. **Mutating non-message steps** (add member, join, cancel) should be `delivery: true` so the "sắp gửi" mark protects
   them from replay after a crash (RU `step.delivery && !step.gate` → `markSending`).
4. **Materialization hook.** Friend (all/tagged), birthday, recommendation and cancel create rows at run start, under the
   campaign claim, before any target exists. runUnit currently ends the unit on `no_target` after `onNoTarget`
   (RU `claim.status === 'no_target'` branch). Needed: a host `prepareTargets(lease, signal)` hook, called after a `no_target`
   claim, that may insert rows and ask runUnit to claim again once, plus the empty-result completions of §2 (birthday
   `🎂`, recommendation / cancel `⚠️ ${note}`, friend `⚠️` notes left `chờ xử lý`).
5. **Completion variants.** `aka_agent_engine_finish_campaign_v1` (V495:1717-1748) only defers to future rows or
   completes. Realtime (wait window), multi-slot, share repeat and the Desktop suffixes are missing
   (`zalo-scheduling-completion.md` §5.8).
6. **Batch unit for share mode.** runUnit claims one target per run (RU claim loop, `deps.data.claimTarget`). Share mode needs a batch
   claim (≤ 50 ids), one content preparation, per-target media, one forward and per-target reports with the batch
   policy scope (§3.5). Until then `support()` must return `share_mode`.
7. **Realtime intake stays outside runUnit.** The core can share pure helpers: group / member id normalization
   (RG:627-633), trigger labels (RG:635-639), `schedule_at` (RG:575-587) and the two history texts (RG:554-556).

### 5.2 Port additions

The current port (`ZaloMessagePhonePort extends ZaloAuxiliaryPort`, MP) already has `takeContentIndex`,
`businessNow`, `sendText(ctx, uid, message)`, `sendFriendRequest`, `isOptedOut`, `friendStatus`, `applyLabel`,
`mirrorLabel`, `changeAlias`, `applyAkaBizTags`. Proposed additions (Desktop mapping / Fly command):

```ts
interface ZaloOtherTypesPort {
  /** Profile by UID; null when Zalo returns none. Desktop: zaloRuntime.getUserProfile (ZR:1626). Fly: get_user_profile. */
  getUserProfile(ctx: StepContext, uid: string): Promise<ZaloFoundUser | null>
  /** Upsert the resolved profile into contacts (CS:8066-8085); errors are traced, never fail the step. */
  saveResolvedProfile(ctx: StepContext, target: ZaloResolvedTarget, source: string): Promise<void>
  /** Text to a user or a group. Desktop: sendMessageToUser/Group (ZR:1664-1682). Fly: send_text {threadId, threadType, message}. */
  sendText(ctx: StepContext, threadId: string, message: ZaloOutgoingText, threadType: 'user' | 'group'):
    Promise<{ response: unknown; msgId: string | null }>
  /** Desktop: undoFriendRequest (ZR:2181). Fly: undo_friend_request {userId}. */
  undoFriendRequest(ctx: StepContext, uid: string): Promise<unknown>
  /** Normalized like ZR:1684-1803 (Fly's adapter must return `outcome`). */
  addGroupMember(ctx: StepContext, input: { groupId: string; memberId: string; useShareMethod: boolean }): Promise<{
    groupId: string; groupName?: string; groupType: number | null; mode: 'share_group_link' | 'invite_user_to_groups' | 'direct_add'
    outcome: 'added' | 'invited' | 'already_member' | 'link_sent'; message: string; groupLink?: string; response: unknown }>
  /** Like ZR:1805-1840; 178 → already_joined, 240 → pending_approval. */
  joinGroupByLink(ctx: StepContext, link: string): Promise<{
    link: string; groupId: string; groupName?: string; group: Record<string, unknown>
    outcome: 'joined' | 'already_joined' | 'pending_approval'; zaloCode?: string; zaloMessage?: string; response?: unknown }>
  /** Group contact with is_joined (CS:8050-8064). */
  saveJoinedGroup(ctx: StepContext, result: Awaited<ReturnType<ZaloOtherTypesPort['joinGroupByLink']>>, isJoined: boolean): Promise<void>
}

/** Used by the materialization hook (§5.1.4), with the lease held; reads are paced 2–5 s and retried on 429 (15/30/60 s). */
interface ZaloMaterializePort {
  listLabels(signal: AbortSignal): Promise<Array<{ id: number; text: string; conversations: string[] }>>
  getAllFriendsPage(count: number, page: number, signal: AbortSignal): Promise<Record<string, unknown>[]>
  getFriendRecommendations(signal: AbortSignal): Promise<{ profiles: Array<{ uid: string; name: string; phone?: string }>;
    totalItems: number; recommendedItems: number; missingUidItems: number; hasRecommendationList: boolean }>
  getSentFriendRequests(signal: AbortSignal): Promise<{ profiles: Array<{ uid: string; name: string; sentAt: number | null;
    requestMessage?: string; globalId?: string }>; totalItems: number; missingUidItems: number }>
  upsertUserContacts(rawProfiles: Record<string, unknown>[], source: string): Promise<void>
  insertTargets(rows: Array<{ uid: string; name: string; phone?: string; info1?: string; info2?: string; info3?: string }>): Promise<void>
  clearTargets(): Promise<void>
  setMarkers(patch: Record<string, unknown>): Promise<void>
  businessNow(): Promise<Date>
  progress(text: string): void
}
```

The port's `sendMedia(ctx, { threadId, threadType: 'user' | 'group', files, message?, stepKey })` (MP) already
covers groups (see `zalo-media.md` §8.2). Share mode additionally needs
`forwardMessage(ctx, threadIds, threadType, message): Promise<Array<{ threadId; ok; errorCode?; errorMessage?; raw? }>>`.

### 5.3 Reusable pieces from `messagePhone.ts` and `common.ts`

- `prepare()` (MP, inside `buildZaloMessagePhoneSteps`): variant split, rotation with `takeContentIndex`, preparation
  error handling. Move it to `common.ts` and pass the action code (`zalo_message_stranger`, `zalo_message_friend`,
  `zalo_message_group`, `zalo_add_friend`).
- `optOut` gate: same checks (input phone, profile phone, global ID, warnings, `on_error` setting). Needs a parameter for
  the label (`name → uid → phone` for these types) and the step it requires (`resolve`). Desktop also adds the warning
  `Không lấy được Zalo global ID để kiểm tra từ chối nhận tin; vẫn tiếp tục xử lý target: ${message}` when the profile
  read throws (CS:7282-7284); pass it from the resolve step through `ctx.state`.
- `message` step: generalize the action code, action name, thread type, `enabled` (always for friend/birthday/group) and
  the opt-out link switch (off for group).
- `friend` step: reuse as is (150-character cut, no link, runs when the message failed).
- `buildZaloAuxiliarySteps` and `buildAkaBizTagStep` (AUX) for tag, alias and akaBiz.
- `zaloFailure`, `preparationFailure`, `zaloPortErrorFrom` with `operation: 'read'` for profile reads and lookups and
  `'send'` for every mutating call; `zaloTargetLabel`, `renderZaloTemplateText`, `templateUsesDatabaseDate`,
  `normalizeZaloFoundUser`.
- `searchZaloPhone` (`content/zaloPhoneSearch.ts`) + the `lookup` step for add-member phone rows (with action
  `zalo_find_phone_user`, `Tìm SĐT`).
- `zaloMessagePhoneClaimPlan` logic: extract a helper for the "stranger send codes" plan.
- `zaloMessagePhoneV2Support`: extract the feature checks (`hasDeclaredMedia`, `hasSendExclusionConfig`, advanced,
  formatted, AI, opt-out link, akaBiz, cooldown, SMS, share, engagement, data group) into a shared function.

### 5.4 Per type

Claim plans use `ClaimContext.actions` (CT `ClaimContext`); "skippable" means
`{ code, required: false, skippableGates: ['quota'] }` when `actionLimits.continueWhenActionLimitReached === true`, plus
`requireAny` over the send codes, exactly like MP. Target label: the runUnit default (name → uid → phone, RU `labelOf`)
matches Desktop for all ten types.

#### `zalo_message_group_member`, `zalo_message_remarketing_customer`, `zalo_message_friend_recommendation`, `zalo_message_group_realtime`

- Steps: `resolve` (gate, action `zalo_message_stranger` / `Nhắn tin người lạ`, missing-UID text per type:
  `UID thành viên group Zalo không hợp lệ` / `UID khách hàng cũ Zalo không hợp lệ` / `UID đề xuất Zalo không hợp lệ`;
  `getUserProfile` + `saveResolvedProfile`) → `opt_out` (gate) → exclusion and cooldown gates (when ported) →
  `akabiz_tag` (person, requires `opt_out`) → `message` (`zalo_message_stranger`, `enabled: enableMessage`) → `friend`
  (`zalo_add_friend`, `enabled: enableAddFriend`) → tag, alias (requires `opt_out`).
- Claim plan: send codes only (no `zalo_find_phone_user`), skippable on quota as above.
- Action names: `{ zalo_message_stranger: 'Nhắn tin người lạ', zalo_add_friend: 'Kết bạn', zalo_tag_contact: 'Gắn tag Zalo',
  zalo_change_alias: 'Đổi tên Zalo' }`.
- `support()` fallbacks: as MP; group member also `sms_push`.
- Port: `getUserProfile`, `saveResolvedProfile`, existing send / friend / aux methods.
- Realtime only: keep RG / RE intake; completion needs the window wait (§5.1.5).
- Recommendation only: materialization through `ZaloMaterializePort.getFriendRecommendations` (no contact upsert).

#### `zalo_message_friend`

- Steps: (legacy blocklist gate when ported) → `resolve` (gate, action `zalo_message_friend` / `Nhắn tin bạn bè`, text
  `UID bạn bè Zalo không hợp lệ`) → `opt_out` → exclusion, cooldown → `akabiz_tag` (person) → `message`
  (`zalo_message_friend`, always enabled, opt-out link allowed) → tag, alias.
- Claim plan: `[{ code: 'zalo_message_friend' }]`.
- `support()` fallbacks: share mode, auto modes (until §5.1.4), multi-slot (until §5.1.5), legacy blocklist, plus MP's list.
- Materialization (all / tagged): `listLabels`, `getAllFriendsPage`, `upsertUserContacts`, `insertTargets`, marker
  `zaloFriendDataMaterializedAt` / `zaloFriendMaterializedCount`, Desktop lines of §2.2.

#### `zalo_message_birthday`

- Steps: as friend, without `akabiz_tag`, tag and alias.
- Claim plan: `[{ code: 'zalo_message_friend' }]`; action names `{ zalo_message_friend: 'Nhắn tin bạn bè' }`.
- Materialization: friends pages filtered by `sdob` `DD/MM` of `businessNow()`, marker
  `zaloBirthdayDataMaterializedDate`; empty → completion with note `Không có bạn bè sinh nhật hôm nay` and the `🎂` line.

#### `zalo_message_group`

- Steps: `target` (gate: group id from `uid`; decide whether to strip `g`; Desktop normal mode does not) → cooldown gate →
  `message` (`zalo_message_group` / `Nhắn tin group`, thread `group`, no opt-out link, no engagement) →
  `akabiz_tag` (contact type `group`, **requires `message` to succeed**).
- Claim plan: `[{ code: 'zalo_message_group' }]`.
- `support()` fallbacks: share mode, multi-slot, plus MP's content checks; ignore tag/alias flags (Desktop has no nodes).

#### `zalo_add_group_member`

- Validation: the destination group (`zaloAddGroupMemberTargetGroupId`) is campaign config. Desktop fails every row with a
  non-counted 114 until the bad-target threshold pauses the campaign; a `validateCampaign` issue (scope `campaign`,
  RU `cfg.validateCampaign` branch) would stop at once — a product decision.
- Steps: `resolve`: UID → `getUserProfile` (no akaBiz); else phone → reuse MP `lookup` (`zalo_find_phone_user`, writes
  `Tìm SĐT` rows, updates the row's name/UID) + `akabiz_tag`; neither → `target_missing_identity` with
  `Data cần có SĐT hoặc UID Zalo` (Desktop: not counted) → `add` (`zalo_add_group_member` / `Thêm thành viên vào group`,
  `delivery: true`): outcome mapping of §2.5, errors via `zaloPortErrorFrom(…, { operation: 'send' })`; quota off for
  failures (DB policy).
- Claim plan: `[{ code: 'zalo_add_group_member' }, { code: 'zalo_find_phone_user', required: false }]`. Desktop checks the
  lookup lock/quota only for phone rows and then requeues the row and stops; the core needs a step-level rule for a
  `wait` decision on `zalo_find_phone_user` (today runUnit just skips the step, RU `gate?.decision === 'wait'`,
  which would end the row with `no_outcome`).
- Port: `getUserProfile`, `saveResolvedProfile`, `addGroupMember`, existing `findUser` / `saveFoundUser`.

#### `zalo_join_group_link`

- Steps: `join` (`zalo_join_group_link` / `Tham gia group`, `delivery: true`): link from `uid` normalized as CS:7880-7902
  (invalid → `target_missing_identity`, `Link group Zalo không hợp lệ`); `joinGroupByLink`; `saveJoinedGroup`; outcomes
  `joined` / `pending_approval` → success (counted), `already_joined` → `campaign_detail_joined` (not counted).
- Claim plan: `[{ code: 'zalo_join_group_link' }]`. The find-data wait already exists in DER `onNoTarget`.

#### `zalo_cancel_sent_friend_request`

- Materialization every pass when no row or all rows are done: `clearTargets`, `getSentFriendRequests`, oldest first,
  limit `zaloCancelFriendRequestLimit` (default 10), rows with `info1..info3`, marker; empty / error → completion with the
  `⚠️` line.
- Steps: `cancel` (`zalo_cancel_sent_friend_request` / `Huỷ lời mời kết bạn`, `delivery: true`), missing UID →
  `target_missing_identity` with `UID lời mời kết bạn Zalo không hợp lệ`; success log uses the target label.
- Claim plan: `[{ code: 'zalo_cancel_sent_friend_request' }]` (lock only; the DB limit must honor the empty
  `limit_check_action_codes`).
- Port: `undoFriendRequest`, `ZaloMaterializePort.getSentFriendRequests`.

---

## 6. Observations to confirm

1. **Normal-mode group sends keep the `g` prefix** on Desktop (CS:15783, ZR:1674-1682); share mode, add member, realtime
   and Fly strip it. Check whether stored group ids ever start with `g` before choosing a rule.
2. **Daily birthday campaigns are not re-armed** after they complete (CR:3690-3697; only weekly/monthly are re-armed at
   CR:3848-3867). Confirm this is intended.
3. **Desktop add-member logs read oddly**: `${result.message} cho ${targetLabel} vào group ${groupLabel}` yields
   `Đã thêm thành viên vào group cho X vào group Y` (CS:15882).
4. **Group-member friend requests after a lock on the message**: the row is requeued although a friend request was sent
   (§2.1 outcome 5); the managed settle may turn it into `tạm dừng` (AR:193). Decide the engine rule (V500 policies) explicitly.
5. **Fly add member always reports success** (§2.5); fix the adapter or the executor before comparing Fly with Desktop
   reports.
6. **Zero-row campaigns** write one 114 row without an input on Desktop (§1.4) but complete silently on Fly.
