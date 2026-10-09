# Facebook composer error policy v374

> Superseded by [v375: DB-only result handling](FB_COMPOSER_DB_RESULT_V375.md).
> The runtime edits described below were reverted; this document records the historical v374 approach.

Applied to **akachat / cgjbsmqtfhqvttudyjzq** as
`20261009193333 / migration_v374_fb_composer_error_policy`
(10 October 2026, 02:33:33 Vietnam time). Do not reapply.

## Cause and resulting behavior

Campaign 27394 / run 2508109 / input 6874115 / step 30435604 failed in
`fb_open_composer` (block 27). The button wait timed out and the executor stored
`output={}`, so the existing Facebook error policy could not be selected.
This observation does not establish that a buy/sell group caused the failure.

Only the two existing 15-second composer waits now translate an exact
`waitForSelector timeout:` into a thrown error with an attached `actionResult`:

- `statusCode=campaign_detail_error`
- `errorCode=err_fb_composer_editor_not_found`
- `operationState=not_committed`
- `actionCode=fb_post_group` or `fb_post_my_profile`, from the composer node's config
- Message chosen by the user: **Không tìm thấy ô đăng bài**
- Original error, selector and stage retained in result `data` for diagnosis

The throw keeps the existing DAG failure behavior: no downstream content,
media upload or post submission. Cancellation, missing element configuration,
click errors and browser errors retain their previous handling. Successful DOM
operations, XPath, wait durations and workflow edges are unchanged. No retries,
new status, RPC, schema change, schema reload, connection or pool was added.

## Live DB changes

| Object | Change |
|---|---|
| `auto_blocks.id=27` | Wrap only the button/dialog waits; preserve all other code |
| `auto_workflows.id IN (1,252)` | `open_composer.config.composerActionCode=fb_post_group` |
| `auto_workflows.id IN (2,251)` | `open_composer.config.composerActionCode=fb_post_my_profile` |
| `auto_error.id=94` | Both `noti_running_process` and `noti_campaign` use the chosen message; `detail_mode=inherit` |

`inherit` enables the existing error overrides for the explicit Facebook result.
Existing policy settings are retained: no action quota, no bad-target increment,
no account/action disable, and campaign moves to `chờ xử lý`. No old detail,
input, note/log, status row or other error policy was rewritten. Historical
`error_desc` source/import annotations remain unchanged.

## Runtime and rollout

The executor retains an attached result on a thrown exception and resolves its
notice from the current run's error catalog. The result boundary also validates
error steps, including malformed payloads and out-of-scope input IDs. The scheduler
uses the explicit result's policy receipt and does not normalize that same throw
again into `err_undefined`.

Production source build and both typechecks passed. The Desktop installer has
**not** been packaged or installed for this change; runtime files remain in the
existing `fb-email-policy-catalogs/akaAgent` worktree. Build/install an updated
Desktop to enable the complete policy/detail behavior. Existing clients receiving
the new block still stop safely with the chosen friendly error but discard its
attached contract and retain their old generic error-policy path. Campaigns that
already loaded an older block can retain that version for their current run.

No Chat API/WebApp/Server deployment is required for this browser-based composer
fix. Existing shared runtime source changes will be included in a future Server
build, but do not introduce Facebook execution there. Old run logs remain as-is.

## Verification and recovery

- Offline composer smoke: **21** scenarios using the captured live block, real
  DAG/executor, scheduler, result resolver and PostgreSQL WASM writer. Covers
  button/dialog timeouts for group/timeline, normal success, downstream stop,
  cancellation/unrelated failures, changed catalog notice, malformed result,
  old executor compatibility, one detail, zero quota, unchanged bad-target streak,
  no duplicate policy effects, and the actual scheduler target-finalization branch.
- Regression smoke: result boundary **24**, mixed outputs **25**, origin/tracking
  **33** scenarios; no real Facebook posting or messaging.
- Node and renderer typechecks: zero errors. `npm run build`: passed with existing
  import/chunk warnings. No installer produced.
- Live UPDATE/ROLLBACK before apply: full scoped table checksums restored.
- After apply: only six owned rows changed, schema/catalog and six existing
  campaign detail checksums preserved. Public Data API reads return HTTP 200
  with exact expected block, workflow config and policy values.
- Explicit rollback rehearsal after apply restores the before checksums inside
  a transaction, then rolls that rehearsal back; the applied configuration remains.

Files: [migration](../migrations/migration_v374_fb_composer_error_policy.sql),
[snapshot and receipts](../migrations/snapshots/fb-composer-policy-v374/),
[rollback](../migrations/snapshots/fb-composer-policy-v374/rollback.sql),
[offline smoke](../scripts/fb-composer-policy-smoke.cjs).

Backup contains every column of all 104 `auto_error` rows and 41 `auto_status`
rows, full block 27 and all four consumer workflows, per-row/table checksums,
schema/constraints/indexes/ACL/RLS metadata, and example detail checksums. It was
read back and verified before any live mutation. Archived `draft-1-*` files are
superseded preparation artifacts; use the canonical migration/rollback files.

Rollback verifies exact after-row checksums, schema and composer consumer IDs
before restoring only the changed fields and original timestamps. It fails on
configuration drift; reconcile any later edits rather than forcing it. It retains
migration history, status/error identities and processed details. No row deletion,
TRUNCATE, sequence reset or historical result recalculation is involved. A runtime
revert affects future execution only; keep the existing readers for stored details.
