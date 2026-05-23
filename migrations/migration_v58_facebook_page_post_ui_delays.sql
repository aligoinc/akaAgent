-- Migration v58: tune Facebook page/profile UI post delays.
-- - Remove discussion-tab fallback from generic composer posting (group-only fallback).
-- - Wait a fixed 3s after typing content.
-- - Wait 3s after submit before clicking "Lúc khác".

BEGIN;

UPDATE public.auto_blocks
SET
  code = replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                code,
$old$const discussionSelector = await helpers.element('FbComposerDiscussionTab')
$old$,
$new$$new$),
$old$function sleepAfterTypingMs(content) {
  const words = String(content || '').split(/\s+/).filter(Boolean).length
  if (words === 0) return stepMs
  return Math.min(60000, Math.max(2000, stepMs + words * 120))
}

$old$,
$new$$new$),
$old$let openCount = await rawCount(openSelector)
if (openCount === 0) {
  await rawClick(discussionSelector).catch(() => null)
  await helpers.sleep(stepMs + 1000, signal)
}
openCount = await rawCount(openSelector)
if (openCount === 0) {
  return { ok: false, posted: false, error: 'Không tìm thấy nút tạo bài viết' }
}
$old$,
$new$const openCount = await rawCount(openSelector)
if (openCount === 0) {
  return { ok: false, posted: false, error: 'Không tìm thấy nút tạo bài viết' }
}
$new$),
$old$  let openCount = await rawCount(openSelector)
  if (openCount === 0) {
    await rawClick(discussionSelector).catch(() => null)
    await helpers.sleep(stepMs + 1000, signal)
  }
  openCount = await rawCount(openSelector)
  if (openCount === 0) return { ok: false, error: 'Không tìm thấy nút tạo bài viết' }
$old$,
$new$  const openCount = await rawCount(openSelector)
  if (openCount === 0) return { ok: false, error: 'Không tìm thấy nút tạo bài viết' }
$new$),
$old$await helpers.sleep(sleepAfterTypingMs(message), signal)$old$,
$new$await helpers.sleep(3000, signal)$new$),
$old$  await rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)$old$,
$new$  await helpers.sleep(3000, signal)
  await rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)$new$),
$old$await rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)$old$,
$new$await helpers.sleep(3000, signal)
await rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)$new$),
  default_config = COALESCE(default_config, '{}'::jsonb) || '{"facebookStepMs":1000,"facebookSubmitTimeoutMs":30000,"facebookPublishTimeoutMs":120000}'::jsonb,
  updated_at = now()
WHERE name IN ('fb_post_current_identity_ui', 'fb_page_post_ui');

-- Keep the migration idempotent: collapse any repeated 3s waits before "Lúc khác"
-- back to exactly one wait, preserving the line indentation.
UPDATE public.auto_blocks
SET
  code = regexp_replace(
    code,
$pattern$(?m)([ \t]*)await helpers\.sleep\(3000, signal\)
(?:[ \t]*await helpers\.sleep\(3000, signal\)
)*[ \t]*await rawClick\(anotherTimeSelector\)$pattern$,
$replace$\1await helpers.sleep(3000, signal)
\1await rawClick(anotherTimeSelector)$replace$,
    'g'
  ),
  updated_at = now()
WHERE name IN ('fb_post_current_identity_ui', 'fb_page_post_ui');

UPDATE public.auto_workflows
SET
  default_variables = COALESCE(default_variables, '{}'::jsonb) || '{"facebookStepMs":1000,"facebookSubmitTimeoutMs":30000,"facebookPublishTimeoutMs":120000}'::jsonb,
  updated_at = now()
WHERE name = 'facebook_page_post';

COMMIT;
