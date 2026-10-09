# Action status policies — runtime and DB audit

## Deployment record

Only akachat, `cgjbsmqtfhqvttudyjzq`. Existing connections/pools are reused. No application release setting or shared block/workflow was changed.

Follow-up correction: [V365](ACTION_STATUS_CLEANUP_V365.md) removed the unsupported, unused “Đã hiển thị bài” catalog row and speculative Desktop consumer. “Chờ duyệt bài” remains backed by the live pending-detection block. Other policies, results and deployed worker/Web behavior are unchanged.

| Migration | History version | SQL SHA-256 |
|---|---|---|
| migration_v361_action_status_policy_catalog | 20261009102331 | `08326ab7bb228fd97f5139ecccbaf677de2d3aea1ce17b6bfbf350ecfb4eeaad` |
| migration_v362_action_status_readers | 20261009114725 | `71ac65fe01e4b24eef0e11b0f6f8f9e5c253d9d4a8741b9224425671d53b5e93` |
| migration_v363_action_status_writer | 20261009114836 | `3c38285b37796acdb73cf51a8a8b8b4b93c3e16dce605d843eca33ec444a9d2b` |
| migration_v364_action_status_catalog_grants | 20261009115214 | `dc09a0134bfdbfcc7b2b14c34a5351d71bc20979e11d956352500cc20798abcc` |

V361 is the additive schema/catalog preparation described in [its audit](ACTION_STATUS_POLICIES_V361.md). V362 upgrades existing readers, Automation, CRM and Email/SMS observations from captured live definitions. V363 adds an atomic owned-unit writer and target settlement. V364 grants Chat SELECT on only auto_account_actions.code/is_active/is_delete, with no configuration write privilege. Do not reapply any of these migrations.

### Application rollout completed on 9 October 2026

Web/API readers were deployed first at approximately 19:06 Vietnam time to the existing Web machine `48ee749f357398`, image `action-status-20261009-efcf389`. The public health check and the exact new JavaScript bundle return 200; the downloaded bundle matches the local build byte for byte. Source commit: WebApp `efcf389`.

The existing Chat worker `784574da214578` was updated to image `action-status-20261009-59420f7` and started at 19:08 Vietnam time. Source commit: ChatApi `59420f7`. The API and Zalo runtime machine images were not changed. All four machines retain exactly their previous configuration except the image field on the two updated machines; replica counts, guest resources, environment, commands, restart settings and connection limits are unchanged. The running worker has exactly one Node process and its compiled policy modules match the local build hashes.

The worker stop used SIGTERM with a 220-second allowance. The npm parent exited with signal 15 (exit 143), rather than an application exit-0/drain acknowledgement; therefore full task drain is **not verified**. The machine was confirmed stopped before the new image was started, and the existing startup recovery was retained. The observation window through 19:10:42 recorded two reserved-connection timeouts during startup, with no further such event in the following worker-stat interval. Both intervals report zero infrastructure errors and continued processing. A read-only DB check found no blocked backend. These observations do not prove every production action path or absence of transient impact.

At 19:09:34, production contained 11 naturally created managed results and 19 policies; all original values on the 104 pre-existing error-policy rows still matched the verified backup. No outbound action was initiated for verification. Because new result metadata is now in use, keep the schema, catalogs and readers for history; an operational revert must switch future execution back to the previous worker image, not remove these DB objects.

Desktop and packaged Server production builds and both Desktop typechecks passed from source commit `479a319`; installers have **not** been published and the updater setting is unchanged. Existing installed clients continue their legacy path until their normal release. Shared blocks/workflows have not been changed to emit new codes to old clients. Source commits are local to the isolated worktrees; they have not been merged or pushed.

Exact old/new image digests, config hashes, stop event, sanitized worker statistics and DB verification are in [the rollout receipt](../migrations/snapshots/action-status-policies-v364/deployment-receipt.json). The previous worker image in that receipt is the future-execution rollback target; retain the new Web/DB readers after use.

## Effective behavior

Desktop and packaged Server acquire a catalog once per campaign run; Chat uses one query on the existing business pool. There is no polling, revision or per-target catalog read. Restart/recovery loads current policy for work that has not completed. Existing clients keep their legacy insert/RPC payloads.

