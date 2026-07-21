DO $migration$
DECLARE
  v_block_count integer;
  v_element_count integer;
  v_code text := $block$
const imgs = Array.isArray(input.images) && input.images.length > 0
  ? input.images
  : (Array.isArray(vars.images) ? vars.images : [])
if (imgs.length === 0) return { fileCount: 0 }
const form = await helpers.element('FbComposerForm')
const result = await page.dropFile(form, imgs)
await helpers.sleep(2000, signal)
return result
$block$;
BEGIN
  SELECT count(*)
  INTO v_block_count
  FROM auto_blocks
  WHERE name = 'fb_drop_post_images';

  IF v_block_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one auto_blocks row named fb_drop_post_images, found %', v_block_count;
  END IF;

  SELECT count(*)
  INTO v_element_count
  FROM auto_elements
  WHERE name = 'FbComposerForm'
    AND xpath = '//*[@role=''dialog'']//form[@method=''POST'']';

  IF v_element_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one FbComposerForm element matching the C# PostForm XPath, found %', v_element_count;
  END IF;

  UPDATE auto_blocks
  SET code = v_code,
      updated_at = now()
  WHERE name = 'fb_drop_post_images'
    AND code IS DISTINCT FROM v_code;
END;
$migration$;
