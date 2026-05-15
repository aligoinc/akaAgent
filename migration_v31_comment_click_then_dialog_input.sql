-- Keep the indexed feed comment box as the click target, then type/drop into
-- the active dialog textbox that appears after the click.

UPDATE public.auto_blocks
SET
  code = replace(
    replace(
      replace(
        replace(
          code,
          $old$const boxXpath = "//*[@role='dialog']//*[@role='textbox' and (contains(@aria-label,'Bình luận') or contains(@aria-label,'bình luận') or contains(@aria-label,'Comment') or contains(@aria-label,'comment') or contains(@aria-label,'Trả lời') or contains(@aria-label,'trả lời'))]"$old$,
          $new$const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })
const inputXpath = "//*[@role='dialog']//*[@role='textbox' and (contains(@aria-label,'Bình luận') or contains(@aria-label,'bình luận') or contains(@aria-label,'Comment') or contains(@aria-label,'comment') or contains(@aria-label,'Trả lời') or contains(@aria-label,'trả lời'))]"$new$
        ),
        $old$await helpers.sleep(2000, signal)

if (text) {$old$,
        $new$await helpers.sleep(2000, signal)
await page.waitForSelector(inputXpath, { timeout: 8000 })

if (text) {$new$
      ),
      $old$await helpers.sleep(2000, signal)
await page.type(boxXpath, text, { clearFirst: true })$old$,
      $new$await helpers.sleep(2000, signal)
await page.waitForSelector(inputXpath, { timeout: 8000 })
await page.type(inputXpath, text, { clearFirst: true })$new$
    ),
    'page.type(boxXpath,',
    'page.type(inputXpath,'
  ),
  updated_at = now()
WHERE name = 'fb_comment_at_position'
  AND code LIKE '%role=''dialog''%role=''textbox''%';

UPDATE public.auto_blocks
SET
  code = replace(code, 'page.dropFile(boxXpath,', 'page.dropFile(inputXpath,'),
  updated_at = now()
WHERE name = 'fb_comment_at_position'
  AND code LIKE '%const inputXpath =%'
  AND code LIKE '%page.dropFile(boxXpath,%';
