-- Facebook may insert an intermediate Next/Tiếp step in the shared timeline/group
-- composer. Treat that step as optional and preserve the existing Post/Đăng flow.

BEGIN;

DO $migration$
DECLARE
  v_block_count integer;
  v_element_count integer;
  v_current_code text;
  v_expected_old_md5 constant text := 'd6bcde9ac293c07570ce18057c96065c';
  v_new_code constant text := $block$
let nextClicked = false
try {
  const nextSelector = await helpers.element('FbComposerNextButton')
  const nextButton = await page.$(nextSelector)
  if (nextButton) {
    await page.click(nextSelector)
    nextClicked = true
  }
} catch {}

if (nextClicked) await helpers.sleep(2000, signal)

const btn = await helpers.element('fb_post_button')
await page.waitForSelector(btn, { timeout: 10000 })
await page.click(btn)
await helpers.sleep(3000, signal)
return { posted: true }
$block$;
BEGIN
  SELECT count(*)
  INTO v_block_count
  FROM public.auto_blocks
  WHERE name = 'fb_click_post_button';

  IF v_block_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one auto_blocks row named fb_click_post_button, found %', v_block_count;
  END IF;

  SELECT count(*)
  INTO v_element_count
  FROM public.auto_elements
  WHERE name = 'FbComposerNextButton';

  IF v_element_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one auto_elements row named FbComposerNextButton, found %', v_element_count;
  END IF;

  SELECT code
  INTO v_current_code
  FROM public.auto_blocks
  WHERE name = 'fb_click_post_button'
  FOR UPDATE;

  IF v_current_code = v_new_code THEN
    RETURN;
  END IF;

  IF md5(v_current_code) <> v_expected_old_md5 THEN
    RAISE EXCEPTION
      'fb_click_post_button changed unexpectedly (expected md5 %, got %)',
      v_expected_old_md5,
      md5(v_current_code);
  END IF;

  UPDATE public.auto_blocks
  SET code = v_new_code,
      updated_at = now()
  WHERE name = 'fb_click_post_button';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update fb_click_post_button';
  END IF;

  SELECT code
  INTO v_current_code
  FROM public.auto_blocks
  WHERE name = 'fb_click_post_button';

  IF v_current_code <> v_new_code THEN
    RAISE EXCEPTION 'Failed to verify fb_click_post_button after update';
  END IF;
END;
$migration$;

COMMIT;
