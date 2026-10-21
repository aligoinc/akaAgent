-- Rollback candidate only; production execution is NOT authorized.
-- Update the application first / close affected forms. No data tables are modified.
BEGIN;
DO $guard$ BEGIN
 IF to_regprocedure('private.column_filter_predicate_v1(text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_predicate_v1(text,jsonb)'))) IS DISTINCT FROM '069845e69f67531eddb64e543cf57b4f' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_predicate_v1(text,jsonb)'; END IF;
 IF to_regprocedure('private.column_filter_text_v1(text[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_text_v1(text[])'))) IS DISTINCT FROM 'da410fa01ffdc9d221e490c59c5a1c5d' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_text_v1(text[])'; END IF;
 IF to_regprocedure('private.column_filter_phone_v1(text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_phone_v1(text)'))) IS DISTINCT FROM '2e1679fd24b99b00fde04c91906ebad8' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_phone_v1(text)'; END IF;
 IF to_regprocedure('private.column_filter_tag_values_v1(jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_tag_values_v1(jsonb)'))) IS DISTINCT FROM 'a230119462fc49ccd8d9711e16ad80e2' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_tag_values_v1(jsonb)'; END IF;
 IF to_regprocedure('private.column_filter_zalo_tags_v1(jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_zalo_tags_v1(jsonb)'))) IS DISTINCT FROM '7e495fbaac600fd0b6b0bbd22f8d535a' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_zalo_tags_v1(jsonb)'; END IF;
 IF to_regprocedure('private.column_filter_uri_decode_v1(text,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_uri_decode_v1(text,boolean)'))) IS DISTINCT FROM '4b3ad151607986717af93716dcc7a390' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_uri_decode_v1(text,boolean)'; END IF;
 IF to_regprocedure('private.column_filter_uri_encode_v1(text,boolean)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_uri_encode_v1(text,boolean)'))) IS DISTINCT FROM '2d19cc24cd1005755a2855124a3d2214' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_uri_encode_v1(text,boolean)'; END IF;
 IF to_regprocedure('private.column_filter_fb_url_v1(text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_fb_url_v1(text,text)'))) IS DISTINCT FROM '2663f1372e16552e0433daafa6854aaa' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_fb_url_v1(text,text)'; END IF;
 IF to_regprocedure('private.column_filter_source_match_v1(jsonb,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('private.column_filter_source_match_v1(jsonb,jsonb)'))) IS DISTINCT FROM 'c96fc3e0f9ec082876fe89275fe435a7' THEN RAISE EXCEPTION 'V421 rollback target drift: private.column_filter_source_match_v1(jsonb,jsonb)'; END IF;
 IF to_regprocedure('public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)'))) IS DISTINCT FROM '17ffadd05bb48b245a4382789c6d59ea' THEN RAISE EXCEPTION 'V421 rollback target drift: public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)'; END IF;
 IF to_regprocedure('public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)'))) IS DISTINCT FROM '788154e11ff9c302ed14cabd866fa1da' THEN RAISE EXCEPTION 'V421 rollback target drift: public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)'; END IF;
 IF to_regprocedure('public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)'))) IS DISTINCT FROM '6f5c7a310643cf7d63782974ffcdc933' THEN RAISE EXCEPTION 'V421 rollback target drift: public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)'; END IF;
END $guard$;
DROP FUNCTION public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb);
DROP FUNCTION public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb);
DROP FUNCTION public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb);
DROP FUNCTION private.column_filter_source_match_v1(jsonb,jsonb);
DROP FUNCTION private.column_filter_fb_url_v1(text,text);
DROP FUNCTION private.column_filter_uri_encode_v1(text,boolean);
DROP FUNCTION private.column_filter_uri_decode_v1(text,boolean);
DROP FUNCTION private.column_filter_zalo_tags_v1(jsonb);
DROP FUNCTION private.column_filter_tag_values_v1(jsonb);
DROP FUNCTION private.column_filter_phone_v1(text);
DROP FUNCTION private.column_filter_text_v1(text[]);
DROP FUNCTION private.column_filter_predicate_v1(text,jsonb);
COMMIT;