Policy selection is whole-row: a live action override wins; a disabled override blocks; a soft-deleted override permits the default for the same status ID. Missing defaults/overrides are contract errors. Main statuses determine policy; secondary statuses only describe/trigger a report condition.

The user confirmed on 9 October that pre-existing friendship, membership and invitations preserve the bad-target streak. The defaults for those main statuses use ignore. Newly submitted requests use success immediately. Facebook group-invite not-found retains its separate reset behavior (source: processFacebookGroupInviteOutput). Tag/alias outcomes never count quota or change streaks; the two already-catalogued tag-not-found/invalid-parameter states have defaults added in V363.

Writes verify account/staff/campaign/parent claim/unit/input and policy identity. Detail, quota increment and account error reset share one transaction. The stable result key survives a lost INSERT acknowledgement; a duplicate returns the original row without counting. Target settlement aggregates all sibling results, records the actual decision once, and refuses missing/late siblings. Pause wins over requeue, and committed/uncertain work cannot requeue. Mixed batches, auxiliary actions and partial sends keep their execution guards.

Failure to resolve or persist an output stops the owning run through the existing token-checked cleanup. No automatic policy queue or send retry is introduced. When all action input effects are none after a committed/uncertain operation, final settlement pauses the source through the existing input guard so unit release cannot requeue it. Suppressed results still retain existing error side effects and use owned input settlement without creating detail/quota. Existing note/log templates are unchanged.

Reports read stored report_group before the legacy text adapter and display catalog labels with the stored text as fallback. Pending result/input pairs are counted once. Detail and report Excel include the secondary label. Email open/click and managed SMS delivery observations update secondary metadata only; original outcome/count/log/snapshot remains. Legacy SMS initial writes and legacy tracking retain their original RPC behavior. No old detail is backfilled.

Automation preserves an omitted subStatusIds field from old clients. Explicit null clears it; empty arrays fail. Secondary observations enqueue only on a false-to-true full-condition transition and retain (automation_id, source_campaign_detail_id) deduplication.

## Configuring a new result

1. Add an active auto_status row with a unique stable code, component_type=campaign_detail, platform, name and status_value. Do not rename a used code/status_value. A label/color change only changes presentation.
2. If it can be a main outcome, add a default policy with action_code=NULL, or an action override if behavior differs. Secondary-only usage needs no policy. Every distinct main status ID needs a policy even when its values match another status.
3. For an error cause, configure auto_error and its supported detail_mode/input_effect overrides. NULL detail_mode keeps the existing per-flow interpretation. Do not use Zalo raw-code columns for Facebook/SMTP.
4. Declare supported main output codes in workflow.defaultVariables.resultStatusDeclarations (or node.config.resultStatusDeclarations): [{actionCode, statusCodes:[...]}]. They are checked before action execution. New action execution still requires registered/supported blocks/runtime.
5. Emit actionResult: {actionCode,statusCode,subStatusCode?,errorCode?,operationState,message?,data?}. operationState is not_committed, committed, or unknown. A batch emits actionResults with an inputDataId for every claimed target; one result is not a batch summary. Legacy raw statusCode fields alone do not claim this contract.
6. For Automation, use the existing action/detail-status mapping catalog as its condition selector; it is not a policy table. Do not enable new shared-block output until all clients of that block support it.

Changing policy affects future runs/results, never recalculates history. Promoting a secondary code to main requires its policy and a producer change; old results remain unchanged. No admin UI is included.

## New diagnostics and text

No new Vietnamese note/log template was added. Technical exceptions use action_result_contract with reason/action/status, including policy_missing, policy_disabled, status_unknown, output_invalid, result_key_conflict and target_settled. The existing diagnostic/cleanup path handles them. The new UI/Excel field is “Trạng thái phụ”.

## Source/target RPC audit

Existing owner, security mode, volatility, search_path/settings and ACL are checked against the captured source. V362 preserves all unrelated live patches, including Automation identity/save normalization/enqueue-reconciliation, tenant/pagination guards, legacy tracking and CRM signatures. V363 does not replace a business RPC; it reuses the existing input-serialization and quota functions. Exact bodies/attributes are in the snapshots.

