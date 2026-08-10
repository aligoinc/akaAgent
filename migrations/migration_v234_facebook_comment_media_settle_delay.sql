-- Give Facebook more time to finish processing an attached comment image or
-- video before the comment is submitted. PageController.dropFile() only
-- confirms that the synthetic drop events were dispatched; it does not prove
-- that Facebook has finished rendering/uploading the attachment.

BEGIN;

DO $migration$
DECLARE
  v_block_name text;
  v_old text;
  v_new text;
  v_code text;
  v_old_position integer;
  v_new_position integer;
BEGIN
  FOREACH v_block_name IN ARRAY ARRAY[
    'fb_comment_at_position',
    'fb_comment_current_post'
  ]
  LOOP
    IF v_block_name = 'fb_comment_at_position' THEN
      v_old :=
        '    const dropResult = await page.dropFile(inputXpath, images)' || E'\n' ||
        '    imageCount = Number(dropResult.fileCount || 0)' || E'\n' ||
        '    await helpers.sleep(3000, signal)';
      v_new :=
        '    const dropResult = await page.dropFile(inputXpath, images)' || E'\n' ||
        '    imageCount = Number(dropResult.fileCount || 0)' || E'\n' ||
        '    await helpers.sleep(10000, signal)';
    ELSE
      v_old :=
        '  const dropResult = await page.dropFile(inputXpath, images)' || E'\n' ||
        '  imageCount = Number(dropResult.fileCount || 0)' || E'\n' ||
        '  await helpers.sleep(3000, signal)';
      v_new :=
        '  const dropResult = await page.dropFile(inputXpath, images)' || E'\n' ||
        '  imageCount = Number(dropResult.fileCount || 0)' || E'\n' ||
        '  await helpers.sleep(10000, signal)';
    END IF;

    SELECT block.code
    INTO v_code
    FROM public.auto_blocks AS block
    WHERE block.name = v_block_name
      AND block.is_builtin = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Built-in block % was not found', v_block_name;
    END IF;

    v_old_position := strpos(v_code, v_old);
    v_new_position := strpos(v_code, v_new);

    IF v_new_position > 0 THEN
      IF v_old_position > 0 OR strpos(
        substr(v_code, v_new_position + length(v_new)),
        v_new
      ) > 0 THEN
        RAISE EXCEPTION 'Comment media settle delay is ambiguous in block %', v_block_name;
      END IF;
      CONTINUE;
    END IF;

    IF v_old_position = 0 THEN
      RAISE EXCEPTION 'Expected comment media settle delay was not found in block %', v_block_name;
    END IF;

    IF strpos(
      substr(v_code, v_old_position + length(v_old)),
      v_old
    ) > 0 THEN
      RAISE EXCEPTION 'Expected comment media settle delay is not unique in block %', v_block_name;
    END IF;

    UPDATE public.auto_blocks AS block
    SET
      code = replace(block.code, v_old, v_new),
      updated_at = now()
    WHERE block.name = v_block_name
      AND block.is_builtin = true;

    SELECT block.code
    INTO v_code
    FROM public.auto_blocks AS block
    WHERE block.name = v_block_name
      AND block.is_builtin = true;

    IF strpos(v_code, v_new) = 0 OR strpos(v_code, v_old) > 0 THEN
      RAISE EXCEPTION 'Failed to verify comment media settle delay in block %', v_block_name;
    END IF;
  END LOOP;
END;
$migration$;

COMMIT;
