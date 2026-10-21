# V420 — SQL Zalo Web import

Prepared 21 October 2026; **not applied or deployed**. Backend implementation and the detailed contract live in akaAgentWebApp, `docs/SQL_ZALO_WEB_IMPORT.md`. Canonical migration: [migration_v420_akabiz_sql_zalo_web_import.sql](../migrations/migration_v420_akabiz_sql_zalo_web_import.sql).

Only two new objects (plus the history table's indexes):

- `public.akabiz_zalo_import_history`: run and source→target mapping/history in one RLS-protected table. service_role has direct SELECT only.
- `public.akabiz_import_sql_zalo_web_v1(p jsonb)`: owner postgres, SECURITY DEFINER, fixed `pg_catalog, public, private` search path, 3s lock timeout/15s statement timeout; EXECUTE restricted to service_role.

Read-only live inspection verified project **akachat / cgjbsmqtfhqvttudyjzq**. Both new objects were absent. The new function uses `CREATE FUNCTION`, never replaces a live signature; preflight refuses either name already existing. Existing business tables, functions, triggers, runtime, scheduler and workers are unchanged.

Captured prerequisites (`md5(pg_get_functiondef)`):

| Signature | Source checksum |
| --- | --- |
| create_control_zalo_account_atomic(bigint,bigint,integer,jsonb) | a42a8a093fd19dc094b002c45890e1bd |
| private.resolve_organization_zalo_entitlement_pools(bigint) | f4524e751fbca68adc364272885e07ae |
| aka_agent_staff_time_allowed(bigint) | a294e60011edd8d42e90ac2f74ce744c |
| aka_agent_set_campaign_completed_at() | 1b346c7a6b25dfb7057ee0c5a32adde7 |
| aka_agent_close_terminal_campaign_data_group_source() | 139c06853af9872e2f55a3a3e9006015 |
| aka_agent_stamp_campaign_input_semantic_type() | e0e2a82080ed3afe00fd95aa9a1954f1 |
| aka_agent_clear_campaign_runtime_claim_metadata() | dacc6362ba94f2f62c9e4cb43f965510 |
| auto_validate_campaign_send_exclusion() | 8dd9a7ee0baafd762154de59cb2bd953 |

The migration checks these exact dependencies without editing them. Their captured definitions and relevant table metadata are in akaAgentWebApp's `apps/api/src/modules/aka-agent-migrations/__fixtures__/zalo-import-live-*.sql`; they contain no production rows or credentials.

New RPC source checksum: **absent**. Local target checksum: **300cbfc774051241d5cb289522f26e5c**. No claim of a live target checksum is made before deployment.

Staging inserts campaign paused and `is_delete=true` atomically; readers/claim/realtime queries exclude it. Input and mapping/cursor writes share each transaction, capped at 500 rows/1 MiB. Final completion checks the staging version, unchanged campaign metadata, input count, current account UID/ownership, labels and dependencies. Input content/status fingerprints are no longer rescanned; same-count external input edits are accepted and never overwritten. Replays leave completed campaign configuration and runtime progress untouched. Source detail errors map to completed inputs with original status retained only in import history, never invented action results/logs/counters.

The API reads SQL source only and uses the existing mainDb pool and backend Supabase singleton. Source detail count is read once before staging; final source validation reads only eligibility/account identity. No full-source detail hash or SERIALIZABLE transaction holds source locks through the RPC. It does not copy source login sessions or stop old accounts. Existing matching destination accounts keep their sessions/configuration/proxy. New accounts use the existing quota helper and require login.

The user explicitly accepted the existing cancellation materializer behavior: when all imported inputs are complete, the first run may clear that input set and fetch sent requests again. No runtime edit or migration-specific reset mechanism was added.

Initial verification (before the later simplification below): disposable local Postgres applied this migration and ran ROLLBACK smoke with captured helpers/triggers; service-role invocation, ACL, quota, UID/mode/Chat binding, staging, 1,001 inputs, batch rollback/replay, source/target drift and read-only dependency conflicts passed. Two separate sessions racing begin produced one run/lease and one IMPORT_BUSY. All 1,064 API tests, typecheck/build, six browser cases and 11 real-materializer-with-fakes cases passed in WebApp. No real messages, production data migration or production DDL was performed.

Run from akaAgentWebApp:

```sh
AKA_AGENT_REPO=/path/to/akaAgent sh scripts/test-sql-zalo-import.sh
AKA_AGENT_CHAT_REPO=/path/to/akaAgentChatApi node --import tsx scripts/test-sql-zalo-import-runtime.mjs
```

Deployment requires a separate request: recheck project and dependency checksums; apply only V420, then deploy Web/API. Preserve existing migrations. Rollback the application independently while retaining import history and completed business data; do not drop the new objects or delete imported campaigns automatically.

Review fixes, 21 October: validate labels from the stored staged configuration (send-source and post-send), rejecting UID drift without remapping. Blocklist history stores expected count, committed offset and last batch fingerprint; member writes/mappings/cursor are atomic, with exact replay and final full-reference validation. First staging after a preflight/transport issue restores the account parent mapping. WebApp also scopes legacy cooldown to supported senders, preserves the birthday daily-limit field and NULL-last detail ordering. Additional rollback regression covers both label modes and 3,000 blocklist members; no new object or runtime change.

Follow-up review: the user approved akaAgent defaults for phone lookup (`PHONE_LOOKUP_USES_AKAAGENT_DEFAULTS`); WebApp preserves the share-link group-member limit from `CountAddMemberToGroupOfDay`. Resumption prioritizes the current campaign, reads committed input cursor/count directly, and completes after a fresh source eligibility/identity check (the former consistent snapshot check was removed by the decision below). Catalog/orphan-audit checkpoints use the existing run JSON; no SQL or runtime change. The same RPC supports payload-free campaign resumption, verified in rollback smoke. WebApp passed 1,072 API tests, 11 materializer and 3 actual runtime-limit cases, 7 SQL Server date cases, 1,001 synthetic ordering rows, 6 source projection probes, typecheck/build and 6 browser cases. The checksum was unchanged in that fix; the subsequent simplification below updates it. Still not applied/deployed.

User-approved simplification, 21 October: remove full-dataset source hashing/read locks and repeated target input hash/row-lock scans. Copy source values as each batch is read. Keep ownership/account UID, source eligibility, label/dependency guards, unique history mappings, run/campaign locks and atomic per-batch cursor/count writes. Source count is captured once; destination active input count is checked once at completion, so missing/extra/deleted rows still block completion. External content/status changes with unchanged count are deliberately not reconciled. Per-input history retains original SQL status and source fingerprint computed from the incoming row, without rereading previous rows; no target input fingerprint is stored.

Only the new, unapplied `public.akabiz_import_sql_zalo_web_v1(jsonb)` body changed. Live signature and history table were confirmed absent again on akachat; prerequisite account/staff/entitlement hashes match the table above. Source checksum: absent; local target: `300cbfc774051241d5cb289522f26e5c`. Existing function definitions/attributes, business schema, scheduler/worker/runtime and connection budget are untouched. Regression ROLLBACK checks accepted input edits, final hard/soft-deletion and extra-row count failures, duplicate mapping rollback, cursor validation, 1,001 inputs and 3,000 blocklist members. Separate sessions verify both import lease exclusion and that a locked previous input does not block the next batch. WebApp: 1,077 API tests, all seven workspace typechecks, build, 14 actual-runtime-with-fakes cases and SQL Server synthetic/projection probes passed. No production DDL or real migration was performed.
