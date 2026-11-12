# Zalo auxiliary actions after a send: tag, alias, akaBiz tag

Behavior spec for moving these actions into `packages/campaign-engine`. Research only, 12/11/2026.

**Sources.**
- akaAgent worktree `campaign-engine-v2`: HEAD `24ff928c`, plus uncommitted changes. None of those changes touch the paths below.
- ChatApi worktree `akaAgentChatApi-deploy-dbb38b7`: HEAD `dbb38b7`.

**No DB was queried.** The workflow wiring comes from the repo snapshot `migrations/snapshots/campaign-content-v350/source.json`, captured 2026-10-06 08:16 UTC, and from the migrations that created the workflows. No later migration touches these workflows (checked V350→V500). The DB is the source of truth, so re-read live `auto_workflows` 260/266/272/274/276/280 and `auto_blocks` 2772/2773 before shipping.

**Abbreviations.**

| Short | Path |
|---|---|
| CS | `src/main/services/campaignScheduler.ts` |
| ZR | `src/main/services/zaloRuntimeService.ts` |
| AUX | `src/shared/zaloAuxiliaryActions.ts` |
| FORM | `src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx` |
| ZE | ChatApi `apps/system-worker/src/zaloCampaignExecutor.ts` |
| CRR | ChatApi `packages/database/src/campaignRuntimeRepository.ts` |
| AS | ChatApi `apps/zalo-server-runtime/src/accountSupervisor.ts` |
| ZA | ChatApi `packages/zalo-zca-adapter/src/index.ts` |

## 0. Summary

| | Zalo tag | Zalo alias (tên gợi nhớ) | akaBiz CRM tag |
|---|---|---|---|
| Flag | `enableZaloTag` | `enableZaloAlias` | `enableAkaBizTag` |
| Action code / name | `zalo_tag_contact` / `Gắn tag Zalo` | `zalo_change_alias` / `Đổi tên Zalo` | none (no action code) |
| Position in a target | after message + friend request | last, after tag | while resolving the target (before the message). Group campaigns: after a successful group send |
| `auto_campaign_details` row | yes, except the silent skips | yes, except the friend skip | never (progress line only) |
| Quota / consecutive bad-target streak | never / never | never / never | n/a |
| Zalo call (Desktop) | `getLabels` (once per target) + `updateLabels`. Label is *moved* to the contact | `changeFriendAlias` | none (DB only) |
| Fly command | `apply_label` | `change_friend_display_name` | none (direct SQL) |
| In the core today | no: `zaloMessagePhoneV2Support` → `auxiliary_actions` | no (same) | no → `akabiz_tag` (`packages/campaign-engine/src/zalo/messagePhone.ts:122-123`) |

## 1. Campaign types that support them

### Desktop / VPS runtime

Each target runs a DB workflow. Tag and alias are two nodes at the end of a linear chain. The block code calls exactly one helper (V350 snapshot, blocks 2772/2773):

```js
return await helpers.zaloApplyContactTag({ target: input.zaloTarget, enabled: vars.enableZaloTag, labelId: vars.zaloTagId, labelName: vars.zaloTagName });
return await helpers.zaloChangeContactAlias({ target: input.zaloTarget, enabled: vars.enableZaloAlias, alias: vars.zaloAlias, inputData: vars.inputData });
```

| `action_id` | Workflow | Chain | Defined in |
|---|---|---|---|
| `zalo_message_phone` | 260 | find_phone → send_message → send_friend_request → apply_tag → change_alias | `migrations/migration_v113_zalo_message_phone_campaign.sql:296-303` |
| `zalo_message_friend` (normal mode) | 266 | send_message → apply_tag → change_alias | `migration_v124_…sql:142-147` |
| `zalo_message_group_member` | 272 | resolve_member → send_message → send_friend_request → apply_tag → change_alias | `migration_v126_…sql:152-159` |
| `zalo_message_remarketing_customer` | 274 | resolve_customer → (same) | `migration_v127_…sql:152-159` |
| `zalo_message_group_realtime` | 276 | resolve_member → (same) | `migration_v132_…sql:196-203` |
| `zalo_message_friend_recommendation` | 280 | resolve_recommendation → (same) | `migration_v134_…sql:152-159` |

**No tag/alias:**
- `zalo_message_birthday` (workflow 270: send only);
- `zalo_message_group` (workflow 268: send only);
- share mode (batch path, no workflow);
- add-group-member, join-group-link, cancel-friend-request.

Workflows 262/267/273/275/277/281 are the editor test copies of the same chains.

**UI.** The form saves `enableZaloTag`/`enableZaloAlias` only for the six types above, and for friend only when not in share mode:
- FORM:2604-2606 (`supportsZaloAuxiliaryActions`), FORM:6593-6607;
- the same predicate drives the account display list (`src/shared/campaignActionDescriptors.ts:328-344`).

**akaBiz in the UI.** Allowed when `supportsAkaBizContactTags = isZaloMessageCampaign && !birthday && !share` (FORM:2534; otherwise saved `false`, FORM:6603). That is: phone, friend, group member, group realtime, remarketing, recommendation, and group in normal mode.
- The runtime excludes birthday and share mode itself (CS:8122-8130).
- The App Server RPC also whitelists `zalo_add_group_member` (§4.4).
- Desktop's `zaloFindPhoneUser`, used by add-group-member when the data has a phone (CS:15448), would apply akaBiz tags if the flag were set.

## 2. Configuration (`auto_campaigns.extra_settings`)

### 2.1 Zalo tag

| Key | Type / default | Notes |
|---|---|---|
| `enableZaloTag` | bool, `false` | Variable `enableZaloTag: extra.enableZaloTag === true` (CS:10796) |
| `zaloTagSettingsByAccountId` | `{ [accountId]: { zaloTagId, zaloTagName, zaloTagSkipTagIds, zaloTagSkipTagNames } }` | Saved for the campaign's account(s), primary plus secondary (FORM:6597, `pickZaloAccountTagSettings`, AUX:54-58). When the key is present the map is authoritative, and a missing entry means "no tag" (AUX:43-52) |
| `zaloTagId` | number/string/null | Legacy flat id. The form mirrors the primary account's id into it (FORM:6594). Variable `zaloTagId: extra.zaloTagId ?? null` (CS:10797) |
| `zaloTagName` | string | Legacy flat name (FORM:6595). Variable `zaloTagName: extra.zaloTagName \|\| ''` (CS:10798) |
| `zaloTagSkipIfFriend` | bool, `false` | Skip when the target is already a friend |
| `zaloTagSkipIfHasSelectedTags` | bool, `false` | Skip when the contact already has one of the skip labels |
| `zaloTagSkipTagIds` / `zaloTagSkipTagNames` | string[] | Legacy flat skip list, mirrored for the primary account (FORM:6600-6601) |

**Normalization** (`normalizeZaloAccountTagSettings`, AUX:30-41): ids must match `/^[1-9][0-9]*$/`; names are aligned to ids by index.

**Form validation** (FORM:6826-6838):
- `Vui lòng chọn tag Zalo cần gắn cho tài khoản <name>.`
- `Vui lòng chọn ít nhất một tag trong điều kiện không gắn tag cho tài khoản <name>.`

**Which label id runs** (CS:16244-16251). Settings are resolved for the **running** account `account.id`. A fallback or secondary account therefore uses its own label (`scripts/zalo-auxiliary-skip-smoke-test.cjs:146-177`).
- Map present: `settings.zaloTagId`, a normalized digit string.
- Map absent: the raw `extra.zaloTagId`, not normalized.

**Label name in logs**: `label.text` from Zalo, else the configured `zaloTagName`, else the id (CS:16282, 16302).

### 2.2 Alias

