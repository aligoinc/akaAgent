-- Formatted content for Facebook group-post workflows.
-- DOM parity with akaBizAuto C# PostFb is intentional:
--   existing fb_composer_dialog -> focus -> facebookStepMs -> text/html paste
--   -> native insertText(' '), with no selector/coordinate/raw-HTML fallback.

BEGIN;

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(required.name, ', ' ORDER BY required.name)
  INTO v_missing
  FROM unnest(ARRAY[
    'fb_scrape_post',
    'fb_rewrite_source_content_ai',
    'fb_type_post_content'
  ]) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.auto_blocks AS block
    WHERE block.name = required.name
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration v173 requires block(s): %', v_missing;
  END IF;
END $$;

-- Keep the existing scrape DOM implementation byte-for-byte. Only separate
-- copied plain text from the campaign's canonical HTML at its final assembly.
DO $$
DECLARE
  v_code text;
  v_old_header text := $old$const link = String(input.sourceLink || vars.sourceLink || '').trim()
const appendContent = String(input.appendContent || vars.campaignContent || '')
if (!link) return { scrapedText: appendContent, scrapedImages: [] }$old$;
  v_new_header text := $new$const link = String(input.sourceLink || vars.sourceLink || '').trim()
const appendContent = String(input.appendContent || vars.campaignContent || '')
const formattedContentEnabled = vars.formattedContentEnabled === true
const manualContentNative = String(vars.manualContentNative || appendContent || vars.campaignContent || '')
const buildFormattedResult = (sourcePlain, scrapedImages) => {
  const sourceContentPlain = String(sourcePlain || '')
  vars.formattedManualContent = manualContentNative
  vars.copiedSourcePlainText = sourceContentPlain
  vars.sourceContentPlain = sourceContentPlain
  vars.campaignContent = manualContentNative
  return {
    scrapedText: sourceContentPlain,
    sourceContent: sourceContentPlain,
    copiedSourcePlainText: sourceContentPlain,
    sourceContentPlain,
    manualContentNative,
    campaignContent: manualContentNative,
    scrapedImages
  }
}
if (!link) {
  if (formattedContentEnabled) return buildFormattedResult('', [])
  return { scrapedText: appendContent, scrapedImages: [] }
}$new$;
  v_old_container_fallback text := $old$  vars.campaignContent = appendContent
  return { scrapedText: appendContent, scrapedImages: [] }$old$;
  v_new_container_fallback text := $new$  if (formattedContentEnabled) return buildFormattedResult('', [])
  vars.campaignContent = appendContent
  return { scrapedText: appendContent, scrapedImages: [] }$new$;
  v_old_assignment text := $old$vars.campaignContent = finalText$old$;
  v_new_assignment text := $new$if (!formattedContentEnabled) vars.campaignContent = finalText$new$;
  v_old_return text := $old$return { scrapedText: finalText, scrapedImages: scrapedImages }$old$;
  v_new_return text := $new$return formattedContentEnabled
  ? buildFormattedResult(scrapedText, scrapedImages)
  : { scrapedText: finalText, scrapedImages: scrapedImages }$new$;
