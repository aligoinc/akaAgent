-- Manual rollback only after all new callers have stopped using these functions.
-- Drops only this additive boundary; never reopens anon or changes RLS.
DO $rollback$
DECLARE r record; f record;
BEGIN
  IF current_setting('aka_agent.cross_repo_http_rollback',true) IS DISTINCT FROM 'approved-after-callers-stopped' THEN
    RAISE EXCEPTION 'cross_repo_http_rollback_requires_stopped_callers';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_chat_aux_settings(text)','3d617a075b57042966d0b532e4e7137a', '["search_path=pg_catalog","statement_timeout=3s"]'::jsonb),
    ('private.akamap_assert_data_group_identity(jsonb)','fa192c26786b71d42ba2ed3917c3dc0f', '["search_path=pg_catalog"]'::jsonb),
    ('public.akamap_data_group_types(jsonb)','3ca461cf05ba92b3fd8f1e6ec30a48b2', '["search_path=pg_catalog","statement_timeout=3s"]'::jsonb),
    ('public.akamap_create_data_group(jsonb)','34db9ee25c12c111d73813d5c7b1c8b5', '["search_path=pg_catalog","statement_timeout=3s"]'::jsonb),
    ('public.akamap_list_data_groups(jsonb)','c8fd0c4b8c4e013b869ff13483a7e4d5', '["search_path=pg_catalog","statement_timeout=60s"]'::jsonb),
    ('public.akamap_list_data_group_datasets(jsonb)','6d3e3aed770aacb2b22923b9aff88ae9', '["search_path=pg_catalog","statement_timeout=60s"]'::jsonb),
    ('public.akamap_ingest_data_group(jsonb)','7edb60e44988e9576d3442157c1498ab', '["search_path=pg_catalog","statement_timeout=60s"]'::jsonb)
  ) AS expected(signature,checksum,config) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner_name,
      p.prosecdef definer,to_jsonb(p.proconfig) config,p.proacl::text acl
    INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature);
    IF NOT FOUND OR f.checksum IS DISTINCT FROM r.checksum OR f.owner_name<>'postgres'
      OR f.definer OR f.config IS DISTINCT FROM r.config
      OR f.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'cross_repo_http_rollback_drift: %',r.signature;
    END IF;
  END LOOP;
END $rollback$;
DROP FUNCTION public.aka_agent_chat_aux_settings(text);
DROP FUNCTION public.akamap_data_group_types(jsonb);
DROP FUNCTION public.akamap_create_data_group(jsonb);
DROP FUNCTION public.akamap_list_data_groups(jsonb);
DROP FUNCTION public.akamap_list_data_group_datasets(jsonb);
DROP FUNCTION public.akamap_ingest_data_group(jsonb);
DROP FUNCTION private.akamap_assert_data_group_identity(jsonb);
NOTIFY pgrst, 'reload schema';
