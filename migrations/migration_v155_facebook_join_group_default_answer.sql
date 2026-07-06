-- Use a fixed default answer for Facebook join-group questions.

BEGIN;

UPDATE public.auto_blocks
SET
  code = replace(
    code,
    $$const variants = helpers.splitVariants(vars.campaignContent || vars.originalCampaignContent || '');
const answerContent = helpers.cycleVariant(variants.length > 0 ? variants : [String(vars.campaignContent || '')], Number(vars.loopIndex || 0));$$,
    $$const answerContent = 'Tôi đồng ý';$$
  ),
  updated_at = now()
WHERE name = 'fb_join_group';

UPDATE public.auto_workflows
SET
  variables_schema = '[
    {"name":"targetUid","type":"string","label":"Group URL/UID"},
    {"name":"targetName","type":"string","label":"Tên group"}
  ]'::jsonb,
  updated_at = now()
WHERE name IN ('facebook_join_group', 'facebook_join_group__test__facebook_join_group');

DO $verify$
DECLARE
  block_code text;
  fixed_schema jsonb := '[
    {"name":"targetUid","type":"string","label":"Group URL/UID"},
    {"name":"targetName","type":"string","label":"Tên group"}
  ]'::jsonb;
BEGIN
  SELECT code
  INTO block_code
  FROM public.auto_blocks
  WHERE name = 'fb_join_group';

  IF block_code IS NULL THEN
    RAISE EXCEPTION 'Cannot update facebook_join_group default answer: missing fb_join_group block';
  END IF;

  IF block_code NOT LIKE '%const answerContent = ''Tôi đồng ý'';%' THEN
    RAISE EXCEPTION 'fb_join_group block must use fixed answerContent';
  END IF;

  IF block_code LIKE '%helpers.splitVariants(vars.campaignContent%'
     OR block_code LIKE '%vars.campaignContent || vars.originalCampaignContent%'
     OR block_code LIKE '%helpers.cycleVariant(variants%' THEN
    RAISE EXCEPTION 'fb_join_group block must ignore campaign content variants';
  END IF;

  IF block_code LIKE '%page.click(%' THEN
    RAISE EXCEPTION 'fb_join_group block must not use page.click because C# DOM mode avoids viewport coordinates';
  END IF;

  IF block_code LIKE '%.filter(isVisible%' OR block_code LIKE '%filter(Boolean).filter%' THEN
    RAISE EXCEPTION 'fb_join_group block must not add visible filters to raw C# FindElements equivalents';
  END IF;

  IF block_code NOT LIKE '%scrollTo(0,0)%' THEN
    RAISE EXCEPTION 'fb_join_group block must preserve C# scrollTo(0,0)';
  END IF;

  IF block_code NOT LIKE '%xpathAll(args.textareaSelector, dialog)%'
     OR block_code NOT LIKE '%xpathAll(args.checkboxSelector, dialog)%'
     OR block_code NOT LIKE '%xpathAll(args.radioSelector, dialog)%'
     OR block_code NOT LIKE '%xpathAll(args.submitSelector, dialog)%' THEN
    RAISE EXCEPTION 'fb_join_group question selectors must stay scoped to the C# dialog root';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_workflows
    WHERE name IN ('facebook_join_group', 'facebook_join_group__test__facebook_join_group')
      AND variables_schema <> fixed_schema
  ) THEN
    RAISE EXCEPTION 'facebook_join_group workflow variables_schema must only include targetUid and targetName';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
