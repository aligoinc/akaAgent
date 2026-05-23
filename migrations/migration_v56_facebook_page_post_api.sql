-- Migration v56: Facebook fanpage post campaign via Graph API.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES ('facebook', 'Đăng bài fanpage', 'fb_post_page')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES (
  'fb_page_post_api',
  'Đăng bài lên fanpage bằng Facebook Graph API từ session Business hiện tại.',
  'Send',
  'facebook',
  'js',
  NULL,
$block$
const pageUid = String(vars.pageUid || input.pageUid || vars.inputDataUid || '').trim()
const pageName = String(vars.pageName || input.pageName || vars.inputDataName || '').trim()
const businessUrl = String(vars.businessUrl || input.businessUrl || 'https://business.facebook.com/content_management').trim()
const graphBaseUrl = String(vars.graphBaseUrl || input.graphBaseUrl || 'https://graph.facebook.com').replace(/\/+$/g, '')

if (!pageUid) throw new Error('Thiếu Page ID để đăng bài fanpage')
if (vars.pagePostMode && vars.pagePostMode !== 'api') {
  throw new Error('Đăng bài fanpage trên giao diện chưa được hỗ trợ trong phiên bản này')
}

const formatTemplateDate = (dayKey, formatKey) => {
  const d = new Date()
  const key = String(dayKey || 'TODAY').toUpperCase()
  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)
  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return String(formatKey || 'DD/MM/YYYY').toUpperCase() === 'MM/DD/YYYY'
    ? mm + '/' + dd + '/' + yyyy
    : dd + '/' + mm + '/' + yyyy
}

const renderContentTemplate = async (raw) => {
  let rendered = String(raw || '')
  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || pageName || '').trim()
    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  }
  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )
  return rendered
}

const rewriteContentForRun = async (raw) => {
  const original = String(raw || '')
  const content = original.trim()
  if (vars.rewriteContentEachRun !== true || !content) return original
  try {
    const response = await page.apiCall({
      url: 'https://api.akaapp.vn/api/AI/rewriteContent',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        content,
        questionContentName: 'rewrite_content',
        source: 'aka_agent'
      },
      timeout: 120000
    })
    if (response.status < 200 || response.status >= 300) throw new Error('AI trả về lỗi ' + response.status)
    const payload = response.data || {}
    const ok = payload.status === 1 || payload.status === '1'
    if (!ok) throw new Error(String(payload.message || 'AI không thể xử lý nội dung lúc này.'))
    if (typeof payload.data !== 'string') throw new Error('AI trả về nội dung không hợp lệ.')
    helpers.log('Đã viết lại nội dung bằng AI')
    return payload.data
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log('AI viết lại nội dung lỗi, dùng nội dung gốc: ' + message)
    return original
  }
}

let message = String(vars.campaignContent || input.campaignContent || '').trim()
message = (await renderContentTemplate(message)).trim()
message = (await rewriteContentForRun(message)).trim()

const images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])
  .map(item => String(item || '').trim())
  .filter(Boolean)

if (!message && images.length === 0) {
  throw new Error('Không có nội dung hoặc ảnh để đăng fanpage')
}

function graphUrl(path, params) {
  const qs = new URLSearchParams(params || {}).toString()
  return graphBaseUrl + '/' + String(path || '').replace(/^\/+/g, '') + (qs ? '?' + qs : '')
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function redactTokens(value) {
  if (Array.isArray(value)) return value.map(redactTokens)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value)) {
    if (/token/i.test(key)) continue
    out[key] = redactTokens(value[key])
  }
  return out
}

function graphErrorFromResponse(phase, response, fallbackMessage) {
  const data = asObject(response && response.data)
  const rawError = asObject(data.error)
  const rawData = typeof (response && response.data) === 'string' ? response.data : ''
  const message = String(
    rawError.message ||
    data.message ||
    fallbackMessage ||
    rawData ||
    'Facebook Graph API không trả chi tiết lỗi'
  ).trim()
  return {
    phase,
    status: Number(response && response.status || 0),
    message,
    type: rawError.type ? String(rawError.type) : undefined,
    code: rawError.code !== undefined ? rawError.code : undefined,
    error_subcode: rawError.error_subcode !== undefined ? rawError.error_subcode : undefined,
    fbtrace_id: rawError.fbtrace_id ? String(rawError.fbtrace_id) : undefined
  }
}

