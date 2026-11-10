#!/usr/bin/env bash
# Edge Function ai-chat-agent (handler.ts) chạy trên Node với hàm SQL V488 thật, cluster PostgreSQL dùng một lần.
# Usage: bash scripts/ai-chat/edge_agent_smoke.sh   (cần Node >= 22.18 để chạy thẳng tệp .ts)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${AI_CHAT_PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${AI_CHAT_PG_PORT:-55489}"
TMP="$(mktemp -d)"
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
AS=()
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
"${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT" -w start >/dev/null
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
psql_ -f "$ROOT/scripts/ai-chat/setup_v488.sql" >/dev/null
psql_ -f "$ROOT/migrations/migration_v488_ai_chat.sql" >/dev/null
chmod 755 "$TMP"
node "$ROOT/scripts/ai-chat/edge_agent_smoke.mjs" "$BIN/psql" "$TMP" "$PORT"
