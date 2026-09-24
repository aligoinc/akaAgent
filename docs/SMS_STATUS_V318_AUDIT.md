# SMS result reporting — v318

Deployed on 2026-09-24 to **cgjbsmqtfhqvttudyjzq (akachat)** as
`20260924073247 / migration_v318_sms_status_accept_existing_input`.
This supersedes v317's restriction requiring the reporting account to match
the campaign/current history owner. No mobile APK or API executable changed.

## Approved business rule and exact change

The user explicitly permits account B to report results of SMS sent by A.
Result reporting must not block the mobile outbox because a campaign was deleted
or assigned to another account. The API's existing login/device authentication
is unchanged; no new original-sender, device, tenant, or historical-source check
was added to the status RPC.

The RPC no longer restricts input lookup by the campaign's current account.
It uses the existing insert/update path for both active and soft-deleted sources,
then skips input/campaign finalization for deleted sources. Existing details keep
their original account/campaign IDs and are not counted again. When no undeleted
detail exists, the existing first-report insert/count behavior is reused. Existing
row and advisory locks serialize retries and concurrent updates.

The previously discussed broader draft was discarded. The final function retains
the previous status validation, detail deletion filter, status precedence and
`đã gửi` prerequisite before the first `đã nhận`. The current APK already handles
that prerequisite by recovering a sent report and retrying delivery; this flow is
now also able to complete after source deletion/account reassignment. No new
delivered-before-sent behavior or invalid-history repair was deployed.

The fetch function still excludes deleted sources. The v317 group-only automation
fix remains unchanged, preventing deleted campaigns from enqueueing new work.

## Live-source audit

Exact public signature:
`aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)`.

| Definition | `md5(pg_get_functiondef(oid))` |
| --- | --- |
| Captured source (deployed v317) | `2efe388f627258da23e79842b271a16f` |
| Deployed v318 | `6ed7c94a13aa8d1644fa9bbb401f10b2` |
| Unchanged `aka_agent_list_sms_due_input_data(bigint,bigint[],text,integer,integer)` | `70ffadf2302e9601f68d1af0dab41469` |
| Unchanged `aka_agent_enqueue_group_only_automations()` | `c6611cee9b1c40772bdb9e41234049de` |

The captured source exactly matched v317, including prior v152 history payload
behavior. Owner `postgres`, SECURITY DEFINER, volatility `v`, configuration
`search_path=public`, signature, return shape and execution ACL were verified
unchanged after deployment. Migration preflight rejects a missing/unknown source
or changed dependencies and allows reapplying the exact target.
No explicit PostgREST reload, new connection/pool, or unrelated migration was used.

## Validation

- `node scripts/run-sms-deleted-campaign-smoke.cjs --v318`: passed on disposable
  PostgreSQL 16. Covers B reporting A, campaign reassignment, deleted source,
  preserved history ownership/counters, the unchanged missing-sent recovery,
  retries, deleted fetch exclusion, automation behavior and normal completion.
- Seven concurrent local calls passed: cross-account callbacks preserve delivered
  precedence, and simultaneous first reports create/count only once.
- Twelve existing `aka-agent-sms.service.test.ts` API tests passed.
- Production migration rehearsal plus actual SQL `service_role` smoke passed in
  a transaction ending ROLLBACK; the same smoke passed again after deployment.
  It uses another real SMS account to report the diagnosed SMS and verifies
  unchanged history owner, account counters, input/campaign rows and automation
  counts. Simulated delivered/failed results were rolled back.
- Production HTTP verified cross-account replay of the existing sent status:
  accepted, `counted=false`, `input_updated=false`. This replay was a no-op.
  Deleted-campaign fetch returned HTTP 200 with zero items; API health was 200.
- Security advisors remained at 884 existing findings, zero new findings.
  Existing RPC execution ACL warnings were not changed in this business-rule fix;
  see [anon execution guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
  and [authenticated execution guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Handoff and cleanup

Users can retry Stop → Start with their current APK. No phone-side outbox was
manually edited; end-to-end confirmation of actual phone sending requires the
device to retry. Missing SMS IDs and malformed requests retain existing errors.
Per-SMS mobile revalidation of a previously fetched batch is outside this fix.

The unapproved v318 draft was replaced by the deployed, narrower migration.
Task-specific scratch captures and draft SQL in `/tmp` were removed. The repo
retains only final migrations, reproducible tests/fixtures and deployment audits;
v317 files remain because that migration was already deployed.

For rollback, derive the status function from v317, guard the exact current v318
checksum/attributes, rehearse in a rollback transaction, and apply as a new single
migration. Do not rerun the whole older migration against a newer database.