BEGIN
  SELECT block.code
  INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_scrape_post'
  FOR UPDATE;

  -- This legacy block is stored with CRLF in production; normalize only line
  -- endings so the guarded replacements are deterministic.
  v_code := replace(v_code, E'\r\n', E'\n');

  IF strpos(v_code, 'const buildFormattedResult = (sourcePlain, scrapedImages) =>') = 0 THEN
    IF strpos(v_code, v_old_header) = 0
      OR strpos(v_code, v_old_container_fallback) = 0
      OR strpos(v_code, v_old_assignment) = 0
      OR strpos(v_code, v_old_return) = 0
    THEN
      RAISE EXCEPTION 'Migration v173 cannot safely patch fb_scrape_post; expected live-code fragments were not found';
    END IF;

    UPDATE public.auto_blocks
    SET
      code = replace(
        replace(
          replace(
            replace(v_code, v_old_header, v_new_header),
            v_old_container_fallback,
            v_new_container_fallback
          ),
          v_old_assignment,
          v_new_assignment
        ),
        v_old_return,
        v_new_return
      ),
      updated_at = now()
    WHERE name = 'fb_scrape_post';
  END IF;

  SELECT block.code INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_scrape_post';

  IF strpos(v_code, 'if (formattedContentEnabled) return buildFormattedResult('''', [])') = 0
    OR strpos(v_code, 'if (!formattedContentEnabled) vars.campaignContent = finalText') = 0
    OR strpos(v_code, 'copiedSourcePlainText: sourceContentPlain') = 0
  THEN
    RAISE EXCEPTION 'Migration v173 failed to separate fb_scrape_post formatted content';
  END IF;
END $$;

-- Preserve the promoted centralized-AI implementation. Formatted mode feeds AI
-- only the separate plain source and leaves the canonical manual HTML untouched.
DO $$
DECLARE
  v_code text;
  v_old_source text := $old$
const originalCampaignContent = trimText(vars.originalCampaignContent || vars.campaignContent)
const combinedContent = pickText(input.campaignContent, vars.campaignContent, input.content)
let sourceContent = pickText(
  input.sourceContent,
  input.scrapedContent,
  input.scrapedText,
  input.copiedSourceContent,
  input.copiedContent,
  input.postText,
  input.text
)

if (!sourceContent) {
  sourceContent = stripManualContent(combinedContent, originalCampaignContent) || trimText(combinedContent)
}
$old$;
  v_new_source text := $new$
const formattedContentEnabled = vars.formattedContentEnabled === true
const originalCampaignContent = trimText(vars.originalCampaignContent || vars.campaignContent)
const combinedContent = pickText(input.campaignContent, vars.campaignContent, input.content)
const formattedManualContent = toText(
  vars.formattedManualContent || vars.manualContentNative || originalCampaignContent || vars.campaignContent
)
let sourceContent = formattedContentEnabled
  ? pickText(
      input.copiedSourcePlainText,
      input.sourceContentPlain,
      vars.copiedSourcePlainText,
      vars.sourceContentPlain
    )
  : pickText(
      input.sourceContent,
      input.scrapedContent,
      input.scrapedText,
      input.copiedSourceContent,
      input.copiedContent,
      input.postText,
      input.text
    )

if (!sourceContent && !formattedContentEnabled) {
  sourceContent = stripManualContent(combinedContent, originalCampaignContent) || trimText(combinedContent)
}
$new$;
  v_old_success text := $old$
  const finalContent = buildFinalContent(combinedContent, sourceContent, rewrittenSourceContent, originalCampaignContent)
  vars.campaignContent = finalContent
$old$;
  v_new_success text := $new$
  const finalContent = formattedContentEnabled
    ? formattedManualContent
    : buildFinalContent(combinedContent, sourceContent, rewrittenSourceContent, originalCampaignContent)
  if (formattedContentEnabled) {
    vars.formattedManualContent = formattedManualContent
    vars.copiedSourcePlainText = rewrittenSourceContent
    vars.sourceContentPlain = rewrittenSourceContent
  }
  vars.campaignContent = finalContent
$new$;
  v_old_return_fields text := $old$
    copiedSourceContent: rewrittenSourceContent,
    content: finalContent,
$old$;
  v_new_return_fields text := $new$
    copiedSourceContent: rewrittenSourceContent,
    ...(formattedContentEnabled
      ? {
          copiedSourcePlainText: rewrittenSourceContent,
          sourceContentPlain: rewrittenSourceContent,
          manualContentNative: formattedManualContent
        }
      : {}),
    content: finalContent,
$new$;
BEGIN
  SELECT block.code
  INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_rewrite_source_content_ai'
  FOR UPDATE;

  IF strpos(v_code, 'const formattedContentEnabled = vars.formattedContentEnabled === true') = 0 THEN
    IF strpos(v_code, v_old_source) = 0
      OR strpos(v_code, v_old_success) = 0
      OR strpos(v_code, v_old_return_fields) = 0
    THEN
      RAISE EXCEPTION 'Migration v173 cannot safely patch fb_rewrite_source_content_ai; expected promoted-code fragments were not found';
    END IF;

    UPDATE public.auto_blocks
    SET
      code = replace(
        replace(
          replace(code, v_old_source, v_new_source),
          v_old_success,
          v_new_success
        ),
        v_old_return_fields,
        v_new_return_fields
      ),
      updated_at = now()
    WHERE name = 'fb_rewrite_source_content_ai';
  END IF;

  SELECT block.code INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_rewrite_source_content_ai';

  IF strpos(v_code, 'if (!sourceContent && !formattedContentEnabled)') = 0
    OR strpos(v_code, 'vars.sourceContentPlain = rewrittenSourceContent') = 0
  THEN
    RAISE EXCEPTION 'Migration v173 failed to separate formatted source-AI content';
  END IF;
END $$;

-- Compose the copied source (plain) and manual content (HTML) immediately before
-- typing. DOMParser is used as an allow-list sanitizer; no selector is queried.
INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin,
  staff_id, organization_id, updated_at
)
VALUES (
  'fb_compose_source_manual_content',
  'Ghép nội dung nguồn plain với nội dung định dạng trước khi paste lên Facebook.',
  'FileType2',
  'facebook',
  'js',
  NULL,
$block$
if (vars.formattedContentEnabled !== true) return input

const sourceContentPlain = String(
  vars.copiedSourcePlainText || vars.sourceContentPlain || input.copiedSourcePlainText || input.sourceContentPlain || ''
)
const manualContentNative = String(
  vars.formattedManualContent || vars.manualContentNative || vars.campaignContent || ''
)

const composed = await page.evaluate(String.raw`
  const source = String(__args[0] || '');
  const manual = String(__args[1] || '');
  const allowed = new Set([
    'p', 'div', 'br', 'h1', 'h2', 'h3',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
    'ul', 'ol', 'li', 'blockquote', 'a'
  ]);
  const discardWithContent = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math']);
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const renderNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = String(node.tagName || '').toLowerCase();
    if (discardWithContent.has(tag)) return '';
    let children = Array.from(node.childNodes || []).map(renderNode).join('');
    if (!allowed.has(tag)) return children;
    if (tag === 'br') return '<br>';
    let attrs = '';
    const styles = [];
    if (tag === 'a') {
      const href = String(node.getAttribute('href') || '').trim();
      if (/^https?:\/\//i.test(href)) attrs += ' href="' + escapeHtml(href) + '"';
    }
    const style = String(node.getAttribute('style') || '');
    const align = style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i);
    if (align && (tag === 'p' || /^h[1-3]$/.test(tag))) {
      styles.push('text-align: ' + align[1].toLowerCase());
    }
    const indentRaw = String(node.getAttribute('data-indent') || '').trim();
    const parsedIndent = Number(indentRaw);
    const indent = /^\d+$/.test(indentRaw) && Number.isSafeInteger(parsedIndent) && parsedIndent > 0
      ? Math.min(8, parsedIndent)
      : 0;
    const hasVisibleContent = String(node.textContent || '').replace(/\u00a0/g, ' ').trim().length > 0;
    if (indent > 0 && hasVisibleContent && !node.closest('li') && (tag === 'p' || /^h[1-3]$/.test(tag))) {
      children = '&#160;'.repeat(indent * 6) + children;
    }
    if (styles.length > 0) attrs += ' style="' + styles.join('; ') + '"';
    return '<' + tag + attrs + '>' + children + '</' + tag + '>';
  };
  const parsed = new DOMParser().parseFromString(manual, 'text/html');
  const safeManual = Array.from(parsed.body.childNodes || []).map(renderNode).join('').trim();
  const safeSource = source
    ? source
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line ? '<p>' + escapeHtml(line) + '</p>' : '<p><br></p>')
      .join('')
      .trim()
    : '';
  return [safeSource, safeManual].filter(Boolean).join('<p><br></p>');
`, sourceContentPlain, manualContentNative)

vars.formattedManualContent = manualContentNative
vars.copiedSourcePlainText = sourceContentPlain
vars.sourceContentPlain = sourceContentPlain
vars.campaignContent = String(composed || '')

return {
  ...input,
  content: vars.campaignContent,
  campaignContent: vars.campaignContent,
  copiedSourcePlainText: sourceContentPlain,
  sourceContentPlain,
  manualContentNative
}
$block$,
  '[]'::jsonb,
  '[
    {"name":"campaignContent","type":"string","label":"HTML đã ghép"},
    {"name":"sourceContentPlain","type":"string","label":"Nội dung nguồn plain"},
    {"name":"manualContentNative","type":"string","label":"HTML do người dùng nhập"}
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

DO $$
DECLARE
  v_code text;
BEGIN
  SELECT block.code INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_compose_source_manual_content';

  IF strpos(v_code, 'node.getAttribute(''data-indent'')') = 0
    OR strpos(v_code, 'children = ''&#160;''.repeat(indent * 6) + children') = 0
    OR strpos(v_code, 'const hasVisibleContent = ') = 0
    OR strpos(v_code, '!node.closest(''li'')') = 0
    OR strpos(v_code, 'margin-left') <> 0
  THEN
    RAISE EXCEPTION 'Migration v173 failed to project guarded Facebook indentation as non-breaking spaces';
  END IF;
END $$;

-- Patch only the data-entry branch in the shared type block. Plain content and
-- every workflow with formattedContentEnabled=false retain page.fill verbatim.
DO $$
DECLARE
  v_code text;
  v_old_rewrite_flag text := $old$const shouldRewriteContentEachRun = vars.rewriteContentEachRun === true$old$;
  v_new_rewrite_flag text := $new$const formattedContentEnabled = vars.formattedContentEnabled === true
const shouldRewriteContentEachRun = vars.rewriteContentEachRun === true && !formattedContentEnabled
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')$new$;
  v_old_name_replace text := $old$    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)$old$;
  v_new_name_replace text := $new$    rendered = rendered.replace(
      /#\{\s*FULL_NAME\s*\}/gi,
      formattedContentEnabled ? escapeHtml(fullName) : fullName
    )$new$;
  v_old_dialog_wait text := $old$const dialog = await helpers.element('fb_composer_dialog')
await page.waitForSelector(dialog, { timeout: 10000 })
await helpers.sleep(800, signal)$old$;
  v_new_dialog_wait text := $new$const dialog = await helpers.element('fb_composer_dialog')
await page.waitForSelector(dialog, { timeout: 10000 })
if (!formattedContentEnabled) await helpers.sleep(800, signal)$new$;
  v_old_background text := $old$if (vars.postWithBackground === true && String(text || '').trim()) {$old$;
  v_new_background text := $new$if (!formattedContentEnabled && vars.postWithBackground === true && String(text || '').trim()) {$new$;
  v_old_formatted_text text := $old$text = String(text || '').replace(/\t/g, '      ')$old$;
  v_new_formatted_text text := $new$text = String(text || '')$new$;
  v_old_fill text := $old$await page.fill(dialog, text)
return { typed: true, content: text, rewrittenContent: shouldRewriteContentEachRun }$old$;
  v_new_fill text := $new$if (formattedContentEnabled) {
  text = String(text || '')
  await page.focus(dialog)
  await helpers.sleep(Number(vars.facebookStepMs || input.facebookStepMs || 1000), signal)
  try {
    await page.paste(dialog, text, { mimeType: 'text/html' })
  } catch (e) {
    if (signal && signal.aborted) throw e
    await page.paste(dialog, text, { mimeType: 'text/html' })
  }
  await page.insertText(' ')
} else {
  await page.fill(dialog, text)
}
return { typed: true, content: text, rewrittenContent: shouldRewriteContentEachRun }$new$;
BEGIN
  SELECT block.code
  INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_type_post_content'
  FOR UPDATE;

  IF strpos(v_code, 'await page.paste(dialog, text, { mimeType: ''text/html'' })') = 0 THEN
    IF strpos(v_code, v_old_rewrite_flag) = 0
      OR strpos(v_code, v_old_name_replace) = 0
      OR strpos(v_code, v_old_dialog_wait) = 0
      OR strpos(v_code, v_old_background) = 0
      OR strpos(v_code, v_old_fill) = 0
    THEN
      RAISE EXCEPTION 'Migration v173 cannot safely patch fb_type_post_content; expected promoted-code fragments were not found';
    END IF;

    UPDATE public.auto_blocks
    SET
      code = replace(
        replace(
          replace(
            replace(
              replace(code, v_old_rewrite_flag, v_new_rewrite_flag),
              v_old_name_replace,
              v_new_name_replace
            ),
            v_old_dialog_wait,
            v_new_dialog_wait
          ),
          v_old_background,
          v_new_background
        ),
        v_old_fill,
        v_new_fill
      ),
      updated_at = now()
    WHERE name = 'fb_type_post_content';
  END IF;

  SELECT block.code INTO v_code
  FROM public.auto_blocks AS block
  WHERE block.name = 'fb_type_post_content';

  -- v173 may already have installed the HTML-paste branch. Upgrade that live
  -- block separately so any literal tabs in formatted content are not turned
  -- into collapsible ordinary spaces before paste.
  IF strpos(v_code, v_old_formatted_text) > 0 THEN
    UPDATE public.auto_blocks
    SET
      code = replace(code, v_old_formatted_text, v_new_formatted_text),
      updated_at = now()
    WHERE name = 'fb_type_post_content';

    SELECT block.code INTO v_code
    FROM public.auto_blocks AS block
    WHERE block.name = 'fb_type_post_content';
  END IF;

  IF strpos(v_code, 'await page.focus(dialog)') = 0
    OR strpos(v_code, 'helpers.element(''fb_composer_dialog'')') = 0
    OR strpos(v_code, 'mimeType: ''text/html''') = 0
    OR strpos(v_code, 'await page.insertText('' '')') = 0
    OR strpos(v_code, 'if (!formattedContentEnabled) await helpers.sleep(800, signal)') = 0
    OR strpos(v_code, 'await page.fill(dialog, text)') = 0
    OR strpos(v_code, v_new_formatted_text) = 0
    OR strpos(v_code, v_old_formatted_text) <> 0
  THEN
    RAISE EXCEPTION 'Migration v173 failed to install guarded Facebook HTML paste';
  END IF;
