-- Give Business Inbox additional time to render the selected conversation's
-- message composer before the send block checks its input selectors.

BEGIN;

DO $migration$
DECLARE
  v_old text :=
    'const clearSearch = await dom(''clickFirst'', { selector: searchClearXpath }).catch(() => null)'
    || E'\n'
    || 'await helpers.sleep(2000, signal)';
  v_new text :=
    'const clearSearch = await dom(''clickFirst'', { selector: searchClearXpath }).catch(() => null)'
    || E'\n'
    || 'await helpers.sleep(stepMs + 4000, signal)';
  v_code text;
BEGIN
  SELECT block.code
  INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_send_page_inbox_message'
    AND block.is_builtin = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Built-in block fb_send_page_inbox_message was not found';
  END IF;

  IF strpos(v_code, v_new) > 0 THEN
    RETURN;
  END IF;

  IF strpos(v_code, v_old) = 0 THEN
    RAISE EXCEPTION 'Expected page inbox input settle delay was not found';
  END IF;

  IF strpos(
    substr(v_code, strpos(v_code, v_old) + length(v_old)),
    v_old
  ) > 0 THEN
    RAISE EXCEPTION 'Expected page inbox input settle delay is not unique';
  END IF;

  UPDATE public.auto_blocks
  SET
    code = replace(code, v_old, v_new),
    updated_at = now()
  WHERE name = 'fb_send_page_inbox_message'
    AND is_builtin = true;
END;
$migration$;

COMMIT;