| Key | Type / default | Notes |
|---|---|---|
| `enableZaloAlias` | bool, `false` | |
| `zaloAliasTemplate` | string | Variable `zaloAlias: extra.zaloAliasTemplate \|\| ''` (CS:10800). Saved trimmed (FORM:6607). The form rejects an empty template when enabled: `Vui lòng nhập template đổi tên Zalo.` (FORM:6972) |
| `zaloAliasSkipIfFriend` | bool, `false` | |

**Default templates** (UI only; FORM:1121-1132, filled when the box is ticked, FORM:9708-9715):
- `zalo_message_phone`: `#{FULL_NAME} - #{PHONE}`;
- every other type: `#{FULL_NAME}`.

**Rendering.** Path: CS:16359-16366 → `renderZaloTemplate(alias, vars.inputData, target, false, businessNow).trim()` (CS:15050-15079) → `renderCampaignTemplateText`. The core copy is `packages/campaign-engine/src/content/campaignContentTemplate.ts`.
- Spin `{a|b}` is applied first.
- Tokens:
  - `#{FULL_NAME}` → `target.displayName` (the Zalo name, not the input name);
  - `#{ORIGINAL_NAME}`;
  - `#{INPUT_FULLNAME}` → `input.name`;
  - `#{UID}` → `input.uid`;
  - `#{PHONE}` / `#{MOBILE}` → normalized VN mobile of `target.phone`, else `input.phone`;
  - `#{EMAIL}`, `#{INFO1..5}`, `#{SEX{nam-nữ-khác}}`;
  - `#{TODAY(fmt)}`, `#{TOMORROW(fmt)}`, `#{YESTERDAY(fmt)}`.
- Date tokens use DB business time, read only when such a token is present (CS:15038-15048).
- There is no opt-out replacement, so `#{STOP_MESSAGES_LINK}` stays literal.
- `vars.inputData` is `{id, name, phone, uid, email, info1..info5}` of the target row (CS:10802-10816).

**The 50-character problem.**
- **There is no truncation anywhere.** ZR:2273-2276 sends the string as is; the Fly legacy path also does not truncate (its zod schema allows 1–500 characters, `packages/runtime-protocol/src/index.ts:401-404`).
- Zalo `alias/update` returns code `112` with the message `Lỗi không xác định` when the name is longer than 50 characters.
- Measured (CLAUDE.md pitfall, 06/11/2026): in 14 days, 3,870/4,078 failures were names over 50 characters. At ≤ 50 characters almost nothing fails; from 51 characters 100% fail.
- The review doc counts 7.5k Desktop/VPS failures (Z999) and 155 on Fly in 30 days (`docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md:208`).
- Code 112 has no policy for `zalo_change_alias`, so it falls back to `err_zalo_api_business_failed` (§5.2).
- **Approved fix, not built anywhere yet:** truncate to ≤ 50 characters in the core (same doc, lines 98, 208, 306: "phase 3").
- With the default phone template, `#{FULL_NAME}` plus ` - 0912345678` (13 chars) is enough to exceed 50.

### 2.3 akaBiz tag

| Key | Type / default | Notes |
|---|---|---|
| `enableAkaBizTag` | bool, `false` | |
| `akaBizTagIds` | number[] | `auto_contact_tags.id` of the staff. The runtime keeps finite ids > 0 and dedupes them (CS:8131-8142). The form requires at least one: `Vui lòng chọn tag akaBiz cần gắn.` (FORM:6968-6971) |
| `akaBizTagNames` | string[] | Display only |

## 3. When they run (Desktop / VPS)

### 3.1 Mechanism

- A node's input is the node config plus its **direct parent's** output only (`src/main/v2/runtime/workflowEngine.ts:748-761`).
- A node runs only when its parents succeeded. A parent error marks all descendants `skipped` (workflowEngine.ts:653-735).
- Helpers do not throw for platform errors. They return `{ ok, skipped?, zaloTarget, detail }`. Every Zalo helper passes `zaloTarget` through, including when disabled: `{ ok: true, skipped: true, zaloTarget: options.target ?? null }`.
- All helpers of one target share one `runZaloAction` wrapper (CS:16415-16423):

```ts
if (stoppedTarget) return { ok: true, skipped: true, zaloTarget: stoppedTarget.zaloTarget }
const result = await operation()
if (result.detail?.stopRemainingActions) stoppedTarget = result
```

### 3.2 Preconditions for tag and alias (both)

1. **Flag on.** Otherwise the helper passes the target through, with no detail and no log (CS:16235, 16350).
2. **A resolved target with `uid`.** Otherwise the helper is skipped silently (CS:16238, 16353). This covers:
   - phone not found (the find helper returns no `zaloTarget`);
   - opt-out or send-exclusion block (find returns `zaloTarget: null`, CS:15346-15357);
   - friend message with an empty uid.
3. **No earlier "uncertain" helper result in this target.** `stopRemainingActions` is set by `createZaloErrorDetail` for `campaign_media_timeout` or `command_result_unknown` (CS:14874-14876, 14929), and partial-send details keep it. After such a result, tag and alias are skipped silently.
4. **No helper exception earlier in the chain** (descendants are skipped).
5. **Not conditional on the message or friend-request outcome.** Tag and alias also run:
   - after a failed send (122, 114, …);
   - when message or friend request is disabled;
   - when message or friend request is skipped because it hit its limit (`continueWhenActionLimitReached`: skipped codes are passed as `enableMessage:false` etc. through `skippedLimitActionCodes`, CS:4459-4468).
6. **Not conditional on friendship,** except through `zaloTagSkipIfFriend` / `zaloAliasSkipIfFriend`.
7. **Never quota- or lock-gated** (§7).

**Order.** Tag runs before alias. The alias does not depend on the tag result: a failed tag still returns `zaloTarget` (CS:16336-16340).

### 3.3 Friend status for the skip options

Code: `resolveZaloAuxiliaryFriendStatus`, CS:16195-16227.

- The status is read only when a skip-if-friend option of an enabled action is on.
- First it checks `readZaloApiFriendStatus(target.raw)` (AUX:2-14): keys `isFr` / `is_fr` / `is_friend` on `raw.profile ?? raw.user ?? raw`.
  - Profile-based targets usually carry `isFr`.
  - When the send-exclusion gate reads friendship, it writes `isFr` into `target.raw.profile` (CS:7221-7228).
- Otherwise it calls `zaloRuntime.getFriendRequestStatus(accountId, uid)` and reads `readZaloApiFriendStatus(response.raw)`.
  - At most one call per (account, uid) per target. The promise is shared by tag and alias through a Map created per target run (CS:16425).
  - Errors are swallowed and give `null` (CS:16209-16214).
- `null` writes one warning line (§6) and the action proceeds.

### 3.4 akaBiz timing (Desktop)

Shared code: `applyAkaBizTagsToZaloTarget`, CS:8154-8226.

| Type | Where | Relative to the message |
|---|---|---|
| `zalo_message_phone` | In `zaloFindPhoneUser`, after: contact upsert, input `name`/`uid` update, and the opt-out + send-exclusion gate passed (CS:15324-15361) | Before. Never when the phone is not found or the target is blocked |
| group member / realtime | `zaloResolveGroupMemberTarget` after the profile upsert (CS:15412) | Before |
| remarketing | CS:15506 | Before |
| friend recommendation | CS:15546 | Before |
| `zalo_message_friend` | `zaloSendFriendMessage` after resolve + upsert, before content preparation (CS:15764) | Before |
| `zalo_message_group` | After a successful `dispatchZaloMessage` (CS:15843), contact type `group` | After; only on success |
| birthday, share mode | never (`getAkaBizTagIdsForCampaign` returns `[]`, CS:8124-8128) | — |

## 4. Runtime calls and DB writes

### 4.1 Tag (Desktop)

Call site, CS:16275:

