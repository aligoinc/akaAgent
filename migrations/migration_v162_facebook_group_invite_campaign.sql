-- Facebook browser-based campaign: invite scanned friends to a joined group.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('facebook', 'Mời vào group', 'fb_group_invite')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  (
    'fb_group_invite_button',
    $$//*[@role='button' and .='Mời']$$,
    'Nút mở form/menu mời vào group Facebook.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_group_invite_friend_menu_item',
    $$//*[@role='menuitem' and contains(.,'Mời bạn bè')]$$,
    'Menu item mời bạn bè vào group Facebook, nếu Facebook hiển thị menu trung gian.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_group_invite_search_input',
    $$//*[@role='dialog']//input[@type='text' and contains(@placeholder,'Tìm bạn bè')]$$,
    'Input tìm bạn bè trong dialog mời vào group Facebook.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_group_invite_send_button',
    $$//*[@role='dialog']//*[@role='button' and .='Gửi lời mời']$$,
    'Nút gửi lời mời trong dialog mời vào group Facebook.',
    'facebook',
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'fb_group_invite_dialog',
    $$//*[@role='dialog' and contains(@aria-label,'Mời bạn bè')]$$,
    'Dialog mời vào group Facebook.',
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
    'fb_group_invite',
    'Mời danh sách bạn bè Facebook đã quét vào một group đã tham gia.',
    'UserPlus',
    'facebook',
    'js',
    $block$
if (!page) throw new Error('Facebook - Mời vào group cần browser page');

const rawGroupUrl = String(vars.facebookGroupInviteTargetGroupUrl || '').trim();
const groupName = String(vars.facebookGroupInviteTargetGroupName || rawGroupUrl).trim();
const targets = Array.isArray(vars.facebookGroupInviteTargets) ? vars.facebookGroupInviteTargets : [];
const quotaCapacity = Math.max(0, Math.floor(Number(vars.facebookGroupInviteQuotaCapacity || targets.length || 0)));

const selectors = {
  inviteButton: await helpers.element('fb_group_invite_button'),
  friendMenuItem: await helpers.element('fb_group_invite_friend_menu_item'),
  searchInput: await helpers.element('fb_group_invite_search_input'),
  sendButton: await helpers.element('fb_group_invite_send_button'),
  dialog: await helpers.element('fb_group_invite_dialog')
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

function xpathLiteral(value) {
  const text = String(value || '');
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  const parts = text.split("'");
  const tokens = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) tokens.push('"\'"');
    if (parts[i]) tokens.push(`'${parts[i]}'`);
  }
  return `concat(${tokens.join(',')})`;
}

