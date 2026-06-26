-- Fix Facebook join group selectors from the corrected akaBizAuto DOM source.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  (
    'fb_join_group_close_dialog_btn',
    $$//*[@role='dialog']//*[@role='button' and @aria-label='Đóng']|//*[@role='button' and .='Dùng Trang']$$,
    'Close dialog button before joining Facebook group. Mirrors C# CloseDialogBtn.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_button',
    $$//div[@role='button' and (.='Join Group' or .='Tham gia nhóm')]$$,
    'Facebook group join button. Mirrors C# GroupJoinBtn.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_cancel_request_button',
    $$//div[@role='button' and (.='Cancel Request' or .='Hủy yêu cầu')]$$,
    'Facebook group cancel request button. Mirrors C# GroupCancelReqBtn.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_question_dialog',
    $$//div[@role='dialog' and (@aria-label='Answer Questions' or @aria-label='Answer questions' or @aria-label='Trả lời câu hỏi')]$$,
    'Facebook group question dialog. Mirrors C# GroupQuesDialog.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_question_textarea',
    $$//textarea$$,
    'Facebook group question textarea. Mirrors C# GroupQuesTextarea.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_question_checkbox',
    $$//input[@type='checkbox']$$,
    'Facebook group question checkbox. Mirrors C# GroupQuesCheckbox.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_question_radio',
    $$//input[@type='radio']$$,
    'Facebook group question radio. Mirrors C# GroupQuesRadio.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_question_submit_button',
    $$//div[@role='button' and (.='Submit' or .='Gửi')]$$,
    'Facebook group question submit button. Mirrors C# GroupSubmitQuesBtn.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  )
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

DO $verify$
DECLARE
  block_code text;
BEGIN
  SELECT code
  INTO block_code
  FROM public.auto_blocks
  WHERE name = 'fb_join_group';

  IF block_code IS NULL THEN
    RAISE EXCEPTION 'Cannot verify facebook_join_group selectors: missing fb_join_group block';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_close_dialog_btn'
      AND xpath = $$//*[@role='dialog']//*[@role='button' and @aria-label='Đóng']|//*[@role='button' and .='Dùng Trang']$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_close_dialog_btn XPath does not match corrected C# CloseDialogBtn';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_button'
      AND xpath = $$//div[@role='button' and (.='Join Group' or .='Tham gia nhóm')]$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_button XPath does not match corrected C# GroupJoinBtn';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_cancel_request_button'
      AND xpath = $$//div[@role='button' and (.='Cancel Request' or .='Hủy yêu cầu')]$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_cancel_request_button XPath does not match corrected C# GroupCancelReqBtn';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_question_dialog'
      AND xpath = $$//div[@role='dialog' and (@aria-label='Answer Questions' or @aria-label='Answer questions' or @aria-label='Trả lời câu hỏi')]$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_question_dialog XPath does not match corrected C# GroupQuesDialog';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_question_textarea'
      AND xpath = $$//textarea$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_question_textarea XPath does not match C# GroupQuesTextarea';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_question_checkbox'
      AND xpath = $$//input[@type='checkbox']$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_question_checkbox XPath does not match C# GroupQuesCheckbox';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_question_radio'
      AND xpath = $$//input[@type='radio']$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_question_radio XPath does not match C# GroupQuesRadio';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_question_submit_button'
      AND xpath = $$//div[@role='button' and (.='Submit' or .='Gửi')]$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_question_submit_button XPath does not match C# GroupSubmitQuesBtn';
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
END $verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