```ts
const label = await this.zaloRuntime.applyLabelToUser(account.id, target.uid, labelId, skipLabelIds, this.getSendExclusionLabels(account, campaign))
```

**Skip list.**
- `skipLabelIds = settings.zaloTagSkipTagIds` when `zaloTagSkipIfHasSelectedTags`, else `[]`.
- If the option is on but the list is empty, a warning is written and the tag continues without a skip list (CS:16269-16274).

**Label context.** `getSendExclusionLabels` (CS:7203-7211) keeps one `CampaignLabelContext` per campaign, built by `zaloRuntime.createCampaignLabelContext(accountId)` (ZR:2201-2223).
- It is deleted per target (CS:5019, in a `finally`; also CS:7267 at preflight start, and 3874/5975/6133).
- So `api.getLabels()` runs **once per target**, shared with the send-exclusion gate (`zalo_labels` source).
- The context throws `Phiên tag Zalo đã thay đổi; hãy thử lại trong lượt mới.` when the Zalo session or API changes (ZR:2207-2213).

**`applyLabelToUser`** (ZR:2225-2271):
1. Validate the uid (`UID Zalo không hợp lệ`) and that `Number(labelId) > 0` (`Tag Zalo không hợp lệ`).
2. `response = context.current()`: the working copy.
3. Exclusion check against the **initial** snapshot with `findZaloExcludedLabels` (AUX:67-81). A hit returns a `ZaloLabelSkipResult` and writes nothing.
4. Target label missing → `throw new Error('Tag Zalo không tồn tại')` (ZR:2240).
5. **Move semantics** (a Zalo conversation carries one label): add the uid to the target label's `conversations` and remove it from every other label.
6. Only if something changed: `api.updateLabels({ labelData, version: response.version })` (optimistic version; Zalo answers `230 "Outdated input"` when stale), then `context.commit(updated)`.
7. Return the label (`LabelData`, with `text`).

**Mirror to the contact** (CS:16283-16295 → `src/main/data/repositories/accountContactRepository.ts:1758-1830`):
- Reads `extra_data` of the existing person contacts for (account, staff, uid).
- Merges `zaloTags` / `zaloTagIds` / `zaloTagNames` by **adding** the label. It does not remove the labels that Zalo just dropped.
- PATCHes `auto_account_contacts.extra_data`.
- Errors only produce `console.warn('[CampaignScheduler] Failed to mirror Zalo tag to contact:', …)`.

### 4.2 Alias

CS:16383 → ZR:2273-2276:

```ts
api.changeFriendAlias(String(alias || ''), uid)   // zca-js, Zalo alias/update
```

There is no explicit timeout around the call.

### 4.3 Friend status

ZR:1666-1677: `api.getFriendRequestStatus(uid)` → `{ isFriend, isRequested, isRequesting, addFriendPrivacy, raw }`.

### 4.4 akaBiz (no Zalo call)

**UIDs** (CS:8145-8152): person `[uid]`; group `[uid, uid without a leading g]`.

**Desktop** (`runtimeTarget !== 'server'`): `applyAkaBizTagsToContactTargets` (`src/main/data/repositories/contactTagRepository.ts:278-327`).
1. SELECT `id` from `auto_account_contacts` by account, staff, `contact_type` and uid, in chunks of 100.
2. RPC `aka_agent_mutate_contact_tags(p_staff_id, p_organization_id, p_contact_ids, p_tag_ids, p_auth_username, p_auth_password, p_mode:'add')` (same file, 179-215). Retried twice on `40P01` / `40001`.

**RPC body** (repo version `migrations/migration_v352_zalo_server_campaign_tags.sql:39-129`):
- Asserts the automation identity.
- `aka_agent_internal_mutate_contact_tags` keeps only the staff/org's non-deleted tags.
- Raises `contact_tag_scope_invalid` when a tag is bound to another `auto_account_id`.
- Per contact:
  - if it maps to a chat conversation: insert `chat_zalo_conversation_system_tag` rows, then call `aka_agent_enqueue_data_group_chat_user` and `aka_agent_refresh_contact_chat_tags`;
  - otherwise: union into `auto_account_contacts.akabiz_tag_ids`.
- Returns `{success, count}`, where `count` is the number of contacts changed.

**App Server** (`runtimeTarget === 'server'`): `applyZaloServerCampaignTags` → RPC `aka_agent_apply_zalo_server_campaign_tags(staff, org, campaign, account, runtime_claim_token, runtime_unit_token, input_data_id, contact_type, target_uid, tag_ids)`.
- Client: contactTagRepository.ts:217-247. Latest body: `migrations/migration_v354_zalo_server_deleted_tags.sql:30-125`.
- Guards:
  - **legacy** claim and unit tokens;
  - input `đang chạy` inside the unit;
  - logged-in Zalo Server account;
  - `enableAkaBizTag` on;
  - action whitelist;
  - tags ⊆ the configured `akaBizTagIds` and in scope;
  - `target_uid` = input uid;
  - group-ness consistent with the action.
- Then the same internal mutation.
- **It does not accept engine-v2 leases.**

**Only existing contacts are tagged.** Phone, friend and profile flows upsert the contact first. The profile upsert happens only when the profile read returned data (CS:8100-8119). With `count === 0` there is no customer line, only a `console.warn`.

### 4.5 Diagnostics (errors only)

`auto_zalo_api_error_logs` gets one row per error, plus an account log `zalo_error` (`src/main/data/repositories/zaloApiErrorLogRepository.ts:69-100`). `api_name` is `updateLabels` or `changeFriendAlias` (CS:14749-14752).

## 5. Outcome handling (Desktop)

### 5.1 Rows written to `auto_campaign_details`

Writer: `logZaloMessagePhoneMilestones`, CS:11481-11541 → `createCampaignDetail`. The managed writer `aka_agent_write_action_result_v1` is always on for workflow runs (CS:3822).

`counts_toward_limit` is **false on every aux row**.

| Case | Status | `log` (verbatim) | `data` | Code |
|---|---|---|---|---|
| Tag applied (or already in the label: no `updateLabels` call) | `thành công` | `Đã gắn tag "<labelName \|\| labelId>" cho <label>` | `{ target, labelId, labelName }` | CS:16296-16306 |
| Tag: no label id (legacy flat config) | `tag không tồn tại` | `Tag Zalo không tồn tại` | `{ target, labelId }` | CS:16252-16266 |
| Tag: label no longer in Zalo (error text contains `Tag Zalo không tồn tại`) | `tag không tồn tại` | `Tag Zalo không tồn tại` | `{ target, labelId, error }` | CS:16310-16332. Also writes an error-log row with `detail_status` `tag không tồn tại`, `api_name` `updateLabels` |
| Alias changed | `thành công` | `Đã đổi tên <label> thành "<alias>"` | `{ target, alias, response }` | CS:16385-16395 |
| Alias renders empty | `tham số không hợp lệ` | `Tên Zalo mới không hợp lệ` | `{ target, alias }` | CS:16367-16380 |
| Zalo, network or other error | per §5.2 | per §5.2 | `{ target, labelId \| alias, inputData?, error, zalo: { code, message, policyErrorCode } }` | CS:16334-16340, 16397-16403 |
| Silent skips (friend, excluded label, no tag for this account) | no row | progress line only (§6) | — | — |

`<label>` = `getZaloTargetLabel(target)` = `displayName || originalName || phone || uid || 'target'` (CS:15034-15036; core `zaloTargetLabel`).

In the managed writer, the legacy status text maps to `auto_status` codes (`statusForLegacyValue`):
- `thành công` → `campaign_detail_success`
- `tag không tồn tại` → `campaign_detail_tag_not_found`
- `tham số không hợp lệ` → `campaign_detail_invalid_parameter`
- `thất bại` → `campaign_detail_failed`

V363 gives the two special statuses `failure`, no count, `ignore`, input `complete` (`migrations/migration_v363_action_status_writer.sql:224-232`).

