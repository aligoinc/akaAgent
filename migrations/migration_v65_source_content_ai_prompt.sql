-- Migration v65: AI prompt rewrite for copied source content.

BEGIN;

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES (
  'fb_rewrite_source_content_ai',
  'Edit riêng phần nội dung copy từ nguồn bằng prompt AI trước khi đăng bài.',
  'WandSparkles',
  'facebook',
  'js',
  NULL,
$block$
const toText = (value) => value === undefined || value === null ? '' : String(value)
const trimText = (value) => toText(value).trim()
const pickText = (...values) => {
  for (const value of values) {
    const text = trimText(value)
    if (text) return text
  }
  return ''
}
const pickPayloadValue = (obj, lowerKey, upperKey) => {
  if (!obj || typeof obj !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(obj, lowerKey)) return obj[lowerKey]
  if (Object.prototype.hasOwnProperty.call(obj, upperKey)) return obj[upperKey]
  return undefined
}
const extractAiText = (value) => {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return pickText(
    value.content,
    value.Content,
    value.answer,
    value.Answer,
    value.text,
    value.Text,
    value.result,
    value.Result,
    value.message,
    value.Message
  )
}
const stripManualContent = (combined, manual) => {
  const source = trimText(combined)
  const suffix = trimText(manual)
  if (!source || !suffix || source === suffix) return ''
  const idx = source.lastIndexOf(suffix)
  if (idx < 0) return ''
  return (source.slice(0, idx) + source.slice(idx + suffix.length))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
const buildFinalContent = (combined, originalSource, rewrittenSource, manualContent) => {
  const current = trimText(combined)
  const source = trimText(originalSource)
  const rewritten = trimText(rewrittenSource)
  const manual = trimText(manualContent)
  if (!rewritten) return current
  if (current && source && current.includes(source)) {
    return current.replace(source, rewritten).trim()
  }
  return [rewritten, manual].filter(Boolean).join('\n\n')
}

if (vars.copyContentFromSource !== true || vars.rewriteSourceContentWithAI !== true) {
  return input
}

const rawPrompt = trimText(vars.sourceContentAiPrompt || input.sourceContentAiPrompt)
if (!rawPrompt) {
  helpers.log('Cảnh báo: Chưa có lời nhắc AI cho nội dung nguồn, dùng nội dung copy gốc.')
  return input
}

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

if (!sourceContent) {
  helpers.log('Cảnh báo: Không lấy được nội dung nguồn để gửi AI, tiếp tục với nội dung copy gốc.')
  return input
}

const question = /\[content\]/i.test(rawPrompt)
  ? rawPrompt.replace(/\[content\]/gi, sourceContent)
  : rawPrompt + '\nNội dung: ' + sourceContent

try {
  const response = await page.apiCall({
    url: 'https://api.akaapp.vn/api/AI/chat',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      question,
      source: 'aka_agent'
    },
    timeout: 120000
  })
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error('AI trả về lỗi ' + (response && response.status ? response.status : 'không xác định'))
  }

  const payload = response.data || {}
  const status = pickPayloadValue(payload, 'status', 'Status')
  const message = pickPayloadValue(payload, 'message', 'Message')
  const data = pickPayloadValue(payload, 'data', 'Data')
  const hasStatus = status !== undefined && status !== null && status !== ''
  const ok = !hasStatus || status === 1 || status === '1' || status === true || String(status).toLowerCase() === 'success'
  if (!ok) {
    throw new Error(trimText(message) || 'AI không thể xử lý nội dung nguồn lúc này.')
  }

  const rewrittenSourceContent = extractAiText(data || payload)
  if (!rewrittenSourceContent) {
    throw new Error('AI trả về nội dung nguồn không hợp lệ.')
  }

  const finalContent = buildFinalContent(combinedContent, sourceContent, rewrittenSourceContent, originalCampaignContent)
  vars.campaignContent = finalContent
  if (Array.isArray(input.images) && input.images.length > 0 && vars.includeSourceImages === true) {
    vars.images = input.images
  }

  helpers.log('Đã edit nội dung nguồn bằng AI')
  return {
    ...input,
    sourceContent: rewrittenSourceContent,
    scrapedContent: rewrittenSourceContent,
    scrapedText: rewrittenSourceContent,
    copiedSourceContent: rewrittenSourceContent,
    content: finalContent,
    campaignContent: finalContent,
    rewrittenSourceContentWithAI: true
  }
} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  helpers.log('Cảnh báo: AI edit nội dung nguồn lỗi, dùng nội dung copy gốc: ' + message)
  return {
    ...input,
    rewrittenSourceContentWithAI: false,
    sourceContentAiError: message
  }
}
$block$,
  '[
    {"name":"rewriteSourceContentWithAI","type":"boolean","label":"Lời nhắc AI - Edit lại nội dung"},
    {"name":"sourceContentAiPrompt","type":"textarea","label":"Lời nhắc AI","placeholder":"Viết lại nội dung sau: [content]"}
  ]'::jsonb,
  '[
    {"name":"campaignContent","type":"string","label":"Nội dung sau khi edit nguồn"},
    {"name":"sourceContent","type":"string","label":"Nội dung nguồn sau khi edit"},
    {"name":"rewrittenSourceContentWithAI","type":"boolean","label":"Đã edit nội dung nguồn bằng AI"}
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