| Exact public signature | Source MD5 | Target MD5 |
|---|---|---|
| `aka_agent_enqueue_campaign_detail_automations()` | `b4633f2bdbbe70a8fe63344eed56900f` | `9858143987af45606d6da1ba5ea4dbb4` |
| `aka_agent_enqueue_group_only_automations()` | `c6611cee9b1c40772bdb9e41234049de` | `8e520c75e512e99aeba552e4792d873d` |
| `auto_automation_to_json(bigint,bigint,bigint)` | `22235c9fa385ebb4a70d28e984a39d4f` | `c13373cfefa4f19eed801d20bdae216a` |
| `aka_agent_get_automation_options(bigint,bigint,text,text)` | `80ec7c7d50f1c86dfa77472d0ae8e3c3` | `971cae0a816058b9213b6e85b4fd252d` |
| `auto_save_automation_v171_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text)` | `ebeb86eddde4baea96215a3580c2659f` | `b84327bdc57c58a9df6404f3ce50ea09` |
| `aka_agent_save_automation_v205_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)` | `ea9c24e056218b9428b0d8f3dff2e999` | `566456a7a9a2244f707bcbe668c5bb3d` |
| `aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)` | `a35e88510af1a993d1a2b280638f8f06` | `eabd2a7730a2ff803918e4cdbc70e5c5` |
| `aka_agent_mark_email_open(text,text)` | `28044017acb9bf67c688b70be92cb5cc` | `43fa1d3a95fca0448e714a9dddff16c3` |
| `aka_agent_mark_email_click(text,text)` | `781ec75bf51abb960a2509414ebd19cc` | `13bd35c961fe486823ff0263887911f0` |
| `crm_agent_campaign_results(bigint[],bigint[])` | `91d3e6d4a80d197fc05fa6ffb56c2bd1` | `53da13aaf1f735071e4a50c74a2b862f` |
| `crm_trial_campaign_signal_counts(bigint[],bigint[])` | `52afca54428c297fec537604e3c577e1` | `f36e7da0909e3acc2ac43aff1f50b8e5` |
| `aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)` | `6ed7c94a13aa8d1644fa9bbb401f10b2` | `c06650808d8a4c26b1ad8e8fa21c81f6` |
| `fn_opp_ctx(aka_salesopportunity)` | `db2b5f09d88ea0c16b4bb258c4c70a3c` | `1c3ab0533a7a2ebf1fd868b8a73dc7d4` |
| `fn_opp_trial_state(bigint)` | `2d4a4de61067d497efb1adac4e66fa67` | `460abfed9f0f52131c6e0475ffb347bb` |
| `aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)` | `9652783556c25109e6250375da031fa3` | `593cdd93a81e86d37ce026465550d4f9` |
| `aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)` | `7b7407f8102f56591435b9bc092c7b34` | `10faa8adcee8daef16c7a9b60aca5d97` |
| `aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)` | new | `b4be76b63cd90ef5f4d7bdd93a22b288` |
| `aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)` | new | `b2079cdddae3b165f409b3c42bbac834` |
| `aka_agent_guard_result_policy_identity_v363()` | new | `5e3da51a01b8ba546f3ed5d2852441d6` |

## Verification and operational notes

- V362: 16 definitions plus 12 Automation save cases and 30 event/report/legacy cases, before and after apply, all in ROLLBACK transactions.
- V363: 16 local SQL checks, the real Desktop/Chat adapters against local SQL, anon RPC rollback smoke before/after apply, payload rejection through PostgREST and both explicit catalog relationships.
- Existing executor/scheduler/ownership cleanup: 444 existing Chat tests pass with one test worker; the expanded executor suite also covers both managed/legacy policy-only progress logs. Parallel local PGlite startup exceeded two existing 5-second test budgets; the sequential rerun passed without changing those tests or production resources.
- Desktop/Server note preservation, partial sends, media deadlines, failed cleanup and friend DOM fixtures pass without external operations. Both Desktop typechecks and production Desktop/Server/Chat/Web/API builds are required by this change.
- UI: Desktop Electron and Web Chromium/Android/iPhone fixtures verify main/secondary labels and complete Excel while retaining engagement.
- An initial V361 rollback probe timed out under a DDL lock; it was rolled back and corrected before apply (see V361 audit). A later rollback safety scan hit 10 seconds under a write-blocking lock; it also rolled back. The V362/V363 rollback now limits statements to 2 seconds and uses existing partial indexes (session-local enable_seqscan=off). Verified rollback transactions completed in approximately 14/31 ms. These were test incidents; do not claim zero transient write blocking.
- Management API cannot SET ROLE aka_agent_chat_api. V364 verifies its exact column ACL and RLS=false; anon behavioral writer tests use SET LOCAL ROLE anon. No role membership was added to bypass this restriction.
- Metadata changes used the existing DDL schema-cache mechanism; no repeated manual reload or connection/pool increase. Old API reads remain 200.