function graphErrorFromException(phase, error) {
  return {
    phase,
    status: 0,
    message: error && error.message ? String(error.message) : String(error || 'Lỗi gọi Facebook Graph API')
  }
}

function describeGraphError(error) {
  const parts = []
  if (error.message) parts.push(String(error.message))
  if (error.type) parts.push('type=' + error.type)
  if (error.code !== undefined) parts.push('code=' + error.code)
  if (error.error_subcode !== undefined) parts.push('subcode=' + error.error_subcode)
  if (error.fbtrace_id) parts.push('fbtrace_id=' + error.fbtrace_id)
  return parts.join(' | ') || 'Facebook Graph API lỗi'
}

function logGraphError(error) {
  const parts = ['Facebook API lỗi khi ' + error.phase + ': HTTP ' + (error.status || 'network')]
  if (error.message) parts.push('message=' + error.message)
  if (error.type) parts.push('type=' + error.type)
  if (error.code !== undefined) parts.push('code=' + error.code)
  if (error.error_subcode !== undefined) parts.push('subcode=' + error.error_subcode)
  if (error.fbtrace_id) parts.push('fbtrace_id=' + error.fbtrace_id)
  helpers.log(parts.join(' | '))
}

async function callGraph(phase, opts) {
  try {
    const response = await page.apiCall(opts)
    const data = asObject(response.data)
    if (response.status < 200 || response.status >= 300 || data.error) {
      const graphError = graphErrorFromResponse(phase, response)
      logGraphError(graphError)
      return { ok: false, status: response.status, data: redactTokens(response.data), graphError }
    }
    return { ok: true, status: response.status, data: response.data }
  } catch (e) {
    const graphError = graphErrorFromException(phase, e)
    logGraphError(graphError)
    return { ok: false, status: 0, data: null, graphError }
  }
}

function fail(graphError, extra) {
  return {
    ok: false,
    posted: false,
    pageUid,
    pageName,
    postId: '',
    postUrl: '',
    imageCount: 0,
    error: describeGraphError(graphError),
    graphError,
    ...(extra || {})
  }
}

function postUrlFromId(postId) {
  const id = String(postId || '').trim()
  if (!id) return ''
  const parts = id.split('_').filter(Boolean)
  if (parts.length >= 2) return 'https://www.facebook.com/' + parts[0] + '/posts/' + parts[1]
  return 'https://www.facebook.com/' + id
}

helpers.log('Mở Business/Facebook để lấy phiên đăng nhập')
await page.navigate(businessUrl)
await helpers.sleep(4000, signal)

helpers.log('Đang lấy user access token từ session Business')
const userAccessToken = await page.evaluate(`
  const sources = [];
  function add(value) {
    if (typeof value === 'string' && value) sources.push(value);
  }
  try { add(document.body ? document.body.innerHTML : ''); } catch (e) {}
  try { add(document.documentElement ? document.documentElement.innerHTML : ''); } catch (e) {}
  try {
    for (const script of Array.from(document.scripts || [])) {
      add(script.textContent || script.innerText || '');
    }
  } catch (e) {}
  for (const source of sources) {
    const match = source.match(/EAAG[A-Za-z0-9_\\-]{20,}/);
    if (match && match[0]) return match[0];
  }
  const body = sources.join(' ');
  const legacy = body.match(/EAAG(.*?)"/);
  return legacy && legacy[1] ? 'EAAG' + legacy[1] : '';
`)

if (!userAccessToken) {
  throw new Error('Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.')
}
helpers.log('Đã lấy user token từ session hiện tại')

const cookieHeader = await page.getCookieHeader('https://graph.facebook.com/')
const graphHeaders = {
  Accept: 'application/json',
  ...(cookieHeader ? { Cookie: cookieHeader } : {})
}

