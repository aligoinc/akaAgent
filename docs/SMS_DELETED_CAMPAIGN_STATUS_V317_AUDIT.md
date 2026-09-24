# SMS results after source deletion — v317

Historical deployment audit. The status reporting restrictions were subsequently
revised by [v318](SMS_STATUS_V318_AUDIT.md) according to the user's business rule;
the v317 group-only automation deletion guard remains in effect.

Applied to **cgjbsmqtfhqvttudyjzq (akachat)** on 2026-09-24, migration ledger
`20260924070933 / migration_v317_sms_deleted_campaign_status`.
This is a DB-only deployment; API response shape and existing mobile APK are unchanged.

## Problem and behavior

The mobile app synchronizes its persistent status outbox before fetching new SMS.
The status RPC rejected an already-sent SMS after its campaign was soft-deleted,
using the same message as an ownership failure. One such item blocked the outbox.

For soft-deleted campaigns or inputs, the RPC now updates only an existing,
undeleted SMS detail with the same account and campaign. It preserves the existing
status precedence (delivered cannot downgrade), does not count again, and returns
before input/campaign finalization. Duplicate sent/delivered reports are no-ops.
Deleted sources without valid history, wrong ownership, missing inputs, and
non-SMS campaigns remain rejected. The ordinary active-source path is unchanged.

The group-only automation trigger also excludes deleted source campaigns, so a
late delivered/failed report cannot enqueue new work through that trigger.
The campaign-target automation trigger already checked source deletion.

## Exact live definitions and checksums

Checksums are `md5(pg_get_functiondef(oid))`.

| Exact public signature | Source | Deployed target |
| --- | --- | --- |
| `aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)` | `c901687095ea440ca53c90c9fe25b041` | `2efe388f627258da23e79842b271a16f` |
| `aka_agent_enqueue_group_only_automations()` | `64b63e1c4c521a6f5bebdde2aaf91e84` | `c6611cee9b1c40772bdb9e41234049de` |
| `aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)` | `70ffadf2302e9601f68d1af0dab41469` | unchanged |

The status function body matched v152. The group-only trigger was captured from
production rather than copied from v202: its v206 semantic category snapshot and
v208 optional category matching patches were retained. The only trigger body
change adds the source campaign deletion predicate.

Both changed functions retain owner `postgres`, `SECURITY DEFINER`, volatility,
configuration and ACL exactly. The status function retains `search_path=public`
and existing PUBLIC/anon/authenticated/service_role execution permissions. The
trigger retains `search_path=pg_catalog, public` and postgres-only execution.
Existing row/advisory locks, normal counters, delivery prerequisites, JSON detail
snapshots, and active campaign completion behavior remain intact.

The migration rejects unknown or missing source definitions and allows idempotent
reapply of the exact target. No explicit PostgREST reload, connection/pool changes,
or app/API configuration changes were made. Existing DDL event triggers remained enabled.

## Validation

- `node scripts/run-sms-deleted-campaign-smoke.cjs`: passed on disposable local
  PostgreSQL 16, with rollback, reapply, checksum/missing-signature rejection,
  wrong ownership and mismatched history, deleted input/campaign, missing/deleted
  history, status precedence, duplicate reports, preserved input/campaign state,
  no quota recount, unchanged new-data filtering, normal finalization, and actual
  group-only automation execution for live sources but not deleted sources.
- Seven concurrent local calls verified that delivered results cannot downgrade,
  simultaneous initial sent reports create one detail, and quota counts once.
- API compatibility: all 12 `aka-agent-sms.service.test.ts` tests passed.
- Production PostgreSQL 17: migration plus smoke rehearsed in a transaction ending
  **ROLLBACK**, using actual SQL role `service_role`. The same rollback smoke passed
  again after deployment. Late delivery, wrong account, idempotency, quota,
  campaign/input snapshots, automation counts and fetch exclusion all passed.
- Both deployed checksums and owner/security/volatility/config/ACL were verified.
- Production HTTP: PostgREST fetch for the deleted campaign returned HTTP 200 and
  zero rows; API `/health` returned HTTP 200. Replaying its existing sent status
  through PostgREST returned accepted with `counted=false`, `input_updated=false`.
  That replay is a no-op; no delivered/failed outcome was fabricated in production.
- Security advisor comparison: 884 existing findings before and after, zero new
  findings. Existing public execution warnings on the status RPC were retained
  rather than changing permissions in a mobile compatibility hotfix. See Supabase
  guidance for [anon SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
  and [authenticated execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Operations and scope

The user can press Stop then Start in the current APK to retry its status outbox.
The diagnosed record is handled by this fix; other unrelated permanent outbox
errors may still require separate diagnosis. No phone-side outbox was inspected
or manually deleted. Server readbacks cannot prove the phone has retried yet.

This does not add per-SMS revalidation of a previously downloaded mobile batch.
That separate improvement requires an app update. No deleted campaign was restored.

Source snapshots for a future guarded rollback are retained in
`scripts/fixtures/sms-deleted-campaign-source.sql`. Do not blindly run the fixture
against production: create a new migration that first verifies the exact deployed
checksums and attributes, then rehearse and verify a rollback.
