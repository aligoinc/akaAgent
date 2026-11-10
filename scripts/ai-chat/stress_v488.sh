#!/usr/bin/env bash
# V488: chạy đồng thời app (open/ask/cancel/retry/sync) và nhiều bộ trả lời (claim/progress/answer/fail) để bắt khóa chéo
# và vi phạm bất biến. Cluster PostgreSQL dùng một lần. Usage: scripts/ai-chat/stress_v488.sh [giây]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${AI_CHAT_PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${AI_CHAT_PG_PORT:-55489}"
SECS="${1:-15}"
TMP="$(mktemp -d)"
AS=()
cleanup() { "${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; fi
"${AS[@]}" "$BIN/initdb" -D "$TMP/db" -A trust -U postgres --encoding=UTF8 --locale=C >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -l "$TMP/log" -o "-h '' -k $TMP -p $PORT -c deadlock_timeout=200ms" -w start >/dev/null
psql_() { "$BIN/psql" -X -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_ -f "$ROOT/scripts/notification-center/setup.sql" >/dev/null
psql_ -f "$ROOT/scripts/ai-chat/setup_v488.sql" >/dev/null
psql_ -f "$ROOT/migrations/migration_v488_ai_chat.sql" >/dev/null
psql_ -c "UPDATE public.ai_project SET audience = 'all', output_schema = NULL;
          UPDATE public.auto_system_settings SET value = '20' WHERE key = 'ai_chat.max_pending_per_staff';
          UPDATE public.auto_system_settings SET value = '100000' WHERE key = 'ai_chat.max_questions_per_staff_per_day';"

cat > "$TMP/app.sql" <<'SQL'
\set camp random(31, 36)
\set dice random(1, 100)
DO $$
DECLARE v_pid bigint := (SELECT id FROM public.ai_project LIMIT 1); r jsonb; v_tid bigint; v_mid bigint; v_status text; v_dice int := :dice;
BEGIN
  BEGIN
    r := public.aka_agent_control_ai_chat(1, 1, 'web', 'open', jsonb_build_object('requestId', gen_random_uuid(), 'projectId', v_pid, 'campaignId', :camp, 'question', 'Hỏi ' || v_dice));
    v_tid := (r #>> '{thread,id}')::bigint;
    r := public.aka_agent_control_ai_chat(1, 1, 'web', 'sync', jsonb_build_object('threadId', v_tid));
    v_mid := (r -> 'messages' -> -1 ->> 'id')::bigint; v_status := r -> 'messages' -> -1 ->> 'status';
    IF v_dice <= 25 THEN
      PERFORM public.aka_agent_control_ai_chat(1, 1, 'web', 'cancel', jsonb_build_object('threadId', v_tid, 'messageId', v_mid));
    ELSIF v_dice <= 45 AND v_status IN ('lỗi', 'đã hủy') THEN
      PERFORM public.aka_agent_control_ai_chat(1, 1, 'web', 'retry', jsonb_build_object('threadId', v_tid, 'messageId', v_mid));
    ELSIF v_dice <= 80 THEN
      PERFORM public.aka_agent_control_ai_chat(1, 1, 'web', 'ask', jsonb_build_object('threadId', v_tid, 'requestId', gen_random_uuid(), 'question', 'Hỏi tiếp'));
    ELSE
      PERFORM public.aka_agent_control_ai_chat(1, 1, 'web', 'mark_read', jsonb_build_object('threadId', v_tid, 'seq', 999));
      PERFORM public.aka_agent_control_ai_chat(1, 1, 'web', 'sync_pending', '{}');
    END IF;
  EXCEPTION WHEN others THEN
    -- Từ chối nghiệp vụ là bình thường; khóa chéo/vi phạm ràng buộc thì không.
    IF SQLERRM NOT LIKE 'ai_chat_%' THEN RAISE; END IF;
  END;
END $$;
SQL
cat > "$TMP/worker.sql" <<'SQL'
\set dice random(1, 100)
DO $$
DECLARE c jsonb; i jsonb; v_dice int := :dice;
BEGIN
  c := public.aka_agent_ai_chat_worker('claim', jsonb_build_object('workerId', 'w' || pg_backend_pid(), 'limit', 2, 'leaseSeconds', 30));
  FOR i IN SELECT value FROM jsonb_array_elements(c -> 'items') LOOP
    PERFORM public.aka_agent_ai_chat_worker('progress', jsonb_build_object('messageId', i -> 'messageId', 'claimToken', i ->> 'claimToken', 'note', 'Đang kiểm tra'));
    IF v_dice <= 15 THEN
      PERFORM public.aka_agent_ai_chat_worker('fail', jsonb_build_object('messageId', i -> 'messageId', 'claimToken', i ->> 'claimToken', 'retryable', v_dice <= 8));
    ELSIF v_dice <= 25 THEN
      NULL; -- bỏ dở: để hết hạn thuê
    ELSE
      PERFORM public.aka_agent_ai_chat_worker('answer', jsonb_build_object('messageId', i -> 'messageId', 'claimToken', i ->> 'claimToken', 'answer', 'Trả lời', 'complete', v_dice > 60));
      IF v_dice <= 60 THEN
        PERFORM public.aka_agent_ai_chat_worker('complete', jsonb_build_object('messageId', i -> 'messageId', 'claimToken', i ->> 'claimToken'));
      END IF;
    END IF;
  END LOOP;
END $$;
SQL
cat > "$TMP/chaos.sql" <<'SQL'
UPDATE public.ai_message SET lease_until = now() - interval '1 second' WHERE id IN (SELECT id FROM public.ai_message WHERE lease_until IS NOT NULL ORDER BY random() LIMIT 2);
UPDATE public.ai_message SET deadline_at = now() - interval '1 second' WHERE id IN (SELECT id FROM public.ai_message WHERE status = 'chờ câu trả lời' ORDER BY random() LIMIT 1);
SQL
chmod -R a+rX "$TMP"
"${AS[@]}" "$BIN/pgbench" -n -h "$TMP" -p "$PORT" -U postgres -c 8 -j 4 -T "$SECS" -f "$TMP/app.sql" postgres > "$TMP/app.out" 2>&1 &
A=$!
"${AS[@]}" "$BIN/pgbench" -n -h "$TMP" -p "$PORT" -U postgres -c 6 -j 3 -T "$SECS" -f "$TMP/worker.sql" postgres > "$TMP/worker.out" 2>&1 &
W=$!
"${AS[@]}" "$BIN/pgbench" -n -h "$TMP" -p "$PORT" -U postgres -c 1 -T "$SECS" -R 20 -f "$TMP/chaos.sql" postgres > "$TMP/chaos.out" 2>&1 &
C=$!
wait $A || true; wait $W || true; wait $C || true
for f in app worker chaos; do
  echo "$f: $(grep -E 'number of transactions actually processed|number of failed transactions' "$TMP/$f.out" | tr '\n' ' ')"
  if grep -qiE 'deadlock|aborted|ERROR' "$TMP/$f.out"; then echo "FAIL: errors in $f"; grep -iE 'deadlock|aborted|ERROR' "$TMP/$f.out" | sort | uniq -c | head -5; exit 1; fi
done
if grep -qi 'deadlock detected' "$TMP/log"; then echo "FAIL: deadlock in server log"; exit 1; fi
psql_ -At <<'SQL'
SELECT 'threads=' || (SELECT count(*) FROM public.ai_message_thread) || ' messages=' || (SELECT count(*) FROM public.ai_message)
    || ' done=' || (SELECT count(*) FROM public.ai_message WHERE status = 'hoàn thành');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_message_thread t
              WHERE t.message_count <> (SELECT count(*) FROM public.ai_message m WHERE m.thread_id = t.id)
                 OR t.last_message_seq <> (SELECT max(m.seq) FROM public.ai_message m WHERE m.thread_id = t.id)
                 OR t.last_message_status IS DISTINCT FROM (SELECT m.status FROM public.ai_message m WHERE m.thread_id = t.id AND m.seq = t.last_message_seq)
                 OR t.revision <> (SELECT max(m.thread_rev) FROM public.ai_message m WHERE m.thread_id = t.id)
                 OR t.last_read_seq > t.last_message_seq) THEN
    RAISE EXCEPTION 'invariant: thread does not match its messages';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_message m WHERE m.status = ANY (private.aka_agent_ai_chat_active())
              AND m.seq <> (SELECT t.last_message_seq FROM public.ai_message_thread t WHERE t.id = m.thread_id)) THEN
    RAISE EXCEPTION 'invariant: active message is not the last message';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_message m WHERE (m.status IN ('hoàn thành', 'đã có câu trả lời')) <> (m.answer IS NOT NULL)) THEN
    RAISE EXCEPTION 'invariant: answer present iff answered';
  END IF;
END $$;
SQL
echo "PASS (stress ${SECS}s)"