### 5.2 Error resolution

Code: `createZaloErrorDetail`, CS:14862-14944. The helper then forces `countsTowardLimit = false` (CS:16335, 16399).

1. **Code**: `ZaloApiError.code`, else a string `err.code` (e.g. `ECONNRESET`), else `null` (CS:14608-14615).
2. **Policy**: `getZaloErrorPolicyByCode(code, actionCode)` (`src/main/data/repositories/errorPolicyRepository.ts:52-79`). A row whose `zalo_action_codes` contains the action wins, then unscoped rows. Without a match, the fallback is `err_zalo_api_business_failed` (id 18; seeded `migration_v113…sql:97`).
3. **Log** (`renderZaloPolicyLog`, CS:14649-14667):
   - Fallback policy: `"<actionName> thất bại: <message>[ (mã Zalo: <code>)]"`, with `message` defaulting to `Lỗi Zalo chưa xác định` (CS:14618-14622).
   - Otherwise: `noti_running_process || noti_campaign`, with `[x]` = message.
4. **Side effects of the policy are applied** (`applyZaloPolicySideEffects`, CS:14688-14730): login status, account status, action locks, campaign status. Any of them sets "stop after target".
5. **`detail_status`**: the row status is the policy's `detail_status`. When it is NULL, no row is written, a `⚠️` progress line is written instead, and the error requests a requeue (`resetInputToPending`).

Examples:

| Signal | Policy | Row / log | Progress line |
|---|---|---|---|
| Alias > 50 chars: code `112`, message `Lỗi không xác định` | fallback | `thất bại` / `Đổi tên Zalo thất bại: Lỗi không xác định (mã Zalo: 112)` | same text (it already starts with the action name) |
| `114` | `err_zalo_invalid_param`: detail `thất bại`, notice `Tham số không hợp lệ` (V113:85) | `thất bại` / `Tham số không hợp lệ` | `Gắn tag Zalo: Tham số không hợp lệ` |
| `600` | `err_zalo_session_invalid`: no detail, `update_login_status` `chưa đăng nhập` (V113:95) | no row | `⚠️ Gắn tag Zalo: Zalo đã bị đăng xuất, vui lòng đăng nhập lại`. The account becomes `chưa đăng nhập`, the run stops after the target, and the input requests a requeue (§5.4a) |
| Network error with errno, e.g. `read ECONNRESET`, `connect ETIMEDOUT <proxy>` | fallback | `thất bại` / `Gắn tag Zalo thất bại: read ECONNRESET (mã Zalo: ECONNRESET)` | same |
| `fetch failed` (no code) | fallback | `thất bại` / `Đổi tên Zalo thất bại: fetch failed` | same |
| Label session changed | fallback | `thất bại` / `Gắn tag Zalo thất bại: Phiên tag Zalo đã thay đổi; hãy thử lại trong lượt mới.` | same |

The local zca-js label and alias calls never produce `campaign_media_timeout` or `command_result_unknown`, so the uncertain-delivery rules do not trigger from aux actions on Desktop.

### 5.3 Quota and consecutive-error streak

**Quota: never.**
- Every aux row has `counts_toward_limit=false`.
- The legacy writer increments `auto_account_action_status` and resets `auto_account_error_state` only for counted rows (`src/main/data/repositories/campaignRepository.ts:6393-6450`).
- The managed writer sets the guard `auxiliaryAction` (`src/main/services/actionResultRuntime.ts:162`), which forces `countsTowardLimit:false, badTargetEffect:'ignore', resetErrorStreak:false` (`src/shared/actionStatusPolicy.ts:188`).

**Bad-target streak: never.** It neither increments nor resets.
- `createZaloSuccessDetail` and `shouldCountZaloActionTowardBadTarget` mark aux rows `countsTowardBadTarget:false` (CS:15029, 14767-14772).
- The milestone summary only records rows with `countsTowardBadTarget !== false` (CS:11526-11534). So a target whose only success is the tag still counts as a failure if the message failed.

**SMS push**: never. Only lookup and message/friend rows are eligible (CS:13575-13580).

### 5.4 Effect on the target's status

Normally none. Final status and note come from the primary steps. Aux failures are not in the summary's failure reasons, so the input note stays empty and the line is `✅ Hoàn thành "<name>"` (CS:4752-4764).

Exceptions:

**(a) Policy without `detail_status`** (e.g. `600`), via `applyHelperMilestoneControls` (CS:11063-11073):
- If a message was already delivered in this target, the target becomes `hoàn thành` with the note `<log>. Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.`
- Otherwise the target is requeued (`chờ xử lý`, note = log).
- With the managed writer, the DB settle turns that requeue into **`tạm dừng`**: any earlier success, including the phone lookup, counts as committed (`migrations/migration_v366_action_status_runtime_fixes.sql:76, 103`). This is the known stuck-data bug (CLAUDE.md pitfall; review doc, item 9). **Do not copy it.**

**(b) Policy side effects** (login, account, campaign, locks) stop the run after the target (CS:11076-11082). The campaign goes to `chờ xử lý` with the policy note, and the line `⏸ Dừng chiến dịch: <note>` is written (CS:4861-4875).

**(c) Helper exception.** For example, the error-policy read fails (and `runCampaignErrorPolicy` remembers it, CS:10225-10234), or `Zalo runtime chưa sẵn sàng`. The block errors, alias is skipped, and the workflow fails:
- input `hoàn thành` with note = the error;
- line `❌ Lỗi "<name>": <error>` (CS:4771-4780);
- `handleCampaignBadTarget` with the normalized runtime error counts a bad target (CS:4795-4819).

**(d) Runtime stop** (`throwIfZaloRuntimeStopping`): the whole run aborts and the uncertain-run rules apply.

## 6. Customer-facing lines, verbatim (Desktop)

All lines go to the campaign log through `logCampaignProgress`.

Lines built from a detail row use `formatZaloProgressLog` (CS:11327-11337): `"<actionName>: <log>"`, unless the log already starts with the action name. When no row was created, the line gets a `⚠️ ` prefix (CS:11339-11351).

| # | Text | Source |
|---|---|---|
| 1 | `⚠️ Không xác định được trạng thái bạn bè của ${label} sau khi kiểm tra bổ sung; vẫn thực hiện gắn tag/đổi tên theo cấu hình` | CS:16218 (once per target and uid) |
| 2 | `Bỏ qua gắn tag Zalo cho ${label}: đã là bạn bè` | CS:16241 |
| 3 | `Không thể gắn tag Zalo cho ${label}: chưa chọn tag cần gắn cho tài khoản ${account.name \|\| account.id}` | CS:16248 |
| 4 | `⚠️ Chưa cấu hình tag loại trừ cho tài khoản ${account.name \|\| account.id}; vẫn gắn tag Zalo cho ${label} theo cấu hình` | CS:16272 |
| 5 | `Bỏ qua gắn tag Zalo cho ${label}: đã có tag ${matchedLabelNames.join(', ')}` (names are `label.text \|\| id`) | CS:16278 |
| 6 | `Gắn tag Zalo: Đã gắn tag "${labelName \|\| labelId}" cho ${label}` | row + CS:11339 |
| 7 | `Gắn tag Zalo: Tag Zalo không tồn tại` | row |
| 8 | Tag error, e.g. `Gắn tag Zalo thất bại: <message> (mã Zalo: <code>)`, `Gắn tag Zalo: <policy text>`, or `⚠️ Gắn tag Zalo: <policy text>` when there is no row | §5.2 |
| 9 | `Bỏ qua đổi tên Zalo cho ${label}: đã là bạn bè` | CS:16356 |
| 10 | `Đổi tên Zalo: Đã đổi tên ${label} thành "${alias}"` | row |
| 11 | `Đổi tên Zalo: Tên Zalo mới không hợp lệ` | row |
| 12 | Alias error, e.g. `Đổi tên Zalo thất bại: Lỗi không xác định (mã Zalo: 112)` | §5.2 |
| 13 | `🏷️ Đã gắn tag akaBiz cho ${label}`; for a group: `🏷️ Đã gắn tag akaBiz cho group ${label}` | CS:8192-8195. Only when `count > 0` |
| 14 | `⚠️ Không thể gắn tag akaBiz cho ${label}: ${message}` (label without the `group ` prefix; the message is the raw error, e.g. `Failed to update akaBiz contact tags: …`, `server_campaign_tag_claim_invalid`) | CS:8215 |

