-- Manual rollback for V455; never run automatically or as part of deployment.
-- Restores the original descendant selector and BOTH callers together.
-- Reverts Reel support. Stop affected campaigns and obtain an explicit rollback
-- instruction first; restart the app afterwards to invalidate the element cache.
-- Refuses unknown code/metadata; already-restored rows retain updated_at.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $share_xpath_rollback_v455$
DECLARE
  desired_xpath text := $xpath$//*[@role="button" and (@aria-label="Chia sẻ" or @aria-label="Share" or .="Chia sẻ" or .="Share" or .//*[@data-ad-rendering-role="share_button"])]$xpath$;
  element_row jsonb;
  current_row jsonb;
  next_row jsonb;
  block_changes jsonb := '[]'::jsonb;
  change jsonb;
  patch record;
  checksum text;
BEGIN
  IF (SELECT count(*) FROM public.auto_elements WHERE name = 'fb_share_button_inner') <> 1 THEN
    RAISE EXCEPTION 'rollback v455: missing or duplicate fb_share_button_inner';
  END IF;
  SELECT to_jsonb(e) INTO element_row
  FROM public.auto_elements e WHERE name = 'fb_share_button_inner' FOR UPDATE;
  checksum := md5((element_row - 'id' - 'created_at' - 'updated_at')::text);
  IF checksum IS NULL OR checksum NOT IN (
    '13e644b099750357a1c10a8a018eaccc', -- exact full XPath
    'ee75d5359998173752e8bb4bab2217f5' -- original descendant selector, already restored
  ) THEN
    RAISE EXCEPTION 'rollback v455: fb_share_button_inner drift';
  END IF;
  next_row := element_row || jsonb_build_object('xpath', desired_xpath);
  IF md5((next_row - 'id' - 'created_at' - 'updated_at')::text) <> 'ee75d5359998173752e8bb4bab2217f5' THEN
    RAISE EXCEPTION 'rollback v455: unexpected element target';
  END IF;

  FOR patch IN
    SELECT * FROM (VALUES
      ('fb_share_post',
       'ca7051b37dba1702a01acf50ccd8a2ec', 'f8abbc22b492ba249ee72b319776ff52',
       $new_share$// Element 257 contains the complete XPath, including the global Reel branch.
const shareInner = await helpers.element('fb_share_button_inner')
const shareBtnSel = shareInner$new_share$,
       $old_share$// Build share button selector: append descendant pattern sau mỗi container path
const shareInner = await helpers.element('fb_share_button_inner')
const shareBtnSel = containerSel.split('|').map(c => c.trim() + shareInner).join(' | ')$old_share$),
      ('fb_select_native_share_group',
       '5a062a2bc91691fcb4567725f4eee3be', '787791026f5b949d84e8f6a66291a740',
       $new_native$const shareXPath = await helpers.element('fb_share_button_inner');$new_native$,
       $old_native$const shareXPath = scoped("//*[@role='dialog']", await helpers.element('fb_share_button_inner'));$old_native$)
    ) AS changes(name, before_checksum, after_checksum, old_code, new_code)
    ORDER BY name
  LOOP
    IF (SELECT count(*) FROM public.auto_blocks WHERE name = patch.name) <> 1 THEN
      RAISE EXCEPTION 'rollback v455: missing or duplicate block %', patch.name;
    END IF;
    SELECT to_jsonb(b) INTO current_row
    FROM public.auto_blocks b WHERE b.name = patch.name FOR UPDATE;
    checksum := md5((current_row - 'id' - 'created_at' - 'updated_at')::text);
    IF checksum IS NULL OR checksum NOT IN (patch.before_checksum, patch.after_checksum) THEN
      RAISE EXCEPTION 'rollback v455: block drift: %', patch.name;
    END IF;
    next_row := current_row;
    IF checksum = patch.before_checksum THEN
      next_row := current_row || jsonb_build_object(
        'code', replace(current_row->>'code', patch.old_code, patch.new_code));
    END IF;
    IF md5((next_row - 'id' - 'created_at' - 'updated_at')::text) <> patch.after_checksum THEN
      RAISE EXCEPTION 'rollback v455: unexpected block target: %', patch.name;
    END IF;
    block_changes := block_changes || jsonb_build_array(jsonb_build_object(
      'id', current_row->'id', 'name', patch.name,
      'code', next_row->>'code', 'checksum', patch.after_checksum,
      'changed', current_row->>'code' IS DISTINCT FROM next_row->>'code'));
  END LOOP;

  IF element_row->>'xpath' IS DISTINCT FROM desired_xpath THEN
    UPDATE public.auto_elements
    SET xpath = desired_xpath, updated_at = clock_timestamp()
    WHERE id = (element_row->>'id')::bigint;
  END IF;
  FOR change IN SELECT value FROM jsonb_array_elements(block_changes)
  LOOP
    IF (change->>'changed')::boolean THEN
      UPDATE public.auto_blocks
      SET code = change->>'code', updated_at = clock_timestamp()
      WHERE id = (change->>'id')::bigint;
    END IF;
  END LOOP;

  SELECT to_jsonb(e) INTO current_row FROM public.auto_elements e WHERE id = (element_row->>'id')::bigint;
  IF md5((current_row - 'id' - 'created_at' - 'updated_at')::text) IS DISTINCT FROM 'ee75d5359998173752e8bb4bab2217f5' THEN
    RAISE EXCEPTION 'rollback v455: element post-check failed';
  END IF;
  FOR change IN SELECT value FROM jsonb_array_elements(block_changes)
  LOOP
    SELECT to_jsonb(b) INTO current_row FROM public.auto_blocks b WHERE id = (change->>'id')::bigint;
    IF md5((current_row - 'id' - 'created_at' - 'updated_at')::text) IS DISTINCT FROM change->>'checksum' THEN
      RAISE EXCEPTION 'rollback v455: block post-check failed: %', change->>'name';
    END IF;
  END LOOP;
END $share_xpath_rollback_v455$;
COMMIT;
