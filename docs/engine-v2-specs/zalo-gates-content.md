# Zalo pre-send gates and content features: behavior spec for the engine v2 core

Read-only research, 12/11/2026. It describes what the Desktop/VPS runner does today (the standard), what the old Fly
path does, and what the shared core needs in order to reproduce it. Vietnamese strings are verbatim.

Sources read:

| Short name | Path |
|---|---|
| Scheduler | `src/main/services/campaignScheduler.ts` (worktree `campaign-engine-v2`, HEAD `24ff928c` plus local edits) |
| Runtime | `src/main/services/zaloRuntimeService.ts` |
| Repo | `src/main/data/repositories/campaignRepository.ts`, `campaignSendExclusionRepository.ts`, `aiRepository.ts`; `src/main/services/aiRuntimeService.ts`, `desktopAiTransport.ts`, `zaloFormattedContent.ts` |
| Shared | `src/shared/campaignDeliveryCooldown.ts`, `campaignSendExclusion.ts`, `zaloMessageOptOut.ts`, `messageOptOutSource.ts`, `advancedContent.ts`, `formattedContent.ts`, `contentSpin.ts` |
| Core | `packages/campaign-engine/src/**` (byte-identical to the ChatApi copy: `diff -rq` empty) |
| Fly old | ChatApi `akaAgentChatApi-deploy-dbb38b7` (`dbb38b7`): `apps/system-worker/src/zaloCampaignScheduler.ts`, `zaloCampaignExecutor.ts`, `campaignContent.ts`, `campaignAiRewriter.ts`, `zaloMessageOptOut.ts`, `messageOptOutSource.ts`; `packages/database/src/campaignRuntimeRepository.ts`, `campaignAiRepository.ts` |
| Fly engine | ChatApi `apps/system-worker/src/campaignEngine/flyEngineRunner.ts`, `flyZaloPort.ts` |
| SQL | `migrations/migration_v431_cooldown_history_lookup.sql`, `migration_v330_campaign_send_exclusions.sql`, `migration_v295_message_opt_out_customers.sql`, `migration_v495_*`, `migration_v499_*`; opt-out RPC bodies from `scripts/fixtures/message-opt-out-live-baseline.json`; ownership guard from `migrations/snapshots/desktop-account-ownership/production-trial.sql` |

