-- Migration v60: add explicit waits after closing Facebook dialogs in UI page/profile post flow.

BEGIN;

UPDATE public.auto_blocks
SET
  code = replace(
    code,
$old$helpers.log('Đang mở composer đăng bài trên identity hiện tại')
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs, signal)
await page.navigate('https://www.facebook.com/profile.php')
await helpers.sleep(stepMs + 2000, signal)
await rawClick(closeSelector).catch(() => null)

const openCount = await rawCount(openSelector)$old$,
$new$helpers.log('Đang mở composer đăng bài trên identity hiện tại')
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)
await page.navigate('https://www.facebook.com/profile.php')
await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)

const openCount = await rawCount(openSelector)$new$
  ),
  updated_at = now()
WHERE name = 'fb_post_current_identity_ui';

COMMIT;