async function evaluateInviteDom(operation, args) {
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

    function setInputValue(input, value) {
      if (!input) return false;
      const text = String(value || '');
      try { input.focus(); } catch {}
      try {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, text);
        else input.value = text;
      } catch {
        input.value = text;
      }
      try {
        input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: text ? 'insertText' : 'deleteContentBackward' }));
      } catch {
        input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return true;
    }

    if (operation === 'clickFirst') {
      const el = xpathAll(args.selector, document)[0] || null;
      return { clicked: clickElement(el) };
    }

    if (operation === 'clickOptional') {
      const el = xpathAll(args.selector, document)[0] || null;
      return { exists: !!el, clicked: clickElement(el) };
    }

    if (operation === 'hasElement') {
      return { exists: xpathAll(args.selector, document).length > 0 };
    }

    if (operation === 'setSearch') {
      const input = xpathAll(args.selector, document)[0] || null;
      return { ok: setInputValue(input, args.value) };
    }

    if (operation === 'clearSearch') {
      const input = xpathAll(args.selector, document)[0] || null;
      return { ok: setInputValue(input, '') };
    }

    if (operation === 'processTarget') {
      if (args.statusOnly !== true) {
        const exactCheckbox = xpathAll(args.exactCheckboxSelector, document)[0] || null;
        if (exactCheckbox) {
          const clicked = clickElement(exactCheckbox);
          return {
            status: clicked ? 'selected' : 'lỗi',
            selected: clicked,
            message: clicked ? 'Đã chọn bạn bè để mời' : 'Không tick được checkbox'
          };
        }
        if (args.checkboxOnly === true) {
          return { status: 'not_ready', selected: false, message: '' };
        }
      }
      if (xpathAll(args.alreadyInvitedSelector, document).length > 0) {
        return { status: 'đã gửi lời mời', selected: false, message: 'Đã gửi lời mời trước đó' };
      }
      if (xpathAll(args.alreadyMemberSelector, document).length > 0) {
        return { status: 'đã là thành viên', selected: false, message: 'Đã là thành viên của group' };
      }
      return { status: 'không tồn tại', selected: false, message: 'Không tìm thấy bạn bè trong form mời' };
    }

    if (operation === 'dialogOpen') {
      return { open: xpathAll(args.selector, document).length > 0 };
    }

    return { ok: false, message: 'Unknown operation' };
  `, operation, args);
}

const groupUrl = verifyGroupLinkFb(rawGroupUrl);
if (!groupUrl) throw new Error('Link group nhận lời mời không hợp lệ');

await page.navigate(groupUrl);
await helpers.sleep(5000, signal);

const inviteClick = await evaluateInviteDom('clickFirst', { selector: selectors.inviteButton });
if (inviteClick?.clicked !== true) throw new Error('Không tìm thấy nút Mời trong group');
await helpers.sleep(5000, signal);

const menuClick = await evaluateInviteDom('clickOptional', { selector: selectors.friendMenuItem });
await helpers.sleep(5000, signal);

const inputReady = await evaluateInviteDom('hasElement', { selector: selectors.searchInput });
if (inputReady?.exists !== true) throw new Error('Không tìm thấy input tìm bạn bè trong form mời');

let selectedCount = 0;
let quotaReached = false;
let results = [];

for (const target of targets) {
  if (selectedCount >= quotaCapacity) {
    quotaReached = true;
    break;
  }

  const inputDataId = Number(target?.inputDataId || target?.inputData?.id);
  const name = String(target?.name || target?.inputData?.name || '').trim();
  const uid = String(target?.uid || target?.inputData?.uid || '').trim();

  if (!name) {
    results.push({
      inputDataId,
      name,
      uid,
      status: 'không tồn tại',
      selected: false,
      countsTowardLimit: false,
      message: 'Thiếu tên bạn bè để tìm trong form mời'
    });
    continue;
  }

  const filled = await evaluateInviteDom('setSearch', { selector: selectors.searchInput, value: name });
  if (filled?.ok !== true) {
    results.push({
      inputDataId,
      name,
      uid,
      status: 'lỗi',
      selected: false,
      countsTowardLimit: false,
      message: 'Không nhập được tên bạn bè vào input tìm kiếm'
    });
    break;
  }

  const nameLiteral = xpathLiteral(name);
  const processTargetArgs = {
    exactCheckboxSelector: `${selectors.dialog}//*[@role='checkbox' and @aria-checked='false' and .=${nameLiteral}]`,
    alreadyInvitedSelector: `${selectors.dialog}//*[@role='checkbox' and @aria-checked='false' and contains(.,${nameLiteral}) and contains(.,'Đã mời')]`,
    alreadyMemberSelector: `${selectors.dialog}//*[@role='checkbox' and @aria-checked='false' and contains(.,${nameLiteral}) and contains(.,'Đã là thành viên')]`
  };
  const waitUntil = Date.now() + 10000;
  let outcome = null;
  while (Date.now() <= waitUntil) {
    outcome = await evaluateInviteDom('processTarget', { ...processTargetArgs, checkboxOnly: true });
    if (outcome?.status === 'selected' || outcome?.status === 'lỗi') break;
    const remainingMs = waitUntil - Date.now();
    if (remainingMs <= 0) break;
    await helpers.sleep(Math.min(500, remainingMs), signal);
  }
  if (outcome?.status !== 'selected' && outcome?.status !== 'lỗi') {
    outcome = await evaluateInviteDom('processTarget', { ...processTargetArgs, statusOnly: true });
  }

  const selected = outcome?.status === 'selected';
  if (selected) selectedCount += 1;
  results.push({
    inputDataId,
    name,
    uid,
    status: outcome?.status || 'không tồn tại',
    selected,
    countsTowardLimit: false,
    message: outcome?.message || ''
  });

  await evaluateInviteDom('clearSearch', { selector: selectors.searchInput });
  await helpers.sleep(2000, signal);
}

let submitOk = selectedCount === 0;
let submitError = '';

if (selectedCount > 0) {
  const sendClick = await evaluateInviteDom('clickFirst', { selector: selectors.sendButton });
  if (sendClick?.clicked !== true) {
    submitOk = false;
    submitError = 'Không tìm thấy hoặc không bấm được nút Gửi lời mời';
  } else {
    await helpers.sleep(10000, signal);
    const dialogState = await evaluateInviteDom('dialogOpen', { selector: selectors.dialog });
    submitOk = dialogState?.open !== true;
    if (!submitOk) submitError = 'Dialog mời vào group vẫn mở sau khi gửi lời mời';
  }

  results = results.map(item => {
    if (item.status !== 'selected') return item;
    return {
      ...item,
      status: submitOk ? 'thành công' : 'lỗi',
      countsTowardLimit: submitOk,
      message: submitOk
        ? `Đã gửi lời mời vào group "${groupName}" cho "${item.name}"`
        : submitError
    };
  });
}