## Backup and rollback

Full original auto_error/catalog snapshots, canonical per-row/table checksums, schema/constraints/indexes/permissions, exact definitions, before/after manifests, immutable inserted-row ownership and apply histories are under migrations/snapshots/action-status-policies-v361 through v364. Backups are read/validated before writes. Earlier FB/Email/catalog imports are retained and not reapplied.

The rollback SQL is in migrations/tests. Stop/revert the new runtime first; for unused preparation, reverse V364 → V363 → V362 → V361. V363 checks exact owned IDs/checksums and restores only its one changed policy row; it deletes only its two inserts. V362 restores captured definitions and its read grant. Any used result metadata causes schema/reader rollback to fail closed. Keep the reader/schema/catalog needed for historical data and revert only future execution after use. Never truncate, reset sequences, cascade-delete detail, restore a whole live table or recalculate historical counters. Retain failed-probe/repair receipts and all apply/rollback history.

## Mixed output review fixes — 09/10/2026

Desktop/packaged Server source now uses one explicit-result writer for Newsfeed progress and finalization. A block may retain `liked`/`commented` for old clients and add `actionResult`, `actionResults`, or an explicit action/status pair without creating two details or consuming quota twice. The in-flight write and its stored results are shared for the same step; repeated callbacks/finalization do not repeat error-policy side effects. Conflicting output or an uncertain write fails closed through existing cleanup. RAM receipts are cleared on the next claimed unit and at run teardown.

Mixed workflows emit results in step order. Legacy adapters retain the full workflow context for post verification, links, pending detection, comment ordinals and existing messages, but only the selected step may emit. A confirmed post followed by a failed comment therefore retains the existing target-only failure guard. Email/Zalo adapters share the aggregate summary so committed-delivery and no-retry flags survive across mixed steps.

Verification: `node scripts/action-status-mixed-output-smoke.cjs` covers 25 scenarios using the actual scheduler, managed writer and local PostgreSQL WASM: legacy/new/dual outputs, Like/Comment, concurrent callbacks, cloned finalization, replay after settlement, distinct iterations, batch targets, policy side effects, conflicting/uncertain results, both result orders, post context and shared retry guards. The 7 group-post status checks, 78 V366 checks, 22 runtime checks, 11 policy checks and existing media/partial-send/policy-progress/failure-cleanup smoke suites pass. Both TypeScript configurations pass; production Desktop and Server builds are checked locally.

No DB migration, policy/catalog/block/workflow mutation, new connection or live Facebook/Zalo action is needed. Existing note/log templates and historical results are unchanged. The installer is not published by this fix; Chat worker and Web/API deployments remain unchanged. Reverting the source fix affects subsequent processing only and requires no data rollback.

## Result origins and Email tracking review fixes — 09/10/2026

The workflow engine now assigns an origin to each explicit result and carries it through `merge`, `parallel`, object spread and JSON copies. `RunStepV2.actionResultSourceKeys` is runtime metadata; the reserved `__akaActionResultSource` marker travels with the JSON result. No DB column or producer configuration is added. Only origins issued by the current workflow run are inherited. A new operation must return a fresh result object, not reuse a previously emitted result with its marker. Equal fresh results, concurrent producers and loop iterations remain independent; batch relays may reorder inherited rows or append new results without counting inherited rows again. Result rows are copied on entry to downstream blocks so in-place edits cannot rewrite earlier step snapshots.

The scheduler keeps one write/policy/side-effect receipt per result origin for the claimed unit, including uncertain failures. Relays and repeated finalization use that receipt. Changing the result contract under an existing origin fails closed. Raw legacy payloads keep their existing adapters.