helpers.log('Đang lấy page access token cho fanpage ' + (pageName || pageUid))
const pageTokenResponse = await callGraph('lấy page token', {
  url: graphUrl(pageUid, { fields: 'access_token', access_token: userAccessToken }),
  method: 'GET',
  headers: graphHeaders,
  timeout: 30000
})
if (!pageTokenResponse.ok) return fail(pageTokenResponse.graphError, { graphResponse: redactTokens(pageTokenResponse.data) })

const pageTokenData = asObject(pageTokenResponse.data)
const pageAccessToken = String(pageTokenData.access_token || '').trim()
if (!pageAccessToken) {
  const graphError = {
    phase: 'lấy page token',
    status: Number(pageTokenResponse.status || 200),
    message: 'Graph API không trả page access_token. Kiểm tra quyền pages_manage_posts/pages_read_engagement và quyền quản lý page.'
  }
  logGraphError(graphError)
  return fail(graphError)
}
helpers.log('Đã lấy page token, chuẩn bị đăng bài')

const mediaFbids = []
for (let i = 0; i < images.length; i++) {
  const imagePath = images[i]
  const phase = 'upload ảnh ' + (i + 1) + '/' + images.length
  helpers.log('Đang ' + phase + ' lên fanpage')
  const uploadResponse = await callGraph(phase, {
    url: graphUrl(pageUid + '/photos'),
    method: 'POST',
    headers: graphHeaders,
    bodyType: 'multipart',
    body: {
      access_token: pageAccessToken,
      published: 'false',
      temporary: 'true'
    },
    files: [{ field: 'source', path: imagePath }],
    timeout: 120000
  })
  if (!uploadResponse.ok) {
    return fail(uploadResponse.graphError, {
      imageCount: mediaFbids.length,
      graphResponse: redactTokens(uploadResponse.data)
    })
  }
  const photoId = String(asObject(uploadResponse.data).id || '').trim()
  if (!photoId) {
    const graphError = {
      phase,
      status: Number(uploadResponse.status || 200),
      message: 'Facebook không trả photo_id sau khi upload ảnh'
    }
    logGraphError(graphError)
    return fail(graphError, { imageCount: mediaFbids.length, graphResponse: redactTokens(uploadResponse.data) })
  }
  mediaFbids.push(photoId)
}

