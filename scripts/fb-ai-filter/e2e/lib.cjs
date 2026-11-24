// Kiểm thử đầu-cuối bộ lọc AI bài / comment Facebook: đọc cấu hình đang chạy trên production (ai_using / ai_prompt / ai_model, code block)
// qua REST, dựng yêu cầu AI đúng như Desktop (renderTemplate + buildChatCompletionsBody / buildOpenAiResponsesBody của aiRuntimeService.ts),
// gọi thẳng nhà cung cấp, đọc câu trả lời như extractResponseText. Khoá chỉ giữ trong bộ nhớ, không in, không ghi ra tệp.
// Câu trả lời được nhớ theo md5 thân yêu cầu ở <DATA>/cache.jsonl để chạy lại không tốn tiền.
// Chạy với NODE_USE_ENV_PROXY=1 (đi qua proxy của phiên cloud).
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const REST = process.env.AKA_REST || 'https://cgjbsmqtfhqvttudyjzq.supabase.co/rest/v1'
const DATA = process.env.E2E_DATA || path.join(process.cwd(), 'e2e-data')
fs.mkdirSync(DATA, { recursive: true })

async function rest(q) {
  const r = await fetch(REST + q, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`REST ${r.status} ${q.slice(0, 120)}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}
const inList = xs => `in.(${xs.map(x => encodeURIComponent(x)).join(',')})`

// ---- Bản chép nguyên văn từ src/main/services/aiRuntimeService.ts ----
function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
function renderTemplate(template, payload) {
  let output = String(template || '')
  for (const [key, value] of Object.entries(payload)) {
    const text = toText(value)
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    output = output
      .replace(new RegExp(`\\[${escapedKey}\\]`, 'gi'), () => text)
      .replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'gi'), () => text)
  }
  return output
}
const toRecord = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
function buildBody(cfg, payload) {
  const systemPrompt = renderTemplate(cfg.prompt.prompt_system || '', payload).trim()
  const userPrompt = renderTemplate(cfg.prompt.prompt_user || '', payload).trim()
  const base = { ...toRecord(cfg.model.default_body), ...toRecord(cfg.using.request_options), model: cfg.model.model }
  const endpoint = cfg.model.endpoint.toLowerCase()
  if (cfg.model.provider.toLowerCase() === 'openai' && endpoint.includes('/responses')) {
    const body = { ...base }
    if (systemPrompt) body.instructions = systemPrompt
    body.input = [{ role: 'user', content: [{ type: 'input_text', text: userPrompt }] }]
    return { body, systemPrompt, userPrompt }
  }
  const messages = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: userPrompt })
  return { body: { ...base, stream: false, messages }, systemPrompt, userPrompt }
}
function extractResponseText(raw) {
  if (typeof raw === 'string') return raw.trim()
  const data = toRecord(raw)
  if (typeof data.output_text === 'string') return data.output_text.trim()
  const dataValue = data.data ?? data.Data ?? data.message ?? data.Message
  if (typeof dataValue === 'string') return dataValue.trim()
  const choice = toRecord((Array.isArray(data.choices) ? data.choices : [])[0])
  const choiceContent = toRecord(choice.message).content ?? choice.text
  if (typeof choiceContent === 'string') return choiceContent.trim()
  const parts = []
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const c of Array.isArray(toRecord(item).content) ? item.content : []) {
      if ((c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') parts.push(c.text)
    }
  }
  return parts.join('\n').trim()
}
// ---- hết phần chép ----

async function loadConfigs(codes) {
  const using = await rest(`/ai_using?select=id,code,model_id,prompt_id,request_options,timeout_ms,response_path,is_active&code=${inList(codes)}`)
  const prompts = await rest(`/ai_prompt?select=id,code,prompt_system,prompt_user&id=${inList(using.map(u => String(u.prompt_id)))}`)
  const models = await rest(`/ai_model?select=id,code,provider,model,endpoint,api_key,default_body,is_active&id=${inList([...new Set(using.map(u => String(u.model_id)))])}`)
  const out = {}
  for (const u of using) {
    out[u.code] = { using: u, prompt: prompts.find(p => p.id === u.prompt_id), model: models.find(m => m.id === u.model_id) }
    // Thử request_options chưa đưa lên (chỉ cho mã lọc chính, không cho mã dự phòng).
    if (process.env.E2E_REQUEST_OPTIONS && u.code !== 'fb_ai_content_filter_fallback') out[u.code].using = { ...u, request_options: JSON.parse(process.env.E2E_REQUEST_OPTIONS) }
    // Thử lời dặn chưa đưa lên: E2E_PROMPT_DIR có system.txt / user.txt thay cho lời dặn đang chạy của mọi mã lọc.
    if (process.env.E2E_PROMPT_DIR) {
      const dir = process.env.E2E_PROMPT_DIR
      out[u.code].prompt = { ...out[u.code].prompt, prompt_system: fs.readFileSync(path.join(dir, 'system.txt'), 'utf8').trim(), prompt_user: fs.readFileSync(path.join(dir, 'user.txt'), 'utf8').trim() }
    }
  }
  return out
}
async function loadModel(code) {
  const [m] = await rest(`/ai_model?select=id,code,provider,model,endpoint,api_key,default_body&code=eq.${code}`)
  return m
}
async function loadBlocks(ids) {
  return rest(`/auto_blocks?select=id,name,code&id=${inList(ids.map(String))}&order=id`)
}

// ---- gọi nhà cung cấp, có nhớ ----
const cachePath = path.join(DATA, 'cache.jsonl')
const cache = new Map()
if (fs.existsSync(cachePath)) {
  for (const line of fs.readFileSync(cachePath, 'utf8').split('\n')) {
    if (!line) continue
    try { const x = JSON.parse(line); cache.set(x.k, x.v) } catch {}
  }
}
const stats = { calls: 0, cached: 0, inTok: 0, outTok: 0, errors: 0 }
let active = 0
const waiters = []
const CONC = Number(process.env.E2E_CONCURRENCY || 8)
async function slot(fn) {
  while (active >= CONC) await new Promise(r => waiters.push(r))
  active++
  try { return await fn() } finally { active--; const w = waiters.shift(); if (w) w() }
}
async function httpCall(model, body, timeoutMs, { headers = null } = {}) {
  const h = headers || { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${model.api_key}` }
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(model.endpoint, { method: 'POST', headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
      const text = await r.text()
      let raw = text
      try { raw = text ? JSON.parse(text) : {} } catch {}
      // 429 / 5xx của chính môi trường thử (tải dồn) thì chờ rồi gửi lại; còn lại trả về như thật.
      if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 3) { await new Promise(s => setTimeout(s, 3000 * (attempt + 1))); lastErr = r.status; continue }
      return { status: r.status, raw }
    } catch (e) { lastErr = e; if (attempt < 3) await new Promise(s => setTimeout(s, 2000)) }
  }
  return { status: 0, raw: String(lastErr && lastErr.message || lastErr) }
}
// Như callAiUsing: trả { ok, content } hoặc { ok:false, error } cùng câu lỗi.
async function callAiUsing(cfg, payload, { noCache = false } = {}) {
  const { body, userPrompt } = buildBody(cfg, payload)
  const k = crypto.createHash('md5').update(cfg.model.endpoint + '\n' + JSON.stringify(body)).digest('hex')
  if (!noCache && cache.has(k)) { stats.cached++; return { ...cache.get(k), renderedUserPrompt: userPrompt } }
  const res = await slot(() => httpCall(cfg.model, body, Number(cfg.using.timeout_ms || 120000)))
  stats.calls++
  const usage = toRecord(toRecord(res.raw).usage)
  stats.inTok += Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
  stats.outTok += Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
  let out
  if (res.status < 200 || res.status >= 300) {
    const message = typeof res.raw === 'string' ? res.raw : toText(toRecord(res.raw).error || toRecord(res.raw).message || res.raw)
    out = { ok: false, content: '', error: res.status ? `AI trả về lỗi ${res.status}${message ? `: ${String(message).slice(0, 800)}` : ''}` : message }
    stats.errors++
  } else {
    const content = extractResponseText(res.raw)
    out = content ? { ok: true, content } : { ok: false, content: '', error: 'AI không trả về nội dung.' }
  }
  if (out.ok) { cache.set(k, out); fs.appendFileSync(cachePath, JSON.stringify({ k, v: out }) + '\n') }
  return { ...out, renderedUserPrompt: userPrompt }
}

