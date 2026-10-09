# Facebook composer: DB-only result handling, v375

Applied to **akachat / cgjbsmqtfhqvttudyjzq** as
`20261009194359 / migration_v375_fb_composer_db_result`
on 10 October 2026 at 02:43:59 Vietnam time. Do not reapply v374/v375.

This supersedes the thrown-result approach in v374. The existing app supports
normally returned `actionResult` already; no new runtime release or installer is
required for this composer fix on clients with the action-status-policy runtime.

## Behavior

Block 27 keeps the original selectors, clicks and wait durations. A timeout in
either composer wait returns `opened=false` with:

- `actionCode=fb_post_group` or `fb_post_my_profile` from existing node config
- `statusCode=campaign_detail_error`
- `errorCode=err_fb_composer_editor_not_found`
- `inputDataId=vars.inputDataId ?? null`
- `operationState=not_committed`
- The user-approved message **Không tìm thấy ô đăng bài**
- Original timeout, selector and stage in `data`

A new `if_composer_opened` node in workflows 1, 2, 251 and 252 permits publishing
only when `input.opened === true`. Both group branches (content and choosing share
targets) are gated. On failure the group graph goes to the existing final merge
and Page identity cleanup, bypassing posting, comments and optional group actions.
The timeline branch ends without submitting. Successful traversal, Reels, sharing
an existing link and the known-approval skip path retain their prior behavior.

The explicit input ID fixes v374's multi-group ownership failure:
`output_invalid:fb_post_group:batch_input_missing`. Only the current main target
gets the error result. Unselected share targets remain owned by the existing
run-unit settlement; they receive neither a new detail nor a quota charge.

The existing runtime writes one **Lỗi** detail, does not count quota or increment
the bad-target streak, and applies the existing policy's `chờ xử lý` campaign
state. Error policy 94 remains unchanged from v374, including `detail_mode=inherit`
and both approved notification fields. No status rows, old input/detail/note/log,
RPC, schema, pool, listener, timer or schema cache changed.

A handled result ends the workflow normally. Workflow completion and input
processing completion do not mean the Facebook action succeeded: its detail is
**Lỗi**. Existing runtime message templates remain unchanged. The four workflows
retain `campaignContentPreparationVersion=1`, so the legacy workflow-completed
content-rotation path is not activated by this result.

## App source reconciliation

Removed only the unshipped v374 additions:

- Exception-attached result transport and notice callback in BlockExecutor/helpers
- Error-step result-boundary extension
- Scheduler callback and special exception fallback suppression

`actionResultRuntime.ts`, `blockExecutor.ts` and `blockHelpers.ts` are back at
HEAD. Scheduler SHA-256 matches the exact pre-composer version
`1d5e92f1d8ca61f4e62276d42a69a7e402cb1814e636948716603696a88c3d53`,
retaining the earlier approved secondary-status mapping. Earlier cache/query work
was not reverted. The legacy Page/Inbox smoke harness was updated for the existing
scheduler dependencies; this is test-only, not an application change.

## Verification

- Current [composer suite](../scripts/fb-composer-policy-smoke.cjs) uses all four
  captured live graphs in **31 scenarios**, the restored executor, real scheduler/result policy
  resolver and PostgreSQL WASM writer. Includes one/multiple/no input, button and
  dialog timeout, cancellation/unrelated errors, Page editor/session cleanup,
  replay/deduplication, no account disable, zero quota, unchanged bad-target count,
  and an offline requeue override. No real Facebook operations.
- Existing Page identity suite passed all 12 reference graphs, lifecycle and real
  scheduler target-loop cases. Boundary suite: 24; mixed-output suite: 25.
- Both typechecks and production source build passed. No installer packaged.
- Full backup read back and checksum-verified before any live update.
- Apply was rehearsed with transaction rollback; rollback was also rehearsed
  after apply. Only five intended block/workflow rows changed.
- Public Data API returned HTTP 200 with the expected block, all four workflow
  graphs and unchanged policy. No schema reload.

Already-loaded workflows/blocks may finish using their captured version. A fresh
run reads the new DB configuration. Clients older than the original policy-runtime
upgrade still require that earlier upgrade; v375 adds no further app requirement.

## Snapshot and rollback

[Snapshot folder](../migrations/snapshots/fb-composer-policy-v375/) contains all
104 error policies, 41 statuses, 30 referenced block definitions, four full workflow
rows, row/table checksums, schema/index/constraint/ACL/RLS metadata, and historical
example-detail checksums. It also archives the removed runtime diff and v374 smoke
suite. `draft-1-*` files are superseded preparation artifacts only.

Use the guarded [rollback SQL](../migrations/snapshots/fb-composer-policy-v375/rollback.sql)
only after comparing current checksums. It restores exactly the pre-v375 block
and workflow values and timestamps, retaining all details and migration history.
It stops on row/schema/consumer drift. No deletion, TRUNCATE, sequence reset or
historical recalculation is involved.

Rolling back v375 alone restores v374's exception approach, whose attached result
is not consumed by the restored runtime. To undo the composer changes entirely,
restore v375 first, then use v374's guarded rollback; do not reintroduce the rejected
runtime approach silently. Preserve the separate approved-status/cache changes.
