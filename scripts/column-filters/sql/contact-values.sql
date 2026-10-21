CREATE FUNCTION private.column_filter_text_v1(VARIADIC p_values text[]) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT nullif(btrim(value),'') FROM unnest(p_values) WITH ORDINALITY t(value,n) WHERE nullif(btrim(value),'') IS NOT NULL ORDER BY n LIMIT 1
$fn$;
CREATE FUNCTION private.column_filter_phone_v1(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $fn$
DECLARE digits text; mapped text; prefixes constant jsonb:='{"0162":"032","0163":"033","0164":"034","0165":"035","0166":"036","0167":"037","0168":"038","0169":"039","0120":"070","0121":"079","0122":"077","0126":"076","0128":"078","0123":"083","0124":"084","0125":"085","0127":"081","0129":"082","0186":"056","0188":"058","0199":"059"}';
BEGIN
 IF btrim(value) ~* '^[+-]?\d+(\.\d+)?e[+-]?\d+$' AND length(value)<40 THEN BEGIN value:=trunc(value::numeric)::text; EXCEPTION WHEN numeric_value_out_of_range THEN RETURN NULL; END; END IF;
 digits:=regexp_replace(value,'\D','','g');
 IF left(digits,4)='0084' AND length(digits)>=13 THEN digits:='0'||substr(digits,5);
 ELSIF left(digits,2)='84' AND length(digits)>=11 THEN digits:='0'||substr(digits,3); END IF;
 IF length(digits)=9 AND digits ~ '^[35789]' THEN digits:='0'||digits; END IF;
 IF length(digits)=10 THEN mapped:=prefixes->>('0'||left(digits,3)); IF mapped IS NOT NULL THEN digits:=mapped||substr(digits,4); END IF;
 ELSIF length(digits)=11 THEN mapped:=prefixes->>left(digits,4); IF mapped IS NOT NULL THEN digits:=mapped||substr(digits,5); END IF; END IF;
 RETURN CASE WHEN digits ~ '^0[35789]\d{8}$' THEN digits END;
END $fn$;
CREATE FUNCTION private.column_filter_tag_values_v1(value jsonb) RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE item jsonb; result text[]:='{}'; id text;
BEGIN
 IF jsonb_typeof(value)='array' THEN FOR item IN SELECT jsonb_array_elements(value) LOOP result:=result||private.column_filter_tag_values_v1(item); END LOOP; RETURN result;
 ELSIF jsonb_typeof(value)='object' THEN id:=private.column_filter_text_v1(value->>'id',value->>'labelId',value->>'label_id',value->>'tagId',value->>'tag_id');
 ELSE id:=nullif(btrim(value#>>'{}'),''); END IF;
 RETURN CASE WHEN id IS NULL THEN '{}'::text[] ELSE ARRAY[id] END;
END $fn$;
CREATE FUNCTION private.column_filter_zalo_tags_v1(extra jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT ARRAY(SELECT DISTINCT id FROM (
 SELECT unnest(private.column_filter_tag_values_v1(extra->key)) id FROM unnest(ARRAY['zaloTagIds','zalo_tag_ids','labelIds','label_ids','tagIds','tag_ids','zaloTags','zalo_tags','labels','tags']) key
 UNION ALL SELECT unnest(private.column_filter_tag_values_v1(extra->'rawPayload'->key)) FROM unnest(ARRAY['labelIds','label_ids','tagIds','tag_ids','zaloTags','zalo_tags','labels','tags']) key
 ) t WHERE id IS NOT NULL)
$fn$;
-- URL component decoding/encoding preserves the existing Desktop source selectors.
CREATE FUNCTION private.column_filter_uri_decode_v1(value text,form boolean DEFAULT false) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $fn$
DECLARE result bytea:=''::bytea; i integer:=1; ch text;
BEGIN
 WHILE i<=length(value) LOOP
  ch:=substr(value,i,1);
  IF ch='%' THEN
   IF substr(value,i+1,2) !~ '^[0-9a-fA-F]{2}$' THEN RAISE EXCEPTION 'invalid_uri'; END IF;
   result:=result||decode(substr(value,i+1,2),'hex');i:=i+3;
  ELSE result:=result||convert_to(CASE WHEN form AND ch='+' THEN ' ' ELSE ch END,'UTF8');i:=i+1;END IF;
 END LOOP;
 RETURN convert_from(result,'UTF8');
END $fn$;
CREATE FUNCTION private.column_filter_uri_encode_v1(value text,form boolean DEFAULT false) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $fn$
DECLARE result text:=''; bytes bytea:=convert_to(value,'UTF8'); b integer; i integer;
BEGIN
 FOR i IN 0..length(bytes)-1 LOOP
  b:=get_byte(bytes,i);
  IF (b BETWEEN 65 AND 90) OR (b BETWEEN 97 AND 122) OR (b BETWEEN 48 AND 57) OR b IN (45,46,95,42) OR (NOT form AND b IN (33,39,40,41,126)) THEN result:=result||chr(b);
  ELSIF form AND b=32 THEN result:=result||'+';
  ELSE result:=result||'%'||upper(lpad(to_hex(b),2,'0'));END IF;
 END LOOP;
 RETURN result;
END $fn$;
CREATE FUNCTION private.column_filter_fb_url_v1(value text,kind text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE raw text:=btrim(value); url text; host text; protocol text; path text; query text; result text; pair text; key text; val text; parts text[]; i integer; removed boolean:=false;
BEGIN
 IF raw IS NULL OR raw='' THEN RETURN NULL; END IF;
 IF kind='profile' THEN raw:=regexp_replace(raw,'^@+',''); END IF;
 IF kind IN ('profile','group') AND raw !~* '(facebook\.com|fb\.com)' THEN
  result:=raw;
  IF kind='group' THEN
   result:=btrim(raw,'/');parts:=array_remove(string_to_array(result,'/'),'');
   IF lower(parts[1])='groups' AND parts[2] IS NOT NULL THEN result:=parts[2]; END IF;
  END IF;
  RETURN CASE WHEN result ~ '^[a-zA-Z0-9._-]+$' THEN lower('https://www.facebook.com/'||CASE WHEN kind='group' THEN 'groups/' ELSE '' END||result) END;
 END IF;
 url:=CASE WHEN raw ~* '^https?://' THEN raw ELSE 'https://'||raw END;
 protocol:=lower(split_part(url,'://',1));host:=lower(substring(url from '^https?://([^/?#]+)'));
 -- WHATWG URL removes default ports. Nondefault ports matter only for post URLs.
 host:=regexp_replace(host,CASE protocol WHEN 'http' THEN ':80$' ELSE ':443$' END,'');
 IF host ~* '@' THEN host:=regexp_replace(host,'^.*@',''); END IF;
 FOREACH key IN ARRAY CASE WHEN kind='post' THEN ARRAY['www','web','m'] ELSE ARRAY['www','web','m','mobile','mbasic'] END LOOP host:=regexp_replace(host,'^'||key||'\.','','i'); END LOOP;
 IF split_part(host,':',1) NOT IN ('facebook.com','fb.com') THEN RETURN NULL; END IF;
 path:=regexp_replace(url,'^https?://[^/?#]+','','i');path:=split_part(path,'#',1);query:=CASE WHEN strpos(path,'?')>0 THEN substr(path,strpos(path,'?')+1) ELSE '' END;path:=split_part(path,'?',1);
 IF path='' THEN path:='/'; END IF;
 IF kind='group' THEN
  parts:=array_remove(string_to_array(path,'/'),'');result:=NULL;
  FOR i IN 1..COALESCE(cardinality(parts),0) LOOP IF lower(parts[i])='groups' THEN result:=parts[i+1];EXIT;END IF;END LOOP;
  result:=btrim(private.column_filter_uri_decode_v1(result));
  RETURN CASE WHEN result ~ '^[a-zA-Z0-9._-]+$' THEN lower('https://www.facebook.com/groups/'||result) END;
 ELSIF kind='profile' THEN
  IF path='/profile.php' THEN
   FOREACH pair IN ARRAY string_to_array(query,'&') LOOP
    IF private.column_filter_uri_decode_v1(split_part(pair,'=',1),true)='id' THEN
     result:=btrim(private.column_filter_uri_decode_v1(CASE WHEN strpos(pair,'=')>0 THEN substr(pair,strpos(pair,'=')+1) ELSE '' END,true));EXIT;
    END IF;
   END LOOP;
   RETURN CASE WHEN nullif(result,'') IS NOT NULL THEN lower('https://www.facebook.com/profile.php?id='||private.column_filter_uri_encode_v1(result)) END;
  END IF;
  parts:=array_remove(string_to_array(path,'/'),'');
  WHILE lower(parts[cardinality(parts)])='friends' LOOP parts:=parts[1:cardinality(parts)-1];END LOOP;
  IF cardinality(parts)<>1 THEN RETURN NULL;END IF;
  result:=btrim(private.column_filter_uri_decode_v1(parts[1]));
  RETURN CASE WHEN result ~ '^[a-zA-Z0-9._-]+$' THEN lower('https://www.facebook.com/'||result) END;
 END IF;
 result:='';
 FOREACH pair IN ARRAY string_to_array(query,'&') LOOP
  IF pair='' THEN CONTINUE;END IF;
  key:=private.column_filter_uri_decode_v1(split_part(pair,'=',1),true);
  IF key ~ '^(__|mibextid$|ref$|locale$|comment_id$|reply_comment_id$)' THEN removed:=true;CONTINUE;END IF;
  val:=private.column_filter_uri_decode_v1(CASE WHEN strpos(pair,'=')>0 THEN substr(pair,strpos(pair,'=')+1) ELSE '' END,true);
  result:=result||CASE WHEN result='' THEN '' ELSE '&' END||private.column_filter_uri_encode_v1(key,true)||'='||private.column_filter_uri_encode_v1(val,true);
 END LOOP;
 IF removed THEN query:=result;END IF;
 RETURN lower(rtrim(protocol||'://www.facebook.com'||CASE WHEN strpos(host,':')>0 THEN ':'||split_part(host,':',2) ELSE '' END||path||CASE WHEN query='' THEN '' ELSE '?'||query END,'/'));
EXCEPTION WHEN data_exception OR raise_exception THEN RETURN lower(rtrim(raw,'/'));
END $fn$;
CREATE FUNCTION private.column_filter_source_match_v1(extra jsonb,query jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE source text:=nullif(btrim(query->>'source'),''); url text; key text; kind text; found boolean;
BEGIN
 url:=private.column_filter_fb_url_v1(query->>'sourcePostUrl','post');
 IF source IS NOT NULL AND url IS NOT NULL AND jsonb_typeof(extra->'sourcePostRefs')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(extra->'sourcePostRefs') r WHERE nullif(btrim(r->>'source'),'') IS NOT NULL AND nullif(btrim(COALESCE(nullif(r->>'url',''),r->>'sourcePostUrl')),'') IS NOT NULL) THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(extra->'sourcePostRefs') r WHERE btrim(r->>'source')=source AND private.column_filter_fb_url_v1(COALESCE(nullif(r->>'url',''),r->>'sourcePostUrl'),'post')=url) THEN RETURN false; END IF;
 ELSE
  IF source IS NOT NULL AND btrim(extra->>'source') IS DISTINCT FROM source AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(extra->'sources')='array' THEN extra->'sources' ELSE '[]'::jsonb END) v WHERE btrim(v)=source) THEN RETURN false; END IF;
  IF url IS NOT NULL AND private.column_filter_fb_url_v1(extra->>'sourcePostUrl','post') IS DISTINCT FROM url AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(extra->'sourcePostUrls')='array' THEN extra->'sourcePostUrls' ELSE '[]'::jsonb END) v WHERE private.column_filter_fb_url_v1(v,'post')=url) THEN RETURN false; END IF;
 END IF;
 FOREACH kind IN ARRAY ARRAY['profile','group'] LOOP
  key:=CASE kind WHEN 'profile' THEN 'sourceProfileUrl' ELSE 'sourceGroupUrl' END;url:=private.column_filter_fb_url_v1(query->>key,kind);
  IF url IS NOT NULL AND private.column_filter_fb_url_v1(extra->>key,kind) IS DISTINCT FROM url AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(extra->(key||'s'))='array' THEN extra->(key||'s') ELSE '[]'::jsonb END) v WHERE private.column_filter_fb_url_v1(v,kind)=url) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION private.column_filter_text_v1(text[]),private.column_filter_phone_v1(text),private.column_filter_tag_values_v1(jsonb),private.column_filter_zalo_tags_v1(jsonb),private.column_filter_uri_decode_v1(text,boolean),private.column_filter_uri_encode_v1(text,boolean),private.column_filter_fb_url_v1(text,text),private.column_filter_source_match_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
