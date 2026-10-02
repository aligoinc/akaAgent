-- v334: Append one space after pasting a group/feed comment, before Enter.
-- Source: live auto_blocks id=34 on linked cgjbsmqtfhqvttudyjzq, 2026-10-01.
-- Only code/updated_at change. No RPC, schema, selector or connection changes.
-- Shared by real/test facebook_comment_seeding and facebook_group_post.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $comment_space$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_code text;
  v_count integer;
  v_old text := $old$    await page.fill(inputXpath, text)
    await helpers.sleep(1000, signal)$old$;
  v_new text := $new$    await page.fill(inputXpath, text)
    await helpers.sleep(1000, signal)
    // Append a real space after paste so the final word no longer ends at the caret.
    await page.type(inputXpath, ' ')
    await helpers.sleep(500, signal)$new$;
BEGIN
  SELECT to_jsonb(b) INTO v_before
  FROM public.auto_blocks b WHERE b.id = 34 FOR UPDATE;
  IF v_before IS NULL
    OR v_before->>'name' IS DISTINCT FROM 'fb_comment_at_position'
    OR md5(v_before::text) IS DISTINCT FROM '32a8bcfbee49ad93f66a8f03b2eba9a6'
    OR md5(v_before->>'code') IS DISTINCT FROM 'a8e41af1c2ab9f2e7c10bca6e68dcd3f' THEN
    RAISE EXCEPTION 'v334 preflight: live block 34 changed; recapture before applying';
  END IF;

  v_code := v_before->>'code';
  IF (length(v_code) - length(replace(v_code, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'v334 preflight: expected exactly one paste anchor';
  END IF;
  v_code := replace(v_code, v_old, v_new);
  IF md5(v_code) IS DISTINCT FROM 'c7bd3036206f8690e1ffab6f0d0a832c' THEN
    RAISE EXCEPTION 'v334 target code checksum mismatch';
  END IF;

  UPDATE public.auto_blocks SET code = v_code, updated_at = now() WHERE id = 34;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'v334 update count mismatch'; END IF;

  SELECT to_jsonb(b) INTO v_after FROM public.auto_blocks b WHERE b.id = 34;
  IF md5(v_after->>'code') IS DISTINCT FROM 'c7bd3036206f8690e1ffab6f0d0a832c'
    OR (v_after - 'code' - 'updated_at') IS DISTINCT FROM (v_before - 'code' - 'updated_at') THEN
    RAISE EXCEPTION 'v334 postflight: unexpected block changes';
  END IF;
END $comment_space$;

COMMIT;