## 7. Rate limits and quotas

- **`auto_account_actions` rows exist**: `zalo_tag_contact` `Zalo - Gắn tag` and `zalo_change_alias` `Zalo - Đổi tên` (`migration_v111…sql:77-78`, `migration_v113…sql:55-56`).
- **Not in any `auto_campaign_actions.limit_check_action_codes`** (V350 snapshot: phone = find, stranger, add_friend; friend and birthday = message_friend; …).
- **Never quota-checked.** `isActionCheckEnabledForCampaign` returns `false` for both codes (`src/shared/campaignActionDescriptors.ts:147-149`), so they never enter the executable or quota descriptors. They appear only in the display list `getCampaignAccountOverviewActionDescriptors` (same file, 328-344). Reports treat them as auxiliary (`src/shared/campaignRunReport.ts:48`).
- **Locks are not checked before an aux call.** Desktop checks only the quota descriptors. A lock on `zalo_tag_contact` (`auto_account_action_status.is_disable`) is ignored by the legacy Desktop runtime.
- **akaBiz** has no action code, quota or lock.
- **Engine v2.** V495 marks both codes `operation_class='idempotent'` (`migration_v495…sql:1827-1833`): they can never be "delivered". V495 also adds an action-only policy row with `quota_effect='no_count'` and `target_streak_effect='ignore'` that overrides every error policy (V495:2157-2161).

## 8. Fly

### 8.1 Engine v2 on Fly today: aux actions are not supported

`zaloMessagePhoneV2Support` returns `auxiliary_actions` or `akabiz_tag`. `FlyEngineRunner.accepts` reaches it through `zaloCampaignV2Support`, logs `campaign_engine_v2_fallback`, and the legacy executor runs the campaign (`apps/system-worker/src/campaignEngine/flyEngineRunner.ts:98-107`). That directory is untracked and was being edited during this research. `flyZaloPort.ts` has no aux methods.

### 8.2 Legacy executor flow (`executeTarget`, ZE:1172-1341)

**Resolution and akaBiz.**
- **Phone**: `findPhone` (ZE:1738-1781).
  - Not found → input `hoàn thành`, note `Không tìm thấy tài khoản Zalo theo SĐT.`, return (no aux).
  - Then `gateResolvedPhoneMessageTarget`. Blocked → return (no aux).
  - Then `applyAkaBizTags` (ZE:1237).
  - `findPhone` itself applies akaBiz for non-phone types (add-group-member by phone, ZE:1777-1779).
- **friend / birthday / group member / realtime / remarketing / recommendation**: `resolveUser` via `get_user_profile`, or the opt-out cached target plus persist (ZE:1238-1245). Then akaBiz for all of them except birthday (ZE:1247-1255).
- **group**: akaBiz inside `runStep("zalo_message_group")`, after a successful send (ZE:1257-1269).

**Message and friend request** go through `runStep` (ZE:1190-1211):
- An action locked earlier in the same target by a policy is skipped (`lockedActionCodes`).
- On a `RecordedCampaignStepError`:
  - uncertain delivery or media timeout → rethrow (the target ends);
  - `detailStatus` non-null and no campaign stop → continue;
  - otherwise continue only for chained types whose policy changes no login, account or campaign status (ZE:1510-1515). The strongest such failure is deferred.

**Aux block** (ZE:1311-1322):

```ts
const auxiliaryFriendStatus = target && ((bool(extra.enableZaloTag) && extra.zaloTagSkipIfFriend === true) ||
  (bool(extra.enableZaloAlias) && extra.zaloAliasSkipIfFriend === true))
  ? await this.resolveAuxiliaryFriendStatus(campaign, input, target, unitToken, signal) : null;
if (target && bool(extra.enableZaloTag)) await runStep("zalo_tag_contact", () => this.applyTag(...));
if (target && bool(extra.enableZaloAlias)) await runStep("zalo_change_alias", () => this.changeAlias(...));
```

The condition is "any type with a `target`". That includes birthday, group (where the target is the group id) and add-group-member. The UI never saves the flags for those types.

**After the steps:**
- A bad target counts only for primary failures: `recordFailure` → `badTarget: !isAuxiliaryZaloTargetAction(...)` (ZE:2488).
- The bad-target counter resets only if at least one primary step succeeded (ZE:1333).
- **The input note is the last failure's note, including aux failures** (ZE:1335-1340).

### 8.3 Commands

All commands go through `CampaignCommandClient.execute` (`apps/system-worker/src/campaignCommandClient.ts:70-136`):
- inserts a `chat_zalo_action` row with idempotency key `campaign:<campaignId>:<inputDataId>:<unitToken>:<stepKey>`;
- polls every 100 ms for up to 210 s;
- `failed` → `CampaignCommandError(errorCode ?? 'zalo_command_failed', errorMessage, uncertain = errorCode==='command_result_unknown')`;
- `waiting_socket` → uncertain;
- client-side timeout → cancel the pending command → `campaign_runtime_unavailable` (not dispatched), or `command_result_unknown` (dispatched).

| Step | `stepKey` | `commandType` | Payload | Runtime → zca-js | Result |
|---|---|---|---|---|---|
| Friend status | `auxiliary_friend_status` | `get_friend_request_status` | `{ userId }` | AS:603-609 → ZA:2740 `getFriendRequestStatus` | raw (`is_friend` …), read with `readZaloApiFriendStatus` |
| Tag | `apply_tag` | `apply_label` | `{ userId, labelId, labelContextId?, skipLabelIds? }` (ZE:2111-2112) | AS:662-670 → ZA:2855-2862 → `packages/zalo-zca-adapter/src/campaignLabels.ts` | label object (`text` …) or `ZaloLabelSkipResult` |
| Alias | `change_alias` | `change_friend_display_name` | `{ userId, displayName }` (ZE:2172-2173) | AS:558-564 → ZA:2672-2673 `changeFriendAlias(displayName, userId)` | zca response |
| Label release | `release_exclusion_labels` (or created directly) | `release_campaign_labels` | `{ contextId }` | AS:657-660 | `{ released: true }` |

**Payload schemas** (`packages/runtime-protocol/src/index.ts`):
- `apply_label` (500-508): `labelId` is a positive int or a digit string; `labelContextId` must be a **UUID**; `skipLabelIds` are digit strings.
- alias (401-404): `displayName` trimmed, 1–500 characters.
- `get_friend_request_status` (429-431).

**`labelContextId`** is sent only when this unit opened a send-exclusion label context (ZE:2112, 386, 431). Otherwise the runtime reads labels fresh for that one call.

**Runtime `applyCampaignLabel`** (`campaignLabels.ts`) runs the same algorithm as Desktop, with three differences:
- it de-duplicates `conversations` (a de-dup counts as a change);
- the error text is `Tag Zalo không tồn tại.` (with a period);
- after the update it calls `syncLabels(snapshot)`, which emits an `account_tags_snapshot` runtime event (ZA:1265-1300). Errors there are swallowed.

