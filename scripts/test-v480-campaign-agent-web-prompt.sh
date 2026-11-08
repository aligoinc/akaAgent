#!/usr/bin/env bash
# Thử V480 (prompt Agent Web bản 2) trên PostgreSQL 16 cục bộ, không chạm production. Fixture như test V479 (12 dòng
# ai_form_configs, trigger validate, quyền) rồi chạy V479 để có dòng Agent; md5 bản chụp production thay bằng md5 của fixture.
# Kiểm: đổi đúng prompt, phần còn lại của dòng và 12 dòng khác giữ nguyên, chạy lại bị từ chối, guard dòng khác bị đổi,
# nguyên tắc bổ sung không làm hỏng guard, Desktop vẫn chỉ thấy 12 dòng, rollback về đúng prompt V479 và từ chối chạy lại.
# Dùng: bash scripts/test-v480-campaign-agent-web-prompt.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
V479="$ROOT/migrations/migration_v479_campaign_agent_web_config.sql"
MIGRATION="$ROOT/migrations/migration_v480_campaign_agent_web_prompt.sql"
ROLLBACK="$ROOT/migrations/rollback_v480_campaign_agent_web_prompt.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v480.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt)
q() { as_pg "${PSQL[@]}" -c "$1"; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }

as_pg "${PSQL[@]}" <<'SQL'
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA private;
CREATE TABLE public.auto_campaign_actions (id text PRIMARY KEY, is_delete boolean DEFAULT false);
INSERT INTO public.auto_campaign_actions (id) VALUES ('zalo_message_phone'), ('zalo_message_friend'), ('zalo_message_group'),
  ('zalo_message_group_member'), ('zalo_message_remarketing_customer'), ('zalo_message_friend_recommendation'),
  ('zalo_message_group_realtime'), ('facebook_group_post'), ('facebook_comment_seeding');
CREATE TABLE public.ai_model (id bigint PRIMARY KEY, organization_id bigint, provider text, model text, is_active boolean DEFAULT true);
INSERT INTO public.ai_model VALUES (21, NULL, 'openai', 'gpt-6.1-sol', true), (24, NULL, 'anthropic', 'claude-haiku', true), (25, NULL, 'openai', 'gpt-6.1-terra', true);
CREATE TABLE public.ai_form_configs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,119}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  desktop_section_id text UNIQUE CHECK (desktop_section_id IS NULL OR btrim(desktop_section_id) <> ''),
  web_section_id text UNIQUE CHECK (web_section_id IS NULL OR btrim(web_section_id) <> ''),
  mobile_section_id text UNIQUE CHECK (mobile_section_id IS NULL OR btrim(mobile_section_id) <> ''),
  prompt_system text,
  prompt_user text NOT NULL DEFAULT '',
  output_schema jsonb NOT NULL CHECK (jsonb_typeof(output_schema) = 'object'),
  model_id bigint NOT NULL REFERENCES public.ai_model(id),
  campaign_scope text NOT NULL DEFAULT 'all' CHECK (campaign_scope = ANY (ARRAY['all', 'selected'])),
  campaign_action_ids text[] NOT NULL DEFAULT '{}' CHECK (array_position(campaign_action_ids, NULL::text) IS NULL),
  is_active boolean NOT NULL DEFAULT true,
  is_reasoning boolean NOT NULL DEFAULT false,
  timeout_ms integer NOT NULL DEFAULT 120000 CHECK (timeout_ms >= 1000 AND timeout_ms <= 120000),
  response_parser text NOT NULL DEFAULT 'auto',
  response_path text,
  request_options jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(request_options) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  nguyen_tac_bo_sung text CHECK (nguyen_tac_bo_sung IS NULL OR char_length(nguyen_tac_bo_sung) <= 8000),
  CHECK (num_nonnulls(desktop_section_id, web_section_id, mobile_section_id) > 0),
  CHECK ((btrim(COALESCE(prompt_system, '')) <> '') OR (btrim(prompt_user) <> '')),
  CHECK ((campaign_scope = 'all' AND cardinality(campaign_action_ids) = 0) OR (campaign_scope = 'selected' AND cardinality(campaign_action_ids) > 0))
);
CREATE FUNCTION private.validate_ai_form_config() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.campaign_action_ids) a(id)
    LEFT JOIN public.auto_campaign_actions c ON c.id=a.id
    WHERE c.id IS NULL OR c.is_delete IS TRUE) THEN
    RAISE EXCEPTION 'Unknown campaign action in AI configuration' USING ERRCODE='23514';
  END IF;
  IF cardinality(NEW.campaign_action_ids) <> (SELECT count(DISTINCT id) FROM unnest(NEW.campaign_action_ids) a(id)) THEN
    RAISE EXCEPTION 'Duplicate campaign action in AI configuration' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model WHERE id=NEW.model_id AND organization_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Form AI requires a global model' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;
CREATE TRIGGER ai_form_configs_validate BEFORE INSERT OR UPDATE ON public.ai_form_configs
  FOR EACH ROW EXECUTE FUNCTION private.validate_ai_form_config();
