-- Store the active dialog comment textbox XPath in auto_elements and reference
-- it from the comment block instead of hard-coding XPath in block code.

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES (
  'fb_comment_dialog_textbox',
  '//*[@role=''dialog'']//*[@role=''textbox'' and (contains(@aria-label,''Bình luận'') or contains(@aria-label,''bình luận'') or contains(@aria-label,''Comment'') or contains(@aria-label,''comment'') or contains(@aria-label,''Trả lời'') or contains(@aria-label,''trả lời''))]',
  'Ô nhập comment/reply đang hiển thị trong dialog sau khi click khung comment',
  'facebook',
  true,
  NULL,
  NULL,
  now()
)
ON CONFLICT (name) DO UPDATE
SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = EXCLUDED.is_builtin,
  updated_at = now();

UPDATE public.auto_blocks
SET
  code = replace(
    code,
    $old$const inputXpath = "//*[@role='dialog']//*[@role='textbox' and (contains(@aria-label,'Bình luận') or contains(@aria-label,'bình luận') or contains(@aria-label,'Comment') or contains(@aria-label,'comment') or contains(@aria-label,'Trả lời') or contains(@aria-label,'trả lời'))]"$old$,
    $new$const inputXpath = await helpers.element('fb_comment_dialog_textbox')$new$
  ),
  updated_at = now()
WHERE name = 'fb_comment_at_position'
  AND code LIKE '%const inputXpath = "//*[@role=''dialog''%';