**Runtime timeouts** (AS:57, 61-80, 96-108). Default per command: 90 s.
- `apply_label` and `change_friend_display_name` are mutating commands. A timeout gives `command_result_unknown` with the message `Zalo không trả kết quả lệnh đúng hạn (90 giây); không tự thực hiện lại.`
- `get_friend_request_status` gives `zalo_command_timeout` with `Zalo không phản hồi lệnh đúng hạn (90 giây).`

### 8.4 Repository writes (Fly)

- **`appendZaloTagToExistingContact`** (CRR:3411-3487): same additive mirror as Desktop, person contacts only, by account, staff and org.
- **`applyAkaBizTags`** (CRR:3489): a direct `UPDATE auto_account_contacts SET akabiz_tag_ids = union(...)` with the active tags of the staff/org, for uid ∈ {uid, uid without `g`} on groups.
  - There is no `auto_account_id` scope check (the Desktop RPC raises `contact_tag_scope_invalid` in that case).
  - The trigger `trg_aka_agent_sync_contact_chat_tag_delta` mirrors the change into chat tags (`migration_v289…sql:92-93`).
- **`createDetail`** (CRR:1832): either the managed writer, with the `auxiliaryAction` guard in `packages/database/src/campaignActionResults.ts:118`, or a plain INSERT. In the plain path, counters are touched only when `countsTowardLimit !== false`.

### 8.5 Fly outcomes and lines

**Tag** (ZE:2079-2150) and **alias** (ZE:2152-2181): same branches as Desktop. Strings:
- `Bỏ qua gắn tag Zalo cho ${name}: đã là bạn bè`
- `Không thể gắn tag Zalo cho ${name}: chưa chọn tag cần gắn cho tài khoản ${campaign.accountName || campaign.accountId}`
- `⚠️ Chưa cấu hình tag loại trừ cho tài khoản ${…}; vẫn gắn tag Zalo cho ${name} theo cấu hình`
- `Bỏ qua gắn tag Zalo cho ${name}: đã có tag ${names.join(", ")}`
- `⚠️ Không thể đồng bộ tag Zalo vào contact ${name}: ${error}` (mirror failure; **customer-visible on Fly, silent on Desktop**)
- row `Đã gắn tag "${labelName}" cho ${name}.`, with `labelName = response.text || zaloTagName || labelId`
- row `Tag Zalo không tồn tại`
- `Bỏ qua đổi tên Zalo cho ${name}: đã là bạn bè`
- row `Tên Zalo mới không hợp lệ`
- row `Đã đổi tên ${name} thành "${alias}".`

Where `name` = `target.displayName || target.uid`.

**Friend-status warning** (ZE:2055-2077): same text as Desktop line 1.

**akaBiz** (ZE:2183-2206):
- `🏷️ Đã gắn tag akaBiz cho ${label}`, with `group ` prefixed for group campaigns;
- `⚠️ Không thể gắn tag akaBiz cho ${name}: ${errorMessage(error)}`.

**Failures** (`recordFailure`, ZE:2342-2490):
- Policy lookup: raw code → action-scoped policy → `err_zalo_api_business_failed`.
- The **row log is the raw message** (`log: partialLog ?? message`, ZE:2419).
- The progress line is `"<actionName>: <message>"`. For alias 112: row `Lỗi không xác định`, line `Đổi tên Zalo: Lỗi không xác định`.
- When the policy has no `detail_status`, the progress line is the rendered running-process notice instead.
- Side effects are applied through `applyErrorSideEffects`. `countsTowardLimit = false`.

**Uncertain aux command** (`command_result_unknown`):
- `recordFailure` rethrows it (`requiresFailureCleanup`, ZE:126-132), so there is no row.
- The target goes through the failure cleanup of the scheduler (`apps/system-worker/src/zaloCampaignScheduler.ts:1005-1015`), and the run or campaign stops.
- The review doc counts Fly in-flight network errors at about 1.9k for alias and 1.2k for tag in 30 days (`docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md:233`).

**`campaign_runtime_unavailable` / `campaign_runtime_binding_changed` / `campaign_command_cancelled`** → `CampaignRuntimeUnavailable` (ZE:2334-2340): the input goes back to `chờ xử lý`, or `hoàn thành` if something was already delivered, and the campaign stops.

### 8.6 Differences: Fly legacy vs Desktop

| Topic | Desktop / VPS | Fly legacy |
|---|---|---|
| Aux on types without workflow nodes | never (birthday, group, add member…) | whenever the flags are true and a target exists |
| Success row text | no trailing period; label = `getZaloTargetLabel` | trailing `.`; label = `displayName \|\| uid` |
| Failure row `log` | policy text / `"<action> thất bại: <msg> (mã Zalo: <code>)"` | raw error message |
| Input note after an aux failure | none (`✅ Hoàn thành`) | last failure note, e.g. `Đổi tên Zalo: Lỗi không xác định` |
| Tag label id without a per-account map | raw `extra.zaloTagId` | normalized id (`''` → `tag không tồn tại`) |
| Tag row `data` | `{target, labelId, labelName}` | `{target, labelId}` |
| Alias row `data` | `{target, alias, response}` | `{target, alias}` |
| Date tokens in the alias | DB business time | worker clock (`new Date()`, ZE:487) |
| Friend-status read | lazy, shared, all errors → `null` | once before tag; rethrows runtime-unavailable / abort / uncertain |
| Label snapshot | one per target, shared with send exclusion | per unit only if the exclusion context exists, else a fresh read per call |
| `Tag Zalo không tồn tại` from Zalo | also writes `auto_zalo_api_error_logs` | no error-log row |
| Mirror failure | `console.warn` | customer line `⚠️ Không thể đồng bộ tag Zalo vào contact …` |
| Locks inside a target | ignored | skipped if an earlier step's policy locked the code |
| Uncertain result | n/a (local calls) | 90 s runtime timeout → `command_result_unknown` → cleanup, campaign stops |
| akaBiz write | `aka_agent_mutate_contact_tags` (chat tag or `akabiz_tag_ids`, scope check); App Server uses the guarded RPC | direct UPDATE of `akabiz_tag_ids` + trigger; no account-scope check |
| akaBiz label in the error line | `getZaloTargetLabel` | `displayName \|\| uid` |

## 9. Engine-v2 DB rules that already cover aux actions (V495 / V500)

- **V495:2157-2161**: action-only policies for both codes force `no_count` and `ignore`. This is the `auxiliaryAction` guard, done in the DB.
- **V495:1827-1833**: `operation_class='idempotent'`, so the delivery state is always `none`. Aux outcomes never make a target "committed".
- **V363:224-232**: the status policies for `campaign_detail_tag_not_found` and `campaign_detail_invalid_parameter` (failure, no count, ignore, complete). An `ok:true` outcome with these `statusCode`s reproduces the Desktop rows without new rules.
- **V500 (engine v2 only), rows for tag/alias:**

| Error | Rule | V500 lines |
|---|---|---|
| `114` (`err_zalo_invalid_param`) | `no_count`, `ignore` | 100-101 |
| DAT01 (`err_input_invalid`) | pace `none` | 112-113 |
| `600` | `remaining_steps='skip'` | 131-132 |
| NET01 / NET03 | suppress, requeue, lock every Zalo action for 5 min, `end_unit`, pause the campaign after 4 in a row | 157-158, 168-169 |
| Zalo `230` → `err_engine_zalo_tag_outdated` (Z230) | row `campaign_detail_failed`, complete, continue | 67, 178 |

- **In-flight network errors** on tag/alias fall into the `in_flight` catch-all → UNK01, as approved in the review table (line 233).
- **Divergence:** Desktop always attempts the alias after a failed tag. The engine skips the remaining steps when the policy says `skip` (600, NET01/03, UNK01). This follows the approved decisions; everything else continues.
- **The engine writes no `auto_zalo_api_error_logs` row or account `zalo_error` log.** The signal is stored in `auto_campaign_details.data`. Decide whether to keep the diagnostic table.

