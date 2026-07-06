-- Add runtime support for group post "Đăng bài dạng chia sẻ" via composer "Thêm nhóm".

BEGIN;

INSERT INTO public.auto_elements (
  name,
  xpath,
  description,
  category,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES
  ('AddGroupToPostBtn', '//*[@role=''button'' and .=''Thêm nhóm'']', 'Nút Thêm nhóm trong composer đăng bài group', 'facebook', true, NULL, NULL, now()),
  ('SearchAddGroupToPostInp', '//*[@role=''textbox'' and @type=''search'']', 'Ô tìm group trong popup Thêm nhóm', 'facebook', true, NULL, NULL, now()),
  ('SelectGroupToPostChk', '//div[@role=''button'' and .//*[.=''$group_name'']]//input[@type=''checkbox'' and @aria-checked=''false'']', 'Checkbox chọn group trong popup Thêm nhóm', 'facebook', true, NULL, NULL, now()),
  ('ConfirmGroupToPostBtn', '//*[@role=''button'' and .=''Xong'']', 'Nút Xong sau khi chọn group share kèm', 'facebook', true, NULL, NULL, now()),
  ('BackToPostFormBtn', '//*[@role=''button'' and @aria-label=''Quay lại'']', 'Nút quay lại composer khi không chọn được group share kèm', 'facebook', true, NULL, NULL, now())
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
  system_type,
  code,
  config_schema,
  output_schema,
  default_config,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES (
  'fb_select_group_post_share_targets',
  'Chọn tối đa 3 group để đăng bài dạng chia sẻ trong composer group.',
  'Share2',
  'facebook',
  'js',
  NULL,
$block$
const enabled = vars.enableGroupPostShareToJoinedGroups === true || input.enableGroupPostShareToJoinedGroups === true;
const rawTargets = Array.isArray(vars.groupPostShareTargets)
  ? vars.groupPostShareTargets
  : (Array.isArray(input.groupPostShareTargets) ? input.groupPostShareTargets : []);
const maxSelect = Math.min(3, Math.max(0, Math.floor(Number(vars.groupPostShareMaxCount ?? input.groupPostShareMaxCount ?? 3))));
const stepMs = Math.max(0, Number(vars.facebookStepMs || input.facebookStepMs || 1000));

const targets = rawTargets
  .map(item => {
    const record = item && typeof item === 'object' ? item : {};
    return {
      id: Number(record.id),
      name: String(record.name || '').replace(/\s+/g, ' ').trim(),
      uid: String(record.uid || '').trim()
    };
  })
  .filter(item => Number.isFinite(item.id) && item.id > 0 && item.name)
  .slice(0, 10);

if (!enabled || maxSelect <= 0 || targets.length === 0 || !page) {
  return {
    enabled,
    skipped: true,
    reason: !enabled ? 'disabled' : maxSelect <= 0 ? 'no_quota_capacity' : targets.length === 0 ? 'no_candidates' : 'no_page',
    candidateCount: targets.length,
    attemptedCount: 0,
    selectedCount: 0,
    selectedTargets: []
  };
}

const addButton = await helpers.element('AddGroupToPostBtn');
const searchInput = await helpers.element('SearchAddGroupToPostInp');
const selectTemplate = await helpers.element('SelectGroupToPostChk');
const confirmButton = await helpers.element('ConfirmGroupToPostBtn');
const backButton = await helpers.element('BackToPostFormBtn');

function xpathLiteral(value) {
  const text = String(value || '');
  if (!text.includes("'")) return "'" + text + "'";
  if (!text.includes('"')) return '"' + text + '"';
  return "concat('" + text.replace(/'/g, "',\"'\",'") + "')";
}

function selectorForGroupName(template, groupName) {
  const literal = xpathLiteral(groupName);
  if (template.includes("'$group_name'")) return template.replace(/'\$group_name'/g, literal);
  if (template.includes('"$group_name"')) return template.replace(/"\$group_name"/g, literal);
  return template.replace(/\$group_name/g, groupName);
}

async function rawClick(xpath) {
  return await page.evaluate(`
    const xpath = String(__args[0] || '');
    function firstByXPath(value) {
      try {
        return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch (e) {
        return null;
      }
    }
    const el = firstByXPath(xpath);
    if (!el) return { found: false, clicked: false };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch (e) {}
    try { el.click(); } catch (e) { return { found: true, clicked: false, message: e && e.message ? e.message : String(e) }; }
    return { found: true, clicked: true };
  `, xpath).catch(err => ({ found: false, clicked: false, message: err && err.message ? err.message : String(err) }));
}

async function rawClear(xpath) {
  return await page.evaluate(`
    const xpath = String(__args[0] || '');
    function firstByXPath(value) {
      try {
        return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch (e) {
        return null;
      }
    }
    const el = firstByXPath(xpath);
    if (!el) return { found: false, cleared: false };
    try { el.focus(); } catch (e) {}
    try {
      if (typeof el.select === 'function') el.select();
      else if (typeof el.setSelectionRange === 'function') el.setSelectionRange(0, String(el.value || '').length);
    } catch (e) {}
    try { document.execCommand('delete', false); } catch (e) {}
    if ('value' in el) {
      const proto = Object.getPrototypeOf(el);
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (desc && typeof desc.set === 'function') desc.set.call(el, '');
      else el.value = '';
    }
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, cleared: true };
  `, xpath).catch(err => ({ found: false, cleared: false, message: err && err.message ? err.message : String(err) }));
}

async function rawType(xpath, text) {
  return await page.evaluate(`
    const xpath = String(__args[0] || '');
    const text = String(__args[1] || '');
    function firstByXPath(value) {
      try {
        return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch (e) {
        return null;
      }
    }
    const el = firstByXPath(xpath);
    if (!el) return { found: false, typed: false };
    try { el.focus(); } catch (e) {}
    if ('value' in el) {
      const proto = Object.getPrototypeOf(el);
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (desc && typeof desc.set === 'function') desc.set.call(el, text);
      else el.value = text;
    } else {
      try { document.execCommand('insertText', false, text); } catch (e) {}
    }
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, typed: true };
  `, xpath, text).catch(err => ({ found: false, typed: false, message: err && err.message ? err.message : String(err) }));
}

let attemptedCount = 0;
let opened = false;
let confirmed = false;
const checkboxSelectedTargets = [];
let selectedTargets = [];

try {
  const openedResult = await rawClick(addButton);
  opened = openedResult && openedResult.clicked === true;
  if (!opened) {
    return {
      enabled: true,
      skipped: true,
      reason: openedResult && openedResult.found === false ? 'add_group_button_not_found' : 'add_group_button_not_clicked',
      candidateCount: targets.length,
      attemptedCount: 0,
      selectedCount: 0,
      selectedTargets: []
    };
  }
  await helpers.sleep(stepMs + 1000, signal);

  for (const target of targets) {
    if (checkboxSelectedTargets.length >= maxSelect) break;
    attemptedCount += 1;
    try {
      if (signal && signal.aborted) throw new Error('Aborted');
      const cleared = await rawClear(searchInput);
      if (!cleared || cleared.found !== true) continue;
      await helpers.sleep(stepMs + 500, signal);

      const typed = await rawType(searchInput, target.name);
      if (!typed || typed.found !== true) continue;
      await helpers.sleep(stepMs + 500, signal);

      const selectXpath = selectorForGroupName(selectTemplate, target.name);
      const selected = await rawClick(selectXpath);
      if (!selected || selected.clicked !== true) continue;
      checkboxSelectedTargets.push(target);
      await helpers.sleep(stepMs + 500, signal);
    } catch (err) {
      if (signal && signal.aborted) throw err;
    }
  }
} catch (err) {
  if (signal && signal.aborted) throw err;
  helpers.log('Không chọn được group share kèm: ' + (err && err.message ? err.message : String(err)));
} finally {
  if (opened) {
    try {
      if (checkboxSelectedTargets.length > 0) {
        const confirmResult = await rawClick(confirmButton);
        confirmed = confirmResult && confirmResult.clicked === true;
        if (confirmed) {
          selectedTargets = checkboxSelectedTargets;
          await helpers.sleep(stepMs + 500, signal);
        }
      } else {
        const backResult = await rawClick(backButton);
        if (backResult && backResult.clicked === true) await helpers.sleep(stepMs + 500, signal);
      }
    } catch (err) {
      if (signal && signal.aborted) throw err;
    }
  }
}

vars.groupPostShareSelectedTargets = selectedTargets;

return {
  enabled: true,
  skipped: false,
  candidateCount: targets.length,
  attemptedCount,
  checkboxSelectedCount: checkboxSelectedTargets.length,
  selectedCount: selectedTargets.length,
  confirmed,
  selectedTargets
};
$block$,
  '[
    {"name":"enableGroupPostShareToJoinedGroups","type":"boolean","label":"Bật đăng bài dạng chia sẻ"},
    {"name":"groupPostShareTargets","type":"json","label":"Danh sách group ứng viên"},
    {"name":"groupPostShareMaxCount","type":"number","label":"Số group share tối đa"}
  ]'::jsonb,
  '[
    {"name":"selectedCount","type":"number","label":"Số group đã chọn"},
    {"name":"selectedTargets","type":"json","label":"Group đã chọn"},
    {"name":"attemptedCount","type":"number","label":"Số group đã thử"}
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
  system_type = EXCLUDED.system_type,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name = 'fb_select_group_post_share_targets'
),
target_workflows AS (
  SELECT workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_group_post'
    AND workflow_id IS NOT NULL
  UNION
  SELECT test_workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_group_post'
    AND test_workflow_id IS NOT NULL
)
UPDATE public.auto_workflows AS wf
SET
  nodes = (
    SELECT COALESCE(jsonb_agg(node ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(wf.nodes, '[]'::jsonb)) WITH ORDINALITY AS t(node, ord)
    WHERE node->>'id' <> 'select_group_share_targets'
  ) || jsonb_build_array(
    jsonb_build_object(
      'id', 'select_group_share_targets',
      'label', 'Chọn group share kèm',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_select_group_post_share_targets'),
      'position', jsonb_build_object('x', 100, 'y', 430),
      'blockName', 'fb_select_group_post_share_targets'
    )
  ),
  edges = (
    SELECT COALESCE(jsonb_agg(edge ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(wf.edges, '[]'::jsonb)) WITH ORDINALITY AS t(edge, ord)
    WHERE edge->>'id' NOT IN (
      'e-open_composer-select_group_share_targets',
      'e-select_group_share_targets-type_content'
    )
      AND NOT (edge->>'source' = 'open_composer' AND edge->>'target' = 'type_content')
  ) || jsonb_build_array(
    jsonb_build_object('id', 'e-open_composer-select_group_share_targets', 'source', 'open_composer', 'target', 'select_group_share_targets'),
    jsonb_build_object('id', 'e-select_group_share_targets-type_content', 'source', 'select_group_share_targets', 'target', 'type_content')
  ),
  variables_schema = COALESCE(wf.variables_schema, '[]'::jsonb)
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'enableGroupPostShareToJoinedGroups'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'enableGroupPostShareToJoinedGroups',
        'type', 'boolean',
        'label', 'Đăng bài dạng chia sẻ'
      ))
      ELSE '[]'::jsonb
    END
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'groupPostShareTargets'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'groupPostShareTargets',
        'type', 'json',
        'label', 'Group share ứng viên'
      ))
      ELSE '[]'::jsonb
    END
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'groupPostShareMaxCount'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'groupPostShareMaxCount',
        'type', 'number',
        'label', 'Số group share tối đa'
      ))
      ELSE '[]'::jsonb
    END,
  default_variables = COALESCE(wf.default_variables, '{}'::jsonb)
    || jsonb_build_object(
      'enableGroupPostShareToJoinedGroups', false,
      'groupPostShareTargets', '[]'::jsonb,
      'groupPostShareMaxCount', 0
    ),
  updated_at = now()
FROM target_workflows
WHERE wf.id = target_workflows.id;

COMMIT;