// Trọng tài: Claude Opus qua /v1/messages (khoá Anthropic của ai_model 39), nhớ như trên.
async function judge(anthropicModelRow, system, user, { model = 'claude-opus-5-5', maxTokens = 2000 } = {}) {
  const body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }
  const k = crypto.createHash('md5').update('judge\n' + JSON.stringify(body)).digest('hex')
  if (cache.has(k)) { stats.cached++; return cache.get(k) }
  const m = { ...anthropicModelRow, endpoint: 'https://api.anthropic.com/v1/messages' }
  const res = await slot(() => httpCall(m, body, 180000, { headers: { 'content-type': 'application/json', 'x-api-key': anthropicModelRow.api_key, 'anthropic-version': '2023-06-01' } }))
  stats.calls++
  if (res.status !== 200) return { ok: false, error: `${res.status} ${toText(res.raw).slice(0, 300)}` }
  const text = (res.raw.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
  const usage = res.raw.usage || {}
  stats.inTok += usage.input_tokens || 0; stats.outTok += usage.output_tokens || 0
  const out = { ok: true, content: text }
  cache.set(k, out); fs.appendFileSync(cachePath, JSON.stringify({ k, v: out }) + '\n')
  return out
}

function parseVerdict(text) {
  const t = String(text || '').trim()
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const b = (f ? f[1] : t).trim()
  const s = b.indexOf('{'), e = b.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try { return JSON.parse(b.slice(s, e + 1)) } catch { return null }
}

module.exports = { rest, loadConfigs, loadModel, loadBlocks, buildBody, renderTemplate, callAiUsing, judge, parseVerdict, stats, DATA }