END $$;

CREATE TEMP TABLE _v173_group_workflows (
  id bigint PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _v173_group_workflows (id)
SELECT action.workflow_id
FROM public.auto_campaign_actions AS action
WHERE action.id = 'facebook_group_post'
  AND action.workflow_id IS NOT NULL
UNION
SELECT action.test_workflow_id
FROM public.auto_campaign_actions AS action
WHERE action.id = 'facebook_group_post'
  AND action.test_workflow_id IS NOT NULL;

DO $$
DECLARE
  v_missing_workflow_count integer;
  v_missing_type_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_actions AS action
    WHERE action.id = 'facebook_group_post'
      AND action.workflow_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Migration v173 requires a production workflow for facebook_group_post';
  END IF;

  SELECT count(*) INTO v_missing_workflow_count
  FROM _v173_group_workflows AS target
  LEFT JOIN public.auto_workflows AS workflow ON workflow.id = target.id
  WHERE workflow.id IS NULL;

  IF v_missing_workflow_count <> 0 THEN
    RAISE EXCEPTION 'Migration v173 references % missing facebook_group_post workflow(s)', v_missing_workflow_count;
  END IF;

  SELECT count(*) INTO v_missing_type_count
  FROM _v173_group_workflows AS target
  JOIN public.auto_workflows AS workflow ON workflow.id = target.id
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(workflow.nodes, '[]'::jsonb)) AS item(node)
    WHERE item.node->>'id' = 'type_content'
      AND item.node->>'blockName' = 'fb_type_post_content'
  );

  IF v_missing_type_count <> 0 THEN
    RAISE EXCEPTION 'Migration v173 requires type_content/fb_type_post_content in every collected group workflow';
  END IF;
