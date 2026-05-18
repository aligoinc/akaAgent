-- Use the active dialog textbox for feed comment seeding instead of the
-- indexed legacy comment box element.

UPDATE public.auto_blocks
SET
  code = replace(
    code,
    $old$const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })$old$,
    $new$const boxXpath = "//*[@role='dialog']//*[@role='textbox' and (contains(@aria-label,'Bình luận') or contains(@aria-label,'bình luận') or contains(@aria-label,'Comment') or contains(@aria-label,'comment') or contains(@aria-label,'Trả lời') or contains(@aria-label,'trả lời'))]"$new$
  ),
  updated_at = now()
WHERE name = 'fb_comment_at_position'
  AND code LIKE '%fb_comment_box_at_n%';
