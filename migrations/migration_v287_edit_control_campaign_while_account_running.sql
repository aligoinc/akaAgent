-- v287: saving a campaign must not depend on its account's runtime status.
-- Exact live definitions captured from linked akachat on 2026-09-20.
-- Preserve the September orphan-account repair, config-version retry, row locks,
-- tenant/subtype/active/deleted guards, SMS materialization and append idempotency.
-- The edited campaign itself must still be stopped; scheduler ownership is unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $migration$
DECLARE
  r record;
  f oid;
  definition text;
  checksum text;
  target_definition text;
  matched_count integer;
BEGIN
  -- Validate BOTH entrypoints before altering either one. A concurrent hotfix
  -- must fail closed, including drift in security attributes or local settings.
  FOR r IN SELECT * FROM (VALUES
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '218ccf3eb631a84af633818939177db7', 'f285e48f4deaf2e1bf7896d7aeddbcf8'),
    ('public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '4d824c50515201bc8410d7114bd3a8a7', '3e1e2f8b67697d36b3c8c3830586a6c2')
  ) AS expected(signature, source_checksum, target_checksum)
  LOOP
    f := to_regprocedure(r.signature);
    IF f IS NULL THEN RAISE EXCEPTION 'v287_missing_function:%', r.signature; END IF;
    checksum := md5(pg_get_functiondef(f));
    IF checksum NOT IN (r.source_checksum, r.target_checksum) THEN
      RAISE EXCEPTION 'v287_unexpected_definition:%:%', r.signature, checksum;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=f
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
      AND ((checksum=r.source_checksum AND p.proconfig=ARRAY['search_path=public'])
        OR (checksum=r.target_checksum
          AND p.proconfig=ARRAY['search_path=public','statement_timeout=60s']))) THEN
      RAISE EXCEPTION 'v287_unexpected_attributes:%', r.signature;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '218ccf3eb631a84af633818939177db7', 'f285e48f4deaf2e1bf7896d7aeddbcf8'),
    ('public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '4d824c50515201bc8410d7114bd3a8a7', '3e1e2f8b67697d36b3c8c3830586a6c2')
  ) AS expected(signature, source_checksum, target_checksum)
  LOOP
    f := to_regprocedure(r.signature);
    definition := pg_get_functiondef(f);
    IF md5(definition)=r.source_checksum THEN
      target_definition := definition;
      IF r.signature LIKE 'public.update_control_campaign_atomic(%' THEN
        SELECT count(*) INTO matched_count FROM regexp_matches(definition,
          E'\n[ \t]+AND (account|target_account)\\.status IN \\(''chờ xử lý'', ''tạm dừng''\\)', 'g');
        IF matched_count<>5 THEN RAISE EXCEPTION 'v287_status_pattern_count:%', matched_count; END IF;
        target_definition := regexp_replace(definition,
          E'\n[ \t]+AND (account|target_account)\\.status IN \\(''chờ xử lý'', ''tạm dừng''\\)', '', 'g');
      END IF;
      -- Both update entrypoints can materialize/append many rows: keep the
      -- repository's function-local 60-second bulk RPC budget.
      target_definition := replace(target_definition,
        E' SET search_path TO ''public''\n',
        E' SET search_path TO ''public''\n SET statement_timeout TO ''60s''\n');
      IF md5(target_definition) IS DISTINCT FROM r.target_checksum THEN
        RAISE EXCEPTION 'v287_target_checksum_mismatch:%:%', r.signature, md5(target_definition);
      END IF;
      EXECUTE target_definition;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '218ccf3eb631a84af633818939177db7', 'f285e48f4deaf2e1bf7896d7aeddbcf8'),
    ('public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)', '4d824c50515201bc8410d7114bd3a8a7', '3e1e2f8b67697d36b3c8c3830586a6c2')
  ) AS expected(signature, source_checksum, target_checksum)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature)
      AND md5(pg_get_functiondef(p.oid))=r.target_checksum
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public','statement_timeout=60s']
      AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
      RAISE EXCEPTION 'v287_postflight_failed:%', r.signature;
    END IF;
  END LOOP;
END;
$migration$;

-- No changes to signatures/return types, grants, runtime claim or creation.
-- Existing DDL event triggers handle API cache invalidation; no extra NOTIFY.
COMMIT;
