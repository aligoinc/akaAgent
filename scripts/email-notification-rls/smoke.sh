#!/usr/bin/env bash
# V456 local smoke: disposable PostgreSQL 17 cluster, metadata reconstructed from live 04/11/2026.
# Proves the leak before V456, owner-only Desktop access after V456 (legacy 9-column upsert and
# the campaign completion trigger keep working), fail-closed re-apply, and rollback.
# Usage: EMAIL_RLS_PG_BIN=/usr/lib/postgresql/17/bin scripts/email-notification-rls/smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${EMAIL_RLS_PG_BIN:-/usr/lib/postgresql/17/bin}"
TMP="$(mktemp -d)"
PORT="${EMAIL_RLS_PG_PORT:-55496}"
cleanup() { "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
# initdb refuses to run as root; use the postgres OS user when needed.
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
"${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }

A='{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}'
UNKNOWN='{"role":"aka_agent_desktop","sub":"99999999-9999-4999-8999-999999999999"}'
desktop() { psql_ -c "BEGIN; SET LOCAL ROLE aka_agent_desktop; SET LOCAL request.jwt.claims='$1'; $2; ROLLBACK;"; }
expect() { if [ "$2" != "$3" ]; then echo "FAIL: $1 (expected '$2', got '$3')"; exit 1; fi; echo "ok  - $1"; }
expect_denied() {
  local out
  if out=$(desktop "$2" "$3" 2>&1); then echo "FAIL: $1 was allowed: $out"; exit 1; fi
  case "$out" in *"row-level security"*|*"permission denied"*) echo "ok  - $1";; *) echo "FAIL: $1: $out"; exit 1;; esac
}
UPSERT_OWN="INSERT INTO public.auto_email_notification_settings (staff_id,organization_id,is_enabled,recipient_emails,notify_campaign_completed,daily_report_enabled,daily_report_time,is_delete,updated_at) VALUES (1,1,true,'{a@example.test}',true,false,'18:00',false,now()) ON CONFLICT (staff_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,is_enabled=EXCLUDED.is_enabled,recipient_emails=EXCLUDED.recipient_emails,notify_campaign_completed=EXCLUDED.notify_campaign_completed,daily_report_enabled=EXCLUDED.daily_report_enabled,daily_report_time=EXCLUDED.daily_report_time,is_delete=EXCLUDED.is_delete,updated_at=EXCLUDED.updated_at RETURNING staff_id"
UPSERT_OTHER="${UPSERT_OWN//VALUES (1,1,/VALUES (2,1,}"

psql_ -f "$ROOT/scripts/email-notification-rls/setup.sql" >/dev/null
expect "fixture scope helper checksum" d417807fa9dc08cfecbd6cd0aab7df3e \
  "$(psql_ -c "SELECT md5(pg_get_functiondef('private.aka_agent_staff_scope_for_request()'::regprocedure))")"
expect "fixture trigger checksum" 0523c07b0878e3aaa53efb0bc97a74b8 \
  "$(psql_ -c "SELECT md5(pg_get_functiondef('public.aka_agent_enqueue_campaign_completed_email()'::regprocedure))")"

expect "before V456: Desktop A reads staff 2 emails (leak)" 1 \
  "$(desktop "$A" "SELECT count(*) FROM public.auto_email_notification_settings")"

psql_ -f "$ROOT/migrations/migration_v456_email_notification_owner_rls.sql" >/dev/null
echo "ok  - V456 applied"

expect "Desktop A sees only own settings (none yet)" 0 \
  "$(desktop "$A" "SELECT count(*) FROM public.auto_email_notification_settings")"
expect "legacy 9-column upsert inserts own row" 1 "$(desktop "$A" "$UPSERT_OWN")"
psql_ -c "BEGIN; SET LOCAL ROLE aka_agent_desktop; SET LOCAL request.jwt.claims='$A'; $UPSERT_OWN; COMMIT;" >/dev/null
expect "legacy 9-column upsert updates own row" 1 "$(desktop "$A" "$UPSERT_OWN")"
expect "Desktop A reads exactly its own row" 1 \
  "$(desktop "$A" "SELECT string_agg(staff_id::text, ',') FROM public.auto_email_notification_settings")"
expect_denied "upsert onto staff 2 row is rejected" "$A" "$UPSERT_OTHER"
expect "UPDATE of staff 2 row touches nothing" "" \
  "$(desktop "$A" "UPDATE public.auto_email_notification_settings SET is_enabled=false WHERE staff_id=2 RETURNING id")"
expect "unknown Desktop token sees nothing" 0 \
  "$(desktop "$UNKNOWN" "SELECT count(*) FROM public.auto_email_notification_settings")"
expect_denied "unknown token cannot insert" "$UNKNOWN" "$UPSERT_OWN"
expect_denied "direct outbox insert for staff 2 is rejected" "$A" \
  "INSERT INTO public.auto_email_notification_deliveries (staff_id,type,dedupe_key,payload) VALUES (2,'daily_report','x','{}')"
# Pre-existing (live ACL, unchanged by V456): ON CONFLICT (dedupe_key) needs SELECT on
# dedupe_key, which Desktop lacks, so a direct Desktop completion of an email-enabled
# campaign already fails before V456. Live completions reach the outbox via other callers.
expect_denied "direct Desktop completion: pre-existing ACL error unchanged" "$A" \
  "UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id=10"
# With that column privilege present, the V456 policies do not block the owner's trigger insert.
psql_ -c "GRANT SELECT (dedupe_key) ON public.auto_email_notification_deliveries TO aka_agent_desktop"
expect "own campaign completion enqueues under V456 policies" 1 \
  "$(desktop "$A" "UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id=10; SET LOCAL ROLE postgres; SELECT count(*) FROM public.auto_email_notification_deliveries WHERE staff_id=1 AND type='campaign_completed'")"
psql_ -c "REVOKE SELECT (dedupe_key) ON public.auto_email_notification_deliveries FROM aka_agent_desktop"
expect "Desktop A cannot update staff 2 campaign (unchanged guard)" "" \
  "$(desktop "$A" "UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id=20 RETURNING id")"
expect "service_role still reads every row" 2 \
  "$(psql_ -c "BEGIN; SET LOCAL ROLE service_role; SELECT count(*) FROM public.auto_email_notification_settings; ROLLBACK;")"
expect "chat api still reads every row" 2 \
  "$(psql_ -c "BEGIN; SET LOCAL ROLE aka_agent_chat_api; SELECT count(*) FROM public.auto_email_notification_settings; ROLLBACK;")"

if psql_ -f "$ROOT/migrations/migration_v456_email_notification_owner_rls.sql" >/dev/null 2>&1; then
  echo "FAIL: V456 re-apply was not refused"; exit 1; fi
echo "ok  - V456 re-apply refused by preflight"

psql_ -f "$ROOT/migrations/rollback_v456_email_notification_owner_rls.sql" >/dev/null
expect "after rollback the old behavior returns" 2 \
  "$(desktop "$A" "SELECT count(*) FROM public.auto_email_notification_settings")"
psql_ -f "$ROOT/migrations/migration_v456_email_notification_owner_rls.sql" >/dev/null
echo "ok  - V456 applies again after rollback"
echo "PASS"
