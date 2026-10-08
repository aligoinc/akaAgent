-- v355: Restore the missing Messenger waiting-request-limit check in block 38.
-- Source: linked akachat (cgjbsmqtfhqvttudyjzq), captured 2026-10-08.
-- Only block code/updated_at change. Existing policy, workflow, selectors and
-- content preparation stay unchanged. Data-only: no schema reload or new RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $message_limit$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_code text;
  v_count integer;
  v_old_wait text := $old_wait$  await page.waitForSelector(box, { timeout: 15000 })$old_wait$;
  v_new_wait text := $new_wait$  try {
    await page.waitForSelector(box, { timeout: 15000 })
  } catch (textboxError) {
    // C# SendMessage_Fb checks LimitMessageSpan when the composer is absent.
    // Keep the exact policy XPath and raw FindElements semantics.
    const waitingMessageLimit = !signal.aborted && await page.evaluate(`
      return document.evaluate(__args[0], document, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength > 0;
    `, '//span//span[contains(.,"Bạn đã đạt giới hạn về số tin nhắn đang chờ")]').catch(() => false)
    if (waitingMessageLimit) {
      const limitError = new Error('Bạn đã đạt giới hạn về số tin nhắn đang chờ')
      limitError.code = 'err_limit_waiting_message'
      throw limitError
    }
    throw textboxError
  }$new_wait$;
  v_old_catch text := $old_catch$} catch (e) {
  return { ok: false, error: e.message }
}$old_catch$;
  v_new_catch text := $new_catch$} catch (e) {
  // Let the existing scheduler policy stop this run and disable the action.
  if (e && e.code === 'err_limit_waiting_message') throw e
  return { ok: false, error: e.message }
}$new_catch$;
BEGIN
  SELECT to_jsonb(b) INTO v_before
  FROM public.auto_blocks b WHERE b.id = 38 AND b.name = 'fb_send_message' FOR UPDATE;
  IF v_before IS NULL
    OR md5(v_before::text) IS DISTINCT FROM '56dfd1f6942ea2a552792edda3fb1ec3'
    OR md5(v_before->>'code') IS DISTINCT FROM '3a7f999972550721bf67b25744363b9f' THEN
    RAISE EXCEPTION 'v355 preflight: live block 38 changed; recapture before applying';
  END IF;
  IF (SELECT md5(to_jsonb(p)::text) FROM public.auto_error p
      WHERE p.error_code = 'err_limit_waiting_message') IS DISTINCT FROM '6962d5198d9884f148a8affa8f168dfa' THEN
    RAISE EXCEPTION 'v355 preflight: waiting-message policy changed; review before applying';
  END IF;

  v_code := v_before->>'code';
  IF (length(v_code) - length(replace(v_code, v_old_wait, ''))) / length(v_old_wait) <> 1
    OR (length(v_code) - length(replace(v_code, v_old_catch, ''))) / length(v_old_catch) <> 1 THEN
    RAISE EXCEPTION 'v355 preflight: expected exactly one wait and outer catch anchor';
  END IF;
  v_code := replace(replace(v_code, v_old_wait, v_new_wait), v_old_catch, v_new_catch);
  IF md5(v_code) IS DISTINCT FROM 'fb11e928304d044f50f3a11a93821463' THEN
    RAISE EXCEPTION 'v355 target code checksum mismatch';
  END IF;

  UPDATE public.auto_blocks SET code = v_code, updated_at = now()
  WHERE id = 38 AND name = 'fb_send_message';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'v355 update count mismatch'; END IF;

  SELECT to_jsonb(b) INTO v_after FROM public.auto_blocks b WHERE b.id = 38;
  IF md5(v_after->>'code') IS DISTINCT FROM 'fb11e928304d044f50f3a11a93821463'
    OR (v_after - 'code' - 'updated_at') IS DISTINCT FROM (v_before - 'code' - 'updated_at') THEN
    RAISE EXCEPTION 'v355 postflight: unexpected block changes';
  END IF;
END $message_limit$;

COMMIT;