END $$;

UPDATE public.auto_workflows AS workflow
SET
  nodes = (
    SELECT COALESCE(jsonb_agg(item.node ORDER BY item.ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(workflow.nodes, '[]'::jsonb)) WITH ORDINALITY AS item(node, ord)
    WHERE item.node->>'id' <> 'compose_formatted_content'
  ) || jsonb_build_array(
    jsonb_build_object(
      'id', 'compose_formatted_content',
      'label', 'Ghép nội dung nguồn và nội dung định dạng',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM public.auto_blocks WHERE name = 'fb_compose_source_manual_content'),
      'position', jsonb_build_object('x', 100, 'y', 500),
      'blockName', 'fb_compose_source_manual_content'
    )
  ),
  edges = (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN item.edge->>'target' = 'type_content'
            AND item.edge->>'source' <> 'compose_formatted_content'
          THEN jsonb_set(item.edge, '{target}', to_jsonb('compose_formatted_content'::text))
          ELSE item.edge
        END
        ORDER BY item.ord
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(workflow.edges, '[]'::jsonb)) WITH ORDINALITY AS item(edge, ord)
    WHERE item.edge->>'id' <> 'e-compose-formatted-content-type-content'
      AND NOT (
        item.edge->>'source' = 'compose_formatted_content'
        AND item.edge->>'target' = 'type_content'
      )
  ) || jsonb_build_array(
    jsonb_build_object(
      'id', 'e-compose-formatted-content-type-content',
      'source', 'compose_formatted_content',
      'target', 'type_content'
    )
  ),
  variables_schema = COALESCE(workflow.variables_schema, '[]'::jsonb)
    || CASE
      WHEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(workflow.variables_schema, '[]'::jsonb)) AS item(variable)
        WHERE item.variable->>'name' = 'formattedContentEnabled'
      )
      THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'name', 'formattedContentEnabled',
        'type', 'boolean',
        'label', 'Nội dung có định dạng'
      ))
    END,
  default_variables = COALESCE(workflow.default_variables, '{}'::jsonb)
    || '{"formattedContentEnabled":false}'::jsonb,
  updated_at = now()