All six features are excluded from the core today: `zaloMessagePhoneV2Support` returns `advanced_content`,
`formatted_content`, `media`, `ai_rewrite`, `opt_out_link`, `send_exclusion` or `delivery_cooldown`, and the whole
campaign then runs on the old runner (`packages/campaign-engine/src/zalo/messagePhone.ts:116-124`). The core has the
opt-out check (`messagePhone.ts:252-305`), the opt-out contract module (`content/zaloMessageOptOut.ts`, identical to
`src/shared/zaloMessageOptOut.ts` and to Fly's copy), and calls `appendStopMessagesFooter` with the link disabled
(`messagePhone.ts:316-323`).

---

## 1. Where the gates sit in a Desktop/VPS target

Generic per-target loop of `executeCampaignV2` (Scheduler 4186-4520). `zalo_message_phone` uses this loop (the share
batch path is only for `zalo_message_friend` / `zalo_message_group` with `zaloMessageSendMode: 'share'`).

| # | Step | Scheduler | Applies to `zalo_message_phone`? |
|---|---|---|---|
| 1 | Skip rows not `chờ xử lý`, future `schedule` | 4196-4197, 4254-4264 | yes |
| 2 | Legacy friend blocklist (`zaloFriendBlocklistEnabled`) | 4266-4271 | no (friend only) |
| 3 | Opt-out preflight + send exclusion (`preflightZaloMessageOptOut`) | 4273-4276 | returns an empty context immediately (7279) |
| 4 | **Delivery cooldown** (`applyRecentDeliveryCooldown`, one id) | 4278-4294 | yes, before the phone lookup |
| 5 | Opt-out link (`prepareZaloMessageOptOutLink`) | 4296-4304 | no-op: no global ID yet (7418) |
| 6 | Per-target action lock / quota preflight | 4317+ | yes |
| 7 | Unit claim `beginCampaignRunUnit`, store opt-out context | 4505-4516 | yes |
| 8 | `▶️ Xử lý "<label>" trong chiến dịch "<name>"` | 4520 | yes |
| 9 | Workflow: `zaloFindPhoneUser` → **`gateResolvedPhoneMessageTarget`** (opt-out by input phone, profile phone, global ID → send exclusion → opt-out link) → send message (content preparation, AI) → friend request | 15278-15367, 7344-7406 | yes |
| 10 | No sleep after a gate-blocked target: `if (zaloOptOutContext?.blocked) continue` | 5069 | yes |

So for phone campaigns the cooldown runs **before** the target is claimed and before the lookup, while opt-out,
send exclusion and link creation run **after** a successful lookup (the lookup detail and its quota are written first).
For the other six opt-out action types (friend, birthday, group member, realtime, remarketing, recommendation) steps
3-5 all run before the unit claim and before `▶️`.

A target stopped at step 3, 4 or 5 prints no `▶️` and no `✅ Hoàn thành` line, writes no `auto_campaign_details` row,
consumes no quota, does not touch the consecutive bad-target counter, and is followed by no sleep (`continue`).

Old Fly path (`zaloCampaignScheduler.ts`), same order: blocklist (once per run, 1351-1389) →
`preflightZaloMessageOptOut` (880) → `applyRecentDeliveryCooldown` (884) → `prepareZaloMessageOptOutLink` (889) →
`claimUnit` → `▶️` → `executeTarget` (phone: `gateResolvedPhoneMessageTarget`, `zaloCampaignExecutor.ts:650-705`).

---

## 2. Delivery cooldown (chống gửi lặp)

### 2.1 Configuration and eligibility

`extra_settings` keys (`src/shared/types.ts:613-615`):

| Key | Meaning |
|---|---|
| `recentDeliveryCooldownEnabled` | must be `true` |
| `recentDeliveryCooldownDays` | calendar days in Vietnam time, 1..3650; empty means 3 (`DEFAULT_RECENT_DELIVERY_COOLDOWN_DAYS`) |
| `recentDeliveryCooldownAllAccounts` | `zalo_message_phone` only: check history of every account with the same staff and organization (V424) |

`isRecentDeliveryCooldownEnabled(actionId, extra)` (`src/shared/campaignDeliveryCooldown.ts:43-49`) is true when the flag
is true and `supportsRecentDeliveryCooldown`: always for `zalo_message_friend`, `zalo_message_birthday`,
`zalo_message_group` (and Facebook/SMS/Email types); for `zalo_message_phone` and the four other "message toggle" types
only when `enableMessage === true`. A friend-request-only phone campaign is never checked. When message and friend
request are both on, a paused target loses both.

The RPC re-reads `extra_settings` from the DB row; the runtime flag only decides whether to call it.

### 2.2 RPC `aka_agent_apply_campaign_delivery_cooldown(p_campaign_id, p_account_id, p_staff_id, p_input_data_ids bigint[])`

Body in Git: `migrations/migration_v431_cooldown_history_lookup.sql:64-404`. The live body was rewritten again on
28/10/2026 (recipient-first lookup, target checksum `018db8850de2f967b13240e6cd36158c`, `docs/COOLDOWN_HISTORY_V431.md`);
that SQL is outside Git. Documented as same results. Since the ownership migration `20261027185059` it also starts with
`PERFORM private.aka_agent_assert_request_ownership(p_staff_id, p_account_id, p_campaign_id)` (binds the Desktop JWT to
the staff; `migrations/snapshots/desktop-account-ownership/production-trial.sql:392`). EXECUTE: `postgres, service_role,
aka_agent_chat_api, aka_agent_desktop`.

Behavior:

1. Validates scope; raises `invalid_campaign_delivery_cooldown_scope`, `invalid_campaign_delivery_cooldown_batch_size`
   (1..500 distinct ids), `campaign_delivery_cooldown_scope_not_found` (campaign/account/staff/org mismatch or deleted),
   `campaign_delivery_cooldown_input_scope_mismatch` (an id is not a live row of the campaign),
   `invalid_campaign_delivery_cooldown_days` (days text not `^[0-9]+$` or outside 1..3650).
2. `FOR UPDATE` on the requested input rows (V431:127-133).
3. Flag off or action unsupported (phone types need `enableMessage`) → every id `allowed`.
4. Target keys from the input: `zalo_person_uid:<lower(trim(uid))>` and `zalo_person_phone:<normalize_phone(phone)>`
   (`aka_agent_internal_delivery_cooldown_target_keys`, V246:39-94). `normalize_phone` returns `''` only when there is
   no digit, so only a row with no uid and no digit in the phone is unidentifiable.
5. History: `auto_campaign_details` of the campaign account (or of all accounts of the staff+org when
   `recentDeliveryCooldownAllAccounts` and the campaign is `zalo_message_phone`, deleted accounts included), action codes
   `zalo_message_friend`/`zalo_message_stranger`, `created_at >= start of (today_VN - (days-1))`, and either
   `policy_snapshot.operationState = 'committed'` or (`operationState IS NULL` and status in `thành công, đã gửi, đã nhận,
   đã xem, đã click`) (V431:257-275). Engine v2 details write `operationState='committed'` only for delivered/partial
   (`migration_v499_target_memory_per_account.sql:569`), so v2 history counts the same way. Friend requests never count.
6. Decision per id, first match wins (V431:338-368):

| Decision | Condition | `note` (verbatim) | Row change |
|---|---|---|---|
| `not_pending` | status ≠ `chờ xử lý` | `Data không còn ở trạng thái chờ xử lý.` | none |
| `paused_unidentifiable` | no target key | `Tạm dừng vì không thể chuẩn hóa đối tượng để kiểm tra giới hạn gửi/đăng lặp.` | `status='tạm dừng'`, `note` |
| `deferred_batch_duplicate` | shares a key with an earlier id of the same call | `Giữ chờ xử lý vì trùng đối tượng với một data đứng trước trong cùng batch.` | none |
| `paused_recent_delivery` | `today_VN < last_sent_date_VN + days` | Zalo: `Tạm dừng: đã gửi tin trước đó ngày %s. Gửi lại từ %s.` (dates `DD/MM/YYYY`; other texts for posts/email/SMS) | `status='tạm dừng'`, `note` |
| `allowed` | otherwise | NULL | none |

Returns `TABLE(input_data_id, decision, note, last_sent_at, eligible_date, source_campaign_id, source_campaign_name)`
in request order. The pause is written by the RPC itself (V431:382-391); `date_action` is not touched. Nothing ever
reopens a cooldown-paused row (no reopen code in Git); the daily resets skip `tạm dừng`.

### 2.3 Desktop flow

Repository `applyCampaignDeliveryCooldown` (Repo `campaignRepository.ts:6622-6653`): dedups ids, rejects 0 or >500 ids
with `Dữ liệu kiểm tra giới hạn gửi/đăng lặp không hợp lệ.`, wraps RPC errors as
`Không thể kiểm tra lịch sử gửi/đăng gần nhất: <PostgREST message>`.

Scheduler `applyRecentDeliveryCooldown` (7451-7498): throws `RPC giới hạn gửi/đăng lặp trả về batch không đầy đủ.`
when ids are missing, `RPC giới hạn gửi/đăng lặp trả về quyết định không hợp lệ: <decision>` for unknown decisions;
missing pause note falls back to `Tạm dừng vì giới hạn gửi/đăng lặp.`

Call site for normal targets (4278-4294), one id per call:

- **allowed**: continue to link creation and quota (no log).
- **paused** (`paused_recent_delivery`, `paused_unidentifiable`): `detail.status='tạm dừng'` in memory, then one
  progress line per paused id (`logRecentDeliveryCooldownPauses`, 7516-7535):

  ```
  ⏸️ Bỏ qua "<targetName>": <note>
  ```

  `targetName` (`getRecentDeliveryCooldownTargetName`, 7500-7514): for `zalo_message_phone` the first two distinct
  non-empty values of `[phone, name, uid]` joined by ` - `, else `[name, uid, phone, email]`; `N/A` when none.
  `note` = RPC note trimmed, leading `Tạm dừng: ` or `Tạm dừng vì ` removed, trailing ` Gửi lại từ DD/MM/YYYY.` /
  ` Đăng lại từ DD/MM/YYYY.` removed; empty → `do giới hạn gửi/đăng lặp.`
  Example: `⏸️ Bỏ qua "0901234567 - Nguyễn An": đã gửi tin trước đó ngày 10/11/2026.`
  The input keeps the full RPC note (`Tạm dừng: đã gửi tin trước đó ngày 10/11/2026. Gửi lại từ 13/11/2026.`).
- **not_pending / deferred**: `continue` silently.
- **error** (any throw above): the run ends before claiming the target:

  ```
  campaign.status = 'chờ xử lý', campaign.note = 'Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: <message>'
  account released (releaseClaimedCampaignPreflight, 9896-9913)
  progress: ⚠️ Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: <message>
  ```

  `<message>` is `getErrorMessage(err) || 'Lỗi không xác định'`, so a DB failure reads
  `… thử lại: Không thể kiểm tra lịch sử gửi/đăng gần nhất: <PostgREST message>`. The input is untouched. The campaign
  `schedule` is unchanged, so the next scheduler tick (~30 s) retries. A bad `recentDeliveryCooldownDays` therefore loops
  forever with `invalid_campaign_delivery_cooldown_days` until the config is fixed.

No `auto_campaign_details` row, no quota, no bad-target streak, no pace, in every branch.

Phone-specific consequence: because the cooldown runs before the lookup, a phone target with no digit and no uid is
paused as unidentifiable instead of getting the lookup's 114.

Share batch path (friend/group share mode only, 5985-6001): opt-out preflight per candidate, then **one** RPC call for
all allowed candidates; `deferred_batch_duplicate` rows stay `chờ xử lý` for a later batch; same log and error lines.
Also used for Facebook group-post share targets (4430-4456).

### 2.4 App Server (VPS)

Same code (`runtimeTarget: 'server'`); the only extra behavior is the early `return` when the server runtime is
stopping (`isServerZaloCampaign(...) && !this.running`), which leaves the target untouched. Since V497 a flagged
organisation's Zalo Server accounts run on Fly instead of the VPS.

### 2.5 Old Fly path

`zaloCampaignScheduler.ts`: eligibility `recentDeliveryCooldownEnabled` (92-104, same rule for the Zalo types),
call per target (884-888) and per share batch (1080-1083), handling 1391-1440, logging 1442-1456, repository
`campaignRuntimeRepository.ts:1395-1418` (direct SQL as `aka_agent_chat_api`).

Differences from Desktop:

| Point | Desktop | Old Fly |
|---|---|---|
| Fallback pause note | `Tạm dừng vì giới hạn gửi/đăng lặp.` | `Tạm dừng vì giới hạn gửi lặp.` (1425) |
| Fallback log detail | `do giới hạn gửi/đăng lặp.` | `do giới hạn gửi lặp.` (135) |
| Error texts | `RPC giới hạn gửi/đăng lặp …`, `Không thể kiểm tra lịch sử gửi/đăng gần nhất: …` | `RPC giới hạn gửi lặp …` (1410, 1430), `Batch kiểm tra giới hạn gửi lặp phải có từ 1 đến 500 data.`, raw pg message |
| RPC error | campaign held `chờ xử lý` + note + `⚠️ Không thể kiểm tra giới hạn gửi/đăng lặp; …`, retried next tick | not caught: run failure → `cleanupFailedRun` with note `Lượt chiến dịch gặp lỗi: <message>` (322), campaign not paused, account blocked in RAM until cleanup succeeds; no progress line |

The `⏸️` line format and label rule are the same.

### 2.6 Engine v2 implications

- `aka_agent_engine_claim_target_v1` sets the claimed row to `đang chạy` before the runner sees it (V499:288). The
  existing RPC returns `not_pending` for such a row and pauses nothing, so **it cannot be called after claim**.
- `auto_engine_gates` seeds `delivery_cooldown` as `on_error='closed'`, `retry_after_seconds=60` (V495:1825). The claim
  returns only `onError` per gate (V499:311); `retry_after_seconds` is read nowhere.
- `err_engine_gate_unavailable` (V495:1955, policy 2094): suppress, target `requeue`, `end_unit`, no quota, no campaign
  effect, note/log `Chưa kiểm tra được điều kiện gửi, sẽ tự chạy lại (SYS08)`. Desktop instead leaves the input untouched
  and writes the message into the campaign note. The report always overwrites the input note with the failing outcome's
  log (V499:759), so keeping the old input note needs a DB change.

---

## 3. Send exclusions (`zaloSendExclusionsByAccountId`)

### 3.1 Configuration

`extra_settings.zaloSendExclusionsByAccountId: Record<accountId, { groupId: number | null; blocklistIds: number[] }>`
(`src/shared/campaignSendExclusion.ts:19-20`). Eligibility `supportsSendExclusion` (25-28): the seven opt-out action
types; `zalo_message_friend`/`zalo_message_birthday` always, the others only with `enableMessage === true`.
`exclusionSelection` (29-38) throws `Cấu hình loại trừ không hợp lệ.` (map not an object, bad ids) or
`Chưa cấu hình loại trừ cho tài khoản thực hiện.` (no entry for the running account). `hasSendExclusions` (39-42) is
true when the entry has a group or at least one blocklist.

The module is dependency-free and **identical** in Desktop `src/shared` and ChatApi
`packages/runtime-protocol/src/campaignSendExclusion.ts` (`diff` empty).

### 3.2 RPC `aka_agent_campaign_send_exclusion_runtime(p_campaign_id, p_account_id, p_staff_id, p_claim_token uuid, p_operation, p_payload)`

V330:527-575 (plus the Desktop ownership guard). `statement_timeout=15s`. Locks the campaign `FOR UPDATE` and requires
`campaign.runtime_claim_token = p_claim_token` (the **legacy** run claim), else `send_exclusion_runtime_claim_lost`.

| Operation | Payload | Result |
|---|---|---|
| `snapshot` | none | `{ catalog, group, blocklistUids }`: active filter catalog, the selected group with rules, distinct trimmed UIDs of person contacts of this account in the selected blocklists (`auto_account_contact_group_members` × `auto_account_contacts`). Raises `send_exclusion_account_configuration_missing` |
| `facts` | `{ inputId, uid, tags?: true, days?: n }` | `{ akabiz_contact: {ids, availableValues} \| null, campaign_delivery: {daysSince} \| null }`. Tags: akaBiz tag ids of the contact (`aka_agent_data_group_zalo_facts`) or, without a contact, the chat conversation tags. Delivery: VN days since the last committed `zalo_message_friend`/`zalo_message_stranger` of **this account** to the uid/phone keys of the input; `3651` when none |
| `pause` | `{ inputId, expectedStatus, note }` | CAS `status='tạm dừng', note=left(note,2000)` where status = expected and in (`chờ xử lý`,`đang chạy`); `{changed}` |

Repository `callSendExclusionRuntime` (`campaignSendExclusionRepository.ts:25-32`): 20 s abort; any error becomes
`Không thể xác minh điều kiện loại trừ hoặc quyền thực hiện chiến dịch.`. Scheduler `sendExclusionRpc` (7196-7201) throws
`Lượt chạy loại trừ không còn hợp lệ.` when the run has no claim token.

### 3.3 Snapshot per run (Desktop)

After the legacy claim (3692-3702), when supported and `hasSendExclusions`: `snapshot` → `validateExclusionGroup` →
`sendExclusionRuns.set(campaignId, snapshot)`. Any error (including `exclusionSelection` and validation errors such as
`Bật ít nhất một điều kiện.`, `Định nghĩa điều kiện chưa được hỗ trợ hoặc đã ngừng sử dụng.`):

```
campaign.status = 'tạm dừng', campaign.note = 'Không thể tải cấu hình loại trừ: <message>'
account released; no progress line
```

The snapshot is dropped at run end (3873-3874). The label context is reset per target (7267, 5019) so each target reads
Zalo labels at most once.

### 3.4 Evaluation `evaluateSendExclusion(snapshot, uid, resolve, checkActive, onSourceError)` (shared 120-170)

1. uid in `blocklistUids` → `excluded`, note `Thuộc danh sách Zalo ID loại trừ.`
2. no uid and the blocklist is non-empty → `unknown`, note `Chưa xác định được Zalo ID để kiểm tra danh sách loại trừ.`
3. no group → `allowed`.
4. Enabled rules ordered: DB sources (`akabiz_contact`, `campaign_delivery`) first, then Zalo sources, then `sortOrder`.
   Each source is resolved once. A resolver error calls `onSourceError` and yields `null` (unknown). Three-valued logic:
   `or` + true → `excluded`, note `Thỏa điều kiện loại trừ của nhóm “<group>”: <field>.`; `and` + false → `allowed`.
   After all rules: any unknown → `unknown`, note `Chưa đủ dữ liệu để kiểm tra nhóm “<group>”.`; no evaluated rule →
   `allowed`; `and` → `excluded`, note `Thỏa điều kiện loại trừ của nhóm “<group>”.`; `or` → `allowed`.
   Native Zalo tag rules ignore selected tag ids that are no longer in the complete label list; a rule left empty is
   skipped (04/11 change, 143-157).

Desktop resolvers (`gateSendExclusion`, 7213-7259):

| Source | Desktop | Old Fly (executor 421-475) |
|---|---|---|
| `zalo_labels` | `CampaignLabelContext` from `zaloRuntime.createCampaignLabelContext(accountId)` (`.ids(uid)`), one label read per target, bound to API instance and session generation (Runtime 2201+) | command `campaign_label_membership` `{contextId: unitToken, userId}`; released by `release_campaign_labels` at unit end |
| `zalo_friendship` | `readFriendship(target.raw)`, else `zaloRuntime.getFriendRequestStatus(accountId, uid)` and the result is merged into `target.raw.profile` | same with command `get_friend_request_status` |
| `zalo_profile` | rethrows a profile error recorded by `resolveZaloFriendMessageTarget`; else `zaloProfileFacts(target.raw ?? getUserProfile(uid).raw)` | `zaloProfileFacts(target?.raw)` only (no fetch) |
| `akabiz_contact` / `campaign_delivery` | RPC `facts` with `{inputId, uid, tags: true}` or `{days: max(1, …values of enabled rules of that source)}` | same RPC |

Zalo source errors (`onSourceError`, only for `zalo_*` sources): Desktop resolves the policy by Zalo code
(`getZaloPolicyByErrorCode`, fallback `err_zalo_api_business_failed`) and applies its side effects without writing a
detail (`applyZaloPolicySideEffects`, 14688-14731: login status, account status, action locks, campaign status), with
`Không thể kiểm tra loại trừ: <Zalo message>` as running-process/campaign note. If any side effect ran, later reads stop
and the decision is forced to `unknown`, note `Nguồn Zalo đang bị giới hạn hoặc phiên đã thay đổi.` Old Fly rethrows
cleanup-class errors and runtime-unavailable errors, and applies side effects only when the policy has one
(`failurePolicySideEffectPriority`).

### 3.5 Decision handling

`allowed` → continue. `excluded` **or `unknown`** → RPC `pause` (`expectedStatus` `chờ xử lý` in preflight, `đang chạy`
after the phone lookup); when `changed`, the target is `tạm dừng` with the decision note and the line

```
🚫 Bỏ qua "<getInputDataDisplayName>": <note>
```

is printed (7175-7194). For a claimed phone target this line is deferred until after the lookup line and the opt-out
warnings (`logZaloMilestoneContext`, 11353-11364). Label: phone → name → uid for phone campaigns, name → uid → phone for
the other Zalo types (7613-7636). No detail, no quota, no streak, no sleep. The lookup detail of a phone campaign is
already written and keeps its `zalo_find_phone_user` quota.

So the gate fails closed: unreadable data pauses the target (no retry); it never sends.

Exceptions:

- Preflight path (non-phone types, before claim): the throw leaves `executeCampaignV2` and reaches the generic run
  failure (3843-3866): `err_undefined` policy via `handleCampaignBadTarget`, then `cleanupFailedCampaignRun` with note
  `Lượt chạy gặp lỗi: <message>` (1307).
- Phone path (after lookup, 7393-7401): wrapped as
  `ZaloSendExclusionError('Không thể hoàn tất loại trừ gửi sau khi tìm SĐT: <message>')`; the target gets no Zalo target
  (no send, no friend request), the lookup milestone is persisted, then the error is rethrown (4683, 4901) and the
  failed-run cleanup **pauses the campaign** (`campaignStatus = 'tạm dừng'`, 3848) without the `err_undefined` policy.

### 3.6 Legacy friend blocklist (friend campaigns only)

`zaloFriendBlocklistEnabled` + `zaloFriendBlocklistId`, ignored as soon as `zaloSendExclusionsByAccountId` exists
(7057-7101). Desktop per target marks `hoàn thành` with note `Bỏ qua vì nằm trong danh sách không gửi tin: <group>` and
logs `🚫 Bỏ qua "<label>" vì nằm trong danh sách không gửi tin: <group>` (7537-7553); invalid list → campaign
`chờ xử lý`, note and log `⚠️ Danh sách không gửi tin Zalo không hợp lệ: <reason>` (4093-4100). Old Fly does it once
per run and logs one summary `🚫 Đã bỏ qua <n> bạn bè Zalo trong danh sách không gửi tin "<group>"` (1351-1389). Not
relevant to `zalo_message_phone`.

### 3.7 Old Fly differences

| Point | Desktop | Old Fly |
|---|---|---|
| Snapshot failure | campaign `tạm dừng`, note `Không thể tải cấu hình loại trừ: <message>` | `pauseOnFailure` → `cleanupFailedRun` note `Lượt chiến dịch gặp lỗi: <message>` (793, 322) |
| Missing repository method | n/a | `Worker chưa hỗ trợ loại trừ gửi.`; empty RPC row `Không đọc được điều kiện loại trừ.` |
| Pause log label | `getInputDataDisplayName` (phone first for phone campaigns), deferred after lookup | `input.name \|\| uid \|\| input.id`, printed immediately (471) |
| Phone-path exception | campaign paused via cleanup | generic `executeTarget` failure: `recordFailure` with `actionCode = campaign.actionId`, input completed or requeued |

### 3.8 Engine v2 implications

- The RPC needs the legacy `runtime_claim_token`; the engine never sets it (claim returns `legacy_busy` while any
  campaign of the account holds one, V499:118-121). A lease-authenticated variant is required.
- `auto_engine_gates.send_exclusion` is seeded `on_error='open'` ("giữ như hiện nay", V495:1824). That contradicts
  Desktop: no error path sends. The core must not treat `open` as "send anyway" for this gate.

---

## 4. Opt-out check and opt-out link

### 4.1 Contract (`zaloMessageOptOut.ts`, identical in Desktop, core and Fly)

- Token `#{STOP_MESSAGES_LINK}`; editor insert text `Từ chối nhận tin: #{STOP_MESSAGES_LINK}`.
- Link `https://b.akabiz.biz/s/<22-char base64url of the UUID>` (`buildStopMessagesLink`); error page
  `https://b.akabiz.biz/s/error`.
- `supportsStopMessagesLink(actionId, sendMode)`: the seven opt-out action types and `sendMode !== 'share'`.
- `replaceStopMessagesLink` (97-105), applied in the template `afterSpin` hook (after spin, before other tokens): token
  present → `state.hasToken = true`, replaced by the link, by the error URL when enabled but no link id, by `''` when not
  enabled.
- `appendStopMessagesFooter` (107-121): only when enabled, no token and a link exists:
  `body.trimEnd() + '\n\n' + 'Từ chối nhận tin: <link>'` (footer alone when the body is empty); styled text keeps
  `styles` clipped to the trimmed body; the footer has no style.
- `validateStopMessagesSettings` is form-only; the runtime never validates.

### 4.2 RPCs (bodies in `scripts/fixtures/message-opt-out-live-baseline.json`, captured 20/09; the ownership migration later added the same `aka_agent_assert_request_ownership` guard, `production-trial.sql:890`, `:1758`)

`aka_agent_check_zalo_message_opt_out(campaign, account, staff, p_phone, p_zalo_global_id)` STABLE: scope check
(raises `invalid_zalo_message_opt_out_scope`, `zalo_message_opt_out_scope_not_found`); true when a **confirmed**
(`confirmed_at IS NOT NULL`) row of the staff+org matches the normalized phone (`matched_by='phone'`) or the global ID.

`aka_agent_prepare_zalo_message_opt_out(campaign, account, staff, p_phone, p_zalo_global_id)`: raises
`zalo_global_id_required`; upserts `auto_zalo_message_opt_outs` on `(staff_id, organization_id, zalo_global_id)` (keeps
an old phone when the new one is null); returns `(id uuid, is_opted_out = confirmed_at IS NOT NULL)`.

Desktop repository wrappers (Repo 6654-6716): `Không thể kiểm tra từ chối nhận tin Zalo: <message>`,
`RPC kiểm tra từ chối nhận tin Zalo không trả kết quả.`, `Không thể tạo link từ chối nhận tin Zalo: <message>`,
`RPC tạo link từ chối nhận tin Zalo không trả kết quả.`, and the pre-claim CAS pause
`pausePendingZaloMessageOptOutInput` (`Không thể đánh dấu data từ chối nhận tin Zalo: <message>`). Old Fly repository
(1421-1476) throws raw pg errors for the check, same texts for empty rows.

### 4.3 Desktop flow for `zalo_message_phone` (`gateResolvedPhoneMessageTarget`, 7344-7406)

After a successful lookup, with the claimed input:

1. Check `{phone: input phone}` (label `SĐT`). Opted out → block.
2. Profile phone, if different (label `SĐT hồ sơ`). Opted out → block.
3. No global ID → warning `Không lấy được Zalo global ID; vẫn tiếp tục gửi, cá nhân hoá từ chối nhận tin (nếu có) dùng trang thông báo lỗi.`;
   else check `{globalId}` (label `Zalo global ID`). Opted out → block.
4. Any check error → warning `Không thể kiểm tra từ chối nhận tin Zalo theo <label>; vẫn tiếp tục gửi: <message>`
   (`<message>` defaults to `Lỗi không xác định`); the gate stays open.
5. Record warnings: appended to the input note (status kept `đang chạy`); for phone campaigns the log lines are deferred.
6. Send exclusion (section 3).
7. Link: when `zaloOptOutLinkEnabled === true`, mode not `share`, and a global ID exists → `prepare` with
   `{globalId, phone: target.phone || input.phone}`. `isOptedOut` → block. Error → warning
   `Không thể tạo link từ chối nhận tin Zalo; vẫn tiếp tục gửi, cá nhân hoá từ chối nhận tin (nếu có) dùng trang thông báo lỗi: <message>`,
   appended to the input note, link id null. Desktop prepares the link even when only the friend request is enabled (no
   `enableMessage` check, 7408-7440).

Block (`blockZaloMessageOptOutTarget`, 7153-7173): claimed input → `status='tạm dừng'`,
note `Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo`; the lookup helper returns no target with `optOutBlocked`, so
the send and friend steps do not run and the final status stays `tạm dừng` (4743-4746).

Line order after the lookup (11186-11191): lookup line (`Tìm SĐT: Đã tìm thấy SĐT …`), then each warning as
`⚠️ "<label>": <warning>` (7140-7151), then `🚫 Bỏ qua "<label>": Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo`
(or the exclusion note). At completion the input note is `[note, ...warnings]` de-duplicated (`withZaloMessageOptOutWarnings`,
7442-7449), so warnings stay in the final note.

Other opt-out types: same checks in `preflightZaloMessageOptOut` (7261-7342) before claim; the profile comes from
`resolveZaloFriendMessageTarget` (a profile error adds
`Không lấy được Zalo global ID để kiểm tra từ chối nhận tin; vẫn tiếp tục xử lý target: <message>`); warnings are logged
immediately; block uses the `chờ xử lý` CAS; link creation runs after the cooldown (4296).

No detail and no quota for any block; no sleep afterwards (5069).

### 4.4 Rendering with a link (`buildZaloOutgoingMessage`, 15098-15123, condensed)

```ts
const enabled = OPT_OUT_ACTIONS.has(actionId) && extra.zaloOptOutLinkEnabled === true && extra.zaloMessageSendMode !== 'share'
const rendered = this.renderZaloTemplate(raw, inputData, target, formatted, businessNow, { linkId, enabled, state })
const message = appendStopMessagesFooter(formatted ? convertHtmlToZaloMessage(rendered) : rendered, linkId, enabled, state.hasToken)
return typeof message === 'string' ? this.rewriteZaloMessageForRun(...) : message
```

The AI rewrite sees the footer and may change or drop the link; nothing restores it.

### 4.5 Source metadata

On a successful message, the detail `data.messageOptOutSource = buildMessageOptOutSource(enabled ? linkId : null, target,
response.contentSentAt)` (15708-15713; builder `src/shared/messageOptOutSource.ts:11-32`, identical in Fly). It is
`undefined` without a valid UUID, a global ID or a content send time (media-only sends have none). Trigger
`auto_capture_message_opt_out_source` (V295:45+) uses it only on INSERT of `thành công` details of
`zalo_message_friend`/`zalo_message_stranger` whose `data.target.uid` exists and `data.target.globalId` equals the
metadata. It feeds the "Khách hàng từ chối nhận tin" list.

### 4.6 Old Fly differences

Same order and texts (executor 542-745), except: warnings and the block line are printed immediately with label
`input.name || input.phone || input.uid || input.id` (719, 734) instead of after the lookup with the phone-first label;
check errors carry the raw pg message (no `Không thể kiểm tra từ chối nhận tin Zalo: ` prefix).

### 4.7 Core today

`messagePhone.ts` `optOut` gate implements steps 1-4 with `on_error` from `auto_engine_gates.opt_out` (open: warning and
continue; closed: `gate_unavailable`). Missing: warnings in the input note, send exclusion, link creation, link in the
message, `messageOptOutSource`. Block → signal `recipient_opted_out` → `err_engine_recipient_opted_out`
(V495:1953, 1996, 2093: suppress, hold, no pace). The note and the `🚫` line get ` (OPT01)` (documented difference D6).

---

## 5. Advanced content (`advancedContentEnabled`)

Used only when `shouldUseAdvancedContent` = flag and the campaign uses main content (phone types need `enableMessage`)
(17102-17170). Items: `getAdvancedContentItems` → `normalizeAdvancedContentItems` (`src/shared/advancedContent.ts:28-70`):
non-objects dropped, `mediaOption` normalized to `none|all|random` (anything else `none`), `randomMediaCount` default 3.

Run preflight (4146-4153, `getAdvancedContentConfigError` 17172-17206, `allowMediaOnly` true for Zalo):

- no item → `Vui lòng thêm ít nhất 1 nội dung nâng cao hoặc chuyển về chế độ Cơ bản.`
- an item without content and without media (formatted: `isFormattedContentEmpty`) →
  `Nội dung nâng cao số <n> đang rỗng. Vui lòng nhập nội dung hoặc chọn media.`
- effect: campaign `chờ xử lý` + note, `⚠️ <message>`, account released; retried next tick.

Selection (`prepareSelectedCampaignContent`, 17208-17266): variant count = number of items; one rotation index per send
from `aka_agent_take_campaign_content_index` (engine: `aka_agent_engine_take_content_index_v1`, keyed by action code,
`zalo_message_stranger` for phone); item = `items[index % n]`. The item content is one variant: a top-level `|` stays
literal, `{a|b}` spin groups still render. Media come from the same item (`resolveCampaignMediaForIndex`, 17400-17423:
`resolveMediaSelection(item.mediaItems, item.mediaOption, item.randomMediaCount)`), so text and media rotate together.
Without advanced content: variants are `|` splits of `campaign.content` (formatted: `splitFormattedContentVariants`) and
media always come from `campaign.images` with `imageOption || 'all'`, `randomImageCount || 3` (random subset per send).

Old Fly differences: `advancedItems` (executor 313-317) does not normalize, so an item without `mediaOption` sends
**all** its media (`selectMedia` default `all`, 1898-1905) where Desktop sends none; non-object entries count as empty
items; preflight error printed as `⚠️ Chưa thể chạy chiến dịch: <note>` and stored only when the note changed
(scheduler 482-499).

---

## 6. Formatted content (`formattedContentEnabled`)

Applies to `supportsFormattedContent` types (`src/shared/formattedContent.ts:12-41`, includes all Zalo message types).

Pipeline on Desktop:

1. Variants: `splitFormattedContentVariants(html)` (formattedContent.ts:299-321): sanitize (allowed tags `p div br h1-3
   strong b em i u s strike del ul ol li blockquote a`; `script style noscript template iframe object embed` dropped with
   children; `b→strong`, `i→em`, `strike/del→s`; `data-indent` 1..8; only `http(s)` links), split on visible top-level `|`
   (escaped `\|`, template tokens and spin groups kept), trim each variant's edges, drop empty ones. Advanced items are
   whole HTML variants.
2. `renderZaloTemplate(..., formatted=true)` (15050-15065) = `transformFormattedContentText(html, text => renderZaloTemplateText(text, …, optOut))`:
   spin, link token and template tokens per **text node**, re-serialized and escaped.
3. `convertHtmlToZaloMessage(html)` (`zaloFormattedContent.ts:55-66`) → `{ msg, styles? }`: blocks become lines, `br` a
   newline, lists `lst_1`/`lst_2`, headings `f_18` + `b`, inline `b i u s`, blockquote and `data-indent` → `ind_$` with
   `indentSize` (overlaps summed, adjacent equal segments merged), links rendered as `label (url)`; leading/trailing
   newlines trimmed, styles on whitespace-only ranges dropped. Always an object.
4. Footer (section 4.1), styles clipped.
5. No AI: the rewrite runs only for strings.

Sending: no special parameter for styles. `sendMessageToUser(accountId, uid, message, attachments, campaignMedia)` builds
the zca-js `MessageContent` `{ msg, styles? (only when non-empty), attachments? }` and calls `api.sendMessage`
(Runtime 1876-1945), for QR and Zalo Web alike. The legacy dispatch passes `campaignMedia = true` (uploads go through
`CampaignMediaExecution` when there are files); the core's Desktop port passes `false` today because it sends no files
(`desktopZaloPort.ts:80-87`). Dispatch with media (`dispatchZaloMessage`, 15555-15616):

| Files | Message | Sequence |
|---|---|---|
| ≥2 | any | album first, then text (`media_then_content`) |
| 1 | styled with text | text first, then the file (`content_then_media`) |
| 1 | plain, or styled without text | one call, text as caption (`combined`) / `media_only` |
| 0 | any | `content_only` |

A failure after the first part gives a partial detail `Đã gửi file nhưng gửi nội dung thất bại. <log>` or
`Đã gửi nội dung nhưng gửi file thất bại. <log>` (`thất bại`, counts toward the limit, no retry; 15644-15672). Empty text
with no media is sent anyway and zca-js rejects it (`Missing message content`).

Old Fly differences (`campaignContent.ts`): own splitter `splitFormattedCampaignVariants` (273-289) and renderer
`renderFormattedCampaignText` (574-582) that transforms text nodes of the unsanitized tree (ignores only `script style
noscript template`), does not merge adjacent equal indent segments, and its top-level `|` finder treats a `<` in visible
text as a tag start. Date tokens use the worker clock (`this.now()`) instead of DB business time, phone tokens use a
simpler normalizer. Same dispatch rules (executor 1919-2017); empty text and no media throws `114`
`Nội dung và media Zalo đều rỗng.` (1952). `send_text` accepts `{msg ≤20000, styles ≤2000}` (`runtime-protocol`
`ZaloOutgoingTextSchema`).

---

## 7. AI rewrite (`rewriteContentEachRun`)

### 7.1 Desktop / App Server

Position: inside content preparation of the send step, after the rotation index, template rendering and footer, only
when the result is a string and `trim()` is not empty (15164-15230). Code `ZALO_MESSAGE_REWRITE_AI_CODE = 'fb_send_message_rewrite'`
(670). One call per message send, no cache.

```ts
const result = await callAiUsing('fb_send_message_rewrite', { content, question: content, source: 'aka_agent' }, metadata)
const rewritten = stripAiCodeFence(result.content)          // ^```(text|txt)?…```$ → inner, trimmed (15232-15236)
if (result.ok && rewritten) return rewritten
throw new Error(result.error || 'AI trả về nội dung không hợp lệ.')   // caught below → original text
```

`callAiUsing` (`aiRuntimeService.ts:302-557`): config from `ai_using` (code, active; organization row, else system
row, else any null-org row, else first row) + active `ai_model` + active `ai_prompt` (3 REST reads per call); prompt
placeholders `[content]`, `{{content}}`, `[question]`, `[source]`; timeout `ai_using.timeout_ms` or 120 000 ms (min 1 000);
Desktop sends through the AI proxy `https://agent.akabiz.net/api/aka-agent/desktop/v1/ai` with the session token (no
retry, proxy errors surface as `fetch failed`; `desktopAiTransport.ts`), the App Server calls the provider directly with
`ai_model.api_key` (missing key: `Chưa cấu hình API key cho AI model: <model code>`). One `ai_log` row per call that
found a config, success or error, with tokens (a missing config returns without a log row). Other errors: `Không tìm thấy cấu hình AI: fb_send_message_rewrite`,
`AI trả về lỗi <status>[: <sanitized provider message>]`, `AI không trả về nội dung.`, timeout/abort messages. No abort
signal is passed, so stopping a campaign does not cancel an in-flight AI call.

Failure (any of the above):

```
progress: ⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: <message>
```

and the original text is sent. Hidden run events (`auto_campaign_run_events`, `is_user_visible=false`, type
`zalo_ai_rewrite`, names `zalo_ai_rewrite_success` with message `Đã viết lại nội dung bằng AI`, or
`zalo_ai_rewrite_fallback` with the fallback text) are written only when the workflow metadata has a run id
(15125-15162). The detail `data.message` holds the text actually sent. No detail, quota, streak or target effect from
the AI step itself.

Share batch (6308-6355): one AI call per batch, failures only `console.warn`, no progress line, no code-fence strip.

Cost/quota: +1 provider call and +1 `ai_log` per target; latency up to the configured timeout (production configs go up
to 300 s, `docs/DESKTOP_AI_PROXY.md`); no Zalo quota; no per-org AI quota in the proxy.

### 7.2 Old Fly

`CampaignAiRewriter.rewriteWithResult` (`campaignAiRewriter.ts:134-201`, wired in `main.ts:193-203`): one joined SQL for
the config (organization row, then system null-org row, then other null-org row; inactive model/prompt filtered first),
direct provider `fetch` with `AbortSignal.timeout(timeout_ms)` (default 120 000), `ai_log` on success and error. Called
in `sendMessage` after the footer, strings only (executor 1938-1941). Fallback line (2224-2230):
`⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: <reason>` with reasons `AI trả về lỗi <status>.`,
`AI không trả về nội dung.`, fetch/timeout messages, or a config-read error.

Differences: no config or no API key → original text **silently** (143); Desktop prints the fallback line. Share batches
never log (`logFallback=false`).

---

## 8. Effects summary

| Event | Detail row | Target | Quota | Streak | Pace | Campaign | Progress (Desktop) |
|---|---|---|---|---|---|---|---|
| Cooldown pause | none | `tạm dừng` + RPC note (written by RPC) | no | no | no | none | `⏸️ Bỏ qua "<a - b>": <stripped note>`, no `▶️` |
| Cooldown error | none | untouched | no | no | no | `chờ xử lý` + note, run ends | `⚠️ Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: <msg>` |
| Exclusion excluded/unknown | none (phone: lookup detail kept) | `tạm dừng` + decision note | no | no | no | none | `🚫 Bỏ qua "<label>": <note>` |
| Exclusion snapshot error | none | untouched | no | no | n/a | `tạm dừng` + `Không thể tải cấu hình loại trừ: …` | none |
| Exclusion exception after phone lookup | lookup detail kept | failed-run cleanup | lookup only | no | n/a | `tạm dừng` | none from the gate |
| Opt-out block | none (phone: lookup detail kept) | `tạm dừng` + `Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo` | no | no | no | none | `🚫 Bỏ qua "<label>": Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo` |
| Opt-out check / link error | none | note += warning | no | no | normal | none | `⚠️ "<label>": <warning>` |
| AI fallback | message detail as usual | as usual | as usual | as usual | normal | none | `⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: <msg>` |
| Advanced content config error | none | untouched | no | no | n/a | `chờ xử lý` + note | `⚠️ <message>` |

---

## 9. Discrepancies found while reading

1. `auto_engine_gates.send_exclusion.on_error='open'` (V495:1824) contradicts Desktop, which never sends when an
   exclusion cannot be evaluated (unknown → pause; infrastructure error → paused campaign or failed run).
2. `retry_after_seconds` of `auto_engine_gates` is not used by any RPC or runtime.
3. `docs/CAMPAIGN_OUTCOME_ENGINE.md` table 14.4 row D5 attributes "warnings not appended to the data note" to Desktop;
   the legacy Desktop does append them (7117-7138, 7442-7449). Only the engine core does not.
4. The cooldown RPC body in Git (V431) is not the live body (28/10 recipient-first rewrite plus ownership guard, SQL kept
   outside Git). Any engine variant should be generated from the live definition (`pg_get_functiondef`), not from V431.
5. Old Fly sends all media of an advanced item without `mediaOption`; Desktop sends none.

---

## 10. What the core needs

### 10.1 Port methods

Add to `ZaloCampaignPort` (`zalo/registry.ts` declares it as the union of operations; today `= ZaloMessagePhonePort`).
Every method takes the step context first, like the existing ones.

```ts
export interface DeliveryCooldownDecision {
  decision: 'allowed' | 'paused_recent_delivery' | 'paused_unidentifiable'
  /** RPC note verbatim, e.g. "Tạm dừng: đã gửi tin trước đó ngày 10/11/2026. Gửi lại từ 13/11/2026." */
  note: string | null
  lastSentAt: string | null
  eligibleDate: string | null
  sourceCampaignId: number | null
  sourceCampaignName: string | null
}

export interface ZaloGatePort {
  /** Throws when the decision cannot be made (gate error). Never writes the target. */
  checkDeliveryCooldown(ctx: StepContext): Promise<DeliveryCooldownDecision>

  /** Once per unit (cache by leaseToken in the step closure); null when the account has no exclusion selection. */
  loadSendExclusion(ctx: StepContext): Promise<SendExclusionSnapshot | null>
  sendExclusionFacts(ctx: StepContext, request: { uid: string; tags?: true; days?: number }): Promise<ExclusionFacts>
  /** Desktop: CampaignLabelContext.ids(uid); Fly: campaign_label_membership with contextId = unit token. */
  zaloLabelIds(ctx: StepContext, uid: string): Promise<{ ids: string[]; availableValues: string[] }>
  /** Raw friend-request status for readFriendship (Desktop getFriendRequestStatus, Fly get_friend_request_status). */
  friendRequestStatus(ctx: StepContext, uid: string): Promise<unknown>
  /** Raw profile for zaloProfileFacts when the target has none (Desktop getUserProfile). */
  userProfile?(ctx: StepContext, uid: string): Promise<unknown | null>
  /** Side effects of a Zalo read error (locks, account/campaign/login status) without a detail; true = stop further reads. */
  applyZaloReadErrorSideEffects(ctx: StepContext, error: unknown, note: string): Promise<boolean>
  /** Fly: release the label context of the unit (release_campaign_labels); Desktop: drop the cached context. */
  endExclusionTarget?(ctx: StepContext): Promise<void>

  prepareOptOutLink(ctx: StepContext, identity: { globalId: string; phone: string | null }): Promise<{ id: string; isOptedOut: boolean }>

  /** fallbackReason set = AI failed and content is the input; Desktop maps every !ok, Fly should also report missing config/key. */
  rewriteMessage(ctx: StepContext, content: string): Promise<{ content: string; fallbackReason?: string }>
}
```

Change `sendText(ctx, uid, message: ZaloOutgoingText)` to accept `string | { msg: string; styles?: ZaloStyle[] }` and
return `{ response, msgId, contentSentAt }` so the core can build `messageOptOutSource`. Media (advanced items with media,
`campaign.images`) needs the media ports of the media spec.

Host mapping:

| Method | Desktop | Fly |
|---|---|---|
| `checkDeliveryCooldown` | new RPC (10.2) via Supabase client | same RPC via `CampaignEngineRepository` |
| `loadSendExclusion`, `sendExclusionFacts` | new engine RPC (10.2) | same |
| `zaloLabelIds` | `zaloRuntime.createCampaignLabelContext(accountId)` per target | command `campaign_label_membership` (`unitToken: v2-<targetRunId>`) |
| `friendRequestStatus` / `userProfile` | `zaloRuntime.getFriendRequestStatus` / `getUserProfile` | `get_friend_request_status` / none |
| `applyZaloReadErrorSideEffects` | resolve policy like `getZaloPolicyByErrorCode` and apply like `applyZaloPolicySideEffects`, or a new engine RPC | same engine RPC |
| `prepareOptOutLink` | `prepareZaloMessageOptOut` (existing RPC, no claim token) | `CampaignRuntimeRepository.prepareZaloMessageOptOut` |
| `rewriteMessage` | `callAiUsing('fb_send_message_rewrite', {content, question: content, source: 'aka_agent'}, {organizationId, accountId, campaignId, campaignInputDataId})` + `stripAiCodeFence` | `CampaignAiRewriter.rewriteWithResult` |

### 10.2 DB contracts to add

1. `aka_agent_engine_delivery_cooldown_v1(p_target_run_id bigint, p_lease_token uuid) RETURNS jsonb`: lease check like
   `aka_agent_engine_take_content_index_v1`; same keys, history, all-accounts rule and notes as the live
   `aka_agent_apply_campaign_delivery_cooldown`, for the run's input in `đang chạy`; read-only (no `FOR UPDATE`, no pause).
2. `aka_agent_engine_send_exclusion_v1(p_target_run_id, p_lease_token, p_operation 'snapshot'|'facts', p_payload)`:
   same results as V330 `snapshot`/`facts`, authorised by lease instead of `runtime_claim_token`. No `pause` operation:
   the report holds the target.
3. Signal rules and policies (suppress, `campaign_detail_skipped`, `no_count`, streak `ignore`, target `hold`,
   remaining `skip`, run `continue`, pace `none`, campaign `none`, `log_template='{message}'` so the dynamic note is kept):
   - `engine` / `recent_delivery_cooldown` → new `err_engine_recent_delivery`;
   - `engine` / `send_excluded` → new `err_engine_send_excluded`.
   Decide whether they get a public code: the report appends ` (<code>)` to the note (V499:527-539), which also breaks
   the `Gửi lại từ …$` strip used for the progress line.
4. `auto_engine_gates`: set `send_exclusion` to a value the core reads as "never send" (or drop its use); document that
   `retry_after_seconds` is unused.
5. Optional, to match Desktop on cooldown errors: let the gate-unavailable outcome hold the campaign with
   `{message}` as campaign note and keep the input note (needs a report change).
6. Campaign-level config issues for `validateCampaign`: advanced content empty (Desktop texts in section 5, Desktop
   holds the campaign; pick hold or pause), bad `recentDeliveryCooldownDays` (Desktop loops; better a config issue), send
   exclusion selection/snapshot invalid (Desktop pauses the campaign with `Không thể tải cấu hình loại trừ: <message>`).

### 10.3 Step logic for `zalo_message_phone`

```
steps = [cooldown, lookup, optOut, prepareMessage, message, friend]
```

- **cooldown** (`gate`, new flag `beforeStart` so `runTarget` runs it before `▶️ Xử lý`; enabled when
  `isRecentDeliveryCooldownEnabled(actionId, extra)`; actionCode `zalo_message_stranger`):
  `allowed` → pass; paused → `{ ok:false, phase:'before_send', signal:{ kind:'engine', code:'recent_delivery_cooldown',
  message: note }, data:{ gate:'delivery_cooldown', decision, lastSentAt, eligibleDate, sourceCampaignId } }`; error →
  `gate_unavailable` (closed) with `ctx.progress('⚠️ Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: ' + (message || 'Lỗi không xác định'))`.
- **lookup**: unchanged.
- **optOut** (existing gate, extended, same order as `gateResolvedPhoneMessageTarget`): input phone → profile phone →
  global ID (existing), then flush warnings; then send exclusion when `supportsSendExclusion` and a snapshot exists:
  `evaluateSendExclusion(snapshot, uid, resolver, checkActive, onSourceError)` with the resolvers of 3.4;
  `excluded|unknown` → signal `send_excluded` with the decision note; a thrown error → Desktop pauses the campaign
  (map to a config/campaign-pause code, not to "send"); then link: when `zaloOptOutLinkEnabled === true`, mode not
  `share` and a global ID exists → `prepareOptOutLink`; `isOptedOut` → `recipient_opted_out`; error → warning text of
  4.3 step 7 via `ctx.progress`; pass `state.optOutLinkId`.
- **prepareMessage** (new, `delivery:false`, enabled when `enableMessage`, own timeout ≥ AI timeout + DB time): one
  `takeContentIndex(zalo_message_stranger, count)` with count = advanced items / formatted variants / plain variants;
  render (formatted: `transformFormattedContentText` + `convertHtmlToZaloMessage`; plain: `renderZaloTemplateText`) with
  `{ linkId: state.optOutLinkId, enabled, state }`; `appendStopMessagesFooter`; if string and `rewriteContentEachRun`
  and non-empty → `rewriteMessage`, on `fallbackReason` print `⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: <reason>`;
  resolve media for the same index; empty text and no media → `empty_content` as today. Store `{ message, media, linkId }`
  in `state`. Reason for a separate step: `runUnit` writes the "sắp gửi" mark before a delivery step runs
  (`runUnit.ts:317-329`), and a deadline inside a delivery step is reported as `in_flight` (`boundary.ts:82-86`). An AI
  call (up to 120-300 s) inside the delivery step would turn a slow AI into "không rõ kết quả" with nothing sent.
- **message** (`delivery:true`, requires `prepareMessage`): dispatch per section 6 table; outcome `data` =
  `{ target, message, attachments, response, messageOptOutSource }` (the trigger needs `target.uid` and `target.globalId`).
- **friend**: unchanged (no link, no AI, no formatting, 150 chars).

Support gating: remove each reason from `zaloMessagePhoneV2Support` only when its steps and DB contracts exist; advanced
content with item media stays excluded until media is ported.

### 10.4 Progress lines to add (`progress.ts`)

- `err_engine_recent_delivery`: `⏸️ Bỏ qua "<label>": <note>`, label = first two distinct of phone/name/uid joined by
  ` - ` (`N/A` when none), note = signal message with the Desktop strip rules (fallback `do giới hạn gửi/đăng lặp.`);
  build it from the signal message, not from the DB log, if a public code is appended.
- `err_engine_send_excluded`: `🚫 Bỏ qua "<label>": <note>` (phone-first label).
- `err_engine_gate_unavailable` from the cooldown gate: suppress the generic `⚠️ <action>: Chưa kiểm tra được điều kiện gửi, …`
  line when the gate already printed the Desktop line, or accept two lines.
- `beforeStart` gates: no `▶️` and no `✅` when they block.

### 10.5 Modules to copy into the core

| Source | Copy | Adaptation |
|---|---|---|
| `src/shared/campaignSendExclusion.ts` | verbatim | none (dependency-free; already identical to ChatApi runtime-protocol) |
| `src/shared/messageOptOutSource.ts` | verbatim | none (identical to Fly copy) |
| `src/shared/campaignDeliveryCooldown.ts` | verbatim body | replace `import type { CampaignExtraSettings } from './types'` with a local structural type |
| `src/shared/advancedContent.ts` | verbatim body | local types for `CampaignAdvancedContentItem`, `CampaignExtraSettings`, `CampaignMediaInput` |
| `src/shared/formattedContent.ts` | verbatim | needs `htmlparser2` as a core dependency (Desktop and ChatApi already have it); imports `./contentSpin` (core copy is identical) |
| `src/main/services/zaloFormattedContent.ts` | near-verbatim | replace zca-js `TextStyle`/`Style` with local string constants `b i u s f_18 lst_1 lst_2 ind_$` |
| Scheduler 7500-7535 | label + note strip | into `progress.ts` |
| Scheduler 15232-15236 `stripAiCodeFence` | 4 lines | used by the Desktop AI adapter, or inside the core after `rewriteMessage` |

Already in the core and identical to Desktop: `zaloMessageOptOut.ts`, `contentSpin.ts`, `campaignContentTemplate.ts`,
`campaignContentPreparation.ts`, `zaloPhoneSearch.ts`.

Fly's own `campaignContent.ts` renderer, `advancedItems`/`selectMedia` and the old executor gates are not copied: Fly
should use the core copies so it sends Desktop-identical text and styles.

### 10.6 Open decisions

1. Cooldown gate as a runtime step (above) or inside `aka_agent_engine_claim_target_v1` (pause before claiming, closest
   to Desktop's pre-claim order and no lease round-trip).
2. Public codes for the two new suppress codes, and whether the target note may change from Desktop's text.
3. Send exclusion infrastructure error: pause the campaign (Desktop) or `gate_unavailable` (requeue).
4. Warnings in the input note (Desktop appends; core does not).
5. Link creation when only the friend request is enabled (Desktop creates it).
6. Fly AI with no config/API key: silent (Fly today) or the Desktop fallback line.
