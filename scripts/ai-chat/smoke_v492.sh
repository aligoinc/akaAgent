#!/usr/bin/env bash
# V492 (hàm chèn câu hỏi Hỏi đáp AI) trên một cluster PostgreSQL dùng một lần, dữ liệu agent như production.
# Usage: AI_CHAT_PG_BIN=/usr/lib/postgresql/17/bin scripts/ai-chat/smoke_v492.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${AI_CHAT_PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${AI_CHAT_PG_PORT:-55492}"
TMP="$(mktemp -d)"
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
AS=()
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
"${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
MIGRATION="$ROOT/migrations/migration_v492_ai_chat_insert.sql"
ROLLBACK="$ROOT/migrations/rollback_v492_ai_chat_insert.sql"
V488_FUNCTIONS="FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE (n.nspname = 'private' AND p.proname LIKE 'aka_agent_ai_chat%')
    OR (n.nspname = 'public' AND p.proname IN ('aka_agent_ai_chat', 'aka_agent_control_ai_chat', 'aka_agent_ai_chat_worker'))"
fingerprint() { psql_ -Atc "SELECT md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text, ''), '|'
  ORDER BY p.oid::regprocedure::text COLLATE \"C\")) $V488_FUNCTIONS"; }

psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
psql_ -f "$ROOT/scripts/ai-chat/setup_v488.sql" >/dev/null
if psql_ -f "$MIGRATION" >/dev/null 2>&1; then echo "FAIL: V492 applied without V488"; exit 1; fi
echo "ok  - V492 từ chối khi chưa có V488"
psql_ -f "$ROOT/migrations/migration_v488_ai_chat.sql" >/dev/null
# Như production 10/11/2026: agent gốc mở cho mọi tài khoản, có thêm nhóm + agent của Desktop.
psql_ -c "UPDATE public.ai_project SET audience = 'all', version = 2 WHERE code = 'hoi-dap-chien-dich'" >/dev/null
psql_ -f "$ROOT/scripts/ai-chat/seed_akaagent_desktop.sql" >/dev/null
BEFORE="$(fingerprint)"
psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V492 applied (preflight + postcheck)"
[ "$(fingerprint)" = "$BEFORE" ] || { echo "FAIL: V492 changed a V488 function"; exit 1; }
echo "ok  - $(psql_ -Atc "SELECT count(*) $V488_FUNCTIONS") hàm V488 giữ nguyên thân và quyền"
psql_ -f "$ROOT/scripts/ai-chat/tests_v492.sql" | grep -E '^(ok|not ok|PASS|FAIL)' | tee "$TMP/out"
if grep -q '^not ok' "$TMP/out" || ! grep -q '^PASS' "$TMP/out"; then echo "FAIL"; exit 1; fi
if psql_ -f "$MIGRATION" >/dev/null 2>&1; then echo "FAIL: re-apply was not refused"; exit 1; fi
echo "ok  - re-apply refused by preflight"
ROWS="$(psql_ -Atc "SELECT (SELECT count(*) FROM public.ai_message_thread) || '/' || (SELECT count(*) FROM public.ai_message)")"
psql_ -f "$ROLLBACK" >/dev/null
[ "$(psql_ -Atc "SELECT to_regprocedure('public.aka_agent_ai_chat_insert(jsonb)') IS NULL")" = "t" ] || { echo "FAIL: rollback left the function"; exit 1; }
[ "$(fingerprint)" = "$BEFORE" ] || { echo "FAIL: rollback changed a V488 function"; exit 1; }
[ "$(psql_ -Atc "SELECT (SELECT count(*) FROM public.ai_message_thread) || '/' || (SELECT count(*) FROM public.ai_message)")" = "$ROWS" ] \
  || { echo "FAIL: rollback changed conversation rows"; exit 1; }
echo "ok  - rollback gỡ hàm, giữ hội thoại và hàm V488"
psql_ -f "$MIGRATION" >/dev/null
echo "ok  - V492 applies again after rollback"
echo "PASS (smoke)"
