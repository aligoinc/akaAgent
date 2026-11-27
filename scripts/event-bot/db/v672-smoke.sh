#!/usr/bin/env bash
# Kiểm V672 (Bot sự kiện) trên Postgres cục bộ (PG16/17): fixture → V660 thật → V672 → bài kiểm → gỡ → apply lại.
# Cách chạy: bash scripts/event-bot/db/v672-smoke.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$DIR/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/v672-smoke.XXXXXX")"; chmod 777 "$TMP"
PORT="${PORT:-55672}"
RUN=(); if [ "$(id -u)" = 0 ]; then RUN=(runuser -u postgres --); fi
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; echo "(thư mục tạm: $TMP)"; }
trap cleanup EXIT
export LC_ALL=C
"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -p $PORT -c listen_addresses='' -c timezone=UTC" -l "$TMP/log" start >/dev/null
cp "$REPO/migrations/migration_v660_zalo_tag_sync.sql" "$REPO/migrations/migration_v672_event_bot.sql" \
   "$REPO/migrations/rollback_v672_event_bot.sql" "$DIR"/v672-*.sql "$TMP/"; chmod 644 "$TMP"/*.sql
PSQL=("${RUN[@]}" psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c 'CREATE DATABASE t'
"${PSQL[@]}" -d t -f "$TMP/v672-fixture.sql"
"${PSQL[@]}" -d t -f "$TMP/migration_v660_zalo_tag_sync.sql"
"${PSQL[@]}" -d t -tAc "SELECT CASE WHEN md5(prosrc) = 'd21d55c1ea0d6396c6d16e39ca70ff2e' THEN 'PASS: V660 watched md5 như production' ELSE 'FAIL: V660 watched md5' END FROM pg_proc WHERE proname = 'aka_agent_zalo_tag_sync_watched'"
"${PSQL[@]}" -d t -f "$TMP/migration_v672_event_bot.sql" && echo 'PASS: apply V672'
"${PSQL[@]}" -d t -tAc "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261126900000', 'migration_v672_event_bot', ARRAY['x'])"
if "${PSQL[@]}" -d t -f "$TMP/migration_v672_event_bot.sql" >/dev/null 2>"$TMP/reapply.err"; then echo 'FAIL: apply lần hai không bị chặn'; else grep -q 'already recorded' "$TMP/reapply.err" && echo 'PASS: apply lần hai bị preflight chặn'; fi
"${PSQL[@]}" -d t -f "$TMP/v672-smoke.sql" 2>&1 | grep -E "PASS|FAIL|ERROR|WARNING|ALL PASS" || { echo 'FAIL: smoke dừng giữa chừng'; tail -20 "$TMP/log"; exit 1; }
# aka_agent_chat_api đăng nhập trực tiếp (session_user): chỉ được nguồn fly.
if "${RUN[@]}" psql -h "$TMP" -p "$PORT" -U aka_agent_chat_api -d t -v ON_ERROR_STOP=1 -qtAX -c "SELECT public.aka_agent_event_bot_claim_v1('server', 'x', ARRAY[1002], 1)" >/dev/null 2>"$TMP/chat.err"; then
  echo 'FAIL: chat_api gọi được nguồn server'; else grep -q 'event_bot_source_not_allowed' "$TMP/chat.err" && echo 'PASS: aka_agent_chat_api gọi nguồn server bị từ chối'; fi
"${RUN[@]}" psql -h "$TMP" -p "$PORT" -U aka_agent_chat_api -d t -v ON_ERROR_STOP=1 -qtAX -c "SELECT CASE WHEN public.aka_agent_event_bot_claim_v1('fly', 'x', ARRAY[3001], 1)->>'ok' = 'true' THEN 'PASS: aka_agent_chat_api gọi nguồn fly được' ELSE 'FAIL: chat_api fly' END"
# Hai nơi hỏi việc cùng lúc cho một tài khoản: chỉ một việc sending (khoá dòng settings + chỉ mục duy nhất).
"${PSQL[@]}" -d t -qtA <<'SQL' >/dev/null
UPDATE auto_system_settings SET value = '{"audience":"all"}' WHERE key = 'event_bot';
UPDATE auto_event_bot_jobs SET status = 'sent' WHERE account_id = 1002 AND status IN ('pending', 'sending');
UPDATE auto_event_bot_settings SET paused_until = NULL WHERE account_id = 1002;
INSERT INTO auto_event_bot_jobs (account_id, organization_id, staff_id, rule_id, rule_revision, event_type, direction, recipient_uid,
  dedupe_key, status, message_template, send_after, expires_at)
SELECT 1002, 10, 100, r.id, r.revision, 'birthday', 'birthday', 'c' || i, 'conc:' || i, 'pending', 'Chúc mừng', now() - interval '1 second', now() + interval '1 hour'
FROM auto_event_bot_rules r CROSS JOIN generate_series(1, 6) i WHERE r.account_id = 1002 AND r.event_type = 'birthday';
SQL
for k in 1 2 3 4; do
  "${PSQL[@]}" -d t -qtAc "BEGIN; SELECT jsonb_array_length(public.aka_agent_event_bot_claim_v1('server', 'r$k', ARRAY[1002], 5)->'jobs'); SELECT pg_sleep(1.5); COMMIT;" > "$TMP/conc$k.out" 2>&1 &
done
wait
"${PSQL[@]}" -d t -qtAc "SELECT CASE WHEN count(*) = 1 THEN 'PASS: 4 nơi hỏi việc đồng thời → đúng 1 việc sending' ELSE 'FAIL: ' || count(*) || ' việc sending' END FROM auto_event_bot_jobs WHERE account_id = 1002 AND status = 'sending'"
grep -h -v '^$' "$TMP"/conc*.out | grep -vq 'ERROR' && echo 'PASS: không lượt hỏi việc nào lỗi' || echo 'FAIL: lượt hỏi việc lỗi'
"${PSQL[@]}" -d t -f "$TMP/rollback_v672_event_bot.sql" && echo 'PASS: rollback chạy'
"${PSQL[@]}" -d t -tAc "SELECT CASE WHEN to_regclass('public.auto_event_bot_jobs') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'aka_agent_%event_bot%') AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_aka_agent_event_bot%') AND NOT EXISTS (SELECT 1 FROM auto_system_settings WHERE key = 'event_bot') AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-event-bot-maintenance') AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'aka_agent_zalo_tag_sync_watched') = 'd21d55c1ea0d6396c6d16e39ca70ff2e' THEN 'PASS: bản gỡ sạch, watched về V660' ELSE 'FAIL: bản gỡ còn sót' END"
"${PSQL[@]}" -d t -tAc "SELECT count(*) || ' dòng sổ tag còn nguyên' FROM auto_zalo_tag_member_events" | sed 's/^/INFO: /'
"${PSQL[@]}" -d t -c "DELETE FROM supabase_migrations.schema_migrations WHERE name = 'migration_v672_event_bot'"
"${PSQL[@]}" -d t -f "$TMP/migration_v672_event_bot.sql" && echo 'PASS: apply lại sau khi gỡ'