WHERE workflow.id IN (SELECT id FROM _v173_group_workflows);

DO $$
DECLARE
  v_invalid_count integer;
BEGIN
  SELECT count(*) INTO v_invalid_count
  FROM _v173_group_workflows AS target
  JOIN public.auto_workflows AS workflow ON workflow.id = target.id
  WHERE (
      SELECT count(*)
      FROM jsonb_array_elements(COALESCE(workflow.nodes, '[]'::jsonb)) AS item(node)
      WHERE item.node->>'id' = 'compose_formatted_content'
        AND item.node->>'blockName' = 'fb_compose_source_manual_content'
    ) <> 1
    OR (
      SELECT count(*)
      FROM jsonb_array_elements(COALESCE(workflow.edges, '[]'::jsonb)) AS item(edge)
      WHERE item.edge->>'source' = 'compose_formatted_content'
        AND item.edge->>'target' = 'type_content'
    ) <> 1
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(workflow.edges, '[]'::jsonb)) AS item(edge)
      WHERE item.edge->>'target' = 'type_content'
        AND item.edge->>'source' <> 'compose_formatted_content'
    );

  IF v_invalid_count <> 0 THEN
    RAISE EXCEPTION 'Migration v173 failed to wire formatted-content compose node safely';
  END IF;
END $$;

COMMIT;
