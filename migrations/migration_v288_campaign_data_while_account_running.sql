-- v288: campaign data preparation is independent of account runtime status.
-- Built from exact live akachat definitions captured 2026-09-20. Preserve tenant,
-- subtype/active/deleted checks, locks, idempotency and each campaign/source guard.
-- Core bodies retain v219 behavior; credentialed wrappers retain v224 routing.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $migration$
DECLARE
  specs constant jsonb := $specs$[
  {
    "signature": "public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)",
    "source_checksum": "49005ecea81255f4a3bebd747513e6ef",
    "target_checksum": "0f22d3c6fe532176af0e3f38fd485f88",
    "status_count": 2,
    "volatility": "v",
    "acl": "{postgres=X/postgres,service_role=X/postgres}",
    "source_config": [
      "search_path=public"
    ],
    "target_config": [
      "search_path=public",
      "statement_timeout=60s"
    ],
    "header": " SET search_path TO 'public'\n"
  },
  {
    "signature": "public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)",
    "source_checksum": "d3b0ec9f53d3b41102dd7b69ec3b2a3b",
    "target_checksum": "0b6ca7aaa203ea4991f9b31b5f10bd9b",
    "status_count": 2,
    "volatility": "v",
    "acl": "{postgres=X/postgres,service_role=X/postgres}",
    "source_config": [
      "search_path=pg_catalog, public"
    ],
    "target_config": [
      "search_path=pg_catalog, public",
      "statement_timeout=60s"
    ],
    "header": " SET search_path TO 'pg_catalog', 'public'\n"
  },
  {
    "signature": "public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint)",
    "source_checksum": "abc77805588d2b86c8f7dc41e9d6fafc",
    "target_checksum": "38713235dc164457501da0997f7edf2f",
    "status_count": 1,
    "volatility": "s",
    "acl": "{postgres=X/postgres,service_role=X/postgres}",
    "source_config": [
      "search_path=pg_catalog, public"
    ],
    "target_config": [
      "search_path=pg_catalog, public",
      "statement_timeout=60s"
    ],
    "header": " SET search_path TO 'pg_catalog', 'public'\n"
  },
  {
    "signature": "public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)",
    "source_checksum": "fb36874ee305eddfc56b775a798ffe48",
    "target_checksum": "967d28f6e9df5472bfefeffa6746ffb7",
    "status_count": 0,
    "volatility": "v",
    "acl": "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
    "source_config": [
      "search_path=pg_catalog, public"
    ],
    "target_config": [
      "search_path=pg_catalog, public",
      "statement_timeout=60s"
    ],
    "header": " SET search_path TO 'pg_catalog', 'public'\n"
  },
  {
    "signature": "public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)",
    "source_checksum": "ae62b6c0b3064ad37da3d9b5411bae25",
    "target_checksum": "3ff057a65e4e976720ac23070489bb82",
    "status_count": 1,
    "volatility": "v",
    "acl": "{postgres=X/postgres,service_role=X/postgres}",
    "source_config": [
      "search_path=pg_catalog, public"
    ],
    "target_config": [
      "search_path=pg_catalog, public",
      "statement_timeout=60s"
    ],
    "header": " SET search_path TO 'pg_catalog', 'public'\n"
  },
  {
    "signature": "public.append_control_campaign_inputs(bigint,bigint,bigint,text,integer,jsonb)",
    "source_checksum": "39d62e473f8d85452901cf2fe9f2c483",
    "target_checksum": "b4d9f9e05f917bd3793fd5fdc1ca27a2",
    "status_count": 2,
    "volatility": "v",
    "acl": "{postgres=X/postgres,service_role=X/postgres}",
    "source_config": [
      "search_path=public"
    ],
    "target_config": [
      "search_path=public",
      "statement_timeout=60s"
    ],
    "header": " SET search_path TO 'public'\n"
  }
]$specs$::jsonb;
  r record;
  f oid;
  definition text;
  checksum text;
  target_definition text;
  matched_count integer;
BEGIN
  -- Preflight every signature and attribute before altering the first function.
  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(
    signature text, source_checksum text, target_checksum text, status_count integer,
    volatility text, acl text, source_config jsonb, target_config jsonb, header text)
  LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL THEN RAISE EXCEPTION 'v288_missing_function:%',r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source_checksum,r.target_checksum) THEN
      RAISE EXCEPTION 'v288_unexpected_definition:%:%',r.signature,checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=f
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND p.provolatile::text=r.volatility AND p.proacl::text=r.acl
      AND to_jsonb(p.proconfig)=CASE WHEN checksum=r.source_checksum THEN r.source_config ELSE r.target_config END) THEN
      RAISE EXCEPTION 'v288_unexpected_attributes:%',r.signature;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(
    signature text, source_checksum text, target_checksum text, status_count integer,
    volatility text, acl text, source_config jsonb, target_config jsonb, header text)
  LOOP
    f := to_regprocedure(r.signature);
    definition := pg_get_functiondef(f);
    IF md5(definition)=r.source_checksum THEN
      SELECT count(*) INTO matched_count FROM regexp_matches(definition,
        E'\n[ \t]+AND account\\.status IN \\(''chờ xử lý'', ''tạm dừng''\\)', 'g');
      IF matched_count<>r.status_count THEN
        RAISE EXCEPTION 'v288_status_pattern_count:%:%',r.signature,matched_count;
      END IF;
      target_definition := regexp_replace(definition,
        E'\n[ \t]+AND account\\.status IN \\(''chờ xử lý'', ''tạm dừng''\\)', '', 'g');
      -- Data API bulk/aggregate entrypoints keep a local 60s budget. Existing
      -- bind/reactivate credentialed wrappers already have it and are unchanged.
      target_definition := replace(target_definition,r.header,r.header || E' SET statement_timeout TO ''60s''\n');
      IF md5(target_definition) IS DISTINCT FROM r.target_checksum THEN
        RAISE EXCEPTION 'v288_target_checksum_mismatch:%:%',r.signature,md5(target_definition);
      END IF;
      EXECUTE target_definition;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_to_recordset(specs) AS x(
    signature text, source_checksum text, target_checksum text, status_count integer,
    volatility text, acl text, source_config jsonb, target_config jsonb, header text)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature)
      AND md5(pg_get_functiondef(p.oid))=r.target_checksum
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND p.provolatile::text=r.volatility AND p.proacl::text=r.acl
      AND to_jsonb(p.proconfig)=r.target_config) THEN
      RAISE EXCEPTION 'v288_postflight_failed:%',r.signature;
    END IF;
  END LOOP;
END;
$migration$;

-- No explicit schema reload: preserve the existing DDL event-trigger mechanism.
COMMIT;
