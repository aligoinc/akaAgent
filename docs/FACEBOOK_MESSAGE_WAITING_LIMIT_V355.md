# Facebook Messenger waiting-request limit — v355

Applied to linked production **akachat / cgjbsmqtfhqvttudyjzq** on 08/10/2026,
10:58:03 Vietnam time. History: `20261008035803 / migration_v355_facebook_message_waiting_limit`.
Do not reapply.

**Current cooldown: 24 hours (1,440 minutes).** Follow-up v356 was applied on
08/10/2026 at 11:07:58 Vietnam time, history
`20261008040758 / migration_v356_facebook_message_waiting_limit_24h`, at the user's
request. [Canonical SQL](../migrations/migration_v356_facebook_message_waiting_limit_24h.sql)
guards the live policy checksum, updates only `time_disable_actions` and
`updated_at`, and verifies all other policy fields are unchanged. Rollback smoke
and a separate post-commit read passed. Policy MD5 immediately after v356 was
`1d7a519002b4180aa14158db7e80d61e`; block MD5 remains
`fb11e928304d044f50f3a11a93821463`. Existing account cooldown timestamps were not
rewritten; the duration applies when the policy next triggers. No build or schema
reload is required. The 60-minute values and policy checksum below record the
original v355 deployment. The read-only `verify` command checks the policy at the
latest recorded v355/v356/v357 revision, while `apply`/`smoke` retain the original
v355 preconditions.

**Current notices:** v357 was applied on 08/10/2026 at 11:30:42 Vietnam time,
history `20261008043042 / migration_v357_facebook_waiting_message_notices`.

- `noti_running_process`: “Facebook đang hạn chế nhắn tin cho người lạ.”
- `noti_campaign`: “Facebook đang hạn chế nhắn tin cho người lạ. Tạm nghỉ 24 giờ.”

[Canonical SQL](../migrations/migration_v357_facebook_waiting_message_notices.sql)
uses the captured live v356 checksum and changes only those two fields and
`updated_at`. Current policy MD5: `604d7635ae91594495830f917173d77c`. Detection text,
XPath, block code, 1,440-minute cooldown and all other policy settings are
unchanged. Rollback smoke, post-commit verification and the 14-case Electron
smoke passed; the scheduler assertion covers the new campaign note. Previously
stored log/campaign notes are not rewritten. No app release or schema reload.

## Cause and change

Facebook can replace the composer with “Bạn đã đạt giới hạn về số tin nhắn đang chờ”.
The existing `fb_send_message` block waited for the missing textbox, then returned
`{ok:false,error:'waitForSelector timeout: ...'}`. The workflow therefore completed
with a failed milestone and reached generic error handling, not the existing
`err_limit_waiting_message` policy.

C# `SendMessage_Fb` already checks `LimitMessageSpan` when the composer is absent
(`akaBizAuto.AutomationModule/Services/mFbChromeSeleniumService.cs:657`). V355
adds the equivalent branch to block **38 / fb_send_message**:

- Preserve the existing 15-second composer wait and prior dialog handling.
- After a failed composer wait, query the exact existing policy/C# XPath:
  `//span//span[contains(.,"Bạn đã đạt giới hạn về số tin nhắn đang chờ")]`.
  Use raw XPath matches, as C# does; add no selector fallback or visibility filter.
- Throw the recognized limit past the outer catch. The existing engine stops
  downstream steps and the existing scheduler maps the message to the policy.
- Missing banner, DOM-read failure and cancelled waits retain the old error path.
  Content allocation, AI, media and successful sends remain unchanged.

V355 kept the then-current policy unchanged at **60 minutes**; v356 subsequently
changed it to **24 hours**. It disables `fb_message_stranger` and the campaign
returns to `chờ xử lý`. This is the app's cooldown, not a guarantee that Facebook
lifts its restriction at that time. No campaign,
account, detail, quota or error-state rows were changed during deployment.

## Historical investigation

The policy and scheduler classification predate this fix; their existence did not
prove that the Facebook DOM detection was connected:

