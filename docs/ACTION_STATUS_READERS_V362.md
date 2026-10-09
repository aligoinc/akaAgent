# Action status policies — runtime and DB audit

## Deployment record

Only akachat, `cgjbsmqtfhqvttudyjzq`. Existing connections/pools are reused. No application release setting or shared block/workflow was changed.

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
