# V420 — SQL Zalo Web import

Applied to **akachat on 21 October 2026**, migration `20261021063329 / migration_v420_akabiz_sql_zalo_web_import`. Web/API deployment is recorded below. Backend implementation and the detailed contract live in akaAgentWebApp, `docs/SQL_ZALO_WEB_IMPORT.md`. Canonical migration: [migration_v420_akabiz_sql_zalo_web_import.sql](../migrations/migration_v420_akabiz_sql_zalo_web_import.sql).

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

New RPC source checksum: **absent**. Verified live target checksum after apply: **300cbfc774051241d5cb289522f26e5c**.

Staging inserts campaign paused and `is_delete=true` atomically; readers/claim/realtime queries exclude it. Input and mapping/cursor writes share each transaction, capped at 500 rows/1 MiB. Final completion checks the staging version, unchanged campaign metadata, input count, current account UID/ownership, labels and dependencies. Input content/status fingerprints are no longer rescanned; same-count external input edits are accepted and never overwritten. Replays leave completed campaign configuration and runtime progress untouched. Source detail errors map to completed inputs with original status retained only in import history, never invented action results/logs/counters.

The API reads SQL source only and uses the existing mainDb pool and backend Supabase singleton. Source detail count is read once before staging; final source validation reads only eligibility/account identity. No full-source detail hash or SERIALIZABLE transaction holds source locks through the RPC. It does not copy source login sessions or stop old accounts. Existing matching destination accounts keep their sessions/configuration/proxy. New accounts use the existing quota helper and require login.

The user explicitly accepted the existing cancellation materializer behavior: when all imported inputs are complete, the first run may clear that input set and fetch sent requests again. No runtime edit or migration-specific reset mechanism was added.

Initial verification (before the later simplification below): disposable local Postgres applied this migration and ran ROLLBACK smoke with captured helpers/triggers; service-role invocation, ACL, quota, UID/mode/Chat binding, staging, 1,001 inputs, batch rollback/replay, source/target drift and read-only dependency conflicts passed. Two separate sessions racing begin produced one run/lease and one IMPORT_BUSY. All 1,064 API tests, typecheck/build, six browser cases and 11 real-materializer-with-fakes cases passed in WebApp. No real messages, production data migration or production DDL was performed.

Run from akaAgentWebApp:

```sh
AKA_AGENT_REPO=/path/to/akaAgent sh scripts/test-sql-zalo-import.sh
AKA_AGENT_CHAT_REPO=/path/to/akaAgentChatApi node --import tsx scripts/test-sql-zalo-import-runtime.mjs
```

The user authorized apply and deployment on 21 October. V420 is now applied; do not reapply it. Preserve existing migrations. Rollback the application independently while retaining import history and completed business data; do not drop the new objects or delete imported campaigns automatically.

Review fixes, 21 October: validate labels from the stored staged configuration (send-source and post-send), rejecting UID drift without remapping. Blocklist history stores expected count, committed offset and last batch fingerprint; member writes/mappings/cursor are atomic, with exact replay and final full-reference validation. First staging after a preflight/transport issue restores the account parent mapping. WebApp also scopes legacy cooldown to supported senders, preserves the birthday daily-limit field and NULL-last detail ordering. Additional rollback regression covers both label modes and 3,000 blocklist members; no new object or runtime change.

Follow-up review: the user approved akaAgent defaults for phone lookup (`PHONE_LOOKUP_USES_AKAAGENT_DEFAULTS`); WebApp preserves the share-link group-member limit from `CountAddMemberToGroupOfDay`. Resumption prioritizes the current campaign, reads committed input cursor/count directly, and completes after a fresh source eligibility/identity check (the former consistent snapshot check was removed by the decision below). Catalog/orphan-audit checkpoints use the existing run JSON; no SQL or runtime change. The same RPC supports payload-free campaign resumption, verified in rollback smoke. WebApp passed 1,072 API tests, 11 materializer and 3 actual runtime-limit cases, 7 SQL Server date cases, 1,001 synthetic ordering rows, 6 source projection probes, typecheck/build and 6 browser cases. The checksum was unchanged in that fix; the subsequent simplification below updates it. Still not applied/deployed.

User-approved simplification, 21 October: remove full-dataset source hashing/read locks and repeated target input hash/row-lock scans. Copy source values as each batch is read. Keep ownership/account UID, source eligibility, label/dependency guards, unique history mappings, run/campaign locks and atomic per-batch cursor/count writes. Source count is captured once; destination active input count is checked once at completion, so missing/extra/deleted rows still block completion. External content/status changes with unchanged count are deliberately not reconciled. Per-input history retains original SQL status and source fingerprint computed from the incoming row, without rereading previous rows; no target input fingerprint is stored.

