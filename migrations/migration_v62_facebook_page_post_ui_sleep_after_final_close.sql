-- Add a render wait after closing the final Facebook composer dialog before
-- reading the just-published post link.

BEGIN;

UPDATE public.auto_blocks
SET
  code = replace(
    code,
$old$await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
const postUrl = String(await getPostUrl() || '').trim()$old$,
$new$await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)
const postUrl = String(await getPostUrl() || '').trim()$new$
  ),
  updated_at = now()
WHERE name = 'fb_post_current_identity_ui'
  AND position($old$await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
const postUrl = String(await getPostUrl() || '').trim()$old$ in code) > 0;

COMMIT;
