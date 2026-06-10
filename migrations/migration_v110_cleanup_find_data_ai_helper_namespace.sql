-- Remove the legacy app-level find-data AI helper namespace from built-in blocks.

BEGIN;

UPDATE public.auto_blocks AS block
SET
  code = replace(
    replace(
      replace(
        block.code,
        'helpers.checkFindDataMeaningAI = async (options = {}) => {',
        'const checkMeaningAI = async (options = {}) => {'
      ),
      'helpers.checkFindDataMeaningAI',
      'checkMeaningAI'
    ),
    'helper checkFindDataMeaningAI',
    'helper callAIUsing'
  ),
  updated_at = now()
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments'
)
  AND block.code LIKE '%checkFindDataMeaningAI%';

COMMIT;