## 10. What the core needs

### 10.1 Contract additions

```ts
// contracts.ts: a step result that writes nothing (Desktop helper returning { ok:true, skipped:true } without detail)
export type RawOutcome = /* existing variants */ | { ok: true; noOutcome: true }

// runUnit.ts, right after `raw ??= await runStep(step, ctx)`:
//   if (raw.ok && 'noOutcome' in raw && raw.noOutcome) continue   // no report, no detail, not added to `succeeded`

// runUnit.ts UnitConfig: per-target cleanup (Desktop drops the label context; Fly sends release_campaign_labels)
onTargetEnd?(info: { targetRunId: number; inputDataId: number }, signal: AbortSignal): Promise<void>  // call in runTarget's finally
```

### 10.2 Port

```ts
// zalo/auxiliary.ts
export const ZALO_TAG_CONTACT = 'zalo_tag_contact'
export const ZALO_CHANGE_ALIAS = 'zalo_change_alias'
export const ZALO_AUXILIARY_ACTION_NAMES = { [ZALO_TAG_CONTACT]: 'Gắn tag Zalo', [ZALO_CHANGE_ALIAS]: 'Đổi tên Zalo' } as const

export type ZaloLabelApplyResult =
  | { kind: 'applied'; labelText: string | null }                // includes "already in the label" (no update sent)
  | { kind: 'excluded'; matchedLabelNames: string[] }            // ZaloLabelSkipResult; nothing written
  | { kind: 'label_not_found'; message: string }                 // error text contains 'Tag Zalo không tồn tại'

export interface ZaloAuxiliaryPort {
  /** is_friend of the running account toward uid; null = unknown. Never throws except CancelledError. */
  friendStatus(ctx: StepContext, uid: string): Promise<boolean | null>
  /**
   * Move uid into labelId (one label per conversation), unless it is in one of skipLabelIds (checked on the
   * target's initial label snapshot). One getLabels per target, shared with the send-exclusion gate.
   * Other errors: ZaloPortError (operation 'send').
   */
  applyLabel(ctx: StepContext, uid: string, labelId: string, skipLabelIds: readonly string[]): Promise<ZaloLabelApplyResult>
  /** Best-effort additive mirror into auto_account_contacts.extra_data (person); errors only traced. */
  mirrorLabel(ctx: StepContext, uid: string, label: { id: string; name: string }): Promise<void>
  /** Zalo changeFriendAlias. Errors: ZaloPortError (operation 'send'). */
  changeAlias(ctx: StepContext, uid: string, alias: string): Promise<unknown>
  /** Add CRM tags to the existing contact(s); returns #contacts changed. Throws on DB error (step catches). */
  applyAkaBizTags(ctx: StepContext, contactType: 'person' | 'group', uid: string, tagIds: readonly number[]): Promise<number>
}
// registry.ts:17
export type ZaloCampaignPort = ZaloMessagePhonePort & ZaloAuxiliaryPort
```

The step builder also needs the **running** account (`{ id, name }`) for tag settings and log text. Use the unit's account, not `campaign.accountId`.

### 10.3 Steps

Each step is one `EngineStep`, with `delivery: false` (operation class idempotent, no "sắp gửi" mark).

**Do not add the aux codes to the claim plan.** Desktop never gates them. Adding them would apply `aka_agent_engine_claim_target_v1` to them (V495:839-905): `action_lock`, quota defaults of 30/day and 9 per 65 min from `aka_agent_engine_action_limit`, and `target_memory`.

```ts
export function buildZaloAuxiliarySteps(campaign: ZaloCampaign, port: ZaloAuxiliaryPort,
  opts: { requires: readonly string[]; account: { id: number; name: string } }): readonly EngineStep[]
```