- Commit `69560e12800d75b69db0327edd61adce41641eae` (09/05/2026) adds the v15
  policy and `normalizeRuntimeError()` matching the warning in an **already
  reported error message**. It does not update the message block to read that
  warning from Facebook. Production records v15 as
  `20260509041620 / account_action_limits_errors`.
- The v104 block snapshot committed as `488d1d70` on 08/06/2026 waits for the
  textbox and returns exceptions as `{ok:false,error:e.message}`; it contains no
  waiting-message banner detection.
- The chat **“Plan tài khoản phụ chạy campaign”**
  (`019fb1e8-1db3-7d12-b510-aac9b2f14857`), assistant response at
  30/07/2026 14:35 Vietnam time, says this policy “có thể dùng ngay”. That readiness
  statement is not evidence of an end-to-end DOM-to-policy check; the missing
  detection makes it too strong.
- Production v351 (`20261006101435 / migration_v351_campaign_content_blocks`)
  and the live block captured before v355 still have the same missing branch.
  The recent **“Bổ sung policy lỗi FB và Email”** chat explicitly scoped its work
  to new database policies, leaving existing policies and runtime code unchanged.

No inspected commit, recorded migration statement or saved block snapshot shows
this detection being implemented and subsequently removed. This supports an
incomplete connection between DOM detection and the existing policy, rather than
an identified overwrite. Migration history is not a complete audit of manual DB
edits, and the original May task transcript was not found in the available local
chat history, so it cannot establish that a transient live implementation never
existed.

## Deployment and checksums

Canonical SQL: [migration_v355_facebook_message_waiting_limit.sql](../migrations/migration_v355_facebook_message_waiting_limit.sql).
The baseline fixture captures the exact live row before editing; the SQL requires
both full-row and code MD5 checksums, checks the unchanged policy, and verifies
that only `code` and `updated_at` changed.

| Item | MD5 |
|---|---|
| Block before | `3a7f999972550721bf67b25744363b9f` |
| Full row before | `56dfd1f6942ea2a552792edda3fb1ec3` |
| Block after | `fb11e928304d044f50f3a11a93821463` |
| Policy, unchanged | `6962d5198d9884f148a8affa8f168dfa` |

Applied using `node scripts/facebook-message-waiting-limit-migration.cjs apply`:
one transaction through the existing linked Management API query path, including
the migration-history INSERT. No schema preparation DDL, RPC changes, schema
reload, new connections/pools, app build or package release. Workflows **3, 208,
248, 249** retain their captured full-row checksums. The engine fetches block code
at each workflow run; already executing runs keep their previously loaded code.

## Verification

- `node scripts/facebook-message-waiting-limit-smoke.cjs` — 14 checks passed:
  real Electron DOM/PageController, baseline failure, immediate/delayed banner,
  unrelated text, missing banner, failed DOM read, cancellation, normal/legacy/
  media-only sends, content preparation failure, and actual engine/scheduler
  propagation to both the historical 60-minute and current 1,440-minute policy,
  plus the configured after-failure screenshot hook. Isolated fixture, network denied;
  no real recipients or Facebook session used.
- `node scripts/facebook-message-waiting-limit-migration.cjs smoke` — production
  rollback smoke passed before apply: code/metadata/policy drift rejected, duplicate
  apply rejected, target code verified, policy/workflows unchanged, original block
  checksum restored after rollback.
- Both `tsconfig.node.json` and `tsconfig.web.json` typechecks passed.
- `node scripts/facebook-message-waiting-limit-migration.cjs verify` verifies the
  applied block checksum, expected policy at the recorded migration revision,
  unchanged workflows and migration-history receipts.

The customer's screenshot establishes the Facebook restriction. The corrected
branch is verified on a local DOM fixture; no live customer campaign was resumed
or replayed for this change.

If rollback is required, use the captured original block in
`scripts/fixtures/facebook-message-waiting-limit-live.json`, require the exact
v355 target checksum before restoring it in a transaction, and record the rollback
separately. Do not overwrite a later block update or remove the applied history.