WITH rewrite_block AS (
  SELECT id
  FROM public.auto_blocks
  WHERE name = 'fb_rewrite_source_content_ai'
)
UPDATE public.auto_workflows w
SET
  nodes = COALESCE(w.nodes, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'id', 'source_ai_prompt',
      'blockId', (SELECT id FROM rewrite_block),
      'blockName', 'fb_rewrite_source_content_ai',
      'label', 'AI edit nội dung nguồn',
      'position', jsonb_build_object('x', -120, 'y', 180),
      'config', '{}'::jsonb
    )
  ),
  edges = (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN edge_item.value->>'source' = 'scrape_source'
           AND edge_item.value->>'target' = 'merge_source'
          THEN edge_item.value || jsonb_build_object('target', 'source_ai_prompt')
          ELSE edge_item.value
        END
        ORDER BY edge_item.ord
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(w.edges, '[]'::jsonb)) WITH ORDINALITY AS edge_item(value, ord)
  ) || jsonb_build_array(
    jsonb_build_object('id', 'e-source-ai-merge', 'source', 'source_ai_prompt', 'target', 'merge_source')
  ),
  default_variables = COALESCE(w.default_variables, '{}'::jsonb)
    || '{"rewriteSourceContentWithAI":false,"sourceContentAiPrompt":""}'::jsonb,
  updated_at = now()
WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.nodes, '[]'::jsonb)) AS node_item(value)
    WHERE node_item.value->>'id' = 'scrape_source'
      AND node_item.value->>'blockName' = 'fb_scrape_post'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.nodes, '[]'::jsonb)) AS node_item(value)
    WHERE node_item.value->>'id' = 'merge_source'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.edges, '[]'::jsonb)) AS edge_item(value)
    WHERE edge_item.value->>'source' = 'scrape_source'
      AND edge_item.value->>'target' = 'merge_source'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.nodes, '[]'::jsonb)) AS node_item(value)
    WHERE node_item.value->>'id' = 'source_ai_prompt'
  );

WITH rewrite_block AS (
  SELECT id
  FROM public.auto_blocks
  WHERE name = 'fb_rewrite_source_content_ai'
)
UPDATE public.auto_workflows w
SET
  nodes = COALESCE(w.nodes, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'id', 'source_ai_prompt',
      'blockId', (SELECT id FROM rewrite_block),
      'blockName', 'fb_rewrite_source_content_ai',
      'label', 'AI edit nội dung nguồn',
      'position', jsonb_build_object('x', 200, 'y', 540),
      'config', '{}'::jsonb
    )
  ),
  edges = (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN edge_item.value->>'source' = 'scrape'
           AND edge_item.value->>'target' = 'nav_home_after_scrape'
          THEN edge_item.value || jsonb_build_object('target', 'source_ai_prompt')
          ELSE edge_item.value
        END
        ORDER BY edge_item.ord
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(w.edges, '[]'::jsonb)) WITH ORDINALITY AS edge_item(value, ord)
  ) || jsonb_build_array(
    jsonb_build_object('id', 'e-source-ai-nav-home-after-scrape', 'source', 'source_ai_prompt', 'target', 'nav_home_after_scrape')
  ),
  default_variables = COALESCE(w.default_variables, '{}'::jsonb)
    || '{"rewriteSourceContentWithAI":false,"sourceContentAiPrompt":""}'::jsonb,
  updated_at = now()
WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.nodes, '[]'::jsonb)) AS node_item(value)
    WHERE node_item.value->>'id' = 'scrape'
      AND node_item.value->>'blockName' = 'fb_scrape_post'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.nodes, '[]'::jsonb)) AS node_item(value)
    WHERE node_item.value->>'id' = 'nav_home_after_scrape'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.edges, '[]'::jsonb)) AS edge_item(value)
    WHERE edge_item.value->>'source' = 'scrape'
      AND edge_item.value->>'target' = 'nav_home_after_scrape'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.nodes, '[]'::jsonb)) AS node_item(value)
    WHERE node_item.value->>'id' = 'source_ai_prompt'
  );

UPDATE public.auto_workflows w
SET
  variables_schema = COALESCE(w.variables_schema, '[]'::jsonb)
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(w.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'rewriteSourceContentWithAI'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'rewriteSourceContentWithAI',
        'type', 'boolean',
        'label', 'Lời nhắc AI - Edit lại nội dung'
      ))
      ELSE '[]'::jsonb
    END
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(w.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'sourceContentAiPrompt'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'sourceContentAiPrompt',
        'type', 'textarea',
        'label', 'Lời nhắc AI',
        'placeholder', 'Viết lại nội dung sau: [content]'
      ))
      ELSE '[]'::jsonb
    END,
  updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(w.nodes, '[]'::jsonb)) AS node_item(value)
  WHERE node_item.value->>'blockName' IN ('fb_scrape_post', 'fb_rewrite_source_content_ai')
);

COMMIT;