Only the new, unapplied `public.akabiz_import_sql_zalo_web_v1(jsonb)` body changed. Live signature and history table were confirmed absent again on akachat; prerequisite account/staff/entitlement hashes match the table above. Source checksum: absent; local target: `300cbfc774051241d5cb289522f26e5c`. Existing function definitions/attributes, business schema, scheduler/worker/runtime and connection budget are untouched. Regression ROLLBACK checks accepted input edits, final hard/soft-deletion and extra-row count failures, duplicate mapping rollback, cursor validation, 1,001 inputs and 3,000 blocklist members. Separate sessions verify both import lease exclusion and that a locked previous input does not block the next batch. WebApp: 1,077 API tests, all seven workspace typechecks, build, 14 actual-runtime-with-fakes cases and SQL Server synthetic/projection probes passed. No production DDL or real migration was performed.

## Production apply — 21 October 2026

- Target: `akachat / cgjbsmqtfhqvttudyjzq`; migration version **20261021063329**, at **13:33:29 Asia/Ho_Chi_Minh**. Only the canonical V420 file was applied.
- Exact new signature: `public.akabiz_import_sql_zalo_web_v1(jsonb)`. Source absent; live target checksum `300cbfc774051241d5cb289522f26e5c` matches the local fixture. Owner `postgres`, SECURITY DEFINER, volatile, fixed search_path, 3s lock timeout and 15s statement timeout are confirmed; only postgres/service_role execute.
- All eight prerequisite function checksums, owners, security modes, volatility, settings and ACLs match the pre-apply snapshot. No existing function or trigger was replaced.
- History RLS is enabled; anon/authenticated cannot read it; service_role can SELECT but cannot INSERT/UPDATE/DELETE directly. The advisor's “RLS enabled without policies” notice is intentional for this backend-only table, whose writes go through the restricted RPC.
- Live ROLLBACK smoke passed: service-role invocation, invalid owner, wrong/expired lease, duplicate open run, and RPC ACL. All synthetic history writes rolled back; history count remained zero. Full 1,001-input/3,000-member, cursor/replay and separate-session tests ran against disposable local PostgreSQL.
- Web/API image from akaAgentWebApp commit `c3d6eefe8aa224908f3c31f2ee2e5a2088a9fcb1` was updated on the existing machine `48ee749f357398`. Only image changed; one shared CPU/512 MB and all other machine configuration remain unchanged. See WebApp `docs/SQL_ZALO_WEB_IMPORT_DEPLOY_20261021.md` for verification and rollback.
- No real account/campaign data was imported; no messages sent. Existing campaign runtime, business schema and connection budget are unchanged.

Private audit evidence: `/Users/lequangnhut/.codex/deployments/sql-zalo-v420-20261021-japtk2t7`.

## V421 — account identity correction, 21 October 2026

User-approved scope: match only compatible Zalo Server accounts (same staff/organization/UID; exclude QR/Web), and allow missing source UID. Missing-UID accounts use the existing quota/proxy helper, retain no SQL session or fabricated profile, and use the source-ID history mapping for replay. Existing mapped accounts remain unchanged after user login/configuration. Deletion, ownership/mode changes, malformed nonempty UIDs and multiple matching Server accounts still fail. Final campaign completion requires the account mapping even when its UID is NULL. Web service also accepts NULL-to-NULL source identity on first import and retry.

Canonical patch: `migrations/migration_v421_akabiz_sql_zalo_web_account_identity.sql`. Built from the exact live `public.akabiz_import_sql_zalo_web_v1(jsonb)` captured this task; the V420 body matches production, with no DB-only patches. Fail-closed preflight accepts source checksum `300cbfc774051241d5cb289522f26e5c` only; target checksum `650066d9ec7ffddbdf044195ce72d29b`. Original V420 is unchanged and must not be reapplied. No business schema, existing helper/trigger, runtime, connection source or budget change.

Verification: disposable PostgreSQL rollback suite covers independent missing-UID accounts, replay, untouched target session/configuration, owner/deletion/mode/quota conflicts, missing mapping at completion, campaign staging/completion, QR/Web coexistence, single Server reuse and duplicate Server rejection. Existing 1,001-input, 3,000-member and separate-session lease/input-lock tests pass. WebApp passes 1,080 API tests, seven workspace typechecks and build. Live transaction installed the patch temporarily, ran only read-only previews and invalid-target/lease guards as service_role, verified owner/ACL/security/config/target checksum, then rolled back; history remains zero. V421 applied as `20261021070657 / migration_v421_akabiz_sql_zalo_web_account_identity` at 14:06:57 Vietnam time. Post-apply rollback smoke has the same target checksum, owner postgres, SECURITY DEFINER/volatile, search_path and 3s/15s timeouts; only postgres/service_role execute. All eight prerequisite definitions/attributes/ACLs remain identical. History remains zero; no real import.