helpers.log('Đang đăng bài lên fanpage ' + (pageName || pageUid))
const feedBody = {
  access_token: pageAccessToken,
  published: 'true'
}
if (message) feedBody.message = message
for (let i = 0; i < mediaFbids.length; i++) {
  feedBody['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: mediaFbids[i] })
}

const feedResponse = await callGraph('đăng feed', {
  url: graphUrl(pageUid + '/feed'),
  method: 'POST',
  headers: graphHeaders,
  bodyType: 'form',
  body: feedBody,
  timeout: 60000
})
if (!feedResponse.ok) {
  return fail(feedResponse.graphError, {
    imageCount: mediaFbids.length,
    graphResponse: redactTokens(feedResponse.data)
  })
}

const postId = String(asObject(feedResponse.data).id || '').trim()
if (!postId) {
  const graphError = {
    phase: 'đăng feed',
    status: Number(feedResponse.status || 200),
    message: 'Facebook không trả id bài viết sau khi đăng feed'
  }
  logGraphError(graphError)
  return fail(graphError, { imageCount: mediaFbids.length, graphResponse: redactTokens(feedResponse.data) })
}

const postUrl = postUrlFromId(postId)
helpers.log('Đăng bài fanpage thành công: ' + postId)

return {
  ok: true,
  posted: true,
  pageUid,
  pageName,
  postId,
  postUrl,
  imageCount: mediaFbids.length,
  graphResponse: redactTokens(feedResponse.data)
}
$block$,
  '[
    {"name":"pageUid","type":"string","label":"Page ID"},
    {"name":"pageName","type":"string","label":"Tên page"},
    {"name":"businessUrl","type":"string","label":"Business URL"},
    {"name":"campaignContent","type":"string","label":"Nội dung"},
    {"name":"images","type":"array","label":"Ảnh"}
  ]'::jsonb,
  '[
    {"name":"ok","type":"boolean","label":"OK"},
    {"name":"posted","type":"boolean","label":"Đã đăng"},
    {"name":"postId","type":"string","label":"Post ID"},
    {"name":"postUrl","type":"string","label":"Post URL"},
    {"name":"imageCount","type":"number","label":"Số ảnh"},
    {"name":"graphError","type":"json","label":"Graph error"}
  ]'::jsonb,
  '{"businessUrl":"https://business.facebook.com/content_management"}'::jsonb,
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
  WHERE name IN ('if_else', 'fb_scrape_post', 'merge', 'fb_page_post_api')
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  'facebook_page_post_api',
  'Workflow đăng bài lên fanpage Facebook bằng Graph API.',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'if_copy_source',
      'label', 'Có copy nguồn?',
      'config', jsonb_build_object('condition', 'vars.copyContentFromSource === true && !!vars.sourceLink'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'position', jsonb_build_object('x', 0, 'y', 0),
      'blockName', 'if_else',
      'systemType', 'ifElse'
    ),
    jsonb_build_object(
      'id', 'scrape_source',
      'label', 'Copy nội dung nguồn',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scrape_post'),
      'position', jsonb_build_object('x', -160, 'y', 120),
      'blockName', 'fb_scrape_post'
    ),
    jsonb_build_object(
      'id', 'merge_source',
      'label', 'Gộp nguồn',
      'config', jsonb_build_object('mode', 'any'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'merge'),
      'position', jsonb_build_object('x', 0, 'y', 240),
      'blockName', 'merge',
      'systemType', 'merge'
    ),
    jsonb_build_object(
      'id', 'post_page_api',
      'label', 'Đăng fanpage bằng API',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_page_post_api'),
      'position', jsonb_build_object('x', 0, 'y', 360),
      'blockName', 'fb_page_post_api'
    )
  ),
  '[
    {"id":"e-if-copy-true","source":"if_copy_source","target":"scrape_source","sourceHandle":"true"},
    {"id":"e-if-copy-false","source":"if_copy_source","target":"merge_source","sourceHandle":"false"},
    {"id":"e-scrape-merge","source":"scrape_source","target":"merge_source"},
    {"id":"e-merge-post","source":"merge_source","target":"post_page_api"}
  ]'::jsonb,
  '[
    {"name":"pageUid","type":"string","label":"Page ID"},
    {"name":"pageName","type":"string","label":"Tên page"},
    {"name":"campaignContent","type":"string","label":"Nội dung"},
    {"name":"images","type":"array","label":"Ảnh"},
    {"name":"copyContentFromSource","type":"boolean","label":"Copy nội dung từ nguồn"},
    {"name":"includeSourceImages","type":"boolean","label":"Lấy kèm hình ảnh"},
    {"name":"sourceLink","type":"string","label":"Link nguồn"},
    {"name":"pagePostMode","type":"string","label":"Chế độ đăng"}
  ]'::jsonb,
  '{"businessUrl":"https://business.facebook.com/content_management","pagePostMode":"api","published":true}'::jsonb,
  true,
  NULL,
  NULL,
  now()
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  nodes = EXCLUDED.nodes,
  edges = EXCLUDED.edges,
  variables_schema = EXCLUDED.variables_schema,
  default_variables = EXCLUDED.default_variables,
  is_builtin = true,
  updated_at = now();

INSERT INTO public.auto_campaign_actions (
  id, name, flatform_type, is_active, workflow_id, limit_check_action_codes, is_delete, created_at
)
VALUES (
  'facebook_page_post',
  'Facebook - Đăng bài lên fanpage',
  'facebook',
  true,
  (SELECT id FROM public.auto_workflows WHERE name = 'facebook_page_post_api'),
  ARRAY['fb_post_page']::text[],
  false,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = true,
  workflow_id = EXCLUDED.workflow_id,
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

NOTIFY pgrst, 'reload schema';

COMMIT;
