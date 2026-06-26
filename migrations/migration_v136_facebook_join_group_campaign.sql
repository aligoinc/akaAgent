-- Facebook browser-based campaign: join groups by Facebook group UID/link.
-- DOM interactions intentionally mirror akaBizAuto JoinGroup_Fb.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('facebook', 'Facebook - Tham gia group', 'fb_join_group')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  (
    'fb_join_group_close_dialog_btn',
    $$//*[@role='dialog']//*[@role='button' and @aria-label='Đóng']$$,
    'Close dialog button before joining Facebook group. Mirrors C# CloseDialogBtn.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_join_group_button',
    $$//div[@class='rq0escxv lpgh02oy du4w35lb rek2kq2y']//div[@role='button' and (.='Join Group' or .='Tham gia nhóm')]$$,
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
    $$//div[@role='dialog' and (@aria-label='Answer Questions' or @aria-label='Trả lời câu hỏi')]$$,
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

INSERT INTO public.auto_blocks (
  name,
  description,
  icon,
  category,
  kind,
  code,
  config_schema,
  output_schema,
  default_config,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES
  (
    'fb_join_group',
    'Tham gia group Facebook theo UID/link, bám DOM C# JoinGroup_Fb.',
    'LogIn',
    'facebook',
    'js',
    $block$
if (!page) throw new Error('Facebook - Tham gia group cần browser page');

const TIME_SLEEP_BY_STEP_MS = 1000;
const rawTarget = String(vars.targetUid || vars.inputDataUid || vars.targetUrl || vars.inputData?.uid || '').trim();
const targetName = String(vars.targetName || vars.inputDataName || vars.inputData?.name || '').trim();
const variants = helpers.splitVariants(vars.campaignContent || vars.originalCampaignContent || '');
const answerContent = helpers.cycleVariant(variants.length > 0 ? variants : [String(vars.campaignContent || '')], Number(vars.loopIndex || 0));

const selectors = {
  closeDialog: await helpers.element('fb_join_group_close_dialog_btn'),
  join: await helpers.element('fb_join_group_button'),
  cancelRequest: await helpers.element('fb_join_group_cancel_request_button'),
  questionDialog: await helpers.element('fb_join_group_question_dialog'),
  textarea: await helpers.element('fb_join_group_question_textarea'),
  checkbox: await helpers.element('fb_join_group_question_checkbox'),
  radio: await helpers.element('fb_join_group_question_radio'),
  submit: await helpers.element('fb_join_group_question_submit_button')
};

function verifyLink(link) {
  if (!link) return '';
  if (!link.includes('https://') && !link.includes('http://')) return 'https://' + link;
  return link;
}

function verifyGroupLinkFb(value) {
  let linkUid = String(value || '').trim();
  if (!linkUid) return '';
  if (linkUid.includes('mobile.facebook.com')) linkUid = linkUid.replace('mobile.facebook.com', 'www.facebook.com');
  else if (linkUid.includes('mobile.fb.com')) linkUid = linkUid.replace('mobile.fb.com', 'www.facebook.com');
  else if (linkUid.includes('m.facebook.com')) linkUid = linkUid.replace('m.facebook.com', 'www.facebook.com');
  else if (linkUid.includes('m.fb.com')) linkUid = linkUid.replace('m.fb.com', 'www.facebook.com');
  else if (linkUid.includes('mbasic.facebook.com')) linkUid = linkUid.replace('mbasic.facebook.com', 'www.facebook.com');
  else if (linkUid.includes('mbasic.fb.com')) linkUid = linkUid.replace('mbasic.fb.com', 'www.facebook.com');
  else if (linkUid.includes('web.facebook.com')) linkUid = linkUid.replace('web.facebook.com', 'www.facebook.com');
  else if (linkUid.includes('web.fb.com')) linkUid = linkUid.replace('web.fb.com', 'www.facebook.com');
  else if (!linkUid.includes('facebook.com') && !linkUid.includes('fb.com')) linkUid = `https://www.facebook.com/groups/${linkUid}`;
  if (linkUid.includes('?')) linkUid = linkUid.substring(0, linkUid.indexOf('?'));
  return verifyLink(linkUid.trim());
}

async function evaluateJoinDom(operation, args) {
  return await page.evaluate(`
    const operation = __args[0];
    const args = __args[1] || {};

    function xpathAll(xpath, root) {
      const out = [];
      if (!xpath) return out;
      const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) {
        const item = result.snapshotItem(i);
        if (item) out.push(item);
      }
      return out;
    }

    function clickElement(el) {
      if (!el) return false;
      try {
        el.click();
        return true;
      } catch {}
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch {}
      return false;
    }

    function firstDialog() {
      return xpathAll(args.dialogSelector, document)[0] || null;
    }

    if (operation === 'closeDialog') {
      const dialogCloseBtn = xpathAll(args.selector, document)[0] || null;
      return { clicked: clickElement(dialogCloseBtn) };
    }

    if (operation === 'scrollTop') {
      scrollTo(0,0);
      return { ok: true };
    }

    if (operation === 'clickJoinOrResolveExisting') {
      const buttons = xpathAll(args.joinSelector, document);
      if (buttons.length === 0) {
        const cancelButtons = xpathAll(args.cancelSelector, document);
        if (cancelButtons.length > 0) {
          return { ok: true, clicked: false, joinOutcome: 'requested', statusCode: 22, message: 'Đã gửi yêu cầu tham gia group' };
        }
        return { ok: true, clicked: false, joinOutcome: 'already_joined', statusCode: 21, message: 'Đã tham gia group' };
      }
      return { ok: clickElement(buttons[0]), clicked: true, joinOutcome: 'clicked', statusCode: 0 };
    }

    if (operation === 'questionCounts') {
      const dialog = firstDialog();
      if (!dialog) return { hasDialog: false, textareaCount: 0, checkboxCount: 0, radioCount: 0, submitCount: 0 };
      return {
        hasDialog: true,
        textareaCount: xpathAll(args.textareaSelector, dialog).length,
        checkboxCount: xpathAll(args.checkboxSelector, dialog).length,
        radioCount: xpathAll(args.radioSelector, dialog).length,
        submitCount: xpathAll(args.submitSelector, dialog).length
      };
    }

    if (operation === 'fillTextarea') {
      const dialog = firstDialog();
      const textarea = dialog ? xpathAll(args.textareaSelector, dialog)[Number(args.index || 0)] : null;
      if (!textarea) return { ok: false };
      try {
        textarea.focus();
        const text = String(args.value || '');
        const current = String(textarea.value || '');
        textarea.value = current + text;
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
        textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        return { ok: true, method: 'sendKeysLike' };
      } catch {}
      try {
        textarea.value = String(args.value || '');
        textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        return { ok: true, method: 'setValue' };
      } catch {}
      return { ok: false };
    }

    if (operation === 'clickCheckbox') {
      const dialog = firstDialog();
      const checkbox = dialog ? xpathAll(args.checkboxSelector, dialog)[Number(args.index || 0)] : null;
      return { clicked: clickElement(checkbox) };
    }

    if (operation === 'clickLastRadio') {
      const dialog = firstDialog();
      const radios = dialog ? xpathAll(args.radioSelector, dialog) : [];
      const radio = radios.length > 0 ? radios[radios.length - 1] : null;
      return { clicked: clickElement(radio) };
    }

    if (operation === 'clickSubmit') {
      const dialog = firstDialog();
      const submit = dialog ? xpathAll(args.submitSelector, dialog)[Number(args.index || 0)] : null;
      return { clicked: clickElement(submit) };
    }

    return { ok: false, message: 'Unknown operation' };
  `, operation, args);
}

const targetUrl = verifyGroupLinkFb(rawTarget);
if (!targetUrl) {
  return {
    ok: false,
    joinOutcome: 'invalid',
    statusCode: 13,
    message: 'Link group không hợp lệ',
    targetUid: rawTarget,
    targetUrl,
    targetName
  };
}

try {
  const closed = await evaluateJoinDom('closeDialog', { selector: selectors.closeDialog });
  if (closed?.clicked) await helpers.sleep(TIME_SLEEP_BY_STEP_MS, signal);
} catch {}

try {
  await page.navigate(targetUrl);
  await helpers.sleep(TIME_SLEEP_BY_STEP_MS, signal);
  await helpers.sleep(TIME_SLEEP_BY_STEP_MS + 2000, signal);
} catch (err) {
  throw new Error('Link group không hợp lệ');
}

let joinClickResult;
try {
  await evaluateJoinDom('scrollTop', {});
  await helpers.sleep(TIME_SLEEP_BY_STEP_MS + 500, signal);
  joinClickResult = await evaluateJoinDom('clickJoinOrResolveExisting', {
    joinSelector: selectors.join,
    cancelSelector: selectors.cancelRequest
  });
  if (joinClickResult?.joinOutcome === 'requested' || joinClickResult?.joinOutcome === 'already_joined') {
    return {
      ok: true,
      joinOutcome: joinClickResult.joinOutcome,
      statusCode: joinClickResult.statusCode,
      message: joinClickResult.message,
      targetUid: rawTarget,
      targetUrl,
      targetName,
      countsTowardLimit: joinClickResult.joinOutcome !== 'already_joined'
    };
  }
  if (joinClickResult?.ok !== true) throw new Error('click failed');
  await helpers.sleep(TIME_SLEEP_BY_STEP_MS + 2000, signal);
} catch (err) {
  throw new Error('Lỗi khi nhấn nút tham gia group');
}

const questionStats = {
  hasDialog: false,
  textareaCount: 0,
  textareaFilledCount: 0,
  checkboxCount: 0,
  checkboxClickedCount: 0,
  radioCount: 0,
  radioClicked: false,
  submitCount: 0,
  submitClickedCount: 0
};

try {
  const counts = await evaluateJoinDom('questionCounts', {
    dialogSelector: selectors.questionDialog,
    textareaSelector: selectors.textarea,
    checkboxSelector: selectors.checkbox,
    radioSelector: selectors.radio,
    submitSelector: selectors.submit
  });
  questionStats.hasDialog = counts?.hasDialog === true;
  questionStats.textareaCount = Number(counts?.textareaCount || 0);
  questionStats.checkboxCount = Number(counts?.checkboxCount || 0);
  questionStats.radioCount = Number(counts?.radioCount || 0);
  questionStats.submitCount = Number(counts?.submitCount || 0);

  if (questionStats.hasDialog) {
    for (let i = 0; i < questionStats.textareaCount; i++) {
      try {
        const filled = await evaluateJoinDom('fillTextarea', {
          dialogSelector: selectors.questionDialog,
          textareaSelector: selectors.textarea,
          index: i,
          value: answerContent
        });
        if (filled?.ok) questionStats.textareaFilledCount += 1;
        if (filled?.ok) await helpers.sleep(TIME_SLEEP_BY_STEP_MS + 2000, signal);
      } catch {}
    }

    for (let i = 0; i < questionStats.checkboxCount; i++) {
      try {
        const clicked = await evaluateJoinDom('clickCheckbox', {
          dialogSelector: selectors.questionDialog,
          checkboxSelector: selectors.checkbox,
          index: i
        });
        if (clicked?.clicked) questionStats.checkboxClickedCount += 1;
        if (clicked?.clicked) await helpers.sleep(TIME_SLEEP_BY_STEP_MS + 2000, signal);
      } catch {}
    }

    try {
      const clickedRadio = await evaluateJoinDom('clickLastRadio', {
        dialogSelector: selectors.questionDialog,
        radioSelector: selectors.radio
      });
      questionStats.radioClicked = clickedRadio?.clicked === true;
      if (questionStats.radioClicked) await helpers.sleep(TIME_SLEEP_BY_STEP_MS + 2000, signal);
    } catch {}

    for (let i = 0; i < questionStats.submitCount; i++) {
      try {
        const clicked = await evaluateJoinDom('clickSubmit', {
          dialogSelector: selectors.questionDialog,
          submitSelector: selectors.submit,
          index: i
        });
        if (clicked?.clicked) questionStats.submitClickedCount += 1;
        if (clicked?.clicked) {
          await helpers.sleep(TIME_SLEEP_BY_STEP_MS + helpers.randomBetween(2400, 5600), signal);
        }
      } catch {}
    }

    await helpers.sleep(TIME_SLEEP_BY_STEP_MS + 2000, signal);
  }
} catch {}

return {
  ok: true,
  joinOutcome: questionStats.hasDialog ? 'requested' : 'joined',
  statusCode: 2,
  message: questionStats.hasDialog ? 'Đã gửi yêu cầu tham gia group' : 'Đã tham gia group',
  targetUid: rawTarget,
  targetUrl,
  targetName,
  answerUsed: answerContent,
  questionStats,
  countsTowardLimit: true
};
$block$,
    '[]'::jsonb,
    '[
      {"name":"ok","type":"boolean","label":"OK"},
      {"name":"joinOutcome","type":"string","label":"Join outcome"},
      {"name":"statusCode","type":"number","label":"C# status code"},
      {"name":"targetUrl","type":"string","label":"Target URL"},
      {"name":"questionStats","type":"json","label":"Question stats"}
    ]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  )
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  kind = EXCLUDED.kind,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

DO $verify$
DECLARE
  join_block_id bigint;
  workflow_id bigint;
  test_workflow_id bigint;
  block_code text;
BEGIN
  SELECT id, code INTO join_block_id, block_code
  FROM public.auto_blocks
  WHERE name = 'fb_join_group';

  IF join_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed facebook_join_group workflow: missing fb_join_group block id';
  END IF;

  INSERT INTO public.auto_workflows (
    name,
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    is_builtin,
    staff_id,
    organization_id,
    updated_at
  )
  VALUES (
    'facebook_join_group',
    'Workflow browser-based cho chiến dịch Facebook - Tham gia vào group.',
    jsonb_build_array(
      jsonb_build_object(
        'id', 'join_group',
        'blockId', join_block_id,
        'blockName', 'fb_join_group',
        'position', jsonb_build_object('x', 0, 'y', 0),
        'config', jsonb_build_object()
      )
    ),
    '[]'::jsonb,
    '[
      {"name":"targetUid","type":"string","label":"Group URL/UID"},
      {"name":"targetName","type":"string","label":"Tên group"},
      {"name":"campaignContent","type":"string","label":"Câu trả lời câu hỏi group"}
    ]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    nodes = EXCLUDED.nodes,
    edges = EXCLUDED.edges,
    variables_schema = EXCLUDED.variables_schema,
    default_variables = EXCLUDED.default_variables,
    is_builtin = true,
    updated_at = now()
  RETURNING id INTO workflow_id;

  INSERT INTO public.auto_workflows (
    name,
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    is_builtin,
    staff_id,
    organization_id,
    updated_at
  )
  SELECT
    'facebook_join_group__test__facebook_join_group',
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    false,
    staff_id,
    organization_id,
    now()
  FROM public.auto_workflows
  WHERE id = workflow_id
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO test_workflow_id
  FROM public.auto_workflows
  WHERE name = 'facebook_join_group__test__facebook_join_group';

  INSERT INTO public.auto_campaign_actions (
    id,
    name,
    flatform_type,
    is_active,
    workflow_id,
    test_workflow_id,
    limit_check_action_codes,
    is_delete,
    created_at
  )
  VALUES (
    'facebook_join_group',
    'Facebook - Tham gia vào group',
    'facebook',
    true,
    workflow_id,
    test_workflow_id,
    ARRAY['fb_join_group']::text[],
    false,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    flatform_type = EXCLUDED.flatform_type,
    is_active = true,
    workflow_id = EXCLUDED.workflow_id,
    test_workflow_id = COALESCE(auto_campaign_actions.test_workflow_id, EXCLUDED.test_workflow_id),
    limit_check_action_codes = EXCLUDED.limit_check_action_codes,
    is_delete = false;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_close_dialog_btn'
      AND xpath = $$//*[@role='dialog']//*[@role='button' and @aria-label='Đóng']$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_close_dialog_btn XPath does not match C# CloseDialogBtn';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_button'
      AND xpath = $$//div[@class='rq0escxv lpgh02oy du4w35lb rek2kq2y']//div[@role='button' and (.='Join Group' or .='Tham gia nhóm')]$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_button XPath does not match C# GroupJoinBtn';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_cancel_request_button'
      AND xpath = $$//div[@role='button' and (.='Cancel Request' or .='Hủy yêu cầu')]$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_cancel_request_button XPath does not match C# GroupCancelReqBtn';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_join_group_question_dialog'
      AND xpath = $$//div[@role='dialog' and (@aria-label='Answer Questions' or @aria-label='Trả lời câu hỏi')]$$
  ) THEN
    RAISE EXCEPTION 'fb_join_group_question_dialog XPath does not match C# GroupQuesDialog';
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

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_actions
    WHERE id = 'facebook_join_group'
      AND limit_check_action_codes = ARRAY['fb_join_group']::text[]
  ) THEN
    RAISE EXCEPTION 'facebook_join_group action is not linked to fb_join_group limit code';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