The target is `ctx.state.zaloTarget`. If it is missing or has no `uid`, return `{ ok: true, noOutcome: true }` (Desktop's silent skip).

**Friend status**, shared by tag and alias. Store the promise once per target on the shared state object (runUnit.ts:284, 292):

```ts
const friend = (ctx, t) => (ctx.state.auxFriendStatus ??= (async () => {
  const known = readZaloApiFriendStatus(t.raw); if (known !== null) return known
  const s = await port.friendStatus(ctx, t.uid)
  if (s === null) ctx.progress(`⚠️ Không xác định được trạng thái bạn bè của ${zaloTargetLabel(t)} sau khi kiểm tra bổ sung; vẫn thực hiện gắn tag/đổi tên theo cấu hình`, 'warning')
  return s
})()) as Promise<boolean | null>
```

**Tag** (`key: 'zalo_tag'`, `actionCode: 'zalo_tag_contact'`, `actionName: 'Gắn tag Zalo'`, `requires: opts.requires`, `enabled: () => extra.enableZaloTag === true`):
1. If `zaloTagSkipIfFriend === true` and `await friend() === true`: write `Bỏ qua gắn tag Zalo cho ${L}: đã là bạn bè`, return `noOutcome`.
2. `settings = resolveZaloAccountTagSettings({ ...extra, zaloTagId: extra.zaloTagId ?? null, zaloTagName: extra.zaloTagName || '' }, account.id)`.
   - If `!settings || (map !== undefined && !settings.zaloTagId)`: write `Không thể gắn tag Zalo cho ${L}: chưa chọn tag cần gắn cho tài khoản ${account.name || account.id}`, return `noOutcome`.
3. `labelId = map === undefined ? (extra.zaloTagId ?? null) : settings.zaloTagId`. If falsy, return `{ ok: true, statusCode: 'campaign_detail_tag_not_found', customerLog: 'Tag Zalo không tồn tại', data: { target, labelId } }`.
4. `skip = zaloTagSkipIfHasSelectedTags === true ? settings.zaloTagSkipTagIds : []`. If the option is on and the list is empty, write `⚠️ Chưa cấu hình tag loại trừ cho tài khoản ${account.name || account.id}; vẫn gắn tag Zalo cho ${L} theo cấu hình`.
5. `r = await port.applyLabel(ctx, uid, String(labelId), skip)`. A `ZaloPortError` returns `zaloFailure(e, 'after_send', { target, labelId })`.
6. `excluded`: write `Bỏ qua gắn tag Zalo cho ${L}: đã có tag ${names.join(', ')}`, return `noOutcome`.
7. `label_not_found`: return `ok:true`, `campaign_detail_tag_not_found`, `'Tag Zalo không tồn tại'`, `data: { target, labelId, error: r.message }`.
8. `labelName = r.labelText || settings.zaloTagName || ''`. Run `port.mirrorLabel(ctx, uid, { id: String(labelId), name: labelName })`. Its errors only produce a trace (Desktop parity).
9. Return `{ ok: true, customerLog: \`Đã gắn tag "${labelName || labelId}" cho ${L}\`, data: { target, labelId, labelName } }`.

**Alias** (`key: 'zalo_alias'`, `actionCode: 'zalo_change_alias'`, `actionName: 'Đổi tên Zalo'`, same `requires`, `enabled: () => extra.enableZaloAlias === true`):
1. If `zaloAliasSkipIfFriend === true` and the friend status is `true`: write `Bỏ qua đổi tên Zalo cho ${L}: đã là bạn bè`, return `noOutcome`.
2. Render:

   ```ts
   alias = renderZaloTemplateText(extra.zaloAliasTemplate || '', ctx.target, target,
     templateUsesDatabaseDate(t) ? await port.businessNow(ctx) : undefined).trim()
   ```

   Preparation errors go through `preparationFailure`.
3. Approved change: `alias = truncateAlias(alias, 50)`. Cut until `alias.length <= 50` (UTF-16) without splitting a surrogate pair, then `trimEnd()`. Desktop does not do this yet (§2.2).
4. Empty alias: return `{ ok: true, statusCode: 'campaign_detail_invalid_parameter', customerLog: 'Tên Zalo mới không hợp lệ', data: { target, alias } }`.
5. `response = await port.changeAlias(ctx, uid, alias)`. A `ZaloPortError` returns `zaloFailure(e, 'after_send', { target, alias })`.
6. Return `{ ok: true, customerLog: \`Đã đổi tên ${L} thành "${alias}"\`, data: { target, alias, response } }`.

`L` = `zaloTargetLabel(target)`. The DB uses `customerLog` as the row log (V495:1202-1205). `outcomeProgress` then prints `Gắn tag Zalo: …` / `Đổi tên Zalo: …`, the same as `formatZaloProgressLog`.

**Note on levels.** An `ok:true` outcome with a failure-group status is printed at level `success`. The text matches Desktop, which has no levels.

**akaBiz** (`key: 'akabiz_tag'`). Make it a **`gate: true` step that always passes**:
- a non-gate step would be looked up in `claim.actions` by its action code, and a quota wait on that code would wrongly skip it;
- a gate never reports.

```ts
export function buildAkaBizTagStep(campaign: ZaloCampaign, port: ZaloAuxiliaryPort,
  opts: { requires: readonly string[]; contactType: 'person' | 'group' }): EngineStep
// enabled: actionId !== 'zalo_message_birthday' && zaloMessageSendMode !== 'share' && enableAkaBizTag === true && ids.length > 0
//   (ids = akaBizTagIds: finite, > 0, deduped)
// run: count = await port.applyAkaBizTags(ctx, contactType, uid, ids)
//      count > 0  → ctx.progress(`🏷️ Đã gắn tag akaBiz cho ${contactType === 'group' ? `group ${L}` : L}`, 'success')
//      count = 0  → trace only
//      error      → ctx.progress(`⚠️ Không thể gắn tag akaBiz cho ${L}: ${errorMessage(e)}`, 'warning')
//      always return { ok: true }  (CancelledError propagates)
```

### 10.4 Placement per type

| Type | Steps |
|---|---|
| `zalo_message_phone` | lookup, opt_out (gate), **akabiz_tag** (`requires ['opt_out']`), message, friend, **zalo_tag**, **zalo_alias** (both `requires ['opt_out']`) |
| `zalo_message_friend` (normal) | resolve, gates, **akabiz_tag**, message, **zalo_tag**, **zalo_alias** |
| group member / realtime / remarketing / recommendation | resolve, gates, **akabiz_tag**, message, friend, **zalo_tag**, **zalo_alias** |
| `zalo_message_group` (normal) | message, **akabiz_tag** (`contactType 'group'`, `requires ['message']`); no tag or alias |
| birthday, share mode | none |

For `zalo_message_group`, `requires ['message']` matches Desktop: akaBiz only after a successful send.

**Remaining steps.** If a message or friend outcome closes the target (`remaining_steps='skip'`, e.g. unknown delivery), aux steps do not run. This matches Desktop's `stopRemainingActions`.

**Remove `auxiliary_actions` and `akabiz_tag`** from `zaloMessagePhoneV2Support` once these steps exist, and add `ZALO_AUXILIARY_ACTION_NAMES` to each type's `actionNames`.

### 10.5 Port implementations

**Desktop** (`src/main/engineAdapters/desktopZaloPort.ts`):
- `friendStatus`: `zaloRuntime.getFriendRequestStatus(accountId, uid)` → `readZaloApiFriendStatus(res.raw)`. Any error → `null`.
- `applyLabel`:
  - keep one `zaloRuntime.createCampaignLabelContext(accountId)` per `targetRunId`, shared with the send-exclusion gate when that gate is ported;
  - call `zaloRuntime.applyLabelToUser(accountId, uid, labelId, skip, context)`;
  - `isZaloLabelSkipResult` → `excluded`;
  - a message containing `Tag Zalo không tồn tại` → `label_not_found`;
  - `UID Zalo không hợp lệ`, `Tag Zalo không hợp lệ`, and the `ensureApi` errors in `LOCAL_BEFORE_CALL` → `zaloPortErrorFrom(e, { phase: 'before_send' })`;
  - else `zaloPortErrorFrom(e, { operation: 'send', answered: e instanceof ZaloApiError })`.
- `mirrorLabel`: `appendZaloTagsToExistingContacts(accountId, 'person', [uid], [{ id, name }])`.
- `changeAlias`: `zaloRuntime.changeUserAlias(accountId, uid, alias)`, with the same error mapping.
- `applyAkaBizTags`: `applyAkaBizTagsToContactTargets(uids.map(uid => ({ accountId, contactType, uid })), tagIds)`, with uids per §4.4. The App Server guarded RPC requires legacy tokens, so it cannot serve engine-v2 leases.
- `onTargetEnd`: drop the label context.

**Fly** (`apps/system-worker/src/campaignEngine/flyZaloPort.ts`):
- `friendStatus`: `command(ctx, 'auxiliary_friend_status', 'get_friend_request_status', { userId })` → `readZaloApiFriendStatus(response)`. Errors → `null`, except `CancelledError`.
- `applyLabel`:
  - `command(ctx, 'apply_tag', 'apply_label', { userId, labelId, labelContextId, ...(skip.length ? { skipLabelIds: skip } : {}) })`;
  - **`labelContextId` must be a UUID.** The engine's `v2-<targetRunId>` fails the zod schema, so derive one UUID per target run;
  - response `isZaloLabelSkipResult` → `excluded`;
  - `CampaignCommandError` whose message contains `Tag Zalo không tồn tại` → `label_not_found`;
  - else `flyCommandFailure(e, 'send')`.
- `mirrorLabel`: `runtime.appendZaloTagToExistingContact({ campaign, uid, labelId, labelName })`.
- `changeAlias`: `command(ctx, 'change_alias', 'change_friend_display_name', { userId, displayName: alias })`.
- `applyAkaBizTags`: `runtime.applyAkaBizTags({ campaign, contactType, uid, tagIds: ids.map(String) })`.
- `onTargetEnd`: send `release_campaign_labels` `{ contextId }`, the same as `CampaignCommandClient.releaseLabelContext`.

The idempotency key `campaign:<campaign>:<input>:v2-<targetRunId>:<stepKey>` makes a re-run inside the same target run return the stored command result.

### 10.6 Approved changes not in Desktop today (decide explicitly)

1. **Alias ≤ 50 characters** (§2.2, §10.3 step 3). This removes most 112 failures. The success text shows the truncated alias.
2. **Zalo 230 "Outdated input"**: re-read the labels and retry once (review doc line 209). V500 currently writes `failed` and completes (Z230). If adopted, do it inside `applyLabel`: drop the context, re-read, retry once.
3. **Do not reproduce the `tạm dừng` settle bug** (§5.4a). The engine's `no_requeue_after_delivery` only counts delivered outcomes, which is correct.

### 10.7 Parity tests (minimum)

**Tag:**
- tag off/on with alias on/off;
- target missing (lookup not found, opt-out block);
- skip-if-friend: known from `raw`; read returns true / false / null (warning printed once, shared by tag and alias); read throws;
- per-account map: missing entry, secondary account;
- legacy flat id empty → `tag không tồn tại`;
- excluded label;
- empty skip list with the option on (warning);
- label missing in Zalo;
- already in the label (no update call);
- move removes other labels;
- mirror failure silent;
- 114 / 600 / fallback 112 texts.

**Alias:**
- empty render → `tham số không hợp lệ`;
- `#{TODAY()}` uses DB time;
- > 50 chars (truncation if adopted).

**Message interplay:**
- aux still runs after a failed message (122);
- aux does not run after unknown delivery;
- quota and streak never change from aux rows.

**akaBiz:**
- phone: after the gate, before the message;
- friend types: before the message;
- group: after a successful send only;
- birthday/share: never;
- count 0: no line;
- error: warning line, step passes.
