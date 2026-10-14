CREATE OR REPLACE FUNCTION public.aka_agent_facebook_web_enrichment_settings(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_account_id bigint, p_operation text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE a public.auto_accounts%ROWTYPE; cfg jsonb; rev integer; enabled boolean;
 key text; item jsonb; items jsonb; text_value text; authority text; url_path text; urls jsonb:='[]';
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_operation IS NULL OR p_operation NOT IN ('get','save') THEN RAISE EXCEPTION 'web_enrichment_operation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'web_enrichment_identity'; END IF;
 IF p_operation='save' THEN PERFORM 1 FROM public.org_staff WHERE id=p_staff_id FOR SHARE; END IF;
 SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id
   AND organization_id=p_organization_id AND flatform_type='facebook' AND NOT is_delete;
 IF NOT FOUND THEN RAISE EXCEPTION 'web_enrichment_account'; END IF;
 IF p_operation='save' THEN
   SELECT * INTO a FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id
     AND organization_id=p_organization_id AND flatform_type='facebook' AND NOT is_delete FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'web_enrichment_account'; END IF;
 END IF;
 cfg:=a.facebook_web_enrichment_config; rev:=coalesce((cfg->>'revision')::integer,0);
 enabled:=a.facebook_web_enrichment_enabled;
 -- Reading and disabling remain available to the owning staff after entitlement expiry.
 IF p_operation='save' THEN
   IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'web_enrichment_enabled'; END IF;
   enabled:=(p_input->>'enabled')::boolean; cfg:=p_input->'config';
   IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR cfg->>'version' IS DISTINCT FROM '1'
     OR jsonb_typeof(cfg->'revision') IS DISTINCT FROM 'number' OR cfg->>'revision' !~ '^[0-9]+$'
     OR (cfg->>'revision')::numeric IS DISTINCT FROM rev THEN RAISE EXCEPTION 'web_enrichment_conflict'; END IF;
   IF rev=2147483647 OR octet_length(cfg::text)>100000 THEN RAISE EXCEPTION 'web_enrichment_size'; END IF;
   IF jsonb_typeof(cfg->'industry') IS DISTINCT FROM 'string' OR length(cfg->>'industry')>8000 THEN RAISE EXCEPTION 'web_enrichment_industry'; END IF;
   FOREACH key IN ARRAY ARRAY['keywords','websites','hobbies','slots'] LOOP
     items:=cfg->key;
     IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'web_enrichment_list'; END IF;
     IF jsonb_array_length(items)>(CASE key WHEN 'keywords' THEN 200 WHEN 'websites' THEN 5 WHEN 'hobbies' THEN 100 ELSE 48 END)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')>2048) THEN RAISE EXCEPTION 'web_enrichment_list'; END IF;
     SELECT coalesce(jsonb_agg(v ORDER BY n),'[]') INTO items FROM (
       SELECT DISTINCT ON (CASE WHEN key='websites' THEN btrim(x#>>'{}') ELSE lower(btrim(x#>>'{}')) END) btrim(x#>>'{}') v,n FROM jsonb_array_elements(items) WITH ORDINALITY t(x,n)
       WHERE btrim(x#>>'{}')<>'' ORDER BY CASE WHEN key='websites' THEN btrim(x#>>'{}') ELSE lower(btrim(x#>>'{}')) END,n) q;
     cfg:=jsonb_set(cfg,ARRAY[key],items);
   END LOOP;
   IF enabled THEN
     IF NOT EXISTS(SELECT 1 FROM public.org_organization_product WHERE organization_id=p_organization_id AND NOT is_deleted
       AND product_id IN (3,10) AND expiration_date>=date_trunc('day',timezone('Asia/Ho_Chi_Minh',clock_timestamp())) AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN
       RAISE EXCEPTION 'web_enrichment_feature'; END IF;
     IF btrim(cfg->>'industry')='' OR jsonb_array_length(cfg->'keywords')<5 OR jsonb_array_length(cfg->'websites')<>5
       OR jsonb_array_length(cfg->'slots')<1 THEN RAISE EXCEPTION 'web_enrichment_required'; END IF;
     IF jsonb_typeof(cfg->'minutesPerSession') IS DISTINCT FROM 'number' OR cfg->>'minutesPerSession' !~ '^[0-9]+$'
       OR (cfg->>'minutesPerSession')::numeric NOT BETWEEN 5 AND 240 OR (cfg->>'minutesPerSession')::numeric%5<>0 THEN RAISE EXCEPTION 'web_enrichment_minutes'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(cfg->'slots') x WHERE x !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RAISE EXCEPTION 'web_enrichment_slots'; END IF;
     IF cfg->>'stopDate' IS NOT NULL AND (cfg->>'stopDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (cfg->>'stopDate')::date::text<>cfg->>'stopDate') THEN RAISE EXCEPTION 'web_enrichment_date'; END IF;
     FOR text_value IN SELECT jsonb_array_elements_text(cfg->'websites') LOOP
       IF text_value !~* '^[a-z][a-z0-9+.-]*:' OR text_value ~* '^[a-z0-9.-]+:[0-9]+([/?#]|$)' THEN text_value:='https://'||text_value; END IF;
       IF text_value !~* '^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$' THEN RAISE EXCEPTION 'web_enrichment_url'; END IF;
       authority:=lower(substring(text_value FROM '(?i)^https?://([^/?#]+)'));
       IF authority !~ '^([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(:[0-9]{1,5})?$'
         OR (authority ~ ':[0-9]+$' AND substring(authority FROM ':([0-9]+)$')::integer NOT BETWEEN 1 AND 65535) THEN RAISE EXCEPTION 'web_enrichment_url'; END IF;
       url_path:=regexp_replace(text_value,'(?i)^https?://[^/?#]+',''); url_path:=split_part(url_path,'#',1);
       IF url_path='' OR left(url_path,1)='?' THEN url_path:='/'||url_path; END IF;
       text_value:=lower(split_part(text_value,'://',1))||'://'||authority||url_path;
       IF urls ? text_value THEN RAISE EXCEPTION 'web_enrichment_duplicate_url'; END IF;
       urls:=urls||jsonb_build_array(text_value);
     END LOOP;
     cfg:=jsonb_set(cfg,'{websites}',urls);
   END IF;
   cfg:=jsonb_build_object('version',1,'revision',rev+1,'industry',btrim(cfg->>'industry'),
     'keywords',cfg->'keywords','websites',cfg->'websites','hobbies',cfg->'hobbies',
     'minutesPerSession',CASE WHEN jsonb_typeof(cfg->'minutesPerSession')='number' THEN cfg->'minutesPerSession' ELSE '30'::jsonb END,
     'slots',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') FROM jsonb_array_elements_text(cfg->'slots') x),'stopDate',cfg->'stopDate');
   UPDATE public.auto_accounts SET facebook_web_enrichment_enabled=enabled,facebook_web_enrichment_config=cfg,updated_at=clock_timestamp() WHERE id=p_account_id;
 END IF;
 RETURN jsonb_build_object('enabled',enabled,'config',cfg);
END $function$
;
