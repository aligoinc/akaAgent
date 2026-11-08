#!/usr/bin/env bash
# Thử V478 (ai_form_configs.nguyen_tac_bo_sung) trên PostgreSQL 16 cục bộ, không chạm production.
# Fixture dựng lại cấu trúc ai_form_configs như akachat (20 cột, ràng buộc, trigger validate, quyền Desktop cấp bảng, RLS),
# chạy migration với md5 bản chụp thay bằng md5 của fixture, kiểm kết quả, chạy lại bị từ chối, rồi thử hai mức rollback.
# Dùng: bash scripts/test-v478-nguyen-tac-bo-sung.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v478_ai_form_configs_nguyen_tac_bo_sung.sql"
ROLLBACK="$ROOT/migrations/rollback_v478_ai_form_configs_nguyen_tac_bo_sung.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v478.XXXXXX")
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
CREATE TABLE public.ai_model (id bigint PRIMARY KEY, organization_id bigint);
INSERT INTO public.ai_model VALUES (21, NULL), (24, NULL);
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
SQL
ok "fixture 12 dòng ai_form_configs"

FP=$(q "SELECT md5(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id)) FROM public.ai_form_configs c")
sed "s/b4370e771a565a4f74073344affcb94d/$FP/g" "$MIGRATION" > "$WORK/v478.sql"
chmod a+r "$WORK/v478.sql"
UPDATED_BEFORE=$(q "SELECT string_agg(updated_at::text, ',' ORDER BY id) FROM public.ai_form_configs")

as_pg "${PSQL[@]}" -f "$WORK/v478.sql" >/dev/null && ok "migration chạy được trên fixture"
[ "$(q "SELECT count(*) FROM public.ai_form_configs WHERE nguyen_tac_bo_sung IS NULL")" = 12 ] && ok "cả 12 dòng NULL" || fail "dòng không NULL"
[ "$(q "SELECT string_agg(updated_at::text, ',' ORDER BY id) FROM public.ai_form_configs")" = "$UPDATED_BEFORE" ] && ok "updated_at giữ nguyên" || fail "updated_at đổi"
[ "$(q "SELECT col_description('public.ai_form_configs'::regclass, attnum) LIKE 'Nguyên tắc bổ sung (V478)%' FROM pg_attribute WHERE attrelid='public.ai_form_configs'::regclass AND attname='nguyen_tac_bo_sung'")" = t ] && ok "có COMMENT" || fail "thiếu COMMENT"

if as_pg "${PSQL[@]}" -f "$WORK/v478.sql" >/dev/null 2>"$WORK/rerun.err"; then fail "chạy lại không bị từ chối"; fi
grep -q "v478: already applied" "$WORK/rerun.err" && ok "chạy lại bị từ chối" || fail "lỗi chạy lại không đúng"

[ "$(q "SET ROLE aka_agent_desktop; SELECT count(*) FROM (SELECT * FROM public.ai_form_configs) s")" = 12 ] && ok "Desktop select(*) vẫn chạy" || fail "Desktop select(*)"
if q "SET ROLE aka_agent_desktop; UPDATE public.ai_form_configs SET nguyen_tac_bo_sung='x' WHERE id=1" >/dev/null 2>&1; then fail "Desktop ghi được cột mới"; fi
ok "Desktop không ghi được cột mới"

RULE='[Bắt buộc] Khi chiến dịch nhắn người lạ: mỗi ảnh là một tin.'
OLD=$(q "SELECT updated_at::text FROM public.ai_form_configs WHERE id=1")
sleep 0.05
[ "$(q "SET ROLE service_role; UPDATE public.ai_form_configs SET nguyen_tac_bo_sung='$RULE' WHERE code='app_campaign_action_limits' AND updated_at='$OLD' RETURNING 1")" = 1 ] && ok "lưu có so updated_at" || fail "lưu"
NEW=$(q "SELECT updated_at::text FROM public.ai_form_configs WHERE id=1")
[ "$NEW" != "$OLD" ] && ok "trigger đặt lại updated_at khi lưu" || fail "updated_at không đổi"
[ -z "$(q "SET ROLE service_role; UPDATE public.ai_form_configs SET nguyen_tac_bo_sung='y' WHERE code='app_campaign_action_limits' AND updated_at='$OLD' RETURNING 1")" ] && ok "lưu bằng updated_at cũ không ghi đè" || fail "ghi đè khi xung đột"
if q "SET ROLE service_role; UPDATE public.ai_form_configs SET nguyen_tac_bo_sung=repeat('a', 8001) WHERE id=2" >/dev/null 2>&1; then fail "vượt 8000 ký tự vẫn lưu"; fi
ok "CHECK chặn quá 8000 ký tự"
[ "$(q "SET ROLE service_role; UPDATE public.ai_form_configs SET nguyen_tac_bo_sung=repeat('ạ', 8000) WHERE id=2 RETURNING char_length(nguyen_tac_bo_sung)")" = 8000 ] && ok "8000 ký tự tiếng Việt lưu được" || fail "8000 ký tự"

as_pg "${PSQL[@]}" -f "$ROLLBACK" >/dev/null && [ "$(q "SELECT count(nguyen_tac_bo_sung) FROM public.ai_form_configs")" = 0 ] && ok "rollback mức 1 xoá nội dung" || fail "rollback mức 1"
sed -n 's/^-- \(BEGIN;\|SET LOCAL lock_timeout\|ALTER TABLE public.ai_form_configs DROP COLUMN\|COMMIT;\)/\1/p' "$ROLLBACK" > "$WORK/drop.sql"
chmod a+r "$WORK/drop.sql"
as_pg "${PSQL[@]}" -f "$WORK/drop.sql" >/dev/null
[ "$(q "SELECT count(*) FROM pg_attribute WHERE attrelid='public.ai_form_configs'::regclass AND attname='nguyen_tac_bo_sung' AND NOT attisdropped")" = 0 ] && ok "rollback mức 2 bỏ cột" || fail "rollback mức 2"
[ "$(q "SET ROLE aka_agent_desktop; SELECT count(*) FROM (SELECT * FROM public.ai_form_configs) s")" = 12 ] && ok "Desktop select(*) chạy sau khi bỏ cột" || fail "Desktop sau rollback"
echo "V478: $pass/$pass đạt"
