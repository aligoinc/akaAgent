-- Run this before a V410 rollback; the old Like block needs element 1456.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
DO $restore$
BEGIN
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE id=1132 OR name='fb_like_button') THEN RAISE EXCEPTION 'v411 rollback element 1132 already exists'; END IF;
INSERT INTO public.auto_elements OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.auto_elements,'{"category":"facebook","created_at":"2026-04-29T08:29:26.476645+00:00","description":"Nút Thích bài viết đầu tiên trong page (skip nếu đã Like → query không match)","id":1132,"is_builtin":true,"name":"fb_like_button","organization_id":1,"staff_id":1,"updated_at":"2026-04-29T09:27:38.81+00:00","xpath":"//*[@role=''article''][1]//*[@role=''button'' and (@aria-label=''Thích'' or @aria-label=''Like'')]"}'::jsonb);
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1132) IS DISTINCT FROM 'e274d9f4982763b4a54007f19778e2f3' THEN RAISE EXCEPTION 'v411 rollback element 1132 mismatch'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE id=1456 OR name='fb_like_button_at_n') THEN RAISE EXCEPTION 'v411 rollback element 1456 already exists'; END IF;
INSERT INTO public.auto_elements OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.auto_elements,'{"category":"facebook","created_at":"2026-04-29T09:36:36.285814+00:00","description":"Nút Thích trong bài viết thứ N của feed (template ${n}=position). Skip nếu đã Like → query không match.","id":1456,"is_builtin":true,"name":"fb_like_button_at_n","organization_id":1,"staff_id":1,"updated_at":"2026-04-29T09:36:35.184+00:00","xpath":"(//*[@role=''article''])[${n}]//*[@role=''button'' and (@aria-label=''Thích'' or @aria-label=''Like'')]"}'::jsonb);
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1456) IS DISTINCT FROM '3a97187ea0d3f6aadb3e5da97a94a987' THEN RAISE EXCEPTION 'v411 rollback element 1456 mismatch'; END IF;
END $restore$;
COMMIT;
