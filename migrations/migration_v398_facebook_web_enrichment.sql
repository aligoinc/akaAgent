-- akachat cgjbsmqtfhqvttudyjzq. Additive settings and auxiliary v2 workflow only.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))) IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN
   RAISE EXCEPTION 'v398 identity source drift'; END IF;
 IF to_regprocedure('public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)') IS NOT NULL
   OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auto_accounts' AND column_name LIKE 'facebook_web_enrichment%')
   OR EXISTS(SELECT 1 FROM public.auto_workflows WHERE name='fb_web_enrichment')
   OR EXISTS(SELECT 1 FROM public.auto_blocks WHERE name='fb_web_enrichment_browse')
   OR EXISTS(SELECT 1 FROM public.auto_elements WHERE name LIKE 'fb_web_enrichment%') THEN
   RAISE EXCEPTION 'v398 objects already exist; refusing to overwrite'; END IF;
END $preflight$;

ALTER TABLE public.auto_accounts ADD COLUMN facebook_web_enrichment_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN facebook_web_enrichment_config jsonb;
COMMENT ON COLUMN public.auto_accounts.facebook_web_enrichment_config IS 'Versioned optional web-browsing settings only; no runtime progress, claims or history.';

CREATE FUNCTION public.aka_agent_facebook_web_enrichment_settings(
 p_staff_id bigint,p_organization_id bigint,p_auth_username text,p_auth_password text,
 p_account_id bigint,p_operation text,p_input jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public' SET statement_timeout='15s' AS $function$
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
END $function$;
ALTER FUNCTION public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb) TO anon,authenticated,service_role;

INSERT INTO public.auto_elements(name,xpath,category,description,is_builtin) VALUES
 ('fb_web_enrichment_result',$xpath$//div[@id='search']//a[.//h3 and @href and not(ancestor::*[@data-text-ad]) ]$xpath$,'facebook','Kết quả Google thông thường có tiêu đề; không mở quảng cáo.',true),
 ('fb_web_enrichment_captcha',$xpath$//form[contains(@action,'sorry')] | //iframe[contains(@src,'recaptcha')] | //*[@id='captcha-form']$xpath$,'facebook','CAPTCHA: ngừng tìm Google trong phiên, không giải CAPTCHA.',true);

INSERT INTO public.auto_blocks(name,description,icon,category,kind,code,is_builtin) VALUES
('fb_web_enrichment_browse','Tác vụ phụ: Google 30–60 giây, mỗi website 3–5 phút. Không AI, không tìm trang con.','Globe','facebook','js',$browse$
const config = vars.webConfig;
const selectors = vars.webSelectors;
const remaining = () => Math.max(0, Number(vars.webUntil) - Date.now());
const random = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const sleep = ms => helpers.sleep(Math.min(ms, remaining()), signal);
function bag(values) {
  let pool = [], last = '';
  return failed => {
    pool = pool.filter(v => !failed.has(v));
    if (!pool.length) {
      pool = values.filter(v => !failed.has(v));
      for (let i = pool.length - 1; i > 0; i--) { const j = random(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      if (pool.length > 1 && pool[pool.length - 1] === last) [pool[0], pool[pool.length - 1]] = [pool[pool.length - 1], pool[0]];
    }
    return last = pool.pop() || '';
  };
}
const website = bag(config.websites), keyword = bag(config.keywords), hobby = bag(config.hobbies);
const failedWeb = new Set(), failedSearch = new Set();
let searchEnabled = true, nextSearch = true, lastPage = '', lastQuery = '';
async function read(ms) {
  const until = Math.min(Date.now() + ms, Number(vars.webUntil));
  while (!signal.aborted && Date.now() < until) {
    await helpers.sleep(Math.min(random(8000, 18000), until - Date.now()), signal);
    if (signal.aborted || Date.now() >= until) break;
    await page.evaluate('window.scrollBy({top:__args[0],behavior:"smooth"});', random(220, 650));
  }
}
async function results() {
  return page.evaluate(`
    const selectors = __args[0];
    const first = xpath => document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (location.pathname.startsWith('/sorry') || first(selectors.fb_web_enrichment_captcha)) return {captcha:true,links:[]};
    const nodes = document.evaluate(selectors.fb_web_enrichment_result, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const links=[];
    for(let i=0;i<nodes.snapshotLength;i++) {
      try {
        let url=new URL(nodes.snapshotItem(i).href);
        if(url.pathname==='/url' && /(^|\\.)google\\./i.test(url.hostname)) url=new URL(url.searchParams.get('q')||url.searchParams.get('url'));
        if(['http:','https:'].includes(url.protocol) && !url.username && !url.password && !/(^|\\.)(google\\.[a-z.]+|googleadservices\\.com|doubleclick\\.net)$/i.test(url.hostname)) links.push(url.href);
      } catch {}
    }
    return {captcha:false,links:[...new Set(links)]};
  `, selectors);
}
while (!signal.aborted && remaining() > 0) {
  const availableKeywords = [...config.keywords,...config.hobbies].some(x => !failedSearch.has(x));
  const canSearch = searchEnabled && availableKeywords;
  const canDirect = config.websites.some(x => !failedWeb.has(x));
  if (!canSearch && !canDirect) break;
  const searching = canSearch && (nextSearch || !canDirect);
  nextSearch = !searching;
  let item = '';
  try {
    if (searching) {
      const excluded = new Set(failedSearch);
      if ([...config.keywords,...config.hobbies].filter(x => !failedSearch.has(x)).length > 1) excluded.add(lastQuery);
      item = (config.hobbies.length && Math.random() < 0.2 ? hobby(excluded) : keyword(excluded)) || keyword(excluded) || hobby(excluded);
      lastQuery = item;
      await page.navigate('https://www.google.com/search?q=' + encodeURIComponent(item));
      let found = await results();
      if (found.captcha) { searchEnabled = false; continue; }
      await read(random(30000,60000));
      if (signal.aborted || remaining() <= 0) break;
      found = await results();
      if (found.captcha) { searchEnabled = false; continue; }
      const links = found.links.filter(url => !failedWeb.has(url) && url !== lastPage);
      if (!links.length) { failedSearch.add(item); continue; }
      item = links[random(0,links.length-1)];
    } else {
      item = website(failedWeb);
      if (item === lastPage && config.websites.filter(x => !failedWeb.has(x)).length > 1) item = website(failedWeb);
    }
    if (!item) break;
    lastPage = item;
    await page.navigate(item);
    if (!signal.aborted && remaining() > 0) await read(random(180000,300000));
  } catch {
    if (signal.aborted) break;
    if (/^https?:\/\//i.test(item)) failedWeb.add(item); else failedSearch.add(item);
  }
}
return {ok:true};
$browse$,true);

INSERT INTO public.auto_workflows(name,description,is_builtin,nodes,edges,default_variables)
SELECT 'fb_web_enrichment','Làm giàu lịch sử Web, chạy phụ persist:false; không claim/token/lịch sử.',true,
 jsonb_build_array(jsonb_build_object('id','browse','blockId',id,'blockName',name,'position',jsonb_build_object('x',80,'y',100),'config','{}'::jsonb)),
 '[]'::jsonb,'{}'::jsonb FROM public.auto_blocks WHERE name='fb_web_enrichment_browse';
-- New columns and new RPC are API metadata, so a single schema reload is intentional.
NOTIFY pgrst,'reload schema';
COMMIT;
