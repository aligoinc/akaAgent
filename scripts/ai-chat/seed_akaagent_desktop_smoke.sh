#!/usr/bin/env bash
# Nhóm + agent riêng của app Desktop (scripts/ai-chat/seed_akaagent_desktop.sql) trên một cluster PostgreSQL dùng một lần.
# Usage: AI_CHAT_PG_BIN=/usr/lib/postgresql/17/bin scripts/ai-chat/seed_akaagent_desktop_smoke.sh
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
# Như production lúc chạy seed: agent gốc đã mở cho mọi tài khoản, version 2.
psql_ -c "UPDATE public.ai_project SET audience = 'all', version = 2 WHERE code = 'hoi-dap-chien-dich'" >/dev/null
psql_ -f "$ROOT/scripts/ai-chat/seed_akaagent_desktop.sql" >/dev/null
psql_ -f "$ROOT/scripts/ai-chat/seed_akaagent_desktop.sql" >/dev/null
echo "ok  - seed chạy hai lần không lỗi"

psql_ <<'SQL' | grep -E '^(ok|not ok)' | tee "$TMP/out"
\pset format unaligned
\pset tuples_only on
CREATE FUNCTION pg_temp.ok(c boolean, label text) RETURNS text LANGUAGE sql AS
$$ SELECT CASE WHEN c IS TRUE THEN 'ok - ' ELSE 'not ok - ' END || label $$;
CREATE FUNCTION pg_temp.app(p_staff bigint, p_org bigint, p_client text, p_action text, p_payload text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT private.aka_agent_ai_chat(p_staff, p_org, p_client, p_action, p_payload::jsonb) $$;

SELECT pg_temp.ok((SELECT count(*) FROM public.ai_project_group) = 2 AND (SELECT count(*) FROM public.ai_project) = 2,
  'chạy lại không tạo trùng: 2 nhóm, 2 agent');
SELECT pg_temp.ok(g.code = 'akaagent-desktop' AND d.version = 1 AND d.is_active
  AND (to_jsonb(d) - '{id,group_id,code,version,created_at,updated_at}'::text[]) = (to_jsonb(s) - '{id,group_id,code,version,created_at,updated_at}'::text[]),
  'agent Desktop thuộc nhóm akaagent-desktop và giống agent gốc ở mọi cột nội dung')
  FROM public.ai_project d JOIN public.ai_project_group g ON g.id = d.group_id, public.ai_project s
 WHERE d.code = 'hoi-dap-chien-dich-desktop' AND s.code = 'hoi-dap-chien-dich';

-- App: mọi client nhận hai nhóm; lọc theo mã nhóm thì mỗi app chỉ thấy agent của mình.
SELECT pg_temp.ok(jsonb_array_length(r -> 'groups') = 2 AND r #>> '{groups,0,code}' = 'hoi-dap-chien-dich' AND r #>> '{groups,1,code}' = 'akaagent-desktop',
  'agents: nhân viên thường nhận hai nhóm, nhóm cũ đứng trước') FROM pg_temp.app(2, 1, 'web', 'agents', '{}') r;
SELECT pg_temp.ok(jsonb_array_length(r -> 'groups') = 1 AND r #>> '{groups,0,projects,0,code}' = 'hoi-dap-chien-dich-desktop'
  AND r #>> '{groups,0,projects,0,name}' = 'Hỏi đáp chiến dịch',
  'agents: groupCode akaagent-desktop chỉ trả agent Desktop') FROM pg_temp.app(2, 1, 'desktop', 'agents', '{"groupCode":"akaagent-desktop"}') r;

-- Hỏi từ Desktop vào agent Desktop, hỏi từ Web vào agent gốc: hai hội thoại riêng cho cùng một chiến dịch.
SELECT id AS did FROM public.ai_project WHERE code = 'hoi-dap-chien-dich-desktop' \gset
SELECT id AS wid FROM public.ai_project WHERE code = 'hoi-dap-chien-dich' \gset
SELECT pg_temp.app(2, 1, 'desktop', 'open', '{"requestId":"00000000-0000-4000-8000-0000000000d1","projectId":' || :did || ',"campaignId":20,"question":"Hỏi từ Desktop"}') AS d \gset
SELECT pg_temp.app(2, 1, 'web', 'open', '{"requestId":"00000000-0000-4000-8000-0000000000d2","projectId":' || :wid || ',"campaignId":20,"question":"Hỏi từ Web"}') AS w \gset
SELECT pg_temp.ok((:'d'::jsonb #>> '{thread,projectCode}') = 'hoi-dap-chien-dich-desktop' AND (:'d'::jsonb #>> '{thread,source}') = 'desktop'
  AND (:'w'::jsonb #>> '{thread,projectCode}') = 'hoi-dap-chien-dich' AND (:'d'::jsonb #>> '{thread,id}') <> (:'w'::jsonb #>> '{thread,id}'),
  'open: Desktop và Web tạo hai hội thoại riêng, đúng agent');

-- Bộ trả lời: lọc projectCodes tách được câu hỏi của Desktop.
SELECT pg_temp.ok(jsonb_array_length(c -> 'items') = 1 AND c #>> '{items,0,project,code}' = 'hoi-dap-chien-dich-desktop'
  AND c #>> '{items,0,question}' = 'Hỏi từ Desktop', 'list: projectCodes của Desktop chỉ trả câu hỏi từ Desktop')
  FROM public.aka_agent_ai_chat_worker('list', '{"projectCodes":["hoi-dap-chien-dich-desktop"]}'::jsonb) c;
SELECT pg_temp.ok(jsonb_array_length(c -> 'items') = 1 AND c #>> '{items,0,question}' = 'Hỏi từ Web', 'list: projectCodes của agent gốc không lẫn câu hỏi Desktop')
  FROM public.aka_agent_ai_chat_worker('list', '{"projectCodes":["hoi-dap-chien-dich"]}'::jsonb) c;
SELECT pg_temp.ok(jsonb_array_length(c -> 'items') = 2, 'list: không lọc thì thấy cả hai') FROM public.aka_agent_ai_chat_worker('list', '{}'::jsonb) c;

-- Ẩn agent Desktop: nhóm biến mất khỏi app, agent gốc không đổi.
UPDATE public.ai_project SET audience = 'off' WHERE code = 'hoi-dap-chien-dich-desktop';
SELECT pg_temp.ok(jsonb_array_length(r -> 'groups') = 1 AND r #>> '{groups,0,code}' = 'hoi-dap-chien-dich',
  'audience off ở agent Desktop: app chỉ còn nhóm cũ') FROM pg_temp.app(2, 1, 'desktop', 'agents', '{}') r;
SQL
if grep -q '^not ok' "$TMP/out" || [ "$(grep -c '^ok' "$TMP/out")" != 9 ]; then echo "FAIL"; exit 1; fi
echo "PASS (seed akaagent-desktop: 10 khẳng định)"
