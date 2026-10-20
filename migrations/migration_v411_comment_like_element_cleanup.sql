-- Data-only cleanup after V410. Keep combined 1787 and shared parent/newsfeed elements.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
-- Briefly exclude concurrent definition edits while checking named consumers.
LOCK TABLE public.auto_blocks,public.auto_workflows,public.auto_error IN SHARE MODE;
SELECT id FROM public.auto_elements WHERE id IN(1132,1456,1492,1691,1696,1787) ORDER BY id FOR UPDATE;
DO $cleanup$
DECLARE deleted_count integer;
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v411_%') THEN RAISE EXCEPTION 'v411 already applied'; END IF;
IF EXISTS(SELECT 1 FROM pg_constraint WHERE confrelid='public.auto_elements'::regclass) THEN RAISE EXCEPTION 'v411 new element foreign key'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1132) IS DISTINCT FROM 'e274d9f4982763b4a54007f19778e2f3' THEN RAISE EXCEPTION 'v411 element 1132 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1456) IS DISTINCT FROM '3a97187ea0d3f6aadb3e5da97a94a987' THEN RAISE EXCEPTION 'v411 element 1456 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1492) IS DISTINCT FROM 'aa376e04f9aa123c5e598f931f3cd470' THEN RAISE EXCEPTION 'v411 element 1492 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1691) IS DISTINCT FROM '3f136fa78a2aa28aef2b5b9f5a27ee40' THEN RAISE EXCEPTION 'v411 element 1691 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1696) IS DISTINCT FROM 'd5a66517e4be69e1c19e9bab7e5d1e70' THEN RAISE EXCEPTION 'v411 element 1696 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1787) IS DISTINCT FROM '72ff45af0569c1eec317e7cc5573f079' THEN RAISE EXCEPTION 'v411 element 1787 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2074) IS DISTINCT FROM '50c7e3a57648395147bb9f8c563f82b0' THEN RAISE EXCEPTION 'v411 block 2074 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2603) IS DISTINCT FROM '302bcbb892e113663243331d8c64bfbf' THEN RAISE EXCEPTION 'v411 block 2603 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2615) IS DISTINCT FROM '5f9a1686aaabfc341955ed54d492c01c' THEN RAISE EXCEPTION 'v411 block 2615 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2705) IS DISTINCT FROM 'a99e35f1fe4fa7ce9fec4baad18174f3' THEN RAISE EXCEPTION 'v411 block 2705 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2708) IS DISTINCT FROM '97387bbdeadd6e0df79cb058ebaf2a84' THEN RAISE EXCEPTION 'v411 block 2708 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2719) IS DISTINCT FROM 'd3559be4b544825b099e082f6ee39ea6' THEN RAISE EXCEPTION 'v411 block 2719 drift'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_blocks t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v411 element still used by auto_blocks'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_workflows t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v411 element still used by auto_workflows'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_error t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v411 element still used by auto_error'; END IF;
DELETE FROM public.auto_elements WHERE id IN(1132,1456) AND is_builtin IS TRUE;
GET DIAGNOSTICS deleted_count = ROW_COUNT;
IF deleted_count <> 2 THEN RAISE EXCEPTION 'v411 unexpected deleted count %',deleted_count; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1492) IS DISTINCT FROM 'aa376e04f9aa123c5e598f931f3cd470' THEN RAISE EXCEPTION 'v411 retained element 1492 changed'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1691) IS DISTINCT FROM '3f136fa78a2aa28aef2b5b9f5a27ee40' THEN RAISE EXCEPTION 'v411 retained element 1691 changed'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1696) IS DISTINCT FROM 'd5a66517e4be69e1c19e9bab7e5d1e70' THEN RAISE EXCEPTION 'v411 retained element 1696 changed'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1787) IS DISTINCT FROM '72ff45af0569c1eec317e7cc5573f079' THEN RAISE EXCEPTION 'v411 retained element 1787 changed'; END IF;
END $cleanup$;
COMMIT;
