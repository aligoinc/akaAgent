#!/usr/bin/env bash
# V488 (Hỏi đáp AI) trên một cluster PostgreSQL dùng một lần: không dữ liệu khách, không cron, không pg_net.
# Usage: AI_CHAT_PG_BIN=/usr/lib/postgresql/17/bin scripts/ai-chat/smoke_v488.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${AI_CHAT_PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${AI_CHAT_PG_PORT:-55488}"
TMP="$(mktemp -d)"
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
AS=()
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
"${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
MIGRATION="$ROOT/migrations/migration_v488_ai_chat.sql"
ROLLBACK="$ROOT/migrations/rollback_v488_ai_chat.sql"

psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
psql_ -f "$ROOT/scripts/ai-chat/setup_v488.sql" >/dev/null
psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V488 applied (preflight + postcheck)"
psql_ -f "$ROOT/scripts/ai-chat/tests_v488.sql" | grep -E '^(ok|not ok|PASS|FAIL)' | tee "$TMP/out"
if grep -q '^not ok' "$TMP/out" || ! grep -q '^PASS' "$TMP/out"; then echo "FAIL"; exit 1; fi
if psql_ -f "$MIGRATION" >/dev/null 2>&1; then echo "FAIL: re-apply was not refused"; exit 1; fi
echo "ok  - re-apply refused by preflight"
psql_ -f "$ROLLBACK" >/dev/null
[ "$(psql_ -Atc "SELECT to_regclass('public.ai_message') IS NULL AND to_regclass('public.ai_project_group') IS NULL AND NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key LIKE 'ai_chat.%')")" = "t" ] \
  || { echo "FAIL: rollback left objects"; exit 1; }
echo "ok  - rollback removes V488 objects"
psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V488 applies again after rollback"
echo "PASS (smoke)"
