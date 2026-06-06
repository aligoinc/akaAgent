-- Pause group-post campaigns immediately when Facebook reports a posting frequency limit.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES (
  'GroupPostFrequencyLimitError',
  '//*[contains(.,''giới hạn tần suất bạn đăng bài'')]',
  'Thông báo Facebook giới hạn tần suất đăng bài group',
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

INSERT INTO public.auto_error (
  error_type,
  error_name,
  error_desc,
  error_code,
  error_element,
  noti_running_process,
  noti_campaign,
  update_status_account,
  update_status_campaign,
  disable_action_codes,
  time_disable_actions,
  count_consecutive_errors
)
VALUES (
  'external facebook',
  'Giới hạn tần suất đăng bài group',
  'Facebook báo giới hạn tần suất bạn đăng bài',
  'err_group_post_frequency_limit',
  '//*[contains(.,''giới hạn tần suất bạn đăng bài'')]',
  'Facebook báo giới hạn tần suất bạn đăng bài',
  'Facebook báo giới hạn tần suất bạn đăng bài',
  NULL,
  'tạm dừng',
  '{}'::text[],
  NULL,
  NULL
)
ON CONFLICT (error_code) DO UPDATE SET
  error_type = EXCLUDED.error_type,
  error_name = EXCLUDED.error_name,
  error_desc = EXCLUDED.error_desc,
  error_element = EXCLUDED.error_element,
  noti_running_process = EXCLUDED.noti_running_process,
  noti_campaign = EXCLUDED.noti_campaign,
  update_status_account = EXCLUDED.update_status_account,
  update_status_campaign = EXCLUDED.update_status_campaign,
  disable_action_codes = EXCLUDED.disable_action_codes,
  time_disable_actions = EXCLUDED.time_disable_actions,
  count_consecutive_errors = EXCLUDED.count_consecutive_errors,
  is_active = true,
  is_delete = false,
  updated_at = now();

UPDATE public.auto_blocks
SET
  code = $block$
const submitButton = await helpers.element('GroupPostSubmitButtonAfterClick');
const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
let posted = false;
let message = '';

async function hasVisibleElement(selector) {
  return await page.evaluate(`
    const selector = __args[0];

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function xpathAll(xpath) {
      const out = [];
      if (!xpath) return out;
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
          const item = result.snapshotItem(i);
          if (item) out.push(item);
        }
      } catch {}
      return out;
    }

    return xpathAll(selector).some(isVisible);
  `, selector);
}

try {
  await page.waitForSelector(submitButton, { timeout: 60000, state: 'hidden' });
  posted = true;
  message = 'Form đăng bài đã đóng';
} catch {
  posted = false;
  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);
  if (hasFrequencyLimitError) {
    message = 'Facebook báo giới hạn tần suất bạn đăng bài';
    vars.groupPostSubmitted = false;
    vars.groupPostFrequencyLimitError = true;
    helpers.log(message);
    throw new Error(message);
  }
  message = 'Form đăng bài chưa đóng sau 60 giây';
}

vars.groupPostSubmitted = posted;
if (!posted) helpers.log(message);

return {
  ok: posted,
  posted,
  submitClosed: posted,
  message
};
$block$,
  output_schema = '[
    {"name":"ok","type":"boolean","label":"Submit OK"},
    {"name":"posted","type":"boolean","label":"Đã đăng"},
    {"name":"submitClosed","type":"boolean","label":"Form đã đóng"},
    {"name":"message","type":"string","label":"Thông báo"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_verify_group_post_form_closed';

COMMIT;
