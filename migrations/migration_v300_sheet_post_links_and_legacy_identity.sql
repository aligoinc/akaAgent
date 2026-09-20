-- V300: preserve Facebook post identities and legacy phone/email fallback.
-- Body captured from linked production after v299, with metadata/ACL audited.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_sheet_identity(text,jsonb)') IS NULL OR
    md5(pg_get_functiondef('public.aka_agent_sheet_identity(text,jsonb)'::regprocedure)) IS DISTINCT FROM '774d7079692fe25b5fd433c374630d37'
  THEN RAISE EXCEPTION 'v300 Sheet identity RPC drift'; END IF;
  PERFORM 1 FROM public.auto_data_group_sheet_worker_state WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'v300 missing Sheet worker state'; END IF;
  IF EXISTS(SELECT 1 FROM public.auto_data_group_external_sync_seen
    WHERE data_type_code IN ('phone','email','facebook_post_url'))
  THEN RAISE EXCEPTION 'v300 existing Sheet keys require reconciliation'; END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_sheet_identity(p_type text, p_row jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v text; v_id text; v_path text;
BEGIN
  IF p_type='phone' THEN
    -- Same precedence as ingest/campaign extraction: primary field, legacy
    -- extra_data, then UID only for a contact whose identity is a phone/email.
    v:=public.aka_agent_internal_normalize_phone(COALESCE(
      NULLIF(p_row->>'phone',''),NULLIF(p_row->'extra_data'->>'phone',''),
      CASE WHEN p_row->>'contact_type'='phone' THEN p_row->>'uid' END,''));
    RETURN CASE WHEN v ~ '^0[35789][0-9]{8}$' THEN v ELSE NULL END;
  ELSIF p_type='email' THEN
    v:=lower(btrim(COALESCE(NULLIF(p_row->>'email',''),NULLIF(p_row->'extra_data'->>'email',''),
      CASE WHEN p_row->>'contact_type'='email' THEN p_row->>'uid' END,'')));
    RETURN CASE WHEN length(v)<=254 AND v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN v ELSE NULL END;
  ELSIF p_type='facebook_search_keyword' THEN
    RETURN NULLIF(lower(regexp_replace(btrim(COALESCE(p_row->>'uid','')),'[[:space:]]+',' ','g')),'');
  ELSIF p_type='zalo_person' THEN
    v:=btrim(COALESCE(p_row->>'uid','')); RETURN CASE WHEN v ~ '^[0-9]+$' AND length(v)<=100 THEN v ELSE NULL END;
  ELSIF p_type='zalo_group' THEN
    v:=COALESCE(NULLIF(p_row->>'url',''),p_row->>'uid','');
    v_id:=substring(v from '^(?:https?://)?(?:www\.)?(?:zalo\.me/g/|zaloapp\.com/qr/g/)([A-Za-z0-9_-]+)(?:[/?#].*)?$');
    RETURN CASE WHEN v_id IS NOT NULL THEN 'zalo.me/g/'||v_id ELSE NULL END;
  ELSIF p_type IN ('facebook_person','facebook_group','facebook_page','facebook_post_url') THEN
    -- Existing post contacts may carry a numeric UID as well as the post URL.
    -- Sheet rows map the URL, so both sides must choose that same identity.
    IF p_type='facebook_post_url' THEN
      v:=COALESCE(NULLIF(btrim(p_row->>'url'),''),btrim(p_row->>'uid'),'');
    ELSE
      v:=btrim(COALESCE(NULLIF(p_row->>'uid',''),p_row->>'url',''));
    END IF;
    IF v ~ '^[0-9]+$' AND p_type<>'facebook_post_url' THEN RETURN v; END IF;
    IF v !~* '^(https?://)?(www\.|m\.|mbasic\.)?(facebook\.com|fb\.com)/[^[:space:]]+$' THEN RETURN NULL; END IF;
    v:=regexp_replace(v,'^(https?://)?(www\.|m\.|mbasic\.)?(facebook\.com|fb\.com)/','','i');
    v:=split_part(v,'#',1); v_path:=regexp_replace(split_part(v,'?',1),'/$','');
    IF p_type='facebook_group' THEN
      v_id:=substring(v_path from '^groups/([^/]+)'); RETURN lower(v_id);
    ELSIF p_type='facebook_post_url' THEN
      -- Support raw legacy contact URLs as well as the mapper's canonical URL.
      IF v_path ~ '^groups/[^/]+' AND v ~ '[?&]multi_permalinks=' THEN
        v_id:=substring(v from '[?&]multi_permalinks=([A-Za-z0-9_-]+)(?:&|$)');
        RETURN CASE WHEN v_id IS NOT NULL THEN 'post:'||v_id ELSE NULL END;
      END IF;
      IF v_path IN ('watch','watch/live','video.php') THEN
        v_id:=substring(v from '[?&]v=([A-Za-z0-9_-]+)(?:&|$)');
        RETURN CASE WHEN v_id IS NOT NULL THEN 'post:'||v_id ELSE NULL END;
      END IF;
      -- A group landing page has no post identity (including links already
      -- stripped by an older client); never import it as a valid post.
      IF v_path ~ '^groups/[^/]+$' THEN RETURN NULL; END IF;
      -- Opaque pfbid values are case-sensitive; never truncate to a numeric
      -- prefix or collapse every story.php/permalink.php URL to one key.
      v_id:=substring(v from '[?&](?:story_fbid|fbid)=([A-Za-z0-9_-]+)(?:&|$)');
      IF v_id IS NOT NULL THEN RETURN 'post:'||v_id; END IF;
      v_id:=substring(v_path from '(?:^|/)(?:posts|permalink|videos|reel)/([A-Za-z0-9_-]+)(?:/|$)');
      IF v_id IS NOT NULL THEN RETURN 'post:'||v_id; END IF;
      RETURN lower(v_path);
    ELSE
      -- Reuse the campaign canonicalizer for /people/name/UID and /pages/name/UID.
      -- The host was validated and stripped above, including the fb.com alias.
      RETURN NULLIF(public.aka_agent_internal_normalize_facebook_identity('https://www.facebook.com/'||v),'');
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DO $postflight$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.aka_agent_sheet_identity(text,jsonb)'::regprocedure
    AND md5(pg_get_functiondef(oid))='b6e2126aadbf1b9c558dd83e20b7bacd'
    AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='i'
    AND proconfig=ARRAY['search_path=pg_catalog, public']
    AND proacl='{postgres=X/postgres}'::aclitem[])
  THEN RAISE EXCEPTION 'v300 identity definition or privileges mismatch'; END IF;
END;
$postflight$;

-- Body-only replacement; no API metadata change or explicit schema reload.
COMMIT;