Explicit `email_send` results now use the same tracking-link routine as the legacy adapter after the detail is created. A single result accepts the existing wrapper `emailTrackingMessageId`; batch results carry their own `emailTrackingMessageId` on each result row. A wrapper tracking ID is never spread across a batch. Existing Email text, tracking failure diagnostics and legacy tracking behavior are retained. Relaying or finalizing the same result does not link or log twice. Open/click projection continues through the already-deployed DB behavior, without another send or quota increment.

Verification: `node scripts/action-status-origin-tracking-smoke.cjs` uses the real DAG engine, JavaScript executor, scheduler, managed writer and local PostgreSQL WASM. It covers 33 cases: all three explicit output shapes through five relay forms; independent identical operations, parallel nodes, loops, appended/reordered/in-place batch relays, conflicting origins; legacy/dual/new Email results with observations before/after linking and separate batch recipients. The 25 mixed-output scenarios, 7 group-post checks, V366/runtime/policy tests, failure-cleanup, partial-send, policy-progress and media-timeout smoke checks also pass. Both typechecks and production Desktop/Server builds are run locally.

No production DB, policy, block/workflow, connection budget or deployed worker/Web/API is changed by this source fix. No real send or Facebook/Zalo operation is used for verification. Installers remain unpublished; source rollback changes future runtime behavior only and requires no DB rollback.

## Partial delivery and result boundaries — 09/10/2026

The real Zalo partial-send finalizer now records `deliveryCommitted=true` after the first acknowledged stage. Both the legacy adapter and dual-output adapter carry this evidence into the managed writer: an error policy with zero quota or `detail_mode=suppress` cannot erase a confirmed partial send. It retains one failure detail, one quota count, the original error text and the no-retry guard. No policy row is changed.

Result-origin signatures are checked synchronously at the producer boundary using the same operation fields as the writer. Conflicting inherited results abort before the next workflow node starts. An invalid batch does not register partial signatures. Already-started siblings drain and valid completed outputs are written before the normal and group-invite batch paths hand the error to existing cleanup. Rejected outputs do not reach the writer; normal completion/settlement is skipped. Receipt replay cannot count or send again. Boundary filtering distinguishes loop outputs even when timestamps coincide.

Group-post verification now shares payload preparation and post-processing between legacy and explicit outputs. Link, actual pending detection, contact approval metadata, selected share targets, consumed-input tracking, bump enqueueing and existing messages are preserved. Explicit batches do not synthesize another detail for targets already represented by an explicit result. Side effects belong to the cached origin receipt, so relays/replayed finalization cannot repeat them. No “post visible” state or approval outcome is inferred from an absent pending marker.

Verification: `node scripts/action-status-result-boundary-smoke.cjs` uses real send helpers (mock transport), the DAG engine, scheduler and local PostgreSQL WASM. It covers partial sends under both error modes and both output formats; status/data/batch conflicts before another send; in-flight siblings; coincident loop timestamps; the actual group-invite scheduler failure/cleanup handoff; and legacy/dual/new/batch group-post metadata, sharing and replay. The 33 origin/tracking and 25 mixed-output scenarios, 7 group-post checks, 78 V366 checks, 22 runtime checks, 11 policy checks and existing partial-send, failure-cleanup, policy-progress and media-timeout suites pass. Both typechecks and sequential Desktop/packaged Server production builds pass locally.

This is a source-only fix. Production DB, catalogs, workflow outputs and deployed worker/Web/API remain unchanged; no connection, listener, polling or real send is added. Existing note/log templates and historical results are unchanged. Installers remain unpublished. Source rollback affects future execution and requires no DB rollback.

## Helper controls and execution evidence — 09/10/2026

Legacy and explicit Zalo outputs now share the existing helper lifecycle aggregation. The explicit origin receipt retains the helper's stop, committed-delivery, no-retry, opt-out and pending/completion-note decisions even when the writer suppresses the detail or a later relay omits the helper envelope. A summary consumes those controls once per origin, so an older relay cannot replace the reason from a later result. Replayed finalization can reconstruct the summary without repeating writes or policy side effects. Existing note/log strings are unchanged.

