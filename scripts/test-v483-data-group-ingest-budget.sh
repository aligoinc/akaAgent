#!/usr/bin/env bash
# Thử V483 (chặn sớm lần nạp nhóm data chắc chắn quá 60 giây) trên PostgreSQL 16 cục bộ, không chạm production.
# Fixture dựng lại 2 wrapper Desktop của aka_agent_ingest_data_group đúng nguyên văn production (md5 thân d3ba6d79…,
# 9a75506b…, cùng SET/ACL), hàm xác thực và hàm nạp lõi 12/13 tham số là stub ghi lại lần gọi.
# Dùng: bash scripts/test-v483-data-group-ingest-budget.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v483_data_group_ingest_budget_guard.sql"
ROLLBACK="$ROOT/migrations/rollback_v483_data_group_ingest_budget_guard.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v483.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK" && chmod 755 "$WORK" && cp "$MIGRATION" "$ROLLBACK" "$WORK/" && chown postgres "$WORK"/*.sql
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt)
q() { as_pg "${PSQL[@]}" -c "$1"; }
run_file() { as_pg "${PSQL[@]}" -f "$1"; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
M="$WORK/$(basename "$MIGRATION")"; R="$WORK/$(basename "$ROLLBACK")"
[ "$(id -u)" = 0 ] || { M="$MIGRATION"; R="$ROLLBACK"; }

as_pg "${PSQL[@]}" <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
CREATE TABLE public.auto_campaign_data_group_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, campaign_id bigint NOT NULL UNIQUE, group_id bigint NOT NULL,
  status text NOT NULL, staff_id bigint NOT NULL, organization_id bigint NOT NULL
);
CREATE INDEX idx_auto_campaign_data_group_sources_group_intake ON public.auto_campaign_data_group_sources (group_id, status, campaign_id)
  WHERE status = ANY (ARRAY['baselining'::text, 'active'::text]);
-- Nhóm 1770: 630 chiến dịch bật nhận data (+15 đã ngừng); nhóm 2000: 3 chiến dịch; nhóm 3000: không có.
INSERT INTO public.auto_campaign_data_group_sources (campaign_id, group_id, status, staff_id, organization_id)
SELECT i, 1770, CASE WHEN i <= 630 THEN 'active' ELSE 'stopped' END, 724, 701 FROM generate_series(1, 645) AS i;
INSERT INTO public.auto_campaign_data_group_sources (campaign_id, group_id, status, staff_id, organization_id)
SELECT 10000 + i, 2000, 'active', 724, 701 FROM generate_series(1, 3) AS i;

CREATE TABLE public.v483_calls (id serial, arity int, request_id text, kind text, row_count int);
CREATE FUNCTION public.auto_assert_automation_identity(p_staff_id bigint, p_organization_id bigint, p_username text, p_password text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF p_password IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'automation_identity_invalid'; END IF;
END $$;
CREATE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint DEFAULT NULL::bigint, p_dataset_name text DEFAULT NULL::text, p_import_source text DEFAULT NULL::text, p_source_account_id bigint DEFAULT NULL::bigint, p_source_name text DEFAULT NULL::text, p_payload_hash text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  INSERT INTO public.v483_calls (arity, request_id, kind, row_count) VALUES (12, p_request_id, p_kind, jsonb_array_length(p_rows));
  RETURN jsonb_build_object('request_id', p_request_id, 'inserted_membership_count', jsonb_array_length(p_rows));
END $$;
CREATE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint, p_dataset_name text, p_import_source text, p_source_account_id bigint, p_source_name text, p_payload_hash text, p_data_type_category_item_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
  INSERT INTO public.v483_calls (arity, request_id, kind, row_count) VALUES (13, p_request_id, p_kind, jsonb_array_length(p_rows));
  RETURN jsonb_build_object('request_id', p_request_id, 'inserted_membership_count', jsonb_array_length(p_rows));
END $$;

-- Hai wrapper Desktop đúng nguyên văn production trước V483.
CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint, p_dataset_name text, p_import_source text, p_source_account_id bigint, p_source_name text, p_payload_hash text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT * FROM public.aka_agent_ingest_data_group(p_staff_id, p_organization_id, p_request_id, p_group_id, p_kind, p_rows, p_dataset_id, p_dataset_name, p_import_source, p_source_account_id, p_source_name, p_payload_hash);
$function$;
CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint, p_dataset_name text, p_import_source text, p_source_account_id bigint, p_source_name text, p_payload_hash text, p_data_type_category_item_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT public.aka_agent_ingest_data_group(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_group_id,
    p_kind,
    p_rows,
    p_dataset_id,
    p_dataset_name,
    p_import_source,
    p_source_account_id,
    p_source_name,
    p_payload_hash,
    p_data_type_category_item_id
  );
$function$;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO aka_agent_desktop', f);
  END LOOP;
END $$;

-- Gọi wrapper 15 tham số kiểu PostgREST (tham số theo tên); ghi lại SQLSTATE/message/detail.
CREATE TABLE public.v483_outcomes (label text PRIMARY KEY, state text, message text, detail text);
CREATE FUNCTION public.v483_try(p_label text, p_group bigint, p_kind text, p_rows int, p_password text DEFAULT 'ok', p_org bigint DEFAULT 701, p_legacy boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_rows jsonb; v_state text; v_message text; v_detail text;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('uid', i::text)) INTO v_rows FROM generate_series(1, p_rows) AS i;
  BEGIN
    IF p_legacy THEN
      PERFORM public.aka_agent_ingest_data_group(p_staff_id => 724, p_organization_id => p_org, p_request_id => p_label, p_group_id => p_group,
        p_kind => p_kind, p_rows => v_rows, p_dataset_id => NULL::bigint, p_dataset_name => NULL::text, p_import_source => NULL::text,
        p_source_account_id => NULL::bigint, p_source_name => NULL::text, p_payload_hash => NULL::text,
        p_auth_username => 'staff', p_auth_password => p_password);
    ELSE
      PERFORM public.aka_agent_ingest_data_group(p_staff_id => 724, p_organization_id => p_org, p_request_id => p_label, p_group_id => p_group,
        p_kind => p_kind, p_rows => v_rows, p_dataset_id => NULL::bigint, p_dataset_name => NULL::text, p_import_source => NULL::text,
        p_source_account_id => NULL::bigint, p_source_name => NULL::text, p_payload_hash => NULL::text,
        p_data_type_category_item_id => 39, p_auth_username => 'staff', p_auth_password => p_password);
    END IF;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
  END;
  INSERT INTO public.v483_outcomes VALUES (p_label, v_state, v_message, v_detail)
  ON CONFLICT (label) DO UPDATE SET state = EXCLUDED.state, message = EXCLUDED.message, detail = EXCLUDED.detail;
END $$;
SQL

src_md5() { q "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text$1)'::regprocedure"; }
[ "$(src_md5 ',text,text')" = d3ba6d794b51ef41a6af705920cab7af ] && [ "$(src_md5 ',bigint,text,text')" = 9a75506b8a5a2ddc197052bfc725cb7f ] \
  || fail "fixture wrappers differ from production snapshot"
ok "fixture wrappers byte-identical to production (md5 d3ba6d79…, 9a75506b…)"

run_file "$M" >/dev/null
[ "$(src_md5 ',text,text')" = f324434527d755f005a9f2f3744643d0 ] && [ "$(src_md5 ',bigint,text,text')" = 901b27e30590aa0f522bcf8b6a805bb7 ] \
  || fail "wrappers md5 after apply"
ok "migration applies, wrappers carry the guard (md5 f3244345…, 901b27e3…)"

[ "$(q "SELECT string_agg(proacl::text, '|' ORDER BY pronargs) FROM pg_proc WHERE proname = 'aka_agent_ingest_data_group' AND pronargs IN (14, 15)")" \
  = '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}|{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' ] \
  || fail "wrapper ACL changed"
ok "wrapper ACL unchanged"

[ "$(q "SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role','aka_agent_desktop','aka_agent_chat_api']) r
        WHERE has_function_privilege(r, 'private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)', 'EXECUTE')")" = 0 ] \
  || fail "guard executable by API roles"
ok "guard function not executable by anon/authenticated/service_role/desktop/chat roles"

q "SELECT public.v483_try('t-630', 1770, 'scan', 45)" >/dev/null
[ "$(q "SELECT state FROM v483_outcomes WHERE label = 't-630'")" = PT413 ] || fail "45 rows × 630 campaigns not rejected"
[ "$(q "SELECT (detail::jsonb->>'maxRows') || '/' || (detail::jsonb->>'rowMs') || '/' || (detail::jsonb->>'receivingCampaigns') || '/' || (detail::jsonb->>'rows') FROM v483_outcomes WHERE label = 't-630'")" = '14/3158/630/45' ] \
  || fail "guard detail for 630 campaigns"
q "SELECT message FROM v483_outcomes WHERE label = 't-630'" | grep -q 'đang cấp data cho 630 chiến dịch' || fail "guard message"
[ "$(q "SELECT count(*) FROM v483_calls WHERE request_id = 't-630'")" = 0 ] || fail "core ingest ran despite rejection"
ok "45 rows into a group feeding 630 campaigns: PT413 instantly (maxRows 14, rowMs 3158), core ingest not called"

q "SELECT public.v483_try('t-3', 2000, 'scan', 45)" >/dev/null
[ "$(q "SELECT state FROM v483_outcomes WHERE label = 't-3'")" = ok ] || fail "small fan-out rejected"
[ "$(q "SELECT arity || ':' || row_count FROM v483_calls WHERE request_id = 't-3'")" = '13:45' ] || fail "15-arg wrapper did not reach 13-arg core"
ok "45 rows into a group feeding 3 campaigns passes to the 13-arg core"

q "SELECT public.v483_try('t-up-9000', 3000, 'upload', 9000)" >/dev/null
q "SELECT public.v483_try('t-up-10000', 3000, 'upload', 10000)" >/dev/null
[ "$(q "SELECT state FROM v483_outcomes WHERE label = 't-up-9000'")" = ok ] || fail "9000-row upload (72 s estimate) rejected"
[ "$(q "SELECT state FROM v483_outcomes WHERE label = 't-up-10000'")" = PT413 ] || fail "10000-row upload (80 s estimate) not rejected"
q "SELECT message FROM v483_outcomes WHERE label = 't-up-10000'" | grep -q 'tách thành nhiều file' || fail "upload message"
ok "upload: 9000 rows pass, 10000 rows rejected with the file-split message"

q "SELECT public.v483_try('t-auth', 1770, 'scan', 45, 'wrong')" >/dev/null
q "SELECT message FROM v483_outcomes WHERE label = 't-auth'" | grep -q automation_identity_invalid || fail "identity not checked first"
ok "identity is still checked before the guard"

q "SELECT public.v483_try('t-legacy', 1770, 'scan', 45, p_legacy => true)" >/dev/null
[ "$(q "SELECT state FROM v483_outcomes WHERE label = 't-legacy'")" = PT413 ] || fail "14-arg wrapper not guarded"
q "SELECT public.v483_try('t-legacy-ok', 2000, 'manual', 10, p_legacy => true)" >/dev/null
[ "$(q "SELECT arity || ':' || row_count FROM v483_calls WHERE request_id = 't-legacy-ok'")" = '12:10' ] || fail "14-arg wrapper did not reach 12-arg core"
ok "legacy 14-arg wrapper guarded and still reaches the 12-arg core"

q "SELECT public.v483_try('t-other-org', 1770, 'scan', 45, p_org => 999)" >/dev/null
[ "$(q "SELECT state FROM v483_outcomes WHERE label = 't-other-org'")" = ok ] || fail "other organization saw foreign campaign counts"
ok "another organization's group id counts 0 campaigns (no cross-tenant numbers)"

if run_file "$M" >/dev/null 2>"$WORK/rerun.err"; then fail "migration re-run accepted"; fi
grep -q 'already applied' "$WORK/rerun.err" || fail "re-run refused for the wrong reason"
ok "re-running the migration is refused"

run_file "$R" >/dev/null
[ "$(src_md5 ',text,text')" = d3ba6d794b51ef41a6af705920cab7af ] && [ "$(src_md5 ',bigint,text,text')" = 9a75506b8a5a2ddc197052bfc725cb7f ] \
  || fail "rollback md5"
[ -z "$(q "SELECT to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)')")" ] || fail "guard not dropped"
q "SELECT public.v483_try('t-after-rollback', 1770, 'scan', 45)" >/dev/null
[ "$(q "SELECT state FROM v483_outcomes WHERE label = 't-after-rollback'")" = ok ] || fail "rollback still guarded"
ok "rollback restores the exact production bodies and drops the guard"

if run_file "$R" >/dev/null 2>"$WORK/rerun-rollback.err"; then fail "rollback re-run accepted"; fi
ok "rollback re-run is refused"

run_file "$M" >/dev/null
[ "$(src_md5 ',bigint,text,text')" = 901b27e30590aa0f522bcf8b6a805bb7 ] || fail "re-apply after rollback"
ok "migration re-applies cleanly after rollback"

echo "V483: $pass/$pass passed"