INSERT INTO public.ai_form_configs (id, code, name, desktop_section_id, web_section_id, prompt_system, prompt_user, output_schema, model_id, campaign_scope, campaign_action_ids)
OVERRIDING SYSTEM VALUE VALUES
  (1, 'app_campaign_action_limits', 'Giới hạn', 'campaign.action_limits', 'campaign.action_limits', 'P1', '{{limitsContext}}', '{"type":"object"}', 21, 'all', '{}'),
  (2, 'app_campaign_schedule', 'Lịch', 'campaign.schedule', 'campaign.schedule', 'P2', '{{x}}', '{"type":"object"}', 21, 'all', '{}'),
  (5, 'app_campaign_content', 'Nội dung', 'campaign.content', 'campaign.content', 'P5', '{{x}}', '{"type":"object"}', 24, 'all', '{}'),
  (7, 'app_campaign_send_exclusions', 'Loại trừ', 'campaign.send_exclusions', 'campaign.send_exclusions', 'P7', '{{x}}', '{"type":"object"}', 21, 'selected', '{zalo_message_phone,zalo_message_friend,zalo_message_group,zalo_message_group_member,zalo_message_remarketing_customer,zalo_message_friend_recommendation,zalo_message_group_realtime}'),
  (14, 'app_facebook_form_general', 'Cài đặt chung', 'campaign.facebook.general', 'campaign.facebook.general', 'P14', '{{x}}', '{"type":"object"}', 21, 'all', '{}'),
  (15, 'app_facebook_form_search', 'FB 1', 'campaign.facebook.search', NULL, 'P15', '{{x}}', '{"type":"object"}', 21, 'selected', '{facebook_group_post,facebook_comment_seeding}'),
  (16, 'app_facebook_form_keywords', 'FB 2', 'campaign.facebook.keywords', NULL, 'P16', '{{x}}', '{"type":"object"}', 21, 'selected', '{facebook_comment_seeding}'),
  (17, 'app_facebook_form_post_search', 'FB 3', 'campaign.facebook.post_search', NULL, 'P17', '{{x}}', '{"type":"object"}', 21, 'selected', '{facebook_comment_seeding}'),
  (18, 'app_facebook_form_newsfeed', 'FB 4', 'campaign.facebook.newsfeed', NULL, 'P18', '{{x}}', '{"type":"object"}', 21, 'selected', '{facebook_group_post}'),
  (19, 'app_facebook_form_group_comment', 'FB 5', 'campaign.facebook.group_comment', NULL, 'P19', '{{x}}', '{"type":"object"}', 21, 'selected', '{facebook_group_post}'),
  (22, 'app_campaign_agent_router', 'Agent router', 'campaign.agent.router', NULL, 'P22', '{{x}}', '{"type":"object"}', 21, 'all', '{}'),
  (23, 'app_campaign_agent_section', 'Agent section', 'campaign.agent.section', NULL, 'P23', '{{x}}', '{"type":"object"}', 21, 'all', '{}');