The policy resolver combines producer output and execution evidence: confirmed delivery takes precedence, then uncertainty, then definitely not committed. Neither output nor adapter can downgrade stronger evidence into retryable work. `requeue` therefore becomes `pause` for committed/uncertain operations, including suppressed details. This small resolver change is identical in the Desktop/packaged Server and Chat source copies; the worker is not deployed by this fix.

Both Zalo error-helper constructors now attach `handledErrorCode` after completing their policy handling. The explicit writer skips generic side effects only when the matching action/input helper owns that exact error code. This includes deliberate target-only/batch-followup handling; adding explicit output cannot upgrade it to a full account/campaign policy. Pure explicit results and mismatched helper action/input/error still use the generic handler. The marker is runtime output metadata, not a DB column or a policy change.

Verification: `node scripts/action-status-helper-controls-smoke.cjs` runs 23 local cases with real Zalo helpers, scheduler, managed writer and PostgreSQL WASM. Cases cover unknown outcomes, contradictory producer evidence, legacy/dual outputs, suppressed details, one-time action locks/campaign-note updates, both helper constructors and all three policy scopes, pure explicit/mismatched helpers, receipt replay and ordered relay notes. `action-status-policy-smoke.cjs` passes 35 checks against each source copy, including the producer/evidence matrix under suppression, cancellation and partial delivery. Existing origin/tracking (33), result-boundary (24), mixed-output (25), runtime (22) and V366 (78) checks pass, as do group-post, partial-send, policy-progress, days-at-time, media-timeout and failure-cleanup checks. The method-extraction fixtures now load the shared lifecycle helper; the older days-at-time fixture also supplies its missing legacy catalog globals. Both Desktop typechecks, the Chat TypeScript project build/typecheck and sequential Desktop/Server production builds pass.

No production DB/configuration, workflow output, deployment, connection budget or historical result is changed. Tests use mock transports, with no real Facebook/Zalo/Email operation. Changes remain in the task worktrees and installers remain unpublished. Source rollback requires no data rollback and affects future processing only.

## Legacy helper compatibility and SMS — 09/10/2026

Desktop/packaged Server now share helper guard construction between the legacy Email/Zalo adapters and explicit results. A helper that suppresses its legacy detail and requests requeue retains those decisions while `detail_mode` is NULL; explicit DB modes retain their existing precedence. The explicit writer also passes the helper's legacy counting decision. Email's no-quota guard therefore still applies when a missing recipient prevents any send, without resetting the account error streak. Confirmed partial delivery and unknown-outcome guards retain their precedence, and pure explicit results without a matching helper continue to resolve from their output and DB policies.

The legacy and explicit paths share their existing progress-log formatting, phone-lookup exclusion diagnostics, and SMS routing/error handling. Explicit results run that post-processing inside their per-origin receipt, so relay/finalization replay cannot repeat logs, tracking links or SMS attempts. Suppressed results keep their existing warning log and do not route SMS. The internal/external SMS eligibility, configured status filters and target deduplication remain in the existing SMS methods. Batch results use their own result data and only receive the outer input when its ID matches; a missing phone on another target cannot borrow the first recipient's phone. Existing note/log text and templates are unchanged.

Verification: `node scripts/action-status-helper-compat-smoke.cjs` covers 30 cases using real helpers, DAG relays, the scheduler, managed writer/settlement and local PostgreSQL WASM. It compares legacy/dual results for NULL/inherit/suppress policies and uncertain operations; tests missing-recipient/success/SMTP-failure Email quota; exercises actual internal/external SMS routing with mock writes for legacy/dual/pure/batch outputs, missing recipient phones and replay; and verifies unchanged SMS failure warnings without retrying the main send. The test mapper now exposes persisted action code/input ID so SMS eligibility is exercised rather than bypassed. Method-extraction fixtures load the shared helper methods.

The existing 23 helper-control, 24 result-boundary, 33 origin/tracking, 25 mixed-output, 78 V366, 22 Desktop/Chat runtime, 35 policy and 7 group-post checks pass, along with partial-send, policy-progress, days-at-time, media-timeout and failure-cleanup smoke suites. Both TypeScript configurations and sequential production Desktop/Server builds pass locally. No live send or production DB query/mutation is used. No schema, catalog, block/workflow, deployed service or connection budget is changed. Installers remain unpublished; reverting this source commit only changes future runtime processing.