Private evidence: `/Users/lequangnhut/.codex/deployments/sql-zalo-account-fix-20261021`. The initial combined trial lacked the delimiter after `pg_get_functiondef`; PostgreSQL rejected it before execution. The migration now has the delimiter and the corrected rollback trial passed.

Web/API fix deployed from `cc3eafb` at 14:09:41 VN; only image changed on the existing 1 shared CPU/512 MB machine, health 1/1. Production dry run `nhutlq` → `nhutlq` at 14:10:44 VN returned HTTP 200/state preview in 1.817s: 7 planned new accounts, 1 reuse (Server 1159 for SQL 154787), zero campaigns/inputs/issues. History remains 0 rows and target staff's active-row count remains 14. Six production browser cases with mocked business API/WS and HTTP/runtime checksum checks passed. No real import or messages. WebApp's deployment document records image digest, rollback and evidence.

## V422 — reuse the saved source-ID mapping

User requested removal of source UID change checks. Existing history target_id wins; current source UID is used only without a committed mapping. Preserve the historical UID snapshot and target profile/session/configuration. Existing target owner/deletion/mode and target UID consistency checks stay intact; no business schema/runtime/helper/trigger/connection change. Web API removes source UID comparisons on campaign start, resume and completion, retaining source Shop ID and eligibility checks. Preview resolves mappings before deduplicating planned new accounts.

Exact signature `public.akabiz_import_sql_zalo_web_v1(jsonb)` captured live on 21 October: source `650066d9ec7ffddbdf044195ce72d29b`, target `e7646343b76af8a1d66f1e82ea1a360b`. Live V421 matches repository body; no DB-only patches. Fail-closed checksum preflight; owner postgres, SECURITY DEFINER, volatile, search_path and 3s/15s timeouts/ACL preserved. Canonical `migrations/migration_v422_akabiz_sql_zalo_web_mapped_reuse.sql`; original V420/V421 unchanged.

SQL local rollback suite covers NULL/new/changed/invalid current UID with committed mappings, no redirection to another Server, unchanged profiles/history/session, unmapped identity/quota, duplicate Server discovery, missing/deleted/changed-mode targets, 1,001 inputs/3,000 members and two-session lease/input-lock checks. API 1,082 tests, seven workspace typechecks/build pass. Live pre-apply transaction installs V422 temporarily, adds one synthetic history mapping, calls read-only account_preview with changed UID under service_role, checks unmapped matching/UID/staff/lease guards and ACL, then ROLLBACK; no account/campaign writes or real import.

V422 applied on akachat as `20261021072601 / migration_v422_akabiz_sql_zalo_web_mapped_reuse` at 14:26:01 Vietnam time. Post-apply rollback smoke confirmed the same target checksum/attributes/ACL; all eight prerequisite definitions/attributes/ACLs are unchanged. Synthetic history writes rolled back, leaving zero history rows. Do not reapply V420/V421/V422.

Web/API deployed from `7160ae4` at 14:30:03 VN, image `web-sql-zalo-7160ae4-20261021@sha256:8a63ba520845a741c8ab3ff0c1c00b4bb92d6e7a7e00dd3e833dc55335eceb34`; only image changed on the same 1 shared CPU/512 MB machine, health 1/1. Six production browser cases with mocked business API/WS plus HTTP/auth/assets and runtime checksums passed. Production `dry_run=true` for `nhutlq` to `nhutlq` at 14:30:40 VN returned HTTP 200 in 1.613s: preview 7 new accounts + 1 reused, zero campaigns/inputs/issues, run_id NULL. History remains zero and target active-row count remains 14. No real import or messages. With no eligible source campaigns, live dry-run campaign coverage is limited; fixtures cover those paths.

Evidence: `/Users/lequangnhut/.codex/deployments/sql-zalo-mapped-reuse-20261021`. WebApp `docs/SQL_ZALO_WEB_IMPORT_V422.md` records the full image, machine/config, verification and application rollback. RPC rollback, if requested, must use a new migration based on fresh live state and the saved V421 body with checksum preflight; never rerun old migrations or remove history.