ALTER TABLE public.ai_form_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_legacy_0 ON public.ai_form_configs FOR SELECT TO aka_agent_desktop USING (is_active);
CREATE POLICY ai_form_configs_active_read ON public.ai_form_configs FOR SELECT TO anon, authenticated USING (is_active);
GRANT SELECT ON public.ai_form_configs TO aka_agent_desktop;
GRANT ALL ON public.ai_form_configs TO service_role;
GRANT USAGE ON SCHEMA public TO aka_agent_desktop, service_role;
-- Như akachat: service_role đọc được bảng mà trigger validate tra cứu.
GRANT SELECT ON public.auto_campaign_actions, public.ai_model TO service_role;
GRANT USAGE ON SCHEMA private TO service_role;
SELECT setval(pg_get_serial_sequence('public.ai_form_configs', 'id'), 23);
CREATE TABLE public.auto_system_settings (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key text NOT NULL UNIQUE, value text,
  description text, is_secret boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.auto_system_settings (key, value) VALUES ('web.campaigns.poll_interval_seconds', '30');
SQL
ok "fixture 12 dòng ai_form_configs + ai_model 25 + auto_system_settings"

FP=$(q "SELECT md5(string_agg((to_jsonb(c) - 'nguyen_tac_bo_sung' - 'updated_at')::text, ',' ORDER BY c.id)) FROM public.ai_form_configs c")
sed "s/6e38cf9c6f8c49c49fcd9c4c0d41636b/$FP/g" "$V479" > "$WORK/v479.sql"
chmod a+r "$WORK/v479.sql"
as_pg "${PSQL[@]}" -f "$WORK/v479.sql" >/dev/null && ok "V479 chạy trước (dòng Agent bản V479)"
OLD=ce237722c4312cf31bd0327ecd158a0a
NEW=$(grep -o "md5 [0-9a-f]\{32\} (V479) → mới md5 [0-9a-f]\{32\}" "$MIGRATION" | grep -o "[0-9a-f]\{32\}" | tail -1)
[ -n "$NEW" ] && [ "$NEW" != "$OLD" ] || fail "không đọc được md5 prompt mới trong V480"
[ "$(q "SELECT md5(prompt_system) FROM public.ai_form_configs WHERE code='app_campaign_agent_web'")" = "$OLD" ] && ok "prompt V479 đúng md5 production" || fail "prompt V479"
REST=$(q "SELECT md5((to_jsonb(c) - 'nguyen_tac_bo_sung' - 'updated_at' - 'prompt_system')::text) FROM public.ai_form_configs c WHERE code='app_campaign_agent_web'")
for file in "$MIGRATION" "$ROLLBACK"; do
  sed -e "s/6e38cf9c6f8c49c49fcd9c4c0d41636b/$FP/g" -e "s/d0d95df6071ea97fb729b0538d4cd02e/$REST/g" "$file" > "$WORK/$(basename "$file")"
done
chmod a+r "$WORK"/*.sql
M="$WORK/$(basename "$MIGRATION")"; R="$WORK/$(basename "$ROLLBACK")"
# Admin lưu nguyên tắc bổ sung ở dòng Agent và một dòng cũ trước khi apply: guard bỏ cột này.
q "UPDATE public.ai_form_configs SET nguyen_tac_bo_sung='[Khuyến nghị] x' WHERE code IN ('app_campaign_agent_web','app_campaign_content')" >/dev/null
BEFORE=$(q "SELECT updated_at FROM public.ai_form_configs WHERE code='app_campaign_agent_web'")
as_pg "${PSQL[@]}" -f "$M" >/dev/null && ok "V480 chạy được (guard bỏ nguyen_tac_bo_sung/updated_at)"
[ "$(q "SELECT md5(prompt_system) FROM public.ai_form_configs WHERE code='app_campaign_agent_web'")" = "$NEW" ] && ok "prompt mới đúng md5" || fail "prompt mới"
[ "$(q "SELECT md5((to_jsonb(c) - 'nguyen_tac_bo_sung' - 'updated_at' - 'prompt_system')::text) FROM public.ai_form_configs c WHERE code='app_campaign_agent_web'")" = "$REST" ] && ok "phần còn lại của dòng Agent giữ nguyên" || fail "dòng Agent đổi ngoài prompt"
[ "$(q "SELECT md5(string_agg((to_jsonb(c) - 'nguyen_tac_bo_sung' - 'updated_at')::text, ',' ORDER BY c.id)) FROM public.ai_form_configs c WHERE code <> 'app_campaign_agent_web'")" = "$FP" ] && ok "12 dòng AI từng phần giữ nguyên" || fail "dòng cũ đổi"
[ "$(q "SELECT nguyen_tac_bo_sung FROM public.ai_form_configs WHERE code='app_campaign_agent_web'")" = '[Khuyến nghị] x' ] && ok "giữ nguyên tắc bổ sung admin đã lưu" || fail "mất nguyên tắc"
[ "$(q "SELECT updated_at > '$BEFORE'::timestamptz FROM public.ai_form_configs WHERE code='app_campaign_agent_web'")" = t ] && ok "trigger validate đặt lại updated_at" || fail "updated_at"
[ "$(q "SET ROLE aka_agent_desktop; SELECT count(*) FROM public.ai_form_configs WHERE desktop_section_id IS NOT NULL")" = 12 ] && ok "Desktop vẫn chỉ thấy 12 dòng" || fail "Desktop thấy dòng Agent Web"
if as_pg "${PSQL[@]}" -f "$M" >/dev/null 2>"$WORK/rerun.err"; then fail "chạy lại không bị từ chối"; fi
grep -q "không chạy lại" "$WORK/rerun.err" && ok "chạy lại bị từ chối" || fail "lỗi chạy lại không đúng"

as_pg "${PSQL[@]}" -f "$R" >/dev/null && ok "rollback chạy được"
[ "$(q "SELECT md5(prompt_system) FROM public.ai_form_configs WHERE code='app_campaign_agent_web'")" = "$OLD" ] && ok "rollback về đúng prompt V479" || fail "rollback prompt"
if as_pg "${PSQL[@]}" -f "$R" >/dev/null 2>"$WORK/rb.err"; then fail "rollback lần 2 không bị từ chối"; fi
grep -q "không chạy lại" "$WORK/rb.err" && ok "rollback lần 2 bị từ chối, dữ liệu không đổi" || fail "lỗi rollback lần 2"

# Guard: dòng AI từng phần bị đổi (ví dụ prompt dùng chung Desktop) thì V480 không chạy.
q "UPDATE public.ai_form_configs SET prompt_system='P5 sửa' WHERE code='app_campaign_content'" >/dev/null
if as_pg "${PSQL[@]}" -f "$M" >/dev/null 2>"$WORK/rows.err"; then fail "dòng cũ đổi vẫn chạy"; fi
grep -q "đã thay đổi ngoài prompt" "$WORK/rows.err" && ok "guard 12 dòng khác" || fail "guard dòng"
[ "$(q "SELECT md5(prompt_system) FROM public.ai_form_configs WHERE code='app_campaign_agent_web'")" = "$OLD" ] && ok "guard thất bại không đổi gì" || fail "guard để lại thay đổi"
echo "PASS $pass"
