BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
SELECT jsonb_build_object(
'prompts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.ai_prompt p WHERE p.id IN (SELECT prompt_id FROM public.ai_using WHERE code='app_campaign_diagnostics')),
'usings',(SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM public.ai_using u WHERE u.code='app_campaign_diagnostics'),
'prompt_references',(SELECT jsonb_agg(jsonb_build_object('id',u.id,'code',u.code,'prompt_id',u.prompt_id) ORDER BY u.id) FROM public.ai_using u WHERE u.prompt_id IN (SELECT prompt_id FROM public.ai_using WHERE code='app_campaign_diagnostics')),
'models',(SELECT jsonb_agg(jsonb_build_object('id',m.id,'model',m.model,'checksum',md5(to_jsonb(m)::text)) ORDER BY m.id) FROM public.ai_model m WHERE m.id IN (SELECT model_id FROM public.ai_using WHERE code='app_campaign_diagnostics')),
'other_prompts_md5',(SELECT md5(coalesce(string_agg(to_jsonb(p)::text,'|' ORDER BY p.id),'')) FROM public.ai_prompt p WHERE p.id NOT IN (SELECT prompt_id FROM public.ai_using WHERE code='app_campaign_diagnostics')),
'other_usings_md5',(SELECT md5(coalesce(string_agg(to_jsonb(u)::text,'|' ORDER BY u.id),'')) FROM public.ai_using u WHERE code<>'app_campaign_diagnostics'),
'all_models_md5',(SELECT md5(coalesce(string_agg(to_jsonb(m)::text,'|' ORDER BY m.id),'')) FROM public.ai_model m),
'latest_migrations',(SELECT jsonb_agg(to_jsonb(h)) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5) h),
'latest_number',(SELECT max((regexp_match(name,'^migration_v([0-9]+)_'))[1]::integer) FROM supabase_migrations.schema_migrations)
) AS snapshot; COMMIT;