return {
  ok: submitOk && !results.some(item => item.status === 'lỗi'),
  submitOk,
  selectedCount,
  processedCount: results.length,
  quotaReached,
  groupUrl,
  groupName,
  error: submitError,
  results
};
$block$,
    '[]'::jsonb,
    '[
      {"name":"ok","type":"boolean","label":"OK"},
      {"name":"submitOk","type":"boolean","label":"Submit OK"},
      {"name":"selectedCount","type":"number","label":"Số checkbox đã tick"},
      {"name":"processedCount","type":"number","label":"Số target đã xử lý"},
      {"name":"quotaReached","type":"boolean","label":"Đã đủ quota"},
      {"name":"results","type":"json","label":"Kết quả từng bạn bè"}
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
  invite_block_id bigint;
  workflow_id bigint;
  test_workflow_id bigint;
  block_code text;
BEGIN
  SELECT id, code INTO invite_block_id, block_code
  FROM public.auto_blocks
  WHERE name = 'fb_group_invite';

  IF invite_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed facebook_group_invite workflow: missing fb_group_invite block id';
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
    'facebook_group_invite',
    'Workflow browser-based cho chiến dịch Facebook - Mời vào group.',
    jsonb_build_array(
      jsonb_build_object(
        'id', 'group_invite',
        'blockId', invite_block_id,
        'blockName', 'fb_group_invite',
        'position', jsonb_build_object('x', 0, 'y', 0),
        'config', jsonb_build_object()
      )
    ),
    '[]'::jsonb,
    '[
      {"name":"facebookGroupInviteTargetGroupUrl","type":"string","label":"Group nhận lời mời"},
      {"name":"facebookGroupInviteTargetGroupName","type":"string","label":"Tên group"},
      {"name":"facebookGroupInviteQuotaCapacity","type":"number","label":"Quota còn lại"},
      {"name":"facebookGroupInviteTargets","type":"json","label":"Danh sách bạn bè cần mời"}
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
    'facebook_group_invite__test__facebook_group_invite',
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
  WHERE name = 'facebook_group_invite__test__facebook_group_invite';

  INSERT INTO public.auto_campaign_actions (
    id,
    name,
    flatform_type,
    is_active,
    workflow_id,
    test_workflow_id,
    allow_multiple_accounts,
    limit_check_action_codes,
    is_delete,
    created_at
  )
  VALUES (
    'facebook_group_invite',
    'Facebook - Mời vào group',
    'facebook',
    true,
    workflow_id,
    test_workflow_id,
    false,
    ARRAY['fb_group_invite']::text[],
    false,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    flatform_type = EXCLUDED.flatform_type,
    is_active = true,
    workflow_id = EXCLUDED.workflow_id,
    test_workflow_id = COALESCE(auto_campaign_actions.test_workflow_id, EXCLUDED.test_workflow_id),
    allow_multiple_accounts = false,
    limit_check_action_codes = EXCLUDED.limit_check_action_codes,
    is_delete = false;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_group_invite_button'
      AND xpath = $$//*[@role='button' and .='Mời']$$
  ) THEN
    RAISE EXCEPTION 'fb_group_invite_button XPath mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_group_invite_friend_menu_item'
      AND xpath = $$//*[@role='menuitem' and contains(.,'Mời bạn bè')]$$
  ) THEN
    RAISE EXCEPTION 'fb_group_invite_friend_menu_item XPath mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_group_invite_search_input'
      AND xpath = $$//*[@role='dialog']//input[@type='text' and contains(@placeholder,'Tìm bạn bè')]$$
  ) THEN
    RAISE EXCEPTION 'fb_group_invite_search_input XPath mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_group_invite_send_button'
      AND xpath = $$//*[@role='dialog']//*[@role='button' and .='Gửi lời mời']$$
  ) THEN
    RAISE EXCEPTION 'fb_group_invite_send_button XPath mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_elements
    WHERE name = 'fb_group_invite_dialog'
      AND xpath = $$//*[@role='dialog' and contains(@aria-label,'Mời bạn bè')]$$
  ) THEN
    RAISE EXCEPTION 'fb_group_invite_dialog XPath mismatch';
  END IF;

  IF block_code LIKE '%page.click(%' THEN
    RAISE EXCEPTION 'fb_group_invite block must not use page.click';
  END IF;

  IF block_code NOT LIKE '%@role=''checkbox'' and @aria-checked=''false'' and .=%' THEN
    RAISE EXCEPTION 'fb_group_invite block must use exact checkbox selector';
  END IF;

  IF block_code NOT LIKE '%contains(.,''Đã mời'')%'
     OR block_code NOT LIKE '%contains(.,''Đã là thành viên'')%' THEN
    RAISE EXCEPTION 'fb_group_invite block must detect already invited and already member statuses';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaign_actions
    WHERE id = 'facebook_group_invite'
      AND allow_multiple_accounts = false
      AND limit_check_action_codes = ARRAY['fb_group_invite']::text[]
  ) THEN
    RAISE EXCEPTION 'facebook_group_invite action is not linked to fb_group_invite limit code';
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
