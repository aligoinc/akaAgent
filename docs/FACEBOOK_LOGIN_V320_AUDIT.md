# Audit v320 — 2FA login for existing Facebook accounts

Applied 2026-09-26 (Asia/Ho_Chi_Minh) to linked **akachat**, ref **cgjbsmqtfhqvttudyjzq**. History version `20260925184154`, name `migration_v320_facebook_existing_account_login`. No access to the legacy project.

Migration: [migration_v320_facebook_existing_account_login.sql](../migrations/migration_v320_facebook_existing_account_login.sql).
SHA-256: `8e638295c69c70011cfca6e90a5845cbcd5a96e7582d5502da0e36f1506b88ea`.

## Live definition audit

Exact signature: `public.aka_agent_facebook_login(bigint,text,text,text,jsonb)`.

- Source `md5(pg_get_functiondef)`: `9da25936c98428774debffcafcc0d8f8`.
- Target, rollback verification and postapply: `4ab7e726d3bc9c9e17c35b61f186ed55`.
- The main agent captured the full live definition and attributes before drafting. Live body matched v319 byte-for-byte; no DB-only patch was present. V320 was built by inserting two branches into that captured body.
- Preserved every v319 branch: import reservation/dedupe/quota/replay, entitlement and owner/tenant checks, existing observation/identity discard, save revision and observed-UID guards, cleanup/read-after-expiry exceptions.
- Owner `postgres`; SECURITY DEFINER; volatile; config `search_path=pg_catalog, public`, `statement_timeout=15s`.
- ACL unchanged: `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. No PUBLIC execute.

Only existing function body changed. No schema, signature, return type, owner or ACL change, explicit PostgREST reload, migration-history bootstrap DDL, new pool, connection budget, timer or job. Applied one file through `supabase db query --linked`, with fail-closed source checksum, target-attribute assertions and insertion into the existing migration-history table in the same transaction.

## New behavior

- `metadata` for an existing manual account returns public UID, revision 0 and false credential flags. Reading it does not create a secret/session row.
- Explicit `login` accepts a verified UID/password/2FA/cookie result. The existing account row is locked; revision 0 enrolls a manual account, positive revision replaces its saved session. Both require c_user matching UID plus a nonempty xs cookie. No duplicate-UID gate or creation quota, because no account is created.
- The same account ID, partition, name, group, proxy and campaign relationships remain. `facebook_login_managed`, UID, login status, Vault secret, revision and verification timestamp are updated on success.
- Main process explicit login authenticates through HTTP with cookies emptied, even when the persistent browser/cloud session is valid. Password/2FA from a different stored UID is never inherited. Authentication failure before promotion leaves the old cookies/credentials intact. Background restore keeps its original cookie-first behavior.
- Cookie/user-input/navigation conflicts, revision conflicts, timeout and claim release reuse the existing safeguards. Legacy polling skips only the account currently owned by explicit login; untouched manual accounts retain their original checks.
- The modal exposes login for every Facebook account. Manual accounts enroll through successful login; managed accounts additionally retain passive Save. Secret fields remain write-only and masked.

## Verification

All passed:

- Full migration plus synthetic fixtures in one transaction ending ROLLBACK before apply.
- Postapply standalone [SQL smoke](../migrations/tests/migration_v320_facebook_existing_account_login_smoke.sql), using actual `SET LOCAL ROLE anon`: manual metadata without secret creation, cross-staff rejection, invalid cookie rejection, manual enrollment while logged in, duplicate UID allowed, stale revision rejected, same-account relogin and preserved v319 import/save/cleanup/claim behavior. Synthetic rows rolled back; sequences can advance.
- Postapply exact checksum, owner, ACL, security mode, volatility and config matched the tested target.
- HTTP schema/auth/secret-table probe passed without schema reload. Invalid staff credentials rejected; direct secret/reservation reads denied.
- `node scripts/facebook-login-smoke-test.cjs`: explicit login for manual/managed accounts already authenticated, no saved-cookie shortcut, no account creation/dedupe, failed login preserves session, different UID requires new credentials, user switch cancels promotion, claim release and all existing recovery cases.
- `node scripts/run-facebook-login-browser-smoke.cjs`: Electron cookies, local HTTPS/proxy and actual HTTP password/TOTP requests. Existing logged-in manual/managed account success/failure, same account partition, replacement of 222 with 111 on explicit success, old xs preserved on authentication failure, no new BrowserWindow/DOM, no Graph lookup and lock release.
- `node scripts/facebook-login-legacy-check-smoke-test.cjs`: old manual checks unchanged, skip during login then resume, no extra selector or write on stable state.
- `node scripts/run-facebook-login-ui-smoke.cjs`: manual and managed forms, logged-in account login, masked fields, busy/error/retry/close, saved credential reuse; import UI regression checks also passed. Visual screenshot inspected.
- Both Node and renderer TypeScript checks; production `npm run build`; `git diff --check`.

This change was verified with fixtures, not another login to the user's real Facebook accounts. It was built locally, not packaged or published as an installer. A DB write or visible-tab refresh failure after cookie promotion can leave the verified new session in the browser while reporting an error; it must not be mistaken for Facebook rejecting authentication.

## Security advisor review

Project-wide advisories were read after apply. Relevant findings reflect the preserved RPC-only design: [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on the two existing secret/reservation tables (direct access is revoked), and [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)/[authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) execution of the existing SECURITY DEFINER RPC (staff credentials, entitlement and owner/tenant checked inside). ACL/RLS were not widened. Unrelated project advisories were not changed in this task.

## Post-review application fixes

RPC v320 and the production database were not changed for these fixes. Explicit login now watches cookie/input/navigation before the initial reads/claim/proxy waits and releases any completed claim after cancellation. Manual-account promotion preserves script-readable `c_user` so a failed enrollment RPC cannot break the legacy check; `xs` stays HttpOnly. Electron requires expiring an existing HttpOnly UID cookie before setting the readable replacement; only the matching c_user is affected and its expected removal event is fenced. The error explicitly distinguishes a verified Facebook login from unconfirmed credential persistence.

The credentials form always exposes X. Closing hides the form immediately while the already-started operation continues; login completion shows the shared result modal. A view generation prevents old completion callbacks from closing/updating a newer form. UI tests cover success/error, closing during pending metadata/login, result after close, and opening another form while the old request finishes. Runtime tests cover early read/claim/proxy cookie changes, early input/navigation/tab changes, claim release and failed-enrollment cookie attributes. Electron tests cover legacy document.cookie visibility after a failed enrollment plus real HttpOnly-to-readable cookie conversion. No Facebook DOM logic, selector, timer, pool or migration was added.
